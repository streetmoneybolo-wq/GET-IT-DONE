'use strict';

/* =============================================================================
 * MEM Academy billing: configuration.
 *
 * Pure. Reads SML_ACADEMY_BILLING_* (plus the few shared SML_ACADEMY_* keys the
 * engine needs) from an env object and returns one frozen config.
 *
 * Every flag is ON only when its value is exactly '1'. Every mode defaults to
 * 'off'. An empty env therefore yields an engine that does nothing at all,
 * which is what a merge of this code must do in production.
 *
 * Invalid config never half-enables the engine:
 *   - SML_ACADEMY_BILLING_ENABLED != '1'  -> { enabled:false, reason:'disabled' }
 *   - ENABLED=1 and the config is invalid -> throws (the service logs and keeps
 *     the rest of the Academy running with billing off)
 *   - ENABLED=1 and the billing guild differs from SML_ACADEMY_GUILD_ID
 *     -> { enabled:false, reason:'guild_mismatch' } (the engine refuses to
 *     write roles into a guild the Academy itself does not serve)
 *   - CHECKOUT_ENABLED=1 opens checkout only while ROLE_MODE=enforce: a buyer
 *     must never pay while the engine cannot queue their role (ROLE_MODE
 *     off / dry_run is therefore also a checkout kill switch)
 * ========================================================================== */

const PACKAGES = Object.freeze(['daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'yearly', 'lifetime']);

const MONARCH_ROLE_ID = '1260433215189946420';
const ELITE_ROLE_ID = '1192450618485395466';
const PREMIUM_ROLE_ID = '939031140679970867';
const FREE_TRIAL_ROLE_ID = '1542090070553526362';
const FREE_MEMBER_ROLE_ID = '1553281948527362100';

/* Roles that can never be an ENGINE role (Academy Student / the optional
   lifetime role, which the engine owns with strict desired-state semantics),
   whatever the env says. The env list can only ADD to this set. Monarch,
   Elite, Premium, Free Trial, FREE MEMBER. */
const DEFAULT_PROTECTED_ROLE_IDS = Object.freeze([
  MONARCH_ROLE_ID,
  ELITE_ROLE_ID,
  PREMIUM_ROLE_ID,
  FREE_TRIAL_ROLE_ID,
  FREE_MEMBER_ROLE_ID
]);

/* Roles the engine may never grant at all, not even as an external role:
   Free Trial, FREE MEMBER, plus the manager role and every id in
   SML_ACADEMY_BILLING_PROTECTED_ROLE_IDS (added at parse time). */
const NEVER_GRANT_ROLE_IDS = Object.freeze([FREE_TRIAL_ROLE_ID, FREE_MEMBER_ROLE_ID]);

/* EXTERNAL roles: roles a price (or a comp) may grant but the engine does not
   own, because Upgrade.Chat (or staff) also hand them out. They are
   GRANT-ONLY-UNLESS-SAFE: see external.js and academy_billing_external_grants.
   SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS replaces this default list. */
const DEFAULT_EXTERNAL_ROLE_IDS = Object.freeze([MONARCH_ROLE_ID, ELITE_ROLE_ID, PREMIUM_ROLE_ID]);

/* Upgrade.Chat product ids (UUIDs) in SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON;
   the same path-safety shape platform/upgrade-chat.js accepts. */
const UC_PRODUCT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_PRICE_ROLES = 10;

const DEFAULT_GRACE_HOURS = Object.freeze({
  daily: 2, weekly: 12, monthly: 72, quarterly: 72, semiannual: 72, yearly: 72, lifetime: 0
});

/* FREE TRIALS (per price): "trialDays" 1-30 on a recurring price; with
   "trialNoCard": true Checkout collects no payment method and the
   subscription cancels itself at the trial end if none was added. One free
   trial per Discord account across every product (academy_billing_trials +
   the member's Stripe subscriptions). */
const TRIAL_DAYS_MIN = 1;
const TRIAL_DAYS_MAX = 30;
/* AUTO-STOP (per price): "cancelAfterDays" 1-365 on a recurring price: after
   the subscription is created the engine sets cancel_at = subscription start
   + N days (idempotently). An Academy-line daily price (academy:true) without
   its own value stops after DEFAULT_DAILY_CANCEL_AFTER_DAYS (the Day plan's
   3-charge cap); a membership daily price has no default auto-stop. */
const CANCEL_AFTER_DAYS_MIN = 1;
const CANCEL_AFTER_DAYS_MAX = 365;
const DEFAULT_DAILY_CANCEL_AFTER_DAYS = 3;

/* SML_ACADEMY_BILLING_UC_MATCH: which Upgrade.Chat orders keep an external
   role the engine granted when its engine entitlement ends.
     any    (default) ANY active Upgrade.Chat upgrade of that Discord account
            (every product, hidden ones and one-time lifetime orders
            included) keeps the role; UC_ROLE_PRODUCTS_JSON is not needed
     mapped only the products SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON lists
            for that role count */
const UC_MATCH_MODES = Object.freeze(['any', 'mapped']);

/* SML_ACADEMY_BILLING_PAYMENT_METHODS (the default for every price without its
   own list) takes instant methods only: it applies to the recurring plans too,
   and a subscription paid by a delayed method turns active before the money
   clears. */
const INSTANT_PAYMENT_METHODS = Object.freeze(['card', 'link', 'cashapp', 'amazon_pay', 'revolut_pay']);

/* A price entry's own "paymentMethods" list is checked against this allowlist
   at config load. us_bank_account (ACH Direct Debit) is a DELAYED method: the
   Checkout Session completes with payment_status 'unpaid', the PaymentIntent
   sits in 'processing' for up to four business days, and the engine grants
   nothing until it reads 'succeeded'. It is therefore allowed only on a
   one-time lifetime price (see DELAYED_METHOD_PACKAGES). */
const PRICE_PAYMENT_METHODS = Object.freeze(['card', 'link', 'us_bank_account']);
const DELAYED_PAYMENT_METHODS = Object.freeze(['us_bank_account']);
const DELAYED_METHOD_PACKAGES = Object.freeze(['lifetime']);
/* Checkout payment_method_options[us_bank_account][verification_method]:
   'automatic' = instant verification through Stripe Financial Connections,
   falling back to manual account entry + microdeposits ('instant' would turn
   away every buyer whose bank Financial Connections cannot reach). */
const US_BANK_VERIFICATION_METHOD = 'automatic';

/* Stripe's own default portal configuration on MEM is shared with the store,
   Creator Tiers and subdomains. Never point the Academy at it. */
const FORBIDDEN_PORTAL_PREFIX = 'bpc_1R7qIy';

const SNOWFLAKE = /^[0-9]{15,24}$/;
const PRICE_ID = /^price_[A-Za-z0-9]+$/;

function flag(value) { return String(value == null ? '' : value).trim() === '1'; }
function text(value) { return String(value == null ? '' : value).trim(); }
function csv(value) { return text(value).split(',').map((item) => item.trim()).filter(Boolean); }
function mode(value, allowed, errors, name) {
  const raw = text(value);
  if (!raw) return 'off';
  if (!allowed.includes(raw)) { errors.push(`${name} must be one of ${allowed.join('|')}`); return 'off'; }
  return raw;
}
function positiveInt(value, fallback, min, max, errors, name) {
  const raw = text(value);
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) { errors.push(`${name} must be an integer ${min}-${max}`); return fallback; }
  return n;
}
function httpsUrl(value, errors, name, required) {
  const raw = text(value).replace(/\/+$/, '');
  if (!raw) { if (required) errors.push(`${name} is required`); return ''; }
  let parsed;
  try { parsed = new URL(raw); } catch (_) { errors.push(`${name} must be a URL`); return ''; }
  if (parsed.protocol !== 'https:') { errors.push(`${name} must be https`); return ''; }
  return raw;
}

/**
 * SML_ACADEMY_BILLING_PRICES_JSON:
 *   {"price_A":{"package":"monthly","sell":true,"graceHours":72},
 *    "price_L":{"package":"lifetime","paymentMethods":["card","us_bank_account"]},
 *    "price_OLD":{"package":"monthly","sell":false}}
 * Prices are never deleted from this map, only retired with sell:false. A
 * price that is missing is still recognised when its Stripe product carries
 * metadata sml_kind=mem_academy (see catalog.js), so forgetting an entry can
 * never cost a paying member the role.
 *
 * "paymentMethods" (optional) is the Checkout payment_method_types for that
 * price: a non-empty list from PRICE_PAYMENT_METHODS without repeats, with the
 * delayed us_bank_account only on a lifetime price. Without it the price uses
 * SML_ACADEMY_BILLING_PAYMENT_METHODS (default card,link).
 *
 * "roles" (optional) lists EXTERNAL role snowflakes the price grants while it
 * entitles the member (for example Monarch on the lifetime price). Each one
 * must be in SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS; Free Trial, FREE MEMBER,
 * the manager role and SML_ACADEMY_BILLING_PROTECTED_ROLE_IDS can never be
 * listed, and neither can the engine's own roles (those come from "academy").
 *
 * "academy" (optional, default true) also grants the engine-owned Academy
 * Student role (and, on a lifetime price, the optional lifetime role). A pure
 * membership product (an Upgrade.Chat-style Premium / Elite / Monarch plan
 * without the Academy) sets "academy": false and lists its "roles".
 *
 * Every price belongs to a LINE: "academy" for academy:true prices, else the
 * sorted set of its roles. Each line sells at most one sell:true price per
 * package, so the Academy Monthly and a Premium Monthly membership can both
 * be on sale.
 *
 * "trialDays" (optional, 1-30, recurring prices only) offers a free trial of
 * that many days to a Discord account that never had one (any product);
 * "trialNoCard" (optional, default false, needs trialDays) starts that trial
 * without collecting a payment method (the subscription cancels itself at
 * the trial end unless the member adds one).
 *
 * "cancelAfterDays" (optional, 1-365, recurring prices only): the engine sets
 * cancel_at = subscription start + N days. Unset on an Academy-line daily
 * price (academy:true) means 3 (the Day plan's 3-charge cap); unset elsewhere
 * (a membership daily price included) means no auto-stop. For a trial price
 * the start is the trial start, so trialDays 3 + cancelAfterDays 3 (Free
 * Trial Access) is three free days that never charge: the engine stops such
 * a free-only trial (trialDays >= cancelAfterDays) 10 minutes before its
 * trial ends (resync.js TRIAL_STOP_MARGIN_SEC), so Stripe never invoices it,
 * and such an offer is sold only with its trial: an account whose trial is
 * used is not offered it (pages.offerTerms trialOnly).
 * A price that would never charge only because of the Day plan default
 * (trialDays >= 3 without its own cancelAfterDays) is refused: a free-only
 * offer must say cancelAfterDays itself.
 *
 * An entry may carry only package, sell, graceHours, paymentMethods, roles,
 * academy, trialDays, trialNoCard and cancelAfterDays; any other key (a typo)
 * makes the config invalid.
 */
function parsePaymentMethods(priceId, pkg, value, errors) {
  if (!Array.isArray(value) || !value.length) {
    errors.push(`${priceId}: paymentMethods must be a non-empty list such as ["card","link"]`);
    return null;
  }
  const methods = [];
  for (const item of value) {
    const method = typeof item === 'string' ? item.trim() : '';
    if (!PRICE_PAYMENT_METHODS.includes(method)) {
      errors.push(`${priceId}: payment method ${JSON.stringify(String(item).slice(0, 30))} is not allowed (${PRICE_PAYMENT_METHODS.join(', ')})`);
      return null;
    }
    if (methods.includes(method)) { errors.push(`${priceId}: payment method ${method} is listed twice`); return null; }
    if (DELAYED_PAYMENT_METHODS.includes(method) && !DELAYED_METHOD_PACKAGES.includes(pkg)) {
      errors.push(`${priceId}: ${method} (bank debit) is only allowed on a one-time lifetime price; a ${pkg} subscription would turn active before the debit clears`);
      return null;
    }
    methods.push(method);
  }
  return Object.freeze(methods);
}

function hasDelayedMethod(methods) {
  return Array.isArray(methods) && methods.some((method) => DELAYED_PAYMENT_METHODS.includes(method));
}

/* The only keys a PRICES_JSON entry may carry. Anything else is refused, so a
   typo such as "payment_methods" can never silently drop the bank debit (or a
   graceHours) while the owner believes it is on. */
const PRICE_ENTRY_KEYS = Object.freeze(['package', 'sell', 'graceHours', 'paymentMethods', 'roles', 'academy',
  'trialDays', 'trialNoCard', 'cancelAfterDays', 'winback', 'introCents', 'bonusAcademyDays']);

/* WIN-BACK offers (owner decision 2026-09-27): a price with "winback": true is
   sold ONLY to the Discord accounts listed in SML_ACADEMY_BILLING_WINBACK_IDS
   (former $10 monthly members), only on /buy's "Welcome back" section, and
   only once per account (a Customer that ever had a win-back subscription,
   whatever its status, is not offered it again). "introCents" (optional)
   makes the first month cost that much through a one-time Stripe coupon; the
   price then renews at its own amount. "bonusAcademyDays" (optional, a
   membership price only) adds that many days of MEM Academy through a comp
   when the subscription starts. Win-back prices never compete with the
   regular sell:true price of their package. */
const INTRO_CENTS_MIN = 0;
const INTRO_CENTS_MAX = 100000;
const BONUS_ACADEMY_DAYS_MIN = 1;
const BONUS_ACADEMY_DAYS_MAX = 30;
const MAX_WINBACK_IDS = 20000;

/** An optional integer key of a price entry; undefined -> null, bad -> false. */
function entryInt(priceId, entry, key, min, max, errors) {
  if (entry[key] === undefined || entry[key] === null) return null;
  const n = entry[key];
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    errors.push(`${priceId}: ${key} must be an integer ${min}-${max}`);
    return false;
  }
  return n;
}

/** The line a price sells in: 'academy', or 'roles:<sorted role ids>'. */
function lineFor(academy, roles) {
  return academy ? 'academy' : `roles:${[...(roles || [])].map(String).sort().join('+')}`;
}

/** "roles" of one PRICES_JSON entry, or null (an error was recorded). */
function parsePriceRoles(priceId, value, errors, rules) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) { errors.push(`${priceId}: roles must be a list of role snowflakes such as ["${MONARCH_ROLE_ID}"]`); return null; }
  if (value.length > MAX_PRICE_ROLES) { errors.push(`${priceId}: roles lists more than ${MAX_PRICE_ROLES} roles`); return null; }
  const roles = [];
  for (const item of value) {
    const id = typeof item === 'string' ? item.trim() : '';
    if (!SNOWFLAKE.test(id)) { errors.push(`${priceId}: role ${JSON.stringify(String(item).slice(0, 30))} is not a role snowflake`); return null; }
    if (roles.includes(id)) { errors.push(`${priceId}: role ${id} is listed twice`); return null; }
    if (rules.neverGrant.has(id)) {
      errors.push(`${priceId}: role ${id} can never be granted (Manager, Free Trial, FREE MEMBER and SML_ACADEMY_BILLING_PROTECTED_ROLE_IDS)`);
      return null;
    }
    if (rules.engineRoleIds.has(id)) {
      errors.push(`${priceId}: role ${id} is an engine role; the Academy Student and lifetime roles come from "academy", not "roles"`);
      return null;
    }
    if (!rules.externalRoleIds.includes(id)) {
      errors.push(`${priceId}: role ${id} is not an external role; add it to SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS (default Monarch, Elite, Premium)`);
      return null;
    }
    roles.push(id);
  }
  return Object.freeze(roles);
}

function parsePrices(raw, errors, defaultMethods = Object.freeze(['card', 'link']),
  rules = { neverGrant: new Set(NEVER_GRANT_ROLE_IDS), engineRoleIds: new Set(), externalRoleIds: DEFAULT_EXTERNAL_ROLE_IDS }) {
  const prices = new Map();
  const source = text(raw);
  if (!source) return prices;
  let parsed;
  try { parsed = JSON.parse(source); } catch (_) { errors.push('SML_ACADEMY_BILLING_PRICES_JSON is not valid JSON'); return prices; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    errors.push('SML_ACADEMY_BILLING_PRICES_JSON must be an object keyed by price id');
    return prices;
  }
  const sellingPerPackage = new Map();
  for (const [priceId, entry] of Object.entries(parsed)) {
    if (!PRICE_ID.test(priceId)) { errors.push(`price id ${JSON.stringify(priceId.slice(0, 40))} is not a Stripe price id`); continue; }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { errors.push(`${priceId}: entry must be an object`); continue; }
    const unknown = Object.keys(entry).filter((key) => !PRICE_ENTRY_KEYS.includes(key));
    if (unknown.length) {
      errors.push(`${priceId}: unknown key ${JSON.stringify(unknown[0].slice(0, 30))} (allowed: ${PRICE_ENTRY_KEYS.join(', ')})`);
      continue;
    }
    const pkg = text(entry.package);
    if (!PACKAGES.includes(pkg)) { errors.push(`${priceId}: package must be one of ${PACKAGES.join('|')}`); continue; }
    if (entry.sell !== undefined && typeof entry.sell !== 'boolean') { errors.push(`${priceId}: sell must be true or false`); continue; }
    const sell = entry.sell === undefined ? true : entry.sell;
    let graceHours = DEFAULT_GRACE_HOURS[pkg];
    if (entry.graceHours !== undefined) {
      const g = Number(entry.graceHours);
      if (!Number.isInteger(g) || g < 0 || g > 168) { errors.push(`${priceId}: graceHours must be an integer 0-168`); continue; }
      graceHours = g;
    }
    let paymentMethods = defaultMethods;
    if (entry.paymentMethods !== undefined) {
      paymentMethods = parsePaymentMethods(priceId, pkg, entry.paymentMethods, errors);
      if (!paymentMethods) continue;
    }
    if (entry.academy !== undefined && typeof entry.academy !== 'boolean') { errors.push(`${priceId}: academy must be true or false`); continue; }
    const academy = entry.academy === undefined ? true : entry.academy;
    const roles = parsePriceRoles(priceId, entry.roles, errors, rules);
    if (!roles) continue;
    const trialDays = entryInt(priceId, entry, 'trialDays', TRIAL_DAYS_MIN, TRIAL_DAYS_MAX, errors);
    if (trialDays === false) continue;
    const ownCancelAfter = entryInt(priceId, entry, 'cancelAfterDays', CANCEL_AFTER_DAYS_MIN, CANCEL_AFTER_DAYS_MAX, errors);
    if (ownCancelAfter === false) continue;
    if (entry.trialNoCard !== undefined && typeof entry.trialNoCard !== 'boolean') { errors.push(`${priceId}: trialNoCard must be true or false`); continue; }
    const trialNoCard = entry.trialNoCard === true;
    if (pkg === 'lifetime' && (trialDays !== null || ownCancelAfter !== null || trialNoCard)) {
      errors.push(`${priceId}: trialDays, trialNoCard and cancelAfterDays are only allowed on a recurring price, not on lifetime`);
      continue;
    }
    if (trialNoCard && trialDays === null) { errors.push(`${priceId}: trialNoCard needs trialDays (the length of the free trial)`); continue; }
    const cancelAfterDays = ownCancelAfter !== null ? ownCancelAfter : (pkg === 'daily' && academy ? DEFAULT_DAILY_CANCEL_AFTER_DAYS : null);
    if (ownCancelAfter === null && cancelAfterDays !== null && trialDays !== null && trialDays >= cancelAfterDays) {
      /* The default 3-day stop would fall inside the trial: the plan would be
         free and never charge although nothing in the entry says so. */
      errors.push(`${priceId}: trialDays ${trialDays} with the default cancelAfterDays ${cancelAfterDays} of a daily Academy price would never charge; set "cancelAfterDays" explicitly (at most trialDays for a free-only offer, or above it for a paid plan)`);
      continue;
    }
    if (!academy && !roles.length) {
      errors.push(`${priceId}: academy:false with no "roles" grants nothing; list the membership role(s) or drop academy:false`);
      continue;
    }
    if (entry.winback !== undefined && typeof entry.winback !== 'boolean') { errors.push(`${priceId}: winback must be true or false`); continue; }
    const winback = entry.winback === true;
    const introCents = entryInt(priceId, entry, 'introCents', INTRO_CENTS_MIN, INTRO_CENTS_MAX, errors);
    if (introCents === false) continue;
    const bonusAcademyDays = entryInt(priceId, entry, 'bonusAcademyDays', BONUS_ACADEMY_DAYS_MIN, BONUS_ACADEMY_DAYS_MAX, errors);
    if (bonusAcademyDays === false) continue;
    if ((introCents !== null || bonusAcademyDays !== null) && !winback) {
      errors.push(`${priceId}: introCents and bonusAcademyDays are only allowed on a "winback": true price`);
      continue;
    }
    if (winback && pkg === 'lifetime') { errors.push(`${priceId}: a win-back price must be recurring, not lifetime`); continue; }
    if (winback && (trialDays !== null || ownCancelAfter !== null)) {
      errors.push(`${priceId}: a win-back price cannot also have trialDays or cancelAfterDays`);
      continue;
    }
    if (bonusAcademyDays !== null && academy) {
      errors.push(`${priceId}: bonusAcademyDays is only for a membership (academy:false) win-back price; an Academy price already includes the Academy`);
      continue;
    }
    const line = lineFor(academy, roles);
    if (sell && winback) {
      const key = `winback|${line}|${pkg}`;
      if (sellingPerPackage.has(key)) {
        errors.push(`two sell:true win-back prices for package ${pkg} in the same line (${sellingPerPackage.get(key)}, ${priceId}); retire one with sell:false`);
        continue;
      }
      sellingPerPackage.set(key, priceId);
    } else if (sell) {
      const key = `${line}|${pkg}`;
      if (sellingPerPackage.has(key)) {
        const where = academy ? '' : ` in the membership line ${roles.join('+')}`;
        errors.push(`two sell:true prices for package ${pkg}${where} (${sellingPerPackage.get(key)}, ${priceId}); retire one with sell:false`);
        continue;
      }
      sellingPerPackage.set(key, priceId);
    }
    prices.set(priceId, Object.freeze({ priceId, package: pkg, sell, graceHours, paymentMethods,
      ownPaymentMethods: entry.paymentMethods !== undefined, academy, roles, line, trialDays, trialNoCard, cancelAfterDays,
      winback, introCents, bonusAcademyDays }));
  }
  return prices;
}

/**
 * SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON: which Upgrade.Chat products grant
 * each external role, e.g.
 *   {"1260433215189946420":["<uc product uuid>","<uc lifetime product uuid>"],
 *    "939031140679970867":["<uc product uuid>"]}
 * A role mapped to [] is one no Upgrade.Chat product grants (a conclusive
 * "no UC membership"). A role missing from the map is never revoked
 * automatically.
 */
function parseUcRoleProducts(raw, externalRoleIds, errors) {
  const map = new Map();
  const source = text(raw);
  if (!source) return map;
  let parsed;
  try { parsed = JSON.parse(source); } catch (_) { errors.push('SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON is not valid JSON'); return map; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    errors.push('SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON must be an object keyed by role id');
    return map;
  }
  for (const [roleId, products] of Object.entries(parsed)) {
    if (!SNOWFLAKE.test(roleId)) { errors.push(`SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON: ${JSON.stringify(roleId.slice(0, 30))} is not a role snowflake`); continue; }
    if (!externalRoleIds.includes(roleId)) { errors.push(`SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON: role ${roleId} is not in SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS`); continue; }
    if (!Array.isArray(products) || products.length > 20) { errors.push(`SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON: role ${roleId} must map to a list of at most 20 Upgrade.Chat product ids`); continue; }
    const ids = [];
    let bad = false;
    for (const item of products) {
      const id = typeof item === 'string' ? item.trim() : '';
      if (!UC_PRODUCT_ID.test(id) || ids.includes(id)) { bad = true; break; }
      ids.push(id);
    }
    if (bad) { errors.push(`SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON: role ${roleId} lists an invalid or repeated Upgrade.Chat product id`); continue; }
    map.set(roleId, Object.freeze(ids));
  }
  return map;
}

function parseSkus(raw, errors) {
  const skus = new Map();
  const source = text(raw);
  if (!source) return skus;
  let parsed;
  try { parsed = JSON.parse(source); } catch (_) { errors.push('SML_ACADEMY_BILLING_DISCORD_SKUS_JSON is not valid JSON'); return skus; }
  for (const [sku, pkg] of Object.entries(parsed || {})) {
    if (!SNOWFLAKE.test(sku) || !['monthly', 'lifetime'].includes(String(pkg))) {
      errors.push('SML_ACADEMY_BILLING_DISCORD_SKUS_JSON maps a SKU snowflake to monthly|lifetime');
      continue;
    }
    skus.set(sku, String(pkg));
  }
  return skus;
}

function parseBillingConfig(env = process.env, { throwOnInvalid = true } = {}) {
  const errors = [];
  const warnings = [];
  const requested = flag(env.SML_ACADEMY_BILLING_ENABLED);

  const roleMode = mode(env.SML_ACADEMY_BILLING_ROLE_MODE, ['off', 'dry_run', 'enforce'], errors, 'SML_ACADEMY_BILLING_ROLE_MODE');
  const reconcileMode = mode(env.SML_ACADEMY_BILLING_RECONCILE_MODE, ['off', 'dry_run', 'apply'], errors, 'SML_ACADEMY_BILLING_RECONCILE_MODE');
  const scanRaw = text(env.SML_ACADEMY_BILLING_RECONCILE_SCAN) || 'known_ids';
  if (!['known_ids', 'members'].includes(scanRaw)) errors.push('SML_ACADEMY_BILLING_RECONCILE_SCAN must be known_ids|members');
  const reconcileScan = ['known_ids', 'members'].includes(scanRaw) ? scanRaw : 'known_ids';
  const reconcileIntervalMs = positiveInt(env.SML_ACADEMY_BILLING_RECONCILE_INTERVAL_MS, 900000, 60000, 86400000, errors, 'SML_ACADEMY_BILLING_RECONCILE_INTERVAL_MS');
  const maxRevokesPerRun = positiveInt(env.SML_ACADEMY_BILLING_MAX_REVOKES_PER_RUN, 10, 0, 1000, errors, 'SML_ACADEMY_BILLING_MAX_REVOKES_PER_RUN');
  /* Appending proxies in front of the service (rate-limit client address). */
  const proxyHops = positiveInt(env.SML_ACADEMY_BILLING_PROXY_HOPS, 1, 1, 5, errors, 'SML_ACADEMY_BILLING_PROXY_HOPS');

  const webhookSecrets = csv(env.SML_ACADEMY_BILLING_WEBHOOK_SECRET);
  for (const secret of webhookSecrets) if (!/^whsec_[A-Za-z0-9]+$/.test(secret)) errors.push('SML_ACADEMY_BILLING_WEBHOOK_SECRET entries must be whsec_ values');
  const platformSecrets = new Set(csv(env.SML_STRIPE_WEBHOOK_SECRET));
  if (webhookSecrets.some((secret) => platformSecrets.has(secret))) {
    errors.push('SML_ACADEMY_BILLING_WEBHOOK_SECRET must belong to the NEW Academy endpoint, not the platform endpoint');
  }

  const stripeKey = text(env.SML_ACADEMY_BILLING_STRIPE_KEY);
  let stripeKeyKind = null;
  let keyLivemode = null;
  if (stripeKey) {
    const m = /^(rk|sk)_(live|test)_[A-Za-z0-9]+$/.exec(stripeKey);
    if (!m) errors.push('SML_ACADEMY_BILLING_STRIPE_KEY must be an rk_live_/rk_test_ restricted key');
    else {
      stripeKeyKind = m[1] === 'rk' ? 'restricted' : 'secret';
      keyLivemode = m[2] === 'live';
      if (stripeKeyKind === 'secret') warnings.push('SML_ACADEMY_BILLING_STRIPE_KEY is a full secret key; a restricted rk_ key is expected');
    }
  }
  const livemode = flag(env.SML_ACADEMY_BILLING_LIVEMODE);
  if (keyLivemode !== null && keyLivemode !== livemode) errors.push('SML_ACADEMY_BILLING_LIVEMODE does not match the Stripe key mode');
  const stripeAccountId = text(env.SML_ACADEMY_BILLING_STRIPE_ACCOUNT_ID);
  if (stripeAccountId && !/^acct_[A-Za-z0-9]+$/.test(stripeAccountId)) errors.push('SML_ACADEMY_BILLING_STRIPE_ACCOUNT_ID must be an acct_ id');

  /* Unset (or blank) means card,link. A value that lists nothing (",") or a
     method twice is refused rather than guessed: an empty list must never
     reach Checkout, where it would fall back to the Dashboard's dynamic
     payment methods (which can include the bank debit). */
  const paymentMethods = csv(text(env.SML_ACADEMY_BILLING_PAYMENT_METHODS) || 'card,link');
  if (!paymentMethods.length) errors.push('SML_ACADEMY_BILLING_PAYMENT_METHODS must list at least one payment method (unset means card,link)');
  for (const [index, method] of paymentMethods.entries()) {
    if (!INSTANT_PAYMENT_METHODS.includes(method)) {
      errors.push(`payment method ${JSON.stringify(method.slice(0, 30))} is not an instant method (${INSTANT_PAYMENT_METHODS.join(', ')}); a bank debit belongs in the lifetime price's own "paymentMethods" in SML_ACADEMY_BILLING_PRICES_JSON`);
    } else if (paymentMethods.indexOf(method) !== index) {
      errors.push(`SML_ACADEMY_BILLING_PAYMENT_METHODS: payment method ${method} is listed twice`);
    }
  }
  const managerRoleId = text(env.SML_ACADEMY_MANAGER_ROLE_ID);
  const protectedRoleIds = new Set(DEFAULT_PROTECTED_ROLE_IDS);
  const neverGrantRoleIds = new Set(NEVER_GRANT_ROLE_IDS);
  if (managerRoleId) { protectedRoleIds.add(managerRoleId); neverGrantRoleIds.add(managerRoleId); }
  for (const id of csv(env.SML_ACADEMY_BILLING_PROTECTED_ROLE_IDS)) {
    if (!SNOWFLAKE.test(id)) errors.push('SML_ACADEMY_BILLING_PROTECTED_ROLE_IDS must be role snowflakes');
    else { protectedRoleIds.add(id); neverGrantRoleIds.add(id); }
  }
  const academyRoleId = text(env.SML_ACADEMY_BILLING_ACADEMY_ROLE_ID);
  /* Optional: the owner decided (2026-09-26) that Lifetime grants the existing
     Monarch role through the lifetime price's "roles" instead of a separate
     MEM Lifetime role. Leave it unset. */
  const lifetimeRoleId = text(env.SML_ACADEMY_BILLING_LIFETIME_ROLE_ID);
  for (const [name, id] of [['SML_ACADEMY_BILLING_ACADEMY_ROLE_ID', academyRoleId], ['SML_ACADEMY_BILLING_LIFETIME_ROLE_ID', lifetimeRoleId]]) {
    if (!id) continue;
    if (!SNOWFLAKE.test(id)) errors.push(`${name} must be a role snowflake`);
    else if (protectedRoleIds.has(id)) errors.push(`${name} is a protected role (Monarch/Elite/Premium/Free Trial/FREE MEMBER/manager); the engine only owns its own roles, and Monarch, Elite and Premium can only be granted as external roles through a price "roles" list`);
  }
  if (academyRoleId && lifetimeRoleId && academyRoleId === lifetimeRoleId) errors.push('the Academy and Lifetime engine roles must be different roles');
  const engineRoleIdSet = new Set([academyRoleId, lifetimeRoleId].filter(Boolean));

  /* EXTERNAL roles (grant-only-unless-safe). Unset or blank = Monarch, Elite,
     Premium. */
  const externalRaw = csv(env.SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS);
  const externalRoleIds = [];
  for (const id of externalRaw.length ? externalRaw : DEFAULT_EXTERNAL_ROLE_IDS) {
    if (!SNOWFLAKE.test(id)) { errors.push('SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS must be role snowflakes'); continue; }
    if (neverGrantRoleIds.has(id)) { errors.push(`SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS: ${id} can never be granted (Manager, Free Trial, FREE MEMBER, SML_ACADEMY_BILLING_PROTECTED_ROLE_IDS)`); continue; }
    if (engineRoleIdSet.has(id)) { errors.push(`SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS: ${id} is an engine role (Academy Student / lifetime role)`); continue; }
    if (!externalRoleIds.includes(id)) externalRoleIds.push(id);
  }

  const prices = parsePrices(env.SML_ACADEMY_BILLING_PRICES_JSON, errors, Object.freeze(paymentMethods.slice()),
    { neverGrant: neverGrantRoleIds, engineRoleIds: engineRoleIdSet, externalRoleIds });

  /* Upgrade.Chat check for EXTERNAL revokes. The client credentials are the
     platform's existing UPGRADE_CHAT_CLIENT_ID / UPGRADE_CHAT_CLIENT_SECRET
     (platform/config.js); the map says which UC products grant which role.
     Without both, an engine-granted external role is never removed: it is
     parked as needs_review instead. */
  const ucClientId = text(env.UPGRADE_CHAT_CLIENT_ID);
  const ucClientSecret = text(env.UPGRADE_CHAT_CLIENT_SECRET);
  const ucRoleProducts = parseUcRoleProducts(env.SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON, externalRoleIds, errors);
  const ucConfigured = Boolean(ucClientId && ucClientSecret);
  /* Default 'any': every active Upgrade.Chat upgrade of the member keeps an
     engine-granted external role (hidden products and one-time lifetime
     orders included); 'mapped' counts only the products mapped to the role. */
  const ucMatchRaw = text(env.SML_ACADEMY_BILLING_UC_MATCH) || 'any';
  if (!UC_MATCH_MODES.includes(ucMatchRaw)) errors.push(`SML_ACADEMY_BILLING_UC_MATCH must be one of ${UC_MATCH_MODES.join('|')}`);
  const ucMatch = UC_MATCH_MODES.includes(ucMatchRaw) ? ucMatchRaw : 'any';
  const grantedExternal = new Set([...prices.values()].flatMap((entry) => entry.roles || []));
  if (grantedExternal.size && !ucConfigured) {
    warnings.push('UPGRADE_CHAT_CLIENT_ID / UPGRADE_CHAT_CLIENT_SECRET are not set: an engine-granted external role (Monarch/Elite/Premium) is never removed automatically; it is listed by external-review instead');
  }
  if (ucMatch === 'mapped') {
    for (const id of grantedExternal) {
      if (!ucRoleProducts.has(id)) warnings.push(`external role ${id} has no entry in SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON: its engine grants are never removed automatically (needs_review); map it to its Upgrade.Chat products, or to [] if no Upgrade.Chat product grants it`);
    }
  } else if (ucRoleProducts.size) {
    warnings.push('SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON is not used while SML_ACADEMY_BILLING_UC_MATCH=any: any active Upgrade.Chat upgrade of the member keeps an engine-granted external role');
  }

  const guildId = text(env.SML_ACADEMY_BILLING_GUILD_ID);
  const academyGuildId = text(env.SML_ACADEMY_GUILD_ID);
  if (guildId && !SNOWFLAKE.test(guildId)) errors.push('SML_ACADEMY_BILLING_GUILD_ID must be a guild snowflake');

  const portalConfigId = text(env.SML_ACADEMY_BILLING_PORTAL_CONFIG_ID);
  if (portalConfigId && !/^bpc_[A-Za-z0-9]+$/.test(portalConfigId)) errors.push('SML_ACADEMY_BILLING_PORTAL_CONFIG_ID must be a bpc_ id');
  if (portalConfigId.startsWith(FORBIDDEN_PORTAL_PREFIX)) errors.push('SML_ACADEMY_BILLING_PORTAL_CONFIG_ID is the shared default portal; create a dedicated Academy configuration');

  const publicUrl = httpsUrl(env.SML_ACADEMY_BILLING_PUBLIC_URL, errors, 'SML_ACADEMY_BILLING_PUBLIC_URL', requested);
  const inviteUrl = httpsUrl(env.SML_ACADEMY_BILLING_INVITE_URL, errors, 'SML_ACADEMY_BILLING_INVITE_URL', false);
  const termsUrl = httpsUrl(env.SML_ACADEMY_BILLING_TERMS_URL || 'https://stockmarketloop.com/academy-terms/', errors, 'SML_ACADEMY_BILLING_TERMS_URL', false);
  const privacyUrl = httpsUrl(env.SML_ACADEMY_BILLING_PRIVACY_URL || 'https://stockmarketloop.com/academy-privacy/', errors, 'SML_ACADEMY_BILLING_PRIVACY_URL', false);
  const consentVersion = text(env.SML_ACADEMY_BILLING_CONSENT_VERSION);
  if (consentVersion && !/^[A-Za-z0-9._-]{1,64}$/.test(consentVersion)) errors.push('SML_ACADEMY_BILLING_CONSENT_VERSION must be a short version label such as 2026-10-01');

  /* Buyers who are not in the server are shown the invite on /buy and on
     the success page; without one they are told to ask staff. */
  if ((flag(env.SML_ACADEMY_BILLING_ALLOW_NON_MEMBER) || flag(env.SML_ACADEMY_BILLING_AUTO_JOIN)) && !inviteUrl) {
    warnings.push('SML_ACADEMY_BILLING_INVITE_URL is not set: buyers who are not in the server are told to ask staff for an invite');
  }

  const checkoutEnabled = flag(env.SML_ACADEMY_BILLING_CHECKOUT_ENABLED);
  if (checkoutEnabled && roleMode !== 'enforce') {
    warnings.push('SML_ACADEMY_BILLING_CHECKOUT_ENABLED=1 has no effect until SML_ACADEMY_BILLING_ROLE_MODE=enforce (a buyer must never pay without a role being queued)');
  }
  const testClock = flag(env.SML_ACADEMY_BILLING_TEST_CLOCK);
  if (testClock && livemode) errors.push('SML_ACADEMY_BILLING_TEST_CLOCK is test-mode only and is refused when LIVEMODE=1');
  const discordSkusEnabled = flag(env.SML_ACADEMY_BILLING_DISCORD_SKUS_ENABLED);
  const discordSkus = parseSkus(env.SML_ACADEMY_BILLING_DISCORD_SKUS_JSON, errors);
  if (discordSkusEnabled) warnings.push('SML_ACADEMY_BILLING_DISCORD_SKUS_ENABLED is phase 2 and has no effect in this build');

  const accessRoleIds = csv(env.SML_ACADEMY_ACCESS_ROLE_IDS).filter((id) => SNOWFLAKE.test(id));
  /* Default '1' keeps today's gate (Monarch admitted). Only an explicit '0'
     removes Monarch; the legacy verified-payer roster that should replace it
     is phase 2. This engine never reads it; it is reported by `status`. */
  const monarchAccess = text(env.SML_ACADEMY_MONARCH_ACCESS == null ? '1' : env.SML_ACADEMY_MONARCH_ACCESS) !== '0';

  /* Who may see and buy the win-back prices: Discord ids separated by commas,
     spaces or new lines. */
  const winbackIds = new Set();
  const winbackRaw = text(env.SML_ACADEMY_BILLING_WINBACK_IDS).split(/[\s,;]+/).map((item) => item.replace(/^'+|'+$/g, '')).filter(Boolean);
  const badWinback = winbackRaw.filter((id) => !SNOWFLAKE.test(id));
  if (badWinback.length) errors.push(`SML_ACADEMY_BILLING_WINBACK_IDS has ${badWinback.length} entr${badWinback.length === 1 ? 'y' : 'ies'} that are not Discord ids`);
  else if (winbackRaw.length > MAX_WINBACK_IDS) errors.push(`SML_ACADEMY_BILLING_WINBACK_IDS lists more than ${MAX_WINBACK_IDS} ids`);
  else for (const id of winbackRaw) winbackIds.add(id);
  const winbackOnSale = [...prices.values()].some((entry) => entry.winback && entry.sell);
  if (winbackOnSale && !winbackIds.size) warnings.push('a win-back price is on sale but SML_ACADEMY_BILLING_WINBACK_IDS is empty: nobody is offered it');

  const botToken = text(env.SML_ACADEMY_BOT_TOKEN);
  const appId = text(env.SML_ACADEMY_APP_ID);
  const clientSecret = text(env.SML_ACADEMY_CLIENT_SECRET);

  if (requested) {
    if (!webhookSecrets.length) errors.push('SML_ACADEMY_BILLING_WEBHOOK_SECRET is required');
    if (!stripeKey) errors.push('SML_ACADEMY_BILLING_STRIPE_KEY is required');
    if (!stripeAccountId) errors.push('SML_ACADEMY_BILLING_STRIPE_ACCOUNT_ID is required');
    if (!academyRoleId) errors.push('SML_ACADEMY_BILLING_ACADEMY_ROLE_ID is required');
    if (!guildId) errors.push('SML_ACADEMY_BILLING_GUILD_ID is required');
    if (!botToken) errors.push('SML_ACADEMY_BOT_TOKEN is required');
    if (!SNOWFLAKE.test(appId)) errors.push('SML_ACADEMY_APP_ID is required');
    if (!clientSecret) errors.push('SML_ACADEMY_CLIENT_SECRET is required');
    if (checkoutEnabled && !consentVersion) errors.push('SML_ACADEMY_BILLING_CONSENT_VERSION is required before checkout can open');
    if (checkoutEnabled && ![...prices.values()].some((entry) => entry.sell && !entry.winback) && !winbackOnSale) errors.push('checkout needs at least one sell:true price');
  }

  let enabled = false;
  let reason = null;
  if (!requested) reason = 'disabled';
  else if (errors.length) reason = 'invalid_config';
  else if (guildId !== academyGuildId) reason = 'guild_mismatch';
  else enabled = true;

  if (requested && errors.length && throwOnInvalid) {
    const error = new Error(`academy_billing_config_invalid: ${errors.join('; ')}`);
    error.code = 'academy_billing_config_invalid';
    error.errors = errors.slice();
    throw error;
  }

  return Object.freeze({
    requested,
    enabled,
    reason,
    errors: Object.freeze(errors.slice()),
    warnings: Object.freeze(warnings.slice()),
    checkoutEnabled: enabled && checkoutEnabled && roleMode === 'enforce',
    checkoutRequested: checkoutEnabled,
    roleMode,
    revokesEnabled: flag(env.SML_ACADEMY_BILLING_REVOKES_ENABLED),
    reconcileMode,
    reconcileIntervalMs,
    reconcileScan,
    maxRevokesPerRun,
    proxyHops,
    webhookSecrets: Object.freeze(webhookSecrets),
    stripeKey,
    stripeKeyKind,
    stripeAccountId,
    livemode,
    prices,
    winbackIds,
    academyRoleId,
    lifetimeRoleId,
    engineRoleIds: Object.freeze({ academy: academyRoleId, mem_lifetime: lifetimeRoleId }),
    protectedRoleIds,
    neverGrantRoleIds,
    externalRoleIds: Object.freeze(externalRoleIds),
    ucClientId,
    ucClientSecret,
    ucConfigured,
    ucRoleProducts,
    ucMatch,
    guildId,
    academyGuildId,
    botToken,
    appId,
    clientSecret,
    managerRoleId,
    portalConfigId,
    publicUrl,
    inviteUrl,
    termsUrl,
    privacyUrl,
    consentVersion,
    tosConsent: flag(env.SML_ACADEMY_BILLING_TOS_CONSENT),
    automaticTax: flag(env.SML_ACADEMY_BILLING_AUTOMATIC_TAX),
    paymentMethods: Object.freeze(paymentMethods),
    allowNonMember: flag(env.SML_ACADEMY_BILLING_ALLOW_NON_MEMBER),
    autoJoin: flag(env.SML_ACADEMY_BILLING_AUTO_JOIN),
    partialRefundRevokes: flag(env.SML_ACADEMY_BILLING_PARTIAL_REFUND_REVOKES),
    cancelOnRefund: flag(env.SML_ACADEMY_BILLING_CANCEL_ON_REFUND),
    inDiscordLinks: flag(env.SML_ACADEMY_BILLING_IN_DISCORD_LINKS),
    seenNotify: flag(env.SML_ACADEMY_BILLING_SEEN_NOTIFY),
    discordSkusEnabled,
    discordSkus,
    testClock,
    accessRoleIds: Object.freeze(accessRoleIds),
    monarchAccess
  });
}

/** Safe summary for logs and the CLI: flags and ids only, never secrets. */
function describeConfig(config) {
  return {
    requested: config.requested,
    enabled: config.enabled,
    reason: config.reason,
    checkout: config.checkoutEnabled,
    roleMode: config.roleMode,
    revokes: config.revokesEnabled,
    reconcileMode: config.reconcileMode,
    reconcileScan: config.reconcileScan,
    maxRevokesPerRun: config.maxRevokesPerRun,
    proxyHops: config.proxyHops,
    livemode: config.livemode,
    stripeAccountId: config.stripeAccountId || null,
    stripeKeyKind: config.stripeKeyKind,
    webhookSecretCount: config.webhookSecrets.length,
    guildId: config.guildId || null,
    academyRoleId: config.academyRoleId || null,
    lifetimeRoleId: config.lifetimeRoleId || null,
    prices: [...config.prices.values()].map((entry) => ({ priceId: entry.priceId, package: entry.package, sell: entry.sell, graceHours: entry.graceHours,
      paymentMethods: entry.paymentMethods, academy: entry.academy, roles: entry.roles, trialDays: entry.trialDays, trialNoCard: entry.trialNoCard,
      cancelAfterDays: entry.cancelAfterDays, winback: entry.winback, introCents: entry.introCents, bonusAcademyDays: entry.bonusAcademyDays })),
    winbackIdCount: config.winbackIds ? config.winbackIds.size : 0,
    externalRoleIds: config.externalRoleIds,
    ucConfigured: config.ucConfigured,
    ucMatch: config.ucMatch,
    ucRoleProducts: Object.fromEntries([...config.ucRoleProducts.entries()].map(([roleId, products]) => [roleId, products.length])),
    portalConfigured: Boolean(config.portalConfigId),
    publicUrl: config.publicUrl || null,
    consentVersion: config.consentVersion || null,
    paymentMethods: config.paymentMethods,
    allowNonMember: config.allowNonMember,
    autoJoin: config.autoJoin,
    inviteConfigured: Boolean(config.inviteUrl),
    partialRefundRevokes: config.partialRefundRevokes,
    cancelOnRefund: config.cancelOnRefund,
    inDiscordLinks: config.inDiscordLinks,
    seenNotify: config.seenNotify,
    testClock: config.testClock,
    monarchAccess: config.monarchAccess,
    accessRoleIds: config.accessRoleIds,
    errors: config.errors,
    warnings: config.warnings
  };
}

module.exports = {
  PACKAGES,
  DEFAULT_PROTECTED_ROLE_IDS,
  DEFAULT_EXTERNAL_ROLE_IDS,
  NEVER_GRANT_ROLE_IDS,
  MONARCH_ROLE_ID,
  ELITE_ROLE_ID,
  PREMIUM_ROLE_ID,
  FREE_TRIAL_ROLE_ID,
  FREE_MEMBER_ROLE_ID,
  lineFor,
  DEFAULT_GRACE_HOURS,
  TRIAL_DAYS_MIN,
  TRIAL_DAYS_MAX,
  CANCEL_AFTER_DAYS_MIN,
  CANCEL_AFTER_DAYS_MAX,
  DEFAULT_DAILY_CANCEL_AFTER_DAYS,
  UC_MATCH_MODES,
  INSTANT_PAYMENT_METHODS,
  PRICE_PAYMENT_METHODS,
  PRICE_ENTRY_KEYS,
  BONUS_ACADEMY_DAYS_MAX,
  DELAYED_PAYMENT_METHODS,
  US_BANK_VERIFICATION_METHOD,
  hasDelayedMethod,
  SNOWFLAKE,
  parseBillingConfig,
  describeConfig,
  flag
};
