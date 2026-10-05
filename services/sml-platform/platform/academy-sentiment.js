'use strict';

/* Academy sentiment engine. Pure, deterministic scoring functions plus a small service that gathers the inputs.
 *
 * Components (each -1 bearish .. +1 bullish, or unavailable with a reason):
 *   news    - headline lexicon scoring with negation and recency weighting (no vendor sentiment feed exists on this plan)
 *   social  - StockTwits bull/bear tags, with posting velocity measured against that symbol's own rolling baseline
 *   options - put/call by volume and open interest, unusual-activity premium skew (dealer gamma and max pain reported alongside)
 *   market  - SPY/QQQ day change and VIX level
 * The composite rescales over the components that are actually available and reports coverage, so one dead feed lowers confidence
 * instead of silently producing a confident number. Educational context only; none of this is a trade signal. */

const clamp = (x, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
const num = (v, d = null) => { if (v == null || v === '') return d; const x = Number(v); return Number.isFinite(x) ? x : d; };

/* ------------------------------------------------------------------ news */
/* Lexicon entries are whole-word patterns (regex source) so that "miss" cannot fire inside "Missouri" or "mission" and "beat" and "beats" are one hit. */
const POS = [
  ['beats?|tops?', 1.2], ['surg(?:e|es|ed|ing)', 1.4], ['soar(?:s|ed|ing)?', 1.5], ['jump(?:s|ed|ing)?', 1.1], ['rall(?:y|ies|ied|ying)', 1.0], ['upgrad(?:e|es|ed|ing)', 1.4],
  ['raises|raised|raising', 1.1], ['records?', 1.1], ['strong(?:er)?', 0.8], ['growth', 0.7], ['profit(?:s|able)?', 0.7], ['wins|winning', 0.9], ['approv(?:al|als|e|es|ed)', 1.2],
  ['partnership', 0.8], ['buybacks?', 1.0], ['repurchases?', 0.9], ['dividend hike', 1.0], ['outperform(?:s|ed|ing)?', 1.2], ['bullish', 1.1], ['breakouts?', 1.0], ['upside', 0.8],
  ['expands?|expanding|expansion', 0.6], ['accelerat(?:e|es|ed|ing)', 0.8], ['rebound(?:s|ed|ing)?', 0.8], ['gains?|gained', 0.7], ['boosts?|boosted', 0.8], ['optimis(?:m|tic)', 0.7],
  ['awarded', 0.9], ['breakthrough', 1.2], ['exceed(?:s|ed|ing)?', 1.0]
];
const NEG = [
  ['miss(?:es|ed)?', 1.3], ['plunge(?:s|d)?|plunging', 1.5], ['tumbl(?:e|es|ed|ing)', 1.3], ['slump(?:s|ed|ing)?', 1.2], ['sinks?|sank|sinking', 1.1], ['drops?|dropped|dropping', 0.9],
  ['falls?|fell|falling', 0.8], ['downgrad(?:e|es|ed|ing)', 1.4], ['cuts?|cutting', 1.0], ['slash(?:es|ed|ing)?', 1.1], ['lawsuits?', 1.1], ['sued', 1.1], ['probe(?:s|d)?', 1.1],
  ['investigat(?:e|es|ed|ing|ion|ions)', 1.2], ['subpoenas?', 1.3], ['recalls?|recalled', 1.2], ['bankrupt(?:cy)?', 2.0], ['fraud', 1.8], ['offering|offerings', 1.0], ['dilut(?:e|es|ed|ion|ive)', 1.2],
  ['halts?|halted', 1.0], ['delist(?:s|ed|ing)?', 1.7], ['layoffs?', 1.1], ['warning|warns|warned', 1.0], ['weak(?:er|ness)?', 0.9], ['loss(?:es)?', 0.8], ['declin(?:e|es|ed|ing)', 0.8],
  ['bearish', 1.1], ['short report', 1.5], ['default(?:s|ed)?', 1.6], ['resign(?:s|ed|ation)?', 0.9], ['crash(?:es|ed|ing)?', 1.5], ['concerns?', 0.6], ['fears?', 0.6], ['sell-?off', 1.2],
  ['underperform(?:s|ed|ing)?', 1.2], ['guidance cut', 1.4]
];
const POS_RE = POS.map(([src, w]) => [new RegExp('(?:^|[^a-z0-9])(?:' + src + ')(?![a-z0-9])'), w]);
const NEG_RE = NEG.map(([src, w]) => [new RegExp('(?:^|[^a-z0-9])(?:' + src + ')(?![a-z0-9])'), w]);
const NEGATORS = /\b(no|not|never|without|fails?|failed|unlikely|despite|denies|denied|avoid(?:s|ed)?)\b/;
const INTENSIFY = /\b(sharply|massive|huge|record|significantly|plummets?|skyrockets?)\b/;

function scoreHeadline(text) {
  const t = String(text || '').toLowerCase().replace(/[^a-z0-9$%.\- ]+/g, ' ');
  if (!t.trim()) return { score: 0, hits: [] };
  let sum = 0; const hits = [];
  const test = (re, w, sign) => {
    const m = re.exec(t);
    if (!m) return;
    const idx = m.index + (m[0].length - m[0].replace(/^[^a-z0-9]/, '').length > 0 ? 1 : 0);
    const lead = t.slice(Math.max(0, idx - 28), idx);
    const negated = NEGATORS.test(lead);
    const boost = INTENSIFY.test(lead) ? 1.25 : 1;
    sum += (negated ? -sign : sign) * w * boost;
    hits.push({ term: m[0].trim(), dir: negated ? -sign : sign });
  };
  for (const [re, w] of POS_RE) test(re, w, 1);
  for (const [re, w] of NEG_RE) test(re, w, -1);
  return { score: Math.tanh(sum / 2), hits };
}

function scoreNews(items, { now = Date.now(), halfLifeH = 48, maxAgeH = 24 * 7 } = {}) {
  const rows = [];
  for (const it of Array.isArray(items) ? items : []) {
    const title = String((it && it.title) || '').trim(); if (!title) continue;
    const at = Date.parse(it.date || it.published || it.published_at || '');
    const ageH = Number.isFinite(at) ? Math.max(0, (now - at) / 3_600_000) : null;
    if (ageH != null && ageH > maxAgeH) continue;
    const s = scoreHeadline(`${title} ${it.excerpt || ''}`);
    const w = ageH == null ? 0.5 : Math.pow(0.5, ageH / halfLifeH);
    rows.push({ title: title.slice(0, 140), url: String(it.url || ''), date: it.date || '', score: s.score, weight: w, ageH });
  }
  if (!rows.length) return { available: false, reason: 'no_recent_news', n: 0 };
  const wsum = rows.reduce((a, r) => a + r.weight, 0) || 1;
  const score = rows.reduce((a, r) => a + r.score * r.weight, 0) / wsum;
  const bull = rows.filter((r) => r.score >= 0.15).length, bear = rows.filter((r) => r.score <= -0.15).length;
  const drivers = rows.slice().sort((a, b) => Math.abs(b.score * b.weight) - Math.abs(a.score * a.weight)).slice(0, 3)
    .map((r) => ({ title: r.title, url: r.url, date: r.date, score: Math.round(r.score * 100) / 100 }));
  return { available: true, score: clamp(score), n: rows.length, bull, bear, neutral: rows.length - bull - bear, drivers, confidence: Math.min(1, rows.length / 8) };
}

/* ------------------------------------------------------------------ social */
function postsPerHour(posts, now) {
  const times = posts.map((p) => Date.parse(p.timestamp || p.created_at || p.at || '')).filter(Number.isFinite).sort((a, b) => a - b);
  if (times.length < 4) return null;
  const span = Math.max(30 * 60_000, Math.min(48 * 3_600_000, Math.max(now - times[0], times[times.length - 1] - times[0])));
  return times.length / (span / 3_600_000);
}

function scoreSocial(sentiment, { baseline = null, now = Date.now() } = {}) {
  const posts = sentiment && Array.isArray(sentiment.posts) ? sentiment.posts : null;
  if (!posts || posts.length < 3) return { available: false, reason: 'too_few_posts', n: posts ? posts.length : 0 };
  const bull = posts.filter((p) => /bull/i.test(p.sentiment || '')).length, bear = posts.filter((p) => /bear/i.test(p.sentiment || '')).length, tagged = bull + bear;
  const rate = postsPerHour(posts, now);
  const velocityRatio = rate != null && baseline && baseline.ema > 0 && baseline.n >= 3 ? rate / baseline.ema : null;
  const out = { n: posts.length, tagged, bull, bear, postsPerHour: rate != null ? Math.round(rate * 10) / 10 : null, velocityRatio: velocityRatio != null ? Math.round(velocityRatio * 100) / 100 : null };
  if (velocityRatio != null && posts.length >= 10) out.surge = velocityRatio >= 3;
  if (tagged < 3) return { ...out, available: false, reason: 'untagged_posts' };
  const score = (bull - bear) / (tagged + 2); // Laplace-smoothed so 3-0 is not a perfect score
  const crowded = tagged >= 20 && bull / tagged > 0.8;
  return { ...out, available: true, score: clamp(score), confidence: Math.min(1, tagged / 20), crowdedLong: crowded };
}

/* ------------------------------------------------------------------ options */
function flattenChain(rows, underlying) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    for (const [type, leg] of [['call', r && r.call], ['put', r && r.put]]) {
      if (!leg) continue;
      out.push({ strike: num(r.strike), type, expiration: r.expiry || r.expiration || '', volume: num(leg.volume, 0), open_interest: num(leg.oi ?? leg.open_interest, 0),
        iv: num(leg.iv), delta: num(leg.delta), gamma: num(leg.gamma), bid: num(leg.bid), ask: num(leg.ask), last: num(leg.last), underlying });
    }
  }
  return out;
}

let optionsMath = null;
try { optionsMath = require('../news-engine/src/triggers/options'); } catch (_) { optionsMath = null; }

function scoreOptions(rows, { underlying = null, math = optionsMath } = {}) {
  const contracts = flattenChain(rows, underlying);
  if (contracts.length < 10) return { available: false, reason: 'no_chain', contracts: contracts.length };
  if (!math) return { available: false, reason: 'options_math_missing', contracts: contracts.length };
  const pcr = math.putCallRatio(contracts);
  let unusual = [], gex = null, pain = null;
  try { const u = math.unusualActivity(contracts, { minVolume: 200, minRatio: 1.5, minPremium: 100_000 }); unusual = Array.isArray(u) ? u : (u && u.hits) || []; } catch (_) { unusual = []; }
  try { if (underlying > 0) gex = math.gammaExposure(contracts, underlying); } catch (_) { gex = null; }
  try { pain = math.maxPain(contracts); } catch (_) { pain = null; }
  const parts = []; let w = 0, s = 0;
  if (pcr.volume != null && pcr.call_volume + pcr.put_volume >= 100) { s += 0.6 * clamp((1 - pcr.volume) / 0.6); w += 0.6; parts.push(`P/C vol ${pcr.volume}`); }
  if (!w) return { available: false, reason: 'no_volume', contracts: contracts.length, pcr }; // open interest alone is stale positioning, not today's sentiment
  if (pcr.open_interest != null) { s += 0.2 * clamp((1 - pcr.open_interest) / 0.6); w += 0.2; parts.push(`P/C OI ${pcr.open_interest}`); }
  let callPrem = 0, putPrem = 0;
  for (const h of unusual) { const p = num(h.premium ?? h.premium_usd, 0); if (/call/i.test(h.type || h.side || '')) callPrem += p; else if (/put/i.test(h.type || h.side || '')) putPrem += p; }
  if (callPrem + putPrem > 0) { s += 0.2 * clamp((callPrem - putPrem) / (callPrem + putPrem)); w += 0.2; parts.push(`unusual flow ${callPrem >= putPrem ? 'call' : 'put'}-heavy`); }
  if (!w) return { available: false, reason: 'no_volume', contracts: contracts.length, pcr };
  return {
    available: true, score: clamp(s / w), confidence: Math.min(1, (pcr.call_volume + pcr.put_volume) / 2000), contracts: contracts.length,
    putCall: { volume: pcr.volume, openInterest: pcr.open_interest, callVolume: pcr.call_volume, putVolume: pcr.put_volume },
    unusual: unusual.slice(0, 3).map((h) => ({ type: h.type || h.side || '', strike: h.strike, expiration: h.expiration, volume: h.volume, premium: h.premium ?? h.premium_usd })),
    gex: gex ? { net: gex.net_gex, flipStrike: gex.flip_strike } : null, maxPain: pain && pain.strike != null ? pain.strike : null, detail: parts.join(' | ')
  };
}

/* ------------------------------------------------------------------ market */
function scoreMarket({ spy = null, qqq = null, vix = null } = {}) {
  const changes = [spy, qqq].map((r) => num(r && (r.changePct ?? r.change_pct ?? r.pct), null)).filter((x) => x != null);
  const parts = []; let s = 0, w = 0;
  if (changes.length) { const avg = changes.reduce((a, b) => a + b, 0) / changes.length; s += 0.6 * Math.tanh(avg / 1.0); w += 0.6; parts.push(`SPY/QQQ ${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%`); }
  let vixBand = null;
  const lvl = num(vix && (vix.level ?? vix.value ?? vix.c), null);
  if (lvl != null && lvl > 0) {
    vixBand = lvl < 15 ? 'calm' : lvl < 20 ? 'normal' : lvl < 30 ? 'elevated' : 'panic';
    s += 0.4 * clamp((18 - lvl) / 12); w += 0.4; parts.push(`VIX ${lvl.toFixed(1)} (${vixBand})`);
  }
  if (!w) return { available: false, reason: 'no_market_data' };
  return { available: true, score: clamp(s / w), confidence: w, vix: lvl, vixBand, detail: parts.join(' | ') };
}

/* ------------------------------------------------------------------ composite */
const WEIGHTS = { news: 0.3, social: 0.2, options: 0.25, market: 0.25 };
function labelOf(score) {
  if (score >= 0.35) return 'bullish'; if (score >= 0.12) return 'leaning bullish';
  if (score <= -0.35) return 'bearish'; if (score <= -0.12) return 'leaning bearish';
  return 'neutral';
}

function composite(parts, { priceChangePct = null } = {}) {
  let wsum = 0, ssum = 0; const comps = {};
  for (const [key, w] of Object.entries(WEIGHTS)) {
    const p = parts[key] || { available: false, reason: 'not_requested' };
    const conf = p.available ? (0.5 + 0.5 * (p.confidence == null ? 1 : p.confidence)) : 0;
    comps[key] = { ...p, weight: w };
    if (p.available) { wsum += w * conf; ssum += w * conf * p.score; }
  }
  const coverage = Object.entries(WEIGHTS).reduce((a, [k, w]) => a + (comps[k].available ? w : 0), 0);
  const notes = [];
  if (coverage < 0.4 || !wsum) {
    return { available: false, reason: 'insufficient_data', coverage: Math.round(coverage * 100), components: comps, notes: ['Too few sentiment sources are available right now to give an honest reading.'] };
  }
  const score = clamp(ssum / wsum);
  const n = comps.news, so = comps.social, op = comps.options;
  if (so.available && so.crowdedLong) notes.push('Social chatter is heavily one-sided bullish; crowded trades can reverse quickly.');
  if (so.available && so.surge) notes.push(`Mentions are running about ${so.velocityRatio}x this ticker's normal pace.`);
  if (n.available && op.available && n.score > 0.2 && op.score < -0.2) notes.push('News reads positive but options positioning leans bearish: they disagree.');
  if (n.available && op.available && n.score < -0.2 && op.score > 0.2) notes.push('News reads negative but options positioning leans bullish: they disagree.');
  if (priceChangePct != null && n.available && priceChangePct > 2 && n.score < -0.15) notes.push('Price is rising while recent news is negative.');
  if (priceChangePct != null && n.available && priceChangePct < -2 && n.score > 0.15) notes.push('Price is falling while recent news is positive.');
  if (coverage < 0.7) notes.push(`Based on ${Math.round(coverage * 100)}% of the usual sources; treat as a rough read.`);
  return { available: true, score: Math.round(score * 1000) / 1000, scorePct: Math.round(score * 100), label: labelOf(score), coverage: Math.round(coverage * 100), components: comps, notes };
}

/* ------------------------------------------------------------------ baselines + history (durable via the state store) */
function createSentimentMemory({ store = null, now = Date.now, logger = () => {}, flushMs = 60_000, historyPoints = 96, historySpacingMs = 30 * 60_000 } = {}) {
  let state = { baselines: {}, history: {} }, loading = null, dirty = false, lastFlush = 0;
  /* one shared load: callers that arrive while it is in flight wait for it instead of writing into the default state that the load then replaces */
  function load() {
    if (loading) return loading;
    loading = (async () => {
      if (!store) return;
      try { const v = await store.read(); if (v && typeof v === 'object') state = { baselines: v.baselines || {}, history: v.history || {} }; } catch (error) { logger('warn', 'sentiment_memory_load_failed', { error }); }
    })();
    return loading;
  }
  async function flush(force = false) {
    if (!store || !dirty || (!force && now() - lastFlush < flushMs)) return;
    lastFlush = now(); dirty = false;
    const keep = Object.entries(state.history).sort((a, b) => (b[1].at(-1)?.t || 0) - (a[1].at(-1)?.t || 0)).slice(0, 300);
    state.history = Object.fromEntries(keep);
    const bl = Object.entries(state.baselines).sort((a, b) => (b[1].t || 0) - (a[1].t || 0)).slice(0, 500);
    state.baselines = Object.fromEntries(bl);
    try { await store.write(state); } catch (error) { dirty = true; logger('warn', 'sentiment_memory_write_failed', { error }); }
  }
  function baseline(symbol) { return state.baselines[symbol] || null; }
  function observeRate(symbol, rate) {
    if (!(rate > 0)) return;
    const b = state.baselines[symbol] || { ema: rate, n: 0, t: 0 }, t = now();
    if (t - b.t < 20 * 60_000 && b.n > 0) return; // at most one observation per 20 minutes
    b.ema = b.n === 0 ? rate : b.ema * 0.8 + rate * 0.2; b.n += 1; b.t = t;
    state.baselines[symbol] = b; dirty = true;
  }
  function record(symbol, score) {
    if (!Number.isFinite(score)) return;
    const h = state.history[symbol] || [], t = now();
    if (h.length && t - h[h.length - 1].t < historySpacingMs) return;
    h.push({ t, s: Math.round(score * 1000) / 1000 }); if (h.length > historyPoints) h.splice(0, h.length - historyPoints);
    state.history[symbol] = h; dirty = true;
  }
  function history(symbol) { return (state.history[symbol] || []).slice(); }
  return { load, flush, baseline, observeRate, record, history };
}

/* ------------------------------------------------------------------ service */
function createSentimentService({ news, social, chain, market, quote, memory = createSentimentMemory(), now = Date.now, ttlMs = 60_000, logger = () => {} } = {}) {
  const cache = new Map(), inflight = new Map();
  async function safe(name, fn, fallback) {
    if (typeof fn !== 'function') return { available: false, reason: 'not_configured' };
    try { const r = await fn(); return r === undefined ? fallback : r; }
    catch (error) { logger('warn', 'sentiment_input_failed', { input: name, error }); return { available: false, reason: 'provider_error' }; }
  }
  async function compute(symbol) {
    await memory.load();
    const [newsItems, social_, chainRows, mkt, q] = await Promise.all([
      safe('news', () => news(symbol), null), safe('social', () => social(symbol), null), safe('chain', () => chain(symbol), null),
      safe('market', () => market(), null), safe('quote', () => quote(symbol), null)
    ]);
    const t = now();
    const bad = (x) => x && x.available === false && x.reason;
    const underlying = num(q && (q.price ?? q.last), null);
    const socialScore = bad(social_) ? social_ : scoreSocial(social_, { baseline: memory.baseline(symbol), now: t });
    if (socialScore && socialScore.postsPerHour) memory.observeRate(symbol, socialScore.postsPerHour);
    const parts = {
      news: bad(newsItems) ? newsItems : scoreNews(newsItems, { now: t }),
      social: socialScore,
      options: bad(chainRows) ? chainRows : scoreOptions(chainRows, { underlying }),
      market: bad(mkt) ? mkt : scoreMarket(mkt || {})
    };
    const pct = num(q && (q.changePct ?? q.change_pct ?? q.pct), null);
    const out = composite(parts, { priceChangePct: pct });
    if (out.available) memory.record(symbol, out.score);
    void memory.flush();
    return { ok: true, symbol, asOf: t, ...out, history: memory.history(symbol), disclaimer: 'Educational context, not a trade signal.' };
  }
  async function get(symbol) {
    const key = String(symbol || '').toUpperCase();
    const hit = cache.get(key); if (hit && hit.until > now()) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
    const p = compute(key).then((v) => { cache.set(key, { until: now() + ttlMs, value: v }); if (cache.size > 300) cache.delete(cache.keys().next().value); return v; }).finally(() => inflight.delete(key));
    inflight.set(key, p); return p;
  }
  return { get, memory };
}

module.exports = { scoreHeadline, scoreNews, scoreSocial, scoreOptions, scoreMarket, composite, flattenChain, createSentimentMemory, createSentimentService, labelOf, WEIGHTS };
