'use strict';

/* =============================================================================
 * stripe-ledger — projects committed stripe_events rows into the append-only
 * evidence ledgers:
 *
 *   billing_events          one row per Stripe event (chained, scope 'stripe')
 *   billing_subscriptions   registry row per Stripe subscription (first seen)
 *   billing_transactions    charges / failed attempts, keyed by Stripe ids
 *   refund_events           refunds, keyed by Stripe refund id
 *   cancellation_requests   cancel_at_period_end requests + terminal cancels
 *   entitlement_events      granted / revoked from subscription status
 *
 * Identity linking uses ONLY trusted keys the platform itself created: the
 * membership checkout key, the client_reference_id on a Checkout Session the
 * platform built (metadata.sml_kind), or an engine subscription row bound to
 * the Stripe customer. Email and display name are never consulted.
 *
 * Every event is applied in its own short transaction after the raw event has
 * already been committed to stripe_events (post-commit driver in the API plus
 * a catch-up sweep in the worker). Idempotency comes from billing_events
 * UNIQUE (provider, provider_event_id). Out-of-order delivery cannot corrupt
 * anything: each row is a dated fact, and the registry row is first-seen.
 *
 * This module never logs payloads, emails, or identifiers beyond event ids.
 * ========================================================================== */

const crypto = require('node:crypto');

const OUR_CHECKOUT_KINDS = new Set(['loop_bucks', 'membership']);
const GRANT_STATUSES = new Set(['active', 'trialing']);
const REVOKE_STATUSES = new Set(['canceled', 'unpaid', 'incomplete_expired']);

/* Event families the ledger materializes. Everything else still gets a
 * billing_events row with status 'ignored' so the catch-up cursor advances. */
const SUBSCRIPTION_TYPES = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted'
]);
const INVOICE_PAID_TYPES = new Set(['invoice.paid', 'invoice.payment_succeeded']);
const DISPUTE_TYPES = new Set([
  'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed',
  'charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated'
]);

function unixIso(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function toIso(value) {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function parsePayload(payload) {
  if (payload == null) return null;
  if (typeof payload === 'string') {
    try { return JSON.parse(payload); } catch (_) { return null; }
  }
  return typeof payload === 'object' ? payload : null;
}

function str(value) {
  return typeof value === 'string' && value ? value : null;
}

function idOf(value) {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && typeof value.id === 'string' && value.id) return value.id;
  return null;
}

function objectOf(payload) {
  const object = payload && payload.data && payload.data.object;
  return object && typeof object === 'object' ? object : {};
}

function previousOf(payload) {
  const previous = payload && payload.data && payload.data.previous_attributes;
  return previous && typeof previous === 'object' ? previous : {};
}

function cents(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function planFields(subscription) {
  const item = subscription.items && subscription.items.data && subscription.items.data[0];
  const price = item && item.price && typeof item.price === 'object' ? item.price : null;
  const recurring = price && price.recurring && typeof price.recurring === 'object' ? price.recurring : null;
  const interval = recurring && str(recurring.interval)
    ? (Number(recurring.interval_count) > 1 ? `${recurring.interval_count} ${recurring.interval}` : recurring.interval)
    : null;
  return {
    plan_name: price ? (str(price.nickname) || idOf(price.product)) : null,
    plan_description: null,
    plan_features: null,
    price_cents: price ? cents(price.unit_amount) : null,
    currency: price ? str(price.currency) : null,
    billing_interval: interval
  };
}

/**
 * Origin is derived from facts only. `unknown` is the honest fallback; the
 * evidence engine never upgrades it (DESIGN §4b.12).
 */
function deriveOrigin({ object, engineRow }) {
  const checkoutKey = object.metadata && str(object.metadata.subscription_key);
  const hasTrial = object.trial_start != null && object.trial_end != null;
  if (checkoutKey && engineRow) {
    if (engineRow.origin === 'migrated') {
      return {
        origin: 'explicit_purchase',
        note: 'customer-initiated migration checkout; the first charge was deferred to the provider-verified external renewal date'
      };
    }
    if (engineRow.origin === 'manual_comp') {
      return { origin: 'admin_created', note: 'engine subscription origin manual_comp' };
    }
    return hasTrial
      ? { origin: 'trial_auto_convert', note: 'checkout created a Stripe subscription with a trial; conversion is automatic per the subscription settings' }
      : { origin: 'explicit_purchase', note: 'checkout created a Stripe subscription without a trial' };
  }
  if (object.metadata && str(object.metadata.sml_origin) === 'admin') {
    return { origin: 'admin_created', note: 'metadata sml_origin=admin' };
  }
  return {
    origin: 'unknown',
    note: checkoutKey ? 'checkout key present but no engine subscription row matched' : 'no trusted origin marker on the subscription'
  };
}

function createStripeLedger({ pool, store, graph, now, logger } = {}) {
  if (!pool) throw new TypeError('a pg pool is required');
  if (!store) throw new TypeError('an evidence store is required');
  if (!graph) throw new TypeError('an identity graph is required');
  const clock = now || Date.now;
  const log = typeof logger === 'function' ? logger : () => {};

  function prov(ctx, occurredAt, extra) {
    return {
      source: 'stripe',
      source_event_id: ctx.eventId,
      provider_account: ctx.account,
      occurred_at: occurredAt || ctx.occurredAt,
      received_at: new Date(clock()).toISOString(),
      provenance: Object.assign({ event_type: ctx.eventType }, extra || {})
    };
  }

  /* ---- identity ---------------------------------------------------------- */

  async function resolveIdentity(client, ctx, customerId, hints = {}) {
    if (!customerId) return null;
    const found = await graph.findByRef(client, 'stripe', 'customer', customerId);
    if (found && found.id != null) return Number(found.id);

    let userId = null;
    let via = null;
    if (hints.subscriptionKey) {
      const engine = await client.query(
        `SELECT user_id FROM subscriptions WHERE membership_checkout_key = $1 LIMIT 1`,
        [hints.subscriptionKey]
      );
      if (engine.rows[0]) {
        userId = Number(engine.rows[0].user_id);
        via = `stripe_checkout_key:${hints.subscriptionKey}`;
      }
    }
    if (userId == null && hints.ourCheckout && hints.clientReferenceId) {
      const parsed = Number(hints.clientReferenceId);
      if (Number.isSafeInteger(parsed) && parsed > 0) {
        userId = parsed;
        via = `stripe_checkout_session:${hints.sessionId || 'unknown'}`;
      }
    }
    if (userId == null) {
      const engine = await client.query(
        `SELECT user_id FROM subscriptions WHERE stripe_customer_id = $1 ORDER BY id ASC LIMIT 1`,
        [customerId]
      );
      if (engine.rows[0]) {
        userId = Number(engine.rows[0].user_id);
        via = 'engine_subscription_customer';
      }
    }
    if (!Number.isSafeInteger(userId) || userId < 1) return null;

    try {
      return await graph.linkVerified(client, {
        provider: 'stripe',
        refType: 'customer',
        refValue: customerId,
        sml_user_id: userId,
        wordpress_user_id: userId,
        via,
        prov: prov(ctx, null, { link_via: via })
      });
    } catch (error) {
      if (error instanceof TypeError && /identity_conflict/.test(String(error.message))) {
        ctx.notes.identity_conflict = true;
        return null;
      }
      throw error;
    }
  }

  /* ---- registries -------------------------------------------------------- */

  async function ensureSubscription(client, ctx, object) {
    const providerSubscriptionId = str(object.id);
    if (!providerSubscriptionId) return { id: null, identityId: null, engineRow: null, created: false };
    const engine = await client.query(
      `SELECT id, origin, user_id, group_id FROM subscriptions WHERE stripe_subscription_id = $1 LIMIT 1`,
      [providerSubscriptionId]
    );
    const engineRow = engine.rows[0] || null;
    const existing = await client.query(
      `SELECT id, identity_id FROM billing_subscriptions WHERE provider = 'stripe' AND provider_subscription_id = $1`,
      [providerSubscriptionId]
    );
    if (existing.rows[0]) {
      return {
        id: Number(existing.rows[0].id),
        identityId: existing.rows[0].identity_id == null ? null : Number(existing.rows[0].identity_id),
        engineRow,
        created: false
      };
    }
    const subscriptionKey = object.metadata && str(object.metadata.subscription_key);
    const identityId = await resolveIdentity(client, ctx, idOf(object.customer), { subscriptionKey });
    const origin = deriveOrigin({ object, engineRow });
    const inserted = await store.appendRow(client, {
      table: 'billing_subscriptions',
      fields: Object.assign({
        provider: 'stripe',
        provider_subscription_id: providerSubscriptionId,
        identity_id: identityId,
        merchant_account: ctx.account,
        origin: origin.origin,
        trial_start: unixIso(object.trial_start),
        trial_end: unixIso(object.trial_end),
        engine_subscription_id: engineRow ? Number(engineRow.id) : null
      }, planFields(object), prov(ctx, unixIso(object.created) || ctx.occurredAt, {
        origin_note: origin.note,
        engine_origin: engineRow ? engineRow.origin : null,
        first_seen_event: ctx.eventId
      }))
    });
    return { id: Number(inserted.id), identityId, engineRow, created: true };
  }

  async function findSubscriptionByProviderId(client, providerSubscriptionId) {
    if (!providerSubscriptionId) return null;
    const found = await client.query(
      `SELECT id, identity_id FROM billing_subscriptions WHERE provider = 'stripe' AND provider_subscription_id = $1`,
      [providerSubscriptionId]
    );
    return found.rows[0] || null;
  }

  async function ensureTransaction(client, ctx, input) {
    if (!input.providerTransactionId || input.amountCents == null || !input.currency) return null;
    const existing = await client.query(
      `SELECT id FROM billing_transactions WHERE provider = 'stripe' AND provider_transaction_id = $1 AND kind = $2`,
      [input.providerTransactionId, input.kind]
    );
    if (existing.rows[0]) return Number(existing.rows[0].id);
    const inserted = await store.appendRow(client, {
      table: 'billing_transactions',
      fields: Object.assign({
        provider: 'stripe',
        provider_transaction_id: input.providerTransactionId,
        kind: input.kind,
        amount_cents: input.amountCents,
        currency: input.currency,
        status: input.status || null,
        identity_id: input.identityId == null ? null : input.identityId,
        subscription_id: input.subscriptionId == null ? null : input.subscriptionId
      }, prov(ctx, input.occurredAt, input.extra))
    });
    return Number(inserted.id);
  }

  async function ensureRefund(client, ctx, refund, chargeId) {
    const refundId = str(refund && refund.id);
    const amount = cents(refund && refund.amount);
    const currency = str(refund && refund.currency);
    if (!refundId || amount == null || !currency) return null;
    const existing = await client.query(
      `SELECT id FROM refund_events WHERE provider = 'stripe' AND provider_refund_id = $1`,
      [refundId]
    );
    if (existing.rows[0]) return Number(existing.rows[0].id);
    let transactionId = null;
    if (chargeId) {
      const tx = await client.query(
        `SELECT id FROM billing_transactions WHERE provider = 'stripe' AND provider_transaction_id = $1 AND kind = $2`,
        [chargeId, 'charge']
      );
      if (tx.rows[0]) transactionId = Number(tx.rows[0].id);
    }
    const inserted = await store.appendRow(client, {
      table: 'refund_events',
      fields: Object.assign({
        provider: 'stripe',
        provider_refund_id: refundId,
        transaction_id: transactionId,
        amount_cents: amount,
        currency,
        reason: str(refund.reason),
        status: str(refund.status)
      }, prov(ctx, unixIso(refund.created) || ctx.occurredAt, { charge_id: chargeId || null }))
    });
    return Number(inserted.id);
  }

  async function appendEntitlement(client, ctx, { identityId, engineRow, action, cause, planRef, occurredAt }) {
    await store.appendRow(client, {
      table: 'entitlement_events',
      fields: Object.assign({
        identity_id: identityId,
        group_id: engineRow && engineRow.group_id != null ? Number(engineRow.group_id) : null,
        plan_ref: planRef,
        action,
        cause
      }, prov(ctx, occurredAt, {}))
    });
  }

  async function appendCancellation(client, ctx, { identityId, subscriptionId, requestedAt, effectiveAt, actor }) {
    await store.appendRow(client, {
      table: 'cancellation_requests',
      fields: Object.assign({
        identity_id: identityId,
        subscription_id: subscriptionId,
        requested_at: requestedAt || ctx.occurredAt,
        effective_at: effectiveAt,
        channel: 'stripe',
        actor
      }, prov(ctx, requestedAt || ctx.occurredAt, {}))
    });
  }

  /* ---- per-family handlers ------------------------------------------------ */

  async function handleSubscription(client, ctx, payload) {
    const object = objectOf(payload);
    const previous = previousOf(payload);
    const registry = await ensureSubscription(client, ctx, object);
    const refs = { identityId: registry.identityId, subscriptionId: registry.id, transactionId: null };
    const status = str(object.status) || '';
    const planRef = str(object.id);

    if (ctx.eventType === 'customer.subscription.created') {
      if (GRANT_STATUSES.has(status)) {
        await appendEntitlement(client, ctx, {
          identityId: refs.identityId, engineRow: registry.engineRow, action: 'granted',
          cause: `subscription ${status}`, planRef, occurredAt: unixIso(object.created) || ctx.occurredAt
        });
      }
      return refs;
    }

    if (ctx.eventType === 'customer.subscription.updated') {
      const previousStatus = str(previous.status);
      if (previousStatus && GRANT_STATUSES.has(status) && !GRANT_STATUSES.has(previousStatus)) {
        await appendEntitlement(client, ctx, {
          identityId: refs.identityId, engineRow: registry.engineRow, action: 'granted',
          cause: `subscription ${previousStatus} -> ${status}`, planRef, occurredAt: ctx.occurredAt
        });
      } else if (previousStatus && REVOKE_STATUSES.has(status) && !REVOKE_STATUSES.has(previousStatus)) {
        await appendEntitlement(client, ctx, {
          identityId: refs.identityId, engineRow: registry.engineRow, action: 'revoked',
          cause: `subscription ${previousStatus} -> ${status}`, planRef, occurredAt: ctx.occurredAt
        });
      }
      if (Object.prototype.hasOwnProperty.call(previous, 'cancel_at_period_end') && object.cancel_at_period_end === true) {
        const details = object.cancellation_details && typeof object.cancellation_details === 'object'
          ? object.cancellation_details : {};
        await appendCancellation(client, ctx, {
          identityId: refs.identityId,
          subscriptionId: refs.subscriptionId,
          requestedAt: unixIso(object.canceled_at) || ctx.occurredAt,
          effectiveAt: unixIso(object.cancel_at) || unixIso(object.current_period_end),
          actor: str(details.reason)
        });
      }
      return refs;
    }

    /* customer.subscription.deleted: terminal cancellation. */
    const details = object.cancellation_details && typeof object.cancellation_details === 'object'
      ? object.cancellation_details : {};
    await appendCancellation(client, ctx, {
      identityId: refs.identityId,
      subscriptionId: refs.subscriptionId,
      requestedAt: unixIso(object.canceled_at) || ctx.occurredAt,
      effectiveAt: unixIso(object.ended_at) || unixIso(object.canceled_at) || ctx.occurredAt,
      actor: str(details.reason)
    });
    await appendEntitlement(client, ctx, {
      identityId: refs.identityId, engineRow: registry.engineRow, action: 'revoked',
      cause: 'subscription deleted', planRef, occurredAt: unixIso(object.ended_at) || ctx.occurredAt
    });
    return refs;
  }

  async function handleInvoice(client, ctx, payload) {
    const invoice = objectOf(payload);
    const paid = INVOICE_PAID_TYPES.has(ctx.eventType);
    const subscription = await findSubscriptionByProviderId(client, idOf(invoice.subscription));
    let identityId = subscription && subscription.identity_id != null ? Number(subscription.identity_id) : null;
    if (identityId == null) identityId = await resolveIdentity(client, ctx, idOf(invoice.customer));
    const transitions = invoice.status_transitions && typeof invoice.status_transitions === 'object'
      ? invoice.status_transitions : {};
    const chargeId = idOf(invoice.charge);
    const providerTransactionId = paid
      ? (chargeId || idOf(invoice.payment_intent) || str(invoice.id))
      : (chargeId || `${str(invoice.id) || 'invoice'}:failed:${Number(invoice.attempt_count) || 0}`);
    const transactionId = await ensureTransaction(client, ctx, {
      providerTransactionId,
      kind: 'charge',
      amountCents: paid ? cents(invoice.amount_paid) : cents(invoice.amount_due),
      currency: str(invoice.currency),
      status: paid ? 'succeeded' : 'failed',
      identityId,
      subscriptionId: subscription ? Number(subscription.id) : null,
      occurredAt: (paid ? unixIso(transitions.paid_at) : null) || unixIso(invoice.created) || ctx.occurredAt,
      extra: { invoice_id: str(invoice.id), attempt_count: Number(invoice.attempt_count) || null }
    });
    return { identityId, subscriptionId: subscription ? Number(subscription.id) : null, transactionId };
  }

  async function handleCharge(client, ctx, payload) {
    const charge = objectOf(payload);
    const chargeId = str(charge.id);
    const identityId = await resolveIdentity(client, ctx, idOf(charge.customer));
    let transactionId = null;
    if (ctx.eventType === 'charge.succeeded' || ctx.eventType === 'charge.failed' || ctx.eventType === 'charge.refunded') {
      transactionId = await ensureTransaction(client, ctx, {
        providerTransactionId: chargeId,
        kind: 'charge',
        amountCents: cents(charge.amount),
        currency: str(charge.currency),
        status: ctx.eventType === 'charge.failed' ? 'failed' : (str(charge.status) || 'succeeded'),
        identityId,
        subscriptionId: null,
        occurredAt: unixIso(charge.created) || ctx.occurredAt,
        extra: { payment_intent: idOf(charge.payment_intent), invoice_id: idOf(charge.invoice) }
      });
    }
    if (ctx.eventType === 'charge.refunded') {
      const refunds = charge.refunds && Array.isArray(charge.refunds.data) ? charge.refunds.data : [];
      for (const refund of refunds) await ensureRefund(client, ctx, refund, chargeId);
    }
    return { identityId, subscriptionId: null, transactionId };
  }

  async function handleRefund(client, ctx, payload) {
    const refund = objectOf(payload);
    const chargeId = idOf(refund.charge);
    await ensureRefund(client, ctx, refund, chargeId);
    let transactionId = null;
    if (chargeId) {
      const tx = await client.query(
        `SELECT id FROM billing_transactions WHERE provider = 'stripe' AND provider_transaction_id = $1 AND kind = $2`,
        [chargeId, 'charge']
      );
      if (tx.rows[0]) transactionId = Number(tx.rows[0].id);
    }
    return { identityId: null, subscriptionId: null, transactionId };
  }

  async function handleCheckoutSession(client, ctx, payload) {
    const session = objectOf(payload);
    const ourCheckout = !!(session.metadata && OUR_CHECKOUT_KINDS.has(String(session.metadata.sml_kind || '')));
    const identityId = await resolveIdentity(client, ctx, idOf(session.customer), {
      subscriptionKey: session.metadata && str(session.metadata.subscription_key),
      clientReferenceId: str(session.client_reference_id),
      ourCheckout,
      sessionId: str(session.id)
    });
    return { identityId, subscriptionId: null, transactionId: null };
  }

  async function handleDispute(client, ctx, payload) {
    const dispute = objectOf(payload);
    const chargeId = idOf(dispute.charge);
    let transactionId = null;
    let identityId = null;
    if (chargeId) {
      const tx = await client.query(
        `SELECT id, identity_id FROM billing_transactions WHERE provider = 'stripe' AND provider_transaction_id = $1 AND kind = 'charge'`,
        [chargeId]
      );
      if (tx.rows[0]) {
        transactionId = Number(tx.rows[0].id);
        identityId = tx.rows[0].identity_id == null ? null : Number(tx.rows[0].identity_id);
      }
    }
    return { identityId, subscriptionId: null, transactionId };
  }

  /* ---- entry points ------------------------------------------------------- */

  /** eventRow = a stored stripe_events row: event_id, event_type, event_created_at, payload. */
  async function applyStripeEvent(eventRow) {
    if (!eventRow || typeof eventRow !== 'object') throw new TypeError('a stored stripe_events row is required');
    const payload = parsePayload(eventRow.payload);
    if (!payload) throw new TypeError('stripe event payload is not readable JSON');
    const eventId = str(eventRow.event_id) || str(payload.id);
    const eventType = str(eventRow.event_type) || str(payload.type);
    if (!eventId || !eventType) throw new TypeError('stripe event id and type are required');
    const occurredAt = toIso(eventRow.event_created_at) || unixIso(payload.created);
    if (!occurredAt) throw new TypeError('stripe event created time is required');

    const ctx = {
      eventId,
      eventType,
      occurredAt,
      account: str(payload.account),
      notes: {}
    };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const seen = await client.query(
        `SELECT id FROM billing_events WHERE provider = 'stripe' AND provider_event_id = $1`,
        [eventId]
      );
      if (seen.rows[0]) {
        await client.query('COMMIT');
        return { status: 'duplicate', eventId };
      }

      let refs = { identityId: null, subscriptionId: null, transactionId: null };
      let status = 'applied';
      if (SUBSCRIPTION_TYPES.has(eventType)) refs = await handleSubscription(client, ctx, payload);
      else if (INVOICE_PAID_TYPES.has(eventType) || eventType === 'invoice.payment_failed') refs = await handleInvoice(client, ctx, payload);
      else if (eventType === 'charge.succeeded' || eventType === 'charge.failed' || eventType === 'charge.refunded') refs = await handleCharge(client, ctx, payload);
      else if (eventType === 'refund.created' || eventType === 'refund.updated') refs = await handleRefund(client, ctx, payload);
      else if (eventType === 'checkout.session.completed') refs = await handleCheckoutSession(client, ctx, payload);
      else if (DISPUTE_TYPES.has(eventType)) refs = await handleDispute(client, ctx, payload);
      else status = 'ignored';

      const payloadHash = crypto.createHash('sha256')
        .update(JSON.stringify(payload), 'utf8').digest('hex');
      await store.appendChained(client, {
        table: 'billing_events',
        scopeKey: 'stripe',
        fields: {
          provider: 'stripe',
          provider_event_id: eventId,
          event_type: eventType,
          identity_id: refs.identityId == null ? null : refs.identityId,
          subscription_id: refs.subscriptionId == null ? null : refs.subscriptionId,
          transaction_id: refs.transactionId == null ? null : refs.transactionId,
          payload_hash: payloadHash,
          raw_ref: eventId,
          status,
          source: 'stripe',
          source_event_id: eventId,
          provider_account: ctx.account,
          occurred_at: occurredAt,
          received_at: new Date(clock()).toISOString(),
          provenance: Object.assign({ raw_store: 'stripe_events' }, ctx.notes)
        }
      });
      await client.query('COMMIT');
      return { status, eventId, refs };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
      throw error;
    } finally {
      client.release();
    }
  }

  /** Catch-up: stripe_events rows that have no billing_events row yet. */
  async function sweep(limit = 50) {
    const bounded = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 500) : 50;
    const found = await pool.query(
      `SELECT e.event_id, e.event_type, e.event_created_at, e.payload
         FROM stripe_events e
        WHERE NOT EXISTS (
          SELECT 1 FROM billing_events b
           WHERE b.provider = 'stripe' AND b.provider_event_id = e.event_id)
        ORDER BY e.event_created_at ASC, e.event_id ASC
        LIMIT $1`,
      [bounded]
    );
    const summary = { scanned: found.rows.length, applied: 0, ignored: 0, duplicate: 0, failed: 0 };
    for (const row of found.rows) {
      try {
        const result = await applyStripeEvent(row);
        summary[result.status] = (summary[result.status] || 0) + 1;
      } catch (error) {
        summary.failed += 1;
        log('warn', 'stripe_ledger_apply_failed', { eventId: row.event_id, error });
      }
    }
    return summary;
  }

  return { applyStripeEvent, sweep };
}

module.exports = {
  DISPUTE_TYPES,
  SUBSCRIPTION_TYPES,
  createStripeLedger,
  deriveOrigin,
  planFields
};
