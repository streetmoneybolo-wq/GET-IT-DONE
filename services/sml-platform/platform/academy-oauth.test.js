'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcademyOAuth } = require('./academy-oauth');
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('Academy OAuth exchanges a code then issues only an opaque short-lived session', async () => {
  let time = 1_700_000_000_000; const requests = [];
  const oauth = createAcademyOAuth({ clientId: 'client', clientSecret: 'secret', redirectUri: 'https://example.test/callback', now: () => time, randomBytes: () => Buffer.alloc(32, 7), academyAccess: { verify: async (value) => { assert.equal(value, 'Bearer discord-user-token'); return { ok: true, userId: '42' }; } }, fetchImpl: async (url, options) => { requests.push({ url, options }); return response(200, { access_token: 'discord-user-token' }); } });
  const start = oauth.start(); const authorize = new URL(start.url);
  assert.equal(authorize.searchParams.get('scope'), 'identify guilds.members.read');
  const result = await oauth.complete({ code: 'code', state: authorize.searchParams.get('state') });
  assert.equal(result.ok, true); assert.notEqual(result.sessionToken, 'discord-user-token'); assert.equal(oauth.verifySession(`Bearer ${result.sessionToken}`).userId, '42');
  assert.equal(requests[0].url, 'https://discord.com/api/v10/oauth2/token'); assert.match(requests[0].options.headers.authorization, /^Basic /); assert.doesNotMatch(requests[0].options.body, /secret/);
  assert.equal((await oauth.complete({ code: 'again', state: authorize.searchParams.get('state') })).code, 'invalid_authorization_state');
  time += 16 * 60_000; assert.equal(oauth.verifySession(`Bearer ${result.sessionToken}`).code, 'authorization_required');
});
test('Academy OAuth fails closed when not configured', () => { const oauth = createAcademyOAuth(); assert.equal(oauth.start().status, 503); assert.equal(oauth.verifySession('Bearer anything').status, 401); });

test('Academy OAuth exchanges a Discord Activity code without a popup redirect', async () => {
  const requests = [];
  const oauth = createAcademyOAuth({
    clientId: 'academy-client', clientSecret: 'academy-secret',
    redirectUri: 'https://example.test/callback',
    academyAccess: { verify: async (value) => { assert.equal(value, 'Bearer activity-token'); return { ok: true, userId: '77' }; } },
    randomBytes: () => Buffer.alloc(32, 9),
    fetchImpl: async (url, options) => { requests.push({ url, options }); return response(200, { access_token: 'activity-token' }); }
  });
  assert.equal(oauth.activityConfigured, true);
  const result = await oauth.completeActivity({ code: 'embedded-code' });
  assert.equal(result.ok, true);
  assert.equal(result.accessToken, 'activity-token');
  assert.equal(oauth.verifySession(`Bearer ${result.sessionToken}`).userId, '77');
  assert.equal(requests[0].url, 'https://discord.com/api/v10/oauth2/token');
  assert.match(requests[0].options.body, /code=embedded-code/);
  assert.match(requests[0].options.body, /redirect_uri=https%3A%2F%2Fexample.test%2Fcallback/);
});
