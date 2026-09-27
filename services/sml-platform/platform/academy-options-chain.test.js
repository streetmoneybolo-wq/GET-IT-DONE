'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalize, findSpot, expirations } = require('./academy-options-chain');

const MOOMOO = {
  underlying: 123.45, freshness: 'live', expirations: ['2026-10-02', '2026-10-09', '2026-10-16'], expiration: '2026-10-02',
  contracts: [
    { strike: 120, type: 'call', expiration: '2026-10-02', bid: 4.1, ask: 4.3, last: 4.2, volume: 1200, open_interest: 5400, iv: 0.41, delta: 0.62, gamma: 0.04, theta: -0.09, vega: 0.11, rho: 0.02 },
    { strike: 120, type: 'put', expiration: '2026-10-02', bid: 0.7, ask: 0.8, last: 0.75, volume: 800, open_interest: 3100, iv: 0.43, delta: -0.38, gamma: 0.04, theta: -0.08, vega: 0.1 },
    { strike: 125, type: 'CALL', expiration: '2026-10-02', bid: 1.4, ask: 1.5, volume: 3000, open_interest: 9000, iv: 0.39, delta: 0.41 },
    { strike: 125, type: 'put', expiration: '2026-10-02', bid: 2.9, ask: 3.1, volume: 500, open_interest: 2000, iv: 0.42, delta: -0.59 }
  ]
};

test('moomoo chain: type-tagged contracts become paired rows with real bid/ask/oi/greeks', () => {
  const rows = normalize(MOOMOO);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.strike), [120, 125]);
  assert.equal(rows[0].expiry, '2026-10-02');
  assert.equal(rows[0].call.bid, 4.1);
  assert.equal(rows[0].call.ask, 4.3);
  assert.equal(rows[0].call.oi, 5400);
  assert.equal(rows[0].call.iv, 0.41);
  assert.equal(rows[0].call.delta, 0.62);
  assert.equal(rows[0].put.bid, 0.7);
  assert.equal(rows[0].put.delta, -0.38);
  assert.equal(rows[1].call.volume, 3000);
  assert.equal(findSpot(MOOMOO), 123.45);
  assert.deepEqual(expirations(MOOMOO, rows), ['2026-10-02', '2026-10-09', '2026-10-16']);
});

test('the bridge envelope ({ ok, data }) and a wrapped data object still resolve', () => {
  const rows = normalize({ ok: true, symbol: 'X', data: MOOMOO });
  assert.equal(rows.length, 2);
  assert.equal(findSpot({ ok: true, data: MOOMOO }), 123.45);
  assert.deepEqual(expirations({ ok: true, data: MOOMOO }, rows), ['2026-10-02', '2026-10-09', '2026-10-16']);
});

test('massive v3 snapshot: nested details / last_quote / greeks map onto the same rows', () => {
  const massive = { results: [
    { details: { strike_price: 120, expiration_date: '2026-10-02', contract_type: 'call', ticker: 'O:X261002C00120000' }, last_quote: { bid: 4.1, ask: 4.3 }, day: { volume: 1200 }, open_interest: 5400, implied_volatility: 0.41, greeks: { delta: 0.62, gamma: 0.04, theta: -0.09, vega: 0.11 }, underlying_asset: { price: 123.45 } },
    { details: { strike_price: 120, expiration_date: '2026-10-02', contract_type: 'put' }, last_quote: { bid: 0.7, ask: 0.8 }, day: { volume: 800 }, open_interest: 3100, implied_volatility: 0.43, greeks: { delta: -0.38 } }
  ] };
  const rows = normalize(massive);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].strike, 120);
  assert.equal(rows[0].call.bid, 4.1);
  assert.equal(rows[0].call.volume, 1200);
  assert.equal(rows[0].call.oi, 5400);
  assert.equal(rows[0].call.gamma, 0.04);
  assert.equal(rows[0].put.ask, 0.8);
  assert.equal(findSpot(massive), 123.45);
});

test('paired rows (nested call/put objects, or callBid/putAsk keys) are read without inventing values', () => {
  const rows = normalize([
    { strike: 50, expiration: '2026-11-20', call: { bid: 1, ask: 1.2 }, put: { bid: 0.9, ask: 1.1 } },
    { strike: 55, expirationDate: '2026-11-20', callBid: 0.4, callAsk: 0.5, putBid: 3.9, putAsk: 4.2 },
    { strike: 60, expiry: '2026-11-20' }
  ]);
  assert.equal(rows.length, 2, 'a strike with no quotes on either side is not a row');
  assert.equal(rows[0].call.ask, 1.2);
  assert.equal(rows[1].put.ask, 4.2);
  assert.equal(rows[1].call.volume, null);
});

test('non-ISO expirations are normalized to YYYY-MM-DD so the picker groups them', () => {
  const rows = normalize({ contracts: [{ strike: 10, type: 'call', expiration: '20261120', bid: 1, ask: 1.1 }, { strike: 10, type: 'put', expiration: '2026-11-20T00:00:00Z', bid: 1, ask: 1.1 }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].expiry, '2026-11-20');
});
