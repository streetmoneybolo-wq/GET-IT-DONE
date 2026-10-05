'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDataRateLimit } = require('./data-rate-limit');
const req = (auth, ip = '1.1.1.1') => ({ headers: { ...(auth ? { authorization: auth } : {}), 'x-forwarded-for': ip }, socket: {} });

test('limits per caller, not globally, and resets each window', () => {
  let t = 120_000;
  const rl = createDataRateLimit({ limit: 3, windowMs: 60_000, now: () => t });
  const a = req('Bearer aaaaaaaaaaaaaaaaaaaa'), b = req('Bearer bbbbbbbbbbbbbbbbbbbb');
  assert.equal(rl.take(a).ok, true); assert.equal(rl.take(a).ok, true); assert.equal(rl.take(a).ok, true);
  const over = rl.take(a);
  assert.equal(over.ok, false); assert.ok(over.retryAfterSec >= 1 && over.retryAfterSec <= 60);
  assert.equal(rl.take(b).ok, true, 'another member is unaffected');
  t += 60_000;
  assert.equal(rl.take(a).ok, true, 'new window');
});

test('anonymous callers are keyed by IP; token callers by token hash, never the raw token', () => {
  const rl = createDataRateLimit({ limit: 1 });
  assert.equal(rl.take(req('', '9.9.9.9')).ok, true);
  assert.equal(rl.take(req('', '9.9.9.9')).ok, false);
  assert.equal(rl.take(req('', '8.8.8.8')).ok, true);
  assert.doesNotMatch(rl.keyOf(req('Bearer secrettokensecrettoken')), /secret/);
});

test('the key table is bounded so a flood of new callers cannot grow memory', () => {
  const rl = createDataRateLimit({ limit: 5, maxKeys: 3 });
  for (let i = 0; i < 3; i++) rl.take(req('', `10.0.0.${i}`));
  assert.equal(rl.take(req('', '10.0.0.99')).ok, false);
  assert.equal(rl.take(req('', '10.0.0.1')).ok, true);
});
