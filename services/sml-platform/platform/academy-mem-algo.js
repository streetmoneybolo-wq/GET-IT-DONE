'use strict';

/*
 * MEM ALGO — the Making Easy Money EMA-crossover model for the Academy Live Chart Lab.
 *
 * Educational simulation only: it draws signals and runs a paper backtest on candles the chart already has.
 * It never places orders and makes no promise about future results.
 *
 * Rebuilt from the "SML Crossover v3" Pine indicator. What changed, and why:
 *  1. The original confirmed a cross with `aboveRun >= confirmBars and rawCrossUp`. A cross is, by definition, the FIRST bar above,
 *     so the run length is 1 there: with the default confirmation of 2 bars the indicator could never fire. Here a signal fires on the
 *     Nth consecutive bar after the cross, and every filter is evaluated on that bar.
 *  2. The volatility gate measured the gap between the two EMAs on the bar of the cross, where the lines are touching (gap ~0 by construction), so it
 *     also blocked almost every real signal. It now measures how far PRICE has moved away from the slow EMA (in ATRs) on the confirmation bar.
 *  3. Signals are decided only from closed candles, and the backtest enters on the NEXT candle's open (no look-ahead), gaps are honoured,
 *     and a candle that touches both stop and target is scored as a stop (the conservative reading).
 *  4. "Gain since last alert" compared any two consecutive signals in one direction; the model now reports each trade in R (multiples of risk).
 *  5. Costs (per-side slippage/commission) are charged, and results are split into an in-sample and an out-of-sample part so members can
 *     see how much a result depends on the data it was tuned on.
 * Add new strategies by adding an entry to STRATEGIES; the chart panel lists whatever is registered.
 *  - dirs: 'both' (default), 'long' or 'short'. A one-direction strategy only opens that side; the opposite crossover becomes an EXIT signal.
 *  - trail: an ATR trailing stop that only ever moves in the trade's favour (hold strategies). targetAtr: null means "no fixed target".
 *  - byTf: parameter overrides for a specific candle size, so one strategy can sensibly run on 1D, 1W and 1M candles.
 *  - maxSep: skip entries where price is already stretched more than this many ATR from the slow EMA (guards shorts against chasing a drop into a squeeze).
 */

const INTRADAY = ['1m', '3m', '5m', '10m', '15m', '30m'];

const STRATEGIES = {
  day: {
    key: 'day',
    label: 'Day Trading',
    blurb: 'Fast EMA(9) vs slow EMA(21) inside the EMA(100) trend, on intraday candles. Skips the first 10 minutes and last 15 minutes of the regular session.',
    tfHint: INTRADAY,
    params: { fast: 9, slow: 21, trend: 100, atr: 14, minSep: 0.35, confirm: 2, stopAtr: 1.2, targetAtr: 2.4, maxHold: 40, costBps: 2, session: { open: 570, close: 960, skipOpen: 10, skipClose: 15 } }
  },
  swing: {
    key: 'swing',
    label: 'Swing Trading',
    blurb: 'Fast EMA(20) vs slow EMA(50) inside the EMA(200) trend, on hourly or daily candles. Wider ATR stops, held for days to weeks.',
    tfHint: ['1h', '2h', '4h', '1D'],
    params: { fast: 20, slow: 50, trend: 200, atr: 14, minSep: 0.5, confirm: 2, stopAtr: 2.0, targetAtr: 4.0, maxHold: 40, costBps: 2, session: null }
  },
  mid: {
    key: 'mid',
    label: 'Mid-Term Hold',
    blurb: 'Buy and hold for weeks to months while the trend lasts: EMA(50) over EMA(100) with price above the EMA(200), on daily candles. A wide ATR trailing stop protects the position and it exits when the trend rolls over. Long only.',
    tfHint: ['1D', '1W'],
    bestTf: '1D',
    dirs: 'long',
    params: { fast: 50, slow: 100, trend: 200, atr: 14, minSep: 0.5, confirm: 3, stopAtr: 3, targetAtr: null, trail: 4, maxHold: 250, costBps: 3, session: null, minScore: 55, htfFast: 10, htfSlow: 30, regimeLen: 200, rsLook: 90 },
    byTf: { '1W': { fast: 10, slow: 30, trend: 40, confirm: 2, maxHold: 52, regimeLen: 40, rsLook: 26, htfFast: 6, htfSlow: 12 } }
  },
  long: {
    key: 'long',
    label: 'Long-Term Hold',
    blurb: 'Invest for months to years: EMA(50) crossing over EMA(200) (the classic golden cross), held until it reverses. Very wide trailing stop. Long only. Best on weekly candles.',
    tfHint: ['1D', '1W', '1M'],
    bestTf: '1W',
    dirs: 'long',
    params: { fast: 50, slow: 200, trend: 200, atr: 14, minSep: 0.5, confirm: 5, stopAtr: 4, targetAtr: null, trail: 6, maxHold: 500, costBps: 3, session: null, minScore: 55, htfFast: 10, htfSlow: 30, regimeLen: 200, rsLook: 180 },
    byTf: { '1W': { fast: 20, slow: 50, trend: 50, confirm: 2, maxHold: 260, trail: 5, regimeLen: 40, rsLook: 52, htfFast: 6, htfSlow: 12 }, '1M': { fast: 6, slow: 12, trend: 12, confirm: 1, maxHold: 120, trail: 4, regimeLen: 10, rsLook: 12, htfFast: 3, htfSlow: 6 } }
  },
  short: {
    key: 'short',
    label: 'Short Sale',
    blurb: 'Bearish only: EMA(12) under EMA(26) with price below the EMA(100), confirmed on closed candles, skipping drops that are already stretched (squeeze and bounce risk). Shorting can lose more than the money you put in, so this is a paper model only.',
    tfHint: ['15m', '30m', '1h', '2h', '4h', '1D'],
    bestTf: '1h',
    dirs: 'short',
    params: { fast: 12, slow: 26, trend: 100, atr: 14, minSep: 0.5, maxSep: 3.5, confirm: 2, stopAtr: 1.6, targetAtr: 3.2, trail: null, maxHold: 30, costBps: 4, session: null }
  }
};

function clampInt(v, lo, hi, dflt) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; }
function clampNum(v, lo, hi, dflt) { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; }

/** Merge user overrides into a strategy's defaults with hard limits, so a bad input can never break the model. */
function resolveParams(mode, overrides = {}, tf = '') {
  const st = STRATEGIES[mode] || STRATEGIES.day;
  const base = Object.assign({}, st.params, (st.byTf && st.byTf[tf]) || {});
  const o = overrides || {};
  const p = {
    fast: clampInt(o.fast, 2, 200, base.fast), slow: clampInt(o.slow, 3, 400, base.slow), trend: clampInt(o.trend, 5, 600, base.trend),
    atr: clampInt(o.atr, 2, 100, base.atr), minSep: clampNum(o.minSep, 0, 5, base.minSep), confirm: clampInt(o.confirm, 1, 10, base.confirm),
    stopAtr: clampNum(o.stopAtr, 0.2, 10, base.stopAtr), targetAtr: base.targetAtr == null ? null : clampNum(o.targetAtr, 0.2, 20, base.targetAtr),
    trail: base.trail == null ? null : clampNum(o.trail, 0.5, 20, base.trail), maxSep: base.maxSep == null ? null : clampNum(o.maxSep, 0.5, 20, base.maxSep),
    dirs: st.dirs || 'both',
    minScore: base.minScore == null ? null : clampInt(o.minScore, 0, 100, base.minScore), htfFast: base.htfFast, htfSlow: base.htfSlow, regimeLen: base.regimeLen, rsLook: base.rsLook,
    maxHold: clampInt(o.maxHold, 1, 500, base.maxHold), costBps: clampNum(o.costBps, 0, 50, base.costBps),
    session: base.session ? { ...base.session } : null
  };
  if (p.fast >= p.slow) p.slow = p.fast + 1;
  return p;
}

function ema(values, len) {
  const out = new Array(values.length).fill(NaN);
  const a = 2 / (len + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    prev = Number.isFinite(prev) ? a * v + (1 - a) * prev : v;
    out[i] = prev;
  }
  return out;
}

/** Wilder's ATR (RMA of true range), seeded with the simple average of the first `len` true ranges. */
function atr(bars, len) {
  const out = new Array(bars.length).fill(NaN);
  let sum = 0, prev = NaN;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], pc = i ? bars[i - 1].c : b.c;
    const tr = Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
    if (i < len) { sum += tr; if (i === len - 1) { prev = sum / len; out[i] = prev; } }
    else { prev = (prev * (len - 1) + tr) / len; out[i] = prev; }
  }
  return out;
}

const etFormat = typeof Intl !== 'undefined' ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' }) : null;
function minutesET(t) {
  if (!etFormat) return { min: 600, weekday: 'Mon' };
  let hour = 0, minute = 0, weekday = '';
  for (const part of etFormat.formatToParts(new Date(t))) {
    if (part.type === 'hour') hour = Number(part.value) % 24;
    else if (part.type === 'minute') minute = Number(part.value);
    else if (part.type === 'weekday') weekday = part.value;
  }
  return { min: hour * 60 + minute, weekday };
}

function sessionAllows(t, session) {
  if (!session) return true;
  const { min, weekday } = minutesET(t);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return min >= session.open + session.skipOpen && min < session.close - session.skipClose;
}

/** Indicator series + one decision per candle. A decision at index i uses candles 0..i only. */
function computeSignals(bars, params) {
  const p = params;
  const n = bars.length;
  const close = bars.map((b) => b.c);
  const fast = ema(close, p.fast), slow = ema(close, p.slow), trend = ema(close, p.trend), a = atr(bars, p.atr);
  const warm = Math.max(p.trend, p.slow, p.atr) + 1;
  const sig = new Array(n).fill(0), xsig = new Array(n).fill(0), sep = new Array(n).fill(NaN);
  let above = 0, below = 0;
  for (let i = 0; i < n; i++) {
    const up = fast[i] > slow[i], dn = fast[i] < slow[i];
    above = up ? above + 1 : 0;
    below = dn ? below + 1 : 0;
    // how far price has pulled away from the slow EMA, in ATRs. (The gap BETWEEN the two EMAs is ~0 right after a cross, so it cannot be the gate.)
    sep[i] = a[i] > 0 ? Math.abs(close[i] - slow[i]) / a[i] : NaN;
    if (i < warm || !(a[i] > 0)) continue;
    // a one-direction strategy leaves its trade when the crossover turns against it (no volatility or session filter on the way out)
    if (p.dirs === 'long' && below === p.confirm) xsig[i] = -1;
    else if (p.dirs === 'short' && above === p.confirm) xsig[i] = 1;
    const volOk = sep[i] >= p.minSep && !(p.maxSep && sep[i] > p.maxSep);
    if (!volOk || !sessionAllows(bars[i].t, p.session)) continue;
    if (above === p.confirm && close[i] > trend[i] && close[i] > slow[i] && p.dirs !== 'short') sig[i] = 1;
    else if (below === p.confirm && close[i] < trend[i] && close[i] < slow[i] && p.dirs !== 'long') sig[i] = -1;
  }
  return { fast, slow, trend, atr: a, sep, sig, xsig, warm };
}


/* ---------- Confluence for the hold strategies (Mid-Term / Long-Term) ----------
 * A crossover on its own is one opinion. Before a hold signal is taken, the model asks what else agrees, using only data that already exists on the page:
 *   higher-timeframe trend (20)  the next timeframe up is also trending up (previous COMPLETE higher-timeframe candle, so no look-ahead)
 *   volume (15)                  the signal candle traded on real volume and money has been flowing in (up-volume vs down-volume)
 *   momentum (15)                RSI in a healthy 50-70 zone (not exhausted) and MACD histogram positive and rising
 *   market regime (15)           the benchmark (SPY) is above its long average
 *   relative strength (10)       the stock beat the benchmark over the last ~90 candles
 *   structure (25)               pattern scanner: confirmed bullish pattern, support just below, resistance not immediately overhead, no confirmed bearish pattern
 * Each factor that has no data (for example no benchmark when the chart IS the benchmark) is left out and the score is scaled over what is available.
 * Score 0-100 -> grade A 75+, B 60+, C 45+, D. Signals below the minimum conviction are skipped. The backtest is run both ways so the panel shows whether the filter actually helped.
 */
function sma(values, len) {
  const out = new Array(values.length).fill(NaN); let sum = 0;
  for (let i = 0; i < values.length; i++) { sum += values[i]; if (i >= len) sum -= values[i - len]; if (i >= len - 1) out[i] = sum / len; }
  return out;
}
function rsi(close, len = 14) {
  const out = new Array(close.length).fill(NaN); let g = 0, l = 0;
  for (let i = 1; i < close.length; i++) {
    const d = close[i] - close[i - 1], up = Math.max(0, d), dn = Math.max(0, -d);
    if (i <= len) { g += up; l += dn; if (i === len) { g /= len; l /= len; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
    else { g = (g * (len - 1) + up) / len; l = (l * (len - 1) + dn) / len; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  }
  return out;
}
function macdHist(close) {
  const f = ema(close, 12), s = ema(close, 26), line = f.map((v, i) => v - s[i]), sig = ema(line.map((v) => (Number.isFinite(v) ? v : 0)), 9);
  return line.map((v, i) => (Number.isFinite(v) ? v - sig[i] : NaN));
}
/** index of the last candle in `arr` whose start time is <= t (or -1). `arr` is oldest -> newest. */
function lastIdxLE(arr, t) { let lo = 0, hi = arr.length - 1, ans = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; } return ans; }
const gradeOf = (score) => (score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 45 ? 'C' : 'D');
const clean = (list) => (list || []).map((b) => ({ t: Number(b.t), o: Number(b.o), h: Number(b.h), l: Number(b.l), c: Number(b.c), v: Number(b.v) || 0 })).filter((b) => [b.t, b.o, b.h, b.l, b.c].every(Number.isFinite));

function buildConfluence(bars, p, ind, tf, ctx) {
  const n = bars.length, close = bars.map((b) => b.c), vol = bars.map((b) => b.v);
  const rs = rsi(close, 14), mh = macdHist(close), vAvg = sma(vol, 50);
  const htf = clean(ctx.htf), bench = ctx.benchSelf ? [] : clean(ctx.bench);
  // higher-timeframe trend, evaluated on the previous COMPLETE higher-timeframe candle
  const hC = htf.map((b) => b.c), hFast = ema(hC, p.htfFast || 10), hSlow = ema(hC, p.htfSlow || 30);
  const htfState = (t) => {
    if (htf.length < (p.htfSlow || 30) + 2) return null;
    const j = lastIdxLE(htf, t) - 1; if (j < (p.htfSlow || 30)) return null;
    if (hC[j] > hSlow[j] && hFast[j] > hSlow[j]) return 'up';
    if (hC[j] < hSlow[j] && hFast[j] < hSlow[j]) return 'down';
    return 'flat';
  };
  const bC = bench.map((b) => b.c), bEma = ema(bC, p.regimeLen || 200);
  const benchAt = (t) => { const k = lastIdxLE(bench, t); return k >= (p.regimeLen || 200) ? k : (k >= 30 ? k : -1); };
  const lookback = p.rsLook || 90;
  const patternsFn = typeof ctx.patterns === 'function' ? ctx.patterns : null;
  const accDist = (i) => { let up = 0, dn = 0; for (let k = Math.max(1, i - 19); k <= i; k++) { if (close[k] >= close[k - 1]) up += vol[k]; else dn += vol[k]; } return up + dn > 0 ? up / (up + dn) : null; };

  function scoreAt(i, withPatterns) {
    const F = [];
    const add = (key, label, max, pts, detail, available = true) => F.push({ key, label, max, pts: available ? pts : 0, ok: available ? pts >= max * 0.6 : null, detail, available });
    const hs = htfState(bars[i].t);
    add('htf', 'Higher-timeframe trend', 20, hs === 'up' ? 20 : hs === 'flat' ? 8 : 0, hs === null ? 'no higher-timeframe data' : 'next timeframe up is ' + hs, hs !== null);
    const vr = Number.isFinite(vAvg[i]) && vAvg[i] > 0 ? bars[i].v / vAvg[i] : null, ad = accDist(i);
    if (vr === null || !(bars[i].v > 0)) add('volume', 'Volume', 15, 0, 'no volume data', false);
    else add('volume', 'Volume', 15, (vr >= 1.2 ? 10 : vr >= 0.9 ? 5 : 0) + (ad != null && ad >= 0.55 ? 5 : 0), (vr).toFixed(2) + '× average volume' + (ad != null ? ', ' + Math.round(ad * 100) + '% of recent volume on up candles' : ''));
    const r = rs[i], h = mh[i], hPrev = mh[i - 1];
    if (!Number.isFinite(r)) add('momentum', 'Momentum', 15, 0, 'warming up', false);
    else add('momentum', 'Momentum', 15, (r >= 50 && r <= 70 ? 10 : (r >= 45 && r < 50) || (r > 70 && r <= 78) ? 5 : 0) + (Number.isFinite(h) && h > 0 && h >= (hPrev || 0) ? 5 : 0), 'RSI ' + r.toFixed(0) + (Number.isFinite(h) ? ', MACD histogram ' + (h > 0 ? 'positive' : 'negative') + (h >= (hPrev || 0) ? ' and rising' : ' and falling') : ''));
    const bi = benchAt(bars[i].t);
    if (bi < 0 || ctx.benchSelf) { add('regime', 'Market regime', 15, 0, ctx.benchSelf ? 'this chart is the benchmark' : 'no benchmark data', false); add('rs', 'Relative strength', 10, 0, ctx.benchSelf ? 'this chart is the benchmark' : 'no benchmark data', false); }
    else {
      const above = Number.isFinite(bEma[bi]) ? bC[bi] > bEma[bi] : bC[bi] > sma(bC.slice(0, bi + 1), Math.min(bi + 1, 50)).pop();
      add('regime', 'Market regime', 15, above ? 15 : 0, 'benchmark is ' + (above ? 'above' : 'below') + ' its long average');
      const bj = bi - lookback, ij = i - lookback;
      if (bj < 0 || ij < 0) add('rs', 'Relative strength', 10, 0, 'not enough history', false);
      else { const mine = close[i] / close[ij] - 1, theirs = bC[bi] / bC[bj] - 1; add('rs', 'Relative strength', 10, mine > theirs ? 10 : 0, (mine * 100).toFixed(0) + '% vs benchmark ' + (theirs * 100).toFixed(0) + '% over ' + lookback + ' candles'); }
    }
    if (!patternsFn || !withPatterns) add('structure', 'Chart structure', 25, 0, 'pattern scanner not available', false);
    else {
      const ck = bars[0].t + ':' + bars[i].t + ':' + (i + 1);
      let res = ctx.patternCache ? ctx.patternCache.get(ck) : undefined;
      if (res === undefined) { try { res = patternsFn(bars.slice(0, i + 1)); } catch (_) { res = null; } if (ctx.patternCache) ctx.patternCache.set(ck, res); }
      if (!res || !res.ok) add('structure', 'Chart structure', 25, 0, 'not enough candles to scan', false);
      else {
        const a = ind.atr[i] > 0 ? ind.atr[i] : bars[i].c * 0.02, c0 = bars[i].c;
        const recent = (c) => c.status === 'confirmed' && Number.isFinite(c.endIdx) && i - (Number.isFinite(c.breakIdx) ? c.breakIdx : c.endIdx) <= 40;
        const bullP = (res.charts || []).filter((c) => recent(c) && c.dir === 'bull'), bearP = (res.charts || []).filter((c) => recent(c) && c.dir === 'bear');
        const above = (res.levels || []).filter((l) => l.kind === 'resistance' && l.p > c0 && l.p - c0 < a), below = (res.levels || []).filter((l) => l.kind === 'support' && l.p < c0 && c0 - l.p <= 2 * a && l.touches >= 2);
        let pts = 12; const notes = [];
        if (bullP.length) { pts += 8; notes.push('bullish ' + bullP[0].name.replace(/_/g, ' ')); }
        if (below.length) { pts += 5; notes.push('support just below'); }
        if (bearP.length) { pts -= 10; notes.push('bearish ' + bearP[0].name.replace(/_/g, ' ') + ' confirmed'); }
        if (above.length) { pts -= 6; notes.push('resistance right overhead'); }
        add('structure', 'Chart structure', 25, Math.max(0, Math.min(25, pts)), notes.length ? notes.join(', ') : 'nothing decisive');
      }
    }
    const avail = F.filter((f) => f.available), max = avail.reduce((s, f) => s + f.max, 0), got = avail.reduce((s, f) => s + f.pts, 0);
    const score = max > 0 ? Math.round((got / max) * 100) : 0;
    return { score, grade: gradeOf(score), factors: F, available: avail.length };
  }

  const rawSig = ind.sig.slice(), keptSig = ind.sig.slice(), byIndex = new Map();
  for (let i = 0; i < n; i++) {
    if (ind.sig[i] !== 1) continue;
    const c = scoreAt(i, true); byIndex.set(i, c);
    if (c.score < p.minScore) keptSig[i] = 0;
  }
  // exit: the higher timeframe rolls over while price is under the slow average
  const xsig = ind.xsig.slice();
  if (htf.length) {
    let prev = null;
    for (let i = 0; i < n; i++) { const s = htfState(bars[i].t); if (prev === 'up' && s === 'down' && close[i] < ind.slow[i]) xsig[i] = -1; if (s) prev = s; }
  }
  // exit watch on the latest candle: warnings, not orders
  let exitWatch = null;
  if (n > 30) {
    const i = n - 1, flags = [];
    if (close[i] < ind.slow[i]) flags.push('Price is below the slow EMA');
    if (htfState(bars[i].t) === 'down') flags.push('Higher-timeframe trend has turned down');
    if (Number.isFinite(rs[i]) && rs[i] < 45 && Math.max(...rs.slice(Math.max(0, i - 30), i).filter(Number.isFinite)) > 60) flags.push('Momentum is fading (RSI fell from above 60 to below 45)');
    const ad = accDist(i); if (ad != null && ad < 0.4) flags.push('Volume is leaning to the sell side (' + Math.round(ad * 100) + '% of recent volume on up candles)');
    if (patternsFn) { try { const fk = 'full:' + bars[0].t + ':' + bars[i].t + ':' + bars[i].c; let r = ctx.patternCache ? ctx.patternCache.get(fk) : undefined; if (r === undefined) { r = patternsFn(bars); if (ctx.patternCache) ctx.patternCache.set(fk, r); } const bear = r && r.ok ? (r.charts || []).filter((c) => c.status === 'confirmed' && c.dir === 'bear' && i - (Number.isFinite(c.breakIdx) ? c.breakIdx : c.endIdx) <= 30) : []; if (bear.length) flags.push('Bearish ' + bear[0].name.replace(/_/g, ' ') + ' confirmed'); } catch (_) { /* scanner optional */ } }
    exitWatch = { flags, level: flags.length >= 3 ? 'exit' : flags.length >= 1 ? 'caution' : 'clear' };
  }
  return { rawSig, keptSig, xsig, byIndex, exitWatch, htfAvailable: htf.length > 0, benchAvailable: bench.length > 0 || !!ctx.benchSelf };
}

function emptyStats() { return { trades: 0, wins: 0, losses: 0, winRate: null, avgWinR: null, avgLossR: null, expectancyR: null, profitFactor: null, totalR: 0, returnPct: 0, maxDrawdownPct: 0, avgBars: null, longs: 0, shorts: 0, compoundPct: null, avgTradePct: null }; }

function summarize(trades) {
  const s = emptyStats();
  if (!trades.length) return s;
  let win = 0, loss = 0, wins = 0, losses = 0, eq = 1, peak = 1, dd = 0, bars = 0, comp = 1, pctSum = 0;
  for (const t of trades) {
    if (t.R > 0) { win += t.R; wins++; } else { loss += -t.R; losses++; }
    eq *= 1 + 0.01 * t.R; // 1% of equity risked per trade
    peak = Math.max(peak, eq); dd = Math.max(dd, (peak - eq) / peak);
    bars += t.bars; if (t.dir > 0) s.longs++; else s.shorts++;
    if (Number.isFinite(t.pct)) { comp *= 1 + t.pct / 100; pctSum += t.pct; }
  }
  s.trades = trades.length; s.wins = wins; s.losses = losses;
  s.winRate = wins / trades.length;
  s.avgWinR = wins ? win / wins : null;
  s.avgLossR = losses ? -loss / losses : null;
  s.totalR = win - loss;
  s.expectancyR = s.totalR / trades.length;
  s.profitFactor = loss > 0 ? win / loss : (win > 0 ? Infinity : null);
  s.returnPct = (eq - 1) * 100;
  s.maxDrawdownPct = dd * 100;
  s.avgBars = bars / trades.length;
  s.compoundPct = (comp - 1) * 100; // every trade taking the whole account, one after another (what a hold strategy actually earns)
  s.avgTradePct = pctSum / trades.length;
  return s;
}

/**
 * Paper backtest. Enter at the NEXT candle's open; exit on stop, target, opposite signal (next open) or after maxHold candles.
 * If one candle touches both stop and target the stop is assumed to have hit first.
 */
function backtest(bars, p, ind) {
  const trades = [];
  const n = bars.length;
  let pos = null;
  const cost = (entry) => (entry * p.costBps * 2) / 1e4; // round trip, in price
  const close = (exitPrice, exitIdx, reason) => {
    const risk = pos.risk;
    const gross = pos.dir * (exitPrice - pos.entry);
    const R = (gross - cost(pos.entry)) / risk;
    const pctRet = ((gross - cost(pos.entry)) / pos.entry) * 100; // whole-position % result, for hold strategies
    trades.push({ dir: pos.dir, signalIdx: pos.signalIdx, entryIdx: pos.entryIdx, exitIdx, entry: pos.entry, stop: pos.stop0, target: Number.isFinite(pos.target) ? pos.target : null, exit: exitPrice, reason, R: Math.round(R * 1e4) / 1e4, pct: Math.round(pctRet * 100) / 100, bars: exitIdx - pos.entryIdx + 1 });
    pos = null;
  };
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (pos) {
      // gap through a level at the open fills at the open
      const gapStop = pos.dir > 0 ? b.o <= pos.stop : b.o >= pos.stop;
      const gapTarget = pos.dir > 0 ? b.o >= pos.target : b.o <= pos.target;
      if (i > pos.entryIdx && gapStop) close(b.o, i, 'stop'); // (target gaps are checked after a stop gap, and can never both apply)
      else if (i > pos.entryIdx && gapTarget) close(b.o, i, 'target');
      else {
        const hitStop = pos.dir > 0 ? b.l <= pos.stop : b.h >= pos.stop;
        const hitTarget = pos.dir > 0 ? b.h >= pos.target : b.l <= pos.target;
        if (hitStop) close(pos.stop, i, 'stop');
        else if (hitTarget) close(pos.target, i, 'target');
        else if (i - pos.entryIdx + 1 >= p.maxHold) close(b.c, i, 'time');
      }
    }
    // a signal on the PREVIOUS candle is acted on at this candle's open
    const prev = i > 0 ? ind.sig[i - 1] : 0;
    const prevExit = i > 0 && ind.xsig ? ind.xsig[i - 1] : 0;
    if (pos && prevExit !== 0 && prevExit === -pos.dir) close(b.o, i, 'exit-signal');
    if (prev !== 0) {
      if (pos && pos.dir !== prev) close(b.o, i, 'reverse');
      if (!pos) {
        const risk = ind.atr[i - 1] * p.stopAtr;
        const entry = b.o;
        const stop = entry - prev * risk, target = p.targetAtr == null ? (prev > 0 ? Infinity : -Infinity) : entry + prev * ind.atr[i - 1] * p.targetAtr;
        const gapped = prev > 0 ? entry <= stop : entry >= stop;
        if (risk > 0 && !gapped) {
          pos = { dir: prev, signalIdx: i - 1, entryIdx: i, entry, stop, stop0: stop, target, risk, ext: entry };
          // the entry candle itself can already hit the stop or target
          const hitStop = prev > 0 ? b.l <= stop : b.h >= stop;
          const hitTarget = prev > 0 ? b.h >= target : b.l <= target;
          if (hitStop) close(stop, i, 'stop'); else if (hitTarget) close(target, i, 'target');
        }
      }
    }
    // trailing stop: follows the best price reached, only ever tightens, and applies from the NEXT candle
    if (pos && p.trail && ind.atr[i] > 0) {
      pos.ext = pos.dir > 0 ? Math.max(pos.ext, b.h) : Math.min(pos.ext, b.l);
      const ts = pos.ext - pos.dir * p.trail * ind.atr[i];
      pos.stop = pos.dir > 0 ? Math.max(pos.stop, ts) : Math.min(pos.stop, ts);
    }
  }
  const open = pos ? { dir: pos.dir, entry: pos.entry, stop: pos.stop, target: Number.isFinite(pos.target) ? pos.target : null, entryIdx: pos.entryIdx, unrealizedR: Math.round(((pos.dir * (bars[n - 1].c - pos.entry)) / pos.risk) * 100) / 100 } : null;
  return { trades, open };
}

/** Everything the chart panel needs, from candles ordered oldest → newest. */
function analyze(rawBars, mode = 'day', overrides = {}, tf = '', ctx = {}) {
  const bars = (rawBars || []).map((b) => ({ t: Number(b.t), o: Number(b.o), h: Number(b.h), l: Number(b.l), c: Number(b.c), v: Number(b.v) || 0 }))
    .filter((b) => [b.t, b.o, b.h, b.l, b.c].every(Number.isFinite));
  const params = resolveParams(mode, overrides, tf);
  const ind = computeSignals(bars, params);
  const conf = params.minScore != null ? buildConfluence(bars, params, ind, tf, ctx || {}) : null;
  let trades, open, allTrades = null;
  if (conf) {
    // run the backtest twice: with every raw signal, and with only the signals that clear the conviction filter, so the panel can show whether the filter helped
    allTrades = backtest(bars, params, Object.assign({}, ind, { sig: conf.rawSig, xsig: conf.xsig })).trades;
    ({ trades, open } = backtest(bars, params, Object.assign({}, ind, { sig: conf.keptSig, xsig: conf.xsig })));
    const scoreOf = (t) => { const c = conf.byIndex.get(t.signalIdx); return c ? c.score : null; };
    allTrades.forEach((t) => { t.score = scoreOf(t); }); trades.forEach((t) => { t.score = scoreOf(t); });
    ind.sig = conf.keptSig;
  } else ({ trades, open } = backtest(bars, params, ind));
  const split = Math.floor(bars.length * 0.7);
  const inS = trades.filter((t) => t.entryIdx < split), oos = trades.filter((t) => t.entryIdx >= split);
  const signals = [];
  for (let i = 0; i < bars.length; i++) {
    if (!ind.sig[i]) continue;
    const dir = ind.sig[i], a = ind.atr[i];
    const cf = conf && conf.byIndex.get(i);
    signals.push({ i, t: bars[i].t, dir, conf: cf || null, price: bars[i].c, stop: bars[i].c - dir * a * params.stopAtr, target: params.targetAtr == null ? null : bars[i].c + dir * a * params.targetAtr, sep: ind.sep[i] });
  }
  const last = bars[bars.length - 1];
  const bias = !last || !Number.isFinite(ind.trend[bars.length - 1]) || bars.length < ind.warm ? 'warming' : (last.c > ind.trend[bars.length - 1] ? (ind.fast[bars.length - 1] > ind.slow[bars.length - 1] ? 'long' : 'pullback') : (ind.fast[bars.length - 1] < ind.slow[bars.length - 1] ? 'short' : 'bounce'));
  const first = bars[Math.min(ind.warm, bars.length - 1)];
  return {
    mode, params, bars: bars.length, warm: ind.warm, ind: { fast: ind.fast, slow: ind.slow, trend: ind.trend, atr: ind.atr },
    signals, latest: signals.length ? signals[signals.length - 1] : null, open, bias,
    stats: summarize(trades), inSample: summarize(inS), outOfSample: summarize(oos), trades,
    buyHoldPct: first && last && first.o ? ((last.c - first.o) / first.o) * 100 : null,
    enoughData: bars.length >= ind.warm + 30,
    confluence: conf ? (() => {
      const bucket = (g) => summarize((allTrades || []).filter((t) => t.score != null && gradeOf(t.score) === g));
      const skipped = [...conf.byIndex.entries()].filter(([, c]) => c.score < params.minScore).map(([i, c]) => ({ i, t: bars[i].t, score: c.score, grade: c.grade }));
      return { minScore: params.minScore, all: summarize(allTrades || []), kept: summarize(trades), buckets: { A: bucket('A'), B: bucket('B'), C: bucket('C'), D: bucket('D') }, skipped, exitWatch: conf.exitWatch, htf: conf.htfAvailable, bench: conf.benchAvailable };
    })() : null
  };
}

module.exports = { rsi, macdHist, sma, gradeOf, buildConfluence, STRATEGIES, INTRADAY, resolveParams, ema, atr, computeSignals, backtest, summarize, analyze, sessionAllows, minutesET };
