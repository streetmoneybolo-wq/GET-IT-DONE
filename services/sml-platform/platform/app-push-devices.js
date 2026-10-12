'use strict';

/* Native push device tokens registered by the phone app (app_push_devices, schema 042). Registration and lookup only:
 * the APNs / FCM senders are a later step, and nothing here sends. A token belongs to one member at a time, so a phone
 * that signs in as someone else moves its token over. Postgres when a pool is given, memory otherwise. */

const PLATFORMS = new Set(['ios', 'android', 'web']);

function createAppPushDevices({ pool = null, now = Date.now } = {}) {
  const db = pool && typeof pool.query === 'function' ? pool : null;
  const mem = new Map();
  const out = (r) => ({ id: String(r.id), userId: Number(r.user_id), platform: String(r.platform), deviceId: String(r.device_id || ''), appVersion: String(r.app_version || ''),
    createdAt: new Date(r.created_at).toISOString(), lastSeenAt: new Date(r.last_seen_at).toISOString(), disabledAt: r.disabled_at ? new Date(r.disabled_at).toISOString() : null });

  function clean({ platform = '', token = '', deviceId = '', appVersion = '' } = {}) {
    const p = String(platform || '').toLowerCase();
    const t = String(token || '').trim();
    if (!PLATFORMS.has(p)) return { error: 'invalid_platform' };
    // APNs tokens are 64 hex chars; FCM tokens are long URL-safe strings with ':'; web push endpoints are URLs
    if (t.length < 16 || t.length > 4096 || /[\s\u0000-\u001f]/.test(t)) return { error: 'invalid_token' };
    return { platform: p, token: t, deviceId: String(deviceId || '').replace(/[^\w.:-]/g, '').slice(0, 80), appVersion: String(appVersion || '').replace(/[^\w.+-]/g, '').slice(0, 32) };
  }

  async function register(userId, input) {
    const c = clean(input);
    if (c.error) return { ok: false, status: 400, error: c.error };
    const at = new Date(now());
    if (db) {
      const r = (await db.query(`INSERT INTO app_push_devices (user_id, platform, token, device_id, app_version, created_at, last_seen_at)
        VALUES ($1,$2,$3,$4,$5,$6,$6)
        ON CONFLICT (token) DO UPDATE SET user_id=EXCLUDED.user_id, platform=EXCLUDED.platform, device_id=EXCLUDED.device_id, app_version=EXCLUDED.app_version, last_seen_at=EXCLUDED.last_seen_at, disabled_at=NULL
        RETURNING *`, [userId, c.platform, c.token, c.deviceId, c.appVersion, at])).rows[0];
      return { ok: true, status: 200, device: out(r) };
    }
    const existing = mem.get(c.token);
    const row = { id: existing ? existing.id : mem.size + 1, user_id: userId, platform: c.platform, token: c.token, device_id: c.deviceId, app_version: c.appVersion, created_at: existing ? existing.created_at : at, last_seen_at: at, disabled_at: null };
    mem.set(c.token, row);
    return { ok: true, status: 200, device: out(row) };
  }

  /* Sign-out or push permission withdrawn: the token stops receiving. Only the member it belongs to can remove it. */
  async function remove(userId, token) {
    const t = String(token || '').trim();
    if (t.length < 16 || t.length > 4096) return { ok: false, status: 400, error: 'invalid_token' };
    const at = new Date(now());
    if (db) {
      const r = await db.query('UPDATE app_push_devices SET disabled_at=$3 WHERE token=$1 AND user_id=$2 AND disabled_at IS NULL', [t, userId, at]);
      return { ok: true, status: 200, removed: r.rowCount > 0 };
    }
    const row = mem.get(t);
    if (row && row.user_id === userId && !row.disabled_at) { row.disabled_at = at; return { ok: true, status: 200, removed: true }; }
    return { ok: true, status: 200, removed: false };
  }

  async function list(userId) {
    if (db) return (await db.query('SELECT * FROM app_push_devices WHERE user_id=$1 AND disabled_at IS NULL ORDER BY last_seen_at DESC', [userId])).rows.map(out);
    return [...mem.values()].filter((r) => r.user_id === userId && !r.disabled_at).sort((a, b) => new Date(b.last_seen_at) - new Date(a.last_seen_at)).map(out);
  }

  /* for the senders to come: every live token of a member, with its platform */
  async function tokensFor(userId) {
    if (db) return (await db.query('SELECT platform, token FROM app_push_devices WHERE user_id=$1 AND disabled_at IS NULL', [userId])).rows.map((r) => ({ platform: String(r.platform), token: String(r.token) }));
    return [...mem.values()].filter((r) => r.user_id === userId && !r.disabled_at).map((r) => ({ platform: r.platform, token: r.token }));
  }

  return { register, remove, list, tokensFor };
}

module.exports = { createAppPushDevices, PLATFORMS };
