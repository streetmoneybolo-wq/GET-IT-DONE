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
