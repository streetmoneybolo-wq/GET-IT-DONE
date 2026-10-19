'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSweepWallTracker, detectPrintSweeps, normalizeTapeSweeps } = require('./academy-sweep-wall');

const T0 = 1_800_000_000_000;
/* ten levels a side around 100.00 / 100.01; `ask` and `bid` override sizes best first */
const book = (o = {}) => ({
  bids: Array.from({ length: 10 }, (_, i) => ({ price: +(100 - i * 0.01).toFixed(2), size: (o.bid || [])[i] != null ? o.bid[i] : 300 })),
  asks: Array.from({ length: 10 }, (_, i) => ({ price: +(100.01 + i * 0.01).toFixed(2), size: (o.ask || [])[i] != null ? o.ask[i] : 300 }))
});
/* the book shifted up by `ticks` */
const shifted = (ticks, o = {}) => { const b = book(o); const d = ticks * 0.01; b.bids.forEach((l) => { l.price = +(l.price + d).toFixed(2); }); b.asks.forEach((l) => { l.price = +(l.price + d).toFixed(2); }); return b; };
const askWall = { side: 'ask', price: 100.04, max: 5000, first: T0 - 60_000, last: T0, seen: 12 };
const bidWall = { side: 'bid', price: 99.97, max: 4000, first: T0 - 60_000, last: T0, seen: 9 };
const tapeSweep = (t, price, dir, size) => [{ t, price, size, dir, legs: 4, exchanges: 3, isw: true }];

test('a buy sweep that eats the ask wall and holds above it is a confirmed breakout (bullish), measured on the next snapshots', () => {
  const tr = createSweepWallTracker();
  // the wall is on the book: 5,000 at 100.04
  let r = tr.push({ t: T0, ...book({ ask: [300, 300, 300, 5000] }), walls: [askWall] });
  assert.deepEqual([r.emitted.length, r.opened], [0, 0]);
  // the sweep prints at the wall; the next book shows the wall gone and the bid up through it
  r = tr.push({ t: T0 + 2500, ...shifted(4, { ask: [200, 300, 300, 300] }), walls: [askWall], sweeps: tapeSweep(T0 + 1200, 100.04, 'B', 9000) });
  assert.equal(r.opened, 1); assert.equal(r.emitted.length, 0, 'one snapshot held is not enough');
  assert.equal(tr.state(T0 + 2500).pending.length, 1); assert.equal(tr.state(T0 + 2500).pending[0].held, 1);
  tr.push({ t: T0 + 5000, ...shifted(5), walls: [askWall] });
  r = tr.push({ t: T0 + 7500, ...shifted(5), walls: [askWall] });
  assert.equal(r.emitted.length, 1);
  const ev = r.emitted[0];
  assert.equal(ev.kind, 'sweep'); assert.equal(ev.outcome, 'breakout_confirmed'); assert.equal(ev.side, 'bull'); assert.equal(ev.price, 100.04);
  assert.match(ev.note, /Buy sweep of 9,000 ate the 5,000 ask wall at 100.04 and price held above it/);
  assert.ok(ev.strength >= 0.9, 'a sweep nearly twice the wall is strong: ' + ev.strength);
  assert.equal(ev.sweep.source, 'tape'); assert.equal(ev.tookMs, 5000);
  const st = tr.state(T0 + 8000);
  assert.equal(st.pending.length, 0); assert.equal(st.events.length, 1); assert.equal(st.read.bias, 'bull'); assert.equal(st.read.lastOutcome, 'breakout_confirmed');
  // the same wall and direction is quiet for a minute (cooldown)
  r = tr.push({ t: T0 + 9000, ...shifted(4, { ask: [200, 300, 300, 300] }), walls: [askWall], sweeps: tapeSweep(T0 + 8800, 100.04, 'B', 3000) });
  assert.equal(r.opened, 0);
});

test('a buy sweep the ask wall absorbs (it refills, price is pushed back) is a bearish rejection; a wall that is eaten but loses the level is a false break', () => {
  const tr = createSweepWallTracker();
  tr.push({ t: T0, ...book({ ask: [300, 300, 300, 5000] }), walls: [askWall] });
  // the sweep hits the wall, the book shows it thinned, price did not get through
  let r = tr.push({ t: T0 + 2500, ...book({ ask: [300, 300, 300, 1200] }), walls: [askWall], sweeps: tapeSweep(T0 + 1500, 100.04, 'B', 4000) });
  assert.equal(r.opened, 1);
  // it refills and the bid is pushed lower
  r = tr.push({ t: T0 + 7000, ...shifted(-2, { ask: [300, 300, 300, 300, 300, 4800] }), walls: [askWall] });
  assert.equal(r.emitted.length, 1);
  assert.equal(r.emitted[0].outcome, 'sweep_absorbed'); assert.equal(r.emitted[0].side, 'bear');
  assert.match(r.emitted[0].note, /absorbed by the 5,000 ask wall at 100.04/);
  // false break: eaten and held, then back under
  const tr2 = createSweepWallTracker();
  tr2.push({ t: T0, ...book({ ask: [300, 300, 300, 5000] }), walls: [askWall] });
  tr2.push({ t: T0 + 2500, ...shifted(4, { ask: [200, 300, 300, 300] }), walls: [askWall], sweeps: tapeSweep(T0 + 1200, 100.04, 'B', 6000) });
  r = tr2.push({ t: T0 + 7000, ...shifted(-1), walls: [askWall] });
  assert.equal(r.emitted.length, 1); assert.equal(r.emitted[0].outcome, 'false_break'); assert.equal(r.emitted[0].side, 'bear');
  assert.match(r.emitted[0].note, /broke the 5,000 ask wall at 100.04 but price fell back under it/);
});

test('the mirror: a sell sweep through a bid wall that holds below is bearish, one the bid wall absorbs is bullish; sweeps that reach no wall open nothing', () => {
  const tr = createSweepWallTracker();
  tr.push({ t: T0, ...book({ bid: [300, 300, 300, 4000] }), walls: [bidWall] });
  let r = tr.push({ t: T0 + 2500, ...shifted(-4, { bid: [200, 300, 300, 300] }), walls: [bidWall], sweeps: tapeSweep(T0 + 1300, 99.97, 'S', 7000) });
  assert.equal(r.opened, 1);
  tr.push({ t: T0 + 5000, ...shifted(-5), walls: [bidWall] });
  r = tr.push({ t: T0 + 7500, ...shifted(-5), walls: [bidWall] });
  assert.equal(r.emitted[0].outcome, 'breakout_confirmed'); assert.equal(r.emitted[0].side, 'bear');
  const tr2 = createSweepWallTracker();
  tr2.push({ t: T0, ...book({ bid: [300, 300, 300, 4000] }), walls: [bidWall] });
  tr2.push({ t: T0 + 2500, ...book({ bid: [300, 300, 300, 900] }), walls: [bidWall], sweeps: tapeSweep(T0 + 1500, 99.97, 'S', 3000) });
  r = tr2.push({ t: T0 + 7000, ...shifted(2, { bid: [300, 300, 300, 300, 300, 3900] }), walls: [bidWall] });
  assert.equal(r.emitted[0].outcome, 'sweep_absorbed'); assert.equal(r.emitted[0].side, 'bull');
  // a sweep well away from any wall, or at a wall that only just appeared, is not a case
  const tr3 = createSweepWallTracker();
  assert.equal(tr3.push({ t: T0, ...book(), walls: [askWall], sweeps: tapeSweep(T0 - 100, 100.20, 'B', 9000) }).opened, 0);
  assert.equal(tr3.push({ t: T0 + 100, ...book(), walls: [{ ...askWall, seen: 1 }], sweeps: tapeSweep(T0, 100.04, 'B', 9000) }).opened, 0);
  assert.equal(tr3.push({ t: T0 + 200, ...book(), walls: [{ ...askWall, first: T0 + 150 }], sweeps: tapeSweep(T0 + 100, 100.04, 'B', 9000) }).opened, 0, 'a wall that appeared after the sweep was not what it hit');
});

test('without the Massive tape, a burst of same-direction prints crossing two ticks is the sweep; a case nobody resolves fades after ninety seconds', () => {
  const prints = [[0, 100.01, 300, 'B'], [120, 100.02, 400, 'B'], [250, 100.03, 500, 'B'], [330, 100.04, 800, 'B'], [2000, 100.03, 100, 'S'], [2100, 100.03, 100, 'S'], [2150, 100.03, 100, 'S'], [9000, 100.05, 50, 'B']].map(([dt, price, size, dir]) => ({ t: T0 + dt, price, size, dir }));
  const sw = detectPrintSweeps(prints, { tick: 0.01 });
  assert.equal(sw.length, 1, 'the three sells sit on one price (no levels crossed), the lone buy is alone');
  assert.deepEqual([sw[0].dir, sw[0].lo, sw[0].hi, sw[0].size, sw[0].legs, sw[0].source], ['B', 100.01, 100.04, 2000, 4, 'prints']);
  assert.deepEqual(normalizeTapeSweeps([{ t: 5, price: 10, size: 100, dir: 'B', legs: 3, exchanges: 2 }])[0].id, 'm:5:10:B');
  const tr = createSweepWallTracker();
  tr.push({ t: T0, ...book({ ask: [300, 300, 300, 5000] }), walls: [askWall] });
  const r = tr.push({ t: T0 + 2500, ...book({ ask: [300, 300, 300, 2600] }), walls: [askWall], prints: prints.slice(0, 4) });
  assert.equal(r.opened, 1); assert.equal(tr.state(T0 + 2500).pending[0].source, 'prints');
  // half eaten, price neither through nor pushed back: nothing decisive, and the case fades
  let emitted = 0;
  for (let t = T0 + 5000; t <= T0 + 100_000; t += 2500) emitted += tr.push({ t, ...book({ ask: [300, 300, 300, 2600] }), walls: [askWall] }).emitted.length;
  assert.equal(emitted, 0); assert.equal(tr.state(T0 + 100_000).pending.length, 0); assert.equal(tr.state(T0 + 100_000).events.length, 0);
  assert.equal(tr.state().read, null);
});
