'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const SM = require('./academy-smart-money');
const P = require('./academy-patterns');
const E = require('./academy-mem-algo');
const X = require('./academy-mem-scenarios');

/* deterministic candles: an uptrend with pullbacks, equal lows left behind, a gap, and a range at the end */
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
function series(n, { start = 100, drift = 0.0003, sigma = 0.009, daily = true, cycle = 1 } = {}) {
  /* an oscillating market: a slow cycle, a fast cycle and noise around a gentle drift, so ranges, equal lows and pullbacks all appear */
  const out = []; let noise = 0; const t0 = Date.UTC(2026, 0, 5, 14, 30);
  let prevC = start;
  for (let i = 0; i < n; i++) {
    noise += (rnd() - 0.5) * sigma; noise *= 0.97;
    const c = start * Math.exp(drift * i + cycle * (0.10 * Math.sin(i / 29) + 0.035 * Math.sin(i / 9)) + noise);
    const o = prevC * (1 + (rnd() - 0.5) * sigma * 0.4);
    const h = Math.max(o, c) * (1 + rnd() * sigma * 0.7), l = Math.min(o, c) * (1 - rnd() * sigma * 0.7);
    out.push({ t: t0 + i * (daily ? 864e5 : 5 * 60e3), o, h, l, c, v: 1e6 * (0.6 + rnd()) });
    prevC = c;
  }
  return out;
}
const bars = series(320);
const analysis = SM.analyze(bars);
const patterns = P.detect(bars);
const model = E.analyze(bars, 'swing', {}, '1D', {});

test('five scenarios come back for a swing trade, ranked by fit, all on the trade side, each with a numbered path from now into the future', () => {
  const r = X.build({ bars, mode: 'swing', analysis, model, patterns, params: E.STRATEGIES.swing.params });
  assert.equal(r.ok, true);
  assert.equal(r.scenarios.length, 5);
  assert.ok(r.considered >= 5, 'more templates qualified than were shown');
  const fits = r.scenarios.map((s) => s.fit);
  assert.deepEqual(fits, fits.slice().sort((a, b) => b - a), 'ranked by fit');
  assert.deepEqual(r.scenarios.map((s) => s.rank), [1, 2, 3, 4, 5]);
  assert.equal(new Set(r.scenarios.map((s) => s.id)).size, 5, 'five different ideas, never the same template twice');
  for (const s of r.scenarios) {
    assert.equal(s.side, r.side);
    assert.ok(s.fit >= 5 && s.fit <= 97);
    assert.ok(s.steps.length >= 3 && s.steps.length <= 6, s.id + ' has 3 to 6 steps');
    assert.equal(s.steps[0].i, s.window.i0, 'the path starts on the last candle');
    assert.equal(s.steps[0].p, r.entry);
    assert.equal(s.steps[s.steps.length - 1].i, s.window.iEnd, 'and ends at the horizon');
    assert.ok(s.steps.every((st, k) => st.n === k + 1 && typeof st.text === 'string' && st.text.length > 20), 'every step is numbered and explained');
    assert.ok(s.path.length >= s.steps.length && s.path.every((pt) => Number.isFinite(pt.i) && Number.isFinite(pt.p)));
    assert.ok(s.path.every((pt, k) => k === 0 || pt.i >= s.path[k - 1].i), 'the path only moves forward in time');
    const dir = s.side === 'long' ? 1 : -1;
    assert.ok(dir * (s.target - s.entry) > 0, s.id + ': the target is on the trade side');
    assert.ok(dir * (s.entry - s.stop) > 0, s.id + ': the stop is on the other side');
    assert.match(s.invalidation.text, dir > 0 ? /A close below/ : /A close above/);
    assert.ok(s.teach.length >= 2, 'it teaches');
    assert.equal(s.options.side, dir > 0 ? 'calls' : 'puts');
    assert.ok(s.options.expiry && s.options.strike);
    assert.ok(s.rr == null || s.rr > 0);
  }
});

test('each trade type keeps its own horizon and its own options note', () => {
  for (const mode of ['day', 'swing', 'mid', 'long', 'short']) {
    const r = X.build({ bars, mode, analysis, model: E.analyze(bars, mode, {}, '1D', {}), patterns, params: E.STRATEGIES[mode].params });
    assert.ok(r.ok, mode);
    assert.equal(r.scenarios[0].window.future, X.HORIZON[mode].future);
    assert.equal(r.scenarios[0].options.expiry, X.HORIZON[mode].options.expiry);
    assert.equal(r.scenarios[0].horizonLabel, X.HORIZON[mode].label);
  }
});

test('the short model trades down: every scenario is a short with puts, the stop above and the target below', () => {
  const r = X.build({ bars, mode: 'short', analysis, model: E.analyze(bars, 'short', {}, '1D', {}), patterns, params: E.STRATEGIES.short.params });
  assert.equal(r.side, 'short');
  for (const s of r.scenarios) {
    assert.equal(s.side, 'short');
    assert.ok(s.stop > s.entry && s.target < s.entry, s.id);
    assert.equal(s.options.side, 'puts');
  }
});

test('mid and long term never go short, whatever the candles say', () => {
  const down = series(320, { drift: -0.0015 });
  const a = SM.analyze(down), pats = P.detect(down);
  for (const mode of ['mid', 'long']) {
    const r = X.build({ bars: down, mode, analysis: a, model: E.analyze(down, mode, {}, '1D', {}), patterns: pats, params: E.STRATEGIES[mode].params });
    assert.ok(r.ok);
    assert.equal(r.side, 'long');
    assert.ok(r.scenarios.every((s) => s.side === 'long' && s.options.side === 'calls'));
  }
});

test('the open MEM ALGO signal anchors the entry and stop when there is one', () => {
  const withOpen = Object.assign({}, model, { open: { dir: 1, entry: 123.45, stop: 119.1, target: 131, entryIdx: bars.length - 5 } });
  const r = X.build({ bars, mode: 'swing', analysis, model: withOpen, patterns, params: E.STRATEGIES.swing.params });
  assert.equal(r.entry, 123.45);
  assert.equal(r.stop, 119.1);
  assert.ok(r.scenarios.every((s) => s.entry === 123.45));
  // the sweep scenario is the only one allowed to move the stop (beyond the liquidity pool), and only further away
  for (const s of r.scenarios) if (!['sweep', 'retest', 'ema'].includes(s.id)) assert.equal(s.stop, 119.1, s.id);
  // the ideas that widen it say so
  for (const s of r.scenarios) if (s.stop !== 119.1) assert.match(s.invalidation.text, /wider stop|liquidity pool/);
});

test('templates whose prerequisites are missing are not offered: no VWAP idea on daily candles, nothing at all on a stub chart', () => {
  const r = X.build({ bars, mode: 'swing', analysis, model, patterns, params: E.STRATEGIES.swing.params });
  assert.ok(!r.scenarios.some((s) => s.id === 'vwap'), 'daily candles have no session VWAP');
  const stub = X.build({ bars: bars.slice(0, 20), mode: 'swing', analysis: null });
  assert.equal(stub.ok, false);
  assert.deepEqual(stub.scenarios, []);
});

test('intraday candles offer the VWAP idea for a day trade', () => {
  const intra = series(400, { daily: false, drift: 0, sigma: 0.0015, cycle: 0.04 });
  const a = SM.analyze(intra);
  assert.equal(a.intraday, true);
  const r = X.build({ bars: intra, mode: 'day', analysis: a, model: E.analyze(intra, 'day', {}, '5m', {}), patterns: P.detect(intra), params: E.STRATEGIES.day.params, top: 8 });
  assert.ok(r.scenarios.some((s) => s.id === 'vwap'), 'VWAP hold is among the ideas on a 5m chart');
  const v = r.scenarios.find((s) => s.id === 'vwap');
  assert.ok(v.levels.some((l) => l.label === 'VWAP'));
});

test('drawing primitives are complete: zones carry a label and edges, levels carry a price and label, the pattern idea names its pattern', () => {
  const r = X.build({ bars, mode: 'swing', analysis, model, patterns, params: E.STRATEGIES.swing.params, top: 8 });
  for (const s of r.scenarios) {
    for (const z of s.zones) { assert.ok(z.top > z.bottom, s.id + ' zone'); assert.ok(typeof z.label === 'string' && z.label); assert.ok(Number.isFinite(z.from)); }
    for (const l of s.levels) { assert.ok(Number.isFinite(l.price)); assert.ok(l.label); }
    if (s.id === 'pattern' || (s.id === 'breakout' && s.patternId)) assert.ok(patterns.charts.some((c) => c.id === s.patternId), 'the pattern id exists on the chart');
  }
});

test('the result is deterministic for the same candles', () => {
  const a1 = X.build({ bars, mode: 'swing', analysis, model, patterns, params: E.STRATEGIES.swing.params });
  const a2 = X.build({ bars, mode: 'swing', analysis, model, patterns, params: E.STRATEGIES.swing.params });
  assert.deepEqual(a1, a2);
});
