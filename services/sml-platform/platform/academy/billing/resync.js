'use strict';

/* =============================================================================
 * MEM Academy billing: resync(discordId).
 *
 * The ONLY place a grant or revoke is decided. Webhooks, the success page, the
 * due-scan, the reconciler and the CLI all just call resync; event order,
 * duplicates, missing event types and payload API versions can therefore only
 * change latency, never the answer.
 *
 *   1. Fresh Stripe snapshot of the member's engine-created Customer, with NO
 *      DB client or lock held: subscriptions, payment intents and charges paged
 *      to the end, the newest PAID invoice of each live subscription (the
 *      current-period charge), and disputes on every disputed charge.
 *   2. Discord observation of the member (200 or Unknown Member only). Any
 *      other answer skips the ROLE planning only: the access cache and the
 *      Stripe billing rules below still run from the Stripe snapshot, then the
 *      Discord error is rethrown so the caller retries the role part.
 *   3. A SHORT transaction under the per-user advisory lock: comps, stale
 *      check, the pure computeAccess, role_state compare-and-write with a
 *      generation bump on every change, cache updates, then the audit rows.
 *   4. After COMMIT: kick the applier, then the Stripe billing rules (the
 *      per-price auto-stop "cancelAfterDays", which is the daily 3-charge cap
 *      by default, and which stops a free-only trial TRIAL_STOP_MARGIN_SEC
 *      before its trial ends, or cancels one Stripe already converted
 *      (before its first charge is collected when the engine is back within
 *      about an hour); lifetime supersedes recurring;
 *      cancel-on-refund and cancel-on-lost-dispute).
 *
 * FREE TRIALS: every subscription on the member's Customer that ever had a
 * trial is listed in the snapshot (snap.trials); the transaction records the
 * first one in academy_billing_trials (one free trial per Discord account,
 * checkout.js), and a trialing subscription entitles like an active one.
 *
 * THE OBSERVATION IS STALE BY DESIGN: it is read before the transaction, so an
 * applier call may land between the read and the write. A row that is queued
 * ('pending' / 'awaiting_member', possibly in flight) is therefore never
 * settled as 'synced' from it, and every change of the desired value of a
 * queued row bumps the generation AND queues an idempotent PUT/DELETE. The
 * applier's compare-and-set discards the older call's result; the newer
 * queued row then repairs whatever that call did. The outbox rows are also
 * read BEFORE the Discord read; a row that changed by the time of the
 * transaction (an applier call finished in between, for example during the
 * Upgrade.Chat check) is not decided from that read at all: a revoke of an
 * engine role, and any decision on an external role, waits for a fresh read
 * five minutes later.
 *
 * DRIFT REPAIR: every member with access is re-read at least once a day
 * (ENTITLED_RECHECK_MS), so a role that went missing (the member left and
 * rejoined the server, someone removed it) comes back without waiting for a
 * renewal; a lifetime has no renewal at all.
 *
 * FAIL CLOSED FOR REVOKES: if any Stripe call failed or any list hit its page
 * cap, or the binding is in conflict, or preflight has not confirmed the
 * Stripe account (revokeGate), grants still proceed but no revoke is written;
 * the member is re-checked in five minutes. A caller brake (allowRevokes=false:
 * the reconciler's revoke cap / watermark) also defers revokes but schedules NO
 * retry: a tripped brake stays tripped until a later unbraked reconcile or
 * reconcile --force-breaker.
 *
 * EXTERNAL ROLES (Monarch / Elite / Premium, see external.js) ride the same
 * outbox with role_key 'external', but their revokes are GRANT-ONLY-UNLESS-
 * SAFE: the ledger (academy_billing_external_grants) records at the first
 * grant decision whether the member already held the role, and a revoke is
 * decided only for an engine_granted row with had_role_before=false, when no
 * engine source entitles the role any more AND the Upgrade.Chat check (done
 * BEFORE the transaction, never under a lock) says no active UC membership
 * grants it. A role without a ledger row is never touched. Every fail-closed
 * rule above holds for them too, and a price missing from the config
 * (externalHold) holds every external revoke. A grant that is still queued
 * when the entitlement ends is withdrawn, never delivered. A revoke whose
 * DELETE did not land (failed, or held by the kill switch) is asked again and
 * re-queued; a DELETE that waits longer than UC_ANSWER_TTL_MS is sent only
 * after a fresh Upgrade.Chat answer. A role held before the engine's grant is
 * never removed; when it is gone anyway the row is 'released'.
 *
 * UC_MATCH=any: the Upgrade.Chat upgrade that keeps a role may be for another
 * product and another role, so Upgrade.Chat never removes the kept one. A row
 * kept that way (kept_external, had_role_before=false, uc_result active, not
 * a staff keep: external.ucKeptRecheckable) is asked again every
 * UC_KEPT_RECHECK_MS while the member holds the role, and is revoked like an
 * engine_granted row as soon as Upgrade.Chat shows no active upgrade at all.
 * When an engine source entitles the role again it goes back to
 * engine_granted (never 'held': the role on the member is the engine's own).
 * ========================================================================== */

const { computeAccess, planRoleDiff, planExternalDiff, grantOf, ROLE_KEYS } = require('./access');
const { ucRecheckDue, ucAnswerStale, ucKeptRecheckable, UC_RECHECK_MS, UC_KEPT_RECHECK_MS } = require('./external');
const shapes = require('./stripe-shapes');
const audit = require('./audit');
const { BONUS_ACADEMY_DAYS_MAX } = require('./config');

const SNOWFLAKE = /^[0-9]{15,24}$/;
const LIVE_SUB_STATUSES = Object.freeze(['active', 'trialing', 'past_due']);
const INCOMPLETE_RETRY_MS = 5 * 60_000;
const AWAITING_FIRST_BACKOFF_MS = 10 * 60_000;
/* A member with access is re-read at least this often (drift repair). */
const ENTITLED_RECHECK_MS = 24 * 3600_000;
const DAY_SEC = 86400;
/* MONEY SAFETY for a free trial that must never charge (Free Trial Access,
   owner decision 2026-09-26: a plain 3-day trial, trialDays 3 =
   cancelAfterDays 3). When a trial ends Stripe opens the first paid period,
   creates its invoice and charges it about an hour later with the default
   payment method of the subscription or of the Customer; the Checkout
   setting trial_settings.end_behavior.missing_payment_method=cancel only
   applies when neither has one, and a member may have saved a card on the
   engine Customer for an earlier plan. So a free-only trial is set to cancel
   this long before the earlier of its auto-stop and its trial end: Stripe
   cancels it while it is still trialing and never creates that invoice. */
const TRIAL_STOP_MARGIN_SEC = 10 * 60;
/* A free-only trial is also re-checked this long after its trial end, so a
   stop the engine missed (a lost webhook) is caught while the first invoice
   Stripe drafts at the trial end is still unpaid (it is charged about an
   hour later). */
const FREE_TRIAL_RECHECK_SEC = 5 * 60;

const QUEUED = (row) => Boolean(row) && (row.state === 'pending' || row.state === 'awaiting_member');
/* A revoke whose DELETE never landed: the row gave up, or the kill switch held it. */
const UNFINISHED = (row) => Boolean(row) && !row.desired && (row.state === 'failed' || row.state === 'suppressed');

/**
 * The auto-stop of one live subscription whose price has "cancelAfterDays"
 * `days`. Pure; times in Unix seconds.
 *   stop      subscription start + days (for a trial price, the trial start)
 *   freeOnly  it is trialing and its trial covers the whole auto-stop window:
 *             the trial it has, or the one its price offers, is at least
 *             `days` long (maxCharges 0, e.g. Free Trial Access). It must
 *             never reach an invoice.
 *   target    the cancel_at to set: stop; for a free-only trial
 *             min(stop, trial_end) - TRIAL_STOP_MARGIN_SEC
 *   done      it already ends in time, so nothing is written (idempotent,
 *             and an earlier cancel_at is never moved later): cancel_at at
 *             or before stop; for a free-only trial, cancel_at at or before
 *             its trial end AND at least the margin before stop. Stripe's
 *             classic billing mode moves trial_end to a cancel_at set before
 *             it, so after the engine's own write trial_end equals cancel_at;
 *             that state is final (the subscription is cancelled when its
 *             trial period ends, before any renewal) and is never re-moved.
 */
function autoStopPlan(sub, days, marginSec = TRIAL_STOP_MARGIN_SEC) {
  const stop = sub.startDate + days * DAY_SEC;
  let freeOnly = false;
  if (sub.status === 'trialing' && Number(sub.trialEnd) > 0) {
    const had = Math.round((sub.trialEnd - (sub.trialStart || sub.startDate)) / DAY_SEC);
    const offered = sub.price && Number.isInteger(sub.price.trialDays) ? sub.price.trialDays : null;
    freeOnly = had >= days || (offered !== null && offered >= days);
  }
  if (!freeOnly) return { stop, target: stop, freeOnly, done: Boolean(sub.cancelAt) && sub.cancelAt <= stop };
  const target = Math.min(stop, sub.trialEnd) - marginSec;
  const done = Boolean(sub.cancelAt) && sub.cancelAt <= sub.trialEnd && sub.cancelAt <= stop - marginSec;
  return { stop, target, freeOnly, done };
}

/**
 * THE SAFETY NET behind autoStopPlan: a free-only trial (the trial it had
 * covers the whole auto-stop window of `days`) that Stripe already converted,
 * because the engine never set its stop (it was down, or preflight blocked
 * the Stripe rules, for the whole trial) and the member has a default payment
 * method (without one Checkout's missing_payment_method=cancel ends it at the
 * trial end). At the trial end Stripe opened the first paid period and
 * created its invoice; it charges that invoice about an hour later. Either
 * way it is cancelled now (a DELETE: no idempotency-key replay, and access
 * ends, as the 3-day trial promised). Pure; times in Unix seconds.
 *   null       not such a subscription
 *   'cancel'   no paid invoice seen (everPaid false, or unknown). Stripe sets
 *              auto_advance=false on the subscription's draft and open
 *              invoices when it is cancelled, so the pending first invoice is
 *              never collected (docs.stripe.com/billing/subscriptions/cancel)
 *   'charged'  its first invoice was already paid: no second charge, and it
 *              is flagged for staff to refund
 */
function missedFreeTrialStop(sub, days, nowSec) {
  if (!['active', 'past_due'].includes(sub.status) || !(Number(sub.trialEnd) > 0) || sub.trialEnd > nowSec) return null;
  /* the same free-only test as autoStopPlan: the trial it had, or the one its price offers */
  const had = Math.round((sub.trialEnd - (sub.trialStart || sub.startDate)) / DAY_SEC);
  const offered = sub.price && Number.isInteger(sub.price.trialDays) ? sub.price.trialDays : null;
  if (!(had >= days || (offered !== null && offered >= days))) return null;
  return sub.everPaid === true ? 'charged' : 'cancel';
}

/**
 * Extra due-scan times (ms) for the free-only trials of a snapshot, so their
 * stop never depends on a webhook arriving: just before the stop time while
 * the stop is not set yet (the engine then sets it, or cancels at once), and
 * FREE_TRIAL_RECHECK_SEC after the trial end (missedFreeTrialStop). Pure.
 */
function freeTrialCheckTimes(subscriptions, nowMs) {
  const out = [];
  for (const sub of subscriptions || []) {
    const days = sub.price && Number.isInteger(sub.price.cancelAfterDays) ? sub.price.cancelAfterDays : null;
    if (!days || sub.status !== 'trialing' || !sub.startDate || !(Number(sub.trialEnd) > 0)) continue;
    const plan = autoStopPlan(sub, days);
    if (!plan.freeOnly) continue;
    if (!plan.done) out.push((plan.target - 120) * 1000);
    out.push((sub.trialEnd + FREE_TRIAL_RECHECK_SEC) * 1000);
  }
  return out.filter((at) => at > nowMs);
}

/** Did an outbox row change between the pre-read and the transaction? */
function rowChanged(pre, cur) {
  if (!pre && !cur) return false;
  if (!pre || !cur) return true;
  const at = (v) => (v ? new Date(v).getTime() : null);
  return pre.state !== cur.state || Boolean(pre.desired) !== Boolean(cur.desired) || Number(pre.generation) !== Number(cur.generation)
    || Number(pre.applied_generation || 0) !== Number(cur.applied_generation || 0) || at(pre.last_applied_at) !== at(cur.last_applied_at);
}

/**
 * Should the pre-transaction Upgrade.Chat check run for this ledger row (its
 * role no longer entitled)? row is the pre-read outbox row, has the Discord
 * read. ucAny: SML_ACADEMY_BILLING_UC_MATCH=any (a kept row is re-checked).
 */
function ucCheckWanted({ grant, row, has, nowMs, force = false, ucAny = false }) {
  /* 'any': kept on an upgrade that may grant another role (see the header):
     asked again while the member holds the role. */
  if (ucAny && ucKeptRecheckable(grant)) return has && ucRecheckDue(grant, nowMs, force);
  if (grant.state === 'engine_granted' || grant.state === 'needs_review') {
    if (!ucRecheckDue(grant, nowMs, force)) return false;
    /* engine-granted: before a revoke (the role, or a grant still queued) */
    if (grant.had_role_before === false) return has || (QUEUED(row) && row.desired);
    /* held before: never removed, but an active Upgrade.Chat membership settles it */
    return has;
  }
  if (grant.state === 'revoked' && grant.had_role_before === false && row && !row.desired) {
    /* a DELETE that did not land, while the role is still there */
    if (UNFINISHED(row)) return has;
    /* a DELETE still waiting, on an answer too old to send it on */
    if (QUEUED(row)) return force || ucAnswerStale(grant, nowMs);
  }
  return false;
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function normalizeCharge(charge) {
  return {
    id: charge.id,
    fullyRefunded: shapes.chargeFullyRefunded(charge),
    partiallyRefunded: shapes.chargePartiallyRefunded(charge),
    /* A bank debit that bounced (or any charge Stripe marks failed). */
    failed: charge.status === 'failed',
    disputed: charge.disputed === true,
    paymentIntentId: shapes.idOf(charge.payment_intent),
    invoiceId: shapes.chargeInvoiceId(charge),
    created: Number(charge.created) || null
  };
}

function createResync({ config, store, stripeApi, catalog, bot, logger = () => {}, now = Date.now,
  kickApplier = () => {}, stripeWritesAllowed = () => false, revokeGate = () => true, ucChecker = null } = {}) {
  const engineRoleIds = config.engineRoleIds;
  const externalIds = Array.isArray(config.externalRoleIds) ? config.externalRoleIds.map(String) : [];
  /* SML_ACADEMY_BILLING_UC_MATCH (default any): a kept row stays revocable. */
  const ucAny = config.ucMatch !== 'mapped';
  /** A kept_external row that is not final (see the header). */
  const keptRecheck = (grant) => ucAny && ucKeptRecheckable(grant);

  /* ------------------------------ 1. snapshot ------------------------------ */

  async function takeSnapshot(member, discordId, cacheRows) {
    const issues = [];
    let complete = true;
    const step = async (label, fn) => {
      try {
        const value = await fn();
        if (value && value.complete === false) { complete = false; issues.push(`${label}_truncated`); }
        return value;
      } catch (error) {
        complete = false;
        issues.push(`${label}_failed`);
        logger('warn', 'academy_billing_snapshot_step_failed', { step: label, error: String(error && (error.code || error.type || error.message) || 'error').slice(0, 80) });
        return null;
      }
    };
    const snap = {
      complete: true, issues, customerId: null, customerMissing: false, bindingConflict: null,
      subscriptions: [], lifetime: [], charges: new Map(), disputes: [], lifetimeMeta: new Map(), trials: [],
      winbackUsed: false, winbackBonus: []
    };
    const customerId = member && member.stripe_customer_id ? member.stripe_customer_id : null;
    snap.customerId = customerId;
    if (!customerId) { snap.complete = true; return snap; }

    const customer = await step('customer', () => stripeApi.retrieveCustomer(customerId));
    if (customer && customer.deleted) snap.customerMissing = true;
    else if (customer) {
      const meta = customer.metadata || {};
      if (!shapes.isAcademyMeta(meta)) snap.bindingConflict = 'customer_not_academy';
      else if (meta.mem_academy_discord_user && String(meta.mem_academy_discord_user) !== String(discordId)) snap.bindingConflict = 'metadata_discord_mismatch';
    }

    let rawSubs = [];
    let rawPis = [];
    if (!snap.customerMissing && customer) {
      const [subs, pis, charges] = [
        await step('subscriptions', () => stripeApi.listSubscriptions(customerId)),
        await step('payment_intents', () => stripeApi.listPaymentIntents(customerId)),
        await step('charges', () => stripeApi.listCharges(customerId))
      ];
      rawSubs = subs ? subs.data : [];
      rawPis = pis ? pis.data : [];
      for (const charge of charges ? charges.data : []) snap.charges.set(charge.id, normalizeCharge(charge));
    }

    /* Win-back (checkout.js): any subscription that was one, whatever its
       status, uses up the account's offer; a live one with bonus days gets
       its Academy comp (see the transaction below). */
    for (const sub of rawSubs) {
      const meta = sub.metadata || {};
      if (meta.mem_academy_winback !== '1') continue;
      snap.winbackUsed = true;
      const days = Number(meta.mem_academy_bonus_days);
      const startedAt = Number(sub.start_date || sub.created) || null;
      if (Number.isInteger(days) && days > 0 && days <= BONUS_ACADEMY_DAYS_MAX && startedAt && ['active', 'trialing'].includes(String(sub.status))) {
        snap.winbackBonus.push({ subscriptionId: String(sub.id), startedAt, days });
      }
    }

    /* Every subscription of this engine-dedicated Customer that ever had a
       free trial, whatever its price or status (one trial per account). */
    for (const sub of rawSubs) {
      const trialStart = Number(sub.trial_start) || null;
      const trialEnd = Number(sub.trial_end) || null;
      if (!trialStart && !trialEnd) continue;
      const first = shapes.subItems(sub).find((item) => item.priceId);
      snap.trials.push({ subscriptionId: String(sub.id), priceId: first ? String(first.priceId) : null, status: String(sub.status || ''),
        trialStart: trialStart || Number(sub.start_date || sub.created) || null, trialEnd });
    }

    /* Subscriptions: resolve each price (configured, or an Academy product). */
    const invoiceToSub = new Map();
    for (const sub of rawSubs) {
      const items = shapes.subItems(sub);
      let price = null;
      for (const item of items) {
        if (!item.priceId) continue;
        const info = await step('price', () => catalog.resolvePrice(item.priceId, item.recurring));
        if (info && info.academy) { price = info; break; }
        if (!info) {
          /* Unknown AND unresolvable: count it as an Academy price so the
             engine errs toward access; the snapshot is already incomplete, so
             nothing can be revoked on its account. */
          price = { priceId: item.priceId, package: 'monthly', academy: true, known: false, unmapped: true, graceHours: 72 };
          break;
        }
      }
      if (!price) continue;
      const normalized = {
        id: sub.id,
        status: String(sub.status || ''),
        created: Number(sub.created) || null,
        startDate: Number(sub.start_date || sub.created) || null,
        cancelAtPeriodEnd: sub.cancel_at_period_end === true,
        cancelAt: Number(sub.cancel_at) || null,
        periodStart: shapes.subPeriodStart(sub),
        periodEnd: shapes.subPeriodEnd(sub),
        trialStart: Number(sub.trial_start) || null,
        trialEnd: Number(sub.trial_end) || null,
        price,
        currentPeriodChargeId: null,
        /* Was any invoice of this subscription ever paid with money? null =
           not known (not read, or the read failed). A free trial's $0
           invoice is not a payment: a trial that ended and was never paid
           gets no past_due grace in ANY later period (access.js). The newest
           ten paid invoices are read: a subscription with more was paid. */
        everPaid: null
      };
      if (LIVE_SUB_STATUSES.includes(normalized.status)) {
        const invoices = await step('invoices', () => stripeApi.listPaidInvoices(sub.id));
        if (invoices) {
          normalized.everPaid = invoices.data.some((invoice) => Boolean(shapes.invoiceChargeId(invoice))
            || Number(invoice.amount_paid) > 0 || Number(invoice.total) > 0);
        }
        for (const invoice of invoices ? invoices.data : []) {
          invoiceToSub.set(invoice.id, sub.id);
          const chargeId = shapes.invoiceChargeId(invoice);
          if (!chargeId) continue;               /* $0 or balance-paid: skip */
          if (!normalized.currentPeriodChargeId) normalized.currentPeriodChargeId = chargeId;
        }
        if (normalized.currentPeriodChargeId && !snap.charges.has(normalized.currentPeriodChargeId)) {
          const charge = await step('charge', () => stripeApi.retrieveCharge(normalized.currentPeriodChargeId));
          if (charge) snap.charges.set(charge.id, normalizeCharge(charge));
        }
      }
      snap.subscriptions.push(normalized);
    }

    /* Lifetime: every Academy lifetime PaymentIntent on the customer, plus any
       cached one the list did not return (fetched by id). */
    const seen = new Set();
    const addLifetime = async (pi) => {
      if (!pi || seen.has(pi.id)) return;
      seen.add(pi.id);
      const chargeId = shapes.piLatestChargeId(pi);
      const embedded = shapes.piLatestCharge(pi);
      if (embedded && embedded.id) snap.charges.set(embedded.id, normalizeCharge(embedded));
      else if (chargeId && !snap.charges.has(chargeId)) {
        const charge = await step('charge', () => stripeApi.retrieveCharge(chargeId));
        if (charge) snap.charges.set(charge.id, normalizeCharge(charge));
      }
      /* A bank (ACH) lifetime is 'processing' until the debit clears, or
         'requires_action' / verify_with_microdeposits while the buyer still
         has to confirm the account; computeAccess grants only 'succeeded'. */
      const nextAction = pi.next_action && typeof pi.next_action.type === 'string' ? pi.next_action.type : null;
      /* What this lifetime grants comes from its own price entry (never
         deleted, only retired), so a repriced lifetime keeps its roles. */
      const lifetimePrice = pi.metadata && pi.metadata.mem_academy_price ? String(pi.metadata.mem_academy_price) : null;
      const grant = catalog && typeof catalog.lifetimeGrant === 'function' ? catalog.lifetimeGrant(lifetimePrice) : null;
      snap.lifetime.push({ paymentIntentId: pi.id, status: pi.status, nextAction, chargeId, created: Number(pi.created) || null, grant });
      snap.lifetimeMeta.set(pi.id, {
        priceId: pi.metadata && pi.metadata.mem_academy_price ? String(pi.metadata.mem_academy_price) : null,
        amountCents: Number(pi.amount_received || pi.amount || 0),
        currency: String(pi.currency || 'usd'),
        paidAt: (Number(pi.created) || Math.floor(now() / 1000)) * 1000,
        customerId: shapes.idOf(pi.customer) || customerId
      });
    };
    for (const pi of rawPis) {
      const meta = pi.metadata || {};
      if (shapes.isAcademyMeta(meta) && meta.mem_academy_package === 'lifetime') await addLifetime(pi);
    }
    for (const row of cacheRows || []) {
      if (seen.has(row.payment_intent_id)) continue;
      const pi = await step('lifetime_pi', () => stripeApi.retrievePaymentIntent(row.payment_intent_id));
      if (pi) await addLifetime(pi);
    }

    /* Disputes on ANY charge of this (engine-dedicated) customer. */
    for (const charge of snap.charges.values()) {
      if (!charge.disputed) continue;
      const list = await step('disputes', () => stripeApi.listDisputesForCharge(charge.id));
      let subscriptionId = null;
      const isLifetime = snap.lifetime.some((pi) => pi.chargeId === charge.id || pi.paymentIntentId === charge.paymentIntentId);
      if (!isLifetime && charge.invoiceId) {
        subscriptionId = invoiceToSub.get(charge.invoiceId) || null;
        if (!subscriptionId) {
          const invoice = await step('dispute_invoice', () => stripeApi.retrieveInvoice(charge.invoiceId));
          subscriptionId = invoice ? shapes.invoiceSubscriptionId(invoice) : null;
        }
      }
      for (const dispute of list ? list.data : []) {
        snap.disputes.push({
          id: dispute.id,
          chargeId: charge.id,
          status: dispute.status,
          paymentIntentId: isLifetime ? (charge.paymentIntentId || shapes.idOf(dispute.payment_intent)) : null,
          subscriptionId,
          chargeCreated: charge.created
        });
      }
    }

    snap.complete = complete;
    return snap;
  }

  /* ------------------------------ 3. write ------------------------------ */

  function decideRole({ roleKey, roleId, want, observed, row, revokesPossible }) {
    const has = observed.inGuild && observed.roles.includes(roleId);
    const inGuild = observed.inGuild;
    /* A queued row may have an applier call in flight that this (earlier)
       observation does not reflect yet: never settle it from the observation. */
    const queued = Boolean(row) && (row.state === 'pending' || row.state === 'awaiting_member');
    if (want) {
      const state = inGuild ? 'pending' : 'awaiting_member';
      const nextAttemptAt = state === 'awaiting_member' ? now() + AWAITING_FIRST_BACKOFF_MS : null;
      if (!row) {
        return has
          ? { write: 'insert', desired: true, state: 'synced', nextAttemptAt: null, audit: null }
          : { write: 'insert', desired: true, state, nextAttemptAt, audit: 'role_desired_changed' };
      }
      /* desired flips to true: always queue an idempotent PUT, even when the
         member looks like they hold the role (a DELETE may still be landing). */
      if (!row.desired) return { write: 'update', desired: true, state, bump: true, nextAttemptAt, audit: 'role_desired_changed' };
      if (queued) {
        if (row.state === 'awaiting_member' && inGuild) return { write: 'update', desired: true, state: 'pending', bump: true, nextAttemptAt: null, audit: null };
        return null;
      }
      if (has) return row.state === 'synced' ? null : { write: 'update', desired: true, state: 'synced', bump: false, nextAttemptAt: null, audit: null };
      return { write: 'update', desired: true, state, bump: true, nextAttemptAt, audit: 'role_drift_repair' };
    }
    /* not wanted */
    if (!has) {
      if (row && row.desired) {
        if (queued) {
          /* A grant may be in flight: queue an idempotent DELETE behind it
             (fail closed: never on an incomplete snapshot or a brake). */
          if (!revokesPossible) return { deferred: true };
          return { write: 'update', desired: false, state: 'pending', bump: true, nextAttemptAt: null, audit: 'role_desired_changed' };
        }
        return { write: 'update', desired: false, state: 'synced', bump: true, nextAttemptAt: null, audit: 'role_desired_changed' };
      }
      if (row && !queued && row.state !== 'synced') return { write: 'update', desired: false, state: 'synced', bump: false, nextAttemptAt: null, audit: null };
      return null;
    }
    if (!revokesPossible) return { deferred: true };
    if (!config.revokesEnabled) {
      if (row && !row.desired && row.state === 'suppressed') return null;
      return { write: row ? 'update' : 'insert', desired: false, state: 'suppressed', bump: Boolean(row), nextAttemptAt: null, audit: 'role_suppressed' };
    }
    if (row && !row.desired && row.state === 'pending') return null;
    return { write: row ? 'update' : 'insert', desired: false, state: 'pending', bump: Boolean(row), nextAttemptAt: null, audit: 'role_desired_changed' };
  }

  /** An outbox row the engine no longer wants, without any Discord call. */
  function releaseOutbox(row) {
    const queued = Boolean(row) && (row.state === 'pending' || row.state === 'awaiting_member');
    if (!row || !row.desired || queued) return null;
    return { write: 'update', desired: false, state: 'synced', bump: true, nextAttemptAt: null, audit: null };
  }

  /**
   * One EXTERNAL role (see external.js and the header). Returns
   *   { outbox, ledger, deferred, retry }
   * outbox: a decideRole-shaped write (or null); ledger: { write: 'insert' |
   * 'update', state, hadRoleBefore, reason, ucResult } (or null); retry: look
   * again in five minutes. A role with no ledger row that no engine source
   * entitles is never touched.
   */
  function decideExternal({ roleId, want, observed, row, grant, uc, revokesPossible, sourceRef }) {
    const has = observed.inGuild && observed.roles.includes(roleId);
    const queuedGrant = QUEUED(row) && row.desired;
    if (want) {
      const outbox = decideRole({ roleKey: 'external', roleId, want: true, observed, row, revokesPossible });
      let ledger = null;
      /* The previous entitlement ended: this decision starts a new one and
         records again, from this live read, whether the member holds it. */
      const ended = Boolean(grant) && ['revoked', 'kept_external', 'released'].includes(grant.state);
      if (!grant) {
        /* The FIRST grant decision, from this live read of the member. */
        ledger = has
          ? { write: 'insert', state: 'held', hadRoleBefore: true, reason: 'held_before_first_grant' }
          : { write: 'insert', state: 'engine_granted', hadRoleBefore: false, reason: 'granted' };
      } else if (!has) {
        if (grant.state !== 'engine_granted') ledger = { write: 'update', state: 'engine_granted', reason: 're_granted', ...(ended ? { hadRoleBefore: false } : {}) };
      } else if (keptRecheck(grant)) {
        /* 'any': the role on the member is still the engine's own grant,
           kept on an upgrade that may grant another role: it stays revocable. */
        ledger = { write: 'update', state: 'engine_granted', reason: 're_entitled' };
      } else if (!['held', 'engine_granted'].includes(grant.state)) {
        /* The role is on the member. After an ended entitlement it came from
           someone else (Upgrade.Chat, staff), unless the engine's own DELETE
           never landed (still queued, failed or held). */
        const revokeLanded = grant.state !== 'revoked' || (Boolean(row) && !row.desired && row.state === 'synced');
        ledger = ended && revokeLanded
          ? { write: 'update', state: 'held', hadRoleBefore: true, reason: 'held_at_new_grant' }
          : { write: 'update', state: grant.had_role_before ? 'held' : 'engine_granted', reason: 're_entitled' };
      }
      return { outbox, ledger: ledger && { ...ledger, sourceRef } };
    }
    /* No engine source entitles the role any more. */
    if (!grant) return { outbox: null, ledger: null };
    /* A grant still queued that (as this read shows) never reached the member
       is withdrawn, never delivered; 'suppressed' keeps a PUT that was in
       flight and lands anyway visible to the next pass (retry). */
    const undelivered = queuedGrant && !has;
    const withdraw = (state) => ({ write: 'update', desired: false, state, bump: true, nextAttemptAt: null, audit: 'role_desired_changed' });
    if (undelivered && !revokesPossible) return { deferred: true };
    /* 'any': a kept row with a fresh Upgrade.Chat answer (asked while the
       member holds the role) is decided like an engine_granted one below:
       active -> kept again, none -> revoked, inconclusive -> needs_review. */
    const recheckKept = keptRecheck(grant) && Boolean(uc) && uc.generation === Number(grant.generation);
    if (['held', 'kept_external', 'released'].includes(grant.state) && !recheckKept) {
      return undelivered ? { outbox: withdraw('synced'), ledger: null, retry: true } : { outbox: releaseOutbox(row), ledger: null };
    }
    if (grant.state === 'revoked') return decideRevoked({ has, row, grant, uc, revokesPossible, withdraw });
    /* engine_granted / needs_review */
    if (grant.had_role_before) {
      /* The engine PUT a role the member had held before (it had gone missing
         while they were entitled): never removed automatically. Gone anyway
         (removed by hand, or never delivered) -> released; an active
         Upgrade.Chat membership -> kept_external; otherwise staff review. */
      if (undelivered) return { outbox: withdraw('synced'), ledger: { write: 'update', state: 'released', reason: 'grant_withdrawn_undelivered' }, retry: true };
      if (!has) return { outbox: releaseOutbox(row), ledger: { write: 'update', state: 'released', reason: 'role_absent' } };
      const answer = uc && uc.generation === Number(grant.generation) ? uc : null;
      if (answer && answer.result === 'active') {
        return { outbox: releaseOutbox(row), ledger: { write: 'update', state: 'kept_external', reason: answer.reason, ucResult: 'active', ucChecked: true } };
      }
      if (grant.state === 'needs_review' && !answer) return { outbox: releaseOutbox(row), ledger: null };
      return { outbox: releaseOutbox(row), ledger: { write: 'update', state: 'needs_review', reason: 'had_role_before_first_grant',
        ...(answer ? { ucResult: answer.result, ucChecked: true } : {}) } };
    }
    if (!has && !queuedGrant) {
      /* Someone already removed it (or it never arrived): nothing to send. */
      return { outbox: UNFINISHED(row) ? settleRevoke() : releaseOutbox(row), ledger: { write: 'update', state: 'revoked', reason: 'role_already_removed' } };
    }
    if (!revokesPossible) return { deferred: true };
    if (!config.revokesEnabled) {
      if (row && !row.desired && row.state === 'suppressed') return {};
      return { outbox: { write: row ? 'update' : 'insert', desired: false, state: 'suppressed', bump: Boolean(row), nextAttemptAt: null, audit: 'role_suppressed' } };
    }
    if (!uc || uc.generation !== Number(grant.generation)) {
      if (undelivered) return { outbox: withdraw('suppressed'), ledger: null, retry: true };
      /* A needs_review row inside its re-check window waits quietly; any
         other missing answer is a race with the pre-transaction check. */
      return !uc && grant.state === 'needs_review' ? {} : { deferred: true, retry: true };
    }
    if (uc.result === 'active') {
      return { outbox: undelivered ? withdraw('synced') : releaseOutbox(row),
        ledger: { write: 'update', state: 'kept_external', reason: uc.reason, ucResult: 'active', ucChecked: true } };
    }
    if (uc.result === 'none') {
      /* An idempotent DELETE, also behind a PUT that may be in flight. */
      return {
        outbox: { write: row ? 'update' : 'insert', desired: false, state: 'pending', bump: Boolean(row), nextAttemptAt: null, audit: 'role_desired_changed' },
        ledger: { write: 'update', state: 'revoked', reason: uc.reason, ucResult: 'none', ucChecked: true }
      };
    }
    /* Not configured, an error or an unknown answer: keep a role the member
       HAS, never deliver one they do not, and flag staff. */
    return { outbox: undelivered ? withdraw('suppressed') : null, retry: undelivered,
      ledger: { write: 'update', state: 'needs_review', reason: uc.reason || 'uc_inconclusive', ucResult: 'inconclusive', ucChecked: true } };
  }

  /** An unfinished DELETE row whose role is gone: nothing left to remove. */
  function settleRevoke() {
    return { write: 'update', desired: false, state: 'synced', bump: false, nextAttemptAt: null, audit: null };
  }

  /**
   * A 'revoked' ledger row (had_role_before=false) whose role is no longer
   * entitled. The DELETE either landed (outbox synced: a role that is back
   * came from someone else and is never touched), is still queued (sent only
   * on a fresh Upgrade.Chat "none"; an older answer is asked again), or did
   * not land (failed, or held by the kill switch): asked again and re-queued.
   */
  function decideRevoked({ has, row, grant, uc, revokesPossible, withdraw }) {
    const queuedRevoke = QUEUED(row) && !row.desired;
    const unfinished = UNFINISHED(row);
    if (QUEUED(row) && row.desired && !has) return { outbox: withdraw('suppressed'), ledger: null, retry: true };
    /* Nothing queued and the role is gone: nothing left to remove. (A queued
       DELETE is never settled from the read: it may be in flight.) */
    if (!has && !queuedRevoke) return { outbox: unfinished ? settleRevoke() : releaseOutbox(row), ledger: null };
    if (has && !queuedRevoke && !unfinished) return { outbox: releaseOutbox(row), ledger: null };
    if (!revokesPossible) return { deferred: true };
    if (!config.revokesEnabled) return {};
    if (!uc) return queuedRevoke ? {} : { deferred: true, retry: true };
    if (uc.generation !== Number(grant.generation)) return { deferred: true, retry: true };
    if (uc.result === 'none') {
      return {
        outbox: queuedRevoke
          ? { write: 'update', desired: false, state: 'pending', bump: false, nextAttemptAt: null, audit: null }
          : { write: 'update', desired: false, state: 'pending', bump: true, nextAttemptAt: null, audit: 'role_desired_changed' },
        ledger: { write: 'update', state: 'revoked', reason: uc.reason, ucResult: 'none', ucChecked: true }
      };
    }
    /* The DELETE is cancelled: an Upgrade.Chat membership now grants the role,
       or the answer is not a clear no. */
    const cancel = { write: 'update', desired: false, state: 'synced', bump: true, nextAttemptAt: null, audit: null };
    if (uc.result === 'active') {
      return { outbox: cancel, ledger: { write: 'update', state: 'kept_external', reason: uc.reason, ucResult: 'active', ucChecked: true } };
    }
    return { outbox: cancel, ledger: { write: 'update', state: 'needs_review', reason: uc.reason || 'uc_inconclusive', ucResult: 'inconclusive', ucChecked: true } };
  }

  async function resync(discordId, { actor = 'resync', eventId = null, runId = null, dryRun = false, allowRevokes = true, ucRecheck = false } = {}) {
    const id = String(discordId || '');
    if (!SNOWFLAKE.test(id)) throw new TypeError('resync: Discord snowflake required');
    const startedAt = now();
    const member = await store.getMember(store.pool, id);
    const cacheRows = member ? await store.lifetimeRows(store.pool, id) : [];
    const snap = await takeSnapshot(member, id, cacheRows);

    /* dryRun (CLI / dry-run reconcile): audit only, no other row changes.
       ROLE_MODE governs only the role outbox: in dry_run the access cache is
       still kept current (so audits are not repeated) but no role intent is
       queued. */
    const cacheWrites = !dryRun;
    const roleWrites = !dryRun && config.roleMode === 'enforce';
    const observeRoles = config.roleMode !== 'off' || dryRun;
    /* The outbox as it stood BEFORE the Discord read (see the header). */
    const preRows = roleWrites && observeRoles ? await store.roleRowsFor(store.pool, id) : [];
    const preRow = (roleId) => preRows.find((r) => String(r.role_id) === String(roleId)) || null;
    let observed = null;
    let observeError = null;
    if (observeRoles) {
      try { observed = await bot.getMember(id); } catch (error) { observeError = error; }
    }
    /* An explicit dry run is audit-only: nothing else to salvage. */
    if (observeError && dryRun) throw observeError;
    const accountConfirmed = Boolean(revokeGate());
    const revokesPossible = Boolean(allowRevokes && snap.complete && !snap.bindingConflict && accountConfirmed);
    const rulesWillRun = !dryRun && Boolean(stripeWritesAllowed());

    /* External roles: the ledger as it stands, and the Upgrade.Chat check for
       every ledger row whose role no source entitles any more and that needs
       an answer (ucCheckWanted). Both run here, BEFORE the transaction, so no
       lock is held across the UC call; the transaction re-reads the ledger
       and only uses an answer taken for the same ledger generation. */
    const accessOptions = { partialRefundRevokes: config.partialRefundRevokes, livemode: config.livemode,
      stripeSuppressed: Boolean(snap.bindingConflict), externalRoleIds: externalIds };
    let preGrants = [];
    const ucResults = new Map();
    if (observed && externalIds.length) {
      preGrants = await store.externalGrantsFor(store.pool, id);
      if (roleWrites && revokesPossible && config.revokesEnabled
        && preGrants.some((grant) => ['engine_granted', 'needs_review', 'revoked'].includes(grant.state) || keptRecheck(grant))) {
        const preComps = await store.compsFor(store.pool, id);
        const pre = computeAccess({ snapshot: { ...snap, comps: preComps }, now: now(), ...accessOptions });
        /* SML_ACADEMY_BILLING_UC_MATCH=any answers per member (any active
           Upgrade.Chat upgrade), so it is asked once per pass for all roles. */
        let memberAnswer = null;
        const ask = async (roleId) => {
          if (!ucChecker || typeof ucChecker.check !== 'function') return { result: 'inconclusive', reason: 'uc_not_configured' };
          if (ucChecker.scope !== 'member') return ucChecker.check(id, roleId);
          if (!memberAnswer) memberAnswer = ucChecker.check(id, roleId);
          return memberAnswer;
        };
        for (const grant of pre.externalHold ? [] : preGrants) {
          const roleId = String(grant.role_id);
          if (!externalIds.includes(roleId) || pre.externalRoles.has(roleId)) continue;
          const has = observed.inGuild && observed.roles.includes(roleId);
          if (!ucCheckWanted({ grant, row: preRow(roleId), has, nowMs: now(), force: ucRecheck, ucAny })) continue;
          const answer = await ask(roleId);
          ucResults.set(roleId, { ...answer, generation: Number(grant.generation) });
        }
      }
    }

    const result = await store.withUserTx(id, async (client) => {
      const current = await store.getMember(client, id, { forUpdate: true });
      if (current && current.last_synced_at && new Date(current.last_synced_at).getTime() > startedAt) return { stale: true };
      if ((current && current.stripe_customer_id) !== (member && member.stripe_customer_id)) return { stale: true };
      /* Win-back bonus Academy days: one comp per win-back subscription,
         ending startedAt + days. Never re-granted once it exists (a comp
         staff revoked stays revoked). */
      const bonusRows = [];
      if (cacheWrites && snap.complete && !snap.bindingConflict) {
        for (const bonus of snap.winbackBonus || []) {
          const reason = `winback_bonus:${bonus.subscriptionId}`;
          const expiresAt = bonus.startedAt * 1000 + bonus.days * 86_400_000;
          if (expiresAt <= now() || await store.compByReason(client, id, reason)) continue;
          const comp = await store.insertComp(client, { discordId: id, includeLifetimeRole: false, reason, grantedBy: 'winback', expiresAt, grantsAcademy: true });
          bonusRows.push({ actor, livemode: config.livemode, discordUserId: id, eventId, runId, action: 'comp_granted', outcome: 'applied', reason: 'winback_bonus',
            stripeRefs: [bonus.subscriptionId], details: { comp: comp && comp.id, days: bonus.days, expiresAt: new Date(expiresAt).toISOString() } });
        }
      }
      const comps = await store.compsFor(client, id);
      const access = computeAccess({ snapshot: { ...snap, comps }, now: now(), ...accessOptions });
      const desired = access.roles;
      const rows = [...bonusRows];
      const refs = access.refs.slice(0, 20);
      const base = { actor, livemode: config.livemode, discordUserId: id, eventId, runId };
      const previous = new Set(current && current.last_access && Array.isArray(current.last_access.roles) ? current.last_access.roles : []);
      const previousExternal = new Set(current && current.last_access && Array.isArray(current.last_access.externalRoles) ? current.last_access.externalRoles : []);
      const previousReasons = new Set(current && current.last_access && Array.isArray(current.last_access.reasons) ? current.last_access.reasons : []);
      const previousFlagged = current && current.last_access && Array.isArray(current.last_access.cancelFlagged)
        ? current.last_access.cancelFlagged.map(String) : [];
      const rolesQueued = roleWrites && Boolean(observed);
      if (cacheWrites && (!sameSet(previous, desired) || !sameSet(previousExternal, access.externalRoles))) {
        rows.push({ ...base, action: 'access_changed', outcome: roleWrites ? 'applied' : 'dry_run',
          reason: access.reasons[access.reasons.length - 1] || null, stripeRefs: refs,
          details: { from: [...previous].sort(), to: [...desired].sort(), externalFrom: [...previousExternal].sort(),
            externalTo: [...access.externalRoles].sort(), reasons: access.reasons.slice(0, 12), complete: snap.complete, rolesQueued } });
      }
      /* Plans that give no access but that Stripe still bills. Recorded as
         flagged only when the Stripe rules run on this pass, so a pass with
         the rules blocked (preflight) never swallows the staff flag. */
      const cancelCandidates = cancelCandidatesFor(snap, access).map((item) => item.subscriptionId);
      const cancelFlagged = rulesWillRun ? cancelCandidates : previousFlagged.filter((sid) => cancelCandidates.includes(sid));
      if (snap.bindingConflict) {
        rows.push({ ...base, action: 'binding_conflict', outcome: 'noop', reason: snap.bindingConflict, stripeRefs: snap.customerId ? [snap.customerId] : [] });
      }
      for (const priceId of access.unmapped) {
        if (!previousReasons.has('config_unmapped_price')) {
          rows.push({ ...base, action: 'config_unmapped_price', outcome: 'noop', reason: 'academy_product_price_not_in_config', stripeRefs: [priceId] });
        }
      }

      const ops = [];
      let deferredRevokes = 0;
      let queued = 0;
      let retryRoles = false;
      let needsReview = false;
      let keptRecheckAt = null;
      /* A price missing from the config never removes an external role. */
      const externalRevokesPossible = revokesPossible && !access.externalHold;

      async function writeOutbox(decision, roleKey, roleId) {
        if (decision.write === 'insert') {
          await store.insertRoleRow(client, { discordId: id, roleId, roleKey, desired: decision.desired, state: decision.state, nextAttemptAt: decision.nextAttemptAt });
        } else {
          await store.updateRoleRow(client, { discordId: id, roleId, desired: decision.desired, state: decision.state,
            bump: decision.bump, nextAttemptAt: decision.nextAttemptAt, resetAttempts: decision.bump });
        }
        const isQueued = decision.state === 'pending' || decision.state === 'awaiting_member';
        if (isQueued) queued += 1;
        ops.push({ roleKey, roleId: String(roleId), desired: decision.desired, state: decision.state, queued: isQueued });
        if (decision.audit) {
          const outcome = decision.state === 'suppressed' ? 'suppressed' : (decision.state === 'awaiting_member' ? 'waiting_member' : 'applied');
          rows.push({ ...base, action: decision.audit, roleKey, outcome,
            reason: decision.desired ? 'entitled' : (access.reasons.find((r) => r !== 'no_entitlement') || 'no_entitlement'),
            stripeRefs: refs, details: roleKey === 'external' ? { state: decision.state, roleId: String(roleId) } : { state: decision.state } });
        }
      }

      if (observed) {
        if (!roleWrites) {
          const plan = planRoleDiff({ desired, member: observed, engineRoleIds, allowRevokes: revokesPossible });
          const xplan = planExternalDiff({ desired: access.externalRoles, member: observed, grants: preGrants, externalRoleIds: externalIds,
            allowRevokes: externalRevokesPossible });
          deferredRevokes = plan.deferredRevokes + xplan.deferredRevokes;
          for (const op of [...plan.ops, ...xplan.ops]) {
            ops.push({ ...op, queued: false });
            rows.push({ ...base, action: 'role_desired_changed', roleKey: op.roleKey, outcome: 'dry_run',
              reason: op.desired ? (op.awaitingMember ? 'grant_awaiting_member' : 'grant') : (op.needsUcCheck ? 'revoke_unless_upgrade_chat_membership' : 'revoke'),
              stripeRefs: refs, details: op.roleKey === 'external' ? { roleId: op.roleId } : {} });
          }
        } else {
          const existing = await store.roleRowsFor(client, id, { forUpdate: true });
          for (const roleKey of ROLE_KEYS) {
            const roleId = engineRoleIds[roleKey];
            if (!roleId) continue;
            const row = existing.find((r) => String(r.role_id) === String(roleId)) || null;
            /* An applier call finished after the Discord read: that read may
               predate it, so no revoke is decided from it (retry). */
            if (!desired.has(roleKey) && rowChanged(preRow(roleId), row)) { deferredRevokes += 1; retryRoles = true; continue; }
            const decision = decideRole({ roleKey, roleId: String(roleId), want: desired.has(roleKey), observed, row, revokesPossible });
            if (!decision) continue;
            if (decision.deferred) { deferredRevokes += 1; continue; }
            await writeOutbox(decision, roleKey, roleId);
          }
          const grants = externalIds.length ? await store.externalGrantsFor(client, id, { forUpdate: true }) : [];
          for (const roleId of externalIds) {
            const row = existing.find((r) => String(r.role_id) === roleId) || null;
            const grant = grants.find((g) => String(g.role_id) === roleId) || null;
            const want = access.externalRoles.has(roleId);
            /* The ledger's first grant decision and every revoke read the
               member: never from a read an applier call may have overtaken. */
            if (rowChanged(preRow(roleId), row)) { if (!want) deferredRevokes += 1; retryRoles = true; continue; }
            const decision = decideExternal({ roleId, want, observed, row, grant, uc: ucResults.get(roleId) || null,
              revokesPossible: externalRevokesPossible, sourceRef: (access.externalSources.get(roleId) || [])[0] || null });
            if (decision.retry) retryRoles = true;
            if (decision.deferred) { deferredRevokes += 1; continue; }
            if (decision.ledger) {
              const l = decision.ledger;
              let written = true;
              if (l.write === 'insert') {
                written = (await store.insertExternalGrant(client, { discordId: id, roleId, hadRoleBefore: l.hadRoleBefore, state: l.state,
                  firstSourceRef: l.sourceRef, reason: l.reason })) > 0;
              } else {
                written = (await store.updateExternalGrant(client, { discordId: id, roleId, generation: grant.generation, state: l.state,
                  reason: l.reason, ucResult: l.ucResult || null, ucChecked: Boolean(l.ucChecked),
                  hadRoleBefore: typeof l.hadRoleBefore === 'boolean' ? l.hadRoleBefore : null })) !== null;
              }
              if (!written) { retryRoles = true; continue; }
              const from = grant ? grant.state : null;
              if (l.state === 'needs_review') {
                needsReview = true;
                if (from !== 'needs_review' || grant.last_reason !== l.reason) logger('warn', 'academy_billing_external_needs_review', { discordUserId: id, roleId, reason: l.reason });
              }
              if (from !== l.state || (grant && grant.last_reason !== l.reason && l.state === 'needs_review')) {
                const outcome = ['engine_granted', 'revoked'].includes(l.state) ? 'applied' : 'noop';
                const hadRoleBefore = typeof l.hadRoleBefore === 'boolean' ? l.hadRoleBefore : Boolean(grant && grant.had_role_before);
                rows.push({ ...base, action: 'external_grant_state', roleKey: 'external', outcome, reason: l.reason,
                  stripeRefs: refs, details: { roleId, from, to: l.state, hadRoleBefore,
                    uc: l.ucResult || null, ucRef: (ucResults.get(roleId) || {}).ref || null } });
              }
            } else if (grant && grant.state === 'needs_review') {
              needsReview = true;
            }
            if (decision.outbox) await writeOutbox(decision.outbox, 'external', roleId);
          }
          /* 'any': a kept row the member still holds is asked again
             UC_KEPT_RECHECK_MS after its last Upgrade.Chat answer. */
          if (ucAny && grants.length) {
            for (const grant of await store.externalGrantsFor(client, id)) {
              if (!keptRecheck(grant) || !observed.inGuild || !observed.roles.includes(String(grant.role_id))) continue;
              const at = grant.uc_checked_at ? new Date(grant.uc_checked_at).getTime() : NaN;
              const due = Math.max(now() + 60_000, (Number.isFinite(at) ? at : now()) + UC_KEPT_RECHECK_MS);
              keptRecheckAt = keptRecheckAt === null ? due : Math.min(keptRecheckAt, due);
            }
          }
        }
      }

      /* Re-check in five minutes when the snapshot was incomplete, the
         Discord read failed, or revokes were held back for a reason that
         clears by itself (binding conflict fixed in Stripe, the Stripe account
         confirmed by preflight, a ledger row or an outbox row that changed
         under the Upgrade.Chat check or the Discord read, a withdrawn grant
         that may still have been in flight). Revokes held back only by the
         caller's brake are NOT retried (see the header). A needs_review
         external role is re-checked against Upgrade.Chat after UC_RECHECK_MS,
         and every member with access at least once a day. A free-only trial
         is also re-checked around its stop (freeTrialCheckTimes). */
      const selfClearing = Boolean(snap.bindingConflict) || !accountConfirmed;
      const retrySoon = !snap.complete || Boolean(observeError) || retryRoles || (deferredRevokes > 0 && selfClearing);
      const entitledNow = desired.size > 0 || access.externalRoles.size > 0;
      const nextCheckAt = [access.nextCheckAt, retrySoon ? now() + INCOMPLETE_RETRY_MS : null,
        needsReview ? now() + UC_RECHECK_MS : null, keptRecheckAt, entitledNow ? now() + ENTITLED_RECHECK_MS : null,
        ...freeTrialCheckTimes(snap.subscriptions, now())].filter(Boolean);
      if (cacheWrites && current) {
        await store.updateMemberAccess(client, {
          discordId: id,
          lastAccess: { roles: [...desired].sort(), externalRoles: [...access.externalRoles].sort(), reasons: access.reasons.slice(0, 20), refs: refs,
            complete: snap.complete, disputeOpen: access.disputeOpen, rolesQueued, cancelFlagged, lifetimePending: access.pendingLifetime.length > 0,
            lifetime: access.sources.some((source) => source.kind === 'lifetime'), computedAt: new Date(now()).toISOString() },
          nextCheckAt: nextCheckAt.length ? Math.min(...nextCheckAt) : null,
          snapshotAt: startedAt
        });
        for (const state of access.lifetimeStates) {
          const meta = snap.lifetimeMeta.get(state.paymentIntentId);
          if (!meta) continue;
          await store.upsertLifetime(client, {
            paymentIntentId: state.paymentIntentId, discordId: id, customerId: meta.customerId, priceId: meta.priceId,
            amountCents: meta.amountCents, currency: meta.currency, paidAt: meta.paidAt, chargeId: state.chargeId, state: state.state
          });
        }
      }
      /* One free trial per Discord account: the first trial seen on the
         member's own Customer is recorded for good (never while the binding
         is in conflict: whose trial it was is not known then). */
      if (cacheWrites && current && !snap.bindingConflict && snap.trials.length) {
        const first = [...snap.trials].sort((a, b) => (a.trialStart || 0) - (b.trialStart || 0))[0];
        if (first.trialStart && await store.recordTrial(client, { discordId: id, priceId: first.priceId, subscriptionId: first.subscriptionId,
          startedAt: first.trialStart * 1000, trialEndAt: first.trialEnd ? first.trialEnd * 1000 : null }) > 0) {
          rows.push({ ...base, action: 'trial_recorded', outcome: 'applied', reason: 'one_free_trial_per_account',
            stripeRefs: [first.subscriptionId, first.priceId].filter(Boolean), details: { status: first.status } });
        }
      }
      await audit.appendAll(client, rows, { now });
      return { stale: false, access, ops, deferredRevokes, queued, audited: rows.length, previousFlagged };
    });

    if (result.stale) {
      logger('info', 'academy_billing_resync_stale', { discordUserId: id });
      return { discordId: id, stale: true };
    }
    if (result.queued) kickApplier();
    let stripeActions = [];
    if (rulesWillRun) {
      try {
        stripeActions = await enforceBillingRules(id, snap, result.access, { actor, eventId, runId, previousFlagged: result.previousFlagged });
      } catch (error) {
        logger('error', 'academy_billing_stripe_rule_failed', { discordUserId: id, error: String(error && (error.code || error.message) || 'error').slice(0, 120) });
        await store.setNextCheck(store.pool, id, now() + INCOMPLETE_RETRY_MS).catch(() => {});
      }
    } else {
      /* The Stripe rules do not run on this pass: preflight blocks them, or
         it is a dry run (the RECONCILE_MODE=dry_run sweep of rollout stages
         B and C, or the CLI). A free trial meant to stop before any charge
         (Free Trial Access) is not yet set to end before its trial does:
         Stripe cancels it at its trial end only when neither the
         subscription nor the Customer has a default payment method, so a
         member with a saved card would be charged. Staff are told; the rule
         runs on the next pass that may write (a webhook, the success page,
         the due scan, or once preflight passes; a trial past its stop time
         is then cancelled at once). One Stripe already converted is an
         error: its first invoice is charged about an hour after the trial
         end. */
      const nowSec = Math.floor(now() / 1000);
      for (const sub of snap.subscriptions) {
        const days = sub.price && Number.isInteger(sub.price.cancelAfterDays) ? sub.price.cancelAfterDays : null;
        const missed = days ? missedFreeTrialStop(sub, days, nowSec) : null;
        if (missed) {
          logger('error', 'academy_billing_free_trial_stop_missed', { discordUserId: id, subscriptionId: sub.id, trialEnd: sub.trialEnd,
            everPaid: sub.everPaid, blocked: true, dryRun: Boolean(dryRun) });
          continue;
        }
        if (!days || sub.status !== 'trialing' || sub.cancelAtPeriodEnd || !sub.startDate || !sub.trialEnd) continue;
        const plan = autoStopPlan(sub, days);
        if (plan.freeOnly && !plan.done) {
          logger('warn', 'academy_billing_auto_stop_pending', { discordUserId: id, subscriptionId: sub.id, stopAt: plan.target, trialEnd: sub.trialEnd,
            dryRun: Boolean(dryRun) });
        }
      }
    }
    if (observeError) {
      /* The Stripe side is done; the caller retries the role part. */
      logger('warn', 'academy_billing_resync_discord_unreadable', { discordUserId: id, stripeActions: stripeActions.length,
        error: String(observeError && (observeError.kind || observeError.code || observeError.message) || 'error').slice(0, 80) });
      throw observeError;
    }
    return {
      discordId: id,
      stale: false,
      roles: [...result.access.roles].sort(),
      externalRoles: [...result.access.externalRoles].sort(),
      reasons: result.access.reasons,
      complete: snap.complete,
      issues: snap.issues,
      bindingConflict: snap.bindingConflict,
      ops: result.ops,
      queued: result.queued,
      deferredRevokes: result.deferredRevokes,
      dryRun: !roleWrites,
      stripeActions
    };
  }

  /* ------------------------------ 4. Stripe billing rules ------------------------------ */

  async function enforceBillingRules(discordId, snap, access, { actor, eventId, runId, previousFlagged = [] }) {
    const actions = [];
    const base = { actor, livemode: config.livemode, discordUserId: discordId, eventId, runId };
    const auditOne = (row) => audit.appendStandalone(store.pool, { ...base, ...row }, { now });
    const nowSec = Math.floor(now() / 1000);

    /* AUTO-STOP: a price with "cancelAfterDays" N (an Academy daily price: 3
       by default, the Day plan's 3-charge cap) ends N days after the
       subscription START (for a trial price, the trial start): cancel_at =
       start + N days, set once (idempotent: a subscription already set to end
       by then is left alone). A FREE-ONLY trial (its trial covers the N days:
       Free Trial Access, trialDays 3 = cancelAfterDays 3) is set to end
       TRIAL_STOP_MARGIN_SEC before the earlier of that time and its trial
       end, so Stripe cancels it while it is still trialing and never creates
       the first paid invoice, even with a saved default card (autoStopPlan).
       A trial whose stop time has already come (the engine first sees it
       late, but before its trial ends) is cancelled now, so it never reaches
       a charge; any other late plan ends at the end of its paid period.
       SAFETY NET: a free-only trial Stripe already converted (the engine
       missed it for the whole trial) is cancelled at once: before its first
       invoice is collected, or, once charged, with no second charge and a
       refund flag for staff (missedFreeTrialStop). Any failed write for a free-only trial is logged
       as academy_billing_free_trial_stop_failed (error) and retried. */
    const freeTrialFailed = (sub, error, extra) => logger('error', 'academy_billing_free_trial_stop_failed', { discordUserId: discordId,
      subscriptionId: sub.id, trialEnd: sub.trialEnd || null, secondsLeft: sub.trialEnd ? sub.trialEnd - nowSec : null, ...extra,
      error: String(error && (error.code || error.message) || 'error').slice(0, 120) });
    for (const sub of snap.subscriptions) {
      const days = Number.isInteger(sub.price.cancelAfterDays) ? sub.price.cancelAfterDays : null;
      if (!sub.price.academy || !days) continue;
      const missed = missedFreeTrialStop(sub, days, nowSec);
      if (missed) {
        const details = { cancelAfterDays: days, start: sub.startDate, trialEnd: sub.trialEnd, everPaid: sub.everPaid, freeTrial: true };
        try {
          await stripeApi.cancelSubscription(sub.id, { prorate: false }, `mem-academy-free-trial-missed-cancel-v1-${sub.id}`);
        } catch (error) {
          freeTrialFailed(sub, error, { missed });
          throw error;
        }
        const action = missed === 'cancel' ? 'free_trial_stop_missed' : 'free_trial_charged';
        actions.push({ action, subscriptionId: sub.id });
        await auditOne({ action, outcome: 'applied', reason: missed === 'cancel' ? 'converted_before_stop' : 'refund_review', stripeRefs: [sub.id],
          details: { ...details, canceledNow: true } });
        logger('error', `academy_billing_${action}`, { discordUserId: discordId, subscriptionId: sub.id, trialEnd: sub.trialEnd, everPaid: sub.everPaid,
          canceledNow: true });
        continue;
      }
      if (!LIVE_SUB_STATUSES.includes(sub.status) || sub.cancelAtPeriodEnd || !sub.startDate) continue;
      const plan = autoStopPlan(sub, days);
      if (plan.done) continue;
      const target = plan.target;
      const details = { cancelAfterDays: days, start: sub.startDate, trialEnd: sub.trialEnd || null,
        ...(plan.freeOnly ? { freeTrial: true, marginSec: TRIAL_STOP_MARGIN_SEC } : {}) };
      if (target <= nowSec + 60 && sub.status === 'trialing') {
        try {
          await stripeApi.cancelSubscription(sub.id, { prorate: false }, `mem-academy-auto-stop-cancel-v1-${sub.id}`);
        } catch (error) {
          if (plan.freeOnly) freeTrialFailed(sub, error, { stopAt: target, canceledNow: true });
          throw error;
        }
        actions.push({ action: 'auto_stop_set', subscriptionId: sub.id });
        await auditOne({ action: 'auto_stop_set', outcome: 'applied', reason: `cancel_after_${days}_days`, stripeRefs: [sub.id],
          details: { ...details, canceledNow: true } });
        continue;
      }
      const params = target > nowSec + 60 ? { cancel_at: target, proration_behavior: 'none' } : { cancel_at_period_end: true };
      try {
        await stripeApi.updateSubscription(sub.id, params, `mem-academy-auto-stop-v1-${sub.id}-${params.cancel_at || 'period_end'}`);
      } catch (error) {
        if (plan.freeOnly) freeTrialFailed(sub, error, { stopAt: target });
        throw error;
      }
      actions.push({ action: 'auto_stop_set', subscriptionId: sub.id });
      await auditOne({ action: 'auto_stop_set', outcome: 'applied', reason: `cancel_after_${days}_days`, stripeRefs: [sub.id],
        details: { ...details, cancelAt: params.cancel_at || null, periodEnd: Boolean(params.cancel_at_period_end) } });
    }

    /* A paid lifetime supersedes every recurring plan it fully covers (the
       Academy lifetime covers every Academy plan; a membership lifetime covers
       the plans of its own roles): set each to cancel at the end of its paid
       period (no refund; disclosed on /buy). A plan that grants something the
       lifetime does not (another membership) is left alone. */
    /* Supersede and refund-cancel act on someone's plan, so they need a
       complete snapshot of a customer whose binding is not in conflict. */
    const trusted = snap.complete && !snap.bindingConflict;
    const lifetimes = !trusted || access.disputeOpen ? [] : access.sources.filter((source) => source.kind === 'lifetime');
    for (const sub of lifetimes.length ? snap.subscriptions : []) {
      if (!sub.price.academy || !LIVE_SUB_STATUSES.includes(sub.status) || sub.cancelAtPeriodEnd) continue;
      const plan = grantOf(sub.price);
      const lifetime = lifetimes.find((source) => (!plan.academy || (source.roles || []).includes('academy'))
        && plan.roles.every((roleId) => (source.externalRoles || []).includes(roleId)));
      if (!lifetime) continue;
      await stripeApi.updateSubscription(sub.id, { cancel_at_period_end: true }, `mem-academy-lifetime-supersede-v1-${lifetime.id}-${sub.id}`);
      actions.push({ action: 'lifetime_supersede', subscriptionId: sub.id });
      await auditOne({ action: 'lifetime_supersede', outcome: 'applied', reason: 'lifetime_purchased', stripeRefs: [lifetime.id, sub.id] });
    }

    /* A plan that gives no access while Stripe still bills it: the current
       period's charge was fully refunded, or a lost dispute voided it for
       good. CANCEL_ON_REFUND=1 cancels it (no proration); otherwise staff are
       told once per subscription (stripe_cancel_required). */
    const flagged = new Set((previousFlagged || []).map(String));
    for (const item of trusted ? cancelCandidatesFor(snap, access) : []) {
      const refs = [item.subscriptionId, item.chargeId].filter(Boolean);
      if (config.cancelOnRefund) {
        const key = item.reason === 'dispute_lost'
          ? `mem-academy-dispute-cancel-v1-${item.subscriptionId}`
          : `mem-academy-refund-cancel-v1-${item.chargeId}`;
        await stripeApi.cancelSubscription(item.subscriptionId, { prorate: false }, key);
        actions.push({ action: item.reason === 'dispute_lost' ? 'dispute_cancel' : 'refund_cancel', subscriptionId: item.subscriptionId });
        await auditOne({ action: 'stripe_subscription_canceled', outcome: 'applied', reason: item.reason, stripeRefs: refs });
      } else if (!flagged.has(item.subscriptionId)) {
        actions.push({ action: 'stripe_cancel_required', subscriptionId: item.subscriptionId });
        await auditOne({ action: 'stripe_cancel_required', outcome: 'noop', reason: item.reason, stripeRefs: refs });
        logger('warn', 'academy_billing_stripe_cancel_required', { subscriptionId: item.subscriptionId, reason: item.reason });
      }
    }
    return actions;
  }

  return { resync, takeSnapshot, decideRole, enforceBillingRules };
}

/**
 * Live Academy plans that give no access but will still charge: the current
 * period fully refunded, or voided by a lost dispute. A plan already set to
 * end (cancel_at_period_end / cancel_at) will not charge again and is left
 * alone. Pure.
 */
function cancelCandidatesFor(snap, access) {
  const byId = new Map((snap.subscriptions || []).map((sub) => [sub.id, sub]));
  const out = [];
  const seen = new Set();
  const add = (item, reason) => {
    if (seen.has(item.subscriptionId) || !LIVE_SUB_STATUSES.includes(item.status)) return;
    const sub = byId.get(item.subscriptionId);
    if (sub && (sub.cancelAtPeriodEnd || sub.cancelAt)) return;
    seen.add(item.subscriptionId);
    out.push({ subscriptionId: item.subscriptionId, chargeId: item.chargeId || null, status: item.status, reason });
  };
  for (const item of access.voidedSubs || []) add(item, 'dispute_lost');
  for (const item of access.refundedSubs || []) if (!item.partial) add(item, 'current_period_refunded');
  return out;
}

module.exports = { createResync, cancelCandidatesFor, rowChanged, ucCheckWanted, autoStopPlan, missedFreeTrialStop, freeTrialCheckTimes, INCOMPLETE_RETRY_MS,
  ENTITLED_RECHECK_MS, TRIAL_STOP_MARGIN_SEC, FREE_TRIAL_RECHECK_SEC };
