'use strict';

/* Push device tokens registered by the phone app and the PWA shell (app_push_devices, schema 042 + 043). A token belongs to one
 * member at a time, so a phone that signs in as someone else moves its token over. Native devices (ios, android) register the raw
 * APNs / FCM token; web devices register their push endpoint as the token plus the p256dh / auth keys the browser hands out.
 * The senders live in app-push-sender.js and call disableToken() when a service says a token is dead.
 * Postgres when a pool is given, memory otherwise. */

const PLATFORMS = new Set(['ios', 'android', 'web']);
const WEB_HOSTS = /(^|\.)(fcm\.googleapis\.com|googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com|web\.push\.apple\.com)$/i;
const unb64u = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function createAppPushDevices({ pool = null, now = Date.now } = {}) {
  const db = pool && typeof pool.query === 'function' ? pool : null;
  const mem = new Map();
  const out = (r) => ({ id: String(r.id), userId: Number(r.user_id), platform: String(r.platform), deviceId: String(r.device_id || ''), appVersion: String(r.app_version || ''),
    createdAt: new Date(r.created_at).toISOString(), lastSeenAt: new Date(r.last_seen_at).toISOString(), disabledAt: r.disabled_at ? new Date(r.disabled_at).toISOString() : null, hasKeys: Boolean(r.keys) });

  function clean({ platform = '', token = '', deviceId = '', appVersion = '', keys = null } = {}) {
    const p = String(platform || '').toLowerCase();
    const t = String(token || '').trim();
    if (!PLATFORMS.has(p)) return { error: 'invalid_platform' };
    // APNs tokens are 64 hex chars; FCM tokens are long URL-safe strings with ':'; web push endpoints are https URLs on a known push service
    if (t.length < 16 || t.length > 4096 || /[\s\u0000-\u001f]/.test(t)) return { error: 'invalid_token' };
    let cleanKeys = null;
    if (p === 'web') {
      let host = ''; try { const u = new URL(t); if (u.protocol !== 'https:') throw new Error('x'); host = u.hostname; } catch (_) { return { error: 'invalid_token' }; }
      if (!WEB_HOSTS.test(host)) return { error: 'unknown_push_service' };
      const k = keys && typeof keys === 'object' ? keys : {};
      if (unb64u(k.p256dh).length !== 65 || unb64u(k.auth).length < 16) return { error: 'invalid_keys' };
      cleanKeys = { p256dh: String(k.p256dh), auth: String(k.auth) };
    } else if (p === 'ios' && !/^[0-9a-f]{64}$/i.test(t)) return { error: 'invalid_token' };
    return { platform: p, token: t, keys: cleanKeys, deviceId: String(deviceId || '').replace(/[^\w.:-]/g, '').slice(0, 80), appVersion: String(appVersion || '').replace(/[^\w.+-]/g, '').slice(0, 32) };
  }

  async function register(userId, input) {
    const c = clean(input);
    if (c.error) return { ok: false, status: 400, error: c.error };
    const at = new Date(now());
    if (db) {
      const r = (await db.query(`INSERT INTO app_push_devices (user_id, platform, token, device_id, app_version, keys, created_at, last_seen_at)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$7)
        ON CONFLICT (token) DO UPDATE SET user_id=EXCLUDED.user_id, platform=EXCLUDED.platform, device_id=EXCLUDED.device_id, app_version=EXCLUDED.app_version, keys=EXCLUDED.keys, last_seen_at=EXCLUDED.last_seen_at, disabled_at=NULL, disabled_reason=NULL
        RETURNING *`, [userId, c.platform, c.token, c.deviceId, c.appVersion, c.keys ? JSON.stringify(c.keys) : null, at])).rows[0];
      return { ok: true, status: 200, device: out(r) };
    }
    const existing = mem.get(c.token);
    const row = { id: existing ? existing.id : mem.size + 1, user_id: userId, platform: c.platform, token: c.token, device_id: c.deviceId, app_version: c.appVersion, keys: c.keys, created_at: existing ? existing.created_at : at, last_seen_at: at, disabled_at: null, disabled_reason: null };
    mem.set(c.token, row);
    return { ok: true, status: 200, device: out(row) };
  }

  /* Sign-out or push permission withdrawn: the token stops receiving. Only the member it belongs to can remove it. */
  async function remove(userId, token) {
    const t = String(token || '').trim();
    if (t.length < 16 || t.length > 4096) return { ok: false, status: 400, error: 'invalid_token' };
    const at = new Date(now());
    if (db) {
      const r = await db.query("UPDATE app_push_devices SET disabled_at=$3, disabled_reason='user' WHERE token=$1 AND user_id=$2 AND disabled_at IS NULL", [t, userId, at]);
      return { ok: true, status: 200, removed: r.rowCount > 0 };
    }
    const row = mem.get(t);
    if (row && row.user_id === userId && !row.disabled_at) { row.disabled_at = at; row.disabled_reason = 'user'; return { ok: true, status: 200, removed: true }; }
    return { ok: true, status: 200, removed: false };
  }

  /* The push service said this token is gone (APNs Unregistered / BadDeviceToken, FCM UNREGISTERED, web 404/410). */
  async function disableToken(token, reason = 'gone') {
    const at = new Date(now());
    if (db) { await db.query('UPDATE app_push_devices SET disabled_at=$2, disabled_reason=$3 WHERE token=$1 AND disabled_at IS NULL', [String(token), at, String(reason).slice(0, 64)]); return; }
    const row = mem.get(String(token)); if (row && !row.disabled_at) { row.disabled_at = at; row.disabled_reason = reason; }
  }

  async function list(userId) {
    if (db) return (await db.query('SELECT * FROM app_push_devices WHERE user_id=$1 AND disabled_at IS NULL ORDER BY last_seen_at DESC', [userId])).rows.map(out);
    return [...mem.values()].filter((r) => r.user_id === userId && !r.disabled_at).sort((a, b) => new Date(b.last_seen_at) - new Date(a.last_seen_at)).map(out);
  }

  /* every live token of a member, with its platform and (web) keys, for the senders */
  async function tokensFor(userId) {
    const shape = (r) => ({ platform: String(r.platform), token: String(r.token), keys: r.keys && typeof r.keys === 'object' ? r.keys : null });
    if (db) return (await db.query('SELECT platform, token, keys FROM app_push_devices WHERE user_id=$1 AND disabled_at IS NULL', [userId])).rows.map(shape);
    return [...mem.values()].filter((r) => r.user_id === userId && !r.disabled_at).map(shape);
  }

  return { register, remove, disableToken, list, tokensFor };
}

module.exports = { createAppPushDevices, PLATFORMS };
