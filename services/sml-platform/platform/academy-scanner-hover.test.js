'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./academy-scanner-hover');

const bar = (t, o, h, l, c, v = 100) => ({ t, o, h, l, c, v });

test('every interval the member asked for is offered, in order', () => {
  assert.deepEqual(H.INTERVALS, ['1m', '3m', '5m', '15m', '1h', '1D', '1W', '1M', '1Q', '1Y']);
});

test('only valid candles are kept and only the newest ones are drawn', () => {
  const many = Array.from({ length: 200 }, (_, i) => bar(i + 1, 10, 11, 9, 10));
  assert.equal(H.visibleBars(many).length, 90);
  assert.equal(H.visibleBars(many)[89].t, 200);
  assert.deepEqual(H.visibleBars([bar(1, 1, 2, 0.5, 1.5), { t: 2, o: NaN, h: 1, l: 1, c: 1 }, null]).map((b) => b.t), [1]);
  assert.deepEqual(H.visibleBars(null), []);
});

test('the price range covers every candle with a little padding', () => {
  const r = H.priceRange([bar(1, 10, 12, 9, 11), bar(2, 11, 15, 10, 14)]);
  assert.ok(r.lo < 9 && r.hi > 15);
  assert.equal(H.priceRange([]), null);
});

test('the live price moves the newest candle only and never invents data', () => {
  const bars = [bar(1, 10, 11, 9, 10), bar(2, 10, 11, 9.5, 10.5)];
  const out = H.withLivePrice(bars, 11.4);
  assert.equal(out[1].c, 11.4); assert.equal(out[1].h, 11.4); assert.equal(out[1].l, 9.5); assert.equal(out[0].c, 10);
  assert.equal(bars[1].c, 10.5, 'the original is not changed');
  assert.deepEqual(H.withLivePrice(bars, 99), bars, 'a wildly different print is ignored');
  assert.deepEqual(H.withLivePrice(bars, NaN), bars);
  assert.deepEqual(H.withLivePrice([], 5), []);
});

test('the change is measured from the first candle open to the last close', () => {
  assert.equal(H.changeOver([bar(1, 100, 101, 99, 100), bar(2, 100, 111, 99, 110)]), 10);
  assert.equal(H.changeOver([bar(1, 1, 1, 1, 1)]), null);
});
