/* =============================================================================
 * platform/corporate-feed.js — eligibility, relevance, and the reserved slot
 *
 * THE 80% IS A CEILING POLICY, NOT A FILL QUOTA.
 * Corporate reach rate = the share of signed-in feed SESSIONS in which at least
 * one corporate item appears within the first 20 cards. Target 80%. When there
 * is not enough eligible corporate content the slot stays EMPTY and reach sits
 * below target — that is correct behaviour. Nothing in this file may backfill a
 * corporate slot with non-corporate content, and nothing may re-show the same
 * item to the same user to hit a number.
 *
 * FAIL CLOSED. Every rail in js/home-feed.js returns null on empty rather than
 * rendering a shell, which is why a dead endpoint has never broken the feed.
 * The corporate slot inherits that: no candidates means no slot, never filler.
 *
 * BOOSTS RANK, THEY NEVER BILL. Multiplying where a partner ranks is a benefit
 * they bought; multiplying what they are charged is fraud. Billing lives in
 * corporate-billing.js and nothing here touches it. If you are about to
 * "simplify" by passing a boost into a price, stop.
 *
 * BOOSTS DO NOT STACK. Corporate-organic and paid-promo are the same 1.5x, and
 * an item that is both takes the maximum, not the product. Stacking to 2.25x
 * lets one advertiser own every slot, which burns the inventory being sold.
 * ========================================================================== */

'use strict';

const crypto = require('node:crypto');

/** Reserved slot index: after the breaking-news pin and the uploads rail at 3. */
const SLOT_INDEX = 4;

/** The window the reach rate is measured over. Cards, not screens. */
const REACH_WINDOW = 20;

const POLICY = Object.freeze({
  relevanceFloor: 0.35,
  /* Per user, per corporate account, per day. */
  dailySlotCap: 2,
  /* Per corporate account, per day, across all users: the rest compete
   * organically only. Stops a publisher flooding the slot with volume. */
  slotEligiblePostsPerDay: 5,
  maxItemAgeMs: 24 * 3600 * 1000,
  hideSuppressionMs: 7 * 24 * 3600 * 1000,
  recencyHalfLifeMs: 6 * 3600 * 1000,
  corporateBoost: 1.5,
  promoBoost: 1.5,
  /* Hide rate over 7d above this drops the boost to 1.0 automatically. No
   * meeting required — the metric is the decision. */
  hideRateDemotion: 0.08,
  holdoutPercent: 10
});

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/* ------------------------------------------------------------- the holdout */

/**
 * Is this user permanently held out of corporate slots?
 *
 * On from day one, per the design: without a holdout there is no way to tell
 * whether the slot policy is hurting the feed. If the holdout's session length
 * is materially BETTER, the policy is too aggressive regardless of what
 * advertisers are paying.
 *
 * Deterministic and stable: the same user is in the same bucket forever, with
 * no stored assignment to migrate. CHANGING THE SALT RE-ROLLS EVERY BUCKET and
 * destroys the comparability of any experiment already running — treat it as a
 * permanent constant, not a tunable.
 */
function isHeldOut(userId, { salt = 'sml-corporate-holdout-v1', percent = POLICY.holdoutPercent } = {}) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id < 1) return true;   // unknown user: no slot
  const digest = crypto.createHash('sha256').update(`${salt}:${id}`).digest();
  return (digest.readUInt32BE(0) % 1000) < Math.round(percent * 10);
}

/* ----------------------------------------------------------- the relevance */

function tickerOverlap(itemTickers, watchlist) {
  const tickers = Array.isArray(itemTickers) ? itemTickers : [];
  const watched = watchlist instanceof Set ? watchlist
    : new Set(Array.isArray(watchlist) ? watchlist : []);
  if (!tickers.length || !watched.size) return 0;
  const upper = new Set([...watched].map((t) => String(t).toUpperCase()));
  const hits = tickers.filter((t) => upper.has(String(t).toUpperCase())).length;
  return clamp01(hits / tickers.length);
}

function categoryAffinity(category, profile) {
  if (!category || !profile || typeof profile !== 'object') return 0;
  const affinities = profile.categoryAffinity;
  if (!affinities || typeof affinities !== 'object') return 0;
  return clamp01(affinities[category]);
}

function recencyDecay(ageMs, halfLifeMs = POLICY.recencyHalfLifeMs) {
  const age = Number(ageMs);
  if (!Number.isFinite(age) || age < 0) return 0;
  return Math.pow(0.5, age / halfLifeMs);
}

/**
 * relevance(item, user) in [0, 1].
 *
 * engagement_rate_7d is the term that does the real safeguarding work: an
 * account whose slots are ignored loses relevance automatically, with nobody
 * filing a complaint or writing a rule. Ticker overlap is weighted hardest
 * because it is the strongest signal this platform actually has.
 */
function relevance(item = {}, user = {}, { now = Date.now, policy = POLICY } = {}) {
  const ageMs = item.publishedAt == null ? Infinity : now() - Date.parse(item.publishedAt);
  return clamp01(
      0.45 * tickerOverlap(item.tickers, user.watchlist)
    + 0.25 * categoryAffinity(item.category, user.onboardingProfile)
    + 0.20 * clamp01(item.engagementRate7d)
    + 0.10 * recencyDecay(ageMs, policy.recencyHalfLifeMs)
  );
}

/* ---------------------------------------------------------- the eligibility */

/**
 * Why an item may not take the reserved slot, or null when it may.
 *
 * Returns the REASON rather than a boolean: when reach sits under target the
 * only useful question is which gate is rejecting inventory, and a boolean
 * cannot answer it. The design says to widen the floor before raising the cap —
 * that ordering is only decidable from these counts.
 */
function slotRejection(item = {}, user = {}, context = {}, { now = Date.now, policy = POLICY } = {}) {
  const {
    activeCorporateIds = new Set(),
    hiddenSources = new Map(),
    slotsShownToday = new Map(),
    slotEligibleUsedToday = new Map()
  } = context;

  const corporateId = Number(item.corporateId);
  if (!Number.isSafeInteger(corporateId) || corporateId < 1) return 'not_corporate';
  if (!activeCorporateIds.has(corporateId)) return 'not_active';

  const ageMs = item.publishedAt == null ? Infinity : now() - Date.parse(item.publishedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= policy.maxItemAgeMs) return 'stale';

  /* A hide is the strongest negative signal a user ever gives. It outranks
   * every positive term, so it is checked before relevance is computed. */
  const hiddenAt = hiddenSources.get(corporateId);
  if (hiddenAt != null && now() - Number(hiddenAt) < policy.hideSuppressionMs) return 'user_hid_source';

  if (Number(slotsShownToday.get(corporateId) || 0) >= policy.dailySlotCap) return 'user_frequency_cap';
  if (Number(slotEligibleUsedToday.get(corporateId) || 0) >= policy.slotEligiblePostsPerDay) {
    return 'account_daily_cap';
  }

  if (relevance(item, user, { now, policy }) < policy.relevanceFloor) return 'below_relevance_floor';
  return null;
}

/** The highest-relevance eligible item, or null. Null means an EMPTY slot. */
function selectSlotItem(items, user, context, opts = {}) {
  const { now = Date.now, policy = POLICY } = opts;
  const eligible = (Array.isArray(items) ? items : [])
    .filter((item) => item && slotRejection(item, user, context, { now, policy }) === null);
  if (!eligible.length) return null;

  return eligible
    .map((item) => ({ item, r: relevance(item, user, { now, policy }) }))
    /* Tie-break on id so the same inputs always produce the same slot — an
     * unstable pick makes any reach measurement unreproducible. */
    .sort((a, b) => (b.r - a.r) || String(a.item.id).localeCompare(String(b.item.id)))[0].item;
}

/* ---------------------------------------------------------------- the boost */

/**
 * The rank multiplier for one corporate account. RANK ONLY — see the header.
 *
 * Hide rate over 7d above the threshold drops it to 1.0 automatically. The
 * denominator is total impressions, so an account with barely any delivery
 * cannot be demoted by one or two hides on a handful of views.
 */
function boostFor(account = {}, metrics = {}, { policy = POLICY } = {}) {
  if (!account.active) return 1;

  const impressions = Number(metrics.slotImpressions || 0) + Number(metrics.organicImpressions || 0);
  if (impressions >= 100) {
    const hideRate = Number(metrics.hides || 0) / impressions;
    if (hideRate > policy.hideRateDemotion) return 1;
  }

  /* MAX, not product: see "boosts do not stack" in the header. */
  return account.promoted
    ? Math.max(policy.corporateBoost, policy.promoBoost)
    : policy.corporateBoost;
}

/* ----------------------------------------------------------------- the feed */

/**
 * Apply the weighted organic path and the reserved slot.
 *
 * Returns { items, slot, reason }. `slot` is the promoted item or null, and
 * `reason` says why there is no slot — 'disabled', 'holdout' or 'no_candidates'
 * — which is what makes a reach shortfall diagnosable rather than mysterious.
 *
 * The promoted item is REMOVED from the organic list before insertion, so the
 * slot can never duplicate a card the user was already going to see. Dedup
 * downstream must stay authoritative like the breaking pin: insert first, THEN
 * mark seenItemIds. Gating on the boot-preseeded set makes the slot silently
 * vanish whenever the item is also server-rendered.
 */
function buildFeed({ user = {}, items = [], context = {}, enabled = false } = {}, opts = {}) {
  const { now = Date.now, policy = POLICY, holdout = {} } = opts;
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const accounts = context.accounts instanceof Map ? context.accounts : new Map();

  const ranked = list
    .map((item) => {
      const account = accounts.get(Number(item.corporateId));
      const boost = account ? boostFor(account, account.metrics || {}, { policy }) : 1;
      return { ...item, rank: Number(item.score || 0) * boost };
    })
    .sort((a, b) => (b.rank - a.rank) || String(a.id).localeCompare(String(b.id)));

  /* The flag gates the SLOT, not the badge and not organic weighting — those
   * ship in earlier steps and are not experimental. */
  if (!enabled) return { items: ranked, slot: null, reason: 'disabled' };
  if (isHeldOut(user.id, holdout)) return { items: ranked, slot: null, reason: 'holdout' };

  const pick = selectSlotItem(list, user, context, { now, policy });
  if (!pick) return { items: ranked, slot: null, reason: 'no_candidates' };

  const out = ranked.filter((x) => x.id !== pick.id);
  out.splice(Math.min(SLOT_INDEX, out.length), 0, { ...pick, promoted: true, slotIndex: SLOT_INDEX });
  return { items: out, slot: pick, reason: null };
}

/* ---------------------------------------------------------- the measurement */

/**
 * Corporate reach rate over a set of sessions.
 *
 * Held-out sessions are reported SEPARATELY rather than dropped: they are the
 * control arm, and averaging them into the headline number both understates
 * reach and hides the comparison the holdout exists to provide.
 */
function reachRate(sessions = [], { window = REACH_WINDOW } = {}) {
  let exposed = 0;
  let measured = 0;
  let heldOut = 0;

  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (!session) continue;
    if (session.heldOut) { heldOut += 1; continue; }
    measured += 1;
    const positions = Array.isArray(session.corporatePositions) ? session.corporatePositions : [];
    if (positions.some((p) => Number.isFinite(Number(p)) && Number(p) < window)) exposed += 1;
  }

  return {
    rate: measured ? exposed / measured : 0,
    exposedSessions: exposed,
    measuredSessions: measured,
    heldOutSessions: heldOut,
    window
  };
}

module.exports = {
  SLOT_INDEX,
  REACH_WINDOW,
  POLICY,
  isHeldOut,
  relevance,
  tickerOverlap,
  recencyDecay,
  slotRejection,
  selectSlotItem,
  boostFor,
  buildFeed,
  reachRate
};
