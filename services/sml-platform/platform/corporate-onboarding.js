/* =============================================================================
 * platform/corporate-onboarding.js — the questionnaire and the 15-card pool
 *
 * WHERE THIS RUNS: after sml-members/v1 `verify` succeeds, never inside the
 * signup card. That card is hardened, carries the hashcash PoW handshake, and
 * is explicitly not to be modified.
 *
 * CORPORATE IS CAPPED AT 3 OF 15. Above that the screen stops being a
 * recommendation and becomes an ad unit, and a new user's first impression of
 * the product becomes "this is where brands shout at me". The cap is enforced
 * here, in the builder, so no caller can raise it by passing more corporate
 * cards in.
 *
 * EVERY QUESTION DRIVES A STORED SIGNAL. A question that changes nothing is a
 * question that should not be asked, so each entry below names what it feeds
 * and buildProfile is the only place those signals are produced.
 *
 * Question 10 is the load-bearing one: it lets a user CHOOSE less corporate
 * content. A user who asked for headlines only and still gets two promoted
 * slots a day will hide them — and `hides` is the metric that ends up demoting
 * the advertiser you were paid to promote.
 * ========================================================================== */

'use strict';

const REQUIRED_SELECTIONS = 5;
const POOL_SIZE = 15;
const MAX_CORPORATE_CARDS = 3;
const MAX_WATCHLIST = 5;

function invalid(message) { return new TypeError(message); }

/* ------------------------------------------------------------- the questions */

const QUESTIONS = Object.freeze([
  { id: 'instrument', required: true, type: 'single', drives: 'categoryAffinity, group recs',
    prompt: 'What do you mostly trade?',
    options: ['stocks', 'options', 'crypto', 'futures', 'learning'] },

  { id: 'holdPeriod', required: true, type: 'single', drives: 'creator style match',
    prompt: 'How long is a typical position held?',
    options: ['minutes', 'days', 'weeks', 'months_plus'] },

  { id: 'riskAppetite', required: true, type: 'single', drives: 'creator and group match',
    prompt: 'How would you describe your risk appetite?',
    options: ['protect_capital', 'balanced', 'aggressive', 'swing_for_the_fences'] },

  { id: 'experience', required: true, type: 'single', drives: 'beginner-content weighting',
    prompt: 'Roughly how long have you been trading?',
    options: ['just_starting', 'under_a_year', 'one_to_five', 'over_five'] },

  { id: 'watchlist', required: false, type: 'tickers', max: MAX_WATCHLIST,
    drives: 'watchlist seed — the strongest feed signal there is',
    prompt: 'Pick up to 5 tickers you follow' },

  { id: 'sectors', required: false, type: 'multi', drives: 'corporate category match',
    prompt: 'Which sectors interest you?',
    options: ['technology', 'energy', 'healthcare', 'financials', 'consumer',
              'industrials', 'crypto', 'macro'] },

  { id: 'learningStyle', required: true, type: 'single', drives: 'rail ordering, letters vs video',
    prompt: 'How do you prefer to learn?',
    options: ['live_video', 'short_clips', 'written_letters', 'chat'] },

  { id: 'participation', required: true, type: 'single', drives: 'voice-room rail on/off',
    prompt: 'Do you want live voice rooms and group chat, or mostly read quietly?',
    options: ['voice_and_chat', 'read_quietly'] },

  { id: 'intent', required: true, type: 'single', drives: 'creator vs peer weighting',
    prompt: 'Are you here to follow pros, share your own trades, or both?',
    options: ['follow_pros', 'share_my_trades', 'both'] },

  { id: 'newsAppetite', required: true, type: 'single', drives: 'corporate slot cap — self-selected',
    prompt: 'How much market news do you want?',
    options: ['headlines_only', 'a_few_a_day', 'everything'] }
]);

const QUESTIONS_BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));

/* A user's self-selected daily ceiling on promoted corporate slots. Never
 * zero: the answer tunes volume, it is not an opt-out switch, and a silent
 * opt-out would be sold as inventory that never delivers. */
const SLOT_CAP_BY_APPETITE = Object.freeze({
  headlines_only: 1,
  a_few_a_day: 2,
  everything: 3
});

/**
 * What each answer contributes to corporate category affinity, in [0, 1].
 *
 * Kept as data rather than branches so the mapping can be read, argued with and
 * tuned without touching logic. Contributions are summed then clamped.
 */
const CATEGORY_SIGNALS = Object.freeze({
  instrument: {
    stocks:   { finance: 0.4, brokerage: 0.2 },
    options:  { finance: 0.5, data: 0.3 },
    crypto:   { finance: 0.3, data: 0.2 },
    futures:  { finance: 0.4, data: 0.3 },
    learning: { research: 0.3, media: 0.2 }
  },
  learningStyle: {
    live_video:      { media: 0.3 },
    short_clips:     { media: 0.3 },
    written_letters: { research: 0.4, news: 0.2 },
    chat:            { media: 0.2 }
  },
  newsAppetite: {
    headlines_only: { news: 0.2 },
    a_few_a_day:    { news: 0.4 },
    everything:     { news: 0.6, media: 0.2 }
  },
  sectors: {
    technology:  { data: 0.2, research: 0.1 },
    energy:      { research: 0.1 },
    healthcare:  { research: 0.2 },
    financials:  { finance: 0.3, brokerage: 0.2 },
    consumer:    { media: 0.1 },
    industrials: { research: 0.1 },
    crypto:      { data: 0.2 },
    macro:       { news: 0.3, research: 0.3 }
  }
});

/* ------------------------------------------------------------- validation */

const TICKER = /^[A-Z][A-Z.\-]{0,9}$/;

function normalizeTickers(value) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  for (const raw of list) {
    const ticker = String(raw == null ? '' : raw).trim().toUpperCase().replace(/^\$/, '');
    if (!TICKER.test(ticker)) continue;
    seen.add(ticker);
    /* Truncate rather than reject: a user who pasted six tickers meant to give
     * us signal, and failing their onboarding over it teaches them nothing. */
    if (seen.size >= MAX_WATCHLIST) break;
  }
  return [...seen];
}

/**
 * Validate and normalize a questionnaire submission.
 *
 * Unknown question ids and unknown option values are DROPPED rather than
 * accepted, so a stale client or a hand-rolled POST cannot write an affinity
 * key that no downstream mapping knows about. Missing required answers are
 * reported; nothing here throws on a partial submission, because a
 * half-finished questionnaire is a normal thing for a user to send.
 */
function validateAnswers(input = {}) {
  if (!input || typeof input !== 'object') throw invalid('answers must be an object');

  const answers = {};
  const rejected = [];

  for (const [id, raw] of Object.entries(input)) {
    const question = QUESTIONS_BY_ID.get(id);
    if (!question) { rejected.push({ id, reason: 'unknown_question' }); continue; }

    if (question.type === 'tickers') {
      const tickers = normalizeTickers(raw);
      if (tickers.length) answers[id] = tickers;
      continue;
    }

    if (question.type === 'multi') {
      const chosen = (Array.isArray(raw) ? raw : [])
        .map((v) => String(v))
        .filter((v) => question.options.includes(v));
      if (chosen.length) answers[id] = [...new Set(chosen)];
      continue;
    }

    const value = String(raw == null ? '' : raw);
    if (!question.options.includes(value)) { rejected.push({ id, reason: 'unknown_option' }); continue; }
    answers[id] = value;
  }

  const missing = QUESTIONS.filter((q) => q.required && answers[q.id] === undefined).map((q) => q.id);
  return { answers, missing, rejected, complete: missing.length === 0 };
}

/* --------------------------------------------------------------- profiling */

function addSignal(into, contribution) {
  for (const [category, weight] of Object.entries(contribution || {})) {
    into[category] = (into[category] || 0) + weight;
  }
}

/**
 * Turn validated answers into the stored signals the rest of the system reads.
 *
 * The shape is what corporate-feed.js consumes: `watchlist` and
 * `categoryAffinity` are read directly by relevance(), and `corporateSlotCap`
 * is the per-user ceiling the frequency cap enforces.
 */
function buildProfile(answers = {}) {
  const affinity = {};
  addSignal(affinity, CATEGORY_SIGNALS.instrument[answers.instrument]);
  addSignal(affinity, CATEGORY_SIGNALS.learningStyle[answers.learningStyle]);
  addSignal(affinity, CATEGORY_SIGNALS.newsAppetite[answers.newsAppetite]);
  for (const sector of Array.isArray(answers.sectors) ? answers.sectors : []) {
    addSignal(affinity, CATEGORY_SIGNALS.sectors[sector]);
  }

  const categoryAffinity = {};
  for (const [category, weight] of Object.entries(affinity)) {
    categoryAffinity[category] = Math.min(1, Math.round(weight * 1000) / 1000);
  }

  return {
    watchlist: Array.isArray(answers.watchlist) ? answers.watchlist : [],
    categoryAffinity,
    /* An unanswered question 10 gets the middle setting, not the largest. */
    corporateSlotCap: SLOT_CAP_BY_APPETITE[answers.newsAppetite] ?? SLOT_CAP_BY_APPETITE.a_few_a_day,
    prefersVideo: answers.learningStyle === 'live_video' || answers.learningStyle === 'short_clips',
    prefersLetters: answers.learningStyle === 'written_letters',
    wantsVoiceRooms: answers.participation === 'voice_and_chat',
    isBeginner: answers.experience === 'just_starting' || answers.instrument === 'learning',
    holdPeriod: answers.holdPeriod || null,
    riskAppetite: answers.riskAppetite || null,
    intent: answers.intent || null
  };
}

/* ------------------------------------------------------------ the 15 cards */

function cardKey(card) {
  const id = Number(card && card.wpUserId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Score a corporate card against the profile, so the <=3 slots go to the
 * category the user actually asked about rather than to whoever registered
 * first.
 */
function corporateFit(card, profile) {
  const affinity = (profile && profile.categoryAffinity) || {};
  return Number(affinity[card && card.category] || 0);
}

/**
 * Build the 15-card recommendation pool.
 *
 * Composition: at most 3 corporate, 2 news personas, the rest real creators.
 * Creators BACKFILL every shortfall — if there are no corporate accounts and no
 * news personas, the user still sees 15 creators rather than a short screen.
 * The reverse is never true: a corporate shortfall is not filled by promoting a
 * fourth corporate card, because the cap is the whole point.
 *
 * Identity is keyed on `wpUserId` throughout. Handles collide on this site —
 * /grandmasterobi/ resolves to a different user than its display name implies —
 * so a pool deduped by handle would silently drop or double a real person.
 */
function buildCardPool({ corporate = [], news = [], creators = [], profile = {} } = {},
  { size = POOL_SIZE, maxCorporate = MAX_CORPORATE_CARDS } = {}) {
  const used = new Set();
  const out = [];

  const take = (card, source) => {
    const id = cardKey(card);
    if (id === null || used.has(id)) return false;
    used.add(id);
    out.push({ ...card, wpUserId: id, source });
    return true;
  };

  const eligibleCorporate = (Array.isArray(corporate) ? corporate : [])
    .filter((c) => c && c.active !== false)
    .map((c) => ({ card: c, fit: corporateFit(c, profile) }))
    .sort((a, b) => (b.fit - a.fit) || (cardKey(a.card) - cardKey(b.card)));

  let placed = 0;
  for (const { card } of eligibleCorporate) {
    if (placed >= maxCorporate || out.length >= size) break;
    if (take(card, 'corporate')) placed += 1;
  }

  for (const card of Array.isArray(news) ? news : []) {
    if (out.length >= size) break;
    take(card, 'news');
  }

  for (const card of Array.isArray(creators) ? creators : []) {
    if (out.length >= size) break;
    take(card, 'creator');
  }

  return {
    cards: out,
    corporateCount: placed,
    /* A pool short of `size` means thin inventory upstream, not a bug here —
     * surfaced so the caller can log it rather than silently ship 9 cards. */
    short: out.length < size,
    requiredSelections: REQUIRED_SELECTIONS
  };
}

/**
 * The personalized 5 shown after the pool.
 *
 * Both upstream routes fail closed and return [] on cold start, so creators are
 * the backfill. Feed authors are NOT a fallback: those are auto-news bots, and
 * recommending a bot as a person to a brand-new user is a bad first impression.
 * Automated accounts are therefore dropped wherever they appear.
 */
function personalizedFive({ friends = [], traderSuggest = [], creators = [], exclude = [] } = {},
  { size = REQUIRED_SELECTIONS } = {}) {
  const used = new Set((Array.isArray(exclude) ? exclude : []).map(Number).filter(Boolean));
  const out = [];

  const consider = (list, source) => {
    for (const card of Array.isArray(list) ? list : []) {
      if (out.length >= size) return;
      const id = cardKey(card);
      if (id === null || used.has(id)) continue;
      if (card.isAutomated) continue;      // never recommend a bot as a person
      used.add(id);
      out.push({ ...card, wpUserId: id, source });
    }
  };

  consider(friends, 'friends');
  consider(traderSuggest, 'trader_suggest');
  consider(creators, 'creator_backfill');

  return { cards: out, short: out.length < size };
}

/** Did the user pick enough cards to continue? Ids, never handles. */
function validateSelection(selected = [], pool = []) {
  const offered = new Set((Array.isArray(pool) ? pool : []).map(cardKey).filter((id) => id !== null));
  const chosen = new Set();
  for (const raw of Array.isArray(selected) ? selected : []) {
    const id = Number(raw);
    /* Only ids that were actually offered: otherwise the selection step becomes
     * an arbitrary "make me follow this user" endpoint. */
    if (Number.isSafeInteger(id) && id > 0 && offered.has(id)) chosen.add(id);
  }
  return {
    selected: [...chosen],
    ok: chosen.size >= REQUIRED_SELECTIONS,
    required: REQUIRED_SELECTIONS
  };
}

module.exports = {
  QUESTIONS,
  REQUIRED_SELECTIONS,
  POOL_SIZE,
  MAX_CORPORATE_CARDS,
  MAX_WATCHLIST,
  SLOT_CAP_BY_APPETITE,
  normalizeTickers,
  validateAnswers,
  buildProfile,
  buildCardPool,
  personalizedFive,
  validateSelection
};
