'use strict';

/* The Making Easy Money products of the Upgrade.Chat store (owner request
   2026-09-26), sold through Stripe next to the Academy packages:
     Elite Lifetime Access  $7,490.90 once       Monarch + Elite
     Elite Yearly Access    $849.90 / year       Elite, 7-day free trial
     Elite Monthly Access   $89.90 / month       Elite, 7-day free trial
     Elite Week Seat        $34.90 / week        Elite, 7-day free trial
     Free Trial Access      $7.90 / day          Elite, a plain 3-day free
                                                 trial without a card that
                                                 stops by itself, never charged
                                                 (owner decision 2026-09-26)
   and the Academy Lifetime granting the Academy Student role and Monarch
   ONLY (owner correction 2026-09-26: never Elite, so it neither owns Elite
   Lifetime Access nor supersedes an Elite plan). Covers the free trial rules
   (one per Discord account across every product), the per-price auto-stop,
   trial ends without payment, the lifetime supersede and owned rules, and
   the Upgrade.Chat 'any' keep rule. */

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildCheckoutParams, createCheckout, renewalLine } = require('./checkout');
const { createResync, TRIAL_STOP_MARGIN_SEC } = require('./resync');
const { createCatalog } = require('./catalog');
const { createApplier } = require('./applier');
const { createLinkTokens } = require('./link-token');
const { createUcChecker, UC_KEPT_RECHECK_MS, STAFF_KEEP_REASON } = require('./external');
const { computeAccess } = require('./access');
const pages = require('./pages');
const k = require('./testkit');

const { USER, ACADEMY_ROLE, MONARCH, ELITE, PREMIUM, T0, S } = k;
const CUS = 'cus_mem1';
const DAY = 86400;
const DAY_MS = DAY * 1000;
/* A free-only trial is stopped this long before its trial end. */
const MARGIN = TRIAL_STOP_MARGIN_SEC;
/* The engine Customer of a member who saved a default card (an earlier plan,
   or a card update in Manage billing): Stripe charges it at a trial end. */
const SAVED_CARD = { [CUS]: k.academyCustomer(CUS, USER, { invoice_settings: { default_payment_method: 'pm_saved_card' } }) };

/* bound=false: the member has no row in the database (a first purchase, or a
   database restore / rollback that lost the binding and the trial ledger).
   rulesAllowed=false: preflight blocks the Stripe rules. */
function setup({ env = {}, members = { [USER]: [] }, fixtures = {}, uc = null, bound = true, customers = null, rulesAllowed = true, logs = null } = {}) {
  const now = k.clock();
  const config = k.config({ ...k.memEnv(), ...env });
  const store = k.createFakeStore({ now });
  const stripe = k.createFakeStripe({ customers: customers || { [CUS]: k.academyCustomer(CUS, USER) }, ...fixtures });
  const bot = k.createFakeBot({ members });
  const catalog = createCatalog({ config, stripeApi: stripe, now });
  const client = uc || k.createFakeUc();
  const ucChecker = createUcChecker({ config, client, now });
  const logger = (level, event, details) => { if (logs) logs.push([level, event, details]); };
  const engine = createResync({ config, store, stripeApi: stripe, catalog, bot, now, ucChecker, logger, stripeWritesAllowed: () => rulesAllowed });
  const tokens = createLinkTokens({ secret: config.clientSecret, now });
  let n = 0;
  const checkout = createCheckout({ config, store, stripeApi: stripe, catalog, bot, tokens, resync: engine.resync, takeSnapshot: engine.takeSnapshot,
    preflight: { ok: () => true, stripeAccountOk: () => true }, now, uuid: () => `0b9f1f64-6a3c-4d7b-9a44-${String(++n).padStart(12, '0')}` });
  const bind = tokens.readBind(tokens.issueBind({ userId: USER, guildId: k.GUILD, source: 'web_oauth', purpose: 'buy' }));
  const calls = [];
  /* A fake Discord that applies each role call to the member the resync reads. */
  const fetchImpl = async (url, init) => {
    const parts = String(url).split('/');
    const user = parts[8];
    const role = parts[10];
    calls.push([init.method, user, role]);
    const held = bot.state.members[user];
    if (held == null) return new Response(JSON.stringify({ code: 10007, message: 'Unknown Member' }), { status: 404 });
    if (init.method === 'PUT' && !held.includes(role)) bot.state.members[user] = [...held, role];
    if (init.method === 'DELETE') bot.state.members[user] = held.filter((r) => r !== role);
    return new Response(null, { status: 204 });
  };
  const applier = createApplier({ config, store, bot, fetchImpl, sleep: async () => {}, now });
  if (bound) k.bindMember(store, USER, CUS);
  const ledger = (role) => store.db.external.get(`false|${k.GUILD}|${USER}|${role}`) || null;
  const held = () => [...(bot.state.members[USER] || [])].sort();
  return { now, config, store, stripe, bot, catalog, client, ucChecker, engine, checkout, tokens, bind, applier, calls, ledger, held };
}

/** The /buy form for one offer, exactly as the page renders it for this member. */
async function formFor(t, priceId) {
  const state = await t.catalog.get();
  const desc = state.memberships.get(priceId) || [...state.sellable.values()].find((d) => d.priceId === priceId);
  assert.ok(desc, `${priceId} is on sale`);
  const view = await t.checkout.readAccess(USER);
  const terms = pages.offerTerms(desc, { trialUsed: view.trialUsed });
  const d = pages.disclosureFor({ pkg: desc.key, amount: desc.amount, currency: desc.currency, termsUrl: t.config.termsUrl,
    privacyUrl: t.config.privacyUrl, grants: pages.offerGrants(desc), terms });
  const form = { package: desc.key, price: priceId, csrf: t.tokens.csrfFor(t.bind), disclosure_sha: pages.consentSha(t.config.consentVersion, d.text),
    [desc.key === 'lifetime' ? 'consent_final' : 'consent_renewal']: '1' };
  return { form, desc, terms, disclosure: d, view };
}

async function buy(t, priceId) {
  const { form, disclosure, terms } = await formFor(t, priceId);
  t.now.advance(60_000);
  const result = await t.checkout.start({ bind: t.bind, form, ipKey: 'ip' });
  assert.ok(result.redirect, JSON.stringify(result));
  const session = t.stripe.callsOf('createCheckoutSession').pop().args[0];
  return { result, session, disclosure, terms, intent: t.store.db.intents.get(result.intentId) };
}

/** Checkout completed: Stripe created the subscription (trialing when a trial
 *  was given; a no-card trial carries Checkout's missing_payment_method=cancel). */
function subscribe(t, { id, price, trialDays = null, start = S(T0), status = null, customer = CUS }) {
  const trialEnd = trialDays ? start + trialDays * DAY : null;
  const periodEnd = trialEnd || start + 30 * DAY;
  const entry = t.config.prices.get(price);
  const noCard = Boolean(trialDays) && Boolean(entry && entry.trialNoCard);
  t.stripe.data.subscriptions.push(k.subscription({ id, customer, price, status: status || (trialDays ? 'trialing' : 'active'),
    created: start, start, periodStart: start, periodEnd, trialStart: trialDays ? start : null, trialEnd,
    trialSettings: noCard ? { end_behavior: { missing_payment_method: 'cancel' } } : null }));
  return t.stripe.data.subscriptions[t.stripe.data.subscriptions.length - 1];
}

/* ------------------------------ config ------------------------------ */

test('config: the five store products next to the Academy line; Academy Lifetime grants Monarch only (never Elite)', () => {
  const t = setup();
  assert.equal(t.config.enabled, true, t.config.errors.join('; '));
  assert.equal(t.config.ucMatch, 'any');
  const p = (id) => t.config.prices.get(id);
  assert.deepEqual([p('price_life1').academy, p('price_life1').roles, p('price_life1').paymentMethods], [true, [MONARCH], ['card', 'us_bank_account']]);
  assert.deepEqual([p('price_elitelife').package, p('price_elitelife').academy, p('price_elitelife').roles], ['lifetime', false, [MONARCH, ELITE]]);
  for (const id of ['price_eliteyear', 'price_elitemonth', 'price_eliteweek']) {
    assert.deepEqual([p(id).academy, p(id).roles, p(id).trialDays, p(id).trialNoCard, p(id).cancelAfterDays], [false, [ELITE], 7, false, null], id);
    assert.equal(p(id).line, `roles:${ELITE}`);
  }
  const free = p('price_freetrial');
  /* owner decision 2026-09-26 ("3 DAY"): a plain 3-day trial that stops by itself */
  assert.deepEqual([free.package, free.roles, free.trialDays, free.trialNoCard, free.cancelAfterDays], ['daily', [ELITE], 3, true, 3]);
  /* the Academy Day plan keeps its 3-charge cap by default; other plans have none */
  assert.equal(p('price_daily1').cancelAfterDays, 3);
  assert.equal(p('price_monthly1').cancelAfterDays, null);
  /* 'any' needs no product map: no "has no entry" warning */
  assert.equal(t.config.warnings.some((w) => /has no entry/.test(w)), false, t.config.warnings.join('; '));
});

/* ------------------------------ free trials ------------------------------ */

test('the first free trial (Elite Monthly Access): 7 days with a card, disclosed, recorded once the subscription exists', async () => {
  const t = setup();
  const { session, disclosure, intent } = await buy(t, 'price_elitemonth');
  assert.equal(session.mode, 'subscription');
  assert.equal(session.subscription_data.trial_period_days, 7);
  assert.equal(session.payment_method_collection, undefined, 'a card trial collects the card');
  assert.equal(session.subscription_data.trial_settings, undefined);
  assert.equal(session.metadata.mem_academy_trial_days, '7');
  assert.equal(session.subscription_data.metadata.mem_academy_trial_days, '7');
  assert.match(session.custom_text.submit.message, /^Free for 7 days, then renews every month at \$89\.90 until you cancel\. Cancel before the trial ends/);
  assert.equal(disclosure.kind, 'auto_renewal');
  assert.match(disclosure.text, /starts with a 7-day free trial\. When the trial ends it costs \$89\.90/);
  assert.match(disclosure.text, /One free trial per Discord account\./);
  assert.match(disclosure.checkbox, /after the 7-day free trial my Elite Monthly Access membership renews automatically every month at \$89\.90/);
  assert.deepEqual([intent.trial_days, intent.consent_kind], [7, 'auto_renewal']);
  /* nothing is recorded at checkout: an abandoned checkout keeps the trial */
  assert.equal(await t.store.trialFor(null, USER), null);
  assert.equal((await t.checkout.readAccess(USER)).trialUsed, false);
  /* Stripe created the trialing subscription: it entitles, and the trial is recorded for good */
  subscribe(t, { id: 'sub_em', price: 'price_elitemonth', trialDays: 7 });
  const result = await t.engine.resync(USER);
  assert.deepEqual(result.externalRoles, [ELITE], 'a trialing subscription entitles');
  assert.ok(result.reasons.includes('sub_trialing:monthly'));
  const trial = await t.store.trialFor(null, USER);
  assert.deepEqual([trial.first_price_id, trial.stripe_subscription_id, trial.started_at.getTime(), trial.trial_end_at.getTime()],
    ['price_elitemonth', 'sub_em', S(T0) * 1000, (S(T0) + 7 * DAY) * 1000]);
  assert.equal(k.actions(t.store).filter((a) => a === 'trial_recorded').length, 1);
  await t.engine.resync(USER);
  assert.equal(k.actions(t.store).filter((a) => a === 'trial_recorded').length, 1, 'recorded once');
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [ELITE]);
});

test('one free trial per Discord account ACROSS products: a second trial checkout has no trial, and /buy says so', async () => {
  const t = setup();
  subscribe(t, { id: 'sub_ft', price: 'price_freetrial', trialDays: 3, status: 'canceled' });
  await t.engine.resync(USER);
  assert.ok(await t.store.trialFor(null, USER), 'the Free Trial Access trial is recorded');
  for (const priceId of ['price_eliteweek', 'price_eliteyear']) {
    const { session, disclosure, terms, intent } = await buy(t, priceId);
    assert.equal(session.subscription_data.trial_period_days, undefined, priceId);
    assert.equal(session.payment_method_collection, undefined);
    assert.equal(session.metadata.mem_academy_trial_days, undefined);
    assert.equal(intent.trial_days, null);
    assert.deepEqual([terms.trialDays, terms.trialUsed], [null, true]);
    assert.equal(/free trial/i.test(disclosure.text), false, 'no trial in the consent text');
    assert.match(disclosure.text, /^Automatic renewal: the Elite (Week Seat|Yearly Access) membership costs/);
    t.stripe.data.sessions = {};
  }
  /* the ledger alone is enough (the old subscription is gone from Stripe) */
  t.stripe.data.subscriptions = [];
  assert.equal((await t.checkout.readAccess(USER)).trialUsed, true);
  /* and so is Stripe alone (a trial subscription the ledger never saw) */
  const fresh = setup();
  subscribe(fresh, { id: 'sub_old', price: 'price_eliteweek', trialDays: 7, status: 'canceled' });
  const view = await fresh.checkout.readAccess(USER);
  assert.equal(view.trialUsed, true);
  const second = await buy(fresh, 'price_elitemonth');
  assert.equal(second.session.subscription_data.trial_period_days, undefined);
  /* the /buy card: no trial line, the used-trial note, the full price */
  const state = await fresh.catalog.get();
  const html = pages.buyPage({ config: fresh.config, nonce: 'n', userId: USER, user: null, packages: [], memberships: [...state.memberships.values()],
    csrf: 'c', state: { trialUsed: true } });
  assert.ok(html.includes(pages.TRIAL_USED_NOTE));
  assert.equal(html.includes('7-day free trial'), false);
  assert.ok(html.includes('$89.90 / month'));
});

test('Free Trial Access: a plain 3-day trial, no card, stops by itself 10 minutes before its trial ends: it never charges', async () => {
  assert.equal(MARGIN, 600, 'the safety margin is 10 minutes');
  const t = setup();
  const { session, disclosure, intent } = await buy(t, 'price_freetrial');
  assert.equal(session.payment_method_collection, 'if_required');
  assert.deepEqual(session.subscription_data.trial_settings, { end_behavior: { missing_payment_method: 'cancel' } });
  assert.equal(session.subscription_data.trial_period_days, 3, "Stripe's own Checkout page and emails say 3 days, like our copy");
  assert.equal(session.custom_text.submit.message, 'Free for 3 days. It ends by itself and is never charged. One free trial per Discord account.');
  assert.equal(disclosure.kind, 'free_trial');
  assert.match(disclosure.text, /^Free trial: Free Trial Access is free for 3 days and needs no payment method\. It ends by itself after 3 days, does not renew and is never charged\./);
  assert.match(disclosure.text, /gives this Discord account the Elite Member role in the Making Easy Money Discord server\. It does not include MEM Academy\./);
  assert.match(disclosure.checkbox, /^I understand Free Trial Access is a 3-day free trial that ends by itself and is never charged\.$/);
  assert.deepEqual([intent.trial_days, intent.consent_kind], [3, 'free_trial']);
  /* the /buy card mirrors the Upgrade.Chat copy */
  const state = await t.catalog.get();
  const card = pages.buyPage({ config: t.config, nonce: 'n', userId: USER, user: null, packages: [], memberships: [state.memberships.get('price_freetrial')],
    csrf: 'c', state: {} });
  assert.ok(card.includes('<h2>Free Trial Access</h2>'));
  assert.ok(card.includes('<div class="price">Free</div>'));
  assert.ok(card.includes('3 days free, no card needed, stops by itself'));

  /* Stripe created it (trialing, no payment method): Elite now, cancel_at = the trial end minus the margin */
  const start = S(T0) + 60;
  const sub = subscribe(t, { id: 'sub_ft', price: 'price_freetrial', trialDays: 3, start });
  const trialEnd = start + 3 * DAY;
  assert.equal(sub.trial_end, trialEnd);
  const first = await t.engine.resync(USER);
  assert.deepEqual(first.externalRoles, [ELITE]);
  const stopAt = trialEnd - MARGIN;
  const writes = t.stripe.callsOf('updateSubscription');
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].args, ['sub_ft', { cancel_at: stopAt, proration_behavior: 'none' }, `mem-academy-auto-stop-v1-sub_ft-${stopAt}`]);
  assert.ok(sub.cancel_at < sub.trial_end, 'it ends while still trialing, before the first invoice');
  assert.deepEqual(first.stripeActions, [{ action: 'auto_stop_set', subscriptionId: 'sub_ft' }]);
  const row = t.store.db.audit.find((r) => r.action === 'auto_stop_set');
  assert.deepEqual([row.reason, row.details.cancelAt, row.details.trialEnd, row.details.freeTrial, row.details.marginSec],
    ['cancel_after_3_days', stopAt, trialEnd, true, 600]);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [ELITE]);
  /* idempotent */
  await t.engine.resync(USER);
  assert.equal(t.stripe.callsOf('updateSubscription').length, 1);
  /* Stripe cancels it 10 minutes before the 72-hour mark, still trialing; Elite goes (Upgrade.Chat has nothing) */
  t.stripe.advanceClock(stopAt - 1);
  assert.equal(sub.status, 'trialing');
  t.stripe.advanceClock(stopAt);
  assert.deepEqual([sub.status, sub.ended_at], ['canceled', stopAt]);
  t.now.set((stopAt + 60) * 1000);
  const ended = await t.engine.resync(USER);
  assert.deepEqual(ended.externalRoles, []);
  assert.equal(t.ledger(ELITE).state, 'revoked');
  await t.applier.runOnce();
  assert.deepEqual(t.held(), []);
  t.stripe.advanceClock(trialEnd + DAY);
  assert.equal(t.stripe.data.invoices.length + t.stripe.data.charges.length, 0, 'never charged');
});

test('Free Trial Access with a SAVED default card never invoices: cancel_at < trial_end in both Stripe billing modes, set once', async () => {
  /* the danger: Stripe's no-card cancel does not apply to a member with a saved card, who is charged at the trial end */
  const bare = setup({ customers: SAVED_CARD });
  const unguarded = subscribe(bare, { id: 'sub_ft', price: 'price_freetrial', trialDays: 3 });
  bare.stripe.advanceClock(S(T0) + 3 * DAY);
  assert.deepEqual([unguarded.status, bare.stripe.data.charges.map((c) => c.amount)], ['active', [790]], 'without the engine: $7.90 at the trial end');

  for (const billingMode of ['classic', 'flexible']) {
    const t = setup({ customers: SAVED_CARD, fixtures: { billingMode } });
    const start = S(T0);
    const trialEnd = start + 3 * DAY;
    const sub = subscribe(t, { id: 'sub_ft', price: 'price_freetrial', trialDays: 3, start });
    assert.deepEqual((await t.engine.resync(USER)).externalRoles, [ELITE], billingMode);
    assert.equal(sub.cancel_at, trialEnd - MARGIN, billingMode);
    assert.ok(sub.cancel_at < trialEnd, `${billingMode}: before the original trial end`);
    /* classic billing (the engine's pinned API version) moves trial_end onto the earlier cancel_at; the engine does not chase it */
    assert.equal(sub.trial_end, billingMode === 'classic' ? trialEnd - MARGIN : trialEnd, billingMode);
    for (let i = 0; i < 5; i += 1) {
      t.now.advance(DAY_MS / 2);
      await t.engine.resync(USER);
    }
    t.now.set((trialEnd - MARGIN - 30) * 1000);
    await t.engine.resync(USER);
    assert.equal(t.stripe.callsOf('updateSubscription').length, 1, `${billingMode}: set once, never moved again`);
    assert.equal(t.stripe.callsOf('cancelSubscription').length, 0, `${billingMode}: never cancelled early by the engine`);
    t.stripe.advanceClock(trialEnd + 2 * DAY);
    assert.deepEqual([sub.status, sub.ended_at], ['canceled', trialEnd - MARGIN], billingMode);
    assert.deepEqual([t.stripe.data.invoices.length, t.stripe.data.charges.length], [0, 0], `${billingMode}: never invoiced, never charged`);
    t.now.set((trialEnd + 60) * 1000);
    assert.deepEqual((await t.engine.resync(USER)).externalRoles, [], billingMode);
  }
});

test('Free Trial Access first seen in the last 10 minutes of its trial is cancelled at once; seen 20 minutes before, it gets its cancel_at', async () => {
  const trialEnd = S(T0) + 3 * DAY;
  const late = setup({ customers: SAVED_CARD });
  late.now.set((trialEnd - 5 * 60) * 1000);
  const sub = subscribe(late, { id: 'sub_late', price: 'price_freetrial', trialDays: 3, start: S(T0) });
  const result = await late.engine.resync(USER);
  assert.deepEqual(late.stripe.callsOf('cancelSubscription').map((c) => c.args), [['sub_late', { prorate: false }, 'mem-academy-auto-stop-cancel-v1-sub_late']]);
  assert.equal(late.stripe.callsOf('updateSubscription').length, 0);
  assert.deepEqual(result.stripeActions, [{ action: 'auto_stop_set', subscriptionId: 'sub_late' }]);
  const row = late.store.db.audit.find((r) => r.action === 'auto_stop_set');
  assert.deepEqual([row.details.canceledNow, row.details.freeTrial], [true, true]);
  assert.equal(sub.status, 'canceled');
  late.stripe.advanceClock(trialEnd + DAY);
  assert.equal(late.stripe.data.invoices.length + late.stripe.data.charges.length, 0, 'never charged');
  /* 20 minutes before the trial end Stripe can still stop it itself */
  const early = setup({ customers: SAVED_CARD });
  early.now.set((trialEnd - 20 * 60) * 1000);
  const soon = subscribe(early, { id: 'sub_soon', price: 'price_freetrial', trialDays: 3, start: S(T0) });
  await early.engine.resync(USER);
  assert.deepEqual(early.stripe.callsOf('updateSubscription').map((c) => c.args[1]), [{ cancel_at: trialEnd - MARGIN, proration_behavior: 'none' }]);
  assert.equal(early.stripe.callsOf('cancelSubscription').length, 0);
  early.stripe.advanceClock(trialEnd + DAY);
  assert.deepEqual([soon.status, early.stripe.data.charges.length], ['canceled', 0]);
});

test('the trial guard touches only free-only trials: Elite Monthly converts and is charged, a paid Day trial is charged once, a cancel_at is only pulled in', async () => {
  /* Elite Monthly Access: 7-day card trial and no auto-stop, so its stop is never set: $89.90 at the trial end */
  const em = setup({ customers: SAVED_CARD });
  const monthly = subscribe(em, { id: 'sub_em', price: 'price_elitemonth', trialDays: 7 });
  await em.engine.resync(USER);
  await em.engine.resync(USER);
  assert.equal(em.stripe.writes().length, 0, 'no cancel_at on Elite Monthly Access');
  assert.equal(monthly.cancel_at, null);
  em.stripe.advanceClock(S(T0) + 7 * DAY);
  assert.deepEqual([monthly.status, em.stripe.data.charges.map((c) => c.amount)], ['active', [8990]]);
  /* an Academy Day plan with a 2-day trial (a paid offer: its 3-day stop comes after the trial): the exact stop, one charge */
  const day = setup({ env: k.memEnv({ extraPrices: { price_daily1: { package: 'daily', trialDays: 2 } } }), customers: SAVED_CARD });
  assert.equal(day.config.prices.get('price_daily1').cancelAfterDays, 3);
  const plan = subscribe(day, { id: 'sub_day', price: 'price_daily1', trialDays: 2 });
  await day.engine.resync(USER);
  await day.engine.resync(USER);
  assert.deepEqual(day.stripe.callsOf('updateSubscription').map((c) => c.args[1]), [{ cancel_at: S(T0) + 3 * DAY, proration_behavior: 'none' }]);
  day.stripe.advanceClock(S(T0) + 2 * DAY);
  assert.deepEqual([plan.status, day.stripe.data.charges.map((c) => c.amount)], ['active', [299]]);
  day.stripe.advanceClock(S(T0) + 3 * DAY);
  assert.deepEqual([plan.status, day.stripe.data.charges.length], ['canceled', 1], 'charged once, as its disclosure says');
  /* Free Trial Access with a cancel_at set elsewhere: one at or after the trial end is pulled in, an earlier one is kept */
  for (const [cancelAt, pulledTo] of [[S(T0) + 3 * DAY, S(T0) + 3 * DAY - MARGIN], [S(T0) + 5 * DAY, S(T0) + 3 * DAY - MARGIN], [S(T0) + DAY, null]]) {
    const t = setup({ customers: SAVED_CARD });
    const sub = subscribe(t, { id: 'sub_ft', price: 'price_freetrial', trialDays: 3 });
    sub.cancel_at = cancelAt;
    await t.engine.resync(USER);
    await t.engine.resync(USER);
    assert.deepEqual(t.stripe.callsOf('updateSubscription').map((c) => c.args[1].cancel_at), pulledTo === null ? [] : [pulledTo], String(cancelAt - S(T0)));
    assert.equal(sub.cancel_at, pulledTo === null ? cancelAt : pulledTo);
    t.stripe.advanceClock(S(T0) + 4 * DAY);
    assert.deepEqual([sub.status, t.stripe.data.charges.length], ['canceled', 0], String(cancelAt - S(T0)));
  }
});

test('safety net: a Free Trial Access that Stripe converted while the engine was away is cancelled before its first invoice is collected', async () => {
  const trialEnd = S(T0) + 3 * DAY;
  /* control: with nobody watching, Stripe drafts the first invoice at the trial end and charges the saved card an hour later */
  const bare = setup({ customers: SAVED_CARD, fixtures: { invoiceDelay: true } });
  const unguarded = subscribe(bare, { id: 'sub_ft', price: 'price_freetrial', trialDays: 3 });
  bare.stripe.advanceClock(trialEnd);
  assert.deepEqual([unguarded.status, bare.stripe.data.invoices.map((i) => i.status), bare.stripe.data.charges.length], ['active', ['draft'], 0]);
  bare.stripe.advanceClock(trialEnd + 3600);
  assert.deepEqual(bare.stripe.data.charges.map((c) => c.amount), [790], 'without the engine: $7.90 an hour after the trial end');

  /* the engine missed the whole trial and is back 20 minutes after the trial end: cancelled now, the draft is never collected */
  const logs = [];
  const t = setup({ customers: SAVED_CARD, fixtures: { invoiceDelay: true }, logs });
  const sub = subscribe(t, { id: 'sub_ft', price: 'price_freetrial', trialDays: 3 });
  t.stripe.advanceClock(trialEnd);
  assert.equal(sub.status, 'active');
  t.now.set((trialEnd + 20 * 60) * 1000);
  const result = await t.engine.resync(USER);
  assert.deepEqual(t.stripe.callsOf('cancelSubscription').map((c) => c.args), [['sub_ft', { prorate: false }, 'mem-academy-free-trial-missed-cancel-v1-sub_ft']]);
  assert.equal(t.stripe.callsOf('updateSubscription').length, 0);
  assert.deepEqual(result.stripeActions, [{ action: 'free_trial_stop_missed', subscriptionId: 'sub_ft' }]);
  const row = t.store.db.audit.find((r) => r.action === 'free_trial_stop_missed');
  assert.deepEqual([row.outcome, row.reason, row.details.canceledNow, row.details.everPaid, row.details.trialEnd, row.details.freeTrial],
    ['applied', 'converted_before_stop', true, false, trialEnd, true]);
  const alert = logs.find((l) => l[1] === 'academy_billing_free_trial_stop_missed');
  assert.deepEqual([alert[0], alert[2].subscriptionId, alert[2].canceledNow], ['error', 'sub_ft', true]);
  t.stripe.advanceClock(trialEnd + 2 * DAY);
  assert.deepEqual([sub.status, t.stripe.data.invoices.map((i) => [i.status, i.auto_advance]), t.stripe.data.charges.length],
    ['canceled', [['draft', false]], 0], 'the first invoice is never collected');
  t.now.set((trialEnd + 2 * DAY) * 1000);
  assert.deepEqual((await t.engine.resync(USER)).externalRoles, []);
  assert.equal(t.stripe.callsOf('cancelSubscription').length, 1, 'cancelled once');

  /* back only after the charge: cancelled at once (access ends, no second charge) and flagged once for a refund */
  const lateLogs = [];
  const late = setup({ customers: SAVED_CARD, fixtures: { invoiceDelay: true }, logs: lateLogs });
  subscribe(late, { id: 'sub_ft', price: 'price_freetrial', trialDays: 3 });
  late.stripe.advanceClock(trialEnd + 3600);
  assert.equal(late.stripe.data.charges.length, 1);
  late.now.set((trialEnd + 2 * 3600) * 1000);
  const charged = await late.engine.resync(USER);
  assert.deepEqual(late.stripe.callsOf('cancelSubscription').map((c) => c.args), [['sub_ft', { prorate: false }, 'mem-academy-free-trial-missed-cancel-v1-sub_ft']]);
  assert.equal(late.stripe.callsOf('updateSubscription').length, 0);
  assert.deepEqual(charged.stripeActions, [{ action: 'free_trial_charged', subscriptionId: 'sub_ft' }]);
  const flag = late.store.db.audit.find((r) => r.action === 'free_trial_charged');
  assert.deepEqual([flag.reason, flag.details.everPaid, flag.details.canceledNow], ['refund_review', true, true]);
  assert.ok(lateLogs.some((l) => l[0] === 'error' && l[1] === 'academy_billing_free_trial_charged'));
  await late.engine.resync(USER);
  assert.equal(late.stripe.writes().length, 1, 'flagged once');

  /* no webhook at all: the member renews in Manage billing 3 hours before the end (the stop is cleared) and neither that
     event nor the conversion event arrives. The due scan alone (run every minute here, Stripe's clock first) re-checks the
     trial 5 minutes after its trial end and cancels it while its first invoice is still a draft */
  const renew = setup({ customers: SAVED_CARD, fixtures: { invoiceDelay: true } });
  const start = S(T0) - 5 * 3600;
  const end = start + 3 * DAY;
  const renewed = subscribe(renew, { id: 'sub_ft', price: 'price_freetrial', trialDays: 3, start });
  await renew.engine.resync(USER);
  const scan = async (from, to) => {
    for (let at = from; at <= to; at += 60) {
      renew.now.set(at * 1000);
      renew.stripe.advanceClock(at);
      if ((await renew.store.dueMemberIds(null, 25)).includes(USER)) await renew.engine.resync(USER, { actor: 'due_scan' });
    }
  };
  await scan(S(T0) + 60, end - 3 * 3600);
  assert.equal(renewed.cancel_at, end - MARGIN);
  renewed.cancel_at = null;
  await scan(end - 3 * 3600 + 60, end + 2 * 3600);
  assert.deepEqual(renew.stripe.callsOf('cancelSubscription').map((c) => c.args[2]), ['mem-academy-free-trial-missed-cancel-v1-sub_ft']);
  assert.deepEqual([renewed.status, renew.stripe.data.invoices.map((i) => [i.status, i.auto_advance]), renew.stripe.data.charges.length],
    ['canceled', [['draft', false]], 0], 'never charged');

  /* preflight blocks the Stripe rules: an error for staff, nothing written */
  const blockedLogs = [];
  const blocked = setup({ customers: SAVED_CARD, fixtures: { invoiceDelay: true }, rulesAllowed: false, logs: blockedLogs });
  subscribe(blocked, { id: 'sub_ft', price: 'price_freetrial', trialDays: 3 });
  blocked.stripe.advanceClock(trialEnd);
  blocked.now.set((trialEnd + 60) * 1000);
  await blocked.engine.resync(USER);
  assert.equal(blocked.stripe.writes().length, 0);
  const missed = blockedLogs.find((l) => l[1] === 'academy_billing_free_trial_stop_missed');
  assert.deepEqual([missed[0], missed[2].subscriptionId, missed[2].blocked], ['error', 'sub_ft', true]);

  /* a paid trial that converts on purpose is never touched by the safety net */
  const em = setup({ customers: SAVED_CARD, fixtures: { invoiceDelay: true } });
  subscribe(em, { id: 'sub_em', price: 'price_elitemonth', trialDays: 7 });
  em.stripe.advanceClock(S(T0) + 7 * DAY);
  em.now.set((S(T0) + 7 * DAY + 600) * 1000);
  await em.engine.resync(USER);
  assert.equal(em.stripe.writes().length, 0, 'Elite Monthly Access converts');
  const day = setup({ env: k.memEnv({ extraPrices: { price_daily1: { package: 'daily', trialDays: 2 } } }), customers: SAVED_CARD, fixtures: { invoiceDelay: true } });
  subscribe(day, { id: 'sub_day', price: 'price_daily1', trialDays: 2 });
  await day.engine.resync(USER);
  day.stripe.advanceClock(S(T0) + 2 * DAY);
  day.now.set((S(T0) + 2 * DAY + 600) * 1000);
  await day.engine.resync(USER);
  assert.equal(day.stripe.callsOf('cancelSubscription').length, 0, 'a paid Day trial (2 days, 3-day stop) converts');
  day.stripe.advanceClock(S(T0) + 2 * DAY + 3600);
  assert.equal(day.stripe.data.charges.length, 1);
});

test('a failed stop write for Free Trial Access is an error for staff and is retried; near its trial end the engine cancels it instead', async () => {
  const logs = [];
  const t = setup({ customers: SAVED_CARD, logs });
  const trialEnd = S(T0) + 3 * DAY;
  const sub = subscribe(t, { id: 'sub_ft', price: 'price_freetrial', trialDays: 3 });
  t.stripe.fail('updateSubscription', Object.assign(new Error('stripe 500'), { statusCode: 500 }));
  await t.engine.resync(USER);
  assert.equal(sub.cancel_at, null);
  const failed = logs.find((l) => l[1] === 'academy_billing_free_trial_stop_failed');
  assert.deepEqual([failed[0], failed[2].subscriptionId, failed[2].stopAt, failed[2].trialEnd, failed[2].secondsLeft],
    ['error', 'sub_ft', trialEnd - MARGIN, trialEnd, 3 * DAY]);
  assert.ok(logs.some((l) => l[1] === 'academy_billing_stripe_rule_failed'), 'the resync schedules its 5-minute retry');
  /* still failing 5 minutes before the trial end: the engine cancels it (a DELETE), so it never reaches an invoice */
  t.now.set((trialEnd - 5 * 60) * 1000);
  await t.engine.resync(USER);
  assert.deepEqual(t.stripe.callsOf('cancelSubscription').map((c) => c.args[0]), ['sub_ft']);
  t.stripe.advanceClock(trialEnd + DAY);
  assert.deepEqual([sub.status, t.stripe.data.invoices.length, t.stripe.data.charges.length], ['canceled', 0, 0]);
});

test('Free Trial Access is only ever a free trial: an account whose trial is used is never sold it as the $7.90 daily plan', async () => {
  const t = setup({ customers: SAVED_CARD });
  subscribe(t, { id: 'sub_old', price: 'price_eliteweek', trialDays: 7, start: S(T0) - 40 * DAY, status: 'canceled' });
  await t.engine.resync(USER);
  assert.equal((await t.checkout.readAccess(USER)).trialUsed, true);
  const state = await t.catalog.get();
  const desc = state.memberships.get('price_freetrial');
  const terms = pages.offerTerms(desc, { trialUsed: true });
  assert.deepEqual([terms.trialOnly, terms.trialDays, terms.charges], [true, null, 3]);
  assert.deepEqual([pages.offerTerms(desc).trialOnly, pages.offerTerms(state.memberships.get('price_elitemonth')).trialOnly], [true, false]);
  /* the /buy card: "Free", the note, and no checkout form */
  const html = pages.buyPage({ config: t.config, nonce: 'n', userId: USER, user: null, packages: [], memberships: [desc], csrf: 'c', state: { trialUsed: true } });
  assert.ok(html.includes('<h2>Free Trial Access</h2>'));
  assert.ok(html.includes('<div class="price">Free</div>'));
  assert.ok(html.includes(pages.esc(pages.FREE_TRIAL_USED_NOTE)));
  assert.equal(html.includes('value="price_freetrial"'), false, 'no checkout form');
  assert.equal(html.includes('$7.90'), false, 'never shown as the paid daily plan');
  const unknown = pages.buyPage({ config: t.config, nonce: 'n', userId: USER, user: null, packages: [], memberships: [desc], csrf: 'c',
    state: { trialUsed: true, trialUnknown: true } });
  assert.ok(unknown.includes(pages.esc(pages.TRIAL_UNKNOWN_NOTE)));
  assert.equal(unknown.includes('value="price_freetrial"'), false);
  /* a posted form (the paid consent a stale or crafted page could carry) is refused before anything reaches Stripe */
  const d = pages.disclosureFor({ pkg: 'daily', amount: desc.amount, currency: desc.currency, termsUrl: t.config.termsUrl, privacyUrl: t.config.privacyUrl,
    grants: pages.offerGrants(desc), terms });
  const form = { package: 'daily', price: 'price_freetrial', csrf: t.tokens.csrfFor(t.bind), disclosure_sha: pages.consentSha(t.config.consentVersion, d.text),
    consent_renewal: '1' };
  t.now.advance(60_000);
  const refused = await t.checkout.start({ bind: t.bind, form, ipKey: 'ip' });
  assert.deepEqual([refused.status, refused.error], [409, 'free_trial_used']);
  assert.equal(t.stripe.writes().length, 0);
  assert.equal(t.store.db.intents.size, 0);
  /* the Elite plans are still sold to this account, without a trial */
  const monthly = await buy(t, 'price_elitemonth');
  assert.equal(monthly.session.subscription_data.trial_period_days, undefined);
});

test('a trial that ends without payment ends access: cancelled for a missing card, or its first charge failing (no grace)', async () => {
  const t = setup();
  const sub = subscribe(t, { id: 'sub_wk', price: 'price_eliteweek', trialDays: 7 });
  assert.deepEqual((await t.engine.resync(USER)).externalRoles, [ELITE]);
  await t.applier.runOnce();
  /* trial over: the first charge failed (past_due in the first period after the trial) */
  t.now.set((S(T0) + 7 * DAY + 3600) * 1000);
  Object.assign(sub, { status: 'past_due', current_period_start: S(T0) + 7 * DAY, current_period_end: S(T0) + 14 * DAY });
  const failed = await t.engine.resync(USER);
  assert.deepEqual(failed.externalRoles, []);
  assert.ok(failed.reasons.includes('trial_ended_unpaid'));
  /* the same failure in a LATER period of a plan that WAS paid keeps the usual grace */
  const laterSub = (everPaid) => ({
    id: 'sub_wk', status: 'past_due', created: S(T0), trialStart: S(T0), trialEnd: S(T0) + 7 * DAY, periodStart: S(T0) + 14 * DAY, periodEnd: S(T0) + 21 * DAY,
    everPaid, price: { priceId: 'price_eliteweek', package: 'weekly', academy: true, graceHours: 12, grantsAcademy: false, externalRoles: [ELITE] } });
  const later = computeAccess({ now: (S(T0) + 14 * DAY + 3600) * 1000, externalRoleIds: t.config.externalRoleIds, snapshot: { subscriptions: [laterSub(true)] } });
  assert.deepEqual([...later.externalRoles], [ELITE]);
  /* ... but never for a trial that was never paid (see the next test) */
  const never = computeAccess({ now: (S(T0) + 14 * DAY + 3600) * 1000, externalRoleIds: t.config.externalRoleIds, snapshot: { subscriptions: [laterSub(false)] } });
  assert.deepEqual([[...never.externalRoles], never.reasons.includes('trial_ended_unpaid')], [[], true]);
  /* a no-card trial the member never paid: Stripe cancels it at the trial end, or leaves it incomplete_expired */
  for (const status of ['canceled', 'incomplete_expired', 'paused']) {
    const a = computeAccess({ now: (S(T0) + 4 * DAY) * 1000, externalRoleIds: t.config.externalRoleIds, snapshot: { subscriptions: [{
      id: 'sub_x', status, created: S(T0), trialStart: S(T0), trialEnd: S(T0) + 3 * DAY, periodStart: S(T0), periodEnd: S(T0) + 3 * DAY,
      price: { priceId: 'price_freetrial', package: 'daily', academy: true, graceHours: 2, grantsAcademy: false, externalRoles: [ELITE] } }] } });
    assert.deepEqual([...a.externalRoles], [], status);
  }
});

test('a trial that was never paid gets no past_due grace in a LATER period either (Stripe keeps opening periods while it retries)', async () => {
  const t = setup();
  const sub = subscribe(t, { id: 'sub_wk', price: 'price_eliteweek', trialDays: 7 });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [ELITE]);
  /* day 7 + 1h: the trial ended and its first charge failed */
  t.now.set((S(T0) + 7 * DAY + 3600) * 1000);
  Object.assign(sub, { status: 'past_due', current_period_start: S(T0) + 7 * DAY, current_period_end: S(T0) + 14 * DAY });
  assert.deepEqual((await t.engine.resync(USER)).externalRoles, []);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), []);
  /* day 14 + 1h: Stripe's retries still run (about two weeks by default) and the subscription rolled into its next
     weekly period, still past_due and still never paid: no grace, no Elite */
  t.now.set((S(T0) + 14 * DAY + 3600) * 1000);
  Object.assign(sub, { current_period_start: S(T0) + 14 * DAY, current_period_end: S(T0) + 21 * DAY });
  const second = await t.engine.resync(USER);
  assert.deepEqual(second.externalRoles, [], second.reasons.join(','));
  assert.ok(second.reasons.includes('trial_ended_unpaid'));
  /* a retry succeeds (a paid invoice with money), then a LATER renewal fails: the usual weekly grace applies */
  t.stripe.data.invoices.push(k.invoice({ id: 'in_paid1', subscription: 'sub_wk', charge: 'ch_paid1', created: S(T0) + 15 * DAY }));
  t.stripe.data.charges.push(k.charge({ id: 'ch_paid1', customer: CUS, amount: 3490, invoiceId: 'in_paid1', created: S(T0) + 15 * DAY }));
  t.now.set((S(T0) + 21 * DAY + 3600) * 1000);
  Object.assign(sub, { current_period_start: S(T0) + 21 * DAY, current_period_end: S(T0) + 28 * DAY });
  const paid = await t.engine.resync(USER);
  assert.deepEqual(paid.externalRoles, [ELITE]);
  assert.ok(paid.reasons.includes('past_due_grace:weekly'));
});

test('after a database restore the member\'s old Stripe Customer already had a trial: checkout adopts it and offers NO second trial', async () => {
  const old = 'cus_oldtrial';
  const t = setup({ bound: false, customers: { [old]: k.academyCustomer(old, USER) } });
  /* Stripe still has the member's Customer and its cancelled Elite Week Seat trial; the ledger and the binding are gone */
  subscribe(t, { id: 'sub_oldtrial', price: 'price_eliteweek', trialDays: 7, start: S(T0) - 40 * DAY, status: 'canceled', customer: old });
  assert.equal(await t.store.trialFor(null, USER), null);
  const view = await t.checkout.readAccess(USER);
  assert.deepEqual([view.trialUsed, view.trialUnknown], [true, false]);
  const { session, terms, disclosure } = await buy(t, 'price_elitemonth');
  assert.equal(session.customer, old, 'the old Customer was adopted through Stripe Search');
  assert.equal(session.subscription_data.trial_period_days, undefined);
  assert.deepEqual([terms.trialDays, terms.trialUsed], [null, true]);
  assert.equal(/free trial/i.test(disclosure.text), false);
  /* the next resync refills the ledger from Stripe */
  await t.engine.resync(USER);
  assert.equal((await t.store.trialFor(null, USER)).stripe_subscription_id, 'sub_oldtrial');
});

test('a member with no bound Customer and no trial anywhere gets the trial; a failed trial lookup offers none and never sells a trial price', async () => {
  const t = setup({ bound: false, customers: {} });
  const view = await t.checkout.readAccess(USER);
  assert.deepEqual([view.trialUsed, view.trialUnknown], [false, false]);
  assert.equal(t.stripe.callsOf('searchCustomersByDiscordId').length, 1);
  const { session } = await buy(t, 'price_elitemonth');
  assert.equal(session.subscription_data.trial_period_days, 7);

  /* Stripe Search errors (or a list is truncated): fail closed */
  const down = setup({ bound: false, customers: {} });
  down.stripe.fail('searchCustomersByDiscordId', Object.assign(new Error('stripe 500'), { statusCode: 500 }));
  const unknown = await down.checkout.readAccess(USER);
  assert.deepEqual([unknown.trialUsed, unknown.trialUnknown], [true, true]);
  /* /buy: the trial card says the trial could not be checked, and its button is disabled */
  const state = await down.catalog.get();
  const html = pages.buyPage({ config: down.config, nonce: 'n', userId: USER, user: null, packages: [], memberships: [state.memberships.get('price_elitemonth')],
    csrf: 'c', state: { trialUsed: unknown.trialUsed, trialUnknown: unknown.trialUnknown } });
  assert.ok(html.includes(pages.esc(pages.TRIAL_UNKNOWN_NOTE)));
  assert.equal(html.includes(pages.TRIAL_USED_NOTE), false);
  assert.ok(html.includes('<button type="submit" disabled>'));
  /* checkout of a trial price answers 503 before anything reaches Stripe */
  const { form } = await formFor(down, 'price_elitemonth');
  down.now.advance(60_000);
  const refused = await down.checkout.start({ bind: down.bind, form, ipKey: 'ip' });
  assert.deepEqual([refused.status, refused.error], [503, 'stripe_unavailable']);
  assert.equal(down.stripe.writes().length, 0);
  /* a price without a trial still sells */
  const academy = await formFor(down, 'price_monthly1');
  down.now.advance(60_000);
  assert.ok((await down.checkout.start({ bind: down.bind, form: academy.form, ipKey: 'ip' })).redirect);
  /* a truncated Customer search is inconclusive too */
  const partial = setup({ bound: false, customers: {}, fixtures: { truncated: ['searchCustomersByDiscordId'] } });
  assert.equal((await partial.checkout.readAccess(USER)).trialUnknown, true);
});

/* ------------------------------ auto-stop ------------------------------ */

test('cancelAfterDays: cancel_at = subscription start + N days, set once; an earlier end is kept; a late trial is cancelled now', async () => {
  const t = setup({ env: k.memEnv({ extraPrices: { price_weekly1: { package: 'weekly', cancelAfterDays: 14 } } }) });
  assert.equal(t.config.prices.get('price_weekly1').cancelAfterDays, 14);
  const start = S(T0) - 600;
  const sub = subscribe(t, { id: 'sub_w', price: 'price_weekly1', start });
  await t.engine.resync(USER);
  await t.engine.resync(USER);
  const writes = t.stripe.callsOf('updateSubscription');
  assert.equal(writes.length, 1, 'idempotent');
  assert.deepEqual(writes[0].args[1], { cancel_at: start + 14 * DAY, proration_behavior: 'none' });
  const row = t.store.db.audit.find((r) => r.action === 'auto_stop_set');
  assert.deepEqual([row.reason, row.details.cancelAfterDays, row.details.start], ['cancel_after_14_days', 14, start]);
  /* a subscription already set to end earlier is never pushed later */
  sub.cancel_at = start + 5 * DAY;
  await t.engine.resync(USER);
  assert.equal(t.stripe.callsOf('updateSubscription').length, 1);
  /* a plan without cancelAfterDays is never touched */
  const plain = setup();
  subscribe(plain, { id: 'sub_m', price: 'price_elitemonth' });
  await plain.engine.resync(USER);
  assert.equal(plain.stripe.writes().length, 0);
  /* Free Trial Access first seen in the last minutes of its 3-day trial (the engine was off): cancelled now, never charged */
  const late = setup();
  late.now.set((S(T0) + 3 * DAY - 300) * 1000);
  subscribe(late, { id: 'sub_late', price: 'price_freetrial', trialDays: 3, start: S(T0) });
  const result = await late.engine.resync(USER);
  assert.deepEqual(late.stripe.callsOf('cancelSubscription').map((c) => c.args), [['sub_late', { prorate: false }, 'mem-academy-auto-stop-cancel-v1-sub_late']]);
  assert.equal(late.stripe.callsOf('updateSubscription').length, 0);
  assert.deepEqual(result.stripeActions, [{ action: 'auto_stop_set', subscriptionId: 'sub_late' }]);
  assert.equal(late.store.db.audit.find((r) => r.action === 'auto_stop_set').details.canceledNow, true);
});

test('renewalLine and the disclosure count the charges an auto-stop allows', () => {
  assert.equal(renewalLine('daily', 1100, 'usd'), 'Renews every day at $11.00 until you cancel. Ends by itself after 3 charges. Cancel any time in Manage billing.');
  assert.match(renewalLine('weekly', 4000, 'usd', { cancelAfterDays: 14 }), /Ends by itself after 2 charges\./);
  assert.match(renewalLine('daily', 790, 'usd', { cancelAfterDays: 10, trial: { days: 7, noCard: false } }), /^Free for 7 days, then renews every day at \$7\.90 until you cancel\. Ends by itself after at most 3 charges\./);
  const d = pages.disclosureFor({ pkg: 'daily', amount: 1100, termsUrl: 'https://t.example', privacyUrl: 'https://p.example' });
  assert.match(d.text, /The Day plan renews at most 2 times \(3 charges in total, \$33\.00\) and then ends by itself\./);
  const w = pages.disclosureFor({ pkg: 'weekly', amount: 3490, termsUrl: 'https://t.example', privacyUrl: 'https://p.example', grants: { academy: false, roleNames: ['Elite Member'], label: 'Elite Week Seat' },
    terms: pages.offerTerms({ key: 'weekly', trialDays: 7, cancelAfterDays: 21 }) });
  assert.match(w.text, /After the free trial it is charged at most 2 times \(\$69\.80 in total\) and then ends by itself\./);
});

test('while the Stripe rules are blocked, a never-charging trial with no cancel_at yet is logged for staff', async () => {
  const logs = [];
  const t = setup({ rulesAllowed: false, logs });
  const sub = subscribe(t, { id: 'sub_ft', price: 'price_freetrial', trialDays: 3 });
  const result = await t.engine.resync(USER);
  assert.deepEqual([result.externalRoles, result.stripeActions], [[ELITE], []]);
  assert.equal(t.stripe.writes().length, 0);
  const warn = logs.find((l) => l[1] === 'academy_billing_auto_stop_pending');
  assert.deepEqual([warn[0], warn[2].subscriptionId, warn[2].stopAt, warn[2].trialEnd], ['warn', 'sub_ft', S(T0) + 3 * DAY - MARGIN, S(T0) + 3 * DAY]);
  /* a cancel_at exactly at the trial end is not enough (the margin is missing): still flagged */
  sub.cancel_at = S(T0) + 3 * DAY;
  logs.length = 0;
  await t.engine.resync(USER);
  assert.ok(logs.some((l) => l[1] === 'academy_billing_auto_stop_pending'));
  /* set in time (classic billing then shows trial_end = cancel_at): no longer flagged */
  Object.assign(sub, { cancel_at: S(T0) + 3 * DAY - MARGIN, trial_end: S(T0) + 3 * DAY - MARGIN });
  logs.length = 0;
  await t.engine.resync(USER);
  assert.equal(logs.some((l) => l[1] === 'academy_billing_auto_stop_pending'), false);
  /* a dry-run pass (the RECONCILE_MODE=dry_run sweep) writes nothing to Stripe but still tells staff */
  const dryLogs = [];
  const dry = setup({ logs: dryLogs });
  subscribe(dry, { id: 'sub_ft', price: 'price_freetrial', trialDays: 3 });
  await dry.engine.resync(USER, { dryRun: true });
  assert.equal(dry.stripe.writes().length, 0);
  const pending = dryLogs.find((l) => l[1] === 'academy_billing_auto_stop_pending');
  assert.deepEqual([pending[0], pending[2].subscriptionId, pending[2].dryRun], ['warn', 'sub_ft', true]);
  /* a card trial that converts on purpose is not flagged */
  const paid = [];
  const card = setup({ rulesAllowed: false, logs: paid });
  subscribe(card, { id: 'sub_em', price: 'price_elitemonth', trialDays: 7 });
  await card.engine.resync(USER);
  assert.equal(paid.some((l) => l[1] === 'academy_billing_auto_stop_pending'), false);
});

/* ------------------------------ lifetimes ------------------------------ */

/* Owner correction (2026-09-26): the Academy Lifetime grants the Academy
   Student role and Monarch ONLY. Elite Lifetime Access (the Upgrade.Chat
   mirror, academy:false) keeps Monarch + Elite. Both follow from the config
   ("roles" per price): a lifetime owns and supersedes only what it grants. */

/** A paid Academy Lifetime ($9,200, price_life1). */
function academyLifetimePaid() {
  return { paymentIntents: [k.lifetimePi({ id: 'pi_life', customer: CUS, latestCharge: 'ch_life', amount: 920000 })],
    charges: [k.charge({ id: 'ch_life', customer: CUS, amount: 920000, paymentIntent: 'pi_life' })] };
}

/** A paid Elite Lifetime Access ($7,490.90, price_elitelife). */
function eliteLifetimePaid() {
  return { paymentIntents: [k.lifetimePi({ id: 'pi_el', customer: CUS, latestCharge: 'ch_el', amount: 749090, price: 'price_elitelife' })],
    charges: [k.charge({ id: 'ch_el', customer: CUS, amount: 749090, paymentIntent: 'pi_el' })] };
}

test('Academy Lifetime grants Academy Student and Monarch only (never Elite): Elite Lifetime Access and the Elite plans stay on sale', async () => {
  const t = setup({ fixtures: academyLifetimePaid() });
  const result = await t.engine.resync(USER);
  assert.deepEqual(result.roles, ['academy', 'mem_lifetime']);
  assert.deepEqual(result.externalRoles, [MONARCH]);
  assert.equal(t.ledger(MONARCH).state, 'engine_granted');
  assert.equal(t.ledger(ELITE), null, 'the engine never grants (or records) Elite for the Academy lifetime');
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [ACADEMY_ROLE, MONARCH].sort());
  const view = await t.checkout.readAccess(USER);
  assert.equal(view.lifetime, true);
  assert.deepEqual([...view.ownedExternal], [MONARCH], 'the Academy lifetime owns Monarch only');
  /* Elite Lifetime Access (Monarch + Elite) is NOT owned: it is sold, and checkout goes to Stripe */
  const { session } = await buy(t, 'price_elitelife');
  assert.deepEqual([session.mode, session.line_items[0].price], ['payment', 'price_elitelife']);
  /* the /buy page offers Elite Lifetime Access and every Elite plan, none of them "active" */
  const state = await t.catalog.get();
  const html = pages.buyPage({ config: t.config, nonce: 'n', userId: USER, user: null, packages: [...state.sellable.values()],
    memberships: [...state.memberships.values()], csrf: 'c', state: { lifetime: view.lifetime, ownedExternal: [...view.ownedExternal],
      blockingLines: [...view.blockingLines], entitled: view.entitled } });
  for (const priceId of ['price_elitelife', 'price_eliteyear', 'price_elitemonth', 'price_eliteweek']) {
    assert.ok(html.includes(`name="price" value="${priceId}"`), `${priceId} is offered`);
  }
  assert.equal(/Elite [A-Za-z ]+: active/.test(html), false, 'no Elite membership reads as already on this account');
});

test("an Academy Lifetime buyer's Elite Monthly Access keeps renewing (no cancel_at_period_end), and the Lifetime consent and /buy card never claim Elite", async () => {
  const t = setup({ fixtures: academyLifetimePaid() });
  const sub = subscribe(t, { id: 'sub_em', price: 'price_elitemonth', start: S(T0) - DAY });
  const result = await t.engine.resync(USER);
  /* Monarch from the lifetime, Elite from the plan: nothing to supersede */
  assert.deepEqual(result.externalRoles, [ELITE, MONARCH].sort());
  assert.deepEqual(result.stripeActions, [], 'the Academy lifetime does not cover the Elite plan');
  await t.engine.resync(USER);
  assert.deepEqual(t.stripe.callsOf('updateSubscription'), [], 'no cancel_at_period_end (or any other) write on the Elite plan');
  assert.deepEqual(t.stripe.callsOf('cancelSubscription'), []);
  assert.deepEqual([sub.status, Boolean(sub.cancel_at_period_end), sub.cancel_at || null], ['active', false, null], 'the Elite plan still renews');
  assert.equal(k.actions(t.store).includes('lifetime_supersede'), false);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [ACADEMY_ROLE, ELITE, MONARCH].sort());
  /* the plan still holds its line: another Elite plan goes to Manage billing, not to a second subscription */
  assert.ok((await t.checkout.readAccess(USER)).blockingLines.has(`roles:${ELITE}`));

  /* the consent text of the Academy Lifetime names what its config grants: Academy Student and Monarch, no Elite */
  const state = await t.catalog.get();
  const life = state.sellable.get('lifetime');
  assert.deepEqual([life.priceId, life.roles, life.roleNames], ['price_life1', [MONARCH], ['Monarch']]);
  const d = pages.disclosureFor({ pkg: 'lifetime', amount: life.amount, currency: life.currency, termsUrl: t.config.termsUrl,
    privacyUrl: t.config.privacyUrl, grants: pages.offerGrants(life) });
  assert.equal(/Elite/.test(d.text) || /Elite/.test(d.checkbox), false, d.text);
  assert.match(d.text, /It gives this Discord account the Academy Student role \(MEM Academy and paid access to the Making Easy Money Discord server\) and the Monarch role\./);
  assert.ok(d.text.includes('If you have an Academy plan, or a membership plan that gives no role other than the Monarch role, that renews, buying Lifetime sets that plan to cancel at the end of its current paid period.'), d.text);
  /* the /buy card and the Stripe Checkout of the Academy Lifetime (a fresh buyer) say the same */
  const fresh = setup();
  const freshState = await fresh.catalog.get();
  const card = pages.buyPage({ config: fresh.config, nonce: 'n', userId: USER, user: null, packages: [freshState.sellable.get('lifetime')], memberships: [],
    csrf: 'c', state: {} });
  assert.ok(card.includes(pages.esc(d.text)), 'the card shows exactly that consent text');
  assert.equal(/Elite/.test(card), false);
  const bought = await buy(fresh, 'price_life1');
  assert.equal(bought.disclosure.text, d.text);
  assert.equal(/Elite/.test(JSON.stringify(bought.session)), false, 'nothing in the Checkout Session claims Elite');
});

test('Elite Lifetime Access grants Monarch + Elite, owns the Elite memberships and supersedes a renewing Elite plan (never an Academy plan)', async () => {
  const t = setup({ fixtures: eliteLifetimePaid() });
  subscribe(t, { id: 'sub_em', price: 'price_elitemonth', start: S(T0) - DAY });
  subscribe(t, { id: 'sub_am', price: 'price_monthly1', start: S(T0) - DAY });
  const result = await t.engine.resync(USER);
  assert.deepEqual(result.roles, ['academy'], 'the Academy plan still grants the Academy');
  assert.deepEqual(result.externalRoles, [ELITE, MONARCH].sort());
  assert.deepEqual([t.ledger(MONARCH).state, t.ledger(ELITE).state], ['engine_granted', 'engine_granted']);
  /* Elite Lifetime Access covers the Elite plan: set to end at its period end; the Academy plan is left alone */
  assert.deepEqual(result.stripeActions, [{ action: 'lifetime_supersede', subscriptionId: 'sub_em' }]);
  assert.deepEqual(t.stripe.callsOf('updateSubscription').map((c) => [c.args[0], c.args[1]]), [['sub_em', { cancel_at_period_end: true }]]);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [ACADEMY_ROLE, ELITE, MONARCH].sort());
  const view = await t.checkout.readAccess(USER);
  assert.equal(view.lifetime, false, 'Elite Lifetime Access is not the Academy lifetime');
  assert.deepEqual([...view.ownedExternal].sort(), [ELITE, MONARCH].sort());
  for (const priceId of ['price_elitelife', 'price_elitemonth']) {
    const { form, desc } = await formFor(t, priceId);
    const owned = await t.checkout.start({ bind: t.bind, form, ipKey: 'ip' });
    assert.deepEqual([owned.status, owned.page, owned.data && owned.data.label], [409, 'owned', desc.label], priceId);
  }
  /* its consent text discloses the supersede for the plans of its own roles */
  const state = await t.catalog.get();
  const elite = state.memberships.get('price_elitelife');
  const d = pages.disclosureFor({ pkg: elite.key, amount: elite.amount, currency: elite.currency, termsUrl: t.config.termsUrl,
    privacyUrl: t.config.privacyUrl, grants: pages.offerGrants(elite) });
  assert.ok(d.text.includes('It gives this Discord account the Monarch role and the Elite Member role in the Making Easy Money Discord server'), d.text);
  assert.ok(d.text.includes('If you have a membership plan that gives no role other than the Monarch or Elite Member role and renews, buying this sets that plan to cancel at the end of its current paid period.'), d.text);
  /* an Academy lifetime without external roles keeps the Academy-only sentence */
  assert.match(pages.disclosureFor({ pkg: 'lifetime', amount: 920000, termsUrl: 'https://t.example', privacyUrl: 'https://p.example' }).text,
    /If you have an Academy plan that renews, buying Lifetime sets that plan to cancel at the end of its current paid period\./);
});

/* ------------------------------ Upgrade.Chat 'any' keep rule ------------------------------ */

/** An Elite Monthly plan the engine granted Elite for, then cancelled. */
async function eliteEnded(uc) {
  const t = setup({ uc });
  const sub = subscribe(t, { id: 'sub_em', price: 'price_elitemonth', start: S(T0) - 10 * DAY });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.deepEqual([t.held(), t.ledger(ELITE).state], [[ELITE], 'engine_granted']);
  sub.status = 'canceled';
  await t.engine.resync(USER);
  return t;
}

test("UC_MATCH=any (default): an active Upgrade.Chat membership on a HIDDEN product keeps the engine-granted Elite", async () => {
  const uc = k.createFakeUc({ orders: { [USER]: [k.ucOrder({ uuid: 'uc-hidden-1', product: 'uc-hidden-premium-legacy', lastCharge: T0 - 3 * 86400_000 })] } });
  const t = await eliteEnded(uc);
  assert.deepEqual([t.ledger(ELITE).state, t.ledger(ELITE).uc_result, t.ledger(ELITE).last_reason], ['kept_external', 'active', 'uc_subscription_active']);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [ELITE]);
  assert.deepEqual(uc.calls.map((c) => c[0]), ['listOrders'], 'every UPGRADE order, no per-product lookup');
  const kept = t.store.db.audit.find((r) => r.action === 'external_grant_state' && r.details.to === 'kept_external');
  assert.equal(kept.details.ucRef, 'uc-hidden-1');
});

test('UC_MATCH=any: a one-time Upgrade.Chat lifetime counts for good; nothing active -> the Elite the engine gave is removed', async () => {
  const lifetime = k.createFakeUc({ orders: { [USER]: [k.ucOrder({ uuid: 'uc-life', product: 'uc-old-lifetime', subscription: false, purchasedAt: T0 - 900 * 86400_000 })] } });
  const kept = await eliteEnded(lifetime);
  assert.deepEqual([kept.ledger(ELITE).state, kept.ledger(ELITE).last_reason], ['kept_external', 'uc_one_time_order']);
  /* a lapsed subscription, a cancelled one and an ended (refunded) one-time order are not active */
  const none = k.createFakeUc({ orders: { [USER]: [
    k.ucOrder({ uuid: 'uc-lapsed', lastCharge: T0 - 60 * 86400_000, cancelledAt: T0 - 40 * 86400_000 }),
    k.ucOrder({ uuid: 'uc-refunded', subscription: false, deleted: T0 - 86400_000 })
  ] } });
  const t = await eliteEnded(none);
  assert.deepEqual([t.ledger(ELITE).state, t.ledger(ELITE).uc_result, t.ledger(ELITE).last_reason], ['revoked', 'none', 'uc_no_active_upgrade']);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), []);
});

test('UC_MATCH=any: an Upgrade.Chat error, a truncated order list or a renewal still being charged never removes the role', async () => {
  const cases = [
    [k.createFakeUc({ error: new Error('Upgrade.Chat orders request failed (503)') }), 'uc_error'],
    [k.createFakeUc({ incomplete: true }), 'uc_orders_truncated'],
    [k.createFakeUc({ orders: { [USER]: [k.ucOrder({ uuid: 'uc-renewing', lastCharge: T0 - 33 * 86400_000 })] } }), 'uc_renewal_pending']
  ];
  for (const [uc, reason] of cases) {
    const t = await eliteEnded(uc);
    assert.deepEqual([t.ledger(ELITE).state, t.ledger(ELITE).last_reason], ['needs_review', reason], reason);
    await t.applier.runOnce();
    assert.deepEqual(t.held(), [ELITE], `${reason}: access kept`);
  }
});

test('UC_MATCH=any: a refunded Elite Lifetime Access asks Upgrade.Chat ONCE for Monarch and Elite, and keeps both for a paying member', async () => {
  const paying = () => k.createFakeUc({ orders: { [USER]: [k.ucOrder({ uuid: 'uc-hidden-2', product: 'uc-hidden-elite-quarterly', interval: 'month', count: 3,
    lastCharge: T0 - 20 * 86400_000 })] } });
  const refund = (t) => {
    const charge = t.stripe.data.charges[0];
    charge.refunded = true;
    charge.amount_refunded = charge.amount;
  };
  const uc = paying();
  const t = setup({ uc, fixtures: eliteLifetimePaid() });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [ELITE, MONARCH].sort(), 'Monarch and Elite, no Academy Student');
  refund(t);
  const result = await t.engine.resync(USER);
  assert.deepEqual([result.roles, result.externalRoles], [[], []]);
  assert.deepEqual([t.ledger(MONARCH).state, t.ledger(ELITE).state], ['kept_external', 'kept_external']);
  assert.equal(uc.calls.length, 1, 'one Upgrade.Chat read for the member, not one per role');
  await t.applier.runOnce();
  assert.deepEqual(t.held(), [ELITE, MONARCH].sort(), 'Monarch and Elite kept');
  /* a refunded Academy Lifetime: Academy Student goes, Monarch is kept; Elite was never the engine's */
  const academy = setup({ uc: paying(), fixtures: academyLifetimePaid() });
  await academy.engine.resync(USER);
  await academy.applier.runOnce();
  assert.deepEqual(academy.held(), [ACADEMY_ROLE, MONARCH].sort());
  refund(academy);
  await academy.engine.resync(USER);
  await academy.applier.runOnce();
  assert.deepEqual([academy.ledger(MONARCH).state, academy.ledger(ELITE)], ['kept_external', null]);
  assert.deepEqual(academy.held(), [MONARCH], 'Academy Student removed, Monarch kept');
});

test("UC_MATCH=mapped keeps today's per-product rule: an unmapped hidden product does not keep the role", async () => {
  const uc = k.createFakeUc({ orders: { [USER]: [k.ucOrder({ uuid: 'uc-hidden-3', product: 'uc-hidden-premium-legacy', lastCharge: T0 - 3 * 86400_000 })] } });
  const t = setup({ uc, env: k.memEnv({ ucMatch: 'mapped', extraPrices: {} }) });
  assert.equal(t.config.ucMatch, 'mapped');
  assert.ok(t.config.warnings.some((w) => w.includes(`external role ${ELITE} has no entry`)));
  const mapped = setup({ uc, env: { ...k.memEnv({ ucMatch: 'mapped' }), SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON: JSON.stringify({ [ELITE]: [], [MONARCH]: [] }) } });
  const sub = subscribe(mapped, { id: 'sub_em', price: 'price_elitemonth', start: S(T0) - 10 * DAY });
  await mapped.engine.resync(USER);
  await mapped.applier.runOnce();
  sub.status = 'canceled';
  await mapped.engine.resync(USER);
  assert.deepEqual([mapped.ledger(ELITE).state, mapped.ledger(ELITE).last_reason], ['revoked', 'uc_no_product_grants_role']);
  assert.equal(uc.calls.length, 0);
});

/* UC_MATCH=any: kept_external is NOT final for a role the engine granted. The
   Upgrade.Chat upgrade that kept it may grant another role, so Upgrade.Chat
   never removes it: the engine asks again (every UC_KEPT_RECHECK_MS while the
   member holds the role) and revokes once Upgrade.Chat shows nothing active. */

test('UC any: a never-paid Elite trial kept by an unrelated Upgrade.Chat product is removed once Upgrade.Chat shows nothing', async () => {
  /* the member pays Upgrade.Chat for a hidden legacy Premium product only (it does not grant Elite) */
  const premiumOnly = (extra = {}) => k.ucOrder({ uuid: 'uc-premium-legacy', product: 'uc-hidden-premium-legacy', lastCharge: T0 - 3 * DAY_MS, ...extra });
  const uc = k.createFakeUc({ orders: { [USER]: [premiumOnly()] } });
  const t = setup({ uc });
  const sub = subscribe(t, { id: 'sub_wk', price: 'price_eliteweek', trialDays: 7 });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.deepEqual([t.held(), t.ledger(ELITE).state, t.ledger(ELITE).had_role_before], [[ELITE], 'engine_granted', false]);
  /* day 7: the trial ends without a payment; the Premium upgrade is active, so Elite is kept (for now) */
  t.now.set((S(T0) + 7 * DAY + 3600) * 1000);
  sub.status = 'canceled';
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.deepEqual([t.ledger(ELITE).state, t.ledger(ELITE).uc_result], ['kept_external', 'active']);
  /* day 60: the Premium subscription was cancelled long ago; Upgrade.Chat shows no active upgrade at all */
  t.now.set(T0 + 60 * DAY_MS);
  uc.state.orders[USER] = [premiumOnly({ cancelledAt: T0 + 5 * DAY_MS })];
  assert.deepEqual(await t.ucChecker.check(USER, ELITE), { result: 'none', reason: 'uc_no_active_upgrade' });
  const before = uc.calls.length;
  await t.engine.resync(USER, { ucRecheck: true });
  assert.equal(uc.calls.length, before + 1, 'Upgrade.Chat is asked again');
  assert.deepEqual([t.ledger(ELITE).state, t.ledger(ELITE).uc_result, t.ledger(ELITE).last_reason], ['revoked', 'none', 'uc_no_active_upgrade']);
  await t.applier.runOnce();
  assert.deepEqual(t.held(), []);
});

test('UC any: a REFUNDED Academy Lifetime does not keep Monarch forever because of a UC Elite subscription or a UC free trial', async () => {
  const cases = [
    /* a hidden UC Elite quarterly subscription (grants Elite, NOT Monarch), cancelled after the refund */
    ['uc_elite_quarterly', k.ucOrder({ uuid: 'uc-elite-q', product: 'uc-hidden-elite-quarterly', interval: 'month', count: 3, lastCharge: T0 - 20 * DAY_MS }),
      (order) => { order.cancelled_at = new Date(T0 + 30 * DAY_MS).toISOString(); }, T0 + 200 * DAY_MS],
    /* the Upgrade.Chat Free Trial Access (Elite only, paymentless 7-day trial bought yesterday), cancelled on day 6 */
    ['uc_free_trial', k.ucOrder({ uuid: 'uc-free-trial', product: '43012a04-dbf2-4919-af73-b265eb04cb7a', interval: 'day', count: 1,
      purchasedAt: T0 - DAY_MS, freeTrialLength: 7 }), (order) => { order.cancelled_at = new Date(T0 + 6 * DAY_MS).toISOString(); }, T0 + 10 * DAY_MS]
  ];
  for (const [name, order, lapse, later] of cases) {
    const uc = k.createFakeUc({ orders: { [USER]: [order] } });
    /* the member already holds the Elite that Upgrade.Chat sold them; the Academy Lifetime adds Academy Student and Monarch */
    const t = setup({ uc, fixtures: academyLifetimePaid(), members: { [USER]: [ELITE] } });
    await t.engine.resync(USER);
    await t.applier.runOnce();
    assert.deepEqual(t.held(), [ACADEMY_ROLE, ELITE, MONARCH].sort(), name);
    assert.equal(t.ledger(MONARCH).had_role_before, false);
    assert.equal(t.ledger(ELITE), null, `${name}: the Academy Lifetime never touches Elite`);
    const charge = t.stripe.data.charges[0];
    charge.refunded = true;
    charge.amount_refunded = charge.amount;
    await t.engine.resync(USER);
    await t.applier.runOnce();
    assert.deepEqual([t.ledger(MONARCH).state, t.ledger(ELITE)], ['kept_external', null], name);
    /* the UC upgrade ends; Upgrade.Chat's bot removes the Elite it sold, nothing else would ever remove Monarch */
    lapse(order);
    t.now.set(later);
    t.bot.state.members[USER] = t.bot.state.members[USER].filter((r) => r !== ELITE);
    assert.equal((await t.ucChecker.check(USER, MONARCH)).result, 'none', name);
    /* the due re-check (not forced: the kept answer is more than a day old) removes Monarch */
    await t.engine.resync(USER);
    await t.applier.runOnce();
    assert.deepEqual([t.ledger(MONARCH).state, t.ledger(MONARCH).uc_result], ['revoked', 'none'], name);
    /* Elite was Upgrade.Chat's from the start (it removed it): the engine never asked about it or touched it */
    assert.equal(t.ledger(ELITE), null, name);
    assert.deepEqual(t.held(), [], name);
  }
});

test('UC any: a kept row is asked again once a day while the member holds the role (next check scheduled), not on every resync', async () => {
  const premium = k.ucOrder({ uuid: 'uc-prem', product: 'uc-premium-monthly', lastCharge: T0 - 3 * DAY_MS });
  const uc = k.createFakeUc({ orders: { [USER]: [premium] } });
  const t = await eliteEnded(uc);
  await t.applier.runOnce();
  assert.deepEqual([t.ledger(ELITE).state, t.held()], ['kept_external', [ELITE]]);
  const keptAt = t.ledger(ELITE).uc_checked_at.getTime();
  const member = await t.store.getMember(null, USER);
  assert.equal(new Date(member.next_check_at).getTime(), keptAt + UC_KEPT_RECHECK_MS, 'the due-scan comes back in a day');
  /* 23 hours later a webhook resyncs the member: Upgrade.Chat is not asked yet */
  const calls = uc.calls.length;
  t.now.set(keptAt + 23 * 3600_000);
  await t.engine.resync(USER);
  assert.equal(uc.calls.length, calls);
  /* a day after the answer: asked again; still active -> kept, and the next check moves a day on */
  t.now.set(keptAt + UC_KEPT_RECHECK_MS);
  await t.engine.resync(USER);
  assert.equal(uc.calls.length, calls + 1);
  assert.deepEqual([t.ledger(ELITE).state, t.ledger(ELITE).uc_checked_at.getTime()], ['kept_external', t.now()]);
  assert.equal(new Date((await t.store.getMember(null, USER)).next_check_at).getTime(), t.now() + UC_KEPT_RECHECK_MS);
  /* the Premium subscription lapses: the next due re-check removes the engine's Elite */
  premium.cancelled_at = new Date(T0 + DAY_MS).toISOString();
  t.now.set(T0 + 60 * DAY_MS);
  await t.engine.resync(USER);
  assert.equal(t.ledger(ELITE).state, 'revoked');
  await t.applier.runOnce();
  assert.deepEqual(t.held(), []);
  /* an inconclusive re-check never removes the role: needs_review */
  const flaky = k.createFakeUc({ orders: { [USER]: [k.ucOrder({ uuid: 'uc-prem2', product: 'uc-premium-monthly', lastCharge: T0 - 3 * DAY_MS })] } });
  const r = await eliteEnded(flaky);
  await r.applier.runOnce();
  assert.equal(r.ledger(ELITE).state, 'kept_external');
  flaky.state.error = new Error('Upgrade.Chat orders request failed (503)');
  r.now.set(T0 + 2 * DAY_MS);
  await r.engine.resync(USER);
  await r.applier.runOnce();
  assert.deepEqual([r.ledger(ELITE).state, r.ledger(ELITE).last_reason, r.held()], ['needs_review', 'uc_error', [ELITE]]);
});

test('UC any: a staff keep stays final (never asked again, even forced), and a kept row the member lost is left alone', async () => {
  const uc = k.createFakeUc({ error: new Error('Upgrade.Chat orders request failed (503)') });
  const t = await eliteEnded(uc);
  assert.equal(t.ledger(ELITE).state, 'needs_review');
  /* what external-review --keep writes */
  const grant = t.ledger(ELITE);
  assert.notEqual(await t.store.updateExternalGrant(null, { discordId: USER, roleId: ELITE, generation: grant.generation, state: 'kept_external',
    reason: STAFF_KEEP_REASON }), null);
  uc.state.error = null;
  const calls = uc.calls.length;
  t.now.set(T0 + 30 * DAY_MS);
  await t.engine.resync(USER, { ucRecheck: true });
  await t.applier.runOnce();
  assert.equal(uc.calls.length, calls, 'a staff keep is never re-checked');
  assert.deepEqual([t.ledger(ELITE).state, t.held()], ['kept_external', [ELITE]]);
  /* a UC-kept row whose role is already gone needs no answer: Upgrade.Chat is not asked */
  const gone = k.createFakeUc({ orders: { [USER]: [k.ucOrder({ uuid: 'uc-x', lastCharge: T0 - 3 * DAY_MS })] } });
  const g = await eliteEnded(gone);
  await g.applier.runOnce();
  assert.equal(g.ledger(ELITE).state, 'kept_external');
  g.bot.state.members[USER] = [];
  const before = gone.calls.length;
  g.now.set(T0 + 30 * DAY_MS);
  await g.engine.resync(USER, { ucRecheck: true });
  assert.equal(gone.calls.length, before);
});

test('UC any: a kept row entitled again by a new Stripe plan goes back to engine_granted (never held), so it stays removable', async () => {
  const order = k.ucOrder({ uuid: 'uc-prem', product: 'uc-premium-monthly', lastCharge: T0 - 3 * DAY_MS });
  const uc = k.createFakeUc({ orders: { [USER]: [order] } });
  const t = await eliteEnded(uc);
  await t.applier.runOnce();
  assert.deepEqual([t.ledger(ELITE).state, t.held()], ['kept_external', [ELITE]]);
  /* a new Elite Monthly Access subscription entitles Elite again */
  t.now.advance(60_000);
  const again = subscribe(t, { id: 'sub_em2', price: 'price_elitemonth', start: S(t.now()) });
  await t.engine.resync(USER);
  assert.deepEqual([t.ledger(ELITE).state, t.ledger(ELITE).had_role_before, t.ledger(ELITE).last_reason], ['engine_granted', false, 're_entitled']);
  /* it ends, Upgrade.Chat now shows nothing: the engine's Elite is removed */
  order.cancelled_at = new Date(T0).toISOString();
  again.status = 'canceled';
  t.now.set(T0 + 60 * DAY_MS);
  await t.engine.resync(USER);
  await t.applier.runOnce();
  assert.deepEqual([t.ledger(ELITE).state, t.held()], ['revoked', []]);
});

test("UC mapped keeps today's rule: kept_external is final (the mapped product grants the role, so Upgrade.Chat removes it)", async () => {
  const uc = k.createFakeUc({ subscriptions: { [USER]: { 'uc-elite-monthly': 'uc-order-e' } } });
  const t = setup({ uc, env: { ...k.memEnv({ ucMatch: 'mapped' }),
    SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON: JSON.stringify({ [ELITE]: ['uc-elite-monthly'], [MONARCH]: [] }) } });
  const sub = subscribe(t, { id: 'sub_em', price: 'price_elitemonth', start: S(T0) - 10 * DAY });
  await t.engine.resync(USER);
  await t.applier.runOnce();
  sub.status = 'canceled';
  await t.engine.resync(USER);
  assert.deepEqual([t.ledger(ELITE).state, t.ledger(ELITE).uc_result], ['kept_external', 'active']);
  const calls = uc.calls.length;
  uc.state.subscriptions[USER] = {};
  t.now.set(T0 + 60 * DAY_MS);
  await t.engine.resync(USER, { ucRecheck: true });
  assert.equal(uc.calls.length, calls);
  assert.equal(t.ledger(ELITE).state, 'kept_external');
});

test('during Free Trial Access (set to stop before its trial ends) the member can buy a paid Elite plan at once, without a second trial', async () => {
  const t = setup();
  const sub = subscribe(t, { id: 'sub_ft', price: 'price_freetrial', trialDays: 3 });
  /* before the engine set its auto-stop it still blocks the Elite line */
  assert.ok((await t.checkout.readAccess(USER)).blockingLines.has(`roles:${ELITE}`));
  await t.engine.resync(USER);
  assert.ok(sub.cancel_at <= sub.trial_end);
  const view = await t.checkout.readAccess(USER);
  assert.equal(view.blockingLines.has(`roles:${ELITE}`), false, 'a trial that can never charge does not block');
  assert.equal(view.trialUsed, true);
  const { session } = await buy(t, 'price_elitemonth');
  assert.equal(session.subscription_data.trial_period_days, undefined);
  /* a card trial that will convert (no auto-stop) still blocks its line */
  const other = setup();
  subscribe(other, { id: 'sub_em', price: 'price_elitemonth', trialDays: 7 });
  await other.engine.resync(USER);
  assert.ok((await other.checkout.readAccess(USER)).blockingLines.has(`roles:${ELITE}`));
  const { form } = await formFor(other, 'price_eliteweek');
  assert.deepEqual(await other.checkout.start({ bind: other.bind, form, ipKey: 'ip' }), { redirect: '/v1/academy/billing/manage' });
});

test('the success page of a free trial says the trial started, never "Payment received"', async () => {
  const t = setup();
  const { result } = await buy(t, 'price_freetrial');
  /* Checkout completed without collecting anything */
  Object.assign(t.stripe.data.sessions[result.sessionId], { status: 'complete', payment_status: 'no_payment_required', subscription: 'sub_ft' });
  subscribe(t, { id: 'sub_ft', price: 'price_freetrial', trialDays: 3, start: S(T0) + 60 });
  const settled = await t.checkout.settle(result.sessionId);
  assert.deepEqual([settled.ok, settled.paid, settled.trial], [true, true, true]);
  assert.equal(t.store.db.intents.get(result.intentId).status, 'completed');
  const html = pages.successPage({ config: t.config, nonce: 'n', sessionId: result.sessionId, paid: true, trial: true, inGuild: true });
  assert.ok(html.includes('data-trial="1"'));
  assert.ok(html.includes('Your free trial has started. Adding your Discord role...'));
  assert.equal(html.includes('>Payment received.'), false);
  const away = pages.successPage({ config: t.config, nonce: 'n', sessionId: result.sessionId, paid: true, trial: true, inGuild: false });
  assert.ok(away.includes('Your free trial has started. Your roles are waiting for you'));
  /* a paid checkout keeps its wording */
  const paid = pages.successPage({ config: t.config, nonce: 'n', sessionId: result.sessionId, paid: true, inGuild: true });
  assert.ok(paid.includes('Payment received. Adding your Discord role...'));
  assert.equal(paid.includes('data-trial="1"'), false);
});

test('one free trial across the Academy line and the memberships: an Elite trial uses up an Academy plan trial, and back', async () => {
  const env = k.memEnv({ extraPrices: { price_weekly1: { package: 'weekly', trialDays: 3 } } });
  const t = setup({ env });
  /* never had one: the Academy Week plan offers its 3-day trial */
  const first = await formFor(t, 'price_weekly1');
  assert.deepEqual([first.terms.trialDays, first.disclosure.kind], [3, 'auto_renewal']);
  assert.match(first.disclosure.text, /^Free trial, then automatic renewal: the MEM Academy Week plan starts with a 3-day free trial\./);
  /* an Elite Week Seat trial happened: the Academy trial is gone */
  subscribe(t, { id: 'sub_ew', price: 'price_eliteweek', trialDays: 7 });
  await t.engine.resync(USER);
  const { session, terms } = await buy(t, 'price_weekly1');
  assert.deepEqual([terms.trialDays, terms.trialUsed], [null, true]);
  assert.equal(session.subscription_data.trial_period_days, undefined);
  /* and the other way round */
  const back = setup({ env });
  subscribe(back, { id: 'sub_aw', price: 'price_weekly1', trialDays: 3, status: 'canceled' });
  await back.engine.resync(USER);
  assert.equal((await back.store.trialFor(null, USER)).first_price_id, 'price_weekly1');
  const elite = await buy(back, 'price_elitemonth');
  assert.equal(elite.session.subscription_data.trial_period_days, undefined);
  /* test-mode trials never use up a live one (the ledger is per livemode) */
  const live = k.createFakeStore({ livemode: true });
  assert.equal(await live.trialFor(null, USER), null);
});
