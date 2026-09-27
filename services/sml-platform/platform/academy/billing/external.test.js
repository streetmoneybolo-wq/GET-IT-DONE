'use strict';

/* The Upgrade.Chat check behind every EXTERNAL-role revoke (external.js).
   Only a clear "no active UC membership" may lead to a revoke; everything
   else keeps the role. */

const assert = require('node:assert/strict');
const test = require('node:test');
const { createUcChecker, orderGrants, revocableGrant, ucRecheckDue, ucAnswerStale, ucKeptRecheckable, UC_RECHECK_MS, UC_KEPT_RECHECK_MS,
  UC_ANSWER_TTL_MS, UC_RENEWAL_GRACE_MS, UC_CHECK_DEADLINE_MS, STAFF_KEEP_REASON } = require('./external');
const { createUpgradeChatClient } = require('../../upgrade-chat');
const k = require('./testkit');

const { USER, MONARCH, PREMIUM, ELITE, T0, UC_MONARCH_MONTHLY, UC_MONARCH_LIFETIME, UC_PREMIUM_MONTHLY } = k;

function checker({ uc = true, client = k.createFakeUc(), now = () => T0 } = {}) {
  const config = k.config(k.ownerEnv({ uc }));
  const logs = [];
  return { config, client, logs, check: createUcChecker({ config, client: uc ? client : null, now, logger: (level, event, fields) => logs.push({ level, event, fields }) }) };
}

const order = (extra = {}) => ({
  uuid: 'order-1', is_subscription: true, purchased_at: '2026-09-20T12:00:00Z', deleted: null,
  order_items: [{ interval: 'month', interval_count: 1, product: { uuid: UC_MONARCH_MONTHLY } }], ...extra
});

test('not configured: every answer is inconclusive, never a revoke', async () => {
  const t = checker({ uc: false });
  assert.equal(t.check.configured, false);
  assert.deepEqual(await t.check.check(USER, MONARCH), { result: 'inconclusive', reason: 'uc_not_configured' });
  /* credentials but no client wired: still inconclusive */
  const noClient = createUcChecker({ config: k.config(k.ownerEnv()), client: null });
  assert.equal((await noClient.check(USER, MONARCH)).result, 'inconclusive');
});

test('a role missing from UC_ROLE_PRODUCTS_JSON is inconclusive; a role mapped to [] is a clear none', async () => {
  const t = checker();
  const config = k.config({ ...k.ownerEnv(), SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON: JSON.stringify({ [PREMIUM]: [UC_PREMIUM_MONTHLY] }) });
  const unmapped = createUcChecker({ config, client: k.createFakeUc() });
  assert.deepEqual(await unmapped.check(USER, MONARCH), { result: 'inconclusive', reason: 'uc_role_unmapped' });
  assert.deepEqual(await t.check.check(USER, ELITE), { result: 'none', reason: 'uc_no_product_grants_role' });
  assert.deepEqual(t.client.calls, [], 'no Upgrade.Chat call for a role no UC product grants');
});

test('an active Upgrade.Chat subscription (findMembership) keeps the role', async () => {
  const client = k.createFakeUc({ subscriptions: { [USER]: { [UC_MONARCH_LIFETIME]: 'order-life' } } });
  const t = checker({ client });
  assert.deepEqual(await t.check.check(USER, MONARCH), { result: 'active', reason: 'uc_subscription_active', ref: 'order-life' });
  assert.deepEqual(client.calls.map((c) => c[0]), ['findMembership', 'findMembership']);
});

test('a one-time Upgrade.Chat purchase (lifetime) is active; a deleted one is not; nothing is a clear none', async () => {
  const oneTime = order({ uuid: 'order-once', is_subscription: false, order_items: [{ product: { uuid: UC_MONARCH_LIFETIME } }] });
  const t = checker({ client: k.createFakeUc({ orders: { [USER]: [oneTime] } }) });
  assert.deepEqual(await t.check.check(USER, MONARCH), { result: 'active', reason: 'uc_one_time_order', ref: 'order-once' });
  const deleted = checker({ client: k.createFakeUc({ orders: { [USER]: [{ ...oneTime, deleted: '2026-09-01T00:00:00Z' }] } }) });
  assert.deepEqual(await deleted.check.check(USER, MONARCH), { result: 'none', reason: 'uc_no_active_membership' });
  const other = checker({ client: k.createFakeUc({ orders: { [USER]: [order({ order_items: [{ interval: 'month', product: { uuid: UC_PREMIUM_MONTHLY } }] })] } }) });
  assert.deepEqual(await other.check.check(USER, MONARCH), { result: 'none', reason: 'uc_no_active_membership' }, 'a Premium order says nothing about Monarch');
});

test('a subscription order beyond findMembership (later pages) counts until its paid-through date, then a renewal grace', async () => {
  /* paid through 2026-10-20T12:00Z */
  const paidThrough = order({ last_succeeded_charge: { payment_processor_created: '2026-09-20T12:00:00Z' } });
  const at = (iso, o = paidThrough) => checker({ client: k.createFakeUc({ orders: { [USER]: [o] } }), now: () => Date.parse(iso) }).check.check(USER, MONARCH);
  assert.equal((await at('2026-10-05T12:00:00Z')).result, 'active');
  /* not cancelled, the renewal charge not recorded yet: never a "no" */
  assert.deepEqual(await at('2026-10-21T12:00:00Z'), { result: 'inconclusive', reason: 'uc_renewal_pending', ref: 'order-1' });
  assert.equal(UC_RENEWAL_GRACE_MS, 7 * 86400_000);
  assert.equal((await at('2026-10-27T11:59:00Z')).result, 'inconclusive');
  assert.deepEqual(await at('2026-10-27T12:00:01Z'), { result: 'none', reason: 'uc_no_active_membership' }, 'past the grace: a clear no');
  /* a cancelled subscription gets no grace once its paid period is over */
  assert.equal((await at('2026-10-21T12:00:00Z', { ...paidThrough, cancelled_at: '2026-10-01T00:00:00Z' })).result, 'none');
  assert.equal((await at('2026-10-05T12:00:00Z', { ...paidThrough, cancelled_at: '2026-10-01T00:00:00Z' })).result, 'active', 'cancelled but paid through');
  /* an active order wins over a renewing one */
  const renewing = { ...paidThrough, uuid: 'order-old' };
  const fresh = order({ uuid: 'order-new', last_succeeded_charge: { payment_processor_created: '2026-10-20T12:00:00Z' } });
  const both = checker({ client: k.createFakeUc({ orders: { [USER]: [renewing, fresh] } }), now: () => Date.parse('2026-10-21T12:00:00Z') });
  assert.deepEqual(await both.check.check(USER, MONARCH), { result: 'active', reason: 'uc_subscription_active', ref: 'order-new' });
});

test('the real client: an Upgrade.Chat subscriber whose renewal charge is 30 minutes late is inconclusive, never a "no"', async () => {
  /* review-ext-access-safety BUG 4: findMembership (orderRenewal) already
     rejects the order 30 min after its paid-through date; the checker must
     not turn that into a revoke. */
  const now = Date.parse('2026-10-05T12:00:00Z');
  const renewingOrder = {
    uuid: 'uc-order-renewing', is_subscription: true, deleted: false, cancelled_at: null,
    purchased_at: '2026-06-05T11:30:00.000Z',
    last_succeeded_charge: { payment_processor_created: '2026-09-05T11:30:00.000Z' },
    order_items: [{ product: { uuid: UC_MONARCH_MONTHLY }, interval: 'month', interval_count: 1 }]
  };
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/oauth/token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    if (u.includes('/orders')) return new Response(JSON.stringify({ data: [renewingOrder], has_more: false }), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  const client = createUpgradeChatClient({ clientId: 'uc-client', clientSecret: 'uc-secret', fetchImpl, now: () => now });
  const check = createUcChecker({ config: k.config(k.ownerEnv({ uc: true })), client, now: () => now });
  assert.deepEqual(await check.check(USER, MONARCH), { result: 'inconclusive', reason: 'uc_renewal_pending', ref: 'uc-order-renewing' });
});

test('an Upgrade.Chat that never answers: the check gives up (inconclusive, uc_timeout) and the client aborts its request', async () => {
  /* review-ext-correctness: without a deadline one hung request held a
     resync slot (index.js runs two at a time) for good. */
  const aborted = [];
  const hangingFetch = (url, init = {}) => new Promise((resolve, reject) => {
    if (init.signal) {
      if (init.signal.aborted) { aborted.push(String(url)); reject(init.signal.reason || new Error('aborted')); return; }
      init.signal.addEventListener('abort', () => { aborted.push(String(url)); reject(init.signal.reason || new Error('aborted')); });
    }
  });
  const config = k.config(k.ownerEnv({ uc: true }));
  const logs = [];
  const client = createUpgradeChatClient({ clientId: 'uc-client', clientSecret: 'uc-secret', fetchImpl: hangingFetch });
  const checker1 = createUcChecker({ config, client, deadlineMs: 50, logger: (level, event, fields) => logs.push({ event, fields }) });
  const started = Date.now();
  assert.deepEqual(await checker1.check(USER, MONARCH), { result: 'inconclusive', reason: 'uc_timeout' });
  assert.ok(Date.now() - started < 5000);
  assert.ok(logs.some((l) => l.event === 'academy_billing_uc_check_failed' && l.fields.error === 'timeout'));
  assert.ok(UC_CHECK_DEADLINE_MS > 0 && UC_CHECK_DEADLINE_MS < 15_000, 'the default deadline answers well inside a resync');
  /* the client's own per-request timeout (the engine passes 8 s) aborts the hung request */
  const timed = createUpgradeChatClient({ clientId: 'uc-client', clientSecret: 'uc-secret', fetchImpl: hangingFetch, timeoutMs: 30 });
  await assert.rejects(() => timed.listOrders({ discordUserId: USER }));
  assert.ok(aborted.some((u) => u.includes('/oauth/token')));
  const checker2 = createUcChecker({ config, client: timed });
  assert.deepEqual(await checker2.check(USER, MONARCH), { result: 'inconclusive', reason: 'uc_error' }, 'an aborted request is an error, never a "no"');
});

test('an Upgrade.Chat error, a network failure or a truncated order list is inconclusive, never none', async () => {
  for (const error of [new Error('Upgrade.Chat orders request failed (503)'), new TypeError('fetch failed'), new TypeError('invalid charge date')]) {
    const t = checker({ client: k.createFakeUc({ error }) });
    assert.deepEqual(await t.check.check(USER, MONARCH), { result: 'inconclusive', reason: 'uc_error' }, error.message);
    assert.ok(t.logs.some((l) => l.event === 'academy_billing_uc_check_failed'));
    assert.equal(JSON.stringify(t.logs).includes('uc-secret'), false);
  }
  /* findMembership failing while the order list answers is still not a "no" */
  for (const error of [new Error('Upgrade.Chat orders request failed (500)'), new TypeError('fetch failed')]) {
    const half = k.createFakeUc();
    half.findMembership = async () => { throw error; };
    const t = checker({ client: half });
    assert.deepEqual(await t.check.check(USER, MONARCH), { result: 'inconclusive', reason: 'uc_error' }, error.message);
  }
  const truncated = checker({ client: k.createFakeUc({ incomplete: true }) });
  assert.deepEqual(await truncated.check.check(USER, MONARCH), { result: 'inconclusive', reason: 'uc_orders_truncated' });
  const unreadable = checker({ client: k.createFakeUc({ orders: { [USER]: [order({ order_items: [{ interval: 'fortnight', product: { uuid: UC_MONARCH_MONTHLY } }] })] } }) });
  assert.equal((await unreadable.check.check(USER, MONARCH)).result, 'inconclusive', 'an order it cannot read is not a no');
  const noList = createUcChecker({ config: k.config(k.ownerEnv()), client: { findMembership: async () => { throw new TypeError('no eligible Upgrade.Chat subscription was found for this Discord account'); } } });
  assert.deepEqual(await noList.check(USER, MONARCH), { result: 'inconclusive', reason: 'uc_orders_unavailable' });
});

test('orderGrants, revocableGrant and the needs_review re-check window', () => {
  assert.equal(orderGrants(null, [UC_MONARCH_MONTHLY], T0), null);
  assert.equal(orderGrants(order(), ['other'], Date.parse('2026-10-01T00:00:00Z')), null);
  assert.equal(orderGrants(order(), [UC_MONARCH_MONTHLY], Date.parse('2026-10-01T00:00:00Z')).kind, 'subscription');
  assert.equal(revocableGrant({ had_role_before: false, state: 'engine_granted' }), true);
  assert.equal(revocableGrant({ had_role_before: false, state: 'needs_review' }), true);
  for (const row of [null, { had_role_before: true, state: 'engine_granted' }, { had_role_before: false, state: 'held' },
    { had_role_before: false, state: 'kept_external' }, { had_role_before: false, state: 'revoked' }]) assert.equal(revocableGrant(row), false);
  const review = { state: 'needs_review', uc_checked_at: new Date(T0) };
  assert.equal(ucRecheckDue(review, T0 + UC_RECHECK_MS - 1), false);
  assert.equal(ucRecheckDue(review, T0 + UC_RECHECK_MS), true);
  assert.equal(ucRecheckDue(review, T0 + 1, true), true, '--recheck forces it');
  assert.equal(ucRecheckDue({ state: 'engine_granted' }, T0), true);
  /* UC_MATCH=any: a role the engine granted and an Upgrade.Chat 'active' answer kept is re-checked once a day */
  const kept = { state: 'kept_external', had_role_before: false, uc_result: 'active', last_reason: 'uc_subscription_active', uc_checked_at: new Date(T0) };
  assert.equal(ucKeptRecheckable(kept), true);
  assert.equal(UC_KEPT_RECHECK_MS, 24 * 3600_000);
  assert.equal(ucRecheckDue(kept, T0 + UC_KEPT_RECHECK_MS - 1), false);
  assert.equal(ucRecheckDue(kept, T0 + UC_KEPT_RECHECK_MS), true);
  assert.equal(ucRecheckDue(kept, T0 + 1, true), true, '--recheck forces it');
  /* final keeps: a staff keep, a role held before the engine's grant, no Upgrade.Chat 'active' answer */
  for (const row of [null, { ...kept, last_reason: STAFF_KEEP_REASON }, { ...kept, had_role_before: true }, { ...kept, uc_result: 'inconclusive' },
    { ...kept, uc_result: null }, { ...kept, state: 'engine_granted' }]) assert.equal(ucKeptRecheckable(row), false, JSON.stringify(row));
  assert.equal(STAFF_KEEP_REASON, 'kept_by_staff');
  /* the answer an external DELETE may be sent on */
  assert.equal(ucAnswerStale({ uc_checked_at: new Date(T0) }, T0 + UC_ANSWER_TTL_MS), false);
  assert.equal(ucAnswerStale({ uc_checked_at: new Date(T0) }, T0 + UC_ANSWER_TTL_MS + 1), true);
  assert.equal(ucAnswerStale({ uc_checked_at: null }, T0), true);
  assert.equal(UC_ANSWER_TTL_MS, 10 * 60_000);
  /* a subscription item without an interval cannot be read: never a "no" */
  assert.throws(() => orderGrants(order({ order_items: [{ product: { uuid: UC_MONARCH_MONTHLY } }] }), [UC_MONARCH_MONTHLY], T0), TypeError);
});

/* ---------------------------------------------------------------------------
 * The real client (platform/upgrade-chat.js) against a fake Upgrade.Chat API.
 * ------------------------------------------------------------------------ */

function ucApi({ pages = [], status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/oauth/token')) return { ok: true, json: async () => ({ access_token: 'token', expires_in: 3600 }) };
    if (status !== 200) return { ok: false, status, json: async () => ({}) };
    const offset = Number(new URL(String(url)).searchParams.get('offset') || 0);
    const data = pages[offset / 100] || [];
    return { ok: true, json: async () => ({ data, has_more: offset / 100 < pages.length - 1 }) };
  };
  return { calls, client: createUpgradeChatClient({ clientId: 'id', clientSecret: 'secret', fetchImpl, now: () => Date.parse('2026-10-05T12:00:00Z') }) };
}

test('listOrders pages 100 at a time and reports a hit page cap as incomplete', async () => {
  const full = Array.from({ length: 100 }, (_, i) => ({ uuid: `o${i}` }));
  const two = ucApi({ pages: [full, [{ uuid: 'last' }]] });
  const result = await two.client.listOrders({ discordUserId: USER });
  assert.equal(result.data.length, 101);
  assert.equal(result.complete, true);
  const orderCalls = two.calls.filter((u) => u.includes('/orders'));
  assert.equal(orderCalls.length, 2);
  assert.match(orderCalls[1], /offset=100/);
  assert.match(orderCalls[0], new RegExp(`userDiscordId=${USER}`));
  assert.match(orderCalls[0], /type=UPGRADE/);
  const capped = ucApi({ pages: [full, full, full] });
  assert.equal((await capped.client.listOrders({ discordUserId: USER, maxPages: 2 })).complete, false);
  await assert.rejects(() => ucApi({ status: 503 }).client.listOrders({ discordUserId: USER }), /failed \(503\)/);
  await assert.rejects(() => two.client.listOrders({ discordUserId: '../x' }), TypeError);
});

test('the checker over the real client: a first-page miss, then a one-time purchase on page 2', async () => {
  const full = Array.from({ length: 100 }, (_, i) => ({ uuid: `o${i}`, is_subscription: true, purchased_at: '2020-01-01T00:00:00Z',
    order_items: [{ interval: 'month', product: { uuid: 'something-else' } }] }));
  const api = ucApi({ pages: [full, [{ uuid: 'lifetime-order', is_subscription: false, order_items: [{ product: { uuid: UC_MONARCH_LIFETIME } }] }]] });
  const check = createUcChecker({ config: k.config(k.ownerEnv()), client: api.client, now: () => Date.parse('2026-10-05T12:00:00Z') });
  assert.deepEqual(await check.check(USER, MONARCH), { result: 'active', reason: 'uc_one_time_order', ref: 'lifetime-order' });
});

/* ---------------------------------------------------------------------------
 * SML_ACADEMY_BILLING_UC_MATCH=any (the default): ANY active Upgrade.Chat
 * upgrade of the member keeps an engine-granted external role.
 * ------------------------------------------------------------------------ */

test('orderGrants(order, null): any product; lifetime one-time orders count until Upgrade.Chat ends them; time limits and free trials', () => {
  const at = Date.parse('2026-10-05T12:00:00Z');
  const hidden = { ...order(), order_items: [{ interval: 'month', interval_count: 1, product: { uuid: 'uc-hidden-legacy' } }] };
  assert.equal(orderGrants(hidden, [UC_MONARCH_MONTHLY], at), null, 'mapped: another product does not count');
  assert.equal(orderGrants(hidden, null, at).kind, 'subscription', 'any: every product counts');
  const oneTime = { uuid: 'o-life', is_subscription: false, purchased_at: '2023-01-01T00:00:00Z', deleted: null,
    order_items: [{ interval: null, product: { uuid: 'uc-hidden-lifetime' } }] };
  assert.equal(orderGrants(oneTime, null, at).kind, 'one_time', 'a lifetime order from 2023 still counts');
  assert.equal(orderGrants({ ...oneTime, cancelled_at: '2024-01-01T00:00:00Z' }, null, at).kind, 'one_time', 'fail safe: a cancel mark on a one-time order is not a refund');
  assert.equal(orderGrants({ ...oneTime, deleted: '2026-10-01T00:00:00Z' }, null, at), null, 'ended by Upgrade.Chat (refund, chargeback): none');
  const limited = { ...oneTime, purchased_at: '2026-09-20T00:00:00Z', order_items: [{ interval: 'month', interval_count: 1, is_time_limited: true, product: { uuid: 'p' } }] };
  assert.equal(orderGrants(limited, null, at).kind, 'one_time');
  assert.equal(orderGrants(limited, null, Date.parse('2026-10-21T00:00:00Z')), null, 'a time-limited one-time order ends with its time');
  /* a Free Trial product (1 day, 7-day trial) with no charge yet is active for the whole trial */
  const trial = { uuid: 'o-trial', is_subscription: true, purchased_at: '2026-10-01T12:00:00Z', deleted: null, cancelled_at: null,
    order_items: [{ interval: 'day', interval_count: 1, free_trial_length: 7, product: { uuid: 'uc-free-trial' } }] };
  assert.equal(orderGrants(trial, null, at).kind, 'subscription');
  assert.equal(orderGrants(trial, null, Date.parse('2026-10-09T12:00:00Z')).kind, 'renewing', 'after the trial, not cancelled: not a clear no');
  assert.equal(orderGrants({ ...trial, cancelled_at: '2026-10-03T00:00:00Z' }, null, Date.parse('2026-10-09T12:00:00Z')), null);
});

test('the any-mode checker: one listOrders read, any active upgrade is active, nothing active is a clear none', async () => {
  const at = () => T0;
  const config = k.config(k.memEnv());
  assert.equal(config.ucMatch, 'any');
  const hidden = k.createFakeUc({ orders: { [USER]: [k.ucOrder({ uuid: 'o-9', product: 'uc-hidden-1', lastCharge: T0 - 86400_000 })] } });
  const check = createUcChecker({ config, client: hidden, now: at });
  assert.deepEqual([check.configured, check.mode, check.scope], [true, 'any', 'member']);
  for (const role of [MONARCH, ELITE, PREMIUM]) {
    assert.deepEqual(await check.check(USER, role), { result: 'active', reason: 'uc_subscription_active', ref: 'o-9' }, role);
  }
  assert.deepEqual(hidden.calls.map((c) => c[0]), ['listOrders', 'listOrders', 'listOrders'], 'never findMembership');
  const empty = createUcChecker({ config, client: k.createFakeUc(), now: at });
  assert.deepEqual(await empty.check(USER, ELITE), { result: 'none', reason: 'uc_no_active_upgrade' });
  const lapsed = createUcChecker({ config, client: k.createFakeUc({ orders: { [USER]: [k.ucOrder({ lastCharge: T0 - 60 * 86400_000 })] } }), now: at });
  assert.deepEqual(await lapsed.check(USER, ELITE), { result: 'none', reason: 'uc_no_active_upgrade' });
  const renewing = createUcChecker({ config, client: k.createFakeUc({ orders: { [USER]: [k.ucOrder({ uuid: 'o-r', lastCharge: T0 - 32 * 86400_000 })] } }), now: at });
  assert.deepEqual(await renewing.check(USER, ELITE), { result: 'inconclusive', reason: 'uc_renewal_pending', ref: 'o-r' });
  const truncated = createUcChecker({ config, client: k.createFakeUc({ incomplete: true }), now: at });
  assert.equal((await truncated.check(USER, ELITE)).reason, 'uc_orders_truncated');
  const broken = createUcChecker({ config, client: k.createFakeUc({ orders: { [USER]: [{ uuid: 'bad', is_subscription: true, order_items: [{ product: { uuid: 'x' } }] }] } }), now: at });
  assert.deepEqual(await broken.check(USER, ELITE), { result: 'inconclusive', reason: 'uc_error' });
  const down = createUcChecker({ config, client: k.createFakeUc({ error: new Error('Upgrade.Chat orders request failed (503)') }), now: at });
  assert.deepEqual(await down.check(USER, ELITE), { result: 'inconclusive', reason: 'uc_error' });
  /* no listOrders on the client, or no credentials: never a revoke */
  assert.equal(createUcChecker({ config, client: { findMembership: async () => null }, now: at }).configured, false);
  assert.deepEqual(await createUcChecker({ config: k.config(k.memEnv({ uc: false })), client: hidden, now: at }).check(USER, ELITE),
    { result: 'inconclusive', reason: 'uc_not_configured' });
  /* a role no product map lists is still checked (the map is not used in this mode) */
  assert.equal(config.ucRoleProducts.size, 0);
  const slow = createUcChecker({ config, client: { listOrders: () => new Promise(() => {}) }, now: at, deadlineMs: 20 });
  assert.deepEqual(await slow.check(USER, ELITE), { result: 'inconclusive', reason: 'uc_timeout' });
});
