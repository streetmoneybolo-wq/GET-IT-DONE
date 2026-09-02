'use strict';

/* PayPal webhook handler tests. Run: node --test
 * No network, no clock, no database: every dependency is a small fake and
 * `now` is injected. A shared `ops` log records the order of everything —
 * queries, verify calls, dispute handoffs — so ordering (handoff strictly
 * after COMMIT) is asserted, not assumed. */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const W = require('./paypal-webhook');

const NOW = 1_700_000_000_000;

function goodHeaders(over = {}) {
  return Object.assign({
    'paypal-transmission-id': '69cd13f0-d67a-11e5-baa3-778b53f4ae55',
    'paypal-transmission-time': new Date(NOW).toISOString(),
    'paypal-cert-url': 'https://api.paypal.com/v1/notifications/certs/CERT-1',
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-transmission-sig': 'c2lnbmF0dXJl'
  }, over);
}

function goodBody(over = {}) {
  return JSON.stringify(Object.assign({
    id: 'WH-58D329510W468432D-8HN650336L201105X',
    event_type: 'CUSTOMER.DISPUTE.CREATED',
    resource_type: 'dispute',
    create_time: new Date(NOW - 60_000).toISOString(),
    resource: {
      dispute_id: 'PP-R-123',
      update_time: new Date(NOW - 30_000).toISOString(),
      status: 'OPEN'
    }
  }, over));
}

function fakeRequest(headers = goodHeaders(), ip = '203.0.113.9') {
  return { headers, socket: { remoteAddress: ip } };
}

function fakeResponse() {
  return {
    status: 0,
    body: null,
    writeHead(status) { this.status = status; },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; }
  };
}

function harness(options = {}) {
  const ops = [];
  let connects = 0;
  const client = {
    async query(sql, values) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      ops.push({ op: 'query', text, values });
      if (text.startsWith('INSERT INTO paypal_events')) {
        return options.duplicate ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ event_id: values[0] }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() { ops.push({ op: 'release' }); }
  };
  const pool = { async connect() { connects += 1; return client; } };
  const store = {
    async appendChained(_client, args) {
      ops.push({ op: 'appendChained', args });
      if (options.storeError) throw new Error('forced store failure');
      return { id: 1, integrityHash: 'h'.repeat(64) };
    }
  };
  const disputeCases = {
    async applyPayPalDispute(resource, meta) {
      ops.push({ op: 'handoff', resource, meta });
      if (options.handoffError) throw new Error('forced handoff failure');
      return { caseId: 11, changed: true, stale: false };
    }
  };
  const paypalClient = {
    async verifyWebhookSignature(args) {
      ops.push({ op: 'verify', args });
      if (options.verifyError) throw Object.assign(new Error('verify down'), { retryable: true });
      if (options.verifyPending) return options.verifyPending;
      return options.verifyResult || 'SUCCESS';
    }
  };
  const config = Object.assign({
    paypalEnabled: true,
    paypalWebhookId: 'WH-ID-1',
    paypalClientId: 'cid',
    paypalClientSecret: 'csecret'
  }, options.config);
  const clock = { value: NOW };
  const handler = W.createPayPalWebhookHandler({
    pool, config, paypalClient, disputeCases, store,
    now: () => clock.value,
    limits: options.limits
  });
  return { handler, ops, clock, connects: () => connects };
}

async function run(h, { headers, body, ip } = {}) {
  const response = fakeResponse();
  await h.handler.handle(fakeRequest(headers || goodHeaders(), ip), response, body ?? goodBody());
  return response;
}

/* ---------- the happy path, and its ordering ---------- */

test('a verified dispute event is stored, normalized, and handed off after commit', async () => {
  const h = harness();
  const raw = goodBody();
  const response = await run(h, { body: raw });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, eventId: 'WH-58D329510W468432D-8HN650336L201105X', status: 'accepted' });

  const kinds = h.ops.map((op) => op.op === 'query' ? op.text.split(' ')[0] + (op.text.startsWith('INSERT INTO paypal_events') ? ':paypal_events' : '') : op.op);
  assert.equal(kinds[0], 'verify', 'verification precedes every database write');

  const insert = h.ops.find((op) => op.op === 'query' && op.text.startsWith('INSERT INTO paypal_events'));
  assert.ok(insert, 'raw event row inserted');
  assert.match(insert.text, /ON CONFLICT \(event_id\) DO NOTHING/);

  const append = h.ops.find((op) => op.op === 'appendChained');
  assert.equal(append.args.table, 'billing_events');
  assert.equal(append.args.scopeKey, 'paypal');
  assert.equal(append.args.fields.provider, 'paypal');
  assert.equal(append.args.fields.provider_event_id, 'WH-58D329510W468432D-8HN650336L201105X');
  assert.equal(append.args.fields.event_type, 'CUSTOMER.DISPUTE.CREATED');
  assert.equal(append.args.fields.source, 'paypal');
  assert.equal(append.args.fields.payload_hash, crypto.createHash('sha256').update(raw, 'utf8').digest('hex'));
  assert.equal(append.args.fields.occurred_at, new Date(NOW - 30_000).toISOString(), 'resource.update_time wins');
  assert.equal(append.args.fields.received_at, new Date(NOW).toISOString(), 'writer-supplied received_at');

  const commitIndex = h.ops.findIndex((op) => op.op === 'query' && op.text === 'COMMIT');
  const handoffIndex = h.ops.findIndex((op) => op.op === 'handoff');
  assert.ok(commitIndex >= 0 && handoffIndex >= 0);
  assert.ok(handoffIndex > commitIndex, 'dispute handoff runs strictly AFTER the accept transaction commits');

  const handoff = h.ops[handoffIndex];
  assert.equal(handoff.resource.dispute_id, 'PP-R-123');
  assert.deepEqual(handoff.meta, {
    eventId: 'WH-58D329510W468432D-8HN650336L201105X',
    eventType: 'CUSTOMER.DISPUTE.CREATED',
    occurredAt: new Date(NOW - 30_000).toISOString()
  });
});

test('a non-dispute event is normalized but never routed to dispute cases', async () => {
  const h = harness();
  const response = await run(h, { body: goodBody({ event_type: 'PAYMENT.CAPTURE.COMPLETED' }) });
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'accepted');
  assert.ok(h.ops.some((op) => op.op === 'appendChained'));
  assert.equal(h.ops.some((op) => op.op === 'handoff'), false);
});

/* ---------- dedupe ---------- */

test('the paypal_events primary key makes a replay a 200 duplicate with no re-normalization', async () => {
  const h = harness({ duplicate: true });
  const response = await run(h);
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'duplicate');
  assert.equal(h.ops.some((op) => op.op === 'appendChained'), false, 'billing_events not written twice');
  /* The handoff still runs: a redelivery after a crashed handoff lands here,
     and applyPayPalDispute is an idempotent watermark-guarded upsert — while
     skipping it would lose the case update forever. */
  const commitIndex = h.ops.findIndex((op) => op.op === 'query' && op.text === 'COMMIT');
  const handoffIndex = h.ops.findIndex((op) => op.op === 'handoff');
  assert.ok(handoffIndex > commitIndex, 'idempotent handoff still runs post-commit on duplicates');
});

/* ---------- fail-closed matrix (no outbound call, no database touch) ---------- */

test('missing webhook id, credentials, or flag fail closed 503 before any outbound call', async () => {
  for (const config of [
    { paypalWebhookId: '' },
    { paypalClientId: '' },
    { paypalClientSecret: '' },
    { paypalEnabled: false }
  ]) {
    const h = harness({ config });
    const response = await run(h);
    assert.equal(response.status, 503, JSON.stringify(config));
    assert.equal(response.body.error, 'integration_unconfigured');
    assert.equal(h.ops.length, 0, 'no verify call, no query');
    assert.equal(h.connects(), 0);
  }
});

test('a missing paypal client also fails closed', async () => {
  const ops = [];
  const handler = W.createPayPalWebhookHandler({
    pool: { async connect() { throw new Error('must not connect'); } },
    config: { paypalEnabled: true, paypalWebhookId: 'W', paypalClientId: 'a', paypalClientSecret: 'b' },
    paypalClient: null,
    disputeCases: { applyPayPalDispute() { ops.push('handoff'); } },
    store: { appendChained() { ops.push('append'); } },
    now: () => NOW
  });
  const response = fakeResponse();
  await handler.handle(fakeRequest(), response, goodBody());
  assert.equal(response.status, 503);
  assert.deepEqual(ops, []);
});

/* ---------- header shape prechecks: rejected 400 before any outbound call ---------- */

test('malformed headers are rejected before verification is even attempted', async () => {
  const cases = [
    [{ 'paypal-transmission-id': 'not-a-uuid' }, 'invalid_transmission_id'],
    [{ 'paypal-transmission-id': '' }, 'invalid_transmission_id'],
    [{ 'paypal-transmission-time': 'yesterday' }, 'invalid_transmission_time'],
    [{ 'paypal-transmission-time': '2026-99-99T99:99:99Z' }, 'invalid_transmission_time'],
    [{ 'paypal-transmission-time': new Date(NOW - 6 * 60_000).toISOString() }, 'transmission_time_out_of_tolerance'],
    [{ 'paypal-transmission-time': new Date(NOW + 6 * 60_000).toISOString() }, 'transmission_time_out_of_tolerance'],
    [{ 'paypal-cert-url': 'http://api.paypal.com/cert' }, 'invalid_cert_url'],
    [{ 'paypal-cert-url': 'https://api.paypal.com.evil.example/cert' }, 'invalid_cert_url'],
    [{ 'paypal-cert-url': 'https://evilpaypal.com/cert' }, 'invalid_cert_url'],
    [{ 'paypal-cert-url': 'not a url' }, 'invalid_cert_url'],
    [{ 'paypal-transmission-sig': '' }, 'invalid_signature_headers'],
    [{ 'paypal-auth-algo': '' }, 'invalid_signature_headers']
  ];
  for (const [over, error] of cases) {
    const h = harness();
    const response = await run(h, { headers: goodHeaders(over) });
    assert.equal(response.status, 400, JSON.stringify(over));
    assert.equal(response.body.error, error);
    assert.equal(h.ops.some((op) => op.op === 'verify'), false, 'no outbound call');
    assert.equal(h.connects(), 0);
  }
});

test('paypal.com apex and subdomain cert hosts are accepted', async () => {
  for (const certUrl of ['https://paypal.com/cert', 'https://api.sandbox.paypal.com/cert']) {
    const h = harness();
    const response = await run(h, { headers: goodHeaders({ 'paypal-cert-url': certUrl }) });
    assert.equal(response.status, 200, certUrl);
  }
});

test('the clock skew window is honored on both sides', async () => {
  for (const delta of [-4 * 60_000, 4 * 60_000]) {
    const h = harness();
    const response = await run(h, { headers: goodHeaders({ 'paypal-transmission-time': new Date(NOW + delta).toISOString() }) });
    assert.equal(response.status, 200);
  }
});

/* ---------- envelope + body cap ---------- */

test('unparseable or shapeless bodies are rejected without an outbound call', async () => {
  for (const [body, error] of [
    ['not json', 'invalid_json'],
    ['[]', 'invalid_event'],
    [JSON.stringify({ event_type: 'X' }), 'invalid_event'],
    [JSON.stringify({ id: 'WH-1' }), 'invalid_event'],
    [JSON.stringify({ id: 'x'.repeat(200), event_type: 'X' }), 'invalid_event']
  ]) {
    const h = harness();
    const response = await run(h, { body });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, error);
    assert.equal(h.ops.some((op) => op.op === 'verify'), false);
  }
});

test('the 256KB raw-body cap rejects oversized deliveries before anything else', async () => {
  const h = harness();
  const response = await run(h, { body: `{"pad":"${'x'.repeat(W.MAX_BODY_BYTES)}"}` });
  assert.equal(response.status, 413);
  assert.equal(response.body.error, 'payload_too_large');
  assert.equal(h.ops.length, 0);
});

/* ---------- verification outcomes ---------- */

test('a definitive FAILURE is a 400 and nothing is stored', async () => {
  const h = harness({ verifyResult: 'FAILURE' });
  const response = await run(h);
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'verification_failed');
  assert.equal(h.connects(), 0, 'an unverified payload never reaches the database');
});

test('a retryable verification error is a 503 so PayPal redelivers', async () => {
  const h = harness({ verifyError: true });
  const response = await run(h);
  assert.equal(response.status, 503);
  assert.equal(response.body.error, 'verification_unavailable');
  assert.equal(h.connects(), 0);
});

test('repeated verify failures open the circuit breaker; the cooldown closes it', async () => {
  const h = harness({ verifyError: true, limits: { breakerThreshold: 2, breakerCooldownMs: 30_000 } });
  await run(h);
  await run(h);
  const tripped = await run(h);
  assert.equal(tripped.status, 503);
  assert.equal(h.ops.filter((op) => op.op === 'verify').length, 2,
    'the third request short-circuits without an outbound call');

  h.clock.value = NOW + 31_000;
  await run(h);
  assert.equal(h.ops.filter((op) => op.op === 'verify').length, 3, 'after cooldown, verification is attempted again');
});

/* ---------- transaction failure & handoff failure ---------- */

test('a failure inside the accept transaction rolls back and returns 503', async () => {
  const h = harness({ storeError: true });
  const response = await run(h);
  assert.equal(response.status, 503);
  assert.equal(response.body.error, 'temporary_unavailable');
  const texts = h.ops.filter((op) => op.op === 'query').map((op) => op.text);
  assert.ok(texts.includes('ROLLBACK'));
  assert.equal(texts.includes('COMMIT'), false);
  assert.equal(h.ops.some((op) => op.op === 'handoff'), false, 'no handoff without a committed event');
});

test('a dispute handoff failure returns 503 so the delivery is retried', async () => {
  const h = harness({ handoffError: true });
  const response = await run(h);
  assert.equal(response.status, 503);
  assert.equal(response.body.error, 'temporary_unavailable');
  const commitIndex = h.ops.findIndex((op) => op.op === 'query' && op.text === 'COMMIT');
  assert.ok(commitIndex >= 0, 'the raw event stays committed — the retry takes the duplicate path');
});

/* ---------- rate limiting & concurrency ---------- */

test('the per-IP token bucket rejects the burst and refills with the injected clock', async () => {
  const h = harness({ limits: { perIpPerMinute: 2, globalPerMinute: 100 } });
  assert.equal((await run(h)).status, 200);
  assert.equal((await run(h)).status, 200);
  const limited = await run(h);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, 'rate_limited');

  h.clock.value = NOW + 60_000;
  assert.equal((await run(h)).status, 200, 'a minute later the bucket has refilled');
});

test('the global bucket caps total traffic across distinct IPs', async () => {
  const h = harness({ limits: { perIpPerMinute: 100, globalPerMinute: 2 } });
  assert.equal((await run(h, { ip: '198.51.100.1' })).status, 200);
  assert.equal((await run(h, { ip: '198.51.100.2' })).status, 200);
  assert.equal((await run(h, { ip: '198.51.100.3' })).status, 429);
});

test('rate limiting happens before verification — a flood buys no outbound calls', async () => {
  const h = harness({ limits: { perIpPerMinute: 1, globalPerMinute: 100 } });
  await run(h);
  await run(h);
  assert.equal(h.ops.filter((op) => op.op === 'verify').length, 1);
});

test('bounded concurrency: an over-capacity request is refused immediately', async () => {
  let releaseVerify;
  const pending = new Promise((resolve) => { releaseVerify = () => resolve('SUCCESS'); });
  const h = harness({ verifyPending: pending, limits: { maxConcurrent: 1 } });

  const firstResponse = fakeResponse();
  const first = h.handler.handle(fakeRequest(), firstResponse, goodBody());
  await Promise.resolve(); // let the first request reach the pending verify

  const second = await run(h);
  assert.equal(second.status, 503);
  assert.equal(second.body.error, 'over_capacity');

  releaseVerify();
  await first;
  assert.equal(firstResponse.status, 200, 'the in-flight request still completes');
});

/* ---------- occurred_at fallbacks ---------- */

test('occurred_at falls back from resource.update_time to create_time to received time', async () => {
  const noUpdate = harness();
  await run(noUpdate, { body: goodBody({ resource: { dispute_id: 'PP-R-1' } }) });
  assert.equal(noUpdate.ops.find((op) => op.op === 'appendChained').args.fields.occurred_at,
    new Date(NOW - 60_000).toISOString());

  const bare = harness();
  await run(bare, { body: goodBody({ resource: { dispute_id: 'PP-R-1' }, create_time: undefined }) });
  assert.equal(bare.ops.find((op) => op.op === 'appendChained').args.fields.occurred_at,
    new Date(NOW).toISOString());
});

/* ---------- precheck unit surface ---------- */

test('precheckHeaders normalizes case and array-valued headers', () => {
  const result = W.precheckHeaders({
    'PAYPAL-TRANSMISSION-ID': ['69cd13f0-d67a-11e5-baa3-778b53f4ae55'],
    'Paypal-Transmission-Time': new Date(NOW).toISOString(),
    'PAYPAL-CERT-URL': 'https://api.paypal.com/cert',
    'PAYPAL-AUTH-ALGO': 'SHA256withRSA',
    'PAYPAL-TRANSMISSION-SIG': 'sig'
  }, { now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.headers['paypal-transmission-id'], '69cd13f0-d67a-11e5-baa3-778b53f4ae55');
});
