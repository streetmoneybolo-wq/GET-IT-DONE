'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const W = require('./billing-worker');
const { createDiscordAccessHandler } = require('./worker');

test('outbox retry delay is bounded exponential backoff', () => {
  assert.equal(W.retryDelaySeconds(0), 30);
  assert.equal(W.retryDelaySeconds(3), 240);
  assert.equal(W.retryDelaySeconds(99), 3600);
});

test('seller recovery reverses the original transfer before account debit', async () => {
  const calls = [];
  const stripe = {
    charges: {
      retrieve: async () => ({ transfer: 'tr_1' }),
      create: async (params, options) => { calls.push(['debit', params, options]); }
    },
    transfers: {
      retrieve: async () => ({ amount: 9500, amount_reversed: 0 }),
      createReversal: async (id, params, options) => { calls.push(['reverse', id, params, options]); }
    }
  };
  const handle = W.createStripeRecoveryHandler(stripe);
  await handle({ amountCents: 10000, chargeId: 'ch_1', connectedAccountId: 'acct_1',
    currency: 'usd', disputeId: 'dp_1', reason: 'dispute_principal' },
  { source_key: 'seller-recover-principal:dp_1' });
  assert.equal(calls[0][0], 'reverse');
  assert.equal(calls[0][2].amount, 9500);
  assert.equal(calls[1][0], 'debit');
  assert.equal(calls[1][1].amount, 500);
});

test('12.5% dispute fee uses a separate account debit', async () => {
  const calls = [];
  const stripe = {
    charges: { create: async (params) => { calls.push(params); } },
    transfers: {}
  };
  const handle = W.createStripeRecoveryHandler(stripe);
  await handle({ amountCents: 1250, connectedAccountId: 'acct_1', currency: 'usd',
    disputeId: 'dp_1', reason: 'platform_dispute_fee_12_5_percent' },
  { source_key: 'seller-recover-fee:dp_1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].amount, 1250);
  assert.equal(calls[0].source, 'acct_1');
});

test('a won dispute returns funds to the connected seller', async () => {
  const calls = [];
  const stripe = { transfers: { create: async (params, options) => calls.push({ params, options }) } };
  const handle = W.createStripeRestoreHandler(stripe);
  await handle({ amountCents: 10000, connectedAccountId: 'acct_1', currency: 'usd', disputeId: 'dp_1' },
    { source_key: 'seller-restore:dp_1' });
  assert.equal(calls[0].params.destination, 'acct_1');
  assert.equal(calls[0].params.amount, 10000);
});

test('access outbox payload is enriched with real roles and Discord identities', async () => {
  const client = { query: async () => ({ rows: [{
    id: 44, user_id: 7, group_id: 9, status: 'active', access_until: null,
    discord_user_id: '1051212765475377172', guild_id: '938894329076940820',
    grants: [{ target: 'discord_guild_role', roleRef: '939031140679970867' }]
  }] }) };
  const row = await W.enrichAccessPayload(client, {
    intent_type: 'subscription_access_reconcile', payload: { subscriptionId: 44 }
  });
  assert.equal(row.payload.active, true);
  assert.equal(row.payload.discordUserId, '1051212765475377172');
  assert.equal(row.payload.grants.length, 1);
});

test('Discord membership handler applies every mapped role', async () => {
  const calls = [];
  const handler = createDiscordAccessHandler('bot-token', async (url, options) => {
    calls.push({ url, options });
    return { status: 204, headers: { get: () => null } };
  });
  await handler({ active: true, guildId: '938894329076940820', discordUserId: '1051212765475377172',
    grants: [{ target: 'discord_guild_role', roleRef: '939031140679970867' }] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'PUT');
  assert.match(calls[0].url, /939031140679970867$/);
});

/* ---------- PR-D: dead-letter cap (SML_BILLING_OUTBOX_MAX_ATTEMPTS) ---------- */

/* An in-memory billing_outbox that honours the claim predicate
   (status pending|failed AND available_at <= now()), so "never claimed again"
   is observed rather than assumed. 'infinity' is stored as Infinity. Pass a
   subscriptionRow to make enrichAccessPayload find a real platform
   subscription; without one every access row is rowless. */
function outboxDb(rows, subscriptionRow) {
  const clock = { now: 1_000_000 };
  const store = new Map(rows.map((r) => [r.id, {
    status: 'failed', attempts: 0, available_at: 0, last_error: null,
    debt_recorded_cents: 0, source_key: 'k:' + r.id, payload: {}, ...r
  }]));
  const sql = [];
  const client = {
    async query(text, values = []) {
      const q = String(text).replace(/\s+/g, ' ').trim();
      sql.push({ q, values });
      if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (q.startsWith('SELECT * FROM billing_outbox WHERE status IN')) {
        const due = [...store.values()]
          .filter((r) => (r.status === 'pending' || r.status === 'failed') && r.available_at <= clock.now)
          .sort((a, b) => a.available_at - b.available_at || a.id - b.id);
        return { rowCount: due.length ? 1 : 0, rows: due.slice(0, 1).map((r) => ({ ...r })) };
      }
      if (q.startsWith("UPDATE billing_outbox SET status = 'processing'")) {
        const r = store.get(values[0]);
        r.status = 'processing'; r.attempts += 1; r.last_error = null;
        return { rowCount: 1, rows: [] };
      }
      if (q.startsWith('SELECT * FROM billing_outbox WHERE id = $1 FOR UPDATE')) {
        const r = store.get(values[0]);
        return { rowCount: r ? 1 : 0, rows: r ? [{ ...r }] : [] };
      }
      if (q.startsWith("UPDATE billing_outbox SET status = 'processed'")) {
        const r = store.get(values[0]);
        r.status = 'processed'; r.last_error = null; r.debt_recorded_cents = 0;
        return { rowCount: 1, rows: [] };
      }
      if (q.startsWith("UPDATE billing_outbox SET status = 'failed'")) {
        const r = store.get(values[0]);
        r.status = 'failed';
        r.last_error = values[1];
        if (q.includes("'infinity'::timestamptz")) {
          r.debt_recorded_cents = values[2];
          r.available_at = Infinity;
        } else {
          r.debt_recorded_cents = values[3];
          r.available_at = clock.now + values[2] * 1000;
        }
        return { rowCount: 1, rows: [] };
      }
      /* enrichAccessPayload: rowless unless a subscriptions row was supplied */
      if (q.startsWith('SELECT s.id')) {
        return subscriptionRow ? { rowCount: 1, rows: [{ ...subscriptionRow }] } : { rowCount: 0, rows: [] };
      }
      if (q.startsWith('UPDATE marketplace_sellers')) return { rowCount: 1, rows: [] };
      throw new Error('unexpected SQL in fake outbox: ' + q);
    },
    release() {}
  };
  return { pool: { connect: async () => client }, store, clock, sql };
}

/* Run the worker the way worker.js does, advancing time to each row's retry. */
async function drive(db, processOne, steps, { untilProcessed = false } = {}) {
  const outcomes = [];
  for (let i = 0; i < steps; i += 1) {
    const next = Math.min(...[...db.store.values()]
      .filter((r) => r.status === 'failed' || r.status === 'pending').map((r) => r.available_at));
    if (Number.isFinite(next)) db.clock.now = Math.max(db.clock.now, next);
    else db.clock.now += 365 * 24 * 3600 * 1000;
    const outcome = await processOne();
    outcomes.push(outcome);
    if (untilProcessed && outcome === 'processed') break;
  }
  return outcomes;
}

function withOutboxEnv(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'SML_BILLING_OUTBOX_MAX_ATTEMPTS');
  const prior = process.env.SML_BILLING_OUTBOX_MAX_ATTEMPTS;
  if (value == null) delete process.env.SML_BILLING_OUTBOX_MAX_ATTEMPTS;
  else process.env.SML_BILLING_OUTBOX_MAX_ATTEMPTS = value;
  try { return fn(); } finally {
    if (had) process.env.SML_BILLING_OUTBOX_MAX_ATTEMPTS = prior;
    else delete process.env.SML_BILLING_OUTBOX_MAX_ATTEMPTS;
  }
}

const rowlessAccessRow = (over) => ({
  id: 1, intent_type: 'subscription_access_reconcile', status: 'pending',
  payload: { stripe_subscription_id: 'sub_academy', reason: 'paid', type: 'sync_roles' }, ...over
});

test('dead-letter cap parsing: unset, zero or junk means no cap; values are clamped', () => {
  for (const off of [undefined, null, '', '   ', '0', '-3', 'abc', 'NaN', 0, -1, 0.5]) {
    assert.equal(W.parseMaxAttempts(off), 0, String(off));
  }
  assert.equal(W.parseMaxAttempts('20'), 20);
  assert.equal(W.parseMaxAttempts(' 20 '), 20);
  assert.equal(W.parseMaxAttempts(20.9), 20);
  assert.equal(W.parseMaxAttempts('999999'), 10000);
  assert.equal(W.RECOMMENDED_MAX_ATTEMPTS, 20);
  withOutboxEnv('7', () => assert.equal(W.resolveMaxAttempts({}), 7));
  withOutboxEnv('7', () => assert.equal(W.resolveMaxAttempts({ maxAttempts: 0 }), 0, 'an explicit option wins'));
  withOutboxEnv(null, () => assert.equal(W.resolveMaxAttempts(), 0));
});

test('legacy default (no cap): a failing row keeps retrying and never dies', async () => {
  const db = outboxDb([rowlessAccessRow()]);
  const logs = [];
  const processOne = withOutboxEnv(null, () => W.createOutboxWorker(db.pool, {
    subscription_access_reconcile: async () => { throw new Error('WordPress billing bridge returned 400'); }
  }, { logger: (...a) => logs.push(a) }));
  const outcomes = await drive(db, processOne, 30);
  assert.deepEqual([...new Set(outcomes)], ['failed'], 'merging with the flag unset must change nothing');
  const row = db.store.get(1);
  assert.equal(row.attempts, 30);
  assert.ok(Number.isFinite(row.available_at), 'still scheduled for another retry');
  assert.equal(row.available_at - db.clock.now, 3600 * 1000, 'hourly, as before');
  assert.doesNotMatch(row.last_error, /^dead_letter/);
  assert.equal(logs.length, 0, 'no cap line and no dead line when the cap is off');
});

test('cap 20: the 20th failed attempt dead-letters the row with a logged reason; it is never claimed again', async () => {
  const db = outboxDb([rowlessAccessRow()]);
  const logs = [];
  let calls = 0;
  const processOne = W.createOutboxWorker(db.pool, {
    subscription_access_reconcile: async () => { calls += 1; throw new Error('WordPress billing bridge returned 400'); }
  }, { maxAttempts: 20, logger: (...a) => logs.push(a) });

  const outcomes = await drive(db, processOne, 19);
  assert.deepEqual([...new Set(outcomes)], ['failed']);
  assert.equal(await drive(db, processOne, 1).then((o) => o[0]), 'dead');

  const row = db.store.get(1);
  assert.equal(row.status, 'failed', 'billing_outbox_status_check has no dead state; failed is reused');
  assert.equal(row.available_at, Infinity, 'parked at infinity');
  assert.equal(row.attempts, 20);
  assert.match(row.last_error, /^dead_letter \(no_subscription_row\): gave up after 20 attempts \(cap 20\); last error: WordPress billing bridge returned 400$/);
  const deadSql = db.sql.find((s) => s.q.includes("'infinity'::timestamptz"));
  assert.ok(deadSql, 'the dead-letter UPDATE parks the row');

  const dead = logs.filter((l) => l[1] === 'billing_outbox_dead');
  assert.equal(dead.length, 1);
  assert.equal(dead[0][0], 'warn');
  assert.deepEqual(dead[0][2], { outboxId: 1, sourceKey: 'k:1', intentType: 'subscription_access_reconcile',
    attempts: 20, maxAttempts: 20, unroutable: 'no_subscription_row', reason: 'WordPress billing bridge returned 400' });
  assert.equal(logs.filter((l) => l[1] === 'billing_outbox_dead_letter_cap').length, 1, 'the cap is announced once');

  /* A year later it is still not retried. */
  assert.deepEqual(await drive(db, processOne, 5), ['empty', 'empty', 'empty', 'empty', 'empty']);
  assert.equal(calls, 20, 'no handler call after the row died');
});

test('the cap can come from SML_BILLING_OUTBOX_MAX_ATTEMPTS, read once when the worker is built', async () => {
  const db = outboxDb([rowlessAccessRow()]);
  const processOne = withOutboxEnv('3', () => W.createOutboxWorker(db.pool, {
    subscription_access_reconcile: async () => { throw new Error('boom'); }
  }, { logger: () => {} }));
  assert.deepEqual(await drive(db, processOne, 4), ['failed', 'failed', 'dead', 'empty']);
});

test('a row with no handler counts toward the cap and dies', async () => {
  const db = outboxDb([{ id: 5, intent_type: 'mystery_intent', status: 'pending' }]);
  const processOne = W.createOutboxWorker(db.pool, {}, { maxAttempts: 2, logger: () => {} });
  assert.deepEqual(await drive(db, processOne, 3), ['failed', 'dead', 'empty']);
  assert.match(db.store.get(5).last_error, /^dead_letter \(no_handler_registered\): .*no handler for mystery_intent$/);
});

test('a legacy row already past the cap dies on its next failure; a success is still a success', async () => {
  const db = outboxDb([
    rowlessAccessRow({ id: 1, status: 'failed', attempts: 500 }),
    { id: 2, intent_type: 'subscription_notify', status: 'failed', attempts: 500 }
  ]);
  const seen = [];
  const processOne = W.createOutboxWorker(db.pool, {
    subscription_access_reconcile: async () => { seen.push(1); throw new Error('still bare'); },
    subscription_notify: async () => { seen.push(2); }
  }, { maxAttempts: 20, logger: () => {} });
  const outcomes = await drive(db, processOne, 3);
  assert.deepEqual(outcomes, ['dead', 'processed', 'empty']);
  assert.equal(db.store.get(1).available_at, Infinity);
  assert.equal(db.store.get(2).status, 'processed');
  assert.deepEqual(seen, [1, 2]);
});

test('money-moving intents are never dead-lettered, whatever the cap', async () => {
  for (const type of ['loop_bucks_credit', 'seller_recovery', 'seller_restore', 'cancel_external_subscription']) {
    assert.equal(W.DEAD_LETTER_EXEMPT.has(type), true, type);
    const db = outboxDb([{ id: 9, intent_type: type, status: 'pending',
      payload: { sellerId: 3, amountCents: 100, currency: 'usd' } }]);
    const logs = [];
    const processOne = W.createOutboxWorker(db.pool, {
      [type]: async () => { throw new Error('provider down'); }
    }, { maxAttempts: 2, logger: (...a) => logs.push(a) });
    const outcomes = await drive(db, processOne, 6);
    assert.deepEqual([...new Set(outcomes)], ['failed'], type);
    assert.ok(Number.isFinite(db.store.get(9).available_at), type + ' must stay scheduled');
    assert.equal(logs.some((l) => l[1] === 'billing_outbox_dead'), false, type);
  }
  assert.equal(W.isDeadLetter('subscription_access_reconcile', 20, 20), true);
  assert.equal(W.isDeadLetter('subscription_access_reconcile', 19, 20), false);
  assert.equal(W.isDeadLetter('subscription_access_reconcile', 999, 0), false, 'cap 0 means never');
});

test('finish() called directly keeps its legacy contract and reports the outcome', async () => {
  const db = outboxDb([rowlessAccessRow({ attempts: 1, status: 'processing' })]);
  const row = { ...db.store.get(1) };
  assert.equal(await withOutboxEnv(null, () => W.finish(db.pool, row, new Error('x'))), 'failed');
  assert.equal(await W.finish(db.pool, row, null), 'processed');
  /* An access row enrichAccessPayload looked up and did not find. */
  const other = outboxDb([rowlessAccessRow({ attempts: 20, status: 'processing' })]);
  const logs = [];
  assert.equal(await W.finish(other.pool, { ...other.store.get(1), subscriptionRowFound: false }, new Error('y'),
    { maxAttempts: 20, logger: (...a) => logs.push(a) }), 'dead');
  assert.equal(logs[0][1], 'billing_outbox_dead');
  assert.equal(logs[0][2].unroutable, 'no_subscription_row');
  /* A row nobody enriched is treated as real work: never dead-lettered. */
  const unknown = outboxDb([rowlessAccessRow({ attempts: 20, status: 'processing' })]);
  assert.equal(await W.finish(unknown.pool, { ...unknown.store.get(1) }, new Error('z'),
    { maxAttempts: 20, logger: () => {} }), 'failed');
  assert.ok(Number.isFinite(unknown.store.get(1).available_at));
  /* An explicit classification from the worker wins. */
  const forced = outboxDb([{ id: 3, intent_type: 'dispute_alert', status: 'processing', attempts: 20 }]);
  assert.equal(await W.finish(forced.pool, { ...forced.store.get(3) }, new Error('w'),
    { maxAttempts: 20, unroutable: null, logger: () => {} }), 'failed');
  assert.equal(await W.finish(forced.pool, { ...forced.store.get(3) }, new Error('w'),
    { maxAttempts: 20, unroutable: 'no_handler_registered', logger: () => {} }), 'dead');
});

test('a throwing logger cannot change the dead-letter outcome', async () => {
  const db = outboxDb([rowlessAccessRow({ attempts: 0 })]);
  const processOne = W.createOutboxWorker(db.pool, {
    subscription_access_reconcile: async () => { throw new Error('boom'); }
  }, { maxAttempts: 1, logger: () => { throw new Error('log sink down'); } });
  assert.deepEqual(await drive(db, processOne, 2), ['dead', 'empty']);
});

/* ---------- PR-D review: the cap only ever applies to unroutable rows ---------- */

/* A real platform subscription, as enrichAccessPayload's SELECT returns it. */
const platformSubscription = (over) => ({
  id: 7, user_id: 101, group_id: 11, status: 'active', access_until: null, connected_account_id: null,
  discord_user_id: '1051212765475377172', guild_id: '938894329076940820',
  grants: [{ target: 'discord_guild_role', roleRef: '939031140679970867' }], ...over
});

/* A transient outage: the WordPress bridge (called first by membershipAccess
   in worker.js) returns 503 for `failures` attempts, then recovers. */
function outageThenRecover(failures, applied) {
  let calls = 0;
  return async (payload) => {
    calls += 1;
    if (calls <= failures) throw new Error('WordPress billing bridge returned 503');
    applied.push({ active: payload.active, subscriptionId: payload.subscriptionId });
  };
}

test('unroutableReason: only rows that can never succeed are classified', () => {
  const handlers = { subscription_access_reconcile: () => {}, subscription_notify: null, dispute_deadline: () => {} };
  const access = (over) => ({ intent_type: 'subscription_access_reconcile', payload: {}, ...over });
  assert.equal(W.unroutableReason(access({ subscriptionRowFound: false }), handlers), 'no_subscription_row');
  assert.equal(W.unroutableReason(access({ subscriptionRowFound: true }), handlers), null);
  assert.equal(W.unroutableReason(access(), handlers), null, 'never enriched means real work');
  assert.equal(W.unroutableReason(access({ payload: { subscriptionId: 7 } }), handlers), null);
  const notify = (payload) => ({ intent_type: 'subscription_notify', payload });
  assert.equal(W.unroutableReason(notify({ template: 'payment_failed', user_id: null }), handlers), 'no_recipient');
  assert.equal(W.unroutableReason(notify({ template: 'payment_failed' }), handlers), 'no_recipient');
  assert.equal(W.unroutableReason(notify({ user_id: '  ' }), handlers), 'no_recipient');
  assert.equal(W.unroutableReason(notify({ user_id: 100 }), handlers), null);
  assert.equal(W.unroutableReason(notify({ userId: '100' }), handlers), null);
  assert.equal(W.unroutableReason(notify({ user_id: 100 }), handlers), null,
    'a handler key that is present but unconfigured (null) is a transient gap, not unroutable');
  assert.equal(W.unroutableReason({ intent_type: 'mystery_intent' }, handlers), 'no_handler_registered');
  assert.equal(W.unroutableReason({ intent_type: 'mystery_intent' }), null, 'no handler map, no no-handler rule');
  assert.equal(W.unroutableReason({ intent_type: 'dispute_deadline', payload: {} }, handlers), null);
  for (const type of W.DEAD_LETTER_EXEMPT) {
    assert.equal(W.unroutableReason({ intent_type: type }, {}), null, type + ' is exempt even with no handler');
  }
  assert.equal(W.unroutableReason(null, handlers), null);
  assert.deepEqual([...W.UNROUTABLE_REASONS], ['no_handler_registered', 'no_subscription_row', 'no_recipient']);
});

test('enrichAccessPayload marks whether it found the subscriptions row', async () => {
  const found = await W.enrichAccessPayload({ query: async () => ({ rows: [platformSubscription()] }) },
    { intent_type: 'subscription_access_reconcile', payload: { stripe_subscription_id: 'sub_1' } });
  assert.equal(found.subscriptionRowFound, true);
  assert.equal(found.payload.subscriptionId, 7);
  const input = { intent_type: 'subscription_access_reconcile', payload: { stripe_subscription_id: 'sub_academy' } };
  const missing = await W.enrichAccessPayload({ query: async () => ({ rows: [] }) }, input);
  assert.equal(missing.subscriptionRowFound, false);
  assert.deepEqual(missing.payload, input.payload, 'the bare payload is passed through unchanged');
  assert.equal(input.subscriptionRowFound, undefined, 'the claimed row object is not mutated');
  const other = { intent_type: 'subscription_notify', payload: {} };
  assert.equal(await W.enrichAccessPayload({ query: async () => { throw new Error('not called'); } }, other), other);
});

test('HIGH (review): a paying member\'s grant survives a >14h bridge outage with the cap on', async () => {
  const db = outboxDb([{
    id: 1, source_key: 'subscription-intent:41', intent_type: 'subscription_access_reconcile', status: 'pending',
    payload: { type: 'sync_roles', reason: 'paid', stripe_subscription_id: 'sub_paying' }
  }], platformSubscription());
  const applied = [];
  const logs = [];
  const processOne = W.createOutboxWorker(db.pool, {
    subscription_access_reconcile: outageThenRecover(20, applied)
  }, { maxAttempts: W.RECOMMENDED_MAX_ATTEMPTS, logger: (...a) => logs.push(a) });

  const outcomes = await drive(db, processOne, 40, { untilProcessed: true });
  assert.ok(!outcomes.includes('dead'), 'a rowful access row must not be dead-lettered: ' + outcomes.join(','));
  assert.equal(outcomes.at(-1), 'processed');
  assert.equal(outcomes.length, 21, 'retried past the cap and applied once the bridge recovered');
  assert.deepEqual(applied, [{ active: true, subscriptionId: 7 }]);
  assert.equal(db.store.get(1).status, 'processed');
  assert.equal(logs.some((l) => l[1] === 'billing_outbox_dead'), false);
});

test('HIGH (review): a canceled member\'s revoke survives a >14h bridge outage with the cap on', async () => {
  const db = outboxDb([{
    id: 2, source_key: 'subscription-intent:42', intent_type: 'subscription_access_reconcile', status: 'pending',
    payload: { type: 'sync_roles', reason: 'canceled', stripe_subscription_id: 'sub_canceled' }
  }], platformSubscription({ id: 8, user_id: 102, status: 'canceled', access_until: '2026-09-20T00:00:00.000Z',
    discord_user_id: '1051212765475377173' }));
  const applied = [];
  const processOne = W.createOutboxWorker(db.pool, {
    subscription_access_reconcile: outageThenRecover(25, applied)
  }, { maxAttempts: W.RECOMMENDED_MAX_ATTEMPTS, logger: () => {} });

  /* customer.subscription.deleted is the last event Stripe sends for this
     subscription, so a dead revoke row would never be re-driven. */
  const outcomes = await drive(db, processOne, 40, { untilProcessed: true });
  assert.ok(!outcomes.includes('dead'), 'a rowful revoke must not be dead-lettered: ' + outcomes.join(','));
  assert.equal(outcomes.at(-1), 'processed');
  assert.deepEqual(applied, [{ active: false, subscriptionId: 8 }]);
});

test('an expireGrace revoke for a real subscription keeps its hourly retry past the cap', async () => {
  const db = outboxDb([{
    id: 4, source_key: 'subscription-expired:8:2026-09-20T00:00:00.000Z', intent_type: 'subscription_access_reconcile',
    status: 'failed', attempts: 500,
    payload: { subscriptionId: 8, stripeSubscriptionId: 'sub_lapsed', reason: 'three_failed_attempts_and_72_hour_grace_expired' }
  }], platformSubscription({ id: 8, status: 'unpaid', access_until: '2026-09-20T00:00:00.000Z' }));
  const processOne = W.createOutboxWorker(db.pool, {
    subscription_access_reconcile: async () => { throw new Error('Discord membership sync incomplete: 1 retryable'); }
  }, { maxAttempts: 20, logger: () => {} });
  assert.deepEqual(await drive(db, processOne, 3), ['failed', 'failed', 'failed']);
  const row = db.store.get(4);
  assert.ok(Number.isFinite(row.available_at));
  assert.equal(row.available_at - db.clock.now, 3600 * 1000, 'hourly, as before PR-D');
  assert.doesNotMatch(row.last_error, /^dead_letter/);
});

test('notify: the null-user payment_failed notice dies at the cap; a real member\'s notice never does', async () => {
  const db = outboxDb([
    { id: 1, intent_type: 'subscription_notify', status: 'pending',
      payload: { type: 'notify', template: 'payment_failed', user_id: null, access_until: 1 } },
    { id: 2, intent_type: 'subscription_notify', status: 'pending',
      payload: { type: 'notify', template: 'payment_failed', user_id: 100, access_until: 1 } }
  ]);
  const processOne = W.createOutboxWorker(db.pool, {
    subscription_notify: async () => { throw new Error('WordPress billing bridge returned 503'); }
  }, { maxAttempts: 3, logger: () => {} });
  const outcomes = await drive(db, processOne, 12);
  assert.equal(outcomes.filter((o) => o === 'dead').length, 1);
  assert.equal(db.store.get(1).available_at, Infinity);
  assert.match(db.store.get(1).last_error, /^dead_letter \(no_recipient\): gave up after 3 attempts/);
  assert.ok(Number.isFinite(db.store.get(2).available_at), 'a notice to a real member keeps retrying');
  assert.ok(db.store.get(2).attempts > 3);
});

test('real work with a registered handler (dispute deadline) never dies, and an unconfigured handler key keeps retrying', async () => {
  const db = outboxDb([
    { id: 1, intent_type: 'dispute_deadline', status: 'pending', payload: { caseId: 5 } },
    { id: 2, intent_type: 'subscription_notify', status: 'pending', payload: { template: 'renewal', user_id: 100 } }
  ]);
  const processOne = W.createOutboxWorker(db.pool, {
    dispute_deadline: async () => { throw new Error('Discord 503'); },
    subscription_notify: null /* the WordPress bridge is not configured on this worker */
  }, { maxAttempts: 2, logger: () => {} });
  const outcomes = await drive(db, processOne, 10);
  assert.deepEqual([...new Set(outcomes)], ['failed']);
  for (const id of [1, 2]) assert.ok(Number.isFinite(db.store.get(id).available_at), 'row ' + id + ' stays scheduled');
  assert.match(db.store.get(2).last_error, /^no handler for subscription_notify$/);
});
