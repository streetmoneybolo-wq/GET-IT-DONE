'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./academy-mem-signals');

function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
function walk(n, { drift = 0, vol = 0.012, seed = 3, start = 100 } = {}) {
  const r = rng(seed); const out = []; let p = start; const t0 = Date.UTC(2024, 0, 2, 14, 30);
  for (let i = 0; i < n; i++) { const ret = drift + (r() - 0.5) * 2 * vol * 1.7; const o = p, c = p * (1 + ret); out.push({ t: t0 + i * 864e5, o, h: Math.max(o, c) * (1 + r() * vol * 0.4), l: Math.min(o, c) * (1 - r() * vol * 0.4), c, v: 1e6 * (0.7 + r() * 0.8) }); p = c; }
  return out;
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

test('every component is causal: the value at a candle never changes when later candles are added', () => {
  const bars = walk(420);
  const full = S.allVotes(bars);
  for (const k of [150, 230, 333, 419]) {
    const cut = S.allVotes(bars.slice(0, k + 1));
    for (const name of S.NAMES) assert.ok(Math.abs(full[name][k] - cut[name][k]) < 1e-9, name + ' at ' + k + ': ' + full[name][k] + ' vs ' + cut[name][k]);
  }
});

test('every component returns one finite vote per candle, between -1 and +1', () => {
  const bars = walk(400, { seed: 9 });
  const votes = S.allVotes(bars);
  assert.deepEqual(Object.keys(votes).sort(), [...S.NAMES].sort());
  for (const name of S.NAMES) {
    assert.equal(votes[name].length, bars.length, name);
    assert.ok(votes[name].every((v) => Number.isFinite(v) && v >= -1 && v <= 1), name + ' stays in range');
    assert.ok(votes[name].some((v) => v !== 0), name + ' says something');
  }
});

test('the trend followers lean the right way in a clean up-trend and a clean down-trend', () => {
  const up = walk(400, { drift: 0.004, vol: 0.006, seed: 5 }), down = walk(400, { drift: -0.004, vol: 0.006, seed: 5 });
  const vu = S.allVotes(up), vd = S.allVotes(down);
  for (const name of ['supertrend', 'adx', 'macd', 'rsi', 'donchian', 'ichimoku', 'kalman', 'quality', 'obv']) {
    const a = mean(vu[name].slice(250)), b = mean(vd[name].slice(250));
    assert.ok(a > b, name + ' reads the up-trend (' + a.toFixed(2) + ') more bullish than the down-trend (' + b.toFixed(2) + ')');
  }
  assert.ok(mean(vu.supertrend.slice(250)) > 0.5 && mean(vd.supertrend.slice(250)) < -0.5);
});

test('the mean-reversion vote leans AGAINST a stretch in a quiet market', () => {
  const bars = walk(200, { drift: 0, vol: 0.004, seed: 2 });
  // push the last candle far above its average
  const last = bars[bars.length - 1]; bars.push({ ...last, t: last.t + 864e5, o: last.c, c: last.c * 1.05, h: last.c * 1.052, l: last.c * 0.999 });
  const z = S.zscore(bars);
  assert.ok(z[bars.length - 1] < 0, 'a stretch up leans back down: ' + z[bars.length - 1]);
});

test('the efficiency ratio is 1 for a straight line and near 0 for noise', () => {
  const line = Array.from({ length: 60 }, (_, i) => ({ t: i, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1 }));
  assert.ok(Math.abs(S.efficiency(line)[59] - 1) < 1e-9);
  const noise = walk(300, { drift: 0, vol: 0.02, seed: 4 });
  assert.ok(mean(S.efficiency(noise).slice(40)) < 0.4);
});

test('short or empty input is handled without throwing', () => {
  for (const bars of [[], walk(5), walk(30)]) { const v = S.allVotes(bars); for (const name of S.NAMES) assert.equal(v[name].length, bars.length); }
});
