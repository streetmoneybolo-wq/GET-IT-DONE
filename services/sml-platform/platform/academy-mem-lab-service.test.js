'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createMemLab } = require('./academy-mem-lab-service.js');

function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
function noise(n, seed) {
  const out = [];
  for (let k = 0; k < 40; k++) { const r = rng(seed * 1000 + k + 1); let p = 100; const bars = []; for (let i = 0; i < n; i++) { const c = p * (1 + (r() - 0.5) * 0.03), o = p; bars.push({ t: Date.UTC(2022, 0, 3) + i * 864e5, o, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, c, v: 1e6 }); p = c; } out.push({ symbol: 'N' + k, bars }); }
  return out;
}
test('skips with too little data and never promotes noise; failing sources are reported', async () => {
  const lab = createMemLab({ sources: [{ name: 'few', load: async () => noise(300, 1).slice(0, 2) }, { name: 'bad', load: async () => { throw new Error('boom'); } }] });
  const r = await lab.cycle({ seed: 1 });
  assert.strictEqual(r.outcome, 'skipped'); assert.match(r.errors[0], /boom/);
  const big = createMemLab({ sources: [{ name: 'noise', load: async () => noise(1500, 2) }], budget: 20, autoPromote: true });
  const r2 = await big.cycle({ seed: 2 });
  assert.notStrictEqual(r2.outcome, 'promoted');
  assert.strictEqual((await big.report()).champion, null);
  assert.strictEqual(await big.approve(), null);
});
