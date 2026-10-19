'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createFlowDaily, dayKey, LARGE_SHARES } = require('./academy-flow-daily');
const FR = require('./academy-flow-read');

/* Tuesday 2026-10-20 14:30 New York = 18:30 UTC: the regular session */
const T0 = Date.parse('2026-10-20T18:30:00Z');

function fakePool() {
  const calls = [];
  let rows = [];
  return {
    calls, setRows: (r) => { rows = r; },
    query: async (sql, params) => { calls.push({ sql, params }); if (/^SELECT \* FROM academy_flow_days/.test(sql)) return { rows }; if (/^INSERT INTO academy_flow_days \(symbol, day, tape_source, buy_vol, sell_vol, neu_vol, prints, notional, large_buy, large_sell, large_n, hi, lo, last_px\)/.test(sql)) return { rowCount: 3 }; return { rows: [], rowCount: 1 }; }
  };
}
const upserts = (pool) => pool.calls.filter((c) => /^INSERT INTO academy_flow_days \(symbol, day, tape_source, buy_vol/.test(c.sql) && c.params.length > 3);
const row = (pool, i = -1) => { const u = upserts(pool); const c = u[i < 0 ? u.length + i : i]; const p = c.params; return { symbol: p[0], day: p[1], source: p[2], buy: p[3], sell: p[4], neu: p[5], prints: p[6], notional: p[7], largeBuy: p[8], largeSell: p[9], largeN: p[10], sweepBuy: p[11], sweepSell: p[12], blockBuy: p[13], blockSell: p[14], offVol: p[15], pSum: p[16], pN: p[17], bullMin: p[18], bearMin: p[19], evBull: p[20], evBear: p[21], hi: p[22], lo: p[23], last: p[24] }; };

function engine(prints, events = []) { return { prints, flow: { events: () => events } }; }
function orderFlowFor(engines, insights) { return { engines: new Map(Object.entries(engines)), insights: (s) => (insights && insights[s]) || { ready: false } }; }

test('a fold adds the moomoo prints since the last fold (this day only), the large prints, the pressure sample and the events, then moves the marks', async () => {
  const pool = fakePool();
  let clock = T0;
  const prints = [
    { t: T0 - 90_000, price: 100, size: 200, dir: 'B' }, { t: T0 - 60_000, price: 100.1, size: 1500, dir: 'S' }, { t: T0 - 30_000, price: 100.05, size: 300, dir: 'N' },
    { t: T0 - 20_000, price: 100.2, size: 600, dir: 'B' }, { t: T0 - 86_400_000, price: 99, size: 5000, dir: 'B' } // yesterday's print never counts today
  ];
  const events = [{ t: T0 - 50_000, kind: 'absorb', side: 'bull' }, { t: T0 - 10_000, kind: 'stack', side: 'bear' }];
  const of = orderFlowFor({ SPY: engine(prints, events) }, { SPY: { ready: true, pressure: { score: 52 } } });
  const fd = createFlowDaily({ pool, now: () => clock, orderFlow: of });
  assert.deepEqual(await fd.tick(), ['SPY']);
  const r = row(pool);
  assert.equal(r.day, '2026-10-20'); assert.equal(r.source, 'moomoo');
  assert.deepEqual([r.buy, r.sell, r.neu, r.prints], [800, 1500, 300, 4]);
  assert.equal(r.notional, Math.round(100 * 200 + 100.1 * 1500 + 100.05 * 300 + 100.2 * 600));
  assert.deepEqual([r.largeBuy, r.largeSell, r.largeN], [600, 1500, 2], 'the 1,500-share sell and the $60,120 buy are large');
  assert.deepEqual([r.pSum, r.pN, r.bullMin, r.bearMin], [52, 1, 1, 0]);
  assert.deepEqual([r.evBull, r.evBear], [1, 1]);
  assert.deepEqual([r.hi, r.lo, r.last], [100.2, 100, 100.2]);
  // the next fold only sees what is new
  clock += 60_000;
  prints.push({ t: clock - 5_000, price: 100.3, size: 100, dir: 'B' });
  events.push({ t: clock - 4_000, kind: 'flip', side: 'bull' });
  await fd.tick();
  const r2 = row(pool);
  assert.deepEqual([r2.buy, r2.sell, r2.prints, r2.evBull, r2.evBear, r2.last], [100, 0, 1, 1, 0, 100.3]);
  assert.equal(upserts(pool).length, 2);
  // nothing new and no pressure: no write
  const quiet = createFlowDaily({ pool: fakePool(), now: () => clock, orderFlow: orderFlowFor({ SPY: engine([]) }) });
  assert.deepEqual(await quiet.tick(), []);
});

test('the Massive stream is the tape when it is watched: deltas between folds, a reset counts whole, and totals from before today are skipped on the first look', async () => {
  const pool = fakePool();
  let clock = T0;
  const stats = { since: T0 - 3_600_000, count: 1000, buy: 60_000, sell: 40_000, neu: 5_000, vol: 105_000, vwap: 100, offVol: 9_000, sweepBuy: 3_000, sweepSell: 1_000, blockBuy: 20_000, blockSell: 0 };
  const massive = { peek: () => ({ stats }) };
  const of = orderFlowFor({ SPY: engine([{ t: T0 - 1000, price: 100, size: 2000, dir: 'S' }]) });
  const fd = createFlowDaily({ pool, now: () => clock, orderFlow: of, massive });
  await fd.tick();
  let r = row(pool);
  assert.equal(r.source, 'massive');
  assert.deepEqual([r.buy, r.sell, r.neu, r.prints, r.offVol, r.sweepBuy, r.blockBuy], [60_000, 40_000, 5_000, 1000, 9_000, 3_000, 20_000], 'the stream opened today, so its totals count whole on the first look');
  assert.deepEqual([r.largeSell, r.largeN], [2000, 1], 'large prints still come from the moomoo prints');
  clock += 60_000;
  Object.assign(stats, { count: 1200, buy: 70_000, sell: 42_000, neu: 5_000, vol: 117_000, offVol: 9_500, sweepBuy: 3_000, sweepSell: 2_000 });
  await fd.tick();
  r = row(pool);
  assert.deepEqual([r.buy, r.sell, r.prints, r.offVol, r.sweepSell], [10_000, 2_000, 200, 500, 1_000], 'only the growth since the last fold');
  clock += 60_000;
  Object.assign(stats, { since: clock - 10_000, count: 50, buy: 3_000, sell: 1_000, neu: 0, vol: 4_000, offVol: 0, sweepBuy: 0, sweepSell: 0, blockBuy: 0, blockSell: 0 });
  await fd.tick();
  r = row(pool);
  assert.deepEqual([r.buy, r.sell, r.prints], [3_000, 1_000, 50], 'a reset stream counts whole again');
  // a stream that opened yesterday: its first look is skipped (the moomoo prints carry the fold), the second look is a delta
  const pool2 = fakePool(); const st2 = { since: T0 - 30 * 3_600_000, count: 9000, buy: 500_000, sell: 400_000, neu: 0, vol: 900_000, vwap: 100, offVol: 0, sweepBuy: 0, sweepSell: 0, blockBuy: 0, blockSell: 0 };
  const fd2 = createFlowDaily({ pool: pool2, now: () => clock, orderFlow: orderFlowFor({ SPY: engine([{ t: clock - 500, price: 100, size: 10, dir: 'B' }]) }), massive: { peek: () => ({ stats: st2 }) } });
  await fd2.tick();
  assert.equal(row(pool2).source, 'moomoo'); assert.equal(row(pool2).buy, 10);
  clock += 60_000; st2.count = 9100; st2.buy = 505_000;
  await fd2.tick();
  assert.equal(row(pool2).source, 'massive'); assert.equal(row(pool2).buy, 5_000);
});

test('institutional net is refreshed every half hour and replaces, never adds; a closed market folds nothing; bad symbols are refused', async () => {
  const pool = fakePool();
  let clock = T0, calls = 0;
  const institutional = { get: async () => { calls += 1; return { capital: { institutionalNet: 1_250_000 * calls, retailNet: -300_000 } }; } };
  const of = orderFlowFor({ SPY: engine([{ t: T0 - 1000, price: 100, size: 10, dir: 'B' }]) });
  const fd = createFlowDaily({ pool, now: () => clock, orderFlow: of, institutional });
  await fd.tick();
  const inst = pool.calls.filter((c) => /inst_net, retail_net/.test(c.sql));
  assert.equal(inst.length, 1); assert.deepEqual(inst[0].params, ['SPY', '2026-10-20', 1_250_000, -300_000]);
  assert.match(inst[0].sql, /DO UPDATE SET inst_net = EXCLUDED.inst_net/);
  clock += 10 * 60_000; await fd.tick();
  assert.equal(calls, 1, 'not asked again inside the half hour');
  clock += 25 * 60_000; await fd.tick();
  assert.equal(calls, 2);
  // Saturday: nothing
  const sat = createFlowDaily({ pool: fakePool(), now: () => Date.parse('2026-10-24T18:30:00Z'), orderFlow: of });
  assert.deepEqual(await sat.tick(), []);
  await assert.rejects(() => fd.summary('../x'), /invalid_symbol/);
  assert.equal(dayKey(Date.parse('2026-10-20T03:30:00Z')), '2026-10-19', 'a New York day, not a UTC one');
  const off = createFlowDaily({});
  assert.equal(off.configured, false); assert.equal(off.start(), false); assert.deepEqual(await off.tick(), []);
  assert.equal((await off.summary('SPY')).ok, false);
});

test('summary reads the window oldest first, marks today partial during a session, and backfill aggregates the recorded prints for past days only', async () => {
  const pool = fakePool();
  const fd = createFlowDaily({ pool, now: () => T0, orderFlow: orderFlowFor({}) });
  pool.setRows([
    { symbol: 'SPY', day: '2026-10-20', tape_source: 'massive', buy_vol: 500, sell_vol: 300, neu_vol: 0, prints: 10, notional: 80_000, large_buy: 0, large_sell: 0, large_n: 0, sweep_buy: 0, sweep_sell: 0, block_buy: 0, block_sell: 0, off_vol: 0, hi: 101, lo: 99, last_px: 100.5, pressure_sum: 80, pressure_n: 2, bull_minutes: 1, bear_minutes: 0, ev_bull: 1, ev_bear: 0, inst_net: 1000, retail_net: -500 },
    { symbol: 'SPY', day: new Date('2026-10-19T00:00:00Z'), tape_source: 'moomoo', buy_vol: 200, sell_vol: 600, neu_vol: 0, prints: 8, notional: 79_000, large_buy: 100, large_sell: 900, large_n: 3, sweep_buy: 0, sweep_sell: 0, block_buy: 0, block_sell: 0, off_vol: 0, hi: 100, lo: 98, last_px: 99, pressure_sum: -60, pressure_n: 1, bull_minutes: 0, bear_minutes: 1, ev_bull: 0, ev_bear: 2, inst_net: null, retail_net: null }
  ]);
  const s = await fd.summary('spy', 5);
  assert.equal(s.ok, true); assert.deepEqual(s.days.map((d) => d.day), ['2026-10-19', '2026-10-20'], 'oldest first');
  assert.equal(s.days[1].partial, true, 'today, during the session'); assert.equal(s.days[0].partial, false);
  assert.equal(s.days[0].deltaRatio, -0.5); assert.equal(s.days[1].cvd, -200, 'running CVD: -400 then +200');
  assert.equal(s.window.days, 2); assert.ok(Number.isFinite(s.window.score));
  assert.equal(pool.calls[0].params[1], 5);
  const n = await fd.backfill('QQQ', 30);
  assert.equal(n, 3);
  const bf = pool.calls[pool.calls.length - 1];
  assert.deepEqual(bf.params, ['QQQ', '30']);
  assert.match(bf.sql, /jsonb_array_elements\(s\.prints\)/); assert.match(bf.sql, /ON CONFLICT \(symbol, day\) DO NOTHING/); assert.match(bf.sql, /day < \(now\(\) AT TIME ZONE 'America\/New_York'\)::date/);
  assert.match(bf.sql, new RegExp('size >= ' + LARGE_SHARES));
});

/* ---------- the reading (academy-flow-read.js) ---------- */
const dayRow = (day, buy, sell, extra = {}) => ({ day, tape_source: 'massive', buy_vol: buy, sell_vol: sell, neu_vol: 0, prints: 100, notional: (buy + sell) * (extra.px || 100), large_buy: extra.lb || 0, large_sell: extra.ls || 0, large_n: (extra.lb || 0) + (extra.ls || 0) > 0 ? 5 : 0, sweep_buy: extra.sb || 0, sweep_sell: extra.ss || 0, block_buy: 0, block_sell: 0, off_vol: 0, hi: (extra.px || 100) + 1, lo: (extra.px || 100) - 1, last_px: extra.px || 100, pressure_sum: extra.p != null ? extra.p : 0, pressure_n: extra.p != null ? 1 : 0, bull_minutes: 0, bear_minutes: 0, ev_bull: 0, ev_bear: 0, inst_net: extra.inst == null ? null : extra.inst, retail_net: extra.inst == null ? null : -extra.inst / 2 });

test('the window: distribution shows as net selling, a bearish divergence when price still rose, and the score, label and lines follow', () => {
  const rows = [dayRow('2026-10-13', 400_000, 600_000, { px: 100, lb: 20_000, ls: 60_000, p: -30, inst: -2_000_000 }), dayRow('2026-10-14', 450_000, 650_000, { px: 101, lb: 10_000, ls: 50_000, p: -45, inst: -1_500_000 }),
    dayRow('2026-10-15', 500_000, 500_000, { px: 102, p: 5 }), dayRow('2026-10-16', 400_000, 700_000, { px: 103, lb: 5_000, ls: 70_000, p: -50, inst: -3_000_000 }), dayRow('2026-10-17', 420_000, 600_000, { px: 104, p: -20 })];
  const w = FR.readWindow(rows, { symbol: 'XYZ' });
  assert.equal(w.window.days, 5); assert.equal(w.window.cvd, -880_000); assert.equal(w.window.down, 4); assert.equal(w.window.up, 0);
  assert.equal(w.window.priceChangePct, 4); assert.equal(w.window.divergence, 'bearish');
  assert.ok(w.window.largeBias < -0.5 && w.window.instShare < -0.5 && w.window.pressureAvg < -20);
  assert.ok(w.window.score <= -50, 'strong distribution: ' + w.window.score); assert.equal(w.window.label, 'strong distribution');
  assert.ok(w.window.lines.some((l) => /bearish divergence/.test(l)) && w.window.lines.some((l) => /institutions net selling/.test(l)));
  assert.equal(w.days[0].vwap, 100); assert.equal(w.days[1].large.bias, -0.67);
  // the mirror reads as accumulation with a bullish divergence
  const up = rows.map((r) => ({ ...r, buy_vol: r.sell_vol, sell_vol: r.buy_vol, large_buy: r.large_sell, large_sell: r.large_buy, pressure_sum: -r.pressure_sum, inst_net: r.inst_net == null ? null : -r.inst_net, retail_net: r.retail_net == null ? null : -r.retail_net, last_px: 200 - r.last_px }));
  const u = FR.readWindow(up); assert.equal(u.window.divergence, 'bullish'); assert.ok(u.window.score >= 50);
  assert.deepEqual(FR.readWindow([]).window, { days: 0, available: false, reason: 'no_days' });
});

test('week read: a swing exits on a week firmly against it, a mid hold trims, a long hold holds through less than four things, a day trade only reads context', () => {
  const rows = [dayRow('2026-10-13', 400_000, 600_000, { px: 100, lb: 20_000, ls: 60_000, p: -30, inst: -2_000_000 }), dayRow('2026-10-14', 450_000, 650_000, { px: 101, lb: 10_000, ls: 50_000, p: -45, inst: -1_500_000 }),
    dayRow('2026-10-15', 500_000, 500_000, { px: 102, p: 5 }), dayRow('2026-10-16', 400_000, 700_000, { px: 103, lb: 5_000, ls: 70_000, p: -50, inst: -3_000_000 }), dayRow('2026-10-17', 420_000, 600_000, { px: 104, p: -20 })];
  const w = FR.readWindow(rows);
  const swing = FR.weekRead('swing', 1, w); assert.equal(swing.verdict, 'exit'); assert.ok(swing.against >= 3); assert.ok(swing.reasons.some((r) => /rise is being sold into/.test(r.text)));
  assert.equal(FR.weekRead('mid', 1, w).verdict, 'trim');
  const long = FR.weekRead('long', 1, w); assert.ok(['hold', 'trim'].includes(long.verdict)); assert.match(long.note, /never exits/);
  const day = FR.weekRead('day', 1, w); assert.equal(day.verdict, 'hold'); assert.match(day.note, /context/);
  const short = FR.weekRead('short', -1, w); assert.equal(short.against, 0); assert.ok(short.withCount >= 3);
  const shortSwing = FR.weekRead('swing', -1, w); assert.equal(shortSwing.verdict, 'add', 'the same week is an add for a short swing');
  assert.equal(FR.weekRead('swing', 1, FR.readWindow([rows[0]])).verdict, 'none', 'one day is not a week');
  assert.equal(FR.weekRead('swing', 1, null).verdict, 'none');
});
