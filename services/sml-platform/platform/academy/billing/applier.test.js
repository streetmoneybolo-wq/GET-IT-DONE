'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createApplier } = require('./applier');
const { createResync } = require('./resync');
const { createCatalog } = require('./catalog');
const k = require('./testkit');

const { USER, USER2, GUILD, ACADEMY_ROLE, LIFETIME_ROLE, T0 } = k;
const ROLE_URL = (user, role) => `https://discord.com/api/v10/guilds/${GUILD}/members/${user}/roles/${role}`;

function discordFetch(respond) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, method: init.method, reason: init.headers['X-Audit-Log-Reason'] });
    const out = await respond(url, init, calls.length);
    const status = out.status || 204;
    return new Response(status === 204 ? null : JSON.stringify(out.body || {}), { status, headers: out.headers || {} });
  };
  fn.calls = calls;
  return fn;
}

function setup({ respond = () => ({ status: 204 }), overrides = {}, preflightOk = () => true } = {}) {
  const now = k.clock();
  const config = k.config(overrides);
  const store = k.createFakeStore({ now });
  const fetchImpl = discordFetch(respond);
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); now.advance(ms); };
  const logs = [];
  const bot = k.createFakeBot({});
  const applier = createApplier({ config, store, bot, fetchImpl, sleep, now, preflightOk, logger: (level, event, fields) => logs.push({ level, event, fields }) });
  return { now, config, store, fetchImpl, sleeps, applier, logs, bot };
}

async function row(store, { user = USER, role = ACADEMY_ROLE, key = 'academy', desired = true, state = 'pending' } = {}) {
  await store.insertRoleRow(null, { discordId: user, roleId: role, roleKey: key, desired, state });
}
const get = (store, user = USER, role = ACADEMY_ROLE) => store.db.roles.get(`false|${GUILD}|${user}|${role}`);

test('204 -> synced, with the audit-log reason, and audited as role_granted', async () => {
  const t = setup();
  await row(t.store);
  const result = await t.applier.runOnce();
  assert.deepEqual(result.counts, { synced: 1 });
  assert.deepEqual(t.fetchImpl.calls, [{ url: ROLE_URL(USER, ACADEMY_ROLE), method: 'PUT', reason: 'MEM Academy entitlement' }]);
  assert.equal(get(t.store).state, 'synced');
  assert.equal(get(t.store).applied_generation, 1);
  assert.deepEqual(k.actions(t.store), ['role_granted']);
});

test('end to end: resync + applier sends exactly one PUT, and two for lifetime', async () => {
  for (const lifetime of [false, true]) {
    /* the fake Discord applies each role call to the member the resync reads */
    const bot = k.createFakeBot({ members: { [USER]: [] } });
    const t = setup({ respond: (url, init) => {
      const role = String(url).split('/').pop();
      const held = bot.state.members[USER] || [];
      if (init.method === 'PUT' && !held.includes(role)) bot.state.members[USER] = [...held, role];
      if (init.method === 'DELETE') bot.state.members[USER] = held.filter((r) => r !== role);
      return { status: 204 };
    } });
    const CUS = 'cus_e2e';
    const stripe = k.createFakeStripe({ customers: { [CUS]: k.academyCustomer(CUS, USER) } });
    if (lifetime) {
      stripe.data.paymentIntents.push(k.lifetimePi({ id: 'pi_l', customer: CUS, latestCharge: 'ch_l' }));
      stripe.data.charges.push(k.charge({ id: 'ch_l', customer: CUS, paymentIntent: 'pi_l' }));
    } else {
      stripe.data.subscriptions.push(k.subscription({ id: 'sub_1', customer: CUS }));
      stripe.data.invoices.push(k.invoice({ id: 'in_1', subscription: 'sub_1', charge: 'ch_1' }));
      stripe.data.charges.push(k.charge({ id: 'ch_1', customer: CUS }));
    }
    k.bindMember(t.store, USER, CUS);
    const resync = createResync({ config: t.config, store: t.store, stripeApi: stripe, catalog: createCatalog({ config: t.config, stripeApi: stripe, now: t.now }), bot, now: t.now });
    await resync.resync(USER);
    await t.applier.runOnce();
    const expected = lifetime ? [ROLE_URL(USER, ACADEMY_ROLE), ROLE_URL(USER, LIFETIME_ROLE)] : [ROLE_URL(USER, ACADEMY_ROLE)];
    assert.deepEqual(t.fetchImpl.calls.map((c) => [c.method, c.url]), expected.map((url) => ['PUT', url]));
    assert.deepEqual([...bot.state.members[USER]].sort(), lifetime ? [ACADEMY_ROLE, LIFETIME_ROLE] : [ACADEMY_ROLE]);
    await resync.resync(USER);
    await resync.resync(USER);
    await t.applier.runOnce();
    assert.equal(t.fetchImpl.calls.length, expected.length, 'renewals and repeat resyncs of a synced member send nothing');
  }
});

test('Unknown Member (10007) on a grant waits with backoff, never retries forever', async () => {
  const t = setup({ respond: () => ({ status: 404, body: { code: 10007, message: 'Unknown Member' } }) });
  await row(t.store);
  await t.applier.runOnce();
  let r = get(t.store);
  assert.equal(r.state, 'awaiting_member');
  assert.equal(r.next_attempt_at.getTime(), T0 + 10 * 60_000);
  assert.deepEqual(k.actions(t.store), ['role_awaiting_member']);
  const expected = [30 * 60_000, 2 * 3600_000, 6 * 3600_000, 6 * 3600_000];
  for (const delay of expected) {
    t.now.set(r.next_attempt_at.getTime());
    await t.applier.runOnce();
    r = get(t.store);
    assert.equal(r.next_attempt_at.getTime() - t.now(), delay);
  }
  assert.deepEqual(k.actions(t.store), ['role_awaiting_member']);
  t.now.set(r.awaiting_since.getTime() + 90 * 86400_000 + 1);
  await t.applier.runOnce();
  assert.equal(get(t.store).state, 'failed');
  assert.ok(k.actions(t.store).includes('role_failed'));
});

test('a banned member is flagged for staff when the grant starts waiting', async () => {
  const t = setup({ respond: () => ({ status: 404, body: { code: 10007 } }) });
  t.bot.state.bans.add(USER);
  await row(t.store);
  await t.applier.runOnce();
  assert.deepEqual(k.actions(t.store), ['member_banned']);
  assert.ok(t.logs.some((l) => l.event === 'academy_billing_member_banned'));
});

test('404 on a revoke is success (the member is gone)', async () => {
  const t = setup({ respond: () => ({ status: 404, body: { code: 10007 } }) });
  await row(t.store, { desired: false });
  await t.applier.runOnce();
  assert.equal(get(t.store).state, 'synced');
  assert.deepEqual(k.actions(t.store), ['role_revoked']);
});

test('Unknown Role (10011) latches globally instead of waiting for a member', async () => {
  const t = setup({ respond: () => ({ status: 404, body: { code: 10011, message: 'Unknown Role' } }) });
  await row(t.store);
  await row(t.store, { user: USER2 });
  const result = await t.applier.runOnce();
  assert.equal(result.latch, 'config');
  assert.equal(t.fetchImpl.calls.length, 1);
  assert.deepEqual([get(t.store).state, get(t.store, USER2).state], ['pending', 'pending']);
  assert.ok(t.logs.some((l) => l.event === 'academy_billing_discord_blocked' && l.fields.latch === 'config'));
});

test('403 latches: other rows untouched, one probe per 30 minutes, then unblocks', async () => {
  let forbidden = true;
  const t = setup({ respond: () => (forbidden ? { status: 403, body: { code: 50013 } } : { status: 204 }) });
  await row(t.store);
  await row(t.store, { user: USER2 });
  const first = await t.applier.runOnce();
  assert.equal(first.latch, 'permission');
  assert.equal(t.fetchImpl.calls.length, 1);
  assert.deepEqual(await t.applier.runOnce(), { skipped: 'latched_permission' });
  t.now.advance(30 * 60_000);
  await t.applier.runOnce();
  assert.equal(t.fetchImpl.calls.length, 2, 'exactly one probe');
  forbidden = false;
  t.now.advance(30 * 60_000);
  const probe = await t.applier.runOnce();
  assert.equal(probe.latch, null);
  const rest = await t.applier.runOnce();
  assert.equal(rest.claimed, 1);
  assert.deepEqual([get(t.store).state, get(t.store, USER2).state], ['synced', 'synced']);
});

test('401 latches on the token', async () => {
  const t = setup({ respond: () => ({ status: 401, body: { code: 0 } }) });
  await row(t.store);
  assert.equal((await t.applier.runOnce()).latch, 'token');
  assert.equal(get(t.store).state, 'pending');
});

test('a global 429 is honoured before retrying', async () => {
  const t = setup({ respond: (url, init, n) => (n === 1 ? { status: 429, body: { retry_after: 2, global: true } } : { status: 204 }) });
  await row(t.store);
  await t.applier.runOnce();
  assert.equal(get(t.store).state, 'synced');
  assert.ok(t.sleeps.some((ms) => ms >= 2000));
  assert.equal(t.fetchImpl.calls.length, 2);
});

test('revokes run before grants', async () => {
  const t = setup();
  await row(t.store, { user: USER, desired: true });
  t.now.advance(1000);
  await row(t.store, { user: USER2, desired: false });
  await t.applier.runOnce();
  assert.deepEqual(t.fetchImpl.calls.map((c) => c.method), ['DELETE', 'PUT']);
});

test('an injected foreign role id throws before any request', async () => {
  const t = setup();
  t.store.db.roles.set(`false|${GUILD}|${USER}|${k.MONARCH}`, { livemode: false, guild_id: GUILD, discord_user_id: USER, role_id: k.MONARCH, role_key: 'academy',
    desired: false, generation: 1, state: 'pending', attempts: 0, next_attempt_at: null, updated_at: new Date(T0) });
  await assert.rejects(() => t.applier.runOnce(), /foreign_role_refused/);
  assert.equal(t.fetchImpl.calls.length, 0);
});

test('with REVOKES off a claimed revoke is suppressed without a request', async () => {
  const t = setup({ overrides: { SML_ACADEMY_BILLING_REVOKES_ENABLED: '0' } });
  await row(t.store, { desired: false });
  await t.applier.runOnce();
  assert.equal(t.fetchImpl.calls.length, 0);
  assert.equal(get(t.store).state, 'suppressed');
  assert.deepEqual(k.actions(t.store), ['role_suppressed']);
});

test('the generation race: a resync that flips desired mid-call wins', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const t = setup({ respond: async (url, init) => { if (init.method === 'DELETE') await gate; return { status: 204 }; } });
  await row(t.store, { desired: false });
  const pass = t.applier.runOnce();
  await new Promise((r) => setImmediate(r));
  /* resync: the member renewed while the DELETE was in flight */
  await t.store.updateRoleRow(null, { discordId: USER, roleId: ACADEMY_ROLE, desired: true, state: 'pending', bump: true });
  release();
  const result = await pass;
  assert.deepEqual(result.counts, { superseded: 1 });
  const r = get(t.store);
  assert.deepEqual([r.desired, r.state, r.generation], [true, 'pending', 2]);
  await t.applier.runOnce();
  assert.deepEqual(t.fetchImpl.calls.map((c) => c.method), ['DELETE', 'PUT']);
  assert.equal(get(t.store).state, 'synced');
});

test('retryable failures back off and fail after 20 attempts', async () => {
  const t = setup({ respond: () => ({ status: 500, body: {} }) });
  await row(t.store);
  await t.applier.runOnce();
  let r = get(t.store);
  assert.equal(r.state, 'pending');
  assert.ok(r.next_attempt_at.getTime() > t.now());
  for (let i = 0; i < 25 && get(t.store).state === 'pending'; i += 1) {
    t.now.set(get(t.store).next_attempt_at.getTime());
    await t.applier.runOnce();
  }
  r = get(t.store);
  assert.equal(r.state, 'failed');
  assert.ok(k.actions(t.store).includes('role_failed'));
});

test('idle unless ROLE_MODE=enforce and the Discord preflight passed', async () => {
  const dry = setup({ overrides: { SML_ACADEMY_BILLING_ROLE_MODE: 'dry_run' } });
  await row(dry.store);
  assert.deepEqual(await dry.applier.runOnce(), { skipped: 'role_mode' });
  const blocked = setup({ preflightOk: () => false });
  await row(blocked.store);
  assert.deepEqual(await blocked.applier.runOnce(), { skipped: 'preflight' });
  assert.equal(blocked.fetchImpl.calls.length, 0);
});

/* ---------------------------------------------------------------------------
 * The outbox generation race with the REAL resync: its Discord read happens
 * before its transaction, so an in-flight applier call can land after it.
 * ------------------------------------------------------------------------ */

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate, label) {
  for (let i = 0; i < 200; i += 1) { if (predicate()) return; await tick(); }
  throw new Error(`timed out waiting for ${label}`);
}

/** Discord whose PUT/DELETE change the member the resync reads, with one method held open. */
function gatedDiscord(bot, method) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(init.method);
    if (init.method === method) await gate;
    const role = String(url).split('/').pop();
    const held = bot.state.members[USER] || [];
    if (init.method === 'PUT' && !held.includes(role)) bot.state.members[USER] = [...held, role];
    if (init.method === 'DELETE') bot.state.members[USER] = held.filter((r) => r !== role);
    return new Response(null, { status: 204 });
  };
  return { fetchImpl, calls, release: () => release() };
}

function raceParts({ fixtures, members }) {
  const now = k.clock();
  const config = k.config();
  const store = k.createFakeStore({ now });
  const stripe = k.createFakeStripe(fixtures);
  const bot = k.createFakeBot({ members });
  const catalog = createCatalog({ config, stripeApi: stripe, now });
  const resync = createResync({ config, store, stripeApi: stripe, catalog, bot, now, stripeWritesAllowed: () => true });
  return { now, config, store, stripe, bot, resync };
}

test('outbox race: a renewal that lands while a revoke DELETE is in flight still ends with the member holding the role', async () => {
  const CUS = 'cus_raceA';
  const t = raceParts({
    members: { [USER]: [ACADEMY_ROLE] },
    fixtures: {
      customers: { [CUS]: k.academyCustomer(CUS, USER) },
      subscriptions: [k.subscription({ id: 'sub_renewed', customer: CUS })],
      invoices: [k.invoice({ id: 'in_new', subscription: 'sub_renewed', charge: 'ch_new' })],
      charges: [k.charge({ id: 'ch_new', customer: CUS })]
    }
  });
  k.bindMember(t.store, USER, CUS);
  await t.store.insertRoleRow(null, { discordId: USER, roleId: ACADEMY_ROLE, roleKey: 'academy', desired: false, state: 'pending' });
  const discord = gatedDiscord(t.bot, 'DELETE');
  const applier = createApplier({ config: t.config, store: t.store, bot: t.bot, fetchImpl: discord.fetchImpl, sleep: async () => {}, now: t.now });

  const pass = applier.runOnce();
  await until(() => discord.calls.includes('DELETE'), 'the DELETE to be in flight');
  await t.resync.resync(USER);                /* observes the role: the DELETE has not landed */
  const queued = get(t.store);
  assert.deepEqual([queued.desired, queued.state, queued.generation], [true, 'pending', 2], 'the flip is queued, never settled from the stale read');
  discord.release();
  assert.deepEqual((await pass).counts, { superseded: 1 });
  await applier.runOnce();
  await applier.runOnce();

  const row = get(t.store);
  assert.ok(t.bot.state.members[USER].includes(ACADEMY_ROLE),
    `paying member lost the Academy role: row desired=${row.desired} state=${row.state} gen=${row.generation}, Discord calls=${discord.calls.join(',')}`);
  assert.deepEqual(discord.calls, ['DELETE', 'PUT']);
  assert.deepEqual([row.desired, row.state], [true, 'synced']);
});

test('outbox race: a refund that lands while a grant PUT is in flight still ends with the role removed', async () => {
  const CUS = 'cus_raceB';
  const t = raceParts({
    members: { [USER]: [] },
    fixtures: {
      customers: { [CUS]: k.academyCustomer(CUS, USER) },
      subscriptions: [k.subscription({ id: 'sub_refunded', customer: CUS })],
      invoices: [k.invoice({ id: 'in_ref', subscription: 'sub_refunded', charge: 'ch_ref' })],
      charges: [k.charge({ id: 'ch_ref', customer: CUS, refunded: true, amountRefunded: 2999 })]
    }
  });
  k.bindMember(t.store, USER, CUS);
  await t.store.insertRoleRow(null, { discordId: USER, roleId: ACADEMY_ROLE, roleKey: 'academy', desired: true, state: 'pending' });
  const discord = gatedDiscord(t.bot, 'PUT');
  const applier = createApplier({ config: t.config, store: t.store, bot: t.bot, fetchImpl: discord.fetchImpl, sleep: async () => {}, now: t.now });

  const pass = applier.runOnce();
  await until(() => discord.calls.includes('PUT'), 'the PUT to be in flight');
  await t.resync.resync(USER);                /* observes no role: the PUT has not landed */
  discord.release();
  await pass;
  await applier.runOnce();
  await applier.runOnce();

  const row = get(t.store);
  assert.equal(t.bot.state.members[USER].includes(ACADEMY_ROLE), false,
    `refunded member kept the Academy role: row desired=${row.desired} state=${row.state} gen=${row.generation}, Discord calls=${discord.calls.join(',')}`);
  assert.deepEqual(discord.calls, ['PUT', 'DELETE']);
  assert.deepEqual([row.desired, row.state], [false, 'synced']);
});

test('outbox race: a SECOND resync during the in-flight DELETE does not settle the queued grant from its stale read', async () => {
  const CUS = 'cus_raceC';
  const t = raceParts({
    members: { [USER]: [ACADEMY_ROLE] },
    fixtures: {
      customers: { [CUS]: k.academyCustomer(CUS, USER) },
      subscriptions: [k.subscription({ id: 'sub_again', customer: CUS })],
      invoices: [k.invoice({ id: 'in_again', subscription: 'sub_again', charge: 'ch_again' })],
      charges: [k.charge({ id: 'ch_again', customer: CUS })]
    }
  });
  k.bindMember(t.store, USER, CUS);
  await t.store.insertRoleRow(null, { discordId: USER, roleId: ACADEMY_ROLE, roleKey: 'academy', desired: false, state: 'pending' });
  const discord = gatedDiscord(t.bot, 'DELETE');
  const applier = createApplier({ config: t.config, store: t.store, bot: t.bot, fetchImpl: discord.fetchImpl, sleep: async () => {}, now: t.now });

  const pass = applier.runOnce();
  await until(() => discord.calls.includes('DELETE'), 'the DELETE to be in flight');
  await t.resync.resync(USER);                /* webhook: flips to a queued grant */
  t.now.advance(1000);
  await t.resync.resync(USER);                /* success-page settle: still sees the role */
  assert.equal(get(t.store).state, 'pending', 'a queued row is left to the applier');
  discord.release();
  await pass;
  await applier.runOnce();
  assert.ok(t.bot.state.members[USER].includes(ACADEMY_ROLE));
  assert.equal(get(t.store).state, 'synced');
});

test('revokes wait for preflight to confirm the Stripe account; grants still flow', async () => {
  let accountOk = false;
  const now = k.clock();
  const config = k.config();
  const store = k.createFakeStore({ now });
  const fetchImpl = discordFetch(() => ({ status: 204 }));
  const logs = [];
  const applier = createApplier({ config, store, bot: k.createFakeBot({}), fetchImpl, sleep: async () => {}, now,
    revokesAllowed: () => accountOk, logger: (level, event) => logs.push(event) });
  await row(store, { user: USER, desired: false });
  await row(store, { user: USER2, desired: true });
  const first = await applier.runOnce();
  assert.deepEqual(first.counts, { synced: 1 });
  assert.deepEqual(fetchImpl.calls.map((c) => [c.method, c.url]), [['PUT', ROLE_URL(USER2, ACADEMY_ROLE)]]);
  const held = get(store, USER);
  assert.deepEqual([held.desired, held.state, held.attempts], [false, 'pending', 0], 'the revoke row is left queued and untouched');
  assert.ok(logs.includes('academy_billing_revokes_held'));
  accountOk = true;
  await applier.runOnce();
  assert.deepEqual(fetchImpl.calls.map((c) => c.method), ['PUT', 'DELETE']);
  assert.ok(logs.includes('academy_billing_revokes_released'));
});

test('a revoke row that is claimed anyway while revokes are held is released without a request', async () => {
  const now = k.clock();
  const config = k.config();
  const store = k.createFakeStore({ now });
  await row(store, { desired: false });
  const original = store.claimRoleRows;
  store.claimRoleRows = (limit, lease) => original(limit, lease);   /* ignores grantsOnly */
  const fetchImpl = discordFetch(() => ({ status: 204 }));
  const applier = createApplier({ config, store, bot: k.createFakeBot({}), fetchImpl, sleep: async () => {}, now, revokesAllowed: () => false });
  assert.deepEqual((await applier.runOnce()).counts, { held: 1 });
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(get(store).state, 'pending');
});
