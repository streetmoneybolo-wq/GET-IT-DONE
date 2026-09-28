'use strict';

/* =============================================================================
 * MEM Academy billing: checkout, settle and the billing portal.
 *
 * SML_ACADEMY_BILLING_CHECKOUT_ENABLED is the ONLY switch that can lead to a
 * charge. Turning it off stops NEW sales; existing subscriptions keep
 * renewing in Stripe.
 *
 * Checkout Session parameters are built by one PURE function:
 *   - mode 'subscription' for recurring packages, 'payment' for lifetime;
 *   - metadata { sml_kind:'mem_academy', mem_academy_v, mem_academy_intent,
 *     mem_academy_discord_user, mem_academy_package, mem_academy_price,
 *     mem_academy_consent_version, mem_academy_consent_sha256 } on the session
 *     AND on subscription_data / payment_intent_data (the Customer already
 *     carries sml_kind + mem_academy_discord_user), so the consent proof and
 *     the binding survive in Stripe even if the database is rolled back;
 *   - NEVER the keys other MEM integrations key on (subscription_key,
 *     sml_site, sml_uid, sml_key, sml_ct_user, sml_sub_id, sml_user_id,
 *     sml_lb_amount, order_key), NEVER transfer_data / application_fee /
 *     on_behalf_of (MEM itself is the seller);
 *   - payment_method_types from the PRICE entry's "paymentMethods" (else
 *     SML_ACADEMY_BILLING_PAYMENT_METHODS, default card, link), never empty
 *     (Stripe would fall back to the Dashboard's dynamic methods). A list with
 *     us_bank_account (ACH Direct Debit, lifetime only; config.js refuses it
 *     elsewhere and this builder throws for a recurring package) adds
 *     payment_method_options.us_bank_account.verification_method
 *     'automatic': instant verification through Financial Connections, with
 *     manual entry + microdeposits as the fallback. Such a Checkout completes
 *     with payment_status 'unpaid'; the role waits for the debit to clear;
 *   - allow_promotion_codes false (Discord price parity); a win-back price
 *     carries its intro discount as `discounts` instead (the engine's own
 *     once-off coupon, or the owner's promotion code named by the entry's
 *     "promotionCode"), never both;
 *   - consent_collection only behind SML_ACADEMY_BILLING_TOS_CONSENT;
 *   - expires_at = now + 35 min (Stripe's minimum is 30).
 *
 * Duplicate guard (fresh Stripe snapshot, not the DB): an Academy
 * subscription that is active, trialing, past_due, unpaid, paused or
 * incomplete sends the member to Manage billing instead of a second
 * plan (except a free trial already set to end before its trial does: it can
 * never charge, so its member may buy the paid plan right away); an owned
 * lifetime shows "already owned". A plan that gives no access
 * (current period refunded, or voided by a lost dispute) AND is already set to
 * end does not block: it will never charge again. One that is still set to
 * renew does block, so a second plan is never charged next to it; /buy says
 * that plan needs attention instead of "Access active". Buying lifetime while a plan
 * renews IS allowed: after payment the engine sets that plan to cancel at
 * period end (resync.js), which /buy states before checkout. While a lifetime
 * bank payment is still clearing (PaymentIntent processing, or waiting for
 * microdeposit verification) nothing new is sold to that member, so a second
 * debit is never started next to it. Any OPEN Checkout Session of the member
 * is expired before a new one is created.
 *
 * BANNED ACCOUNTS. With ALLOW_NON_MEMBER=1 a buyer who is not in the server
 * may pay, but an account BANNED from it could never get in (the invite and
 * the guilds.join "Add me" both fail): every buyer who is not in the server
 * is checked with the bot's ban lookup first and refused if banned. An
 * unknown answer (no Ban Members permission; preflight warns) lets the sale
 * go on; a failed lookup refuses it for now.
 *
 * OFFERS AND LINES. The Academy line (academy:true prices) is sold by
 * package, exactly as above. A pure membership product (academy:false, e.g.
 * an Upgrade.Chat-style Premium plan) is its own line, keyed by its role set,
 * and is posted by price id. The duplicate guard is per line: an active
 * Premium membership never blocks an Academy plan, and vice versa. A lifetime
 * that already covers an offer (the Academy lifetime for Academy offers, or a
 * lifetime that grants every role of a membership) makes it "owned".
 *
 * FREE TRIALS. A price with "trialDays" offers its trial ONLY to a Discord
 * account that never had one, on any product: no row in
 * academy_billing_trials AND no subscription on the member's Customer that
 * ever had a trial (the fresh Stripe snapshot). A member with NO bound
 * Customer (a first purchase, or a database restore / rollback that lost the
 * binding and the ledger) is also looked up in Stripe: every Academy Customer
 * Stripe Search finds for the Discord id (the ones ensureCustomer would
 * adopt) is read for past trials. That lookup fails closed: a Search or list
 * that errors or is truncated offers no trial (/buy says the trial could not
 * be checked, and checkout of a trial price answers 503 until it can).
 * Otherwise the same price is
 * sold without a trial (the consent text then has no trial either), EXCEPT
 * a free-only offer (its own trial covers its auto-stop: Free Trial Access,
 * pages.offerTerms trialOnly): it is only ever a free trial and is never
 * sold as a paid plan (owner decision 2026-09-26: it never charges). A trial
 * adds subscription_data.trial_period_days; "trialNoCard" also sends
 * payment_method_collection 'if_required' (Checkout asks for no payment
 * method while nothing is due) and
 * subscription_data.trial_settings.end_behavior.missing_payment_method
 * 'cancel' (the subscription cancels itself at the trial end unless the
 * member added one). The trial is recorded when resync first sees the
 * subscription, never at checkout, so an abandoned checkout keeps it.
 * ========================================================================== */

const crypto = require('node:crypto');
const { computeAccess, grantOf } = require('./access');
const { isRecurring, LABELS, intervalPhrase, formatAmount, maxCharges, cancelAfterFor } = require('./catalog');
const { hasDelayedMethod, US_BANK_VERIFICATION_METHOD, TRIAL_DAYS_MIN, TRIAL_DAYS_MAX } = require('./config');
const { disclosureFor, consentSha, offerTerms, BANK_PAYMENT_NOTE } = require('./pages');
const shapes = require('./stripe-shapes');
const audit = require('./audit');

const SESSION_TTL_SECONDS = 35 * 60;

/** What the consent text must say this offer grants (see pages.disclosureFor). */
function grantsForDisclosure(desc) {
  return {
    academy: desc.academy !== false,
    lifetimeRole: desc.lifetimeRole !== undefined ? Boolean(desc.lifetimeRole) : true,
    roleNames: Array.isArray(desc.roleNames) ? desc.roleNames : [],
    label: desc.label || null
  };
}
/* Stripe's own 'existing subscription' set plus incomplete (Stripe expires an
   incomplete subscription by itself after 23 h). */
const DUPLICATE_STATUSES = Object.freeze(['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete']);
const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The line under Stripe's pay button. trial = { days, noCard } offered to
 * this member (null: none); cancelAfterDays = the price's auto-stop (default
 * 3 on a daily price).
 */
function renewalLine(pkg, amount, currency, { delayed = false, label = null, academy = true, trial = null, cancelAfterDays, intro = null } = {}) {
  if (intro && isRecurring(pkg) && Number.isInteger(intro.cents)) {
    const bonus = Number.isInteger(intro.bonusAcademyDays) ? ` Includes ${intro.bonusAcademyDays} days of MEM Academy at no extra charge.` : '';
    return `${formatAmount(intro.cents, currency)} today for your first ${intervalPhrase(pkg)}, then renews every ${intervalPhrase(pkg)} at ${formatAmount(amount, currency)} until you cancel.${bonus} Welcome-back price, once per Discord account. Cancel any time in Manage billing.`;
  }
  if (!isRecurring(pkg)) {
    const base = academy
      ? 'One-time payment for MEM Lifetime. Final sale as described in the MEM Academy Terms.'
      : `One-time payment for ${label || 'this membership'}. Final sale as described in the Terms.`;
    return delayed ? `${base} ${BANK_PAYMENT_NOTE}` : base;
  }
  const price = formatAmount(amount, currency);
  const stopAfter = cancelAfterDays === undefined ? cancelAfterFor(pkg, null) : cancelAfterDays;
  const trialDays = trial && Number.isInteger(trial.days) ? trial.days : null;
  const charges = maxCharges({ pkg, trialDays, cancelAfterDays: stopAfter });
  if (charges === 0) {
    return `Free for ${stopAfter} day${stopAfter === 1 ? '' : 's'}. It ends by itself and is never charged. One free trial per Discord account.`;
  }
  const cap = charges === null ? '' : ` Ends by itself after ${trialDays !== null ? 'at most ' : ''}${charges} charge${charges === 1 ? '' : 's'}.`;
  if (trialDays !== null) {
    const noCard = trial.noCard ? ' No card is needed for the trial: without one it ends by itself when the trial ends.' : ' Cancel before the trial ends and you are not charged.';
    return `Free for ${trialDays} days, then renews every ${intervalPhrase(pkg)} at ${price} until you cancel.${cap}${noCard} One free trial per Discord account. Cancel any time in Manage billing.`;
  }
  return `Renews every ${intervalPhrase(pkg)} at ${price} until you cancel.${cap} Cancel any time in Manage billing.`;
}

/** PURE and exact; see the header for every rule it encodes. trial =
 *  { days, noCard } when this member is offered the price's free trial. */
function buildCheckoutParams({ pkg, priceId, amount, currency = 'usd', customerId, discordId, intent, urls, flags, nowMs, label = null, academy = true,
  trial = null, cancelAfterDays, winback = null }) {
  const metadata = {
    sml_kind: shapes.ACADEMY_KIND,
    mem_academy_v: '1',
    mem_academy_intent: intent.id,
    mem_academy_discord_user: String(discordId),
    mem_academy_package: pkg,
    mem_academy_price: priceId,
    mem_academy_consent_version: intent.consentVersion,
    mem_academy_consent_sha256: intent.consentSha256
  };
  /* Fail closed. An empty list would let Stripe fall back to the Dashboard's
     dynamic payment methods, and a delayed method (bank debit) on a
     subscription turns it active before the money clears. config.js already
     refuses both; this keeps the pure builder safe on its own. */
  if (!Array.isArray(flags.paymentMethods) || !flags.paymentMethods.length) {
    throw Object.assign(new Error('payment_methods_required'), { code: 'payment_methods_required' });
  }
  const delayed = hasDelayedMethod(flags.paymentMethods);
  if (delayed && isRecurring(pkg)) {
    throw Object.assign(new Error(`delayed_method_on_subscription: ${pkg}`), { code: 'delayed_method_on_subscription' });
  }
  if (trial && (!isRecurring(pkg) || !Number.isInteger(trial.days) || trial.days < TRIAL_DAYS_MIN || trial.days > TRIAL_DAYS_MAX)) {
    throw Object.assign(new Error(`trial_not_allowed: ${pkg}`), { code: 'trial_not_allowed' });
  }
  if (trial) metadata.mem_academy_trial_days = String(trial.days);
  /* winback = { couponId, promotionCodeId, cents, bonusAcademyDays } (the
     discount ids and cents null without an intro price): marks the
     subscription as this account's one win-back (checked on every later
     offer) and carries the bonus days. The intro discount is EITHER the
     engine's coupon (couponId) OR the owner's promotion code
     (promotionCodeId), which wins when both are given. */
  if (winback) {
    if (!isRecurring(pkg) || trial) throw Object.assign(new Error(`winback_not_allowed: ${pkg}`), { code: 'winback_not_allowed' });
    metadata.mem_academy_winback = '1';
    if (Number.isInteger(winback.cents)) metadata.mem_academy_intro_cents = String(winback.cents);
    if (Number.isInteger(winback.bonusAcademyDays)) metadata.mem_academy_bonus_days = String(winback.bonusAcademyDays);
    if (winback.promotionCodeId) metadata.mem_academy_promotion_code = String(winback.promotionCodeId);
  }
  const intro = winback && (winback.couponId || winback.promotionCodeId) && Number.isInteger(winback.cents)
    ? { cents: winback.cents, bonusAcademyDays: winback.bonusAcademyDays } : null;
  const params = {
    mode: isRecurring(pkg) ? 'subscription' : 'payment',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: intent.id,
    metadata: { ...metadata },
    payment_method_types: [...flags.paymentMethods],
    allow_promotion_codes: false,
    custom_text: { submit: { message: renewalLine(pkg, amount, currency, { delayed, label, academy, trial, cancelAfterDays, intro }).slice(0, 1200) } },
    expires_at: Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS,
    success_url: `${urls.publicUrl}/v1/academy/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${urls.publicUrl}/v1/academy/billing/buy?package=${encodeURIComponent(pkg)}`
  };
  /* The intro month is a one-time discount: the owner's promotion code when
     the entry names one, else the engine's coupon on the price's product.
     Stripe refuses allow_promotion_codes next to discounts, and no code typed
     by the buyer is allowed either way. */
  if (intro) {
    delete params.allow_promotion_codes;
    params.discounts = winback.promotionCodeId
      ? [{ promotion_code: String(winback.promotionCodeId) }]
      : [{ coupon: winback.couponId }];
  }
  if (isRecurring(pkg)) {
    params.subscription_data = { metadata: { ...metadata } };
    if (trial) {
      params.subscription_data.trial_period_days = trial.days;
      if (trial.noCard) {
        /* No payment method while nothing is due; without one the
           subscription cancels itself when the trial ends. */
        params.payment_method_collection = 'if_required';
        params.subscription_data.trial_settings = { end_behavior: { missing_payment_method: 'cancel' } };
      }
    }
  } else {
    params.payment_intent_data = { metadata: { ...metadata } };
    params.invoice_creation = { enabled: true, invoice_data: { metadata: { ...metadata } } };
  }
  if (flags.paymentMethods.includes('us_bank_account')) {
    params.payment_method_options = { us_bank_account: { verification_method: US_BANK_VERIFICATION_METHOD } };
  }
  if (flags.tosConsent) params.consent_collection = { terms_of_service: 'required' };
  if (flags.automaticTax) {
    params.automatic_tax = { enabled: true };
    params.customer_update = { address: 'auto' };
  }
  return params;
}

function createRateLimiter({ now = Date.now, windowMs = 10 * 60_000 } = {}) {
  const hits = new Map();
  return function allow(key, max) {
    const at = now();
    const list = (hits.get(key) || []).filter((t) => at - t < windowMs);
    if (list.length >= max) { hits.set(key, list); return false; }
    list.push(at);
    hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || at - v[v.length - 1] > windowMs) hits.delete(k);
    return true;
  };
}

function createCheckout({ config, store, stripeApi, catalog, bot, tokens, resync, takeSnapshot, preflight,
  logger = () => {}, now = Date.now, uuid = () => crypto.randomUUID(), onMemberSeen = null } = {}) {
  const allow = createRateLimiter({ now });
  /* A refreshed success page must not turn into a Stripe call storm. */
  const settled = new Map();
  const SETTLE_REUSE_MS = 10_000;
  /* The success page poll re-checks a buyer who is not in the server yet at
     most once a minute, so a waiting role lands soon after they join. */
  const seenChecks = new Map();
  const SEEN_CHECK_MS = 60_000;

  /** A buyer who is not in the server: 'banned', 'not_banned', 'unknown'
   *  (the bot cannot read bans) or 'error'. */
  async function banState(discordId) {
    if (!bot || typeof bot.getBan !== 'function') return 'unknown';
    try {
      const banned = await bot.getBan(String(discordId));
      if (banned === true) return 'banned';
      return banned === false ? 'not_banned' : 'unknown';
    } catch (_) {
      return 'error';
    }
  }

  /* Is any price on sale with a free trial? Only then is an unbound member's
     trial history looked up in Stripe (no extra Stripe call otherwise). */
  const trialOnSale = [...(config.prices ? config.prices.values() : [])].some((entry) => entry.sell && Number.isInteger(entry.trialDays));

  /**
   * Free-trial history of a member with no bound Customer: every Academy
   * Customer of this livemode that Stripe Search finds for the Discord id
   * (ensureCustomer adopts one of them), read for any subscription that ever
   * had a trial. 'used' | 'none' | 'failed' (an error or a truncated list:
   * the caller offers no trial).
   */
  async function unboundTrialHistory(discordId) {
    try {
      const found = await stripeApi.searchCustomersByDiscordId(discordId);
      if (!found || !Array.isArray(found.data) || found.complete === false) return 'failed';
      const mine = found.data.filter((c) => c && !c.deleted && shapes.isAcademyMeta(c.metadata)
        && Boolean(c.livemode) === Boolean(config.livemode) && String(c.metadata.mem_academy_discord_user) === String(discordId));
      for (const customer of mine) {
        const subs = await stripeApi.listSubscriptions(customer.id);
        if (!subs || !Array.isArray(subs.data) || subs.complete === false) return 'failed';
        if (subs.data.some((sub) => Number(sub.trial_start) > 0 || Number(sub.trial_end) > 0)) return 'used';
      }
      return 'none';
    } catch (error) {
      logger('warn', 'academy_billing_trial_lookup_failed', { discordUserId: String(discordId),
        error: String(error && (error.code || error.type || error.message) || 'error').slice(0, 80) });
      return 'failed';
    }
  }

  /** Read-only view of a member's current access (no DB writes). */
  async function readAccess(discordId) {
    const member = await store.getMember(store.pool, discordId);
    const cacheRows = member ? await store.lifetimeRows(store.pool, discordId) : [];
    const snapshot = await takeSnapshot(member, discordId, cacheRows);
    const comps = await store.compsFor(store.pool, discordId);
    const access = computeAccess({ snapshot: { ...snapshot, comps }, now: now(), partialRefundRevokes: config.partialRefundRevokes,
      livemode: config.livemode, stripeSuppressed: Boolean(snapshot.bindingConflict), externalRoleIds: config.externalRoleIds });
    const lifetimeSources = access.sources.filter((s) => s.kind === 'lifetime');
    const disputedLifetimes = access.lifetimeStates.filter((s) => s.state === 'disputed');
    /* The Academy lifetime (the Academy line); a membership lifetime only
       covers its own roles (ownedExternal). */
    const lifetime = lifetimeSources.some((s) => (s.roles || []).includes('academy')) || disputedLifetimes.some((s) => s.academy !== false);
    const ownedExternal = new Set([...lifetimeSources, ...disputedLifetimes].flatMap((s) => s.externalRoles || []).map(String));
    /* Owned, but an open dispute suspends every Stripe source (for a bank
       debit that includes an authorization inquiry): not sold again, and not
       shown as "Access active" either. */
    const lifetimeSuspended = lifetime && access.disputeOpen;
    const noAccess = new Set([...(access.voidedSubs || []), ...access.refundedSubs.filter((r) => !r.partial)].map((r) => r.subscriptionId));
    const ending = (sub) => Boolean(sub.cancelAtPeriodEnd || sub.cancelAt);
    /* A free trial set to end before its trial does (Free Trial Access)
       can never charge, so it never blocks buying a paid plan of its line. */
    const neverCharges = (sub) => sub.status === 'trialing' && Boolean(sub.cancelAt) && Boolean(sub.trialEnd) && sub.cancelAt <= sub.trialEnd;
    const blocking = snapshot.subscriptions.filter((sub) => DUPLICATE_STATUSES.includes(sub.status) && !(noAccess.has(sub.id) && ending(sub))
      && !neverCharges(sub));
    const blockingLines = new Set(blocking.map((sub) => grantOf(sub.price).line));
    /* A lifetime bank debit that has not cleared yet. */
    const lifetimePending = !lifetime && (access.pendingLifetime || []).length > 0;
    /* One free trial per Discord account: the ledger, or any subscription of
       the member's Customer that ever had a trial; with no bound Customer,
       any Academy Customer Stripe Search finds for this account (a database
       restore loses the binding and the ledger, never Stripe's history). */
    let trialUsed = (snapshot.trials || []).length > 0 || Boolean(await store.trialFor(store.pool, discordId));
    let trialUnknown = false;
    if (!trialUsed && trialOnSale && !(member && member.stripe_customer_id)) {
      const history = await unboundTrialHistory(discordId);
      trialUsed = history !== 'none';
      trialUnknown = history === 'failed';
    }
    /* Win-back: a listed former member whose Customer never had a win-back
       subscription (any status). */
    const winbackUsed = Boolean(snapshot.winbackUsed);
    const winbackEligible = Boolean(config.winbackIds && config.winbackIds.has(String(discordId))) && !winbackUsed;
    return { member, snapshot, access, lifetime, lifetimeSuspended, lifetimePending, ownedExternal, blockingLines, trialUsed, trialUnknown,
      winbackUsed, winbackEligible, recurring: blockingLines.has('academy'), entitled: access.roles.size > 0 };
  }

  async function transitionIntent(client, { id = null, sessionId = null, status, actor }) {
    const rows = await store.markIntentStatus(client, { id, sessionId, status });
    for (const row of rows) {
      await audit.append(client, { actor, livemode: config.livemode, discordUserId: row.discord_user_id, action: `intent_${status}`,
        outcome: 'applied', stripeRefs: [row.stripe_checkout_session_id].filter(Boolean), details: { intent: row.id } }, { now });
    }
    return rows.length;
  }

  async function ensureCustomer(discordId, bindSource) {
    let member = await store.getMember(store.pool, discordId);
    if (member && member.stripe_customer_id) return member.stripe_customer_id;
    const boundVia = ['web_oauth', 'activity', 'hub'].includes(bindSource) ? bindSource : 'web_oauth';
    await store.withUserTx(discordId, (client) => store.ensureMember(client, { discordId, boundVia }));
    /* A Customer may exist from an attempt whose DB write failed: adopt it
       (Stripe Search lags about a minute; the idempotency key covers the
       first 24 h). */
    let customerId = null;
    try {
      const found = await stripeApi.searchCustomersByDiscordId(discordId);
      const match = (found.data || []).find((c) => !c.deleted && shapes.isAcademyMeta(c.metadata)
        && Boolean(c.livemode) === Boolean(config.livemode) && String(c.metadata.mem_academy_discord_user) === String(discordId));
      customerId = match ? match.id : null;
    } catch (_) { customerId = null; }
    if (!customerId) {
      let testClock = null;
      if (config.testClock && !config.livemode) {
        const clock = await stripeApi.createTestClock({ frozen_time: Math.floor(now() / 1000), name: `mem-academy-${discordId}` },
          `mem-academy-testclock-v1-${discordId}`);
        testClock = clock.id;
      }
      const customer = await stripeApi.createCustomer({
        metadata: { sml_kind: shapes.ACADEMY_KIND, mem_academy_v: '1', mem_academy_discord_user: String(discordId) },
        invoice_settings: {
          footer: `MEM Academy plans renew automatically until cancelled. Cancel any time at ${config.publicUrl}/v1/academy/billing/start?purpose=manage . Terms: ${config.termsUrl}`
        },
        ...(testClock ? { test_clock: testClock } : {})
      }, `mem-academy-customer-v1-${config.livemode ? 'live' : 'test'}-${discordId}`);
      customerId = customer.id;
    }
    await store.withUserTx(discordId, async (client) => {
      const n = await store.setMemberCustomer(client, { discordId, customerId, accountId: config.stripeAccountId });
      if (n) {
        await audit.append(client, { actor: 'checkout', livemode: config.livemode, discordUserId: discordId, action: 'binding_created',
          outcome: 'applied', reason: boundVia, stripeRefs: [customerId] }, { now });
        return;
      }
      member = await store.getMember(client, discordId);
      if (!member || member.stripe_customer_id !== customerId) throw Object.assign(new Error('binding_conflict'), { code: 'binding_conflict' });
    });
    return customerId;
  }

  /**
   * The one-time coupon that makes a win-back price's first period cost
   * introCents. Its id carries the price and both amounts, so a repriced
   * Stripe Price gets a new coupon instead of a wrong discount.
   */
  async function ensureIntroCoupon(desc) {
    const off = desc.amount - desc.introCents;
    if (!Number.isInteger(off) || off <= 0 || !desc.productId) throw Object.assign(new Error('intro_invalid'), { code: 'intro_invalid' });
    const id = `mem_winback_${String(desc.priceId).replace(/^price_/, '')}_${desc.amount}_${desc.introCents}`.slice(0, 200);
    const existing = await stripeApi.retrieveCoupon(id);
    if (existing) {
      if (existing.valid === false || existing.amount_off !== off || existing.duration !== 'once') {
        throw Object.assign(new Error('intro_coupon_mismatch'), { code: 'intro_coupon_mismatch' });
      }
      return id;
    }
    await stripeApi.createCoupon({
      id, amount_off: off, currency: desc.currency || 'usd', duration: 'once', name: 'Welcome back: first month',
      applies_to: { products: [desc.productId] },
      metadata: { sml_kind: shapes.ACADEMY_KIND, mem_academy_winback: '1', mem_academy_price: desc.priceId }
    }, `mem-academy-coupon-v1-${id}`);
    return id;
  }

  /**
   * POST /checkout. Returns one of
   *   { status, error }            plain refusal
   *   { status, page, data }       render a page (routes.js)
   *   { redirect }                 303 to Stripe or Manage billing
   */
  async function start({ bind, form, ipKey = '' }) {
    if (!config.checkoutEnabled) return { status: 503, error: 'checkout_disabled' };
    if (!preflight.ok()) return { status: 503, error: 'preflight_not_passed' };
    if (!bind) return { status: 401, error: 'sign_in_required' };
    if (!tokens.checkCsrf(bind, form.csrf)) return { status: 403, error: 'csrf_failed' };
    if (!allow(`u:${bind.userId}`, 6) || !allow(`ip:${ipKey}`, 30)) return { status: 429, error: 'too_many_attempts' };

    /* A membership offer is posted by price id (several lines can sell the
       same package); an Academy offer by package. Anything else (a retired
       membership price, a repriced Academy plan) meets the consent hash
       check below and is shown the plans again. */
    const priceParam = String(form.price || '');
    const catalogState = await catalog.get();
    const desc = (priceParam && catalogState.winback && catalogState.winback.get(priceParam))
      || (priceParam && catalogState.memberships && catalogState.memberships.get(priceParam))
      || catalogState.sellable.get(String(form.package || '')) || null;
    if (!desc) return { status: 400, error: 'package_unavailable' };
    if (desc.winback && !(config.winbackIds && config.winbackIds.has(String(bind.userId)))) return { status: 403, error: 'winback_not_eligible' };
    const pkg = desc.key;
    const recurring = isRecurring(pkg);
    const consented = recurring ? form.consent_renewal === '1' : form.consent_final === '1';
    if (!consented) return { status: 400, error: 'consent_required' };

    const observed = await bot.getMember(bind.userId);
    if (!observed.inGuild && !config.allowNonMember) return { status: 403, page: 'non_member', data: { pkg } };
    if (!observed.inGuild) {
      const ban = await banState(bind.userId);
      if (ban === 'banned') return { status: 403, page: 'banned' };
      if (ban === 'error') return { status: 503, error: 'discord_unavailable' };
    }

    const view = await readAccess(bind.userId);
    /* Never reuse a Customer that is not an Academy one, belongs to someone
       else, or was deleted in the Dashboard: staff resolve it with the CLI. */
    if (view.snapshot.bindingConflict || view.snapshot.customerMissing) return { status: 409, error: 'binding_conflict' };
    if (!view.snapshot.complete) return { status: 503, error: 'stripe_unavailable' };
    /* A trial price is never sold while this account's trial history could
       not be read (fail closed: no second trial, and no surprise charge in
       place of a trial the buyer may still have). */
    if (view.trialUnknown && Number.isInteger(desc.trialDays)) return { status: 503, error: 'stripe_unavailable' };
    /* The consent text depends on whether this account can still use the
       price's free trial (fresh snapshot + ledger): a trial used meanwhile
       (another tab) changes the text, so the buyer sees the plans again. */
    if (desc.winback && view.winbackUsed) return { status: 409, error: 'winback_used' };
    const terms = offerTerms(desc, { trialUsed: view.trialUsed });
    /* A free-only offer (Free Trial Access) is only ever a free trial: never
       sold as the paid daily plan to an account whose trial is used. */
    if (terms.trialOnly && terms.trialDays === null) return { status: 409, error: 'free_trial_used' };
    const disclosure = disclosureFor({ pkg, amount: desc.amount, currency: desc.currency, termsUrl: config.termsUrl, privacyUrl: config.privacyUrl,
      grants: grantsForDisclosure(desc), terms });
    const sha = consentSha(config.consentVersion, disclosure.text);
    if (String(form.disclosure_sha || '') !== sha) return { status: 409, page: 'prices_changed' };
    const trial = terms.trialDays !== null ? { days: terms.trialDays, noCard: terms.trialNoCard } : null;
    const academyOffer = desc.academy !== false;
    if (academyOffer && view.lifetime) return { status: 409, page: 'owned' };
    if (!academyOffer && (desc.roles || []).every((roleId) => view.ownedExternal.has(String(roleId)))) {
      return { status: 409, page: 'owned', data: { label: desc.label } };
    }
    if (view.lifetimePending) return { status: 409, page: 'lifetime_pending' };
    if (recurring && view.blockingLines.has(desc.line || 'academy')) return { redirect: '/v1/academy/billing/manage' };

    const customerId = await ensureCustomer(bind.userId, bind.source);
    const intent = {
      id: uuid(),
      discordId: bind.userId,
      package: pkg,
      priceId: desc.priceId,
      customerId,
      bindSource: ['web_oauth', 'activity', 'hub'].includes(bind.source) ? bind.source : 'web_oauth',
      consentKind: disclosure.kind,
      consentVersion: config.consentVersion,
      consentSha256: sha,
      consentedAt: now(),
      expiresAt: now() + SESSION_TTL_SECONDS * 1000,
      trialDays: trial ? trial.days : null
    };
    const inserted = await store.withUserTx(bind.userId, async (client) => {
      if (await store.recentCreatedIntent(client, bind.userId, 20)) return false;
      await store.insertIntent(client, intent);
      await audit.append(client, { actor: 'checkout', livemode: config.livemode, discordUserId: bind.userId, action: 'intent_created',
        outcome: 'applied', reason: pkg, stripeRefs: [customerId, desc.priceId],
        details: { intent: intent.id, package: pkg, consentKind: disclosure.kind, consentVersion: config.consentVersion, consentSha256: sha,
          trialDays: trial ? trial.days : null, trialNoCard: Boolean(trial && trial.noCard), trialUsed: terms.trialUsed,
          winback: Boolean(desc.winback), introCents: terms.introCents } }, { now });
      return true;
    });
    if (!inserted) return { status: 429, error: 'checkout_in_progress' };

    try {
      /* Built (and so checked) before anything in Stripe is touched. */
      const paymentMethods = Array.isArray(desc.paymentMethods) && desc.paymentMethods.length ? desc.paymentMethods : config.paymentMethods;
      const winback = desc.winback ? {
        /* the catalog only lists a promotionCode price after checking the
           code against the live price, so it is applied as-is here */
        promotionCodeId: desc.promotionCode || null,
        couponId: terms.introCents !== null && !desc.promotionCode ? await ensureIntroCoupon(desc) : null,
        cents: terms.introCents,
        bonusAcademyDays: terms.bonusAcademyDays
      } : null;
      const params = buildCheckoutParams({ winback,
        pkg, priceId: desc.priceId, amount: desc.amount, currency: desc.currency, customerId, discordId: bind.userId, intent,
        urls: { publicUrl: config.publicUrl }, nowMs: now(), label: desc.label, academy: academyOffer, trial, cancelAfterDays: terms.cancelAfterDays,
        flags: { paymentMethods, tosConsent: config.tosConsent, automaticTax: config.automaticTax }
      });
      const open = await stripeApi.listOpenCheckoutSessions(customerId);
      for (const session of open.data || []) {
        await stripeApi.expireCheckoutSession(session.id, `mem-academy-expire-v1-${session.id}`);
        await store.withUserTx(bind.userId, (client) => transitionIntent(client, { sessionId: session.id, status: 'expired', actor: 'checkout' }));
      }
      const session = await stripeApi.createCheckoutSession(params, `mem-academy-checkout-v1-${intent.id}`);
      await store.markIntentOpen(store.pool, { id: intent.id, sessionId: session.id });
      return { redirect: session.url, intentId: intent.id, sessionId: session.id };
    } catch (error) {
      logger('error', 'academy_billing_checkout_failed', { intent: intent.id, error: String(error && (error.code || error.type || error.message) || 'error').slice(0, 120) });
      await store.withUserTx(bind.userId, (client) => transitionIntent(client, { id: intent.id, status: 'failed', actor: 'checkout' })).catch(() => {});
      return { status: 502, error: 'stripe_checkout_failed' };
    }
  }

  /**
   * The success page's settle: idempotent with the webhook path. Trusts only
   * the session id; everything else is re-read from Stripe and must match the
   * stored binding. Only a session THIS engine created (a stored checkout
   * intent of this livemode) ever reaches Stripe: the page is public, and
   * MEM's per-account Stripe rate limit is shared with the store, Upgrade.Chat,
   * Creator Tiers and subdomains. Every real success_url visit has an intent:
   * the buyer is only redirected to Stripe after markIntentOpen succeeded.
   */
  async function settle(sessionId) {
    if (!SESSION_ID.test(String(sessionId || ''))) return { ok: false, reason: 'invalid_session' };
    if (String(sessionId).startsWith('cs_live_') !== Boolean(config.livemode)) return { ok: false, reason: 'livemode_mismatch' };
    const recent = settled.get(sessionId);
    if (recent && now() - recent.at < SETTLE_REUSE_MS) return recent.result;
    const intent = await store.getIntentBySession(store.pool, sessionId);
    if (!intent) return { ok: false, reason: 'unknown_session' };
    const result = await settleOnce(sessionId, intent);
    settled.set(sessionId, { at: now(), result });
    if (settled.size > 2000) for (const [key, value] of settled) if (now() - value.at > SETTLE_REUSE_MS) settled.delete(key);
    return result;
  }

  async function settleOnce(sessionId, intent) {
    const session = await stripeApi.retrieveCheckoutSession(sessionId);
    if (!session || !shapes.isAcademyMeta(session.metadata)) return { ok: false, reason: 'not_academy' };
    const discordId = String(session.metadata.mem_academy_discord_user || '');
    if (String(intent.discord_user_id) !== discordId) return { ok: false, reason: 'binding_mismatch' };
    const member = /^[0-9]{15,24}$/.test(discordId) ? await store.getMember(store.pool, discordId) : null;
    if (!member || !member.stripe_customer_id || member.stripe_customer_id !== shapes.idOf(session.customer)) {
      return { ok: false, reason: 'binding_mismatch' };
    }
    const intentId = UUID.test(String(session.client_reference_id || '')) ? session.client_reference_id : null;
    const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
    /* A completed session that is still unpaid was paid by a delayed method
       (bank debit): nothing is granted until the debit clears
       (checkout.session.async_payment_succeeded, or a later re-read here, by
       the due-scan or by the reconciler that sees the PaymentIntent
       succeeded). checkout.session.async_payment_failed marks the intent
       failed. */
    const failed = !paid && intent.status === 'failed';
    const processing = !paid && !failed && session.status === 'complete' && session.payment_status === 'unpaid';
    if (paid) {
      await store.withUserTx(discordId, (client) => transitionIntent(client, { id: intentId, sessionId, status: 'completed', actor: 'settle' }));
    } else if (session.status === 'expired') {
      await store.withUserTx(discordId, (client) => transitionIntent(client, { id: intentId, sessionId, status: 'expired', actor: 'settle' }));
    }
    let result = null;
    if (paid) result = await resync(discordId, { actor: 'settle' });
    return {
      ok: true,
      paid,
      processing,
      failed,
      discordId,
      mode: session.mode,
      /* a free trial: Checkout charged nothing (no_payment_required) */
      trial: paid && session.mode === 'subscription' && session.payment_status === 'no_payment_required',
      lifetimeWithPlan: Boolean(result && (result.stripeActions || []).some((a) => a.action === 'lifetime_supersede'))
    };
  }

  /** Stripe Billing Portal with the DEDICATED configuration. */
  async function portal(bind) {
    if (!bind || bind.purpose !== 'manage') return { redirect: '/v1/academy/billing/start?purpose=manage' };
    const member = await store.getMember(store.pool, bind.userId);
    if (!member || !member.stripe_customer_id) return { status: 404, page: 'no_customer' };
    if (!config.portalConfigId) return { status: 503, error: 'portal_unconfigured' };
    if (!preflight.stripeAccountOk()) return { status: 503, error: 'preflight_not_passed' };
    const session = await stripeApi.createPortalSession({
      customer: member.stripe_customer_id,
      configuration: config.portalConfigId,
      return_url: `${config.publicUrl}/v1/academy/billing/buy`
    }, `mem-academy-portal-v1-${bind.userId}-${bind.nonce}`);
    await audit.appendStandalone(store.pool, { actor: 'portal', livemode: config.livemode, discordUserId: bind.userId, action: 'portal_opened',
      outcome: 'applied', stripeRefs: [member.stripe_customer_id] }, { now });
    return { redirect: session.url };
  }

  /** JSON for the success page poll: this session's own binding only, no PII. */
  async function status(sessionId) {
    if (!SESSION_ID.test(String(sessionId || ''))) return null;
    const intent = await store.getIntentBySession(store.pool, sessionId);
    if (!intent) return null;
    const member = await store.getMember(store.pool, intent.discord_user_id);
    const roles = await store.roleStatusFor(store.pool, intent.discord_user_id);
    const last = member && member.last_access ? member.last_access : {};
    const entitled = (Array.isArray(last.roles) && last.roles.length > 0) || (Array.isArray(last.externalRoles) && last.externalRoles.length > 0);
    /* This checkout bought Lifetime by bank debit and it has not cleared:
       the page must not say "access active" from an older plan's role. */
    const lifetimePending = intent.package === 'lifetime' && last.lifetimePending === true;
    const wanted = roles.filter((r) => r.desired);
    /* A role waits for a buyer who is not in the server yet: the page shows
       the invite, and a buyer who has joined gets the role now. */
    const awaitingMember = wanted.some((r) => r.state === 'awaiting_member');
    if (awaitingMember) await recheckMember(String(intent.discord_user_id));
    return {
      entitled,
      intent: intent.status,
      lifetimePending,
      lifetime: last.lifetime === true,
      awaitingMember,
      roles: wanted.map((r) => ({ key: r.key, state: r.state }))
    };
  }

  /** At most once a minute per buyer: joined the server -> waiting grants are due now. */
  async function recheckMember(discordId) {
    if (typeof onMemberSeen !== 'function' || !bot) return false;
    const last = seenChecks.get(discordId);
    if (last && now() - last < SEEN_CHECK_MS) return false;
    seenChecks.set(discordId, now());
    if (seenChecks.size > 5000) for (const [key, at] of seenChecks) if (now() - at > SEEN_CHECK_MS) seenChecks.delete(key);
    try {
      const observed = await bot.getMember(discordId);
      if (!observed || !observed.inGuild) return false;
      onMemberSeen(discordId);
      return true;
    } catch (_) {
      return false;
    }
  }

  return { start, settle, portal, status, readAccess, ensureCustomer, transitionIntent, recheckMember, banState, ensureIntroCoupon };
}

module.exports = { buildCheckoutParams, createCheckout, createRateLimiter, renewalLine, grantsForDisclosure, SESSION_TTL_SECONDS, DUPLICATE_STATUSES, LABELS,
  US_BANK_VERIFICATION_METHOD };
