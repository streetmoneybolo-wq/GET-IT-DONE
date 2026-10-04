'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TICK_SIZES, parseTick, buildTickBars, mergeTrades } = require('./academy-tick-bars.js');

test('only the offered tick sizes parse', () => {
  assert.deepEqual(TICK_SIZES, [10, 25, 50, 100, 250, 500, 1000]);
  assert.equal(parseTick('100T'), 100); assert.equal(parseTick('7T'), 0); assert.equal(parseTick('5m'), 0); assert.equal(parseTick('100t'), 0); assert.equal(parseTick(''), 0);
});

test('every N trades make one candle and the last may still be forming', () => {
  const trades = Array.from({ length: 25 }, (_, i) => [1000 + i, 100 + (i % 5), 10 + i]);
  const bars = buildTickBars(trades, 10);
  assert.equal(bars.length, 3);
  assert.deepEqual(bars.map((b) => b.n), [10, 10, 5]);
  assert.equal(bars[0].o, 100); assert.equal(bars[0].c, 104);
  assert.equal(bars[0].h, 104); assert.equal(bars[0].l, 100);
  assert.equal(bars[0].v, trades.slice(0, 10).reduce((s, r) => s + r[2], 0));
});

test('trades are ordered by time, bad rows dropped, and bar times strictly increase', () => {
  const t = [[5, 10, 1], [5, 11, 1], [5, 12, 1], [5, 13, 1], [1, 9, 1], [3, NaN, 1], [4, -2, 1]];
  const bars = buildTickBars(t, 10);
  assert.equal(bars.length, 1, 'five good prints make one forming candle');
  assert.deepEqual([bars[0].o, bars[0].h, bars[0].l, bars[0].c, bars[0].n], [9, 13, 9, 13, 5], 'the earliest print opens it, whatever order they arrived in');
  const many = Array.from({ length: 40 }, () => [7, 50, 1]);
  const b = buildTickBars(many, 10);
  assert.ok(b.every((x, i) => i === 0 || x.t > b[i - 1].t), 'strictly increasing even when every print shares a millisecond');
  assert.deepEqual(buildTickBars(many, 3), []); assert.deepEqual(buildTickBars(null, 10), []);
});

test('merging history and live prints counts a print once', () => {
  const m = mergeTrades([[1, 10, 5], [2, 11, 5]], [[2, 11, 5], [3, 12, 5]]);
  assert.equal(m.length, 3);
});
