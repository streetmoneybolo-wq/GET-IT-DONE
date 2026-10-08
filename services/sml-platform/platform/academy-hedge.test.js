'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const calc = require('./academy-options-calc');
const H = require('./academy-hedge');

const NOW = Date.UTC(2026, 9, 8, 15, 0, 0);
const expiryIn = (days) => new Date(NOW + days * 86_400_000).toISOString().slice(0, 10);

/* a synthetic, internally consistent chain: Black-Scholes prices at 30% IV, 2% bid/ask spread, healthy open interest */
function chain({ price = 100, iv = 0.3, days = [21, 35, 50], step = 2.5, spread = 0.02, oi = 1200, mutate = null } = {}) {
  const rows = [];
  for (const d of days) {
    const expiry = expiryIn(d), T = (dte(expiry)) / 365;
    for (let k = price * 0.6; k <= price * 1.4 + 1e-9; k += step) {
      const strike = Math.round(k * 100) / 100;
      for (const type of ['call', 'put']) {
        const p = calc.price(type, price, strike, T, 0.043, 0, iv);
        if (!p || p.price < 0.05) continue;
        const mid = p.price, row = { expiry, type, strike, bid: +(mid * (1 - spread / 2)).toFixed(2), ask: +(mid * (1 + spread / 2)).toFixed(2), delta: p.delta, gamma: p.gamma, theta: p.theta, vega: p.vega, iv, oi, volume: 300 };
        rows.push(mutate ? mutate(row) : row);
      }
    }
  }
  return rows;
}
function dte(expiry) { return Math.max(0, Math.ceil((Date.parse(expiry + 'T20:00:00Z') - NOW) / 86_400_000)); }
const base = (over = {}) => Object.assign({ symbol: 'xyz', price: 100, side: 'long', shares: 100, entry: 95, target: 112, stop: 92, horizon: 'swing', chain: chain(), now: NOW }, over);
const byKind = (r, k) => r.ideas.find((i) => i.kind === k);

test('returns every idea for a long position with a disclaimer and the core fields', () => {
  const r = H.planHedges(base({ memRead: { dir: 'neutral', strength: 50 } }));
  assert.equal(r.ok, true);
  assert.equal(r.symbol, 'XYZ');
  assert.match(r.disclaimer, /not financial advice/i);
  assert.match(r.disclaimer, /100%/);
  for (const k of ['protective_put', 'put_debit_spread', 'collar', 'covered_call', 'cash_secured_put', 'directional_put']) assert.ok(byKind(r, k), 'missing ' + k);
  for (const i of r.ideas) {
    assert.ok(i.legs.length >= 1);
    assert.ok(i.score >= 0 && i.score <= 100);
    assert.ok(typeof i.why === 'string' && i.why.length > 60 && i.why.length < 700, i.kind + ' why');
    assert.ok(i.whenToUse);
    assert.ok(['A', 'B', 'C'].includes(i.liquidity.grade));
    assert.ok(Array.isArray(i.breakevens));
    assert.ok(Number.isFinite(i.thetaPerDay));
    for (const l of i.legs) for (const g of ['delta', 'gamma', 'theta', 'vega', 'iv', 'mid']) assert.ok(Number.isFinite(l[g]), i.kind + ' ' + g);
    assert.doesNotMatch(i.why, /delve|in today's|navigate the|it's important to note|landscape/i);
  }
});

test('protective put sits near the stop, 21-60 DTE, |delta| near 0.25-0.45, and its math is per share / per contract', () => {
  const r = H.planHedges(base());
  const p = byKind(r, 'protective_put'), l = p.legs[0];
  assert.equal(l.type, 'put'); assert.equal(l.action, 'buy');
  assert.ok(l.dte >= 21 && l.dte <= 60, 'dte ' + l.dte);
  assert.ok(Math.abs(l.delta) >= 0.15 && Math.abs(l.delta) <= 0.5, 'delta ' + l.delta);
  assert.ok(l.strike <= 100 && l.strike >= 85, 'strike ' + l.strike);
  assert.equal(p.net.type, 'debit');
  assert.equal(p.net.perShare, l.mid);
  assert.equal(p.net.perContract, Math.round(l.mid * 100 * 100) / 100);
  assert.equal(p.protectedBelow, l.strike);
  assert.ok(Math.abs(p.maxLoss.perShare - (95 - l.strike + l.mid)) < 0.011);
  assert.ok(Math.abs(p.costPctOfPosition - (l.mid * 100) / (100 * 100)) < 1e-3);
  assert.ok(p.thetaPerDay < 0, 'a bought put loses time value');
  // payoff: deep below the strike the loss is capped at maxLoss
  assert.ok(Math.abs(H.payoffAt(p, 40) + p.maxLoss.total) < 1);
});

test('put debit spread is cheaper than the put alone and caps its payout at the width', () => {
  const r = H.planHedges(base());
  const p = byKind(r, 'protective_put'), s = byKind(r, 'put_debit_spread');
  assert.equal(s.legs[0].action, 'buy'); assert.equal(s.legs[1].action, 'sell');
  assert.ok(s.legs[1].strike < s.legs[0].strike);
  assert.equal(s.legs[0].expiry, s.legs[1].expiry);
  assert.ok(s.net.perShare < p.net.perShare);
  const width = s.legs[0].strike - s.legs[1].strike;
  assert.ok(Math.abs(s.maxPayout.perShare - (width - s.net.perShare)) < 0.011);
});

test('collar sells a call at or above the target and lands near zero cost', () => {
  const r = H.planHedges(base());
  const c = byKind(r, 'collar');
  const put = c.legs.find((l) => l.type === 'put'), call = c.legs.find((l) => l.type === 'call');
  assert.equal(put.action, 'buy'); assert.equal(call.action, 'sell');
  assert.ok(call.strike >= 112, 'call strike ' + call.strike);
  assert.equal(c.cappedAt, call.strike);
  assert.ok(c.net.perShare < 1.0, 'net ' + c.net.perShare + ' should be close to zero');
  assert.match(c.why, /gains stop/);
});

test('covered call: strike at/above target, delta 0.15-0.30, annualized yield is premium/price scaled to a year', () => {
  const r = H.planHedges(base({ target: 108 }));
  const cc = byKind(r, 'covered_call'), l = cc.legs[0];
  assert.equal(l.action, 'sell'); assert.equal(l.type, 'call');
  assert.ok(l.strike >= 108);
  assert.ok(l.dte >= 14 && l.dte <= 45);
  assert.equal(cc.net.type, 'credit');
  assert.ok(Math.abs(cc.yield.period - l.mid / 100) < 1e-3);
  assert.ok(Math.abs(cc.yield.annualized - (l.mid / 100) * (365 / l.dte)) < 1e-3);
  assert.ok(Math.abs(cc.probWorthless - (1 - Math.abs(l.delta))) < 1e-3);
  assert.ok(cc.thetaPerDay > 0, 'a sold call earns time decay');
});

test('cash-secured put: premium, cash secured, yield on cash, chance to expire worthless and effective price', () => {
  const r = H.planHedges(base());
  const p = byKind(r, 'cash_secured_put'), l = p.legs[0];
  assert.equal(l.action, 'sell'); assert.equal(l.type, 'put');
  assert.ok(l.strike < 100);
  assert.ok(Math.abs(l.delta) >= 0.1 && Math.abs(l.delta) <= 0.35, 'delta ' + l.delta);
  assert.equal(p.cashSecured, l.strike * 100);
  assert.ok(Math.abs(p.effectivePrice - (l.strike - l.mid)) < 0.011);
  assert.ok(Math.abs(p.yield.annualized - (l.mid / l.strike) * (365 / l.dte)) < 1e-3);
  assert.ok(Math.abs(p.probWorthless - (1 - Math.abs(l.delta))) < 1e-3);
  assert.equal(p.withStock, false);
  assert.match(p.why, /effective/);
});

test('directional pick: a call with delta 0.40-0.65 when MEM ALGO is bullish, a put when bearish', () => {
  const bull = H.planHedges(base({ memRead: { dir: 'bull', strength: 80 } }));
  const c = byKind(bull, 'directional_call');
  assert.ok(c && !byKind(bull, 'directional_put'));
  assert.ok(Math.abs(c.legs[0].delta) >= 0.4 && Math.abs(c.legs[0].delta) <= 0.65, 'delta ' + c.legs[0].delta);
  const bear = H.planHedges(base({ memRead: { dir: 'bear', strength: 80 } }));
  assert.ok(byKind(bear, 'directional_put'));
});

test('ranking flips with MEM ALGO: hedges first when it leans against the position or is unclear, income first when it agrees', () => {
  const against = H.planHedges(base({ memRead: { dir: 'bear', strength: 75 } }));
  assert.equal(against.lean.mode, 'hedge-first');
  assert.equal(against.ideas[0].group, 'hedge');
  const unclear = H.planHedges(base({ memRead: { dir: 'bull', strength: 20 } }));
  assert.equal(unclear.lean.mode, 'hedge-first');
  assert.equal(unclear.ideas[0].group, 'hedge');
  const withIt = H.planHedges(base({ memRead: { dir: 'bull', strength: 75 } }));
  assert.equal(withIt.lean.mode, 'income-first');
  assert.equal(withIt.ideas[0].group, 'income');
  const firstIncome = withIt.ideas.findIndex((i) => i.group === 'income'), firstHedge = withIt.ideas.findIndex((i) => i.group === 'hedge');
  assert.ok(firstIncome < firstHedge);
});

test('illiquid contracts are skipped: no bid, spread over 15% of mid, or no open interest and no volume', () => {
  let n = 0;
  const bad = chain({ mutate: (row) => { n++; if (n % 3 === 0) return Object.assign(row, { bid: 0 }); if (n % 3 === 1) return Object.assign(row, { bid: +(row.ask * 0.7).toFixed(2) }); return Object.assign(row, { oi: 0, volume: 0 }); } });
  const r = H.planHedges(base({ chain: bad }));
  assert.equal(r.ideas.length, 0);
  assert.equal(r.contractsConsidered, 0);
  assert.ok(r.skipped.illiquid > 0);
  assert.ok(r.skipped.reasons.no_bid > 0 && r.skipped.reasons.wide_spread > 0 && r.skipped.reasons.thin > 0);
  assert.ok(r.notes.some((x) => /thin|wide/.test(x)));
  // a single liquid contract among them is still used
  assert.equal(H.liquidityProblem({ bid: 1, ask: 1.1, mid: 1.05, spreadPct: 0.095, oi: 500, volume: 0 }), null);
  assert.equal(H.liquidityProblem({ bid: 1, ask: 1.4, mid: 1.2, spreadPct: 0.33, oi: 500, volume: 10 }), 'wide_spread');
});

test('short stock mirrors: protective call above, call spread, collar with a put sold at the target, covered put; no cash-secured put', () => {
  const r = H.planHedges(base({ side: 'short', entry: 104, target: 88, stop: 108, memRead: { dir: 'bull', strength: 70 } }));
  assert.equal(r.lean.mode, 'hedge-first'); // MEM ALGO bullish against a short
  const pc = byKind(r, 'protective_call');
  assert.ok(pc && pc.legs[0].type === 'call' && pc.legs[0].action === 'buy' && pc.legs[0].strike >= 100);
  assert.equal(pc.protectedAbove, pc.legs[0].strike);
  assert.ok(Math.abs(pc.maxLoss.perShare - (pc.legs[0].strike - 104 + pc.legs[0].mid)) < 0.011);
  const sp = byKind(r, 'call_debit_spread');
  assert.ok(sp && sp.legs[1].strike > sp.legs[0].strike);
  const col = byKind(r, 'collar');
  assert.ok(col.legs.find((l) => l.type === 'put' && l.action === 'sell').strike <= 88);
  const cp = byKind(r, 'covered_put');
  assert.ok(cp && cp.legs[0].type === 'put' && cp.legs[0].action === 'sell');
  assert.ok(!byKind(r, 'cash_secured_put'));
  assert.equal(r.ideas[0].group, 'hedge');
  // short stock P/L: price going up loses, protective call caps it
  assert.ok(Math.abs(H.payoffAt(pc, 200) + pc.maxLoss.total) < 1);
  const withShort = H.planHedges(base({ side: 'short', entry: 104, target: 88, stop: 108, memRead: { dir: 'bear', strength: 80 } }));
  assert.equal(withShort.lean.mode, 'income-first');
  assert.equal(withShort.ideas[0].kind, 'covered_put');
});

test('contracts follow the share count, and a part lot is called out', () => {
  const r = H.planHedges(base({ shares: 250 }));
  assert.equal(r.contracts, 2);
  const p = byKind(r, 'protective_put');
  assert.equal(p.legs[0].contracts, 2);
  assert.ok(Math.abs(p.net.total - p.net.perContract * 2) < 0.011);
  assert.ok(r.notes.some((x) => /200 of your 250/.test(x)));
});

test('bad levels and missing price are handled', () => {
  assert.equal(H.planHedges(base({ price: null })).ok, false);
  const r = H.planHedges(base({ stop: 130, target: 50 })); // wrong sides for a long are ignored
  assert.ok(r.levels.stop < 100 && r.levels.target > 100);
  const empty = H.planHedges(base({ chain: [] }));
  assert.equal(empty.ideas.length, 0);
  assert.match(empty.disclaimer, /Educational/);
});

test('greeks are filled from implied volatility when the feed leaves them out, and positive put deltas are flipped', () => {
  const rows = chain().map((r) => Object.assign({}, r, { delta: null, gamma: null, theta: null, vega: null }));
  const r = H.planHedges(base({ chain: rows }));
  assert.ok(byKind(r, 'protective_put').legs[0].delta < 0);
  const c = H.prepare({ expiry: expiryIn(30), type: 'put', strike: 95, bid: 2, ask: 2.1, delta: 0.3, iv: 30 }, 100, NOW);
  assert.equal(c.delta, -0.3);
  assert.equal(c.iv, 0.3);
});

test('pickExpirations picks at most three distinct dates near each window', () => {
  const list = [7, 14, 21, 28, 35, 42, 49, 63, 91, 182].map(expiryIn);
  const got = H.pickExpirations(list, 'swing', NOW);
  assert.ok(got.length <= 3 && got.length >= 2);
  assert.equal(new Set(got).size, got.length);
  assert.ok(got.includes(expiryIn(28)) || got.includes(expiryIn(35)));
});

test('service: uses the alert desk levels (with a raised auto-PT stop), caches the chain, fetches at most 3 expirations', async () => {
  const exps = [10, 24, 38, 52, 80].map(expiryIn);
  const calls = [];
  const full = chain({ days: [10, 24, 38, 52, 80] });
  const svc = H.createHedgeService({
    now: () => NOW,
    chain: async (symbol, expiration) => { calls.push(expiration); return { ok: true, data: { expirations: exps, contracts: expiration ? full.filter((r) => r.expiry === expiration) : full.filter((r) => r.expiry === exps[0]) } }; },
    candles: async () => ({ bars: Array.from({ length: 40 }, (_, i) => ({ t: i, o: 100, h: 101, l: 99, c: 100 })) }),
    alertsFor: async () => [{ id: '77', symbol: 'XYZ', entry: 96, target0: 110, plan: { stop: 90, target: 114 }, at: 2 }, { id: '5', symbol: 'XYZ', entry: 80, at: 1 }],
    ptLadder: (key) => (key === 'd:77' ? { stop: 93 } : null)
  });
  const r = await svc.plan({ symbol: 'XYZ', shares: 100, horizon: 'swing', userId: 'u', view: 'live', dir: 'bull', strength: 70 });
  assert.equal(r.ok, true);
  assert.equal(r.levels.source, 'alert');
  assert.equal(r.levels.alertId, '77');
  assert.equal(r.levels.entry, 96);
  assert.equal(r.levels.target, 114);
  assert.equal(r.levels.stop, 93);
  assert.ok(calls.filter(Boolean).length <= 3);
  assert.ok(r.ideas.length >= 4);
  const n = calls.length;
  await svc.plan({ symbol: 'XYZ', shares: 100, horizon: 'swing', userId: 'u', view: 'live' });
  assert.equal(calls.length, n, 'second request within 60 s is served from cache');
});

test('service: falls back to ATR levels without an alert, and reports a missing chain', async () => {
  const bars = Array.from({ length: 40 }, (_, i) => ({ t: i, o: 100, h: 102, l: 98, c: 100 })); // ATR 4
  const svc = H.createHedgeService({ now: () => NOW, chain: async () => ({ ok: true, data: { contracts: chain({ days: [24, 38] }) } }), candles: async () => ({ bars }) });
  const r = await svc.plan({ symbol: 'XYZ', horizon: 'swing', view: 'teaser' });
  assert.equal(r.levels.source, 'atr');
  assert.equal(r.levels.stop, 92); // 100 - 2 x 4
  assert.equal(r.levels.target, 116); // 100 + 4 x 4
  const none = H.createHedgeService({ chain: async () => ({ ok: false, code: 'x' }), candles: async () => ({ bars }) });
  const bad = await none.plan({ symbol: 'XYZ' });
  assert.equal(bad.ok, false); assert.equal(bad.status, 503);
});

test('service: noAlerts (the stockmarketloop.com dashboard) never reads an alert desk; its own levels win, ATR fills the rest', async () => {
  const bars = Array.from({ length: 40 }, (_, i) => ({ t: i, o: 100, h: 102, l: 98, c: 100 })); // ATR 4
  let asked = 0;
  const svc = H.createHedgeService({ now: () => NOW, chain: async () => ({ ok: true, data: { contracts: chain({ days: [24, 38] }) } }), candles: async () => ({ bars }),
    alertsFor: async () => { asked += 1; return [{ id: '9', symbol: 'XYZ', entry: 80, plan: { stop: 70, target: 90 }, at: 1 }]; } });
  const r = await svc.plan({ symbol: 'XYZ', horizon: 'swing', view: 'live', userId: 'u', noAlerts: true, entry: 97, target: 110 });
  assert.equal(asked, 0, 'alertsFor is never called');
  assert.equal(r.ok, true);
  assert.equal(r.levels.entry, 97); assert.equal(r.levels.target, 110);
  assert.equal(r.levels.stop, 92, 'stop from ATR: 100 - 2 x 4');
  assert.equal(r.levels.from.entry, 'query'); assert.equal(r.levels.from.stop, 'atr');
  assert.equal(r.levels.alertId, null);
  // without the flag the same call does read the desk
  await svc.plan({ symbol: 'XYZ', horizon: 'swing', view: 'live', userId: 'u' });
  assert.equal(asked, 1);
});
