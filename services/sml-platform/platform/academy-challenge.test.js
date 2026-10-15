'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ch = require('./academy-challenge');
const paperLib = require('./academy-paper');

const MON = Date.UTC(2026, 9, 12, 14, 0, 0); // Monday 2026-10-12 10:00 ET
const D = 86_400_000;
const R = ch.RULES;
const cand = (symbol, score, entry, stop, extra = {}) => ({ symbol, mode: 'swing', signal: { t: MON, dir: 1, i: 10 }, score, grade: score >= 75 ? 'A' : 'B', entry, stop, target: entry * 1.1, atr: 1, ...extra });

test('sizing: risk budget to the stop, capped by the position limit and cash, never below the minimum notional', () => {
  assert.equal(ch.sizeIdea(cand('A', 80, 100, 98), 1000, 1000), 3.5, '3% of $1,000 = $30 of risk would be 15 shares; the 35% cap ($350 / $100) wins');
  assert.equal(ch.sizeIdea(cand('A', 80, 100, 50), 1000, 1000), 0.6, '$30 / $50 of risk per share');
  assert.equal(ch.sizeIdea(cand('A', 80, 100, 98), 1000, 100), 0.98, 'cash-capped');
  assert.equal(ch.sizeIdea(cand('A', 80, 100, 99.9), 1000, 10), 0, 'too small');
  assert.equal(ch.sizeIdea(cand('A', 80, 100, 101), 1000, 1000), 0, 'stop above entry: no idea');
});

test('ideas: score floor, best first, blackout, full book, no duplicates, bearish market blocks, expiry', () => {
  const s = ch.freshState(MON);
  const acct = { positions: { HELD: { symbol: 'HELD', qty: 1 } }, cash: 1000, equity: 1000 };
  const raised = ch.raiseIdeas(s, [cand('BBB', 80, 50, 48), cand('AAA', 90, 100, 98), cand('LOW', R.minScore - 1, 20, 19), cand('ERN', 85, 10, 9.9, { earningsDays: 2 }), cand('HELD', 95, 10, 9)], acct, { ok: true, bias: 10 }, MON);
  assert.deepEqual(raised.map((i) => i.symbol), ['AAA', 'BBB']);
  assert.ok(raised[0].qty > 0 && raised[0].riskDollars <= 30.01 && raised[0].expiresAt > MON);
  assert.equal(ch.raiseIdeas(s, [cand('AAA', 90, 100, 98)], acct, { ok: true, bias: 10 }, MON + 1).length, 0, 'same signal, and AAA already pending');
  assert.equal(ch.raiseIdeas(s, [cand('CCC', 90, 100, 98)], acct, { ok: true, bias: -31 }, MON + 1).length, 0, 'market read bearish');
  assert.ok(s.log.some((l) => /earnings in 2 days/.test(l.text)));
  const full = ch.freshState(MON); const book = { positions: Object.fromEntries(Array.from({ length: R.maxPositions }, (_, i) => ['P' + i, { symbol: 'P' + i, qty: 1 }])), cash: 1000, equity: 5000 };
  assert.equal(ch.raiseIdeas(full, [cand('NEW', 90, 100, 98)], book, null, MON).length, 0, 'book full');
  assert.equal(ch.expireIdeas(s, MON + 3 * D), 2); assert.ok(s.ideas.every((i) => i.status === 'expired'));
});

test('exits for taken ideas: stop, gap, target, trailing stop from the next bar, session end, exit signal, closed by hand', () => {
  const s = ch.freshState(MON);
  const mk = (symbol, extra = {}) => { const i = { id: s.nextId++, t: MON, status: 'taken', symbol, mode: 'swing', signalT: MON, entry: 100, stop: 95, target: 110, trail: 2, maxHold: 3, atr: 1, qty: 2, ...extra }; s.ideas.push(i); return i; };
  const a = mk('AAA'); const pos = { AAA: { qty: 2 } };
  assert.equal(ch.planExits(s, pos, { AAA: { bar: { t: MON + 1, o: 101, h: 104, l: 100, c: 103 }, atr: 1 } }, MON + 1).length, 0); assert.equal(a.stop, 102, 'trail set after the bar');
  assert.equal(ch.planExits(s, pos, { AAA: { bar: { t: MON + 2, o: 103, h: 103.5, l: 102.8, c: 103 }, atr: 1 } }, MON + 2).length, 0); assert.equal(a.stop, 102, 'never loosens');
  const out = ch.planExits(s, pos, { AAA: { bar: { t: MON + 3, o: 102.5, h: 102.6, l: 101, c: 101.5 }, atr: 1 } }, MON + 3);
  assert.equal(out.length, 1); assert.equal(out[0].reason, 'stop'); assert.equal(out[0].price, 102); assert.equal(out[0].qty, 2);
  const g = mk('GAP'); assert.equal(ch.planExits(s, { GAP: { qty: 1 } }, { GAP: { bar: { t: MON + 1, o: 90, h: 92, l: 88, c: 91 } } }, MON + 1)[0].reason, 'stop (gap)'); void g;
  mk('TGT'); assert.equal(ch.planExits(s, { TGT: { qty: 1 } }, { TGT: { bar: { t: MON + 1, o: 105, h: 111, l: 104, c: 109 } } }, MON + 1)[0].reason, 'target');
  mk('DAY', { mode: 'day', target: 130 }); assert.equal(ch.planExits(s, { DAY: { qty: 1 } }, { DAY: { bar: { t: MON + 1, o: 100, h: 101, l: 99, c: 100 } } }, Date.UTC(2026, 9, 12, 19, 50, 0))[0].reason, 'session end');
  mk('XS', { target: 130 }); assert.equal(ch.planExits(s, { XS: { qty: 1 } }, { XS: { bar: { t: MON + 1, o: 100, h: 101, l: 99, c: 100 }, exitSignal: true } }, MON + 1)[0].reason, 'exit signal');
  const h = mk('HAND'); ch.planExits(s, {}, {}, MON + 1); assert.equal(h.status, 'closed'); assert.equal(h.exitReason, 'closed by hand');
});

test('service: deposit on the new week, idea raised and notified, take fills the paper account, exit sells it, snapshot', async () => {
  const saved = {}; const storeFor = (id) => ({ read: async () => saved[id] || null, write: async (v) => { saved[id] = JSON.parse(JSON.stringify(v)); } });
  let t = MON;
  const daily = Array.from({ length: 300 }, (_, i) => ({ t: Date.UTC(2025, 7, 1) + i * D, o: 100, h: 101, l: 99, c: 100, v: 1e6 }));
  let five = Array.from({ length: 200 }, (_, i) => ({ t: MON - (200 - i) * 300_000, o: 100, h: 101, l: 99, c: 100, v: 1e4 }));
  const paper = paperLib.createPaperService({ storeFor, quote: async () => ({ bid: 99.9, ask: 100.1, last: 100 }), now: () => t });
  let sellSignal = false;
  const analyze = (bars, mode) => ({ params: { trail: 2, maxHold: 40 }, latest: mode === 'swing' ? { t: sellSignal ? t : bars[bars.length - 1].t, dir: sellSignal ? -1 : 1, i: bars.length - 1, price: 100, stop: 96, target: 110, conf: { score: 82, grade: 'A', factors: [{ key: 'htf', label: 'Higher-timeframe trend', available: true, ok: true, pts: 20, max: 20 }] } } : null, confluence: null });
  const notified = [];
  const svc = ch.createChallenge({ store: storeFor('ideas'), paper, candles: async (s, tf) => ({ bars: tf === '1D' ? daily : five }), analyze, ctxFor: async () => ({}), universe: async () => [{ symbol: 'AAA' }], direction: async () => ({ ok: true, bias: 20 }), nextEarnings: async () => ({ daysAway: 30 }), notify: async (i) => notified.push(i), now: () => t, scanPerTick: 5 });
  const r = await svc.tick(); assert.ok(r && r.raised === 1); assert.equal(notified.length, 1); assert.equal(notified[0].symbol, 'AAA');
  let snap = await svc.snapshot(); assert.equal(snap.ideas[0].status, 'new'); assert.equal(snap.paper.summary.equity, 1000); assert.equal(snap.simulated, true);
  const took = await svc.take(snap.ideas[0].id); assert.equal(took.ok, true); assert.equal(took.trade.price, 100.1);
  assert.equal((await svc.take(snap.ideas[0].id)).error, 'idea_taken');
  snap = await svc.snapshot(); assert.equal(snap.open.length, 1); assert.equal(snap.paper.summary.positions[0].symbol, 'AAA');
  // next week: deposit lands, then the stop is hit on the next bar and the paper account sells
  t = MON + 7 * D + 3_600_000; five = five.concat([{ t: t - 300_000, o: 97, h: 98, l: 95, c: 96, v: 1e4 }]);
  const r2 = await svc.tick(); assert.equal(r2.sold, 1);
  snap = await svc.snapshot(); assert.equal(snap.open.length, 0); assert.equal(snap.ideas.find((i) => i.symbol === 'AAA').exitReason, 'stop');
  assert.ok(snap.paper.deposits.some((d) => d.kind === 'weekly' && d.amount === R.weeklyDeposit)); assert.ok(snap.paper.summary.cash > 1200);
  assert.equal((await svc.skip(999)).error, 'not_found');
  const closed = ch.createChallenge({ store: storeFor('ideas2'), paper, candles: async () => ({ bars: five }), analyze, universe: async () => [], now: () => Date.UTC(2026, 9, 11, 14, 0, 0) });
  assert.equal(await closed.tick(), null, 'Sunday: no tick');
  const after = await svc.reset(); assert.equal(after.ideas.length, 0); assert.equal(after.paper.summary.equity, 1000);
});
