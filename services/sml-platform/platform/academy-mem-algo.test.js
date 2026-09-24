'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const algo = require('./academy-mem-algo');

/* deterministic candles: an up-trend with pullbacks, then a down-trend (daily-like, so no session filter applies) */
function series(n = 900, seed = 7) {
  let x = seed; const rnd = () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; };
  const bars = []; let price = 100;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 7) * 0.7 + (i < n / 2 ? 0.12 : -0.12);
    const o = price, c = Math.max(5, o + drift + (rnd() - 0.5) * 1.6);
    const h = Math.max(o, c) + rnd() * 0.9, l = Math.min(o, c) - rnd() * 0.9;
    bars.push({ t: Date.UTC(2024, 0, 1) + i * 86400000, o, h, l, c, v: 1000 });
    price = c;
  }
  return bars;
}

/* the original Pine logic, transcribed: confirmation required aboveRun >= confirm AND the raw cross bar */
function legacyCount(bars, p) {
  const close = bars.map((b) => b.c);
  const fast = algo.ema(close, p.fast), slow = algo.ema(close, p.slow), trend = algo.ema(close, p.trend), atr = algo.atr(bars, p.atr);
  let above = 0, below = 0, count = 0;
  for (let i = 1; i < bars.length; i++) {
    const crossUp = fast[i] > slow[i] && fast[i - 1] <= slow[i - 1], crossDn = fast[i] < slow[i] && fast[i - 1] >= slow[i - 1];
    above = fast[i] > slow[i] ? above + 1 : 0; below = fast[i] < slow[i] ? below + 1 : 0;
    const sep = atr[i] > 0 ? Math.abs(fast[i] - slow[i]) / atr[i] : 0, volOk = sep >= p.minSep;
    if ((above >= p.confirm && crossUp && close[i] > trend[i] && volOk) || (below >= p.confirm && crossDn && close[i] < trend[i] && volOk)) count++;
  }
  return count;
}

test('the original indicator can never fire with 2 confirmation bars; MEM ALGO does', () => {
  const bars = series();
  const p = algo.resolveParams('swing');
  assert.equal(legacyCount(bars, { ...p, confirm: 2, minSep: 0 }), 0);
  const a = algo.analyze(bars, 'swing', { minSep: 0 });
  assert.ok(a.signals.length >= 3, `expected signals, got ${a.signals.length}`);
});

test('decisions never look ahead: signals on a prefix equal the same signals on the full series', () => {
  const bars = series();
  const full = algo.analyze(bars, 'swing', { minSep: 0.2 }).signals;
  const cut = 600;
  const prefix = algo.analyze(bars.slice(0, cut), 'swing', { minSep: 0.2 }).signals;
  assert.deepEqual(prefix.map((s) => [s.i, s.dir]), full.filter((s) => s.i < cut).map((s) => [s.i, s.dir]));
});

test('a long fires only above the trend EMA and a short only below it', () => {
  const bars = series();
  const a = algo.analyze(bars, 'swing', { minSep: 0.2 });
  for (const s of a.signals) {
    if (s.dir > 0) assert.ok(bars[s.i].c > a.ind.trend[s.i]); else assert.ok(bars[s.i].c < a.ind.trend[s.i]);
  }
});

test('the volatility gate is measured on the confirmation bar, not the cross bar', () => {
  const bars = series();
  const loose = algo.analyze(bars, 'swing', { minSep: 0 }).signals.length;
  const strict = algo.analyze(bars, 'swing', { minSep: 2.5 }).signals.length;
  assert.ok(loose > strict);
  const a = algo.analyze(bars, 'swing', { minSep: 0.6 });
  for (const s of a.signals) assert.ok(s.sep >= 0.6);
});

test('backtest: enters at the next open, hits target, charges costs, scores in R', () => {
  const p = algo.resolveParams('swing', { stopAtr: 1, targetAtr: 2, costBps: 0 });
  const bars = []; for (let i = 0; i < 400; i++) bars.push({ t: i * 86400000, o: 100, h: 101, l: 99, c: 100, v: 1 });
  const ind = { sig: new Array(400).fill(0), atr: new Array(400).fill(2) };
  ind.sig[300] = 1; // long signal on bar 300 -> entry at bar 301 open (100), stop 98, target 104
  bars[302] = { t: 302 * 86400000, o: 101, h: 105, l: 100.5, c: 104, v: 1 };
  const r = algo.backtest(bars, p, ind);
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].entryIdx, 301); assert.equal(r.trades[0].entry, 100); assert.equal(r.trades[0].reason, 'target');
  assert.equal(r.trades[0].R, 2);
  const withCost = algo.backtest(bars, { ...p, costBps: 50 }, ind);
  assert.ok(withCost.trades[0].R < 2);
});

test('backtest: a candle that touches both stop and target is a stop; gaps fill at the open', () => {
  const p = algo.resolveParams('swing', { stopAtr: 1, targetAtr: 2, costBps: 0 });
  const mk = () => { const b = []; for (let i = 0; i < 400; i++) b.push({ t: i * 86400000, o: 100, h: 101, l: 99, c: 100, v: 1 }); return b; };
  const ind = { sig: new Array(400).fill(0), atr: new Array(400).fill(2) }; ind.sig[300] = 1;
  const both = mk(); both[302] = { t: 302 * 86400000, o: 100, h: 106, l: 97, c: 100, v: 1 };
  assert.equal(algo.backtest(both, p, ind).trades[0].reason, 'stop');
  assert.equal(algo.backtest(both, p, ind).trades[0].R, -1);
  const gap = mk(); gap[302] = { t: 302 * 86400000, o: 95, h: 96, l: 94, c: 95, v: 1 };
  const t = algo.backtest(gap, p, ind).trades[0];
  assert.equal(t.exit, 95); assert.ok(t.R < -1, 'a gap through the stop loses more than 1R');
});

test('day mode ignores the first 10 and last 15 minutes and weekends (New York time)', () => {
  const s = algo.STRATEGIES.day.params.session;
  const mon = (h, m) => Date.UTC(2026, 8, 21, h + 4, m); // Mon 21 Sep 2026, EDT = UTC-4
  assert.equal(algo.sessionAllows(mon(9, 35), s), false);
  assert.equal(algo.sessionAllows(mon(9, 45), s), true);
  assert.equal(algo.sessionAllows(mon(15, 50), s), false);
  assert.equal(algo.sessionAllows(mon(12, 0), s), true);
  assert.equal(algo.sessionAllows(Date.UTC(2026, 8, 19, 16, 0), s), false); // Saturday
  assert.equal(algo.sessionAllows(mon(12, 0), null), true);
});

test('parameters are clamped so a bad input cannot break the model', () => {
  const p = algo.resolveParams('day', { fast: 500, slow: 1, trend: -5, atr: 'x', minSep: 99, confirm: 0, stopAtr: 0, targetAtr: 1e9 });
  assert.ok(p.fast < p.slow && p.trend >= 5 && p.atr === 14 && p.minSep <= 5 && p.confirm >= 1 && p.stopAtr >= 0.2 && p.targetAtr <= 20);
  assert.doesNotThrow(() => algo.analyze([], 'swing'));
  assert.doesNotThrow(() => algo.analyze([{ t: 1, o: 1, h: 1, l: 1, c: 1 }], 'day'));
  assert.doesNotThrow(() => algo.analyze(null, 'nope'));
});

test('stats add up and out-of-sample is separated from in-sample', () => {
  const a = algo.analyze(series(1500, 11), 'swing', { minSep: 0.2 });
  const s = a.stats;
  assert.equal(s.trades, a.trades.length);
  assert.equal(s.wins + s.losses, s.trades);
  assert.equal(a.inSample.trades + a.outOfSample.trades, s.trades);
  assert.ok(Math.abs(s.totalR - a.trades.reduce((x, t) => x + t.R, 0)) < 1e-6);
  assert.ok(a.enoughData);
});
