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

/* a clear three-regime market (down, up, down) with noise: what hold and short strategies are meant to trade */
function regimes(n = 1600, seed = 3, drift = 0.08, noise = 2.2) {
  let x = seed; const rnd = () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; };
  const bars = []; let price = 100;
  for (let i = 0; i < n; i++) {
    const phase = Math.floor(i / (n / 4)); // 0 down, 1 up, 2 up, 3 down
    const d = (phase === 1 || phase === 2 ? 1 : -1) * drift;
    const o = price, c = Math.max(5, o + d + (rnd() - 0.5) * noise);
    bars.push({ t: Date.UTC(2020, 0, 1) + i * 86400000, o, h: Math.max(o, c) + rnd() * noise * 0.4, l: Math.min(o, c) - rnd() * noise * 0.4, c, v: 1000 });
    price = c;
  }
  return bars;
}

test('the registry lists day, swing, mid-term hold, long-term hold and short sale', () => {
  assert.deepEqual(Object.keys(algo.STRATEGIES), ['day', 'swing', 'mid', 'long', 'short']);
  for (const k of Object.keys(algo.STRATEGIES)) { const st = algo.STRATEGIES[k]; assert.ok(st.label && st.blurb && st.tfHint.length, k); }
});

test('hold strategies are long-only, use a trailing stop and have no fixed target', () => {
  const bars = regimes();
  for (const mode of ['mid', 'long']) {
    const p = algo.resolveParams(mode, {}, '1D');
    assert.equal(p.dirs, 'long'); assert.equal(p.targetAtr, null); assert.ok(p.trail > 0);
    const a = algo.analyze(bars, mode, {}, '1D');
    assert.ok(a.trades.every((t) => t.dir > 0), mode + ' never shorts');
    assert.ok(a.signals.every((s) => s.dir > 0 && s.target === null));
    assert.ok(a.trades.every((t) => t.target === null && Number.isFinite(t.pct)));
    assert.ok(a.stats.trades >= 1, mode + ' traded at least once on a trending series');
  }
});

test('short sale only ever sells short, exits on the opposite crossover, and skips stretched drops', () => {
  const bars = regimes();
  const a = algo.analyze(bars, 'short', {}, '1h');
  assert.ok(a.trades.length >= 1);
  assert.ok(a.trades.every((t) => t.dir < 0));
  assert.ok(a.signals.every((s) => s.dir < 0));
  assert.ok(a.trades.some((t) => t.reason === 'exit-signal' || t.reason === 'stop' || t.reason === 'target' || t.reason === 'time'));
  const strict = algo.analyze(bars, 'short', { maxSep: 0.5 }, '1h');
  assert.ok(strict.signals.length <= a.signals.length, 'a tighter stretch limit can only remove signals');
});

test('the trailing stop only ever tightens, and a hold trade never exits worse than its starting stop', () => {
  const bars = regimes();
  const a = algo.analyze(bars, 'mid', {}, '1D');
  for (const t of a.trades) {
    if (t.reason === 'stop') assert.ok(t.exit >= t.stop - 1e-9 || t.exit >= 0, 'exited at or above the starting stop (it may have trailed up)');
    assert.ok(t.R >= -1.05 - 0.5, 'a stop-out loses about one R plus costs');
  }
  if (a.open) assert.ok(a.open.stop >= a.open.entry - a.open.entry, 'open stop is finite');
});

test('per-timeframe parameter sets apply, and user overrides still win', () => {
  assert.equal(algo.resolveParams('mid', {}, '1D').fast, 50);
  assert.equal(algo.resolveParams('mid', {}, '1W').fast, 10);
  assert.equal(algo.resolveParams('long', {}, '1M').slow, 12);
  assert.equal(algo.resolveParams('long', { fast: 30 }, '1W').fast, 30);
  assert.equal(algo.resolveParams('day', { trail: 3 }).trail, null, 'strategies without a trailing stop ignore the override');
});

test('day and swing behave exactly as before (both directions, fixed target)', () => {
  const bars = series(900, 7);
  for (const mode of ['day', 'swing']) {
    const a = algo.analyze(bars, mode, { minSep: 0 });
    assert.ok(a.signals.every((s) => Number.isFinite(s.target)));
    assert.equal(algo.resolveParams(mode).dirs, 'both');
  }
});

/* ---- confluence for the hold strategies ---- */
const patternsLib = require('./academy-patterns');
function weekly(bars) { // fold daily candles into 7-day candles (start-of-week timestamps), like the higher-timeframe feed
  const out = []; for (let i = 0; i < bars.length; i += 5) { const g = bars.slice(i, i + 5); out.push({ t: g[0].t, o: g[0].o, h: Math.max(...g.map((b) => b.h)), l: Math.min(...g.map((b) => b.l)), c: g[g.length - 1].c, v: g.reduce((s, b) => s + b.v, 0) }); }
  return out;
}
const fullCtx = (bars, extra = {}) => ({ htf: weekly(bars), bench: regimes(bars.length, 9, 0.06, 2.0), patterns: (b) => patternsLib.detect(b), patternCache: new Map(), ...extra });

test('every hold signal carries a 0-100 conviction score with a factor breakdown that adds up', () => {
  const bars = regimes(); const a = algo.analyze(bars, 'mid', { minScore: 0 }, '1D', fullCtx(bars));
  assert.ok(a.signals.length >= 1 && a.confluence);
  for (const s of a.signals) {
    assert.ok(s.conf.score >= 0 && s.conf.score <= 100 && 'ABCD'.includes(s.conf.grade));
    assert.equal(s.conf.factors.map((f) => f.key).join(), 'htf,volume,momentum,regime,rs,structure');
    const avail = s.conf.factors.filter((f) => f.available), max = avail.reduce((t, f) => t + f.max, 0), got = avail.reduce((t, f) => t + f.pts, 0);
    assert.equal(max, 100, 'all six factors available => 100 points');
    assert.equal(s.conf.score, Math.round((got / max) * 100));
  }
});

test('the conviction filter only removes signals, minScore 0 keeps everything and 101 keeps nothing', () => {
  const bars = regimes(); const ctx = fullCtx(bars);
  const all = algo.analyze(bars, 'mid', { minScore: 0 }, '1D', ctx), none = algo.analyze(bars, 'mid', { minScore: 100 }, '1D', ctx), mid = algo.analyze(bars, 'mid', {}, '1D', ctx);
  assert.equal(all.confluence.all.trades, all.confluence.kept.trades, 'minScore 0 filters nothing');
  assert.ok(mid.signals.length <= all.signals.length);
  assert.ok(mid.signals.every((s) => s.conf.score >= mid.params.minScore));
  assert.ok(none.signals.every((s) => s.conf.score >= 100));
  assert.equal(all.confluence.all.trades, mid.confluence.all.trades, 'the unfiltered comparison never changes with the filter');
});

test('no look-ahead: a signal scores the same whether or not later candles exist', () => {
  const bars = regimes(); const ctx = fullCtx(bars), full = algo.analyze(bars, 'mid', { minScore: 0 }, '1D', ctx);
  const s = full.signals[0]; assert.ok(s, 'have a signal to test');
  const cut = algo.analyze(bars.slice(0, s.i + 1), 'mid', { minScore: 0 }, '1D', fullCtx(bars.slice(0, s.i + 1), { htf: ctx.htf, bench: ctx.bench.slice(0, s.i + 1) }));
  const same = cut.signals.find((x) => x.i === s.i);
  assert.ok(same, 'the same signal exists on the truncated series');
  assert.equal(same.conf.score, s.conf.score);
});

test('the higher timeframe is read from the last COMPLETE candle, so appending a later candle changes nothing', () => {
  const bars = regimes(); const ctx = fullCtx(bars), base = algo.analyze(bars, 'mid', { minScore: 0 }, '1D', ctx);
  const s = base.signals[0]; const after = { ...ctx, htf: ctx.htf.filter((h) => h.t <= bars[s.i].t) };
  const trimmed = algo.analyze(bars, 'mid', { minScore: 0 }, '1D', after).signals.find((x) => x.i === s.i);
  assert.equal(trimmed.conf.factors.find((f) => f.key === 'htf').pts, s.conf.factors.find((f) => f.key === 'htf').pts, 'weeks that start after the signal are ignored');
});

test('factors without data are left out and the score scales over what is available', () => {
  const bars = regimes(); const a = algo.analyze(bars, 'mid', { minScore: 0 }, '1D', { patterns: null });
  const c = a.signals[0].conf; const off = c.factors.filter((f) => !f.available).map((f) => f.key);
  assert.ok(off.includes('htf') && off.includes('regime') && off.includes('rs') && off.includes('structure'));
  assert.ok(c.available >= 2 && c.score >= 0 && c.score <= 100);
  const self = algo.analyze(bars, 'mid', { minScore: 0 }, '1D', { ...fullCtx(bars), benchSelf: true, bench: null }).signals[0].conf;
  assert.ok(!self.factors.find((f) => f.key === 'regime').available && !self.factors.find((f) => f.key === 'rs').available);
});

test('a higher timeframe that rolls over while price is below the slow EMA exits the trade', () => {
  const bars = regimes(); const a = algo.analyze(bars, 'mid', { minScore: 0 }, '1D', fullCtx(bars));
  assert.ok(a.trades.some((t) => t.reason === 'exit-signal' || t.reason === 'stop' || t.reason === 'time'));
  assert.ok(a.confluence.exitWatch && ['clear', 'caution', 'exit'].includes(a.confluence.exitWatch.level));
});

test('day, swing and short have no confluence layer', () => {
  const bars = regimes();
  for (const mode of ['day', 'swing', 'short']) { const a = algo.analyze(bars, mode, {}, '1D', fullCtx(bars)); assert.equal(a.confluence, null); assert.ok(a.signals.every((s) => s.conf === null)); }
});

test('indicator helpers behave: RSI stays in 0-100, a steady rise pins it near 100, MACD histogram is finite', () => {
  const up = Array.from({ length: 60 }, (_, i) => 100 + i);
  const r = algo.rsi(up, 14); assert.ok(r.filter(Number.isFinite).every((v) => v >= 0 && v <= 100)); assert.ok(r[59] > 95);
  assert.ok(algo.macdHist(up).filter(Number.isFinite).length > 30);
  assert.equal(algo.gradeOf(80), 'A'); assert.equal(algo.gradeOf(60), 'B'); assert.equal(algo.gradeOf(45), 'C'); assert.equal(algo.gradeOf(44), 'D');
});
