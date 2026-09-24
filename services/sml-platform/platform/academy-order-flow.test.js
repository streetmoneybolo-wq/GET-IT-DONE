'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOrderFlow } = require('./academy-order-flow');

const T0 = 1_000_000_000_000, STEP = 2500;
let idc = 0;

/* a 10-level book around 100.00 / 100.01 with adjustable sizes */
function book(o = {}) {
  const bidSizes = o.bidSizes || [500, 400, 300, 250, 200, 200, 150, 150, 100, 100];
  const askSizes = o.askSizes || [500, 400, 300, 250, 200, 200, 150, 150, 100, 100];
  const b1 = o.bid1 == null ? 100.0 : o.bid1;
  return {
    bids: bidSizes.map((size, i) => ({ price: +(b1 - i * 0.01).toFixed(2), size })),
    asks: askSizes.map((size, i) => ({ price: +(b1 + 0.01 + i * 0.01).toFixed(2), size }))
  };
}
const snap = (i, o = {}, ticks = []) => ({ t: T0 + i * STEP, ...book(o), ticks: ticks.map((x) => ({ id: 'id' + (idc++), timestamp_ms: T0 + i * STEP, ...x })) });
function feed(flow, from, to, o = {}, ticksFn) { for (let i = from; i < to; i++) flow.push(snap(i, typeof o === 'function' ? o(i) : o, ticksFn ? ticksFn(i) : [])); }
const calm = (flow, n = 50) => feed(flow, 0, n, {}, (i) => (i % 3 === 0 ? [{ price: 100.01, size: 100, direction: 'BUY' }, { price: 100.0, size: 100, direction: 'SELL' }] : []));

test('warms up before it reads anything', () => {
  const f = createOrderFlow();
  feed(f, 0, 5);
  assert.equal(f.analyze(T0 + 5 * STEP).state, 'warming');
  feed(f, 5, 20);
  assert.equal(f.analyze(T0 + 20 * STEP).ready, true);
});

test('bids stacking while asks are pulled reads bullish and logs the events', () => {
  const f = createOrderFlow(); calm(f);
  feed(f, 50, 58, { bidSizes: [1200, 900, 700, 250, 200, 200, 150, 150, 100, 100], askSizes: [120, 100, 90, 250, 200, 200, 150, 150, 100, 100] });
  const a = f.analyze(T0 + 58 * STEP);
  assert.equal(a.momentum.label, 'bullish');
  assert.ok(a.momentum.score >= 45, `score ${a.momentum.score}`);
  assert.ok(a.momentum.pulledAsk > 0.35);
  const kinds = f.events().map((e) => e.kind + ':' + e.side);
  assert.ok(kinds.includes('stack:bull') && kinds.includes('pull:bull'), kinds.join());
});

test('size that leaves because it TRADED is not a pull', () => {
  const f = createOrderFlow(); calm(f);
  // asks thin out, but the tape shows buyers lifting exactly that much size
  feed(f, 50, 56, { askSizes: [150, 100, 90, 250, 200, 200, 150, 150, 100, 100] }, () => [{ price: 100.02, size: 400, direction: 'BUY' }]);
  const a = f.analyze(T0 + 56 * STEP);
  assert.ok(a.momentum.pulledAsk < 0.1, `pulledAsk ${a.momentum.pulledAsk}`);
  assert.ok(!f.events().some((e) => e.kind === 'pull'));
});

test('one spoofed snapshot does not create a signal', () => {
  const f = createOrderFlow(); calm(f);
  feed(f, 50, 51, { askSizes: [5000, 4000, 3000, 250, 200, 200, 150, 150, 100, 100] });
  feed(f, 51, 57);
  assert.ok(!f.events().some((e) => e.kind === 'stack' || e.kind === 'pull'));
});

test('heavy selling absorbed at a steady bid reads as bullish absorption', () => {
  const f = createOrderFlow(); calm(f);
  feed(f, 50, 62, {}, () => [{ price: 100.0, size: 900, direction: 'SELL' }, { price: 100.0, size: 400, direction: 'SELL' }, { price: 100.01, size: 100, direction: 'BUY' }]);
  const a = f.analyze(T0 + 62 * STEP);
  assert.equal(a.absorption.state, 'bull');
  assert.ok(f.events().some((e) => e.kind === 'absorb' && e.side === 'bull'));
});

test('the same selling is NOT absorption when the bid gives way', () => {
  const f = createOrderFlow(); calm(f);
  feed(f, 50, 62, (i) => ({ bid1: 100.0 - (i - 50) * 0.02 }), () => [{ price: 100.0, size: 900, direction: 'SELL' }, { price: 100.0, size: 400, direction: 'SELL' }]);
  assert.equal(f.analyze(T0 + 62 * STEP).absorption.state, 'none');
});

test('repeated prints far beyond the displayed size flag a possible iceberg', () => {
  const f = createOrderFlow(); calm(f);
  feed(f, 50, 60, {}, () => [{ price: 100.0, size: 350, direction: 'SELL' }, { price: 100.0, size: 350, direction: 'SELL' }]);
  assert.ok(f.events().some((e) => e.kind === 'iceberg'));
});

test('a consumed ask wall that holds and reappears as bids is a bullish flip (once)', () => {
  const f = createOrderFlow(); calm(f);
  const wall = [500, 400, 300, 250, 3000, 200, 150, 150, 100, 100]; // ask wall at 100.05
  feed(f, 50, 56, { askSizes: wall });
  // price lifts through the wall: bid climbs to 100.05 and holds; the old wall price now sits in the bids
  feed(f, 56, 64, { bid1: 100.06, bidSizes: [500, 700, 300, 250, 200, 200, 150, 150, 100, 100] });
  const flips = f.events().filter((e) => e.kind === 'flip');
  assert.equal(flips.length, 1);
  assert.equal(flips[0].side, 'bull');
  assert.equal(f.analyze(T0 + 64 * STEP).flip.side, 'bull');
  feed(f, 64, 70, { bid1: 100.06 });
  assert.equal(f.events().filter((e) => e.kind === 'flip').length, 1, 'no repeat on the same wall');
});

test('a wall that is only touched, not held, is not a flip', () => {
  const f = createOrderFlow(); calm(f);
  feed(f, 50, 56, { askSizes: [500, 400, 300, 250, 3000, 200, 150, 150, 100, 100] });
  feed(f, 56, 57, { bid1: 100.06 });
  feed(f, 57, 63, { bid1: 100.0 });
  assert.ok(!f.events().some((e) => e.kind === 'flip'));
});

test('garbled input is ignored: crossed books, out-of-order snapshots, duplicate trades', () => {
  const f = createOrderFlow(); calm(f);
  const n = f.size();
  assert.equal(f.push({ t: T0 + 100 * STEP, bids: [{ price: 101, size: 1 }], asks: [{ price: 100, size: 1 }] }).ok, false);
  assert.equal(f.push({ t: T0, ...book() }).ok, false);
  assert.equal(f.push({ t: T0 + 101 * STEP, bids: [], asks: [] }).ok, false);
  assert.equal(f.size(), n);
  const before = f.analyze().trades;
  f.push({ t: T0 + 102 * STEP, ...book(), ticks: [{ id: 'dup', price: 100, size: 10, timestamp_ms: T0 + 102 * STEP }] });
  f.push({ t: T0 + 103 * STEP, ...book(), ticks: [{ id: 'dup', price: 100, size: 10, timestamp_ms: T0 + 102 * STEP }] });
  assert.equal(f.analyze().trades, before + 1);
});

test('grade: confirms, disagrees, neutral, unavailable', () => {
  const bull = createOrderFlow(); calm(bull);
  feed(bull, 50, 58, { bidSizes: [1200, 900, 700, 250, 200, 200, 150, 150, 100, 100], askSizes: [120, 100, 90, 250, 200, 200, 150, 150, 100, 100] });
  const now = T0 + 58 * STEP;
  assert.equal(bull.grade(1, now).grade, 'confirms');
  assert.equal(bull.grade(-1, now).grade, 'disagrees');
  const flat = createOrderFlow(); calm(flat);
  assert.equal(flat.grade(1, T0 + 50 * STEP).grade, 'neutral');
  assert.equal(flat.grade(1, T0 + 50 * STEP + 60_000).grade, 'unavailable', 'stale data is never graded');
  assert.equal(createOrderFlow().grade(1).grade, 'unavailable');
});
