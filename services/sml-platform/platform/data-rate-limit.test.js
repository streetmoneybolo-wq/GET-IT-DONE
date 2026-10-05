'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDataRateLimit } = require('./data-rate-limit');
const req = (ip, forged) => ({ headers: { 'x-forwarded-for': (forged ? forged + ', ' : '') + ip }, socket: { remoteAddress: '10.0.0.1' } });

test('limits per address and resets each window', () => {
  let t = 120_000;
  const rl = createDataRateLimit({ limit: 3, windowMs: 60_000, now: () => t });
  for (let i = 0; i < 3; i++) assert.equal(rl.take(req('1.1.1.1')).ok, true);
  const over = rl.take(req('1.1.1.1'));
  assert.equal(over.ok, false); assert.ok(over.retryAfterSec >= 1 && over.retryAfterSec <= 60);
  assert.equal(rl.take(req('2.2.2.2')).ok, true, 'another address is unaffected');
  t += 60_000;
  assert.equal(rl.take(req('1.1.1.1')).ok, true, 'new window');
});

test('client-supplied X-Forwarded-For entries cannot be used to dodge the limit: only the proxy-appended last entry counts', () => {
  const rl = createDataRateLimit({ limit: 2 });
  assert.equal(rl.take(req('9.9.9.9', 'fake-1')).ok, true);
  assert.equal(rl.take(req('9.9.9.9', 'fake-2')).ok, true);
  assert.equal(rl.take(req('9.9.9.9', 'fake-3')).ok, false);
});

test('bearer tokens do not create fresh buckets, and the socket address is the fallback', () => {
  const rl = createDataRateLimit({ limit: 1 });
  const r = (tok) => ({ headers: { authorization: 'Bearer ' + tok }, socket: { remoteAddress: '5.5.5.5' } });
  assert.equal(rl.take(r('a'.repeat(30))).ok, true);
  assert.equal(rl.take(r('b'.repeat(30))).ok, false);
});

test('a flood of new addresses cannot lock out everyone else: when the table is full they share an overflow bucket', () => {
  const rl = createDataRateLimit({ limit: 5, maxKeys: 3, overflowMultiplier: 2 });
  for (let i = 0; i < 3; i++) rl.take(req(`10.1.0.${i}`)); // the table is now full
  let refused = 0; for (let i = 0; i < 50; i++) if (!rl.take(req(`10.2.0.${i}`)).ok) refused += 1;
  assert.ok(refused > 30, 'the flood competes with itself');
  assert.equal(rl.take(req('10.1.0.1')).ok, true, 'a known caller still has its own bucket');
});
