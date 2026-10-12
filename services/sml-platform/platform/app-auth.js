'use strict';

/* App API v1 sign-in: bearer access tokens plus rotating refresh tokens, for stockmarketloop.com members on the phone app.
 *
 * A member signs in with their site username (or email) and password; the site verifies both, plus their two-step code when
 * two-step sign-in is on (platform/app-identity.js). This file then owns the session:
 *   - access token  `a1.<claims>.<sig>`: signed, never stored, 15 minutes. Claims bind the WordPress user id and the session id.
 *   - refresh token `r1.<random>`: only its sha256 is stored (app_sessions, schema 042), 60 days, one per device.
 * Refresh rotates: the old token is marked replaced and a new pair is issued. A replaced token presented again means it leaked
 * (or the app lost a response), so the whole family is revoked and the member signs in again on that device.
 * The signing key is derived from SML_APP_TOKEN_SECRET (or, until that is set, from the LOOP-KICK bridge secret) and is never
 * used directly or sent anywhere. */

const crypto = require('node:crypto');

const ACCESS_TTL_MS = 15 * 60_000;
const REFRESH_TTL_MS = 60 * 86_400_000;
const PLATFORMS = new Set(['ios', 'android', 'web', '']);

function cleanDevice(device = {}) {
  const d = device && typeof device === 'object' ? device : {};
  const platform = String(d.platform || '').toLowerCase().slice(0, 16);
  return {
    id: String(d.id || '').replace(/[^\w.:-]/g, '').slice(0, 80),
    name: String(d.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80),
    platform: PLATFORMS.has(platform) ? platform : 'other',
    appVersion: String(d.appVersion || '').replace(/[^\w.+-]/g, '').slice(0, 32)
  };
}

/* Postgres when a pool is given, process memory otherwise (tests, local runs). */
function createAppSessionStore({ pool = null } = {}) {
  const db = pool && typeof pool.query === 'function' ? pool : null;
  const mem = new Map();
  const out = (r) => (r ? {
    id: String(r.id), family: String(r.family), userId: Number(r.user_id), refreshHash: String(r.refresh_hash),
    device: { id: String(r.device_id || ''), name: String(r.device_name || ''), platform: String(r.platform || ''), appVersion: String(r.app_version || '') },
    createdAt: new Date(r.created_at).toISOString(), lastUsedAt: new Date(r.last_used_at).toISOString(), expiresAt: new Date(r.expires_at).toISOString(),
    revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null, revokedReason: r.revoked_reason || null, replacedBy: r.replaced_by ? String(r.replaced_by) : null
  } : null);
  async function insert({ id, family, userId, refreshHash, device, createdAt, expiresAt }) {
    const row = { id, family, user_id: userId, refresh_hash: refreshHash, device_id: device.id, device_name: device.name, platform: device.platform, app_version: device.appVersion,
      created_at: createdAt, last_used_at: createdAt, expires_at: expiresAt, revoked_at: null, revoked_reason: null, replaced_by: null };
    if (db) {
      await db.query('INSERT INTO app_sessions (id, family, user_id, refresh_hash, device_id, device_name, platform, app_version, created_at, last_used_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10)',
        [id, family, userId, refreshHash, device.id, device.name, device.platform, device.appVersion, createdAt, expiresAt]);
      return out(row);
    }
    mem.set(id, row); return out(row);
  }
  async function byRefreshHash(hash) {
    if (db) return out((await db.query('SELECT * FROM app_sessions WHERE refresh_hash=$1', [hash])).rows[0]);
    for (const r of mem.values()) if (r.refresh_hash === hash) return out(r);
    return null;
  }
  async function byId(id) {
    if (db) return out((await db.query('SELECT * FROM app_sessions WHERE id=$1', [id])).rows[0]);
    return out(mem.get(id));
  }
  async function rotate(id, replacedBy, at) {
    if (db) { await db.query("UPDATE app_sessions SET revoked_at=$2, revoked_reason='rotated', replaced_by=$3 WHERE id=$1 AND revoked_at IS NULL", [id, at, replacedBy]); return; }
    const r = mem.get(id); if (r && !r.revoked_at) { r.revoked_at = at; r.revoked_reason = 'rotated'; r.replaced_by = replacedBy; }
  }
  async function revoke(id, reason, at) {
    if (db) { await db.query('UPDATE app_sessions SET revoked_at=$2, revoked_reason=$3 WHERE id=$1 AND revoked_at IS NULL', [id, at, reason]); return; }
    const r = mem.get(id); if (r && !r.revoked_at) { r.revoked_at = at; r.revoked_reason = reason; }
  }
  async function revokeFamily(family, reason, at) {
    if (db) { await db.query('UPDATE app_sessions SET revoked_at=$2, revoked_reason=$3 WHERE family=$1 AND revoked_at IS NULL', [family, at, reason]); return; }
    for (const r of mem.values()) if (r.family === family && !r.revoked_at) { r.revoked_at = at; r.revoked_reason = reason; }
  }
  async function revokeAllForUser(userId, reason, at) {
    if (db) { await db.query('UPDATE app_sessions SET revoked_at=$2, revoked_reason=$3 WHERE user_id=$1 AND revoked_at IS NULL', [userId, at, reason]); return; }
    for (const r of mem.values()) if (r.user_id === userId && !r.revoked_at) { r.revoked_at = at; r.revoked_reason = reason; }
  }
  async function touch(id, at) {
    if (db) { await db.query('UPDATE app_sessions SET last_used_at=$2 WHERE id=$1', [id, at]); return; }
    const r = mem.get(id); if (r) r.last_used_at = at;
  }
  /* live sessions (not revoked, not expired), newest first */
  async function listForUser(userId, at) {
    if (db) return (await db.query('SELECT * FROM app_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > $2 ORDER BY last_used_at DESC', [userId, at])).rows.map(out);
    return [...mem.values()].filter((r) => r.user_id === userId && !r.revoked_at && new Date(r.expires_at) > at).sort((a, b) => new Date(b.last_used_at) - new Date(a.last_used_at)).map(out);
  }
  return { insert, byRefreshHash, byId, rotate, revoke, revokeFamily, revokeAllForUser, touch, listForUser };
}

function createAppAuth({ store = createAppSessionStore(), identity = null, secret = '', now = Date.now, randomBytes = crypto.randomBytes, randomUUID = crypto.randomUUID,
  accessTtlMs = ACCESS_TTL_MS, refreshTtlMs = REFRESH_TTL_MS, logger = () => {} } = {}) {
  const key = String(secret || '').length >= 32 ? Buffer.from(crypto.hkdfSync('sha256', String(secret), 'sml-app-api', 'access-v1', 32)) : null;
  const configured = Boolean(key && identity && identity.configured);
  const sign = (body) => crypto.createHmac('sha256', key).update(body).digest('base64url');
  const hashRefresh = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

  function issueAccess(userId, sessionId) {
    const claims = { u: Number(userId), s: String(sessionId), e: now() + accessTtlMs, n: randomBytes(8).toString('base64url') };
    const body = `a1.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
    return { token: `${body}.${sign(body)}`, expiresAt: new Date(claims.e).toISOString() };
  }
  function readAccess(token) {
    const parts = String(token || '').split('.');
    if (!key || parts.length !== 3 || parts[0] !== 'a1') return null;
    const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`)), given = Buffer.from(parts[2]);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    let claims; try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch (_) { return null; }
    if (!claims || !Number.isInteger(claims.u) || claims.u <= 0 || typeof claims.s !== 'string') return null;
    return { userId: claims.u, sessionId: claims.s, expired: !(Number(claims.e) > now()) };
  }
  /* Bearer check for every app route. `token_expired` tells the app to refresh and retry; anything else means sign in again. */
  function verify(authorization) {
    const match = /^Bearer\s+(\S+)$/i.exec(String(authorization || ''));
    const read = match && readAccess(match[1]);
    if (!read) return { ok: false, status: 401, code: 'authorization_required' };
    if (read.expired) return { ok: false, status: 401, code: 'token_expired' };
    return { ok: true, userId: read.userId, sessionId: read.sessionId };
  }

  async function mint(userId, family, device) {
    const id = randomUUID();
    const refreshToken = `r1.${randomBytes(32).toString('base64url')}`;
    const at = new Date(now());
    const expiresAt = new Date(now() + refreshTtlMs);
    await store.insert({ id, family: family || id, userId, refreshHash: hashRefresh(refreshToken), device, createdAt: at, expiresAt });
    const access = issueAccess(userId, id);
    return { sessionId: id, accessToken: access.token, accessExpiresAt: access.expiresAt, refreshToken, refreshExpiresAt: expiresAt.toISOString() };
  }

  /* Sign in. The site answers invalid_credentials / two_step_required / two_step_invalid / not_verified; those pass straight through. */
  async function login({ login = '', password = '', code = '', device = {}, ip = '' } = {}) {
    if (!configured) return { ok: false, status: 503, error: 'app_auth_unconfigured' };
    const name = String(login || '').trim();
    if (name.length < 3 || name.length > 120 || typeof password !== 'string' || password.length < 1 || password.length > 512) return { ok: false, status: 400, error: 'invalid_request' };
    if (code && !/^[\w-]{4,32}$/.test(String(code))) return { ok: false, status: 400, error: 'invalid_code' };
    const dev = cleanDevice(device);
    const answer = await identity.login({ login: name, password, code, device: dev, ip });
    if (!answer.ok) {
      const { status, ...rest } = answer;
      return { ok: false, status: status || 503, ...rest };
    }
    const user = answer.user && typeof answer.user === 'object' ? answer.user : null;
    const userId = user ? Number(user.id) : 0;
    if (!Number.isInteger(userId) || userId <= 0) { logger('error', 'app_login_bad_user', { keys: Object.keys(answer) }); return { ok: false, status: 503, error: 'identity_unavailable' }; }
    const tokens = await mint(userId, null, dev);
    logger('info', 'app_login', { userId, platform: dev.platform, sessionId: tokens.sessionId });
    return { ok: true, status: 200, user, ...tokens, tokenType: 'Bearer' };
  }

  async function refresh({ refreshToken = '' } = {}) {
    if (!configured) return { ok: false, status: 503, error: 'app_auth_unconfigured' };
    if (!/^r1\.[\w-]{40,50}$/.test(String(refreshToken || ''))) return { ok: false, status: 401, error: 'invalid_refresh' };
    const row = await store.byRefreshHash(hashRefresh(refreshToken));
    if (!row) return { ok: false, status: 401, error: 'invalid_refresh' };
    const at = new Date(now());
    if (row.revokedAt) {
      if (row.replacedBy) {
        // a rotated token came back: someone holds a copy. Every session in this family goes.
        await store.revokeFamily(row.family, 'reuse', at);
        logger('warn', 'app_refresh_reuse', { userId: row.userId, family: row.family });
        return { ok: false, status: 401, error: 'refresh_reused' };
      }
      return { ok: false, status: 401, error: 'refresh_revoked' };
    }
    if (new Date(row.expiresAt) <= at) return { ok: false, status: 401, error: 'refresh_expired' };
    const tokens = await mint(row.userId, row.family, row.device);
    await store.rotate(row.id, tokens.sessionId, at);
    return { ok: true, status: 200, userId: row.userId, ...tokens, tokenType: 'Bearer' };
  }

  /* Sign out this device. Idempotent: an unknown or already-revoked token is still a successful sign-out. */
  async function logout({ refreshToken = '' } = {}) {
    if (/^r1\.[\w-]{40,50}$/.test(String(refreshToken || ''))) {
      const row = await store.byRefreshHash(hashRefresh(refreshToken));
      if (row && !row.revokedAt) await store.revoke(row.id, 'logout', new Date(now()));
    }
    return { ok: true, status: 200 };
  }

  async function sessions(userId, currentSessionId = '') {
    const rows = await store.listForUser(Number(userId), new Date(now()));
    return rows.map((r) => ({ id: r.id, device: r.device, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, expiresAt: r.expiresAt, current: r.id === currentSessionId }));
  }
  async function revokeSession(userId, sessionId) {
    const row = await store.byId(String(sessionId || ''));
    if (!row || row.userId !== Number(userId)) return { ok: false, status: 404, error: 'session_not_found' };
    if (!row.revokedAt) await store.revoke(row.id, 'user', new Date(now()));
    return { ok: true, status: 200 };
  }
  async function revokeAll(userId, reason = 'user') { await store.revokeAllForUser(Number(userId), reason, new Date(now())); return { ok: true, status: 200 }; }
  /* a cheap "is this session still live" check for routes that must not serve a signed-out device */
  async function sessionLive(sessionId) {
    const row = await store.byId(String(sessionId || ''));
    return Boolean(row && !row.revokedAt && new Date(row.expiresAt) > new Date(now()));
  }
  const touch = (sessionId) => store.touch(String(sessionId), new Date(now())).catch(() => {});

  return { configured, verify, login, refresh, logout, sessions, revokeSession, revokeAll, sessionLive, touch, accessTtlMs, refreshTtlMs };
}

module.exports = { createAppAuth, createAppSessionStore, cleanDevice, ACCESS_TTL_MS, REFRESH_TTL_MS };
