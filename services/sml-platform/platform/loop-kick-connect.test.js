'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { createLoopKickConnect, signConnectToken, verifyConnectToken, LINK_TTL_MS } = require('./loop-kick-connect');
const { createLoopKickBridge } = require('./loop-kick-bridge');

const SECRET = 'a'.repeat(40);
const DISCORD = '123456789012345678';

function fakes({ login, link } = {}) {
  const calls = [];
  const identity = { configured: true, login: async (args) => { calls.push(['login', args]); return login ? login(args) : { ok: true, status: 200, user: { id: 42, handle: 'obi', displayName: 'Obi', emailVerified: true } }; } };
  const bridge = { configured: true, link: async (args) => { calls.push(['link', args]); return link ? link(args) : { ok: true, status: 200, linked: true, userId: 42, verified: true }; } };
  return { calls, identity, bridge };
}

test('connect signs the member in with the site password, then stores Discord ↔ member; the password never reaches the link call', async () => {
  const f = fakes();
  const logs = [];
  const connect = createLoopKickConnect({ bridge: f.bridge, identity: f.identity, secret: SECRET, logger: (level, event, fields) => logs.push([level, event, fields]) });
  assert.equal(connect.configured, true);
  const out = await connect.connect({ discordUserId: DISCORD, discordTag: 'obi#1', login: ' obi@example.com ', password: 'pw', ip: '1.2.3.4' });
  assert.equal(out.ok, true);
  assert.equal(out.status, 200);
  assert.deepEqual(out.user, { id: 42, handle: 'obi', displayName: 'Obi', emailVerified: true });
  assert.equal(out.verified, true);
  assert.equal(f.calls[0][0], 'login');
  assert.equal(f.calls[0][1].login, 'obi@example.com');
  assert.equal(f.calls[0][1].password, 'pw');
  assert.equal(f.calls[0][1].device.platform, 'discord');
  assert.deepEqual(f.calls[1], ['link', { discordUserId: DISCORD, wpUserId: 42, discordTag: 'obi#1' }]);
  assert.ok(!JSON.stringify(f.calls[1]).includes('pw'));
  assert.deepEqual(logs.at(-1), ['info', 'loop_kick_connected', { discordUserId: DISCORD, wpUserId: 42 }]);
  assert.ok(!JSON.stringify(logs).includes('pw'), 'no password in logs');
});

test('site refusals pass through for the panel: wrong password, two-step prompt with its hint, blocked account', async () => {
  const answers = [
    { ok: false, status: 401, error: 'invalid_credentials' },
    { ok: false, status: 403, error: 'two_step_required', method: 'email', hint: 'o•••@example.com' },
    { ok: false, status: 403, error: 'two_step_invalid', method: 'email' },
    { ok: false, status: 403, error: 'account_blocked' },
    { ok: false, status: 429, error: 'rate_limited', retryAfterSec: 900 }
  ];
  const f = fakes({ login: async () => answers.shift() });
  const connect = createLoopKickConnect({ bridge: f.bridge, identity: f.identity, secret: SECRET });
  const args = { discordUserId: DISCORD, login: 'obi', password: 'x' };
  assert.deepEqual(await connect.connect(args), { ok: false, status: 401, error: 'invalid_credentials' });
  assert.deepEqual(await connect.connect(args), { ok: false, status: 403, error: 'two_step_required', method: 'email', hint: 'o•••@example.com' });
  assert.deepEqual(await connect.connect({ ...args, code: '123456' }), { ok: false, status: 403, error: 'two_step_invalid', method: 'email' });
  assert.deepEqual(await connect.connect(args), { ok: false, status: 403, error: 'account_blocked' });
  assert.deepEqual(await connect.connect(args), { ok: false, status: 429, error: 'rate_limited', retryAfterSec: 900 });
  assert.ok(f.calls.every((c) => c[0] === 'login'), 'nothing is linked after a refused sign-in');
});

test('a site outage or an unknown refusal never leaks detail: site_unavailable', async () => {
  const f = fakes({ login: async () => ({ ok: false, status: 500, error: 'weird_internal_thing', message: 'stack...' }) });
  const connect = createLoopKickConnect({ bridge: f.bridge, identity: f.identity, secret: SECRET });
  assert.deepEqual(await connect.connect({ discordUserId: DISCORD, login: 'obi', password: 'x' }), { ok: false, status: 500, error: 'site_unavailable' });
});

test('an already-linked Discord account and a site without the link route are reported, not retried', async () => {
  const answers = [{ ok: false, status: 409, error: 'discord_already_linked' }, { ok: false, status: 503, error: 'connect_unconfigured' }];
  const f = fakes({ link: async () => answers.shift() });
  const connect = createLoopKickConnect({ bridge: f.bridge, identity: f.identity, secret: SECRET });
  assert.deepEqual(await connect.connect({ discordUserId: DISCORD, login: 'obi', password: 'x' }), { ok: false, status: 409, error: 'discord_already_linked' });
  assert.deepEqual(await connect.connect({ discordUserId: DISCORD, login: 'obi', password: 'x' }), { ok: false, status: 503, error: 'connect_unconfigured' });
});

test('input is validated before the site is called, and a member gets eight tries per 15 minutes', async () => {
  let t = 1_700_000_000_000;
  const f = fakes({ login: async () => ({ ok: false, status: 401, error: 'invalid_credentials' }) });
  const connect = createLoopKickConnect({ bridge: f.bridge, identity: f.identity, secret: SECRET, now: () => t });
  assert.equal((await connect.connect({ discordUserId: 'nope', login: 'a', password: 'b' })).error, 'invalid_discord_user');
  assert.equal((await connect.connect({ discordUserId: DISCORD, login: '', password: 'b' })).error, 'invalid_request');
  assert.equal((await connect.connect({ discordUserId: DISCORD, login: 'a', password: '' })).error, 'invalid_request');
  assert.equal((await connect.connect({ discordUserId: DISCORD, login: 'a', password: 7 })).error, 'invalid_request');
  assert.equal(f.calls.length, 0);
  for (let i = 0; i < 8; i += 1) assert.equal((await connect.connect({ discordUserId: DISCORD, login: 'a', password: 'b' })).error, 'invalid_credentials');
  const limited = await connect.connect({ discordUserId: DISCORD, login: 'a', password: 'b' });
  assert.equal(limited.error, 'rate_limited');
  assert.equal(limited.status, 429);
  assert.ok(limited.retryAfterSec > 0 && limited.retryAfterSec <= 900);
  assert.equal(f.calls.length, 8);
  t += 15 * 60_000 + 1;
  assert.equal((await connect.connect({ discordUserId: DISCORD, login: 'a', password: 'b' })).error, 'invalid_credentials');
});

test('unconfigured pieces fail closed', async () => {
  const f = fakes();
  const noBridge = createLoopKickConnect({ bridge: { configured: false }, identity: f.identity, secret: SECRET });
  assert.equal(noBridge.configured, false);
  assert.equal((await noBridge.connect({ discordUserId: DISCORD, login: 'a', password: 'b' })).error, 'connect_unconfigured');
  const noIdentity = createLoopKickConnect({ bridge: f.bridge, identity: { configured: false }, secret: SECRET });
  assert.equal((await noIdentity.connect({ discordUserId: DISCORD, login: 'a', password: 'b' })).error, 'connect_unconfigured');
  const shortSecret = createLoopKickConnect({ bridge: f.bridge, identity: f.identity, secret: 'short' });
  assert.equal(shortSecret.connectUrl({ discordUserId: DISCORD }).error, 'connect_unconfigured');
});

test('the connect link is a signed, 10-minute, single-use token the site can verify with the bridge secret', () => {
  const t = 1_700_000_000_000;
  const f = fakes();
  const connect = createLoopKickConnect({ bridge: f.bridge, identity: f.identity, secret: SECRET, now: () => t, siteBase: 'https://stockmarketloop.com/' });
  const out = connect.connectUrl({ discordUserId: DISCORD, discordTag: 'obi' });
  assert.equal(out.ok, true);
  assert.equal(out.expires_at, Math.floor((t + LINK_TTL_MS) / 1000));
  const url = new URL(out.url);
  assert.equal(url.origin + url.pathname, 'https://stockmarketloop.com/connect-discord/');
  const token = url.searchParams.get('lk');
  const claims = verifyConnectToken(token, SECRET, () => t + LINK_TTL_MS - 1000);
  assert.equal(claims.discordUserId, DISCORD);
  assert.equal(claims.discordTag, 'obi');
  assert.equal(claims.expiresAt, out.expires_at);
  assert.ok(claims.nonce.length >= 12);
  assert.equal(verifyConnectToken(token, SECRET, () => t + LINK_TTL_MS + 1000), null, 'expired');
  assert.equal(verifyConnectToken(token, 'b'.repeat(40), () => t), null, 'other secret');
  assert.equal(verifyConnectToken(token.slice(0, -1) + (token.endsWith('0') ? '1' : '0'), SECRET, () => t), null, 'tampered signature');
  const [v, payload, sig] = token.split('.');
  const swapped = Buffer.from(JSON.stringify({ d: '999999999999999999', t: 'obi', e: claims.expiresAt, n: claims.nonce })).toString('base64url');
  assert.equal(verifyConnectToken(`${v}.${swapped}.${sig}`, SECRET, () => t), null, 'tampered payload');
  assert.equal(verifyConnectToken('v1.x', SECRET, () => t), null);
  assert.notEqual(connect.connectUrl({ discordUserId: DISCORD }).url, out.url, 'fresh nonce each time');
  assert.equal(connect.connectUrl({ discordUserId: '12' }).error, 'invalid_discord_user');
});

test('signConnectToken mirrors the PHP check: HMAC over "lk-connect.<payload>"', () => {
  const token = signConnectToken({ discordUserId: DISCORD, discordTag: 'x', secret: SECRET, expiresAt: 1_700_000_600_000, nonce: 'n1' });
  const [, payload, sig] = token.split('.');
  assert.equal(sig, crypto.createHmac('sha256', SECRET).update(`lk-connect.${payload}`).digest('hex'));
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url').toString()), { d: DISCORD, t: 'x', e: 1_700_000_600, n: 'n1' });
});

test('bridge.link posts the signed body to /discord-link and maps the site answers', async () => {
  const seen = [];
  const answers = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); const a = answers.shift(); return { ok: a.status < 400, status: a.status, json: async () => a.body }; };
  const bridge = createLoopKickBridge({ baseUrl: 'https://stockmarketloop.com', secret: SECRET, fetchImpl, now: () => 1_700_000_000_000 });
  answers.push({ status: 200, body: { ok: true, linked: true, user_id: 42, verified: false } });
  const ok = await bridge.link({ discordUserId: DISCORD, wpUserId: 42, discordTag: 'obi' });
  assert.deepEqual(ok, { ok: true, status: 200, linked: true, userId: 42, verified: false });
  assert.equal(seen[0].url, 'https://stockmarketloop.com/wp-json/sml-loop-kick/v1/discord-link');
  const body = seen[0].init.body;
  assert.deepEqual(JSON.parse(body), { discord_user_id: DISCORD, wp_user_id: 42, discord_tag: 'obi' });
  const expected = crypto.createHmac('sha256', SECRET).update(`1700000000./wp-json/sml-loop-kick/v1/discord-link.${crypto.createHash('sha256').update(body).digest('hex')}`).digest('hex');
  assert.equal(seen[0].init.headers['x-sml-lk-signature'], `sha256=${expected}`);
  answers.push({ status: 409, body: { code: 'sml_lkd_discord_already_linked' } });
  assert.deepEqual(await bridge.link({ discordUserId: DISCORD, wpUserId: 42 }), { ok: false, status: 409, error: 'discord_already_linked' });
  answers.push({ status: 404, body: { code: 'rest_no_route' } });
  assert.deepEqual(await bridge.link({ discordUserId: DISCORD, wpUserId: 42 }), { ok: false, status: 503, error: 'connect_unconfigured' });
  answers.push({ status: 500, body: null });
  assert.deepEqual(await bridge.link({ discordUserId: DISCORD, wpUserId: 42 }), { ok: false, status: 503, error: 'loop_kick_unavailable' });
  assert.equal((await bridge.link({ discordUserId: DISCORD, wpUserId: 0 })).error, 'invalid_site_user');
  assert.equal((await createLoopKickBridge({}).link({ discordUserId: DISCORD, wpUserId: 1 })).error, 'loop_kick_unconfigured');
});
