'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSignalOutcomes, depthSignals, outcomePct } = require('./academy-signal-outcomes');

/* Tuesday 2026-10-20 09:35 New York = 13:35 UTC (the first minutes of the regular session) */
const OPEN = Date.parse('2026-10-20T13:35:00Z');
const MID = Date.parse('2026-10-20T15:00:00Z');

function fakePool() {
  const calls = []; let seq = 0; const rows = []; // rows: what was inserted, as the SELECTs will see them
  const flowDays = [];
  return {
    calls, rows, flowDays,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/^INSERT INTO academy_signal_outcomes/.test(sql)) { seq += 1; rows.push({ id: seq, symbol: params[0], t: params[1], family: params[2], signal: params[3], side: params[4], bucket: params[5], value: params[6], price0: params[7], features: JSON.parse(params[8]), outcome_1m_pct: null, outcome_5m_pct: null, outcome_15m_pct: null, outcome_1d_pct: null, outcome_3d_pct: null, outcome_5d_pct: null, settled_at: null }); return { rows: [], rowCount: 1 }; }
      if (/^SELECT 1 FROM academy_signal_outcomes/.test(sql)) return { rows: rows.filter((r) => r.symbol === params[0] && r.family === params[1] && r.t >= params[2]).slice(0, 1) };
      if (/^SELECT id, symbol/.test(sql)) return { rows: rows.filter((r) => r.family === params[0] && !r.settled_at && r.t <= params[1]).map((r) => ({ ...r })) };
      if (/^UPDATE academy_signal_outcomes SET/.test(sql)) { const r = rows.find((x) => x.id === params[0]); const sets = sql.replace(/^UPDATE academy_signal_outcomes SET /, '').replace(/ WHERE id = \$1$/, '').split(', '); for (const s of sets) { const [col, val] = s.split(' = '); if (val === 'now()') r.settled_at = Date.now(); else r[col] = params[Number(val.slice(1)) - 1]; } return { rows: [], rowCount: 1 }; }
      if (/FROM academy_flow_days/.test(sql)) return { rows: flowDays.filter((f) => f.symbol === params[0] && f.day > params[1]).sort((a, b) => (a.day < b.day ? -1 : 1)).slice(0, 5) };
      if (/GROUP BY signal, side, bucket/.test(sql) && /family = 'depth'/.test(sql)) return { rows: [{ signal: 'pressure', side: 'bull', bucket: 'strong', n: 40, outcome_1m_n: 38, outcome_1m_avg: '0.0210', outcome_1m_hit: '0.580', outcome_5m_n: 36, outcome_5m_avg: '0.0450', outcome_5m_hit: '0.611', outcome_15m_n: 30, outcome_15m_avg: '0.0300', outcome_15m_hit: '0.533' }] };
      if (/family = 'week'/.test(sql)) return { rows: [] };
      if (/kind = 'sweep'/.test(sql)) return { rows: [{ outcome: 'breakout_confirmed', side: 'bull', events: 12, measured: 11, avg_pct: '0.0900', hit_rate: '0.636' }] };
      return { rows: [], rowCount: 0 };
    }
  };
}
const reading = (o = {}) => ({ ready: true, book: { mid: o.mid || 100, microTilt: o.tilt || 0, spreadTicks: 1 }, pressure: { score: o.score || 0, label: 'x' }, flow: { divergence: o.div || null, priceChangePct: 0.2, cvdChange: -500, large: o.large || null, replenish: o.refill || null } });
const flowFor = (insights) => ({ engines: new Map(Object.keys(insights).map((s) => [s, {}])), insights: (s) => insights[s] || { ready: false } });

test('depthSignals: which signals a reading fires, with sides and bands', () => {
  assert.deepEqual(depthSignals({ ready: false }), []);
  const s = depthSignals(reading({ score: 63, tilt: -0.55, div: 'bearish', large: { n: 5, bias: -0.45, threshold: 500 }, refill: { bid: 0.4, ask: 2.1 } }));
  assert.deepEqual(s.map((x) => [x.signal, x.side, x.bucket]), [['pressure', 'bull', 'strong'], ['microprice', 'bear', 'strong'], ['divergence', 'bear', ''], ['large', 'bear', 'lean'], ['refill', 'bear', '']]);
  assert.deepEqual(depthSignals(reading({ score: 10, tilt: 0.1 })), [], 'quiet readings fire nothing');
  assert.equal(depthSignals(reading({ score: -30 }))[0].bucket, 'lean');
  assert.equal(outcomePct('bull', 100, 100.5), 0.5); assert.equal(outcomePct('bear', 100, 100.5), -0.5); assert.equal(outcomePct('bull', 0, 1), null);
});

test('sampling stamps a signal once per cooldown, a divergence only when it appears, and the outcomes are filled in at 1, 5 and 15 minutes from the mid then', async () => {
  const pool = fakePool();
  let clock = MID; const ins = { SPY: reading({ score: 45, mid: 100 }) };
  const so = createSignalOutcomes({ pool, orderFlow: flowFor(ins), now: () => clock });
  let r = await so.tick();
  assert.equal(r.sampled, 1); assert.deepEqual([pool.rows[0].signal, pool.rows[0].side, pool.rows[0].bucket, pool.rows[0].price0, pool.rows[0].value], ['pressure', 'bull', 'firm', 100, 45]);
  ins.SPY = reading({ score: 45, mid: 100.2 }); clock += 60_000; r = await so.tick();
  assert.equal(r.sampled, 0, 'still firm bullish pressure inside the cooldown: no second row');
  // a divergence appears: one row; it stays: no more rows; it flips: a new row
  ins.SPY = reading({ score: 45, mid: 100.2, div: 'bullish' }); clock += 60_000; r = await so.tick();
  assert.equal(pool.rows.filter((x) => x.signal === 'divergence').length, 1);
  clock += 60_000; await so.tick(); assert.equal(pool.rows.filter((x) => x.signal === 'divergence').length, 1);
  ins.SPY = reading({ score: 45, mid: 100.2, div: 'bearish' }); clock += 60_000; await so.tick();
  assert.equal(pool.rows.filter((x) => x.signal === 'divergence').length, 2);
  // outcomes: the first pressure row was stamped at MID with mid 100; five minutes later the mid is 100.2 -> +0.2% its way
  const first = pool.rows[0];
  assert.equal(first.outcome_1m_pct, 0.2, 'one minute later the mid was 100.2: ' + JSON.stringify(first));
  assert.equal(first.outcome_5m_pct, null, 'five minutes have not passed');
  clock = MID + 5 * 60_000 + 1000; ins.SPY = reading({ score: 45, mid: 100.5, div: 'bearish' }); await so.tick();
  assert.equal(pool.rows[0].outcome_5m_pct, 0.5);
  clock = MID + 15 * 60_000 + 1000; ins.SPY = reading({ score: 45, mid: 99.0, div: 'bearish' }); await so.tick();
  assert.equal(pool.rows[0].outcome_15m_pct, -1); assert.ok(pool.rows[0].settled_at, 'closed once the 15-minute mark is filled');
  assert.ok(so.status().sampled >= 3 && so.status().settled >= 1);
  // a bearish signal is scored the other way
  const bear = pool.rows.find((x) => x.signal === 'divergence' && x.side === 'bear');
  assert.ok(bear.outcome_1m_pct != null && bear.outcome_1m_pct < 0, 'price rose after the bearish divergence: a negative (wrong) outcome: ' + bear.outcome_1m_pct);
});

test('a row whose symbol dropped off the poll is closed after half an hour with the horizons it got; a closed market samples nothing', async () => {
  const pool = fakePool();
  let clock = MID; const ins = { NVDA: reading({ score: -70, mid: 500 }) };
  const so = createSignalOutcomes({ pool, orderFlow: flowFor(ins), now: () => clock });
  await so.tick();
  delete ins.NVDA; // nobody is looking at it any more
  const of2 = flowFor({ SPY: reading({ score: 0 }) }); so.stop();
  const so2 = createSignalOutcomes({ pool, orderFlow: of2, now: () => clock });
  clock += 31 * 60_000; await so2.tick();
  assert.ok(pool.rows[0].settled_at, 'closed'); assert.equal(pool.rows[0].outcome_5m_pct, null, 'no mid was available to score it');
  const sat = createSignalOutcomes({ pool: fakePool(), orderFlow: flowFor({ SPY: reading({ score: 90 }) }), now: () => Date.parse('2026-10-24T15:00:00Z') });
  assert.deepEqual(await sat.tick(), { sampled: 0, settled: 0 });
  const off = createSignalOutcomes({});
  assert.equal(off.configured, false); assert.equal(off.start(), false); assert.equal((await off.summary()).ok, false);
});

test('the week read is sampled once a day in the first minutes of the session when its score is firm, and scored off the ledger 1, 3 and 5 trading days later', async () => {
  const pool = fakePool();
  let clock = OPEN;
  const flowDaily = { summary: async () => ({ ok: true, window: { available: true, days: 5, score: 58, label: 'strong accumulation', divergence: 'bullish', instShare: 0.4 } }) };
  const so = createSignalOutcomes({ pool, orderFlow: flowFor({ SPY: reading({ score: 0, mid: 400 }) }), flowDaily, now: () => clock });
  let r = await so.tick();
  assert.equal(r.sampled, 1); const w = pool.rows.find((x) => x.family === 'week');
  assert.deepEqual([w.signal, w.side, w.bucket, w.value, w.price0, w.features.label], ['week', 'bull', 'strong', 58, 400, 'strong accumulation']);
  clock += 60_000; r = await so.tick(); assert.equal(pool.rows.filter((x) => x.family === 'week').length, 1, 'once a day');
  // too late in the session: no sample for another symbol
  const late = createSignalOutcomes({ pool, orderFlow: flowFor({ QQQ: reading({ score: 0, mid: 300 }) }), flowDaily, now: () => OPEN + 3 * 3600_000 });
  await late.tick(); assert.equal(pool.rows.filter((x) => x.family === 'week').length, 1);
  // days later the ledger has closes: +1%, +2%, +3% ... -> outcomes signed bull
  pool.flowDays.push({ symbol: 'SPY', day: '2026-10-21', last_px: 404 }, { symbol: 'SPY', day: '2026-10-22', last_px: 410 }, { symbol: 'SPY', day: '2026-10-23', last_px: 412 });
  clock = OPEN + 2 * 86_400_000; await so.tick();
  assert.equal(w.outcome_1d_pct, 1); assert.equal(w.outcome_3d_pct, 3); assert.equal(w.outcome_5d_pct, null); assert.equal(w.settled_at, null);
  pool.flowDays.push({ symbol: 'SPY', day: '2026-10-26', last_px: 420 }, { symbol: 'SPY', day: '2026-10-27', last_px: 396 });
  clock = OPEN + 8 * 86_400_000; await so.tick();
  assert.equal(w.outcome_5d_pct, -1); assert.ok(w.settled_at);
});

test('the summary shapes hit rates per signal, side and band, carries the sweep-versus-wall outcomes, and is cached', async () => {
  const pool = fakePool();
  const so = createSignalOutcomes({ pool, orderFlow: flowFor({}), now: () => MID });
  const s = await so.summary(30);
  assert.equal(s.ok, true); assert.equal(s.days, 30);
  assert.deepEqual(s.depth[0], { signal: 'pressure', side: 'bull', bucket: 'strong', n: 40, horizons: { outcome_1m: { measured: 38, hitRate: 0.58, avgPct: 0.021 }, outcome_5m: { measured: 36, hitRate: 0.611, avgPct: 0.045 }, outcome_15m: { measured: 30, hitRate: 0.533, avgPct: 0.03 } } });
  assert.deepEqual(s.sweeps[0], { outcome: 'breakout_confirmed', side: 'bull', events: 12, measured: 11, hitRate: 0.636, avgPct: 0.09 });
  const before = pool.calls.length; await so.summary(30); assert.equal(pool.calls.length, before, 'cached');
  assert.match(pool.calls.find((c) => /kind = 'sweep'/.test(c.sql)).sql, /features->>'outcome'/);
});
