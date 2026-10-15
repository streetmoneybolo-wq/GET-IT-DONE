'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pb = require('./academy-earnings-playbook');

const NOW = Date.UTC(2026, 9, 14, 14, 0, 0); // 2026-10-14
const D = 86_400_000;
const day = (n) => new Date(NOW + n * D).toISOString().slice(0, 10);
/* 300 daily bars ending yesterday, flat at $100 with a 1.5% range, and two past-report jumps */
function bars(jumps = {}) {
  const out = []; let c = 100;
  for (let i = 299; i >= 0; i--) {
    const t = NOW - i * D, d = new Date(t).toISOString().slice(0, 10);
    const j = jumps[d] || 0; const o = c, close = c * (1 + j); c = close;
    out.push({ t, o, h: Math.max(o, close) * 1.008, l: Math.min(o, close) * 0.992, c: close, v: 2_000_000 });
  }
  return out;
}
const chain = (price, exps, straddlePct) => exps.flatMap((exp) => [-10, -5, 0, 5, 10].map((k) => { const strike = Math.round(price * (1 + k / 100)); const half = (price * straddlePct / 100) / 2; const dist = Math.abs(strike - price) / price; const c = Math.max(0.1, half - dist * price * 0.6), p = Math.max(0.1, half - dist * price * 0.6); return { strike, expiry: exp, call: { bid: c - 0.05, ask: c + 0.05, iv: 0.6, oi: 1000, volume: 100 }, put: { bid: p - 0.05, ask: p + 0.05, iv: 0.6, oi: 1000, volume: 100 } }; }));

test('implied move: the straddle at the first expiry that covers the report, AMC pushes to the next session', () => {
  const rows = chain(100, [day(2), day(9)], 8);
  const bmo = pb.impliedMove(rows, 100, day(2), 'BMO'); assert.equal(bmo.expiry, day(2)); assert.equal(bmo.straddlePct, 8); assert.equal(bmo.impliedPct, 6.8);
  const amc = pb.impliedMove(rows, 100, day(2), 'AMC'); assert.equal(amc.expiry, day(9), 'after the close: the same-day expiry does not cover it');
  assert.equal(pb.impliedMove(rows, 100, day(30), 'BMO'), null, 'no expiry covers it');
  assert.equal(pb.coveringExpiry(rows, day(5), 'BMO'), day(9));
});

test('reaction history reads close-to-close moves on past report dates, next session for AMC', () => {
  const b = bars({ [day(-90)]: 0.12, [day(-180)]: -0.08 });
  const dates = pb.pastReportDates({ history: [{ date: day(-90), epsActual: 1 }, { date: day(-180), eps_actual: 1 }, { date: day(10), epsEstimate: 1 }] }, NOW);
  assert.deepEqual(dates, [day(-90), day(-180)], 'only past or reported dates');
  const h = pb.reactionHistory(b, dates, 'BMO');
  assert.equal(h.n, 2); assert.equal(h.avgAbsPct, 10); assert.equal(h.up, 1); assert.equal(h.down, 1);
  const amc = pb.reactionHistory(b, [day(-91)], 'AMC'); assert.equal(amc.moves[0].movePct, 12, 'AMC on the 91st day back reacts on the 90th');
});

test('rich premium => iron condor; cheap premium => straddle; a trend adds a debit spread; stock plays always present', () => {
  const rows = chain(100, [day(3)], 8);
  const implied = pb.impliedMove(rows, 100, day(2), 'BMO');
  const rich = pb.strategiesFor({ price: 100, implied, hist: { n: 6, avgAbsPct: 4 }, mem: { bias: 'pullback', latest: null }, rows, atr: 2, timing: 'BMO', date: day(2) });
  assert.ok(rich.some((s) => s.key === 'iron_condor') && !rich.some((s) => s.key === 'long_straddle'));
  const ic = rich.find((s) => s.key === 'iron_condor'); assert.equal(ic.legs.length, 4); assert.ok(ic.maxLoss > 0 && ic.credit > 0);
  const cheap = pb.strategiesFor({ price: 100, implied, hist: { n: 6, avgAbsPct: 12 }, mem: { bias: 'long', latest: { dir: 1, conf: { grade: 'A' } } }, rows, atr: 2, timing: 'AMC', date: day(2), sentimentScore: 0.4 });
  assert.ok(cheap.some((s) => s.key === 'long_straddle') && cheap.some((s) => s.key === 'call_spread') && cheap.some((s) => s.key === 'pre_runup'));
  const cs = cheap.find((s) => s.key === 'call_spread'); assert.ok(/sentiment agrees/.test(cs.why)); assert.equal(cs.legs[0].action, 'buy'); assert.equal(cs.legs[1].action, 'sell');
  assert.ok(cheap.every((s) => s.hedge && s.risks.length));
  assert.ok(cheap.some((s) => s.key === 'collar') && cheap.some((s) => s.key === 'post_drift'));
  const none = pb.strategiesFor({ price: 100, implied: null, hist: { n: 0 }, mem: null, rows: [], atr: null, timing: 'BMO', date: day(2) });
  assert.deepEqual(none.map((s) => s.key), ['post_drift'], 'no chain: only the plan that needs none');
});

test('list: ranks the window by option volume and size, enriches, scores, sorts; detail falls back to the symbol history', async () => {
  const month = day(0).slice(0, 7), month2 = day(14).slice(0, 7);
  const events = [
    { symbol: 'BIG', name: 'Big Co', date: day(3), timing: 'AMC', status: 'scheduled', option_volume: 50_000, market_cap: 9e10, iv_rank: 70 },
    { symbol: 'TINY', name: 'Tiny', date: day(4), timing: 'BMO', status: 'scheduled', option_volume: 0, market_cap: 1e8 },
    { symbol: 'LATE', name: 'Late', date: day(40), timing: 'BMO', status: 'scheduled', option_volume: 9_000, market_cap: 5e9 },
    { symbol: 'DONE', name: 'Done', date: day(-1), timing: 'BMO', status: 'reported', option_volume: 99_999, market_cap: 1e11 }
  ];
  const calls = [];
  const svc = pb.createEarningsPlaybook({
    now: () => NOW,
    calendar: async (m) => { calls.push('cal:' + m); return { events: events.filter((e) => e.date.startsWith(m)) }; },
    candles: async (s) => ({ bars: bars({ [day(-89)]: 0.03, [day(-180)]: -0.02 }) }), // AMC reports react the next session
    chain: async (s) => chain(100, [day(5), day(12)], 9),
    history: async (s) => ({ history: [{ date: day(-90), epsActual: 1 }, { date: day(-181), epsActual: 1 }, { date: day(20), epsEstimate: 2 }] }),
    hedge: { plan: async () => ({ ok: true, ideas: [{ name: 'Protective put' }] }) }
  });
  const r = await svc.list({ days: 14, limit: 5 });
  assert.equal(r.available, true); assert.equal(r.considered, 2, 'LATE is outside the window, DONE already reported');
  assert.deepEqual(r.events.map((e) => e.symbol), ['BIG'], 'TINY has no option volume and is too small');
  const big = r.events[0];
  assert.equal(big.implied.expiry, day(5)); assert.equal(big.history.n, 2); assert.equal(big.read, 'the move is expensive versus history');
  assert.ok(big.strategies.some((s) => s.key === 'iron_condor')); assert.ok(big.score > 40); assert.equal(big.hedgeIdeas.length, 1);
  assert.ok(calls.filter((c) => c.startsWith('cal:')).length <= 2);
  const again = await svc.list({ days: 14, limit: 5 }); assert.equal(again, r, 'cached');
  const det = await svc.detail('xyz');
  assert.equal(det.available, true); assert.equal(det.symbol, 'XYZ'); assert.equal(det.date, day(20), 'not on the calendar window: next date from its own history');
  assert.equal(month !== month2 || calls.length >= 1, true);
});
