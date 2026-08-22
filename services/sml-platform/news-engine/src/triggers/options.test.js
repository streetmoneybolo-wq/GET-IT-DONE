/* Options analytics tests.  Run: node --test  (from this directory)
 * Fixtures mirror the real moomoo chain shape verified live on 2026-08-22. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const o = require('./options.js');

function contract(over) {
  return Object.assign({
    ticker: 'O:TEST260824C00100000',
    type: 'call', expiration: '2026-08-24', strike: 100,
    bid: 1.00, ask: 1.10, last: 1.05,
    volume: 0, open_interest: 0,
    iv: 0.35, delta: 0.5, gamma: 0.02, theta: -0.05, vega: 0.1, rho: 0
  }, over);
}

const chain = {
  provider: 'moomoo', symbol: 'TEST', underlying: 100, expiration: '2026-08-24',
  stale: false, freshness: 'live', count: 6,
  contracts: [
    contract({ strike: 95,  type: 'put',  volume: 100,  open_interest: 5000, gamma: 0.010 }),
    contract({ strike: 100, type: 'put',  volume: 200,  open_interest: 8000, gamma: 0.020 }),
    contract({ strike: 100, type: 'call', volume: 300,  open_interest: 9000, gamma: 0.020 }),
    contract({ strike: 105, type: 'call', volume: 4000, open_interest: 500,  gamma: 0.015, bid: 2.0, ask: 2.2 }),
    contract({ strike: 110, type: 'call', volume: 50,   open_interest: 3000, gamma: 0.008 }),
    contract({ strike: 90,  type: 'put',  volume: 20,   open_interest: 2000, gamma: 0.006 })
  ]
};

/* ---------- premium & mid ---------- */

test('mid price uses the book, falls back to last', () => {
  assert.equal(o.midPrice({ bid: 1, ask: 1.2, last: 9 }), 1.1);
  assert.equal(o.midPrice({ last: 3.5 }), 3.5);
});

test('premium is volume x mid x 100', () => {
  assert.equal(o.premiumTraded({ volume: 10, bid: 1, ask: 1 }), 1000);
});

/* ---------- unusual activity ---------- */

test('volume far above open interest is flagged as likely opening', () => {
  const hits = o.unusualActivity(chain.contracts, { minVolume: 250, minRatio: 2, minPremium: 1e9 });
  const top = hits[0];
  assert.equal(top.strike, 105, 'the 4000v/500oi contract should lead');
  assert.equal(top.vol_oi_ratio, 8);
  assert.equal(top.likely_opening, true);
});

test('heavy volume against heavier open interest is not unusual', () => {
  /* 300 lots against 9000 OI is ordinary churn — ratio 0.03 */
  const hits = o.unusualActivity(
    [contract({ strike: 100, type: 'call', volume: 300, open_interest: 9000 })],
    { minVolume: 250, minRatio: 2, minPremium: 1e9 }
  );
  assert.equal(hits.length, 0);
});

test('a brand-new strike with zero OI cannot qualify on ratio alone', () => {
  /* division by zero would otherwise read as an infinite ratio on one lot */
  const hits = o.unusualActivity(
    [contract({ volume: 300, open_interest: 0, bid: 0.01, ask: 0.02 })],
    { minVolume: 250, minRatio: 2, minPremium: 1e9 }
  );
  assert.equal(hits.length, 0, 'zero-OI contract slipped through on ratio');
});

test('large premium qualifies even when the ratio does not', () => {
  const hits = o.unusualActivity(
    [contract({ volume: 5000, open_interest: 90000, bid: 10, ask: 10 })],
    { minVolume: 250, minRatio: 2, minPremium: 1000000 }
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].premium, 5000 * 10 * 100);
});

/* ---------- put/call ---------- */

test('put/call ratios computed on both volume and open interest', () => {
  const r = o.putCallRatio(chain.contracts);
  assert.equal(r.call_volume, 4350);
  assert.equal(r.put_volume, 320);
  assert.equal(r.volume, Math.round((320 / 4350) * 1000) / 1000);
  assert.equal(r.call_oi, 12500);
  assert.equal(r.put_oi, 15000);
});

/* ---------- gamma ---------- */

test('GEX follows gamma x OI x 100 x S^2 x 0.01', () => {
  const one = [contract({ type: 'call', strike: 100, gamma: 0.02, open_interest: 1000 })];
  const g = o.gammaExposure(one, 100);
  const expected = 0.02 * 1000 * 100 * 100 * 100 * 0.01;
  assert.equal(g.by_strike[0].call_gex, expected);
  assert.equal(g.net_gex, Math.round(expected));
});

test('the dealer sign convention is applied and reported, not hidden', () => {
  const puts = [contract({ type: 'put', strike: 100, gamma: 0.02, open_interest: 1000 })];
  const normal = o.gammaExposure(puts, 100);
  assert.ok(normal.net_gex < 0, 'put gamma should be negative under the default assumption');
  assert.match(normal.dealer_assumption, /short calls/);

  const inverted = o.gammaExposure(puts, 100, { dealerShortCalls: false });
  assert.ok(inverted.net_gex > 0, 'inverting the assumption must flip the sign');
});

test('regime and interpretation agree with the sign', () => {
  const g = o.gammaExposure(chain.contracts, 100);
  assert.equal(g.regime, g.net_gex > 0 ? 'positive_gamma' : 'negative_gamma');
  assert.match(g.interpretation, g.net_gex > 0 ? /dampen/ : /amplify/);
});

test('the flip level is always marked approximate', () => {
  assert.equal(o.gammaExposure(chain.contracts, 100).flip_is_approximate, true);
});

test('a missing underlying price yields no gamma rather than a wrong number', () => {
  const g = o.gammaExposure(chain.contracts, 0);
  assert.equal(g.by_strike.length, 0);
  assert.equal(g.net_gex, 0);
});

/* ---------- max pain ---------- */

test('max pain minimises total intrinsic value owed at expiry', () => {
  /* all OI at the 100 call: pain rises with every dollar above 100, so the
     cheapest expiry for writers is at or below the strike */
  const single = [contract({ type: 'call', strike: 100, open_interest: 1000, volume: 0 })];
  assert.equal(o.maxPain(single).strike, 100);

  const balanced = [
    contract({ type: 'call', strike: 90,  open_interest: 1000 }),
    contract({ type: 'put',  strike: 110, open_interest: 1000 })
  ];
  const p = o.maxPain(balanced);
  assert.ok(p.strike === 90 || p.strike === 110, `unexpected max pain ${p.strike}`);
  assert.ok(p.pain >= 0);
});

test('max pain returns null on an empty chain instead of throwing', () => {
  assert.equal(o.maxPain([]).strike, null);
});

/* ---------- skew & 0DTE ---------- */

test('call skew is detected when near-the-money calls are bid over puts', () => {
  const c = [
    contract({ type: 'call', strike: 100, iv: 0.60 }),
    contract({ type: 'call', strike: 102, iv: 0.58 }),
    contract({ type: 'put',  strike: 100, iv: 0.30 }),
    contract({ type: 'put',  strike: 98,  iv: 0.32 })
  ];
  const s = o.ivSkew(c, 100);
  assert.equal(s.call_skew, true);
  assert.ok(s.skew < 0);
});

test('skew needs enough near-the-money contracts to mean anything', () => {
  assert.equal(o.ivSkew([contract({ iv: 0.5 })], 100), null);
});

test('0DTE bucket picks up only contracts expiring today', () => {
  const z = o.zeroDTE(chain.contracts, '2026-08-24');
  assert.equal(z.contracts, 6);
  assert.ok(z.premium > 0);
  assert.equal(o.zeroDTE(chain.contracts, '2026-09-19'), null);
});

/* ---------- chain analysis ---------- */

test('a live chain produces unusual-activity and gamma triggers', () => {
  const r = o.analyzeChain(chain, { minVolume: 250, minRatio: 2, minPremium: 1e9, today: '2099-01-01' });
  const types = r.triggers.map((t) => t.type);
  assert.ok(types.includes('unusual_options_activity'), types.join(','));
  assert.ok(types.includes('gamma_positioning'), types.join(','));
});

/* The rule that matters most: a stale snapshot must never become an article. */
test('a stale chain produces NO triggers', () => {
  const r = o.analyzeChain(Object.assign({}, chain, { stale: true }));
  assert.equal(r.triggers.length, 0);
  assert.match(r.skipped, /stale/);

  const r2 = o.analyzeChain(Object.assign({}, chain, { stale: false, freshness: 'stale' }));
  assert.equal(r2.triggers.length, 0);
});

test('malformed input is skipped, never thrown', () => {
  assert.equal(o.analyzeChain(null).triggers.length, 0);
  assert.equal(o.analyzeChain({}).triggers.length, 0);
  assert.equal(o.analyzeChain({ contracts: [] }).triggers.length, 0);
});

test('triggers carry stated facts, not adjectives', () => {
  const r = o.analyzeChain(chain, { minVolume: 250, minRatio: 2, minPremium: 1e9, today: '2099-01-01' });
  for (const t of r.triggers) {
    assert.ok(Array.isArray(t.headline_facts) && t.headline_facts.length, `${t.type} has no facts`);
    assert.ok(t.evidence && typeof t.evidence === 'object', `${t.type} has no evidence`);
    assert.ok(t.strength >= 0 && t.strength <= 100, `${t.type} strength out of range`);
  }
});

test('gamma trigger always discloses the dealer assumption', () => {
  const r = o.analyzeChain(chain, { today: '2099-01-01' });
  const g = r.triggers.find((t) => t.type === 'gamma_positioning');
  assert.match(g.evidence.dealer_assumption, /dealers/);
  assert.equal(g.evidence.flip_is_approximate, true);
});

test('analysis is deterministic', () => {
  const a = o.analyzeChain(chain, { today: '2099-01-01' });
  const b = o.analyzeChain(chain, { today: '2099-01-01' });
  assert.deepEqual(a.triggers, b.triggers);
});
