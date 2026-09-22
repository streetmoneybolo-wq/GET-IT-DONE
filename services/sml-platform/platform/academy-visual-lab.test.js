'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CHART_TYPES, calculateIntervalStats, heikinAshi, renko, academyVisualLabScript } = require('./academy-visual-lab');

const bars = [
  { t: 1, o: 100, h: 105, l: 99, c: 104, v: 10 },
  { t: 2, o: 104, h: 108, l: 102, c: 103, v: 20 },
  { t: 3, o: 103, h: 110, l: 101, c: 109, v: 30 }
];

test('interval stats follow the documented selected-candle formulas', () => {
  const result = calculateIntervalStats(bars);
  const average = ((105 + 99 + 104) / 3 + (108 + 102 + 103) / 3 + (110 + 101 + 109) / 3) / 3;
  assert.equal(result.start, 1);
  assert.equal(result.end, 3);
  assert.equal(result.high, 110);
  assert.equal(result.low, 99);
  assert.equal(result.average, average);
  assert.equal(result.changePct, 9);
  assert.equal(result.amplitudePct, (11 / average) * 100);
  assert.equal(result.volume, 60);
  assert.equal(result.turnover, 10 * ((105 + 99 + 104) / 3) + 20 * ((108 + 102 + 103) / 3) + 30 * ((110 + 101 + 109) / 3));
  assert.deepEqual([result.bullish, result.bearish], [2, 1]);
  assert.deepEqual([result.rise, result.fall], [1, 1]);
  assert.equal(result.count, 3);
});

test('all requested chart families and interactive teaching tools ship in the Activity', () => {
  assert.deepEqual(CHART_TYPES, ['Candlestick', 'Bar', 'Line', 'Heikin-Ashi', 'Renko', 'Point & Figure', 'Kagi', 'OHLC', 'Raindrop', 'Chart Patterns']);
  const html = academyVisualLabScript();
  for (const name of CHART_TYPES) assert.ok(html.includes(name));
  assert.match(html, /INTERVAL STATS/);
  assert.match(html, /VISUAL MATH LAB/);
  assert.match(html, /MutationObserver/);
  assert.match(html, /LEVEL 2/);
  assert.match(html, /SCANNER/);
});

test('derived chart transforms preserve valid OHLC structures', () => {
  const ha = heikinAshi(bars);
  assert.equal(ha.length, bars.length);
  assert.ok(ha.every((bar) => bar.h >= Math.max(bar.o, bar.c) && bar.l <= Math.min(bar.o, bar.c)));
  const bricks = renko([{ t: 1, o: 100, h: 100, l: 100, c: 100 }, { t: 2, o: 100, h: 106, l: 100, c: 106 }], 2);
  assert.equal(bricks.length, 3);
  assert.deepEqual(bricks.map((bar) => bar.c), [102, 104, 106]);
});
