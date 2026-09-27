'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createStripeEventStore, stripeSubscriptionId, skipRowlessEnabled } = require('./stripe-event-store');

const NOW = 1_700_000_000_000;

function event(type = 'invoice.paid', object = {}) {
  return {
    id: 'evt_store_1',
    type,
    created: NOW / 1000,
    apiVersion: '2024-06-20',
    livemode: true,
    account: null,
    data: { object },
    payloadHash: 'a'.repeat(64)
  };
}

function fakePool(options = {}) {
  const calls = [];
  let released = false;
  const client = {
    async query(sql, values) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ text, values });
      if (text.startsWith('INSERT INTO stripe_events')) {
        return options.duplicate ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ event_id: 'evt_store_1' }] };
      }
      if (text.startsWith('SELECT s.*')) {
        return { rowCount: options.subscription ? 1 : 0, rows: options.subscription ? [options.subscription] : [] };
      }
      if (options.failOn && text.includes(options.failOn)) throw new Error('forced database failure');
      return { rowCount: 1, rows: [] };
    },
    release() { released = true; }
  };
  return {
    calls,
    client,
    pool: { async connect() { return client; } },
    released: () => released
  };
}

function sampleSubscription(overrides = {}) {
  return {
    id: 9,
    user_id: 42,
    group_id: 7,
    plan_id: 3,
    stripe_subscription_id: 'sub_1',
    origin: 'sml_checkout',
    status: 'active',
    platform_fee_bps: 500,
    fee_consent_at: new Date(NOW - 1000).toISOString(),
    first_failed_at: null,
    last_event_at: new Date(NOW - 1000).toISOString(),
    grace_days: 3,
    ...overrides
  };
}

test('subscription id discovery is shape-based, not a second event-type router', () => {
  assert.equal(stripeSubscriptionId(event('invoice.paid', { subscription: 'sub_1' })), 'sub_1');
  assert.equal(stripeSubscriptionId(event('invoice.paid', { subscription: { id: 'sub_expanded' } })), 'sub_expanded');
  assert.equal(stripeSubscriptionId(event('customer.subscription.updated', { id: 'sub_2' })), 'sub_2');
  assert.equal(stripeSubscriptionId(event('charge.succeeded', { id: 'ch_1' })), null);
});

test('one transaction records the event, applies money/state intents, and queues side effects', async () => {
  const db = fakePool({ subscription: sampleSubscription() });
  const accept = createStripeEventStore(db.pool, { now: () => NOW });
  const status = await accept(event('invoice.paid', {
    id: 'in_1', subscription: 'sub_1', charge: 'ch_1', amount_paid: 10_000, currency: 'usd'
  }));

  assert.equal(status, 'processed');
  assert.equal(db.calls[0].text, 'BEGIN');
  assert.equal(db.calls.at(-1).text, 'COMMIT');
  assert.ok(db.calls.some((call) => call.text.startsWith('UPDATE subscriptions SET status')));
  assert.ok(db.calls.some((call) => call.text.startsWith('INSERT INTO platform_fee_ledger')));
  const queued = db.calls.filter((call) => call.text.startsWith('INSERT INTO subscription_intent_outbox'));
  assert.equal(queued.length, 1);
  assert.equal(queued[0].values[2], 'sync_roles');
  assert.ok(db.calls.some((call) => call.text.startsWith('UPDATE stripe_events')));
  assert.equal(db.released(), true);
});

test('the stripe_events primary key makes a replay a successful no-op', async () => {
  const db = fakePool({ duplicate: true });
  const accept = createStripeEventStore(db.pool, { now: () => NOW });
  assert.equal(await accept(event()), 'duplicate');
  assert.deepEqual(db.calls.map((call) => call.text), [
    'BEGIN',
    db.calls[1].text,
    'COMMIT'
  ]);
  assert.equal(db.calls.some((call) => call.text.startsWith('SELECT s.*')), false);
  assert.equal(db.released(), true);
});

test('payment failure updates grace state and queues the notification atomically', async () => {
  const db = fakePool({ subscription: sampleSubscription() });
  const accept = createStripeEventStore(db.pool, { now: () => NOW });
  assert.equal(await accept(event('invoice.payment_failed', { subscription: 'sub_1' })), 'processed');

  const update = db.calls.find((call) => call.text.startsWith('UPDATE subscriptions SET status'));
  assert.match(update.text, /failed_payment_count = failed_payment_count \+ 1/);
  const queued = db.calls.filter((call) => call.text.startsWith('INSERT INTO subscription_intent_outbox'));
  assert.equal(queued.length, 1);
  assert.equal(queued[0].values[2], 'notify');
});

test('an out-of-order event is recorded as stale without mutating subscription state', async () => {
  const db = fakePool({
    subscription: sampleSubscription({ last_event_at: new Date(NOW + 60_000).toISOString() })
  });
  const accept = createStripeEventStore(db.pool, { now: () => NOW });
  assert.equal(await accept(event('invoice.payment_failed', { subscription: 'sub_1' })), 'stale');
  assert.equal(db.calls.some((call) => call.text.startsWith('UPDATE subscriptions')), false);
  const finish = db.calls.find((call) => call.text.startsWith('UPDATE stripe_events'));
  assert.equal(finish.values[1], 'stale');
});

/* ---------- PR-D: rowless subscriptions (SML_LIFECYCLE_SKIP_ROWLESS) ---------- */

const outboxInserts = (db) => db.calls.filter((call) =>
  call.text.startsWith('INSERT INTO subscription_intent_outbox') || call.text.startsWith('INSERT INTO billing_outbox'));

function withEnv(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'SML_LIFECYCLE_SKIP_ROWLESS');
  const prior = process.env.SML_LIFECYCLE_SKIP_ROWLESS;
  if (value == null) delete process.env.SML_LIFECYCLE_SKIP_ROWLESS;
  else process.env.SML_LIFECYCLE_SKIP_ROWLESS = value;
  try { return fn(); } finally {
    if (had) process.env.SML_LIFECYCLE_SKIP_ROWLESS = prior;
    else delete process.env.SML_LIFECYCLE_SKIP_ROWLESS;
  }
}

/* The shapes an Academy package produces on the MEM account's platform
   endpoints: no subscription_key, so no subscriptions row is ever bound. */
const ROWLESS_MEM_EVENTS = [
  ['customer.subscription.created', { id: 'sub_academy', status: 'active', customer: 'cus_a',
    metadata: { sml_kind: 'mem_academy', mem_academy_discord_user: '1051212765475377172' } }],
  ['customer.subscription.updated', { id: 'sub_academy', status: 'active', customer: 'cus_a' }],
  ['invoice.paid', { id: 'in_a', subscription: 'sub_academy', amount_paid: 299, currency: 'usd' }],
  ['invoice.payment_failed', { id: 'in_b', subscription: 'sub_academy' }],
  ['customer.subscription.deleted', { id: 'sub_academy', status: 'canceled' }]
];

test('PR-D regression: a rowless MEM subscription event enqueues no outbox rows and is counted', async () => {
  const db = fakePool();
  const logs = [];
  const accept = createStripeEventStore(db.pool, {
    now: () => NOW, suppressRowless: true, logger: (...args) => logs.push(args)
  });
  for (const [type, object] of ROWLESS_MEM_EVENTS) {
    assert.equal(await accept(event(type, object)), 'processed', type);
  }
  assert.equal(outboxInserts(db).length, 0, 'a rowless subscription must not reach the worker');
  assert.equal(db.calls.at(-1).text, 'COMMIT');
  assert.equal(logs.length, ROWLESS_MEM_EVENTS.length);
  assert.deepEqual(logs.map((l) => l[1]), ROWLESS_MEM_EVENTS.map(() => 'lifecycle_rowless_intents_suppressed'));
  assert.deepEqual(logs.map((l) => l[2].rowlessSuppressedTotal), [1, 2, 3, 4, 5], 'the counter is cumulative');
  assert.equal(logs[0][2].stripeSubscriptionId, 'sub_academy');
  assert.deepEqual(logs[3][2].suppressed, ['notify']);
});

test('PR-D default (flag unset): a rowless event keeps the legacy enqueue', async () => {
  const db = fakePool();
  const logs = [];
  const accept = withEnv(null, () => createStripeEventStore(db.pool, { now: () => NOW, logger: (...a) => logs.push(a) }));
  assert.equal(await accept(event('invoice.paid', { id: 'in_a', subscription: 'sub_academy', amount_paid: 299 })), 'processed');
  const queued = outboxInserts(db);
  assert.equal(queued.length, 1, 'merging with the flag off must change nothing');
  assert.equal(queued[0].values[2], 'sync_roles');
  assert.equal(logs.length, 0);
});

test('PR-D env flag: SML_LIFECYCLE_SKIP_ROWLESS=1 turns suppression on when the store is built', async () => {
  assert.equal(skipRowlessEnabled({ SML_LIFECYCLE_SKIP_ROWLESS: '1' }), true);
  assert.equal(skipRowlessEnabled({ SML_LIFECYCLE_SKIP_ROWLESS: ' 1 ' }), true);
  for (const off of [undefined, '', '0', 'true', 'yes', 'on']) {
    assert.equal(skipRowlessEnabled({ SML_LIFECYCLE_SKIP_ROWLESS: off }), false, String(off));
  }
  assert.equal(skipRowlessEnabled({}), false);

  const db = fakePool();
  const accept = withEnv('1', () => createStripeEventStore(db.pool, { now: () => NOW, logger: () => {} }));
  assert.equal(await accept(event('invoice.payment_failed', { subscription: 'sub_academy' })), 'processed');
  assert.equal(outboxInserts(db).length, 0, 'no null-user notify is queued');

  const explicitOff = fakePool();
  const legacy = withEnv('1', () => createStripeEventStore(explicitOff.pool, { now: () => NOW, suppressRowless: false }));
  await legacy(event('invoice.payment_failed', { subscription: 'sub_academy' }));
  assert.equal(outboxInserts(explicitOff).length, 1, 'an explicit option overrides the environment');
});

test('PR-D flag on still queues side effects for a platform subscription (Connect regression)', async () => {
  const db = fakePool({ subscription: sampleSubscription() });
  const logs = [];
  const accept = createStripeEventStore(db.pool, { now: () => NOW, suppressRowless: true, logger: (...a) => logs.push(a) });
  assert.equal(await accept(event('invoice.paid', {
    id: 'in_1', subscription: 'sub_1', charge: 'ch_1', amount_paid: 10_000, currency: 'usd'
  })), 'processed');
  const queued = outboxInserts(db);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].values[2], 'sync_roles');
  assert.ok(db.calls.some((call) => call.text.startsWith('INSERT INTO platform_fee_ledger')));
  assert.equal(logs.length, 0, 'a rowful event is not counted as rowless');
});

test('PR-D: a throwing logger cannot fail an already committed rowless event', async () => {
  const db = fakePool();
  const accept = createStripeEventStore(db.pool, {
    now: () => NOW, suppressRowless: true, logger: () => { throw new Error('log sink down'); }
  });
  assert.equal(await accept(event('customer.subscription.deleted', { id: 'sub_academy' })), 'processed');
  assert.equal(db.calls.at(-1).text, 'COMMIT');
  assert.equal(db.calls.some((call) => call.text === 'ROLLBACK'), false);
});

test('any intent failure rolls back the event and every state change', async () => {
  const db = fakePool();
  const accept = createStripeEventStore(db.pool, {
    now: () => NOW,
    handleEvent: () => ({ ok: true, intents: [{ type: 'future_unknown_intent' }] })
  });
  await assert.rejects(() => accept(event()), /unsupported lifecycle intent/);
  assert.equal(db.calls.at(-1).text, 'ROLLBACK');
  assert.equal(db.calls.some((call) => call.text === 'COMMIT'), false);
  assert.equal(db.released(), true);
});

/* ---------- Stripe API shape (2025-03-31.basil and later) ---------- */

const basilParent = { type: 'subscription_details', subscription_details: { subscription: 'sub_platform_1' } };

test('LOW (review): subscription id discovery reads parent.subscription_details last, so legacy shapes are unchanged', () => {
  assert.equal(stripeSubscriptionId(event('invoice.paid', { object: 'invoice', id: 'in_basil', parent: basilParent })), 'sub_platform_1');
  assert.equal(stripeSubscriptionId(event('invoice.paid', { id: 'in_1', subscription: 'sub_legacy', parent: basilParent })), 'sub_legacy');
  assert.equal(stripeSubscriptionId(event('invoice.paid', {
    parent: { subscription_details: { subscription: { id: 'sub_expanded' } } } })), 'sub_expanded');
  assert.equal(stripeSubscriptionId(event('invoice.paid', { id: 'in_1', subscription: null })), null);
  assert.equal(stripeSubscriptionId(event('invoice.paid', { id: 'in_q',
    parent: { type: 'quote_details', quote_details: { quote: 'qt_1' } } })), null);
});

test('flag on: a current-shape invoice for a platform subscription is rowful, not suppressed', async () => {
  const db = fakePool({ subscription: sampleSubscription({ stripe_subscription_id: 'sub_platform_1' }) });
  const logs = [];
  const accept = createStripeEventStore(db.pool, { now: () => NOW, suppressRowless: true, logger: (...a) => logs.push(a) });
  assert.equal(await accept(event('invoice.paid', {
    id: 'in_basil', amount_paid: 10_000, currency: 'usd', parent: basilParent
  })), 'processed');
  assert.deepEqual(db.calls.find((call) => call.text.startsWith('SELECT s.*')).values, ['sub_platform_1']);
  assert.equal(db.calls.find((call) => call.text.startsWith('UPDATE subscriptions SET status')).values[0], 'sub_platform_1');
  const queued = outboxInserts(db);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].values[2], 'sync_roles');
  assert.equal(JSON.parse(queued[0].values[3]).stripe_subscription_id, 'sub_platform_1');
  assert.equal(logs.length, 0, 'not logged as Academy/Upgrade.Chat/Substack noise');
});
