'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const H = require('./academy-heatmap');

const col = (t, b, a) => ({ t, b, a });

test('the brightness reference is the 95th percentile of every resting level, so one giant wall does not dim the map', () => {
  const cols = [col(1, [[100, 100], [99.99, 200], [99.98, 300]], [[100.01, 400], [100.02, 500], [100.03, 50_000]])];
  assert.equal(H.heatScale(cols), 500, 'the 50,000-share wall is above the 95th percentile');
  assert.equal(H.heatScale([]), 1);
  assert.equal(H.heatScale([col(1, [[100, 0]], [])]), 1, 'empty levels do not count');
});

test('brightness is a log scale clamped to 0..1: a tenth of the reference is still clearly visible, nothing above the reference saturates further', () => {
  assert.equal(H.intensity(0, 500), 0); assert.equal(H.intensity(500, 500), 1); assert.equal(H.intensity(5000, 500), 1);
  const tenth = H.intensity(50, 500);
  assert.ok(tenth > 0.6 && tenth < 0.7, 'a tenth of the reference is about 0.63: ' + tenth);
  assert.equal(H.intensity(10, 0), 0);
});

test('a column is summed into price bins one screen row wide, bids and asks kept apart', () => {
  const bins = H.binColumn(col(1, [[100.00, 100], [99.99, 150], [99.98, 50]], [[100.01, 300], [100.02, 20]]), 0.02);
  // bin index = round(price / 0.02): 100.00 -> 5000, 99.99 -> 5000 (rounds to even... 4999.5 -> 5000), 99.98 -> 4999, 100.01 -> 5001 (5000.5 -> 5001), 100.02 -> 5001
  assert.deepEqual(bins.get(5000), { bid: 250, ask: 0 });
  assert.deepEqual(bins.get(4999), { bid: 50, ask: 0 });
  assert.deepEqual(bins.get(5001), { bid: 0, ask: 320 });
  assert.equal(H.binColumn(col(1, [[100, 5]], []), 0).size, 0, 'no bin width, no bins');
});

test('merging keeps time order, drops duplicates and older columns, and caps the ring', () => {
  const have = [col(1000), col(2000), col(3000)];
  const merged = H.mergeColumns(have, [col(3000), col(5000), col(4000), col(2500)], 240);
  assert.deepEqual(merged.map((c) => c.t), [1000, 2000, 3000, 4000, 5000]);
  assert.deepEqual(H.mergeColumns(null, [col(7)], 10).map((c) => c.t), [7]);
  const capped = H.mergeColumns([], Array.from({ length: 300 }, (_, i) => col(i + 1)), 240);
  assert.equal(capped.length, 240); assert.equal(capped[0].t, 61);
});

test('colours: bids teal, asks rose, alpha rising with brightness; the intraday intervals carry their lengths', () => {
  assert.match(H.colorFor('bid', 1), /^rgba\(60,240,200,0\.900\)$/);
  assert.match(H.colorFor('ask', 0), /^rgba\(150,50,90,0\.120\)$/);
  assert.equal(H.TF_MS['1m'], 60_000); assert.equal(H.TF_MS['30m'], 1_800_000); assert.equal(H.TF_MS['1D'], undefined);
});
