'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { sign } = require('../../stripe-webhook');
const { createAcademyServer } = require('../server');
const { createAcademyBilling } = require('./index');
const k = require('./testkit');

/* A pool that answers the real store.js statements by pattern. */
function scriptedPool({ schema = true, handlers = [] } = {}) {
  const seen = [];
  async function query(sql, params = []) {
    const text = String(sql);
    seen.push({ text, params });
    for (const [pattern, reply] of handlers) if (pattern.test(text)) return typeof reply === 'function' ? reply(params) : reply;
    if (/FROM schema_migrations/.test(text)) return { rows: schema ? [{ ok: 1 }] : [], rowCount: schema ? 1 : 0 };
    if (/INSERT INTO academy_billing_events/.test(text)) return { rows: [], rowCount: 1 };
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text.trim())) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  }
  return { seen, query, connect: async () => ({ query, release() {} }), end: async () => {} };
}

function fakeTimers() {
  const intervals = [];
  return {
    intervals,
    setInterval(fn, ms) { const h = { fn, ms, cleared: false, unref() {} }; intervals.push(h); return h; },
    clearInterval(h) { if (h) h.cleared = true; }
  };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test('an empty env is fully inert: no pool, no jobs, the server 404s billing paths', async () => {
  const billing = createAcademyBilling({ env: {}, databaseUrl: 'postgres://localhost/none' });
  assert.equal(billing.enabled, false);
  assert.equal(billing.reason, 'disabled');
  assert.equal(await billing.issueHandoff({ discordUserId: k.USER }), null);
  assert.deepEqual(await billing.handoff.mint({ discordUserId: k.USER }), { ok: false, code: 'handoff_unconfigured' });
  await billing.start();
  await billing.stop();
  const server = createAcademyServer({ interactions: null, checkDatabase: async () => true, academyBilling: billing });
  const base = await listen(server);
  try {
    const response = await fetch(`${base}/v1/academy/billing/buy`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { ok: false, error: 'not_found' });
    assert.equal((await fetch(`${base}/v1/academy/billing/stripe/webhook`, { method: 'POST', body: '{}' })).status, 404);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('an invalid ENABLED=1 config never throws out of the factory; it stays disabled', () => {
  const logs = [];
  const billing = createAcademyBilling({ env: k.env({ SML_ACADEMY_BILLING_STRIPE_KEY: '' }), pool: scriptedPool(), logger: (l, e) => logs.push(e) });
  assert.equal(billing.enabled, false);
  assert.equal(billing.reason, 'invalid_config');
  assert.ok(logs.includes('academy_billing_config_invalid'));
});

test('webhook-only (ENABLED=0 + secret) stores deferred events through the real store SQL', async () => {
  const pool = scriptedPool({ handlers: [[/FROM academy_billing_members WHERE stripe_customer_id/, { rows: [{ discord_user_id: k.USER }], rowCount: 1 }]] });
  const env = k.env({ SML_ACADEMY_BILLING_ENABLED: '0' });
  const billing = createAcademyBilling({ env, pool });
  await billing.start();
  const server = createAcademyServer({ interactions: null, checkDatabase: async () => true, academyBilling: billing });
  const base = await listen(server);
  try {
    const body = JSON.stringify({ id: 'evt_idx1', type: 'invoice.paid', created: 1, livemode: false, data: { object: { id: 'in_1', customer: 'cus_bound' } } });
    const t = Math.floor(Date.now() / 1000);
    const response = await fetch(`${base}/v1/academy/billing/stripe/webhook`, { method: 'POST', body,
      headers: { 'stripe-signature': `t=${t},v1=${sign('whsec_academytestsecret', t, body)}` } });
    assert.deepEqual(await response.json(), { received: true, status: 'deferred' });
    const insert = pool.seen.find((q) => /INSERT INTO academy_billing_events/.test(q.text));
    assert.equal(insert.params[0], 'evt_idx1');
    assert.equal(insert.params[17], 'deferred');
    assert.equal((await fetch(`${base}/v1/academy/billing/buy`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await billing.stop();
  }
});

test('a throwing billing handler returns 500 and the service keeps serving interactions', async () => {
  let interactionsServed = 0;
  const server = createAcademyServer({
    interactions: { async handleRequest(_req, res) { interactionsServed += 1; res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"type":1}'); } },
    checkDatabase: async () => true,
    academyBilling: { async handle() { throw new Error('boom'); } }
  });
  const base = await listen(server);
  try {
    const response = await fetch(`${base}/v1/academy/billing/buy`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { ok: false, error: 'internal_error' });
    const ok = await fetch(`${base}/v1/academy/interactions`, { method: 'POST', body: '{"type":1}' });
    assert.equal(ok.status, 200);
    assert.equal(interactionsServed, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('ENABLED=1 without schema 028: no jobs, a periodic schema re-check, routes 404', async () => {
  const timers = fakeTimers();
  const logs = [];
  const billing = createAcademyBilling({ env: k.env(), pool: scriptedPool({ schema: false }), timers, stripeApi: k.createFakeStripe(), bot: k.createFakeBot(),
    logger: (level, event) => logs.push(event) });
  await billing.start();
  assert.ok(logs.includes('academy_billing_schema_missing'));
  assert.deepEqual(timers.intervals.map((i) => i.ms), [5 * 60_000]);
  assert.equal(billing.state().started, false);
  await billing.stop();
  assert.ok(timers.intervals.every((i) => i.cleared));
});

test('ENABLED=1 with schema 028: preflight, then the job timers; stop() clears them', async () => {
  const timers = fakeTimers();
  const logs = [];
  const stripe = k.createFakeStripe();
  const billing = createAcademyBilling({ env: k.env({ SML_ACADEMY_BILLING_RECONCILE_MODE: 'dry_run' }), pool: scriptedPool(), timers, stripeApi: stripe,
    bot: k.createFakeBot(), logger: (level, event) => logs.push(event) });
  await billing.start();
  assert.ok(logs.includes('academy_billing_started'));
  assert.ok(logs.includes('academy_billing_preflight'));
  assert.equal(billing.preflight.ok(), true);
  assert.deepEqual(timers.intervals.map((i) => i.ms).sort((a, b) => a - b), [5000, 5000, 60_000, 900_000, 3600_000]);
  await billing.stop();
  assert.ok(timers.intervals.every((i) => i.cleared));
  assert.equal(billing.state().started, false);
});

test('the Upgrade.Chat check is wired from the platform credentials (or an injected client), else inert', async () => {
  const withUc = createAcademyBilling({ env: k.env(k.ownerEnv()), pool: scriptedPool(), timers: fakeTimers(), stripeApi: k.createFakeStripe(), bot: k.createFakeBot() });
  assert.equal(withUc.ucChecker.configured, true);
  const without = createAcademyBilling({ env: k.env(k.ownerEnv({ uc: false })), pool: scriptedPool(), timers: fakeTimers(), stripeApi: k.createFakeStripe(), bot: k.createFakeBot() });
  assert.equal(without.ucChecker.configured, false);
  assert.deepEqual(await without.ucChecker.check(k.USER, k.MONARCH), { result: 'inconclusive', reason: 'uc_not_configured' });
  const fake = k.createFakeUc({ subscriptions: { [k.USER]: { [k.UC_MONARCH_MONTHLY]: 'uc-1' } } });
  const injected = createAcademyBilling({ env: k.env(k.ownerEnv()), pool: scriptedPool(), timers: fakeTimers(), stripeApi: k.createFakeStripe(),
    bot: k.createFakeBot(), upgradeChat: fake });
  assert.equal((await injected.ucChecker.check(k.USER, k.MONARCH)).result, 'active');
  for (const b of [withUc, without, injected]) await b.stop();
});

test('onMemberSeen re-kicks waiting grants only in enforce mode; hand-offs need IN_DISCORD_LINKS', async () => {
  const pool = scriptedPool({ handlers: [[/UPDATE academy_billing_role_state SET state = 'pending'/, { rows: [], rowCount: 0 }]] });
  const billing = createAcademyBilling({ env: k.env(), pool, timers: fakeTimers(), stripeApi: k.createFakeStripe(), bot: k.createFakeBot() });
  await billing.start();
  billing.onMemberSeen(k.USER);
  billing.onMemberSeen('not-a-snowflake');
  await new Promise((r) => setImmediate(r));
  assert.equal(pool.seen.filter((q) => /UPDATE academy_billing_role_state SET state = 'pending'/.test(q.text)).length, 1);
  assert.equal(await billing.issueHandoff({ discordUserId: k.USER }), null);
  await billing.stop();
  const linked = createAcademyBilling({ env: k.env({ SML_ACADEMY_BILLING_IN_DISCORD_LINKS: '1' }), pool, timers: fakeTimers(), stripeApi: k.createFakeStripe(), bot: k.createFakeBot() });
  await linked.start();
  const handoff = await linked.issueHandoff({ discordUserId: k.USER, source: 'hub' });
  assert.match(handoff.url, /\/v1\/academy\/billing\/start\?h=/);
  await linked.stop();
});

test('onMemberSeen: nothing waiting but roles already delivered -> one resync (a leave and rejoin drops every role), at most every 10 minutes', async () => {
  let delivered = [{ role_key: 'academy', desired: true, state: 'synced' }];
  const pool = scriptedPool({ handlers: [
    [/UPDATE academy_billing_role_state SET state = 'pending'/, { rows: [], rowCount: 0 }],
    [/SELECT role_key, desired, state FROM academy_billing_role_state/, () => ({ rows: delivered, rowCount: delivered.length })]
  ] });
  const now = k.clock();
  const billing = createAcademyBilling({ env: k.env(), pool, timers: fakeTimers(), stripeApi: k.createFakeStripe(), bot: k.createFakeBot(), now });
  await billing.start();
  /* a resync starts with a read of the member's binding */
  const resyncs = () => pool.seen.filter((q) => /SELECT \* FROM academy_billing_members WHERE discord_user_id = \$1 AND livemode = \$2$/.test(q.text)
    && q.params[0] === k.USER).length;
  const ticks = async () => { for (let i = 0; i < 30; i += 1) await new Promise((r) => setImmediate(r)); };
  const base = resyncs();
  billing.onMemberSeen(k.USER);
  await ticks();
  assert.equal(resyncs() - base, 1);
  billing.onMemberSeen(k.USER);
  await ticks();
  assert.equal(resyncs() - base, 1, 'rate limited');
  now.advance(10 * 60_000);
  billing.onMemberSeen(k.USER);
  await ticks();
  assert.equal(resyncs() - base, 2);
  /* nothing ever delivered (no billing record): no resync, only the kick */
  delivered = [];
  now.advance(10 * 60_000);
  billing.onMemberSeen(k.USER);
  await ticks();
  assert.equal(resyncs() - base, 2);
  await billing.stop();
});

test('SEEN_NOTIFY=1 listens for mem_academy_seen and re-kicks that member', async () => {
  const pool = scriptedPool({ handlers: [[/UPDATE academy_billing_role_state SET state = 'pending'/, { rows: [], rowCount: 0 }]] });
  const handlers = {};
  const listenQueries = [];
  pool.connect = async () => ({
    query: async (sql, params) => { listenQueries.push(String(sql)); return pool.query(sql, params); },
    on: (name, fn) => { handlers[name] = fn; },
    release() {}
  });
  const billing = createAcademyBilling({ env: k.env({ SML_ACADEMY_BILLING_SEEN_NOTIFY: '1' }), pool, timers: fakeTimers(), stripeApi: k.createFakeStripe(), bot: k.createFakeBot() });
  await billing.start();
  assert.ok(listenQueries.includes('LISTEN mem_academy_seen'));
  handlers.notification({ channel: 'mem_academy_seen', payload: k.USER });
  handlers.notification({ channel: 'other', payload: k.USER2 });
  await new Promise((r) => setImmediate(r));
  const kicked = pool.seen.filter((q) => /UPDATE academy_billing_role_state SET state = 'pending'/.test(q.text));
  assert.deepEqual(kicked.map((q) => q.params[2]), [k.USER]);
  await billing.stop();
  assert.ok(listenQueries.includes('UNLISTEN mem_academy_seen'));
});

test('no role is REVOKED while preflight says the Stripe key is on the wrong account', async () => {
  const CUS = 'cus_paying';
  const stripe = k.createFakeStripe({ customers: { [CUS]: k.academyCustomer(CUS, k.USER) }, account: { id: 'acct_SOMEONE_ELSE' } });
  const bot = k.createFakeBot({ members: { [k.USER]: [k.ACADEMY_ROLE] } });
  const claimRows = [{
    livemode: false, guild_id: k.GUILD, discord_user_id: k.USER, role_id: k.ACADEMY_ROLE, role_key: 'academy',
    desired: false, generation: 1, state: 'pending', attempts: 1, next_attempt_at: null, awaiting_since: null, updated_at: new Date(k.T0)
  }];
  const claims = [];
  const pool = scriptedPool({ handlers: [
    [/UPDATE academy_billing_role_state r/, (params) => { claims.push(params); const rows = claimRows.splice(0); return { rows, rowCount: rows.length }; }],
    [/UPDATE academy_billing_role_state/, { rows: [], rowCount: 1 }]
  ] });
  const deletes = [];
  const fetchImpl = async (url, init) => { if (init.method === 'DELETE') deletes.push(url); return new Response(null, { status: 204 }); };
  const engine = createAcademyBilling({ env: k.env(), pool, stripeApi: stripe, bot, fetchImpl, sleep: async () => {}, now: () => k.T0, timers: fakeTimers() });

  const preflight = await engine.preflight.run();
  assert.equal(preflight.stripeAccountOk, false, 'fixture: the Stripe account check fails');
  assert.equal(preflight.discordOk, true, 'fixture: Discord itself is fine');

  const result = await engine.applier.runOnce();
  assert.deepEqual(deletes, [], 'a revoke computed from a key on the wrong Stripe account was sent to Discord');
  assert.equal(claims[0][4], true, 'only grants are claimed while the account is unconfirmed');
  assert.deepEqual(result.counts, { held: 1 });
});

test('starting in ROLE_MODE=enforce makes members resynced without role writes due once', async () => {
  const pool = scriptedPool({ handlers: [[/UPDATE academy_billing_members\s+SET next_check_at = now\(\)/, { rows: [], rowCount: 3 }]] });
  const logs = [];
  const billing = createAcademyBilling({ env: k.env(), pool, timers: fakeTimers(), stripeApi: k.createFakeStripe(), bot: k.createFakeBot(),
    logger: (level, event, fields) => logs.push({ event, fields }) });
  await billing.start();
  const sweep = pool.seen.filter((q) => /rolesQueued/.test(q.text));
  assert.equal(sweep.length, 1);
  assert.deepEqual(sweep[0].params, [false]);
  assert.deepEqual(logs.find((l) => l.event === 'academy_billing_role_sync_due').fields, { members: 3 });
  await billing.stop();
  const dry = scriptedPool();
  const dryRun = createAcademyBilling({ env: k.env({ SML_ACADEMY_BILLING_ROLE_MODE: 'dry_run', SML_ACADEMY_BILLING_CHECKOUT_ENABLED: '0' }), pool: dry, timers: fakeTimers(),
    stripeApi: k.createFakeStripe(), bot: k.createFakeBot() });
  await dryRun.start();
  assert.equal(dry.seen.filter((q) => /rolesQueued/.test(q.text)).length, 0);
  await dryRun.stop();
});
