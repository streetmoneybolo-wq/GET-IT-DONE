'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiveRange, mergeRanges } = require('./academy-live-range');

function fakeStream(prior = []) {
  const listeners = new Map();
  return {
    on: (sym, fn) => { listeners.set(sym, fn); return () => listeners.delete(sym); },
    ticks: () => prior,
    emit: (sym, t, price, size = 100) => { const fn = listeners.get(sym); if (fn) fn({ type: 'trade', trade: { t, price, size } }); },
    has: (sym) => listeners.has(sym)
  };
}

test('the live range is the confirmed high and low since the alert, and a lone print does not count', () => {
  let t = Date.UTC(2026, 9, 20, 22, 30, 15);
  const stream = fakeStream();
  const lr = createLiveRange({ stream, now: () => t });
  assert.ok(lr.track('AHT', t));
  const at = t;
  // two minutes later: one stray print high, then a real run with two prints at the high
  t = at + 150_000;
  stream.emit('AHT', t, 3.5);                       // a lone stray print
  stream.emit('AHT', t + 1000, 2.6); stream.emit('AHT', t + 2000, 2.62); stream.emit('AHT', t + 3000, 2.62);
  const r = lr.range('AHT', at);
  assert.equal(r.high, 2.62, 'the second-highest print in the minute is the confirmed high, not the stray 3.50');
  assert.ok(r.low >= 2.6 && r.source === 'live trades');
  // trades before the alert's own minute never count
  const early = createLiveRange({ stream: fakeStream(), now: () => t });
  early.track('XYZ', at);
  early._record('XYZ', at - 5_000, 9); early._record('XYZ', at - 4_000, 9);
  assert.equal(early.range('XYZ', at), null);
  assert.equal(lr.range('NOPE', at), null);
});

test('a confirmed crossing of a watched target calls the watcher at once, once per fifteen seconds, and a short mirrors it', () => {
  let t = Date.UTC(2026, 9, 20, 23, 0, 0); const crosses = [];
  const stream = fakeStream();
  const lr = createLiveRange({ stream, now: () => t, onCross: (s) => crosses.push(s) });
  lr.track('AHT', t - 60_000, { key: 'd:1', side: 'long', target: 2.85 });
  lr.track('SHRT', t - 60_000, { key: 'd:2', side: 'short', target: 9.5 });
  stream.emit('AHT', t, 2.9);                         // one print above the target: not confirmed
  assert.equal(crosses.length, 0);
  stream.emit('AHT', t + 1, 2.9);                     // the second print confirms it
  assert.deepEqual(crosses, ['AHT']);
  stream.emit('AHT', t + 2, 2.95); stream.emit('AHT', t + 3, 2.95);
  assert.equal(crosses.length, 1, 'once per fifteen seconds');
  stream.emit('SHRT', t, 9.4); stream.emit('SHRT', t + 1, 9.4);
  assert.deepEqual(crosses, ['AHT', 'SHRT']);
  lr.unwatch('SHRT', 'd:2'); t += 20_000;
  stream.emit('SHRT', t, 9.3); stream.emit('SHRT', t + 1, 9.3);
  assert.equal(crosses.length, 2, 'an unwatched target no longer calls');
});

test('it backfills from the stream\'s own ticks, stays within its cap and forgets stocks nobody asked about', () => {
  let t = Date.UTC(2026, 9, 20, 23, 0, 0);
  const prior = [[t - 3_600_000, 2.5, 100], [t - 3_599_000, 2.52, 100], [t - 3_598_000, 2.52, 100]];
  const stream = fakeStream(prior);
  const lr = createLiveRange({ stream, now: () => t });
  lr.track('AHT', t - 7_200_000);
  assert.equal(lr.range('AHT', t - 7_200_000).high, 2.52, 'trades already on the stream count');
  for (let i = 0; i < 60; i++) lr.track('S' + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26)), t);
  assert.ok(lr.status().symbols <= 40, 'the cap keeps the stream\'s own limit safe');
  t += 2 * 86_400_000; lr.prune();
  assert.equal(lr.status().symbols, 0, 'stocks nobody asked about for a day are forgotten and their listeners released');
  assert.equal(stream.has('AHT'), false);
});

test('merging the candle range with the live range keeps the wider of each side', () => {
  assert.deepEqual(mergeRanges({ high: 2.8, low: 2.3 }, { high: 2.99, low: 2.4 }), { high: 2.99, low: 2.3 });
  assert.deepEqual(mergeRanges(null, { high: 2.99, low: 2.4 }), { high: 2.99, low: 2.4 });
  assert.deepEqual(mergeRanges({ high: 2.8, low: 2.3 }, null), { high: 2.8, low: 2.3 });
  assert.equal(mergeRanges(null, null), null);
});

test('the summary lists what is tracked for the log line', () => {
  const t = Date.UTC(2026, 9, 20, 23, 0, 0);
  const stream = fakeStream();
  const lr = createLiveRange({ stream, now: () => t });
  lr.track('AAA', t - 60_000, { key: 'd:1', side: 'long', target: 5 }); lr.track('BBB', t - 60_000);
  stream.emit('AAA', t, 4.9); stream.emit('AAA', t + 1, 4.9); stream.emit('AAA', t + 70_000, 4.8); stream.emit('AAA', t + 70_001, 4.8);
  assert.deepEqual(lr.summary(), [{ symbol: 'AAA', minutes: 2, watches: 1 }, { symbol: 'BBB', minutes: 0, watches: 0 }]);
});
