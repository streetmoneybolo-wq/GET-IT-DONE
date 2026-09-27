'use strict';

/* =============================================================================
 * MEM Academy billing: the access rule.
 *
 * PURE. No I/O, no clock of its own. Given one customer's normalized Stripe
 * snapshot plus comps (and, in phase 2, Discord SKU entitlements), decide which
 * engine roles the member should hold, which external roles an engine source
 * still entitles, and why.
 *
 * Access is a UNION: a role is desired while ANY source grants it. So a
 * cancelled monthly next to a paid lifetime keeps both roles, and a comp keeps
 * the Academy role through a dispute.
 *
 *   subscription  active | trialing                      -> academy (a free
 *                                                            trial entitles)
 *                 cancel_at_period_end while active       -> academy (until it ends)
 *                 past_due                                -> academy until
 *                                                            period_start + grace
 *                 past_due after a free trial that was
 *                 never paid (the first period after the
 *                 trial, or ANY later one while no invoice
 *                 was ever paid with money)               -> none (no grace)
 *                 unpaid | paused | incomplete | incomplete_expired | canceled -> none
 *                 the charge that paid the CURRENT period fully refunded -> none
 *   lifetime      PaymentIntent succeeded, charge not refunded -> academy + mem_lifetime
 *                 PaymentIntent processing (a bank debit that has not cleared),
 *                 or waiting for microdeposit verification -> NOTHING yet; it
 *                 is listed in pendingLifetime and re-checked hourly
 *                 its latest charge reads failed (a returned debit)  -> none
 *   dispute       ANY open dispute on the customer's charges suspends EVERY
 *                 Stripe-derived source (comps and SKUs are unaffected);
 *                 won -> lifted; lost -> that source is void for good (a
 *                 voided plan that Stripe still bills is listed in
 *                 voidedSubs, so resync cancels or flags it like a refund)
 *   comp          until expires_at                        -> academy (+ lifetime role)
 *
 * What a source grants comes from its price entry (SML_ACADEMY_BILLING_PRICES_JSON):
 * "academy" (default true) grants the engine-owned Academy Student role (and,
 * for lifetime, the optional lifetime role); "roles" lists EXTERNAL roles
 * (Monarch / Elite / Premium) returned in externalRoles. External roles are
 * GRANT-ONLY-UNLESS-SAFE (external.js): this rule only says whether an engine
 * source still entitles them. A price missing from the config (or a lifetime
 * PaymentIntent whose price is missing) still grants the Academy role but
 * sets externalHold, so no external role is ever removed on its account.
 * ========================================================================== */

const { rolesFor } = require('./catalog');
const { disputeState } = require('./stripe-shapes');

const ROLE_KEYS = Object.freeze(['academy', 'mem_lifetime']);
const ENTITLING_STATUSES = Object.freeze(['active', 'trialing']);
const PERIOD_END_SLACK_MS = 2 * 3600_000;
/* The first paid period of a trial subscription starts at the trial end. */
const TRIAL_PERIOD_MATCH_MS = 3600_000;
/* A lifetime paid by bank debit (ACH) is 'processing' for up to four business
   days. The webhook (checkout.session.async_payment_succeeded) is the fast
   path; this re-check makes the grant independent of it. */
const LIFETIME_PENDING_RECHECK_MS = 3600_000;

/** A lifetime PaymentIntent whose money has not arrived yet: a bank debit in
 *  flight, or a bank account waiting for microdeposit verification. */
function lifetimePending(pi) {
  if (!pi) return false;
  if (pi.status === 'processing') return true;
  return pi.status === 'requires_action' && pi.nextAction === 'verify_with_microdeposits';
}

/** What one price grants: { academy, roles, line }. Missing = the Academy only. */
function grantOf(value) {
  const academy = !value || value.grantsAcademy !== false;
  const roles = value && Array.isArray(value.externalRoles) ? value.externalRoles.map(String) : [];
  return { academy, roles, line: value && value.line ? String(value.line) : (academy ? 'academy' : `roles:${[...roles].sort().join('+')}`) };
}

/** A past_due subscription that had a free trial and was never paid: Stripe
 *  keeps opening a new period (and invoice) while its retries run, so "the
 *  first period after the trial" alone is not enough. sub.everPaid (resync:
 *  any paid invoice with money) decides when known; when it is not known
 *  (null), only the first period after the trial counts as unpaid. */
function trialEndedUnpaid(sub) {
  const trialEnd = toMs(sub && sub.trialEnd);
  if (trialEnd === null) return false;
  if (sub.everPaid === false) return true;
  if (sub.everPaid === true) return false;
  const periodStart = toMs(sub && sub.periodStart);
  if (periodStart === null) return false;
  return periodStart >= trialEnd - 60_000 && periodStart - trialEnd <= TRIAL_PERIOD_MATCH_MS;
}

function toMs(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  const n = Number(value);
  if (!Number.isFinite(n)) {
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }
  /* Stripe sends seconds; everything else here is milliseconds. */
  return n < 1e12 ? n * 1000 : n;
}

/**
 * snapshot = {
 *   subscriptions: [{ id, status, created, cancelAtPeriodEnd, cancelAt, periodStart, periodEnd, trialStart, trialEnd, everPaid,
 *                     price: { priceId, package, academy, known, graceHours, unmapped },
 *                     currentPeriodChargeId }],
 *   lifetime:      [{ paymentIntentId, status, nextAction, chargeId, created }],
 *   charges:       Map(chargeId -> { id, fullyRefunded, partiallyRefunded, failed, created }),
 *   disputes:      [{ id, chargeId, status, paymentIntentId, subscriptionId, chargeCreated }],
 *   comps:         [{ id, include_lifetime_role, grants_academy, external_role_ids, expires_at, revoked_at, livemode }],
 *   skuEntitlements: [{ skuId, package, endsAt }]
 * }
 * A subscription's price and a lifetime's `grant` carry { grantsAcademy,
 * externalRoles, line } from the price entry (catalog.js). externalRoleIds
 * (config) filters the external roles any source may name.
 *
 * Returns roles (engine role keys), externalRoles (role ids an engine source
 * still entitles), externalSources (role id -> source refs), externalHold (an
 * unconfigured price is present: no external revoke), plus the fields below.
 */
function computeAccess({ snapshot = {}, now, partialRefundRevokes = false, livemode = true, stripeSuppressed = false,
  externalRoleIds = null } = {}) {
  if (!Number.isFinite(now)) throw new TypeError('computeAccess: now (ms) is required');
  const roles = new Set();
  const externalRoles = new Set();
  const externalSources = new Map();
  const stripeExternal = new Map();
  let externalHold = false;
  const external = externalRoleIds ? new Set(externalRoleIds.map(String)) : null;
  const addExternal = (target, roleId, ref) => {
    if (external && !external.has(String(roleId))) return;
    if (!target.has(String(roleId))) target.set(String(roleId), []);
    target.get(String(roleId)).push(ref);
  };
  const reasons = [];
  const refs = [];
  const sources = [];
  const unmapped = [];
  const refundedSubs = [];
  const voidedSubs = [];
  const lifetimeStates = [];
  const pendingLifetime = [];
  const nextChecks = [];

  const charges = snapshot.charges instanceof Map ? snapshot.charges : new Map();
  const disputes = Array.isArray(snapshot.disputes) ? snapshot.disputes : [];

  const openDisputes = disputes.filter((d) => disputeState(d.status) === 'open');
  const lost = disputes.filter((d) => disputeState(d.status) === 'lost');
  const lostSubs = new Set(lost.map((d) => d.subscriptionId).filter(Boolean));
  const lostPis = new Set(lost.map((d) => d.paymentIntentId).filter(Boolean));
  const lostCharges = new Set(lost.map((d) => d.chargeId).filter(Boolean));
  /* A lost dispute we could not attribute to a subscription or lifetime
     payment voids every subscription that already existed when the disputed
     charge was made. A LATER purchase is unaffected. */
  const unattributedLostAt = lost
    .filter((d) => !d.subscriptionId && !d.paymentIntentId)
    .map((d) => toMs(d.chargeCreated))
    .filter((v) => v !== null);
  const disputeOpen = openDisputes.length > 0;
  for (const d of disputes) refs.push(d.id);

  const stripeGrants = new Set();

  for (const sub of Array.isArray(snapshot.subscriptions) ? snapshot.subscriptions : []) {
    const price = sub.price || {};
    if (!price.academy) continue;
    const pkg = price.package || 'monthly';
    refs.push(sub.id);
    if (price.unmapped) {
      unmapped.push(price.priceId);
      reasons.push('config_unmapped_price');
      externalHold = true;
    }
    const grant = grantOf(price);
    const createdMs = toMs(sub.created);
    const status = String(sub.status || '');
    if (lostSubs.has(sub.id) || (createdMs !== null && unattributedLostAt.some((at) => createdMs <= at))) {
      reasons.push('dispute_lost');
      const lostOn = lost.find((d) => d.subscriptionId === sub.id)
        || lost.find((d) => !d.subscriptionId && !d.paymentIntentId && createdMs !== null && toMs(d.chargeCreated) >= createdMs);
      voidedSubs.push({ subscriptionId: sub.id, chargeId: lostOn ? lostOn.chargeId : null, status });
      continue;
    }
    let entitled = false;
    let reason = `sub_${status || 'unknown'}`;
    if (ENTITLING_STATUSES.includes(status)) {
      entitled = true;
      reason = `sub_${status}:${pkg}`;
    } else if (status === 'past_due') {
      const startMs = toMs(sub.periodStart);
      const graceEnd = startMs === null ? null : startMs + Number(price.graceHours || 0) * 3600_000;
      if (trialEndedUnpaid(sub)) {
        /* The free trial ended and nothing was ever paid (its first charge,
           or any retry since, failed): there is no grace period to give. */
        reason = 'trial_ended_unpaid';
      } else if (graceEnd !== null && now < graceEnd) {
        entitled = true;
        reason = `past_due_grace:${pkg}`;
        nextChecks.push(graceEnd);
      } else {
        reason = 'past_due_grace_expired';
      }
    } else if (status === 'canceled' || status === 'incomplete_expired') {
      reason = 'sub_ended';
    }
    if (entitled && sub.currentPeriodChargeId) {
      const charge = charges.get(sub.currentPeriodChargeId);
      if (charge && (lostCharges.has(charge.id))) {
        entitled = false;
        reason = 'dispute_lost';
        voidedSubs.push({ subscriptionId: sub.id, chargeId: charge.id, status });
      } else if (charge && charge.fullyRefunded) {
        entitled = false;
        reason = 'current_period_refunded';
        refundedSubs.push({ subscriptionId: sub.id, chargeId: charge.id, status });
      } else if (charge && charge.partiallyRefunded) {
        if (partialRefundRevokes) {
          entitled = false;
          reason = 'current_period_partially_refunded';
          refundedSubs.push({ subscriptionId: sub.id, chargeId: charge.id, status, partial: true });
        } else {
          reasons.push('partial_refund_ignored');
        }
      }
    }
    if (entitled && (sub.cancelAtPeriodEnd || sub.cancelAt)) reasons.push('cancel_scheduled');
    reasons.push(reason);
    if (entitled) {
      const endMs = toMs(sub.cancelAt) || toMs(sub.periodEnd);
      if (endMs !== null) nextChecks.push(endMs + PERIOD_END_SLACK_MS);
      if (grant.academy) for (const role of rolesFor(pkg === 'lifetime' ? 'monthly' : pkg)) stripeGrants.add(role);
      for (const roleId of grant.roles) addExternal(stripeExternal, roleId, sub.id);
      sources.push({ kind: 'subscription', id: sub.id, package: pkg, roles: grant.academy ? ['academy'] : [], externalRoles: grant.roles, line: grant.line });
    }
  }

  for (const pi of Array.isArray(snapshot.lifetime) ? snapshot.lifetime : []) {
    /* pi.grant: the lifetime price entry's grants (resync resolves it from
       the PaymentIntent's mem_academy_price); none = the Academy lifetime. */
    const grant = grantOf(pi.grant);
    if (pi.grant && pi.grant.unmapped) externalHold = true;
    if (lifetimePending(pi)) {
      /* Paid by bank debit and not cleared yet: no role until it succeeds. */
      refs.push(pi.paymentIntentId);
      pendingLifetime.push({ paymentIntentId: pi.paymentIntentId, status: pi.status, nextAction: pi.nextAction || null,
        academy: grant.academy, externalRoles: grant.roles, line: grant.line });
      reasons.push('lifetime_payment_processing');
      nextChecks.push(now + LIFETIME_PENDING_RECHECK_MS);
      continue;
    }
    if (pi.status !== 'succeeded') continue;
    refs.push(pi.paymentIntentId);
    const charge = pi.chargeId ? charges.get(pi.chargeId) : null;
    if (charge && charge.failed) {
      /* Stripe reports a returned bank debit as a dispute, but a charge that
         reads failed is never counted as paid either. Not cached: the
         lifetime table has no failed state, and access never reads it. */
      reasons.push('lifetime_payment_failed');
      continue;
    }
    const chargeDisputes = disputes.filter((d) => (pi.chargeId && d.chargeId === pi.chargeId) || d.paymentIntentId === pi.paymentIntentId);
    let state = 'paid';
    if (chargeDisputes.some((d) => disputeState(d.status) === 'open')) state = 'disputed';
    else if (chargeDisputes.some((d) => disputeState(d.status) === 'lost')) state = 'dispute_lost';
    else if (chargeDisputes.some((d) => disputeState(d.status) === 'won')) state = 'dispute_won';
    if (charge && charge.fullyRefunded) state = 'refunded';
    else if (charge && charge.partiallyRefunded && state === 'paid') state = 'partially_refunded';
    lifetimeStates.push({ paymentIntentId: pi.paymentIntentId, chargeId: pi.chargeId || null, state,
      academy: grant.academy, externalRoles: grant.roles, line: grant.line });

    if (lostPis.has(pi.paymentIntentId) || state === 'dispute_lost') { reasons.push('lifetime_dispute_lost'); continue; }
    if (state === 'refunded') { reasons.push('lifetime_refunded'); continue; }
    if (state === 'partially_refunded' && partialRefundRevokes) { reasons.push('lifetime_partially_refunded'); continue; }
    reasons.push('lifetime_paid');
    const lifetimeRoles = grant.academy ? rolesFor('lifetime') : [];
    for (const role of lifetimeRoles) stripeGrants.add(role);
    for (const roleId of grant.roles) addExternal(stripeExternal, roleId, pi.paymentIntentId);
    sources.push({ kind: 'lifetime', id: pi.paymentIntentId, package: 'lifetime', roles: lifetimeRoles, externalRoles: grant.roles, line: grant.line });
  }

  if (disputeOpen) {
    reasons.push('dispute_open');
    for (const d of openDisputes) refs.push(d.chargeId);
  } else if (stripeSuppressed) {
    reasons.push('stripe_sources_suppressed');
  } else {
    for (const role of stripeGrants) roles.add(role);
    for (const [roleId, list] of stripeExternal) for (const ref of list) addExternal(externalSources, roleId, ref);
  }

  for (const comp of Array.isArray(snapshot.comps) ? snapshot.comps : []) {
    if (comp.livemode !== undefined && Boolean(comp.livemode) !== Boolean(livemode)) continue;
    if (comp.revoked_at) continue;
    const expires = toMs(comp.expires_at);
    if (expires !== null && expires <= now) continue;
    const compRoles = [];
    if (comp.grants_academy !== false) compRoles.push('academy');
    if (comp.include_lifetime_role) compRoles.push('mem_lifetime');
    for (const role of compRoles) roles.add(role);
    const compExternal = Array.isArray(comp.external_role_ids) ? comp.external_role_ids.map(String) : [];
    for (const roleId of compExternal) addExternal(externalSources, roleId, `comp:${comp.id}`);
    reasons.push('comp');
    sources.push({ kind: 'comp', id: String(comp.id), package: null, roles: compRoles, externalRoles: compExternal });
    if (expires !== null) nextChecks.push(expires);
  }

  for (const sku of Array.isArray(snapshot.skuEntitlements) ? snapshot.skuEntitlements : []) {
    const ends = toMs(sku.endsAt);
    if (ends !== null && ends <= now) continue;
    for (const role of rolesFor(sku.package === 'lifetime' ? 'lifetime' : 'monthly')) roles.add(role);
    reasons.push('discord_sku');
    sources.push({ kind: 'sku', id: String(sku.skuId), package: sku.package, roles: rolesFor(sku.package === 'lifetime' ? 'lifetime' : 'monthly') });
    if (ends !== null) nextChecks.push(ends);
  }

  if (!roles.size && !reasons.length) reasons.push('no_entitlement');
  const future = nextChecks.filter((at) => Number.isFinite(at) && at > now);
  for (const roleId of externalSources.keys()) externalRoles.add(roleId);
  return {
    roles,
    externalRoles,
    externalSources,
    externalHold,
    reasons: [...new Set(reasons)],
    refs: [...new Set(refs.filter(Boolean))],
    sources,
    unmapped: [...new Set(unmapped.filter(Boolean))],
    disputeOpen,
    refundedSubs,
    voidedSubs,
    lifetimeStates,
    pendingLifetime,
    nextCheckAt: future.length ? Math.min(...future) : null
  };
}

/**
 * Diff the desired role set against what Discord says the member holds.
 * member: null            -> the observation failed; plan NOTHING
 *         {inGuild:false} -> grants are recorded as awaiting the member
 *         {inGuild:true, roles:[...]}
 * Only the configured engine role ids are ever considered, whatever else the
 * member holds (Monarch, Premium, Elite and manager are invisible here; the
 * external roles have their own plan, planExternalDiff, and ledger rules).
 */
function planRoleDiff({ desired, member, engineRoleIds, allowRevokes = true } = {}) {
  const ops = [];
  let deferredRevokes = 0;
  if (!member || !engineRoleIds) return { ops, deferredRevokes };
  const want = desired instanceof Set ? desired : new Set(desired || []);
  const held = new Set(member.inGuild && Array.isArray(member.roles) ? member.roles.map(String) : []);
  for (const roleKey of ROLE_KEYS) {
    const roleId = engineRoleIds[roleKey];
    if (!roleId) continue;
    const wants = want.has(roleKey);
    const has = held.has(String(roleId));
    if (wants && !has) ops.push({ roleKey, roleId: String(roleId), desired: true, awaitingMember: !member.inGuild });
    else if (!wants && has) {
      if (allowRevokes) ops.push({ roleKey, roleId: String(roleId), desired: false, awaitingMember: false });
      else deferredRevokes += 1;
    }
  }
  return { ops, deferredRevokes };
}

/**
 * Reconciler brakes. Grants always flow; these only decide whether the run may
 * REVOKE.
 *   stripe_incomplete  any Stripe page failed (cannot be forced)
 *   revoke_cap         more planned revokes than the per-run cap
 *   watermark          the entitled count fell by at least max(5, 50%) since the
 *                      previous complete run (a 1 -> 0 drop after the owner's own
 *                      refund does not trip it)
 */
function applyBrakes({ stripeComplete, plannedRevokes = 0, maxRevokes = 10, previousEntitled = null,
  entitledNow = 0, forceBreaker = false } = {}) {
  if (!stripeComplete) return { revokesAllowed: false, brake: 'stripe_incomplete' };
  if (!forceBreaker && plannedRevokes > maxRevokes) return { revokesAllowed: false, brake: 'revoke_cap' };
  if (!forceBreaker && Number.isFinite(previousEntitled) && previousEntitled > 0) {
    const drop = previousEntitled - entitledNow;
    if (drop >= Math.max(5, Math.ceil(previousEntitled * 0.5))) return { revokesAllowed: false, brake: 'watermark' };
  }
  return { revokesAllowed: true, brake: null };
}

/**
 * Dry-run plan for EXTERNAL roles (no ledger writes, no Upgrade.Chat call):
 * a grant for every entitled role the member lacks; a revoke only for a role
 * the ledger says the engine granted to a member who did not hold it before
 * (the real decision also needs the Upgrade.Chat check).
 */
function planExternalDiff({ desired, member, grants = [], externalRoleIds = [], allowRevokes = true } = {}) {
  const ops = [];
  let deferredRevokes = 0;
  if (!member) return { ops, deferredRevokes };
  const want = desired instanceof Set ? desired : new Set(desired || []);
  const held = new Set(member.inGuild && Array.isArray(member.roles) ? member.roles.map(String) : []);
  const ledger = new Map((grants || []).map((row) => [String(row.role_id), row]));
  for (const roleId of externalRoleIds.map(String)) {
    const has = held.has(roleId);
    if (want.has(roleId)) {
      if (!has) ops.push({ roleKey: 'external', roleId, desired: true, awaitingMember: !member.inGuild });
      continue;
    }
    const row = ledger.get(roleId);
    if (!has || !row || row.had_role_before !== false || !['engine_granted', 'needs_review'].includes(row.state)) continue;
    if (allowRevokes) ops.push({ roleKey: 'external', roleId, desired: false, awaitingMember: false, needsUcCheck: true });
    else deferredRevokes += 1;
  }
  return { ops, deferredRevokes };
}

module.exports = { ROLE_KEYS, computeAccess, planRoleDiff, planExternalDiff, applyBrakes, toMs, lifetimePending, grantOf, trialEndedUnpaid,
  PERIOD_END_SLACK_MS, LIFETIME_PENDING_RECHECK_MS };
