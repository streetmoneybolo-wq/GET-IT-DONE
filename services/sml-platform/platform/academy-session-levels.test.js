'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('./academy-session-levels');

const MIN = 60000;
const OPEN = Date.UTC(2026, 9, 14, 13, 30); // 09:30 New York on 14 October 2026 (EDT)
const at = (hh, mm, dayOffset = 0) => OPEN + ((hh * 60 + mm) - (9 * 60 + 30)) * MIN + dayOffset * 24 * 60 * MIN;
const bar = (t, o, h, l, c, v = 1000) => ({ t, o, h, l, c, v });
const flat = (t, p, v = 1000) => bar(t, p, p, p, p, v);
/* one bar a minute from `from` for `n` minutes, prices from a function of the minute index */
const run = (from, n, f, v = 1000) => Array.from({ length: n }, (_, i) => { const p = f(i); return bar(from + i * MIN, p.o, p.h, p.l, p.c, v); });
const walk = (p, step) => (i) => ({ o: p + i * step, h: p + i * step + 0.2, l: p + i * step - 0.2, c: p + (i + 1) * step });

test('vwap bands sit on the price when it never moves and widen with the spread of prices', () => {
  const b = run(at(9, 30), 20, () => ({ o: 100, h: 100, l: 100, c: 100 }));
  const vw = L.vwapBands(b);
  assert.equal(vw[19].vwap, 100); assert.equal(vw[19].sd, 0); assert.deepEqual(vw[19].up, [100, 100]);
  b.push(flat(at(9, 50), 110, 1000)); // one bar well above lifts VWAP and opens the bands
  const vw2 = L.vwapBands(b);
  assert.ok(vw2[20].vwap > 100 && vw2[20].vwap < 110);
  assert.ok(vw2[20].sd > 0); assert.ok(vw2[20].up[1] > vw2[20].up[0] && vw2[20].up[0] > vw2[20].vwap);
  assert.ok(Math.abs((vw2[20].up[0] - vw2[20].vwap) - vw2[20].sd) < 1e-9, '1st band is one standard deviation');
});

test('vwap restarts at each New York day, and with anchor rth the pre-market bars are null', () => {
  const b = [flat(at(8, 0), 50), flat(at(9, 30), 100), flat(at(9, 31), 100), flat(at(9, 30, 1), 200)];
  const day = L.vwapBands(b);
  assert.ok(day[0]); assert.equal(day[1].vwap, 75); assert.equal(day[3].vwap, 200, 'the next day starts over');
  const rth = L.vwapBands(b, { anchor: 'rth' });
  assert.equal(rth[0], null); assert.equal(rth[1].vwap, 100); assert.equal(rth[2].vwap, 100);
});

test('initial balance is the first hour, completes after it, and records the first close through it', () => {
  const b = run(at(9, 30), 60, (i) => ({ o: 100, h: 100 + (i === 10 ? 3 : 1), l: 100 - (i === 40 ? 2 : 1), c: 100 }));
  let ib = L.initialBalance(b);
  assert.equal(ib.current.hi, 103); assert.equal(ib.current.lo, 98); assert.equal(ib.current.complete, false); assert.equal(ib.current.bars, 60);
  b.push(bar(at(10, 30), 100, 101, 99, 100), bar(at(10, 31), 100, 104, 100, 103.5));
  ib = L.initialBalance(b);
  assert.equal(ib.current.complete, true); assert.equal(ib.current.breakUp, 61); assert.equal(ib.current.breakDown, null);
  assert.equal(ib.current.range, 5); assert.equal(ib.current.ext.up1, 108); assert.equal(ib.current.ext.dn2, 88);
  assert.equal(ib.current.startT, at(9, 30)); assert.equal(ib.current.endT, at(10, 29));
});

test('a day with only pre-market bars has no initial balance, and yesterday is complete even if the last bar was inside the hour', () => {
  const b = [...run(at(9, 30, -1), 10, walk(100, 0)), ...run(at(8, 0), 5, walk(100, 0))];
  const ib = L.initialBalance(b);
  assert.equal(ib.days.length, 1); assert.equal(ib.days[0].complete, true);
  assert.equal(ib.current.day, '2026-10-13');
});

test('session ranges put the evening in the next day\'s Asia session and New York notes which overnight extremes it swept', () => {
  const b = [
    ...run(at(20, 0, -1), 10, walk(100, 0.1)),  // Asia (evening of the 13th): 100 .. about 101
    ...run(at(3, 0), 10, walk(99, 0)),          // Asia still (03:00)
    ...run(at(4, 0), 10, walk(98, 0.05)),       // London
    ...run(at(9, 30), 10, walk(97, -0.3)),      // New York drops below everything
    ...run(at(16, 0), 3, walk(95, 0))           // after hours
  ];
  const s = L.sessionRanges(b);
  assert.deepEqual(s.map((x) => x.key), ['asia', 'london', 'newYork', 'afterHours']);
  assert.ok(s.every((x) => x.day === '2026-10-14'), 'all four count towards the 14th');
  assert.equal(s[0].startT, at(20, 0, -1)); assert.equal(s[0].bars, 20);
  const ny = s[2];
  assert.deepEqual(ny.sweeps.map((w) => w.session + ':' + w.side), ['asia:low', 'london:low']);
  assert.equal(s[3].active, true); assert.equal(ny.active, false);
  const only = L.sessionRanges(b, { sessions: ['newYork'] });
  assert.equal(only.length, 1); assert.equal(only[0].key, 'newYork');
});

test('volume nodes find the point of control, the value area and the high and low volume prices', () => {
  const b = [];
  for (let i = 0; i < 40; i++) b.push(bar(at(9, 30) + i * MIN, 100, 100.5, 99.5, 100, i % 2 ? 50 : 60));   // most volume around 100
  for (let i = 0; i < 6; i++) b.push(bar(at(10, 10) + i * MIN, 104, 104.5, 103.5, 104, 60));             // a second cluster at 104
  b.push(bar(at(10, 20), 102, 102.2, 101.8, 102, 1));                                                     // almost nothing traded at 102
  for (let i = 0; i < 4; i++) b.push(bar(at(10, 21) + i * MIN, 108, 108.4, 107.6, 108, 15));            // thin at 108
  const p = L.volumeNodes(b, { bins: 18 });
  assert.ok(p && Math.abs(p.poc - 100) < 0.6, 'POC near 100: ' + p.poc);
  assert.ok(p.val <= 100 && p.vah >= 100);
  assert.ok(p.nodes.some((n) => n.kind === 'hvn' && Math.abs(n.price - 100) < 0.6), 'HVN at 100');
  assert.ok(p.nodes.some((n) => n.kind === 'lvn' && n.price > 101 && n.price < 103.5), 'LVN in the air pocket');
  assert.equal(L.volumeNodes([]), null);
});

test('fib retracement measures the last swing and says how far price has given back', () => {
  const b = [...run(at(9, 30), 10, walk(105, -0.5)), ...run(at(9, 40), 10, walk(100, 1)), ...run(at(9, 50), 6, walk(110, -0.5))];
  const f = L.fibRetracement(b, { k: 3 });
  assert.equal(f.dir, 'up'); assert.ok(f.end.price > 109.5); assert.ok(f.start.price <= 100.2);
  const half = f.levels.find((l) => l.ratio === 0.5);
  assert.ok(Math.abs(half.price - (f.end.price - f.range / 2)) < 1e-9);
  assert.ok(f.pos > 0 && f.pos < 1, 'part-way through the pullback: ' + f.pos);
  assert.equal(f.levels[0].price, f.end.price); assert.equal(f.levels[6].price, f.start.price);
  assert.ok(f.levels[8].price < f.start.price, '161.8% extends past the start of an up swing');
  assert.equal(L.fibRetracement(b.slice(0, 4)), null);
});

test('gamma regime colours each bar by its side of the flip and the levels list only what is known', () => {
  const b = [flat(at(9, 30), 100), flat(at(9, 31), 101), flat(at(9, 32), 99), flat(at(9, 33), 100.05)];
  assert.deepEqual(L.gammaRegime(b, { flip: 100 }), ['neutral', 'positive', 'negative', 'neutral']);
  assert.deepEqual(L.gammaRegime(b, { regime: 'negative' }), ['negative', 'negative', 'negative', 'negative']);
  assert.deepEqual(L.gammaLevels({ callWall: 110, putWall: 90 }).map((l) => l.key), ['callWall', 'putWall']);
  assert.deepEqual(L.gammaLevels({ callWall: 110, flip: 100, putWall: 90 }).map((l) => l.label), ['CALL WALL', 'GAMMA FLIP', 'PUT WALL']);
  assert.deepEqual(L.gammaLevels({}), []);
});

test('analyze and read put the day together in plain words', () => {
  const b = [...run(at(4, 0), 30, walk(99, 0.02)), ...run(at(9, 30), 90, (i) => ({ o: 100 + i * 0.05, h: 100.4 + i * 0.05, l: 99.6 + i * 0.05, c: 100.1 + i * 0.05 }))];
  const a = L.analyze(b, { gamma: { callWall: 110, putWall: 95, flip: 102, regime: 'negative' } });
  assert.ok(a && a.ib.current.complete && a.ib.current.breakUp != null);
  assert.equal(a.sessions.filter((s) => s.day === '2026-10-14').map((s) => s.key).join(','), 'london,newYork');
  assert.ok(a.profile && a.vwap[a.n - 1] && a.gamma.levels.length === 3);
  const lines = L.read(a).map((l) => l.text).join('\n');
  assert.match(lines, /VWAP at/); assert.match(lines, /Initial Balance .* broke to the upside/);
  assert.match(lines, /London: /); assert.match(lines, /New York \(live\): /); assert.match(lines, /Point of control/);
  assert.match(lines, /Dealer gamma positive \(flip 102\.00\), call wall 110\.00, put wall 95\.00/);
  assert.ok(!/No overnight bars/.test(lines), 'the feed had London bars');
  assert.deepEqual(L.read(null), []);
});
