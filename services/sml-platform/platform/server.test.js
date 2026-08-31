'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer } = require('./server');
const { hmac } = require('./wordpress-gateway');

async function withServer(options, run) {
  const server = createServer({
    checkDatabase: async () => true,
    acceptWordPressEvent: async () => 'accepted',
    logger: () => {},
    now: () => 1_700_000_000_000,
    ...options
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('health returns 200 only when the database check passes', async () => {
  await withServer({ checkDatabase: async () => true }, async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      service: 'sml-platform-api',
      database: 'connected'
    });
  });
});

test('health fails closed when the database check fails', async () => {
  await withServer({ checkDatabase: async () => { throw new Error('offline'); } }, async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      service: 'sml-platform-api',
      database: 'unavailable'
    });
  });
});

test('all other routes are a no-store 404', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/not-a-route`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});

function signedHeaders(secret, body, timestamp = '1700000000') {
  return {
    'content-type': 'application/json',
    'x-sml-timestamp': timestamp,
    'x-sml-signature': `sha256=${hmac(secret, timestamp, body)}`
  };
}

function eventBody(overrides = {}) {
  return JSON.stringify({
    version: 1,
    eventId: '7dc5f64b-7c05-4f38-9c55-31fcfa798706',
    eventType: 'system.integration.ping',
    occurredAt: '2023-11-14T22:13:20.000Z',
    actorUserId: 42,
    subject: { type: 'integration', id: 'wordpress' },
    data: { source: 'test' },
    ...overrides
  });
}

test('WordPress gateway fails closed until its secret exists', async () => {
  const body = eventBody();
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/v1/wordpress/events`, {
      method: 'POST', body, headers: signedHeaders('not-configured', body)
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: 'integration_unconfigured' });
  });
});

test('WordPress gateway accepts one valid signed event and exposes no payload', async () => {
  const received = [];
  const body = eventBody();
  await withServer({
    wordpressWebhookSecret: 'gateway-test-secret',
    acceptWordPressEvent: async (event) => { received.push(event); return 'accepted'; }
  }, async (base) => {
    const response = await fetch(`${base}/v1/wordpress/events`, {
      method: 'POST', body, headers: signedHeaders('gateway-test-secret', body)
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      ok: true,
      eventId: '7dc5f64b-7c05-4f38-9c55-31fcfa798706',
      status: 'accepted'
    });
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].eventType, 'system.integration.ping');
  assert.match(received[0].payloadHash, /^[0-9a-f]{64}$/);
});

test('WordPress gateway recognizes a replay without processing it twice', async () => {
  const body = eventBody();
  await withServer({
    wordpressWebhookSecret: 'gateway-test-secret',
    acceptWordPressEvent: async () => 'duplicate'
  }, async (base) => {
    const response = await fetch(`${base}/v1/wordpress/events`, {
      method: 'POST', body, headers: signedHeaders('gateway-test-secret', body)
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      eventId: '7dc5f64b-7c05-4f38-9c55-31fcfa798706',
      status: 'duplicate'
    });
  });
});

test('WordPress gateway rejects bad signatures and old requests before storage', async () => {
  const body = eventBody();
  let calls = 0;
  await withServer({
    wordpressWebhookSecret: 'gateway-test-secret',
    acceptWordPressEvent: async () => { calls += 1; return 'accepted'; }
  }, async (base) => {
    const bad = await fetch(`${base}/v1/wordpress/events`, {
      method: 'POST', body, headers: { ...signedHeaders('wrong-secret', body) }
    });
    assert.equal(bad.status, 401);
    assert.deepEqual(await bad.json(), { ok: false, error: 'invalid_signature' });

    const old = await fetch(`${base}/v1/wordpress/events`, {
      method: 'POST', body, headers: signedHeaders('gateway-test-secret', body, '1600000000')
    });
    assert.equal(old.status, 401);
    assert.deepEqual(await old.json(), { ok: false, error: 'stale_request' });
  });
  assert.equal(calls, 0);
});

test('news webhook queues one authenticated source URL and collapses duplicates', async () => {
  const received = [];
  await withServer({
    newsIngestToken: 'news-test-token',
    enqueueNewsArticle: async (job) => {
      received.push(job);
      return received.length === 1
        ? { id: 71, status: 'accepted' }
        : { id: 71, status: 'duplicate' };
    }
  }, async (base) => {
    const body = JSON.stringify({ source_url: 'https://example.com/story?utm_source=test' });
    const first = await fetch(`${base}/v1/news/articles`, {
      method: 'POST',
      headers: { authorization: 'Bearer news-test-token', 'content-type': 'application/json' },
      body
    });
    assert.equal(first.status, 202);
    assert.deepEqual(await first.json(), { ok: true, jobId: 71, status: 'accepted', jobStatus: 'queued' });
    const second = await fetch(`${base}/v1/news/articles`, {
      method: 'POST',
      headers: { authorization: 'Bearer news-test-token', 'content-type': 'application/json' },
      body
    });
    assert.equal(second.status, 200);
    assert.equal((await second.json()).status, 'duplicate');
  });
  assert.equal(received[0].sourceUrl, 'https://example.com/story');
  assert.match(received[0].sourceUrlHash, /^[a-f0-9]{64}$/);
});

test('news webhook fails closed before storing unauthenticated or invalid requests', async () => {
  let calls = 0;
  await withServer({
    newsIngestToken: 'news-test-token',
    enqueueNewsArticle: async () => { calls += 1; return { id: 1, status: 'accepted' }; }
  }, async (base) => {
    const denied = await fetch(`${base}/v1/news/articles`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"source_url":"https://example.com"}'
    });
    assert.equal(denied.status, 401);
    const invalid = await fetch(`${base}/v1/news/articles`, {
      method: 'POST', headers: { authorization: 'Bearer news-test-token', 'content-type': 'application/json' }, body: '{"source_url":"http://localhost"}'
    });
    assert.equal(invalid.status, 422);
  });
  assert.equal(calls, 0);
});

test('alert routes are signed and owner-scoped before reaching the router', async () => {
  const calls = [];
  const body = JSON.stringify({ groupId: 7, ownerUserId: 42 });
  await withServer({
    alertRouterSecret: 'alert-test-secret',
    alertRouter: { listRoutes: async (...args) => { calls.push(args); return [{ id: 1 }]; } }
  }, async (base) => {
    const response = await fetch(`${base}/v1/alerts/routes/list`, {
      method: 'POST', body, headers: signedHeaders('alert-test-secret', body)
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true, routes: [{ id: 1 }] });
  });
  assert.deepEqual(calls, [[7, 42]]);
});

test('alert ingestion rejects bad signatures before the router is called', async () => {
  let calls = 0;
  const body = JSON.stringify({ groupId: 7 });
  await withServer({
    alertRouterSecret: 'alert-test-secret',
    alertRouter: { ingest: async () => { calls += 1; return { status: 'accepted' }; } }
  }, async (base) => {
    const response = await fetch(`${base}/v1/alerts/ingest`, {
      method: 'POST', body, headers: signedHeaders('wrong-secret', body)
    });
    assert.equal(response.status, 401);
  });
  assert.equal(calls, 0);
});
