'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { orderRenewal, createUpgradeChatClient } = require('./upgrade-chat');

test('derives the next renewal from the provider charge and interval', () => {
  const value = orderRenewal({
    uuid: 'order-1', is_subscription: true, purchased_at: '2026-06-15T12:00:00Z',
    last_succeeded_charge: { payment_processor_created: '2026-08-15T12:00:00Z' },
    order_items: [{ interval: 'month', interval_count: 1, product: { uuid: 'product-1' } }]
  }, 'product-1', Date.parse('2026-08-30T00:00:00Z'));
  assert.equal(value.renewalAt, '2026-09-15T12:00:00.000Z');
  assert.equal(value.externalReference, 'order-1');
});

test('deleted and unrelated orders are never eligible', () => {
  const base = { uuid: 'o', is_subscription: true, purchased_at: '2026-08-15T00:00:00Z',
    order_items: [{ interval: 'month', interval_count: 1, product: { uuid: 'wanted' } }] };
  assert.equal(orderRenewal({ ...base, deleted: '2026-08-20' }, 'wanted'), null);
  assert.equal(orderRenewal(base, 'other'), null);
  assert.equal(orderRenewal({ ...base, purchased_at: '2025-01-01T00:00:00Z' }, 'wanted', Date.parse('2026-08-30T00:00:00Z')), null);
});

test('client authenticates and filters by the linked Discord identity', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/oauth/token')) return { ok: true, json: async () => ({ access_token: 'token', expires_in: 3600 }) };
    return { ok: true, json: async () => ({ data: [{
      uuid: 'order-2', is_subscription: true, purchased_at: '2026-08-29T00:00:00Z',
      order_items: [{ interval: 'month', interval_count: 1, product: { uuid: 'product-2' } }]
    }] }) };
  };
  const client = createUpgradeChatClient({ clientId: 'id', clientSecret: 'secret', fetchImpl,
    now: () => Date.parse('2026-08-30T00:00:00Z') });
  const result = await client.findMembership({ discordUserId: '1051212765475377172', productUuid: 'product-2' });
  assert.equal(result.externalReference, 'order-2');
  assert.match(calls[1].url, /userDiscordId=1051212765475377172/);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer token');
});

function webhookClient(bodies = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/oauth/token')) {
      return { ok: true, json: async () => ({ access_token: 'token', expires_in: 3600 }) };
    }
    if (bodies.status) return { ok: false, status: bodies.status, json: async () => ({}) };
    return { ok: true, json: async () => (bodies.payload || { valid: true }) };
  };
  const client = createUpgradeChatClient({ clientId: 'id', clientSecret: 'secret', fetchImpl,
    now: () => Date.parse('2026-08-30T00:00:00Z') });
  return { calls, client };
}

test('webhook-event reads hit the authenticated API with the exact paths', async () => {
  const eventId = '7f3b2c1d-9a8e-4f6b-8c5d-2e1f0a9b8c7d';
  const { calls, client } = webhookClient({ payload: { valid: true } });

  assert.deepEqual(await client.validateWebhookEvent(eventId), { valid: true });
  await client.getWebhookEvent(eventId);
  await client.getOrder('2b8e8d9e-1c2f-4a5b-9c3d-7e6f5a4b3c2d');

  const apiCalls = calls.filter((call) => !call.url.includes('/oauth/token'));
  assert.equal(apiCalls.length, 3);
  assert.equal(apiCalls[0].url, `https://api.upgrade.chat/v1/webhook-events/${eventId}/validate`);
  assert.equal(apiCalls[1].url, `https://api.upgrade.chat/v1/webhook-events/${eventId}`);
  assert.equal(apiCalls[2].url, 'https://api.upgrade.chat/v1/orders/2b8e8d9e-1c2f-4a5b-9c3d-7e6f5a4b3c2d');
  for (const call of apiCalls) {
    assert.equal(call.options.headers.Authorization, 'Bearer token');
  }
});

test('path-unsafe identifiers are rejected before any request is made', async () => {
  const { calls, client } = webhookClient();
  for (const bad of ['', '../secrets', 'a/b', 'id?x=1', 'x'.repeat(65), null]) {
    await assert.rejects(() => client.validateWebhookEvent(bad), TypeError);
    await assert.rejects(() => client.getWebhookEvent(bad), TypeError);
    await assert.rejects(() => client.getOrder(bad), TypeError);
  }
  assert.equal(calls.length, 0);
});

test('non-OK API responses surface as errors with the status', async () => {
  const { client } = webhookClient({ status: 429 });
  await assert.rejects(() => client.getOrder('2b8e8d9e-1c2f-4a5b-9c3d-7e6f5a4b3c2d'), /429/);
});
