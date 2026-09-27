'use strict';

/* =============================================================================
 * MEM Academy billing: signed, purpose-separated tokens.
 *
 *   mab1.<claims>.<sig>   BIND token. "This browser is Discord user U, for
 *                         purpose P (buy | manage)". Lives ONLY in an HttpOnly
 *                         Secure SameSite=Lax cookie on Path=/v1/academy/billing,
 *                         30 minutes. Never put in a URL. A 'manage' token only
 *                         comes from a fresh Discord OAuth; the Activity and hub
 *                         hand-offs mint 'buy' tokens only, so a leaked link can
 *                         never open somebody's billing portal.
 *   mas1.<claims>.<sig>   OAuth STATE. Bound to a nonce held in a separate
 *                         cookie, 10 minutes.
 *   CSRF                  HMAC(bind nonce) for the /checkout form.
 *
 * All keys are HKDF-derived from SML_ACADEMY_CLIENT_SECRET with the salt
 * 'sml-academy-billing' and a per-purpose info label. The Activity session
 * token (academy-oauth.js) uses the salt 'sml-academy-activity' and the prefix
 * 'v1', so neither token can be replayed as the other even though they share
 * one root secret. Comparisons are constant time.
 * ========================================================================== */

const crypto = require('node:crypto');

const SALT = 'sml-academy-billing';
const BIND_TTL_MS = 30 * 60_000;
const STATE_TTL_MS = 10 * 60_000;
const BIND_SOURCES = Object.freeze(['web_oauth', 'activity', 'hub', 'admin']);
const PURPOSES = Object.freeze(['buy', 'manage', 'join']);
const SNOWFLAKE = /^[0-9]{15,24}$/;

function deriveKey(secret, info) {
  if (!secret) throw new TypeError('link-token: SML_ACADEMY_CLIENT_SECRET is required');
  return Buffer.from(crypto.hkdfSync('sha256', String(secret), SALT, info, 32));
}

function b64(json) { return Buffer.from(JSON.stringify(json)).toString('base64url'); }

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createLinkTokens({ secret, now = Date.now, randomBytes = crypto.randomBytes } = {}) {
  const bindKey = deriveKey(secret, 'bind-v1');
  const stateKey = deriveKey(secret, 'oauth-state-v1');
  const csrfKey = deriveKey(secret, 'csrf-v1');
  const hmac = (key, body) => crypto.createHmac('sha256', key).update(body).digest('base64url');

  function seal(prefix, key, claims) {
    const body = `${prefix}.${b64(claims)}`;
    return `${body}.${hmac(key, body)}`;
  }
  function open(prefix, key, token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || parts[0] !== prefix) return null;
    if (!safeEqual(hmac(key, `${parts[0]}.${parts[1]}`), parts[2])) return null;
    try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch (_) { return null; }
  }

  function issueBind({ userId, guildId, source, purpose = 'buy' }) {
    if (!SNOWFLAKE.test(String(userId))) throw new TypeError('issueBind: userId must be a Discord snowflake');
    if (!BIND_SOURCES.includes(source)) throw new TypeError('issueBind: unknown bind source');
    if (!PURPOSES.includes(purpose)) throw new TypeError('issueBind: unknown purpose');
    const claims = { u: String(userId), g: String(guildId || ''), s: source, p: purpose,
      n: randomBytes(16).toString('base64url'), e: now() + BIND_TTL_MS };
    return seal('mab1', bindKey, claims);
  }

  function readBind(token, { purpose = null } = {}) {
    const claims = open('mab1', bindKey, token);
    if (!claims || !SNOWFLAKE.test(String(claims.u)) || !(Number(claims.e) > now())) return null;
    if (!BIND_SOURCES.includes(claims.s) || !PURPOSES.includes(claims.p)) return null;
    if (purpose && claims.p !== purpose) return null;
    return { userId: String(claims.u), guildId: String(claims.g || ''), source: claims.s, purpose: claims.p,
      nonce: String(claims.n || ''), expiresAt: Number(claims.e) };
  }

  function issueState({ purpose = 'buy', pkg = '', autoJoin = false } = {}) {
    if (!PURPOSES.includes(purpose)) throw new TypeError('issueState: unknown purpose');
    const nonce = randomBytes(24).toString('base64url');
    const claims = { n: nonce, p: purpose, k: String(pkg || '').slice(0, 20), j: autoJoin ? 1 : 0, e: now() + STATE_TTL_MS };
    return { state: seal('mas1', stateKey, claims), nonce };
  }

  /** The state is valid only together with the nonce cookie it was minted with. */
  function readState(state, cookieNonce) {
    const claims = open('mas1', stateKey, state);
    if (!claims || !(Number(claims.e) > now())) return null;
    if (!cookieNonce || !safeEqual(String(claims.n || ''), String(cookieNonce))) return null;
    return { purpose: claims.p, pkg: String(claims.k || ''), autoJoin: claims.j === 1 };
  }

  function csrfFor(bind) {
    return hmac(csrfKey, `${bind.userId}.${bind.nonce}`);
  }
  function checkCsrf(bind, value) {
    return Boolean(bind && value) && safeEqual(csrfFor(bind), String(value));
  }

  return { issueBind, readBind, issueState, readState, csrfFor, checkCsrf };
}

module.exports = { createLinkTokens, BIND_TTL_MS, STATE_TTL_MS, BIND_SOURCES, PURPOSES };
