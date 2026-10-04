'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('./academy-mem-lab.js');

function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
const gauss = (r) => { let u = 0; for (let i = 0; i < 6; i++) u += r(); return (u - 3) / 0.7071; };
function world(kind, symbols, n, seed) {
  const out = [];
  for (let k = 0; k < symbols; k++) {
    const r = rng(seed * 1000 + k + 1); const bars = []; let p = 100, prev = 0, regime = 0, left = 0, drift = 0; const t0 = Date.UTC(2022, 0, 3, 14, 30);
    for (let i = 0; i < n; i++) {
      let ret;
      if (kind === 'noise') ret = gauss(r) * 0.012;
      else { if (left <= 0) { regime = r() < 0.5 ? 1 : 0; left = 40 + Math.floor(r() * 80); drift = (r() < 0.5 ? -1 : 1) * 0.0035; } left--; ret = regime ? 0.45 * prev + drift + gauss(r) * 0.009 : -0.35 * prev + gauss(r) * 0.011; }
      prev = ret; const o = p, c = p * (1 + ret); bars.push({ t: t0 + i * 864e5, o, h: Math.max(o, c) * (1 + r() * 0.004), l: Math.min(o, c) * (1 - r() * 0.004), c, v: 1e6 * (0.7 + r() * 0.6) }); p = c;
    }
    out.push({ symbol: 'S' + k, bars });
  }
  return out;
}
const champion = { overrides: { fast: 5, slow: 12, trend: 30, confirm: 1, minSep: 0.2, stopAtr: 1.5, targetAtr: 3 }, ensemble: null };

test('metrics: mean, win rate, profit factor, drawdown', () => {
  const m = L.metrics([{ symbol: 'A', rs: [1, -1, 2, -0.5] }, { symbol: 'B', rs: [] }]);
  assert.strictEqual(m.trades, 4); assert.strictEqual(m.symbols, 1);
  assert.ok(Math.abs(m.mean - 0.375) < 1e-9); assert.strictEqual(m.winRate, 0.5);
  assert.ok(Math.abs(m.profitFactor - 3 / 1.5) < 1e-9);
  assert.strictEqual(L.metrics([]).mean, null);
});

test('bootstrapDiff is deterministic by seed and sees a real gap', () => {
  const a = Array.from({ length: 200 }, (_, i) => 0.5 + ((i % 7) - 3) * 0.1), b = Array.from({ length: 200 }, (_, i) => ((i % 7) - 3) * 0.1);
  const x = L.bootstrapDiff(a, b, { seed: 3 }), y = L.bootstrapDiff(a, b, { seed: 3 });
  assert.deepStrictEqual(x, y); assert.ok(x.lo > 0.3);
  assert.strictEqual(L.bootstrapDiff([], b).diff, null);
});

test('regime world: a gated improvement is found on most seeds and beats the champion', () => {
  let passes = 0;
  for (const seed of [1, 2, 3, 4]) {
    const r = L.optimize({ dataset: world('regime', 40, 1500, seed), mode: 'swing', tf: '1D', champion, budget: 60, seed, minTrainTrades: 150, minTestTrades: 70 });
    assert.ok(r.ok, 'ran');
    if (r.gate.pass) { passes++; assert.ok(r.gate.diff.lo > 0); }
  }
  assert.ok(passes >= 3, 'passes=' + passes);
});

test('noise world: the gate never promotes a lucky winner', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const r = L.optimize({ dataset: world('noise', 40, 1500, seed), mode: 'swing', tf: '1D', champion, budget: 60, seed, minTrainTrades: 150, minTestTrades: 150 });
    assert.ok(!(r.ok && r.gate.pass), 'false promotion at seed ' + seed);
  }
});

test('optimize is deterministic and refuses thin data', () => {
  const ds = world('regime', 40, 1500, 2);
  const o = { dataset: ds, mode: 'swing', tf: '1D', champion, budget: 12, seed: 5, minTrainTrades: 150, minTestTrades: 70 };
  assert.deepStrictEqual(JSON.stringify(L.optimize(o).winner), JSON.stringify(L.optimize(o).winner));
  assert.strictEqual(L.optimize({ dataset: ds.slice(0, 2), mode: 'swing', tf: '1D' }).ok, false);
});
