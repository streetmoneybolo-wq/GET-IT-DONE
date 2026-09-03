'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { sign, callDispute } = require('./verify-dispute-live');
const { verifySignature } = require('../platform/wordpress-gateway');

const NOW_MS = 1_788_000_000_000;
const TIMESTAMP = String(Math.floor(NOW_MS / 1000));

test('sign() produces a signature the platform verifier itself accepts', () => {
  const secret = 'billing-secret';
  const rawBody = JSON.stringify({ limit: 50 });
  assert.deepEqual(
    verifySignature({ secret, timestamp: TIMESTAMP, signature: sign(secret, TIMESTAMP, rawBody), rawBody, now: NOW_MS }),
    { ok: true }
  );
});

test('sign() fails closed on a wrong secret, an altered body, and a stale timestamp', () => {
  const rawBody = JSON.stringify({ limit: 50 });
  const good = sign('billing-secret', TIMESTAMP, rawBody);
  assert.deepEqual(
    verifySignature({ secret: 'other', timestamp: TIMESTAMP, signature: good, rawBody, now: NOW_MS }),
    { ok: false, status: 401, error: 'invalid_signature' }
  );
  assert.deepEqual(
    verifySignature({ secret: 'billing-secret', timestamp: TIMESTAMP, signature: good, rawBody: '{"limit":1}', now: NOW_MS }),
    { ok: false, status: 401, error: 'invalid_signature' }
  );
  assert.equal(
    verifySignature({ secret: 'billing-secret', timestamp: TIMESTAMP, signature: good, rawBody, now: NOW_MS + 10 * 60 * 1000 }).error,
    'stale_request'
  );
});

test('callDispute sends the required headers and never places the secret in the request body', async () => {
  const captured = {};
  const fetchImpl = async (url, options) => {
    captured.url = url;
    captured.options = options;
    return { status: 200, async json() { return { ok: true, cases: [] }; } };
  };
  const result = await callDispute({ secret: 's3cret-value', action: 'list', payload: { limit: 50 }, fetchImpl, now: () => NOW_MS });

  assert.deepEqual(result, { status: 200, body: { ok: true, cases: [] } });
  assert.match(captured.url, /\/v1\/billing\/disputes\/list$/);
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers['content-type'], 'application/json');
  assert.match(captured.options.headers['x-sml-timestamp'], /^[0-9]{10}$/);
  assert.match(captured.options.headers['x-sml-signature'], /^sha256=[a-f0-9]{64}$/);
  assert.doesNotMatch(captured.options.body, /s3cret-value/, 'the secret is used to sign, never sent');
  assert.equal(captured.options.body, '{"limit":50}', 'an object body, not the empty array PHP produced');
});
