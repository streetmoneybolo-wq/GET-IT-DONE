'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { createLoopKickBridge } = require('./loop-kick-bridge');

const SECRET = 's'.repeat(40);
const NOW = 1_700_000_000_000;

function bridgeWith(fetchImpl, overrides = {}) {
  return createLoopKickBridge({ baseUrl: 'https://site.example', secret: SECRET, appUrl: 'https://phone.example', fetchImpl, now: () => NOW, ...overrides });
}

test('unconfigured bridge fails closed', async () => {
  const bridge = createLoopKickBridge({ baseUrl: '', secret: '' });
  assert.equal(bridge.configured, false);
  assert.deepEqual(await bridge.session('123456789012345678'), { ok: false, status: 503, error: 'loop_kick_unconfigured' });
});

test('rejects malformed discord ids without calling the site', async () => {
  let called = 0;
  const bridge = bridgeWith(async () => { called++; });
  const result = await bridge.session('nope');
  assert.equal(result.error, 'invalid_discord_user');
  assert.equal(called, 0);
});

test('signs timestamp.path.sha256(body) and sends the exact headers', async () => {
  let seen = null;
  const bridge = bridgeWith(async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, json: async () => ({ ok: true, token: 'a'.repeat(64), expires_at: 123, user: { id: 7 }, app_url: 'https://x' }) };
  });
  const result = await bridge.session('123456789012345678');
  assert.equal(result.ok, true);
  assert.equal(result.token, 'a'.repeat(64));
  assert.equal(result.app_url, 'https://phone.example');
  assert.equal(seen.url, 'https://site.example/wp-json/sml-loop-kick/v1/discord-session');
  const ts = seen.init.headers['x-sml-lk-timestamp'];
  assert.equal(ts, String(Math.floor(NOW / 1000)));
  const bodyHash = crypto.createHash('sha256').update(seen.init.body).digest('hex');
  const expected = 'sha256=' + crypto.createHmac('sha256', SECRET)
    .update(`${ts}./wp-json/sml-loop-kick/v1/discord-session.${bodyHash}`).digest('hex');
  assert.equal(seen.init.headers['x-sml-lk-signature'], expected);
  assert.deepEqual(JSON.parse(seen.init.body), { discord_user_id: '123456789012345678' });
});

test('passes not_linked and not_verified shapes through untouched', async () => {
  const bridge = bridgeWith(async () => ({
    ok: false, status: 403,
    json: async () => ({ ok: false, error: 'not_linked', connect_url: 'https://site.example/connect-discord/' }),
  }));
  const result = await bridge.session('123456789012345678');
  assert.deepEqual(result, { ok: false, status: 403, error: 'not_linked', connect_url: 'https://site.example/connect-discord/' });
});

test('maps network failures and junk answers to loop_kick_unavailable', async () => {
  const down = bridgeWith(async () => { throw new Error('boom'); });
  assert.equal((await down.session('123456789012345678')).error, 'loop_kick_unavailable');
  const junk = bridgeWith(async () => ({ ok: true, status: 200, json: async () => ({ nope: 1 }) }));
  assert.equal((await junk.session('123456789012345678')).error, 'loop_kick_unavailable');
});

test('activity: the linked member\'s recent site activity, signed like profile(); an older site without the route says so', async () => {
  let seen = null;
  const bridge = bridgeWith(async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ ok: true, linked: true, user: { id: 7, handle: 'ana' }, items: [{ kind: 'post', id: '1' }, null, 'x'] }) }; });
  const r = await bridge.activity('123456789012345678', 5);
  assert.equal(r.ok, true); assert.equal(r.linked, true); assert.equal(r.user.handle, 'ana'); assert.deepEqual(r.items, [{ kind: 'post', id: '1' }]);
  assert.equal(seen.url, 'https://site.example/wp-json/sml-loop-kick/v1/discord-activity');
  assert.deepEqual(JSON.parse(seen.init.body), { discord_user_id: '123456789012345678', limit: 5 });
  const ts = seen.init.headers['x-sml-lk-timestamp'], bodyHash = crypto.createHash('sha256').update(seen.init.body).digest('hex');
  assert.equal(seen.init.headers['x-sml-lk-signature'], 'sha256=' + crypto.createHmac('sha256', SECRET).update(`${ts}./wp-json/sml-loop-kick/v1/discord-activity.${bodyHash}`).digest('hex'));
  assert.equal((await bridge.activity('bad')).error, 'invalid_discord_user');
  const unlinked = await bridgeWith(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, linked: false }) })).activity('123456789012345678');
  assert.equal(unlinked.linked, false); assert.deepEqual(unlinked.items, []); assert.equal(unlinked.user, null);
  const old = await bridgeWith(async () => ({ ok: false, status: 404, json: async () => ({ code: 'rest_no_route' }) })).activity('123456789012345678');
  assert.equal(old.error, 'activity_unconfigured');
  const off = await bridgeWith(async () => { throw new Error('nope'); }, { secret: '' }).activity('123456789012345678');
  assert.equal(off.error, 'loop_kick_unconfigured');
});
