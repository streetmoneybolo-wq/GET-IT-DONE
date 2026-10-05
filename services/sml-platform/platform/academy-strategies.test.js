'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./academy-strategies');
const calc = require('./academy-options-calc');

const NOW = Date.parse('2026-06-10T15:00:00Z');
const spot = 100;
function chain({ iv = 0.3, spread = 0.02, oi = 1000, expiries = ['2026-07-17'] } = {}) {
  const rows = [];
  for (const expiry of expiries) {
    const T = S.daysTo(expiry, NOW) / 365;
    for (let k = 70; k <= 130; k += 5) {
      const leg = (type) => { const p = calc.price(type, spot, k, T, 0.043, 0, iv).price, h = Math.max(0.01, p * spread / 2); return { bid: +(p - h).toFixed(2), ask: +(p + h).toFixed(2), iv, oi, volume: 50 }; };
      rows.push({ expiry, strike: k, call: leg('call'), put: leg('put') });
    }
  }
  return rows;
}

test('bullish view builds exposure strategies with correct payoff math', () => {
  const r = S.buildStrategies({ symbol: 'X', spot, rows: chain(), view: 'bullish', horizonDays: 30, now: NOW });
  assert.equal(r.available, true);
  const lc = r.strategies.find((s) => s.id === 'long_call');
  assert.ok(lc, 'long call present');
  assert.equal(lc.maxLoss, -Math.round(lc.legs[0].price * 100), 'max loss is the premium');
  assert.equal(lc.unlimitedProfit, true); assert.equal(lc.maxProfit, null);
  assert.equal(lc.breakevens.length, 1);
  assert.ok(Math.abs(lc.breakevens[0] - (lc.legs[0].strike + lc.legs[0].price)) < 0.1);
  assert.ok(lc.greeks.delta > 30 && lc.greeks.delta < 70);
  assert.ok(lc.exposure.leverage > 2, 'a call gives leveraged exposure');
  assert.equal(lc.payoff.length, 41);
  const bcs = r.strategies.find((s) => s.id === 'bull_call_spread');
  const width = Math.abs(bcs.legs[0].strike - bcs.legs[1].strike);
  assert.equal(bcs.maxProfit, Math.round((width * 100) + bcs.netCost * -1) );
  assert.ok(bcs.netCost < lc.netCost, 'spread is cheaper than the long call');
  assert.equal(bcs.unlimitedProfit, false);
  assert.ok(bcs.chanceOfProfit > 0 && bcs.chanceOfProfit < 100);
});

test('bearish view builds put structures and a credit spread with bounded loss', () => {
  const r = S.buildStrategies({ symbol: 'X', spot, rows: chain(), view: 'bearish', horizonDays: 30, now: NOW });
  const ids = r.strategies.map((s) => s.id);
  assert.deepEqual(ids.sort(), ['bear_call_spread', 'bear_put_spread', 'long_put', 'protective_put_100']);
  const lp = r.strategies.find((s) => s.id === 'long_put');
  assert.equal(lp.maxLoss, -Math.round(lp.legs[0].price * 100));
  const bc = r.strategies.find((s) => s.id === 'bear_call_spread');
  assert.equal(bc.costType, 'credit'); assert.ok(bc.maxLoss < 0 && bc.maxProfit > 0);
  assert.equal(bc.kind, 'income');
});

test('holding shares: protective put, collar and covered call hedge the position', () => {
  const r = S.buildStrategies({ symbol: 'X', spot, rows: chain(), view: 'neutral', horizonDays: 30, shares: 200, cost: 90, now: NOW });
  const pp = r.strategies.find((s) => s.id === 'protective_put'), col = r.strategies.find((s) => s.id === 'collar'), cc = r.strategies.find((s) => s.id === 'covered_call');
  assert.ok(pp && col && cc);
  assert.equal(pp.legs[0].qty, 2, 'two contracts cover 200 shares');
  assert.equal(pp.kind, 'hedge'); assert.equal(pp.unlimitedProfit, true);
  // a protective put floors the loss: the worst case is basis minus strike plus premium (times shares)
  const floor = Math.round(-(90 - pp.legs[0].strike) * 200 - pp.legs[0].price * 200);
  assert.ok(Math.abs(pp.maxLoss - floor) <= 2 || pp.maxLoss > floor, 'loss is bounded by the put');
  assert.ok(pp.maxLoss > -90 * 200, 'much smaller than owning shares naked');
  assert.equal(col.unlimitedProfit, false, 'collar caps the gain');
  assert.ok(Math.abs(col.netCost) < Math.abs(pp.netCost), 'selling the call offsets the put cost');
  assert.ok(cc.exposure.vsOwnedShares < 1, 'covered call reduces share-equivalent exposure');
  assert.ok(pp.exposure.vsOwnedShares < 1, 'a put lowers net delta');
});

test('without shares a hedge is still illustrated per 100 shares', () => {
  const r = S.buildStrategies({ symbol: 'X', spot, rows: chain(), view: 'bullish', horizonDays: 30, now: NOW });
  const h = r.strategies.find((s) => s.id === 'protective_put_100');
  assert.ok(h && h.stock.shares === 100);
});

test('picks the first expiry at or after the horizon and warns about thin, wide markets', () => {
  const rows = chain({ expiries: ['2026-06-19', '2026-07-17', '2026-09-18'] });
  const r = S.buildStrategies({ spot, rows, view: 'bullish', horizonDays: 40, now: NOW });
  assert.equal(r.expiry, '2026-09-18'); // 40 * 1.15 = 46d wanted; Jul 17 is 37d
  const wide = S.buildStrategies({ spot, rows: chain({ spread: 0.5, oi: 10 }), view: 'bullish', horizonDays: 30, now: NOW });
  const w = wide.strategies[0].warnings.join(' ');
  assert.match(w, /Wide bid\/ask/); assert.match(w, /low open interest/);
});

test('degrades honestly: no chain, no usable expiry, no priced contracts', () => {
  assert.equal(S.buildStrategies({ spot, rows: [], now: NOW }).reason, 'no_chain');
  assert.equal(S.buildStrategies({ spot: 0, rows: chain(), now: NOW }).available, false);
  const stale = chain({ expiries: ['2026-06-10'] });
  assert.equal(S.buildStrategies({ spot, rows: stale, now: NOW }).reason, 'no_usable_expiry');
  const noPrice = chain().map((r) => ({ ...r, call: { bid: 0, ask: 0 }, put: { bid: 0, ask: 0 } }));
  assert.equal(S.buildStrategies({ spot, rows: noPrice, now: NOW }).available, false);
});

test('invNorm sanity and expiry value of a simple spread', () => {
  assert.ok(Math.abs(S.invNorm(0.5)) < 1e-9);
  assert.ok(Math.abs(S.invNorm(0.975) - 1.96) < 0.01);
  const legs = [{ type: 'call', strike: 100, qty: 1, price: 5 }, { type: 'call', strike: 110, qty: -1, price: 2 }];
  assert.equal(S.expiryValue(legs, 120, null), (10 - 3) * 100);
  assert.equal(S.expiryValue(legs, 90, null), -300);
});

test('never labels a far-away strike as a hedge: no strike near the needed level means no hedge is offered', () => {
  const rows = chain().filter((r) => r.strike >= 110); // nothing near 95% of spot
  const r = S.buildStrategies({ spot, rows, view: 'neutral', horizonDays: 30, shares: 100, cost: 100, now: NOW });
  assert.ok(!r.strategies || !r.strategies.some((s) => s.id === 'protective_put' || s.id === 'collar'));
});
