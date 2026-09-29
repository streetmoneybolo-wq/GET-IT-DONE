'use strict';

const crypto = require('node:crypto');
const { issueHandoff } = require('./academy/billing/handoff');
const DISCORD_AUTHORIZE = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN = 'https://discord.com/api/v10/oauth2/token';

const SESSION_TTL_MS = 15 * 60_000;
const SNOWFLAKE = /^\d{15,24}$/;
/* 'member' sessions carry no tier claim, exactly as before tiers existed, so a
   token without `t` is a member token. Only 'academy' and 'free' are written. */
const SESSION_TIERS = new Set(['member', 'academy', 'free']);

/* Short-lived authorization bridge. The Activity receives the Discord access
   token only long enough to complete Discord SDK authentication; application
   features use our separate, short-lived session token.

   Session tokens are signed rather than stored, so a deploy or restart does
   not sign every student out mid-lesson. The signing key is derived from the
   Academy client secret (never used directly, never sent anywhere). A token
   binds one Discord user id, an expiry and (for non-member tiers) the access
   tier; it carries no other data. The Activity renews an expired token
   silently, and every renewal re-checks the member's Academy role with
   Discord.

   `freeSessions` (SML_ACADEMY_FREE_SESSIONS, default off): a guild member who
   holds no Academy role gets a 'free' tier session instead of a 403. Callers
   outside the guild are still refused. */
function createAcademyOAuth({ clientId = '', clientSecret = '', redirectUri = '', academyAccess = null,
  fetchImpl = fetch, now = Date.now, randomBytes = crypto.randomBytes, freeSessions = false } = {}) {
  const pending = new Map();
  const sessionKey = clientSecret ? Buffer.from(crypto.hkdfSync('sha256', String(clientSecret), 'sml-academy-activity', 'session-v1', 32)) : null;
  const sign = (body) => crypto.createHmac('sha256', sessionKey).update(body).digest('base64url');
  /* Buy tickets have their own key and a 'b1' prefix, so a ticket is never a
     session and a session is never a ticket. */
  const buyKey = clientSecret ? Buffer.from(crypto.hkdfSync('sha256', String(clientSecret), 'sml-academy-activity', 'buy-ticket-v1', 32)) : null;
  const signBuy = (body) => crypto.createHmac('sha256', buyKey).update(body).digest('base64url');
  function issueSession(userId, tier = 'member', displayName = '') {
    const claims = { u: String(userId), e: now() + SESSION_TTL_MS, n: randomBytes(16).toString('base64url') };
    if (tier && tier !== 'member') claims.t = tier;
    // The verified Discord display name rides inside the signed token, so anything that trusts the
    // session (the chat) can label the member without taking a name from the client.
    if (displayName) claims.d = String(displayName).slice(0, 80);
    const body = `v1.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
    return `${body}.${sign(body)}`;
  }
  function readSession(token) {
    const parts = String(token || '').split('.');
    if (!sessionKey || parts.length !== 3 || parts[0] !== 'v1') return null;
    const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`));
    const given = Buffer.from(parts[2]);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    let claims;
    try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch (_) { return null; }
    if (!claims || !/^\d{15,24}$/.test(String(claims.u)) || !(Number(claims.e) > now())) return null;
    const tier = claims.t === undefined ? 'member' : String(claims.t);
    if (!SESSION_TIERS.has(tier)) return null;
    const displayName = String(claims.d || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80);
    return { userId: String(claims.u), tier, displayName };
  }
  const activityConfigured = Boolean(clientId && clientSecret && academyAccess && typeof academyAccess.verify === 'function');
  const configured = Boolean(activityConfigured && redirectUri);
  const nonce = () => randomBytes(32).toString('base64url');
  const clean = (map) => { const cutoff = now(); for (const [key, value] of map) if (value.expiresAt <= cutoff) map.delete(key); };
  function start() {
    if (!configured) return { ok: false, status: 503, code: 'integration_unconfigured' };
    clean(pending);
    const state = nonce();
    pending.set(state, { expiresAt: now() + 10 * 60_000 });
    const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'identify guilds.members.read', state, prompt: 'none' });
    return { ok: true, url: `${DISCORD_AUTHORIZE}?${query.toString()}` };
  }
  /* The member's own Discord display name (global_name, falling back to username), fetched with
     their own OAuth token — never the bot's. Used only to label their chat messages with a real
     name instead of a self-chosen one; a failure here never blocks sign-in. */
  async function fetchDisplayName(accessToken) {
    try {
      const res = await fetchImpl('https://discord.com/api/v10/users/@me', { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return '';
      const user = await res.json();
      return String((user && (user.global_name || user.username)) || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80);
    } catch (_) { return ''; }
  }
  async function exchangeCode(code, exchangeRedirectUri = '') {
    if (!activityConfigured) return { ok: false, status: 503, code: 'integration_unconfigured' };
    if (!String(code)) return { ok: false, status: 400, code: 'authorization_denied' };
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const fields = { grant_type: 'authorization_code', code: String(code) };
    if (exchangeRedirectUri) fields.redirect_uri = exchangeRedirectUri;
    const response = await fetchImpl(DISCORD_TOKEN, { method: 'POST', headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(fields).toString(), signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return { ok: false, status: 401, code: 'authorization_failed' };
    const token = await response.json();
    if (!token || typeof token.access_token !== 'string') return { ok: false, status: 401, code: 'authorization_failed' };
    const [access, displayName] = await Promise.all([academyAccess.verify(`Bearer ${token.access_token}`), fetchDisplayName(token.access_token)]);
    if (!access.ok) {
      const userId = SNOWFLAKE.test(String(access.userId || '')) ? String(access.userId) : '';
      if (freeSessions && access.code === 'academy_role_required' && access.inGuild === true && userId) {
        return { ok: true, accessToken: token.access_token, sessionToken: issueSession(userId, 'free', displayName), userId, tier: 'free', displayName };
      }
      /* A refusal never carries a session or the Discord access token. The id
         and guild membership only let the caller offer a way in. */
      return { ok: false, status: access.status || 403, code: access.code || 'academy_role_required',
        ...(userId ? { userId } : {}), ...(typeof access.inGuild === 'boolean' ? { inGuild: access.inGuild } : {}) };
    }
    const tier = SESSION_TIERS.has(access.tier) && access.tier !== 'free' ? access.tier : 'member';
    const sessionToken = issueSession(access.userId || '', tier, displayName);
    return { ok: true, accessToken: token.access_token, sessionToken, userId: String(access.userId || ''), tier, displayName };
  }
  async function complete({ code = '', state = '' } = {}) {
    if (!configured) return { ok: false, status: 503, code: 'integration_unconfigured' };
    clean(pending);
    const entry = pending.get(String(state)); pending.delete(String(state));
    if (!entry) return { ok: false, status: 400, code: 'invalid_authorization_state' };
    return exchangeCode(code, redirectUri);
  }
  const completeActivity = ({ code = '' } = {}) => exchangeCode(code);
  function verifySession(authorization) { const match = /^Bearer\s+(\S+)$/i.exec(String(authorization || '')); const session = match && readSession(match[1]); return session ? { ok: true, userId: session.userId, tier: session.tier, displayName: session.displayName || '' } : { ok: false, status: 401, code: 'authorization_required' }; }
  /* Buy ticket (SML_ACADEMY_BILLING_IN_DISCORD_LINKS): proof, for 15 minutes,
     that the token exchange just verified this Discord id. It goes back to the
     Activity in the token response BODY and is posted to /academy-activity/buy
     only when the member presses 'Get Academy access'; that route mints the
     one-time handoff code. It grants nothing else and never goes in a URL. */
  function issueBuyTicket(userId) {
    if (!buyKey || !SNOWFLAKE.test(String(userId || ''))) return '';
    const body = `b1.${Buffer.from(JSON.stringify({ u: String(userId), e: now() + SESSION_TTL_MS, n: randomBytes(12).toString('base64url') })).toString('base64url')}`;
    return `${body}.${signBuy(body)}`;
  }
  function verifyBuyTicket(ticket) {
    const parts = String(ticket || '').split('.');
    if (!buyKey || parts.length !== 3 || parts[0] !== 'b1') return null;
    const expected = Buffer.from(signBuy(`${parts[0]}.${parts[1]}`));
    const given = Buffer.from(parts[2]);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    let claims;
    try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch (_) { return null; }
    if (!claims || !SNOWFLAKE.test(String(claims.u)) || !(Number(claims.e) > now())) return null;
    return { userId: String(claims.u) };
  }
  return { configured, activityConfigured, start, complete, completeActivity, verifySession, issueBuyTicket, verifyBuyTicket };
}

/* Buy-link handoff (SML_ACADEMY_BILLING_IN_DISCORD_LINKS). A bearer token
   never goes in a URL: the member's Discord id, just verified by the token
   exchange (Activity) or by Discord's signed interaction (hub), is stored as a
   one-time, five-minute code in academy_billing_handoffs (schema 028) and only
   the /v1/academy/billing/start?h=<code> URL is handed out.

   Both services share the database, so the code is minted IN PROCESS with the
   billing engine's own issueHandoff() (platform/academy/billing/handoff.js,
   which documents exactly this use), not over an HTTP hop: no second secret,
   no unsigned-timestamp replay window, no network wait. `publicUrl` is the
   academy service's https origin (SML_ACADEMY_BILLING_PUBLIC_URL); a mint
   that is unconfigured, invalid, slower than `timeoutMs`, fails, or yields
   a URL on another origin returns { ok:false } and no link is shown. */
const HANDOFF_SOURCES = new Set(['activity', 'hub']);
function createBillingHandoff({ pool = null, publicUrl = '', issue = issueHandoff, timeoutMs = 1_500 } = {}) {
  let origin = '';
  try { const url = new URL(String(publicUrl || '')); if (url.protocol === 'https:') origin = url.origin; } catch (_) { origin = ''; }
  const configured = Boolean(origin && pool && typeof pool.query === 'function' && typeof issue === 'function');
  async function mint({ discordUserId = '', guildId = '', source = 'activity' } = {}) {
    if (!configured) return { ok: false, code: 'handoff_unconfigured' };
    if (!SNOWFLAKE.test(String(discordUserId)) || !SNOWFLAKE.test(String(guildId)) || !HANDOFF_SOURCES.has(source)) return { ok: false, code: 'handoff_invalid_request' };
    let timer;
    try {
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
      const issued = await Promise.race([
        Promise.resolve().then(() => issue(pool, { discordUserId: String(discordUserId), guildId: String(guildId), source, publicUrl: origin })),
        timeout
      ]);
      if (!issued) return { ok: false, code: 'handoff_timeout' };
      let url;
      try { url = new URL(String(issued.url || '')); } catch (_) { return { ok: false, code: 'handoff_invalid_url' }; }
      if (url.protocol !== 'https:' || url.origin !== origin) return { ok: false, code: 'handoff_invalid_url' };
      return { ok: true, url: url.toString() };
    } catch (_) {
      return { ok: false, code: 'handoff_unavailable' };
    } finally { clearTimeout(timer); }
  }
  return { configured, mint };
}

module.exports = { createAcademyOAuth, createBillingHandoff };
