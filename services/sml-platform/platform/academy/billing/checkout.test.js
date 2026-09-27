'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildCheckoutParams, createCheckout } = require('./checkout');
const { createResync } = require('./resync');
const { createCatalog } = require('./catalog');
const { createLinkTokens } = require('./link-token');
const { disclosureFor, consentSha } = require('./pages');
const { RESERVED_FOREIGN_KEYS } = require('./stripe-shapes');
const k = require('./testkit');

const { USER, T0 } = k;
const INTENT = { id: '0b9f1f64-6a3c-4d7b-9a44-1f0a2b3c4d5e', consentVersion: '2026-10-01', consentSha256: 'a'.repeat(64) };
const FLAGS = { paymentMethods: ['card', 'link'], tosConsent: false, automaticTax: false };
const URLS = { publicUrl: 'https://making-easy-money-academy.onrender.com' };

function allKeys(value, out = []) {
  if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) { out.push(key); allKeys(item, out); }
  return out;
}

test('buildCheckoutParams: subscription mode for recurring packages', () => {
  const params = buildCheckoutParams({ pkg: 'quarterly', priceId: 'price_quarter1', amount: 7999, customerId: 'cus_1', discordId: USER, intent: INTENT, urls: URLS, flags: FLAGS, nowMs: T0 });
  assert.equal(params.mode, 'subscription');
  assert.deepEqual(params.line_items, [{ price: 'price_quarter1', quantity: 1 }]);
  assert.equal(params.customer, 'cus_1');
  assert.equal(params.client_reference_id, INTENT.id);
  assert.deepEqual(params.metadata, {
    sml_kind: 'mem_academy', mem_academy_v: '1', mem_academy_intent: INTENT.id, mem_academy_discord_user: USER, mem_academy_package: 'quarterly',
    mem_academy_price: 'price_quarter1', mem_academy_consent_version: '2026-10-01', mem_academy_consent_sha256: 'a'.repeat(64)
  });
  assert.deepEqual(params.subscription_data.metadata, params.metadata);
  assert.equal(params.payment_intent_data, undefined);
  assert.deepEqual(params.payment_method_types, ['card', 'link']);
  assert.equal(params.allow_promotion_codes, false);
  assert.equal(params.consent_collection, undefined);
  assert.equal(params.automatic_tax, undefined);
  assert.equal(params.expires_at, Math.floor(T0 / 1000) + 35 * 60);
  assert.equal(params.success_url, 'https://making-easy-money-academy.onrender.com/v1/academy/billing/success?session_id={CHECKOUT_SESSION_ID}');
  assert.match(params.custom_text.submit.message, /Renews every 3 months at \$79\.99 until you cancel/);
});

test('buildCheckoutParams: payment mode for lifetime, with a receipt invoice', () => {
  const params = buildCheckoutParams({ pkg: 'lifetime', priceId: 'price_life1', amount: 129999, customerId: 'cus_1', discordId: USER, intent: INTENT, urls: URLS, flags: FLAGS, nowMs: T0 });
  assert.equal(params.mode, 'payment');
  assert.deepEqual(params.payment_intent_data.metadata, params.metadata);
  assert.equal(params.subscription_data, undefined);
  assert.equal(params.invoice_creation.enabled, true);
  assert.equal(params.metadata.mem_academy_package, 'lifetime');
});

test('buildCheckoutParams never emits a reserved key, transfer or application fee', () => {
  for (const pkg of ['daily', 'lifetime']) {
    const params = buildCheckoutParams({ pkg, priceId: 'price_x', amount: 299, customerId: 'cus_1', discordId: USER, intent: INTENT, urls: URLS,
      flags: { paymentMethods: ['card'], tosConsent: true, automaticTax: true }, nowMs: T0 });
    const keys = allKeys(params);
    for (const reserved of RESERVED_FOREIGN_KEYS) assert.equal(keys.includes(reserved), false, reserved);
    for (const forbidden of ['transfer_data', 'application_fee_amount', 'application_fee_percent', 'on_behalf_of']) assert.equal(keys.includes(forbidden), false, forbidden);
    assert.deepEqual(params.consent_collection, { terms_of_service: 'required' });
    assert.deepEqual(params.automatic_tax, { enabled: true });
    assert.deepEqual(params.payment_method_types, ['card']);
  }
});

test('buildCheckoutParams: a free trial (card) and a trial without a card (missing payment method cancels it)', () => {
  const base = { priceId: 'price_x', amount: 8990, customerId: 'cus_1', discordId: USER, intent: INTENT, urls: URLS, flags: FLAGS, nowMs: T0 };
  const card = buildCheckoutParams({ ...base, pkg: 'monthly', trial: { days: 7, noCard: false } });
  assert.equal(card.subscription_data.trial_period_days, 7);
  assert.equal(card.subscription_data.trial_settings, undefined);
  assert.equal(card.payment_method_collection, undefined);
  assert.deepEqual(card.payment_method_types, ['card', 'link'], 'still an explicit, non-empty list');
  assert.equal(card.metadata.mem_academy_trial_days, '7');
  const noCard = buildCheckoutParams({ ...base, pkg: 'daily', amount: 790, trial: { days: 7, noCard: true }, cancelAfterDays: 3 });
  assert.equal(noCard.payment_method_collection, 'if_required');
  assert.deepEqual(noCard.subscription_data.trial_settings, { end_behavior: { missing_payment_method: 'cancel' } });
  assert.equal(noCard.subscription_data.trial_period_days, 7);
  assert.match(noCard.custom_text.submit.message, /never charged/);
  const none = buildCheckoutParams({ ...base, pkg: 'monthly' });
  assert.equal(none.subscription_data.trial_period_days, undefined);
  assert.equal(none.metadata.mem_academy_trial_days, undefined);
  for (const [pkg, trial] of [['lifetime', { days: 7 }], ['monthly', { days: 0 }], ['monthly', { days: 31 }], ['monthly', { days: '7' }]]) {
    assert.throws(() => buildCheckoutParams({ ...base, pkg, trial }), /trial_not_allowed/, `${pkg} ${JSON.stringify(trial)}`);
  }
});

/* ------------------------------ createCheckout ------------------------------ */

function setup({ overrides = {}, members = { [USER]: [] }, preflightOk = true, livemode = false, fixtures = {} } = {}) {
  const now = k.clock();
  const config = k.config(overrides);
  const store = k.createFakeStore({ now, livemode });
  const stripe = k.createFakeStripe(fixtures);
  const bot = k.createFakeBot({ members });
  const catalog = createCatalog({ config, stripeApi: stripe, now });
  const tokens = createLinkTokens({ secret: config.clientSecret, now });
  const resyncCalls = [];
  const core = createResync({ config, store, stripeApi: stripe, catalog, bot, now });
  const resync = async (id, opts) => { resyncCalls.push([id, opts]); return core.resync(id, opts); };
  let n = 0;
  const preflight = { ok: () => preflightOk, stripeAccountOk: () => preflightOk };
  const checkout = createCheckout({ config, store, stripeApi: stripe, catalog, bot, tokens, resync, takeSnapshot: core.takeSnapshot, preflight, now,
    uuid: () => `0b9f1f64-6a3c-4d7b-9a44-${String(++n).padStart(12, '0')}` });
  const bind = tokens.readBind(tokens.issueBind({ userId: USER, guildId: k.GUILD, source: 'web_oauth', purpose: 'buy' }));
  const form = (pkg, extra = {}) => {
    const desc = { amount: k.PRICE_TABLE[`price_${{ daily: 'daily1', weekly: 'weekly1', monthly: 'monthly1', quarterly: 'quarter1', yearly: 'year1', lifetime: 'life1' }[pkg]}`].amount };
    const d = disclosureFor({ pkg, amount: desc.amount, currency: 'usd', termsUrl: config.termsUrl, privacyUrl: config.privacyUrl });
    return { package: pkg, csrf: tokens.csrfFor(bind), disclosure_sha: consentSha(config.consentVersion, d.text),
      [pkg === 'lifetime' ? 'consent_final' : 'consent_renewal']: '1', ...extra };
  };
  return { now, config, store, stripe, bot, checkout, tokens, bind, form, resyncCalls };
}

test('a first purchase: Customer, intent with consent proof, then a Checkout Session', async () => {
  const t = setup();
  const result = await t.checkout.start({ bind: t.bind, form: t.form('monthly'), ipKey: 'ip1' });
  assert.match(result.redirect, /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/);
  const [customerCall] = t.stripe.callsOf('createCustomer');
  assert.equal(customerCall.args[1], `mem-academy-customer-v1-test-${USER}`);
  assert.deepEqual(customerCall.args[0].metadata, { sml_kind: 'mem_academy', mem_academy_v: '1', mem_academy_discord_user: USER });
  assert.match(customerCall.args[0].invoice_settings.footer, /renew automatically until cancelled/);
  const intent = t.store.db.intents.get(result.intentId);
  const expectedText = disclosureFor({ pkg: 'monthly', amount: 2999, termsUrl: t.config.termsUrl, privacyUrl: t.config.privacyUrl }).text;
  assert.equal(intent.consent_sha256, consentSha('2026-10-01', expectedText));
  assert.equal(intent.consent_version, '2026-10-01');
  assert.equal(intent.consent_kind, 'auto_renewal');
  assert.equal(intent.status, 'open');
  assert.equal(intent.stripe_checkout_session_id, result.sessionId);
  const [sessionCall] = t.stripe.callsOf('createCheckoutSession');
  assert.equal(sessionCall.args[1], `mem-academy-checkout-v1-${result.intentId}`);
  assert.equal(sessionCall.args[0].client_reference_id, result.intentId);
  assert.equal(sessionCall.args[0].metadata.mem_academy_consent_sha256, intent.consent_sha256);
  assert.deepEqual(k.actions(t.store), ['binding_created', 'intent_created']);
  assert.equal(t.store.db.members.get(`${USER}|false`).bound_via, 'web_oauth');
});

test('CHECKOUT_ENABLED=0 or a failed preflight refuses with 503 and writes nothing', async () => {
  const off = setup({ overrides: { SML_ACADEMY_BILLING_CHECKOUT_ENABLED: '0' } });
  assert.deepEqual(await off.checkout.start({ bind: off.bind, form: off.form('monthly') }), { status: 503, error: 'checkout_disabled' });
  const pre = setup({ preflightOk: false });
  assert.deepEqual(await pre.checkout.start({ bind: pre.bind, form: pre.form('monthly') }), { status: 503, error: 'preflight_not_passed' });
  assert.equal(off.stripe.calls.length + pre.stripe.calls.length, 0);
});

test('refused without consent, without CSRF, without a sign-in, or for an unsellable package', async () => {
  const t = setup();
  assert.equal((await t.checkout.start({ bind: t.bind, form: t.form('monthly', { consent_renewal: '' }) })).error, 'consent_required');
  assert.equal((await t.checkout.start({ bind: t.bind, form: t.form('lifetime', { consent_final: '0' }) })).error, 'consent_required');
  assert.equal((await t.checkout.start({ bind: t.bind, form: t.form('monthly', { csrf: 'forged' }) })).error, 'csrf_failed');
  assert.equal((await t.checkout.start({ bind: null, form: t.form('monthly') })).error, 'sign_in_required');
  assert.equal((await t.checkout.start({ bind: t.bind, form: { ...t.form('monthly'), package: 'semiannual' } })).status, 409);
  t.stripe.data.prices.price_semi1.active = false;
  const bad = setup({ fixtures: { prices: { price_semi1: { ...k.stripePrice('price_semi1'), active: false } } } });
  assert.equal((await bad.checkout.start({ bind: bad.bind, form: { ...bad.form('monthly'), package: 'semiannual' } })).error, 'package_unavailable');
  assert.equal(t.stripe.callsOf('createCheckoutSession').length, 0);
});

test('a changed price (different disclosure) must be reviewed again', async () => {
  const t = setup();
  assert.deepEqual(await t.checkout.start({ bind: t.bind, form: t.form('monthly', { disclosure_sha: 'b'.repeat(64) }) }), { status: 409, page: 'prices_changed' });
});

test('a non-member is refused in strict mode, allowed with ALLOW_NON_MEMBER', async () => {
  const strict = setup({ members: {} });
  assert.deepEqual(await strict.checkout.start({ bind: strict.bind, form: strict.form('monthly') }), { status: 403, page: 'non_member', data: { pkg: 'monthly' } });
  const open = setup({ members: {}, overrides: { SML_ACADEMY_BILLING_ALLOW_NON_MEMBER: '1' } });
  assert.ok((await open.checkout.start({ bind: open.bind, form: open.form('monthly') })).redirect);
});

test('ALLOW_NON_MEMBER=1: an account BANNED from the server is never sent to Stripe (it could never receive the roles)', async () => {
  /* The ban used to show up only after payment (applier member_banned), for
     up to $9,200 and every renewal. */
  for (const overrides of [{ SML_ACADEMY_BILLING_ALLOW_NON_MEMBER: '1' }, { SML_ACADEMY_BILLING_ALLOW_NON_MEMBER: '1', SML_ACADEMY_BILLING_AUTO_JOIN: '1' }]) {
    const t = setup({ members: {}, overrides });
    t.bot.state.bans.add(USER);
    assert.deepEqual(await t.checkout.start({ bind: t.bind, form: t.form('monthly'), ipKey: 'ip1' }), { status: 403, page: 'banned' });
    assert.deepEqual(await t.checkout.start({ bind: t.bind, form: t.form('lifetime'), ipKey: 'ip1' }), { status: 403, page: 'banned' });
    assert.equal(t.stripe.callsOf('createCheckoutSession').length, 0);
    assert.equal(t.stripe.callsOf('createCustomer').length, 0);
    assert.equal(t.store.db.intents.size, 0);
  }
  /* a failed ban lookup refuses for now; an unknown answer (no Ban Members) lets the sale go on */
  const down = setup({ members: {}, overrides: { SML_ACADEMY_BILLING_ALLOW_NON_MEMBER: '1' } });
  down.bot.getBan = async () => { throw new Error('discord 500'); };
  assert.deepEqual(await down.checkout.start({ bind: down.bind, form: down.form('monthly') }), { status: 503, error: 'discord_unavailable' });
  const unknown = setup({ members: {}, overrides: { SML_ACADEMY_BILLING_ALLOW_NON_MEMBER: '1' } });
  unknown.bot.getBan = async () => null;
  assert.ok((await unknown.checkout.start({ bind: unknown.bind, form: unknown.form('monthly') })).redirect);
  /* a member of the server is never looked up */
  const member = setup({ overrides: { SML_ACADEMY_BILLING_ALLOW_NON_MEMBER: '1' } });
  member.bot.getBan = async () => { throw new Error('must not be called'); };
  assert.ok((await member.checkout.start({ bind: member.bind, form: member.form('monthly') })).redirect);
  assert.deepEqual(await member.checkout.banState(USER), 'error');
});

test('duplicate guard: active, trialing, past_due, unpaid, paused and incomplete send the member to Manage billing', async () => {
  for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete']) {
    const t = setup({ fixtures: { customers: { cus_have: k.academyCustomer('cus_have', USER) },
      subscriptions: [k.subscription({ id: 'sub_have', customer: 'cus_have', status, created: Math.floor(T0 / 1000) - 3600 })] } });
    k.bindMember(t.store, USER, 'cus_have');
    assert.deepEqual(await t.checkout.start({ bind: t.bind, form: t.form('weekly') }), { redirect: '/v1/academy/billing/manage' }, status);
    assert.equal(t.stripe.callsOf('createCheckoutSession').length, 0);
  }
});

test('a deleted Customer is never reused for a new checkout', async () => {
  const t = setup();
  k.bindMember(t.store, USER, 'cus_deleted');
  assert.deepEqual(await t.checkout.start({ bind: t.bind, form: t.form('monthly') }), { status: 409, error: 'binding_conflict' });
  assert.equal(t.stripe.callsOf('createCheckoutSession').length, 0);
});

test('lifetime owned -> already owned; lifetime while a plan renews -> allowed', async () => {
  const owned = setup({ fixtures: { customers: { cus_have: k.academyCustomer('cus_have', USER) },
    paymentIntents: [k.lifetimePi({ id: 'pi_l', customer: 'cus_have', latestCharge: 'ch_l' })], charges: [k.charge({ id: 'ch_l', customer: 'cus_have' })] } });
  k.bindMember(owned.store, USER, 'cus_have');
  assert.deepEqual(await owned.checkout.start({ bind: owned.bind, form: owned.form('monthly') }), { status: 409, page: 'owned' });
  assert.deepEqual(await owned.checkout.start({ bind: owned.bind, form: owned.form('lifetime') }), { status: 409, page: 'owned' });
  const upgrading = setup({ fixtures: { customers: { cus_have: k.academyCustomer('cus_have', USER) },
    subscriptions: [k.subscription({ id: 'sub_have', customer: 'cus_have' })] } });
  k.bindMember(upgrading.store, USER, 'cus_have');
  const result = await upgrading.checkout.start({ bind: upgrading.bind, form: upgrading.form('lifetime') });
  assert.ok(result.redirect);
  assert.equal(upgrading.stripe.callsOf('createCheckoutSession')[0].args[0].mode, 'payment');
  assert.equal(upgrading.store.db.intents.get(result.intentId).consent_kind, 'final_sale');
  assert.equal(upgrading.stripe.callsOf('createCustomer').length, 0);
});

test('the member\'s previous OPEN checkout session is expired before a new one', async () => {
  const t = setup();
  const first = await t.checkout.start({ bind: t.bind, form: t.form('monthly') });
  t.now.advance(60_000);
  const second = await t.checkout.start({ bind: t.bind, form: t.form('yearly') });
  assert.notEqual(first.sessionId, second.sessionId);
  assert.deepEqual(t.stripe.callsOf('expireCheckoutSession').map((c) => c.args), [[first.sessionId, `mem-academy-expire-v1-${first.sessionId}`]]);
  assert.equal(t.store.db.intents.get(first.intentId).status, 'expired');
  assert.ok(k.actions(t.store).includes('intent_expired'));
});

test('a second click within seconds is refused instead of creating a second session', async () => {
  const t = setup();
  const origCreate = t.stripe.createCheckoutSession;
  let second;
  t.stripe.createCheckoutSession = async (params, key) => {
    second = await t.checkout.start({ bind: t.bind, form: t.form('monthly') });
    return origCreate(params, key);
  };
  await t.checkout.start({ bind: t.bind, form: t.form('monthly') });
  assert.equal(second.status === 429 || second.redirect === '/v1/academy/billing/manage', true);
});

test('an existing Customer found by search is adopted instead of creating another', async () => {
  const t = setup({ fixtures: { customers: { cus_prev: k.academyCustomer('cus_prev', USER) } } });
  await t.checkout.start({ bind: t.bind, form: t.form('monthly') });
  assert.equal(t.stripe.callsOf('createCustomer').length, 0);
  assert.equal(t.store.db.members.get(`${USER}|false`).stripe_customer_id, 'cus_prev');
});

test('livemode isolation: a test-mode binding never feeds a live checkout', async () => {
  const live = setup({ livemode: true, overrides: { SML_ACADEMY_BILLING_LIVEMODE: '1', SML_ACADEMY_BILLING_STRIPE_KEY: 'rk_live_academy' } });
  live.store.db.members.set(`${USER}|false`, { discord_user_id: USER, livemode: false, stripe_customer_id: 'cus_testmode', last_access: {} });
  Object.values(live.stripe.data.prices).forEach((p) => { p.livemode = true; });
  const result = await live.checkout.start({ bind: live.bind, form: live.form('monthly') });
  assert.ok(result.redirect);
  const customer = live.stripe.callsOf('createCustomer')[0];
  assert.equal(customer.args[1], `mem-academy-customer-v1-live-${USER}`);
  assert.notEqual(live.stripe.callsOf('createCheckoutSession')[0].args[0].customer, 'cus_testmode');
});

test('the test clock is attached only in test mode when its flag is on', async () => {
  const t = setup({ overrides: { SML_ACADEMY_BILLING_TEST_CLOCK: '1' } });
  await t.checkout.start({ bind: t.bind, form: t.form('daily') });
  assert.equal(t.stripe.callsOf('createCustomer')[0].args[0].test_clock, 'clock_1');
});

/* ------------------------------ settle ------------------------------ */

function paidSession(t, overrides = {}) {
  const id = 'cs_test_paidsession01';
  t.stripe.data.sessions[id] = { id, object: 'checkout.session', customer: 'cus_have', mode: 'subscription', status: 'complete', payment_status: 'paid',
    client_reference_id: '0b9f1f64-6a3c-4d7b-9a44-000000000009', metadata: { sml_kind: 'mem_academy', mem_academy_discord_user: USER }, ...overrides };
  return id;
}

test('settle: a paid session for the bound customer completes the intent and resyncs', async () => {
  const t = setup({ fixtures: { customers: { cus_have: k.academyCustomer('cus_have', USER) } } });
  k.bindMember(t.store, USER, 'cus_have');
  const sessionId = paidSession(t);
  await t.store.insertIntent(null, { id: '0b9f1f64-6a3c-4d7b-9a44-000000000009', discordId: USER, package: 'monthly', priceId: 'price_monthly1', customerId: 'cus_have',
    bindSource: 'web_oauth', consentKind: 'auto_renewal', consentVersion: 'v', consentSha256: 'a'.repeat(64), consentedAt: T0, expiresAt: T0 + 1 });
  await t.store.markIntentOpen(null, { id: '0b9f1f64-6a3c-4d7b-9a44-000000000009', sessionId });
  const first = await t.checkout.settle(sessionId);
  assert.deepEqual([first.ok, first.paid, first.discordId], [true, true, USER]);
  assert.equal(t.store.db.intents.get('0b9f1f64-6a3c-4d7b-9a44-000000000009').status, 'completed');
  assert.equal(t.resyncCalls.length, 1);
  const cached = await t.checkout.settle(sessionId);
  assert.equal(cached.ok, true);
  assert.equal(t.resyncCalls.length, 1, 'a refresh within 10 s reuses the result');
  t.now.advance(11_000);
  const second = await t.checkout.settle(sessionId);
  assert.equal(second.ok, true);
  assert.equal(t.resyncCalls.length, 2);
  assert.equal(t.store.db.audit.filter((r) => r.action === 'intent_completed').length, 1);
});

async function storedIntent(t, sessionId, { id = '0b9f1f64-6a3c-4d7b-9a44-000000000009', discordId = USER } = {}) {
  await t.store.insertIntent(null, { id, discordId, package: 'monthly', priceId: 'price_monthly1', customerId: 'cus_have',
    bindSource: 'web_oauth', consentKind: 'auto_renewal', consentVersion: 'v', consentSha256: 'a'.repeat(64), consentedAt: T0, expiresAt: T0 + 1 });
  await t.store.markIntentOpen(null, { id, sessionId });
}

test('settle: a session whose customer is not the binding grants nothing', async () => {
  const t = setup();
  k.bindMember(t.store, USER, 'cus_have');
  const sessionId = paidSession(t, { customer: 'cus_someone_else' });
  await storedIntent(t, sessionId);
  assert.deepEqual(await t.checkout.settle(sessionId), { ok: false, reason: 'binding_mismatch' });
  assert.equal(t.resyncCalls.length, 0);
});

test('settle: a session whose Discord id is not the intent owner grants nothing', async () => {
  const t = setup();
  k.bindMember(t.store, USER, 'cus_have');
  const sessionId = paidSession(t);
  await storedIntent(t, sessionId, { discordId: k.USER2 });
  assert.deepEqual(await t.checkout.settle(sessionId), { ok: false, reason: 'binding_mismatch' });
  assert.equal(t.resyncCalls.length, 0);
});

test('settle: unpaid (async) grants nothing yet; foreign and malformed ids are refused', async () => {
  const t = setup();
  k.bindMember(t.store, USER, 'cus_have');
  const sessionId = paidSession(t, { payment_status: 'unpaid' });
  await storedIntent(t, sessionId);
  const result = await t.checkout.settle(sessionId);
  assert.deepEqual([result.ok, result.paid], [true, false]);
  assert.equal(t.resyncCalls.length, 0);
  t.stripe.data.sessions.cs_test_foreignsess01 = { id: 'cs_test_foreignsess01', metadata: { sml_site: 'x' }, customer: 'cus_have', payment_status: 'paid' };
  await storedIntent(t, 'cs_test_foreignsess01', { id: '0b9f1f64-6a3c-4d7b-9a44-000000000011' });
  assert.deepEqual(await t.checkout.settle('cs_test_foreignsess01'), { ok: false, reason: 'not_academy' });
  assert.deepEqual(await t.checkout.settle('cs_live_0000000000000'), { ok: false, reason: 'livemode_mismatch' });
  assert.deepEqual(await t.checkout.settle('evil"><script>'), { ok: false, reason: 'invalid_session' });
});

test('settle: a session id with no stored intent never reaches Stripe', async () => {
  const t = setup();
  k.bindMember(t.store, USER, 'cus_have');
  paidSession(t);
  for (let i = 0; i < 50; i += 1) {
    assert.deepEqual(await t.checkout.settle(`cs_test_${String(i).padStart(4, '0')}unknownsessionxx`), { ok: false, reason: 'unknown_session' });
  }
  assert.deepEqual(await t.checkout.settle('cs_test_paidsession01'), { ok: false, reason: 'unknown_session' }, 'a real Academy session is settled by its webhook when no intent points at it');
  assert.equal(t.stripe.callsOf('retrieveCheckoutSession').length, 0);
  assert.equal(t.resyncCalls.length, 0);
});

/* ------------------------------ portal + status ------------------------------ */

test('Manage billing needs a fresh purpose=manage sign-in and uses the dedicated portal', async () => {
  const t = setup();
  assert.deepEqual(await t.checkout.portal(t.bind), { redirect: '/v1/academy/billing/start?purpose=manage' });
  const manage = t.tokens.readBind(t.tokens.issueBind({ userId: USER, guildId: k.GUILD, source: 'web_oauth', purpose: 'manage' }));
  assert.deepEqual(await t.checkout.portal(manage), { status: 404, page: 'no_customer' });
  k.bindMember(t.store, USER, 'cus_have');
  const result = await t.checkout.portal(manage);
  assert.equal(result.redirect, 'https://billing.stripe.com/p/session/test_1');
  const [call] = t.stripe.callsOf('createPortalSession');
  assert.deepEqual(call.args[0], { customer: 'cus_have', configuration: 'bpc_academyDedicated1', return_url: 'https://making-easy-money-academy.onrender.com/v1/academy/billing/buy' });
  assert.ok(k.actions(t.store).includes('portal_opened'));
});

test('status JSON exposes only entitlement and role states for that session', async () => {
  const t = setup();
  k.bindMember(t.store, USER, 'cus_have', { last_access: { roles: ['academy'] } });
  await t.store.insertIntent(null, { id: '0b9f1f64-6a3c-4d7b-9a44-000000000010', discordId: USER, package: 'monthly', priceId: 'price_monthly1', customerId: 'cus_have',
    bindSource: 'web_oauth', consentKind: 'auto_renewal', consentVersion: 'v', consentSha256: 'a'.repeat(64), consentedAt: T0, expiresAt: T0 + 1 });
  await t.store.markIntentOpen(null, { id: '0b9f1f64-6a3c-4d7b-9a44-000000000010', sessionId: 'cs_test_statussess01' });
  await t.store.insertRoleRow(null, { discordId: USER, roleId: k.ACADEMY_ROLE, roleKey: 'academy', desired: true, state: 'synced' });
  assert.deepEqual(await t.checkout.status('cs_test_statussess01'), { entitled: true, intent: 'open', lifetimePending: false, lifetime: false,
    awaitingMember: false, roles: [{ key: 'academy', state: 'synced' }] });
  assert.equal(await t.checkout.status('cs_test_unknownsess1'), null);
});

test('duplicate guard: a plan voided by a lost dispute blocks while it still renews, not once it is set to end', async () => {
  const fixtures = (sub = {}) => ({
    customers: { cus_have: k.academyCustomer('cus_have', USER) },
    subscriptions: [k.subscription({ id: 'sub_v', customer: 'cus_have', created: Math.floor(T0 / 1000) - 70 * 86400, ...sub })],
    invoices: [k.invoice({ id: 'in_o', subscription: 'sub_v', charge: 'ch_o', created: Math.floor(T0 / 1000) - 60 * 86400 })],
    charges: [k.charge({ id: 'ch_o', customer: 'cus_have', invoiceId: 'in_o', disputed: true, created: Math.floor(T0 / 1000) - 60 * 86400 })],
    disputes: [{ id: 'du_o', object: 'dispute', charge: 'ch_o', status: 'lost' }]
  });
  const renewing = setup({ fixtures: fixtures() });
  k.bindMember(renewing.store, USER, 'cus_have');
  const view = await renewing.checkout.readAccess(USER);
  assert.deepEqual([view.recurring, view.entitled], [true, false], '/buy shows "needs attention", not "Access active"');
  assert.deepEqual(await renewing.checkout.start({ bind: renewing.bind, form: renewing.form('monthly') }), { redirect: '/v1/academy/billing/manage' },
    'a second plan would be charged next to the one Stripe still renews');
  const ending = setup({ fixtures: fixtures({ cancelAtPeriodEnd: true }) });
  k.bindMember(ending.store, USER, 'cus_have');
  assert.equal((await ending.checkout.readAccess(USER)).recurring, false);
  const result = await ending.checkout.start({ bind: ending.bind, form: ending.form('monthly') });
  assert.ok(result.redirect && result.redirect.startsWith('https://checkout.stripe.com/'), 'a voided plan that will never charge again does not block a new one');
});

/* ---------------------------------------------------------------------------
 * Lifetime by bank debit (ACH Direct Debit, us_bank_account).
 * ------------------------------------------------------------------------ */

test('buildCheckoutParams: a bank-debit lifetime gets us_bank_account with verification_method automatic', () => {
  const params = buildCheckoutParams({ pkg: 'lifetime', priceId: 'price_life1', amount: 1000000, customerId: 'cus_1', discordId: USER, intent: INTENT, urls: URLS,
    flags: { ...FLAGS, paymentMethods: ['card', 'us_bank_account'] }, nowMs: T0 });
  assert.equal(params.mode, 'payment');
  assert.deepEqual(params.payment_method_types, ['card', 'us_bank_account']);
  assert.deepEqual(params.payment_method_options, { us_bank_account: { verification_method: 'automatic' } });
  assert.match(params.custom_text.submit.message, /Bank payments \(ACH\) take a few business days to clear\. Your access starts when the payment clears\./);
  assert.ok(params.custom_text.submit.message.length <= 1200);
  const card = buildCheckoutParams({ pkg: 'lifetime', priceId: 'price_life1', amount: 1000000, customerId: 'cus_1', discordId: USER, intent: INTENT, urls: URLS, flags: FLAGS, nowMs: T0 });
  assert.equal(card.payment_method_options, undefined);
  assert.equal(/Bank payments/.test(card.custom_text.submit.message), false);
});

test('checkout uses the price entry methods: bank for the lifetime, card+link for the plans', async () => {
  const t = setup({ overrides: k.BANK_LIFETIME_ENV });
  const life = await t.checkout.start({ bind: t.bind, form: t.form('lifetime'), ipKey: 'ip1' });
  assert.match(life.redirect, /^https:\/\/checkout\.stripe\.com\//);
  const [lifeCall] = t.stripe.callsOf('createCheckoutSession');
  assert.deepEqual(lifeCall.args[0].payment_method_types, ['card', 'us_bank_account']);
  assert.deepEqual(lifeCall.args[0].payment_method_options, { us_bank_account: { verification_method: 'automatic' } });
  const plan = setup({ overrides: k.BANK_LIFETIME_ENV });
  await plan.checkout.start({ bind: plan.bind, form: plan.form('daily'), ipKey: 'ip2' });
  const [planCall] = plan.stripe.callsOf('createCheckoutSession');
  assert.deepEqual(planCall.args[0].payment_method_types, ['card', 'link']);
  assert.equal(planCall.args[0].payment_method_options, undefined);
});

function achSettleSetup({ piStatus = 'processing', nextAction = null } = {}) {
  const t = setup({ overrides: k.BANK_LIFETIME_ENV, fixtures: {
    customers: { cus_ach: k.academyCustomer('cus_ach', USER) },
    paymentIntents: [k.lifetimePi({ id: 'pi_ach', customer: 'cus_ach', status: piStatus, latestCharge: nextAction ? null : 'ch_ach', nextAction })],
    charges: nextAction ? [] : [k.charge({ id: 'ch_ach', customer: 'cus_ach', amount: 1000000, paymentIntent: 'pi_ach',
      status: piStatus === 'succeeded' ? 'succeeded' : (piStatus === 'processing' ? 'pending' : 'failed') })]
  } });
  k.bindMember(t.store, USER, 'cus_ach');
  const intentId = '0b9f1f64-6a3c-4d7b-9a44-00000000ac01';
  const sessionId = 'cs_test_achsession001';
  t.stripe.data.sessions[sessionId] = { id: sessionId, customer: 'cus_ach', mode: 'payment', status: 'complete', payment_status: 'unpaid', payment_intent: 'pi_ach',
    client_reference_id: intentId, metadata: { sml_kind: 'mem_academy', mem_academy_discord_user: USER, mem_academy_package: 'lifetime' } };
  const ready = async () => {
    await t.store.insertIntent(null, { id: intentId, discordId: USER, package: 'lifetime', priceId: 'price_life1', customerId: 'cus_ach', bindSource: 'web_oauth',
      consentKind: 'final_sale', consentVersion: 'v', consentSha256: 'a'.repeat(64), consentedAt: T0, expiresAt: T0 + 1 });
    await t.store.markIntentOpen(null, { id: intentId, sessionId });
  };
  return { ...t, intentId, sessionId, ready };
}

test('settle: a bank-debit lifetime that is still processing grants nothing and leaves the intent open', async () => {
  const t = achSettleSetup();
  await t.ready();
  const result = await t.checkout.settle(t.sessionId);
  assert.deepEqual([result.ok, result.paid, result.processing, result.failed], [true, false, true, false]);
  assert.equal(t.resyncCalls.length, 0, 'no resync (and so no role) from an unpaid session');
  assert.equal(t.store.db.intents.get(t.intentId).status, 'open');
  assert.equal(t.store.db.roles.size, 0);
  /* the readAccess view used by /buy and the duplicate guard */
  const view = await t.checkout.readAccess(USER);
  assert.deepEqual([view.lifetime, view.lifetimePending, view.entitled], [false, true, false]);
});

test('settle: once the debit clears, a later re-read grants both roles and completes the intent', async () => {
  const t = achSettleSetup();
  await t.ready();
  await t.checkout.settle(t.sessionId);
  /* the debit clears: PaymentIntent succeeded, the session reads paid */
  t.stripe.data.paymentIntents[0].status = 'succeeded';
  t.stripe.data.charges[0].status = 'succeeded';
  t.stripe.data.sessions[t.sessionId].payment_status = 'paid';
  t.now.advance(11_000);
  const result = await t.checkout.settle(t.sessionId);
  assert.deepEqual([result.paid, result.processing], [true, false]);
  assert.equal(t.resyncCalls.length, 1);
  assert.equal(t.store.db.intents.get(t.intentId).status, 'completed');
  assert.deepEqual([...t.store.db.roles.values()].map((r) => [r.role_key, r.desired]).sort(), [['academy', true], ['mem_lifetime', true]]);
});

test('settle: a checkout whose bank debit failed says so and grants nothing', async () => {
  const t = achSettleSetup({ piStatus: 'requires_payment_method' });
  await t.ready();
  await t.store.markIntentStatus(null, { id: t.intentId, status: 'failed' });
  const result = await t.checkout.settle(t.sessionId);
  assert.deepEqual([result.paid, result.processing, result.failed], [false, false, true]);
  assert.equal(t.resyncCalls.length, 0);
});

test('nothing is sold while a lifetime bank debit clears (processing or awaiting microdeposits)', async () => {
  for (const opts of [{ piStatus: 'processing' }, { piStatus: 'requires_action', nextAction: 'verify_with_microdeposits' }]) {
    const t = achSettleSetup(opts);
    for (const pkg of ['lifetime', 'monthly']) {
      assert.deepEqual(await t.checkout.start({ bind: t.bind, form: t.form(pkg), ipKey: `ip-${pkg}` }), { status: 409, page: 'lifetime_pending' }, `${opts.piStatus} ${pkg}`);
    }
    assert.equal(t.stripe.callsOf('createCheckoutSession').length, 0);
  }
  /* a failed debit does not block a new purchase */
  const failed = achSettleSetup({ piStatus: 'requires_payment_method' });
  const again = await failed.checkout.start({ bind: failed.bind, form: failed.form('lifetime'), ipKey: 'ip9' });
  assert.match(again.redirect, /^https:\/\/checkout\.stripe\.com\//);
});

test('status: a lifetime checkout reports lifetimePending while the debit clears', async () => {
  const t = achSettleSetup();
  await t.ready();
  k.bindMember(t.store, USER, 'cus_ach', { last_access: { roles: ['academy'], lifetimePending: true } });
  const status = await t.checkout.status(t.sessionId);
  assert.deepEqual([status.entitled, status.lifetimePending, status.intent], [true, true, 'open']);
});

test('buildCheckoutParams refuses a bank debit on any recurring package and an empty method list', () => {
  const build = (pkg, paymentMethods) => buildCheckoutParams({ pkg, priceId: 'price_x1', amount: 999, customerId: 'cus_1', discordId: USER, intent: INTENT,
    urls: URLS, flags: { ...FLAGS, paymentMethods }, nowMs: T0 });
  for (const pkg of ['daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'yearly']) {
    assert.throws(() => build(pkg, ['card', 'us_bank_account']), /delayed_method_on_subscription/, pkg);
  }
  /* never an empty list: Stripe would fall back to the Dashboard's dynamic methods */
  for (const methods of [[], null, undefined]) assert.throws(() => build('lifetime', methods), /payment_methods_required/);
  assert.deepEqual(build('lifetime', ['card', 'us_bank_account']).payment_method_types, ['card', 'us_bank_account']);
});

test('a plan whose catalog row carries a bank debit never reaches Stripe: 502, intent failed, nothing touched', async () => {
  const t = setup();
  /* a corrupted catalog: the weekly plan with us_bank_account */
  const catalog = createCatalog({ config: t.config, stripeApi: t.stripe, now: t.now });
  const corrupted = { ...catalog, async get() {
    const state = await catalog.get();
    const weekly = { ...state.sellable.get('weekly'), paymentMethods: ['card', 'us_bank_account'], delayedPayment: true };
    return { ...state, sellable: new Map([...state.sellable, ['weekly', weekly]]) };
  } };
  const core = createResync({ config: t.config, store: t.store, stripeApi: t.stripe, catalog, bot: t.bot, now: t.now });
  const checkout = createCheckout({ config: t.config, store: t.store, stripeApi: t.stripe, catalog: corrupted, bot: t.bot, tokens: t.tokens,
    resync: core.resync, takeSnapshot: core.takeSnapshot, preflight: { ok: () => true, stripeAccountOk: () => true }, now: t.now,
    uuid: () => '0b9f1f64-6a3c-4d7b-9a44-00000000bad1' });
  const result = await checkout.start({ bind: t.bind, form: t.form('weekly'), ipKey: 'ip1' });
  assert.deepEqual([result.status, result.error], [502, 'stripe_checkout_failed']);
  assert.equal(t.stripe.callsOf('createCheckoutSession').length, 0);
  assert.equal(t.stripe.callsOf('listOpenCheckoutSessions').length, 0);
  assert.equal(t.store.db.intents.get('0b9f1f64-6a3c-4d7b-9a44-00000000bad1').status, 'failed');
});

test('readAccess: a Lifetime paused by an open dispute (an ACH authorization inquiry here) is owned but suspended', async () => {
  const t = setup({ overrides: k.BANK_LIFETIME_ENV, fixtures: {
    customers: { cus_ach: k.academyCustomer('cus_ach', USER) },
    paymentIntents: [k.lifetimePi({ id: 'pi_ach', customer: 'cus_ach', status: 'succeeded', latestCharge: 'py_ach', amount: 1000000 })],
    charges: [k.charge({ id: 'py_ach', customer: 'cus_ach', amount: 1000000, paymentIntent: 'pi_ach', disputed: true })],
    disputes: [{ id: 'du_ach', object: 'dispute', charge: 'py_ach', status: 'warning_needs_response' }]
  } });
  k.bindMember(t.store, USER, 'cus_ach');
  const view = await t.checkout.readAccess(USER);
  assert.deepEqual([view.lifetime, view.lifetimeSuspended, view.entitled, view.lifetimePending], [true, true, false, false]);
  assert.deepEqual(await t.checkout.start({ bind: t.bind, form: t.form('lifetime'), ipKey: 'ip1' }), { status: 409, page: 'owned' });
  /* once the inquiry closes in MEM's favor it is active again */
  t.stripe.data.disputes[0].status = 'warning_closed';
  const after = await t.checkout.readAccess(USER);
  assert.deepEqual([after.lifetime, after.lifetimeSuspended, after.entitled], [true, false, true]);
});
