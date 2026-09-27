'use strict';

/* EXTERNAL roles end to end (resync -> ledger -> outbox -> applier), with the
   owner set-up of 2026-09-26: Lifetime grants the Academy Student role AND
   Monarch (no separate MEM Lifetime role); a Premium membership product
   (academy:false) grants Premium only. External roles are GRANT-ONLY-UNLESS-
   SAFE: the engine removes one only when its ledger row says the engine put
   it there (had_role_before=false) and Upgrade.Chat has no active membership
   that grants it. */

const assert = require('node:assert/strict');
const test = require('node:test');
const { createResync } = require('./resync');
const { createApplier } = require('./applier');
const { createCatalog } = require('./catalog');
const { createReconciler } = require('./reconciler');
const { createUcChecker, UC_RECHECK_MS, UC_ANSWER_TTL_MS } = require('./external');
const { ENTITLED_RECHECK_MS } = require('./resync');
const { UC_STALE_RETRY_MS } = require('./applier');
const { ROLE_MAX_ATTEMPTS } = require('./store');
const { run: runCli, parseArgs } = require('./cli');
const k = require('./testkit');

const { USER, USER2, ACADEMY_ROLE, MONARCH, PREMIUM, T0, S, UC_MONARCH_LIFETIME, UC_MONARCH_MONTHLY, UC_PREMIUM_MONTHLY } = k;
const CUS = 'cus_ext1';

function setup({ members = { [USER]: [] }, fixtures = {}, overrides = {}, uc = true, ucClient = null, discord = null } = {}) {
  const now = k.clock();
  const config = k.config({ ...k.ownerEnv({ uc }), ...overrides });
  const store = k.createFakeStore({ now });
  const stripe = k.createFakeStripe({ customers: { [CUS]: k.academyCustomer(CUS, USER) }, ...fixtures });
  const bot = k.createFakeBot({ members });
  const catalog = createCatalog({ config, stripeApi: stripe, now });
  const client = ucClient || k.createFakeUc();
  const ucChecker = createUcChecker({ config, client: uc ? client : null, now });
  const logs = [];
  const logger = (level, event, fields) => logs.push({ level, event, fields });
  const engine = createResync({ config, store, stripeApi: stripe, catalog, bot, now, logger, ucChecker, stripeWritesAllowed: () => true });
  const calls = [];
  /* every role call with the status Discord answered: [method, user, role, status] */
  const sent = [];
  /* a Discord answer forced from inside a test (a 403, a 5xx), like `discord` */
  const force = { override: null };
  /* A fake Discord that applies each role call to the member the resync reads. */
  const fetchImpl = async (url, init) => {
    const parts = String(url).split('/');
    const user = parts[8];
    const role = parts[10];
    calls.push([init.method, user, role]);
    const forced = (discord ? discord(role, init.method) : null) || (force.override ? force.override(role, init.method) : null);
    if (forced) { sent.push([init.method, user, role, forced.status]); return new Response(JSON.stringify(forced.body || {}), { status: forced.status }); }
    const held = bot.state.members[user];
    if (held == null) { sent.push([init.method, user, role, 404]); return new Response(JSON.stringify({ code: 10007, message: 'Unknown Member' }), { status: 404 }); }
    if (init.method === 'PUT' && !held.includes(role)) bot.state.members[user] = [...held, role];
    if (init.method === 'DELETE') bot.state.members[user] = held.filter((r) => r !== role);
    sent.push([init.method, user, role, 204]);
    return new Response(null, { status: 204 });
  };
  const makeApplier = (cfg = config) => createApplier({ config: cfg, store, bot, fetchImpl, sleep: async () => {}, now, logger });
  const applier = makeApplier();
  k.bindMember(store, USER, CUS);
  const ledger = (user = USER, role = MONARCH) => store.db.external.get(`false|${k.GUILD}|${user}|${role}`) || null;
  const outbox = (user = USER, role = MONARCH) => store.db.roles.get(`false|${k.GUILD}|${user}|${role}`) || null;
  const held = (user = USER) => [...(bot.state.members[user] || [])].sort();
  const reconciler = createReconciler({ config, store, stripeApi: stripe, bot, resync: engine.resync, preflight: { ok: () => true }, now });
  /* the CLI over this engine */
  const cli = async (argv) => {
    const out = [];
    const eng = { config, store, stripe, preflight: { run: async () => ({ ok: true, stripeAccountOk: true }) },
      resync: (id, opts) => engine.resync(id, opts), checkSchema: async () => true, stop: async () => {} };
    const code = await runCli(parseArgs(argv), { engineFactory: () => eng, out: (o) => out.push(o), now });
    return { code, out: out[0] };
  };
  return { now, config, store, stripe, bot, engine, applier, makeApplier, reconciler, cli, client, logs, calls, sent, force, ledger, outbox, held };
}

const lifetimePaid = (extra = {}) => ({
  paymentIntents: [k.lifetimePi({ id: 'pi_life', customer: CUS, latestCharge: 'ch_life', amount: 920000 })],
  charges: [k.charge({ id: 'ch_life', customer: CUS, amount: 920000, paymentIntent: 'pi_life', ...extra })]
});
const refund = (t) => { const c = t.stripe.data.charges.find((x) => x.id === 'ch_life'); c.refunded = true; c.amount_refunded = c.amount; };
const premiumSub = (extra = {}) => ({
  subscriptions: [k.subscription({ id: 'sub_prem', customer: CUS, price: 'price_premium1', ...extra })],
  invoices: [k.invoice({ id: 'in_prem', subscription: 'sub_prem', charge: 'ch_prem' })],
  charges: [k.charge({ id: 'ch_prem', customer: CUS, amount: 4999 })]
});

test('config: the owner set-up needs no MEM Lifetime role; Lifetime lists Monarch; Premium is a pure membership', () => {
  const t = setup();
  assert.equal(t.config.enabled, true);
  assert.equal(t.config.lifetimeRoleId, '');
  assert.deepEqual(t.config.prices.get('price_life1').roles, [MONARCH]);
  assert.equal(t.config.prices.get('price_premium1').academy, false);
  assert.equal(t.config.prices.get('price_premium1').line, `roles:${PREMIUM}`);
});

test('Lifetime: the buyer without Monarch gets Academy Student AND Monarch; the ledger says engine_granted', async () => {
  const t = setup({ fixtures: lifetimePaid() });
  const result = await t.engine.resync(USER);
  assert.deepEqual(result.roles, ['academy', 'mem_lifetime']);
  assert.deepEqual(result.externalRoles, [MONARCH]);
  const row = t.ledger();
  assert.deepEqual([row.state, row.had_role_before, row.first_source_ref], ['engine_granted', false, 'pi_life']);
  assert.deepEqual([t.outbox().role_key, t.outbox().desired, t.outbox().state], ['external', true, 'pending']);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [ACADEMY_ROLE, MONARCH].sort());
  assert.deepEqual(t.calls.map((c) => c[0]), ['PUT', 'PUT'], 'no lifetime-role call: that role is not configured');
  const recorded = t.store.db.audit.find((r) => r.action === 'external_grant_state');
  assert.deepEqual([recorded.role_key, recorded.details.to, recorded.details.hadRoleBefore], ['external', 'engine_granted', false]);
  /* a repeat resync sends nothing and records nothing new */
  const audits = t.store.db.audit.length;
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.equal(t.calls.length, 2);
  assert.equal(t.store.db.audit.length, audits);
});

test('a member who already holds Monarch (Upgrade.Chat) is recorded as held: no PUT, and never removed', async () => {
  const t = setup({ members: { [USER]: [MONARCH] }, fixtures: lifetimePaid() });
  await t.engine.resync(USER);
  assert.deepEqual([t.ledger().state, t.ledger().had_role_before], ['held', true]);
  assert.equal(t.outbox().state, 'synced');
  await t.applier.runOnce();
  assert.deepEqual(t.calls, [['PUT', USER, ACADEMY_ROLE]]);
  refund(t);
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [MONARCH], 'Academy Student removed, Monarch kept');
  assert.equal(t.ledger().state, 'held');
  assert.deepEqual(t.client.calls, [], 'no Upgrade.Chat call for a held role');
});

test('refund, Upgrade.Chat says none: the engine-granted Monarch is removed (ledger revoked, one DELETE)', async () => {
  const t = setup({ fixtures: lifetimePaid() });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  refund(t);
  const result = await t.engine.resync(USER);
  assert.deepEqual(result.externalRoles, []);
  assert.deepEqual([t.ledger().state, t.ledger().uc_result], ['revoked', 'none']);
  assert.deepEqual(t.client.calls.map((c) => c[0]), ['findMembership', 'findMembership', 'listOrders']);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), []);
  assert.deepEqual(t.calls.filter((c) => c[0] === 'DELETE').map((c) => c[2]).sort(), [ACADEMY_ROLE, MONARCH].sort());
  const change = t.store.db.audit.filter((r) => r.action === 'external_grant_state').map((r) => [r.details.from, r.details.to, r.reason]);
  assert.deepEqual(change, [[null, 'engine_granted', 'granted'], ['engine_granted', 'revoked', 'uc_no_active_membership']]);
});

test('refund, Upgrade.Chat has an active Monarch membership: kept_external, no DELETE of Monarch', async () => {
  const t = setup({ fixtures: lifetimePaid(), ucClient: k.createFakeUc({ subscriptions: { [USER]: { [UC_MONARCH_LIFETIME]: 'uc-order-9' } } }) });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  refund(t);
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.deepEqual([t.ledger().state, t.ledger().uc_result], ['kept_external', 'active']);
  assert.deepEqual(t.held(), [MONARCH]);
  assert.equal(t.calls.some((c) => c[0] === 'DELETE' && c[2] === MONARCH), false);
  const kept = t.store.db.audit.find((r) => r.action === 'external_grant_state' && r.details.to === 'kept_external');
  assert.equal(kept.details.ucRef, 'uc-order-9');
  /* kept_external is final for this purchase: later resyncs ask nothing and send nothing */
  const asked = t.client.calls.length;
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.equal(t.client.calls.length, asked);
  assert.deepEqual(t.held(), [MONARCH]);
});

test('Upgrade.Chat NOT configured: the engine-granted Monarch is kept, flagged needs_review, audited and listed by the CLI', async () => {
  const t = setup({ uc: false, fixtures: lifetimePaid() });
  assert.ok(t.config.warnings.some((w) => /UPGRADE_CHAT_CLIENT_ID/.test(w)));
  await t.engine.resync(USER);
  await t.applier.runOnce();
  refund(t);
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.deepEqual([t.ledger().state, t.ledger().last_reason, t.ledger().uc_result], ['needs_review', 'uc_not_configured', 'inconclusive']);
  assert.deepEqual(t.held(), [MONARCH], 'fail safe: access kept');
  assert.ok(t.logs.some((l) => l.event === 'academy_billing_external_needs_review'));
  const flagged = t.store.db.audit.find((r) => r.action === 'external_grant_state' && r.details.to === 'needs_review');
  assert.equal(flagged.outcome, 'noop');
  const member = t.store.db.members.get(`${USER}|false`);
  assert.equal(member.next_check_at.getTime(), T0 + UC_RECHECK_MS, 're-checked in six hours');
  /* the CLI lists it */
  const out = [];
  const eng = { config: t.config, store: t.store, stripe: t.stripe, preflight: { run: async () => ({ ok: true, stripeAccountOk: true }) },
    resync: (id, opts) => t.engine.resync(id, opts), checkSchema: async () => true, stop: async () => {} };
  assert.equal(await runCli(parseArgs(['external-review']), { engineFactory: () => eng, out: (o) => out.push(o), now: t.now }), 0);
  assert.deepEqual(out[0].rows.map((r) => [r.discordId, r.roleId, r.state, r.reason, r.hadRoleBefore]), [[USER, MONARCH, 'needs_review', 'uc_not_configured', false]]);
  assert.equal(out[0].ucConfigured, false);
  /* repeat resyncs inside the window: no new audit */
  const audits = t.store.db.audit.length;
  await t.engine.resync(USER);
  assert.equal(t.store.db.audit.length, audits);
});

test('an Upgrade.Chat outage parks the revoke as needs_review; the 6-hour re-check (or --recheck) finishes it', async () => {
  const client = k.createFakeUc({ error: new Error('Upgrade.Chat orders request failed (503)') });
  const t = setup({ fixtures: lifetimePaid(), ucClient: client });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  refund(t);
  await t.engine.resync(USER);
  assert.deepEqual([t.ledger().state, t.ledger().last_reason], ['needs_review', 'uc_error']);
  client.state.error = null;
  /* inside the window nothing is re-asked */
  const asked = client.calls.length;
  await t.engine.resync(USER);
  assert.equal(client.calls.length, asked);
  assert.equal(t.ledger().state, 'needs_review');
  /* --recheck through the CLI (dry run first, then apply) */
  const out = [];
  const eng = { config: t.config, store: t.store, stripe: t.stripe, preflight: { run: async () => ({ ok: true, stripeAccountOk: true }) },
    resync: (id, opts) => t.engine.resync(id, opts), checkSchema: async () => true, stop: async () => {} };
  await runCli(parseArgs(['external-review', '--recheck']), { engineFactory: () => eng, out: (o) => out.push(o), now: t.now });
  assert.deepEqual(out[0], { ok: true, apply: false, wouldRecheck: [USER] });
  await runCli(parseArgs(['external-review', '--recheck', '--apply', '--actor', 'owner']), { engineFactory: () => eng, out: (o) => out.push(o), now: t.now });
  assert.equal(out[1].remaining, 0);
  assert.equal(t.ledger().state, 'revoked');
  assert.ok(k.actions(t.store).includes('external_review_recheck'));
  await t.applier.runOnce();
  assert.deepEqual(t.held(), []);
});

test('the 6-hour window: a needs_review row is asked again only after UC_RECHECK_MS', async () => {
  const client = k.createFakeUc({ error: new Error('down') });
  const t = setup({ fixtures: lifetimePaid(), ucClient: client });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  refund(t);
  await t.engine.resync(USER);
  client.state.error = null;
  client.state.subscriptions[USER] = { [UC_MONARCH_LIFETIME]: 'uc-order-2' };
  t.now.advance(UC_RECHECK_MS);
  await t.engine.resync(USER);
  assert.deepEqual([t.ledger().state, t.ledger().uc_result], ['kept_external', 'active']);
});

test('the engine never touches an external role it has no ledger row for (Upgrade.Chat members are invisible)', async () => {
  /* USER holds Premium and Monarch from Upgrade.Chat, has no engine purchase at all */
  const t = setup({ members: { [USER]: [PREMIUM, MONARCH] } });
  await t.engine.resync(USER);
  assert.equal(t.store.db.external.size, 0);
  assert.equal(t.store.db.roles.size, 0);
  await t.applier.runOnce();
  assert.deepEqual(t.calls, []);
  assert.deepEqual(t.client.calls, []);
  /* and the reconciler (apply, revokes on) does not find them either */
  const reconciler = createReconciler({ config: t.config, store: t.store, stripeApi: t.stripe, bot: t.bot, resync: t.engine.resync,
    preflight: { ok: () => true }, now: t.now });
  t.bot.state.members[USER2] = [MONARCH, PREMIUM];
  const summary = await reconciler.run({ mode: 'apply' });
  assert.equal(summary.plannedRevokes, 0);
  await t.applier.runOnce();
  assert.deepEqual(t.calls, []);
  assert.deepEqual(t.held(USER2), [MONARCH, PREMIUM].sort());
});

test('the reconciler re-checks every engine-granted external role, and removes it only through resync + Upgrade.Chat', async () => {
  const t = setup({ fixtures: lifetimePaid() });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  refund(t);
  /* the refund webhook was missed: the 15-minute sweep finds the member from the ledger */
  t.now.advance(60_000);
  const reconciler = createReconciler({ config: t.config, store: t.store, stripeApi: t.stripe, bot: t.bot, resync: t.engine.resync,
    preflight: { ok: () => true }, now: t.now });
  const summary = await reconciler.run({ mode: 'apply' });
  assert.equal(summary.brake, null);
  assert.equal(t.ledger().state, 'revoked');
  await t.applier.runOnce();
  assert.deepEqual(t.held(), []);
});

test('an open dispute suspends Monarch under the same rule; winning it grants it again', async () => {
  const t = setup({ fixtures: { ...lifetimePaid({ disputed: true }), disputes: [] } });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  t.stripe.data.disputes.push({ id: 'du_1', charge: 'ch_life', status: 'needs_response' });
  await t.engine.resync(USER);
  assert.equal(t.ledger().state, 'revoked');
  await t.applier.runOnce();
  assert.deepEqual(t.held(), []);
  t.stripe.data.disputes[0].status = 'won';
  await t.engine.resync(USER);
  assert.deepEqual([t.ledger().state, t.ledger().had_role_before], ['engine_granted', false]);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [ACADEMY_ROLE, MONARCH].sort());
  /* a lost one removes it for good (Upgrade.Chat: none) */
  t.stripe.data.disputes[0].status = 'lost';
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), []);
  assert.equal(t.ledger().state, 'revoked');
});

test('union: a comp that lists Monarch keeps it after the refund; its expiry starts the revoke rule', async () => {
  const t = setup({ fixtures: lifetimePaid() });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  t.store.db.comps.push({ id: 7, discord_user_id: USER, livemode: false, include_lifetime_role: false, grants_academy: false,
    external_role_ids: [MONARCH], expires_at: new Date(T0 + 86400_000), revoked_at: null });
  refund(t);
  const result = await t.engine.resync(USER);
  assert.deepEqual(result.externalRoles, [MONARCH]);
  assert.deepEqual(result.roles, [], 'the comp grants Monarch only');
  assert.equal(t.ledger().state, 'engine_granted');
  assert.deepEqual(t.client.calls, []);
  t.now.advance(86400_000 + 1);
  await t.engine.resync(USER);
  assert.equal(t.ledger().state, 'revoked');
});

test('a Premium membership product (academy:false) grants Premium only, never the Academy role', async () => {
  const t = setup({ fixtures: premiumSub() });
  const result = await t.engine.resync(USER);
  assert.deepEqual(result.roles, []);
  assert.deepEqual(result.externalRoles, [PREMIUM]);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [PREMIUM]);
  assert.equal(t.store.db.members.get(`${USER}|false`).last_access.externalRoles[0], PREMIUM);
  /* cancelled: Upgrade.Chat Premium is active, so the role stays with UC */
  t.client.state.subscriptions[USER] = { [UC_PREMIUM_MONTHLY]: 'uc-prem' };
  t.stripe.data.subscriptions[0].status = 'canceled';
  await t.engine.resync(USER);
  assert.equal(t.ledger(USER, PREMIUM).state, 'kept_external');
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [PREMIUM]);
});

test('a price missing from the config holds every external revoke (no Upgrade.Chat call, no DELETE)', async () => {
  const t = setup({ fixtures: lifetimePaid() });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  refund(t);
  t.stripe.data.prices.price_unknown1 = k.stripePrice('price_unknown1');
  t.stripe.data.subscriptions.push(k.subscription({ id: 'sub_unk', customer: CUS, price: 'price_unknown1' }));
  const result = await t.engine.resync(USER);
  assert.ok(result.reasons.includes('config_unmapped_price'));
  assert.equal(result.deferredRevokes, 1);
  assert.equal(t.ledger().state, 'engine_granted');
  assert.deepEqual(t.client.calls, []);
});

test('REVOKES_ENABLED=0: an external revoke is suppressed without asking Upgrade.Chat', async () => {
  const t = setup({ fixtures: lifetimePaid(), overrides: { SML_ACADEMY_BILLING_REVOKES_ENABLED: '0' } });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  refund(t);
  await t.engine.resync(USER);
  assert.deepEqual([t.outbox().desired, t.outbox().state], [false, 'suppressed']);
  assert.equal(t.ledger().state, 'engine_granted');
  assert.deepEqual(t.client.calls, []);
});

test('a grant still queued when the refund lands: Upgrade.Chat is asked, then the DELETE is queued behind it', async () => {
  const t = setup({ fixtures: lifetimePaid() });
  await t.engine.resync(USER);
  refund(t);
  await t.engine.resync(USER);
  assert.equal(t.client.calls.length > 0, true, 'the queued PUT counts as present');
  assert.deepEqual([t.outbox().desired, t.outbox().state], [false, 'pending']);
  assert.equal(t.ledger().state, 'revoked');
  await t.applier.runOnce();
  assert.deepEqual(t.held(), []);
});

test('a ledger row that changes under the Upgrade.Chat check is not acted on: retried in five minutes', async () => {
  const t = setup({ fixtures: lifetimePaid() });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  refund(t);
  const original = t.client.listOrders;
  t.client.listOrders = async (args) => {
    const row = t.ledger();
    row.generation += 1;
    return original.call(t.client, args);
  };
  const result = await t.engine.resync(USER);
  assert.equal(result.deferredRevokes, 1);
  assert.equal(t.ledger().state, 'engine_granted');
  assert.equal(t.store.db.members.get(`${USER}|false`).next_check_at.getTime(), T0 + 5 * 60_000);
});

test('a buyer not in the server: Monarch waits with the Academy role (had_role_before=false) and lands when they join', async () => {
  const t = setup({ members: {}, fixtures: lifetimePaid() });
  await t.engine.resync(USER);
  assert.deepEqual([t.ledger().state, t.ledger().had_role_before], ['engine_granted', false]);
  assert.equal(t.outbox().state, 'awaiting_member');
  t.bot.state.members[USER] = [];
  assert.equal(await t.store.kickAwaiting(null, USER), 2);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [ACADEMY_ROLE, MONARCH].sort());
});

test('supersede: the Academy lifetime cancels Academy plans only; a Premium lifetime cancels Premium plans only', async () => {
  const both = {
    subscriptions: [k.subscription({ id: 'sub_acad', customer: CUS }), k.subscription({ id: 'sub_prem', customer: CUS, price: 'price_premium1' })],
    invoices: [k.invoice({ id: 'in_a', subscription: 'sub_acad', charge: 'ch_a' }), k.invoice({ id: 'in_p', subscription: 'sub_prem', charge: 'ch_p' })]
  };
  const academyLife = setup({ fixtures: { ...both, paymentIntents: lifetimePaid().paymentIntents,
    charges: [...lifetimePaid().charges, k.charge({ id: 'ch_a', customer: CUS }), k.charge({ id: 'ch_p', customer: CUS })] } });
  const r1 = await academyLife.engine.resync(USER);
  assert.deepEqual(r1.stripeActions.filter((a) => a.action === 'lifetime_supersede').map((a) => a.subscriptionId), ['sub_acad']);
  const premLife = setup({ fixtures: { ...both,
    paymentIntents: [k.lifetimePi({ id: 'pi_pl', customer: CUS, latestCharge: 'ch_pl', price: 'price_premlife1', amount: 250000 })],
    charges: [k.charge({ id: 'ch_pl', customer: CUS, amount: 250000, paymentIntent: 'pi_pl' }), k.charge({ id: 'ch_a', customer: CUS }), k.charge({ id: 'ch_p', customer: CUS })] } });
  const r2 = await premLife.engine.resync(USER);
  assert.deepEqual(r2.roles, ['academy'], 'the Academy plan still grants the Academy');
  assert.deepEqual(r2.externalRoles, [PREMIUM]);
  assert.deepEqual(r2.stripeActions.filter((a) => a.action === 'lifetime_supersede').map((a) => a.subscriptionId), ['sub_prem']);
});

test('ROLE_MODE=dry_run plans external grants and (UC-gated) revokes without writing the ledger', async () => {
  const t = setup({ fixtures: lifetimePaid(), overrides: { SML_ACADEMY_BILLING_ROLE_MODE: 'dry_run' } });
  const result = await t.engine.resync(USER);
  assert.deepEqual(result.ops.map((o) => [o.roleKey, o.desired]), [['academy', true], ['external', true]]);
  assert.equal(t.store.db.external.size, 0);
  const plan = t.store.db.audit.filter((r) => r.action === 'role_desired_changed').map((r) => [r.role_key, r.outcome, r.details.roleId || null]);
  assert.deepEqual(plan, [['academy', 'dry_run', null], ['external', 'dry_run', MONARCH]]);
});

/* ---------------------------------------------------------------------------
 * The applier: last line of defence and per-row blocks.
 * ------------------------------------------------------------------------ */

test('the applier refuses an external DELETE the ledger does not back (never removes a role the engine did not grant)', async () => {
  const t = setup({ members: { [USER]: [MONARCH] } });
  for (const ledgerRow of [null, { state: 'held', had_role_before: true }, { state: 'engine_granted', had_role_before: false }]) {
    t.store.db.roles.clear();
    t.store.db.external.clear();
    if (ledgerRow) t.store.db.external.set(`false|${k.GUILD}|${USER}|${MONARCH}`, { discord_user_id: USER, role_id: MONARCH, livemode: false, generation: 1, ...ledgerRow });
    await t.store.insertRoleRow(null, { discordId: USER, roleId: MONARCH, roleKey: 'external', desired: false, state: 'pending' });
    const result = await t.applier.runOnce();
    assert.deepEqual(result.counts, { refused: 1 }, JSON.stringify(ledgerRow));
    assert.equal(t.outbox().state, 'suppressed');
  }
  assert.deepEqual(t.calls, []);
  assert.deepEqual(t.held(), [MONARCH]);
  assert.ok(k.actions(t.store).includes('external_revoke_refused'));
});

test('an external role or id outside SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS is refused before any request', async () => {
  const t = setup({ overrides: { SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS: PREMIUM, SML_ACADEMY_BILLING_PRICES_JSON: k.pricesJson(),
    SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON: '' } });
  await t.store.insertRoleRow(null, { discordId: USER, roleId: MONARCH, roleKey: 'external', desired: true, state: 'pending' });
  await assert.rejects(() => t.applier.runOnce(), /foreign_role_refused/);
  t.store.db.roles.clear();
  await t.store.insertRoleRow(null, { discordId: USER, roleId: k.FREE_TRIAL, roleKey: 'external', desired: true, state: 'pending' });
  await assert.rejects(() => t.applier.runOnce(), /foreign_role_refused/);
  assert.deepEqual(t.calls, []);
});

test('Monarch above the bot (403) blocks that row only; Academy Student grants keep flowing', async () => {
  const t = setup({ fixtures: lifetimePaid(), discord: (role) => (role === MONARCH ? { status: 403, body: { code: 50013, message: 'Missing Permissions' } } : null) });
  await t.engine.resync(USER);
  const first = await t.applier.runOnce();
  assert.equal(first.latch, null, 'no global latch');
  assert.deepEqual(t.held(), [ACADEMY_ROLE]);
  const row = t.outbox();
  assert.deepEqual([row.state, row.last_error], ['pending', 'external_role_forbidden']);
  assert.equal(row.next_attempt_at.getTime(), T0 + 30 * 60_000);
  assert.ok(k.actions(t.store).includes('role_blocked'));
  assert.ok(t.logs.some((l) => l.event === 'academy_billing_external_role_blocked'));
  /* another member's Academy grant in the meantime still goes through */
  k.bindMember(t.store, USER2, 'cus_other');
  t.bot.state.members[USER2] = [];
  await t.store.insertRoleRow(null, { discordId: USER2, roleId: ACADEMY_ROLE, roleKey: 'academy', desired: true, state: 'pending' });
  await t.applier.runOnce();
  assert.deepEqual(t.held(USER2), [ACADEMY_ROLE]);
  assert.equal(k.actions(t.store).filter((a) => a === 'role_blocked').length, 1, 'audited once, not on every retry');
});

test('comps: --role grants an external role, --no-academy leaves the Academy out, --include-lifetime-role needs the optional role', async () => {
  const t = setup();
  const out = [];
  const eng = { config: t.config, store: t.store, stripe: t.stripe, preflight: { run: async () => ({ ok: true, stripeAccountOk: true }) },
    resync: (id, opts) => t.engine.resync(id, opts), checkSchema: async () => true, stop: async () => {} };
  const cli = (argv) => runCli(parseArgs(argv), { engineFactory: () => eng, out: (o) => out.push(o), now: t.now });
  await assert.rejects(() => cli(['comp', 'grant', '--discord', USER, '--include-lifetime-role', '--reason', 'legacy lifetime', '--apply', '--actor', 'owner']), /LIFETIME_ROLE_ID/);
  await assert.rejects(() => cli(['comp', 'grant', '--discord', USER, '--role', k.FREE_TRIAL, '--reason', 'nope', '--apply', '--actor', 'owner']), /EXTERNAL_ROLE_IDS/);
  await assert.rejects(() => cli(['comp', 'grant', '--discord', USER, '--no-academy', '--reason', 'nothing', '--apply', '--actor', 'owner']), /must grant something/);
  await cli(['comp', 'grant', '--discord', USER, '--role', MONARCH, '--no-academy', '--reason', 'legacy lifetime buyer', '--apply', '--actor', 'owner']);
  const comp = t.store.db.comps[0];
  assert.deepEqual([comp.grants_academy, comp.external_role_ids], [false, [MONARCH]]);
  assert.deepEqual(out[out.length - 1].resync.externalRoles, [MONARCH]);
  assert.deepEqual(out[out.length - 1].resync.roles, []);
  assert.equal(t.ledger().state, 'engine_granted');
});

/* ---------------------------------------------------------------------------
 * Review findings (2026-09-26): revokes that must land, grants that must not,
 * and stale answers. Each test is a concrete sequence that failed before the
 * fix (review-ext-access-safety / review-ext-correctness).
 * ------------------------------------------------------------------------ */

const lifetimeOf = (id) => ({
  paymentIntents: [k.lifetimePi({ id: `pi_${id}`, customer: CUS, latestCharge: `ch_${id}`, amount: 920000 })],
  charges: [k.charge({ id: `ch_${id}`, customer: CUS, amount: 920000, paymentIntent: `pi_${id}` })]
});
const refundOf = (t, id) => { const c = t.stripe.data.charges.find((x) => x.id === `ch_${id}`); c.refunded = true; c.amount_refunded = c.amount; };
const monarchDeletes = (t) => t.sent.filter((c) => c[0] === 'DELETE' && c[2] === MONARCH && c[3] === 204);

test('a Monarch DELETE held by the kill switch (REVOKES_ENABLED=0) is asked again and sent once revokes are back on', async () => {
  const t = setup({ fixtures: lifetimePaid() });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [ACADEMY_ROLE, MONARCH].sort());
  refund(t);
  await t.engine.resync(USER);
  assert.deepEqual([t.ledger().state, t.outbox().desired, t.outbox().state], ['revoked', false, 'pending']);
  /* the owner flips the kill switch before the applier ran */
  await t.makeApplier(k.config({ ...k.ownerEnv(), SML_ACADEMY_BILLING_REVOKES_ENABLED: '0' })).runOnce();
  assert.deepEqual([t.outbox().state, t.outbox(USER, ACADEMY_ROLE).state], ['suppressed', 'suppressed']);
  /* an unfinished revoke: listed, and the reconciler re-checks the member */
  const listed = await t.cli(['external-review']);
  assert.deepEqual(listed.out.rows.map((r) => [r.state, r.revokeUnfinished, r.outbox]), [['revoked', true, 'suppressed']]);
  assert.deepEqual(await t.store.externalGrantHolderIds(), [USER]);
  /* revokes back on */
  t.now.advance(10 * 60_000);
  const asked = t.client.calls.length;
  await t.engine.resync(USER);
  assert.ok(t.client.calls.length > asked, 'Upgrade.Chat is asked again before the DELETE is re-queued');
  assert.deepEqual([t.outbox().desired, t.outbox().state], [false, 'pending']);
  await t.reconciler.run({ mode: 'apply' });
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [], 'Academy Student and the engine-granted Monarch are both removed');
  assert.equal(monarchDeletes(t).length, 1);
  assert.equal((await t.cli(['external-review'])).out.count, 0);
  assert.deepEqual(await t.store.externalGrantHolderIds(), []);
});

test('a Monarch DELETE that gave up (20 failed attempts) is re-queued once Discord recovers', async () => {
  const t = setup({ fixtures: lifetimePaid() });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  refund(t);
  await t.engine.resync(USER);
  t.force.override = (role, method) => (role === MONARCH && method === 'DELETE' ? { status: 500, body: { message: 'Internal Server Error' } } : null);
  for (let i = 0; i < ROLE_MAX_ATTEMPTS + 2 && t.outbox().state !== 'failed'; i += 1) {
    /* each resync (webhook, due-scan) refreshes the Upgrade.Chat answer; the DELETE keeps failing */
    t.now.advance(2 * 3600_000);
    await t.engine.resync(USER);
    await t.applier.runOnce();
  }
  assert.deepEqual([t.outbox().state, t.ledger().state], ['failed', 'revoked']);
  assert.ok(t.held().includes(MONARCH));
  t.force.override = null;
  t.now.advance(60_000);
  await t.engine.resync(USER);
  await t.reconciler.run({ mode: 'apply' });
  await t.applier.runOnce();
  assert.equal(t.held().includes(MONARCH), false);
});

test('Monarch above the bot: a DELETE that failed on 403 is re-queued after the hierarchy is fixed', async () => {
  let blocked = false;
  const t = setup({ fixtures: lifetimePaid(), discord: (role, method) => (blocked && role === MONARCH && method === 'DELETE'
    ? { status: 403, body: { code: 50013, message: 'Missing Permissions' } } : null) });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  refund(t);
  blocked = true;
  await t.engine.resync(USER);
  for (let i = 0; i < 25 && t.outbox().state !== 'failed'; i += 1) {
    /* each 30-minute retry: a resync refreshes the Upgrade.Chat answer, the DELETE meets the 403 again */
    t.now.advance(31 * 60_000);
    await t.engine.resync(USER);
    await t.applier.runOnce();
  }
  assert.deepEqual([t.outbox().state, t.outbox().last_error], ['failed', 'external_role_forbidden']);
  assert.ok(t.held().includes(MONARCH));
  blocked = false;
  for (let i = 0; i < 3; i += 1) {
    t.now.advance(60 * 60_000);
    await t.engine.resync(USER);
    await t.applier.runOnce();
  }
  assert.equal(t.held().includes(MONARCH), false, `ledger=${t.ledger().state}, outbox=${t.outbox().state}`);
});

test('the applier never sends an external DELETE on an Upgrade.Chat answer older than 10 minutes: it waits and makes the member due', async () => {
  const t = setup({ fixtures: lifetimePaid() });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  refund(t);
  await t.engine.resync(USER);
  t.now.advance(UC_ANSWER_TTL_MS + 1);
  t.store.db.members.get(`${USER}|false`).next_check_at = null;
  const result = await t.applier.runOnce();
  assert.deepEqual(result.counts, { stale: 1, synced: 1 }, 'the Academy DELETE goes; the Monarch DELETE waits');
  assert.equal(monarchDeletes(t).length, 0);
  assert.deepEqual([t.outbox().state, t.outbox().last_error], ['pending', 'uc_answer_stale']);
  assert.equal(t.outbox().next_attempt_at.getTime(), t.now() + UC_STALE_RETRY_MS);
  assert.deepEqual(await t.store.dueMemberIds(null, 25), [USER], 'the due-scan resyncs the member now');
  /* the due-scan's resync asks Upgrade.Chat again: still none, so the DELETE is due at once */
  await t.engine.resync(USER, { actor: 'due_scan' });
  assert.equal(t.ledger().uc_checked_at.getTime(), t.now());
  assert.equal(t.outbox().next_attempt_at, null);
  await t.applier.runOnce();
  assert.equal(monarchDeletes(t).length, 1);
  assert.deepEqual(t.held(), []);
});

test('a DELETE that waited 7 hours is re-checked: a member who paid Upgrade.Chat for Monarch meanwhile keeps it', async () => {
  const t = setup({ fixtures: lifetimePaid() });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  refund(t);
  await t.engine.resync(USER);
  assert.deepEqual([t.ledger().state, t.ledger().uc_result], ['revoked', 'none']);
  t.force.override = (role, method) => (role === MONARCH && method === 'DELETE' ? { status: 403, body: { code: 50013, message: 'Missing Permissions' } } : null);
  await t.applier.runOnce();
  assert.equal(t.outbox().last_error, 'external_role_forbidden');
  /* the member buys Upgrade.Chat Monarch monthly; they still hold the role, so Upgrade.Chat adds nothing */
  t.client.state.subscriptions[USER] = { [UC_MONARCH_MONTHLY]: 'uc-order-new' };
  t.now.advance(3 * 3600_000);
  await t.engine.resync(USER);
  assert.deepEqual([t.ledger().state, t.ledger().uc_result], ['kept_external', 'active']);
  assert.deepEqual([t.outbox().desired, t.outbox().state], [false, 'synced'], 'the DELETE is cancelled');
  t.now.advance(4 * 3600_000);
  t.force.override = null;
  await t.applier.runOnce();
  assert.equal(monarchDeletes(t).length, 0);
  assert.ok(t.held().includes(MONARCH));
});

test('without any resync in between, the applier alone still refuses the old answer; the resync it asks for keeps Monarch', async () => {
  const t = setup({ fixtures: lifetimePaid() });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  refund(t);
  await t.engine.resync(USER);
  t.force.override = (role, method) => (role === MONARCH && method === 'DELETE' ? { status: 403, body: { code: 50013, message: 'Missing Permissions' } } : null);
  await t.applier.runOnce();
  t.client.state.subscriptions[USER] = { [UC_MONARCH_MONTHLY]: 'uc-order-new' };
  t.now.advance(7 * 3600_000);
  t.force.override = null;
  await t.applier.runOnce();
  assert.equal(monarchDeletes(t).length, 0, 'a 7-hour-old "none" is never acted on');
  for (const id of await t.store.dueMemberIds(null, 25)) await t.engine.resync(id, { actor: 'due_scan' });
  await t.applier.runOnce();
  assert.equal(t.ledger().state, 'kept_external');
  assert.equal(monarchDeletes(t).length, 0);
  assert.ok(t.held().includes(MONARCH));
});

test('a member who holds Monarch at a LATER purchase is held again: that refund never removes it', async () => {
  const t = setup();
  /* round 1: a comp gives Monarch, is revoked, Upgrade.Chat none -> the engine removes it */
  t.store.db.comps.push({ id: 1, discord_user_id: USER, livemode: false, include_lifetime_role: false, grants_academy: false,
    external_role_ids: [MONARCH], expires_at: null, revoked_at: null });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  t.store.db.comps[0].revoked_at = new Date(T0);
  t.now.advance(60_000);
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.equal(t.ledger().state, 'revoked');
  assert.deepEqual(t.held(), []);
  /* months later staff hand the member Monarch by hand */
  t.bot.state.members[USER] = [MONARCH];
  const deletesBefore = monarchDeletes(t).length;
  t.now.advance(90 * 86400_000);
  const life = lifetimeOf('life2');
  t.stripe.data.paymentIntents.push(...life.paymentIntents);
  t.stripe.data.charges.push(...life.charges);
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.deepEqual([t.ledger().state, t.ledger().had_role_before, t.ledger().last_reason], ['held', true, 'held_at_new_grant']);
  const change = t.store.db.audit.filter((r) => r.action === 'external_grant_state').pop();
  assert.deepEqual([change.details.from, change.details.to, change.details.hadRoleBefore], ['revoked', 'held', true]);
  refundOf(t, 'life2');
  t.now.advance(60_000);
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.equal(monarchDeletes(t).length, deletesBefore);
  assert.ok(t.held().includes(MONARCH));
});

test('a later purchase after a revoke that DID land, by a member without the role: engine_granted again (removable)', async () => {
  const t = setup({ fixtures: lifetimeOf('a') });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  refundOf(t, 'a');
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.deepEqual([t.ledger().state, t.held()], ['revoked', []]);
  const life = lifetimeOf('b');
  t.stripe.data.paymentIntents.push(...life.paymentIntents);
  t.stripe.data.charges.push(...life.charges);
  t.now.advance(60_000);
  await t.engine.resync(USER);
  assert.deepEqual([t.ledger().state, t.ledger().had_role_before], ['engine_granted', false]);
  await t.applier.runOnce();
  refundOf(t, 'b');
  t.now.advance(60_000);
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), []);
});

test('a revoke whose DELETE never landed is not mistaken for a hand-out: a re-purchase keeps it engine_granted', async () => {
  const t = setup({ fixtures: lifetimeOf('a') });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  refundOf(t, 'a');
  await t.engine.resync(USER);
  assert.deepEqual([t.ledger().state, t.outbox().desired, t.outbox().state], ['revoked', false, 'pending']);
  /* bought again before the DELETE ran: the Monarch on the member is still the engine's own */
  const life = lifetimeOf('b');
  t.stripe.data.paymentIntents.push(...life.paymentIntents);
  t.stripe.data.charges.push(...life.charges);
  await t.engine.resync(USER);
  assert.deepEqual([t.ledger().state, t.ledger().had_role_before], ['engine_granted', false]);
});

test('an applier pass during the Upgrade.Chat check: nothing is decided from the stale read; the next pass removes Monarch', async () => {
  const t = setup({ fixtures: lifetimePaid() });
  await t.engine.resync(USER);                 /* Academy Student + Monarch PUTs queued */
  refund(t);
  const original = t.client.listOrders;
  t.client.listOrders = async (args) => { await t.applier.runOnce(); return original.call(t.client, args); };
  const result = await t.engine.resync(USER);
  t.client.listOrders = original;
  assert.deepEqual(t.held(), [ACADEMY_ROLE, MONARCH].sort(), 'the queued PUTs landed during the check');
  assert.equal(t.ledger().state, 'engine_granted', 'not "revoked, role already removed" from a read the PUT overtook');
  assert.equal(result.deferredRevokes, 2);
  assert.equal(t.store.db.members.get(`${USER}|false`).next_check_at.getTime(), T0 + 5 * 60_000);
  for (let i = 0; i < 3; i += 1) {
    t.now.advance(20 * 60_000);
    await t.engine.resync(USER);
    await t.applier.runOnce();
  }
  assert.equal(t.ledger().state, 'revoked');
  assert.deepEqual(t.held(), []);
});

test('Upgrade.Chat NOT configured: a non-member refunded before joining is never given Monarch (the grant is withdrawn)', async () => {
  const t = setup({ uc: false, members: {}, fixtures: lifetimePaid() });
  await t.engine.resync(USER);
  assert.equal(t.outbox().state, 'awaiting_member');
  refund(t);
  await t.engine.resync(USER);
  assert.equal(t.outbox(USER, ACADEMY_ROLE).desired, false, 'the Academy grant is withdrawn');
  assert.deepEqual([t.outbox().desired, t.outbox().state], [false, 'suppressed'], 'so is Monarch, with no Discord call');
  assert.deepEqual([t.ledger().state, t.ledger().last_reason], ['needs_review', 'uc_not_configured']);
  t.bot.state.members[USER] = [];
  await t.store.kickAwaiting(null, USER);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), []);
  assert.equal(t.sent.some((c) => c[0] === 'PUT'), false);
  /* the next pass settles it: nothing was ever delivered */
  t.now.advance(UC_RECHECK_MS);
  await t.engine.resync(USER);
  assert.deepEqual([t.ledger().state, t.outbox().state], ['revoked', 'synced']);
});

test('an open dispute before joining + an Upgrade.Chat outage: Monarch is withdrawn with the Academy role, never delivered', async () => {
  const client = k.createFakeUc({ error: new Error('Upgrade.Chat orders request failed (503)') });
  const t = setup({ ucClient: client, members: {}, fixtures: { ...lifetimePaid({ disputed: true }), disputes: [] } });
  await t.engine.resync(USER);
  t.stripe.data.disputes.push({ id: 'du_1', charge: 'ch_life', status: 'needs_response' });
  await t.engine.resync(USER);
  assert.equal(t.ledger().state, 'needs_review');
  t.bot.state.members[USER] = [];
  await t.store.kickAwaiting(null, USER);
  await t.applier.runOnce();
  assert.equal(t.held().includes(ACADEMY_ROLE), false);
  assert.equal(t.held().includes(MONARCH), false);
  /* the dispute is won: both are granted again */
  t.stripe.data.disputes[0].status = 'won';
  client.state.error = null;
  t.now.advance(60_000);
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [ACADEMY_ROLE, MONARCH].sort());
  assert.equal(t.ledger().state, 'engine_granted');
});

test('a withdrawn grant whose PUT was already in flight is caught by the next pass', async () => {
  const t = setup({ fixtures: lifetimePaid() });
  await t.engine.resync(USER);                 /* Monarch PUT queued (member in the server) */
  const [claimed] = (await t.store.claimRoleRows(20, 120)).filter((r) => r.role_id === MONARCH);
  refund(t);
  t.client.state.error = new Error('Upgrade.Chat down');
  await t.engine.resync(USER);                 /* inconclusive: the undelivered PUT is withdrawn */
  assert.deepEqual([t.outbox().desired, t.outbox().state, t.ledger().state], [false, 'suppressed', 'needs_review']);
  /* ... but the claimed PUT reaches Discord anyway; its finish loses the compare-and-set */
  t.bot.state.members[USER] = [...t.held(), MONARCH];
  assert.equal(await t.store.finishRoleRow(null, { discordId: USER, roleId: MONARCH, generation: claimed.generation, state: 'synced' }), 0);
  t.client.state.error = null;
  t.now.advance(UC_RECHECK_MS);
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.equal(t.ledger().state, 'revoked');
  assert.equal(t.held().includes(MONARCH), false);
});

test('a Lifetime buyer who leaves and rejoins gets both roles back within a day, even with the reconciler in dry_run (stage C)', async () => {
  const t = setup({ fixtures: lifetimePaid() });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [ACADEMY_ROLE, MONARCH].sort());
  assert.equal(t.store.db.members.get(`${USER}|false`).next_check_at.getTime(), T0 + ENTITLED_RECHECK_MS, 'a lifetime is re-read daily');
  delete t.bot.state.members[USER];
  t.now.advance(60_000);
  t.bot.state.members[USER] = [];
  assert.equal(await t.store.kickAwaiting(null, USER), 0, 'nothing was waiting: the rows are synced');
  await t.reconciler.run({ mode: 'dry_run' });
  t.now.advance(ENTITLED_RECHECK_MS);
  const due = await t.store.dueMemberIds(null, 25);
  assert.deepEqual(due, [USER]);
  for (const id of due) await t.engine.resync(id, { actor: 'due_scan' });
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [ACADEMY_ROLE, MONARCH].sort());
  assert.deepEqual([t.ledger().state, t.ledger().had_role_before], ['engine_granted', false]);
});

test('a grant that gave up while the member was away (member_absent_90d) is queued again when they are seen', async () => {
  const t = setup({ members: {}, fixtures: lifetimePaid() });
  await t.engine.resync(USER);
  for (const row of t.store.db.roles.values()) { row.state = 'failed'; row.last_error = 'member_absent_90d'; row.attempts = 20; }
  t.bot.state.members[USER] = [];
  assert.equal(await t.store.kickAwaiting(null, USER), 2);
  assert.deepEqual([t.outbox().state, t.outbox().attempts], ['pending', 0]);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [ACADEMY_ROLE, MONARCH].sort());
  /* any other failure is not revived by a join */
  const other = setup({ fixtures: lifetimePaid() });
  await other.engine.resync(USER);
  for (const row of other.store.db.roles.values()) { row.state = 'failed'; row.last_error = 'max_attempts'; }
  assert.equal(await other.store.kickAwaiting(null, USER), 0);
});

test('a had_role_before role removed by hand settles its needs_review row (released): off the review list, no 6-hour re-reads', async () => {
  const t = setup({ members: { [USER]: [MONARCH] }, fixtures: lifetimePaid() });
  await t.engine.resync(USER);
  assert.equal(t.ledger().state, 'held');
  /* Upgrade.Chat's own sync drops Monarch while the Lifetime still entitles it: the engine puts it back */
  t.bot.state.members[USER] = [ACADEMY_ROLE];
  t.now.advance(60_000);
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.deepEqual([t.ledger().state, t.ledger().had_role_before], ['engine_granted', true]);
  refund(t);
  t.now.advance(60_000);
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.deepEqual([t.ledger().state, t.ledger().last_reason, t.ledger().uc_result], ['needs_review', 'had_role_before_first_grant', 'none']);
  assert.ok(t.held().includes(MONARCH), 'never removed automatically');
  assert.equal((await t.cli(['external-review'])).out.count, 1);
  /* staff follow the hint: remove Monarch by hand */
  t.bot.state.members[USER] = t.held().filter((r) => r !== MONARCH);
  t.now.advance(7 * 3600_000);
  await t.engine.resync(USER);
  assert.deepEqual([t.ledger().state, t.ledger().last_reason], ['released', 'role_absent']);
  const listed = await t.cli(['external-review']);
  assert.equal(listed.out.count, 0, JSON.stringify(listed.out.rows));
  assert.equal(t.store.db.members.get(`${USER}|false`).next_check_at, null, 'no endless 6-hour resync for a settled row');
  /* bought again later without the role: the engine grants it (removable again) */
  const life = lifetimeOf('again');
  t.stripe.data.paymentIntents.push(...life.paymentIntents);
  t.stripe.data.charges.push(...life.charges);
  await t.engine.resync(USER);
  assert.deepEqual([t.ledger().state, t.ledger().had_role_before], ['engine_granted', false]);
});

test('a had_role_before role whose member pays Upgrade.Chat: kept_external when the engine entitlement ends (not staff review)', async () => {
  const t = setup({ members: { [USER]: [MONARCH] }, fixtures: lifetimePaid() });
  await t.engine.resync(USER);
  t.bot.state.members[USER] = [];
  t.now.advance(60_000);
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.deepEqual([t.ledger().state, t.ledger().had_role_before], ['engine_granted', true]);
  t.client.state.subscriptions[USER] = { [UC_MONARCH_MONTHLY]: 'uc-order-7' };
  refund(t);
  t.now.advance(60_000);
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.deepEqual([t.ledger().state, t.ledger().uc_result], ['kept_external', 'active']);
  assert.ok(t.held().includes(MONARCH));
  assert.equal(monarchDeletes(t).length, 0);
});

test('external-review --keep settles one needs_review row as kept_external (dry run first, audited, never removed)', async () => {
  const t = setup({ uc: false, fixtures: lifetimePaid() });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  refund(t);
  await t.engine.resync(USER);
  assert.equal(t.ledger().state, 'needs_review');
  const dry = await t.cli(['external-review', '--keep', '--discord', USER, '--role', MONARCH, '--reason', 'staff gift']);
  assert.deepEqual(dry.out, { ok: true, apply: false, wouldKeep: { discordId: USER, roleId: MONARCH } });
  assert.equal(t.ledger().state, 'needs_review');
  await assert.rejects(() => t.cli(['external-review', '--keep', '--discord', USER, '--role', MONARCH, '--apply', '--actor', 'owner']), /--reason/);
  const kept = await t.cli(['external-review', '--keep', '--discord', USER, '--role', MONARCH, '--reason', 'staff gift', '--apply', '--actor', 'owner']);
  assert.deepEqual(kept.out, { ok: true, apply: true, kept: { discordId: USER, roleId: MONARCH } });
  assert.deepEqual([t.ledger().state, t.ledger().last_reason], ['kept_external', 'kept_by_staff']);
  const row = t.store.db.audit.filter((r) => r.action === 'external_grant_state').pop();
  assert.deepEqual([row.actor, row.reason, row.details.to], ['cli:owner', 'staff gift', 'kept_external']);
  assert.equal((await t.cli(['external-review'])).out.count, 0);
  await assert.rejects(() => t.cli(['external-review', '--keep', '--discord', USER, '--role', MONARCH, '--reason', 'again', '--apply', '--actor', 'owner']), /needs_review row only/);
  t.now.advance(UC_RECHECK_MS);
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.ok(t.held().includes(MONARCH));
  assert.equal(t.ledger().state, 'kept_external');
});
