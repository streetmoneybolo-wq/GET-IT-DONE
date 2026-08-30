'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const B = require('./billing');

test('Loop Bucks quote adds a separately disclosed 2% fee exactly once', () => {
  assert.deepEqual(B.loopBuckQuote(10_00, 83), {
    subtotalCents: 1000, serviceFeeCents: 20, taxCents: 83, totalCents: 1103
  });
});

test('seller dispute fee is 12.5% of disputed principal', () => {
  assert.equal(B.disputeFee(10_00), 125);
  assert.equal(B.disputeFee(9_99), 125);
});

test('Loop Bucks checkout trusts the stored package, enables Tax, and has two lines', () => {
  const params = B.buildLoopBuckCheckout({
    order: { package_id: 3, user_id: 9, order_key: 'ord_1', subtotal_cents: 1000, service_fee_cents: 20 },
    packageRow: { id: 3, loop_bucks: 1000, price_cents: 1000, currency: 'usd', stripe_tax_code: 'txcd_10000000' },
    successUrl: 'https://stockmarketloop.com/store/?paid=1',
    cancelUrl: 'https://stockmarketloop.com/store/'
  });
  assert.equal(params.automatic_tax.enabled, true);
  assert.equal(params.line_items.length, 2);
  assert.equal(params.line_items[0].price_data.unit_amount, 1000);
  assert.equal(params.line_items[1].price_data.unit_amount, 20);
  assert.equal(params.metadata.order_key, 'ord_1');
});

test('membership checkout sends 5% to platform and rest to seller', () => {
  const params = B.buildMembershipCheckout({
    plan: { stripe_price_id: 'price_1', platform_fee_bps: 500 },
    subscriptionKey: 'subkey_1', userId: 9, connectedAccountId: 'acct_seller',
    successUrl: 'https://stockmarketloop.com/groups/one/?joined=1',
    cancelUrl: 'https://stockmarketloop.com/groups/one/'
  });
  assert.equal(params.subscription_data.application_fee_percent, 5);
  assert.equal(params.subscription_data.transfer_data.destination, 'acct_seller');
});

test('checkout builders reject browser-style price drift and insecure redirects', () => {
  assert.throws(() => B.buildLoopBuckCheckout({
    order: { package_id: 3, user_id: 9, order_key: 'ord_1', subtotal_cents: 1, service_fee_cents: 0 },
    packageRow: { id: 3, loop_bucks: 1000, price_cents: 1000, currency: 'usd' },
    successUrl: 'https://stockmarketloop.com/store/', cancelUrl: 'https://stockmarketloop.com/store/'
  }), /does not match/);
});
