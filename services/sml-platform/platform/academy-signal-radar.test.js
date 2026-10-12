'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSignalRadar, judge, STYLES } = require('./academy-signal-radar');

const NOW = 1_800_000_000_000;
/* a fake MEM ALGO read: a BUY on the last bar (or `age` bars back), long bias, strong separation, a paying backtest */
const read = ({ dir = 1, age = 0, bias = 'long', sep = 0.9, trades = 12, winRate = 0.6, expectancyR = 0.4, bars = 300 } = {}) => ({
  bars, params: { minSep: 0.35 }, bias, latest: { i: bars - 1 - age, t: NOW - age * 300_000, dir, sep, stop: 9.5, price: 10 }, stats: { trades, winRate, expectancyR }
});

test('judge: a fresh BUY in a long bias with wide EMA separation, a paying backtest and heavy volume is grade A; stale, bearish or weak reads are dropped', () => {
  const a = judge(read(), STYLES.day, { relVolume: 2.4, changePct: 3.2 });
  assert.equal(a.grade, 'A'); assert.ok(a.score >= 80);
  assert.match(a.why[0], /BUY signal on the latest 5m candle/);
  assert.ok(a.why.some((w) => /volume 2.4x/.test(w)));
  assert.equal(judge(read({ dir: -1 }), STYLES.day, {}), null, 'a sell is not a buy');
  assert.equal(judge(read({ age: 4 }), STYLES.day, {}), null, 'too old for a day trade');
  assert.equal(judge(read({ bias: 'short' }), STYLES.swing, {}), null, 'below the trend');
  const weak = judge(read({ sep: 0.36, trades: 3, age: 1 }), STYLES.swing, {});
  assert.equal(weak.grade, 'C', 'fresh and in trend but nothing else going for it: not strong enough to show');
});

test('the radar reads the universe in slices, emits grade A/B buys with a +10% (day) / +15% (swing) target, persists them, and does not repeat a symbol inside its window', async () => {
  let t = NOW; const saved = { v: null }; const pushed = [];
  const reads = { AAA: read(), BBB: read({ sep: 0.36, trades: 3 }), CCC: read({ dir: -1 }) };
  // the fake MEM ALGO answers for whichever symbol was just read
  const order = [];
  const radar2 = createSignalRadar({
    universe: async () => [{ symbol: 'AAA', relVolume: 2.5, changePct: 4, liveRank: 1 }, { symbol: 'BBB' }, { symbol: 'CCC' }, { symbol: 'bad symbol' }],
    candles: async (symbol) => { order.push(symbol); return { bars: Array.from({ length: 300 }, (_, i) => ({ t: NOW - (300 - i) * 300_000, o: 10, h: 10.2, l: 9.8, c: 10, v: 1000 })) }; },
    analyze: () => reads[order[order.length - 1]],
    state: () => ({ tradingDay: true, session: 'regular' }), push: (s) => pushed.push(s), now: () => t, perTick: 2,
    store: { read: async () => saved.v, write: async (x) => { saved.v = JSON.parse(JSON.stringify(x)); } }
  });
  let r = await radar2.tick();
  assert.deepEqual([r.read, r.found, r.styles], [2, 2, ['day', 'swing']], 'AAA on both styles; BBB is grade D');
  const sigs = radar2.recent(0);
  assert.deepEqual(sigs.map((s) => [s.symbol, s.style, s.entry, s.target, s.pct, s.grade]).sort(), [['AAA', 'day', 10, 11, 10, 'A'], ['AAA', 'swing', 10, 11.5, 15, 'A']]);
  assert.equal(sigs[0].stop, 9.5); assert.equal(sigs[0].side, 'long'); assert.equal(sigs[0].relVolume, 2.5);
  assert.equal(pushed.length, 2); assert.equal(saved.v.signals.length, 2);
  r = await radar2.tick();
  assert.deepEqual([r.read, r.found], [1, 0], 'the rest of the universe (CCC is a sell; the bad symbol is skipped)');
  t += 60_000; r = await radar2.tick();
  assert.equal(r.found, 0, 'AAA again within its repeat window: not repeated');
  assert.equal(radar2.status().signals, 2);
});

test('outside the regular session only the daily (swing) read runs; on a non-trading day nothing runs; a 403-only owner gate is the server\'s', async () => {
  const styles = [];
  const mk = (st) => createSignalRadar({ universe: async () => [{ symbol: 'AAA' }], candles: async (s, tf) => { styles.push(tf); return { bars: [] }; }, analyze: () => null, state: () => st, now: () => NOW });
  assert.deepEqual((await mk({ tradingDay: true, session: 'post' }).tick()).styles, ['swing']);
  assert.deepEqual((await mk({ tradingDay: false, session: 'closed' }).tick()).styles, []);
  assert.deepEqual(styles, ['1D'], 'only daily bars were asked for');
});

test('signals saved earlier are loaded back and count toward the repeat window', async () => {
  const radar = createSignalRadar({ universe: async () => [], candles: async () => ({ bars: [] }), analyze: () => null, now: () => NOW,
    store: { read: async () => ({ signals: [{ id: 'AAA:day:1', symbol: 'AAA', style: 'day', at: NOW - 1000, entry: 1, target: 1.1 }] }), write: async () => {} } });
  await radar.load();
  assert.equal(radar.recent(0).length, 1);
  assert.equal(radar.recent(NOW).length, 0);
});
