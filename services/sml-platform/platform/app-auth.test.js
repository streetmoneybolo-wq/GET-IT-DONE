'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppAuth, createAppSessionStore, cleanDevice } = require('./app-auth');

const SECRET = 'x'.repeat(48);
const START = Date.UTC(2026, 9, 12, 14, 0);

/* a stand-in for the site's app identity plugin */
function fakeIdentity() {
  const calls = [];
  return {
    calls,
    configured: true,
    async login({ login, password, code }) {
      calls.push({ login, code });
      if (login === 'two.step' && password === 'pw') {
        if (!code) return { ok: false, status: 403, error: 'two_step_required', method: 'totp' };
        if (code !== '123456') return { ok: false, status: 403, error: 'two_step_invalid' };
        return { ok: true, status: 200, user: { id: 42, login: 'two.step', displayName: 'Two Step' } };
      }
      if (login === 'vaughn' && password === 'pw') return { ok: true, status: 200, user: { id: 7, login: 'vaughn', displayName: 'Vaughn', roles: ['administrator'] } };
      return { ok: false, status: 401, error: 'invalid_credentials' };
    },
    async me(userId) { return { ok: true, status: 200, user: { id: userId } }; }
  };
}

function build({ identity = fakeIdentity(), secret = SECRET } = {}) {
  let t = START;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const store = createAppSessionStore();
  const auth = createAppAuth({ store, identity, secret, now: clock.now, logger: () => {} });
  return { auth, store, identity, clock };
}

test('a member signs in with their site account and gets a 15-minute access token plus a 60-day refresh token', async () => {
  const { auth, clock } = build();
  const r = await auth.login({ login: 'vaughn', password: 'pw', device: { id: 'ph1', name: 'Vaughn iPhone', platform: 'ios', appVersion: '1.0.0' } });
  assert.equal(r.ok, true);
  assert.equal(r.user.id, 7);
  assert.equal(r.tokenType, 'Bearer');
  assert.match(r.accessToken, /^a1\.[\w-]+\.[\w-]+$/);
  assert.match(r.refreshToken, /^r1\.[\w-]{43}$/);
  assert.equal(new Date(r.accessExpiresAt).getTime(), START + 15 * 60_000);
  assert.equal(new Date(r.refreshExpiresAt).getTime(), START + 60 * 86_400_000);
  const v = auth.verify('Bearer ' + r.accessToken);
  assert.deepEqual(v, { ok: true, userId: 7, sessionId: r.sessionId });
  clock.advance(15 * 60_000 + 1);
  assert.deepEqual(auth.verify('Bearer ' + r.accessToken), { ok: false, status: 401, code: 'token_expired' });
  const forged = r.accessToken.slice(0, -2) + (r.accessToken.endsWith('a') ? 'bb' : 'aa');
  assert.equal(auth.verify('Bearer ' + forged).code, 'authorization_required');
  assert.equal(auth.verify('').code, 'authorization_required');
});

test('the site\'s refusals pass straight through: wrong password, two-step needed, two-step code wrong', async () => {
  const { auth, identity } = build();
  assert.deepEqual(await auth.login({ login: 'vaughn', password: 'nope' }), { ok: false, status: 401, error: 'invalid_credentials' });
  const need = await auth.login({ login: 'two.step', password: 'pw' });
  assert.equal(need.status, 403); assert.equal(need.error, 'two_step_required'); assert.equal(need.method, 'totp');
  const bad = await auth.login({ login: 'two.step', password: 'pw', code: '000000' });
  assert.equal(bad.error, 'two_step_invalid');
  const good = await auth.login({ login: 'two.step', password: 'pw', code: '123456' });
  assert.equal(good.ok, true); assert.equal(good.user.id, 42);
  assert.equal(identity.calls.length, 4);
  assert.deepEqual(await auth.login({ login: 'ab', password: 'pw' }), { ok: false, status: 400, error: 'invalid_request' });
  assert.deepEqual(await auth.login({ login: 'vaughn', password: 'pw', code: 'not a code!' }), { ok: false, status: 400, error: 'invalid_code' });
});

test('refresh rotates the pair; an old refresh token presented again revokes the whole device family', async () => {
  const { auth, clock } = build();
  const first = await auth.login({ login: 'vaughn', password: 'pw', device: { platform: 'android' } });
  clock.advance(60_000);
  const second = await auth.refresh({ refreshToken: first.refreshToken });
  assert.equal(second.ok, true);
  assert.equal(second.userId, 7);
  assert.notEqual(second.refreshToken, first.refreshToken);
  assert.notEqual(second.sessionId, first.sessionId);
  assert.equal(auth.verify('Bearer ' + second.accessToken).ok, true);
  // the device presents the first token again (a leaked copy, or a lost response)
  const reuse = await auth.refresh({ refreshToken: first.refreshToken });
  assert.deepEqual(reuse, { ok: false, status: 401, error: 'refresh_reused' });
  // ... and the current token of that family is gone too
  const after = await auth.refresh({ refreshToken: second.refreshToken });
  assert.equal(after.error, 'refresh_revoked');
  assert.equal(await auth.sessionLive(second.sessionId), false);
  assert.deepEqual(await auth.refresh({ refreshToken: 'r1.' + 'A'.repeat(43) }), { ok: false, status: 401, error: 'invalid_refresh' });
  assert.deepEqual(await auth.refresh({ refreshToken: 'garbage' }), { ok: false, status: 401, error: 'invalid_refresh' });
});

test('a refresh token past 60 days is refused; sign-out is idempotent; the member sees and revokes their devices', async () => {
  const { auth, clock } = build();
  const phone = await auth.login({ login: 'vaughn', password: 'pw', device: { id: 'p', name: 'Phone', platform: 'ios' } });
  clock.advance(1_000);
  const tablet = await auth.login({ login: 'vaughn', password: 'pw', device: { id: 't', name: 'Tablet', platform: 'android' } });
  const list = await auth.sessions(7, phone.sessionId);
  assert.deepEqual(list.map((s) => [s.device.name, s.current]), [['Tablet', false], ['Phone', true]]);
  const gone = await auth.revokeSession(7, tablet.sessionId);
  assert.equal(gone.ok, true);
  assert.equal(await auth.sessionLive(tablet.sessionId), false);
  assert.equal((await auth.revokeSession(99, phone.sessionId)).error, 'session_not_found', 'another member cannot revoke it');
  assert.deepEqual(await auth.logout({ refreshToken: tablet.refreshToken }), { ok: true, status: 200 });
  assert.deepEqual(await auth.logout({ refreshToken: 'nothing' }), { ok: true, status: 200 });
  clock.advance(61 * 86_400_000);
  assert.deepEqual(await auth.refresh({ refreshToken: phone.refreshToken }), { ok: false, status: 401, error: 'refresh_expired' });
  assert.deepEqual(await auth.sessions(7), []);
});

test('revoke-all signs every device out at once', async () => {
  const { auth } = build();
  const a = await auth.login({ login: 'vaughn', password: 'pw' });
  const b = await auth.login({ login: 'vaughn', password: 'pw' });
  await auth.revokeAll(7);
  assert.equal((await auth.refresh({ refreshToken: a.refreshToken })).error, 'refresh_revoked');
  assert.equal((await auth.refresh({ refreshToken: b.refreshToken })).error, 'refresh_revoked');
});

test('without a signing secret or a configured identity the auth fails closed', async () => {
  const noSecret = createAppAuth({ identity: fakeIdentity(), secret: 'short' });
  assert.equal(noSecret.configured, false);
  assert.deepEqual(await noSecret.login({ login: 'vaughn', password: 'pw' }), { ok: false, status: 503, error: 'app_auth_unconfigured' });
  assert.equal(noSecret.verify('Bearer a1.x.y').code, 'authorization_required');
  const noIdentity = createAppAuth({ identity: { configured: false }, secret: SECRET });
  assert.equal(noIdentity.configured, false);
});

test('device details are cleaned before they are stored', () => {
  assert.deepEqual(cleanDevice({ id: 'abc<script>', name: ' My <b>Phone ', platform: 'iOS', appVersion: '1.2.3+45 beta' }), { id: 'abcscript', name: 'My bPhone', platform: 'ios', appVersion: '1.2.3+45beta' });
  assert.deepEqual(cleanDevice({ platform: 'windows' }).platform, 'other');
  assert.deepEqual(cleanDevice(null), { id: '', name: '', platform: '', appVersion: '' });
});
