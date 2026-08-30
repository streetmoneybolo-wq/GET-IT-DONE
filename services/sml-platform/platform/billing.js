'use strict';

const MEMBERSHIP_FEE_BPS = 500;
const LOOP_BUCK_SERVICE_FEE_BPS = 200;
const SELLER_DISPUTE_FEE_BPS = 1250;

function centsAtBps(cents, bps) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new TypeError('cents must be a non-negative integer');
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10_000) throw new TypeError('bps out of range');
  return Math.round(cents * bps / 10_000);
}

function loopBuckQuote(priceCents, taxCents = 0) {
  const serviceFeeCents = centsAtBps(priceCents, LOOP_BUCK_SERVICE_FEE_BPS);
  if (!Number.isSafeInteger(taxCents) || taxCents < 0) throw new TypeError('taxCents must be a non-negative integer');
  return Object.freeze({
    subtotalCents: priceCents,
    serviceFeeCents,
    taxCents,
    totalCents: priceCents + serviceFeeCents + taxCents
  });
}

function disputeFee(principalCents) {
  return centsAtBps(principalCents, SELLER_DISPUTE_FEE_BPS);
}

function absoluteUrl(value, field) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new TypeError(`${field} must use https`);
  if (url.hostname !== 'stockmarketloop.com' && url.hostname !== 'www.stockmarketloop.com') {
    throw new TypeError(`${field} must be a StockMarketLoop URL`);
  }
  return url.toString();
}

/**
 * Stripe Checkout parameters for stored-value credits.
 *
 * The package and price come from the database, never from the browser. Stripe
 * Tax calculates tax exactly once across the package and separately disclosed
 * service-fee line. Crediting happens only from the signed webhook.
 */
function buildLoopBuckCheckout({ order, packageRow, successUrl, cancelUrl }) {
  if (!order || !packageRow || order.package_id !== packageRow.id) throw new TypeError('order/package mismatch');
  const expected = loopBuckQuote(packageRow.price_cents);
  if (order.subtotal_cents !== expected.subtotalCents || order.service_fee_cents !== expected.serviceFeeCents) {
    throw new Error('stored order does not match server price');
  }

  const packageProduct = {
    name: `${packageRow.loop_bucks.toLocaleString('en-US')} Loop Bucks`,
    description: 'StockMarketLoop virtual credits; no cash value',
    metadata: { sml_kind: 'loop_bucks' }
  };
  if (packageRow.stripe_tax_code) packageProduct.tax_code = packageRow.stripe_tax_code;

  return {
    mode: 'payment',
    client_reference_id: String(order.user_id),
    success_url: absoluteUrl(successUrl, 'successUrl'),
    cancel_url: absoluteUrl(cancelUrl, 'cancelUrl'),
    automatic_tax: { enabled: true },
    customer_creation: 'always',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: packageRow.currency,
          unit_amount: packageRow.price_cents,
          product_data: packageProduct
        }
      },
      {
        quantity: 1,
        price_data: {
          currency: packageRow.currency,
          unit_amount: expected.serviceFeeCents,
          product_data: {
            name: 'StockMarketLoop service fee (2%)',
            description: 'Separate platform service fee',
            metadata: { sml_kind: 'service_fee' }
          }
        }
      }
    ],
    metadata: {
      sml_kind: 'loop_bucks',
      order_key: order.order_key
    },
    payment_intent_data: {
      metadata: { sml_kind: 'loop_bucks', order_key: order.order_key }
    }
  };
}

/** A native SML membership uses Connect destination charges and exactly 5%. */
function buildMembershipCheckout({ plan, subscriptionKey, userId, connectedAccountId,
  successUrl, cancelUrl, migrationRenewalAt = null, now = Date.now() }) {
  if (!plan || !plan.stripe_price_id) throw new TypeError('active Stripe price required');
  if (!/^acct_/.test(String(connectedAccountId || ''))) throw new TypeError('connected account required');
  if (plan.platform_fee_bps !== MEMBERSHIP_FEE_BPS) throw new Error('native membership fee must be 5%');

  const subscriptionData = {
    application_fee_percent: MEMBERSHIP_FEE_BPS / 100,
    transfer_data: { destination: connectedAccountId },
    metadata: { sml_kind: 'membership', subscription_key: subscriptionKey }
  };
  const renewalMs = migrationRenewalAt == null ? null : new Date(migrationRenewalAt).getTime();
  if (renewalMs != null) {
    /* Stripe Checkout requires a meaningful future trial. Refuse a date less
       than 48h away rather than double-billing immediately while the external
       subscription is still active. */
    if (!Number.isFinite(renewalMs) || renewalMs <= now) throw new TypeError('verified renewal date must be in the future');
    if (renewalMs < now + 48 * 3600 * 1000) throw new TypeError('verified renewal date is too close for safe migration');
    subscriptionData.trial_end = Math.floor(renewalMs / 1000);
    subscriptionData.trial_settings = { end_behavior: { missing_payment_method: 'cancel' } };
  }

  return {
    mode: 'subscription',
    client_reference_id: String(userId),
    success_url: absoluteUrl(successUrl, 'successUrl'),
    cancel_url: absoluteUrl(cancelUrl, 'cancelUrl'),
    automatic_tax: { enabled: true },
    payment_method_collection: 'always',
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    metadata: { sml_kind: 'membership', subscription_key: subscriptionKey },
    subscription_data: subscriptionData
  };
}

module.exports = {
  MEMBERSHIP_FEE_BPS,
  LOOP_BUCK_SERVICE_FEE_BPS,
  SELLER_DISPUTE_FEE_BPS,
  centsAtBps,
  loopBuckQuote,
  disputeFee,
  buildLoopBuckCheckout,
  buildMembershipCheckout
};
