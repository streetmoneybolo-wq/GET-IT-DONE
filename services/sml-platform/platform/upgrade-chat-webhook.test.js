'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createUpgradeChatWebhookHandler, extractEventId, orderUuidFrom, pathToken } = require('./upgrade-chat-webhook');

const NOW = 1_700_000_000_000;
const EVENT_ID = '7f3b2c1d-9a8e-4f6b-8c5d-2e1f0a9b8c7d';
const ORDER_UUID = '2b8e8d9e-1c2f-4a5b-9c3d-7e6f5a4b3c2d';
const TOKEN = 'tok_9f8e7d6c5b4a';

function fakeResponse() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; }
  };
}

function request(url = `/v1/upgrade-chat/webhook/${TOKEN}`, method = 'POST') {
  return { method, url, headers: {} };
}

function fakePool(options = {}) {
  const queries = [];
  let released = false;
  const client = {
    async query(sql, values) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      queries.push({ text, values });
      return { rowCount: 0, rows: [] };
    },
    release() { released = true; }
  };
  return {
    queries,
    released: () => released,
    pool: {
      async query(sql, values) {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        queries.push({ text, values });
        if (text.startsWith('SELECT id FROM upgrade_chat_records')) {
          return options.duplicate ? { rowCount: 1, rows: [{ id: 5 }] } : { rowCount: 0, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      },
      async connect() { return client; }
    }
  };
}

function fakeStore(options = {}) {
  const appended = [];
  return {
    appended,
    appendRow: async (client, input) => {
      if (options.error) throw options.error;
      appended.push(input);
      return { id: 91, integrityHash: 'f'.repeat(64) };
    }
  };
}

function apiOrder(overrides = {}) {
  return {
    uuid: ORDER_UUID,
    payment_processor: 'PAYPAL',
    payment_processor_record_id: 'I-REALSUB123',
    purchased_at: '2026-08-01T00:00:00Z',
    cancelled_at: null,
    user: { discord_id: '123456789012345678' },
    ...overrides
  };
}

function fakeClient(overrides = {}) {
  const calls = [];
  return {
    calls,
    async validateWebhookEvent(id) {
      calls.push(['validate', id]);
      if (overrides.validateError) throw overrides.validateError;
      return overrides.validate || { valid: true };
    },
    async getWebhookEvent(id) {
      calls.push(['event', id]);
      if (overrides.eventError) throw overrides.eventError;
      return overrides.event || { id, type: 'order.updated', data: { uuid: ORDER_UUID } };
    },
    async getOrder(uuid) {
      calls.push(['order', uuid]);
      if (overrides.orderError) throw overrides.orderError;
      return overrides.order || apiOrder();
    }
  };
}

function handler({ db = fakePool(), store = fakeStore(), client = fakeClient(), token = TOKEN } = {}) {
  return {
    db,
    store,
    client,
    handle: createUpgradeChatWebhookHandler({
      pool: db.pool,
      config: { upgradeChatWebhookPathToken: token },
      upgradeChatClient: client,
      store,
      now: () => NOW
    }).handle
  };
}

test('unset path token fails closed with 503 before anything else runs', async () => {
  const db = fakePool();
  const client = fakeClient();
  const store = fakeStore();
  const { handle } = createUpgradeChatWebhookHandler({
    pool: db.pool, config: {}, upgradeChatClient: client, store, now: () => NOW
  });
  const res = fakeResponse();
  await handle(request(), res, JSON.stringify({ id: EVENT_ID }));
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'integration_unconfigured');
  assert.equal(client.calls.length, 0);
  assert.equal(db.queries.length, 0);
  assert.equal(store.appended.length, 0);
});

test('path token mismatch, missing segment, and wrong method all 404 with no detail', async () => {
  for (const req of [
    request(`/v1/upgrade-chat/webhook/${TOKEN}x`),
    request('/v1/upgrade-chat/webhook/'),
    request('/v1/upgrade-chat/webhook'),
    request(`/v1/upgrade-chat/webhook/wrong-token-entirely`),
    request(`/v1/upgrade-chat/webhook/${TOKEN}`, 'GET')
  ]) {
    const h = handler();
    const res = fakeResponse();
    await h.handle(req, res, JSON.stringify({ id: EVENT_ID }));
    assert.equal(res.statusCode, 404, `expected 404 for ${req.method} ${req.url}`);
    assert.deepEqual(res.body, { ok: false, error: 'not_found' });
    assert.equal(h.client.calls.length, 0);
    assert.equal(h.db.queries.length, 0);
  }
});

test('a body without a UUID event id is rejected without any API call or storage', async () => {
  for (const raw of ['not json', '[]', '"x"', JSON.stringify({}), JSON.stringify({ id: 'evt_123' }),
    JSON.stringify({ id: `${EVENT_ID}Z` })]) {
    const h = handler();
    const res = fakeResponse();
    await h.handle(request(), res, raw);
    assert.equal(res.statusCode, 400);
    assert.equal(h.client.calls.length, 0);
    assert.equal(h.store.appended.length, 0);
  }
});

test('missing API credentials fail closed after the id extraction', async () => {
  const db = fakePool();
  const store = fakeStore();
  const { handle } = createUpgradeChatWebhookHandler({
    pool: db.pool,
    config: { upgradeChatWebhookPathToken: TOKEN },
    upgradeChatClient: null,
    store,
    now: () => NOW
  });
  const res = fakeResponse();
  await handle(request(), res, JSON.stringify({ id: EVENT_ID }));
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'integration_unconfigured');
  assert.equal(store.appended.length, 0);
});

test('validate=false is a definitive 400 and nothing is stored', async () => {
  const h = handler({ client: fakeClient({ validate: { valid: false } }) });
  const res = fakeResponse();
  await h.handle(request(), res, JSON.stringify({ id: EVENT_ID }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'event_not_validated');
  assert.equal(h.store.appended.length, 0);
  assert.deepEqual(h.client.calls, [['validate', EVENT_ID]]);
  assert.equal(h.db.queries.some((q) => q.text.startsWith('BEGIN')), false);
});

test('validate transport failure maps to 503 so the sender retries', async () => {
  const h = handler({ client: fakeClient({ validateError: new Error('boom') }) });
  const res = fakeResponse();
  await h.handle(request(), res, JSON.stringify({ id: EVENT_ID }));
  assert.equal(res.statusCode, 503);
  assert.equal(h.store.appended.length, 0);
});

test('the unsigned inbound body is never stored: the row is built from the API fetch', async () => {
  const h = handler();
  const res = fakeResponse();
  const attackerBody = JSON.stringify({
    id: EVENT_ID,
    type: 'order.created',
    data: {
      uuid: ORDER_UUID,
      payment_processor: 'STRIPE',
      payment_processor_record_id: 'ATTACKER-REF-999',
      total: 0,
      user: { discord_id: '666666666666666666' }
    }
  });
  await h.handle(request(), res, attackerBody);

  assert.equal(res.statusCode, 202);
  assert.equal(h.store.appended.length, 1);
  const fields = h.store.appended[0].fields;
  assert.equal(h.store.appended[0].table, 'upgrade_chat_records');
  assert.equal(fields.payment_processor, 'PAYPAL');
  assert.equal(fields.payment_processor_record_id, 'I-REALSUB123');
  assert.equal(fields.discord_user_id, '123456789012345678');
  assert.equal(fields.uc_order_uuid, ORDER_UUID);
  const serialized = JSON.stringify(fields);
  assert.equal(serialized.includes('ATTACKER'), false);
  assert.equal(serialized.includes('666666666666666666'), false);
  /* And the API was consulted for both authenticity and content. */
  assert.deepEqual(h.client.calls, [
    ['validate', EVENT_ID], ['event', EVENT_ID], ['order', ORDER_UUID]
  ]);
});

test('a stored row is supplemental with full provenance and a writer-supplied received_at', async () => {
  const h = handler();
  const res = fakeResponse();
  await h.handle(request(), res, JSON.stringify({ id: EVENT_ID }));
  const fields = h.store.appended[0].fields;
  assert.equal(fields.supplemental, true);
  assert.equal(fields.source, 'upgrade_chat');
  assert.equal(fields.source_event_id, EVENT_ID);
  assert.equal(fields.received_at, new Date(NOW).toISOString());
  assert.equal(fields.occurred_at, '2026-08-01T00:00:00.000Z');
  assert.equal(fields.record_type, 'order.updated');
  assert.equal(fields.payload.order.payment_processor_record_id, 'I-REALSUB123');
  assert.equal(res.body.status, 'stored');
  assert.ok(h.db.queries.some((q) => q.text === 'BEGIN'));
  assert.ok(h.db.queries.some((q) => q.text === 'COMMIT'));
  assert.equal(h.db.released(), true);
});

test('an already-recorded webhook event id collapses to 200 duplicate without API calls', async () => {
  const h = handler({ db: fakePool({ duplicate: true }) });
  const res = fakeResponse();
  await h.handle(request(), res, JSON.stringify({ id: EVENT_ID }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'duplicate');
  assert.equal(h.client.calls.length, 0);
  assert.equal(h.store.appended.length, 0);
});

test('a unique-violation race on insert also collapses to 200 duplicate', async () => {
  const conflict = Object.assign(new Error('duplicate key value'), { code: '23505' });
  const h = handler({ store: fakeStore({ error: conflict }) });
  const res = fakeResponse();
  await h.handle(request(), res, JSON.stringify({ id: EVENT_ID }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'duplicate');
  assert.ok(h.db.queries.some((q) => q.text === 'ROLLBACK'));
});

test('an event with no resolvable order still stores the API event body only', async () => {
  const h = handler({ client: fakeClient({ event: { id: EVENT_ID, type: 'order.deleted', data: {} } }) });
  const res = fakeResponse();
  await h.handle(request(), res, JSON.stringify({ id: EVENT_ID }));
  assert.equal(res.statusCode, 202);
  const fields = h.store.appended[0].fields;
  assert.equal(fields.uc_order_uuid, null);
  assert.equal(fields.payload.order, null);
  assert.equal(fields.record_type, 'order.deleted');
  assert.equal(h.client.calls.some(([kind]) => kind === 'order'), false);
});

test('helpers: id extraction and order-uuid discovery are shape-strict', () => {
  assert.equal(extractEventId({ id: EVENT_ID.toUpperCase() }), EVENT_ID);
  assert.equal(extractEventId({ event_id: EVENT_ID }), EVENT_ID);
  assert.equal(extractEventId({ id: 'x' }), null);
  assert.equal(extractEventId([EVENT_ID]), null);
  assert.equal(orderUuidFrom({ data: { uuid: ORDER_UUID } }), ORDER_UUID);
  assert.equal(orderUuidFrom({ data: { uuid: 'nope' } }), null);
  assert.equal(pathToken(`/v1/upgrade-chat/webhook/${TOKEN}`), TOKEN);
  assert.equal(pathToken(`/v1/upgrade-chat/webhook/${TOKEN}/extra`), null);
  assert.equal(pathToken('/v1/other'), null);
});
