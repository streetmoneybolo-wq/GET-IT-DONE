'use strict';

/*
 * MEM ALGO — the Making Easy Money EMA-crossover model for the Academy Live Chart Lab.
 *
 * Educational simulation only: it draws signals and runs a backtest on candles the chart already has.
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
 *  - bestTf: the chart interval the strategy is designed for; turning MEM ALGO on or picking a mode switches the chart to it (preferredTf).
 *  - maxSep: skip entries where price is already stretched more than this many ATR from the slow EMA (guards shorts against chasing a drop into a squeeze).
 */

const INTRADAY = ['1m', '3m', '5m', '10m', '15m', '30m'];

const STRATEGIES = {
  day: {
    key: 'day',
    label: 'Day Trading',
    blurb: 'Fast EMA(9) vs slow EMA(21) inside the EMA(100) trend, on intraday candles. Skips the first 10 minutes and last 15 minutes of the regular session.',
    tfHint: INTRADAY,
    bestTf: '5m', // chart interval this mode switches to: EMA(100) spans ~1.5 sessions of 5m candles and the 10/15-minute session skips stay meaningful
    params: { fast: 9, slow: 21, trend: 100, atr: 14, minSep: 0.35, confirm: 2, stopAtr: 1.2, targetAtr: 2.4, maxHold: 40, costBps: 2, session: { open: 570, close: 960, skipOpen: 10, skipClose: 15 }, minScore: 0, htfFast: 10, htfSlow: 30, regimeLen: 200, rsLook: 60 }
  },
  swing: {
    key: 'swing',
    label: 'Swing Trading',
    blurb: 'Fast EMA(20) vs slow EMA(50) inside the EMA(200) trend, on hourly or daily candles. Wider ATR stops, held for days to weeks.',
    tfHint: ['1h', '2h', '4h', '1D'],
    bestTf: '1D', // held days to weeks: on daily candles maxHold 40 is about two months and EMA(200) is the classic trend filter (on 1h a trade would be capped at ~6 sessions)
    params: { fast: 20, slow: 50, trend: 200, atr: 14, minSep: 0.5, confirm: 2, stopAtr: 2.0, targetAtr: 4.0, maxHold: 40, costBps: 2, session: null, minScore: 0, htfFast: 10, htfSlow: 30, regimeLen: 200, rsLook: 60 }
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
    params: { fast: 12, slow: 26, trend: 100, atr: 14, minSep: 0.5, maxSep: 3.5, confirm: 2, stopAtr: 1.6, targetAtr: 3.2, trail: null, maxHold: 30, costBps: 4, session: null, minScore: 0, htfFast: 10, htfSlow: 30, regimeLen: 200, rsLook: 60 }
  }
};

/** The chart interval a strategy is built for (what the chart switches to when the member picks that mode). */
function preferredTf(mode) { const st = STRATEGIES[mode] || STRATEGIES.day; return st.bestTf || st.tfHint[0]; }

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


/* ---------- Confluence (every strategy) ----------
 * A crossover on its own is one opinion. Before a signal is taken, the model asks what else agrees. Every factor is read for the trade's side
 * (a SELL wants the mirror image of what a BUY wants, so the short model scores on bearish readings). Day, Swing and Short default to no minimum
 * (every signal is graded, nothing skipped) and the member raises the minimum in Settings; the hold strategies default to 55. The first six
 * factors use only data already on the page:
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
  const sigVotes = ctx.signals || null;
  const ofData = ctx.orderFlow && ctx.orderFlow.ready ? ctx.orderFlow : null;
  /* the full-depth reading (academy-depth-insights.js): passed on its own or riding on the order-flow answer */
  const deepData = ctx.depth && ctx.depth.ready ? ctx.depth : (ctx.orderFlow && ctx.orderFlow.depth && ctx.orderFlow.depth.ready ? ctx.orderFlow.depth : null);
  /* sweep-versus-wall events of the last ten minutes (academy-sweep-wall.js): a confirmed breakout with the trade helps, a sweep absorbed against it hurts */
  const swAll = ctx.orderFlow && ctx.orderFlow.sweepWall && Array.isArray(ctx.orderFlow.sweepWall.events) ? ctx.orderFlow.sweepWall.events : [];
  const swNow = Number.isFinite(Number(ctx.now)) ? Number(ctx.now) : Date.now();
  const swRecent = swAll.filter((e) => e && Number.isFinite(e.t) && swNow - e.t <= 10 * 60_000);
  /* the week: the daily flow ledger read as a window (academy-flow-read.js); two trading days at least */
  const weekData = ctx.flowDays && ctx.flowDays.ok && ctx.flowDays.window && ctx.flowDays.window.available && ctx.flowDays.window.days >= 2 ? ctx.flowDays.window : null;
  const earnData = ctx.earnings || null;
  const dirData = ctx.direction && ctx.direction.ok ? ctx.direction : null;
  const sentData = ctx.sentiment && ctx.sentiment.ok ? ctx.sentiment : null;
  const dpData = ctx.darkPool && ctx.darkPool.available ? ctx.darkPool : null;
  const gxData = ctx.gamma && ctx.gamma.available ? ctx.gamma : null;
  const inData = ctx.institutional && ctx.institutional.available ? ctx.institutional : null;
  const fiData = ctx.filings && ctx.filings.available ? ctx.filings : null;

  /* dir: +1 scores a BUY, -1 a SELL. Every factor is read for the trade's side: for a short, a falling higher timeframe, sell-side volume,
     RSI under 50, a benchmark below its average, lagging the benchmark, bearish structure, bearish flow and sentiment are the good readings. */
  function scoreAt(i, withPatterns, dir = 1) {
    const d = dir < 0 ? -1 : 1, side = d > 0 ? 'the long' : 'the short';
    const F = [];
    const add = (key, label, max, pts, detail, available = true) => F.push({ key, label, max, pts: available ? pts : 0, ok: available ? pts >= max * 0.6 : null, detail, available });
    const hs = htfState(bars[i].t), hsFor = hs === null ? null : d > 0 ? hs : (hs === 'up' ? 'down' : hs === 'down' ? 'up' : 'flat');
    add('htf', 'Higher-timeframe trend', 20, hsFor === 'up' ? 20 : hsFor === 'flat' ? 8 : 0, hs === null ? 'no higher-timeframe data' : 'next timeframe up is ' + hs, hs !== null);
    const vr = Number.isFinite(vAvg[i]) && vAvg[i] > 0 ? bars[i].v / vAvg[i] : null, ad = accDist(i), adFor = ad == null ? null : (d > 0 ? ad : 1 - ad);
    if (vr === null || !(bars[i].v > 0)) add('volume', 'Volume', 15, 0, 'no volume data', false);
    else add('volume', 'Volume', 15, (vr >= 1.2 ? 10 : vr >= 0.9 ? 5 : 0) + (adFor != null && adFor >= 0.55 ? 5 : 0), (vr).toFixed(2) + '× average volume' + (ad != null ? ', ' + Math.round(ad * 100) + '% of recent volume on up candles' : ''));
    const r = rs[i], h = mh[i], hPrev = mh[i - 1], rFor = d > 0 ? r : 100 - r, hFor = h * d, hPrevFor = (hPrev || 0) * d;
    if (!Number.isFinite(r)) add('momentum', 'Momentum', 15, 0, 'warming up', false);
    else add('momentum', 'Momentum', 15, (rFor >= 50 && rFor <= 70 ? 10 : (rFor >= 45 && rFor < 50) || (rFor > 70 && rFor <= 78) ? 5 : 0) + (Number.isFinite(h) && hFor > 0 && hFor >= hPrevFor ? 5 : 0), 'RSI ' + r.toFixed(0) + (Number.isFinite(h) ? ', MACD histogram ' + (h > 0 ? 'positive' : 'negative') + (h >= (hPrev || 0) ? ' and rising' : ' and falling') : ''));
    const bi = benchAt(bars[i].t);
    if (bi < 0 || ctx.benchSelf) { add('regime', 'Market regime', 15, 0, ctx.benchSelf ? 'this chart is the benchmark' : 'no benchmark data', false); add('rs', 'Relative strength', 10, 0, ctx.benchSelf ? 'this chart is the benchmark' : 'no benchmark data', false); }
    else {
      const above = Number.isFinite(bEma[bi]) ? bC[bi] > bEma[bi] : bC[bi] > sma(bC.slice(0, bi + 1), Math.min(bi + 1, 50)).pop();
      add('regime', 'Market regime', 15, (d > 0 ? above : !above) ? 15 : 0, 'benchmark is ' + (above ? 'above' : 'below') + ' its long average');
      const bj = bi - lookback, ij = i - lookback;
      if (bj < 0 || ij < 0) add('rs', 'Relative strength', 10, 0, 'not enough history', false);
      else { const mine = close[i] / close[ij] - 1, theirs = bC[bi] / bC[bj] - 1; add('rs', 'Relative strength', 10, (d > 0 ? mine > theirs : mine < theirs) ? 10 : 0, (mine * 100).toFixed(0) + '% vs benchmark ' + (theirs * 100).toFixed(0) + '% over ' + lookback + ' candles' + (d < 0 ? ' (weaker than the market helps ' + side + ')' : '')); }
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
        // levels that help the trade sit behind it (support under a long, resistance over a short); the ones that hurt sit right in front of it
        const resNear = (res.levels || []).filter((l) => l.kind === 'resistance' && l.p > c0 && l.p - c0 < a), supNear = (res.levels || []).filter((l) => l.kind === 'support' && l.p < c0 && c0 - l.p < a);
        const supBehind = (res.levels || []).filter((l) => l.kind === 'support' && l.p < c0 && c0 - l.p <= 2 * a && l.touches >= 2), resBehind = (res.levels || []).filter((l) => l.kind === 'resistance' && l.p > c0 && l.p - c0 <= 2 * a && l.touches >= 2);
        const withP = d > 0 ? bullP : bearP, againstP = d > 0 ? bearP : bullP, behind = d > 0 ? supBehind : resBehind, inFront = d > 0 ? resNear : supNear;
        let pts = 12; const notes = [];
        if (withP.length) { pts += 8; notes.push((d > 0 ? 'bullish ' : 'bearish ') + withP[0].name.replace(/_/g, ' ')); }
        if (behind.length) { pts += 5; notes.push(d > 0 ? 'support just below' : 'resistance just above'); }
        if (againstP.length) { pts -= 10; notes.push((d > 0 ? 'bearish ' : 'bullish ') + againstP[0].name.replace(/_/g, ' ') + ' confirmed'); }
        if (inFront.length) { pts -= 6; notes.push(d > 0 ? 'resistance right overhead' : 'support right underneath'); }
        add('structure', 'Chart structure', 25, Math.max(0, Math.min(25, pts)), notes.length ? notes.join(', ') : 'nothing decisive');
      }
    }
    if (!sigVotes) add('signals', 'MEM Signals ensemble', 15, 0, 'signal models not loaded', false);
    else {
      const names = Object.keys(sigVotes); let agree = 0, total = 0;
      for (const k of names) { const v = sigVotes[k]; if (v && i < v.length && Number.isFinite(v[i]) && Math.abs(v[i]) >= 0.15) { total++; if (v[i] * d > 0) agree++; } }
      if (total < 3) add('signals', 'MEM Signals ensemble', 15, 0, 'not enough signal data', false);
      else { const ratio = agree / total; add('signals', 'MEM Signals ensemble', 15, ratio >= 0.75 ? 15 : ratio >= 0.6 ? 10 : ratio >= 0.45 ? 5 : 0, agree + ' of ' + total + ' models agree (' + Math.round(ratio * 100) + '%)'); }
    }
    if (!ofData) add('orderflow', 'Order flow', 10, 0, 'order flow not available', false);
    else {
      const bias = ofData.bias, sc = Number(ofData.score) || 0;
      const strong = Math.abs(sc) > 30;
      const withFlow = d > 0 ? (bias === 'bullish' && sc > 10) : (bias === 'bearish' && sc < -10);
      add('orderflow', 'Order flow', 10, withFlow ? (strong ? 10 : 5) : 0, bias + ' (score ' + sc + ')' + (strong ? ' — strong' : ''));
    }
    /* full-depth book and tape: pressure for the trade's side, a CVD divergence for or against it, and a wall right in front of it */
    if (!deepData && !swRecent.length) add('depth', 'Full-depth book & tape', 10, 0, 'full order book not available', false);
    else {
      const sc = deepData ? Number(deepData.pressure && deepData.pressure.score) || 0 : 0, ps = sc * d;
      let pts = ps >= 40 ? 7 : ps >= 20 ? 5 : ps > -20 ? 3 : 0; const notes = deepData ? [(deepData.pressure && deepData.pressure.label) || 'balanced', '(' + (sc > 0 ? '+' : '') + sc + ')'] : ['book pressure not available'];
      const div = deepData && deepData.flow && deepData.flow.divergence;
      if (div) { const withDiv = d > 0 ? div === 'bullish' : div === 'bearish'; pts += withDiv ? 3 : -3; notes.push(withDiv ? (d > 0 ? 'the dip is being bought' : 'the lift is being sold into') : (d > 0 ? 'the lift is being sold into' : 'the dip is being bought')); }
      const a = ind.atr[i] > 0 ? ind.atr[i] : bars[i].c * 0.005, c0 = bars[i].c;
      const front = deepData ? (deepData.walls || []).find((w) => (d > 0 ? w.kind === 'ask' && w.price > c0 && w.price - c0 <= 0.5 * a : w.kind === 'bid' && w.price < c0 && c0 - w.price <= 0.5 * a)) : null;
      if (front) { pts -= 2; notes.push((d > 0 ? 'ask' : 'bid') + ' wall ' + Math.round(front.size).toLocaleString() + ' right in front'); }
      /* sweep versus wall: the latest event decides; a breakout the trade's way confirms, a sweep absorbed or a false break against it warns */
      const sw = swRecent[0];
      if (sw) {
        const mine = d > 0 ? 'bull' : 'bear';
        if (sw.side === mine && sw.outcome === 'breakout_confirmed') { pts += 2; notes.push('a sweep ate the wall at ' + Number(sw.price).toFixed(2) + ' and price held (breakout confirmed)'); }
        else if (sw.side !== mine) { pts -= 3; notes.push(sw.outcome === 'sweep_absorbed' ? 'a sweep ' + (d > 0 ? 'up' : 'down') + ' was absorbed by the wall at ' + Number(sw.price).toFixed(2) : sw.outcome === 'false_break' ? 'a false break at ' + Number(sw.price).toFixed(2) + ' against the ' + side : 'a sweep broke the wall at ' + Number(sw.price).toFixed(2) + ' against the ' + side); }
      }
      add('depth', 'Full-depth book & tape', 10, Math.max(0, Math.min(10, pts)), notes.join(' '));
    }
    /* multi-day flow: the week's accumulation / distribution score for the trade's side, and a multi-day CVD divergence */
    if (!weekData) add('flowdays', 'Multi-day flow', 10, 0, 'daily flow ledger not available', false);
    else {
      const sc = Number(weekData.score) || 0, ws = sc * d;
      let pts = ws >= 40 ? 7 : ws >= 20 ? 5 : ws > -20 ? 3 : 0; const notes = [weekData.label + ' over ' + weekData.days + ' day' + (weekData.days === 1 ? '' : 's') + ' (' + (sc > 0 ? '+' : '') + sc + ')'];
      const dv = weekData.divergence;
      if (dv) { const withDiv = d > 0 ? dv === 'bullish' : dv === 'bearish'; pts += withDiv ? 3 : -3; notes.push(withDiv ? (d > 0 ? 'the drop is being accumulated' : 'the rise is being distributed') : (d > 0 ? 'the rise is being distributed' : 'the drop is being accumulated')); }
      add('flowdays', 'Multi-day flow', 10, Math.max(0, Math.min(10, pts)), notes.join(', '));
    }
    if (!earnData) add('earnings', 'Earnings safety', 10, 10, 'no earnings data — assumed safe', true);
    else {
      const d = Number(earnData.daysAway);
      if (!Number.isFinite(d)) add('earnings', 'Earnings safety', 10, 10, 'no upcoming earnings found', true);
      else add('earnings', 'Earnings safety', 10, d <= 3 ? 0 : d <= 7 ? 3 : d <= 14 ? 7 : 10, 'earnings in ' + d + ' day' + (d === 1 ? '' : 's') + (d <= 3 ? ' — high risk' : d <= 7 ? ' — elevated risk' : ''));
    }
    if (!dirData) add('direction', 'Market direction', 10, 0, 'market direction not available', false);
    else {
      const db = Number(dirData.bias) || 0;
      add('direction', 'Market direction', 10, db * d > 30 ? 10 : db * d > 0 ? 5 : 0, dirData.label + ' (bias ' + db + ')');
    }
    if (!sentData) add('sentiment', 'Sentiment', 10, 0, 'sentiment not available', false);
    else {
      const ss = Number(sentData.score) || 0;
      add('sentiment', 'Sentiment', 10, ss * d > 0.3 ? 10 : ss * d > 0 ? 5 : 0, sentData.label + ' (' + (ss * 100).toFixed(0) + '%)');
    }
    if (!dpData || !dpData.lean) add('darkpool', 'Dark pool flow', 5, 0, 'dark pool data not available', false);
    else {
      const lean = dpData.lean.label || '';
      const bullLean = /buy|bull|accum/i.test(lean), bearLean = /sell|bear|distrib/i.test(lean);
      add('darkpool', 'Dark pool flow', 5, (d > 0 ? bullLean : bearLean) ? 5 : /neutral/i.test(lean) ? 2 : 0, lean);
    }
    if (!gxData) add('gamma', 'Gamma pressure', 15, 0, 'options positioning not available', false);
    else {
      const dampened = gxData.regime === 'positive', pr = Number(gxData.pressurePct);
      const a = ind.atr[i] > 0 ? ind.atr[i] / bars[i].c * 100 : 2; // one ATR as a percent of price
      const cw = gxData.callWall && Number.isFinite(Number(gxData.callWall.distancePct)) ? Number(gxData.callWall.distancePct) : null;
      const pw = gxData.putWall && Number.isFinite(Number(gxData.putWall.distancePct)) ? Number(gxData.putWall.distancePct) : null;
      let pts = dampened ? 8 : 2; const notes = [dampened ? 'dealer hedging dampens moves' : 'dealer hedging amplifies moves'];
      if (Number.isFinite(pr) && pr >= 2 && dampened) { pts += 3; notes.push('hedge flow is ' + pr.toFixed(1) + '% of daily volume'); }
      // the wall behind the trade is a floor or ceiling in its favour; the wall in front caps it
      const behindW = d > 0 ? pw : cw, frontW = d > 0 ? cw : pw;
      if (behindW != null && behindW <= 2 * a) { pts += 4; notes.push((d > 0 ? 'put wall ' : 'call wall ') + behindW.toFixed(1) + (d > 0 ? '% below' : '% above')); }
      if (frontW != null && frontW <= a) { pts -= 4; notes.push((d > 0 ? 'call wall ' : 'put wall ') + frontW.toFixed(1) + (d > 0 ? '% overhead' : '% underneath')); }
      if (Number(gxData.zeroDteShare) >= 0.4) { pts -= 2; notes.push('mostly 0DTE, profile decays today'); }
      add('gamma', 'Gamma pressure', 15, Math.max(0, Math.min(15, pts)), notes.join(', ') + (gxData.basis === 'inferred' ? ' (dealer side inferred from prints)' : ' (standard dealer assumption)'));
    }
    if (!inData) add('institutional', 'Institutional flow', 10, 0, 'size-bucket and sweep data not available', false);
    else {
      const ib = (Number(inData.bias) || 0) * d;
      let pts = ib >= 40 ? 10 : ib >= 15 ? 6 : ib > -15 ? 3 : 0;
      if (inData.retailVsInstitutional === (d > 0 ? 'institutions buying what retail sells' : 'institutions selling into retail buying') && pts < 10) pts += 2;
      if (Array.isArray(inData.notes) && inData.notes.length) pts = Math.min(pts, 5);
      add('institutional', 'Institutional flow', 10, Math.max(0, Math.min(10, pts)), inData.label + ' (bias ' + (Number(inData.bias) || 0) + ')' + (inData.retailVsInstitutional && inData.retailVsInstitutional !== 'same direction' ? ', ' + inData.retailVsInstitutional : ''));
    }
    if (!fiData) add('filings', 'Insider filings', 5, 0, 'SEC filings not available', false);
    else {
      const fb = Number(fiData.bias) || 0, ins = fiData.insiders || {}, cluster = Boolean(ins.cluster);
      const heavySell = ins.last90 && Number(ins.last90.sellValue) >= 5_000_000 && fb <= -40;
      const pts = d > 0 ? (cluster ? 5 : fb >= 15 ? 4 : heavySell ? 0 : fb <= -15 ? 1 : 2) : (cluster ? 0 : heavySell ? 5 : fb <= -15 ? 4 : fb >= 15 ? 1 : 2);
      add('filings', 'Insider filings', 5, pts, fiData.label + (fiData.activistRecent ? ', 13D filed in the last 60 days' : '') + (ins.last90 ? ' (' + ins.last90.buys + ' buys / ' + ins.last90.sells + ' sells in 90 days)' : ''));
    }
    const avail = F.filter((f) => f.available), max = avail.reduce((s, f) => s + f.max, 0), got = avail.reduce((s, f) => s + f.pts, 0);
    const score = max > 0 ? Math.round((got / max) * 100) : 0;
    return { score, grade: gradeOf(score), factors: F, available: avail.length };
  }

  const rawSig = ind.sig.slice(), keptSig = ind.sig.slice(), byIndex = new Map();
  let lastDir = p.dirs === 'short' ? -1 : 1;
  for (let i = 0; i < n; i++) {
    if (!ind.sig[i]) continue;
    const c = scoreAt(i, true, ind.sig[i]); byIndex.set(i, c);
    if (c.score < p.minScore) keptSig[i] = 0; else lastDir = ind.sig[i];
  }
  // exit: the higher timeframe rolls over against the trade while price is through the slow average
  const xsig = ind.xsig.slice();
  if (htf.length) {
    let prev = null;
    for (let i = 0; i < n; i++) {
      const s = htfState(bars[i].t);
      if (p.dirs !== 'short' && prev === 'up' && s === 'down' && close[i] < ind.slow[i]) xsig[i] = -1;
      if (p.dirs !== 'long' && prev === 'down' && s === 'up' && close[i] > ind.slow[i]) xsig[i] = 1;
      if (s) prev = s;
    }
  }
  // exit watch on the latest candle, read for the side of the most recent kept signal: warnings, not orders
  let exitWatch = null;
  if (n > 30) {
    const i = n - 1, flags = [], ld = lastDir;
    if (ld > 0 ? close[i] < ind.slow[i] : close[i] > ind.slow[i]) flags.push('Price is ' + (ld > 0 ? 'below' : 'above') + ' the slow EMA');
    if (htfState(bars[i].t) === (ld > 0 ? 'down' : 'up')) flags.push('Higher-timeframe trend has turned ' + (ld > 0 ? 'down' : 'up'));
    const rsWin = rs.slice(Math.max(0, i - 30), i).filter(Number.isFinite);
    if (Number.isFinite(rs[i]) && (ld > 0 ? rs[i] < 45 && Math.max(...rsWin) > 60 : rs[i] > 55 && Math.min(...rsWin) < 40)) flags.push(ld > 0 ? 'Momentum is fading (RSI fell from above 60 to below 45)' : 'Momentum is turning up (RSI rose from below 40 to above 55)');
    const ad = accDist(i); if (ad != null && (ld > 0 ? ad < 0.4 : ad > 0.6)) flags.push('Volume is leaning to the ' + (ld > 0 ? 'sell' : 'buy') + ' side (' + Math.round(ad * 100) + '% of recent volume on up candles)');
    if (deepData) {
      const sc = Number(deepData.pressure && deepData.pressure.score) || 0;
      if (sc * ld <= -40) flags.push('The full-depth book and tape are against the position (pressure ' + (sc > 0 ? '+' : '') + sc + ')');
      const div = deepData.flow && deepData.flow.divergence;
      if (div && (ld > 0 ? div === 'bearish' : div === 'bullish')) flags.push(ld > 0 ? 'CVD divergence: the lift is being sold into' : 'CVD divergence: the dip is being bought');
    }
    const swAgainst = swRecent.find((e) => e.side !== (ld > 0 ? 'bull' : 'bear'));
    if (swAgainst) flags.push(swAgainst.outcome === 'sweep_absorbed' ? 'A sweep in your direction was absorbed by the wall at ' + Number(swAgainst.price).toFixed(2) + ' (the level held)' : swAgainst.outcome === 'false_break' ? 'A false break at ' + Number(swAgainst.price).toFixed(2) + ': the wall was eaten, then price came back' : 'A sweep broke the wall at ' + Number(swAgainst.price).toFixed(2) + ' against the position and held');
    if (weekData) {
      const sc = Number(weekData.score) || 0;
      if (sc * ld <= -40) flags.push('The week is against the position: ' + weekData.label + ' over ' + weekData.days + ' days (' + (sc > 0 ? '+' : '') + sc + ')');
      const dv = weekData.divergence;
      if (dv && (ld > 0 ? dv === 'bearish' : dv === 'bullish')) flags.push(ld > 0 ? 'Multi-day divergence: the rise is being sold into' : 'Multi-day divergence: the drop is being bought');
    }
    if (patternsFn) { try { const fk = 'full:' + bars[0].t + ':' + bars[i].t + ':' + bars[i].c; let r = ctx.patternCache ? ctx.patternCache.get(fk) : undefined; if (r === undefined) { r = patternsFn(bars); if (ctx.patternCache) ctx.patternCache.set(fk, r); } const against = r && r.ok ? (r.charts || []).filter((c) => c.status === 'confirmed' && c.dir === (ld > 0 ? 'bear' : 'bull') && i - (Number.isFinite(c.breakIdx) ? c.breakIdx : c.endIdx) <= 30) : []; if (against.length) flags.push((ld > 0 ? 'Bearish ' : 'Bullish ') + against[0].name.replace(/_/g, ' ') + ' confirmed'); } catch (_) { /* scanner optional */ } }
    exitWatch = { flags, level: flags.length >= 3 ? 'exit' : flags.length >= 1 ? 'caution' : 'clear', dir: ld };
  }
  return { rawSig, keptSig, xsig, byIndex, exitWatch, htfAvailable: htf.length > 0, benchAvailable: bench.length > 0 || !!ctx.benchSelf, depthAvailable: Boolean(deepData), flowDaysAvailable: Boolean(weekData) };
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
 * Backtest. Enter at the NEXT candle's open; exit on stop, target, opposite signal (next open) or after maxHold candles.
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
      return { minScore: params.minScore, all: summarize(allTrades || []), kept: summarize(trades), buckets: { A: bucket('A'), B: bucket('B'), C: bucket('C'), D: bucket('D') }, skipped, exitWatch: conf.exitWatch, htf: conf.htfAvailable, bench: conf.benchAvailable, depth: conf.depthAvailable, flowDays: conf.flowDaysAvailable };
    })() : null
  };
}

module.exports = { preferredTf, rsi, macdHist, sma, gradeOf, buildConfluence, STRATEGIES, INTRADAY, resolveParams, ema, atr, computeSignals, backtest, summarize, analyze, sessionAllows, minutesET };
