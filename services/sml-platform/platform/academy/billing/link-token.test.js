'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createLinkTokens } = require('./link-token');
const { issueHandoff, redeemHandoff, hashCode } = require('./handoff');
const { createAcademyOAuth } = require('../../academy-oauth');
const { createFakeStore, USER, GUILD, clock } = require('./testkit');

const SECRET = 'academy-client-secret';

test('bind tokens round-trip with user, guild, source and purpose', () => {
  const tokens = createLinkTokens({ secret: SECRET });
  const token = tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth', purpose: 'manage' });
  assert.match(token, /^mab1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const bind = tokens.readBind(token);
  assert.equal(bind.userId, USER);
  assert.equal(bind.guildId, GUILD);
  assert.equal(bind.source, 'web_oauth');
  assert.equal(bind.purpose, 'manage');
  assert.equal(tokens.readBind(token, { purpose: 'manage' }).userId, USER);
});

test('a purpose=buy token is refused where manage is required', () => {
  const tokens = createLinkTokens({ secret: SECRET });
  const buy = tokens.issueBind({ userId: USER, guildId: GUILD, source: 'hub', purpose: 'buy' });
  assert.equal(tokens.readBind(buy, { purpose: 'manage' }), null);
  assert.equal(tokens.readBind(buy, { purpose: 'buy' }).source, 'hub');
});

test('expired and tampered bind tokens are rejected', () => {
  const now = clock();
  const tokens = createLinkTokens({ secret: SECRET, now });
  const token = tokens.issueBind({ userId: USER, guildId: GUILD, source: 'activity' });
  now.advance(30 * 60_000 + 1);
  assert.equal(tokens.readBind(token), null);
  now.set(Date.parse('2026-10-05T12:00:00Z'));
  const fresh = tokens.issueBind({ userId: USER, guildId: GUILD, source: 'activity' });
  const [prefix, body, sig] = fresh.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), u: '300000000000000009' })).toString('base64url');
  assert.equal(tokens.readBind(`${prefix}.${forged}.${sig}`), null);
  assert.equal(tokens.readBind(`${prefix}.${body}.${sig.slice(0, -2)}AA`), null);
  assert.equal(createLinkTokens({ secret: 'another-secret' }).readBind(fresh), null);
});

test('cross-rejection: a mab1 token is not an Activity session, and a session is not a bind token', async () => {
  const tokens = createLinkTokens({ secret: SECRET });
  const bind = tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' });
  const oauth = createAcademyOAuth({ clientId: '1551336038713139370', clientSecret: SECRET, academyAccess: { verify: async () => ({ ok: true, userId: USER }) } });
  assert.equal(oauth.verifySession(`Bearer ${bind}`).ok, false);
  /* an Activity session token, built from the SAME secret */
  const fetchImpl = async () => ({ ok: true, json: async () => ({ access_token: 'user-token' }) });
  const activity = createAcademyOAuth({ clientId: '1551336038713139370', clientSecret: SECRET, fetchImpl,
    academyAccess: { verify: async () => ({ ok: true, userId: USER }) } });
  const exchanged = await activity.completeActivity({ code: 'abc' });
  assert.equal(exchanged.ok, true);
  assert.ok(exchanged.sessionToken.startsWith('v1.'));
  assert.equal(tokens.readBind(exchanged.sessionToken), null);
  assert.equal(tokens.readBind(exchanged.sessionToken.replace(/^v1\./, 'mab1.')), null);
});

test('state round-trips only with its matching cookie nonce', () => {
  const now = clock();
  const tokens = createLinkTokens({ secret: SECRET, now });
  const { state, nonce } = tokens.issueState({ purpose: 'buy', pkg: 'monthly' });
  assert.deepEqual(tokens.readState(state, nonce), { purpose: 'buy', pkg: 'monthly', autoJoin: false });
  assert.equal(tokens.readState(state, 'other-nonce'), null);
  assert.equal(tokens.readState(state, ''), null);
  const bind = tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' });
  assert.equal(tokens.readState(bind, nonce), null);
  now.advance(10 * 60_000 + 1);
  assert.equal(tokens.readState(state, nonce), null);
});

test('CSRF values are bound to the bind nonce', () => {
  const tokens = createLinkTokens({ secret: SECRET });
  const a = tokens.readBind(tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' }));
  const b = tokens.readBind(tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' }));
  assert.equal(tokens.checkCsrf(a, tokens.csrfFor(a)), true);
  assert.equal(tokens.checkCsrf(a, tokens.csrfFor(b)), false);
  assert.equal(tokens.checkCsrf(a, ''), false);
});

test('hand-off codes: stored hashed, single use, five minutes, buy only', async () => {
  const now = clock();
  const store = createFakeStore({ now });
  const issued = await issueHandoff(store.pool, { discordUserId: USER, guildId: GUILD, source: 'hub', publicUrl: 'https://making-easy-money-academy.onrender.com' });
  assert.match(issued.url, /^https:\/\/making-easy-money-academy\.onrender\.com\/v1\/academy\/billing\/start\?h=[A-Za-z0-9_-]{40,}$/);
  assert.ok(store.db.handoffs.has(hashCode(issued.code)));
  assert.equal([...store.db.handoffs.keys()].includes(issued.code), false);
  const first = await redeemHandoff(store.pool, issued.code);
  assert.deepEqual(first, { userId: USER, guildId: GUILD, source: 'hub', purpose: 'buy' });
  assert.equal(await redeemHandoff(store.pool, issued.code), null);
  const late = await issueHandoff(store.pool, { discordUserId: USER, guildId: GUILD, source: 'activity', publicUrl: 'https://x.example' });
  now.advance(5 * 60_000 + 1);
  assert.equal(await redeemHandoff(store.pool, late.code), null);
  assert.equal(await redeemHandoff(store.pool, 'short'), null);
  await assert.rejects(() => issueHandoff(store.pool, { discordUserId: USER, guildId: GUILD, source: 'web', publicUrl: 'https://x.example' }), /source/);
  await assert.rejects(() => issueHandoff(store.pool, { discordUserId: USER, guildId: GUILD, source: 'hub', publicUrl: 'http://x.example' }), /https/);
});
