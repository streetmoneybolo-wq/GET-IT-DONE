'use strict';

const crypto = require('node:crypto');
const DISCORD_AUTHORIZE = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN = 'https://discord.com/api/v10/oauth2/token';

/* Short-lived authorization bridge. The Activity receives the Discord access
   token only long enough to complete Discord SDK authentication; application
   features use our separate, short-lived opaque session token. */
function createAcademyOAuth({ clientId = '', clientSecret = '', redirectUri = '', academyAccess = null,
  fetchImpl = fetch, now = Date.now, randomBytes = crypto.randomBytes } = {}) {
  const pending = new Map();
  const sessions = new Map();
  const activityConfigured = Boolean(clientId && clientSecret && redirectUri && academyAccess && typeof academyAccess.verify === 'function');
  const configured = activityConfigured;
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
    clean(sessions);
    const sessionToken = nonce();
    sessions.set(sessionToken, { userId: String(access.userId || ''), expiresAt: now() + 15 * 60_000 });
    return { ok: true, accessToken: token.access_token, sessionToken, userId: String(access.userId || '') };
  }
  async function complete({ code = '', state = '' } = {}) {
    if (!configured) return { ok: false, status: 503, code: 'integration_unconfigured' };
    clean(pending);
    const entry = pending.get(String(state)); pending.delete(String(state));
    if (!entry) return { ok: false, status: 400, code: 'invalid_authorization_state' };
    return exchangeCode(code, redirectUri);
  }
  /* Discord requires the registered redirect URI on the token exchange even
     when its embedded Activity issued the authorization code. */
  const completeActivity = ({ code = '' } = {}) => exchangeCode(code, redirectUri);
  function verifySession(authorization) { clean(sessions); const match = /^Bearer\s+(.+)$/i.exec(String(authorization || '')); const session = match && sessions.get(match[1]); return session ? { ok: true, userId: session.userId } : { ok: false, status: 401, code: 'authorization_required' }; }
  return { configured, activityConfigured, start, complete, completeActivity, verifySession };
}
module.exports = { createAcademyOAuth };
