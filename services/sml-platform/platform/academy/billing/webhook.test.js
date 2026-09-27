'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { sign } = require('../../stripe-webhook');
const { createAcademyServer } = require('../server');
const { createRoutes } = require('./routes');
const { createEvents } = require('./events');
const k = require('./testkit');

const SECRET = 'whsec_academytestsecret';
const PLATFORM_SECRET = 'whsec_platformsecret';
const CUS = 'cus_bound1';

async function withServer(options, run) {
  const now = k.clock(Date.now());
  const config = k.config(options.overrides || {});
  const store = k.createFakeStore({ now });
  k.bindMember(store, k.USER, CUS);
  const stripe = k.createFakeStripe();
  const state = { enabled: options.enabled !== false, schemaReady: options.schemaReady !== false };
  const events = options.events || createEvents({ config, store, stripeApi: stripe, resync: async () => ({}), now, isEnabled: () => state.enabled });
  let kicks = 0;
  const routes = createRoutes({ config, state: () => state, events, store, kick: () => { kicks += 1; }, now });
  const server = createAcademyServer({ interactions: null, checkDatabase: async () => true, academyBilling: { handle: routes.handle } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await run({ base: `http://127.0.0.1:${port}`, store, stripe, kicks: () => kicks, now });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function payload(id = 'evt_hook1', object = { id: 'in_1', object: 'invoice', customer: CUS, description: 'Académie ✓' }) {
  return JSON.stringify({ id, object: 'event', type: 'invoice.paid', created: Math.floor(Date.now() / 1000), livemode: false, api_version: '2022-11-15', data: { object } });
}

async function post(base, body, { secret = SECRET, timestamp = Math.floor(Date.now() / 1000), header = null } = {}) {
  const sig = header || `t=${timestamp},v1=${sign(secret, timestamp, body)}`;
  return fetch(`${base}/v1/academy/billing/stripe/webhook`, { method: 'POST', headers: { 'stripe-signature': sig, 'content-type': 'application/json' }, body });
}

test('a valid signature with the Academy secret -> 200 pending, processor kicked', async () => {
  await withServer({}, async ({ base, store, kicks }) => {
    const response = await post(base, payload());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true, status: 'pending' });
    assert.equal(store.db.events.get('evt_hook1').status, 'pending');
    await new Promise((r) => setImmediate(r));
    assert.equal(kicks(), 1);
  });
});

test('the UTF-8 body is verified as a string (multi-byte characters survive)', async () => {
  await withServer({}, async ({ base }) => {
    const body = payload('evt_utf8', { id: 'in_2', customer: CUS, description: 'Ünïcödé — 学院 ✓' });
    assert.equal((await post(base, body)).status, 200);
  });
});

test('a signature made with the PLATFORM secret is rejected', async () => {
  await withServer({ overrides: { SML_STRIPE_WEBHOOK_SECRET: PLATFORM_SECRET } }, async ({ base, store }) => {
    const response = await post(base, payload(), { secret: PLATFORM_SECRET });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error: 'signature_mismatch' });
    assert.equal(store.db.events.size, 0);
  });
});

test('an unset secret fails closed with 503', async () => {
  await withServer({ overrides: { SML_ACADEMY_BILLING_ENABLED: '0', SML_ACADEMY_BILLING_WEBHOOK_SECRET: '' }, enabled: false }, async ({ base }) => {
    const response = await post(base, payload());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: 'stripe_unconfigured' });
  });
});

test('ENABLED=0 stores our event as deferred and does not kick the processor', async () => {
  await withServer({ enabled: false }, async ({ base, store, kicks }) => {
    const response = await post(base, payload('evt_def1'));
    assert.deepEqual(await response.json(), { received: true, status: 'deferred' });
    assert.equal(store.db.events.get('evt_def1').status, 'deferred');
    await new Promise((r) => setImmediate(r));
    assert.equal(kicks(), 0);
    /* and every other billing route is a 404 */
    assert.equal((await fetch(`${base}/v1/academy/billing/buy`)).status, 404);
  });
});

test('a duplicate event returns 200 duplicate', async () => {
  await withServer({}, async ({ base }) => {
    const body = payload('evt_dup1');
    await post(base, body);
    assert.deepEqual(await (await post(base, body)).json(), { received: true, status: 'duplicate' });
  });
});

test('a body over 256 KiB is refused with 413 before verification', async () => {
  await withServer({}, async ({ base }) => {
    const body = JSON.stringify({ pad: 'x'.repeat(257 * 1024) });
    assert.equal((await post(base, body)).status, 413);
  });
});

test('a stale timestamp is rejected', async () => {
  await withServer({}, async ({ base }) => {
    const response = await post(base, payload(), { timestamp: Math.floor(Date.now() / 1000) - 3600 });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error: 'timestamp_out_of_tolerance' });
  });
});

test('a database failure returns 503 so Stripe retries', async () => {
  const events = { record: async () => { throw new Error('connection refused'); } };
  await withServer({ events }, async ({ base }) => {
    assert.equal((await post(base, payload())).status, 503);
  });
});

test('before schema 028 exists the webhook answers 503', async () => {
  await withServer({ schemaReady: false }, async ({ base }) => {
    const response = await post(base, payload());
    assert.deepEqual([response.status, (await response.json()).error], [503, 'schema_unavailable']);
  });
});

test('GET on the webhook path is not allowed', async () => {
  await withServer({}, async ({ base }) => {
    assert.equal((await fetch(`${base}/v1/academy/billing/stripe/webhook`)).status, 405);
  });
});
