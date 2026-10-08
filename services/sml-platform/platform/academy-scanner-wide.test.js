'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const w = require('./academy-scanner-wide');

const snap = (ticker, { p = 20, c = 20, prevC = 19, v = 1_000_000, prevV = 1_000_000, av = 0, bid = 19.99, ask = 20.01, bs = 300, as = 500, vw = 19.8 } = {}) => ({
  ticker, todaysChange: p - prevC, todaysChangePerc: ((p - prevC) / prevC) * 100,
  day: { o: 19.5, h: 20.5, l: 19.2, c, v, vw }, prevDay: { c: prevC, v: prevV }, min: { c: p, av },
  lastTrade: { p }, lastQuote: { p: bid, P: ask, s: bs, S: as }, updated: 1_700_000_000_000_000_000
});

test('maps a snapshot ticker to a scanner row with the site field names', () => {
  const row = w.rowFromSnapshot(snap('ABCD', { p: 21, prevC: 20, v: 2_000_000, prevV: 1_000_000, av: 2_100_000 }));
  assert.equal(row.symbol, 'ABCD');
  assert.equal(row.price, 21);
  assert.equal(row.change, 1);
  assert.equal(row.changePct, 5);
  assert.equal(row.volume, 2_100_000); // max(day.v, min.av)
  assert.equal(row.previousVolume, 1_000_000);
  assert.equal(row.previousClose, 20);
  assert.deepEqual([row.open, row.high, row.low], [19.5, 20.5, 19.2]);
  assert.deepEqual([row.bid, row.ask, row.bidSize, row.askSize], [19.99, 20.01, 3, 5]); // shares -> round lots
  assert.equal(row.turnover, 21 * 2_100_000);
  assert.equal(row.avgPrice, 19.8);
  assert.equal(row.relVolume, 2.1);
  assert.equal(row.updatedAt, 1_700_000_000_000);
});

test('price falls back from last trade to the minute bar to the day close', () => {
  assert.equal(w.rowFromSnapshot({ ...snap('AAA'), lastTrade: {}, min: { c: 7 } }).price, 7);
  assert.equal(w.rowFromSnapshot({ ...snap('AAA'), lastTrade: {}, min: {}, day: { c: 9, v: 1 } }).price, 9);
  assert.equal(w.rowFromSnapshot({ ...snap('AAA'), lastTrade: {}, min: {}, day: {} }), null);
});

test('filters to liquid, plain symbols: no penny stocks, thin volume, warrants, units, rights or odd tickers', () => {
  const map = w.parseSnapshot([
    snap('GOOD'), snap('PENY', { p: 0.8, prevC: 0.7 }), snap('THIN', { v: 10_000, prevV: 10_000 }),
    snap('ABCDW'), snap('ABCDU'), snap('ABCDR'), snap('ABCDE'), snap('BRK.B'), snap('TOOLONG'), snap('abc')
  ], { regular: true });
  assert.deepEqual([...map.keys()].sort(), ['ABCDE', 'GOOD']);
});

test('outside the regular session yesterday\'s volume also qualifies a name', () => {
  const pre = snap('PREM', { v: 20_000, prevV: 3_000_000 });
  assert.equal(w.parseSnapshot([pre], { regular: true }).size, 0);
  assert.equal(w.parseSnapshot([pre], { regular: false }).size, 1);
});

test('percentile ranks share ties and skip missing values', () => {
  assert.deepEqual(w.percentiles([10, null, 30, 20, 20]), [0, null, 1, 0.5, 0.5]);
  assert.deepEqual(w.percentiles([5]), [1]);
});

test('ranking: heavy relative volume, a big move and money traded rank first; outliers do not dominate', () => {
  const rows = [
    { symbol: 'HOT', price: 10, changePct: 12, volume: 9e6, previousVolume: 1e6, turnover: 9e7, changeRate3min: 1.5 },
    { symbol: 'MEGA', price: 500, changePct: 0.2, volume: 5e7, previousVolume: 6e7, turnover: 2.5e10, changeRate3min: 0.01 },
    { symbol: 'DULL', price: 30, changePct: 0.1, volume: 2e5, previousVolume: 1e6, turnover: 6e6, changeRate3min: 0 },
    { symbol: 'ODD', price: 2, changePct: 400, volume: 3e5, previousVolume: 3e5, turnover: 6e5 }
  ];
  const { rows: ranked } = w.rankRows(rows);
  assert.equal(ranked[0].symbol, 'HOT');
  assert.equal(ranked.at(-1).symbol, 'DULL');
  assert.deepEqual(ranked.map((r) => r.liveRank), [1, 2, 3, 4]);
  for (const r of ranked) assert.ok(r.liveScore >= 0 && r.liveScore <= 100);
  assert.ok(ranked.every((r) => r.rankMove === null));
});

test('rankMove is previous rank minus current rank, null for new names', () => {
  const a = { symbol: 'A', price: 10, changePct: 5, volume: 5e6, previousVolume: 1e6, turnover: 5e7 };
  const b = { symbol: 'B', price: 10, changePct: 1, volume: 1e6, previousVolume: 1e6, turnover: 1e7 };
  const c = { symbol: 'C', price: 10, changePct: 0.5, volume: 5e5, previousVolume: 1e6, turnover: 5e6 };
  const first = w.rankRows([a, b, c]);
  assert.deepEqual(first.rows.map((r) => r.symbol), ['A', 'B', 'C']);
  const second = w.rankRows([{ ...c, changePct: 9, volume: 9e6, turnover: 9e7 }, a, b, { symbol: 'D', price: 5, changePct: 0, volume: 2e5, previousVolume: 1e6, turnover: 1e6 }], first.ranks);
  const by = Object.fromEntries(second.rows.map((r) => [r.symbol, r]));
  assert.equal(by.C.liveRank, 1); assert.equal(by.C.rankMove, 2);
  assert.equal(by.A.rankMove, -1);
  assert.equal(by.D.rankMove, null);
});

test('merge: site rows win and keep their fields, empty site fields fill from the snapshot, the rest are added', () => {
  const wide = new Map([['AAPL', { symbol: 'AAPL', price: 200, avgPrice: 199, volume: 1, source: 'massive' }], ['ZZZ', { symbol: 'ZZZ', price: 5, volume: 3e6 }]]);
  const merged = w.mergeRows([{ symbol: 'AAPL', name: 'Apple', price: 201, avgPrice: null, volume: 9e6 }], wide);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0], { symbol: 'AAPL', name: 'Apple', price: 201, avgPrice: 199, volume: 9e6 });
  assert.equal(merged[1].symbol, 'ZZZ');
});

test('limit is capped to 1..500', () => {
  assert.equal(w.clampLimit(0), 1);
  assert.equal(w.clampLimit(-5), 1);
  assert.equal(w.clampLimit(250), 250);
  assert.equal(w.clampLimit(9999), 500);
  assert.equal(w.clampLimit('abc'), 500);
});

const clock = (start = 1_000_000) => { let t = start; return { now: () => t, add: (ms) => { t += ms; } }; };

test('shared snapshot: one request in flight, TTL by session, last good copy on failure', async () => {
  const c = clock();
  let calls = 0, fail = false;
  const shared = w.createSharedSnapshot({ snapshotAll: async () => { calls++; if (fail) throw new Error('down'); return [snap('AAA')]; }, now: c.now, session: () => 'regular' });
  const [x, y] = await Promise.all([shared.snapshotAll(), shared.snapshotAll()]);
  assert.equal(calls, 1); assert.equal(x, y);
  c.add(5_000); await shared.snapshotAll(); assert.equal(calls, 1);
  c.add(20_000); fail = true;
  const stale = await shared.latest(); // served at once, refresh in background
  assert.equal(stale.tickers.length, 1);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 2);
  assert.equal((await shared.latest()).tickers.length, 1); // still the last good copy
});

test('shared snapshot with no copy yet throws on failure', async () => {
  const shared = w.createSharedSnapshot({ snapshotAll: async () => { throw new Error('down'); }, session: () => 'closed' });
  await assert.rejects(shared.latest());
});

test('wide scanner: merges, ranks, caps at the limit, carries momentum for wide names', async () => {
  const c = clock(10_000_000);
  const tickers = [];
  for (let i = 0; i < 700; i++) {
    const sym = 'S' + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26) % 26) + String.fromCharCode(65 + Math.floor(i / 676));
    tickers.push(snap(sym, { p: 10 + (i % 50), prevC: 10, v: 200_000 + i * 1000, prevV: 1_000_000 }));
  }
  let price = 10;
  const snapshots = w.createSharedSnapshot({ snapshotAll: async () => tickers.map((t) => t.ticker === 'SAAA' ? { ...t, lastTrade: { p: price } } : t), now: c.now, session: () => 'regular' });
  let baseAsOf = 1;
  const base = async () => ({ asOf: baseAsOf, rows: [{ symbol: 'AAPL', name: 'Apple', price: 200, changePct: 1, volume: 5e7, previousVolume: 4e7 }] });
  const history = new Map();
  const windowChange = (p, list, at, ms) => { const before = list.filter((s) => s.t <= at - ms).at(-1); return before ? { percent: ((p - before.price) / before.price) * 100, windowSeconds: ms / 1000 } : { percent: null, windowSeconds: null }; };
  const scanner = w.createWideScanner({ snapshots, base, now: c.now, history, windowChange, state: () => ({ session: 'regular', open: true }) });
  const out = await scanner.get(500);
  assert.equal(out.source, 'wide');
  assert.equal(out.rows.length, 500);
  assert.equal(out.universe, 701);
  assert.ok(out.rows.some((r) => r.symbol === 'AAPL') || out.universe > 500);
  assert.deepEqual(out.rows.slice(0, 3).map((r) => r.liveRank), [1, 2, 3]);
  assert.ok(out.rows.every((r, i, a) => i === 0 || a[i - 1].liveScore >= r.liveScore));
  assert.equal((await scanner.get(10)).rows.length, 10);
  assert.equal((await scanner.get(100000)).rows.length, 500);
  assert.ok(history.has('SAAA') && !history.has('AAPL'));
  // four minutes later the price moved: wide names get a 3-minute rate
  c.add(240_000); price = 12; baseAsOf = 2;
  await snapshots.latest(); await new Promise((r) => setImmediate(r));
  const later = await scanner.get(500);
  const saaa = later.rows.find((r) => r.symbol === 'SAAA') || null;
  if (saaa) assert.equal(Math.round(saaa.changeRate3min), 20);
  assert.ok(history.get('SAAA').length >= 2);
  assert.ok(later.rows.some((r) => r.rankMove !== undefined));
});

test('wide scanner without a snapshot still ranks the site rows; with nothing at all it throws', async () => {
  const snapshots = { latest: async () => { throw new Error('down'); } };
  const scanner = w.createWideScanner({ snapshots, base: async () => ({ asOf: 1, rows: [{ symbol: 'A', price: 1, volume: 2, changePct: 1, previousVolume: 1 }] }), state: () => ({ session: 'closed' }) });
  const out = await scanner.get(250);
  assert.equal(out.partial, true);
  assert.equal(out.rows[0].liveRank, 1);
  const dead = w.createWideScanner({ snapshots, base: async () => { throw new Error('x'); }, state: () => ({ session: 'closed' }) });
  await assert.rejects(dead.get(250));
});
