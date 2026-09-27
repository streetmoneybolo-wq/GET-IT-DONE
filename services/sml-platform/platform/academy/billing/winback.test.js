'use strict';

/* Win-back offers (2026-09-27): former $10 monthly members get the membership
   at $1 for the first month (then $15/month, bonus 7 Academy days) or the
   membership + Academy at $1 (then $25/month), once per Discord account. */

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseBillingConfig, PREMIUM_ROLE_ID } = require('./config');
const { buildCheckoutParams, createCheckout } = require('./checkout');
const { createResync } = require('./resync');
const { createCatalog } = require('./catalog');
const { createLinkTokens } = require('./link-token');
const { disclosureFor, consentSha, offerTerms, offerGrants, buyPage } = require('./pages');
const k = require('./testkit');

const { USER, T0 } = k;
const OTHER = '222222222222222222';
const S = (ms) => Math.floor(ms / 1000);

function winbackPrices(extra = {}) {
  const base = JSON.parse(k.env().SML_ACADEMY_BILLING_PRICES_JSON);
  return JSON.stringify({
    ...base,
    price_wbmem: { package: 'monthly', academy: false, roles: [PREMIUM_ROLE_ID], winback: true, introCents: 100, bonusAcademyDays: 7 },
    price_wbboth: { package: 'monthly', roles: [PREMIUM_ROLE_ID], winback: true, introCents: 100 },
    ...extra
  });
}

function winbackEnv(overrides = {}) {
  return { SML_ACADEMY_BILLING_PRICES_JSON: winbackPrices(), SML_ACADEMY_BILLING_WINBACK_IDS: `'${USER}',\n333333333333333333 444444444444444444`, ...overrides };
}

test('config: win-back prices, the id list (quotes, commas, spaces and new lines) and their guards', () => {
  const config = parseBillingConfig(k.env(winbackEnv()));
  assert.equal(config.enabled, true, config.errors.join('; '));
  assert.deepEqual([...config.winbackIds].sort(), ['333333333333333333', '444444444444444444', USER].sort());
  const mem = config.prices.get('price_wbmem');
  assert.deepEqual([mem.winback, mem.introCents, mem.bonusAcademyDays, mem.academy], [true, 100, 7, false]);
  /* a win-back price never clashes with the regular Academy Monthly */
  assert.equal(config.prices.get('price_monthly1').sell, true);
  assert.equal(config.prices.get('price_wbboth').line, 'academy');

  const bad = (extra, pattern, env = {}) => assert.throws(() => parseBillingConfig(k.env({ ...winbackEnv(env), SML_ACADEMY_BILLING_PRICES_JSON: winbackPrices(extra) })), pattern);
  bad({ price_monthly1: { package: 'monthly', introCents: 100 } }, /only allowed on a "winback": true price/);
  bad({ price_wbboth: { package: 'monthly', winback: true, bonusAcademyDays: 7 } }, /bonusAcademyDays is only for a membership/);
  bad({ price_wbmem: { package: 'monthly', academy: false, roles: [PREMIUM_ROLE_ID], winback: true, trialDays: 7 } }, /cannot also have trialDays/);
  bad({ price_life1: { package: 'lifetime', winback: true } }, /must be recurring/);
  bad({ price_wbmem: { package: 'monthly', academy: false, roles: [PREMIUM_ROLE_ID], winback: true, bonusAcademyDays: 31 } }, /bonusAcademyDays must be an integer 1-30/);
  bad({}, /not Discord ids/, { SML_ACADEMY_BILLING_WINBACK_IDS: `${USER},not-an-id` });

  const empty = parseBillingConfig(k.env(winbackEnv({ SML_ACADEMY_BILLING_WINBACK_IDS: '' })));
  assert.ok(empty.warnings.some((w) => /WINBACK_IDS is empty/.test(w)));
});

test('the consent text: $1 for the first month, then $15, bonus Academy days, once per account', () => {
  const desc = { key: 'monthly', winback: true, introCents: 100, bonusAcademyDays: 7, academy: false, roleNames: ['Premium Member'], label: 'Welcome Back Membership' };
  const terms = offerTerms(desc);
  assert.equal(terms.introCents, 100);
  const d = disclosureFor({ pkg: 'monthly', amount: 1500, termsUrl: 'https://t', privacyUrl: 'https://p', grants: offerGrants(desc), terms });
  assert.equal(d.kind, 'auto_renewal');
  assert.match(d.text, /costs \$1\.00 \(plus any applicable tax\) for the first month, then \$15\.00 \(plus any applicable tax\) every month, and renews automatically at \$15\.00 until you cancel/);
  assert.match(d.text, /7 days of MEM Academy/);
  assert.match(d.text, /once per Discord account/);
  assert.match(d.checkbox, /after the first month at \$1\.00, the Welcome Back Membership plan renews automatically every month at \$15\.00/);
});

test('buildCheckoutParams: the intro coupon replaces allow_promotion_codes and marks the subscription', () => {
  const params = buildCheckoutParams({ pkg: 'monthly', priceId: 'price_wbmem', amount: 1500, customerId: 'cus_1', discordId: USER,
    intent: { id: '0b9f1f64-6a3c-4d7b-9a44-1f0a2b3c4d5e', consentVersion: 'v', consentSha256: 'a'.repeat(64) },
    urls: { publicUrl: 'https://x' }, flags: { paymentMethods: ['card', 'link'] }, nowMs: T0, academy: false,
    winback: { couponId: 'mem_winback_wbmem_1500_100', cents: 100, bonusAcademyDays: 7 } });
  assert.deepEqual(params.discounts, [{ coupon: 'mem_winback_wbmem_1500_100' }]);
  assert.equal('allow_promotion_codes' in params, false);
  assert.equal(params.subscription_data.metadata.mem_academy_winback, '1');
  assert.equal(params.subscription_data.metadata.mem_academy_bonus_days, '7');
  assert.equal(params.subscription_data.metadata.mem_academy_intro_cents, '100');
  assert.match(params.custom_text.submit.message, /^\$1\.00 today for your first month, then renews every month at \$15\.00/);
  assert.throws(() => buildCheckoutParams({ pkg: 'monthly', priceId: 'p', amount: 1500, customerId: 'c', discordId: USER,
    intent: { id: 'i', consentVersion: 'v', consentSha256: 'a' }, urls: { publicUrl: 'https://x' }, flags: { paymentMethods: ['card'] }, nowMs: T0,
    trial: { days: 7 }, winback: { couponId: null, cents: null } }), /winback_not_allowed/);
});

function setup({ user = USER, fixtures = {}, env = {} } = {}) {
  const now = k.clock();
  const config = parseBillingConfig(k.env(winbackEnv(env)));
  const store = k.createFakeStore({ now });
  const stripe = k.createFakeStripe(fixtures);
  const bot = k.createFakeBot({ members: { [user]: [] } });
  const catalog = createCatalog({ config, stripeApi: stripe, now });
  const tokens = createLinkTokens({ secret: config.clientSecret, now });
  const core = createResync({ config, store, stripeApi: stripe, catalog, bot, now });
  let n = 0;
  const checkout = createCheckout({ config, store, stripeApi: stripe, catalog, bot, tokens, resync: core.resync, takeSnapshot: core.takeSnapshot,
    preflight: { ok: () => true, stripeAccountOk: () => true }, now, uuid: () => `0b9f1f64-6a3c-4d7b-9a44-${String(++n).padStart(12, '0')}` });
  const bind = tokens.readBind(tokens.issueBind({ userId: user, guildId: k.GUILD, source: 'web_oauth', purpose: 'buy' }));
  const form = async (priceId) => {
    const desc = (await catalog.get()).winback.get(priceId);
    const d = disclosureFor({ pkg: 'monthly', amount: desc.amount, termsUrl: config.termsUrl, privacyUrl: config.privacyUrl, grants: offerGrants(desc), terms: offerTerms(desc) });
    return { package: 'monthly', price: priceId, csrf: tokens.csrfFor(bind), disclosure_sha: consentSha(config.consentVersion, d.text), consent_renewal: '1' };
  };
  return { now, config, store, stripe, bot, catalog, checkout, core, bind, form };
}

test('an eligible former member: coupon for $14 off once, a Checkout with the discount, and the /buy Welcome back section', async () => {
  const t = setup();
  const result = await t.checkout.start({ bind: t.bind, form: await t.form('price_wbmem'), ipKey: 'ip' });
  assert.match(result.redirect || '', /checkout\.stripe\.com/, JSON.stringify(result));
  const [couponCall] = t.stripe.callsOf('createCoupon');
  assert.equal(couponCall.args[0].id, 'mem_winback_wbmem_1500_100');
  assert.equal(couponCall.args[0].amount_off, 1400);
  assert.equal(couponCall.args[0].duration, 'once');
  assert.deepEqual(couponCall.args[0].applies_to, { products: ['prod_wb_mem'] });
  const [sessionCall] = t.stripe.callsOf('createCheckoutSession');
  assert.deepEqual(sessionCall.args[0].discounts, [{ coupon: 'mem_winback_wbmem_1500_100' }]);
  assert.equal(sessionCall.args[0].line_items[0].price, 'price_wbmem');

  /* The coupon is reused, never recreated. */
  t.now.advance(60_000);
  await t.checkout.start({ bind: t.bind, form: await t.form('price_wbboth'), ipKey: 'ip' });
  assert.equal(t.stripe.callsOf('createCoupon').length, 2, 'one coupon per price');
  t.now.advance(60_000);
  await t.checkout.start({ bind: t.bind, form: await t.form('price_wbmem'), ipKey: 'ip' });
  assert.equal(t.stripe.callsOf('createCoupon').length, 2);

  const cat = await t.catalog.get();
  const html = buyPage({ config: t.config, nonce: 'n', userId: USER, user: null, packages: [], memberships: [], winback: [...cat.winback.values()],
    csrf: 'c', state: { winbackEligible: true } });
  assert.match(html, /Welcome back/);
  assert.match(html, /\$1\.00 for your first month, then \$15\.00\/month, plus 7 days of MEM Academy free/);
  assert.match(html, /\$1\.00 for your first month, then \$25\.00\/month/);
  const none = buyPage({ config: t.config, nonce: 'n', userId: USER, user: null, packages: [], memberships: [], winback: [...cat.winback.values()],
    csrf: 'c', state: { winbackEligible: false } });
  assert.doesNotMatch(none, /Welcome back/);
});

test('someone not on the list is refused (403) and nothing is written to Stripe', async () => {
  const t = setup({ user: OTHER });
  const result = await t.checkout.start({ bind: t.bind, form: await t.form('price_wbmem'), ipKey: 'ip' });
  assert.deepEqual(result, { status: 403, error: 'winback_not_eligible' });
  assert.equal(t.stripe.writes().length, 0);
});

test('once per account: any earlier win-back subscription (even canceled) refuses a second one', async () => {
  const t = setup({ fixtures: { customers: { cus_a: k.academyCustomer('cus_a', USER) },
    subscriptions: [k.subscription({ id: 'sub_old', customer: 'cus_a', status: 'canceled', price: 'price_wbmem',
      metadata: { sml_kind: 'mem_academy', mem_academy_discord_user: USER, mem_academy_winback: '1' } })] } });
  await t.store.withUserTx(USER, (c) => t.store.ensureMember(c, { discordId: USER, boundVia: 'web_oauth' }));
  await t.store.withUserTx(USER, (c) => t.store.setMemberCustomer(c, { discordId: USER, customerId: 'cus_a', accountId: k.ACCOUNT }));
  const view = await t.checkout.readAccess(USER);
  assert.equal(view.winbackUsed, true);
  assert.equal(view.winbackEligible, false);
  const result = await t.checkout.start({ bind: t.bind, form: await t.form('price_wbmem'), ipKey: 'ip' });
  assert.deepEqual(result, { status: 409, error: 'winback_used' });
  assert.equal(t.stripe.callsOf('createCheckoutSession').length, 0);
});

test('the bonus: an active win-back membership adds 7 days of the Academy once, ending 7 days after it started', async () => {
  const started = S(T0) - 3600;
  const t = setup({ fixtures: { customers: { cus_a: k.academyCustomer('cus_a', USER) },
    subscriptions: [k.subscription({ id: 'sub_wb', customer: 'cus_a', status: 'active', price: 'price_wbmem', created: started,
      metadata: { sml_kind: 'mem_academy', mem_academy_discord_user: USER, mem_academy_winback: '1', mem_academy_bonus_days: '7' } })] } });
  await t.store.withUserTx(USER, (c) => t.store.ensureMember(c, { discordId: USER, boundVia: 'web_oauth' }));
  await t.store.withUserTx(USER, (c) => t.store.setMemberCustomer(c, { discordId: USER, customerId: 'cus_a', accountId: k.ACCOUNT }));
  await t.core.resync(USER, { actor: 'resync' });
  const comps = t.store.db.comps.filter((c) => c.discord_user_id === USER);
  assert.equal(comps.length, 1);
  assert.equal(comps[0].reason, 'winback_bonus:sub_wb');
  assert.equal(comps[0].grants_academy, true);
  assert.equal(new Date(comps[0].expires_at).getTime(), started * 1000 + 7 * 86_400_000);
  assert.ok(k.actions(t.store).includes('comp_granted'));
  const member = t.store.db.members.get(`${USER}|false`);
  assert.ok(member.last_access.roles.includes('academy'), JSON.stringify(member.last_access));

  /* resync again, and after staff revoke it: never granted twice */
  await t.core.resync(USER, { actor: 'resync' });
  await t.store.revokeComp(null, { id: comps[0].id, revokedBy: 'staff' });
  t.now.advance(60_000);
  await t.core.resync(USER, { actor: 'resync' });
  assert.equal(t.store.db.comps.filter((c) => c.discord_user_id === USER).length, 1);
});
