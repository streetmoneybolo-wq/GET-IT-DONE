'use strict';

/* Web Push for the Academy (phone and desktop notifications that arrive with the Academy closed).
 *
 * Standards only, no extra package: VAPID (RFC 8292) signs each request with an ES256 key, and the message is encrypted for the member's browser
 * with aes128gcm (RFC 8291 / RFC 8188). The VAPID key pair is made once on the server and kept in academy_state_kv ('push-vapid'); it is written with
 * INSERT .. ON CONFLICT DO NOTHING and read back, so a restart or a database blip can never replace it (that would silently break every
 * subscription). Subscriptions are kept per member ('push-subs'); a browser that says the subscription is gone (404 / 410) is dropped. */

const crypto = require('node:crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

function generateVapidKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' }), priv = privateKey.export({ format: 'jwk' });
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(pub.x), unb64u(pub.y)])), privateJwk: priv };
}

/* RFC 8291: the body for one push message (single record, aes128gcm). */
function encryptPayload({ p256dh, auth }, payload, { salt = crypto.randomBytes(16), ecdh = null } = {}) {
  const uaPublic = unb64u(p256dh), authSecret = unb64u(auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('invalid_subscription_keys');
  const local = ecdh || crypto.createECDH('prime256v1');
  if (!ecdh) local.generateKeys();
  const asPublic = local.getPublicKey();
  const shared = local.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/* RFC 8292: Authorization header for one push service origin. */
function vapidHeader({ endpoint, keys, subject, now = Date.now }) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(now() / 1000) + 12 * 3600, sub: subject }));
  const key = crypto.createPrivateKey({ key: keys.privateJwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + claims), { key, dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + head + '.' + claims + '.' + b64u(sig) + ', k=' + keys.publicKey;
}

const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com|web\.push\.apple\.com)$/i;

function createPushService({ pool, subStore, subject = 'https://sml-platform-api.onrender.com', fetchImpl = fetch, logger = () => {}, now = Date.now } = {}) {
  let keys = null, keysLoading = null, subs = null;
  async function loadKeys() {
    if (keys) return keys;
    if (!pool || typeof pool.query !== 'function') return null;
    if (!keysLoading) keysLoading = (async () => {
      try {
        let r = await pool.query("SELECT value FROM academy_state_kv WHERE key = 'push-vapid'");
        if (!r.rows[0]) {
          await pool.query("INSERT INTO academy_state_kv (key, value, updated_at) VALUES ('push-vapid', $1::jsonb, now()) ON CONFLICT (key) DO NOTHING", [JSON.stringify(generateVapidKeys())]);
          r = await pool.query("SELECT value FROM academy_state_kv WHERE key = 'push-vapid'");
        }
        const v = r.rows[0] && r.rows[0].value;
        if (v && v.publicKey && v.privateJwk) keys = v;
      } catch (error) { logger('warn', 'push_keys_unavailable', { error: String(error && error.message || error) }); }
      keysLoading = null;
      return keys;
    })();
    return keysLoading;
  }
  async function loadSubs() { if (!subs) { const v = await subStore.read().catch(() => null); subs = v && v.subs ? v : { subs: {} }; } return subs; }
  const save = () => subStore.write(subs);
  const idOf = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 32);

  async function subscribe(userId, sub, meta = {}) {
    const endpoint = String(sub && sub.endpoint || '');
    let host = ''; try { const u = new URL(endpoint); if (u.protocol !== 'https:') throw new Error('x'); host = u.hostname; } catch (_) { return { ok: false, error: 'invalid_endpoint' }; }
    if (!PUSH_HOSTS.test(host)) return { ok: false, error: 'unknown_push_service' };
    const k = sub.keys || {};
    if (unb64u(k.p256dh).length !== 65 || unb64u(k.auth).length < 16) return { ok: false, error: 'invalid_keys' };
    await loadSubs();
    const mine = Object.entries(subs.subs).filter(([, s]) => s.userId === String(userId));
    if (mine.length >= 8) { mine.sort((a, b) => a[1].at - b[1].at); delete subs.subs[mine[0][0]]; } // a member's oldest device makes room
    subs.subs[idOf(endpoint)] = { userId: String(userId), endpoint, keys: { p256dh: String(k.p256dh), auth: String(k.auth) }, at: now(), ua: String(meta.ua || '').slice(0, 80) };
    await save();
    return { ok: true };
  }
  async function unsubscribe(userId, endpoint) {
    await loadSubs();
    const id = idOf(endpoint);
    if (subs.subs[id] && subs.subs[id].userId === String(userId)) { delete subs.subs[id]; await save(); }
    return { ok: true };
  }
  async function sendOne(id, s, message, { ttl = 86_400, urgency = 'high', topic = '' } = {}) {
    const k = await loadKeys(); if (!k) return { ok: false, error: 'no_keys' };
    const body = encryptPayload(s.keys, JSON.stringify(message));
    const headers = { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: urgency, Authorization: vapidHeader({ endpoint: s.endpoint, keys: k, subject, now }) };
    if (topic) headers.Topic = String(topic).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    try {
      const res = await fetchImpl(s.endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
      if (res.status === 404 || res.status === 410) { delete subs.subs[id]; return { ok: false, gone: true }; }
      if (!res.ok) { logger('warn', 'push_send_failed', { status: res.status, host: new URL(s.endpoint).hostname }); return { ok: false, status: res.status }; }
      return { ok: true };
    } catch (error) { logger('warn', 'push_send_error', { error: String(error && error.message || error) }); return { ok: false }; }
  }
  /* send to every subscribed member for whom allow(userId) resolves true; one decision per member, not per device */
  async function sendTo(allow, message, opts = {}) {
    await loadSubs();
    const byUser = new Map();
    for (const [id, s] of Object.entries(subs.subs)) { if (!byUser.has(s.userId)) byUser.set(s.userId, []); byUser.get(s.userId).push([id, s]); }
    const out = { members: 0, sent: 0, gone: 0 };
    const before = Object.keys(subs.subs).length;
    for (const [userId, list] of byUser) {
      let ok = false; try { ok = await allow(userId); } catch (_) { ok = false; }
      if (!ok) continue;
      out.members++;
      const res = await Promise.all(list.map(([id, s]) => sendOne(id, s, message, opts)));
      out.sent += res.filter((r) => r.ok).length; out.gone += res.filter((r) => r.gone).length;
    }
    if (Object.keys(subs.subs).length !== before) await save();
    return out;
  }
  const count = async (userId) => { await loadSubs(); return Object.values(subs.subs).filter((s) => s.userId === String(userId)).length; };
  return { publicKey: async () => ((await loadKeys()) || {}).publicKey || null, subscribe, unsubscribe, sendTo, count, configured: !!(pool && typeof pool.query === 'function') };
}

module.exports = { createPushService, encryptPayload, vapidHeader, generateVapidKeys, b64u, unb64u };
