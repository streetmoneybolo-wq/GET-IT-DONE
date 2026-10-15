'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const gamma = require('./academy-gamma');

const S = 100;
/* a chain around $100: heavy call OI at 110 (wall overhead), heavy put OI at 90 (floor), everything printed mid-spread unless stated */
function chain({ callLast = null, putLast = null, expiry = '2099-01-16' } = {}) {
  const rows = [];
  for (const k of [85, 90, 95, 100, 105, 110, 115]) {
    const g = 0.02 * Math.exp(-((k - S) ** 2) / 200);
    const leg = (oi, last) => ({ volume: 50, oi, iv: 0.3, delta: 0.5, gamma: g, bid: 1, ask: 2, last: last == null ? 1.5 : last });
    rows.push({ strike: k, expiry, call: leg(k === 110 ? 5000 : 500, callLast), put: leg(k === 90 ? 5000 : 500, putLast) });
  }
  return rows;
}
const bars = Array.from({ length: 30 }, (_, i) => ({ t: i, o: S, h: S, l: S, c: S, v: 1_000_000 }));

test('reports hedge shares per 1% move, pressure against daily volume, walls and flip', () => {
  const g = gamma.analyzeGamma(chain(), { underlying: S, bars });
  assert.equal(g.available, true);
  assert.equal(g.basis, 'standard', 'mid-spread prints give no dealer read');
  assert.equal(g.hedgeShares, Math.round(g.netGex / S));
  assert.equal(g.adv, 1_000_000);
  assert.equal(g.pressurePct, Math.round(g.hedgeSharesAbs / 1_000_000 * 100 * 100) / 100);
  assert.equal(g.callWall.strike, 110); assert.equal(g.putWall.strike, 90);
  assert.ok(g.callWall.distancePct > 0 && g.putWall.distancePct > 0);
  assert.ok(['positive', 'negative'].includes(g.regime));
  assert.ok(g.byStrike.length >= 5);
  assert.ok(/inferred, not observed/.test(g.note));
});

test('prints at the ask read as customer buys (dealer short) and flip the inferred sign', () => {
  const std = gamma.analyzeGamma(chain(), { underlying: S, bars });
  const bought = gamma.analyzeGamma(chain({ callLast: 1.95, putLast: 1.95 }), { underlying: S, bars });
  assert.equal(bought.basis, 'inferred'); assert.equal(bought.inferredCoverage, 1);
  assert.ok(bought.inferredNetGex < 0, 'every contract customer-bought => dealers short gamma everywhere');
  assert.equal(bought.standardNetGex, std.standardNetGex, 'the standard read is unchanged');
  const sold = gamma.analyzeGamma(chain({ callLast: 1.05, putLast: 1.05 }), { underlying: S, bars });
  assert.ok(sold.inferredNetGex > 0);
});

test('0DTE share counts open interest expiring on the New York date', () => {
  const now = Date.UTC(2026, 9, 14, 15, 0, 0); // 11:00 ET on 2026-10-14
  const g = gamma.analyzeGamma(chain({ expiry: '2026-10-14' }), { underlying: S, bars, now });
  assert.equal(g.zeroDteShare, 1);
  assert.equal(gamma.analyzeGamma(chain(), { underlying: S, bars, now }).zeroDteShare, 0);
});

test('unavailable without a price, a chain or the options math', () => {
  assert.equal(gamma.analyzeGamma(chain(), { underlying: null, bars }).reason, 'no_price');
  assert.equal(gamma.analyzeGamma([], { underlying: S, bars }).reason, 'no_chain');
  assert.equal(gamma.analyzeGamma(chain(), { underlying: S, bars, math: null }).reason, 'options_math_missing');
  assert.equal(gamma.analyzeGamma(chain(), { underlying: S, bars: [] }).pressurePct, null, 'no volume history => no pressure read');
});

test('pressure bands', () => {
  assert.equal(gamma.pressureBand(0.2), 'low'); assert.equal(gamma.pressureBand(1), 'moderate');
  assert.equal(gamma.pressureBand(3), 'high'); assert.equal(gamma.pressureBand(9), 'extreme'); assert.equal(gamma.pressureBand(null), null);
});

test('service caches per symbol and falls back to the last daily close for the price', async () => {
  let chainCalls = 0;
  const svc = gamma.createGammaService({ chain: async () => { chainCalls++; return chain(); }, candles: async () => ({ bars }), quote: null, now: () => 1000 });
  const a = await svc.get('abc'); const b = await svc.get('ABC');
  assert.equal(a.ok, true); assert.equal(a.symbol, 'ABC'); assert.equal(a.price, S); assert.equal(chainCalls, 1); assert.equal(a, b);
});
