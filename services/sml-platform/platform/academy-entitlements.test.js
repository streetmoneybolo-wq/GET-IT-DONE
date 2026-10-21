'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEntitlements, withEntitlements, parseSkuIds, parseSkuLevels, isActiveEntitlement } = require('./academy-entitlements');

const APP = '1551336038713139370';
const TOKEN = 'bot-token-that-is-long-enough-to-pass';
const SKU = '1234567890123456789';
const OTHER_SKU = '9876543210987654321';
const USER = '258456581000000000';
const NOW = Date.parse('2026-10-21T12:00:00Z');

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fail = (status) => ({ ok: false, status, json: async () => ({}) });
const entitlement = (over = {}) => ({ id: '1', sku_id: SKU, application_id: APP, user_id: USER, type: 8, deleted: false, starts_at: null, ends_at: null, ...over });

function build(fetchImpl, over = {}) {
  return createEntitlements({ appId: APP, botToken: TOKEN, skuIds: [SKU], fetchImpl, now: () => NOW, ...over });
}

test('parseSkuIds keeps snowflakes only, deduped', () => {
  assert.deepEqual(parseSkuIds(`${SKU}, ${SKU} ${OTHER_SKU},,nope,12`), [SKU, OTHER_SKU]);
  assert.deepEqual(parseSkuIds([SKU, '', null, OTHER_SKU]), [SKU, OTHER_SKU]);
  assert.deepEqual(parseSkuIds(''), []);
});

test('an entitlement is current only while it has started and not ended', () => {
  assert.equal(isActiveEntitlement(entitlement(), NOW), true, 'no bounds means it does not expire');
  assert.equal(isActiveEntitlement(entitlement({ ends_at: '2026-11-01T00:00:00Z' }), NOW), true);
  assert.equal(isActiveEntitlement(entitlement({ ends_at: '2026-10-01T00:00:00Z' }), NOW), false, 'ended');
  assert.equal(isActiveEntitlement(entitlement({ starts_at: '2026-12-01T00:00:00Z' }), NOW), false, 'not started');
  assert.equal(isActiveEntitlement(entitlement({ deleted: true }), NOW), false);
  assert.equal(isActiveEntitlement(entitlement({ consumed: true }), NOW), false, 'a consumed one has been spent');
  assert.equal(isActiveEntitlement(null, NOW), false);
});

test('it stays off until an app id, a bot token and at least one SKU are all set', () => {
  assert.equal(build(async () => ok([])).configured, true);
  assert.equal(createEntitlements({ appId: APP, botToken: TOKEN, skuIds: [] }).configured, false, 'no SKUs');
  assert.equal(createEntitlements({ appId: APP, botToken: 'short', skuIds: [SKU] }).configured, false, 'no token');
  assert.equal(createEntitlements({ appId: '', botToken: TOKEN, skuIds: [SKU] }).configured, false, 'no app');
});

test('a live purchase grants access; the request names the user and our SKUs', async () => {
  const calls = [];
  const ents = build(async (url, init) => { calls.push({ url, init }); return ok([entitlement()]); });
  assert.equal(await ents.hasActive(USER), true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, new RegExp(`/applications/${APP}/entitlements`));
  assert.match(calls[0].url, new RegExp(`user_id=${USER}`));
  assert.match(calls[0].url, new RegExp(`sku_ids=${SKU}`));
  assert.match(calls[0].url, /exclude_ended=true/);
  assert.equal(calls[0].init.headers.authorization, `Bot ${TOKEN}`);
});

test('someone else\'s SKU, an expired one, or nothing at all is refused', async () => {
  assert.equal(await build(async () => ok([entitlement({ sku_id: OTHER_SKU })])).hasActive(USER), false, 'not one of ours');
  assert.equal(await build(async () => ok([entitlement({ ends_at: '2026-01-01T00:00:00Z' })])).hasActive(USER), false, 'expired');
  assert.equal(await build(async () => ok([])).hasActive(USER), false, 'never bought');
  assert.equal(await build(async () => ok({ entitlements: [entitlement()] })).hasActive(USER), true, 'object form is read too');
});

test('a bad user id or an unconfigured service never calls Discord', async () => {
  let called = 0;
  const ents = build(async () => { called += 1; return ok([entitlement()]); });
  assert.equal(await ents.hasActive(''), false);
  assert.equal(await ents.hasActive('not-a-snowflake'), false);
  assert.equal(called, 0);
  const off = createEntitlements({ appId: APP, botToken: TOKEN, skuIds: [], fetchImpl: async () => { called += 1; return ok([entitlement()]); } });
  assert.equal(await off.hasActive(USER), false);
  assert.equal(called, 0);
});

test('the answer is cached, and a purchase can clear it', async () => {
  let calls = 0;
  const ents = build(async () => { calls += 1; return ok([]); });
  assert.equal(await ents.hasActive(USER), false);
  assert.equal(await ents.hasActive(USER), false);
  assert.equal(calls, 1, 'the second read came from the cache');
  ents.forget(USER);
  assert.equal(await ents.hasActive(USER), false);
  assert.equal(calls, 2, 'forget() sends the next read back to Discord');
});

test('an outage fails closed, and keeps the last good answer when there is one', async () => {
  let mode = 'ok';
  let clock = NOW;
  const ents = build(async () => (mode === 'ok' ? ok([entitlement()]) : fail(503)), { now: () => clock, ttlMs: 60_000 });
  assert.equal(await ents.hasActive(USER), true);
  /* the cached yes goes stale, and by then Discord is refusing */
  mode = 'down';
  clock += 120_000;
  assert.equal(await ents.hasActive(USER), true, 'a known buyer is not locked out by a Discord outage');

  const cold = build(async () => fail(500));
  assert.equal(await cold.hasActive(USER), false, 'with nothing known, an outage grants nothing');

  const threw = build(async () => { throw new Error('network'); });
  assert.equal(await threw.hasActive(USER), false);

  /* forget() is a deliberate "throw away what we know", so after it an outage grants nothing */
  let gone = 'ok';
  const cleared = build(async () => (gone === 'ok' ? ok([entitlement()]) : fail(503)));
  assert.equal(await cleared.hasActive(USER), true);
  gone = 'down';
  cleared.forget(USER);
  assert.equal(await cleared.hasActive(USER), false, 'nothing remembered, nothing granted');
});

test('withEntitlements upgrades only a member refused for the Academy role', async () => {
  const ents = build(async () => ok([entitlement()]));
  const refused = { verify: async () => ({ ok: false, code: 'academy_role_required', userId: USER }) };
  assert.deepEqual(await withEntitlements(refused, ents).verify('Bearer x'), { ok: true, userId: USER, tier: 'academy' });

  const already = { verify: async () => ({ ok: true, userId: USER, tier: 'member' }) };
  assert.equal((await withEntitlements(already, ents).verify('Bearer x')).tier, 'member', 'an entitled member is not downgraded');

  const other = { verify: async () => ({ ok: false, code: 'authorization_required' }) };
  assert.equal((await withEntitlements(other, ents).verify('Bearer x')).code, 'authorization_required', 'a signed-out caller stays signed out');

  const noBuyer = build(async () => ok([]));
  assert.equal((await withEntitlements(refused, noBuyer).verify('Bearer x')).ok, false, 'no purchase, no access');

  const off = createEntitlements({ appId: APP, botToken: TOKEN, skuIds: [] });
  assert.equal((await withEntitlements(refused, off).verify('Bearer x')).ok, false, 'unconfigured changes nothing');
  assert.equal((await withEntitlements(refused, null).verify('Bearer x')).ok, false);
});

test('a SKU can be labelled with the level it buys; a bare id still buys everything', () => {
  assert.deepEqual(parseSkuLevels('trader=' + SKU + ', analyst=' + OTHER_SKU), { [SKU]: 'trader', [OTHER_SKU]: 'analyst' });
  assert.deepEqual(parseSkuLevels(SKU), { [SKU]: 'analyst' }, 'an unlabelled SKU keeps the original full grant');
  assert.deepEqual(parseSkuLevels('nonsense=' + SKU), { [SKU]: 'analyst' }, 'an unknown label is not a downgrade');
  assert.deepEqual(parseSkuIds('trader=' + SKU), [SKU], 'the id is still read out of a labelled entry');
  assert.deepEqual(parseSkuLevels(''), {});
});

test('the level held decides the tier, and the better SKU wins', async () => {
  const both = { appId: APP, botToken: TOKEN, skuIds: 'trader=' + SKU + ',analyst=' + OTHER_SKU, now: () => NOW };
  const trader = createEntitlements({ ...both, fetchImpl: async () => ok([entitlement({ sku_id: SKU })]) });
  assert.equal(await trader.levelFor(USER), 'trader');
  assert.equal(await trader.hasActive(USER), true);

  const analyst = createEntitlements({ ...both, fetchImpl: async () => ok([entitlement({ sku_id: OTHER_SKU })]) });
  assert.equal(await analyst.levelFor(USER), 'analyst');

  const holdsBoth = createEntitlements({ ...both, fetchImpl: async () => ok([entitlement({ sku_id: SKU }), entitlement({ id: '2', sku_id: OTHER_SKU })]) });
  assert.equal(await holdsBoth.levelFor(USER), 'analyst', 'holding both is never a downgrade');

  const none = createEntitlements({ ...both, fetchImpl: async () => ok([]) });
  assert.equal(await none.levelFor(USER), '');
  assert.equal(await none.hasActive(USER), false);

  const expired = createEntitlements({ ...both, fetchImpl: async () => ok([entitlement({ sku_id: OTHER_SKU, ends_at: '2026-01-01T00:00:00Z' })]) });
  assert.equal(await expired.levelFor(USER), '', 'an expired analyst SKU grants nothing');
});

test('withEntitlements gives a trader buyer a trader session, an analyst buyer a full one', async () => {
  const refused = { verify: async () => ({ ok: false, code: 'academy_role_required', userId: USER }) };
  const both = { appId: APP, botToken: TOKEN, skuIds: 'trader=' + SKU + ',analyst=' + OTHER_SKU, now: () => NOW };

  const asTrader = createEntitlements({ ...both, fetchImpl: async () => ok([entitlement({ sku_id: SKU })]) });
  assert.deepEqual(await withEntitlements(refused, asTrader).verify('Bearer x'), { ok: true, userId: USER, tier: 'trader' });

  const asAnalyst = createEntitlements({ ...both, fetchImpl: async () => ok([entitlement({ sku_id: OTHER_SKU })]) });
  assert.deepEqual(await withEntitlements(refused, asAnalyst).verify('Bearer x'), { ok: true, userId: USER, tier: 'academy' });
});

test('preflight says whether Discord accepts the bot token', async () => {
  const good = build(async () => ok([]));
  assert.deepEqual(await good.preflight(), { ok: true, skus: 1 }, 'a 200 proves the token works for this app');

  const bad = build(async () => fail(401));
  assert.deepEqual(await bad.preflight(), { ok: false, status: 401, reason: 'token_rejected' });

  const forbidden = build(async () => fail(403));
  assert.deepEqual(await forbidden.preflight(), { ok: false, status: 403, reason: 'token_forbidden' });

  const down = build(async () => fail(503));
  assert.equal((await down.preflight()).reason, 'lookup_failed');

  const off = createEntitlements({ appId: APP, botToken: TOKEN, skuIds: [] });
  assert.deepEqual(await off.preflight(), { ok: false, reason: 'not_configured' });
});
