'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSireFeed } = require('./academy-sire-feed');

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function fakeTimers() {
  const intervals = [];
  return { intervals, setInterval: (fn, ms) => { const h = { fn, ms, cleared: false }; intervals.push(h); return h; }, clearInterval: (h) => { if (h) h.cleared = true; } };
}
function fakeMassive(enabled = true) {
  const listeners = new Map(), log = [];
  return {
    listeners, log,
    status: () => ({ enabled }),
    on(sym, fn) { listeners.set(sym, fn); log.push('on:' + sym); return () => { listeners.delete(sym); log.push('off:' + sym); }; },
    fire(sym, trade) { const fn = listeners.get(sym); if (fn) fn({ type: 'trade', trade }); }
  };
}
const ROWS = [
  { symbol: 'AAA', name: 'Alpha', price: 100, changePct: 5, changeRate1min: 1, changeRate3min: 2, rvol: 3.2, volume: 1000, previousClose: 95.238 },
  { symbol: 'BBB', name: 'Beta', price: 50, changePct: -2, changeRate1min: -0.5, changeRate3min: -4, rvol: 1.1, volume: 500 },
  { symbol: 'CCC', name: 'Gamma', price: 10, changePct: 0, changeRate1min: 0, changeRate3min: 0.5, rvol: null, volume: 10 }
];
function viewer() { const events = []; return { events, write: (event, data) => events.push([event, JSON.parse(JSON.stringify(data))]) }; }

test('a viewer gets a snapshot then a tick with the compact rows; a second viewer starts from a full snapshot', async () => {
  let t = 1_000_000;
  const feed = createSireFeed({ scanner: async () => ({ rows: ROWS, asOf: t }), massive: fakeMassive(), now: () => t, timers: fakeTimers() });
  const a = viewer();
  const offA = feed.subscribe(a.write);
  assert.deepEqual(a.events[0], ['snapshot', { rows: [], asOf: 0, live: false, error: null }], 'nothing loaded yet');
  await settle();
  assert.equal(a.events[1][0], 'tick');
  assert.deepEqual(a.events[1][1].rows.map((r) => r.s), ['AAA', 'BBB', 'CCC']);
  assert.deepEqual(a.events[1][1].rows[0], { s: 'AAA', n: 'Alpha', p: 100, c: 5, r1: 1, r3: 2, rv: 3.2, v: 1000, t: t });
  const b = viewer();
  const offB = feed.subscribe(b.write);
  assert.equal(b.events[0][0], 'snapshot');
  assert.deepEqual(b.events[0][1].rows.map((r) => r.s), ['AAA', 'BBB', 'CCC']);
  assert.equal(b.events[0][1].live, true);
  offA(); offB();
  assert.equal(feed.status().running, false, 'nothing runs once the last viewer leaves');
});

test('a live trade moves price, day %, 1-minute % and S.I.R.E. from the scanner baselines, and only changed fields are sent', async () => {
  let t = 1_000_000;
  const massive = fakeMassive();
  const feed = createSireFeed({ scanner: async () => ({ rows: ROWS, asOf: t }), massive, now: () => t, timers: fakeTimers() });
  const v = viewer(); const off = feed.subscribe(v.write);
  await settle();
  assert.deepEqual(massive.log, ['on:BBB', 'on:AAA', 'on:CCC'], 'strongest 3-minute movers are watched first');
  t += 500;
  massive.fire('AAA', { price: 101, size: 10, t });
  feed.flush();
  const tick = v.events.at(-1);
  assert.equal(tick[0], 'tick');
  assert.equal(tick[1].rows.length, 1);
  const u = tick[1].rows[0];
  assert.equal(u.s, 'AAA'); assert.equal(u.p, 101); assert.equal(u.t, t);
  assert.ok(Math.abs(u.c - 6.05) < 0.01, 'day % from the previous close');
  assert.ok(Math.abs(u.r1 - 2.01) < 0.01, '1-minute % from the price implied one minute ago');
  assert.ok(Math.abs(u.r3 - 3.02) < 0.01, 'S.I.R.E. from the price implied three minutes ago');
  assert.equal('rv' in u, false, 'relative volume did not change, so it is not resent');
  assert.equal('n' in u, false);
  const before = v.events.length;
  feed.flush();
  assert.equal(v.events.length, before, 'no tick when nothing moved');
  massive.fire('AAA', { price: 101, size: 5, t: t + 1 });
  feed.flush();
  assert.equal(v.events.length, before, 'a trade at the same price changes nothing on screen');
  off();
});

test('a scanner refresh right after a live trade keeps the live price but re-bases the windows; stale symbols are dropped', async () => {
  let t = 1_000_000, rows = ROWS;
  const massive = fakeMassive();
  const feed = createSireFeed({ scanner: async () => ({ rows, asOf: t }), massive, now: () => t, timers: fakeTimers() });
  const v = viewer(); const off = feed.subscribe(v.write);
  await settle();
  t += 3000;
  massive.fire('AAA', { price: 102, size: 1, t });
  feed.flush();
  rows = [{ ...ROWS[0], price: 101.5, changeRate3min: 2.5 }, ROWS[2]];
  t += 1000; // the new scanner sample (asOf = t) is older than the trade only if the trade came after it
  massive.fire('AAA', { price: 102, size: 1, t: t + 100 });
  await feed.refresh();
  const last = v.events.at(-1)[1].rows;
  const aaa = feed.snapshot().rows.find((r) => r.s === 'AAA');
  assert.equal(aaa.p, 102, 'the newer live print wins over the scanner sample');
  assert.ok(Math.abs(aaa.r3 - ((102 - 101.5 / 1.025) / (101.5 / 1.025)) * 100) < 1e-3, 'S.I.R.E. is measured from the new scanner window');
  const delta = last.find((r) => r.s === 'AAA');
  assert.equal('p' in delta, false, 'the price was already on screen, so only the re-based rates are sent');
  assert.equal(delta.r3, aaa.r3);
  assert.deepEqual(last.find((r) => r.s === 'BBB'), { s: 'BBB', gone: true });
  assert.ok(massive.log.includes('off:BBB'), 'a symbol that left the scanner is no longer watched');
  assert.deepEqual(feed.snapshot().rows.map((r) => r.s), ['AAA', 'CCC']);
  off();
});

test('only the top movers are watched on Massive, and the set follows the ranking', async () => {
  let t = 1_000_000, rows = ROWS;
  const massive = fakeMassive();
  const feed = createSireFeed({ scanner: async () => ({ rows, asOf: t }), massive, now: () => t, timers: fakeTimers(), top: 2 });
  const off = feed.subscribe(() => {});
  await settle();
  assert.deepEqual([...massive.listeners.keys()].sort(), ['AAA', 'BBB']);
  rows = [ROWS[0], { ...ROWS[1], changeRate3min: 0.1 }, { ...ROWS[2], changeRate3min: 9 }];
  await feed.refresh();
  assert.deepEqual([...massive.listeners.keys()].sort(), ['AAA', 'CCC']);
  assert.ok(massive.log.includes('off:BBB'));
  off();
  assert.equal(massive.listeners.size, 0, 'listeners are released with the last viewer');
});

test('gated viewers only see their free symbols, in snapshots and ticks', async () => {
  let t = 1_000_000;
  const massive = fakeMassive();
  const feed = createSireFeed({ scanner: async () => ({ rows: ROWS, asOf: t }), massive, now: () => t, timers: fakeTimers() });
  const full = viewer(); const offFull = feed.subscribe(full.write);
  await settle();
  const free = viewer(); const offFree = feed.subscribe(free.write, { filter: (s) => s === 'CCC' });
  assert.deepEqual(free.events[0][1].rows.map((r) => r.s), ['CCC']);
  massive.fire('AAA', { price: 99, size: 1, t: t + 10 });
  massive.fire('CCC', { price: 10.5, size: 1, t: t + 10 });
  feed.flush();
  assert.deepEqual(free.events.at(-1)[1].rows.map((r) => r.s), ['CCC']);
  assert.deepEqual(full.events.at(-1)[1].rows.map((r) => r.s).sort(), ['AAA', 'CCC']);
  offFull(); offFree();
});

test('a failing scanner is reported in the snapshot and does not stop the feed; without Massive the rows still refresh', async () => {
  let t = 1_000_000, fail = true;
  const timers = fakeTimers();
  const feed = createSireFeed({ scanner: async () => { if (fail) throw new Error('scanner_down'); return { rows: ROWS, asOf: t }; }, massive: null, now: () => t, timers });
  const v = viewer(); const off = feed.subscribe(v.write);
  await settle();
  assert.equal(feed.status().error, 'scanner_down');
  assert.equal(v.events.length, 1);
  fail = false;
  await timers.intervals[0].fn(); // the refresh interval
  await settle();
  assert.equal(feed.status().error, null);
  assert.deepEqual(v.events.at(-1)[1].rows.map((r) => r.s), ['AAA', 'BBB', 'CCC']);
  assert.equal(feed.snapshot().live, false, 'no Massive means scanner cadence only');
  off();
  assert.ok(timers.intervals.every((h) => h.cleared));
});
