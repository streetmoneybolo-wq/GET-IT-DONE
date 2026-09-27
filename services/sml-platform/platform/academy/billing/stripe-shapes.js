'use strict';

/* =============================================================================
 * MEM Academy billing: Stripe object readers.
 *
 * Pure. The engine's client is pinned to Stripe-Version 2022-11-15 (the MEM
 * account default), but webhook payloads, Dashboard exports and a future
 * version bump can all carry the newer ("basil", 2025-03-31+) shapes. Every
 * field the access rule depends on is read through one of these helpers, which
 * accept BOTH shapes, so an API-version change can never silently turn a paying
 * member into "no period" or "no charge".
 * ========================================================================== */

const ACADEMY_KIND = 'mem_academy';

/* Metadata keys other MEM integrations key on. The Academy never emits them,
   so no WordPress handler or platform endpoint can mistake an Academy object
   for one of its own. */
const RESERVED_FOREIGN_KEYS = Object.freeze([
  'subscription_key', 'sml_site', 'sml_uid', 'sml_key', 'sml_ct_user',
  'sml_sub_id', 'sml_user_id', 'sml_lb_amount', 'order_key'
]);

const OPEN_DISPUTE_STATUSES = Object.freeze(['warning_needs_response', 'warning_under_review', 'needs_response', 'under_review']);
const WON_DISPUTE_STATUSES = Object.freeze(['won', 'warning_closed']);
const LOST_DISPUTE_STATUSES = Object.freeze(['lost']);

function idOf(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof value.id === 'string') return value.id;
  return null;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isAcademyMeta(metadata) {
  return Boolean(metadata && typeof metadata === 'object' && metadata.sml_kind === ACADEMY_KIND);
}

function hasForeignKeys(metadata) {
  if (!metadata || typeof metadata !== 'object') return false;
  return RESERVED_FOREIGN_KEYS.some((key) => Object.prototype.hasOwnProperty.call(metadata, key));
}

function subItems(sub) {
  const items = sub && sub.items && Array.isArray(sub.items.data) ? sub.items.data : [];
  return items.map((item) => {
    const price = item.price || item.plan || {};
    return {
      priceId: idOf(price) || null,
      productId: idOf(price.product),
      product: price.product && typeof price.product === 'object' ? price.product : null,
      recurring: price.recurring || (item.plan ? { interval: item.plan.interval, interval_count: item.plan.interval_count } : null),
      currentPeriodStart: num(item.current_period_start),
      currentPeriodEnd: num(item.current_period_end)
    };
  });
}

/** Seconds since epoch; top level on 2022-11-15, per item on basil. */
function subPeriodStart(sub) {
  if (!sub) return null;
  const top = num(sub.current_period_start);
  if (top !== null) return top;
  const starts = subItems(sub).map((item) => item.currentPeriodStart).filter((v) => v !== null);
  return starts.length ? Math.max(...starts) : null;
}

function subPeriodEnd(sub) {
  if (!sub) return null;
  const top = num(sub.current_period_end);
  if (top !== null) return top;
  const ends = subItems(sub).map((item) => item.currentPeriodEnd).filter((v) => v !== null);
  return ends.length ? Math.max(...ends) : null;
}

function invoiceSubscriptionId(invoice) {
  if (!invoice) return null;
  return idOf(invoice.subscription)
    || idOf(invoice.parent && invoice.parent.subscription_details && invoice.parent.subscription_details.subscription)
    || null;
}

function invoiceSubscriptionMetadata(invoice) {
  if (!invoice) return null;
  if (invoice.subscription_details && invoice.subscription_details.metadata) return invoice.subscription_details.metadata;
  const parent = invoice.parent && invoice.parent.subscription_details;
  if (parent && parent.metadata) return parent.metadata;
  return null;
}

/** The charge that paid an invoice: invoice.charge (2022-11-15) or
 *  invoice.payments[].payment.charge (basil). Null for $0 / balance-paid. */
function invoiceChargeId(invoice) {
  if (!invoice) return null;
  const direct = idOf(invoice.charge);
  if (direct) return direct;
  const payments = invoice.payments && Array.isArray(invoice.payments.data) ? invoice.payments.data : [];
  for (const entry of payments) {
    const payment = entry && entry.payment;
    const charge = payment && idOf(payment.charge);
    if (charge && (entry.status === undefined || entry.status === 'paid')) return charge;
  }
  return null;
}

function invoicePaymentIntentId(invoice) {
  if (!invoice) return null;
  const direct = idOf(invoice.payment_intent);
  if (direct) return direct;
  const payments = invoice.payments && Array.isArray(invoice.payments.data) ? invoice.payments.data : [];
  for (const entry of payments) {
    const pi = entry && entry.payment && idOf(entry.payment.payment_intent);
    if (pi) return pi;
  }
  return null;
}

/** Charge -> invoice id (2022-11-15 only; basil removed charge.invoice). */
function chargeInvoiceId(charge) {
  return charge ? idOf(charge.invoice) : null;
}

function piLatestChargeId(pi) {
  if (!pi) return null;
  const latest = idOf(pi.latest_charge);
  if (latest) return latest;
  /* Pre-2022-11-15 payloads carried charges.data instead. */
  const legacy = pi.charges && Array.isArray(pi.charges.data) ? pi.charges.data : [];
  return legacy.length ? idOf(legacy[0]) : null;
}

function piLatestCharge(pi) {
  if (!pi) return null;
  if (pi.latest_charge && typeof pi.latest_charge === 'object') return pi.latest_charge;
  const legacy = pi.charges && Array.isArray(pi.charges.data) ? pi.charges.data : [];
  return legacy.length && typeof legacy[0] === 'object' ? legacy[0] : null;
}

function chargeFullyRefunded(charge) {
  if (!charge) return false;
  if (charge.refunded === true) return true;
  const amount = num(charge.amount);
  const refunded = num(charge.amount_refunded);
  return amount !== null && amount > 0 && refunded !== null && refunded >= amount;
}

function chargePartiallyRefunded(charge) {
  if (!charge || chargeFullyRefunded(charge)) return false;
  const refunded = num(charge.amount_refunded);
  return refunded !== null && refunded > 0;
}

function disputeState(status) {
  if (OPEN_DISPUTE_STATUSES.includes(status)) return 'open';
  if (WON_DISPUTE_STATUSES.includes(status)) return 'won';
  if (LOST_DISPUTE_STATUSES.includes(status)) return 'lost';
  return 'unknown';
}

/** Customer ids on every object type the endpoint subscribes to. */
function customerIdOf(object) {
  return object ? idOf(object.customer) : null;
}

function isStripeMissing(error) {
  return Boolean(error && (error.code === 'resource_missing' || error.statusCode === 404 || error.status === 404));
}

module.exports = {
  ACADEMY_KIND,
  RESERVED_FOREIGN_KEYS,
  OPEN_DISPUTE_STATUSES,
  idOf,
  isAcademyMeta,
  hasForeignKeys,
  subItems,
  subPeriodStart,
  subPeriodEnd,
  invoiceSubscriptionId,
  invoiceSubscriptionMetadata,
  invoiceChargeId,
  invoicePaymentIntentId,
  chargeInvoiceId,
  piLatestChargeId,
  piLatestCharge,
  chargeFullyRefunded,
  chargePartiallyRefunded,
  disputeState,
  customerIdOf,
  isStripeMissing
};
