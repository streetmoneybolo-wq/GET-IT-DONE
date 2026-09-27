'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { computeAccess, planRoleDiff, applyBrakes, trialEndedUnpaid } = require('./access');
const { ACADEMY_ROLE, LIFETIME_ROLE, MONARCH, PREMIUM } = require('./testkit');

const NOW = Date.parse('2026-10-05T12:00:00Z');
const sec = (ms) => Math.floor(ms / 1000);
const H = 3600_000;
const price = (pkg, extra = {}) => ({ priceId: `price_${pkg}`, package: pkg, academy: true, known: true, unmapped: false,
  graceHours: { daily: 2, weekly: 12 }[pkg] ?? 72, ...extra });
const sub = (extra = {}) => ({ id: 'sub_1', status: 'active', created: sec(NOW - 10 * 86400_000), periodStart: sec(NOW - H),
  periodEnd: sec(NOW + 29 * 86400_000), price: price('monthly'), currentPeriodChargeId: 'ch_cur', cancelAtPeriodEnd: false, cancelAt: null, ...extra });
const chargeMap = (...charges) => new Map(charges.map((c) => [c.id, { fullyRefunded: false, partiallyRefunded: false, created: sec(NOW - H), ...c }]));
const roles = (result) => [...result.roles].sort();
const access = (snapshot, extra = {}) => computeAccess({ snapshot, now: NOW, livemode: true, ...extra });

test('active or trialing grants the Academy role', () => {
  assert.deepEqual(roles(access({ subscriptions: [sub()] })), ['academy']);
  assert.deepEqual(roles(access({ subscriptions: [sub({ status: 'trialing', currentPeriodChargeId: null })] })), ['academy']);
});

test('a past_due trial that was never paid gets no grace in any period; a paid one keeps the usual grace', () => {
  const trialEnd = sec(NOW - 8 * 86400_000);
  const pastDue = (extra) => sub({ status: 'past_due', trialStart: trialEnd - 7 * 86400, trialEnd, currentPeriodChargeId: null, ...extra });
  /* the first period after the trial, whatever everPaid says it does not know */
  assert.equal(trialEndedUnpaid(pastDue({ periodStart: trialEnd, everPaid: null })), true);
  /* a LATER period (Stripe keeps opening periods while it retries): never paid -> still unpaid */
  const later = pastDue({ periodStart: sec(NOW - H), everPaid: false });
  assert.equal(trialEndedUnpaid(later), true);
  const denied = access({ subscriptions: [later] });
  assert.deepEqual([roles(denied), denied.reasons.includes('trial_ended_unpaid')], [[], true]);
  /* paid at least once: the normal past_due grace (monthly 72 h) */
  const paid = pastDue({ periodStart: sec(NOW - H), everPaid: true });
  assert.equal(trialEndedUnpaid(paid), false);
  const graced = access({ subscriptions: [paid] });
  assert.deepEqual([roles(graced), graced.reasons.includes('past_due_grace:monthly')], [['academy'], true]);
  /* not known (the invoice read failed): only the first period after the trial counts as unpaid */
  assert.equal(trialEndedUnpaid(pastDue({ periodStart: sec(NOW - H), everPaid: null })), false);
  /* no trial: never */
  assert.equal(trialEndedUnpaid(sub({ status: 'past_due', everPaid: false })), false);
});

test('cancel_at_period_end while active keeps access until the period ends', () => {
  const result = access({ subscriptions: [sub({ cancelAtPeriodEnd: true })] });
  assert.deepEqual(roles(result), ['academy']);
  assert.ok(result.reasons.includes('cancel_scheduled'));
  assert.equal(result.nextCheckAt, NOW + 29 * 86400_000 + 2 * H);
});

test('canceled, unpaid, paused, incomplete and incomplete_expired grant nothing', () => {
  for (const status of ['canceled', 'unpaid', 'paused', 'incomplete', 'incomplete_expired']) {
    assert.deepEqual(roles(access({ subscriptions: [sub({ status })] })), [], status);
  }
  assert.ok(access({ subscriptions: [sub({ status: 'canceled' })] }).reasons.includes('sub_ended'));
});

test('past_due grace: daily 2 h (1h59m in, 2h+1ms out), weekly 12 h, monthly 72 h', () => {
  const at = (pkg, elapsedMs) => computeAccess({ snapshot: { subscriptions: [sub({ status: 'past_due', price: price(pkg), periodStart: sec(NOW - elapsedMs) })] }, now: NOW, livemode: true });
  const start = sec(NOW);
  const daily = (nowMs) => computeAccess({ snapshot: { subscriptions: [sub({ status: 'past_due', price: price('daily'), periodStart: start })] }, now: nowMs, livemode: true });
  assert.deepEqual(roles(daily(start * 1000 + 2 * H - 60_000)), ['academy'], '1h59m keeps access');
  assert.deepEqual(roles(daily(start * 1000 + 2 * H + 1)), [], '2h+1ms revokes');
  assert.ok(daily(start * 1000 + 2 * H + 1).reasons.includes('past_due_grace_expired'));
  assert.deepEqual(roles(at('weekly', 11 * H)), ['academy']);
  assert.deepEqual(roles(at('weekly', 12 * H + 1000)), []);
  assert.deepEqual(roles(at('monthly', 71 * H)), ['academy']);
  assert.deepEqual(roles(at('monthly', 72 * H + 1000)), []);
  const graced = at('weekly', 2 * H);
  assert.equal(graced.nextCheckAt, sec(NOW - 2 * H) * 1000 + 12 * H);
});

test('the current period charge fully refunded stops the subscription counting', () => {
  const result = access({ subscriptions: [sub()], charges: chargeMap({ id: 'ch_cur', fullyRefunded: true }) });
  assert.deepEqual(roles(result), []);
  assert.ok(result.reasons.includes('current_period_refunded'));
  assert.deepEqual(result.refundedSubs, [{ subscriptionId: 'sub_1', chargeId: 'ch_cur', status: 'active' }]);
  /* a later paid invoice with a NEW charge restores it */
  const renewed = access({ subscriptions: [sub({ currentPeriodChargeId: 'ch_next' })], charges: chargeMap({ id: 'ch_cur', fullyRefunded: true }, { id: 'ch_next' }) });
  assert.deepEqual(roles(renewed), ['academy']);
});

test('a partial refund follows the flag', () => {
  const snapshot = { subscriptions: [sub()], charges: chargeMap({ id: 'ch_cur', partiallyRefunded: true }) };
  assert.deepEqual(roles(access(snapshot)), ['academy']);
  assert.ok(access(snapshot).reasons.includes('partial_refund_ignored'));
  assert.deepEqual(roles(access(snapshot, { partialRefundRevokes: true })), []);
});

test('per-price grants: memberships, lifetime roles, comps, disputes and the unmapped-price hold', () => {
  const external = [MONARCH, PREMIUM];
  const now = Date.parse('2026-10-05T12:00:00Z');
  const run = (snapshot, extra = {}) => computeAccess({ snapshot, now, externalRoleIds: external, ...extra });
  const premium = { id: 'sub_p', status: 'active', created: now / 1000 - 86400, periodStart: now / 1000 - 3600, periodEnd: now / 1000 + 86400 * 29,
    price: { priceId: 'price_p', package: 'monthly', academy: true, known: true, graceHours: 72, grantsAcademy: false, externalRoles: [PREMIUM], line: `roles:${PREMIUM}` } };
  const member = run({ subscriptions: [premium] });
  assert.deepEqual([[...member.roles], [...member.externalRoles]], [[], [PREMIUM]]);
  assert.deepEqual(member.externalSources.get(PREMIUM), ['sub_p']);
  assert.equal(member.externalHold, false);
  const life = run({ lifetime: [{ paymentIntentId: 'pi_l', status: 'succeeded', chargeId: 'ch_l', grant: { grantsAcademy: true, externalRoles: [MONARCH], line: 'academy' } }],
    charges: new Map([['ch_l', { id: 'ch_l' }]]) });
  assert.deepEqual([[...life.roles].sort(), [...life.externalRoles]], [['academy', 'mem_lifetime'], [MONARCH]]);
  assert.deepEqual(life.sources[0].externalRoles, [MONARCH]);
  /* an open dispute suspends the external roles of every Stripe source too; a comp still grants */
  const disputed = run({ lifetime: [{ paymentIntentId: 'pi_l', status: 'succeeded', chargeId: 'ch_l', grant: { grantsAcademy: true, externalRoles: [MONARCH] } }],
    charges: new Map([['ch_l', { id: 'ch_l', disputed: true }]]), disputes: [{ id: 'du', chargeId: 'ch_l', status: 'needs_response', paymentIntentId: 'pi_l' }],
    comps: [{ id: 3, grants_academy: false, external_role_ids: [PREMIUM, '1800000000000000001'], expires_at: null, revoked_at: null }] });
  assert.deepEqual([[...disputed.roles], [...disputed.externalRoles]], [[], [PREMIUM]], 'a comp role that is no longer external is ignored');
  assert.deepEqual(disputed.externalSources.get(PREMIUM), ['comp:3']);
  /* an unconfigured price, or a lifetime bought on one, holds every external revoke */
  assert.equal(run({ subscriptions: [{ ...premium, price: { ...premium.price, unmapped: true, grantsAcademy: true, externalRoles: [] } }] }).externalHold, true);
  assert.equal(run({ lifetime: [{ paymentIntentId: 'pi_x', status: 'succeeded', chargeId: null, grant: { grantsAcademy: true, externalRoles: [], unmapped: true } }] }).externalHold, true);
  /* without externalRoleIds nothing is filtered (unit callers) */
  assert.deepEqual([...computeAccess({ snapshot: { subscriptions: [premium] }, now }).externalRoles], [PREMIUM]);
});

test('lifetime: paid grants both roles; fully refunded grants none', () => {
  const paid = access({ lifetime: [{ paymentIntentId: 'pi_1', status: 'succeeded', chargeId: 'ch_l' }], charges: chargeMap({ id: 'ch_l' }) });
  assert.deepEqual(roles(paid), ['academy', 'mem_lifetime']);
  assert.equal(paid.nextCheckAt, null);
  const refunded = access({ lifetime: [{ paymentIntentId: 'pi_1', status: 'succeeded', chargeId: 'ch_l' }], charges: chargeMap({ id: 'ch_l', fullyRefunded: true }) });
  assert.deepEqual(roles(refunded), []);
  assert.deepEqual(refunded.lifetimeStates, [{ paymentIntentId: 'pi_1', chargeId: 'ch_l', state: 'refunded', academy: true, externalRoles: [], line: 'academy' }]);
  assert.deepEqual(roles(access({ lifetime: [{ paymentIntentId: 'pi_1', status: 'requires_payment_method', chargeId: null }] })), []);
});

test('disputes: open suspends all Stripe sources, comps still grant', () => {
  const base = {
    subscriptions: [sub()],
    lifetime: [{ paymentIntentId: 'pi_1', status: 'succeeded', chargeId: 'ch_l' }],
    charges: chargeMap({ id: 'ch_cur' }, { id: 'ch_l' }, { id: 'ch_old' }),
    comps: [{ id: 7, include_lifetime_role: false, expires_at: null, revoked_at: null, livemode: true }]
  };
  /* a dispute on an OLD renewal charge still suspends everything */
  const open = access({ ...base, disputes: [{ id: 'du_1', chargeId: 'ch_old', status: 'needs_response', subscriptionId: 'sub_1' }] });
  assert.deepEqual(roles(open), ['academy']);
  assert.ok(open.reasons.includes('dispute_open'));
  assert.equal(open.disputeOpen, true);
  const noComp = access({ ...base, comps: [], disputes: [{ id: 'du_1', chargeId: 'ch_old', status: 'warning_under_review' }] });
  assert.deepEqual(roles(noComp), []);
});

test('disputes: won restores; lost voids that source while a new subscription still works', () => {
  const base = { subscriptions: [sub()], charges: chargeMap({ id: 'ch_cur' }, { id: 'ch_old' }) };
  assert.deepEqual(roles(access({ ...base, disputes: [{ id: 'du_1', chargeId: 'ch_old', status: 'won', subscriptionId: 'sub_1' }] })), ['academy']);
  assert.deepEqual(roles(access({ ...base, disputes: [{ id: 'du_1', chargeId: 'ch_old', status: 'lost', subscriptionId: 'sub_1' }] })), []);
  const fresh = access({
    subscriptions: [sub({ status: 'canceled' }), sub({ id: 'sub_2', currentPeriodChargeId: 'ch_new', created: sec(NOW - H) })],
    charges: chargeMap({ id: 'ch_old', created: sec(NOW - 20 * 86400_000) }, { id: 'ch_new' }),
    disputes: [{ id: 'du_1', chargeId: 'ch_old', status: 'lost', subscriptionId: 'sub_1' }]
  });
  assert.deepEqual(roles(fresh), ['academy']);
  const lifetimeLost = access({ lifetime: [{ paymentIntentId: 'pi_1', status: 'succeeded', chargeId: 'ch_l' }], charges: chargeMap({ id: 'ch_l' }),
    disputes: [{ id: 'du_2', chargeId: 'ch_l', status: 'lost', paymentIntentId: 'pi_1' }] });
  assert.deepEqual(roles(lifetimeLost), []);
  assert.equal(lifetimeLost.lifetimeStates[0].state, 'dispute_lost');
});

test('an unattributed lost dispute voids only subscriptions that existed at the charge', () => {
  const result = access({
    subscriptions: [sub({ id: 'sub_old', created: sec(NOW - 40 * 86400_000) }), sub({ id: 'sub_new', created: sec(NOW - H), currentPeriodChargeId: 'ch_new' })],
    charges: chargeMap({ id: 'ch_cur' }, { id: 'ch_new' }),
    disputes: [{ id: 'du_1', chargeId: 'ch_x', status: 'lost', chargeCreated: sec(NOW - 30 * 86400_000) }]
  });
  assert.deepEqual(roles(result), ['academy']);
  assert.deepEqual(result.sources.map((s) => s.id), ['sub_new']);
});

test('union: canceled monthly + lifetime keeps both; canceled monthly + comp keeps academy', () => {
  const lifetime = { lifetime: [{ paymentIntentId: 'pi_1', status: 'succeeded', chargeId: 'ch_l' }], charges: chargeMap({ id: 'ch_l' }) };
  assert.deepEqual(roles(access({ subscriptions: [sub({ status: 'canceled' })], ...lifetime })), ['academy', 'mem_lifetime']);
  const comp = { comps: [{ id: 1, include_lifetime_role: false, expires_at: new Date(NOW + 86400_000), revoked_at: null, livemode: true }] };
  const withComp = access({ subscriptions: [sub({ status: 'canceled' })], ...comp });
  assert.deepEqual(roles(withComp), ['academy']);
  assert.equal(withComp.nextCheckAt, NOW + 86400_000);
});

test('comps: expired, revoked or wrong livemode grant nothing; include_lifetime_role grants both', () => {
  const c = (extra) => ({ id: 1, include_lifetime_role: false, expires_at: null, revoked_at: null, livemode: true, ...extra });
  assert.deepEqual(roles(access({ comps: [c({ expires_at: new Date(NOW - 1) })] })), []);
  assert.deepEqual(roles(access({ comps: [c({ revoked_at: new Date(NOW - 1) })] })), []);
  assert.deepEqual(roles(access({ comps: [c({ livemode: false })] })), []);
  assert.deepEqual(roles(access({ comps: [c({ include_lifetime_role: true })] })), ['academy', 'mem_lifetime']);
});

test('a Discord SKU entitlement counts as a source (phase 2 input)', () => {
  assert.deepEqual(roles(access({ skuEntitlements: [{ skuId: '1', package: 'monthly', endsAt: NOW + H }] })), ['academy']);
  assert.deepEqual(roles(access({ skuEntitlements: [{ skuId: '2', package: 'lifetime', endsAt: null }] })), ['academy', 'mem_lifetime']);
  assert.deepEqual(roles(access({ skuEntitlements: [{ skuId: '1', package: 'monthly', endsAt: NOW - 1 }] })), []);
});

test('prices: a non-Academy price is ignored; retired and UNMAPPED Academy prices still entitle', () => {
  assert.deepEqual(roles(access({ subscriptions: [sub({ price: { priceId: 'price_store', academy: false } })] })), []);
  assert.deepEqual(roles(access({ subscriptions: [sub({ price: price('monthly', { priceId: 'price_monthold', sell: false }) })] })), ['academy']);
  const unmapped = access({ subscriptions: [sub({ price: price('monthly', { priceId: 'price_promo1', known: false, unmapped: true }) })] });
  assert.deepEqual(roles(unmapped), ['academy']);
  assert.deepEqual(unmapped.unmapped, ['price_promo1']);
  assert.ok(unmapped.reasons.includes('config_unmapped_price'));
});

test('a binding conflict suppresses Stripe sources but keeps comps', () => {
  const result = access({ subscriptions: [sub()], comps: [{ id: 1, include_lifetime_role: false, livemode: true }] }, { stripeSuppressed: true });
  assert.deepEqual(roles(result), ['academy']);
  assert.deepEqual(roles(access({ subscriptions: [sub()] }, { stripeSuppressed: true })), []);
});

/* ---------------------------- planRoleDiff ---------------------------- */

const ENGINE = { academy: ACADEMY_ROLE, mem_lifetime: LIFETIME_ROLE };

test('planRoleDiff only ever emits the two engine role ids', () => {
  const plan = planRoleDiff({ desired: new Set(), member: { inGuild: true, roles: [MONARCH, PREMIUM, '1111111111111111111', ACADEMY_ROLE] }, engineRoleIds: ENGINE });
  assert.deepEqual(plan.ops, [{ roleKey: 'academy', roleId: ACADEMY_ROLE, desired: false, awaitingMember: false }]);
  const grant = planRoleDiff({ desired: new Set(['academy', 'mem_lifetime']), member: { inGuild: true, roles: [MONARCH] }, engineRoleIds: ENGINE });
  assert.deepEqual(grant.ops.map((o) => o.roleId), [ACADEMY_ROLE, LIFETIME_ROLE]);
  assert.ok(grant.ops.every((o) => o.desired));
});

test('planRoleDiff: a held role is a no-op; unknown observation plans nothing; absent member awaits', () => {
  assert.deepEqual(planRoleDiff({ desired: new Set(['academy']), member: { inGuild: true, roles: [ACADEMY_ROLE] }, engineRoleIds: ENGINE }).ops, []);
  assert.deepEqual(planRoleDiff({ desired: new Set(['academy']), member: null, engineRoleIds: ENGINE }).ops, []);
  const absent = planRoleDiff({ desired: new Set(['academy']), member: { inGuild: false, roles: [] }, engineRoleIds: ENGINE });
  assert.deepEqual(absent.ops, [{ roleKey: 'academy', roleId: ACADEMY_ROLE, desired: true, awaitingMember: true }]);
});

test('planRoleDiff defers revokes when revokes are not allowed', () => {
  const plan = planRoleDiff({ desired: new Set(), member: { inGuild: true, roles: [ACADEMY_ROLE, LIFETIME_ROLE] }, engineRoleIds: ENGINE, allowRevokes: false });
  assert.deepEqual(plan.ops, []);
  assert.equal(plan.deferredRevokes, 2);
});

/* ------------------------------- brakes ------------------------------- */

test('brakes: zero revokes when Stripe was incomplete (cannot be forced)', () => {
  assert.deepEqual(applyBrakes({ stripeComplete: false, plannedRevokes: 1 }), { revokesAllowed: false, brake: 'stripe_incomplete' });
  assert.deepEqual(applyBrakes({ stripeComplete: false, plannedRevokes: 1, forceBreaker: true }), { revokesAllowed: false, brake: 'stripe_incomplete' });
});

test('brakes: the per-run cap', () => {
  assert.equal(applyBrakes({ stripeComplete: true, plannedRevokes: 10, maxRevokes: 10 }).revokesAllowed, true);
  assert.deepEqual(applyBrakes({ stripeComplete: true, plannedRevokes: 11, maxRevokes: 10 }), { revokesAllowed: false, brake: 'revoke_cap' });
  assert.equal(applyBrakes({ stripeComplete: true, plannedRevokes: 11, maxRevokes: 10, forceBreaker: true }).revokesAllowed, true);
});

test('brakes: the watermark trips on a drop of at least max(5, 50%)', () => {
  assert.deepEqual(applyBrakes({ stripeComplete: true, previousEntitled: 20, entitledNow: 10 }), { revokesAllowed: false, brake: 'watermark' });
  assert.equal(applyBrakes({ stripeComplete: true, previousEntitled: 20, entitledNow: 11 }).revokesAllowed, true);
  assert.deepEqual(applyBrakes({ stripeComplete: true, previousEntitled: 10, entitledNow: 0 }), { revokesAllowed: false, brake: 'watermark' });
  /* the owner's own refund at launch (1 -> 0) does not trip it */
  assert.equal(applyBrakes({ stripeComplete: true, previousEntitled: 1, entitledNow: 0 }).revokesAllowed, true);
  assert.equal(applyBrakes({ stripeComplete: true, previousEntitled: 4, entitledNow: 0 }).revokesAllowed, true);
  assert.equal(applyBrakes({ stripeComplete: true, previousEntitled: 20, entitledNow: 5, forceBreaker: true }).revokesAllowed, true);
  assert.equal(applyBrakes({ stripeComplete: true, previousEntitled: null, entitledNow: 0 }).revokesAllowed, true);
});

test('a live plan voided by a lost dispute is listed in voidedSubs (attributed, unattributed, current charge)', () => {
  const attributed = access({ subscriptions: [sub()], charges: chargeMap({ id: 'ch_cur' }, { id: 'ch_old' }),
    disputes: [{ id: 'du_1', chargeId: 'ch_old', status: 'lost', subscriptionId: 'sub_1' }] });
  assert.deepEqual(attributed.voidedSubs, [{ subscriptionId: 'sub_1', chargeId: 'ch_old', status: 'active' }]);
  const unattributed = access({ subscriptions: [sub({ created: sec(NOW - 40 * 86400_000) })], charges: chargeMap({ id: 'ch_cur' }),
    disputes: [{ id: 'du_1', chargeId: 'ch_x', status: 'lost', chargeCreated: sec(NOW - 30 * 86400_000) }] });
  assert.deepEqual(unattributed.voidedSubs, [{ subscriptionId: 'sub_1', chargeId: 'ch_x', status: 'active' }]);
  const current = access({ subscriptions: [sub()], charges: chargeMap({ id: 'ch_cur' }),
    disputes: [{ id: 'du_1', chargeId: 'ch_cur', status: 'lost' }] });
  assert.deepEqual(roles(current), []);
  assert.deepEqual(current.voidedSubs, [{ subscriptionId: 'sub_1', chargeId: 'ch_cur', status: 'active' }]);
  assert.deepEqual(access({ subscriptions: [sub()], charges: chargeMap({ id: 'ch_cur' }) }).voidedSubs, []);
  const won = access({ subscriptions: [sub()], charges: chargeMap({ id: 'ch_cur' }, { id: 'ch_old' }),
    disputes: [{ id: 'du_1', chargeId: 'ch_old', status: 'won', subscriptionId: 'sub_1' }] });
  assert.deepEqual(won.voidedSubs, []);
});

/* ---------------------------------------------------------------------------
 * Lifetime paid by bank debit (ACH, us_bank_account): delayed notification.
 * ------------------------------------------------------------------------ */

test('lifetime bank debit: processing or awaiting microdeposits grants nothing, is pending and re-checked hourly', () => {
  for (const pi of [
    { paymentIntentId: 'pi_ach', status: 'processing', chargeId: 'ch_ach' },
    { paymentIntentId: 'pi_ach', status: 'requires_action', nextAction: 'verify_with_microdeposits', chargeId: null }
  ]) {
    const result = access({ lifetime: [pi], charges: chargeMap({ id: 'ch_ach' }) });
    assert.deepEqual(roles(result), [], pi.status);
    assert.deepEqual(result.pendingLifetime.map((p) => p.paymentIntentId), ['pi_ach']);
    assert.ok(result.reasons.includes('lifetime_payment_processing'));
    assert.deepEqual(result.lifetimeStates, [], 'nothing to cache until the debit clears');
    assert.equal(result.sources.some((s) => s.kind === 'lifetime'), false);
    assert.equal(result.nextCheckAt, NOW + H);
  }
  /* a card PaymentIntent waiting for 3-D Secure is not a pending bank debit */
  const threeDs = access({ lifetime: [{ paymentIntentId: 'pi_3ds', status: 'requires_action', nextAction: 'use_stripe_sdk' }] });
  assert.deepEqual([roles(threeDs), threeDs.pendingLifetime.length], [[], 0]);
  /* a debit that failed before clearing (requires_payment_method / canceled) */
  for (const status of ['requires_payment_method', 'canceled']) {
    const failed = access({ lifetime: [{ paymentIntentId: 'pi_ach', status, chargeId: 'ch_ach' }], charges: chargeMap({ id: 'ch_ach', failed: true }) });
    assert.deepEqual([roles(failed), failed.pendingLifetime.length], [[], 0], status);
  }
});

test('lifetime bank debit: succeeded grants both roles; a charge that later reads failed grants none', () => {
  const paid = access({ lifetime: [{ paymentIntentId: 'pi_ach', status: 'succeeded', chargeId: 'ch_ach' }], charges: chargeMap({ id: 'ch_ach' }) });
  assert.deepEqual(roles(paid), ['academy', 'mem_lifetime']);
  assert.deepEqual(paid.pendingLifetime, []);
  const bounced = access({ lifetime: [{ paymentIntentId: 'pi_ach', status: 'succeeded', chargeId: 'ch_ach' }], charges: chargeMap({ id: 'ch_ach', failed: true }) });
  assert.deepEqual(roles(bounced), []);
  assert.ok(bounced.reasons.includes('lifetime_payment_failed'));
  assert.equal(bounced.sources.some((s) => s.kind === 'lifetime'), false);
});

test('lifetime bank debit returned after it succeeded (Stripe opens a dispute): suspended while open, void once lost', () => {
  const pi = { paymentIntentId: 'pi_ach', status: 'succeeded', chargeId: 'ch_ach' };
  const charges = chargeMap({ id: 'ch_ach' });
  for (const [status, reason] of [['needs_response', 'dispute_open'], ['lost', 'lifetime_dispute_lost']]) {
    const result = access({ lifetime: [pi], charges, disputes: [{ id: 'du_ach', chargeId: 'ch_ach', paymentIntentId: 'pi_ach', status }] });
    assert.deepEqual(roles(result), [], status);
    assert.ok(result.reasons.includes(reason), `${status}: ${result.reasons}`);
  }
  /* a comp still grants the Academy role through it */
  const comped = access({ lifetime: [pi], charges, disputes: [{ id: 'du_ach', chargeId: 'ch_ach', paymentIntentId: 'pi_ach', status: 'lost' }],
    comps: [{ id: 1, include_lifetime_role: false, expires_at: null, revoked_at: null, livemode: true }] });
  assert.deepEqual(roles(comped), ['academy']);
});
