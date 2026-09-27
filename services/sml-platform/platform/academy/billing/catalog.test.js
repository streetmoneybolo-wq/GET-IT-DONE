'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { packageForRecurring, inferPackage, rolesFor, validatePrice, createCatalog, graceHoursFor, formatAmount } = require('./catalog');
const { config, createFakeStripe, stripePrice } = require('./testkit');

const entry = (priceId, pkg) => ({ priceId, package: pkg, sell: true, graceHours: 72 });

test('the package shapes: month x3 is quarterly and month x6 is semiannual', () => {
  assert.equal(packageForRecurring({ interval: 'day', interval_count: 1 }), 'daily');
  assert.equal(packageForRecurring({ interval: 'week', interval_count: 1 }), 'weekly');
  assert.equal(packageForRecurring({ interval: 'month', interval_count: 1 }), 'monthly');
  assert.equal(packageForRecurring({ interval: 'month', interval_count: 3 }), 'quarterly');
  assert.equal(packageForRecurring({ interval: 'month', interval_count: 6 }), 'semiannual');
  assert.equal(packageForRecurring({ interval: 'year', interval_count: 1 }), 'yearly');
  assert.equal(packageForRecurring(null), 'lifetime');
  assert.equal(packageForRecurring({ interval: 'month', interval_count: 2 }), null);
});

test('an unconfigured Academy price always gets a package (one_time -> lifetime)', () => {
  assert.equal(inferPackage(null), 'lifetime');
  assert.equal(inferPackage({ interval: 'month', interval_count: 2 }), 'monthly');
  assert.equal(inferPackage({ interval: 'day', interval_count: 2 }), 'daily');
  assert.equal(inferPackage({ interval: 'year', interval_count: 2 }), 'yearly');
});

test('roles: lifetime grants both engine roles, every other package the Academy role', () => {
  assert.deepEqual(rolesFor('lifetime'), ['academy', 'mem_lifetime']);
  for (const pkg of ['daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'yearly']) assert.deepEqual(rolesFor(pkg), ['academy']);
});

test('default grace hours: daily 2, weekly 12, others 72; config overrides', () => {
  assert.equal(graceHoursFor('daily'), 2);
  assert.equal(graceHoursFor('weekly'), 12);
  assert.equal(graceHoursFor('monthly'), 72);
  assert.equal(graceHoursFor('yearly'), 72);
  assert.equal(graceHoursFor('monthly', { graceHours: 24 }), 24);
});

test('a valid price passes validation', () => {
  assert.deepEqual(validatePrice(stripePrice('price_quarter1'), entry('price_quarter1', 'quarterly'), { livemode: false }), []);
  assert.deepEqual(validatePrice(stripePrice('price_life1'), entry('price_life1', 'lifetime'), { livemode: false }), []);
});

test('mismatch, inactive, wrong livemode, wrong product and unspecified tax are unsellable', () => {
  const quarter = stripePrice('price_quarter1');
  assert.ok(validatePrice(quarter, entry('price_quarter1', 'semiannual'), { livemode: false }).includes('package_mismatch'));
  assert.ok(validatePrice({ ...quarter, active: false }, entry('price_quarter1', 'quarterly'), { livemode: false }).includes('price_inactive'));
  assert.ok(validatePrice(quarter, entry('price_quarter1', 'quarterly'), { livemode: true }).includes('price_livemode_mismatch'));
  assert.ok(validatePrice({ ...quarter, product: { id: 'prod_store', metadata: { sml_site: 'x' } } }, entry('price_quarter1', 'quarterly'), { livemode: false }).includes('product_not_academy'));
  assert.ok(validatePrice({ ...quarter, tax_behavior: 'unspecified' }, entry('price_quarter1', 'quarterly'), { livemode: false, automaticTax: true }).includes('tax_behavior_unspecified'));
  assert.deepEqual(validatePrice({ ...quarter, tax_behavior: 'unspecified' }, entry('price_quarter1', 'quarterly'), { livemode: false, automaticTax: false }), []);
  assert.ok(validatePrice({ ...quarter, currency: 'eur' }, entry('price_quarter1', 'quarterly'), { livemode: false }).includes('price_currency_not_usd'));
  assert.ok(validatePrice(stripePrice('price_monthly1'), entry('price_monthly1', 'lifetime'), { livemode: false }).includes('package_mismatch'));
});

test('the catalog sells only valid sell:true prices and reports the rest', async () => {
  const stripe = createFakeStripe();
  stripe.data.prices.price_semi1 = { ...stripePrice('price_semi1'), recurring: { interval: 'month', interval_count: 3 } };
  const invalid = [];
  const catalog = createCatalog({ config: config(), stripeApi: stripe, onInvalid: async (list) => invalid.push(...list) });
  const state = await catalog.get();
  assert.equal(state.complete, true);
  assert.deepEqual([...state.sellable.keys()].sort(), ['daily', 'lifetime', 'monthly', 'quarterly', 'weekly', 'yearly']);
  assert.equal(state.sellable.get('quarterly').amount, 7999);
  assert.equal(state.invalid.length, 1);
  assert.equal(invalid[0].priceId, 'price_semi1');
  assert.ok(invalid[0].problems.includes('package_mismatch'));
  /* retired prices are never fetched for selling */
  assert.equal(stripe.callsOf('retrievePrice').some((c) => c.args[0] === 'price_monthold'), false);
});

test('the catalog is cached for ten minutes', async () => {
  let t = 0;
  const stripe = createFakeStripe();
  const catalog = createCatalog({ config: config(), stripeApi: stripe, now: () => t });
  await catalog.get();
  const first = stripe.callsOf('retrievePrice').length;
  t += 9 * 60_000;
  await catalog.get();
  assert.equal(stripe.callsOf('retrievePrice').length, first);
  t += 2 * 60_000;
  await catalog.get();
  assert.ok(stripe.callsOf('retrievePrice').length > first);
});

test('resolvePrice: configured prices need no I/O; an unmapped Academy price still entitles', async () => {
  const stripe = createFakeStripe();
  stripe.data.prices.price_promo1 = { ...stripePrice('price_promo1'), recurring: { interval: 'month', interval_count: 1 } };
  stripe.data.prices.price_store1 = { ...stripePrice('price_store1'), product: { id: 'prod_store', metadata: {} } };
  const catalog = createCatalog({ config: config(), stripeApi: stripe });
  const known = await catalog.resolvePrice('price_monthold');
  assert.deepEqual([known.academy, known.known, known.package, known.sell], [true, true, 'monthly', false]);
  assert.equal(stripe.calls.length, 0);
  const promo = await catalog.resolvePrice('price_promo1');
  assert.deepEqual([promo.academy, promo.known, promo.unmapped, promo.package, promo.graceHours], [true, false, true, 'monthly', 72]);
  const store = await catalog.resolvePrice('price_store1');
  assert.equal(store.academy, false);
});

test('amounts are formatted from Stripe cents, never from code', () => {
  assert.equal(formatAmount(299), '$2.99');
  assert.equal(formatAmount(129999), '$1,299.99');
  assert.equal(formatAmount(1000000), '$10,000.00');
});

test('a sellable package carries its payment methods; only a bank-debit price is marked delayed', async () => {
  const { BANK_LIFETIME_ENV } = require('./testkit');
  const catalog = createCatalog({ config: config(BANK_LIFETIME_ENV), stripeApi: createFakeStripe() });
  const state = await catalog.get();
  const lifetime = state.sellable.get('lifetime');
  assert.deepEqual([lifetime.paymentMethods, lifetime.delayedPayment], [['card', 'us_bank_account'], true]);
  const monthly = state.sellable.get('monthly');
  assert.deepEqual([monthly.paymentMethods, monthly.delayedPayment], [['card', 'link'], false]);
  for (const pkg of ['daily', 'weekly', 'quarterly', 'yearly']) assert.equal(state.sellable.get(pkg).delayedPayment, false, pkg);
});

test('auto-stop charge counts, the daily default, and membership names without emoji', async () => {
  const { maxCharges, cancelAfterFor, plainName, describePrice } = require('./catalog');
  assert.equal(cancelAfterFor('daily', null), 3);
  assert.equal(cancelAfterFor('daily', { cancelAfterDays: 5 }), 5);
  assert.equal(cancelAfterFor('monthly', null), null);
  /* the 3-day default is the Academy Day plan's: a membership daily entry has none unless it says so */
  assert.equal(cancelAfterFor('daily', { academy: false }), null);
  assert.equal(cancelAfterFor('daily', { academy: false, cancelAfterDays: 3 }), 3);
  assert.equal(cancelAfterFor('daily', { academy: true, cancelAfterDays: null }), null, 'a parsed entry is taken as it is');
  assert.equal(cancelAfterFor('daily', { academy: true }), 3);
  assert.equal(maxCharges({ pkg: 'daily', cancelAfterDays: 3 }), 3, 'the Day plan: 3 charges');
  assert.equal(maxCharges({ pkg: 'daily', trialDays: 3, cancelAfterDays: 3 }), 0, 'Free Trial Access (a 3-day trial that stops after 3 days) never charges');
  assert.equal(maxCharges({ pkg: 'daily', trialDays: 7, cancelAfterDays: 3 }), 0, 'a trial longer than its stop never charges either');
  assert.equal(maxCharges({ pkg: 'daily', trialDays: 1, cancelAfterDays: 3 }), 2);
  assert.equal(maxCharges({ pkg: 'weekly', cancelAfterDays: 7 }), 1);
  assert.equal(maxCharges({ pkg: 'weekly', trialDays: 7, cancelAfterDays: 21 }), 2);
  assert.equal(maxCharges({ pkg: 'monthly', cancelAfterDays: 60 }), 3, 'an upper bound for calendar months');
  assert.equal(maxCharges({ pkg: 'monthly', cancelAfterDays: null }), null);
  assert.equal(maxCharges({ pkg: 'lifetime', cancelAfterDays: 3 }), null);
  assert.equal(plainName('\u{1F451} Elite Lifetime Access \u{1F48E}'), 'Elite Lifetime Access');
  assert.equal(plainName('Elite\u{FE0F} Week \u{1F4BA} Seat'), 'Elite Week Seat');
  const price = stripePrice('price_premium1', { product: { id: 'prod_x', object: 'product', active: true, name: '\u{2B50} Free Trial Access', metadata: { sml_kind: 'mem_academy' } } });
  const desc = describePrice(price, 'daily', { priceId: 'price_premium1', package: 'daily', academy: false, roles: ['1192450618485395466'], line: 'roles:x',
    trialDays: 3, trialNoCard: true, cancelAfterDays: 3, paymentMethods: ['card', 'link'] });
  assert.deepEqual([desc.label, desc.trialDays, desc.trialNoCard, desc.cancelAfterDays], ['Free Trial Access', 3, true, 3]);
  const academyDaily = describePrice(stripePrice('price_daily1'), 'daily', { priceId: 'price_daily1', package: 'daily', academy: true, roles: [], line: 'academy' });
  assert.deepEqual([academyDaily.trialDays, academyDaily.trialNoCard, academyDaily.cancelAfterDays], [null, false, 3]);
  /* resolvePrice carries the auto-stop to the billing rules (unconfigured daily prices keep the 3-charge cap) */
  const cfg = config();
  const catalog = createCatalog({ config: cfg, stripeApi: createFakeStripe({ prices: { price_unmapped9: stripePrice('price_unmapped9', {
    recurring: { interval: 'day', interval_count: 1, usage_type: 'licensed' } }) } }) });
  assert.equal((await catalog.resolvePrice('price_daily1')).cancelAfterDays, 3);
  assert.equal((await catalog.resolvePrice('price_monthly1')).cancelAfterDays, null);
  assert.equal((await catalog.resolvePrice('price_unmapped9')).cancelAfterDays, 3);
});
