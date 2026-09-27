'use strict';

/* =============================================================================
 * MEM Academy billing: webhook events -> resync triggers.
 *
 * The NEW MEM endpoint receives EVERY subscribed event on the account:
 * Upgrade.Chat, Substack, the store, Creator Tiers, subdomains. record()
 * classifies each one from the payload it already holds, with ZERO Stripe
 * calls for anything that is not ours:
 *
 *   event.account set (Connect) or livemode mismatch  -> ignored
 *   foreign metadata keys (subscription_key, sml_site...) -> ignored
 *   metadata sml_kind=mem_academy                      -> ours
 *   customer bound in academy_billing_members          -> ours
 *   payment_intent in the lifetime cache               -> ours
 *   charge.dispute.* / charge.refund.updated (no customer on the object)
 *                                                      -> pending; resolved
 *                                                         later by ONE charge
 *                                                         lookup
 *   anything else                                      -> ignored
 *
 * Only ids are stored (customer, subscription, payment_intent, charge,
 * checkout_session, invoice, the sml_kind value, the Discord id and intent id
 * from our own metadata) plus the payload sha256. NO payload body is kept, so
 * a stored or deferred row is classified again after a restart from its
 * columns alone.
 *
 * processDue() claims due rows (SKIP LOCKED + lease), coalesces them per
 * Discord user and calls resync ONCE per user per batch. Failures back off
 * 30 s x 2^n up to 6 h; after 20 attempts the row is 'dead' and
 * academy_billing_event_dead is logged.
 *
 * Checkout intents follow the session events, each change audited in the
 * same transaction: expired -> 'expired', async_payment_failed (a bank debit
 * that did not clear) -> 'failed', async_payment_succeeded -> 'completed'.
 * The role itself is still decided only by resync from Stripe: a bank debit
 * grants nothing while its PaymentIntent is 'processing'. charge.failed and
 * payment_intent.payment_failed of a bound customer (or with our metadata) are
 * classified like any other event and just trigger that resync; a debit
 * returned AFTER it succeeded reaches the engine as a dispute
 * (charge.dispute.*).
 * ========================================================================== */

const shapes = require('./stripe-shapes');
const audit = require('./audit');

const SNOWFLAKE = /^[0-9]{15,24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOKUP_TYPES = /^(charge\.dispute\.|charge\.refund\.updated$)/;
/* Checkout session events that move a checkout intent. The intent only moves
   out of created/open (store.markIntentStatus), so replays are no-ops. */
const INTENT_STATUS_BY_EVENT = Object.freeze({
  'checkout.session.expired': 'expired',
  'checkout.session.async_payment_failed': 'failed',
  'checkout.session.async_payment_succeeded': 'completed'
});

function str(value, pattern) {
  const text = shapes.idOf(value);
  return text && (!pattern || pattern.test(text)) ? text : null;
}

/** Pull only ids (and our own metadata values) out of an event. */
function extractIds(event) {
  const object = event && event.data && event.data.object ? event.data.object : {};
  const type = String(event.type || '');
  const ids = {
    objectId: str(object.id),
    customerId: str(object.customer, /^cus_/),
    subscriptionId: null,
    paymentIntentId: null,
    chargeId: null,
    checkoutSessionId: null,
    invoiceId: null,
    metadata: null
  };
  if (type.startsWith('checkout.session.')) {
    ids.checkoutSessionId = str(object.id, /^cs_/);
    ids.subscriptionId = str(object.subscription, /^sub_/);
    ids.paymentIntentId = str(object.payment_intent, /^pi_/);
    ids.metadata = object.metadata || null;
  } else if (type.startsWith('customer.subscription.')) {
    ids.subscriptionId = str(object.id, /^sub_/);
    ids.metadata = object.metadata || null;
  } else if (type.startsWith('invoice.')) {
    ids.invoiceId = str(object.id, /^in_/);
    ids.subscriptionId = str(shapes.invoiceSubscriptionId(object), /^sub_/);
    ids.chargeId = str(shapes.invoiceChargeId(object), /^(ch|py)_/);
    ids.paymentIntentId = str(shapes.invoicePaymentIntentId(object), /^pi_/);
    ids.metadata = shapes.invoiceSubscriptionMetadata(object);
  } else if (type === 'charge.refund.updated' || (object.object === 'refund')) {
    ids.chargeId = str(object.charge, /^(ch|py)_/);
    ids.paymentIntentId = str(object.payment_intent, /^pi_/);
    ids.customerId = null;
  } else if (type.startsWith('charge.dispute.')) {
    ids.chargeId = str(object.charge, /^(ch|py)_/);
    ids.paymentIntentId = str(object.payment_intent, /^pi_/);
    ids.customerId = null;
  } else if (type.startsWith('charge.')) {
    ids.chargeId = str(object.id, /^(ch|py)_/);
    ids.paymentIntentId = str(object.payment_intent, /^pi_/);
    ids.invoiceId = str(object.invoice, /^in_/);
    ids.metadata = object.metadata || null;
  } else if (type.startsWith('payment_intent.')) {
    ids.paymentIntentId = str(object.id, /^pi_/);
    ids.metadata = object.metadata || null;
  }
  const meta = ids.metadata && typeof ids.metadata === 'object' ? ids.metadata : {};
  return {
    ...ids,
    foreign: shapes.hasForeignKeys(meta) && !shapes.isAcademyMeta(meta),
    metaSmlKind: typeof meta.sml_kind === 'string' ? meta.sml_kind.slice(0, 40) : null,
    metaDiscordUser: SNOWFLAKE.test(String(meta.mem_academy_discord_user || '')) ? String(meta.mem_academy_discord_user) : null,
    metaIntent: UUID.test(String(meta.mem_academy_intent || '')) ? String(meta.mem_academy_intent) : null
  };
}

function createEvents({ config, store, stripeApi, resync, logger = () => {}, now = Date.now, isEnabled = () => config.enabled } = {}) {
  /**
   * Classify and store one verified event. No Stripe call. Returns
   * { status: 'pending'|'deferred'|'ignored'|'duplicate', reason }.
   */
  async function record(event) {
    const ids = extractIds(event);
    let status = 'ignored';
    let reason = 'not_academy';
    if (event.account) reason = 'connect_account';
    else if (Boolean(event.livemode) !== Boolean(config.livemode)) reason = 'livemode_mismatch';
    else if (ids.foreign) reason = 'foreign_metadata';
    else if (ids.metaSmlKind === shapes.ACADEMY_KIND) { status = 'pending'; reason = null; }
    else if (ids.customerId && await store.getMemberByCustomer(store.pool, ids.customerId)) { status = 'pending'; reason = null; }
    else if (ids.paymentIntentId && await store.lifetimeByPaymentIntent(store.pool, ids.paymentIntentId)) { status = 'pending'; reason = null; }
    else if (LOOKUP_TYPES.test(event.type) && ids.chargeId) { status = 'pending'; reason = null; }
    else if (ids.metaSmlKind) reason = 'foreign_kind';

    if (status === 'pending' && !isEnabled()) status = 'deferred';
    const inserted = await store.insertEvent(store.pool, {
      eventId: event.id,
      type: event.type,
      livemode: event.livemode,
      account: event.account,
      apiVersion: event.apiVersion,
      created: event.created,
      objectId: ids.objectId,
      customerId: ids.customerId,
      subscriptionId: ids.subscriptionId,
      paymentIntentId: ids.paymentIntentId,
      chargeId: ids.chargeId,
      checkoutSessionId: ids.checkoutSessionId,
      invoiceId: ids.invoiceId,
      metaSmlKind: ids.metaSmlKind,
      metaDiscordUser: ids.metaDiscordUser,
      metaIntent: ids.metaIntent,
      payloadSha256: event.payloadHash,
      status,
      ignoreReason: reason
    });
    if (inserted === 'duplicate') return { status: 'duplicate' };
    return { status, reason };
  }

  /**
   * Resolve the Discord user a stored row belongs to, from its columns.
   * Returns { discordId } | { ignore: reason }.
   */
  async function resolveTarget(row) {
    const q = store.pool;
    let member = row.customer_id ? await store.getMemberByCustomer(q, row.customer_id) : null;
    if (!member && row.payment_intent_id) {
      const lifetime = await store.lifetimeByPaymentIntent(q, row.payment_intent_id);
      if (lifetime) member = await store.getMember(q, lifetime.discord_user_id);
    }
    if (!member && row.charge_id && LOOKUP_TYPES.test(row.type)) {
      /* Disputes and refund updates carry no customer: ONE charge lookup. */
      const charge = await stripeApi.retrieveCharge(row.charge_id);
      const customerId = shapes.customerIdOf(charge);
      if (customerId) member = await store.getMemberByCustomer(q, customerId);
      if (!member && charge && charge.payment_intent) {
        const lifetime = await store.lifetimeByPaymentIntent(q, shapes.idOf(charge.payment_intent));
        if (lifetime) member = await store.getMember(q, lifetime.discord_user_id);
      }
      if (!member) return { ignore: 'charge_not_academy' };
    }
    if (member) {
      if (row.meta_discord_user && row.meta_discord_user !== member.discord_user_id) {
        await audit.appendStandalone(q, {
          actor: 'webhook', livemode: config.livemode, discordUserId: member.discord_user_id, action: 'binding_conflict',
          outcome: 'noop', reason: 'event_metadata_discord_mismatch', eventId: row.event_id,
          stripeRefs: [row.customer_id, row.subscription_id].filter(Boolean),
          details: { metadataDiscordUser: row.meta_discord_user }
        }, { now });
      }
      return { discordId: String(member.discord_user_id) };
    }
    /* Our metadata on an unbound customer: rebuild the binding (DB rollback),
       but only from the Customer's OWN metadata, re-read from Stripe. */
    if (row.meta_sml_kind === shapes.ACADEMY_KIND && row.customer_id) {
      const customer = await stripeApi.retrieveCustomer(row.customer_id);
      const meta = customer && !customer.deleted ? customer.metadata || {} : {};
      const discordId = SNOWFLAKE.test(String(meta.mem_academy_discord_user || '')) ? String(meta.mem_academy_discord_user) : null;
      if (!shapes.isAcademyMeta(meta) || !discordId) return { ignore: 'customer_not_academy' };
      const rebuilt = await store.withUserTx(discordId, async (client) => {
        const n = await store.upsertRebuiltMember(client, { discordId, customerId: row.customer_id, accountId: config.stripeAccountId });
        if (n) {
          await audit.append(client, { actor: 'webhook', livemode: config.livemode, discordUserId: discordId, action: 'binding_rebuilt',
            outcome: 'applied', reason: 'customer_metadata', eventId: row.event_id, stripeRefs: [row.customer_id] }, { now });
        }
        return n;
      });
      if (!rebuilt) {
        const existing = await store.getMember(q, discordId);
        if (!existing || existing.stripe_customer_id !== row.customer_id) return { ignore: 'binding_not_rebuildable' };
      }
      return { discordId };
    }
    return { ignore: 'not_bound' };
  }

  async function applyIntentSideEffects(row) {
    const status = INTENT_STATUS_BY_EVENT[row.type] || null;
    if (!status || (!row.meta_intent && !row.checkout_session_id)) return;
    const change = async (client) => {
      const changed = await store.markIntentStatus(client, { id: row.meta_intent || null, sessionId: row.checkout_session_id || null, status });
      for (const intent of changed) {
        await audit.append(client, { actor: 'webhook', livemode: config.livemode, discordUserId: intent.discord_user_id, action: `intent_${status}`,
          outcome: 'applied', reason: row.type, eventId: row.event_id,
          stripeRefs: [intent.stripe_checkout_session_id || row.checkout_session_id].filter(Boolean), details: { intent: intent.id } }, { now });
      }
      return changed.length;
    };
    /* Under the member's lock when our metadata names them (as checkout.js
       does for the same rows); a bare transaction otherwise. */
    if (row.meta_discord_user) await store.withUserTx(row.meta_discord_user, change);
    else await store.withTx(change);
  }

  async function processDue({ limit = 25 } = {}) {
    if (!isEnabled()) return { claimed: 0 };
    const rows = await store.claimEvents(limit);
    const groups = new Map();
    const outcome = { claimed: rows.length, processed: 0, ignored: 0, failed: 0, dead: 0, users: 0 };
    for (const row of rows) {
      try {
        await applyIntentSideEffects(row);
        const target = await resolveTarget(row);
        if (target.ignore) {
          await store.finishEvent(store.pool, { eventId: row.event_id, status: 'ignored', reason: target.ignore });
          outcome.ignored += 1;
          continue;
        }
        if (!groups.has(target.discordId)) groups.set(target.discordId, []);
        groups.get(target.discordId).push(row);
      } catch (error) {
        await fail(row, error, outcome);
      }
    }
    for (const [discordId, group] of groups) {
      outcome.users += 1;
      try {
        const result = await resync(discordId, { actor: 'webhook', eventId: group[group.length - 1].event_id });
        if (result && result.deferredRevokes > 0) {
          /* Revokes were held back by an incomplete snapshot: retry later. */
          for (const row of group) await retry(row, 'revokes_deferred_incomplete_snapshot', 300, outcome);
          continue;
        }
        for (const row of group) {
          await store.finishEvent(store.pool, { eventId: row.event_id, status: 'processed' });
          outcome.processed += 1;
        }
      } catch (error) {
        for (const row of group) await fail(row, error, outcome);
      }
    }
    return outcome;
  }

  async function retry(row, message, delaySeconds, outcome) {
    const state = await store.retryEvent(store.pool, { eventId: row.event_id, error: message, delaySeconds });
    if (state && state.status === 'dead') {
      outcome.dead += 1;
      logger('error', 'academy_billing_event_dead', { eventId: row.event_id, type: row.type, attempts: state.attempts });
    } else outcome.failed += 1;
  }

  async function fail(row, error, outcome) {
    const message = String(error && (error.code || error.kind || error.type || error.message) || 'error').slice(0, 300);
    logger('warn', 'academy_billing_event_failed', { eventId: row.event_id, type: row.type, error: message });
    await retry(row, message, null, outcome);
  }

  return { record, processDue, resolveTarget, extractIds };
}

module.exports = { createEvents, extractIds, INTENT_STATUS_BY_EVENT };
