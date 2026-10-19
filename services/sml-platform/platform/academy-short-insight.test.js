'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./academy-short-insight');

const DAY = 86_400_000;
/* weekdays only, from a start date, with a price path */
function bars(start, n, step) { const out = []; let px = 100, t = Date.parse(start + 'T21:00:00Z'); for (let i = 0; out.length < n; i++) { const d = new Date(t + i * DAY); if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue; px *= 1 + step(out.length); out.push({ t: t + i * DAY, o: px * 0.999, h: px * 1.006, l: px * 0.994, c: px, v: 1e6 }); } return out; }
const dates = (list) => list.map((b) => new Date(b.t).toISOString().slice(0, 10));

test('short volume against the price: pressing on down days, absorbed on up days, with a correlation and a trend', () => {
  const down = bars('2026-09-01', 30, (i) => (i >= 20 ? -0.012 : 0.001)), dd = dates(down);
  const vol = dd.slice(-10).map((date, i) => ({ date, ratio: 40 + i * 2.5, short: 1e6, total: 2e6 })); // short ratio rising while the stock falls
  const pressing = S.shortVsPrice(vol, down);
  assert.equal(pressing.tone, 'down'); assert.match(pressing.label, /pressing/); assert.ok(pressing.downOnHigh >= 3); assert.ok(pressing.trendPts > 0); assert.equal(pressing.days.length, 10); assert.equal(typeof pressing.corr, 'number', 'a correlation is reported once five days pair up');
  const up = bars('2026-09-01', 30, (i) => (i >= 20 ? 0.012 : 0.001)), du = dates(up);
  const absorbed = S.shortVsPrice(du.slice(-10).map((date, i) => ({ date, ratio: 50 + i, short: 1e6, total: 2e6 })), up);
  assert.equal(absorbed.tone, 'up'); assert.match(absorbed.label, /absorbed/); assert.ok(absorbed.upOnHigh >= 3);
  const quiet = S.shortVsPrice(du.slice(-10).map((date) => ({ date, ratio: 35, short: 1e6, total: 3e6 })), up);
  assert.equal(quiet.tone, 'neutral'); assert.equal(quiet.label, 'ordinary short volume');
  assert.equal(S.shortVsPrice([], []).label, 'not enough days'); assert.equal(S.shortVsPrice(vol, []).days[0].retPct, null, 'no candles: ratios alone');
});

test('short interest across settlements against the price: pressing, fighting the tape, a squeeze that ran, profit taking', () => {
  const falling = bars('2026-07-01', 70, () => -0.004), rising = bars('2026-07-01', 70, () => 0.004), d = dates(falling);
  const rows = (a, b) => [{ date: d[5], short_interest: a, avg_daily_volume: 1e6, days_to_cover: a / 1e6 }, { date: d[40], short_interest: (a + b) / 2, avg_daily_volume: 1e6, days_to_cover: 2 }, { date: d[65], short_interest: b, avg_daily_volume: 1e6, days_to_cover: b / 1e6 }];
  assert.equal(S.interestTrend(rows(5e6, 6e6), falling).tone, 'down'); assert.match(S.interestTrend(rows(5e6, 6e6), falling).label, /pressing/);
  const fight = S.interestTrend(rows(5e6, 6e6), rising); assert.equal(fight.tone, 'up'); assert.match(fight.label, /fighting the tape/); assert.equal(fight.siChangePct, 20); assert.ok(fight.priceChangePct > 3);
  assert.match(S.interestTrend(rows(6e6, 5e6), rising).label, /squeeze has been running/); assert.match(S.interestTrend(rows(6e6, 5e6), falling).label, /taking profits/);
  assert.equal(S.interestTrend(rows(5e6, 5.1e6), rising).label, 'short interest steady'); assert.equal(S.interestTrend([], rising), null);
  assert.equal(S.interestTrend([{ date: '2026-09-30', days_to_cover: 4.2 }], []).daysToCover, 4.2, 'days to cover alone is still a row');
});

test('scores and verdicts: a crowded short being bought reads as squeeze risk; a weak tape with sellers in control reads as press', () => {
  const up = bars('2026-08-01', 40, (i) => (i >= 30 ? 0.02 : 0.001)), du = dates(up);
  const svpUp = S.shortVsPrice(du.slice(-10).map((date, i) => ({ date, ratio: 52 + i })), up), itUp = { daysToCover: 7, tone: 'up', label: 'fighting the tape' };
  const depthBull = { ready: true, pressure: { score: 60, label: 'strong buying pressure' }, walls: [{ side: 'bid' }, { side: 'bid' }], flow: { divergence: 'bullish' } };
  const tapeBull = { count: 400, buy: 7e6, sell: 3e6, vol: 1.1e7, offVol: 4e6, offBuy: 3e6, offSell: 1e6, sweepN: 6, sweepBuy: 5, sweepSell: 1 };
  const sq = S.scores({ svp: svpUp, it: itUp, bars: up, depth: depthBull, l2: { ready: true, absorption: { state: 'bull', strength: 0.8 } }, tape: tapeBull, flowDays: { available: true, days: 4, score: 55, label: 'bullish week' }, chain: { putCallOi: 1.6, putCallVol: 1.2 } });
  assert.ok(sq.squeeze.score >= 75, 'squeeze ' + sq.squeeze.score); assert.ok(sq.pressing.score <= 35, 'pressing ' + sq.pressing.score);
  assert.ok(sq.squeeze.components.some((c) => c.key === 'breakout' && c.pts === 15)); assert.ok(sq.pressing.components.some((c) => c.key === 'breakout' && c.pts === -15), 'a breakout counts against the shorts');
  const v = S.verdicts(sq, { it: itUp, mem: { mode: 'short', latest: null } });
  assert.match(v.shortSeller.call, /stand aside/); assert.match(v.shortSeller.call, /no signal on the chart/); assert.match(v.long.call, /squeeze candidate/); assert.ok(v.long.reasons.length >= 3); assert.match(v.long.invalidation, /20-day low/);
  const down = bars('2026-08-01', 40, (i) => (i >= 30 ? -0.02 : 0.001)), dd = dates(down);
  const svpDown = S.shortVsPrice(dd.slice(-10).map((date, i) => ({ date, ratio: 48 + i })), down);
  const pr = S.scores({ svp: svpDown, it: { daysToCover: 1.8, tone: 'down', label: 'pressing' }, bars: down, depth: { ready: true, pressure: { score: -55, label: 'strong selling pressure' }, walls: [{ side: 'ask' }, { side: 'ask' }], flow: { divergence: 'bearish' } }, tape: { count: 400, buy: 2e6, sell: 8e6, vol: 1e7, offVol: 1e6, offBuy: 3e5, offSell: 7e5, sweepN: 5, sweepBuy: 0, sweepSell: 5 }, flowDays: { available: true, days: 3, score: -40, label: 'bearish week' }, chain: { putCallOi: 0.7 } });
  assert.ok(pr.pressing.score >= 75, 'pressing ' + pr.pressing.score); assert.ok(pr.squeeze.score <= 30, 'squeeze ' + pr.squeeze.score);
  const v2 = S.verdicts(pr, { it: { daysToCover: 1.8 }, mem: { mode: 'short', latest: { dir: -1, conf: { grade: 'A' } } } });
  assert.match(v2.shortSeller.call, /^press/); assert.match(v2.shortSeller.call, /open SELL \(grade A\)/); assert.match(v2.long.call, /not a squeeze/);
  const bare = S.scores({ svp: null, it: null, bars: [], depth: null, l2: null, tape: null, flowDays: null, chain: null });
  assert.equal(bare.pressing.score, null); assert.equal(bare.squeeze.score, null); assert.match(S.verdicts(bare, {}).shortSeller.call, /wait/);
});

test('the chain summary and the service: inputs gathered in parallel, missing ones tolerated, cached a minute', async () => {
  const rows = [{ expiry: '2026-11-20', strike: 100, call: { oi: 1000, volume: 200, iv: 0.4 }, put: { oi: 1500, volume: 300, iv: 0.5 } }, { expiry: '2026-11-20', strike: 105, call: { oi: 500, volume: 100, iv: 0.38 }, put: { oi: 700, volume: 50, iv: 0.52 } }];
  const c = S.chainSummary(rows); assert.equal(c.putCallOi, 1.47); assert.equal(c.putCallVol, 1.17); assert.equal(c.putSkewPts, 12); assert.equal(S.chainSummary([]), null);
  let calls = 0, clock = 1_800_000_000_000;
  const up = bars('2026-08-01', 40, (i) => (i >= 30 ? 0.02 : 0.001)), du = dates(up);
  const svc = S.createShortInsight({ shortData: async () => { calls += 1; return { volume: du.slice(-10).map((date, i) => ({ date, ratio: 52 + i, short: 1e6, total: 2e6 })), interest: [{ date: du[10], short_interest: 5e6, days_to_cover: 4 }, { date: du[35], short_interest: 6e6, days_to_cover: 6 }] }; },
    candles: async () => ({ bars: up }), orderFlow: () => ({ ready: true, absorption: { state: 'bull', strength: 0.5 }, depth: { ready: true, pressure: { score: 40, label: 'buying pressure' }, walls: [], flow: { divergence: null } } }), tape: () => ({ stats: { count: 100, buy: 5e5, sell: 3e5, vol: 9e5, offVol: 1e5, offBuy: 6e4, offSell: 4e4, sweepN: 1, sweepBuy: 1, sweepSell: 0 } }),
    flowDays: async () => { throw new Error('db down'); }, chain: async () => rows, memAlgo: () => ({ bias: 'bear', latest: null }), now: () => clock, logger: () => {} });
  const out = await svc.insight('acme');
  assert.equal(out.ok, true); assert.equal(out.symbol, 'ACME'); assert.deepEqual(out.sources, { short: true, candles: true, level3: true, level2: true, tape: true, flowDays: false, chain: true, float: false, gamma: false, sentiment: false, intent: false, earnings: false });
  assert.ok(out.model && out.model.score != null && out.model.fuel && out.model.spark && out.model.qstate, 'the rebuilt squeeze model rides along'); assert.equal(out.squeeze.score, out.model.score); assert.equal(out.brief.available, false);
  assert.ok(out.squeeze.score > out.pressing.score); assert.equal(out.interest.daysToCover, 6); assert.equal(out.chain.putCallOi, 1.47); assert.equal(out.tape.buy, 5e5); assert.equal(out.mem, null, 'the short model needs 220 daily bars');
  await svc.insight('ACME'); assert.equal(calls, 1, 'cached'); clock += 61_000; await svc.insight('ACME'); assert.equal(calls, 2);
  assert.equal((await svc.insight('bad!')).error, 'invalid_symbol');
  /* the sweep's read skips the AI brief and is cached on its own key; a fresh full read serves it too */
  const c3 = calls; const nb = await svc.insight('ACME', { brief: false }); assert.equal(nb.brief.available, false); assert.equal(calls, c3, 'the fresh full read is reused');
  clock += 61_000; const nb2 = await svc.insight('ACME', { brief: false }); assert.equal(nb2.brief.reason, 'skipped'); assert.equal(calls, c3 + 1); await svc.insight('ACME', { brief: false }); assert.equal(calls, c3 + 1, 'cached');
  const withBrief = await svc.insight('ACME'); assert.equal(calls, c3 + 2, 'the panel read is its own build'); assert.equal(withBrief.brief.available, false);
  /* the QUICK read: the fuel block from the short feed and the float alone, cached ten times longer */
  const before = calls;
  const q = await svc.quick('acme');
  assert.equal(q.ok, true); assert.equal(q.available, true); assert.equal(q.symbol, 'ACME'); assert.ok(Number.isFinite(q.fuel), 'fuel ' + q.fuel); assert.equal(q.daysToCover, 6); assert.equal(q.shortInterest, 6e6); assert.equal(q.floatShares, null, 'no float source here');
  assert.ok(calls >= before, 'the short feed is read'); const c2 = calls; await svc.quick('ACME'); assert.equal(calls, c2, 'cached');
  assert.equal((await svc.quick('bad!')).error, 'invalid_symbol');
  assert.equal((await S.createShortInsight({ shortData: async () => null, logger: () => {} }).quick('ZZZZ')).available, false);
  const none = S.createShortInsight({ shortData: async () => null, logger: () => {} });
  assert.equal((await none.insight('ZZZZ')).available, false);
});
