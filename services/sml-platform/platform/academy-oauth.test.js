'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcademyOAuth } = require('./academy-oauth');
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('Academy OAuth exchanges a code then issues only an opaque short-lived session', async () => {
  let time = 1_700_000_000_000; const requests = [];
  const oauth = createAcademyOAuth({ clientId: 'client', clientSecret: 'secret', redirectUri: 'https://example.test/callback', now: () => time, randomBytes: () => Buffer.alloc(32, 7), academyAccess: { verify: async (value) => { assert.equal(value, 'Bearer discord-user-token'); return { ok: true, userId: '420000000000000042' }; } }, fetchImpl: async (url, options) => { requests.push({ url, options }); return response(200, { access_token: 'discord-user-token' }); } });
  const start = oauth.start(); const authorize = new URL(start.url);
  assert.equal(authorize.searchParams.get('scope'), 'identify guilds.members.read');
  const result = await oauth.complete({ code: 'code', state: authorize.searchParams.get('state') });
  assert.equal(result.ok, true); assert.notEqual(result.sessionToken, 'discord-user-token'); assert.equal(oauth.verifySession(`Bearer ${result.sessionToken}`).userId, '420000000000000042');
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
    academyAccess: { verify: async (value) => { assert.equal(value, 'Bearer activity-token'); return { ok: true, userId: '770000000000000077' }; } },
    randomBytes: () => Buffer.alloc(32, 9),
    fetchImpl: async (url, options) => { requests.push({ url, options }); return response(200, { access_token: 'activity-token' }); }
  });
  assert.equal(oauth.activityConfigured, true);
  const result = await oauth.completeActivity({ code: 'embedded-code' });
  assert.equal(result.ok, true);
  assert.equal(result.accessToken, 'activity-token');
  assert.equal(oauth.verifySession(`Bearer ${result.sessionToken}`).userId, '770000000000000077');
  assert.equal(requests[0].url, 'https://discord.com/api/v10/oauth2/token');
  assert.match(requests[0].options.body, /code=embedded-code/);
  assert.doesNotMatch(requests[0].options.body, /redirect_uri=/);
});

test('the session carries the member own Discord display name, fetched with their own token, never the bot', async () => {
  const requests = [];
  const respondTo = (url) => {
    if (String(url).includes('/oauth2/token')) return response(200, { access_token: 'member-token' });
    if (String(url).includes('/users/@me')) return response(200, { username: 'ace123', global_name: 'Ace Trader' });
    return response(404, {});
  };
  const oauth = createAcademyOAuth({
    clientId: 'academy-client', clientSecret: 'academy-secret',
    academyAccess: { verify: async () => ({ ok: true, userId: '420000000000000042' }) },
    fetchImpl: async (url, options) => { requests.push({ url, options }); return respondTo(url); }
  });
  const result = await oauth.completeActivity({ code: 'c' });
  assert.equal(result.ok, true);
  assert.equal(result.displayName, 'Ace Trader', 'global_name wins over username');
  assert.equal(oauth.verifySession('Bearer ' + result.sessionToken).displayName, 'Ace Trader', 'the signed session token itself carries the verified name');
  const nameRequest = requests.find((r) => String(r.url).includes('/users/@me'));
  assert.equal(nameRequest.options.headers.authorization, 'Bearer member-token', 'the member own token, never a bot token');
});

test('no global_name falls back to username; a failed name lookup never blocks sign-in', async () => {
  const withUsernameOnly = createAcademyOAuth({
    clientId: 'academy-client', clientSecret: 'academy-secret',
    academyAccess: { verify: async () => ({ ok: true, userId: '420000000000000042' }) },
    fetchImpl: async (url) => (String(url).includes('/users/@me') ? response(200, { username: 'ace123' }) : response(200, { access_token: 'member-token' }))
  });
  assert.equal((await withUsernameOnly.completeActivity({ code: 'c' })).displayName, 'ace123');

  const nameLookupFails = createAcademyOAuth({
    clientId: 'academy-client', clientSecret: 'academy-secret',
    academyAccess: { verify: async () => ({ ok: true, userId: '420000000000000042' }) },
    fetchImpl: async (url) => (String(url).includes('/users/@me') ? response(500, {}) : response(200, { access_token: 'member-token' }))
  });
  const failed = await nameLookupFails.completeActivity({ code: 'c' });
  assert.equal(failed.ok, true, 'sign-in still succeeds');
  assert.equal(failed.displayName, '');
});

test('two Discord members receive distinct Activity sessions bound to their own IDs', async () => {
  let counter = 0;
  const tokens = { 'code-a': 'token-a', 'code-b': 'token-b' };
  const users = { 'Bearer token-a': '111111111111111111', 'Bearer token-b': '222222222222222222' };
  const oauth = createAcademyOAuth({
    clientId: 'academy-client', clientSecret: 'academy-secret',
    academyAccess: { verify: async (value) => ({ ok: true, userId: users[value] }) },
    randomBytes: () => Buffer.alloc(32, ++counter),
    fetchImpl: async (_url, options) => response(200, { access_token: tokens[new URLSearchParams(options.body).get('code')] })
  });
  const a = await oauth.completeActivity({ code: 'code-a' });
  const b = await oauth.completeActivity({ code: 'code-b' });
  assert.notEqual(a.sessionToken, b.sessionToken);
  assert.equal(oauth.verifySession(`Bearer ${a.sessionToken}`).userId, '111111111111111111');
  assert.equal(oauth.verifySession(`Bearer ${b.sessionToken}`).userId, '222222222222222222');
  assert.equal(oauth.verifySession('Bearer forged').ok, false);
});

test('Activity sessions survive a server restart but not tampering, expiry, or a different secret', async () => {
  let time = 1_700_000_000_000;
  const options = {
    clientId: 'academy-client', clientSecret: 'academy-secret', now: () => time,
    academyAccess: { verify: async () => ({ ok: true, userId: '111111111111111111' }) },
    fetchImpl: async () => response(200, { access_token: 'activity-token' })
  };
  const { sessionToken } = await createAcademyOAuth(options).completeActivity({ code: 'c' });
  // A fresh instance stands in for the process after a deploy.
  const restarted = createAcademyOAuth(options);
  assert.equal(restarted.verifySession(`Bearer ${sessionToken}`).userId, '111111111111111111');
  assert.doesNotMatch(sessionToken, /academy-secret|activity-token/);

  const [version, body, signature] = sessionToken.split('.');
  const forgedClaims = { ...JSON.parse(Buffer.from(body, 'base64url').toString('utf8')), u: '222222222222222222' };
  const forged = `${version}.${Buffer.from(JSON.stringify(forgedClaims)).toString('base64url')}.${signature}`;
  assert.equal(restarted.verifySession(`Bearer ${forged}`).ok, false, 'a changed user id breaks the signature');
  assert.equal(createAcademyOAuth({ ...options, clientSecret: 'other-secret' }).verifySession(`Bearer ${sessionToken}`).ok, false);
  assert.equal(restarted.verifySession(`Bearer ${sessionToken}x`).ok, false);

  time += 15 * 60_000 + 1;
  assert.equal(restarted.verifySession(`Bearer ${sessionToken}`).code, 'authorization_required', 'short-lived: expires after 15 minutes');
});

test('an unconfigured Academy never accepts a session token', () => {
  const oauth = createAcademyOAuth();
  assert.equal(oauth.verifySession('Bearer v1.e30.AAAA').ok, false);
});

/* ---------- access tiers, free sessions and the buy-link handoff ---------- */
const crypto = require('node:crypto');
const MEMBER_ID = '420000000000000042';
function tierOAuth(verifyResult, extra = {}) {
  return createAcademyOAuth({
    clientId: 'academy-client', clientSecret: 'academy-secret',
    academyAccess: { verify: async () => verifyResult },
    fetchImpl: async () => response(200, { access_token: 'activity-token' }),
    ...extra
  });
}
const claimsOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));

test('member sessions keep the original claims; academy sessions carry their tier', async () => {
  const member = await tierOAuth({ ok: true, userId: MEMBER_ID, tier: 'member' }).completeActivity({ code: 'c' });
  assert.equal(member.tier, 'member');
  assert.deepEqual(Object.keys(claimsOf(member.sessionToken)).sort(), ['e', 'n', 'u'], 'no tier claim for members, exactly as before');
  const legacy = await tierOAuth({ ok: true, userId: MEMBER_ID }).completeActivity({ code: 'c' });
  assert.equal(legacy.tier, 'member', 'an access check without a tier is a member');
  const oauth = tierOAuth({ ok: true, userId: MEMBER_ID, tier: 'academy' });
  const academy = await oauth.completeActivity({ code: 'c' });
  assert.equal(academy.tier, 'academy');
  assert.equal(claimsOf(academy.sessionToken).t, 'academy');
  assert.deepEqual(oauth.verifySession(`Bearer ${academy.sessionToken}`), { ok: true, userId: MEMBER_ID, tier: 'academy', displayName: '' });
  assert.deepEqual(oauth.verifySession(`Bearer ${member.sessionToken}`), { ok: true, userId: MEMBER_ID, tier: 'member', displayName: '' });
});

test('a tier claim cannot be forged or promoted', async () => {
  const oauth = tierOAuth({ ok: true, userId: MEMBER_ID, tier: 'academy' });
  const { sessionToken } = await oauth.completeActivity({ code: 'c' });
  const [version, body, signature] = sessionToken.split('.');
  const promoted = { ...JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) };
  delete promoted.t;
  const forged = `${version}.${Buffer.from(JSON.stringify(promoted)).toString('base64url')}.${signature}`;
  assert.equal(oauth.verifySession(`Bearer ${forged}`).ok, false, 'dropping the academy tier breaks the signature');
  const key = Buffer.from(crypto.hkdfSync('sha256', 'academy-secret', 'sml-academy-activity', 'session-v1', 32));
  const weird = `v1.${Buffer.from(JSON.stringify({ u: MEMBER_ID, e: Date.now() + 60_000, n: 'x', t: 'owner' })).toString('base64url')}`;
  const signedWeird = `${weird}.${crypto.createHmac('sha256', key).update(weird).digest('base64url')}`;
  assert.equal(oauth.verifySession(`Bearer ${signedWeird}`).ok, false, 'an unknown tier is refused even when signed');
});

test('SML_ACADEMY_FREE_SESSIONS off: a role miss stays a 403 with no session or Discord token, but names the member', async () => {
  const oauth = tierOAuth({ ok: false, status: 403, code: 'academy_role_required', inGuild: true, userId: MEMBER_ID });
  const refused = await oauth.completeActivity({ code: 'c' });
  assert.deepEqual(refused, { ok: false, status: 403, code: 'academy_role_required', userId: MEMBER_ID, inGuild: true });
  assert.equal('sessionToken' in refused, false);
  assert.equal('accessToken' in refused, false);
});

test('SML_ACADEMY_FREE_SESSIONS on: a guild member without a role gets a free session; outsiders are still refused', async () => {
  const free = tierOAuth({ ok: false, status: 403, code: 'academy_role_required', inGuild: true, userId: MEMBER_ID }, { freeSessions: true });
  const result = await free.completeActivity({ code: 'c' });
  assert.equal(result.ok, true);
  assert.equal(result.tier, 'free');
  assert.equal(result.accessToken, 'activity-token');
  assert.deepEqual(free.verifySession(`Bearer ${result.sessionToken}`), { ok: true, userId: MEMBER_ID, tier: 'free', displayName: '' });
  const outsider = await tierOAuth({ ok: false, status: 403, code: 'academy_role_required', inGuild: false, userId: MEMBER_ID }, { freeSessions: true }).completeActivity({ code: 'c' });
  assert.equal(outsider.ok, false);
  assert.equal('sessionToken' in outsider, false);
  const unnamed = await tierOAuth({ ok: false, status: 403, code: 'academy_role_required', inGuild: true }, { freeSessions: true }).completeActivity({ code: 'c' });
  assert.equal(unnamed.ok, false, 'no free session without a verified Discord id');
  const signedOut = await tierOAuth({ ok: false, status: 401, code: 'authorization_required' }, { freeSessions: true }).completeActivity({ code: 'c' });
  assert.equal(signedOut.status, 401);
  const paid = await tierOAuth({ ok: true, userId: MEMBER_ID, tier: 'free' }, { freeSessions: true }).completeActivity({ code: 'c' });
  assert.equal(paid.tier, 'member', 'the access check can never itself hand out the free tier');
});

const { createBillingHandoff } = require('./academy-oauth');
const { hashCode } = require('./academy/billing/handoff');
const GUILD_ID = '938894329076940820';
const PUBLIC_URL = 'https://making-easy-money-academy.onrender.com';
function recordingPool() {
  const queries = [];
  return { queries, query: async (sql, params) => { queries.push({ sql, params }); return { rows: [], rowCount: 1 }; } };
}

/* The API mints the one-time code in process with the billing engine's
   issueHandoff() over the shared database (see handoff.js), so no signed HTTP
   hop, second secret or unsigned-timestamp replay window exists. */
test('the billing handoff mints the one-time code in process: one row, only its hash stored, the URL on the academy origin', async () => {
  const pool = recordingPool();
  const handoff = createBillingHandoff({ pool, publicUrl: `${PUBLIC_URL}/` });
  assert.equal(handoff.configured, true);
  const minted = await handoff.mint({ discordUserId: MEMBER_ID, guildId: GUILD_ID, source: 'activity' });
  assert.equal(minted.ok, true);
  const url = new URL(minted.url);
  assert.equal(url.origin, PUBLIC_URL);
  assert.equal(url.pathname, '/v1/academy/billing/start');
  const code = url.searchParams.get('h');
  assert.match(code, /^[A-Za-z0-9_-]{40,64}$/);
  assert.equal(pool.queries.length, 1);
  assert.match(pool.queries[0].sql, /INSERT INTO academy_billing_handoffs/);
  assert.deepEqual(pool.queries[0].params, [hashCode(code), MEMBER_ID, GUILD_ID, 'activity']);
  assert.equal(JSON.stringify(pool.queries).includes(code), false, 'the code itself is never stored');
  assert.doesNotMatch(minted.url, /Bearer|v1\.|b1\./, 'no session or ticket travels in the URL');
  assert.equal((await handoff.mint({ discordUserId: MEMBER_ID, guildId: GUILD_ID, source: 'hub' })).ok, true);
  assert.equal(pool.queries[1].params[3], 'hub');
});

test('the billing handoff fails closed: unconfigured, bad input, a missing table, a slow database or a URL on another origin', async () => {
  const pool = recordingPool();
  assert.equal((await createBillingHandoff({ pool, publicUrl: '' }).mint({ discordUserId: MEMBER_ID, guildId: GUILD_ID })).code, 'handoff_unconfigured');
  assert.equal(createBillingHandoff({ pool, publicUrl: 'http://making-easy-money-academy.onrender.com' }).configured, false, 'https only');
  assert.equal(createBillingHandoff({ pool: null, publicUrl: PUBLIC_URL }).configured, false);
  const good = createBillingHandoff({ pool, publicUrl: PUBLIC_URL });
  assert.equal((await good.mint({ discordUserId: 'nope', guildId: GUILD_ID })).code, 'handoff_invalid_request');
  assert.equal((await good.mint({ discordUserId: MEMBER_ID, guildId: 'x' })).code, 'handoff_invalid_request');
  assert.equal((await good.mint({ discordUserId: MEMBER_ID, guildId: GUILD_ID, source: 'email' })).code, 'handoff_invalid_request');
  assert.equal(pool.queries.length, 0, 'invalid requests never reach the database');
  const missing = createBillingHandoff({ pool: { query: async () => { throw new Error('relation "academy_billing_handoffs" does not exist'); } }, publicUrl: PUBLIC_URL });
  assert.equal((await missing.mint({ discordUserId: MEMBER_ID, guildId: GUILD_ID })).code, 'handoff_unavailable', 'schema 028 absent: no link, no throw');
  const slow = createBillingHandoff({ pool: { query: () => new Promise(() => {}) }, publicUrl: PUBLIC_URL, timeoutMs: 20 });
  assert.equal((await slow.mint({ discordUserId: MEMBER_ID, guildId: GUILD_ID })).code, 'handoff_timeout');
  const foreign = createBillingHandoff({ pool, publicUrl: PUBLIC_URL, issue: async () => ({ url: 'https://evil.example/v1/academy/billing/start?h=x' }) });
  assert.equal((await foreign.mint({ discordUserId: MEMBER_ID, guildId: GUILD_ID })).code, 'handoff_invalid_url');
  const plain = createBillingHandoff({ pool, publicUrl: PUBLIC_URL, issue: async () => ({ url: 'http://making-easy-money-academy.onrender.com/x' }) });
  assert.equal((await plain.mint({ discordUserId: MEMBER_ID, guildId: GUILD_ID })).ok, false);
});

test('buy tickets: one Discord id for 15 minutes, never a session, never forgeable', async () => {
  let clock = 1_800_000_000_000;
  const oauth = tierOAuth({ ok: true, userId: MEMBER_ID }, { now: () => clock });
  const ticket = oauth.issueBuyTicket(MEMBER_ID);
  assert.match(ticket, /^b1\./);
  assert.deepEqual(oauth.verifyBuyTicket(ticket), { userId: MEMBER_ID });
  assert.equal(oauth.verifySession(`Bearer ${ticket}`).ok, false, 'a ticket is not a session');
  const { sessionToken } = await oauth.completeActivity({ code: 'c' });
  assert.equal(oauth.verifyBuyTicket(sessionToken), null, 'a session is not a ticket');
  const [prefix, body, signature] = ticket.split('.');
  const swapped = { ...JSON.parse(Buffer.from(body, 'base64url').toString('utf8')), u: '420000000000000099' };
  assert.equal(oauth.verifyBuyTicket(`${prefix}.${Buffer.from(JSON.stringify(swapped)).toString('base64url')}.${signature}`), null, 'the id cannot be swapped');
  assert.equal(tierOAuth({ ok: true }, { clientSecret: 'another-secret' }).verifyBuyTicket(ticket), null);
  assert.equal(oauth.verifyBuyTicket(''), null);
  assert.equal(oauth.issueBuyTicket('not-a-snowflake'), '');
  assert.equal(createAcademyOAuth().issueBuyTicket(MEMBER_ID), '', 'no secret, no tickets');
  clock += 15 * 60_000;
  assert.equal(oauth.verifyBuyTicket(ticket), null, 'expired');
});

test('pop-out renewal keys: signed, 12 hours, never a session, and pop-out sessions are ordinary sessions', () => {
  let time = 1_700_000_000_000;
  const oauth = createAcademyOAuth({ clientId: 'c', clientSecret: 's', now: () => time, academyAccess: { verify: async () => ({ ok: true }) } });
  const renew = oauth.issuePopoutRenewal('420000000000000042', 'Obi');
  assert.match(renew, /^p1\./);
  assert.deepEqual(oauth.verifyPopoutRenewal(renew), { userId: '420000000000000042', displayName: 'Obi' });
  assert.equal(oauth.verifySession(`Bearer ${renew}`).ok, false, 'a renewal key is not a session');
  const session = oauth.issuePopoutSession('420000000000000042', 'academy', 'Obi');
  assert.deepEqual(oauth.verifySession(`Bearer ${session}`), { ok: true, userId: '420000000000000042', tier: 'academy', displayName: 'Obi' });
  assert.equal(oauth.verifyPopoutRenewal(session), null, 'a session is not a renewal key');
  assert.equal(oauth.issuePopoutSession('420000000000000042', 'owner'), '', 'only known tiers');
  const forged = renew.slice(0, -2) + (renew.endsWith('A') ? 'BB' : 'AA');
  assert.equal(oauth.verifyPopoutRenewal(forged), null);
  time += 13 * 60 * 60 * 1000;
  assert.equal(oauth.verifyPopoutRenewal(renew), null, 'expires after 12 hours');
});
