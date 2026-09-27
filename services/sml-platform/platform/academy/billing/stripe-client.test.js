'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createStripeApi, API_VERSION } = require('./stripe-client');

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, method: init.method, headers: init.headers, body: init.body });
    const { status = 200, body } = await handler(parsed, init, calls.length);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
  };
  fn.calls = calls;
  return fn;
}

const page = (ids, hasMore, object = 'subscription') => ({ object: 'list', url: '/v1/x', has_more: hasMore, data: ids.map((id) => ({ id, object })) });

test('uses only the restricted key and pins Stripe-Version 2022-11-15', async () => {
  const fetchImpl = fakeFetch(() => ({ body: page(['sub_1'], false) }));
  const api = createStripeApi({ key: 'rk_test_academy', fetchImpl });
  await api.listSubscriptions('cus_1');
  const call = fetchImpl.calls[0];
  assert.equal(API_VERSION, '2022-11-15');
  assert.equal(call.headers['Stripe-Version'], '2022-11-15');
  assert.equal(call.headers.Authorization, 'Bearer rk_test_academy');
  assert.equal(call.url.pathname, '/v1/subscriptions');
  assert.equal(call.url.searchParams.get('customer'), 'cus_1');
  assert.equal(call.url.searchParams.get('status'), 'all');
  assert.equal(call.url.searchParams.get('limit'), '100');
});

test('lists are paged to the end with starting_after', async () => {
  const fetchImpl = fakeFetch((url) => {
    const after = url.searchParams.get('starting_after');
    if (!after) return { body: page(['pi_1', 'pi_2'], true, 'payment_intent') };
    if (after === 'pi_2') return { body: page(['pi_3'], true, 'payment_intent') };
    return { body: page(['pi_4'], false, 'payment_intent') };
  });
  const api = createStripeApi({ key: 'rk_test_academy', fetchImpl });
  const result = await api.listPaymentIntents('cus_1');
  assert.deepEqual(result.data.map((p) => p.id), ['pi_1', 'pi_2', 'pi_3', 'pi_4']);
  assert.equal(result.complete, true);
  assert.equal(fetchImpl.calls.length, 3);
});

test('a list that hits the page cap is reported incomplete', async () => {
  let n = 0;
  const fetchImpl = fakeFetch(() => ({ body: page([`ch_${++n}`], true, 'charge') }));
  const api = createStripeApi({ key: 'rk_test_academy', fetchImpl, maxPages: 3 });
  const result = await api.listCharges('cus_1');
  assert.equal(result.complete, false);
  assert.equal(result.data.length, 3);
});

test('a deleted or missing customer is definitive, other errors throw', async () => {
  const fetchImpl = fakeFetch((url) => {
    if (url.pathname.endsWith('cus_gone')) return { status: 404, body: { error: { type: 'invalid_request_error', code: 'resource_missing', message: 'No such customer' } } };
    if (url.pathname.endsWith('cus_del')) return { body: { id: 'cus_del', object: 'customer', deleted: true } };
    return { status: 500, body: { error: { type: 'api_error', message: 'boom' } } };
  });
  const api = createStripeApi({ key: 'rk_test_academy', fetchImpl });
  assert.deepEqual(await api.retrieveCustomer('cus_gone'), { id: 'cus_gone', deleted: true, missing: true });
  assert.deepEqual(await api.retrieveCustomer('cus_del'), { id: 'cus_del', deleted: true });
  await assert.rejects(() => createStripeApi({ key: 'rk_test_academy', fetchImpl, stripe: null }).retrieveCustomer('cus_x'));
});

test('writes carry the caller\'s Idempotency-Key', async () => {
  const fetchImpl = fakeFetch(() => ({ body: { id: 'cus_new', object: 'customer' } }));
  const api = createStripeApi({ key: 'rk_test_academy', fetchImpl });
  await api.createCustomer({ metadata: { sml_kind: 'mem_academy' } }, 'mem-academy-customer-v1-test-1');
  const call = fetchImpl.calls[0];
  assert.equal(call.method, 'POST');
  assert.equal(call.headers['Idempotency-Key'], 'mem-academy-customer-v1-test-1');
  assert.ok(decodeURIComponent(String(call.body)).includes('metadata[sml_kind]=mem_academy'));
});

test('searches use the documented query syntax and refuse a non-snowflake id', async () => {
  const fetchImpl = fakeFetch(() => ({ body: { object: 'search_result', data: [], has_more: false, next_page: null } }));
  const api = createStripeApi({ key: 'rk_test_academy', fetchImpl });
  await api.searchCustomersByDiscordId('300000000000000001');
  assert.equal(fetchImpl.calls[0].url.pathname, '/v1/customers/search');
  assert.equal(fetchImpl.calls[0].url.searchParams.get('query'), "metadata['mem_academy_discord_user']:'300000000000000001'");
  await assert.rejects(() => api.searchCustomersByDiscordId("1' OR '1"), /snowflake/);
});

test('refuses to start without its own key', () => {
  assert.throws(() => createStripeApi({}), /SML_ACADEMY_BILLING_STRIPE_KEY/);
});
