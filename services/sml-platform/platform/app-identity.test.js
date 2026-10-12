'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createAppIdentity } = require('./app-identity');

const SECRET = 's'.repeat(40);
const NOW = 1_760_000_000_000;

function fetchStub(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); const r = handler(url, init); return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => { if (r.body === undefined) throw new Error('no json'); return r.body; } }; };
  return { fetchImpl, calls };
}

test('every call is signed the LOOP-KICK way: ts.path.sha256(body) under the bridge secret, with the x-sml-lk headers', async () => {
  const { fetchImpl, calls } = fetchStub(() => ({ status: 200, body: { ok: true, user: { id: 7 } } }));
  const id = createAppIdentity({ baseUrl: 'https://stockmarketloop.com/', secret: SECRET, fetchImpl, now: () => NOW });
  assert.equal(id.configured, true);
  const r = await id.login({ login: 'vaughn', password: 'pw', code: '', device: { id: 'd', platform: 'ios' }, ip: '203.0.113.5' });
  assert.equal(r.ok, true); assert.equal(r.user.id, 7);
  assert.equal(calls[0].url, 'https://stockmarketloop.com/wp-json/sml-platform/v1/app/login');
  const { headers, body } = calls[0].init;
  assert.equal(headers['x-sml-lk-timestamp'], String(Math.floor(NOW / 1000)));
  const expected = crypto.createHmac('sha256', SECRET).update(`${headers['x-sml-lk-timestamp']}./wp-json/sml-platform/v1/app/login.${crypto.createHash('sha256').update(body).digest('hex')}`).digest('hex');
  assert.equal(headers['x-sml-lk-signature'], 'sha256=' + expected);
  const sent = JSON.parse(body);
  assert.equal(sent.login, 'vaughn'); assert.equal(sent.password, 'pw'); assert.equal(sent.device.platform, 'ios'); assert.equal(sent.ip, '203.0.113.5');
  await id.me(7);
  assert.equal(calls[1].url, 'https://stockmarketloop.com/wp-json/sml-platform/v1/app/me');
  assert.deepEqual(JSON.parse(calls[1].init.body), { userId: 7 });
  await id.proxy({ userId: 7, method: 'post', route: '/sml-feed/v1/slot', query: { page: '2' }, body: { a: 1 } });
  assert.deepEqual(JSON.parse(calls[2].init.body), { userId: 7, method: 'POST', route: '/sml-feed/v1/slot', query: { page: '2' }, body: { a: 1 } });
});

test('the plugin\'s member-facing refusals pass through with their status; anything else is identity_unavailable', async () => {
  let reply;
  const { fetchImpl } = fetchStub(() => reply);
  const id = createAppIdentity({ baseUrl: 'https://stockmarketloop.com', secret: SECRET, fetchImpl, now: () => NOW });
  reply = { status: 401, body: { ok: false, error: 'invalid_credentials' } };
  assert.deepEqual(await id.login({ login: 'a', password: 'b' }), { ok: false, status: 401, error: 'invalid_credentials' });
  reply = { status: 403, body: { ok: false, error: 'two_step_required', method: 'email', hint: 'v•••@x.com' } };
  assert.deepEqual(await id.login({ login: 'a', password: 'b' }), { ok: false, status: 403, error: 'two_step_required', method: 'email', hint: 'v•••@x.com' });
  reply = { status: 401, body: { code: 'sml_lkd_signature', message: 'Unauthorized.', data: { status: 401 } } };
  assert.deepEqual(await id.me(7), { ok: false, status: 401, error: 'signature', message: 'Unauthorized.' });
  reply = { status: 500, body: { code: 'internal_server_error' } };
  assert.deepEqual(await id.me(7), { ok: false, status: 503, error: 'identity_unavailable' });
  reply = { status: 200, body: undefined };
  assert.deepEqual(await id.me(7), { ok: false, status: 503, error: 'identity_unavailable' });
  reply = { status: 200, body: '<html>429</html>' };
  assert.equal((await id.me(7)).error, 'identity_unavailable');
});

test('a network failure and a missing configuration both fail closed', async () => {
  const down = createAppIdentity({ baseUrl: 'https://stockmarketloop.com', secret: SECRET, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  assert.deepEqual(await down.me(7), { ok: false, status: 503, error: 'identity_unavailable' });
  const off = createAppIdentity({ baseUrl: 'https://stockmarketloop.com', secret: 'short' });
  assert.equal(off.configured, false);
  assert.deepEqual(await off.login({ login: 'a', password: 'b' }), { ok: false, status: 503, error: 'identity_unconfigured' });
  assert.equal(createAppIdentity({ baseUrl: 'ftp://x', secret: SECRET }).configured, false);
});
