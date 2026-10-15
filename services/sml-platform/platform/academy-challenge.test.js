'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ch = require('./academy-challenge');

const MON = Date.UTC(2026, 9, 12, 14, 0, 0); // Monday 2026-10-12 10:00 ET
const D = 86_400_000;
const R = ch.RULES;

test('fresh state, weekly deposit once per week on an open day', () => {
  const s = ch.freshState(MON);
  assert.equal(s.cash, 1000); assert.equal(s.deposits.length, 1);
  assert.equal(ch.applyDeposit(s, MON + 2 * D), false, 'same week');
  assert.equal(ch.applyDeposit(s, MON + 7 * D, R, false), false, 'next Monday but the market is closed: wait');
  assert.equal(ch.applyDeposit(s, MON + 8 * D), true, 'first open day of the new week'); assert.equal(s.cash, 1100);
  assert.equal(ch.applyDeposit(s, MON + 9 * D), false); assert.equal(s.deposits.filter((d) => d.kind === 'weekly').length, 1);
});

test('entries: grade A only, best first, sized to 1% risk, capped by position size, cash and count; earnings blackout; bearish market blocks', () => {
  const s = ch.freshState(MON);
  const sig = { t: MON, dir: 1, i: 10 };
  const c = (symbol, score, price, stop, extra = {}) => ({ symbol, mode: 'swing', signal: sig, score, grade: score >= 75 ? 'A' : 'B', stop, target: price * 1.1, atr: 1, ...extra });
  const prices = { AAA: 100, BBB: 50, CCC: 20, DDD: 10, EEE: 5, FFF: 2, GGG: 200 };
  const opened = ch.pickEntries(s, [c('BBB', 80, 50, 48), c('AAA', 90, 100, 98), c('CCC', 70, 20, 19), c('DDD', 85, 10, 9.9, { earningsDays: 3 }), c('EEE', 76, 5, 4.9), c('FFF', 77, 2, 1.9), c('GGG', 78, 200, 180)], prices, MON, { ok: true, bias: 10 });
  assert.deepEqual(opened.map((p) => p.symbol), ['AAA', 'BBB', 'GGG', 'FFF', 'EEE'], 'best score first; CCC is grade B, DDD is in the earnings blackout, and the fifth slot fills');
  const aaa = opened[0]; assert.ok(aaa.qty * (aaa.entry - aaa.stop) <= 1000 * 0.01 + 0.01, 'risk is one percent'); assert.ok(aaa.qty * aaa.entry <= 250.5, 'and at most a quarter of the account');
  assert.ok(s.cash >= 0); assert.equal(s.positions.length, 5);
  assert.ok(s.log.some((l) => /earnings in 3 days/.test(l.text)));
  const s2 = ch.freshState(MON);
  assert.equal(ch.pickEntries(s2, [c('AAA', 90, 100, 98)], prices, MON, { ok: true, bias: -35 }).length, 0, 'market read below -30: no new longs');
  assert.equal(ch.pickEntries(s2, [c('AAA', 90, 100, 98)], prices, MON, null).length, 1, 'no market read: trade');
  assert.equal(ch.pickEntries(s2, [c('AAA', 90, 100, 98)], prices, MON + 60_000, null).length, 0, 'the same signal never fills twice');
});

test('exits: stop, gap through the stop, target, trailing stop only tightens, time, session end, exit signal; costs charged', () => {
  const s = ch.freshState(MON);
  ch.pickEntries(s, [{ symbol: 'AAA', mode: 'swing', signal: { t: MON, dir: 1, i: 1 }, score: 90, grade: 'A', stop: 95, target: 110, trail: 2, maxHold: 3, atr: 1 }], { AAA: 100 }, MON, null);
  const p = s.positions[0]; const cashAfterBuy = s.cash;
  assert.equal(ch.manageExits(s, { AAA: { bar: { t: MON + 1, o: 101, h: 104, l: 100, c: 103 }, atr: 1 } }, MON + 1).length, 0);
  assert.equal(p.stop, 102, 'trail: 104 high minus 2 ATR'); assert.equal(p.bars, 1);
  ch.manageExits(s, { AAA: { bar: { t: MON + 1, o: 101, h: 104, l: 100, c: 103 }, atr: 1 } }, MON + 2); assert.equal(p.bars, 1, 'the same bar is not counted twice');
  ch.manageExits(s, { AAA: { bar: { t: MON + 2, o: 103, h: 103.5, l: 102.8, c: 103 }, atr: 1 } }, MON + 3); assert.equal(p.stop, 102, 'a lower high never loosens the stop');
  const closed = ch.manageExits(s, { AAA: { bar: { t: MON + 3, o: 102.5, h: 102.6, l: 101, c: 101.5 }, atr: 1 } }, MON + 4);
  assert.equal(closed.length, 1); assert.equal(closed[0].reason, 'stop'); assert.ok(closed[0].exit < 102 && closed[0].exit > 101.9, 'filled at the stop less slippage');
  assert.ok(s.cash > cashAfterBuy && closed[0].pnl > 0 && closed[0].R > 0);
  const gap = ch.freshState(MON); ch.pickEntries(gap, [{ symbol: 'GAP', mode: 'swing', signal: { t: MON, dir: 1, i: 1 }, score: 90, grade: 'A', stop: 95, target: 120, atr: 1 }], { GAP: 100 }, MON, null);
  assert.equal(ch.manageExits(gap, { GAP: { bar: { t: MON + 1, o: 90, h: 92, l: 88, c: 91 } } }, MON + 1)[0].reason, 'stop (gap)');
  const tgt = ch.freshState(MON); ch.pickEntries(tgt, [{ symbol: 'TGT', mode: 'swing', signal: { t: MON, dir: 1, i: 1 }, score: 90, grade: 'A', stop: 95, target: 110, atr: 1 }], { TGT: 100 }, MON, null);
  assert.equal(ch.manageExits(tgt, { TGT: { bar: { t: MON + 1, o: 105, h: 111, l: 104, c: 109 } } }, MON + 1)[0].reason, 'target');
  const day = ch.freshState(MON); ch.pickEntries(day, [{ symbol: 'DAY', mode: 'day', signal: { t: MON, dir: 1, i: 1 }, score: 90, grade: 'A', stop: 95, target: 130, atr: 1 }], { DAY: 100 }, MON, null);
  assert.equal(ch.manageExits(day, { DAY: { bar: { t: MON + 1, o: 100, h: 101, l: 99, c: 100 } } }, Date.UTC(2026, 9, 12, 19, 50, 0))[0].reason, 'session end', '15:50 ET: flat');
  const xs = ch.freshState(MON); ch.pickEntries(xs, [{ symbol: 'XS', mode: 'swing', signal: { t: MON, dir: 1, i: 1 }, score: 90, grade: 'A', stop: 95, target: 130, atr: 1 }], { XS: 100 }, MON, null);
  assert.equal(ch.manageExits(xs, { XS: { bar: { t: MON + 1, o: 100, h: 101, l: 99, c: 100 }, exitSignal: true } }, MON + 1)[0].reason, 'exit signal');
});

test('hedge: on when the read is clearly bearish and the book is exposed, off when it recovers', () => {
  const s = ch.freshState(MON);
  ch.pickEntries(s, [{ symbol: 'AAA', mode: 'swing', signal: { t: MON, dir: 1, i: 1 }, score: 90, grade: 'A', stop: 98, target: 130, atr: 1 }, { symbol: 'BBB', mode: 'swing', signal: { t: MON, dir: 1, i: 1 }, score: 88, grade: 'A', stop: 49, target: 65, atr: 1 }], { AAA: 100, BBB: 50 }, MON, null); // tight stops: both fill at the 25% cap, half the book exposed
  const prices = { AAA: 100, BBB: 50, SH: 20 };
  assert.equal(ch.manageHedge(s, { ok: true, bias: -45 }, prices, MON), 'on'); const h = s.positions.find((p) => p.hedge); assert.ok(h && h.symbol === 'SH');
  assert.ok(h.qty * h.entry <= ch.exposure(s, prices) * 0.5 + 1);
  assert.equal(ch.manageHedge(s, { ok: true, bias: -45 }, prices, MON + 1), null, 'already hedged');
  assert.equal(ch.manageHedge(s, { ok: true, bias: 5 }, prices, MON + 2), 'off'); assert.ok(!s.positions.some((p) => p.hedge));
  const flat = ch.freshState(MON); assert.equal(ch.manageHedge(flat, { ok: true, bias: -60 }, prices, MON), null, 'nothing to hedge');
  assert.ok(s.trades.some((t) => t.hedge), 'the hedge round trip is in the log, flagged');
});

test('equity curve and stats: deposits are not returns, drawdown from the curve, progress to the goal', () => {
  const s = ch.freshState(MON);
  ch.recordEquity(s, {}, MON + 5 * 60_000); ch.applyDeposit(s, MON + 8 * D); ch.recordEquity(s, {}, MON + 8 * D);
  const st = ch.stats(s, {}, MON + 8 * D);
  assert.equal(st.equity, 1100); assert.equal(st.deposited, 1100); assert.equal(st.pnl, 0); assert.equal(st.returnPct, 0); assert.equal(st.progressPct, 1.1);
  s.cash = 990; ch.recordEquity(s, {}, MON + 9 * D); assert.equal(ch.stats(s, {}, MON + 9 * D).maxDrawdownPct, 10);
});

test('service: ticks only in regular hours, fills a fresh grade-A swing signal at the live price, persists, snapshots as simulated', async () => {
  let saved = null; const store = { read: async () => saved, write: async (v) => { saved = JSON.parse(JSON.stringify(v)); } };
  const daily = Array.from({ length: 300 }, (_, i) => ({ t: Date.UTC(2025, 7, 1) + i * D, o: 100, h: 101, l: 99, c: 100, v: 1e6 }));
  const five = Array.from({ length: 200 }, (_, i) => ({ t: MON - (200 - i) * 300_000, o: 100, h: 101, l: 99, c: 100 + i * 0.01, v: 1e4 }));
  const analyze = (bars, mode) => ({ params: { trail: mode === 'swing' ? 2 : null, maxHold: 40 }, latest: mode === 'swing' ? { t: bars[bars.length - 1].t, dir: 1, i: bars.length - 1, stop: 96, target: 110, conf: { score: 80, grade: 'A', factors: [{ key: 'htf', label: 'Higher-timeframe trend', available: true, ok: true, pts: 20, max: 20 }] } } : null, confluence: null });
  const svc = ch.createChallenge({ store, candles: async (s, tf) => ({ bars: tf === '1D' ? daily : five }), analyze, ctxFor: async () => ({}), universe: async () => [{ symbol: 'AAA' }], direction: async () => ({ ok: true, bias: 20 }), nextEarnings: async () => ({ daysAway: 30 }), now: () => MON, scanPerTick: 5 });
  const r = await svc.tick();
  assert.ok(r && r.opened === 1); assert.ok(saved && saved.positions.length === 1 && saved.positions[0].symbol === 'AAA');
  const snap = await svc.snapshot();
  assert.equal(snap.simulated, true); assert.ok(/SIMULATED/.test(snap.disclaimer)); assert.equal(snap.stats.openPositions, 1); assert.ok(snap.positions[0].pnl != null);
  const closedSvc = ch.createChallenge({ store, candles: async () => ({ bars: five }), analyze, universe: async () => [], now: () => Date.UTC(2026, 9, 11, 14, 0, 0) });
  assert.equal(await closedSvc.tick(), null, 'Sunday: no tick');
  const after = await svc.reset(); assert.equal(after.stats.equity, 1000); assert.equal(after.positions.length, 0);
});
