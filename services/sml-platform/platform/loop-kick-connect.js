'use strict';

const crypto = require('node:crypto');

/**
 * One-tap LOOP-KICK ↔ Discord connection, from inside the Academy (or the Connect app's
 * standalone LOOP-KICK Activity). Replaces "copy a code from stockmarketloop.com, then type
 * /link-sml in Discord" — the step that kept ending in "Unknown command".
 *
 * Two paths, both proving the member owns the stockmarketloop.com account:
 *   connect()     the member signs in with their site username (or email) + password (+ their
 *                 two-step code when the site asks for one) right in the panel. The site's app
 *                 identity plugin checks the password (the same channel the phone app uses), and
 *                 the signed /discord-link route stores Discord id ↔ WordPress user. Nothing is
 *                 typed in Discord and no code is copied.
 *   connectUrl()  for members without an account yet: a signed, 10-minute, single-use link to
 *                 stockmarketloop.com/connect-discord/?lk=... carrying the Discord id. The site
 *                 asks them to sign in or register, then links automatically on return.
 *
 * The link token is HMAC-SHA256 with the LOOP-KICK bridge secret over "lk-connect.<payload>":
 *   v1.<base64url({d: discordId, t: tag, e: expiresUnix, n: nonce})>.<hex signature>
 * The site verifies with the same secret and burns the nonce.
 */
const SNOWFLAKE = /^\d{15,24}$/;
const LINK_TTL_MS = 10 * 60_000;
const PASS_THROUGH = new Set(['invalid_credentials', 'two_step_required', 'two_step_invalid', 'account_blocked', 'rate_limited', 'invalid_request']);

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signConnectToken({ discordUserId, discordTag = '', secret, expiresAt, nonce }) {
  const payload = base64url(JSON.stringify({ d: String(discordUserId), t: String(discordTag || '').slice(0, 80), e: Math.floor(expiresAt / 1000), n: nonce }));
  const signature = crypto.createHmac('sha256', String(secret)).update(`lk-connect.${payload}`).digest('hex');
  return `v1.${payload}.${signature}`;
}

/* The site-side check, kept here so the test suite proves both ends agree on the format. */
function verifyConnectToken(token, secret, now = Date.now) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !/^[a-f0-9]{64}$/.test(parts[2])) return null;
  const expected = crypto.createHmac('sha256', String(secret)).update(`lk-connect.${parts[1]}`).digest('hex');
  if (expected.length !== parts[2].length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return null;
  let claims = null;
  try { claims = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (_) { return null; }
  if (!claims || !SNOWFLAKE.test(String(claims.d || '')) || !(Number(claims.e) * 1000 > now())) return null;
  return { discordUserId: String(claims.d), discordTag: String(claims.t || ''), expiresAt: Number(claims.e), nonce: String(claims.n || '') };
}

function createLoopKickConnect({ bridge = null, identity = null, secret = '', siteBase = 'https://stockmarketloop.com', now = Date.now, logger = () => {}, perUserPer15Min = 8 } = {}) {
  const configured = Boolean(bridge && bridge.configured && identity && identity.configured && typeof bridge.link === 'function');
  const linkConfigured = String(secret || '').length >= 32;
  const attempts = new Map(); // discordUserId -> { until, n }

  function take(discordUserId) {
    const t = now();
    const row = attempts.get(discordUserId);
    if (!row || row.until <= t) { attempts.set(discordUserId, { until: t + 15 * 60_000, n: 1 }); if (attempts.size > 20_000) attempts.clear(); return { ok: true }; }
    row.n += 1;
    return row.n <= perUserPer15Min ? { ok: true } : { ok: false, retryAfterSec: Math.max(1, Math.ceil((row.until - t) / 1000)) };
  }

  /* Sign the member in with their site password, then store the link. Site refusals come back as they are (the panel explains them). */
  async function connect({ discordUserId = '', discordTag = '', login = '', password = '', code = '', ip = '' } = {}) {
    const cleanId = String(discordUserId || '').replace(/\D/g, '');
    if (!SNOWFLAKE.test(cleanId)) return { ok: false, status: 400, error: 'invalid_discord_user' };
    if (!configured) return { ok: false, status: 503, error: 'connect_unconfigured' };
    const name = String(login || '').trim();
    const pass = typeof password === 'string' ? password : '';
    if (!name || !pass || name.length > 120 || pass.length > 512) return { ok: false, status: 400, error: 'invalid_request' };
    const limit = take(cleanId);
    if (!limit.ok) return { ok: false, status: 429, error: 'rate_limited', retryAfterSec: limit.retryAfterSec };

    const signedIn = await identity.login({ login: name, password: pass, code: String(code || ''), device: { platform: 'discord', name: 'Academy LOOP-KICK connect' }, ip });
    if (!signedIn.ok) {
      const error = PASS_THROUGH.has(signedIn.error) ? signedIn.error : (signedIn.error === 'identity_unconfigured' ? 'connect_unconfigured' : 'site_unavailable');
      const out = { ok: false, status: signedIn.status || 503, error };
      if (signedIn.method) out.method = String(signedIn.method);
      if (signedIn.hint) out.hint = String(signedIn.hint).slice(0, 120);
      if (signedIn.retryAfterSec) out.retryAfterSec = Number(signedIn.retryAfterSec) || 0;
      if (error === 'site_unavailable') logger('warn', 'loop_kick_connect_login_failed', { error: signedIn.error, status: signedIn.status });
      return out;
    }
    const wpUserId = Number(signedIn.user && signedIn.user.id);
    if (!Number.isInteger(wpUserId) || wpUserId <= 0) return { ok: false, status: 503, error: 'site_unavailable' };

    const linked = await bridge.link({ discordUserId: cleanId, wpUserId, discordTag: String(discordTag || '').slice(0, 190) });
    if (!linked.ok) {
      logger('warn', 'loop_kick_connect_link_failed', { error: linked.error, status: linked.status });
      return { ok: false, status: linked.status || 503, error: linked.error || 'site_unavailable' };
    }
    logger('info', 'loop_kick_connected', { discordUserId: cleanId, wpUserId });
    return {
      ok: true, status: 200,
      user: { id: wpUserId, handle: String(signedIn.user.handle || ''), displayName: String(signedIn.user.displayName || ''), emailVerified: signedIn.user.emailVerified === true },
      verified: linked.verified !== false
    };
  }

  /* A single-use link that finishes the connection on the site after sign-in or registration. */
  function connectUrl({ discordUserId = '', discordTag = '' } = {}) {
    const cleanId = String(discordUserId || '').replace(/\D/g, '');
    if (!SNOWFLAKE.test(cleanId)) return { ok: false, status: 400, error: 'invalid_discord_user' };
    if (!linkConfigured) return { ok: false, status: 503, error: 'connect_unconfigured' };
    const expiresAt = now() + LINK_TTL_MS;
    const token = signConnectToken({ discordUserId: cleanId, discordTag, secret, expiresAt, nonce: crypto.randomBytes(12).toString('base64url') });
    const base = String(siteBase || 'https://stockmarketloop.com').replace(/\/+$/, '');
    return { ok: true, status: 200, url: `${base}/connect-discord/?lk=${encodeURIComponent(token)}`, expires_at: Math.floor(expiresAt / 1000) };
  }

  return { configured, linkConfigured, connect, connectUrl, LINK_TTL_MS };
}

module.exports = { createLoopKickConnect, signConnectToken, verifyConnectToken, LINK_TTL_MS };
