'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { darkPoolSummary } = require('./academy-dark-pool-summary');

const off = (price, size, dir, t = 1) => ({ t, price, size, dir });
test('summarizes share, levels, largest prints and lean', () => {
  const stats = { count: 500, vol: 100_000, offVol: 55_000, offN: 8, since: 1, buy: 40_000, sell: 30_000,
    offTape: [off(100.02, 8000, 'B'), off(100.01, 6000, 'B'), off(99.5, 20000, 'S'), off(100.0, 500, 'N'), off(100.03, 9000, 'B'), off(99.52, 4000, 'S'), off(100.02, 3000, 'B'), off(100, 4500, 'B')] };
  const d = darkPoolSummary(stats, { price: 100 });
  assert.equal(d.available, true);
  assert.equal(d.offSharePct, 55);
  assert.equal(d.largest[0].size, 20000); assert.equal(d.largest[0].notional, 1_990_000);
  assert.ok(d.levels[0].volume >= d.levels[1].volume);
  assert.ok(d.levels.every((l) => ['buy', 'sell', 'mixed'].includes(l.lean)));
  assert.equal(typeof d.lean.offExchange, 'number');
  assert.match(d.caveat, /not a feed of institutional orders/);
  assert.match(d.note, /normal range|high|Unusually/);
});

test('flags high and low share and refuses to guess on thin data', () => {
  const base = { count: 300, vol: 1000, offN: 5, since: 1, buy: 1, sell: 1, offTape: [off(10, 100, 'B')] };
  assert.match(darkPoolSummary({ ...base, offVol: 700 }, { price: 10 }).note, /More than half/);
  assert.match(darkPoolSummary({ ...base, offVol: 100 }, { price: 10 }).note, /Unusually little/);
  assert.equal(darkPoolSummary(null).reason, 'no_prints');
  assert.equal(darkPoolSummary({ count: 3, vol: 10 }).reason, 'too_few_prints');
});
