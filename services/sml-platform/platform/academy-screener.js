'use strict';

/* Market screener behind the Live Chart Lab's Indicator Engine.
 *
 * Two questions, answered for every symbol the scanner tracks, from the same verified candles the
 * chart draws:
 *   1. For an indicator and a timeframe (1h, 1D, 1W, 1M, 1Q, 1Y): which tickers read bullish right
 *      now, which read bearish? Each directional indicator has one explicit reading rule below —
 *      the same reading a trader would take off the chart — so a "bullish" badge always means the
 *      same thing. Volatility measures (ATR, standard deviation...) have no direction and are
 *      deliberately not screened.
 *   2. For a trading horizon (day, swing, mid-term, long-term): which tickers does MEM ALGO lean
 *      long or short on, how strongly, and what chart formation is on them? Longs are the "go long"
 *      list, shorts the "short it" list; the option picker turns either into a call or a put.
 *
 * Nothing here fetches: `candles(symbol, tf)` and `universe()` are injected, so the sweep is
 * tested with synthetic bars and the server decides how often to run it. Educational only:
 * a reading describes what price has done, not what it will do, and nothing here places a trade. */

const algo = require('./academy-mem-algo');
const { detect } = require('./academy-patterns');
const { considerOptions } = require('./academy-alert-options');

const TIMEFRAMES = ['1h', '1D', '1W', '1M', '1Q', '1Y'];
const HORIZONS = {
  day: { mode: 'day', tf: '15m', label: 'Day Trading' },
  swing: { mode: 'swing', tf: '1D', label: 'Swing Trading' },
  mid: { mode: 'mid', tf: '1D', label: 'Mid-Term Hold' },
  long: { mode: 'long', tf: '1W', label: 'Long-Term Hold' }
};
const MIN_BARS = 30;

const fin = Number.isFinite;
const num = (v) => { const x = Number(v); return fin(x) ? x : null; };
const clean = (raw) => (Array.isArray(raw) ? raw : []).map((b) => ({ t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v || 0 })).filter((b) => [b.t, b.o, b.h, b.l, b.c].every(fin));

/* ---------- series (seeded like the chart's own Indicator Engine, so a reading here matches the line a member sees) ---------- */
const ema = (xs, p) => { const k = 2 / (p + 1); let prev = NaN; return xs.map((x) => { if (!fin(x)) return prev; prev = fin(prev) ? x * k + prev * (1 - k) : x; return prev; }); };
const sma = (xs, p) => xs.map((_, i) => (i + 1 < p ? NaN : xs.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p));
const wma = (xs, p) => xs.map((_, i) => (i + 1 < p ? NaN : xs.slice(i - p + 1, i + 1).reduce((a, b, j) => a + b * (j + 1), 0) / (p * (p + 1) / 2)));
const roc = (xs, p) => xs.map((x, i) => (i < p || !xs[i - p] ? NaN : (x / xs[i - p] - 1) * 100));
function rsi(xs, p = 14) {
  const out = new Array(xs.length).fill(NaN); let ag = 0, al = 0;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1], g = Math.max(0, d), l = Math.max(0, -d);
    if (i <= p) { ag += g; al += l; if (i === p) { ag /= p; al /= p; out[i] = al ? 100 - 100 / (1 + ag / al) : 100; } }
    else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; out[i] = al ? 100 - 100 / (1 + ag / al) : 100; }
  }
  return out;
}

/* ---------- one reading rule per directional indicator ---------- */
const maRead = (c, m, i) => { const a = m[i], b = m[i - 5]; if (!fin(a) || !fin(b)) return null; return c[i] > a && a > b ? 'bull' : c[i] < a && a < b ? 'bear' : 'neutral'; }; // price on the right side of an average that is itself heading that way
const slopeRead = (m, i) => { const a = m[i], b = m[i - 5]; if (!fin(a) || !fin(b)) return null; return a > b ? 'bull' : a < b ? 'bear' : 'neutral'; };
const aboveBelow = (x, mid, i, band = 0) => { const a = mid[i]; if (!fin(a) || !fin(x[i])) return null; return x[i] > a * (1 + band) ? 'bull' : x[i] < a * (1 - band) ? 'bear' : 'neutral'; };
const signOf = (v, prev, riseMatters = true) => { if (!fin(v)) return null; if (v > 0 && (!riseMatters || !fin(prev) || v >= prev)) return 'bull'; if (v < 0 && (!riseMatters || !fin(prev) || v <= prev)) return 'bear'; return 'neutral'; };

const INDICATORS = [
  { name: 'SMA', read: ({ c, i }) => maRead(c, sma(c, 20), i) },
  { name: 'EMA', read: ({ c, i }) => maRead(c, ema(c, 20), i) },
  { name: 'WMA', read: ({ c, i }) => maRead(c, wma(c, 20), i) },
  // lag-reduced averages overshoot past price on a straight move, so they are read by their own slope alone
  { name: 'DEMA', read: ({ c, i }) => { const e = ema(c, 20), e2 = ema(e, 20); return slopeRead(e.map((x, k) => 2 * x - e2[k]), i); } },
  { name: 'TEMA', read: ({ c, i }) => { const e = ema(c, 20), e2 = ema(e, 20), e3 = ema(e2, 20); return slopeRead(e.map((x, k) => 3 * x - 3 * e2[k] + e3[k]), i); } },
  { name: 'Zero-Lag MA', read: ({ c, i }) => { const lag = 9, z = c.map((x, k) => x + (k >= lag ? x - c[k - lag] : 0)); return slopeRead(ema(z, 20), i); } },
  { name: 'Moving Average Ribbon', read: ({ c, i }) => { const v = [8, 13, 21, 34].map((p) => ema(c, p)[i]); if (!v.every(fin)) return null; return v[0] > v[1] && v[1] > v[2] && v[2] > v[3] ? 'bull' : v[0] < v[1] && v[1] < v[2] && v[2] < v[3] ? 'bear' : 'neutral'; } },
  { name: 'MA Crossovers', read: ({ c, i }) => { const a = sma(c, 20)[i], b = sma(c, 50)[i]; if (!fin(a) || !fin(b)) return null; return a > b && c[i] > a ? 'bull' : a < b && c[i] < a ? 'bear' : 'neutral'; } },
  // MACD above zero with a histogram that is not clearly negative (on a straight trend the histogram sits at zero, which is not a turn)
  { name: 'MACD', read: ({ c, i }) => { const a = ema(c, 12), b = ema(c, 26), m = a.map((x, k) => x - b[k]), s = ema(m, 9), h = m[i] - s[i]; if (!fin(m[i]) || !fin(h)) return null; const tol = Math.abs(m[i]) * 0.05; return m[i] > 0 && h >= -tol ? 'bull' : m[i] < 0 && h <= tol ? 'bear' : 'neutral'; } },
  { name: 'RSI', read: ({ c, i }) => { const r = rsi(c); if (!fin(r[i]) || !fin(r[i - 1])) return null; return r[i] > 55 && r[i] >= r[i - 1] ? 'bull' : r[i] < 45 && r[i] <= r[i - 1] ? 'bear' : 'neutral'; } },
  { name: 'Stochastic (%K/%D)', read: ({ c, h, l, i }) => { const k = c.map((x, j) => { if (j < 13) return NaN; const hh = Math.max(...h.slice(j - 13, j + 1)), ll = Math.min(...l.slice(j - 13, j + 1)); return hh === ll ? 50 : (x - ll) / (hh - ll) * 100; }), d = sma(k.map((x) => (fin(x) ? x : 50)), 3); if (!fin(k[i]) || !fin(d[i])) return null; return k[i] > 50 && k[i] >= d[i] - 3 ? 'bull' : k[i] < 50 && k[i] <= d[i] + 3 ? 'bear' : 'neutral'; } },
  { name: 'ROC', read: ({ c, i }) => { const r = roc(c, 12); return signOf(r[i], r[i - 1], false); } },
  { name: 'Momentum (Rate of Change)', read: ({ c, i }) => { const r = roc(c, 12); return signOf(r[i], r[i - 1], false); } },
  { name: 'OBV', read: ({ c, v, i }) => { let x = 0; const o = c.map((cl, k) => { if (k) x += cl > c[k - 1] ? v[k] : cl < c[k - 1] ? -v[k] : 0; return x; }); return aboveBelow(o, sma(o, 20), i); } },
  { name: 'VWAP', read: ({ c, h, l, v, i }) => { let pv = 0, vv = 0; const w = c.map((_, k) => { vv += v[k]; pv += ((h[k] + l[k] + c[k]) / 3) * v[k]; return vv ? pv / vv : NaN; }); return aboveBelow(c, w, i, 0.002); } },
  { name: 'Volume Oscillator', read: ({ c, v, i }) => { const a = ema(v, 5)[i], b = ema(v, 20)[i]; if (!fin(a) || !b) return null; const vo = (a - b) / b * 100; return vo > 0 && c[i] > c[i - 1] ? 'bull' : vo > 0 && c[i] < c[i - 1] ? 'bear' : 'neutral'; } },
  { name: 'Accumulation/Distribution (A/D)', read: ({ c, h, l, v, i }) => { let x = 0; const ad = c.map((_, k) => { const r = h[k] - l[k]; x += (r ? ((c[k] - l[k]) - (h[k] - c[k])) / r : 0) * v[k]; return x; }); return aboveBelow(ad, sma(ad, 20), i); } },
  { name: 'Chaikin Money Flow (CMF)', read: ({ c, h, l, v, i }) => { if (i < 19) return null; let mf = 0, vol = 0; for (let k = i - 19; k <= i; k++) { const r = h[k] - l[k]; mf += (r ? ((c[k] - l[k]) - (h[k] - c[k])) / r : 0) * v[k]; vol += v[k]; } if (!vol) return null; const cmf = mf / vol; return cmf > 0.05 ? 'bull' : cmf < -0.05 ? 'bear' : 'neutral'; } },
  { name: 'Money Flow Index (MFI)', read: ({ c, h, l, v, i }) => { if (i < 14) return null; let pos = 0, neg = 0; for (let k = i - 13; k <= i; k++) { const tp = (h[k] + l[k] + c[k]) / 3, ptp = (h[k - 1] + l[k - 1] + c[k - 1]) / 3; if (tp > ptp) pos += tp * v[k]; else if (tp < ptp) neg += tp * v[k]; } const mfi = neg ? 100 - 100 / (1 + pos / neg) : 100; return mfi > 55 ? 'bull' : mfi < 45 ? 'bear' : 'neutral'; } },
  { name: 'Bollinger Bands', read: ({ c, i }) => { const m = sma(c, 20)[i]; if (!fin(m)) return null; return c[i] > m && c[i] > c[i - 1] ? 'bull' : c[i] < m && c[i] < c[i - 1] ? 'bear' : 'neutral'; } },
  { name: 'Keltner Channels', read: ({ c, i }) => { const m = ema(c, 20)[i]; if (!fin(m)) return null; return c[i] > m && c[i] > c[i - 1] ? 'bull' : c[i] < m && c[i] < c[i - 1] ? 'bear' : 'neutral'; } },
  { name: 'Donchian Channels', read: ({ c, h, l, i }) => { if (i < 19) return null; const hi = Math.max(...h.slice(i - 19, i + 1)), lo = Math.min(...l.slice(i - 19, i + 1)); return c[i] >= hi * 0.995 ? 'bull' : c[i] <= lo * 1.005 ? 'bear' : 'neutral'; } },
  { name: 'Price Channels', read: ({ c, h, l, i }) => { if (i < 19) return null; const hi = Math.max(...h.slice(i - 19, i + 1)), lo = Math.min(...l.slice(i - 19, i + 1)); return c[i] >= hi * 0.995 ? 'bull' : c[i] <= lo * 1.005 ? 'bear' : 'neutral'; } }
];
/* Listed by the engine but not screened: they measure how much price moves, not which way. */
const NON_DIRECTIONAL = ['ATR', 'Standard Deviation', 'Historical Volatility', 'True Range', 'Amplitude'];

/** Every directional indicator's reading on the last bar: { close, changePct, states: { name: 'bull'|'bear'|'neutral' } }, or null with too few bars. */
function indicatorStates(rawBars) {
  const bars = clean(rawBars);
  if (bars.length < MIN_BARS) return null;
  const ctx = { c: bars.map((b) => b.c), h: bars.map((b) => b.h), l: bars.map((b) => b.l), v: bars.map((b) => b.v), i: bars.length - 1 };
  const states = {};
  for (const ind of INDICATORS) { let s = null; try { s = ind.read(ctx); } catch (_) { s = null; } if (s) states[ind.name] = s; }
  const lastC = ctx.c[ctx.i], prevC = ctx.c[ctx.i - 1];
  return { close: lastC, changePct: prevC ? (lastC / prevC - 1) * 100 : null, states };
}

/** MEM ALGO's lean for one horizon plus the freshest chart formation, with a strength for ranking. dir is 1 (long), -1 (short) or 0. */
function horizonRead(rawBars, horizon, patternCache) {
  const H = HORIZONS[horizon]; if (!H) return null;
  const bars = clean(rawBars); if (bars.length < 60) return null;
  let a; try { a = algo.analyze(bars, H.mode, {}, H.tf, { patterns: (b) => detect(b), patternCache }); } catch (_) { return null; }
  let chart = null;
  try { const p = detect(bars); chart = (p.charts || []).filter((x) => x.status !== 'failed').sort((x, y) => (y.endIdx || 0) - (x.endIdx || 0))[0] || null; } catch (_) { chart = null; }
  const dir = a.bias === 'long' || a.bias === 'pullback' ? 1 : a.bias === 'short' || a.bias === 'bounce' ? -1 : 0;
  const grade = a.latest && a.latest.conf ? a.latest.conf.grade : null;
  const gradeWeight = { A: 3, B: 2, C: 1, D: 0 }[grade] ?? 0;
  const signalAgo = a.latest ? bars.length - 1 - a.latest.i : null;
  let strength = dir === 0 ? 0 : 1;
  if (dir !== 0 && a.latest && a.latest.dir === dir) strength += 1 + gradeWeight - Math.min(1, (signalAgo || 0) / 50);
  if (dir !== 0 && chart && (chart.dir === 'bull') === (dir > 0)) strength += chart.status === 'confirmed' ? 2 : 1;
  return { horizon, mode: H.mode, tf: H.tf, dir, bias: a.bias, grade, signalAgo, strength: Math.round(strength * 100) / 100, enoughData: !!a.enoughData, pattern: chart ? { name: chart.name, dir: chart.dir, status: chart.status } : null };
}

/** A call (long lean) or put (short lean) for this horizon, via the alerts desk's own contract picker. rows: a normalized chain. */
function optionFor({ symbol, side = 'call', horizon = 'swing', rows, price, bars, now = Date.now() }) {
  const b = clean(bars);
  const p = fin(price) && price > 0 ? price : (b.length ? b[b.length - 1].c : null);
  if (!fin(p) || !(p > 0)) return { verdict: 'WAIT', available: true, reason: 'Waiting for a live price.' };
  let atrPct = null;
  if (b.length > 15) { const a = algo.atr(b, 14); const v = a[a.length - 1]; if (fin(v) && v > 0) atrPct = v / p; }
  const put = side === 'put';
  const move = (atrPct || 0.04) * p * 3; // a three-ATR move is the screener's stand-in for an alert's target
  const alert = { symbol, channel: horizon === 'mid' || horizon === 'long' ? 'longterm' : 'swings', entry: put ? p * 1.01 : p, target: put ? p - move : p + move };
  const out = considerOptions({ alert, price: p, atrPct, plan: put ? { action: 'SELL', target: alert.target } : { action: 'HOLD', target: alert.target }, algoView: { bias: put ? 'short' : 'long' }, flow: null, rows, now });
  // the picker speaks in alert-desk terms; the screener has no alert, so say what the target actually is
  if (out && typeof out.reason === 'string') out.reason = put ? 'MEM ALGO leans short on this horizon, so the contract that fits is a put.' : 'MEM ALGO leans long on this horizon, so the contract that fits is a call.';
  if (out && Array.isArray(out.flags)) out.flags = out.flags.map((f) => f.replace("the alert's own target", 'a three-ATR move'));
  if (out && typeof out.summary === 'string') out.summary = out.summary.replace(/ignoring time value\.$/, 'ignoring time value (target = a three-ATR move).');
  return out;
}

function createScreenerService({ candles, universe, logger = () => {}, now = Date.now, timers = { setInterval, clearInterval }, concurrency = 3, refreshMs = 10 * 60_000, maxSymbols = 40 } = {}) {
  let snap = { updatedAt: 0, symbols: [] }, running = false, timer = null;
  const patternCache = new Map();
  const daily = new Map(); // symbol -> its 1D bars from the last sweep, for the option picker's ATR (kept out of the snapshot payload)
  const wanted = [...new Set([...TIMEFRAMES, ...Object.values(HORIZONS).map((h) => h.tf)])];

  async function readSymbol(row) {
    const symbol = String(row.symbol || '').toUpperCase();
    const bars = {};
    for (const tf of wanted) { try { bars[tf] = (await candles(symbol, tf)).bars; } catch (_) { bars[tf] = null; } }
    const out = { symbol, name: String(row.name || ''), price: num(row.price), changePct: num(row.changePct), byTf: {}, horizons: {} };
    for (const tf of TIMEFRAMES) { const r = bars[tf] ? indicatorStates(bars[tf]) : null; if (r) out.byTf[tf] = r; }
    for (const key of Object.keys(HORIZONS)) { const r = bars[HORIZONS[key].tf] ? horizonRead(bars[HORIZONS[key].tf], key, patternCache) : null; if (r) out.horizons[key] = r; }
    if (out.price == null && out.byTf['1D']) out.price = out.byTf['1D'].close;
    if (bars['1D']) daily.set(symbol, bars['1D']);
    return out;
  }
  async function refresh() {
    if (running) return snap;
    running = true;
    try {
      const rows = (await universe()).filter((r) => r && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(String(r.symbol || '').toUpperCase())).slice(0, maxSymbols);
      const results = []; let next = 0;
      const worker = async () => { while (next < rows.length) { const row = rows[next++]; try { results.push(await readSymbol(row)); } catch (error) { logger('warn', 'academy_screener_symbol_failed', { symbol: row.symbol, error }); } } };
      await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, rows.length)) }, worker));
      results.sort((a, b) => a.symbol.localeCompare(b.symbol));
      snap = { updatedAt: now(), symbols: results };
      if (patternCache.size > 5000) patternCache.clear();
    } catch (error) { logger('error', 'academy_screener_refresh_failed', { error }); }
    finally { running = false; }
    return snap;
  }
  const snapshot = () => ({ ok: true, updatedAt: snap.updatedAt, timeframes: TIMEFRAMES, horizons: Object.fromEntries(Object.entries(HORIZONS).map(([k, h]) => [k, { label: h.label, tf: h.tf }])), indicators: INDICATORS.map((x) => x.name), nonDirectional: NON_DIRECTIONAL, symbols: snap.symbols });
  function start() { if (timer) return; void refresh(); timer = timers.setInterval(() => { void refresh(); }, refreshMs); if (timer && timer.unref) timer.unref(); }
  function stop() { if (timer) timers.clearInterval(timer); timer = null; }
  const barsFor = (symbol) => daily.get(String(symbol || '').toUpperCase()) || [];
  return { refresh, snapshot, start, stop, optionFor, barsFor };
}

module.exports = { createScreenerService, indicatorStates, horizonRead, optionFor, TIMEFRAMES, HORIZONS, INDICATORS, NON_DIRECTIONAL };
