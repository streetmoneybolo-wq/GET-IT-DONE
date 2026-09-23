'use strict';

const crypto = require('node:crypto');
const DISCORD_AUTHORIZE = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN = 'https://discord.com/api/v10/oauth2/token';

const SESSION_TTL_MS = 15 * 60_000;

/* Short-lived authorization bridge. The Activity receives the Discord access
   token only long enough to complete Discord SDK authentication; application
   features use our separate, short-lived session token.

   Session tokens are signed rather than stored, so a deploy or restart does
   not sign every student out mid-lesson. The signing key is derived from the
   Academy client secret (never used directly, never sent anywhere). A token
   binds one Discord user id and an expiry; it carries no other data. The
   Activity renews an expired token silently, and every renewal re-checks the
   member's Academy role with Discord. */
function createAcademyOAuth({ clientId = '', clientSecret = '', redirectUri = '', academyAccess = null,
  fetchImpl = fetch, now = Date.now, randomBytes = crypto.randomBytes } = {}) {
  const pending = new Map();
  const sessionKey = clientSecret ? Buffer.from(crypto.hkdfSync('sha256', String(clientSecret), 'sml-academy-activity', 'session-v1', 32)) : null;
  const sign = (body) => crypto.createHmac('sha256', sessionKey).update(body).digest('base64url');
  function issueSession(userId) {
    const claims = { u: String(userId), e: now() + SESSION_TTL_MS, n: randomBytes(16).toString('base64url') };
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
    return { userId: String(claims.u) };
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
    const access = await academyAccess.verify(`Bearer ${token.access_token}`);
    if (!access.ok) return { ok: false, status: access.status || 403, code: access.code || 'academy_role_required' };
    const sessionToken = issueSession(access.userId || '');
    return { ok: true, accessToken: token.access_token, sessionToken, userId: String(access.userId || '') };
  }
  async function complete({ code = '', state = '' } = {}) {
    if (!configured) return { ok: false, status: 503, code: 'integration_unconfigured' };
    clean(pending);
    const entry = pending.get(String(state)); pending.delete(String(state));
    if (!entry) return { ok: false, status: 400, code: 'invalid_authorization_state' };
    return exchangeCode(code, redirectUri);
  }
  const completeActivity = ({ code = '' } = {}) => exchangeCode(code);
  function verifySession(authorization) { const match = /^Bearer\s+(\S+)$/i.exec(String(authorization || '')); const session = match && readSession(match[1]); return session ? { ok: true, userId: session.userId } : { ok: false, status: 401, code: 'authorization_required' }; }
  return { configured, activityConfigured, start, complete, completeActivity, verifySession };
}
module.exports = { createAcademyOAuth };
