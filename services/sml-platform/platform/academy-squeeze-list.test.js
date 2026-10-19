'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSqueezeList } = require('./academy-squeeze-list');

const fake = (s, score, extra = {}) => ({ ok: true, available: true, symbol: s, squeeze: { score, components: [{ key: 'dtc', label: 'Days to cover', max: 25, pts: 18, detail: '6 days' }, { key: 'tape', label: 'Tape', max: 15, pts: -2, detail: 'sold' }] }, pressing: { score: 100 - score }, interest: { daysToCover: 6, shortInterest: 5e6, siChangePct: 12 }, shortVsPrice: { avgRatio: 55, trendPts: 3, tone: 'up' }, price: { close: 101, hi20: 100, lo20: 90 }, verdict: { long: { call: 'squeeze candidate', tone: 'up' } }, sources: { short: true }, ...extra });

test('the squeeze list: scans the universe a few at a time in the background, ranks by the squeeze score, keeps the top 20, carries the facts', async () => {
  let clock = 1_800_000_000_000, calls = 0;
  const universe = Array.from({ length: 30 }, (_, i) => ({ symbol: 'S' + i, name: 'Stock ' + i, volume: 1e6 * (30 - i), changePct: i / 10 }));
  universe.push({ symbol: 'bad symbol' }, { symbol: 'S1' }, { ticker: 'T1', name: 'Ticker one' });
  const svc = createSqueezeList({ universe: async () => universe, concurrency: 4, now: () => clock, logger: () => {}, insight: async (s) => { calls += 1; await new Promise((r) => setTimeout(r, 5)); if (s === 'S3') throw new Error('boom'); if (s === 'S4') return { ok: true, available: false }; if (s === 'T1') return fake(s, 99); return fake(s, 10 + Number(s.slice(1)) * 3); } });
  const first = svc.list();
  assert.equal(first.building, true); assert.deepEqual(first.rows, []);
  await new Promise((r) => setTimeout(r, 400));
  const done = svc.list();
  assert.equal(done.building, false); assert.equal(done.total, 31, 'unique valid symbols only'); assert.equal(done.done, 31); assert.equal(calls, 31);
  assert.equal(done.rows.length, 20); assert.equal(done.rows[0].symbol, 'T1'); assert.equal(done.rows[0].rank, 1); assert.equal(done.rows[0].name, 'Ticker one'); assert.equal(done.rows[1].symbol, 'S29');
  assert.ok(!done.rows.some((r) => r.symbol === 'S3' || r.symbol === 'S4'), 'a failed or unavailable read is left out');
  const r = done.rows[1];
  assert.equal(r.squeeze, 97); assert.equal(r.pressing, 3); assert.equal(r.daysToCover, 6); assert.equal(r.shortRatio, 55); assert.equal(r.aboveHigh, true); assert.equal(r.changePct, 2.9); assert.equal(r.volume, 1e6); assert.deepEqual(r.why, ['Days to cover: 6 days']); assert.equal(r.call, 'squeeze candidate');
  assert.ok(done.asOf > 0); assert.match(done.note, /SQUEEZE RISK/);
  svc.list(); assert.equal(calls, 31, 'fresh: no rescan');
  clock += 11 * 60_000; const again = svc.list(); assert.equal(again.building, true, 'stale: a rescan starts and the old rows are still served'); assert.equal(again.rows.length, 20);
  await new Promise((r) => setTimeout(r, 400)); assert.equal(calls, 62);
  svc.list({ refresh: true }); await new Promise((r) => setTimeout(r, 400)); assert.equal(calls, 93, 'refresh forces a rescan');
});

test('the low-float lane: names below the active cut with a small float are read too, marked, and carry the supply numbers', async () => {
  const universe = Array.from({ length: 12 }, (_, i) => ({ symbol: 'A' + i, volume: 1e6 * (12 - i), sharesFloat: i === 9 ? 8e6 : i === 11 ? 30e6 : i === 10 ? 900e6 : null, sharesOutstanding: i === 7 ? 40e6 : null }));
  const seen = [];
  const svc = createSqueezeList({ universe: async () => universe, maxSymbols: 5, lowFloatMax: 50e6, lowFloatExtra: 2, concurrency: 3, logger: () => {}, insight: async (s) => { seen.push(s); return fake(s, s === 'A9' ? 80 : 40, { model: { fuel: { score: 90, floatShares: s === 'A9' ? 8e6 : 100e6, floatBand: s === 'A9' ? 'low float' : 'mid float', floatKey: s === 'A9' ? 'low' : 'mid', coverRatio: s === 'A9' ? 1.1 : 0.2, floatTurn: 1.4, dollarFloat: 50e6 }, spark: { score: 50 }, accelerant: { score: 10 }, trap: { score: 5 }, qstate: { dominant: 'squeeze', probs: { squeeze: 0.6 }, entropy: 0.4 }, band: 'loaded', coverage: 0.8, why: { fuel: [], spark: [] } } }); } });
  svc.list(); await new Promise((r) => setTimeout(r, 200));
  const out = svc.list();
  assert.equal(out.total, 7, 'five active names plus two low-float names'); assert.equal(out.lowFloat, 2);
  assert.deepEqual(seen.filter((s) => ['A7', 'A9', 'A10', 'A11'].includes(s)).sort(), ['A7', 'A9'], 'the first two small floats past the cut (A10 is a 900M float, A11 comes after the lane is full)');
  const top = out.rows[0];
  assert.equal(top.symbol, 'A9'); assert.equal(top.lane, 'low-float'); assert.equal(top.floatShares, 8e6); assert.equal(top.floatBand, 'low float'); assert.equal(top.coverRatio, 1.1); assert.equal(top.floatTurn, 1.4);
  assert.equal(out.rows.find((r) => r.symbol === 'A0').lane, 'active');
  assert.match(out.note, /cover ratio = shares owed per free share/); assert.match(out.note, /low-float lane \(floats under 50M\)/);
});

test('two phases: the quick fuel read screens the whole universe, the top names get the full read, the store serves the last list first', async () => {
  let clock = 1_800_000_000_000;
  const universe = Array.from({ length: 40 }, (_, i) => ({ symbol: 'Q' + i, volume: 1e6 * (40 - i), sharesFloat: i === 38 ? 9e6 : i === 39 ? 20e6 : null }));
  const quickSeen = [], fullSeen = [];
  const saved = { rows: [{ symbol: 'OLD', squeeze: 55, rank: 1 }], at: clock - 60_000, total: 9, lowFloat: 1 };
  const store = { read: async () => saved, writes: [], write: async (v) => { store.writes.push(v); } };
  /* quick fuel: Q0..Q39 score 80 - i, except the low-float Q38 (fuel 50) and Q39 (fuel 10: too little to earn a full read) */
  const svc = createSqueezeList({ universe: async () => universe, store, maxSymbols: 10, lowFloatMax: 50e6, lowFloatExtra: 5, concurrency: 4, quickConcurrency: 8, now: () => clock, logger: () => {},
    quick: async (s) => { quickSeen.push(s); const i = Number(s.slice(1)); if (i === 7) return { ok: true, available: false }; return { ok: true, available: true, fuel: i === 38 ? 50 : i === 39 ? 10 : 80 - i, coverRatio: 0.3 }; },
    insight: async (s) => { fullSeen.push(s); await new Promise((r) => setTimeout(r, 3)); return fake(s, 90 - Number(s.slice(1)), { model: { fuel: { score: 70, floatShares: 9e6 }, spark: { score: 60 }, gamma: { score: 77, band: 'gamma squeeze loaded', callWall: { strike: 12, distancePct: 1.5 }, putCallVol: 0.5 }, trap: { score: 5 }, qstate: { dominant: 'squeeze', probs: { squeeze: 0.6 }, entropy: 0.4 }, band: 'squeeze candidate', coverage: 0.9, why: { fuel: ['a'], spark: ['b'], gamma: ['dealers short the ladder'] } } }); } });
  const until = async (fn) => { for (let i = 0; i < 1000 && !fn(); i++) await new Promise((r) => setTimeout(r, 10)); };
  const first = svc.list();
  assert.equal(first.building, true); assert.equal(first.phase, 'quick');
  await svc.restore();
  const early = svc.list();
  assert.equal(early.fromStore, true); assert.deepEqual(early.rows.map((r) => r.symbol), ['OLD'], 'the last list is served while the sweep runs');
  await until(() => !svc.state.building);
  const done = svc.list();
  assert.equal(done.building, false); assert.equal(done.fromStore, false); assert.equal(done.quickTotal, 40); assert.equal(done.quickDone, 40);
  assert.equal(quickSeen.length, 40, 'every name is pre-screened');
  assert.equal(done.total, 11, 'the top 10 by fuel plus the low-float name with real fuel'); assert.equal(done.lowFloat, 2);
  assert.deepEqual(fullSeen.slice().sort(), ['Q0', 'Q1', 'Q10', 'Q2', 'Q3', 'Q38', 'Q4', 'Q5', 'Q6', 'Q8', 'Q9'], 'Q7 had no short data, Q39 had no fuel');
  assert.equal(done.rows[0].symbol, 'Q0'); assert.equal(done.rows[0].gamma, 77); assert.equal(done.rows[0].gammaBand, 'gamma squeeze loaded'); assert.equal(done.rows[0].callWall.strike, 12); assert.equal(done.rows[0].putCallVol, 0.5);
  assert.ok(done.rows[0].modelWhy.includes('dealers short the ladder'));
  assert.equal(done.rows.find((r) => r.symbol === 'Q38').lane, 'low-float');
  assert.equal(store.writes.length, 1); assert.equal(store.writes[0].rows.length, 11); assert.ok(done.lastMs >= 0);
  assert.match(done.note, /GAMMA SQUEEZE/); assert.match(done.note, /pre-screens the whole active market/);
  /* keep warm: looked at recently, the list rebuilds by itself once stale */
  clock += 11 * 60_000;
  const again = svc.list({ touch: false });
  assert.equal(again.building, true, 'stale: a new sweep starts and the old rows are still served'); assert.equal(again.rows.length, 11);
  await until(() => !svc.state.building);
  assert.equal(quickSeen.length, 40, 'the pre-screen results are remembered for hours: no new quick reads'); assert.equal(svc.state.quickCached, 40);
});

test('the quick memo: pre-screen results are kept for hours and survive a restart through the quick store', async () => {
  let clock = 1_800_000_000_000;
  const universe = Array.from({ length: 6 }, (_, i) => ({ symbol: 'M' + i, volume: 1e6 }));
  const saved = { items: { M0: { at: clock - 3_600_000, v: { ok: true, available: true, fuel: 90, coverRatio: 1 } }, M1: { at: clock - 7 * 3_600_000, v: { ok: true, available: true, fuel: 95 } } }, at: clock - 3_600_000 };
  const quickStore = { read: async () => saved, writes: [], write: async (v) => { quickStore.writes.push(v); } };
  const quickSeen = [];
  const svc = createSqueezeList({ universe: async () => universe, quickStore, maxSymbols: 10, now: () => clock, logger: () => {},
    quick: async (s) => { quickSeen.push(s); return { ok: true, available: true, fuel: 50 }; }, insight: async (s) => fake(s, 60) });
  const until = async (fn) => { for (let i = 0; i < 1000 && !fn(); i++) await new Promise((r) => setTimeout(r, 10)); };
  svc.list(); await until(() => !svc.state.building);
  assert.deepEqual(quickSeen.sort(), ['M1', 'M2', 'M3', 'M4', 'M5'], 'M0 came from the store (an hour old); M1 was too old (7 hours)');
  assert.equal(svc.state.quickCached, 1);
  await until(() => quickStore.writes.length > 0);
  const w = quickStore.writes[0]; assert.ok(w.items.M0 && w.items.M2, 'the memo is written back'); assert.equal(w.items.M1.at, clock, 'M1 was re-read');
  clock += 11 * 60_000; svc.list(); await until(() => !svc.state.building);
  assert.equal(quickSeen.length, 5, 'the second sweep needed no quick reads at all'); assert.equal(svc.state.quickCached, 6);
});

test('back-pressure: while memory is short the sweep pauses between names instead of pushing on, and says so', async () => {
  let checks = 0, pausedSeen = false;
  const svc = createSqueezeList({ universe: async () => [{ symbol: 'P1' }, { symbol: 'P2' }, { symbol: 'P3' }], concurrency: 1, pauseMs: 15, logger: () => {},
    memoryOk: () => { checks += 1; return checks > 2; }, insight: async (s) => { pausedSeen = pausedSeen || svc.state.paused; return fake(s, 50); } });
  svc.list();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(svc.list().paused, true, 'waiting for memory');
  for (let i = 0; i < 200 && svc.state.building; i++) await new Promise((r) => setTimeout(r, 10));
  const out = svc.list();
  assert.equal(out.building, false); assert.equal(out.paused, false); assert.equal(out.rows.length, 3); assert.ok(checks >= 3);
});

test('an empty or broken universe is reported, not thrown; a slow symbol is skipped', async () => {
  const empty = createSqueezeList({ universe: async () => { throw new Error('down'); }, insight: async () => fake('X', 50), logger: () => {} });
  empty.list(); await new Promise((r) => setTimeout(r, 30));
  const e = empty.list(); assert.equal(e.error, 'no_universe'); assert.deepEqual(e.rows, []); assert.equal(e.building, false);
  const slow = createSqueezeList({ universe: async () => [{ symbol: 'A' }, { symbol: 'B' }], perSymbolMs: 40, insight: (s) => (s === 'A' ? new Promise(() => {}) : Promise.resolve(fake(s, 60))), logger: () => {} });
  slow.list(); await new Promise((r) => setTimeout(r, 120));
  const out = slow.list(); assert.equal(out.building, false); assert.deepEqual(out.rows.map((x) => x.symbol), ['B']);
  assert.throws(() => createSqueezeList({}), /insight_required/);
});
