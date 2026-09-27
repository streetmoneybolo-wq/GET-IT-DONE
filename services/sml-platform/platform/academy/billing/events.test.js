'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const { createEvents } = require('./events');
const k = require('./testkit');

const { USER, USER2, T0 } = k;
const CUS = 'cus_bound1';
let seq = 0;

function event(type, object, extra = {}) {
  seq += 1;
  return { id: `evt_test${seq}`, type, created: Math.floor(T0 / 1000), livemode: false, account: null, apiVersion: '2022-11-15',
    data: { object }, payloadHash: crypto.createHash('sha256').update(`${type}${seq}`).digest('hex'), ...extra };
}

function setup({ enabled = true, resync = null } = {}) {
  const now = k.clock();
  const config = k.config();
  const store = k.createFakeStore({ now });
  const stripe = k.createFakeStripe({ customers: { [CUS]: k.academyCustomer(CUS, USER) } });
  const calls = [];
  const logs = [];
  const resyncFn = resync || (async (id, opts) => { calls.push([id, opts]); return { roles: ['academy'], deferredRevokes: 0 }; });
  const events = createEvents({ config, store, stripeApi: stripe, resync: resyncFn, now, isEnabled: () => enabled,
    logger: (level, name, fields) => logs.push({ level, name, fields }) });
  k.bindMember(store, USER, CUS);
  return { now, config, store, stripe, events, calls, logs };
}

test('an Upgrade.Chat-like subscription update (unbound, no metadata) is ignored with zero Stripe calls', async () => {
  const t = setup();
  const result = await t.events.record(event('customer.subscription.updated', { id: 'sub_uc', object: 'subscription', customer: 'cus_upgradechat', metadata: {} }));
  assert.deepEqual(result, { status: 'ignored', reason: 'not_academy' });
  assert.equal(t.stripe.calls.length, 0);
  await t.events.processDue();
  assert.equal(t.calls.length, 0);
});

test('store, platform-membership, Loop Bucks, Connect and wrong-livemode events are ignored', async () => {
  const t = setup();
  const cases = [
    [event('checkout.session.completed', { id: 'cs_test_store', customer: 'cus_s', metadata: { sml_site: 'stockmarketloop', order_key: 'x' } }), 'foreign_metadata'],
    [event('customer.subscription.created', { id: 'sub_p', customer: 'cus_p', metadata: { subscription_key: 'abc', sml_uid: '5' } }), 'foreign_metadata'],
    [event('checkout.session.completed', { id: 'cs_test_lb', customer: 'cus_l', metadata: { sml_kind: 'loop_bucks', sml_lb_amount: '5' } }), 'foreign_metadata'],
    [event('checkout.session.completed', { id: 'cs_test_lb2', customer: 'cus_l', metadata: { sml_kind: 'loop_bucks' } }), 'foreign_kind'],
    [event('customer.subscription.updated', { id: 'sub_c', customer: CUS, metadata: { sml_kind: 'mem_academy' } }, { account: 'acct_x' }), 'connect_account'],
    [event('customer.subscription.updated', { id: 'sub_l', customer: CUS, metadata: { sml_kind: 'mem_academy' } }, { livemode: true }), 'livemode_mismatch']
  ];
  for (const [evt, reason] of cases) assert.deepEqual(await t.events.record(evt), { status: 'ignored', reason });
  assert.equal(t.stripe.calls.length, 0);
});

test('a bound customer is ours; a burst is coalesced into ONE resync', async () => {
  const t = setup();
  const burst = [
    event('invoice.paid', { id: 'in_1', customer: CUS, subscription: 'sub_1', charge: 'ch_1' }),
    event('customer.subscription.updated', { id: 'sub_1', customer: CUS, metadata: {} }),
    event('charge.refunded', { id: 'ch_1', object: 'charge', customer: CUS, payment_intent: 'pi_1' })
  ];
  for (const evt of burst) assert.equal((await t.events.record(evt)).status, 'pending');
  const outcome = await t.events.processDue();
  assert.equal(outcome.processed, 3);
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0][0], USER);
  assert.equal(t.calls[0][1].actor, 'webhook');
  assert.ok([...t.store.db.events.values()].every((e) => e.status === 'processed'));
});

test('only ids are stored, never the payload', async () => {
  const t = setup();
  await t.events.record(event('checkout.session.completed', { id: 'cs_test_abc', customer: CUS, payment_intent: 'pi_9', customer_details: { email: 'x@y.z', name: 'Bob' },
    metadata: { sml_kind: 'mem_academy', mem_academy_discord_user: USER, mem_academy_intent: '0b9f1f64-6a3c-4d7b-9a44-1f0a2b3c4d5e' } }));
  const stored = [...t.store.db.events.values()][0];
  assert.equal(stored.checkout_session_id, 'cs_test_abc');
  assert.equal(stored.meta_discord_user, USER);
  assert.equal(stored.meta_intent, '0b9f1f64-6a3c-4d7b-9a44-1f0a2b3c4d5e');
  assert.equal(JSON.stringify(stored).includes('x@y.z'), false);
  assert.equal(JSON.stringify(stored).includes('Bob'), false);
});

test('a duplicate evt is reported as duplicate', async () => {
  const t = setup();
  const evt = event('invoice.paid', { id: 'in_1', customer: CUS });
  assert.equal((await t.events.record(evt)).status, 'pending');
  assert.deepEqual(await t.events.record(evt), { status: 'duplicate' });
});

test('with the engine disabled our events are stored as deferred', async () => {
  const t = setup({ enabled: false });
  assert.equal((await t.events.record(event('invoice.paid', { id: 'in_1', customer: CUS }))).status, 'deferred');
  assert.equal((await t.events.record(event('invoice.paid', { id: 'in_2', customer: 'cus_other' }))).status, 'ignored');
  assert.deepEqual(await t.events.processDue(), { claimed: 0 });
  assert.equal(await t.store.replayDeferred(), 1);
});

test('metadata that names a different Discord id: binding_conflict, and only the bound id is resynced', async () => {
  const t = setup();
  await t.events.record(event('customer.subscription.updated', { id: 'sub_1', customer: CUS, metadata: { sml_kind: 'mem_academy', mem_academy_discord_user: USER2 } }));
  await t.events.processDue();
  assert.deepEqual(t.calls.map((c) => c[0]), [USER]);
  const conflict = t.store.db.audit.find((r) => r.action === 'binding_conflict');
  assert.equal(conflict.discord_user_id, USER);
  assert.equal(conflict.details.metadataDiscordUser, USER2);
});

test('a dispute event is classified from its stored ids after a restart', async () => {
  const t = setup();
  t.stripe.data.charges.push(k.charge({ id: 'ch_disputed', customer: CUS }));
  assert.equal((await t.events.record(event('charge.dispute.created', { id: 'du_1', object: 'dispute', charge: 'ch_disputed', payment_intent: 'pi_x' }))).status, 'pending');
  assert.equal(t.stripe.calls.length, 0);
  /* a fresh process: nothing in memory but the stored row */
  const restarted = createEvents({ config: t.config, store: t.store, stripeApi: t.stripe, resync: async (id) => { t.calls.push([id]); return { deferredRevokes: 0 }; }, now: t.now });
  await restarted.processDue();
  assert.deepEqual(t.stripe.calls.map((c) => c.name), ['retrieveCharge']);
  assert.deepEqual(t.calls.map((c) => c[0]), [USER]);
});

test('a dispute on a foreign charge is ignored after one lookup', async () => {
  const t = setup();
  t.stripe.data.charges.push(k.charge({ id: 'ch_store', customer: 'cus_store' }));
  await t.events.record(event('charge.dispute.created', { id: 'du_2', charge: 'ch_store' }));
  await t.events.processDue();
  assert.equal(t.calls.length, 0);
  assert.equal([...t.store.db.events.values()][0].ignore_reason, 'charge_not_academy');
});

test('a lifetime dispute is resolved through the lifetime cache without a Stripe call', async () => {
  const t = setup();
  t.store.db.lifetime.set('pi_life', { payment_intent_id: 'pi_life', livemode: false, discord_user_id: USER, stripe_customer_id: CUS, stripe_state: 'paid' });
  await t.events.record(event('charge.dispute.closed', { id: 'du_3', charge: 'ch_l', payment_intent: 'pi_life' }));
  await t.events.processDue();
  assert.deepEqual(t.calls.map((c) => c[0]), [USER]);
  assert.equal(t.stripe.calls.length, 0);
});

test('our metadata on an unbound customer rebuilds the binding from the Customer itself', async () => {
  const t = setup();
  t.stripe.data.customers.cus_lost = k.academyCustomer('cus_lost', USER2);
  await t.events.record(event('customer.subscription.created', { id: 'sub_9', customer: 'cus_lost', metadata: { sml_kind: 'mem_academy', mem_academy_discord_user: USER2 } }));
  await t.events.processDue();
  assert.equal(t.store.db.members.get(`${USER2}|false`).stripe_customer_id, 'cus_lost');
  assert.ok(k.actions(t.store).includes('binding_rebuilt'));
  assert.deepEqual(t.calls.map((c) => c[0]), [USER2]);
});

test('a tombstoned (rebound) id is never rebuilt', async () => {
  const t = setup();
  t.stripe.data.customers.cus_lost = k.academyCustomer('cus_lost', USER2);
  t.store.db.members.set(`${USER2}|false`, { discord_user_id: USER2, livemode: false, stripe_customer_id: null, rebound_to: k.USER3, last_access: {} });
  await t.events.record(event('customer.subscription.created', { id: 'sub_9', customer: 'cus_lost', metadata: { sml_kind: 'mem_academy' } }));
  await t.events.processDue();
  assert.equal(t.calls.length, 0);
  assert.equal([...t.store.db.events.values()][0].ignore_reason, 'binding_not_rebuildable');
});

test('checkout.session.expired and async_payment_failed update the intent', async () => {
  const t = setup();
  const id = '0b9f1f64-6a3c-4d7b-9a44-1f0a2b3c4d5e';
  await t.store.insertIntent(null, { id, discordId: USER, package: 'monthly', priceId: 'price_monthly1', customerId: CUS, bindSource: 'web_oauth',
    consentKind: 'auto_renewal', consentVersion: 'v', consentSha256: 'a'.repeat(64), consentedAt: T0, expiresAt: T0 + 1 });
  await t.store.markIntentOpen(null, { id, sessionId: 'cs_test_x1' });
  await t.events.record(event('checkout.session.expired', { id: 'cs_test_x1', customer: CUS, metadata: { sml_kind: 'mem_academy', mem_academy_intent: id } }));
  await t.events.processDue();
  assert.equal(t.store.db.intents.get(id).status, 'expired');
});

test('a Stripe 500 fails the event with backoff; after 20 attempts it is dead', async () => {
  const t = setup({ resync: async () => { throw Object.assign(new Error('stripe 500'), { type: 'StripeAPIError' }); } });
  await t.events.record(event('invoice.paid', { id: 'in_1', customer: CUS }));
  await t.events.processDue();
  const row = () => [...t.store.db.events.values()][0];
  assert.equal(row().status, 'failed');
  assert.equal(row().next_attempt_at.getTime(), T0 + 60_000);
  for (let i = 0; i < 25 && row().status === 'failed'; i += 1) {
    t.now.set(row().next_attempt_at.getTime());
    await t.events.processDue();
  }
  assert.equal(row().status, 'dead');
  assert.equal(row().attempts, 20);
  assert.ok(t.logs.some((l) => l.name === 'academy_billing_event_dead'));
});

test('revokes deferred by an incomplete snapshot are retried in five minutes', async () => {
  const t = setup({ resync: async () => ({ roles: [], deferredRevokes: 1 }) });
  await t.events.record(event('customer.subscription.deleted', { id: 'sub_1', customer: CUS }));
  await t.events.processDue();
  const row = [...t.store.db.events.values()][0];
  assert.equal(row.status, 'failed');
  assert.equal(row.next_attempt_at.getTime(), T0 + 300_000);
});

/* ---------------------------------------------------------------------------
 * Lifetime by bank debit (ACH): delayed Checkout events, failures, returns.
 * ------------------------------------------------------------------------ */

const ACH_INTENT = '0b9f1f64-6a3c-4d7b-9a44-00000000ac02';
const ACH_SESSION = 'cs_test_achsession002';
const sessionObject = (extra = {}) => ({ id: ACH_SESSION, object: 'checkout.session', customer: CUS, mode: 'payment', status: 'complete', payment_status: 'unpaid',
  payment_intent: 'pi_ach', client_reference_id: ACH_INTENT,
  metadata: { sml_kind: 'mem_academy', mem_academy_discord_user: USER, mem_academy_intent: ACH_INTENT, mem_academy_package: 'lifetime' }, ...extra });

async function openAchIntent(store) {
  await store.insertIntent(null, { id: ACH_INTENT, discordId: USER, package: 'lifetime', priceId: 'price_life1', customerId: CUS, bindSource: 'web_oauth',
    consentKind: 'final_sale', consentVersion: 'v', consentSha256: 'a'.repeat(64), consentedAt: T0, expiresAt: T0 + 1 });
  await store.markIntentOpen(null, { id: ACH_INTENT, sessionId: ACH_SESSION });
}

/** The real engine (config, catalog, resync) behind the event processor. */
function achEngine({ members = { [USER]: [] }, piStatus = 'processing', chargeStatus = 'pending' } = {}) {
  const { createResync } = require('./resync');
  const { createCatalog } = require('./catalog');
  const now = k.clock();
  const config = k.config(k.BANK_LIFETIME_ENV);
  const store = k.createFakeStore({ now });
  const stripe = k.createFakeStripe({
    customers: { [CUS]: k.academyCustomer(CUS, USER) },
    paymentIntents: [k.lifetimePi({ id: 'pi_ach', customer: CUS, status: piStatus, latestCharge: 'ch_ach', amount: 1000000 })],
    charges: [k.charge({ id: 'ch_ach', customer: CUS, amount: 1000000, paymentIntent: 'pi_ach', status: chargeStatus })]
  });
  const bot = k.createFakeBot({ members });
  const catalog = createCatalog({ config, stripeApi: stripe, now });
  const core = createResync({ config, store, stripeApi: stripe, catalog, bot, now, stripeWritesAllowed: () => true });
  const events = createEvents({ config, store, stripeApi: stripe, resync: core.resync, now, isEnabled: () => true });
  k.bindMember(store, USER, CUS);
  const roleRows = () => [...store.db.roles.values()].map((r) => [r.role_key, r.desired, r.state]).sort();
  return { now, config, store, stripe, bot, events, roleRows };
}

test('async_payment_succeeded completes the intent and async_payment_failed fails it, each audited with the event id', async () => {
  const t = setup();
  await openAchIntent(t.store);
  await t.events.record(event('checkout.session.async_payment_failed', sessionObject(), { id: 'evt_achfail1' }));
  await t.events.processDue();
  assert.equal(t.store.db.intents.get(ACH_INTENT).status, 'failed');
  const failedRow = t.store.db.audit.find((r) => r.action === 'intent_failed');
  assert.deepEqual([failedRow.actor, failedRow.outcome, failedRow.event_id, failedRow.discord_user_id, failedRow.reason],
    ['webhook', 'applied', 'evt_achfail1', USER, 'checkout.session.async_payment_failed']);
  assert.deepEqual(failedRow.stripe_refs, [ACH_SESSION]);
  assert.equal(failedRow.details.intent, ACH_INTENT);
  /* a replay moves nothing and audits nothing more */
  await t.store.replayEvent(null, 'evt_achfail1');
  await t.events.processDue();
  assert.equal(t.store.db.audit.filter((r) => r.action === 'intent_failed').length, 1);

  const ok = setup();
  await openAchIntent(ok.store);
  await ok.events.record(event('checkout.session.async_payment_succeeded', sessionObject({ payment_status: 'paid' })));
  await ok.events.processDue();
  assert.equal(ok.store.db.intents.get(ACH_INTENT).status, 'completed');
  assert.ok(k.actions(ok.store).includes('intent_completed'));
  assert.deepEqual(ok.calls.map((c) => c[0]), [USER]);
});

test('charge.failed and payment_intent.payment_failed of an Academy customer trigger a resync; a foreign one costs no Stripe call', async () => {
  const t = setup();
  assert.equal((await t.events.record(event('charge.failed', { id: 'ch_ach', object: 'charge', customer: CUS, payment_intent: 'pi_ach', status: 'failed' }))).status, 'pending');
  assert.equal((await t.events.record(event('payment_intent.payment_failed', { id: 'pi_ach', object: 'payment_intent', customer: 'cus_unbound',
    metadata: { sml_kind: 'mem_academy', mem_academy_package: 'lifetime', mem_academy_discord_user: USER } }))).status, 'pending');
  assert.deepEqual(await t.events.record(event('charge.failed', { id: 'ch_store', object: 'charge', customer: 'cus_store', metadata: {} })), { status: 'ignored', reason: 'not_academy' });
  assert.deepEqual(await t.events.record(event('payment_intent.payment_failed', { id: 'pi_uc', object: 'payment_intent', customer: 'cus_uc', metadata: { order_key: 'wc_1' } })),
    { status: 'ignored', reason: 'foreign_metadata' });
  assert.equal(t.stripe.calls.length, 0);
  const stored = [...t.store.db.events.values()].find((e) => e.type === 'charge.failed' && e.status === 'pending');
  assert.deepEqual([stored.charge_id, stored.payment_intent_id, stored.customer_id], ['ch_ach', 'pi_ach', CUS]);
});

test('ACH lifetime end to end: completed unpaid -> no role; the debit fails -> still no role, intent failed and audited', async () => {
  const t = achEngine();
  await openAchIntent(t.store);
  await t.events.record(event('checkout.session.completed', sessionObject()));
  await t.events.processDue();
  assert.deepEqual(t.roleRows(), [], 'Checkout completed with payment_status unpaid: nothing is granted');
  assert.equal(t.store.db.intents.get(ACH_INTENT).status, 'open');
  assert.equal(t.store.db.members.get(`${USER}|false`).last_access.lifetimePending, true);

  /* the bank debit fails before clearing */
  t.stripe.data.paymentIntents[0].status = 'requires_payment_method';
  t.stripe.data.charges[0].status = 'failed';
  t.now.advance(60_000);
  await t.events.record(event('charge.failed', { id: 'ch_ach', object: 'charge', customer: CUS, payment_intent: 'pi_ach', status: 'failed' }));
  await t.events.record(event('payment_intent.payment_failed', { id: 'pi_ach', object: 'payment_intent', customer: CUS, metadata: sessionObject().metadata }));
  await t.events.record(event('checkout.session.async_payment_failed', sessionObject()));
  const outcome = await t.events.processDue();
  assert.equal(outcome.processed, 3);
  assert.deepEqual(t.roleRows(), []);
  assert.equal(t.store.db.intents.get(ACH_INTENT).status, 'failed');
  assert.ok(k.actions(t.store).includes('intent_failed'));
  assert.equal(t.store.db.lifetime.size, 0);
  assert.equal(t.store.db.members.get(`${USER}|false`).last_access.lifetimePending, false);
});

test('ACH lifetime end to end: the debit clears -> both roles; the bank then returns it -> both roles removed', async () => {
  const t = achEngine();
  await openAchIntent(t.store);
  await t.events.record(event('checkout.session.completed', sessionObject()));
  await t.events.processDue();
  assert.deepEqual(t.roleRows(), []);

  t.stripe.data.paymentIntents[0].status = 'succeeded';
  t.stripe.data.charges[0].status = 'succeeded';
  t.now.advance(60_000);
  await t.events.record(event('checkout.session.async_payment_succeeded', sessionObject({ payment_status: 'paid' })));
  await t.events.processDue();
  assert.deepEqual(t.roleRows(), [['academy', true, 'pending'], ['mem_lifetime', true, 'pending']]);
  assert.equal(t.store.db.intents.get(ACH_INTENT).status, 'completed');

  /* the applier delivered both roles */
  t.bot.state.members[USER] = [k.ACADEMY_ROLE, k.LIFETIME_ROLE];
  for (const row of t.store.db.roles.values()) row.state = 'synced';

  /* days later the bank returns the debit; Stripe reports it as a dispute */
  t.stripe.data.charges[0].disputed = true;
  t.stripe.data.disputes.push({ id: 'du_ach', object: 'dispute', charge: 'ch_ach', payment_intent: 'pi_ach', status: 'lost', reason: 'insufficient_funds' });
  t.now.advance(3 * 86400_000);
  await t.events.record(event('charge.dispute.closed', { id: 'du_ach', object: 'dispute', charge: 'ch_ach', payment_intent: 'pi_ach', status: 'lost' }));
  await t.events.processDue();
  assert.deepEqual(t.roleRows(), [['academy', false, 'pending'], ['mem_lifetime', false, 'pending']]);
  assert.equal(t.store.db.lifetime.get('pi_ach').stripe_state, 'dispute_lost');
});

test('ACH lifetime end to end: a charge.failed after access was granted removes it through the same resync', async () => {
  const t = achEngine({ members: { [USER]: [k.ACADEMY_ROLE, k.LIFETIME_ROLE] }, piStatus: 'succeeded', chargeStatus: 'succeeded' });
  await t.events.record(event('checkout.session.async_payment_succeeded', sessionObject({ payment_status: 'paid' })));
  await t.events.processDue();
  assert.deepEqual(t.roleRows(), [['academy', true, 'synced'], ['mem_lifetime', true, 'synced']]);
  t.stripe.data.charges[0].status = 'failed';
  t.now.advance(60_000);
  await t.events.record(event('charge.failed', { id: 'ch_ach', object: 'charge', customer: CUS, payment_intent: 'pi_ach', status: 'failed' }));
  await t.events.processDue();
  assert.deepEqual(t.roleRows(), [['academy', false, 'pending'], ['mem_lifetime', false, 'pending']]);
  const change = t.store.db.audit.filter((r) => r.action === 'role_desired_changed').map((r) => [r.role_key, r.reason]);
  assert.deepEqual(change, [['academy', 'lifetime_payment_failed'], ['mem_lifetime', 'lifetime_payment_failed']]);
});
