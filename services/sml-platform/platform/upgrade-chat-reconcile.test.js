'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createMinIntervalLimiter,
  createUpgradeChatReconciler,
  upgradeChatSaysActive
} = require('./upgrade-chat-reconcile');

const NOW = 1_700_000_000_000;
const EVENT_ID = '7f3b2c1d-9a8e-4f6b-8c5d-2e1f0a9b8c7d';
const ORDER_UUID = '2b8e8d9e-1c2f-4a5b-9c3d-7e6f5a4b3c2d';

function ucRecord(overrides = {}) {
  return {
    id: 10,
    webhook_event_id: EVENT_ID,
    uc_order_uuid: ORDER_UUID,
    record_type: 'order.updated',
    payload: { event: { type: 'order.updated' }, order: { uuid: ORDER_UUID, cancelled_at: null } },
    payment_processor: 'PAYPAL',
    payment_processor_record_id: 'I-REALSUB123',
    discord_user_id: '123456789012345678',
    ...overrides
  };
}

function fakePool(rows) {
  const queries = [];
  return {
    queries,
    pool: {
      async query(sql, values) {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        queries.push({ text, values });
        return { rowCount: rows.length, rows };
      }
    }
  };
}

function build({ rows = [ucRecord()], transaction = null, subscription = null, client = null,
  minIntervalMs = 0, now = () => NOW, sleep = async () => {} } = {}) {
  const db = fakePool(rows);
  const candidates = [];
  const contradictions = [];
  const lookupCalls = [];
  const reconciler = createUpgradeChatReconciler({
    pool: db.pool,
    lookups: {
      async findTransactionByProcessorRecordId(provider, recordId) {
        lookupCalls.push(['transaction', provider, recordId]);
        return transaction;
      },
      async findSubscriptionByProcessorRecordId(provider, recordId) {
        lookupCalls.push(['subscription', provider, recordId]);
        return subscription;
      }
    },
    recordCandidateRef: async (input) => { candidates.push(input); },
    recordContradiction: async (input) => { contradictions.push(input); },
    upgradeChatClient: client,
    minIntervalMs,
    now,
    sleep
  });
  return { db, candidates, contradictions, lookupCalls, reconciler };
}

test('constructor rejects missing injected dependencies', () => {
  const lookups = {
    findTransactionByProcessorRecordId: async () => null,
    findSubscriptionByProcessorRecordId: async () => null
  };
  assert.throws(() => createUpgradeChatReconciler({ pool: { query: async () => {} }, lookups,
    recordCandidateRef: async () => {} }), TypeError);
  assert.throws(() => createUpgradeChatReconciler({ pool: { query: async () => {} },
    recordCandidateRef: async () => {}, recordContradiction: async () => {} }), TypeError);
  assert.throws(() => createUpgradeChatReconciler({ lookups,
    recordCandidateRef: async () => {}, recordContradiction: async () => {} }), TypeError);
});

test('sweep bounds: the limit lands in the SQL and bad limits are TypeErrors', async () => {
  const { db, reconciler } = build({ rows: [] });
  await reconciler.sweep({ limit: 7, sinceId: 3 });
  assert.deepEqual(db.queries[0].values, [7, 3]);
  for (const limit of [0, -1, 501, 2.5, 'many']) {
    await assert.rejects(() => reconciler.sweep({ limit }), TypeError);
  }
  await assert.rejects(() => reconciler.sweep({ sinceId: -1 }), TypeError);
});

test('the sweep is read-only: every query it issues is a SELECT on its own ledger', async () => {
  const { db, reconciler } = build({
    transaction: { id: 71, identity_id: 4 },
    subscription: { id: 81, identity_id: 4, status: 'canceled' }
  });
  await reconciler.sweep({ limit: 25 });
  assert.ok(db.queries.length >= 1);
  for (const query of db.queries) {
    assert.match(query.text, /^SELECT/i);
    assert.match(query.text, /FROM upgrade_chat_records/);
    assert.doesNotMatch(query.text, /billing_transactions|billing_subscriptions/);
  }
});

test('matches become candidate identity refs — never verified — citing both rows', async () => {
  const { candidates, lookupCalls, reconciler } = build({
    transaction: { id: 71, identity_id: 4 },
    subscription: { id: 81, identity_id: 4, status: 'active' }
  });
  const summary = await reconciler.sweep();

  assert.deepEqual(lookupCalls, [
    ['transaction', 'paypal', 'I-REALSUB123'],
    ['subscription', 'paypal', 'I-REALSUB123']
  ]);
  assert.equal(summary.matchedTransactions, 1);
  assert.equal(summary.matchedSubscriptions, 1);
  assert.equal(candidates.length, 2);
  for (const candidate of candidates) {
    assert.equal(candidate.verification, 'candidate');
    assert.equal(candidate.provider, 'upgrade_chat');
    assert.equal(candidate.identityId, 4);
    assert.equal(candidate.refValue, ORDER_UUID);
    assert.deepEqual(candidate.citedRecords[0], { table: 'upgrade_chat_records', id: 10 });
    assert.equal(candidate.prov.source, 'upgrade_chat');
    assert.equal(candidate.prov.source_event_id, EVENT_ID);
    assert.equal(candidate.prov.received_at, new Date(NOW).toISOString());
  }
  assert.deepEqual(candidates.map((c) => c.refType), ['uc_transaction', 'uc_subscription']);
  assert.deepEqual(candidates[0].citedRecords[1], { table: 'billing_transactions', id: 71 });
  assert.deepEqual(candidates[1].citedRecords[1], { table: 'billing_subscriptions', id: 81 });
});

test('UC-active vs processor-canceled is recorded as a contradiction, not a mutation', async () => {
  const { db, contradictions, reconciler } = build({
    subscription: { id: 81, identity_id: 4, status: 'canceled' }
  });
  const summary = await reconciler.sweep();
  assert.equal(summary.contradictions, 1);
  assert.equal(contradictions[0].code, 'upgrade_chat_active_processor_canceled');
  assert.equal(contradictions[0].detail.processor_status, 'canceled');
  assert.equal(contradictions[0].detail.upgrade_chat_cancelled_at, null);
  assert.deepEqual(contradictions[0].citedRecords, [
    { table: 'upgrade_chat_records', id: 10 },
    { table: 'billing_subscriptions', id: 81 }
  ]);
  /* Neutral, cited language only — no characterization of anyone. */
  assert.doesNotMatch(JSON.stringify(contradictions[0]), /lying|fraudulent customer/i);
  for (const query of db.queries) assert.match(query.text, /^SELECT/i);
});

test('UC-cancelled vs processor-active is the mirrored contradiction; agreement records none', async () => {
  const cancelled = ucRecord({ payload: { order: { uuid: ORDER_UUID, cancelled_at: '2026-08-10T00:00:00Z' } } });
  const mismatch = build({ rows: [cancelled], subscription: { id: 81, identity_id: 4, status: 'active' } });
  const summary = await mismatch.reconciler.sweep();
  assert.equal(summary.contradictions, 1);
  assert.equal(mismatch.contradictions[0].code, 'upgrade_chat_cancelled_processor_active');
  assert.equal(mismatch.contradictions[0].detail.upgrade_chat_cancelled_at, '2026-08-10T00:00:00Z');

  const agreement = build({ rows: [cancelled], subscription: { id: 81, identity_id: 4, status: 'canceled' } });
  assert.equal((await agreement.reconciler.sweep()).contradictions, 0);
});

test('unknown processors and unmatched records produce no candidate writes', async () => {
  const { candidates, contradictions, lookupCalls, reconciler } = build({
    rows: [ucRecord({ id: 11, payment_processor: 'CRYPTO' }), ucRecord({ id: 12 })]
  });
  const summary = await reconciler.sweep();
  assert.equal(summary.scanned, 2);
  assert.equal(summary.lastId, 12);
  assert.equal(candidates.length, 0);
  assert.equal(contradictions.length, 0);
  /* The unknown processor is skipped before any lookup. */
  assert.equal(lookupCalls.every(([, provider]) => provider === 'paypal'), true);
  assert.equal(lookupCalls.length, 2);
});

test('API refreshes are rate-limited by the minimum interval with the injected clock', async () => {
  const sleeps = [];
  const orderCalls = [];
  const client = { async getOrder(uuid) { orderCalls.push(uuid); return { uuid, cancelled_at: null }; } };
  const { reconciler } = build({
    rows: [ucRecord({ id: 10 }), ucRecord({ id: 11 })],
    client,
    minIntervalMs: 1000,
    now: () => NOW,
    sleep: async (ms) => { sleeps.push(ms); }
  });
  await reconciler.sweep();
  assert.equal(orderCalls.length, 2);
  /* First call goes straight through; the second waits out the interval. */
  assert.deepEqual(sleeps, [1000]);
});

test('a failed API refresh falls back to the stored payload and the sweep continues', async () => {
  const client = { async getOrder() { throw new Error('rate limited'); } };
  const { contradictions, reconciler } = build({
    client,
    subscription: { id: 81, identity_id: 4, status: 'canceled' }
  });
  const summary = await reconciler.sweep();
  assert.equal(summary.scanned, 1);
  assert.equal(summary.contradictions, 1);
  assert.equal(contradictions[0].code, 'upgrade_chat_active_processor_canceled');
});

test('a fresh API order takes precedence over the stored payload for conflict checks', async () => {
  const client = {
    async getOrder(uuid) { return { uuid, cancelled_at: '2026-08-20T00:00:00Z' }; }
  };
  const { contradictions, reconciler } = build({
    client,
    subscription: { id: 81, identity_id: 4, status: 'active' }
  });
  await reconciler.sweep();
  assert.equal(contradictions.length, 1);
  assert.equal(contradictions[0].code, 'upgrade_chat_cancelled_processor_active');
});

test('limiter unit: spacing calls by the interval, validating its inputs', async () => {
  let clock = 0;
  const sleeps = [];
  const limiter = createMinIntervalLimiter({
    minIntervalMs: 500,
    now: () => clock,
    sleep: async (ms) => { sleeps.push(ms); clock += ms; }
  });
  await limiter();
  await limiter();
  await limiter();
  assert.deepEqual(sleeps, [500, 500]);
  assert.throws(() => createMinIntervalLimiter({ minIntervalMs: -1, sleep: async () => {} }), TypeError);
  assert.throws(() => createMinIntervalLimiter({ minIntervalMs: 100 }), TypeError);
});

test('upgradeChatSaysActive reads only what the payload actually proves', () => {
  assert.equal(upgradeChatSaysActive({ order: { cancelled_at: null } }), true);
  assert.equal(upgradeChatSaysActive({ order: { cancelled_at: '2026-08-10' } }), false);
  assert.equal(upgradeChatSaysActive({ order: { deleted: '2026-08-10', cancelled_at: null } }), false);
  assert.equal(upgradeChatSaysActive({ event: { data: { cancelled_at: null, uuid: ORDER_UUID } } }), true);
  assert.equal(upgradeChatSaysActive({ unrelated: true }), null);
  assert.equal(upgradeChatSaysActive(null), null);
});
