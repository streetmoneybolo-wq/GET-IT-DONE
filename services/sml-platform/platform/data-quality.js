'use strict';
const { marketState } = require('./market-clock');

/* ---------------------------------------------------------------- bad-tick filter (trades) */
function median(a) { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; }

/* A print is rejected when it is far from BOTH the recent median and the live quote mid, unless the next print confirms it
 * (two prints within 0.5% of each other = the market really moved, e.g. a gap or halt reopen). A rejected print never
 * moves last / candles / VWAP / tape stats. Excluded trade-condition codes are configurable because the right list
 * depends on the vendor's condition table (ACADEMY_TRADE_EXCLUDE_CONDITIONS="2,7,..."). */
function createTickFilter({ window = 25, jumpPct = 0.08, lowPriceJumpPct = 0.2, confirmPct = 0.005, excludeConditions = [], quoteMaxAgeMs = 5_000 } = {}) {
  const state = new Map(); // symbol -> { prices: [], candidate }
  const excluded = new Set((excludeConditions || []).map(Number).filter(Number.isFinite));
  const stats = { accepted: 0, rejected: 0, byReason: {} };
  const reject = (reason) => { stats.rejected += 1; stats.byReason[reason] = (stats.byReason[reason] || 0) + 1; return { ok: false, reason }; };

  function check(symbol, { price, size = 0, conditions = null, quote = null, t = 0, now = Date.now() }) {
    if (!(price > 0) || !Number.isFinite(price)) return reject('bad_price');
    if (size < 0 || !Number.isFinite(size)) return reject('bad_size');
    if (excluded.size && Array.isArray(conditions) && conditions.some((c) => excluded.has(Number(c)))) return reject('excluded_condition');
    let st = state.get(symbol); if (!st) { st = { prices: [], candidate: null }; state.set(symbol, st); }
    const ref = st.prices.length >= 3 ? median(st.prices) : NaN;
    const limit = (r) => (r < 1 ? lowPriceJumpPct : jumpPct);
    let mid = NaN;
    if (quote && quote.bid > 0 && quote.ask >= quote.bid && Math.abs((t || now) - (quote.t || now)) <= quoteMaxAgeMs) mid = (quote.bid + quote.ask) / 2;
    const farFromRef = Number.isFinite(ref) && Math.abs(price - ref) / ref > limit(ref);
    const farFromMid = Number.isFinite(mid) ? Math.abs(price - mid) / mid > limit(mid) : true; // no fresh quote -> rely on the median alone
    if (farFromRef && farFromMid) {
      const c = st.candidate;
      if (c && Math.abs(price - c) / c <= confirmPct) { st.candidate = null; st.prices = [price]; stats.accepted += 1; return { ok: true, reason: 'confirmed_move' }; }
      st.candidate = price;
      return reject('spike');
    }
    st.candidate = null;
    st.prices.push(price); if (st.prices.length > window) st.prices.shift();
    stats.accepted += 1;
    return { ok: true };
  }
  function forget(symbol) { state.delete(symbol); }
  return { check, forget, stats };
}

/* ---------------------------------------------------------------- buy/sell classification */
/* Quote rule only when the quote is current at the print; otherwise the tick rule (up = buy, down = sell, flat = previous). */
function classifyTrade(price, { quote = null, tradeT = 0, lastPrice = 0, lastDir = 'N', quoteMaxAgeMs = 2_000 } = {}) {
  if (quote && quote.bid > 0 && quote.ask >= quote.bid && (!tradeT || !quote.t || Math.abs(tradeT - quote.t) <= quoteMaxAgeMs)) {
    if (price >= quote.ask) return { dir: 'B', rule: 'quote' };
    if (price <= quote.bid) return { dir: 'S', rule: 'quote' };
    return { dir: 'N', rule: 'quote' };
  }
  if (lastPrice > 0) {
    if (price > lastPrice) return { dir: 'B', rule: 'tick' };
    if (price < lastPrice) return { dir: 'S', rule: 'tick' };
    return { dir: lastDir === 'B' || lastDir === 'S' ? lastDir : 'N', rule: 'tick' };
  }
  return { dir: 'N', rule: 'none' };
}

/* ---------------------------------------------------------------- candle sanity */
const TF_MS = { '1m': 60e3, '3m': 180e3, '5m': 300e3, '10m': 600e3, '15m': 900e3, '30m': 1800e3, '1h': 3600e3, '2h': 7200e3, '4h': 14400e3, '1D': 86400e3, '1W': 7 * 86400e3, '1M': 30 * 86400e3, '1Q': 91 * 86400e3, '1Y': 365 * 86400e3 };
const INTRADAY = new Set(['1m', '3m', '5m', '10m', '15m', '30m', '1h', '2h', '4h']);

/* Drops malformed bars, forces h>=max(o,c,l) and l<=min(o,c,h), removes duplicate/out-of-order times, and repairs single-bar
 * wicks that exceed the neighbours' range by more than `wickPct` on intraday charts (a classic bad print). */
function sanitizeBars(bars, tf = '5m', { wickPct = 0.25 } = {}) {
  const out = []; let repaired = 0, dropped = 0, lastT = -Infinity;
  for (const b of Array.isArray(bars) ? bars : []) {
    const t = Number(b && b.t), o = Number(b && b.o), h = Number(b && b.h), l = Number(b && b.l), c = Number(b && b.c);
    if (![t, o, h, l, c].every(Number.isFinite) || o <= 0 || h <= 0 || l <= 0 || c <= 0 || t <= lastT) { dropped += 1; continue; }
    lastT = t;
    const hi = Math.max(o, h, l, c), lo = Math.min(o, h, l, c);
    if (hi !== h || lo !== l) repaired += 1;
    out.push({ ...b, t, o, c, h: hi, l: lo, v: Number(b.v) >= 0 ? Number(b.v) : 0 });
  }
  if (INTRADAY.has(tf) && out.length >= 7) {
    for (let i = 3; i < out.length - 3; i++) {
      const nb = [out[i - 3], out[i - 2], out[i - 1], out[i + 1], out[i + 2], out[i + 3]];
      const nHi = Math.max(...nb.map((x) => x.h)), nLo = Math.min(...nb.map((x) => x.l)), body = Math.max(out[i].o, out[i].c), bodyLo = Math.min(out[i].o, out[i].c);
      if (out[i].h > nHi * (1 + wickPct) && out[i].h > body) { out[i].h = Math.max(body, nHi); repaired += 1; }
      if (out[i].l < nLo * (1 - wickPct) && out[i].l < bodyLo) { out[i].l = Math.min(bodyLo, nLo); repaired += 1; }
    }
  }
  return { bars: out, repaired, dropped };
}

/* ---------------------------------------------------------------- freshness / labeling */
/* liveness: 'live' (market open and the last bar is current), 'lagging' (open but behind), 'closed' (nothing expected).
 * Never claims real-time or delayed: the vendor feed class is not knowable from here, so `feed` is only what the caller knows. */
function annotateCandles(payload, { tf = payload && payload.tf, now = Date.now(), source = payload && payload.source, adjusted = null, feed = null, repaired = 0 } = {}) {
  const bars = (payload && payload.bars) || [], last = bars.length ? bars[bars.length - 1].t : 0, ms = TF_MS[tf] || 300e3;
  const st = marketState(now);
  const intraday = INTRADAY.has(tf);
  let liveness = 'closed';
  if (st.session !== 'closed' && intraday) {
    const ageMs = now - last;
    liveness = ageMs <= ms * 2 + 60_000 ? 'live' : 'lagging';
    if (st.session !== 'regular' && ageMs > ms * 2 + 60_000) liveness = 'extended_idle';
  } else if (st.open && !intraday) liveness = 'live';
  return {
    ...payload,
    source: source || 'unknown', adjusted, feed,
    lastBarAt: last || null, ageMs: last ? Math.max(0, now - last) : null,
    session: st.session, marketOpen: st.open, liveness, ...(repaired ? { repairedBars: repaired } : {})
  };
}

module.exports = { createTickFilter, classifyTrade, sanitizeBars, annotateCandles, median, TF_MS };
