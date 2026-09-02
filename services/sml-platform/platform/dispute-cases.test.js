'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createDisputeCases,
  paypalAmountCents,
  STRIPE_DISPUTE_EVENT_TYPES
} = require('./dispute-cases');

const NOW = 1_700_000_000_000;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function iso(ms) { return new Date(ms).toISOString(); }

/* ------------------------------------------------------------------------- */
/* Stateful in-memory fakes (same idiom as stripe-event-store.test.js, plus  */
/* enough table state to exercise replay and ordering).                      */
/* ------------------------------------------------------------------------- */

function harness(options = {}) {
  const state = {
    cases: (options.cases || []).map((row) => ({ ...row })),
    nextCaseId: options.nextCaseId || 1,
    outbox: [],
    appended: [],
    audits: [],
    submissions: (options.submissions || []).map((row) => ({ ...row })),
    stripeEvents: options.stripeEvents || [],
    marketplaceDisputes: new Set(options.marketplaceDisputes || []),
    transactions: options.transactions || [],
    calls: []
  };

  const client = {
    async query(sql, values) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      state.calls.push({ text, values });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rowCount: 0, rows: [] };

      if (text.startsWith('SELECT * FROM dispute_cases WHERE provider')) {
        const row = state.cases.find(
          (c) => c.provider === values[0] && c.provider_dispute_id === values[1]
        );
        return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
      }
      if (text.startsWith('SELECT id, subscription_id, identity_id FROM billing_transactions')) {
        const row = state.transactions.find(
          (t) => t.provider === values[0] && t.provider_transaction_id === values[1] && t.kind === values[2]
        );
        return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
      }
      if (text.startsWith('SELECT stripe_dispute_id FROM marketplace_disputes')) {
        const hit = state.marketplaceDisputes.has(values[0]);
        return { rowCount: hit ? 1 : 0, rows: hit ? [{ stripe_dispute_id: values[0] }] : [] };
      }
      if (text.startsWith('INSERT INTO billing_outbox')) {
        if (state.outbox.some((o) => o.source_key === values[0])) return { rowCount: 0, rows: [] };
        state.outbox.push({
          source_key: values[0], intent_type: values[1], payload: JSON.parse(values[2])
        });
        return { rowCount: 1, rows: [] };
      }
      if (text.startsWith('UPDATE dispute_cases SET')) {
        const row = state.cases.find((c) => Number(c.id) === Number(values[0]));
        if (!row) return { rowCount: 0, rows: [] };
        const setPart = text.slice('UPDATE dispute_cases SET '.length, text.indexOf(' WHERE '));
        for (const fragment of setPart.split(', ')) {
          if (fragment === 'response_cycle = response_cycle + 1') {
            row.response_cycle = Number(row.response_cycle || 1) + 1;
            continue;
          }
          const match = /^(\w+) = \$(\d+)(::jsonb)?$/.exec(fragment);
          if (!match) throw new Error(`fake cannot parse set fragment: ${fragment}`);
          const value = values[Number(match[2]) - 1];
          row[match[1]] = match[3] ? JSON.parse(value) : value;
        }
        return { rowCount: 1, rows: [] };
      }
      if (text.startsWith('SELECT e.event_id')) {
        const types = new Set(values[0]);
        const rows = state.stripeEvents
          .filter((e) => types.has(e.event_type))
          .filter((e) => {
            const dispute = e.payload && e.payload.data && e.payload.data.object;
            const id = dispute && dispute.id;
            return !state.cases.some((c) => c.provider === 'stripe' && c.provider_dispute_id === id);
          })
          .slice(0, values[1]);
        return { rowCount: rows.length, rows };
      }
      if (text.startsWith('SELECT id, provider, provider_dispute_id, due_by')) {
        const allowed = new Set(values[0]);
        const rows = state.cases.filter((c) => c.due_by != null && allowed.has(c.case_state));
        return { rowCount: rows.length, rows: rows.map((r) => ({ ...r })) };
      }
      if (text.startsWith('SELECT ds.id')) {
        const rows = [];
        for (const ds of state.submissions) {
          if (ds.status !== 'submitting' || !(String(ds.created_at) < String(values[0]))) continue;
          const c = state.cases.find((row) => Number(row.id) === Number(ds.case_id));
          if (!c) continue;
          rows.push({
            id: ds.id, case_id: ds.case_id, response_cycle: ds.response_cycle,
            provider: c.provider, provider_dispute_id: c.provider_dispute_id
          });
        }
        return { rowCount: rows.length, rows };
      }
      if (text.startsWith('UPDATE dispute_submissions')) {
        const ds = state.submissions.find((row) => Number(row.id) === Number(values[0]));
        if (!ds || ds.status !== 'submitting') return { rowCount: 0, rows: [] };
        ds.status = values[1];
        ds.submitted_at = values[2];
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`fake client has no handler for: ${text}`);
    },
    release() {}
  };

  const store = {
    async appendRow(_client, { table, fields }) {
      state.appended.push({ table, fields });
      if (table === 'dispute_cases') {
        const row = { id: state.nextCaseId++, ...fields };
        state.cases.push(row);
        return { id: row.id, integrityHash: `hash-${row.id}` };
      }
      return { id: 1000 + state.appended.length, integrityHash: 'hash' };
    },
    async appendChained(_client, { table, scopeKey, fields }) {
      state.audits.push({ table, scopeKey, fields });
      return { id: 2000 + state.audits.length, integrityHash: 'hash' };
    }
  };

  const graph = {
    async findByRef(_client, provider, refType, refValue) {
      return (options.identities || {})[`${provider}:${refType}:${refValue}`] || null;
    }
  };

  const limits = options.limits || {
    checklistForStripe: (reason) => (reason === 'subscription_canceled'
      ? ['cancellation_policy', 'cancellation_policy_disclosure', 'customer_communication']
      : ['product_description', 'customer_communication']),
    checklistForPayPal: () => ['PROOF_OF_FULFILLMENT', 'PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED']
  };

  const pool = { async connect() { return client; } };
  const dc = createDisputeCases({ pool, store, graph, limits, now: options.now || (() => NOW) });
  return { state, dc };
}

function stripeEventRow(eventId, type, dispute, createdMs, account = null) {
  return {
    event_id: eventId,
    event_type: type,
    event_created_at: iso(createdMs),
    payload: {
      id: eventId, type, created: createdMs / 1000, account, data: { object: dispute }
    }
  };
}

function stripeDispute(overrides = {}) {
  return {
    id: 'du_1',
    object: 'dispute',
    amount: 4999,
    currency: 'usd',
    reason: 'subscription_canceled',
    status: 'needs_response',
    charge: 'ch_1',
    evidence_details: { due_by: (NOW + 5 * DAY) / 1000, submission_count: 0 },
    ...overrides
  };
}

function paypalDispute(overrides = {}) {
  return {
    dispute_id: 'PP-D-1',
    reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    status: 'WAITING_FOR_SELLER_RESPONSE',
    dispute_life_cycle_stage: 'INQUIRY',
    dispute_amount: { currency_code: 'USD', value: '49.99' },
    seller_response_due_date: iso(NOW + 4 * DAY),
    links: [{ rel: 'self', href: 'x' }, { rel: 'provide_evidence', href: 'x' }],
    allowed_response_options: {
      provide_evidence: { evidence_types: ['PROOF_OF_FULFILLMENT', 'PROOF_OF_REFUND'] }
    },
    disputed_transactions: [{ seller_transaction_id: 'CAP-1' }],
    ...overrides
  };
}

/* ------------------------------------------------------------------------- */
/* Stripe path                                                               */
/* ------------------------------------------------------------------------- */

test('exports the dispute event type set the sweeps key on', () => {
  for (const type of ['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed',
    'charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated']) {
    assert.equal(STRIPE_DISPUTE_EVENT_TYPES.has(type), true);
  }
  assert.equal(STRIPE_DISPUTE_EVENT_TYPES.has('invoice.paid'), false);
});

test('a dispute with no marketplace seller still creates a case, with checklist and alert', async () => {
  const { state, dc } = harness();
  const result = await dc.applyStripeDisputeEvent(
    stripeEventRow('evt_1', 'charge.dispute.created', stripeDispute(), NOW - DAY)
  );
  assert.deepEqual(result, { caseId: 1, changed: true, stale: false });
  assert.equal(state.cases.length, 1);
  const row = state.cases[0];
  assert.equal(row.provider, 'stripe');
  assert.equal(row.provider_dispute_id, 'du_1');
  assert.equal(row.stripe_dispute_ref, null);
  assert.equal(row.amount_cents, 4999);
  assert.equal(row.case_state, 'open');
  assert.equal(row.response_cycle, 1);
  assert.equal(row.last_event_at, iso(NOW - DAY));
  assert.deepEqual(row.requested_evidence.map((e) => e.kind),
    ['cancellation_policy', 'cancellation_policy_disclosure', 'customer_communication']);
  assert.ok(row.requested_evidence.every((e) => e.state === 'missing'));
  assert.equal(state.outbox.length, 1);
  assert.equal(state.outbox[0].source_key, 'dispute-alert:stripe:du_1:needs_response');
  assert.equal(state.outbox[0].intent_type, 'dispute_alert');
  assert.equal(state.audits.length, 1);
  assert.equal(state.audits[0].fields.action, 'dispute_case_created');
  assert.equal(state.audits[0].scopeKey, 1);
});

test('links stripe_dispute_ref and billing refs when those rows exist', async () => {
  const { state, dc } = harness({
    marketplaceDisputes: ['du_1'],
    transactions: [{
      provider: 'stripe', provider_transaction_id: 'ch_1', kind: 'charge',
      id: 77, subscription_id: 88, identity_id: 99
    }]
  });
  await dc.applyStripeDisputeEvent(
    stripeEventRow('evt_1', 'charge.dispute.created', stripeDispute(), NOW - DAY)
  );
  const row = state.cases[0];
  assert.equal(row.stripe_dispute_ref, 'du_1');
  assert.equal(row.transaction_id, 77);
  assert.equal(row.subscription_id, 88);
  assert.equal(row.identity_id, 99);
});

test('identity falls back to the graph when no billing transaction row matches', async () => {
  const { state, dc } = harness({
    identities: { 'stripe:charge:ch_1': { id: 42 } }
  });
  await dc.applyStripeDisputeEvent(
    stripeEventRow('evt_1', 'charge.dispute.created', stripeDispute(), NOW - DAY)
  );
  assert.equal(state.cases[0].identity_id, 42);
});

test('replaying the same event leaves one case and no duplicate outbox or audit', async () => {
  const { state, dc } = harness();
  const row = stripeEventRow('evt_1', 'charge.dispute.created', stripeDispute(), NOW - DAY);
  const first = await dc.applyStripeDisputeEvent(row);
  const second = await dc.applyStripeDisputeEvent(row);
  assert.equal(first.caseId, second.caseId);
  assert.equal(second.stale, false); /* equal timestamps apply */
  assert.equal(state.cases.length, 1);
  assert.equal(state.outbox.length, 1);
  assert.equal(state.audits.length, 1); /* only case_created; the replay changed nothing */
});

test('an older event cannot regress status or due_by and is recorded as stale', async () => {
  const { state, dc } = harness();
  await dc.applyStripeDisputeEvent(stripeEventRow(
    'evt_2', 'charge.dispute.updated',
    stripeDispute({ status: 'under_review', evidence_details: { due_by: (NOW + 6 * DAY) / 1000 } }),
    NOW - HOUR
  ));
  const outboxBefore = state.outbox.length;
  const result = await dc.applyStripeDisputeEvent(stripeEventRow(
    'evt_1', 'charge.dispute.created',
    stripeDispute({ status: 'needs_response', evidence_details: { due_by: (NOW + 5 * DAY) / 1000 } }),
    NOW - DAY
  ));
  assert.deepEqual(result, { caseId: 1, changed: false, stale: true });
  const row = state.cases[0];
  assert.equal(row.provider_status, 'under_review');
  assert.equal(row.due_by, iso(NOW + 6 * DAY));
  assert.equal(row.last_event_at, iso(NOW - HOUR));
  assert.equal(state.outbox.length, outboxBefore);
  const stale = state.appended.filter((a) => a.table === 'billing_events');
  assert.equal(stale.length, 1);
  assert.equal(stale[0].fields.status, 'stale');
  assert.equal(stale[0].fields.provider_event_id, 'evt_1');
  assert.equal(stale[0].fields.source, 'stripe');
});

test('warning_* -> needs_response bumps the response cycle once, with an audit row', async () => {
  const { state, dc } = harness();
  await dc.applyStripeDisputeEvent(stripeEventRow(
    'evt_1', 'charge.dispute.created', stripeDispute({ status: 'warning_needs_response' }), NOW - 2 * DAY
  ));
  assert.equal(state.cases[0].lifecycle_stage, 'inquiry');

  await dc.applyStripeDisputeEvent(stripeEventRow(
    'evt_2', 'charge.dispute.updated', stripeDispute({ status: 'needs_response' }), NOW - DAY
  ));
  const row = state.cases[0];
  assert.equal(row.response_cycle, 2);
  assert.equal(row.case_state, 'evidence_building'); /* the second cycle may build a new packet */
  assert.equal(row.lifecycle_stage, 'chargeback');
  const bumps = state.audits.filter((a) => a.fields.action === 'response_cycle_bumped');
  assert.equal(bumps.length, 1);
  assert.equal(bumps[0].fields.detail.response_cycle, 2);

  /* a later needs_response event is not another escalation */
  await dc.applyStripeDisputeEvent(stripeEventRow(
    'evt_3', 'charge.dispute.updated', stripeDispute({ status: 'needs_response' }), NOW - HOUR
  ));
  assert.equal(state.cases[0].response_cycle, 2);
  assert.equal(state.audits.filter((a) => a.fields.action === 'response_cycle_bumped').length, 1);
});

test('a closed event maps the terminal provider status onto case_state', async () => {
  const { state, dc } = harness();
  await dc.applyStripeDisputeEvent(stripeEventRow(
    'evt_1', 'charge.dispute.created', stripeDispute(), NOW - DAY
  ));
  await dc.applyStripeDisputeEvent(stripeEventRow(
    'evt_2', 'charge.dispute.closed', stripeDispute({ status: 'won' }), NOW - HOUR
  ));
  assert.equal(state.cases[0].case_state, 'won');
  assert.ok(state.outbox.some((o) => o.source_key === 'dispute-alert:stripe:du_1:won'));
});

test('malformed input is a TypeError, not a silent skip', async () => {
  const { dc } = harness();
  await assert.rejects(() => dc.applyStripeDisputeEvent(null), TypeError);
  await assert.rejects(
    () => dc.applyStripeDisputeEvent(stripeEventRow('evt_1', 'invoice.paid', stripeDispute(), NOW)),
    TypeError
  );
  await assert.rejects(
    () => dc.applyStripeDisputeEvent(stripeEventRow('evt_1', 'charge.dispute.created', { id: '' }, NOW)),
    TypeError
  );
  await assert.rejects(
    () => dc.applyPayPalDispute(paypalDispute(), { eventId: 'WH-1' }), /* no occurredAt/update_time */
    TypeError
  );
});

/* ------------------------------------------------------------------------- */
/* PayPal path                                                               */
/* ------------------------------------------------------------------------- */

test('paypal money strings become integer cents', () => {
  assert.equal(paypalAmountCents({ currency_code: 'USD', value: '49.99' }), 4999);
  assert.equal(paypalAmountCents({ currency_code: 'USD', value: '5' }), 500);
  assert.equal(paypalAmountCents({ currency_code: 'USD', value: '5.1' }), 510);
  assert.equal(paypalAmountCents(null), null);
  assert.throws(() => paypalAmountCents({ value: 'not-money' }), TypeError);
});

test('paypal lifecycle: create, escalate to chargeback (cycle bump), resolve to won', async () => {
  const { state, dc } = harness();
  const created = await dc.applyPayPalDispute(paypalDispute(), {
    eventId: 'WH-1', eventType: 'CUSTOMER.DISPUTE.CREATED', occurredAt: iso(NOW - 2 * DAY)
  });
  assert.deepEqual(created, { caseId: 1, changed: true, stale: false });
  const row = state.cases[0];
  assert.equal(row.provider, 'paypal');
  assert.equal(row.amount_cents, 4999);
  assert.equal(row.currency, 'USD');
  assert.equal(row.lifecycle_stage, 'INQUIRY');
  assert.equal(row.due_by, iso(NOW + 4 * DAY));
  assert.deepEqual(row.requested_evidence.map((e) => e.kind), ['PROOF_OF_FULFILLMENT', 'PROOF_OF_REFUND']);
  assert.ok(row.allowed_actions.includes('provide_evidence'));
  assert.ok(!row.allowed_actions.includes('self'));
  assert.ok(state.outbox.some((o) => o.source_key === 'dispute-alert:paypal:PP-D-1:INQUIRY'));

  await dc.applyPayPalDispute(paypalDispute({ dispute_life_cycle_stage: 'CHARGEBACK' }), {
    eventId: 'WH-2', eventType: 'CUSTOMER.DISPUTE.UPDATED', occurredAt: iso(NOW - DAY)
  });
  assert.equal(state.cases[0].response_cycle, 2);
  assert.equal(state.cases[0].case_state, 'evidence_building');
  assert.equal(state.audits.filter((a) => a.fields.action === 'response_cycle_bumped').length, 1);

  /* CHARGEBACK -> PRE_ARBITRATION is not the INQUIRY escalation; no second bump */
  await dc.applyPayPalDispute(paypalDispute({ dispute_life_cycle_stage: 'PRE_ARBITRATION' }), {
    eventId: 'WH-3', eventType: 'CUSTOMER.DISPUTE.UPDATED', occurredAt: iso(NOW - 12 * HOUR)
  });
  assert.equal(state.cases[0].response_cycle, 2);

  await dc.applyPayPalDispute(paypalDispute({
    dispute_life_cycle_stage: 'CHARGEBACK', status: 'RESOLVED',
    dispute_outcome: { outcome_code: 'RESOLVED_SELLER_FAVOUR' }
  }), {
    eventId: 'WH-4', eventType: 'CUSTOMER.DISPUTE.RESOLVED', occurredAt: iso(NOW - HOUR)
  });
  assert.equal(state.cases[0].case_state, 'won');
  assert.equal(state.cases.length, 1);
});

test('a stale paypal event cannot regress the lifecycle stage', async () => {
  const { state, dc } = harness();
  await dc.applyPayPalDispute(paypalDispute({ dispute_life_cycle_stage: 'CHARGEBACK' }), {
    eventId: 'WH-2', eventType: 'CUSTOMER.DISPUTE.UPDATED', occurredAt: iso(NOW - DAY)
  });
  const result = await dc.applyPayPalDispute(paypalDispute(), {
    eventId: 'WH-1', eventType: 'CUSTOMER.DISPUTE.CREATED', occurredAt: iso(NOW - 2 * DAY)
  });
  assert.equal(result.stale, true);
  assert.equal(state.cases[0].lifecycle_stage, 'CHARGEBACK');
  const stale = state.appended.filter((a) => a.table === 'billing_events');
  assert.equal(stale.length, 1);
  assert.equal(stale[0].fields.provider, 'paypal');
  assert.equal(stale[0].fields.status, 'stale');
});

/* ------------------------------------------------------------------------- */
/* Sweeps                                                                    */
/* ------------------------------------------------------------------------- */

test('sweepStripeCatchUp projects only dispute events that have no case yet', async () => {
  const { state, dc } = harness({
    cases: [{
      id: 50, provider: 'stripe', provider_dispute_id: 'du_existing',
      provider_status: 'needs_response', case_state: 'open', response_cycle: 1,
      last_event_at: iso(NOW - DAY)
    }],
    nextCaseId: 51,
    stripeEvents: [
      stripeEventRow('evt_a', 'charge.dispute.created', stripeDispute({ id: 'du_missed' }), NOW - 2 * DAY),
      stripeEventRow('evt_b', 'charge.dispute.created', stripeDispute({ id: 'du_existing' }), NOW - 2 * DAY),
      stripeEventRow('evt_c', 'invoice.paid', stripeDispute({ id: 'du_other' }), NOW - 2 * DAY)
    ]
  });
  const count = await dc.sweepStripeCatchUp();
  assert.equal(count, 1);
  assert.equal(state.cases.length, 2);
  assert.ok(state.cases.some((c) => c.provider_dispute_id === 'du_missed'));
});

test('deadline buckets fire once each: 72h, 24h, and a per-day past-due key', async () => {
  const openCase = (id, disputeId, dueMs, caseState = 'open') => ({
    id, provider: 'stripe', provider_dispute_id: disputeId, due_by: iso(dueMs),
    amount_cents: 1000, currency: 'usd', case_state: caseState, response_cycle: 1
  });
  const { state, dc } = harness({
    cases: [
      openCase(1, 'du_72', NOW + 48 * HOUR),
      openCase(2, 'du_24', NOW + 12 * HOUR),
      openCase(3, 'du_past', NOW - 2 * HOUR),
      openCase(4, 'du_far', NOW + 100 * HOUR),
      openCase(5, 'du_done', NOW + 12 * HOUR, 'submitted')
    ],
    nextCaseId: 6
  });
  const first = await dc.sweepDeadlines(NOW);
  assert.deepEqual(first.map((a) => a.sourceKey).sort(), [
    'dispute-deadline:stripe:du_24:24h',
    'dispute-deadline:stripe:du_72:72h',
    'dispute-deadline:stripe:du_past:past_due:2023-11-14'
  ]);
  const second = await dc.sweepDeadlines(NOW);
  assert.deepEqual(second, []);
  assert.equal(state.outbox.length, 3);
  assert.ok(state.outbox.every((o) => o.intent_type === 'dispute_deadline'));
  /* the next day, past-due re-alerts exactly once under the new day bucket */
  const nextDay = await dc.sweepDeadlines(NOW + DAY);
  assert.deepEqual(nextDay.map((a) => a.bucket), ['24h', 'past_due:2023-11-15', 'past_due:2023-11-15']);
});

test('stuck submitting rows are resolved from the provider, never blind-retried', async () => {
  const stripeCalls = [];
  const paypalCalls = [];
  const { state, dc } = harness({
    cases: [
      { id: 1, provider: 'stripe', provider_dispute_id: 'du_ok', case_state: 'submitting', response_cycle: 1 },
      { id: 2, provider: 'stripe', provider_dispute_id: 'du_bad', case_state: 'submitting', response_cycle: 1 },
      { id: 3, provider: 'paypal', provider_dispute_id: 'PP-1', case_state: 'submitting', response_cycle: 1 }
    ],
    nextCaseId: 4,
    submissions: [
      { id: 11, case_id: 1, response_cycle: 1, status: 'submitting', created_at: iso(NOW - 20 * 60 * 1000) },
      { id: 12, case_id: 2, response_cycle: 1, status: 'submitting', created_at: iso(NOW - 20 * 60 * 1000) },
      { id: 13, case_id: 3, response_cycle: 1, status: 'submitting', created_at: iso(NOW - 20 * 60 * 1000) },
      { id: 14, case_id: 1, response_cycle: 2, status: 'submitting', created_at: iso(NOW - 5 * 60 * 1000) }
    ]
  });
  const stripe = {
    disputes: {
      async retrieve(id) {
        stripeCalls.push(id);
        return id === 'du_ok'
          ? { id, evidence_details: { submission_count: 1 } }
          : { id, evidence_details: { submission_count: 0 } };
      }
    }
  };
  const paypalClient = {
    async getDispute(id) { paypalCalls.push(id); return { dispute_id: id, status: 'UNDER_REVIEW' }; }
  };

  const count = await dc.sweepStuckSubmissions({ stripe, paypalClient });
  assert.equal(count, 3);
  assert.deepEqual(stripeCalls.sort(), ['du_bad', 'du_ok']);
  assert.deepEqual(paypalCalls, ['PP-1']);

  const byId = (id) => state.submissions.find((s) => s.id === id);
  assert.equal(byId(11).status, 'submitted');
  assert.equal(byId(11).submitted_at, iso(NOW));
  assert.equal(byId(12).status, 'failed');
  assert.equal(byId(12).submitted_at, null);
  assert.equal(byId(13).status, 'submitted');
  assert.equal(byId(14).status, 'submitting'); /* too fresh: untouched */

  assert.equal(state.cases.find((c) => c.id === 1).case_state, 'submitted');
  assert.equal(state.cases.find((c) => c.id === 2).case_state, 'ready_for_review');
  assert.equal(state.cases.find((c) => c.id === 3).case_state, 'submitted');

  const audits = state.audits.filter((a) => a.fields.action === 'submission_reconciled');
  assert.equal(audits.length, 3);
  assert.equal(audits.find((a) => a.fields.detail.submission_id === 11).fields.detail.resolution, 'submitted');
  assert.equal(audits.find((a) => a.fields.detail.submission_id === 12).fields.detail.resolution, 'failed');
  assert.deepEqual(
    audits.find((a) => a.fields.detail.submission_id === 12).fields.detail.provider_detail,
    { submission_count: 0 }
  );
});

test('a provider transport failure leaves the stuck row for the next sweep', async () => {
  const { state, dc } = harness({
    cases: [{ id: 1, provider: 'stripe', provider_dispute_id: 'du_x', case_state: 'submitting', response_cycle: 1 }],
    nextCaseId: 2,
    submissions: [
      { id: 11, case_id: 1, response_cycle: 1, status: 'submitting', created_at: iso(NOW - 20 * 60 * 1000) }
    ]
  });
  const stripe = { disputes: { async retrieve() { throw new Error('network'); } } };
  const count = await dc.sweepStuckSubmissions({ stripe });
  assert.equal(count, 0);
  assert.equal(state.submissions[0].status, 'submitting');
  assert.equal(state.audits.length, 0);
});
