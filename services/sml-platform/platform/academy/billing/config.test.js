'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseBillingConfig, describeConfig, DEFAULT_PROTECTED_ROLE_IDS, DEFAULT_EXTERNAL_ROLE_IDS, PRICE_ENTRY_KEYS } = require('./config');
const { env, GUILD, MONARCH, PREMIUM, ELITE, FREE_TRIAL, FREE_MEMBER, ACADEMY_ROLE, LIFETIME_ROLE, ownerEnv, pricesJson } = require('./testkit');

test('an empty env gives an engine that does nothing', () => {
  const config = parseBillingConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.reason, 'disabled');
  assert.equal(config.checkoutEnabled, false);
  assert.equal(config.roleMode, 'off');
  assert.equal(config.reconcileMode, 'off');
  assert.equal(config.revokesEnabled, false);
  assert.equal(config.inDiscordLinks, false);
  assert.equal(config.allowNonMember, false);
  assert.equal(config.autoJoin, false);
  assert.equal(config.cancelOnRefund, false);
  assert.equal(config.partialRefundRevokes, false);
  assert.equal(config.tosConsent, false);
  assert.equal(config.automaticTax, false);
  assert.deepEqual(config.paymentMethods, ['card', 'link']);
  assert.equal(config.maxRevokesPerRun, 10);
  assert.equal(config.reconcileIntervalMs, 900000);
});

test('flags are on only for exactly "1"', () => {
  for (const value of ['true', 'yes', 'on', ' 2', '01']) {
    const config = parseBillingConfig({ SML_ACADEMY_BILLING_ENABLED: value });
    assert.equal(config.requested, false, value);
  }
  assert.equal(parseBillingConfig({ SML_ACADEMY_BILLING_ENABLED: ' 1 ' }, { throwOnInvalid: false }).requested, true);
});

test('a complete test-mode env is enabled', () => {
  const config = parseBillingConfig(env());
  assert.equal(config.enabled, true);
  assert.equal(config.checkoutEnabled, true);
  assert.equal(config.livemode, false);
  assert.equal(config.prices.size, 8);
  assert.equal(config.prices.get('price_daily1').graceHours, 2);
  assert.equal(config.prices.get('price_weekly1').graceHours, 12);
  assert.equal(config.prices.get('price_monthly1').graceHours, 72);
  assert.equal(config.prices.get('price_quarter1').graceHours, 72);
  assert.equal(config.prices.get('price_monthold').sell, false);
});

test('ENABLED with a missing secret or key throws', () => {
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_WEBHOOK_SECRET: '' })), /WEBHOOK_SECRET is required/);
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_STRIPE_KEY: '' })), /STRIPE_KEY is required/);
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BOT_TOKEN: '' })), /BOT_TOKEN is required/);
  const soft = parseBillingConfig(env({ SML_ACADEMY_BILLING_STRIPE_KEY: '' }), { throwOnInvalid: false });
  assert.equal(soft.enabled, false);
  assert.equal(soft.reason, 'invalid_config');
});

test('a protected role can never be an engine role', () => {
  for (const id of [MONARCH, PREMIUM, ...DEFAULT_PROTECTED_ROLE_IDS]) {
    assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_ACADEMY_ROLE_ID: id })), /protected role/);
    assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_LIFETIME_ROLE_ID: id })), /protected role/);
  }
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_MANAGER_ROLE_ID: ACADEMY_ROLE })), /protected role/);
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_PROTECTED_ROLE_IDS: LIFETIME_ROLE })), /protected role/);
});

test('the env protected list only adds to the defaults', () => {
  const config = parseBillingConfig(env({ SML_ACADEMY_BILLING_PROTECTED_ROLE_IDS: '1800000000000000001' }));
  for (const id of DEFAULT_PROTECTED_ROLE_IDS) assert.ok(config.protectedRoleIds.has(id));
  assert.ok(config.protectedRoleIds.has('1800000000000000001'));
});

test('the two engine roles must differ', () => {
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_LIFETIME_ROLE_ID: ACADEMY_ROLE })), /must be different/);
});

test('a billing guild that differs from SML_ACADEMY_GUILD_ID disables the engine', () => {
  const config = parseBillingConfig(env({ SML_ACADEMY_GUILD_ID: '938894329076940821' }));
  assert.equal(config.enabled, false);
  assert.equal(config.reason, 'guild_mismatch');
  assert.equal(config.checkoutEnabled, false);
  assert.equal(parseBillingConfig(env()).guildId, GUILD);
});

test('two sell:true prices for one package are rejected; a retired one is fine', () => {
  const prices = JSON.stringify({ price_monthlyA1: { package: 'monthly' }, price_monthlyB1: { package: 'monthly', sell: true } });
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: prices })), /two sell:true prices/);
  const ok = JSON.stringify({ price_monthlyA1: { package: 'monthly' }, price_monthlyB1: { package: 'monthly', sell: false } });
  assert.equal(parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: ok })).prices.size, 2);
  const repriced = JSON.stringify({ price_lifenew1: { package: 'lifetime', sell: true }, price_lifeold1: { package: 'lifetime', sell: false } });
  assert.equal(parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: repriced })).prices.get('price_lifenew1').sell, true);
});

test('graceHours must be an integer 0-168; unknown packages are rejected', () => {
  const bad = (entry) => JSON.stringify({ price_monthly1: entry });
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: bad({ package: 'monthly', graceHours: 169 }) })), /graceHours/);
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: bad({ package: 'monthly', graceHours: -1 }) })), /graceHours/);
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: bad({ package: 'monthly', graceHours: 1.5 }) })), /graceHours/);
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: bad({ package: 'biweekly' }) })), /package must be/);
  assert.equal(parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: bad({ package: 'monthly', graceHours: 0 }) })).prices.get('price_monthly1').graceHours, 0);
  assert.equal(parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: bad({ package: 'monthly', graceHours: 168 }) })).prices.get('price_monthly1').graceHours, 168);
});

test('the key, livemode and webhook secret must be consistent', () => {
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_LIVEMODE: '1' })), /LIVEMODE does not match/);
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_STRIPE_KEY: 'pk_test_abc' })), /restricted key/);
  assert.throws(() => parseBillingConfig(env({ SML_STRIPE_WEBHOOK_SECRET: 'whsec_other,whsec_academytestsecret' })), /NEW Academy endpoint/);
  const rotation = parseBillingConfig(env({ SML_ACADEMY_BILLING_WEBHOOK_SECRET: 'whsec_old1,whsec_new2' }));
  assert.deepEqual(rotation.webhookSecrets, ['whsec_old1', 'whsec_new2']);
  const sk = parseBillingConfig(env({ SML_ACADEMY_BILLING_STRIPE_KEY: 'sk_test_full' }));
  assert.equal(sk.stripeKeyKind, 'secret');
  assert.ok(sk.warnings.some((w) => /restricted/.test(w)));
});

test('PUBLIC_URL must be https; the shared default portal is refused', () => {
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_PUBLIC_URL: 'http://example.com' })), /https/);
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_PORTAL_CONFIG_ID: 'bpc_1R7qIyABCDEF' })), /default portal/);
});

test('checkout needs a consent version; async payment methods are refused', () => {
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_CONSENT_VERSION: '' })), /CONSENT_VERSION/);
  assert.equal(parseBillingConfig(env({ SML_ACADEMY_BILLING_CONSENT_VERSION: '', SML_ACADEMY_BILLING_CHECKOUT_ENABLED: '0' })).enabled, true);
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_PAYMENT_METHODS: 'card,us_bank_account' })), /instant/);
});

test('the test clock is refused in live mode', () => {
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_TEST_CLOCK: '1', SML_ACADEMY_BILLING_LIVEMODE: '1', SML_ACADEMY_BILLING_STRIPE_KEY: 'rk_live_abc' })), /test-mode only/);
  assert.equal(parseBillingConfig(env({ SML_ACADEMY_BILLING_TEST_CLOCK: '1' })).testClock, true);
});

test('modes accept only their listed values', () => {
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_ROLE_MODE: 'on' })), /ROLE_MODE/);
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_RECONCILE_MODE: 'yes' })), /RECONCILE_MODE/);
  assert.equal(parseBillingConfig(env({ SML_ACADEMY_BILLING_RECONCILE_MODE: 'dry_run' })).reconcileMode, 'dry_run');
});

test('ACCESS_ROLE_IDS parses as a CSV of snowflakes', () => {
  const config = parseBillingConfig({ SML_ACADEMY_ACCESS_ROLE_IDS: ` ${ACADEMY_ROLE}, ${LIFETIME_ROLE},not-a-role,, ` });
  assert.deepEqual(config.accessRoleIds, [ACADEMY_ROLE, LIFETIME_ROLE]);
  assert.deepEqual(parseBillingConfig({}).accessRoleIds, []);
});

test("MONARCH_ACCESS: '1' or unset keeps Monarch, only '0' drops it", () => {
  assert.equal(parseBillingConfig({}).monarchAccess, true);
  assert.equal(parseBillingConfig({ SML_ACADEMY_MONARCH_ACCESS: '1' }).monarchAccess, true);
  assert.equal(parseBillingConfig({ SML_ACADEMY_MONARCH_ACCESS: '' }).monarchAccess, true);
  assert.equal(parseBillingConfig({ SML_ACADEMY_MONARCH_ACCESS: '0' }).monarchAccess, false);
});

test('checkout opens only while ROLE_MODE=enforce (a buyer never pays without a queued role)', () => {
  const live = env({ SML_ACADEMY_BILLING_LIVEMODE: '1', SML_ACADEMY_BILLING_STRIPE_KEY: 'rk_live_academykey', SML_ACADEMY_BILLING_ROLE_MODE: 'dry_run' });
  const config = parseBillingConfig(live);
  assert.equal(config.enabled, true);
  assert.equal(config.checkoutRequested, true);
  assert.equal(config.checkoutEnabled, false, 'CHECKOUT_ENABLED=1 with ROLE_MODE=dry_run would sell without queueing a role');
  assert.ok(config.warnings.some((w) => /has no effect until SML_ACADEMY_BILLING_ROLE_MODE=enforce/.test(w)));
  for (const roleMode of ['off', 'dry_run']) {
    assert.equal(parseBillingConfig(env({ SML_ACADEMY_BILLING_ROLE_MODE: roleMode })).checkoutEnabled, false, roleMode);
  }
  assert.equal(parseBillingConfig(env({ SML_ACADEMY_BILLING_ROLE_MODE: 'enforce' })).checkoutEnabled, true);
});

test('PROXY_HOPS defaults to 1 and is bounded', () => {
  assert.equal(parseBillingConfig(env()).proxyHops, 1);
  assert.equal(parseBillingConfig(env({ SML_ACADEMY_BILLING_PROXY_HOPS: '2' })).proxyHops, 2);
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_PROXY_HOPS: '0' })), /PROXY_HOPS/);
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_PROXY_HOPS: '9' })), /PROXY_HOPS/);
});

/* ---------------------------------------------------------------------------
 * Per-price payment methods ("paymentMethods" in PRICES_JSON).
 * ------------------------------------------------------------------------ */

const withPrices = (map, extra = {}) => env({ SML_ACADEMY_BILLING_PRICES_JSON: JSON.stringify(map), ...extra });

test('a price may list its own payment methods; the others fall back to SML_ACADEMY_BILLING_PAYMENT_METHODS', () => {
  const config = parseBillingConfig(withPrices({
    price_monthly1: { package: 'monthly' },
    price_life1: { package: 'lifetime', paymentMethods: ['card', 'us_bank_account'] }
  }));
  assert.deepEqual(config.prices.get('price_life1').paymentMethods, ['card', 'us_bank_account']);
  assert.equal(config.prices.get('price_life1').ownPaymentMethods, true);
  assert.deepEqual(config.prices.get('price_monthly1').paymentMethods, ['card', 'link']);
  assert.equal(config.prices.get('price_monthly1').ownPaymentMethods, false);
  assert.ok(Object.isFrozen(config.prices.get('price_life1').paymentMethods));
  const cardOnly = parseBillingConfig(withPrices({ price_monthly1: { package: 'monthly' } }, { SML_ACADEMY_BILLING_PAYMENT_METHODS: 'card' }));
  assert.deepEqual(cardOnly.prices.get('price_monthly1').paymentMethods, ['card']);
  assert.deepEqual(describeConfig(config).prices.find((p) => p.priceId === 'price_life1').paymentMethods, ['card', 'us_bank_account']);
});

test('per-price payment methods: unknown, empty, repeated or non-list values are refused at config load', () => {
  const bad = (paymentMethods) => withPrices({ price_life1: { package: 'lifetime', paymentMethods } });
  for (const value of [['card', 'paypal'], ['cashapp'], ['sepa_debit'], [], 'card', ['card', 'card'], [42], null]) {
    assert.throws(() => parseBillingConfig(bad(value)), /paymentMethods|not allowed|listed twice/, JSON.stringify(value));
  }
  const soft = parseBillingConfig(bad(['card', 'klarna']), { throwOnInvalid: false });
  assert.equal(soft.enabled, false);
  assert.ok(soft.errors.some((e) => e.includes('price_life1') && e.includes('"klarna"') && e.includes('card, link, us_bank_account')));
});

test('us_bank_account (a delayed bank debit) is refused on every recurring package', () => {
  for (const pkg of ['daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'yearly']) {
    assert.throws(() => parseBillingConfig(withPrices({ price_x1: { package: pkg, paymentMethods: ['card', 'us_bank_account'] } })),
      /only allowed on a one-time lifetime price/, pkg);
  }
  assert.equal(parseBillingConfig(withPrices({ price_x1: { package: 'lifetime', paymentMethods: ['us_bank_account'] } })).enabled, true);
  /* and never through the global default, which also covers the plans */
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_PAYMENT_METHODS: 'card,us_bank_account' })), /lifetime price's own "paymentMethods"/);
});

test('the PRICES_JSON examples in README.md and LAUNCH.md are valid, identical and match the owner product list (2026-09-26)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const pages = require('./pages');
  const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
  const launch = fs.readFileSync(path.join(__dirname, 'LAUNCH.md'), 'utf8').replace(/\r\n/g, '\n');
  const examples = [
    ['README.md', /```json\n([\s\S]*?)\n```/.exec(readme)],
    ['LAUNCH.md', /`(\{"price_DAY"[^`]*\})`/.exec(launch)]
  ];
  const parsed = [];
  for (const [file, match] of examples) {
    assert.ok(match, `${file} has a PRICES_JSON example`);
    const map = JSON.parse(match[1]);
    parsed.push(JSON.stringify(map));
    /* the placeholders are Stripe-shaped ids: the example parses exactly as pasted, with no MEM Lifetime role */
    const config = parseBillingConfig(env({ SML_ACADEMY_BILLING_LIFETIME_ROLE_ID: '', SML_ACADEMY_BILLING_PRICES_JSON: JSON.stringify(map) }));
    assert.equal(config.enabled, true, `${file}: ${config.errors.join('; ')}`);
    assert.equal(config.prices.size, 12, `${file}: the seven Academy packages and the five store memberships`);
    const academy = [...config.prices.values()].filter((entry) => entry.academy);
    const byPackage = Object.fromEntries(academy.map((entry) => [entry.package, entry]));
    assert.equal(academy.length, 7, `${file}: one Academy entry per package, no second lifetime price`);
    assert.deepEqual(Object.keys(byPackage).sort(), ['daily', 'lifetime', 'monthly', 'quarterly', 'semiannual', 'weekly', 'yearly'], file);
    assert.deepEqual(byPackage.lifetime.paymentMethods, ['card', 'us_bank_account'], file);
    assert.deepEqual(byPackage.lifetime.roles, [MONARCH], `${file}: the Academy Lifetime also grants Monarch ONLY (never Elite, owner correction 2026-09-26)`);
    for (const pkg of ['daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'yearly']) {
      assert.deepEqual(byPackage[pkg].paymentMethods, ['card', 'link'], `${file} ${pkg}`);
      assert.deepEqual([byPackage[pkg].roles, byPackage[pkg].trialDays], [[], null], `${file} ${pkg}: the Discord access rides on Academy Student`);
      assert.equal(byPackage[pkg].cancelAfterDays, pkg === 'daily' ? 3 : null, `${file} ${pkg}`);
    }
    const members = Object.fromEntries([...config.prices.values()].filter((entry) => !entry.academy)
      .map((entry) => [entry.priceId, [entry.package, entry.roles, entry.trialDays, entry.trialNoCard, entry.cancelAfterDays, entry.paymentMethods]]));
    assert.deepEqual(members, {
      price_ELITELIFE: ['lifetime', [MONARCH, ELITE], null, false, null, ['card', 'link']],
      price_ELITEYEAR: ['yearly', [ELITE], 7, false, null, ['card', 'link']],
      price_ELITEMONTH: ['monthly', [ELITE], 7, false, null, ['card', 'link']],
      price_ELITEWEEK: ['weekly', [ELITE], 7, false, null, ['card', 'link']],
      price_FREETRIAL: ['daily', [ELITE], 3, true, 3, ['card', 'link']]
    }, file);
  }
  assert.equal(parsed[0], parsed[1], 'README.md and LAUNCH.md carry the same PRICES_JSON');
  /* the /buy trial lines the docs promise are the ones the page renders */
  const monthly = pages.trialLine('monthly', 8990, 'usd', pages.offerTerms({ key: 'monthly', trialDays: 7 }));
  assert.equal(monthly, '7-day free trial, then $89.90/month; one free trial per Discord account');
  const free = pages.trialLine('daily', 790, 'usd', pages.offerTerms({ key: 'daily', trialDays: 3, trialNoCard: true, cancelAfterDays: 3 }));
  assert.equal(free, '3 days free, no card needed, stops by itself');
  assert.ok(readme.includes(monthly), 'README.md shows the Elite Monthly trial line');
  for (const [file, text] of [['README.md', readme], ['LAUNCH.md', launch]]) {
    assert.ok(text.includes(free), `${file} shows the Free Trial Access line`);
    /* owner decision 2026-09-26 ("3 DAY"): Free Trial Access is a plain 3-day trial, so Stripe's own page says 3 days too */
    const flat = text.replace(/\s+/g, ' ');
    assert.ok(flat.includes('3 days free, then $7.90 per day'), `${file}: what Stripe's Checkout shows for Free Trial Access`);
    assert.ok(flat.includes('10 minutes before'), `${file}: the engine stops Free Trial Access before its trial ends`);
    assert.equal(/7 days free, then \$7\.90|7-day trial without a card|7 days, no card/.test(flat), false, `${file} still describes the old 7-day Free Trial Access`);
    assert.ok(text.includes(pages.TRIAL_USED_NOTE.slice(0, 50)), `${file} shows the used-trial note`);
    /* Free Trial Access is only ever a free trial: never sold as the paid daily plan, and its safety net is documented */
    assert.ok(flat.includes(pages.FREE_TRIAL_USED_NOTE), `${file} shows the Free Trial Access used-trial note`);
    assert.equal(/\$23\.70|Free Trial Access without the trial is the/.test(flat), false, `${file} still sells Free Trial Access as a paid plan`);
    for (const event of ['academy_billing_free_trial_stop_missed', 'academy_billing_free_trial_charged', 'academy_billing_free_trial_stop_failed']) {
      assert.ok(text.includes(event), `${file} names the ${event} alert`);
    }
    for (const price of ['$11.00', '$40.00', '$120.00', '$300.00', '$540.00', '$960.00', '$9,200.00', '$7,490.90', '$849.90', '$89.90', '$34.90', '$7.90']) {
      assert.ok(text.includes(price), `${file} lists ${price}`);
    }
    for (const name of ['Elite Lifetime Access', 'Elite Yearly Access', 'Elite Monthly Access', 'Elite Week Seat', 'Free Trial Access']) assert.ok(text.includes(name), `${file}: ${name}`);
    /* owner correction 2026-09-26: the Academy Lifetime ($9,200) gives Monarch, never Elite */
    assert.equal(/Academy \+ Discord paid access \+ \**Monarch\** \+ \**Elite/.test(text), false, `${file}: the Academy Lifetime row never lists Elite`);
    assert.equal(/Lifetime (also )?(grants|includes) (the )?Monarch and Elite/.test(text), false, `${file}: no "Lifetime grants Monarch and Elite"`);
    assert.equal(/Founders|\$999\.99|\$1,299\.99|\$10,000|\$2\.99\b|\$29\.99|\$79\.99|\$149\.99|\$199\.99/.test(text), false, `${file} still mentions a dropped price`);
    for (const phrase of ['Premium-level channel access', 'Create Instant Invite', 'guilds.join', 'UPGRADE_CHAT_CLIENT_ID', 'SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON',
      'SML_ACADEMY_BILLING_UC_MATCH', 'position 17', 'external-review', 'Ban Members', 'released', 'external-review --keep', 'revokeUnfinished',
      'sml_kind', 'tax_behavior=exclusive', 'trialNoCard', 'cancelAfterDays', 'one free trial per Discord account']) {
      assert.ok(text.toLowerCase().includes(phrase.toLowerCase()), `${file} explains ${phrase}`);
    }
    assert.ok(/Lifetime-specific payment method\s+configuration/.test(text), `${file}: ACH only in a Lifetime-specific payment method configuration`);
    assert.ok(/leave\s+`?SML_ACADEMY_BILLING_LIFETIME_ROLE_ID`?\s+unset/i.test(text) || text.includes('**leave unset**'), `${file}: the lifetime role stays unset`);
    for (const event of ['checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'charge.failed', 'payment_intent.payment_failed', 'charge.dispute.closed']) {
      assert.ok(text.includes(`\`${event}\``), `${file} subscribes ${event}`);
    }
  }
  /* the Upgrade.Chat store products, with their uuids for reference */
  for (const uuid of ['cf67da72-e309-4db5-bbf8-13e7f42ba02e', 'bf0eb1e8-c034-4eaa-b8f7-3633bdbff989', '5afb4ebb-fb6c-428a-982e-b38b06b2363a',
    'a5749691-20f6-4cda-8554-d1e94a1ff80c', '43012a04-dbf2-4919-af73-b265eb04cb7a']) assert.ok(readme.includes(uuid), uuid);
});

test('an unknown key in a PRICES_JSON entry is refused, so a typo never silently drops paymentMethods', () => {
  for (const key of ['payment_methods', 'paymentMethod', 'methods', 'sel']) {
    const prices = JSON.stringify({ price_life1: { package: 'lifetime', [key]: ['card', 'us_bank_account'] } });
    assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: prices })), new RegExp(`price_life1: unknown key "${key}"`), key);
  }
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: JSON.stringify({ price_life1: ['lifetime'] }) })), /price_life1: entry must be an object/);
  /* the four documented keys stay accepted */
  const ok = JSON.stringify({ price_life1: { package: 'lifetime', sell: true, graceHours: 0, paymentMethods: ['card', 'us_bank_account'] } });
  assert.deepEqual(parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: ok })).prices.get('price_life1').paymentMethods, ['card', 'us_bank_account']);
});

/* ---------------------------------------------------------------------------
 * Per-price roles, academy:false memberships, external roles, Upgrade.Chat.
 * ------------------------------------------------------------------------ */

test('the lifetime role is optional (owner decision: Lifetime grants Monarch instead)', () => {
  const config = parseBillingConfig(env({ SML_ACADEMY_BILLING_LIFETIME_ROLE_ID: '' }));
  assert.equal(config.enabled, true);
  assert.equal(config.lifetimeRoleId, '');
  assert.deepEqual(config.engineRoleIds, { academy: ACADEMY_ROLE, mem_lifetime: '' });
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_ACADEMY_ROLE_ID: '' })), /ACADEMY_ROLE_ID is required/);
});

test('"roles" and "academy" (plus the trial and auto-stop keys) are the only new PRICES_JSON keys; defaults are academy:true and no roles', () => {
  assert.deepEqual(PRICE_ENTRY_KEYS, ['package', 'sell', 'graceHours', 'paymentMethods', 'roles', 'academy', 'trialDays', 'trialNoCard', 'cancelAfterDays',
    'winback', 'introCents', 'bonusAcademyDays', 'promotionCode']);
  const config = parseBillingConfig(env());
  for (const entry of config.prices.values()) {
    assert.equal(entry.academy, true, entry.priceId);
    assert.deepEqual(entry.roles, []);
    assert.equal(entry.line, 'academy');
  }
  for (const key of ['role', 'roleIds', 'Roles', 'academyRole']) {
    const prices = JSON.stringify({ price_life1: { package: 'lifetime', [key]: [MONARCH] } });
    assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: prices })), new RegExp(`unknown key "${key}"`), key);
  }
});

test('the owner set-up: lifetime roles [Monarch] with card + bank; a Premium membership without the Academy', () => {
  const config = parseBillingConfig(env(ownerEnv()));
  assert.equal(config.enabled, true, config.errors.join('; '));
  const life = config.prices.get('price_life1');
  assert.deepEqual([life.academy, life.roles, life.paymentMethods], [true, [MONARCH], ['card', 'us_bank_account']]);
  const premium = config.prices.get('price_premium1');
  assert.deepEqual([premium.academy, premium.roles, premium.line], [false, [PREMIUM], `roles:${PREMIUM}`]);
  assert.ok(Object.isFrozen(life.roles));
  const described = describeConfig(config);
  assert.deepEqual(described.prices.find((p) => p.priceId === 'price_life1').roles, [MONARCH]);
  assert.deepEqual(described.externalRoleIds, DEFAULT_EXTERNAL_ROLE_IDS);
  assert.equal(described.ucConfigured, true);
  assert.equal(JSON.stringify(described).includes('uc-secret'), false, 'the Upgrade.Chat secret is never described');
});

test('Manager, Free Trial and FREE MEMBER can never be listed in "roles"; nor an engine role or a non-external role', () => {
  const withRoles = (roles, extra = {}) => env({ SML_ACADEMY_BILLING_PRICES_JSON: JSON.stringify({ price_life1: { package: 'lifetime', roles } }), ...extra });
  for (const id of [FREE_TRIAL, FREE_MEMBER]) assert.throws(() => parseBillingConfig(withRoles([id])), /can never be granted/, id);
  const manager = '1800000000000000009';
  assert.throws(() => parseBillingConfig(withRoles([manager], { SML_ACADEMY_MANAGER_ROLE_ID: manager })), /can never be granted/);
  assert.throws(() => parseBillingConfig(withRoles(['1800000000000000008'], { SML_ACADEMY_BILLING_PROTECTED_ROLE_IDS: '1800000000000000008' })), /can never be granted/);
  assert.throws(() => parseBillingConfig(withRoles([ACADEMY_ROLE])), /engine role/);
  assert.throws(() => parseBillingConfig(withRoles([LIFETIME_ROLE])), /engine role/);
  assert.throws(() => parseBillingConfig(withRoles(['1800000000000000007'])), /not an external role; add it to SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS/);
  for (const bad of ['1260433215189946420', [42], ['abc'], [MONARCH, MONARCH], Array.from({ length: 11 }, (_, i) => `18000000000000001${String(i).padStart(2, '0')}`)]) {
    assert.throws(() => parseBillingConfig(withRoles(bad)), /roles|role/, JSON.stringify(bad));
  }
  /* Monarch, Elite and Premium are fine as external roles */
  assert.deepEqual(parseBillingConfig(withRoles([MONARCH, ELITE, PREMIUM])).prices.get('price_life1').roles, [MONARCH, ELITE, PREMIUM]);
});

test('"academy" must be a boolean, and academy:false needs at least one role', () => {
  const entry = (value) => env({ SML_ACADEMY_BILLING_PRICES_JSON: JSON.stringify({ price_prem1: { package: 'monthly', ...value } }) });
  assert.throws(() => parseBillingConfig(entry({ academy: 'false', roles: [PREMIUM] })), /academy must be true or false/);
  assert.throws(() => parseBillingConfig(entry({ academy: false })), /grants nothing/);
  assert.throws(() => parseBillingConfig(entry({ academy: false, roles: [] })), /grants nothing/);
  assert.equal(parseBillingConfig(entry({ academy: false, roles: [PREMIUM] })).prices.get('price_prem1').academy, false);
});

test('one sell:true price per package PER LINE: Academy Monthly and a Premium Monthly membership can both be on sale', () => {
  const both = JSON.stringify({ price_acad1: { package: 'monthly' }, price_prem1: { package: 'monthly', academy: false, roles: [PREMIUM] },
    price_elite1: { package: 'monthly', academy: false, roles: [ELITE] } });
  assert.equal(parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: both })).prices.size, 3);
  const twoPremium = JSON.stringify({ price_prem1: { package: 'monthly', academy: false, roles: [PREMIUM] }, price_prem2: { package: 'monthly', academy: false, roles: [PREMIUM] } });
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: twoPremium })), /two sell:true prices for package monthly in the membership line/);
  /* an Academy lifetime with Monarch is still the Academy line: one Lifetime on sale */
  const twoLifetimes = JSON.stringify({ price_life1: { package: 'lifetime', roles: [MONARCH] }, price_life2: { package: 'lifetime' } });
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: twoLifetimes })), /two sell:true prices for package lifetime \(/);
});

test('SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS: default Monarch, Elite, Premium; a replacement list is validated', () => {
  assert.deepEqual(parseBillingConfig(env()).externalRoleIds, [MONARCH, ELITE, PREMIUM]);
  assert.deepEqual(parseBillingConfig(env({ SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS: ' ' })).externalRoleIds, [MONARCH, ELITE, PREMIUM]);
  assert.deepEqual(parseBillingConfig(env({ SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS: `${MONARCH}` })).externalRoleIds, [MONARCH]);
  for (const id of [FREE_TRIAL, FREE_MEMBER, ACADEMY_ROLE, LIFETIME_ROLE, 'nope']) {
    assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS: `${MONARCH},${id}` })), /EXTERNAL_ROLE_IDS/, id);
  }
  /* a price may only list roles of the (replaced) list */
  const prices = pricesJson({ price_life1: { roles: [PREMIUM] } });
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS: MONARCH, SML_ACADEMY_BILLING_PRICES_JSON: prices })), /not an external role/);
});

test('Upgrade.Chat: the platform credentials and SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON, strictly validated', () => {
  const uc = parseBillingConfig(env(ownerEnv()));
  assert.equal(uc.ucConfigured, true);
  assert.deepEqual([...uc.ucRoleProducts.keys()].sort(), [MONARCH, ELITE, PREMIUM].sort());
  assert.deepEqual(uc.ucRoleProducts.get(ELITE), []);
  const none = parseBillingConfig(env(ownerEnv({ uc: false })));
  assert.equal(none.ucConfigured, false);
  assert.ok(none.warnings.some((w) => /never removed automatically/.test(w)), 'no Upgrade.Chat: warned, not refused');
  const only = (json) => env({ ...ownerEnv(), SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON: json });
  assert.throws(() => parseBillingConfig(only('{')), /UC_ROLE_PRODUCTS_JSON is not valid JSON/);
  assert.throws(() => parseBillingConfig(only('[]')), /object keyed by role id/);
  assert.throws(() => parseBillingConfig(only(JSON.stringify({ [FREE_TRIAL]: [] }))), /not in SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS/);
  assert.throws(() => parseBillingConfig(only(JSON.stringify({ [MONARCH]: 'uuid' }))), /list of at most 20/);
  assert.throws(() => parseBillingConfig(only(JSON.stringify({ [MONARCH]: ['../etc'] }))), /invalid or repeated/);
  assert.throws(() => parseBillingConfig(only(JSON.stringify({ [MONARCH]: ['a', 'a'] }))), /invalid or repeated/);
  const unmapped = parseBillingConfig(only(JSON.stringify({ [PREMIUM]: ['p1'] })));
  assert.ok(unmapped.warnings.some((w) => w.includes(`external role ${MONARCH} has no entry`)));
});

test('ALLOW_NON_MEMBER / AUTO_JOIN without an invite URL is warned, not refused', () => {
  const bare = parseBillingConfig(env({ SML_ACADEMY_BILLING_ALLOW_NON_MEMBER: '1', SML_ACADEMY_BILLING_INVITE_URL: '' }));
  assert.equal(bare.enabled, true);
  assert.ok(bare.warnings.some((w) => /INVITE_URL is not set/.test(w)));
  assert.equal(describeConfig(bare).inviteConfigured, false);
  const withInvite = parseBillingConfig(env({ SML_ACADEMY_BILLING_ALLOW_NON_MEMBER: '1', SML_ACADEMY_BILLING_AUTO_JOIN: '1' }));
  assert.deepEqual([withInvite.allowNonMember, withInvite.autoJoin, describeConfig(withInvite).inviteConfigured], [true, true, true]);
  assert.equal(withInvite.warnings.some((w) => /INVITE_URL/.test(w)), false);
});

test('SML_ACADEMY_BILLING_PAYMENT_METHODS that lists nothing or repeats a method is refused; blank means card,link', () => {
  for (const value of [',', ' , ']) {
    assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_PAYMENT_METHODS: value })), /SML_ACADEMY_BILLING_PAYMENT_METHODS must list at least one/, JSON.stringify(value));
  }
  assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_PAYMENT_METHODS: 'card,link,card' })), /card is listed twice/);
  const blank = parseBillingConfig(env({ SML_ACADEMY_BILLING_PAYMENT_METHODS: ' ' }));
  assert.deepEqual(blank.paymentMethods, ['card', 'link']);
  assert.deepEqual(blank.prices.get('price_weekly1').paymentMethods, ['card', 'link']);
});

/* ---------------------------------------------------------------------------
 * Free trials, auto-stop and the Upgrade.Chat keep rule (owner request
 * 2026-09-26: the Making Easy Money store products).
 * ------------------------------------------------------------------------ */

test('trialDays / trialNoCard / cancelAfterDays: integers in range, recurring prices only, trialNoCard needs trialDays', () => {
  const one = (entry) => env({ SML_ACADEMY_BILLING_PRICES_JSON: JSON.stringify({ price_x1: { package: 'monthly', ...entry } }) });
  const ok = parseBillingConfig(one({ trialDays: 7, trialNoCard: true, cancelAfterDays: 3 })).prices.get('price_x1');
  assert.deepEqual([ok.trialDays, ok.trialNoCard, ok.cancelAfterDays], [7, true, 3]);
  const bare = parseBillingConfig(one({})).prices.get('price_x1');
  assert.deepEqual([bare.trialDays, bare.trialNoCard, bare.cancelAfterDays], [null, false, null]);
  for (const [entry, message] of [
    [{ trialDays: 0 }, /trialDays must be an integer 1-30/], [{ trialDays: 31 }, /trialDays must be an integer 1-30/],
    [{ trialDays: 7.5 }, /trialDays must be an integer 1-30/], [{ trialDays: '7' }, /trialDays must be an integer 1-30/],
    [{ cancelAfterDays: 0 }, /cancelAfterDays must be an integer 1-365/], [{ cancelAfterDays: 366 }, /cancelAfterDays must be an integer 1-365/],
    [{ trialNoCard: 'yes', trialDays: 7 }, /trialNoCard must be true or false/], [{ trialNoCard: true }, /trialNoCard needs trialDays/],
    [{ trial_days: 7 }, /unknown key "trial_days"/]
  ]) assert.throws(() => parseBillingConfig(one(entry)), message, JSON.stringify(entry));
  for (const entry of [{ trialDays: 7 }, { cancelAfterDays: 3 }, { trialNoCard: false, trialDays: 3 }]) {
    const lifetime = env({ SML_ACADEMY_BILLING_PRICES_JSON: JSON.stringify({ price_l1: { package: 'lifetime', ...entry } }) });
    assert.throws(() => parseBillingConfig(lifetime), /only allowed on a recurring price, not on lifetime/, JSON.stringify(entry));
  }
  /* an Academy daily price stops after 3 charges unless it says otherwise; no other package has a default */
  const daily = parseBillingConfig(env()).prices;
  assert.equal(daily.get('price_daily1').cancelAfterDays, 3);
  for (const id of ['price_weekly1', 'price_monthly1', 'price_quarter1', 'price_semi1', 'price_year1', 'price_life1']) assert.equal(daily.get(id).cancelAfterDays, null, id);
  const own = parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: pricesJson({ price_daily1: { cancelAfterDays: 5 } }) }));
  assert.equal(own.prices.get('price_daily1').cancelAfterDays, 5);
  const described = describeConfig(parseBillingConfig(one({ trialDays: 7, trialNoCard: true, cancelAfterDays: 3 })));
  assert.deepEqual(['trialDays', 'trialNoCard', 'cancelAfterDays'].map((key) => described.prices[0][key]), [7, true, 3]);
});

test('the 3-day default auto-stop is the Academy Day plan\'s only: a membership daily price has none, and a default that would swallow a trial is refused', () => {
  const pages = require('./pages');
  const { memEnv } = require('./testkit');
  /* a paid membership daily price with a 7-day trial and no cancelAfterDays: it renews after the trial, never silently "Free" */
  const cfg = parseBillingConfig(env(memEnv({ extraPrices: { price_premdaily: { package: 'daily', academy: false, roles: [PREMIUM], trialDays: 7 } } })));
  const entry = cfg.prices.get('price_premdaily');
  assert.ok(entry, cfg.errors.join('; '));
  assert.equal(entry.cancelAfterDays, null);
  assert.equal([...cfg.errors, ...cfg.warnings].some((m) => m.includes('price_premdaily')), false);
  const terms = pages.offerTerms({ key: 'daily', trialDays: entry.trialDays, trialNoCard: entry.trialNoCard, cancelAfterDays: entry.cancelAfterDays });
  assert.deepEqual([terms.trialDays, terms.charges], [7, null], 'a 7-day trial, then renews daily until cancelled');
  /* Free Trial Access says its 3 days itself, so it stays a free-only offer */
  assert.deepEqual([cfg.prices.get('price_freetrial').cancelAfterDays, cfg.prices.get('price_daily1').cancelAfterDays], [3, 3]);
  /* an Academy daily price whose default 3-day stop falls inside its own trial is refused (it would never charge) */
  for (const trialDays of [3, 7]) {
    assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: pricesJson({ price_daily1: { trialDays } }) })),
      /trialDays \d+ with the default cancelAfterDays 3 of a daily Academy price would never charge; set "cancelAfterDays" explicitly/, String(trialDays));
  }
  /* ... unless it says so, or the trial is shorter than the stop */
  assert.equal(parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: pricesJson({ price_daily1: { trialDays: 7, cancelAfterDays: 3 } }) })).prices.get('price_daily1').cancelAfterDays, 3);
  assert.equal(parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: pricesJson({ price_daily1: { trialDays: 7, cancelAfterDays: 10 } }) })).prices.get('price_daily1').cancelAfterDays, 10);
  assert.equal(parseBillingConfig(env({ SML_ACADEMY_BILLING_PRICES_JSON: pricesJson({ price_daily1: { trialDays: 2 } }) })).prices.get('price_daily1').cancelAfterDays, 3);
});

test('SML_ACADEMY_BILLING_UC_MATCH: any (default, no product map needed) | mapped; anything else is refused', () => {
  const byDefault = parseBillingConfig(env({ ...ownerEnv({ ucMatch: null }), SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON: '' }));
  assert.equal(byDefault.ucMatch, 'any');
  assert.equal(byDefault.warnings.some((w) => /has no entry/.test(w)), false, 'the map is optional with any');
  assert.equal(describeConfig(byDefault).ucMatch, 'any');
  const withMap = parseBillingConfig(env(ownerEnv({ ucMatch: null })));
  assert.ok(withMap.warnings.some((w) => /UC_ROLE_PRODUCTS_JSON is not used while SML_ACADEMY_BILLING_UC_MATCH=any/.test(w)));
  const mapped = parseBillingConfig(env({ ...ownerEnv({ ucMatch: 'mapped' }), SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON: '' }));
  assert.equal(mapped.ucMatch, 'mapped');
  assert.ok(mapped.warnings.some((w) => w.includes(`external role ${MONARCH} has no entry`)));
  for (const bad of ['all', 'ANY', 'mapped,any']) {
    assert.throws(() => parseBillingConfig(env({ SML_ACADEMY_BILLING_UC_MATCH: bad })), /SML_ACADEMY_BILLING_UC_MATCH must be one of any\|mapped/, bad);
  }
  /* no Upgrade.Chat credentials: still warned in both modes */
  assert.ok(parseBillingConfig(env(ownerEnv({ uc: false, ucMatch: null }))).warnings.some((w) => /UPGRADE_CHAT_CLIENT_ID/.test(w)));
});
