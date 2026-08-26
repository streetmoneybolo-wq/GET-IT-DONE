/* Stripe webhook tests.  Run: node --test  (from platform/)
 *
 * No network and no clock: `now` is injected, so the replay window is asserted
 * exactly rather than hopefully. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const S = require('./stripe-webhook.js');

const SECRET = 'whsec_testsecret';
const NOW_MS = 1_700_000_000_000;
const T = Math.floor(NOW_MS / 1000);

const body = (over = {}) => JSON.stringify(Object.assign({
  id: 'evt_1PabcdEFghijkLM',
  type: 'invoice.paid',
  created: T,
  livemode: true,
  data: { object: { id: 'in_1', subscription: 'sub_1', amount_paid: 9999 } }
}, over));

const header = (raw, ts = T, secret = SECRET) => `t=${ts},v1=${S.sign(secret, ts, raw)}`;

/* ---------- the bytes ---------- */

test('a signature computed over the exact raw bytes verifies', () => {
  const raw = body();
  const r = S.verifySignature({ secret: SECRET, header: header(raw), rawBody: raw, now: NOW_MS });
  assert.equal(r.ok, true);
  assert.equal(r.timestamp, T);
});

/* This is the failure everyone ships at least once: JSON.parse then
   re-serialise, and the bytes no longer match what Stripe signed. */
test('re-serialising the JSON breaks the signature', () => {
  const raw = body();
  const reserialised = JSON.stringify(JSON.parse(raw).constructor === Object ? JSON.parse(raw) : {});
  const r = S.verifySignature({ secret: SECRET, header: header(raw), rawBody: reserialised, now: NOW_MS });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'signature_mismatch');
});

test('a single altered byte is rejected', () => {
  const raw = body();
  const r = S.verifySignature({ secret: SECRET, header: header(raw), rawBody: raw + ' ', now: NOW_MS });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'signature_mismatch');
});

test('a non-string body is refused rather than coerced', () => {
  const r = S.verifySignature({ secret: SECRET, header: 't=1,v1=' + 'a'.repeat(64), rawBody: { a: 1 }, now: NOW_MS });
  assert.equal(r.error, 'raw_body_required');
});

/* ---------- secret rotation: the one that breaks silently ---------- */

test('accepts when ANY v1 in the header matches — secret rotation', () => {
  const raw = body();
  const old = S.sign('whsec_old', T, raw);
  const cur = S.sign(SECRET, T, raw);
  const r = S.verifySignature({ secret: SECRET, header: `t=${T},v1=${old},v1=${cur}`, rawBody: raw, now: NOW_MS });
  assert.equal(r.ok, true, 'a rotating secret must not reject half of all deliveries');
});

test('rejects when no v1 matches, however many are offered', () => {
  const raw = body();
  const h = `t=${T},v1=${'a'.repeat(64)},v1=${'b'.repeat(64)}`;
  assert.equal(S.verifySignature({ secret: SECRET, header: h, rawBody: raw, now: NOW_MS }).ok, false);
});

test('v0 signatures are ignored — only v1 counts', () => {
  const raw = body();
  const h = `t=${T},v0=${S.sign(SECRET, T, raw)}`;
  assert.equal(S.verifySignature({ secret: SECRET, header: h, rawBody: raw, now: NOW_MS }).error, 'invalid_signature_header');
});

/* ---------- replay window ---------- */

test('a delivery older than the tolerance is rejected', () => {
  const raw = body();
  const old = T - 400;
  const r = S.verifySignature({ secret: SECRET, header: header(raw, old), rawBody: raw, now: NOW_MS });
  assert.equal(r.error, 'timestamp_out_of_tolerance');
});

test('clock skew is tolerated in both directions', () => {
  const raw = body();
  for (const ts of [T - 299, T + 299]) {
    assert.equal(S.verifySignature({ secret: SECRET, header: header(raw, ts), rawBody: raw, now: NOW_MS }).ok, true);
  }
});

test('the tolerance is configurable', () => {
  const raw = body();
  const ts = T - 400;
  assert.equal(S.verifySignature({ secret: SECRET, header: header(raw, ts), rawBody: raw, now: NOW_MS, tolerance: 600 }).ok, true);
});

/* ---------- header + config guards ---------- */

test('a missing signing secret is a 503, not a rejection', () => {
  const raw = body();
  const r = S.verifySignature({ secret: '', header: header(raw), rawBody: raw, now: NOW_MS });
  assert.equal(r.status, 503);
  assert.equal(r.error, 'stripe_unconfigured', 'unconfigured is our fault, not the callers');
});

test('a malformed header is rejected before any hashing', () => {
  for (const h of ['', 'garbage', 't=abc,v1=' + 'a'.repeat(64), `t=${T}`, `t=${T},v1=short`]) {
    const r = S.verifySignature({ secret: SECRET, header: h, rawBody: body(), now: NOW_MS });
    assert.equal(r.ok, false, `accepted: ${h}`);
  }
});

test('the header parser is not confused by whitespace or extra fields', () => {
  const p = S.parseSignatureHeader(` t=${T} , v1=${'a'.repeat(64)} , foo=bar `);
  assert.equal(p.timestamp, String(T));
  assert.equal(p.signatures.length, 1);
});

/* ---------- envelope ---------- */

test('a valid event is parsed and hashed', () => {
  const raw = body();
  const r = S.parseEvent(raw);
  assert.equal(r.ok, true);
  assert.equal(r.event.id, 'evt_1PabcdEFghijkLM');
  assert.equal(r.event.type, 'invoice.paid');
  assert.equal(r.event.livemode, true);
  assert.match(r.event.payloadHash, /^[0-9a-f]{64}$/);
  assert.equal(r.event.payloadHash, crypto.createHash('sha256').update(raw).digest('hex'));
});

/* Connect: which account the event belongs to decides whose money moved, so it
   must survive parsing rather than being flattened away. */
test('the connected account id is carried through', () => {
  const r = S.parseEvent(body({ account: 'acct_1Creator' }));
  assert.equal(r.event.account, 'acct_1Creator');
  assert.equal(S.parseEvent(body()).event.account, null, 'platform events have no account');
});

test('malformed envelopes are rejected', () => {
  assert.equal(S.parseEvent('not json').error, 'invalid_json');
  assert.equal(S.parseEvent('[]').error, 'invalid_event');
  assert.equal(S.parseEvent(body({ id: 'sub_1' })).error, 'invalid_event', 'id must be an evt_');
  assert.equal(S.parseEvent(body({ type: '' })).error, 'invalid_event');
  assert.equal(S.parseEvent(body({ created: 0 })).error, 'invalid_event');
  assert.equal(S.parseEvent(JSON.stringify({ id: 'evt_1', type: 'x', created: T })).error, 'invalid_event', 'data is required');
});

test('livemode defaults to false rather than being assumed', () => {
  assert.equal(S.parseEvent(body({ livemode: undefined })).event.livemode, false);
});

/* ---------- constant-time compare ---------- */

test('secureEqual is length-safe and correct', () => {
  assert.equal(S.secureEqual('abc', 'abc'), true);
  assert.equal(S.secureEqual('abc', 'abd'), false);
  assert.equal(S.secureEqual('abc', 'abcd'), false, 'differing lengths must not throw');
});
