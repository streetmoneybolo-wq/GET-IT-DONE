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
  }
};

function clampInt(v, lo, hi, dflt) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; }
function clampNum(v, lo, hi, dflt) { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; }

/** Merge user overrides into a strategy's defaults with hard limits, so a bad input can never break the model. */
function resolveParams(mode, overrides = {}) {
  const base = (STRATEGIES[mode] || STRATEGIES.day).params;
  const o = overrides || {};
  const p = {
    fast: clampInt(o.fast, 2, 200, base.fast), slow: clampInt(o.slow, 3, 400, base.slow), trend: clampInt(o.trend, 5, 600, base.trend),
    atr: clampInt(o.atr, 2, 100, base.atr), minSep: clampNum(o.minSep, 0, 5, base.minSep), confirm: clampInt(o.confirm, 1, 10, base.confirm),
    stopAtr: clampNum(o.stopAtr, 0.2, 10, base.stopAtr), targetAtr: clampNum(o.targetAtr, 0.2, 20, base.targetAtr),
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
  const sig = new Array(n).fill(0), sep = new Array(n).fill(NaN);
  let above = 0, below = 0;
  for (let i = 0; i < n; i++) {
    const up = fast[i] > slow[i], dn = fast[i] < slow[i];
    above = up ? above + 1 : 0;
    below = dn ? below + 1 : 0;
    // how far price has pulled away from the slow EMA, in ATRs. (The gap BETWEEN the two EMAs is ~0 right after a cross, so it cannot be the gate.)
    sep[i] = a[i] > 0 ? Math.abs(close[i] - slow[i]) / a[i] : NaN;
    if (i < warm || !(a[i] > 0)) continue;
    const volOk = sep[i] >= p.minSep;
    if (!volOk || !sessionAllows(bars[i].t, p.session)) continue;
    if (above === p.confirm && close[i] > trend[i] && close[i] > slow[i]) sig[i] = 1;
    else if (below === p.confirm && close[i] < trend[i] && close[i] < slow[i]) sig[i] = -1;
  }
  return { fast, slow, trend, atr: a, sep, sig, warm };
}

function emptyStats() { return { trades: 0, wins: 0, losses: 0, winRate: null, avgWinR: null, avgLossR: null, expectancyR: null, profitFactor: null, totalR: 0, returnPct: 0, maxDrawdownPct: 0, avgBars: null, longs: 0, shorts: 0 }; }

function summarize(trades) {
  const s = emptyStats();
  if (!trades.length) return s;
  let win = 0, loss = 0, wins = 0, losses = 0, eq = 1, peak = 1, dd = 0, bars = 0;
  for (const t of trades) {
    if (t.R > 0) { win += t.R; wins++; } else { loss += -t.R; losses++; }
    eq *= 1 + 0.01 * t.R; // 1% of equity risked per trade
    peak = Math.max(peak, eq); dd = Math.max(dd, (peak - eq) / peak);
    bars += t.bars; if (t.dir > 0) s.longs++; else s.shorts++;
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
    trades.push({ dir: pos.dir, signalIdx: pos.signalIdx, entryIdx: pos.entryIdx, exitIdx, entry: pos.entry, stop: pos.stop, target: pos.target, exit: exitPrice, reason, R: Math.round(R * 1e4) / 1e4, bars: exitIdx - pos.entryIdx + 1 });
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
    if (prev !== 0) {
      if (pos && pos.dir !== prev) close(b.o, i, 'reverse');
      if (!pos) {
        const risk = ind.atr[i - 1] * p.stopAtr;
        const entry = b.o;
        const stop = entry - prev * risk, target = entry + prev * ind.atr[i - 1] * p.targetAtr;
        const gapped = prev > 0 ? entry <= stop : entry >= stop;
        if (risk > 0 && !gapped) {
          pos = { dir: prev, signalIdx: i - 1, entryIdx: i, entry, stop, target, risk };
          // the entry candle itself can already hit the stop or target
          const hitStop = prev > 0 ? b.l <= stop : b.h >= stop;
          const hitTarget = prev > 0 ? b.h >= target : b.l <= target;
          if (hitStop) close(stop, i, 'stop'); else if (hitTarget) close(target, i, 'target');
        }
      }
    }
  }
  const open = pos ? { dir: pos.dir, entry: pos.entry, stop: pos.stop, target: pos.target, entryIdx: pos.entryIdx, unrealizedR: Math.round(((pos.dir * (bars[n - 1].c - pos.entry)) / pos.risk) * 100) / 100 } : null;
  return { trades, open };
}

/** Everything the chart panel needs, from candles ordered oldest → newest. */
function analyze(rawBars, mode = 'day', overrides = {}) {
  const bars = (rawBars || []).map((b) => ({ t: Number(b.t), o: Number(b.o), h: Number(b.h), l: Number(b.l), c: Number(b.c), v: Number(b.v) || 0 }))
    .filter((b) => [b.t, b.o, b.h, b.l, b.c].every(Number.isFinite));
  const params = resolveParams(mode, overrides);
  const ind = computeSignals(bars, params);
  const { trades, open } = backtest(bars, params, ind);
  const split = Math.floor(bars.length * 0.7);
  const inS = trades.filter((t) => t.entryIdx < split), oos = trades.filter((t) => t.entryIdx >= split);
  const signals = [];
  for (let i = 0; i < bars.length; i++) {
    if (!ind.sig[i]) continue;
    const dir = ind.sig[i], a = ind.atr[i];
    signals.push({ i, t: bars[i].t, dir, price: bars[i].c, stop: bars[i].c - dir * a * params.stopAtr, target: bars[i].c + dir * a * params.targetAtr, sep: ind.sep[i] });
  }
  const last = bars[bars.length - 1];
  const bias = !last || !Number.isFinite(ind.trend[bars.length - 1]) || bars.length < ind.warm ? 'warming' : (last.c > ind.trend[bars.length - 1] ? (ind.fast[bars.length - 1] > ind.slow[bars.length - 1] ? 'long' : 'pullback') : (ind.fast[bars.length - 1] < ind.slow[bars.length - 1] ? 'short' : 'bounce'));
  const first = bars[Math.min(ind.warm, bars.length - 1)];
  return {
    mode, params, bars: bars.length, warm: ind.warm, ind: { fast: ind.fast, slow: ind.slow, trend: ind.trend, atr: ind.atr },
    signals, latest: signals.length ? signals[signals.length - 1] : null, open, bias,
    stats: summarize(trades), inSample: summarize(inS), outOfSample: summarize(oos), trades,
    buyHoldPct: first && last && first.o ? ((last.c - first.o) / first.o) * 100 : null,
    enoughData: bars.length >= ind.warm + 30
  };
}

module.exports = { STRATEGIES, INTRADAY, resolveParams, ema, atr, computeSignals, backtest, summarize, analyze, sessionAllows, minutesET };
