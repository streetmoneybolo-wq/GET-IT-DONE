'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vi = require('./academy-vol-index');

/* Black-Scholes with a normal CDF approximation (Abramowitz-Stegun 26.2.17) */
const cdf = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
function bs(S, K, T, r, sigma) {
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T)), d2 = d1 - sigma * Math.sqrt(T);
  return { call: S * cdf(d1) - K * Math.exp(-r * T) * cdf(d2), put: K * Math.exp(-r * T) * cdf(-d2) - S * cdf(-d1) };
}
function chainFor(S, minutes, sigma, r = 0.043) {
  const T = minutes / 525_600, contracts = [];
  for (let K = 450; K <= 850; K += 1) {
    const p = bs(S, K, T, r, sigma);
    for (const [type, px] of [['call', p.call], ['put', p.put]]) {
      const bid = px > 0.03 ? Math.round((px - 0.01) * 100) / 100 : 0, ask = Math.round((px + 0.01) * 100) / 100;
      contracts.push({ type, strike: K, bid, ask });
    }
  }
  return { contracts };
}

test('a flat 20% volatility market reads about 20 (CBOE method on a Black-Scholes chain)', () => {
  const near = vi.termVariance(vi.strikesFrom(chainFor(650, 28 * 1440, 0.20)), 28 * 1440);
  const next = vi.termVariance(vi.strikesFrom(chainFor(650, 35 * 1440, 0.20)), 35 * 1440);
  assert.ok(near && next);
  assert.ok(Math.abs(Math.sqrt(near.variance) * 100 - 20) < 0.8, 'near ' + Math.sqrt(near.variance) * 100);
  const level = vi.thirtyDay(near, next);
  assert.ok(Math.abs(level - 20) < 0.8, 'level ' + level);
});

test('higher implied volatility gives a higher reading, and the two terms blend to 30 days', () => {
  const lowN = vi.termVariance(vi.strikesFrom(chainFor(650, 25 * 1440, 0.15)), 25 * 1440), lowX = vi.termVariance(vi.strikesFrom(chainFor(650, 39 * 1440, 0.15)), 39 * 1440);
  const highN = vi.termVariance(vi.strikesFrom(chainFor(650, 25 * 1440, 0.35)), 25 * 1440), highX = vi.termVariance(vi.strikesFrom(chainFor(650, 39 * 1440, 0.35)), 39 * 1440);
  const low = vi.thirtyDay(lowN, lowX), high = vi.thirtyDay(highN, highX);
  assert.ok(Math.abs(low - 15) < 0.8, 'low ' + low); assert.ok(Math.abs(high - 35) < 1.2, 'high ' + high);
  // near 20%, next 30%: 30 days sits between them
  const mixed = vi.thirtyDay(vi.termVariance(vi.strikesFrom(chainFor(650, 25 * 1440, 0.20)), 25 * 1440), vi.termVariance(vi.strikesFrom(chainFor(650, 39 * 1440, 0.30)), 39 * 1440));
  assert.ok(mixed > 20 && mixed < 30, 'mixed ' + mixed);
});

test('the bridge row format reads the same, and too few quotes is no reading rather than a guess', () => {
  const site = chainFor(650, 28 * 1440, 0.2);
  const rows = new Map();
  for (const c of site.contracts) { const r = rows.get(c.strike) || { k: c.strike }; r[c.type === 'call' ? 'c' : 'p'] = { bid: c.bid, ask: c.ask }; rows.set(c.strike, r); }
  const a = vi.termVariance(vi.strikesFrom(site), 28 * 1440), b = vi.termVariance(vi.strikesFrom({ rows: [...rows.values()] }), 28 * 1440);
  assert.ok(Math.abs(a.variance - b.variance) < 1e-9);
  assert.equal(vi.termVariance(vi.strikesFrom({ contracts: site.contracts.slice(0, 6) }), 28 * 1440), null);
  assert.equal(vi.thirtyDay(null, null), null);
});

test('term picking brackets 30 days and skips the first week', () => {
  const now = Date.parse('2026-10-08T14:00:00Z');
  const t = vi.pickTerms(['2026-10-09', '2026-10-30', '2026-11-06', '2026-11-13', '2026-12-18'], now);
  assert.deepEqual(t, { near: '2026-11-06', next: '2026-11-13' });
  const m = vi.minutesToExpiry('2026-11-06', now);
  assert.ok(m > 29 * 1440 && m < 30 * 1440, 'minutes ' + m); // 4 pm New York on Nov 6 (EST after the clock change)
});

test('the service: two chain calls per reading, cached, and change since a time from its own history', async () => {
  let t = Date.parse('2026-10-08T14:00:00Z'), calls = [];
  const chain = async (sym, exp) => { calls.push(exp || 'list'); if (!exp) return { ok: true, data: { ok: true, data: { expirations: ['2026-11-06', '2026-11-13'] } } }; return { ok: true, data: { ok: true, data: chainFor(650, vi.minutesToExpiry(exp, t), 0.18) } }; };
  const svc = vi.createVolIndex({ chain, now: () => t });
  const r = await svc.get();
  assert.equal(r.ok, true); assert.ok(Math.abs(r.level - 18) < 0.8, 'level ' + r.level);
  assert.equal(r.terms.length, 2);
  await svc.get();
  assert.deepEqual(calls, ['list', '2026-11-06', '2026-11-13'], 'second read is cached');
  t += 130_000; await svc.get();
  assert.ok(svc.changeSince(t - 200_000));
});
