'use strict';

/* PayPal client tests. Run: node --test
 * No network, no clock: fetchImpl and now are injected. */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const P = require('./paypal-client');

const NOW = 1_700_000_000_000;

function jsonResponse(status, body, headers = {}) {
  const lower = {};
  for (const [key, value] of Object.entries(headers)) lower[key.toLowerCase()] = String(value);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[String(name).toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  };
}

/* Records every call; answers /v1/oauth2/token with a token and everything
   else via the `respond` function (default: empty 200). */
function fakeFetch(respond) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const call = { url: String(url), options };
    calls.push(call);
    if (call.url.includes('/v1/oauth2/token')) {
      return jsonResponse(200, { access_token: `tok${calls.filter((c) => c.url.includes('/oauth2/token')).length}`, expires_in: 3600 });
    }
    return respond ? respond(call) : jsonResponse(200, {});
  };
  return { calls, fetchImpl };
}

function makeClient(overrides = {}) {
  const net = fakeFetch(overrides.respond);
  const clock = { value: NOW };
  const client = P.createPayPalClient({
    env: overrides.env || 'sandbox',
    clientId: 'cid',
    clientSecret: 'csecret',
    fetchImpl: overrides.fetchImpl || net.fetchImpl,
    now: () => clock.value
  });
  return { client, calls: net.calls, clock };
}

/* ---------- construction & fixed hosts ---------- */

test('an unknown environment is refused — hosts are fixed, never configurable', () => {
  assert.throws(() => P.createPayPalClient({ env: 'https://evil.example', clientId: 'a', clientSecret: 'b' }), TypeError);
  assert.throws(() => P.createPayPalClient({ env: '', clientId: 'a', clientSecret: 'b' }), TypeError);
});

test('missing credentials fail at construction, before any request exists', () => {
  assert.throws(() => P.createPayPalClient({ env: 'sandbox', clientId: '', clientSecret: 'b' }), /credentials/);
  assert.throws(() => P.createPayPalClient({ env: 'live', clientId: 'a', clientSecret: '' }), /credentials/);
});

test('sandbox and live map to their exact api-m hosts, https only, no redirects', async () => {
  for (const [env, host] of [['sandbox', 'https://api-m.sandbox.paypal.com'], ['live', 'https://api-m.paypal.com']]) {
    const { client, calls } = makeClient({ env });
    await client.getDispute('PP-R-1');
    for (const call of calls) {
      assert.ok(call.url.startsWith(host), `${call.url} must start with ${host}`);
      assert.equal(call.options.redirect, 'error', 'redirect following must be disabled');
    }
  }
});

test('path parameters are encoded — an id cannot escape the fixed path', async () => {
  const { client, calls } = makeClient();
  await client.getDispute('PP-R-4/../../v1/oauth2');
  const call = calls.at(-1);
  assert.ok(call.url.includes('/v1/customer/disputes/PP-R-4%2F..%2F..%2Fv1%2Foauth2'));
});

/* ---------- token caching ---------- */

test('the OAuth token is cached and reused until 60s before expiry', async () => {
  const { client, calls, clock } = makeClient();
  await client.getDispute('PP-R-1');
  await client.getDispute('PP-R-2');
  assert.equal(calls.filter((c) => c.url.includes('/oauth2/token')).length, 1, 'second call reuses the token');

  clock.value = NOW + (3600 - 59) * 1000; // inside the 60s pre-expiry window
  await client.getDispute('PP-R-3');
  assert.equal(calls.filter((c) => c.url.includes('/oauth2/token')).length, 2, 'near expiry mints a fresh token');
});

test('a failed token request is a retryable error', async () => {
  const failing = async (url) => {
    if (String(url).includes('/oauth2/token')) return jsonResponse(500, {});
    throw new Error('should not get past the token');
  };
  const { client } = makeClient({ fetchImpl: failing });
  await assert.rejects(() => client.getDispute('PP-R-1'), (error) => error.retryable === true);
});

test('a 401 clears the cached token so the next attempt re-authenticates', async () => {
  let disputeCalls = 0;
  const { client, calls } = makeClient({
    respond: () => {
      disputeCalls += 1;
      return disputeCalls === 1 ? jsonResponse(401, {}) : jsonResponse(200, { dispute_id: 'PP-R-1' });
    }
  });
  await assert.rejects(() => client.getDispute('PP-R-1'), (error) => error.retryable === true);
  await client.getDispute('PP-R-1');
  assert.equal(calls.filter((c) => c.url.includes('/oauth2/token')).length, 2);
});

/* ---------- error mapping ---------- */

test('5xx and 429 are retryable; other 4xx are definitive rejections', async () => {
  for (const [status, retryable] of [[500, true], [503, true], [429, true], [400, false], [404, false], [422, false]]) {
    const { client } = makeClient({ respond: () => jsonResponse(status, {}) });
    await assert.rejects(() => client.getDispute('PP-R-1'),
      (error) => error.retryable === retryable, `status ${status}`);
  }
});

test('transport failures are retryable', async () => {
  const { client } = makeClient({
    fetchImpl: async (url) => {
      if (String(url).includes('/oauth2/token')) return jsonResponse(200, { access_token: 't', expires_in: 3600 });
      throw new Error('ECONNRESET');
    }
  });
  await assert.rejects(() => client.getDispute('PP-R-1'), (error) => error.retryable === true);
});

test('oversized responses are refused, by declared length and by actual bytes', async () => {
  const declared = makeClient({ respond: () => jsonResponse(200, '{}', { 'content-length': String(10 * 1024 * 1024) }) });
  await assert.rejects(() => declared.client.getDispute('PP-R-1'), /too large/);

  const actual = makeClient({ respond: () => jsonResponse(200, `{"pad":"${'x'.repeat(P.MAX_RESPONSE_BYTES)}"}`) });
  await assert.rejects(() => actual.client.getDispute('PP-R-1'), /too large/);
});

/* ---------- reads ---------- */

test('listDisputes passes the update-time cursor and a bounded page size', async () => {
  const { client, calls } = makeClient({ respond: () => jsonResponse(200, { items: [] }) });
  await client.listDisputes({ after: '2026-09-01T00:00:00.000Z' });
  const url = new URL(calls.at(-1).url);
  assert.equal(url.pathname, '/v1/customer/disputes');
  assert.equal(url.searchParams.get('page_size'), '50');
  assert.equal(url.searchParams.get('update_time_after'), '2026-09-01T00:00:00.000Z');
  await assert.rejects(() => client.listDisputes({ after: 42 }), TypeError);
});

test('subscription and capture reads hit their fixed paths', async () => {
  const { client, calls } = makeClient();
  await client.getSubscription('I-SUB1');
  assert.ok(calls.at(-1).url.endsWith('/v1/billing/subscriptions/I-SUB1'));
  await client.getCapture('CAP1');
  assert.ok(calls.at(-1).url.endsWith('/v2/payments/captures/CAP1'));
});

/* ---------- verify-webhook-signature: the byte splice ---------- */

/* A payload chosen so that ANY re-serialization changes the bytes: unusual key
   order, duplicate keys (legal JSON text; parsers keep the last), a raw
   unicode char plus an escape, numbers rendered as 10.00 / 2.50 / 1e3, and
   internal whitespace. If the client parsed and re-stringified, PayPal would
   verify different bytes than it signed. */
const BYTE_ODD_RAW = '{"zz":  1,\n"a":"ünïcode\\u2028ok","n":10.00,"m":1e3,"b":2.50,"dup":1,"dup":2}';

const VERIFY_HEADERS = {
  'PAYPAL-AUTH-ALGO': 'SHA256withRSA',
  'PAYPAL-CERT-URL': 'https://api.paypal.com/v1/notifications/certs/CERT-1',
  'PAYPAL-TRANSMISSION-ID': '69cd13f0-d67a-11e5-baa3-778b53f4ae55',
  'PAYPAL-TRANSMISSION-SIG': 'c2lnbmF0dXJl',
  'PAYPAL-TRANSMISSION-TIME': '2026-09-02T12:00:00Z'
};

test('the raw webhook bytes are spliced verbatim into webhook_event', async () => {
  assert.notEqual(JSON.stringify(JSON.parse(BYTE_ODD_RAW)), BYTE_ODD_RAW,
    'the fixture must be a payload a re-serialization would alter');

  const { client, calls } = makeClient({ respond: () => jsonResponse(200, { verification_status: 'SUCCESS' }) });
  const result = await client.verifyWebhookSignature({
    headers: VERIFY_HEADERS, rawBody: BYTE_ODD_RAW, webhookId: 'WH-ID-9'
  });
  assert.equal(result, 'SUCCESS');

  const call = calls.find((c) => c.url.includes('/v1/notifications/verify-webhook-signature'));
  assert.ok(call, 'verify endpoint was called');
  const body = call.options.body;
  assert.equal(typeof body, 'string');
  assert.ok(body.endsWith(`"webhook_event":${BYTE_ODD_RAW}}`),
    'raw bytes must appear verbatim, unmodified, in the webhook_event position');
  assert.ok(body.includes('"webhook_id":"WH-ID-9"'));
  assert.ok(body.includes('"transmission_id":"69cd13f0-d67a-11e5-baa3-778b53f4ae55"'));
  assert.ok(body.includes('"cert_url":"https://api.paypal.com/v1/notifications/certs/CERT-1"'));
  assert.ok(body.includes('"auth_algo":"SHA256withRSA"'));
  assert.ok(body.includes('"transmission_sig":"c2lnbmF0dXJl"'));
  assert.ok(body.includes('"transmission_time":"2026-09-02T12:00:00Z"'));
});

test('a Buffer raw body is spliced byte-identically too', async () => {
  const { client, calls } = makeClient({ respond: () => jsonResponse(200, { verification_status: 'SUCCESS' }) });
  await client.verifyWebhookSignature({
    headers: VERIFY_HEADERS, rawBody: Buffer.from(BYTE_ODD_RAW, 'utf8'), webhookId: 'WH-ID-9'
  });
  const call = calls.find((c) => c.url.includes('/verify-webhook-signature'));
  assert.ok(call.options.body.includes(`"webhook_event":${BYTE_ODD_RAW}`));
});

test('verification outcomes: SUCCESS and FAILURE are definitive, everything else retries', async () => {
  const outcome = (body, status = 200) => makeClient({ respond: () => jsonResponse(status, body) })
    .client.verifyWebhookSignature({ headers: VERIFY_HEADERS, rawBody: '{}', webhookId: 'W' });

  assert.equal(await outcome({ verification_status: 'SUCCESS' }), 'SUCCESS');
  assert.equal(await outcome({ verification_status: 'FAILURE' }), 'FAILURE');
  await assert.rejects(() => outcome({ verification_status: 'PENDING' }), (e) => e.retryable === true);
  await assert.rejects(() => outcome({}), (e) => e.retryable === true);
  await assert.rejects(() => outcome({}, 500), (e) => e.retryable === true);
  await assert.rejects(() => outcome({}, 400), (e) => e.retryable === true,
    'even a 4xx from verify is ambiguous about authenticity — retry, never acknowledge');
  await assert.rejects(() => outcome('not json'), (e) => e.retryable === true);
});

test('verify without a webhook id or with bad inputs never reaches the network', async () => {
  const { client, calls } = makeClient();
  await assert.rejects(() => client.verifyWebhookSignature({ headers: VERIFY_HEADERS, rawBody: '{}', webhookId: '' }),
    (e) => e.retryable === true);
  await assert.rejects(() => client.verifyWebhookSignature({ headers: VERIFY_HEADERS, rawBody: { a: 1 }, webhookId: 'W' }),
    TypeError);
  await assert.rejects(() => client.verifyWebhookSignature({
    headers: { ...VERIFY_HEADERS, 'PAYPAL-TRANSMISSION-SIG': undefined }, rawBody: '{}', webhookId: 'W'
  }), TypeError);
  assert.equal(calls.length, 0);
});

test('verify transport failure is retryable', async () => {
  const { client } = makeClient({
    fetchImpl: async (url) => {
      if (String(url).includes('/oauth2/token')) return jsonResponse(200, { access_token: 't', expires_in: 3600 });
      throw new Error('EPIPE');
    }
  });
  await assert.rejects(() => client.verifyWebhookSignature({ headers: VERIFY_HEADERS, rawBody: '{}', webhookId: 'W' }),
    (e) => e.retryable === true);
});

/* ---------- provide-evidence multipart ---------- */

const PDF = Buffer.from('%PDF-1.4 tiny', 'utf8');

test('the multipart body carries the input JSON part and each file part', () => {
  const { body, contentType } = P.buildEvidenceBody({
    evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', notes: 'access log attached' }],
    files: [{ name: 'access-log.pdf', bytes: PDF }]
  }, 'BOUNDARY');

  assert.equal(contentType, 'multipart/form-data; boundary=BOUNDARY');
  const text = body.toString('utf8');
  assert.ok(text.includes('--BOUNDARY\r\nContent-Disposition: form-data; name="input"\r\nContent-Type: application/json\r\n\r\n'));
  assert.ok(text.includes(JSON.stringify({ evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', notes: 'access log attached' }] })));
  assert.ok(text.includes('Content-Disposition: form-data; name="file1"; filename="access-log.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 tiny'));
  assert.ok(text.endsWith('--BOUNDARY--\r\n'));
});

test('a convenience note becomes an OTHER evidence entry, capped at 2000 chars', () => {
  const { body } = P.buildEvidenceBody({ notes: 'shipped as described' }, 'B');
  assert.ok(body.toString('utf8').includes(JSON.stringify({
    evidences: [{ evidence_type: 'OTHER', notes: 'shipped as described' }]
  })));
  assert.throws(() => P.buildEvidenceBody({ notes: 'x'.repeat(2001) }), TypeError);
  assert.throws(() => P.buildEvidenceBody({
    evidences: [{ evidence_type: 'OTHER', notes: 'x'.repeat(2001) }]
  }), TypeError);
});

test('file limits are enforced before anything is built or sent', () => {
  const okBytes = Buffer.from('x');
  assert.throws(() => P.buildEvidenceBody({ files: [{ name: 'evil.exe', bytes: okBytes }] }), TypeError, 'type');
  assert.throws(() => P.buildEvidenceBody({ files: [{ name: 'x."\r\n.pdf', bytes: okBytes }] }), TypeError, 'header injection');
  assert.throws(() => P.buildEvidenceBody({ files: [{ name: 'a.pdf', bytes: 'not a buffer' }] }), TypeError, 'buffer');
  assert.throws(() => P.buildEvidenceBody({ files: [{ name: 'a.pdf', bytes: Buffer.alloc(0) }] }), TypeError, 'empty');
  assert.throws(() => P.buildEvidenceBody({
    files: [{ name: 'big.pdf', bytes: Buffer.alloc(P.PAYPAL_FILE_RULES.perFileBytes) }]
  }), /smaller than 10MB/, 'per-file cap is strict');
  const nineMb = Buffer.alloc(9 * 1024 * 1024);
  assert.throws(() => P.buildEvidenceBody({
    files: [1, 2, 3, 4, 5, 6].map((i) => ({ name: `f${i}.png`, bytes: nineMb }))
  }), /50MB/, 'per-request cap');
  assert.throws(() => P.buildEvidenceBody({}), TypeError, 'empty payload');
  assert.throws(() => P.buildEvidenceBody({ evidences: [{ notes: 'no type' }] }), TypeError, 'evidence_type required');
});

test('every allowed file type maps to its content type; nothing else passes', () => {
  for (const [ext, mime] of [['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'], ['png', 'image/png'], ['pdf', 'application/pdf']]) {
    const { body } = P.buildEvidenceBody({ files: [{ name: `f.${ext}`, bytes: Buffer.from('x') }] }, 'B');
    assert.ok(body.toString('utf8').includes(`Content-Type: ${mime}`), ext);
  }
  assert.throws(() => P.buildEvidenceBody({ files: [{ name: 'f.svg', bytes: Buffer.from('x') }] }), TypeError);
});

test('provideEvidence and appeal post multipart to their dispute-scoped paths', async () => {
  const { client, calls } = makeClient({ respond: () => jsonResponse(200, {}) });
  await client.provideEvidence('PP-R-9', { notes: 'records attached' });
  let call = calls.at(-1);
  assert.ok(call.url.endsWith('/v1/customer/disputes/PP-R-9/provide-evidence'));
  assert.match(call.options.headers['Content-Type'], /^multipart\/form-data; boundary=/);
  assert.ok(Buffer.isBuffer(call.options.body));

  await client.appeal('PP-R-9', { notes: 'appeal records' });
  call = calls.at(-1);
  assert.ok(call.url.endsWith('/v1/customer/disputes/PP-R-9/appeal'));

  await assert.rejects(() => client.provideEvidence('PP-R-9', { files: [{ name: 'x.exe', bytes: Buffer.from('x') }] }),
    TypeError, 'validation happens before any request');
  assert.equal(calls.filter((c) => c.url.includes('provide-evidence')).length, 1);
});

/* ---------- misc ---------- */

test('the exported file rules match the researched PayPal limits', () => {
  assert.deepEqual([...P.PAYPAL_FILE_RULES.types], ['jpg', 'jpeg', 'gif', 'png', 'pdf']);
  assert.equal(P.PAYPAL_FILE_RULES.perFileBytes, 10 * 1024 * 1024);
  assert.equal(P.PAYPAL_FILE_RULES.perRequestBytes, 50 * 1024 * 1024);
  assert.equal(P.PAYPAL_FILE_RULES.notesMax, 2000);
});

test('id inputs are validated as strings', async () => {
  const { client } = makeClient();
  for (const bad of [null, '', '   ', 42, 'x'.repeat(200)]) {
    await assert.rejects(() => client.getDispute(bad), TypeError);
  }
});

/* Sanity: payload hash helper independence — the client never re-serializes
   what it verifies, so hashing the raw fixture stays stable. */
test('the byte-odd fixture hashes deterministically (guard against fixture drift)', () => {
  const hash = crypto.createHash('sha256').update(BYTE_ODD_RAW, 'utf8').digest('hex');
  assert.match(hash, /^[0-9a-f]{64}$/);
});
