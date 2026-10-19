'use strict';

const MEMBERSHIP_FEE_BPS = 600;
const LOOP_BUCK_SERVICE_FEE_BPS = 200;
const SELLER_DISPUTE_FEE_BPS = 1250;
/* Academy Alert Charts: the platform keeps 6% of every sale, and a dispute the trader loses costs them 15% of the disputed amount. */
const ALERT_CHART_FEE_BPS = 600;
const ALERT_CHART_DISPUTE_FEE_BPS = 1500;
const ALERT_CHART_PLANS = Object.freeze({
  day: { label: '1 day', mode: 'payment', days: 1 },
  week: { label: '1 week', mode: 'subscription', interval: 'week', days: 7 },
  month: { label: '1 month', mode: 'subscription', interval: 'month', days: 30 },
  year: { label: '1 year', mode: 'subscription', interval: 'year', days: 365 },
  lifetime: { label: 'Lifetime', mode: 'payment', days: null }
});

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
/** The seller's dispute fee by what was sold: 12.5% on a membership, 15% on an Alert Chart. */
function disputeFeeFor(principalCents, kind) {
  return centsAtBps(principalCents, kind === 'alert_chart' ? ALERT_CHART_DISPUTE_FEE_BPS : SELLER_DISPUTE_FEE_BPS);
}

function returnUrl(value, field, hosts) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new TypeError(`${field} must use https`);
  const allowed = ['stockmarketloop.com', 'www.stockmarketloop.com', ...(hosts || [])];
  if (!allowed.includes(url.hostname)) throw new TypeError(`${field} must be a StockMarketLoop or Academy URL`);
  return url.toString();
}

/**
 * Stripe Checkout parameters for a trader's premium Alert Chart, sold on stockmarketloop.com.
 *
 * The price is the trader's stored setting, never the browser's. Week, month and year are
 * recurring subscriptions; 1 day and lifetime are one-time payments. Every charge is a Connect
 * destination charge to the trader's account with exactly 6% kept by the platform. Access in
 * the Academy is granted only from the signed webhook (alert-chart-billing.js).
 */
function buildAlertChartCheckout({ plan, priceCents, currency = 'usd', checkoutKey, subscriberUserId = null, sellerId,
  connectedAccountId, traderName = '', successUrl, cancelUrl, onBehalfOf = false, extraHosts = [] }) {
  const spec = ALERT_CHART_PLANS[plan];
  if (!spec) throw new TypeError('unknown Alert Chart plan');
  if (!Number.isSafeInteger(priceCents) || priceCents < 100) throw new TypeError('Alert Chart price must be at least $1');
  if (!/^acct_/.test(String(connectedAccountId || ''))) throw new TypeError('connected account required');
  if (!/^[a-z0-9_]{8,80}$/i.test(String(checkoutKey || ''))) throw new TypeError('checkout key required');
  const name = `${traderName ? traderName + "'s " : ''}Alert Chart · ${spec.label}`;
  const metadata = { sml_kind: 'alert_chart', alert_chart_key: String(checkoutKey), alert_chart_plan: plan, sml_seller_id: String(sellerId) };
  const priceData = {
    currency: String(currency || 'usd').toLowerCase(), unit_amount: priceCents,
    product_data: { name, description: 'Premium trade alerts in the Making Easy Money Academy. Educational content, not advice.', metadata: { sml_kind: 'alert_chart' } }
  };
  if (spec.mode === 'subscription') priceData.recurring = { interval: spec.interval, interval_count: 1 };
  const params = {
    mode: spec.mode,
    success_url: returnUrl(successUrl, 'successUrl', extraHosts),
    cancel_url: returnUrl(cancelUrl, 'cancelUrl', extraHosts),
    line_items: [{ quantity: 1, price_data: priceData }],
    metadata
  };
  if (subscriberUserId) params.client_reference_id = String(subscriberUserId);
  if (spec.mode === 'subscription') {
    params.payment_method_collection = 'always';
    params.subscription_data = { application_fee_percent: ALERT_CHART_FEE_BPS / 100, transfer_data: { destination: connectedAccountId }, metadata };
    if (onBehalfOf) params.subscription_data.on_behalf_of = connectedAccountId;
  } else {
    params.customer_creation = 'always';
    params.payment_intent_data = { application_fee_amount: centsAtBps(priceCents, ALERT_CHART_FEE_BPS), transfer_data: { destination: connectedAccountId }, metadata };
    if (onBehalfOf) params.payment_intent_data.on_behalf_of = connectedAccountId;
  }
  return params;
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

/** A native SML membership uses Connect destination charges and exactly 6%. */
function buildMembershipCheckout({ plan, subscriptionKey, userId, connectedAccountId,
  successUrl, cancelUrl, migrationRenewalAt = null, onBehalfOf = false, now = Date.now() }) {
  if (!plan || !plan.stripe_price_id) throw new TypeError('active Stripe price required');
  if (!/^acct_/.test(String(connectedAccountId || ''))) throw new TypeError('connected account required');
  if (plan.platform_fee_bps !== MEMBERSHIP_FEE_BPS) throw new Error('native membership fee must be 6%');

  const subscriptionData = {
    application_fee_percent: MEMBERSHIP_FEE_BPS / 100,
    transfer_data: { destination: connectedAccountId },
    metadata: { sml_kind: 'membership', subscription_key: subscriptionKey }
  };
  /* The seller is the merchant of record once Stripe has activated card_payments
     on their account: the sale then shows in THEIR Stripe dashboard with the
     product name, description and price. Stripe requires on_behalf_of to match
     the transfer destination. */
  if (onBehalfOf) subscriptionData.on_behalf_of = connectedAccountId;
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
  ALERT_CHART_FEE_BPS,
  ALERT_CHART_DISPUTE_FEE_BPS,
  ALERT_CHART_PLANS,
  centsAtBps,
  loopBuckQuote,
  disputeFee,
  disputeFeeFor,
  buildLoopBuckCheckout,
  buildMembershipCheckout,
  buildAlertChartCheckout
};
