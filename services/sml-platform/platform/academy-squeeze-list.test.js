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

test('an empty or broken universe is reported, not thrown; a slow symbol is skipped', async () => {
  const empty = createSqueezeList({ universe: async () => { throw new Error('down'); }, insight: async () => fake('X', 50), logger: () => {} });
  empty.list(); await new Promise((r) => setTimeout(r, 30));
  const e = empty.list(); assert.equal(e.error, 'no_universe'); assert.deepEqual(e.rows, []); assert.equal(e.building, false);
  const slow = createSqueezeList({ universe: async () => [{ symbol: 'A' }, { symbol: 'B' }], perSymbolMs: 40, insight: (s) => (s === 'A' ? new Promise(() => {}) : Promise.resolve(fake(s, 60))), logger: () => {} });
  slow.list(); await new Promise((r) => setTimeout(r, 120));
  const out = slow.list(); assert.equal(out.building, false); assert.deepEqual(out.rows.map((x) => x.symbol), ['B']);
  assert.throws(() => createSqueezeList({}), /insight_required/);
});
