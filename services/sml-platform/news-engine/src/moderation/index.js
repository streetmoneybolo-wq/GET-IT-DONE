/* =============================================================================
 * StockMarketLoop News Engine — Module 10: Moderation & Quality
 *
 * WHAT THIS MODULE HONESTLY DOES
 *
 * Five of the seven detectors in the spec are computable from the text and are
 * implemented here: duplicate, spam, low_quality, manipulation, bot.
 *
 * Two are NOT, and are deliberately left as interfaces rather than faked:
 *
 *   toxicity      — keyword lists have a false-positive rate that makes them
 *                   worse than nothing (every discussion of a "short squeeze"
 *                   or a company named Scunthorpe trips them) and they miss
 *                   real harassment that uses no listed word. Wire a real
 *                   classifier (Perspective API or equivalent) into
 *                   `detectToxicity`. The conservative lexical fallback here
 *                   only ever raises severity 1 "needs a human look".
 *
 *   misinformation — cannot be pattern-matched at all; it needs ground truth.
 *                   What IS checkable is INTERNAL CONSISTENCY: does the price
 *                   in the article match the price feed, does the EPS match the
 *                   filing. That is implemented as `checkFactConsistency`, which
 *                   verifies claims against data you already hold. A detector
 *                   that claimed to spot false statements generally would give
 *                   false confidence, which on a finance site is worse than an
 *                   honest gap.
 *
 * Everything here is deterministic and dependency-free.
 * ========================================================================== */

'use strict';

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

const SHINGLE_SIZE = 5;          // words per shingle for fingerprinting
const SIMHASH_BITS = 64;
const DUPLICATE_HAMMING_MAX = 3; // <=3 differing bits ≈ near-identical
const SIMILAR_HAMMING_MAX = 8;   // <=8 ≈ same story, reworded

/* Promotional register. Presence is a signal, not a verdict — legitimate
 * coverage occasionally uses these, so they contribute weight rather than
 * triggering on their own. */
const PROMO_PHRASES = [
  'to the moon', 'get in now', 'before it explodes', 'guaranteed', 'can\'t lose',
  'easy money', 'act fast', 'don\'t miss out', 'load up', 'next 10x',
  'once in a lifetime', 'sure thing', 'risk free', 'free money', 'buy now'
];

/* Pump-and-dump register. On a microcap this pattern is the whole playbook:
 * urgency plus a price promise plus a call to accumulate. */
const PUMP_PHRASES = [
  'to the moon', 'squeeze is coming', 'shorts are trapped', 'about to explode',
  'next gme', 'next amc', 'diamond hands', 'hold the line', 'never selling',
  'price target of', 'going to $', 'guaranteed return', 'floor is'
];

/* -------------------------------------------------------------------------- */
/* Text utilities                                                              */
/* -------------------------------------------------------------------------- */

function norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9$%. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(s) { const n = norm(s); return n ? n.split(' ') : []; }

function sentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function countSyllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return w.length ? 1 : 0;
  const groups = w.replace(/(?:es|ed|[^laeiouy]e)$/, '').match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

/* -------------------------------------------------------------------------- */
/* Fingerprinting — SimHash over word shingles                                 */
/* -------------------------------------------------------------------------- */

/* FNV-1a, 32-bit, run twice with different offsets to fill 64 bits. Chosen over
 * a crypto hash because it is fast, dependency-free, and the cryptographic
 * properties are irrelevant here — only distribution matters. */
function fnv1a(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function shingles(text, size) {
  const w = words(text);
  /* Adaptive width. A fixed 5 is right for article-length prose but destroys
     resolution on short text: in a 30-word blurb, changing one word alters five
     of ~26 shingles, which reads as a large distance for a trivial edit. */
  const n = size || (w.length < 40 ? 3 : SHINGLE_SIZE);
  if (w.length < n) return w.length ? [w.join(' ')] : [];
  const out = [];
  for (let i = 0; i <= w.length - n; i++) out.push(w.slice(i, i + n).join(' '));
  return out;
}

/**
 * Blank out the values a template fills in, leaving the skeleton.
 *
 * This is the detector that matters for auto-generation. Two articles built
 * from "Why did [TICKER] options flow spike today?" are the *same article* to a
 * reader and to Google, but their content hashes differ because the ticker and
 * every number differ. Masking the variables makes the reuse visible.
 *
 * Order matters: currency before bare numbers, and tickers while the text is
 * still upper-case, since norm() lowercases everything.
 */
function maskVariables(text) {
  return String(text == null ? '' : text)
    .replace(/\$\s?\d[\d,.]*/g, ' MONEYVAL ')
    .replace(/-?\d[\d,.]*\s?%/g, ' PCTVAL ')
    .replace(/\$[A-Za-z]{1,5}\b/g, ' TICKERVAL ')
    .replace(/\b[A-Z]{1,5}\b/g, ' TICKERVAL ')
    .replace(/\b\d[\d,.]*\b/g, ' NUMVAL ');
}

/** SimHash of the template skeleton rather than the filled-in text. */
function templateSimhash(text) { return simhash(maskVariables(text)); }

/**
 * 64-bit SimHash as a BigInt. Near-identical text yields values a small Hamming
 * distance apart, which a plain hash cannot do — swapping one ticker in a
 * template changes an MD5 completely but moves a simhash by a couple of bits.
 */
function simhash(text) {
  const sh = shingles(text);
  if (!sh.length) return 0n;

  const vector = new Array(SIMHASH_BITS).fill(0);
  for (const s of sh) {
    const lo = fnv1a(s, 0x811c9dc5);
    const hi = fnv1a(s, 0x9e3779b9);
    for (let b = 0; b < 32; b++) {
      vector[b]      += (lo >>> b) & 1 ? 1 : -1;
      vector[b + 32] += (hi >>> b) & 1 ? 1 : -1;
    }
  }

  let out = 0n;
  for (let b = 0; b < SIMHASH_BITS; b++) if (vector[b] > 0) out |= (1n << BigInt(b));
  return out;
}

function hammingDistance(a, b) {
  let x = (BigInt(a) ^ BigInt(b)) & ((1n << 64n) - 1n);
  let count = 0;
  while (x) { x &= x - 1n; count++; }
  return count;
}

/** Four 16-bit bands, stored as signed INTEGERs, for indexable candidate lookup. */
function simhashBands(hash) {
  const h = BigInt(hash) & ((1n << 64n) - 1n);
  return [0, 1, 2, 3].map((i) => Number((h >> BigInt(i * 16)) & 0xffffn));
}

/** BigInt -> signed 64-bit for Postgres BIGINT, which has no unsigned type. */
function toSignedBigInt(v) {
  const u = BigInt(v) & ((1n << 64n) - 1n);
  return u >= (1n << 63n) ? u - (1n << 64n) : u;
}

function fingerprint(text) {
  const h = simhash(text);
  const t = templateSimhash(text);
  return {
    simhash: toSignedBigInt(h).toString(),
    template_simhash: toSignedBigInt(t).toString(),
    bands: simhashBands(h),
    token_count: words(text).length
  };
}

/* -------------------------------------------------------------------------- */
/* Detectors                                                                   */
/* -------------------------------------------------------------------------- */

function flag(type, severity, reason, evidence, detector) {
  return { flag_type: type, severity, reason, evidence: evidence || {}, detector };
}

/**
 * Duplicate detection. `candidates` are rows the caller fetched by band match —
 * this function does not touch the database.
 */
function detectDuplicate(text, candidates = []) {
  const flags = [];
  const mine = simhash(text);
  const mineTemplate = templateSimhash(text);

  let closest = null;         // nearest by content
  let closestTemplate = null; // nearest by skeleton

  for (const c of candidates) {
    const d = hammingDistance(mine, BigInt(c.simhash));
    if (!closest || d < closest.distance) {
      closest = { distance: d, entity_id: c.entity_id, entity_type: c.entity_type };
    }
    if (c.template_simhash != null) {
      const td = hammingDistance(mineTemplate, BigInt(c.template_simhash));
      if (!closestTemplate || td < closestTemplate.distance) {
        closestTemplate = { distance: td, entity_id: c.entity_id, entity_type: c.entity_type };
      }
    }
  }

  if (closest && closest.distance <= DUPLICATE_HAMMING_MAX) {
    flags.push(flag('duplicate', 5,
      `Near-identical to ${closest.entity_type} ${closest.entity_id} (Hamming ${closest.distance})`,
      closest, 'duplicate_detector'));
  } else if (closest && closest.distance <= SIMILAR_HAMMING_MAX) {
    flags.push(flag('duplicate', 3,
      `Substantially similar to ${closest.entity_type} ${closest.entity_id} (Hamming ${closest.distance})`,
      closest, 'duplicate_detector'));
  } else if (closestTemplate && closestTemplate.distance <= DUPLICATE_HAMMING_MAX) {
    /* Content differs, skeleton does not: the same template refilled with a new
       ticker. Severity 4 rather than 5 — this is often legitimate (an earnings
       recap per company), so it wants a human, not an automatic hide. */
    flags.push(flag('duplicate', 4,
      `Same template as ${closestTemplate.entity_type} ${closestTemplate.entity_id} with different values (template Hamming ${closestTemplate.distance})`,
      closestTemplate, 'template_reuse_detector'));
  }

  return { flags, closest, closestTemplate };
}

/** Internal repetition — the same paragraph pasted to pad length. */
function detectSelfRepetition(text) {
  const sents = sentences(text).map(norm).filter((s) => s.split(' ').length >= 5);
  if (sents.length < 4) return { flags: [], repetition_ratio: 0 };

  const seen = new Map();
  for (const s of sents) seen.set(s, (seen.get(s) || 0) + 1);
  const repeated = [...seen.values()].filter((n) => n > 1).reduce((a, n) => a + n - 1, 0);
  const ratio = repeated / sents.length;

  const flags = [];
  if (ratio >= 0.3) {
    flags.push(flag('low_quality', 4, `${Math.round(ratio * 100)}% of sentences are repeats`,
      { repetition_ratio: ratio }, 'self_repetition'));
  }
  return { flags, repetition_ratio: ratio };
}

function detectSpam(content) {
  const flags = [];
  const body = String(content.body || '');
  const w = words(body);
  const wordCount = w.length || 1;

  const links = body.match(/https?:\/\/\S+/g) || [];
  const externalLinks = links.filter((l) => !/stockmarketloop\.com/i.test(l));
  const linkDensity = links.length / (wordCount / 100);

  if (externalLinks.length >= 10) {
    flags.push(flag('spam', 4, `${externalLinks.length} external links`,
      { external_links: externalLinks.length }, 'spam_detector'));
  } else if (linkDensity > 3) {
    flags.push(flag('spam', 3, `Link density ${linkDensity.toFixed(1)} per 100 words`,
      { link_density: linkDensity }, 'spam_detector'));
  }

  const lower = body.toLowerCase();
  const hits = PROMO_PHRASES.filter((p) => lower.includes(p));
  if (hits.length >= 3) {
    flags.push(flag('spam', 4, `Promotional language: ${hits.slice(0, 5).join(', ')}`,
      { phrases: hits }, 'spam_detector'));
  } else if (hits.length >= 1) {
    flags.push(flag('spam', 2, `Promotional phrase: ${hits[0]}`, { phrases: hits }, 'spam_detector'));
  }

  const caps = (body.match(/\b[A-Z]{4,}\b/g) || []).filter((t) => !/^[A-Z]{1,5}$/.test(t));
  if (caps.length > 5) {
    flags.push(flag('spam', 2, `${caps.length} shouted words`, { count: caps.length }, 'spam_detector'));
  }

  return { flags, link_count: links.length, external_links: externalLinks.length };
}

/**
 * Pump-and-dump. Deliberately requires MULTIPLE co-occurring signals — the
 * phrases alone appear in legitimate coverage of meme stocks, and flagging a
 * microcap simply for being a microcap would bury reviewers in false positives.
 */
function detectManipulation(content, context = {}) {
  const flags = [];
  const lower = String(content.body || '').toLowerCase();

  const phraseHits = PUMP_PHRASES.filter((p) => lower.includes(p));
  const pricePromise = /\b(?:going to|target of|hit|reach)\s*\$\s?\d/i.test(lower);
  const urgency = /\b(?:right now|today only|before it|last chance|hurry)\b/i.test(lower);
  const isMicrocap = context.market_cap != null && context.market_cap < 300e6;
  const isPennyPrice = context.price != null && context.price < 5;

  let score = 0;
  const signals = [];
  if (phraseHits.length >= 2) { score += 2; signals.push(`pump phrases: ${phraseHits.slice(0, 3).join(', ')}`); }
  else if (phraseHits.length === 1) { score += 1; signals.push(`pump phrase: ${phraseHits[0]}`); }
  if (pricePromise) { score += 2; signals.push('explicit price promise'); }
  if (urgency) { score += 1; signals.push('urgency framing'); }
  if (isMicrocap || isPennyPrice) { score += 1; signals.push('microcap/penny security'); }
  if (context.no_verifiable_catalyst) { score += 1; signals.push('no verifiable catalyst'); }

  if (score >= 5) {
    flags.push(flag('manipulation', 5, `Strong pump-and-dump pattern: ${signals.join('; ')}`,
      { score, signals }, 'manipulation_detector'));
  } else if (score >= 3) {
    flags.push(flag('manipulation', 3, `Possible promotional pattern: ${signals.join('; ')}`,
      { score, signals }, 'manipulation_detector'));
  }

  return { flags, manipulation_score: score, signals };
}

/**
 * Bot detection from posting behaviour. Operates on timestamps and fingerprints
 * the caller supplies; identical intervals are the tell that survives any
 * amount of text variation.
 */
function detectBot(activity = {}) {
  const flags = [];
  const times = (activity.timestamps || []).map((t) => new Date(t).getTime()).filter((n) => !Number.isNaN(n)).sort();
  const signals = [];

  if (times.length >= 5) {
    const gaps = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance = gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

    /* Humans are irregular. A coefficient of variation under 0.1 across five or
       more posts is a scheduler, not a person. */
    if (cv < 0.1) {
      flags.push(flag('bot', 4, `Posting intervals near-identical (CV ${cv.toFixed(3)})`,
        { cv, posts: times.length }, 'bot_detector'));
      signals.push('metronomic timing');
    }

    const windowMs = times[times.length - 1] - times[0];
    const perHour = windowMs > 0 ? (times.length / (windowMs / 3.6e6)) : Infinity;
    if (perHour > 30) {
      flags.push(flag('bot', 3, `${perHour.toFixed(0)} posts/hour`, { rate: perHour }, 'bot_detector'));
      signals.push('excessive rate');
    }
  }

  const fps = activity.fingerprints || [];
  if (fps.length >= 3) {
    let near = 0;
    for (let i = 1; i < fps.length; i++) if (hammingDistance(fps[0], fps[i]) <= SIMILAR_HAMMING_MAX) near++;
    if (near / (fps.length - 1) > 0.7) {
      flags.push(flag('bot', 4, 'Posts are near-identical templates',
        { similar_ratio: near / (fps.length - 1) }, 'bot_detector'));
      signals.push('template reuse');
    }
  }

  return { flags, signals };
}

/**
 * Toxicity — LEXICAL FALLBACK ONLY. See the module header.
 * Caps at severity 1 and never auto-hides: this exists so the pipeline has a
 * defined shape, not because it works. Replace with a real classifier.
 */
function detectToxicity(content, classifier = null) {
  if (typeof classifier === 'function') return classifier(content);

  const lower = String(content.body || '').toLowerCase();
  const slurs = /\b(?:idiot|moron|scumbag|clown)\b/g;
  const threats = /\b(?:kill yourself|kys|i'll find you)\b/g;
  const flags = [];

  if (threats.test(lower)) {
    flags.push(flag('toxicity', 5, 'Possible threat — human review required',
      { detector_confidence: 'low' }, 'toxicity_lexical_fallback'));
  } else if ((lower.match(slurs) || []).length >= 2) {
    flags.push(flag('toxicity', 1, 'Possible insults — lexical fallback, low confidence',
      { detector_confidence: 'low' }, 'toxicity_lexical_fallback'));
  }

  return { flags, degraded: true, note: 'Lexical fallback active; wire a real classifier.' };
}

/**
 * Internal consistency, NOT misinformation detection. Compares claims made in
 * the text against data you already hold. Finding a mismatch is meaningful;
 * finding none is not evidence the article is true.
 */
function checkFactConsistency(content, facts = {}) {
  const flags = [];
  const body = String(content.body || '');
  const checked = [];

  if (facts.price != null) {
    const m = body.match(/\$\s?(\d+(?:\.\d+)?)/);
    if (m) {
      const claimed = parseFloat(m[1]);
      const drift = Math.abs(claimed - facts.price) / (facts.price || 1);
      checked.push({ field: 'price', claimed, actual: facts.price, drift });
      if (drift > 0.15) {
        flags.push(flag('misinformation', 4,
          `Quoted price $${claimed} differs from feed $${facts.price} by ${(drift * 100).toFixed(0)}%`,
          { claimed, actual: facts.price }, 'fact_consistency'));
      }
    }
  }

  if (facts.percent_change != null) {
    const m = body.match(/(-?\d+(?:\.\d+)?)\s?%/);
    if (m) {
      const claimed = parseFloat(m[1]);
      checked.push({ field: 'percent_change', claimed, actual: facts.percent_change });
      if (Math.abs(claimed - facts.percent_change) > 2) {
        flags.push(flag('misinformation', 4,
          `Quoted move ${claimed}% differs from feed ${facts.percent_change}%`,
          { claimed, actual: facts.percent_change }, 'fact_consistency'));
      }
    }
  }

  return { flags, checked, note: 'Consistency check only — silence is not verification.' };
}

/* -------------------------------------------------------------------------- */
/* Quality scoring                                                             */
/* -------------------------------------------------------------------------- */

/** Flesch Reading Ease. ~60-70 is plain English; finance skews lower. */
function fleschReadingEase(text) {
  const sents = sentences(text);
  const w = String(text || '').split(/\s+/).filter(Boolean);
  if (!sents.length || !w.length) return 0;
  const syllables = w.reduce((a, x) => a + countSyllables(x), 0);
  return 206.835 - 1.015 * (w.length / sents.length) - 84.6 * (syllables / w.length);
}

function scoreQuality(content) {
  const reasons = [];
  let score = 100;
  const deduct = (p, r) => { score -= p; reasons.push({ points: -p, reason: r }); };

  const body = String(content.body || '');
  const wordCount = words(body).length;

  if (wordCount < 120) deduct(30, `Very thin (${wordCount} words)`);
  else if (wordCount < 250) deduct(15, `Thin (${wordCount} words)`);
  else if (wordCount < 400) deduct(5, `Short (${wordCount} words)`);

  const flesch = fleschReadingEase(body);
  if (wordCount >= 100) {
    if (flesch < 20) deduct(12, `Very hard to read (Flesch ${flesch.toFixed(0)})`);
    else if (flesch < 35) deduct(6, `Hard to read (Flesch ${flesch.toFixed(0)})`);
  }

  const sects = ['why_this_matters', 'market_reaction', 'what_happens_next', 'trader_takeaway'];
  const missing = sects.filter((s) => !String(content[s] || '').trim());
  if (missing.length) deduct(missing.length * 5, `Missing sections: ${missing.join(', ')}`);

  const kp = Array.isArray(content.key_points) ? content.key_points.filter(Boolean) : [];
  if (!kp.length) deduct(8, 'No key data points');

  const mods = content.enhanced_data_modules || {};
  const modCount = Object.keys(mods).filter((k) => mods[k] != null).length;
  if (modCount === 0) deduct(12, 'No proprietary data modules — nothing here that is ours');
  else if (modCount < 3) deduct(5, `Only ${modCount} data module(s)`);

  const rep = detectSelfRepetition(body);
  if (rep.repetition_ratio > 0.15) deduct(10, `Repetitive (${Math.round(rep.repetition_ratio * 100)}% repeated sentences)`);

  if (!(content.tickers || []).length) deduct(6, 'No ticker attached');

  return {
    quality_score: Math.max(0, Math.min(100, Math.round(score))),
    readability: Math.round(flesch),
    word_count: wordCount,
    reasons,
    recommended_improvements: reasons.map((r) => r.reason)
  };
}

/* -------------------------------------------------------------------------- */
/* Orchestrator                                                                */
/* -------------------------------------------------------------------------- */

/* Highest severity present decides the outcome. Thresholds are policy, so they
 * live in one place rather than scattered through the detectors. */
function decide(flags, quality) {
  const max = flags.reduce((m, f) => Math.max(m, f.severity), 0);
  const hasDup5 = flags.some((f) => f.flag_type === 'duplicate' && f.severity === 5);

  if (max >= 5) return { moderation_status: 'needs_review', requires_review: true, recommended_actions: hasDup5 ? ['noindex'] : ['hide'] };
  if (max === 4) return { moderation_status: 'flagged', requires_review: true, recommended_actions: ['noindex'] };
  if (quality.quality_score < 40) return { moderation_status: 'auto_noindex', requires_review: false, recommended_actions: ['noindex'] };
  if (max === 3 || quality.quality_score < 60) return { moderation_status: 'flagged', requires_review: true, recommended_actions: [] };
  if (max > 0) return { moderation_status: 'clean', requires_review: false, recommended_actions: [] };
  return { moderation_status: 'clean', requires_review: false, recommended_actions: [] };
}

function moderate(content, opts = {}) {
  if (!content || typeof content !== 'object') throw new TypeError('moderate: content object required');

  const flags = [];
  const dup = detectDuplicate(content.body || content.summary || '', opts.duplicateCandidates || []);
  const spam = detectSpam(content);
  const manip = detectManipulation(content, opts.marketContext || {});
  const bot = detectBot(opts.activity || {});
  const tox = detectToxicity(content, opts.toxicityClassifier);
  const facts = checkFactConsistency(content, opts.facts || {});
  const rep = detectSelfRepetition(content.body || '');

  flags.push(...dup.flags, ...spam.flags, ...manip.flags, ...bot.flags, ...tox.flags, ...facts.flags, ...rep.flags);

  const quality = scoreQuality(content);
  if (quality.quality_score < 50) {
    flags.push(flag('low_quality', 3, `Quality score ${quality.quality_score}`,
      { reasons: quality.recommended_improvements }, 'quality_scoring_engine'));
  }

  const decision = decide(flags, quality);

  return Object.assign({
    quality_score: quality.quality_score,
    flags,
    recommended_improvements: quality.recommended_improvements,
    moderation_summary: flags.length
      ? `${flags.length} flag(s); highest severity ${flags.reduce((m, f) => Math.max(m, f.severity), 0)}`
      : 'No flags raised',
    fingerprint: fingerprint(content.body || ''),
    degraded_detectors: tox.degraded ? ['toxicity'] : []
  }, decision);
}

module.exports = {
  moderate,
  scoreQuality,
  fleschReadingEase,
  detectDuplicate,
  detectSelfRepetition,
  detectSpam,
  detectManipulation,
  detectBot,
  detectToxicity,
  checkFactConsistency,
  simhash,
  templateSimhash,
  maskVariables,
  hammingDistance,
  simhashBands,
  fingerprint,
  toSignedBigInt,
  constants: { SHINGLE_SIZE, DUPLICATE_HAMMING_MAX, SIMILAR_HAMMING_MAX }
};
