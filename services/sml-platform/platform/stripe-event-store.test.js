'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createStripeEventStore, stripeSubscriptionId } = require('./stripe-event-store');

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
