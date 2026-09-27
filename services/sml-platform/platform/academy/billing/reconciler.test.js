'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createReconciler } = require('./reconciler');
const { createResync } = require('./resync');
const { createCatalog } = require('./catalog');
const k = require('./testkit');

const { USER, USER2, USER3, ACADEMY_ROLE, LIFETIME_ROLE, T0, S } = k;

function setup({ fixtures = {}, members = {}, overrides = {}, auditAdds = [], spy = false } = {}) {
  const now = k.clock();
  const config = k.config(overrides);
  const store = k.createFakeStore({ now });
  const stripe = k.createFakeStripe(fixtures);
  const bot = k.createFakeBot({ members, auditAdds });
  const catalog = createCatalog({ config, stripeApi: stripe, now });
  const core = createResync({ config, store, stripeApi: stripe, catalog, bot, now });
  const resyncs = [];
  const resync = async (id, opts) => { resyncs.push([id, opts]); return spy ? { roles: [], ops: [], stale: false } : core.resync(id, opts); };
  const logs = [];
  const reconciler = createReconciler({ config, store, stripeApi: stripe, bot, resync, preflight: { ok: () => true }, now,
    logger: (level, event, fields) => logs.push({ level, event, fields }) });
  return { now, config, store, stripe, bot, reconciler, resyncs, logs };
}

const sub = (id, customer, extra = {}) => k.subscription({ id, customer, ...extra });
const paidInvoice = (subId, chargeId) => k.invoice({ id: `in_${chargeId}`, subscription: subId, charge: chargeId });

test('Stripe lists discover candidates across prices x statuses; every decision is a resync', async () => {
  const t = setup({ spy: true, fixtures: {
    customers: { cus_a: k.academyCustomer('cus_a', USER), cus_b: k.academyCustomer('cus_b', USER2) },
    subscriptions: [sub('sub_a', 'cus_a'), sub('sub_b', 'cus_b', { status: 'past_due', price: 'price_year1' })]
  } });
  k.bindMember(t.store, USER, 'cus_a');
  const summary = await t.reconciler.run({ mode: 'apply' });
  const statuses = new Set(t.stripe.callsOf('listSubscriptionsByPrice').map((c) => c.args[1]));
  assert.deepEqual([...statuses].sort(), ['active', 'past_due', 'trialing']);
  assert.ok(t.stripe.callsOf('listSubscriptionsByPrice').some((c) => c.args[0] === 'price_monthold'), 'retired prices are listed too');
  assert.equal(t.stripe.callsOf('listSubscriptionsByPrice').some((c) => c.args[0] === 'price_life1'), false);
  assert.deepEqual(t.resyncs.map((r) => r[0]).sort(), [USER, USER2]);
  assert.equal(summary.stripeComplete, true);
  /* the missing binding was rebuilt from Customer.metadata */
  assert.equal(t.store.db.members.get(`${USER2}|false`).stripe_customer_id, 'cus_b');
  assert.ok(k.actions(t.store).includes('reconcile_rebuilt_from_stripe'));
});

test('a subscription on a customer without our metadata is an orphan, never a grant', async () => {
  const t = setup({ spy: true, fixtures: {
    customers: { cus_x: { id: 'cus_x', livemode: false, metadata: { sml_kind: 'mem_academy' } } },
    subscriptions: [sub('sub_x', 'cus_x')]
  } });
  const summary = await t.reconciler.run({ mode: 'apply' });
  assert.equal(summary.orphans, 1);
  assert.equal(t.resyncs.length, 0);
  assert.ok(t.logs.some((l) => l.event === 'academy_billing_orphan_customer'));
});

test('grants for a refunded, a disputed and a grace-expired subscription are zero', async () => {
  const t = setup({ members: { [USER]: [], [USER2]: [], [USER3]: [] }, fixtures: {
    customers: { cus_r: k.academyCustomer('cus_r', USER), cus_d: k.academyCustomer('cus_d', USER2), cus_g: k.academyCustomer('cus_g', USER3) },
    subscriptions: [sub('sub_r', 'cus_r'), sub('sub_d', 'cus_d'), sub('sub_g', 'cus_g', { status: 'past_due', price: 'price_daily1', periodStart: S(T0) - 3 * 3600 })],
    invoices: [paidInvoice('sub_r', 'ch_r'), paidInvoice('sub_d', 'ch_d'), paidInvoice('sub_g', 'ch_g')],
    charges: [k.charge({ id: 'ch_r', customer: 'cus_r', refunded: true, amountRefunded: 2999 }), k.charge({ id: 'ch_d', customer: 'cus_d', disputed: true }),
      k.charge({ id: 'ch_g', customer: 'cus_g' })],
    disputes: [{ id: 'du_1', charge: 'ch_d', status: 'needs_response' }]
  } });
  k.bindMember(t.store, USER, 'cus_r');
  k.bindMember(t.store, USER2, 'cus_d');
  k.bindMember(t.store, USER3, 'cus_g');
  const summary = await t.reconciler.run({ mode: 'apply' });
  assert.equal(summary.plannedGrants, 0);
  assert.equal(t.store.db.roles.size, 0);
});

test('a bound revoke candidate goes to a per-customer resync, never a direct DELETE', async () => {
  const t = setup({ members: { [USER]: [ACADEMY_ROLE] }, fixtures: {
    customers: { cus_a: k.academyCustomer('cus_a', USER) }, subscriptions: [sub('sub_a', 'cus_a', { status: 'canceled' })] } });
  k.bindMember(t.store, USER, 'cus_a');
  const summary = await t.reconciler.run({ mode: 'apply' });
  assert.deepEqual(t.resyncs.map((r) => r[0]), [USER]);
  assert.equal(t.resyncs[0][1].allowRevokes, true);
  assert.equal(summary.plannedRevokes, 1);
  const row = [...t.store.db.roles.values()][0];
  assert.deepEqual([row.desired, row.state], [false, 'pending']);
});

test('an unbound manual holder is revoked (audited) in apply mode, under the cap', async () => {
  const t = setup({ members: { [USER3]: [ACADEMY_ROLE] } });
  await t.store.insertRoleRow(null, { discordId: USER3, roleId: ACADEMY_ROLE, roleKey: 'academy', desired: true, state: 'synced' });
  const summary = await t.reconciler.run({ mode: 'apply' });
  assert.equal(summary.orphans, 1);
  assert.ok(k.actions(t.store).includes('reconcile_orphan_revoke'));
  const row = [...t.store.db.roles.values()][0];
  assert.deepEqual([row.desired, row.state], [false, 'pending']);
});

test('an unbound holder with a purchase found by Stripe Search is rebuilt, not revoked', async () => {
  const t = setup({ members: { [USER3]: [ACADEMY_ROLE] }, fixtures: {
    customers: { cus_hidden: k.academyCustomer('cus_hidden', USER3) }, subscriptions: [sub('sub_h', 'cus_hidden', { price: 'price_promo1' })],
    invoices: [paidInvoice('sub_h', 'ch_h')], charges: [k.charge({ id: 'ch_h', customer: 'cus_hidden' })] } });
  t.stripe.data.subscriptions[0].metadata = {};
  t.stripe.data.prices.price_promo1 = { ...k.stripePrice('price_promo1'), recurring: { interval: 'month', interval_count: 1 } };
  await t.store.insertRoleRow(null, { discordId: USER3, roleId: ACADEMY_ROLE, roleKey: 'academy', desired: true, state: 'synced' });
  const summary = await t.reconciler.run({ mode: 'apply' });
  assert.equal(t.store.db.members.get(`${USER3}|false`).stripe_customer_id, 'cus_hidden');
  assert.equal(summary.orphans, 0);
  assert.equal(k.actions(t.store).includes('reconcile_orphan_revoke'), false);
  assert.deepEqual([...t.store.db.roles.values()].map((r) => [r.desired, r.state]), [[true, 'synced']]);
});

test('a Stripe 500 on a list page -> grants only (revokes braked, cannot be forced)', async () => {
  const t = setup({ members: { [USER]: [], [USER2]: [ACADEMY_ROLE] }, fixtures: {
    customers: { cus_a: k.academyCustomer('cus_a', USER), cus_b: k.academyCustomer('cus_b', USER2) },
    subscriptions: [sub('sub_a', 'cus_a'), sub('sub_b', 'cus_b', { status: 'canceled' })], invoices: [paidInvoice('sub_a', 'ch_a')],
    charges: [k.charge({ id: 'ch_a', customer: 'cus_a' })] } });
  k.bindMember(t.store, USER, 'cus_a');
  k.bindMember(t.store, USER2, 'cus_b');
  t.stripe.fail('searchLifetimePaymentIntents');
  const summary = await t.reconciler.run({ mode: 'apply', forceBreaker: true });
  assert.equal(summary.stripeComplete, false);
  assert.equal(summary.brake, 'stripe_incomplete');
  assert.ok(k.actions(t.store).includes('reconcile_brake'));
  const roles = [...t.store.db.roles.values()].map((r) => [r.discord_user_id, r.desired]);
  assert.deepEqual(roles, [[USER, true]]);
});

test('the revoke cap brakes a run; --force-breaker lifts it', async () => {
  const holders = {};
  for (let i = 0; i < 3; i += 1) holders[`30000000000000010${i}`] = [ACADEMY_ROLE];
  const t = setup({ members: holders, overrides: { SML_ACADEMY_BILLING_MAX_REVOKES_PER_RUN: '2' } });
  for (const id of Object.keys(holders)) await t.store.insertRoleRow(null, { discordId: id, roleId: ACADEMY_ROLE, roleKey: 'academy', desired: true, state: 'synced' });
  const braked = await t.reconciler.run({ mode: 'apply' });
  assert.equal(braked.brake, 'revoke_cap');
  assert.ok([...t.store.db.roles.values()].every((r) => r.desired));
  t.now.advance(3600_000);
  const forced = await t.reconciler.run({ mode: 'apply', forceBreaker: true });
  assert.equal(forced.brake, null);
  assert.ok([...t.store.db.roles.values()].every((r) => !r.desired && r.state === 'pending'));
});

test('known_ids discovers a manual role add from the Discord audit log and stores the cursor', async () => {
  const t = setup({ members: { [USER3]: [LIFETIME_ROLE] }, auditAdds: [{ id: '1900000000000000005', targetId: USER3, roleIds: [LIFETIME_ROLE] }] });
  const summary = await t.reconciler.run({ mode: 'dry_run' });
  assert.equal(summary.holdersSeen, 1);
  assert.equal(summary.auditLogCursor, '1900000000000000005');
  assert.equal(t.store.db.runs[0].audit_log_cursor, '1900000000000000005');
  t.now.advance(3600_000);
  await t.reconciler.run({ mode: 'dry_run' });
  assert.deepEqual(t.bot.state.calls.filter((c) => c[0] === 'auditLogRoleAdds').map((c) => c[1]), [null, '1900000000000000005']);
});

test('members scope pages the member list; a 403 falls back to known_ids', async () => {
  const t = setup({ members: { [USER]: [ACADEMY_ROLE], [USER2]: [] }, overrides: { SML_ACADEMY_BILLING_RECONCILE_SCAN: 'members' } });
  const summary = await t.reconciler.run({ mode: 'dry_run' });
  assert.equal(summary.holdersSeen, 1);
  assert.deepEqual(t.bot.state.calls.filter((c) => c[0] === 'listMembers').map((c) => c[1]), ['0']);
  const f = setup({ members: { [USER]: [ACADEMY_ROLE] }, overrides: { SML_ACADEMY_BILLING_RECONCILE_SCAN: 'members' } });
  f.bot.state.listMembersError = k.discordError('forbidden', 403, 50001);
  await f.store.insertRoleRow(null, { discordId: USER, roleId: ACADEMY_ROLE, roleKey: 'academy', desired: true, state: 'synced' });
  const fallback = await f.reconciler.run({ mode: 'dry_run' });
  assert.equal(fallback.holdersSeen, 1);
  assert.ok(f.logs.some((l) => l.event === 'academy_billing_members_scan_unavailable'));
});

test('overlapping runs are refused', async () => {
  const t = setup();
  t.store.db.runs.push({ run_id: 'other', livemode: false, started_at: T0 - 60_000, finished_at: null });
  assert.deepEqual(await t.reconciler.run({ mode: 'apply' }), { skipped: 'overlap' });
});

test('dry_run writes only the run row and audit rows', async () => {
  const t = setup({ members: { [USER]: [], [USER3]: [ACADEMY_ROLE] }, fixtures: {
    customers: { cus_a: k.academyCustomer('cus_a', USER), cus_n: k.academyCustomer('cus_n', USER2) },
    subscriptions: [sub('sub_a', 'cus_a'), sub('sub_n', 'cus_n')], invoices: [paidInvoice('sub_a', 'ch_a')], charges: [k.charge({ id: 'ch_a', customer: 'cus_a' })] } });
  k.bindMember(t.store, USER, 'cus_a');
  await t.store.insertRoleRow(null, { discordId: USER3, roleId: ACADEMY_ROLE, roleKey: 'academy', desired: true, state: 'synced' });
  const rolesBefore = JSON.stringify([...t.store.db.roles.values()]);
  const membersBefore = t.store.db.members.size;
  const summary = await t.reconciler.run({ mode: 'dry_run' });
  assert.equal(JSON.stringify([...t.store.db.roles.values()]), rolesBefore);
  assert.equal(t.store.db.members.size, membersBefore);
  assert.equal(t.store.db.runs.length, 1);
  assert.equal(summary.plannedGrants, 1);
  assert.equal(summary.plannedRevokes, 1);
  assert.equal(summary.appliedGrants + summary.appliedRevokes, 0);
  assert.ok(t.store.db.audit.every((r) => ['dry_run', 'noop'].includes(r.outcome)));
  assert.ok(k.actions(t.store).includes('reconcile_rebuilt_from_stripe'));
  assert.equal(t.stripe.writes().length, 0);
});

test('the reconciler never lists the bot or an active comp holder as a revoke candidate', async () => {
  const t = setup({ spy: true, members: { [k.APP]: [ACADEMY_ROLE], [USER]: [ACADEMY_ROLE] } });
  t.store.db.comps.push({ id: 1, discord_user_id: USER, livemode: false, include_lifetime_role: false, expires_at: null, revoked_at: null });
  await t.store.insertRoleRow(null, { discordId: k.APP, roleId: ACADEMY_ROLE, roleKey: 'academy', desired: true, state: 'synced' });
  await t.reconciler.run({ mode: 'apply' });
  assert.deepEqual(t.resyncs.map((r) => r[0]), [USER]);
});

test('a tripped reconcile brake is not silently undone by the due-scan (needs reconcile --force-breaker)', async () => {
  const ids = Array.from({ length: 12 }, (_, i) => String(300000000000000100n + BigInt(i)));
  const customers = {};
  const subscriptions = [];
  const members = {};
  for (const [i, id] of ids.entries()) {
    const cus = `cus_brake${i}`;
    customers[cus] = k.academyCustomer(cus, id);
    subscriptions.push(k.subscription({ id: `sub_brake${i}`, customer: cus, status: 'canceled' }));
    members[id] = [ACADEMY_ROLE];
  }
  const now = k.clock();
  const config = k.config({ SML_ACADEMY_BILLING_MAX_REVOKES_PER_RUN: '10' });
  const store = k.createFakeStore({ now });
  const stripe = k.createFakeStripe({ customers, subscriptions });
  const bot = k.createFakeBot({ members });
  const core = createResync({ config, store, stripeApi: stripe, catalog: createCatalog({ config, stripeApi: stripe, now }), bot, now });
  for (const [i, id] of ids.entries()) k.bindMember(store, id, `cus_brake${i}`);
  const reconciler = createReconciler({ config, store, stripeApi: stripe, bot, resync: (id, opts) => core.resync(id, opts), preflight: { ok: () => true }, now });

  const summary = await reconciler.run({ mode: 'apply' });
  assert.equal(summary.brake, 'revoke_cap', 'fixture: 12 revoke candidates > cap 10 trips the brake');
  const pendingRevokes = () => [...store.db.roles.values()].filter((r) => r.desired === false && r.state === 'pending').length;
  assert.equal(pendingRevokes(), 0, 'fixture: the braked run queued no revoke');

  /* index.js dueScan(), 5+ minutes later */
  now.advance(6 * 60_000);
  assert.deepEqual(await store.dueMemberIds(null, 25), []);
  for (const id of await store.dueMemberIds(null, 25)) await core.resync(id, { actor: 'due_scan' });
  assert.equal(pendingRevokes(), 0, `the braked revokes were re-scheduled and the due-scan queued ${pendingRevokes()} of them with no --force-breaker`);

  /* the operator lifts the cap explicitly */
  now.advance(31 * 60_000);
  const forced = await reconciler.run({ mode: 'apply', forceBreaker: true });
  assert.equal(forced.brake, null);
  assert.equal(pendingRevokes(), 12);
});
