'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseArgs, run } = require('./cli');
const { createResync } = require('./resync');
const { createCatalog } = require('./catalog');
const k = require('./testkit');

const { USER, USER2, ACADEMY_ROLE } = k;

function engine({ overrides = {}, fixtures = {}, members = {} } = {}) {
  const now = k.clock();
  const config = k.config(overrides);
  const store = k.createFakeStore({ now, livemode: config.livemode });
  const stripe = k.createFakeStripe(fixtures);
  const bot = k.createFakeBot({ members });
  const core = createResync({ config, store, stripeApi: stripe, catalog: createCatalog({ config, stripeApi: stripe, now }), bot, now, stripeWritesAllowed: () => true });
  const resyncs = [];
  const eng = {
    config, store, stripe, bot, now, resyncs,
    preflight: { run: async () => ({ ok: true, stripeAccountOk: true }) },
    resync: async (id, opts) => { resyncs.push([id, opts]); return core.resync(id, opts); },
    reconciler: { run: async (opts) => ({ runId: 'r', ...opts }) },
    checkSchema: async () => true,
    stop: async () => {}
  };
  return eng;
}

async function cli(eng, argv, env = {}) {
  const out = [];
  const code = await run(parseArgs(argv), { env, engineFactory: () => eng, out: (obj) => out.push(obj), now: eng.now });
  return { code, out: out[0] };
}

test('argument parsing', () => {
  assert.deepEqual(parseArgs(['comp', 'grant', '--discord', USER, '--include-lifetime-role', '--reason', 'staff comp', '--apply', '--actor', 'owner']), {
    command: 'comp', args: ['grant'], flags: { discord: USER, 'include-lifetime-role': true, reason: 'staff comp', apply: true, actor: 'owner' }
  });
});

test('mutations are dry runs unless given BOTH --apply and --actor', async () => {
  const eng = engine();
  const dry = await cli(eng, ['comp', 'grant', '--discord', USER, '--reason', 'staff comp']);
  assert.equal(dry.out.apply, false);
  assert.equal(eng.store.db.comps.length, 0);
  await assert.rejects(() => cli(eng, ['comp', 'grant', '--discord', USER, '--reason', 'staff comp', '--apply']), /--actor/);
  await assert.rejects(() => cli(eng, ['comp', 'grant', '--discord', USER, '--reason', 'staff comp', '--apply', '--actor', 'bad actor!']), /--actor/);
  assert.equal(eng.store.db.comps.length, 0);
  assert.equal(eng.store.db.audit.length, 0);
});

test('comp grant writes a comp, audits it as the CLI actor and resyncs', async () => {
  const eng = engine({ members: { [USER]: [] } });
  const result = await cli(eng, ['comp', 'grant', '--discord', USER, '--include-lifetime-role', '--expires', '2026-12-31', '--reason', 'legacy lifetime buyer', '--apply', '--actor', 'owner']);
  assert.equal(result.code, 0);
  assert.equal(eng.store.db.comps.length, 1);
  assert.equal(eng.store.db.comps[0].include_lifetime_role, true);
  const granted = eng.store.db.audit.find((r) => r.action === 'comp_granted');
  assert.equal(granted.actor, 'cli:owner');
  assert.equal(granted.details.expiresAt, '2026-12-31T23:59:59.000Z');
  assert.deepEqual(result.out.resync.roles, ['academy', 'mem_lifetime']);
  assert.equal(eng.store.db.members.get(`${USER}|false`).bound_via, 'admin');
  await assert.rejects(() => cli(eng, ['comp', 'grant', '--discord', USER, '--expires', '2020-01-01', '--reason', 'old', '--apply', '--actor', 'owner']), /future/);
  await assert.rejects(() => cli(eng, ['comp', 'grant', '--discord', USER, '--reason', 'x', '--apply', '--actor', 'owner']), /reason/);
});

test('comp revoke marks the comp revoked, audits and resyncs', async () => {
  const eng = engine({ members: { [USER]: [ACADEMY_ROLE] } });
  await cli(eng, ['comp', 'grant', '--discord', USER, '--reason', 'staff comp', '--apply', '--actor', 'owner']);
  const result = await cli(eng, ['comp', 'revoke', '--id', '1', '--reason', 'staff left', '--apply', '--actor', 'owner']);
  assert.equal(result.out.revoked, 1);
  assert.ok(eng.store.db.comps[0].revoked_at);
  assert.ok(eng.store.db.audit.some((r) => r.action === 'comp_revoked'));
  assert.deepEqual(result.out.resync.roles, []);
});

test('rebind moves the customer A -> B in Stripe and the DB; A loses, B gains; a rebuild yields B', async () => {
  const CUS = 'cus_rebind';
  const eng = engine({ members: { [USER]: [ACADEMY_ROLE], [USER2]: [] }, fixtures: {
    customers: { [CUS]: k.academyCustomer(CUS, USER) },
    subscriptions: [k.subscription({ id: 'sub_rb', customer: CUS, metadata: { sml_kind: 'mem_academy', mem_academy_discord_user: USER } })],
    invoices: [k.invoice({ id: 'in_rb', subscription: 'sub_rb', charge: 'ch_rb' })], charges: [k.charge({ id: 'ch_rb', customer: CUS })],
    paymentIntents: [{ id: 'pi_renewal', customer: CUS, status: 'succeeded', metadata: { sml_kind: 'mem_academy', mem_academy_discord_user: USER } }]
  } });
  k.bindMember(eng.store, USER, CUS);
  await assert.rejects(() => cli(eng, ['rebind', USER2, CUS, '--apply', '--actor', 'owner']), /reason/);
  const dry = await cli(eng, ['rebind', USER2, CUS, '--reason', 'member changed accounts']);
  assert.deepEqual(dry.out.plan, { fromId: USER, toId: USER2, customerId: CUS });
  const result = await cli(eng, ['rebind', USER2, CUS, '--reason', 'member changed accounts', '--apply', '--actor', 'owner']);
  assert.equal(result.code, 0);
  assert.equal(eng.stripe.data.customers[CUS].metadata.mem_academy_discord_user, USER2);
  assert.equal(eng.stripe.data.subscriptions[0].metadata.mem_academy_discord_user, USER2);
  assert.equal(eng.stripe.data.paymentIntents[0].metadata.mem_academy_discord_user, USER2);
  assert.equal(eng.store.db.members.get(`${USER}|false`).stripe_customer_id, null);
  assert.equal(eng.store.db.members.get(`${USER}|false`).rebound_to, USER2);
  assert.equal(eng.store.db.members.get(`${USER2}|false`).stripe_customer_id, CUS);
  assert.deepEqual(result.out.old.roles, []);
  assert.deepEqual(result.out.new.roles, ['academy']);
  assert.ok(eng.store.db.audit.some((r) => r.action === 'binding_rebound' && r.details.fromDiscordUser === USER));
  const rebuild = await cli(eng, ['rebuild-from-stripe']);
  assert.deepEqual(rebuild.out.plan, []);
});

test('rebind refuses when the target already has its own customer', async () => {
  const eng = engine({ fixtures: { customers: { cus_a: k.academyCustomer('cus_a', USER) } } });
  k.bindMember(eng.store, USER, 'cus_a');
  k.bindMember(eng.store, USER2, 'cus_b');
  await assert.rejects(() => cli(eng, ['rebind', USER2, 'cus_a', '--reason', 'merge accounts', '--apply', '--actor', 'owner']), /already has its own customer/);
});

test('rebuild-from-stripe recreates missing bindings from Customer metadata', async () => {
  const eng = engine({ fixtures: { customers: { cus_lost: k.academyCustomer('cus_lost', USER2), cus_other: { id: 'cus_other', livemode: false, metadata: { sml_site: 'x' } } } } });
  const dry = await cli(eng, ['rebuild-from-stripe']);
  assert.deepEqual(dry.out.plan, [{ discordId: USER2, customerId: 'cus_lost' }]);
  assert.equal(eng.store.db.members.size, 0);
  const applied = await cli(eng, ['rebuild-from-stripe', '--apply', '--actor', 'owner']);
  assert.equal(applied.out.rebuilt, 1);
  assert.equal(eng.store.db.members.get(`${USER2}|false`).bound_via, 'stripe_rebuild');
  assert.ok(eng.store.db.audit.some((r) => r.action === 'binding_rebuilt' && r.actor === 'cli:owner'));
});

test('replay-deferred and replay-event re-queue stored events', async () => {
  const eng = engine();
  await eng.store.insertEvent(null, { eventId: 'evt_d1', type: 'invoice.paid', livemode: false, payloadSha256: 'a'.repeat(64), status: 'deferred' });
  assert.equal((await cli(eng, ['replay-deferred'])).out.apply, false);
  assert.equal((await cli(eng, ['replay-deferred', '--apply', '--actor', 'owner'])).out.replayed, 1);
  assert.equal(eng.store.db.events.get('evt_d1').status, 'pending');
  await assert.rejects(() => cli(eng, ['replay-event', 'evt_missing', '--apply', '--actor', 'owner']), /not found/);
  assert.equal((await cli(eng, ['replay-event', 'evt_d1', '--apply', '--actor', 'owner'])).out.replayed.event_id, 'evt_d1');
});

test('purge-test refuses in test mode without --force and audits a purge', async () => {
  const eng = engine();
  await assert.rejects(() => cli(eng, ['purge-test', '--apply', '--actor', 'owner']), /test mode/);
  const result = await cli(eng, ['purge-test', '--force', '--apply', '--actor', 'owner']);
  assert.equal(result.code, 0);
  assert.ok(eng.store.db.audit.some((r) => r.action === 'purge_test' && r.livemode === false));
});

test('audit verify and validate-config are read-only and never print secrets', async () => {
  const eng = engine();
  await cli(eng, ['comp', 'grant', '--discord', USER, '--reason', 'staff comp', '--apply', '--actor', 'owner']);
  const verified = await cli(eng, ['audit', 'verify']);
  assert.equal(verified.out.ok, true);
  const out = [];
  const code = await run(parseArgs(['validate-config']), { env: k.env(), engineFactory: () => { throw new Error('not needed'); }, out: (o) => out.push(o) });
  assert.equal(code, 0);
  const text = JSON.stringify(out[0]);
  for (const secret of ['whsec_academytestsecret', 'rk_test_academykey', 'academy-bot-token', 'academy-client-secret']) assert.equal(text.includes(secret), false, secret);
  assert.equal(out[0].config.roleMode, 'enforce');
});

test('resync is audit-only by default and real with --apply', async () => {
  const eng = engine({ members: { [USER]: [ACADEMY_ROLE] } });
  const dry = await cli(eng, ['resync', USER]);
  assert.equal(dry.out.resync.dryRun, true);
  assert.equal(eng.store.db.roles.size, 0);
  const applied = await cli(eng, ['resync', USER, '--apply', '--actor', 'owner']);
  assert.equal(applied.out.resync.dryRun, false);
  assert.equal(eng.store.db.roles.size, 1);
});
