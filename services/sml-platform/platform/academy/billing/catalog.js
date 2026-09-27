'use strict';

/* =============================================================================
 * MEM Academy billing: the price -> package catalog.
 *
 * There are NO amounts in code. A package is only a billing shape; the price
 * the owner charges lives on the Stripe Price and is read from Stripe.
 *
 * Two different questions, deliberately answered differently:
 *   SELLABLE   may /buy offer it? Only a configured sell:true price that passes
 *              every check below (active, livemode, usd, exact interval, an
 *              Academy product, tax behaviour when automatic tax is on).
 *   ENTITLING  does a subscription on it grant access? Any configured price
 *              (sold or retired) AND any unconfigured price whose PRODUCT has
 *              metadata sml_kind=mem_academy. The package of an unconfigured
 *              price is inferred from its interval (one_time -> lifetime). An
 *              unconfigured price can only ever ADD access; it is audited as
 *              config_unmapped_price and never causes a revoke.
 * ========================================================================== */

const { PACKAGES, DEFAULT_GRACE_HOURS, hasDelayedMethod, MONARCH_ROLE_ID, ELITE_ROLE_ID, PREMIUM_ROLE_ID,
  DEFAULT_DAILY_CANCEL_AFTER_DAYS } = require('./config');
const { isAcademyMeta, idOf } = require('./stripe-shapes');

const EXPECTED = Object.freeze({
  daily: Object.freeze({ type: 'recurring', interval: 'day', count: 1 }),
  weekly: Object.freeze({ type: 'recurring', interval: 'week', count: 1 }),
  monthly: Object.freeze({ type: 'recurring', interval: 'month', count: 1 }),
  quarterly: Object.freeze({ type: 'recurring', interval: 'month', count: 3 }),
  semiannual: Object.freeze({ type: 'recurring', interval: 'month', count: 6 }),
  yearly: Object.freeze({ type: 'recurring', interval: 'year', count: 1 }),
  lifetime: Object.freeze({ type: 'one_time' })
});

const LABELS = Object.freeze({
  daily: 'Day plan', weekly: 'Week plan', monthly: 'Monthly', quarterly: '3-Month',
  semiannual: '6-Month', yearly: '1-Year', lifetime: 'MEM Lifetime'
});

/* Display names of the owner's external roles, for the membership labels and
   the consent text (ids only anywhere else). Any other external role reads
   as "membership". */
const ROLE_NAMES = Object.freeze({
  [MONARCH_ROLE_ID]: 'Monarch',
  [ELITE_ROLE_ID]: 'Elite Member',
  [PREMIUM_ROLE_ID]: 'Premium Member'
});

function roleNames(ids) {
  return (ids || []).map((id) => ROLE_NAMES[String(id)] || 'membership');
}

/* Academy daily plans are fare-capped: the engine sets cancel_at = start + 3
   days (the default "cancelAfterDays" of an academy:true daily price). */
const DAILY_MAX_CHARGES = DEFAULT_DAILY_CANCEL_AFTER_DAYS;

/* The shortest length of one billing period of each package, in days. With
   "cancelAfterDays" N a subscription is charged at the trial end (or the
   start) and at every renewal before start + N days, so these give an exact
   count for day and week plans and an upper bound for the calendar ones. */
const PERIOD_MIN_DAYS = Object.freeze({ daily: 1, weekly: 7, monthly: 28, quarterly: 89, semiannual: 181, yearly: 365 });

/** Effective auto-stop of a price: its entry's cancelAfterDays (config.js
 *  already applied the default there; null = none), else 3 on an Academy
 *  daily price (the Day plan cap; also an unmapped daily Academy product),
 *  else none (null). A membership (academy:false) has no default. */
function cancelAfterFor(pkg, entry) {
  if (entry && entry.cancelAfterDays !== undefined) return Number.isInteger(entry.cancelAfterDays) ? entry.cancelAfterDays : null;
  if (entry && entry.academy === false) return null;
  return pkg === 'daily' ? DEFAULT_DAILY_CANCEL_AFTER_DAYS : null;
}

/**
 * The most charges a subscription on this price can make: null when it has no
 * auto-stop (it renews until cancelled), 0 when the auto-stop comes no later
 * than the end of the free trial (it never charges: resync.js ends such a
 * trial 10 minutes before its trial end, e.g. Free Trial Access, 3 and 3).
 * trialDays is the trial actually offered (null when none).
 */
function maxCharges({ pkg, trialDays = null, cancelAfterDays = null }) {
  if (!Number.isInteger(cancelAfterDays) || !PERIOD_MIN_DAYS[pkg]) return null;
  const first = Number.isInteger(trialDays) ? trialDays : 0;
  if (first >= cancelAfterDays) return 0;
  return Math.ceil((cancelAfterDays - first) / PERIOD_MIN_DAYS[pkg]);
}

/* Stripe product names label memberships on /buy; pictographs (emoji) are
   dropped so the name reads like the Upgrade.Chat name without emoji. */
function plainName(name) {
  return String(name || '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, '').replace(/\s+/g, ' ').trim();
}

const PRICE_TTL_MS = 10 * 60_000;

function packageForRecurring(recurring) {
  if (!recurring) return 'lifetime';
  const count = Number(recurring.interval_count || 1);
  for (const pkg of PACKAGES) {
    const shape = EXPECTED[pkg];
    if (shape.type === 'recurring' && shape.interval === recurring.interval && shape.count === count) return pkg;
  }
  return null;
}

/** Best-effort package for an UNCONFIGURED Academy price. Never null: an
 *  Academy product always entitles; only the label and grace are inferred. */
function inferPackage(recurring) {
  const exact = packageForRecurring(recurring);
  if (exact) return exact;
  switch (recurring && recurring.interval) {
    case 'day': return 'daily';
    case 'week': return 'weekly';
    case 'year': return 'yearly';
    default: return 'monthly';
  }
}

function rolesFor(pkg) {
  return pkg === 'lifetime' ? ['academy', 'mem_lifetime'] : ['academy'];
}

function isRecurring(pkg) { return pkg !== 'lifetime'; }

function graceHoursFor(pkg, entry) {
  if (entry && Number.isInteger(entry.graceHours)) return entry.graceHours;
  return DEFAULT_GRACE_HOURS[pkg] ?? 72;
}

function intervalPhrase(pkg) {
  switch (pkg) {
    case 'daily': return 'day';
    case 'weekly': return 'week';
    case 'monthly': return 'month';
    case 'quarterly': return '3 months';
    case 'semiannual': return '6 months';
    case 'yearly': return 'year';
    default: return '';
  }
}

/**
 * Validate one Stripe Price (retrieved with expand:['product']) against its
 * configured entry. Returns a list of problems; empty means sellable.
 */
function validatePrice(price, entry, { livemode, automaticTax = false } = {}) {
  const problems = [];
  if (!price || typeof price !== 'object') return ['price_not_found'];
  if (price.id !== entry.priceId) problems.push('price_id_mismatch');
  if (price.active !== true) problems.push('price_inactive');
  if (Boolean(price.livemode) !== Boolean(livemode)) problems.push('price_livemode_mismatch');
  if (String(price.currency || '').toLowerCase() !== 'usd') problems.push('price_currency_not_usd');
  if (!Number.isInteger(price.unit_amount) || price.unit_amount <= 0) problems.push('price_amount_invalid');
  if (price.billing_scheme && price.billing_scheme !== 'per_unit') problems.push('price_not_per_unit');
  const expected = EXPECTED[entry.package];
  if (!expected) problems.push('package_unknown');
  else if (expected.type === 'one_time') {
    if (price.type !== 'one_time' || price.recurring) problems.push('package_mismatch');
  } else {
    const recurring = price.recurring;
    if (price.type !== 'recurring' || !recurring || recurring.interval !== expected.interval
      || Number(recurring.interval_count || 1) !== expected.count) problems.push('package_mismatch');
    if (recurring && recurring.usage_type && recurring.usage_type !== 'licensed') problems.push('price_metered');
  }
  const product = price.product && typeof price.product === 'object' ? price.product : null;
  if (!product || !isAcademyMeta(product.metadata)) problems.push('product_not_academy');
  if (product && product.active === false) problems.push('product_inactive');
  if (automaticTax && (!price.tax_behavior || price.tax_behavior === 'unspecified')) problems.push('tax_behavior_unspecified');
  return problems;
}

/** A sellable package. paymentMethods come from the configured entry (its own
 *  "paymentMethods", else SML_ACADEMY_BILLING_PAYMENT_METHODS); delayedPayment
 *  is true when one of them is a bank debit that clears days later. */
function describePrice(price, pkg, entry = null, { lifetimeRole = true } = {}) {
  const paymentMethods = entry && Array.isArray(entry.paymentMethods) && entry.paymentMethods.length
    ? [...entry.paymentMethods] : ['card', 'link'];
  const academy = !entry || entry.academy !== false;
  const roles = entry && Array.isArray(entry.roles) ? [...entry.roles] : [];
  const product = price && price.product && typeof price.product === 'object' ? price.product : null;
  const productName = product && typeof product.name === 'string' ? plainName(product.name).slice(0, 80) : '';
  /* A membership (academy:false) is labelled by its Stripe product name, else
     by its role names. */
  const label = academy && !(entry && entry.winback) ? LABELS[pkg] : (productName || `${roleNames(roles).join(' + ')} ${pkg === 'lifetime' ? 'Lifetime' : LABELS[pkg]}`);
  return {
    key: pkg,
    label,
    academy,
    roles,
    roleNames: roleNames(roles),
    lifetimeRole: Boolean(academy && pkg === 'lifetime' && lifetimeRole),
    line: entry && entry.line ? entry.line : 'academy',
    priceId: price.id,
    amount: price.unit_amount,
    currency: String(price.currency || 'usd').toLowerCase(),
    interval: price.recurring ? price.recurring.interval : null,
    interval_count: price.recurring ? Number(price.recurring.interval_count || 1) : null,
    paymentMethods,
    delayedPayment: hasDelayedMethod(paymentMethods),
    /* the free trial this price offers to an account that never had one
       (checkout.js decides per member), and its auto-stop */
    trialDays: entry && Number.isInteger(entry.trialDays) ? entry.trialDays : null,
    trialNoCard: Boolean(entry && entry.trialNoCard && Number.isInteger(entry.trialDays)),
    cancelAfterDays: cancelAfterFor(pkg, entry),
    productId: product ? product.id : idOf(price.product),
    /* win-back offers (config.js): sold only to the listed former members */
    winback: Boolean(entry && entry.winback),
    introCents: entry && Number.isInteger(entry.introCents) ? entry.introCents : null,
    bonusAcademyDays: entry && Number.isInteger(entry.bonusAcademyDays) ? entry.bonusAcademyDays : null
  };
}

function formatAmount(amount, currency = 'usd') {
  const value = Number(amount || 0) / 100;
  if (String(currency).toLowerCase() === 'usd') {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${value.toFixed(2)} ${String(currency).toUpperCase()}`;
}

/**
 * The live catalog: configured prices validated against Stripe, cached for
 * ten minutes, plus a resolver for any price id met on a subscription.
 */
function createCatalog({ config, stripeApi, now = Date.now, ttlMs = PRICE_TTL_MS, onInvalid = null } = {}) {
  let cached = null;
  const unknownCache = new Map();

  async function refresh() {
    /* sellable: the Academy line, keyed by package (one per package).
       memberships: every academy:false line, keyed by price id. */
    const sellable = new Map();
    const memberships = new Map();
    /* winback: every sell:true win-back price, keyed by price id */
    const winback = new Map();
    const invalid = [];
    let complete = true;
    for (const entry of config.prices.values()) {
      if (!entry.sell) continue;
      let price = null;
      try {
        price = await stripeApi.retrievePrice(entry.priceId);
      } catch (error) {
        complete = false;
        invalid.push({ priceId: entry.priceId, package: entry.package, problems: ['price_fetch_failed'] });
        continue;
      }
      const problems = validatePrice(price, entry, { livemode: config.livemode, automaticTax: config.automaticTax });
      if (!problems.length && entry.winback && Number.isInteger(entry.introCents) && entry.introCents >= price.unit_amount) {
        problems.push('intro_not_below_price');
      }
      if (problems.length) invalid.push({ priceId: entry.priceId, package: entry.package, problems });
      else if (entry.winback) winback.set(entry.priceId, describePrice(price, entry.package, entry, { lifetimeRole: false }));
      else if (entry.academy === false) memberships.set(entry.priceId, describePrice(price, entry.package, entry, { lifetimeRole: false }));
      else sellable.set(entry.package, describePrice(price, entry.package, entry, { lifetimeRole: Boolean(config.lifetimeRoleId) }));
    }
    cached = { at: now(), sellable, memberships, winback, invalid, complete };
    if (invalid.length && typeof onInvalid === 'function') {
      try { await onInvalid(invalid); } catch (_) { /* reporting must not break the catalog */ }
    }
    return cached;
  }

  async function get({ force = false } = {}) {
    if (!force && cached && now() - cached.at < ttlMs) return cached;
    return refresh();
  }

  /** Configured entry, if any. */
  function entryFor(priceId) {
    return config.prices.get(String(priceId || '')) || null;
  }

  /**
   * priceId -> { package, academy, known, sell, graceHours, unmapped }.
   * Configured prices resolve without I/O. Unconfigured ones are fetched once
   * (with product) and cached. A fetch failure throws, which the caller treats
   * as an incomplete snapshot (no revokes).
   */
  async function resolvePrice(priceId, recurringHint = null) {
    const entry = entryFor(priceId);
    if (entry) {
      return { priceId, package: entry.package, academy: true, known: true, sell: entry.sell,
        graceHours: graceHoursFor(entry.package, entry), unmapped: false,
        grantsAcademy: entry.academy !== false, externalRoles: [...(entry.roles || [])], line: entry.line || 'academy',
        cancelAfterDays: cancelAfterFor(entry.package, entry), trialDays: Number.isInteger(entry.trialDays) ? entry.trialDays : null,
        winback: Boolean(entry.winback), bonusAcademyDays: Number.isInteger(entry.bonusAcademyDays) ? entry.bonusAcademyDays : null };
    }
    const hit = unknownCache.get(priceId);
    if (hit && now() - hit.at < ttlMs) return hit.info;
    const price = await stripeApi.retrievePrice(priceId);
    const product = price && price.product && typeof price.product === 'object' ? price.product : null;
    const academy = Boolean(product && isAcademyMeta(product.metadata)) && Boolean(price.livemode) === Boolean(config.livemode);
    const pkg = inferPackage(price && price.recurring ? price.recurring : (recurringHint || null));
    /* An unconfigured Academy-product price grants the Academy role only:
       never an external role, and it holds every external revoke. */
    const info = { priceId, package: pkg, academy, known: false, sell: false,
      graceHours: graceHoursFor(pkg, null), unmapped: academy, productId: idOf(price && price.product),
      grantsAcademy: true, externalRoles: [], line: 'academy', cancelAfterDays: cancelAfterFor(pkg, null), trialDays: null };
    unknownCache.set(priceId, { at: now(), info });
    return info;
  }

  /** What a lifetime PaymentIntent on `priceId` grants (its price entry);
   *  unmapped = the price is not in the config (Academy lifetime assumed). */
  function lifetimeGrant(priceId) {
    const entry = entryFor(priceId);
    if (!entry) return { grantsAcademy: true, externalRoles: [], line: 'academy', unmapped: true };
    return { grantsAcademy: entry.academy !== false, externalRoles: [...(entry.roles || [])], line: entry.line || 'academy', unmapped: false };
  }

  return { refresh, get, entryFor, resolvePrice, lifetimeGrant };
}

module.exports = {
  EXPECTED,
  LABELS,
  DAILY_MAX_CHARGES,
  PERIOD_MIN_DAYS,
  cancelAfterFor,
  maxCharges,
  plainName,
  packageForRecurring,
  inferPackage,
  rolesFor,
  roleNames,
  ROLE_NAMES,
  isRecurring,
  graceHoursFor,
  intervalPhrase,
  validatePrice,
  describePrice,
  formatAmount,
  createCatalog
};
