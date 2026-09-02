'use strict';

/* =============================================================================
 * dispute-cases — dispute case projection shared by the Stripe & PayPal paths.
 *
 * applyStripeDisputeEvent consumes an already-committed stripe_events row and
 * runs its OWN short transaction (post-commit driver + catch-up sweep). It is
 * never called inside acceptStripeEvent, so an evidence-side failure cannot
 * roll back or disturb the existing marketplace seller dispute accounting
 * (DESIGN v2 §4b.5). The upsert is unconditional and independent of seller
 * resolution — a case exists even when no marketplace seller resolves;
 * stripe_dispute_ref links to marketplace_disputes only when that row exists.
 *
 * Ordering: dispute_cases.last_event_at is the watermark (Stripe event.created
 * / PayPal resource update_time | event create_time). Older events never mutate
 * the projection; they are recorded in billing_events with status 'stale' via
 * the injected evidence store. Equal timestamps apply — exact replays are
 * already deduplicated by the raw event stores.
 *
 * All cross-module dependencies (evidence store, identity graph, provider
 * limits, provider API clients) are injected. Nothing here requires sibling
 * new modules, calls Date.now() directly (now is injected), or characterizes
 * a customer — every emitted payload carries cited record fields only.
 * ========================================================================== */

const STRIPE_DISPUTE_EVENT_TYPES = new Set([
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated'
]);

/* Case states in which deadline alerts are still actionable. */
const OPEN_CASE_STATES = ['open', 'evidence_building', 'ready_for_review', 'approved'];

/* Provider terminal status -> our case_state. Anything unmapped leaves
 * case_state untouched; the projection never guesses an outcome. */
const STRIPE_TERMINAL_CASE_STATES = {
  won: 'won',
  lost: 'lost',
  warning_closed: 'warning_closed'
};
const PAYPAL_OUTCOME_CASE_STATES = {
  RESOLVED_SELLER_FAVOUR: 'won',
  RESOLVED_BUYER_FAVOUR: 'lost'
};

const PAYPAL_ESCALATION_STAGES = new Set(['CHARGEBACK', 'PRE_ARBITRATION']);

/* Fallback checklist kinds when no limits object is injected (provider-limits
 * is a separate package). Universal background evidence only. */
const DEFAULT_STRIPE_CHECKLIST = [
  'product_description',
  'customer_communication',
  'service_documentation'
];
const DEFAULT_PAYPAL_CHECKLIST = ['PROOF_OF_FULFILLMENT'];

const STUCK_SUBMISSION_AGE_MS = 15 * 60 * 1000;
const HOUR_MS = 3600 * 1000;

function toMs(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function toIso(value) {
  const ms = toMs(value);
  return ms == null ? null : new Date(ms).toISOString();
}

function dayBucket(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function parsePayload(payload) {
  if (payload == null) return null;
  if (typeof payload === 'string') {
    try { return JSON.parse(payload); } catch (_) { return null; }
  }
  return typeof payload === 'object' ? payload : null;
}

/** PayPal money arrives as a decimal string; store integer cents only. */
function paypalAmountCents(amount) {
  if (!amount || typeof amount.value !== 'string' && typeof amount.value !== 'number') return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(amount.value));
  if (!match) throw new TypeError('paypal dispute amount is not a decimal money string');
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0') || 0);
  if (!Number.isSafeInteger(cents)) throw new TypeError('paypal dispute amount is out of range');
  return cents;
}

function checklistEntries(kinds, fallback) {
  const list = Array.isArray(kinds) && kinds.length ? kinds : fallback;
  return list.map((kind) => ({ kind: String(kind), state: 'missing' }));
}

function stripeChecklist(limits, reason) {
  let kinds = null;
  if (limits) {
    if (typeof limits.checklistForStripe === 'function') kinds = limits.checklistForStripe(reason);
    else if (limits.STRIPE_REASON_FIELD_MAP && Array.isArray(limits.STRIPE_REASON_FIELD_MAP[reason])) {
      kinds = limits.STRIPE_REASON_FIELD_MAP[reason];
    }
  }
  return checklistEntries(kinds, DEFAULT_STRIPE_CHECKLIST);
}

function paypalChecklist(limits, reason, requestedTypes) {
  if (Array.isArray(requestedTypes) && requestedTypes.length) {
    return checklistEntries(requestedTypes, DEFAULT_PAYPAL_CHECKLIST);
  }
  let kinds = null;
  if (limits && typeof limits.checklistForPayPal === 'function') kinds = limits.checklistForPayPal(reason);
  return checklistEntries(kinds, DEFAULT_PAYPAL_CHECKLIST);
}

function paypalAllowedActions(resource) {
  const actions = [];
  if (Array.isArray(resource.links)) {
    for (const link of resource.links) {
      if (link && typeof link.rel === 'string' && link.rel && link.rel !== 'self') actions.push(link.rel);
    }
  }
  const options = resource.allowed_response_options;
  if (options && typeof options === 'object') {
    for (const key of Object.keys(options)) {
      if (!actions.includes(key)) actions.push(key);
    }
  }
  return actions;
}

function paypalRequestedEvidenceTypes(resource) {
  const provide = resource.allowed_response_options && resource.allowed_response_options.provide_evidence;
  if (provide && Array.isArray(provide.evidence_types)) return provide.evidence_types.map(String);
  return [];
}

async function enqueueOutbox(client, sourceKey, intentType, payload) {
  const result = await client.query(
    `INSERT INTO billing_outbox (source_key, intent_type, payload)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (source_key) DO NOTHING`,
    [sourceKey, intentType, JSON.stringify(payload)]
  );
  return result.rowCount === 1;
}

function createDisputeCases({ pool, store, graph, limits, now } = {}) {
  if (!pool) throw new TypeError('a pg pool is required');
  if (!store) throw new TypeError('an evidence store is required');
  const clock = now || Date.now;

  function prov(provider, eventId, providerAccount, occurredAtIso, extra) {
    return {
      source: provider,
      source_event_id: eventId,
      provider_account: providerAccount || null,
      occurred_at: occurredAtIso,
      received_at: new Date(clock()).toISOString(),
      provenance: Object.assign({}, extra)
    };
  }

  async function appendAudit(client, caseId, action, detail, provFields) {
    await store.appendChained(client, {
      table: 'dispute_audit_log',
      scopeKey: caseId == null ? 0 : caseId,
      fields: Object.assign({
        case_id: caseId,
        actor_kind: 'system',
        actor_ref: null,
        action,
        detail
      }, provFields)
    });
  }

  async function resolveRefs(client, provider, kind, refValue) {
    const refs = { transactionId: null, subscriptionId: null, identityId: null };
    if (!refValue) return refs;
    const found = await client.query(
      `SELECT id, subscription_id, identity_id FROM billing_transactions
        WHERE provider = $1 AND provider_transaction_id = $2 AND kind = $3
        ORDER BY id DESC LIMIT 1`,
      [provider, refValue, kind]
    );
    const row = found.rows[0];
    if (row) {
      refs.transactionId = row.id;
      refs.subscriptionId = row.subscription_id == null ? null : row.subscription_id;
      refs.identityId = row.identity_id == null ? null : row.identity_id;
    }
    if (refs.identityId == null && graph && typeof graph.findByRef === 'function') {
      const identity = await graph.findByRef(client, provider, kind, refValue);
      if (identity && identity.id != null) refs.identityId = identity.id;
    }
    return refs;
  }

  /**
   * Shared idempotent upsert. Runs in its own short transaction:
   *  - watermark guard (older event -> billing_events 'stale', no mutation)
   *  - unconditional insert independent of any seller resolution
   *  - response_cycle bump exactly on the audited escalation transition
   *  - dispute_alert outbox enqueue with an idempotent source key
   */
  async function applyCase(input) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT * FROM dispute_cases WHERE provider = $1 AND provider_dispute_id = $2 FOR UPDATE`,
        [input.provider, input.providerDisputeId]
      );
      const existing = found.rows[0] || null;
      const eventMs = toMs(input.occurredAtIso);

      if (existing && existing.last_event_at != null && eventMs < toMs(existing.last_event_at)) {
        await store.appendRow(client, {
          table: 'billing_events',
          fields: Object.assign({
            provider: input.provider,
            provider_event_id: input.eventId,
            event_type: input.eventType,
            identity_id: existing.identity_id == null ? null : existing.identity_id,
            payload_hash: null,
            raw_ref: input.rawRef || null,
            status: 'stale'
          }, prov(input.provider, input.eventId, input.providerAccount, input.occurredAtIso, {
            stale_reason: 'event predates applied dispute case state',
            case_id: existing.id
          }))
        });
        await client.query('COMMIT');
        return { caseId: Number(existing.id), changed: false, stale: true };
      }

      let caseId;
      let responseCycle;
      let caseState;
      let bumped = false;

      if (!existing) {
        const refs = await resolveRefs(client, input.provider, input.transactionKind, input.transactionRef);
        let stripeDisputeRef = null;
        if (input.provider === 'stripe') {
          const marketplace = await client.query(
            `SELECT stripe_dispute_id FROM marketplace_disputes WHERE stripe_dispute_id = $1`,
            [input.providerDisputeId]
          );
          if (marketplace.rows[0]) stripeDisputeRef = marketplace.rows[0].stripe_dispute_id;
        }
        caseState = input.terminalCaseState || 'open';
        responseCycle = 1;
        const inserted = await store.appendRow(client, {
          table: 'dispute_cases',
          fields: Object.assign({
            provider: input.provider,
            provider_dispute_id: input.providerDisputeId,
            reason: input.reason,
            provider_status: input.providerStatus,
            lifecycle_stage: input.lifecycleStage,
            amount_cents: input.amountCents,
            currency: input.currency,
            due_by: input.dueBy,
            allowed_actions: input.allowedActions || [],
            requested_evidence: input.checklist,
            transaction_id: refs.transactionId,
            subscription_id: refs.subscriptionId,
            identity_id: refs.identityId,
            merchant_account: input.merchantAccount || null,
            stripe_dispute_ref: stripeDisputeRef,
            case_state: caseState,
            response_cycle: responseCycle,
            last_event_at: input.occurredAtIso
          }, prov(input.provider, input.eventId, input.providerAccount, input.occurredAtIso, {
            event_type: input.eventType
          }))
        });
        caseId = inserted.id;
        await appendAudit(client, caseId, 'dispute_case_created', {
          provider: input.provider,
          provider_dispute_id: input.providerDisputeId,
          provider_status: input.providerStatus,
          lifecycle_stage: input.lifecycleStage,
          case_state: caseState
        }, prov(input.provider, input.eventId, input.providerAccount, input.occurredAtIso, {}));
      } else {
        caseId = Number(existing.id);
        responseCycle = Number(existing.response_cycle || 1);
        caseState = existing.case_state;
        bumped = input.isEscalation(existing);

        const sets = [];
        const values = [caseId];
        const set = (column, value, cast) => {
          values.push(value);
          sets.push(`${column} = $${values.length}${cast || ''}`);
        };
        if (input.reason != null) set('reason', input.reason);
        set('provider_status', input.providerStatus);
        if (input.lifecycleStage != null) set('lifecycle_stage', input.lifecycleStage);
        if (input.amountCents != null) set('amount_cents', input.amountCents);
        if (input.currency != null) set('currency', input.currency);
        if (input.dueBy != null) set('due_by', input.dueBy);
        if (input.allowedActions && input.allowedActions.length) {
          set('allowed_actions', JSON.stringify(input.allowedActions), '::jsonb');
        }
        set('last_event_at', input.occurredAtIso);

        const refs = await resolveRefs(client, input.provider, input.transactionKind, input.transactionRef);
        if (existing.transaction_id == null && refs.transactionId != null) set('transaction_id', refs.transactionId);
        if (existing.subscription_id == null && refs.subscriptionId != null) set('subscription_id', refs.subscriptionId);
        if (existing.identity_id == null && refs.identityId != null) set('identity_id', refs.identityId);
        if (input.provider === 'stripe' && existing.stripe_dispute_ref == null) {
          const marketplace = await client.query(
            `SELECT stripe_dispute_id FROM marketplace_disputes WHERE stripe_dispute_id = $1`,
            [input.providerDisputeId]
          );
          if (marketplace.rows[0]) set('stripe_dispute_ref', marketplace.rows[0].stripe_dispute_id);
        }

        if (bumped) {
          sets.push('response_cycle = response_cycle + 1');
          responseCycle += 1;
          caseState = 'evidence_building';
          set('case_state', caseState);
        } else if (input.terminalCaseState && existing.case_state !== input.terminalCaseState) {
          caseState = input.terminalCaseState;
          set('case_state', caseState);
        }

        await client.query(
          `UPDATE dispute_cases SET ${sets.join(', ')} WHERE id = $1`,
          values
        );

        const statusChanged = existing.provider_status !== input.providerStatus;
        const stateChanged = existing.case_state !== caseState;
        if (bumped) {
          await appendAudit(client, caseId, 'response_cycle_bumped', {
            provider: input.provider,
            provider_dispute_id: input.providerDisputeId,
            from_status: existing.provider_status,
            to_status: input.providerStatus,
            from_stage: existing.lifecycle_stage,
            to_stage: input.lifecycleStage,
            response_cycle: responseCycle
          }, prov(input.provider, input.eventId, input.providerAccount, input.occurredAtIso, {}));
        } else if (statusChanged || stateChanged) {
          await appendAudit(client, caseId, 'dispute_case_updated', {
            provider: input.provider,
            provider_dispute_id: input.providerDisputeId,
            from_status: existing.provider_status,
            to_status: input.providerStatus,
            from_state: existing.case_state,
            to_state: caseState
          }, prov(input.provider, input.eventId, input.providerAccount, input.occurredAtIso, {}));
        }
      }

      await enqueueOutbox(
        client,
        `dispute-alert:${input.provider}:${input.providerDisputeId}:${input.alertStage}`,
        'dispute_alert',
        {
          provider: input.provider,
          providerDisputeId: input.providerDisputeId,
          caseId,
          providerStatus: input.providerStatus,
          lifecycleStage: input.lifecycleStage,
          caseState,
          responseCycle,
          amountCents: input.amountCents,
          currency: input.currency,
          dueBy: input.dueBy
        }
      );

      await client.query('COMMIT');
      return { caseId: Number(caseId), changed: true, stale: false };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
      throw error;
    } finally {
      client.release();
    }
  }

  /** eventRow = a stored stripe_events row: event_id, event_type, event_created_at, payload. */
  async function applyStripeDisputeEvent(eventRow) {
    if (!eventRow || typeof eventRow !== 'object') {
      throw new TypeError('a stored stripe_events row is required');
    }
    const payload = parsePayload(eventRow.payload);
    if (!payload) throw new TypeError('stripe event payload is not readable JSON');
    const eventId = String(eventRow.event_id || eventRow.id || payload.id || '');
    const eventType = String(eventRow.event_type || eventRow.type || payload.type || '');
    if (!eventId) throw new TypeError('stripe event id is required');
    if (!STRIPE_DISPUTE_EVENT_TYPES.has(eventType)) {
      throw new TypeError(`not a stripe dispute event: ${eventType}`);
    }
    const dispute = payload.data && payload.data.object;
    if (!dispute || typeof dispute !== 'object' || typeof dispute.id !== 'string' || !dispute.id) {
      throw new TypeError('stripe dispute object is missing an id');
    }
    const occurredAtIso = toIso(
      eventRow.event_created_at != null
        ? eventRow.event_created_at
        : (payload.created != null ? payload.created * 1000 : null)
    );
    if (!occurredAtIso) throw new TypeError('stripe event created time is required');

    const amountCents = dispute.amount == null ? null : Number(dispute.amount);
    if (amountCents != null && !Number.isSafeInteger(amountCents)) {
      throw new TypeError('stripe dispute amount must be integer cents');
    }
    const status = String(dispute.status || 'needs_response');
    const details = dispute.evidence_details || {};

    return applyCase({
      provider: 'stripe',
      providerDisputeId: dispute.id,
      eventId,
      eventType,
      occurredAtIso,
      rawRef: eventId,
      providerAccount: payload.account || null,
      merchantAccount: payload.account || null,
      reason: dispute.reason == null ? null : String(dispute.reason),
      providerStatus: status,
      lifecycleStage: status.startsWith('warning_') ? 'inquiry' : 'chargeback',
      amountCents,
      currency: dispute.currency == null ? null : String(dispute.currency),
      dueBy: details.due_by != null ? toIso(details.due_by * 1000) : null,
      allowedActions: [],
      checklist: stripeChecklist(limits, dispute.reason),
      transactionKind: 'charge',
      transactionRef: typeof dispute.charge === 'string' ? dispute.charge : null,
      terminalCaseState: STRIPE_TERMINAL_CASE_STATES[status] || null,
      alertStage: status,
      isEscalation: (existing) =>
        typeof existing.provider_status === 'string' &&
        existing.provider_status.startsWith('warning_') &&
        status === 'needs_response'
    });
  }

  /** disputeResource = the PayPal dispute resource; meta from the webhook event. */
  async function applyPayPalDispute(disputeResource, meta = {}) {
    if (!disputeResource || typeof disputeResource !== 'object') {
      throw new TypeError('a paypal dispute resource is required');
    }
    const disputeId = String(disputeResource.dispute_id || '');
    if (!disputeId) throw new TypeError('paypal dispute_id is required');
    const eventId = String(meta.eventId || '');
    if (!eventId) throw new TypeError('paypal event id is required');
    const occurredAtIso = toIso(
      meta.occurredAt != null ? meta.occurredAt : disputeResource.update_time
    );
    if (!occurredAtIso) throw new TypeError('paypal event time is required');

    const stage = disputeResource.dispute_life_cycle_stage == null
      ? null : String(disputeResource.dispute_life_cycle_stage);
    const status = String(disputeResource.status || 'OPEN');
    const outcome = disputeResource.dispute_outcome && disputeResource.dispute_outcome.outcome_code;
    const transactions = Array.isArray(disputeResource.disputed_transactions)
      ? disputeResource.disputed_transactions : [];
    const transactionRef = transactions[0] && transactions[0].seller_transaction_id
      ? String(transactions[0].seller_transaction_id) : null;

    return applyCase({
      provider: 'paypal',
      providerDisputeId: disputeId,
      eventId,
      eventType: String(meta.eventType || ''),
      occurredAtIso,
      rawRef: eventId,
      providerAccount: null,
      merchantAccount: null,
      reason: disputeResource.reason == null ? null : String(disputeResource.reason),
      providerStatus: status,
      lifecycleStage: stage,
      amountCents: paypalAmountCents(disputeResource.dispute_amount),
      currency: disputeResource.dispute_amount && disputeResource.dispute_amount.currency_code
        ? String(disputeResource.dispute_amount.currency_code) : null,
      dueBy: toIso(disputeResource.seller_response_due_date),
      allowedActions: paypalAllowedActions(disputeResource),
      checklist: paypalChecklist(limits, disputeResource.reason, paypalRequestedEvidenceTypes(disputeResource)),
      transactionKind: 'capture',
      transactionRef,
      terminalCaseState: (outcome && PAYPAL_OUTCOME_CASE_STATES[outcome]) || null,
      alertStage: stage || status,
      isEscalation: (existing) =>
        existing.lifecycle_stage === 'INQUIRY' &&
        stage != null && PAYPAL_ESCALATION_STAGES.has(stage)
    });
  }

  /** Catch-up: dispute-type stripe_events rows whose dispute has no case yet. */
  async function sweepStripeCatchUp(limit = 25) {
    const client = await pool.connect();
    let rows;
    try {
      const found = await client.query(
        `SELECT e.event_id, e.event_type, e.event_created_at, e.payload
           FROM stripe_events e
          WHERE e.event_type = ANY($1)
            AND NOT EXISTS (
              SELECT 1 FROM dispute_cases c
               WHERE c.provider = 'stripe'
                 AND c.provider_dispute_id = e.payload->'data'->'object'->>'id')
          ORDER BY e.event_created_at ASC
          LIMIT $2`,
        [Array.from(STRIPE_DISPUTE_EVENT_TYPES), limit]
      );
      rows = found.rows;
    } finally {
      client.release();
    }
    let count = 0;
    for (const row of rows) {
      const result = await applyStripeDisputeEvent(row);
      if (result.changed) count += 1;
    }
    return count;
  }

  /**
   * Approaching-deadline + past-due alerts. Idempotent by outbox source key:
   * '72h' and '24h' fire once per case; past-due is keyed per UTC day bucket
   * so it repeats at most once per day while the case stays open.
   */
  async function sweepDeadlines(nowInput) {
    const nowMs = nowInput == null ? clock() : toMs(nowInput);
    if (nowMs == null) throw new TypeError('sweepDeadlines requires a valid now');
    const client = await pool.connect();
    const alerts = [];
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT id, provider, provider_dispute_id, due_by, amount_cents, currency, case_state
           FROM dispute_cases
          WHERE due_by IS NOT NULL AND case_state = ANY($1)
          ORDER BY due_by ASC`,
        [OPEN_CASE_STATES]
      );
      for (const row of found.rows) {
        const dueMs = toMs(row.due_by);
        if (dueMs == null) continue;
        let bucket = null;
        if (dueMs <= nowMs) bucket = `past_due:${dayBucket(nowMs)}`;
        else if (dueMs - nowMs <= 24 * HOUR_MS) bucket = '24h';
        else if (dueMs - nowMs <= 72 * HOUR_MS) bucket = '72h';
        if (!bucket) continue;
        const sourceKey = `dispute-deadline:${row.provider}:${row.provider_dispute_id}:${bucket}`;
        const enqueued = await enqueueOutbox(client, sourceKey, 'dispute_deadline', {
          provider: row.provider,
          providerDisputeId: row.provider_dispute_id,
          caseId: Number(row.id),
          dueBy: toIso(row.due_by),
          bucket,
          amountCents: row.amount_cents,
          currency: row.currency,
          caseState: row.case_state
        });
        if (enqueued) {
          alerts.push({
            caseId: Number(row.id),
            provider: row.provider,
            providerDisputeId: row.provider_dispute_id,
            bucket,
            sourceKey
          });
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
      throw error;
    } finally {
      client.release();
    }
    return alerts;
  }

  /**
   * Submissions stuck in 'submitting' for >15 min are resolved by asking the
   * provider what actually happened — never by a blind retry, because Stripe
   * submission is one-shot to the bank. Stripe: evidence_details.submission_count
   * >= the submission's response_cycle means the evidence reached Stripe.
   * PayPal: the dispute leaving WAITING_FOR_SELLER_RESPONSE means it arrived.
   */
  async function sweepStuckSubmissions({ stripe, paypalClient } = {}) {
    const cutoffIso = new Date(clock() - STUCK_SUBMISSION_AGE_MS).toISOString();
    const client = await pool.connect();
    let rows;
    try {
      const found = await client.query(
        `SELECT ds.id, ds.case_id, ds.response_cycle, c.provider, c.provider_dispute_id
           FROM dispute_submissions ds
           JOIN dispute_cases c ON c.id = ds.case_id
          WHERE ds.status = 'submitting' AND ds.created_at < $1
          ORDER BY ds.id ASC
          LIMIT 25`,
        [cutoffIso]
      );
      rows = found.rows;
    } finally {
      client.release();
    }

    let count = 0;
    for (const row of rows) {
      let submitted = null;
      let providerDetail = null;
      try {
        if (row.provider === 'stripe') {
          if (!stripe || !stripe.disputes || typeof stripe.disputes.retrieve !== 'function') continue;
          const remote = await stripe.disputes.retrieve(row.provider_dispute_id);
          const submissionCount = Number(
            remote && remote.evidence_details && remote.evidence_details.submission_count || 0
          );
          submitted = submissionCount >= Number(row.response_cycle);
          providerDetail = { submission_count: submissionCount };
        } else if (row.provider === 'paypal') {
          if (!paypalClient || typeof paypalClient.getDispute !== 'function') continue;
          const remote = await paypalClient.getDispute(row.provider_dispute_id);
          const status = String(remote && remote.status || '');
          submitted = status !== '' && status !== 'WAITING_FOR_SELLER_RESPONSE';
          providerDetail = { status };
        } else {
          continue;
        }
      } catch (_) {
        continue; /* transport failure: leave the row for the next sweep */
      }

      const nowIso = new Date(clock()).toISOString();
      const resolution = submitted ? 'submitted' : 'failed';
      const txnClient = await pool.connect();
      try {
        await txnClient.query('BEGIN');
        const updated = await txnClient.query(
          `UPDATE dispute_submissions
              SET status = $2, submitted_at = $3
            WHERE id = $1 AND status = 'submitting'`,
          [row.id, resolution, submitted ? nowIso : null]
        );
        if (updated.rowCount === 1) {
          await txnClient.query(
            `UPDATE dispute_cases SET case_state = $2 WHERE id = $1`,
            [row.case_id, submitted ? 'submitted' : 'ready_for_review']
          );
          await appendAudit(txnClient, Number(row.case_id), 'submission_reconciled', {
            submission_id: Number(row.id),
            provider: row.provider,
            provider_dispute_id: row.provider_dispute_id,
            response_cycle: Number(row.response_cycle),
            resolution,
            provider_detail: providerDetail
          }, prov(row.provider, null, null, nowIso, { sweep: 'stuck_submissions' }));
          count += 1;
        }
        await txnClient.query('COMMIT');
      } catch (error) {
        try { await txnClient.query('ROLLBACK'); } catch (_) { /* original error wins */ }
        throw error;
      } finally {
        txnClient.release();
      }
    }
    return count;
  }

  return {
    applyStripeDisputeEvent,
    applyPayPalDispute,
    sweepStripeCatchUp,
    sweepDeadlines,
    sweepStuckSubmissions
  };
}

module.exports = {
  createDisputeCases,
  paypalAmountCents,
  STRIPE_DISPUTE_EVENT_TYPES
};
