'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createResync, ENTITLED_RECHECK_MS, autoStopPlan, missedFreeTrialStop, freeTrialCheckTimes, TRIAL_STOP_MARGIN_SEC, FREE_TRIAL_RECHECK_SEC } = require('./resync');
const { createCatalog } = require('./catalog');
const k = require('./testkit');

const { USER, ACADEMY_ROLE, LIFETIME_ROLE, T0, S } = k;
const CUS = 'cus_academy1';

function setup({ members = {}, fixtures = {}, overrides = {}, bind = true, memberExtra = {} } = {}) {
  const now = k.clock();
  const config = k.config(overrides);
  const store = k.createFakeStore({ now });
  const stripe = k.createFakeStripe({ customers: { [CUS]: k.academyCustomer(CUS, USER) }, ...fixtures });
  const bot = k.createFakeBot({ members });
  const catalog = createCatalog({ config, stripeApi: stripe, now });
  let kicks = 0;
  const engine = createResync({ config, store, stripeApi: stripe, catalog, bot, now, kickApplier: () => { kicks += 1; }, stripeWritesAllowed: () => true });
  if (bind) k.bindMember(store, USER, CUS, memberExtra);
  return { now, config, store, stripe, bot, engine, kicks: () => kicks };
}

const rows = (store) => [...store.db.roles.values()].map((r) => ({ key: r.role_key, desired: r.desired, state: r.state, generation: r.generation }))
  .sort((a, b) => a.key.localeCompare(b.key));

const monthly = (extra = {}) => k.subscription({ id: 'sub_m', customer: CUS, ...extra });
const paid = (subId = 'sub_m', chargeId = 'ch_cur', extra = {}) => [k.invoice({ id: `in_${chargeId}`, subscription: subId, charge: chargeId, ...extra })];

test('ROLE_MODE=dry_run audits the plan and queues nothing', async () => {
  const t = setup({ members: { [USER]: [] }, overrides: { SML_ACADEMY_BILLING_ROLE_MODE: 'dry_run' },
    fixtures: { subscriptions: [monthly()], invoices: paid(), charges: [k.charge({ id: 'ch_cur', customer: CUS })] } });
  const result = await t.engine.resync(USER);
  assert.deepEqual(result.roles, ['academy']);
  assert.equal(result.dryRun, true);
  assert.equal(t.store.db.roles.size, 0);
  assert.equal(t.kicks(), 0);
  const plan = t.store.db.audit.filter((r) => r.action === 'role_desired_changed');
  assert.deepEqual(plan.map((r) => [r.role_key, r.outcome]), [['academy', 'dry_run']]);
  assert.equal(t.stripe.writes().length, 0);
});

test('an explicit dry run writes audit rows only (no cache, no Stripe writes)', async () => {
  const t = setup({ members: { [USER]: [] }, fixtures: { subscriptions: [monthly({ price: 'price_daily1' })], invoices: paid(), charges: [k.charge({ id: 'ch_cur', customer: CUS })] } });
  await t.engine.resync(USER, { dryRun: true, actor: 'cli:dry-run' });
  assert.equal(t.store.db.roles.size, 0);
  assert.deepEqual(t.store.db.members.get(`${USER}|false`).last_access, {});
  assert.equal(t.stripe.writes().length, 0);
  assert.ok(t.store.db.audit.every((r) => r.outcome === 'dry_run'));
});

test('enforce: an entitled member without the role gets exactly one pending grant', async () => {
  const t = setup({ members: { [USER]: [k.MONARCH] }, fixtures: { subscriptions: [monthly()], invoices: paid(), charges: [k.charge({ id: 'ch_cur', customer: CUS })] } });
  const result = await t.engine.resync(USER);
  assert.deepEqual(rows(t.store), [{ key: 'academy', desired: true, state: 'pending', generation: 1 }]);
  assert.equal(result.queued, 1);
  assert.equal(t.kicks(), 1);
  assert.deepEqual(k.actions(t.store), ['access_changed', 'role_desired_changed']);
  const member = t.store.db.members.get(`${USER}|false`);
  assert.deepEqual(member.last_access.roles, ['academy']);
  /* the period ends in 29 days (+2 h), but a member with access is re-read daily */
  assert.ok((S(T0) + 29 * 86400) * 1000 + 2 * 3600_000 > T0 + ENTITLED_RECHECK_MS);
  assert.equal(member.next_check_at.getTime(), T0 + ENTITLED_RECHECK_MS);
});

test('a member who already holds the role: no queue, and a renewal is a silent no-op', async () => {
  const t = setup({ members: { [USER]: [ACADEMY_ROLE] }, fixtures: { subscriptions: [monthly()], invoices: paid(), charges: [k.charge({ id: 'ch_cur', customer: CUS })] } });
  await t.engine.resync(USER);
  assert.deepEqual(rows(t.store), [{ key: 'academy', desired: true, state: 'synced', generation: 1 }]);
  assert.equal(t.kicks(), 0);
  const audited = t.store.db.audit.length;
  await t.engine.resync(USER);
  assert.equal(t.store.db.audit.length, audited);
});

test('lifetime grants both roles', async () => {
  const t = setup({ members: { [USER]: [] }, fixtures: { paymentIntents: [k.lifetimePi({ id: 'pi_life', customer: CUS, latestCharge: 'ch_life' })],
    charges: [k.charge({ id: 'ch_life', customer: CUS, amount: 129999, paymentIntent: 'pi_life' })] } });
  const result = await t.engine.resync(USER);
  assert.deepEqual(result.roles, ['academy', 'mem_lifetime']);
  assert.deepEqual(rows(t.store).map((r) => [r.key, r.desired, r.state]), [['academy', true, 'pending'], ['mem_lifetime', true, 'pending']]);
  const cached = t.store.db.lifetime.get('pi_life');
  assert.deepEqual([cached.stripe_state, cached.latest_charge_id, cached.stripe_price_id], ['paid', 'ch_life', 'price_life1']);
});

test('with REVOKES off a revoke is recorded as suppressed, never queued', async () => {
  const t = setup({ members: { [USER]: [ACADEMY_ROLE] }, overrides: { SML_ACADEMY_BILLING_REVOKES_ENABLED: '0' },
    fixtures: { subscriptions: [monthly({ status: 'canceled' })] } });
  await t.engine.resync(USER);
  assert.deepEqual(rows(t.store), [{ key: 'academy', desired: false, state: 'suppressed', generation: 1 }]);
  assert.ok(k.actions(t.store).includes('role_suppressed'));
  assert.equal(t.kicks(), 0);
});

test('a canceled plan with revokes on queues one revoke', async () => {
  const t = setup({ members: { [USER]: [ACADEMY_ROLE] }, fixtures: { subscriptions: [monthly({ status: 'canceled' })] } });
  await t.engine.resync(USER);
  assert.deepEqual(rows(t.store), [{ key: 'academy', desired: false, state: 'pending', generation: 1 }]);
  const change = t.store.db.audit.find((r) => r.action === 'role_desired_changed');
  assert.equal(change.reason, 'sub_ended');
});

test('Customer metadata that differs from the binding: no Stripe grant, binding_conflict, no revoke', async () => {
  const t = setup({ members: { [USER]: [] }, fixtures: { subscriptions: [monthly()], invoices: paid(), charges: [k.charge({ id: 'ch_cur', customer: CUS })] } });
  t.stripe.data.customers[CUS].metadata.mem_academy_discord_user = k.USER2;
  const result = await t.engine.resync(USER);
  assert.deepEqual(result.roles, []);
  assert.equal(result.bindingConflict, 'metadata_discord_mismatch');
  assert.equal(t.store.db.roles.size, 0);
  assert.ok(k.actions(t.store).includes('binding_conflict'));
  const holder = setup({ members: { [USER]: [ACADEMY_ROLE] }, fixtures: { subscriptions: [monthly({ status: 'canceled' })] } });
  holder.stripe.data.customers[CUS].metadata.mem_academy_discord_user = k.USER2;
  const kept = await holder.engine.resync(USER);
  assert.equal(kept.deferredRevokes, 1);
  assert.equal(holder.store.db.roles.size, 0);
});

test('a Stripe failure mid-snapshot allows grants but defers revokes (fail closed)', async () => {
  const grant = setup({ members: { [USER]: [] }, fixtures: { subscriptions: [monthly()], invoices: paid(), charges: [k.charge({ id: 'ch_cur', customer: CUS })] } });
  grant.stripe.fail('listCharges');
  const r1 = await grant.engine.resync(USER);
  assert.equal(r1.complete, false);
  assert.deepEqual(rows(grant.store).map((r) => r.state), ['pending']);
  const holder = setup({ members: { [USER]: [ACADEMY_ROLE] }, fixtures: { subscriptions: [monthly({ status: 'canceled' })] } });
  holder.stripe.fail('listPaymentIntents');
  const r2 = await holder.engine.resync(USER);
  assert.equal(r2.deferredRevokes, 1);
  assert.equal(holder.store.db.roles.size, 0);
  const member = holder.store.db.members.get(`${USER}|false`);
  assert.equal(member.next_check_at.getTime(), T0 + 5 * 60_000);
});

test('a truncated list (page cap) is an incomplete snapshot too', async () => {
  const t = setup({ members: { [USER]: [ACADEMY_ROLE] }, fixtures: { subscriptions: [monthly({ status: 'canceled' })], truncated: ['listPaymentIntents'] } });
  const result = await t.engine.resync(USER);
  assert.equal(result.complete, false);
  assert.equal(result.deferredRevokes, 1);
});

test('a lifetime PaymentIntent among hundreds of renewal intents is found', async () => {
  const intents = [];
  for (let i = 0; i < 300; i += 1) intents.push({ id: `pi_renew${i}`, customer: CUS, status: 'succeeded', metadata: {} });
  intents.splice(150, 0, k.lifetimePi({ id: 'pi_life', customer: CUS, latestCharge: 'ch_life' }));
  const t = setup({ members: { [USER]: [] }, fixtures: { paymentIntents: intents, charges: [k.charge({ id: 'ch_life', customer: CUS, paymentIntent: 'pi_life' })] } });
  assert.deepEqual((await t.engine.resync(USER)).roles, ['academy', 'mem_lifetime']);
});

test('a cached lifetime missing from the list is fetched by id', async () => {
  const t = setup({ members: { [USER]: [] }, fixtures: { charges: [k.charge({ id: 'ch_life', customer: CUS, paymentIntent: 'pi_cached' })] } });
  t.stripe.data.paymentIntents.push({ ...k.lifetimePi({ id: 'pi_cached', customer: 'cus_elsewhere', latestCharge: 'ch_life' }) });
  t.store.db.lifetime.set('pi_cached', { payment_intent_id: 'pi_cached', livemode: false, discord_user_id: USER, stripe_customer_id: CUS, stripe_state: 'paid' });
  assert.deepEqual((await t.engine.resync(USER)).roles, ['academy', 'mem_lifetime']);
  assert.equal(t.stripe.callsOf('retrievePaymentIntent').length, 1);
});

test('a dispute on an OLDER renewal charge suspends access', async () => {
  const t = setup({ members: { [USER]: [ACADEMY_ROLE] }, fixtures: {
    subscriptions: [monthly()], invoices: [...paid(), k.invoice({ id: 'in_old', subscription: 'sub_m', charge: 'ch_old', created: S(T0) - 40 * 86400 })],
    charges: [k.charge({ id: 'ch_cur', customer: CUS }), k.charge({ id: 'ch_old', customer: CUS, disputed: true, invoiceId: 'in_old', created: S(T0) - 40 * 86400 })],
    disputes: [{ id: 'du_1', charge: 'ch_old', status: 'needs_response' }]
  } });
  const result = await t.engine.resync(USER);
  assert.deepEqual(result.roles, []);
  assert.ok(result.reasons.includes('dispute_open'));
  assert.deepEqual(rows(t.store).map((r) => [r.desired, r.state]), [[false, 'pending']]);
});

test('a deleted customer is definitive for subscriptions; comps still grant', async () => {
  const t = setup({ members: { [USER]: [ACADEMY_ROLE] }, fixtures: { subscriptions: [monthly()] } });
  delete t.stripe.data.customers[CUS];
  const result = await t.engine.resync(USER);
  assert.equal(result.complete, true);
  assert.deepEqual(result.roles, []);
  assert.deepEqual(rows(t.store).map((r) => r.desired), [false]);
  t.store.db.comps.push({ id: 1, discord_user_id: USER, livemode: false, include_lifetime_role: false, expires_at: null, revoked_at: null });
  assert.deepEqual((await t.engine.resync(USER)).roles, ['academy']);
});

test('a member lookup that is not 200 or Unknown Member skips the role part, keeps the Stripe part, and rethrows', async () => {
  for (const error of [k.discordError('server', 502, null), k.discordError('rate_limited', 429, null), k.discordError('unknown_guild', 404, 10004)]) {
    const t = setup({ members: { [USER]: [] }, fixtures: { subscriptions: [monthly()], invoices: paid(), charges: [k.charge({ id: 'ch_cur', customer: CUS })] } });
    t.bot.state.failMember.set(USER, error);
    await assert.rejects(() => t.engine.resync(USER), (thrown) => thrown === error);
    assert.equal(t.store.db.roles.size, 0, 'no role intent from an unknown observation');
    assert.deepEqual(k.actions(t.store), ['access_changed']);
    const member = t.store.db.members.get(`${USER}|false`);
    assert.deepEqual(member.last_access.roles, ['academy']);
    assert.equal(member.last_access.rolesQueued, false);
    assert.equal(member.next_check_at.getTime(), T0 + 5 * 60_000, 'the role part is retried in five minutes');
    /* Discord is back: the retry queues the grant */
    t.bot.state.failMember.clear();
    await t.engine.resync(USER);
    assert.deepEqual(rows(t.store).map((r) => [r.key, r.desired, r.state]), [['academy', true, 'pending']]);
    assert.equal(t.store.db.members.get(`${USER}|false`).last_access.rolesQueued, true);
  }
});

test('an explicit dry run still aborts on an unreadable member (audit only, nothing to salvage)', async () => {
  const t = setup({ members: { [USER]: [] }, fixtures: { subscriptions: [monthly()], invoices: paid(), charges: [k.charge({ id: 'ch_cur', customer: CUS })] } });
  t.bot.state.failMember.set(USER, k.discordError('server', 502, null));
  await assert.rejects(() => t.engine.resync(USER, { dryRun: true, actor: 'cli:dry-run' }));
  assert.equal(t.store.db.audit.length, 0);
  assert.equal(t.stripe.writes().length, 0);
});

test('a member who is not in the guild is recorded as awaiting_member', async () => {
  const t = setup({ members: {}, fixtures: { subscriptions: [monthly()], invoices: paid(), charges: [k.charge({ id: 'ch_cur', customer: CUS })] } });
  await t.engine.resync(USER);
  const row = [...t.store.db.roles.values()][0];
  assert.equal(row.state, 'awaiting_member');
  assert.equal(row.next_attempt_at.getTime(), T0 + 10 * 60_000);
  assert.deepEqual(t.store.db.audit.find((r) => r.action === 'role_desired_changed').outcome, 'waiting_member');
});

test('past_due grace sets next_check_at to the grace end, then revokes', async () => {
  const t = setup({ members: { [USER]: [ACADEMY_ROLE] }, fixtures: {
    subscriptions: [monthly({ status: 'past_due', price: 'price_daily1', periodStart: S(T0) - 3600 })], invoices: paid(), charges: [k.charge({ id: 'ch_cur', customer: CUS })] } });
  await t.engine.resync(USER);
  assert.equal(t.store.db.members.get(`${USER}|false`).next_check_at.getTime(), (S(T0) - 3600) * 1000 + 2 * 3600_000);
  assert.deepEqual(rows(t.store).map((r) => r.state), ['synced']);
  t.now.advance(3600_000 + 1000);
  await t.engine.resync(USER);
  assert.deepEqual(rows(t.store).map((r) => [r.desired, r.state, r.generation]), [[false, 'pending', 2]]);
});

test('both Stripe payload shapes produce identical results', async () => {
  const legacy = setup({ members: { [USER]: [] }, fixtures: { subscriptions: [monthly({ status: 'past_due', price: 'price_weekly1', periodStart: S(T0) - 3600 })],
    invoices: paid(), charges: [k.charge({ id: 'ch_cur', customer: CUS, refunded: true, amountRefunded: 999, amount: 999 })] } });
  const basil = setup({ members: { [USER]: [] }, fixtures: { subscriptions: [monthly({ status: 'past_due', price: 'price_weekly1', periodStart: S(T0) - 3600, basil: true })],
    invoices: paid('sub_m', 'ch_cur', { basil: true }), charges: [k.charge({ id: 'ch_cur', customer: CUS, refunded: true, amountRefunded: 999, amount: 999 })] } });
  const a = await legacy.engine.resync(USER);
  const b = await basil.engine.resync(USER);
  assert.deepEqual(a.roles, b.roles);
  assert.deepEqual(a.reasons, b.reasons);
  assert.ok(a.reasons.includes('current_period_refunded'));
  const okLegacy = setup({ members: { [USER]: [] }, fixtures: { subscriptions: [monthly({ status: 'past_due', price: 'price_weekly1', periodStart: S(T0) - 3600, basil: true })] } });
  assert.deepEqual((await okLegacy.engine.resync(USER)).roles, ['academy']);
  assert.equal(okLegacy.store.db.members.get(`${USER}|false`).next_check_at.getTime(), (S(T0) - 3600) * 1000 + 12 * 3600_000);
});

test('a draft renewal after a refunded period keeps it refunded; a $0 invoice is skipped', async () => {
  const t = setup({ members: { [USER]: [ACADEMY_ROLE] }, fixtures: {
    subscriptions: [monthly()],
    invoices: [k.invoice({ id: 'in_draft', subscription: 'sub_m', charge: null, status: 'draft', created: S(T0) }),
      k.invoice({ id: 'in_zero', subscription: 'sub_m', charge: null, created: S(T0) - 60 }),
      k.invoice({ id: 'in_paid', subscription: 'sub_m', charge: 'ch_cur', created: S(T0) - 3600 })],
    charges: [k.charge({ id: 'ch_cur', customer: CUS, refunded: true, amountRefunded: 2999 })]
  } });
  const result = await t.engine.resync(USER);
  assert.deepEqual(result.roles, []);
  assert.ok(result.reasons.includes('current_period_refunded'));
});

test('autoStopPlan: only a free-only trial is stopped the margin before its trial end; the engine never chases its own write', () => {
  const M = TRIAL_STOP_MARGIN_SEC;
  const D = 86400;
  const s = 1_800_000_000;
  /* Free Trial Access: a 3-day trial (trialDays 3) that stops after 3 days (cancelAfterDays 3) */
  const sub = (o = {}) => ({ status: 'trialing', startDate: s, trialStart: s, trialEnd: s + 3 * D, cancelAt: null, price: { trialDays: 3 }, ...o });
  assert.equal(M, 600, '10 minutes');
  assert.deepEqual(autoStopPlan(sub(), 3), { stop: s + 3 * D, target: s + 3 * D - M, freeOnly: true, done: false });
  /* after the engine's own write: flexible billing keeps trial_end, classic moves it onto cancel_at; both are final */
  assert.equal(autoStopPlan(sub({ cancelAt: s + 3 * D - M }), 3).done, true);
  assert.equal(autoStopPlan(sub({ cancelAt: s + 3 * D - M, trialEnd: s + 3 * D - M }), 3).done, true);
  /* a cancel_at AT the trial end (the race the margin avoids) or after it is pulled in; an earlier one is kept */
  assert.equal(autoStopPlan(sub({ cancelAt: s + 3 * D }), 3).done, false);
  assert.equal(autoStopPlan(sub({ cancelAt: s + 4 * D }), 3).done, false);
  assert.equal(autoStopPlan(sub({ cancelAt: s + D }), 3).done, true);
  /* Stripe's trial_start a few seconds off start_date */
  assert.equal(autoStopPlan(sub({ trialStart: s + 2, trialEnd: s + 2 + 3 * D }), 3).target, s + 3 * D - M);
  assert.equal(autoStopPlan(sub({ trialStart: s - 2, trialEnd: s - 2 + 3 * D }), 3).target, s - 2 + 3 * D - M);
  /* a trial longer than its stop (7 days, stop after 3): 10 minutes before day 3 */
  assert.equal(autoStopPlan(sub({ trialEnd: s + 7 * D, price: { trialDays: 7 } }), 3).target, s + 3 * D - M);
  /* the trial shortened below its price's offer (staff): still free-only, stopped before the new trial end */
  assert.deepEqual(autoStopPlan(sub({ trialEnd: s + 2 * D }), 3), { stop: s + 3 * D, target: s + 2 * D - M, freeOnly: true, done: false });
  /* a PAID trial plan (a 2-day trial, stop after 3 days: one charge): the exact stop, no margin */
  assert.deepEqual(autoStopPlan(sub({ trialEnd: s + 2 * D, price: { trialDays: 2 } }), 3), { stop: s + 3 * D, target: s + 3 * D, freeOnly: false, done: false });
  assert.equal(autoStopPlan(sub({ trialEnd: s + 2 * D, price: { trialDays: 2 }, cancelAt: s + 3 * D }), 3).done, true);
  /* not trialing (the Day plan, or a daily price bought without a trial): the exact stop */
  assert.deepEqual(autoStopPlan(sub({ status: 'active', trialStart: null, trialEnd: null }), 3), { stop: s + 3 * D, target: s + 3 * D, freeOnly: false, done: false });
});

test('missedFreeTrialStop: only a free-only trial Stripe already converted; cancelled before the first charge, or flagged for a refund after it', () => {
  const D = 86400;
  const s = 1_800_000_000;
  const now = s + 3 * D + 1200;
  /* Free Trial Access (trialDays 3, cancelAfterDays 3) after its trial end, the engine's stop never set */
  const sub = (o = {}) => ({ status: 'active', startDate: s, trialStart: s, trialEnd: s + 3 * D, cancelAtPeriodEnd: false, everPaid: false,
    price: { trialDays: 3 }, ...o });
  assert.equal(missedFreeTrialStop(sub(), 3, now), 'cancel');
  assert.equal(missedFreeTrialStop(sub({ status: 'past_due' }), 3, now), 'cancel', 'its first charge failed: no retries');
  assert.equal(missedFreeTrialStop(sub({ everPaid: null }), 3, now), 'cancel', 'not known: stop it anyway');
  assert.equal(missedFreeTrialStop(sub({ everPaid: true }), 3, now), 'charged');
  assert.equal(missedFreeTrialStop(sub({ everPaid: true, cancelAtPeriodEnd: true }), 3, now), 'charged', 'access ends now, not with the paid day');
  /* classic billing moved trial_end onto an earlier cancel_at, then a portal renew cleared it: still the 3-day trial */
  assert.equal(missedFreeTrialStop(sub({ trialEnd: s + 3 * D - 600 }), 3, now), 'cancel');
  /* not its business */
  assert.equal(missedFreeTrialStop(sub({ status: 'trialing' }), 3, now), null, 'still trialing: autoStopPlan stops it');
  assert.equal(missedFreeTrialStop(sub({ status: 'canceled' }), 3, now), null);
  assert.equal(missedFreeTrialStop(sub(), 3, s + 3 * D - 1), null, 'before its trial end');
  assert.equal(missedFreeTrialStop(sub({ trialStart: null, trialEnd: null }), 3, now), null, 'no trial at all');
  assert.equal(missedFreeTrialStop(sub({ trialEnd: s + 2 * D, price: { trialDays: 2 } }), 3, now), null, 'a paid trial (2 days, stop after 3)');
  assert.equal(missedFreeTrialStop(sub({ trialEnd: s + 2 * D, price: { trialDays: 3 } }), 3, now), 'cancel', 'a free-only price whose trial staff shortened');
});

test('freeTrialCheckTimes: a free-only trial is re-checked before its stop (while unset) and 5 minutes after its trial end, without a webhook', () => {
  const D = 86400;
  const s = 1_800_000_000;
  const M = TRIAL_STOP_MARGIN_SEC;
  const R = FREE_TRIAL_RECHECK_SEC;
  assert.equal(R, 300);
  const ft = (o = {}) => ({ id: 'sub_ft', status: 'trialing', startDate: s, trialStart: s, trialEnd: s + 3 * D, cancelAt: null,
    price: { trialDays: 3, cancelAfterDays: 3 }, ...o });
  assert.deepEqual(freeTrialCheckTimes([ft()], s * 1000), [(s + 3 * D - M - 120) * 1000, (s + 3 * D + R) * 1000]);
  /* stop set (classic billing moved trial_end onto it): only the check after the trial end */
  assert.deepEqual(freeTrialCheckTimes([ft({ cancelAt: s + 3 * D - M, trialEnd: s + 3 * D - M })], s * 1000), [(s + 3 * D - M + R) * 1000]);
  /* past times are dropped; a paid trial and a plan without an auto-stop get none */
  assert.deepEqual(freeTrialCheckTimes([ft()], (s + 3 * D) * 1000), [(s + 3 * D + R) * 1000]);
  assert.deepEqual(freeTrialCheckTimes([ft({ trialEnd: s + 2 * D, price: { trialDays: 2, cancelAfterDays: 3 } })], s * 1000), []);
  assert.deepEqual(freeTrialCheckTimes([ft({ trialEnd: s + 7 * D, price: { trialDays: 7, cancelAfterDays: null } })], s * 1000), []);
  assert.deepEqual(freeTrialCheckTimes([ft({ status: 'canceled' })], s * 1000), []);
});

test('daily plans are capped at three charges, idempotently', async () => {
  const start = S(T0) - 600;
  const t = setup({ members: { [USER]: [] }, fixtures: { subscriptions: [monthly({ id: 'sub_d', price: 'price_daily1', created: start, start })],
    invoices: paid('sub_d'), charges: [k.charge({ id: 'ch_cur', customer: CUS, amount: 299 })] } });
  const result = await t.engine.resync(USER);
  const writes = t.stripe.callsOf('updateSubscription');
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].args, ['sub_d', { cancel_at: start + 3 * 86400, proration_behavior: 'none' },
    `mem-academy-auto-stop-v1-sub_d-${start + 3 * 86400}`]);
  assert.deepEqual(result.stripeActions, [{ action: 'auto_stop_set', subscriptionId: 'sub_d' }]);
  const row = t.store.db.audit.find((r) => r.action === 'auto_stop_set');
  assert.deepEqual([row.reason, row.details.cancelAfterDays, row.details.cancelAt], ['cancel_after_3_days', 3, start + 3 * 86400]);
  await t.engine.resync(USER);
  assert.equal(t.stripe.callsOf('updateSubscription').length, 1);
});

test('a paid lifetime sets every renewing Academy plan to cancel at period end', async () => {
  const t = setup({ members: { [USER]: [ACADEMY_ROLE] }, fixtures: {
    subscriptions: [monthly(), k.subscription({ id: 'sub_w', customer: CUS, price: 'price_weekly1', status: 'past_due' }), k.subscription({ id: 'sub_c', customer: CUS, status: 'canceled' })],
    invoices: paid(), paymentIntents: [k.lifetimePi({ id: 'pi_life', customer: CUS, latestCharge: 'ch_life' })],
    charges: [k.charge({ id: 'ch_cur', customer: CUS }), k.charge({ id: 'ch_life', customer: CUS, paymentIntent: 'pi_life' })] } });
  const result = await t.engine.resync(USER);
  const writes = t.stripe.callsOf('updateSubscription').map((c) => [c.args[0], c.args[1], c.args[2]]);
  assert.deepEqual(writes, [
    ['sub_m', { cancel_at_period_end: true }, 'mem-academy-lifetime-supersede-v1-pi_life-sub_m'],
    ['sub_w', { cancel_at_period_end: true }, 'mem-academy-lifetime-supersede-v1-pi_life-sub_w']
  ]);
  assert.equal(result.stripeActions.filter((a) => a.action === 'lifetime_supersede').length, 2);
  assert.equal(t.store.db.audit.filter((r) => r.action === 'lifetime_supersede').length, 2);
  await t.engine.resync(USER);
  assert.equal(t.stripe.callsOf('updateSubscription').length, 2);
});

test('a refunded current period: stripe_cancel_required once, or a cancel with CANCEL_ON_REFUND', async () => {
  const fixtures = () => ({ subscriptions: [monthly()], invoices: paid(), charges: [k.charge({ id: 'ch_cur', customer: CUS, refunded: true, amountRefunded: 2999 })] });
  const t = setup({ members: { [USER]: [ACADEMY_ROLE] }, fixtures: fixtures() });
  await t.engine.resync(USER);
  await t.engine.resync(USER);
  assert.equal(t.store.db.audit.filter((r) => r.action === 'stripe_cancel_required').length, 1);
  assert.equal(t.stripe.callsOf('cancelSubscription').length, 0);
  const c = setup({ members: { [USER]: [ACADEMY_ROLE] }, fixtures: fixtures(), overrides: { SML_ACADEMY_BILLING_CANCEL_ON_REFUND: '1' } });
  await c.engine.resync(USER);
  assert.deepEqual(c.stripe.callsOf('cancelSubscription')[0].args, ['sub_m', { prorate: false }, 'mem-academy-refund-cancel-v1-ch_cur']);
});

test('no Stripe write when preflight has not confirmed the account', async () => {
  const now = k.clock();
  const config = k.config();
  const store = k.createFakeStore({ now });
  const start = S(T0) - 600;
  const stripe = k.createFakeStripe({ customers: { [CUS]: k.academyCustomer(CUS, USER) }, subscriptions: [monthly({ id: 'sub_d', price: 'price_daily1', created: start, start })] });
  k.bindMember(store, USER, CUS);
  const engine = createResync({ config, store, stripeApi: stripe, catalog: createCatalog({ config, stripeApi: stripe, now }), bot: k.createFakeBot({ members: { [USER]: [] } }),
    now, stripeWritesAllowed: () => false });
  await engine.resync(USER);
  assert.equal(stripe.writes().length, 0);
});

test('when desired flips, the generation is bumped so an in-flight applier cannot overwrite it', async () => {
  const t = setup({ members: { [USER]: [] }, fixtures: { subscriptions: [monthly()], invoices: paid(), charges: [k.charge({ id: 'ch_cur', customer: CUS })] } });
  await t.engine.resync(USER);
  assert.deepEqual(rows(t.store).map((r) => [r.desired, r.generation]), [[true, 1]]);
  t.stripe.data.subscriptions[0].status = 'canceled';
  t.bot.state.members[USER] = [ACADEMY_ROLE];
  await t.engine.resync(USER);
  assert.deepEqual(rows(t.store).map((r) => [r.desired, r.state, r.generation]), [[false, 'pending', 2]]);
});

test('two concurrent resyncs for one member serialize on the per-user lock', async () => {
  const t = setup({ members: { [USER]: [] }, fixtures: { subscriptions: [monthly()], invoices: paid(), charges: [k.charge({ id: 'ch_cur', customer: CUS })] } });
  let inside = 0;
  let overlap = false;
  const original = t.store.withUserTx;
  t.store.withUserTx = (id, fn) => original(id, async (client) => {
    inside += 1;
    if (inside > 1) overlap = true;
    await new Promise((r) => setImmediate(r));
    try { return await fn(client); } finally { inside -= 1; }
  });
  await Promise.all([t.engine.resync(USER), t.engine.resync(USER)]);
  assert.equal(overlap, false);
  assert.deepEqual(rows(t.store), [{ key: 'academy', desired: true, state: 'pending', generation: 1 }]);
});

test('a snapshot older than the last committed one is discarded', async () => {
  const t = setup({ members: { [USER]: [] }, fixtures: { subscriptions: [monthly()], invoices: paid(), charges: [k.charge({ id: 'ch_cur', customer: CUS })] },
    memberExtra: { last_synced_at: new Date(T0 + 60_000) } });
  const result = await t.engine.resync(USER);
  assert.equal(result.stale, true);
  assert.equal(t.store.db.roles.size, 0);
});

test('an unbound holder with no comp is planned for revoke (comps-only access)', async () => {
  const t = setup({ bind: false, members: { [k.USER2]: [ACADEMY_ROLE, LIFETIME_ROLE] } });
  const result = await t.engine.resync(k.USER2);
  assert.deepEqual(result.roles, []);
  assert.deepEqual(rows(t.store).map((r) => [r.key, r.desired]), [['academy', false], ['mem_lifetime', false]]);
  assert.equal(t.stripe.calls.length, 0);
});

/* ---------------------------------------------------------------------------
 * The Stripe billing rules never wait on a Discord read.
 * ------------------------------------------------------------------------ */

test('daily cap (decision 4) is set even when the Discord member read fails (bot 401 / outage)', async () => {
  const start = S(T0) - 3600;
  const t = setup({ members: {}, fixtures: {
    subscriptions: [monthly({ id: 'sub_daily', price: 'price_daily1', created: start, start })],
    invoices: paid('sub_daily', 'ch_d1'), charges: [k.charge({ id: 'ch_d1', customer: CUS, amount: 299 })] } });
  t.bot.state.failMember.set('*', k.discordError('unauthorized', 401, 0));
  await assert.rejects(() => t.engine.resync(USER));
  const caps = t.stripe.callsOf('updateSubscription').filter((c) => c.args[0] === 'sub_daily');
  assert.equal(caps.length, 1, 'no cancel_at was written: with Discord unreadable the daily plan would renew (and charge) indefinitely');
  assert.deepEqual(caps[0].args[1], { cancel_at: start + 3 * 86400, proration_behavior: 'none' });
  assert.ok(k.actions(t.store).includes('auto_stop_set'));
  assert.equal(t.store.db.roles.size, 0);
});

test('lifetime supersede (decision 5) runs even when the Discord member read fails', async () => {
  const t = setup({ members: {}, fixtures: {
    subscriptions: [monthly({ id: 'sub_week', price: 'price_weekly1' })],
    invoices: paid('sub_week', 'ch_w'),
    paymentIntents: [k.lifetimePi({ id: 'pi_life', customer: CUS, latestCharge: 'ch_life' })],
    charges: [k.charge({ id: 'ch_w', customer: CUS, amount: 999 }), k.charge({ id: 'ch_life', customer: CUS, amount: 129999, paymentIntent: 'pi_life' })] } });
  t.bot.state.failMember.set('*', k.discordError('server', 503, 0));
  await assert.rejects(() => t.engine.resync(USER));
  const supersede = t.stripe.callsOf('updateSubscription').filter((c) => c.args[0] === 'sub_week' && c.args[1].cancel_at_period_end === true);
  assert.equal(supersede.length, 1, 'the weekly plan would keep charging a member who already owns MEM Lifetime while Discord is unreadable');
  assert.ok(k.actions(t.store).includes('lifetime_supersede'));
});

/* ---------------------------------------------------------------------------
 * A lost dispute voids a plan for good: Stripe must stop billing it.
 * ------------------------------------------------------------------------ */

function lostDisputeFixtures(extraSub = {}) {
  return {
    subscriptions: [monthly({ created: S(T0) - 70 * 86400, ...extraSub })],
    invoices: [
      k.invoice({ id: 'in_cur', subscription: 'sub_m', charge: 'ch_cur', created: S(T0) - 3600 }),
      k.invoice({ id: 'in_old', subscription: 'sub_m', charge: 'ch_old', created: S(T0) - 60 * 86400 })
    ],
    charges: [
      k.charge({ id: 'ch_cur', customer: CUS, invoiceId: 'in_cur' }),
      k.charge({ id: 'ch_old', customer: CUS, invoiceId: 'in_old', disputed: true, created: S(T0) - 60 * 86400 })
    ],
    disputes: [{ id: 'du_old', object: 'dispute', charge: 'ch_old', status: 'lost' }]
  };
}

test('a lost dispute that voids a still-renewing subscription is flagged once for staff, like a refund', async () => {
  const t = setup({ members: { [USER]: [ACADEMY_ROLE] }, fixtures: lostDisputeFixtures() });
  const result = await t.engine.resync(USER);
  assert.deepEqual(result.roles, [], 'fixture: the lost dispute voids the subscription for good');
  const flags = t.store.db.audit.filter((r) => r.action === 'stripe_cancel_required');
  assert.equal(flags.length, 1, 'sub_m keeps renewing every month with no access: staff must be told');
  assert.equal(flags[0].reason, 'dispute_lost');
  assert.deepEqual(flags[0].stripe_refs, ['sub_m', 'ch_old']);
  assert.equal(t.stripe.callsOf('cancelSubscription').length, 0);
  t.now.advance(60_000);
  await t.engine.resync(USER);
  assert.equal(t.store.db.audit.filter((r) => r.action === 'stripe_cancel_required').length, 1, 'flagged once per subscription');
});

test('with CANCEL_ON_REFUND=1 a plan voided by a lost dispute is cancelled; a plan already ending is left alone', async () => {
  const t = setup({ members: { [USER]: [ACADEMY_ROLE] }, fixtures: lostDisputeFixtures(), overrides: { SML_ACADEMY_BILLING_CANCEL_ON_REFUND: '1' } });
  await t.engine.resync(USER);
  assert.deepEqual(t.stripe.callsOf('cancelSubscription').map((c) => c.args), [['sub_m', { prorate: false }, 'mem-academy-dispute-cancel-v1-sub_m']]);
  const cancelled = t.store.db.audit.find((r) => r.action === 'stripe_subscription_canceled');
  assert.equal(cancelled.reason, 'dispute_lost');
  const ending = setup({ members: { [USER]: [ACADEMY_ROLE] }, fixtures: lostDisputeFixtures({ cancelAtPeriodEnd: true }) });
  await ending.engine.resync(USER);
  assert.equal(ending.stripe.callsOf('cancelSubscription').length, 0);
  assert.equal(k.actions(ending.store).includes('stripe_cancel_required'), false, 'a plan set to end will not charge again');
});

test('a staff flag is not swallowed by a pass whose Stripe rules were blocked by preflight', async () => {
  let allowed = false;
  const now = k.clock();
  const config = k.config();
  const store = k.createFakeStore({ now });
  const stripe = k.createFakeStripe({ customers: { [CUS]: k.academyCustomer(CUS, USER) }, ...lostDisputeFixtures() });
  const bot = k.createFakeBot({ members: { [USER]: [] } });
  const engine = createResync({ config, store, stripeApi: stripe, catalog: createCatalog({ config, stripeApi: stripe, now }), bot, now, stripeWritesAllowed: () => allowed });
  k.bindMember(store, USER, CUS);
  await engine.resync(USER);
  assert.equal(k.actions(store).includes('stripe_cancel_required'), false);
  allowed = true;
  now.advance(60_000);
  await engine.resync(USER);
  assert.equal(store.db.audit.filter((r) => r.action === 'stripe_cancel_required').length, 1);
});

/* ---------------------------------------------------------------------------
 * Revokes: preflight gate and the caller's brake.
 * ------------------------------------------------------------------------ */

test('no revoke is decided until preflight confirms the Stripe account; the member is re-checked in five minutes', async () => {
  let accountOk = false;
  const now = k.clock();
  const config = k.config();
  const store = k.createFakeStore({ now });
  /* a key on another account: every Customer 404s and reads as deleted */
  const stripe = k.createFakeStripe({});
  const bot = k.createFakeBot({ members: { [USER]: [ACADEMY_ROLE] } });
  const engine = createResync({ config, store, stripeApi: stripe, catalog: createCatalog({ config, stripeApi: stripe, now }), bot, now,
    stripeWritesAllowed: () => accountOk, revokeGate: () => accountOk });
  k.bindMember(store, USER, CUS);
  await store.insertRoleRow(null, { discordId: USER, roleId: ACADEMY_ROLE, roleKey: 'academy', desired: true, state: 'synced' });
  const held = await engine.resync(USER);
  assert.equal(held.deferredRevokes, 1);
  assert.deepEqual(rows(store).map((r) => [r.desired, r.state]), [[true, 'synced']]);
  assert.equal(store.db.members.get(`${USER}|false`).next_check_at.getTime(), T0 + 5 * 60_000);
  accountOk = true;
  now.advance(5 * 60_000);
  await engine.resync(USER);
  assert.deepEqual(rows(store).map((r) => [r.desired, r.state]), [[false, 'pending']]);
});

test('revokes held back only by the caller brake are not re-scheduled', async () => {
  const t = setup({ members: { [USER]: [ACADEMY_ROLE] }, fixtures: { subscriptions: [monthly({ status: 'canceled' })] } });
  const result = await t.engine.resync(USER, { actor: 'reconciler', allowRevokes: false });
  assert.equal(result.deferredRevokes, 1);
  assert.equal(t.store.db.roles.size, 0);
  assert.equal(t.store.db.members.get(`${USER}|false`).next_check_at, null, 'no five-minute retry: the due-scan must not undo the brake');
});

/* ---------------------------------------------------------------------------
 * ROLE_MODE dry_run leaves no role intent: the cache records it.
 * ------------------------------------------------------------------------ */

test('a resync that queued no role intent (ROLE_MODE dry_run) is marked rolesQueued=false for the enforce sweep', async () => {
  const t = setup({ members: { [USER]: [] }, overrides: { SML_ACADEMY_BILLING_ROLE_MODE: 'dry_run' },
    fixtures: { subscriptions: [monthly()], invoices: paid(), charges: [k.charge({ id: 'ch_cur', customer: CUS })] } });
  await t.engine.resync(USER, { actor: 'settle' });
  const member = t.store.db.members.get(`${USER}|false`);
  assert.equal(t.store.db.roles.size, 0, 'fixture: dry_run queues no grant');
  assert.equal(member.next_check_at.getTime(), T0 + ENTITLED_RECHECK_MS, 'fixture: the next automatic look is the daily re-read');
  assert.equal(member.last_access.rolesQueued, false);
  /* ROLE_MODE=enforce at the next start: the member is made due now */
  assert.equal(await t.store.markRoleSyncDue(), 1);
  assert.equal(member.next_check_at.getTime(), T0);
  assert.deepEqual(await t.store.dueMemberIds(null, 25), [USER]);
  const enforced = setup({ bind: false, members: { [USER]: [] }, fixtures: { subscriptions: [monthly()], invoices: paid(), charges: [k.charge({ id: 'ch_cur', customer: CUS })] } });
  enforced.store.db.members.set(`${USER}|false`, member);
  await enforced.engine.resync(USER, { actor: 'due_scan' });
  assert.deepEqual(rows(enforced.store).map((r) => [r.key, r.desired, r.state]), [['academy', true, 'pending']]);
  assert.equal(member.last_access.rolesQueued, true);
  assert.equal(await enforced.store.markRoleSyncDue(), 0);
});

/* ---------------------------------------------------------------------------
 * Lifetime paid by bank debit (ACH Direct Debit, us_bank_account).
 * ------------------------------------------------------------------------ */

const achFixtures = ({ piStatus = 'processing', chargeStatus = 'pending', nextAction = null, disputed = false, extra = {} } = {}) => ({
  paymentIntents: [k.lifetimePi({ id: 'pi_ach', customer: CUS, status: piStatus, latestCharge: nextAction ? null : 'ch_ach', amount: 1000000, nextAction })],
  charges: nextAction ? [] : [k.charge({ id: 'ch_ach', customer: CUS, amount: 1000000, paymentIntent: 'pi_ach', status: chargeStatus, disputed })],
  ...extra
});

test('a lifetime bank debit that is still processing grants no role and is re-checked within the hour', async () => {
  const t = setup({ members: { [USER]: [] }, overrides: k.BANK_LIFETIME_ENV, fixtures: achFixtures() });
  const result = await t.engine.resync(USER);
  assert.deepEqual(result.roles, []);
  assert.ok(result.reasons.includes('lifetime_payment_processing'));
  assert.equal(t.store.db.roles.size, 0);
  assert.equal(t.store.db.lifetime.size, 0, 'nothing is cached as paid before the debit clears');
  const member = t.store.db.members.get(`${USER}|false`);
  assert.equal(member.last_access.lifetimePending, true);
  assert.equal(member.next_check_at.getTime(), T0 + 3600_000);
  assert.equal(k.actions(t.store).includes('access_changed'), false);

  /* the due-scan re-read after the debit cleared (the webhook may be late) */
  t.stripe.data.paymentIntents[0].status = 'succeeded';
  t.stripe.data.charges[0].status = 'succeeded';
  t.now.advance(3600_000);
  const cleared = await t.engine.resync(USER, { actor: 'due_scan' });
  assert.deepEqual(cleared.roles, ['academy', 'mem_lifetime']);
  assert.deepEqual(rows(t.store).map((r) => [r.key, r.desired, r.state]), [['academy', true, 'pending'], ['mem_lifetime', true, 'pending']]);
  assert.equal(t.store.db.lifetime.get('pi_ach').stripe_state, 'paid');
  assert.equal(t.store.db.members.get(`${USER}|false`).last_access.lifetimePending, false);
});

test('a bank account still waiting for microdeposit verification is pending too; a failed debit is not', async () => {
  const waiting = setup({ members: { [USER]: [] }, overrides: k.BANK_LIFETIME_ENV,
    fixtures: achFixtures({ piStatus: 'requires_action', nextAction: 'verify_with_microdeposits' }) });
  const w = await waiting.engine.resync(USER);
  assert.deepEqual(w.roles, []);
  assert.equal(waiting.store.db.members.get(`${USER}|false`).last_access.lifetimePending, true);
  const failed = setup({ members: { [USER]: [] }, overrides: k.BANK_LIFETIME_ENV, fixtures: achFixtures({ piStatus: 'requires_payment_method', chargeStatus: 'failed' }) });
  const f = await failed.engine.resync(USER);
  assert.deepEqual(f.roles, []);
  assert.equal(failed.store.db.members.get(`${USER}|false`).last_access.lifetimePending, false);
  assert.equal(failed.store.db.members.get(`${USER}|false`).next_check_at, null);
});

test('a processing lifetime does not yet set a renewing plan to cancel (only a PAID lifetime supersedes it)', async () => {
  const t = setup({ members: { [USER]: [ACADEMY_ROLE] }, overrides: k.BANK_LIFETIME_ENV, fixtures: achFixtures({ extra: {
    subscriptions: [monthly()], invoices: paid() } }) });
  t.stripe.data.charges.push(k.charge({ id: 'ch_cur', customer: CUS }));
  const pending = await t.engine.resync(USER);
  assert.deepEqual(pending.roles, ['academy']);
  assert.equal(t.stripe.callsOf('updateSubscription').length, 0);
  t.stripe.data.paymentIntents[0].status = 'succeeded';
  t.stripe.data.charges[0].status = 'succeeded';
  t.now.advance(60_000);
  const cleared = await t.engine.resync(USER);
  assert.deepEqual(cleared.roles, ['academy', 'mem_lifetime']);
  assert.deepEqual(t.stripe.callsOf('updateSubscription').map((c) => [c.args[0], c.args[1]]), [['sub_m', { cancel_at_period_end: true }]]);
});

test('an ACH debit returned after access was granted (Stripe opens a dispute) removes lifetime access', async () => {
  for (const status of ['lost', 'needs_response']) {
    const t = setup({ members: { [USER]: [ACADEMY_ROLE, LIFETIME_ROLE] }, overrides: k.BANK_LIFETIME_ENV,
      fixtures: achFixtures({ piStatus: 'succeeded', chargeStatus: 'succeeded' }) });
    const granted = await t.engine.resync(USER);
    assert.deepEqual(granted.roles, ['academy', 'mem_lifetime']);
    assert.deepEqual(rows(t.store).map((r) => [r.key, r.desired, r.state]), [['academy', true, 'synced'], ['mem_lifetime', true, 'synced']]);
    /* the bank returns the debit: insufficient funds, reported as a dispute */
    t.stripe.data.charges[0].disputed = true;
    t.stripe.data.disputes.push({ id: 'du_ach', object: 'dispute', charge: 'ch_ach', payment_intent: 'pi_ach', status, reason: 'insufficient_funds' });
    t.now.advance(60_000);
    const returned = await t.engine.resync(USER, { actor: 'webhook' });
    assert.deepEqual(returned.roles, [], status);
    assert.deepEqual(rows(t.store).map((r) => [r.key, r.desired, r.state]), [['academy', false, 'pending'], ['mem_lifetime', false, 'pending']], status);
    assert.equal(t.store.db.lifetime.get('pi_ach').stripe_state, status === 'lost' ? 'dispute_lost' : 'disputed');
    assert.ok(t.store.db.audit.some((r) => r.action === 'role_desired_changed' && r.role_key === 'mem_lifetime' && r.outcome === 'applied'));
  }
});

test('a lifetime whose charge later reads failed (charge.failed) loses access through the same resync', async () => {
  const t = setup({ members: { [USER]: [ACADEMY_ROLE, LIFETIME_ROLE] }, overrides: k.BANK_LIFETIME_ENV,
    fixtures: achFixtures({ piStatus: 'succeeded', chargeStatus: 'succeeded' }) });
  await t.engine.resync(USER);
  t.stripe.data.charges[0].status = 'failed';
  t.now.advance(60_000);
  const result = await t.engine.resync(USER, { actor: 'webhook' });
  assert.deepEqual(result.roles, []);
  assert.ok(result.reasons.includes('lifetime_payment_failed'));
  assert.deepEqual(rows(t.store).map((r) => [r.key, r.desired]), [['academy', false], ['mem_lifetime', false]]);
  /* with revokes switched off the removal is recorded as suppressed, never sent */
  const off = setup({ members: { [USER]: [ACADEMY_ROLE, LIFETIME_ROLE] }, overrides: { ...k.BANK_LIFETIME_ENV, SML_ACADEMY_BILLING_REVOKES_ENABLED: '0' },
    fixtures: achFixtures({ piStatus: 'succeeded', chargeStatus: 'failed' }) });
  await off.engine.resync(USER);
  assert.deepEqual(rows(off.store).map((r) => [r.key, r.desired, r.state]), [['academy', false, 'suppressed'], ['mem_lifetime', false, 'suppressed']]);
});
