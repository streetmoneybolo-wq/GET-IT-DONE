'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('./academy-options-calc');

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('matches the textbook Black-Scholes values', () => {
  // S=100 K=100 T=1 r=5% sigma=20%, no dividend: call 10.4506, put 5.5735
  const call = C.price('call', 100, 100, 1, 0.05, 0, 0.2), put = C.price('put', 100, 100, 1, 0.05, 0, 0.2);
  close(call.price, 10.4506, 0.002, 'call'); close(put.price, 5.5735, 0.002, 'put');
  close(call.delta, 0.6368, 0.001, 'call delta'); close(put.delta, -0.3632, 0.001, 'put delta');
  close(call.gamma, 0.018762, 0.0001, 'gamma'); close(call.vega, 0.3752, 0.001, 'vega per point');
  close(call.theta, -0.01757, 0.0005, 'theta per day');
});

test('put-call parity holds, with and without a dividend yield', () => {
  for (const q of [0, 0.02]) {
    const S = 87.3, K = 90, T = 0.4, r = 0.043, sig = 0.31;
    const c = C.price('call', S, K, T, r, q, sig).price, p = C.price('put', S, K, T, r, q, sig).price;
    close(c - p, S * Math.exp(-q * T) - K * Math.exp(-r * T), 1e-5, 'parity q=' + q);
  }
});

test('deep in and out of the money behave', () => {
  const itm = C.price('call', 200, 100, 0.5, 0.04, 0, 0.3), otm = C.price('call', 100, 200, 0.05, 0.04, 0, 0.3);
  assert.ok(itm.delta > 0.99 && itm.price > 99);
  assert.ok(otm.price < 0.001 && otm.delta < 0.001);
  assert.ok(itm.probITM > 0.99 && otm.probITM < 0.001);
});

test('an expired option is worth its intrinsic value and nothing else', () => {
  const x = C.price('put', 90, 100, 0, 0.04, 0, 0.3);
  assert.equal(x.price, 10); assert.equal(x.extrinsic, 0); assert.equal(x.expired, true);
  assert.equal(C.price('call', 90, 100, 0, 0.04, 0, 0.3).price, 0);
});

test('implied volatility recovers the volatility that produced a price', () => {
  for (const [type, sig] of [['call', 0.18], ['put', 0.45], ['call', 1.2]]) {
    const p = C.price(type, 150, 145, 0.25, 0.04, 0.01, sig).price;
    close(C.impliedVol(type, 150, 145, 0.25, 0.04, 0.01, p), sig, 1e-4, type + sig);
  }
  assert.equal(C.impliedVol('call', 150, 145, 0.25, 0.04, 0, 0.01), null, 'below intrinsic: no volatility can produce it');
  assert.equal(C.impliedVol('call', 150, 145, 0, 0.04, 0, 5), null);
});

test('garbage input returns null, never NaN or a throw', () => {
  assert.equal(C.price('call', NaN, 100, 1, 0.04, 0, 0.2), null);
  assert.equal(C.price('call', 100, 0, 1, 0.04, 0, 0.2), null);
  assert.equal(C.price('call', 100, 100, 1, 0.04, 0, undefined), null);
  assert.equal(C.impliedVol('call', 100, 100, 1, 0.04, 0, -1), null);
});

test('scenarios: a long call loses the whole premium below the strike and breakeven is strike + premium', () => {
  const prem = 3.2, rows = C.scenarios('call', 100, 100, 0.25, 0.04, 0, 0.25, prem, 2);
  const flat = rows.find((r) => r.move === 0), down = rows.find((r) => r.move === -0.1), up = rows.find((r) => r.move === 0.1);
  close(down.plExpiry, -prem * 200, 1e-9);
  close(up.plExpiry, (110 - 100 - prem) * 200, 1e-9);
  assert.ok(flat.plExpiry < 0);
  assert.equal(C.breakeven('call', 100, prem), 103.2);
  assert.equal(C.breakeven('put', 100, prem), 96.8);
});
