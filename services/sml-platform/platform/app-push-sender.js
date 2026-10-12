'use strict';

/* Native and web push for the phone app: one message in, every registered device of a member out.
 *
 *   APNs  (ios)      HTTP/2 to api.push.apple.com, a provider token (ES256 JWT from the .p8 key) refreshed every 50 minutes.
 *   FCM   (android)  HTTP v1 messages:send with a short-lived OAuth token minted from the Firebase service account (RS256 JWT).
 *   Web   (web)      RFC 8291 encrypted payloads with the platform's existing VAPID keys (academy_state_kv 'push-vapid').
 *
 * Each client is off until its credentials exist; a message to a platform that is off is reported, never thrown. A token the
 * service calls dead (APNs Unregistered / BadDeviceToken, FCM UNREGISTERED, web 404 / 410) is disabled in app_push_devices so it
 * is never tried again. Nothing here decides WHO gets a message: callers (the test route, the site's signed /push/send) do. */

const crypto = require('node:crypto');
const http2 = require('node:http2');
const { encryptPayload, vapidHeader, generateVapidKeys } = require('./academy-push');

const b64u = (buf) => Buffer.from(buf).toString('base64url');

/* ---- the message every sender receives ---- */
function normalizeMessage(input = {}) {
  const m = input && typeof input === 'object' ? input : {};
  const text = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max);
  const title = text(m.title, 120), body = text(m.body, 500);
  if (!title && !body) return { error: 'empty_message' };
  const data = {};
  if (m.data && typeof m.data === 'object') for (const [k, v] of Object.entries(m.data)) { if (Object.keys(data).length >= 20) break; if (/^[\w.-]{1,40}$/.test(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) data[k] = String(v).slice(0, 512); }
  let url = '';
  if (m.url) { try { const u = new URL(String(m.url)); if (u.protocol === 'https:') url = u.href.slice(0, 500); } catch (_) { url = ''; } }
  const ttl = Math.min(7 * 86_400, Math.max(60, Number(m.ttl) || 3_600));
  const badge = Number.isInteger(m.badge) && m.badge >= 0 ? m.badge : null;
  const collapseId = text(m.collapseId || m.topic, 64).replace(/[^\w-]/g, '');
  return { title, body, data, url, ttl, badge, sound: text(m.sound || 'default', 40), collapseId, channelId: text(m.channelId || 'alerts', 64).replace(/[^\w-]/g, '') || 'alerts', category: text(m.category, 40) };
}

/* ---- APNs ---- */
function http2Transport(host, { timeoutMs = 10_000 } = {}) {
  let session = null;
  const connect = () => {
    if (session && !session.closed && !session.destroyed) return session;
    session = http2.connect(`https://${host}`);
    session.on('error', () => { session = null; });
    session.on('close', () => { session = null; });
    session.on('goaway', () => { const s = session; session = null; try { s.close(); } catch (_) { /* gone */ } });
    return session;
  };
  return (headers, body) => new Promise((resolve, reject) => {
    let s;
    try { s = connect(); } catch (error) { reject(error); return; }
    const req = s.request({ ':method': 'POST', ...headers });
    const chunks = []; let status = 0; let done = false;
    const finish = (fn) => { if (done) return; done = true; clearTimeout(timer); fn(); };
    const timer = setTimeout(() => { try { req.close(http2.constants.NGHTTP2_CANCEL); } catch (_) { /* ignore */ } finish(() => reject(new Error('apns_timeout'))); }, timeoutMs);
    req.on('response', (h) => { status = Number(h[':status']) || 0; });
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => finish(() => resolve({ status, body: Buffer.concat(chunks).toString('utf8') })));
    req.on('error', (error) => finish(() => reject(error)));
    req.end(body);
  });
}

function createApnsClient({ keyId = '', teamId = '', key = '', bundleId = '', env = 'production', transport = null, now = Date.now, logger = () => {} } = {}) {
  const pem = String(key || '').replace(/\\n/g, '\n').trim();
  const configured = Boolean(keyId && teamId && pem && bundleId);
  let privateKey = null;
  if (configured) { try { privateKey = crypto.createPrivateKey(pem); } catch (error) { logger('error', 'apns_key_invalid', { error: String(error && error.message || error) }); } }
  const host = String(env).toLowerCase() === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  const send2 = transport || (privateKey ? http2Transport(host) : null);
  let jwt = { token: '', at: 0 };
  function providerToken(force = false) {
    const t = Math.floor(now() / 1000);
    if (!force && jwt.token && t - jwt.at < 50 * 60) return jwt.token;
    const head = b64u(JSON.stringify({ alg: 'ES256', kid: keyId }));
    const claims = b64u(JSON.stringify({ iss: teamId, iat: t }));
    const sig = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
    jwt = { token: `${head}.${claims}.${b64u(sig)}`, at: t };
    return jwt.token;
  }
  function payload(m) {
    const aps = { alert: { title: m.title, body: m.body }, sound: m.sound || 'default', 'mutable-content': 1 };
    if (m.badge !== null) aps.badge = m.badge;
    if (m.category) aps.category = m.category;
    if (m.collapseId) aps['thread-id'] = m.collapseId;
    return JSON.stringify({ aps, ...m.data, ...(m.url ? { url: m.url } : {}) });
  }
  async function send(token, message, { retry = true } = {}) {
    if (!configured || !privateKey) return { ok: false, error: 'apns_unconfigured' };
    const m = message.title !== undefined && message.ttl !== undefined ? message : normalizeMessage(message);
    if (m.error) return { ok: false, error: m.error };
    const headers = { ':path': `/3/device/${token}`, authorization: `bearer ${providerToken()}`, 'apns-topic': bundleId, 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-expiration': String(Math.floor(now() / 1000) + m.ttl), 'content-type': 'application/json' };
    if (m.collapseId) headers['apns-collapse-id'] = m.collapseId;
    let res;
    try { res = await send2(headers, payload(m)); } catch (error) { logger('warn', 'apns_transport_error', { error: String(error && error.message || error) }); return { ok: false, error: 'apns_unavailable' }; }
    if (res.status === 200) return { ok: true, status: 200 };
    let reason = ''; try { reason = String(JSON.parse(res.body || '{}').reason || ''); } catch (_) { reason = ''; }
    if (res.status === 403 && reason === 'ExpiredProviderToken' && retry) { providerToken(true); return send(token, m, { retry: false }); }
    const gone = res.status === 410 || ['Unregistered', 'BadDeviceToken', 'DeviceTokenNotForTopic'].includes(reason);
    if (!gone) logger('warn', 'apns_send_failed', { status: res.status, reason });
    return { ok: false, status: res.status, reason, gone };
  }
  return { configured: configured && Boolean(privateKey), platform: 'ios', host, send, providerToken: configured && privateKey ? providerToken : null };
}

/* ---- FCM (HTTP v1) ---- */
function parseServiceAccount(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const tryParse = (s) => { try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : null; } catch (_) { return null; } };
  const sa = text.startsWith('{') ? tryParse(text) : tryParse(Buffer.from(text, 'base64').toString('utf8'));
  return sa && sa.client_email && sa.private_key && sa.project_id ? sa : null;
}

function createFcmClient({ serviceAccount = '', fetchImpl = fetch, now = Date.now, logger = () => {} } = {}) {
  const sa = typeof serviceAccount === 'object' && serviceAccount ? serviceAccount : parseServiceAccount(serviceAccount);
  let privateKey = null;
  if (sa) { try { privateKey = crypto.createPrivateKey(String(sa.private_key).replace(/\\n/g, '\n')); } catch (error) { logger('error', 'fcm_key_invalid', { error: String(error && error.message || error) }); } }
  const configured = Boolean(sa && privateKey);
  const tokenUri = (sa && sa.token_uri) || 'https://oauth2.googleapis.com/token';
  let access = { token: '', until: 0 }, minting = null;
  async function accessToken(force = false) {
    if (!force && access.token && access.until > now() + 60_000) return access.token;
    if (minting) return minting;
    minting = (async () => {
      const t = Math.floor(now() / 1000);
      const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const claims = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: tokenUri, iat: t, exp: t + 3600 }));
      const assertion = `${head}.${claims}.${b64u(crypto.sign('RSA-SHA256', Buffer.from(`${head}.${claims}`), privateKey))}`;
      const res = await fetchImpl(tokenUri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(), signal: AbortSignal.timeout(10_000) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.access_token) throw new Error(`fcm_token_${res.status}`);
      access = { token: String(body.access_token), until: now() + Math.max(60, Number(body.expires_in) || 3600) * 1000 };
      return access.token;
    })().finally(() => { minting = null; });
    return minting;
  }
  async function send(token, message, { retry = true } = {}) {
    if (!configured) return { ok: false, error: 'fcm_unconfigured' };
    const m = message.title !== undefined && message.ttl !== undefined ? message : normalizeMessage(message);
    if (m.error) return { ok: false, error: m.error };
    let bearer;
    try { bearer = await accessToken(); } catch (error) { logger('warn', 'fcm_token_failed', { error: String(error && error.message || error) }); return { ok: false, error: 'fcm_unavailable' }; }
    const data = { ...m.data, ...(m.url ? { url: m.url } : {}), title: m.title, body: m.body };
    const body = { message: { token, notification: { title: m.title, body: m.body }, data,
      android: { priority: 'high', ttl: `${m.ttl}s`, ...(m.collapseId ? { collapse_key: m.collapseId } : {}), notification: { channel_id: m.channelId, sound: m.sound || 'default', ...(m.collapseId ? { tag: m.collapseId } : {}) } } } };
    let res, parsed = {};
    try {
      res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
      parsed = await res.json().catch(() => ({}));
    } catch (error) { logger('warn', 'fcm_transport_error', { error: String(error && error.message || error) }); return { ok: false, error: 'fcm_unavailable' }; }
    if (res.ok) return { ok: true, status: res.status, name: parsed.name || '' };
    if (res.status === 401 && retry) { try { await accessToken(true); } catch (_) { return { ok: false, error: 'fcm_unavailable' }; } return send(token, m, { retry: false }); }
    const details = Array.isArray(parsed.error && parsed.error.details) ? parsed.error.details : [];
    const code = details.map((d) => d && d.errorCode).find(Boolean) || (parsed.error && parsed.error.status) || '';
    const gone = res.status === 404 || code === 'UNREGISTERED' || (res.status === 400 && /not a valid FCM registration token|invalid.*token/i.test(String(parsed.error && parsed.error.message || '')));
    if (!gone) logger('warn', 'fcm_send_failed', { status: res.status, code });
    return { ok: false, status: res.status, reason: String(code || ''), gone };
  }
  return { configured, platform: 'android', projectId: sa ? sa.project_id : '', send, accessToken: configured ? accessToken : null };
}

/* ---- Web push (the PWA shell), with the platform's existing VAPID keys ---- */
function createWebPushClient({ pool = null, keys = null, subject = 'https://sml-platform-api.onrender.com', fetchImpl = fetch, now = Date.now, logger = () => {} } = {}) {
  let vapid = keys || null, loading = null;
  async function loadKeys() {
    if (vapid) return vapid;
    if (!pool || typeof pool.query !== 'function') return null;
    if (!loading) loading = (async () => {
      try {
        let r = await pool.query("SELECT value FROM academy_state_kv WHERE key = 'push-vapid'");
        if (!r.rows[0]) {
          await pool.query("INSERT INTO academy_state_kv (key, value, updated_at) VALUES ('push-vapid', $1::jsonb, now()) ON CONFLICT (key) DO NOTHING", [JSON.stringify(generateVapidKeys())]);
          r = await pool.query("SELECT value FROM academy_state_kv WHERE key = 'push-vapid'");
        }
        const v = r.rows[0] && r.rows[0].value;
        if (v && v.publicKey && v.privateJwk) vapid = v;
      } catch (error) { logger('warn', 'web_push_keys_unavailable', { error: String(error && error.message || error) }); }
      loading = null;
      return vapid;
    })();
    return loading;
  }
  async function send(device, message) {
    const k = await loadKeys(); if (!k) return { ok: false, error: 'web_push_unconfigured' };
    if (!device || !device.keys || !device.keys.p256dh || !device.keys.auth) return { ok: false, error: 'web_keys_missing', gone: true };
    const m = message.title !== undefined && message.ttl !== undefined ? message : normalizeMessage(message);
    if (m.error) return { ok: false, error: m.error };
    const body = encryptPayload(device.keys, JSON.stringify({ title: m.title, body: m.body, url: m.url, data: m.data, tag: m.collapseId || undefined }));
    const headers = { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(m.ttl), Urgency: 'high', Authorization: vapidHeader({ endpoint: device.token, keys: k, subject, now }) };
    if (m.collapseId) headers.Topic = m.collapseId.slice(0, 32);
    try {
      const res = await fetchImpl(device.token, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
      if (res.status === 404 || res.status === 410) return { ok: false, status: res.status, gone: true };
      if (!res.ok) { logger('warn', 'web_push_send_failed', { status: res.status }); return { ok: false, status: res.status }; }
      return { ok: true, status: res.status };
    } catch (error) { logger('warn', 'web_push_transport_error', { error: String(error && error.message || error) }); return { ok: false, error: 'web_push_unavailable' }; }
  }
  return { configured: Boolean(vapid || (pool && typeof pool.query === 'function')), platform: 'web', send, publicKey: async () => ((await loadKeys()) || {}).publicKey || null };
}

/* ---- the dispatcher ---- */
function createAppPushSender({ devices, apns = null, fcm = null, web = null, logger = () => {}, now = Date.now, concurrency = 8 } = {}) {
  const clients = { ios: apns, android: fcm, web };
  async function sendTo(device, m) {
    const client = clients[device.platform];
    if (!client || !client.configured) return { platform: device.platform, ok: false, error: `${device.platform}_push_off` };
    const r = device.platform === 'web' ? await client.send(device, m) : await client.send(device.token, m);
    if (r.gone) await devices.disableToken(device.token, r.reason || `gone_${r.status || 'x'}`).catch(() => {});
    return { platform: device.platform, ...r };
  }
  /* every live device of one member */
  async function send(userId, message) {
    const m = normalizeMessage(message);
    if (m.error) return { ok: false, error: m.error };
    const list = await devices.tokensFor(Number(userId));
    const results = await Promise.all(list.map((d) => sendTo(d, m)));
    const out = { ok: true, userId: Number(userId), devices: list.length, sent: results.filter((r) => r.ok).length, gone: results.filter((r) => r.gone).length, results };
    if (list.length) logger('info', 'app_push_sent', { userId: out.userId, devices: out.devices, sent: out.sent, gone: out.gone });
    return out;
  }
  /* many members, a few at a time */
  async function sendMany(userIds, message) {
    const m = normalizeMessage(message);
    if (m.error) return { ok: false, error: m.error };
    const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    const totals = { ok: true, members: ids.length, reached: 0, devices: 0, sent: 0, gone: 0 };
    let i = 0;
    const worker = async () => { while (i < ids.length) { const id = ids[i++]; const r = await send(id, m); totals.devices += r.devices; totals.sent += r.sent; totals.gone += r.gone; if (r.sent) totals.reached += 1; } };
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
    return totals;
  }
  const status = () => ({ ios: Boolean(apns && apns.configured), android: Boolean(fcm && fcm.configured), web: Boolean(web && web.configured) });
  return { send, sendMany, status, webPublicKey: () => (web && web.publicKey ? web.publicKey() : Promise.resolve(null)), configured: Object.values(status()).some(Boolean) };
}

module.exports = { createAppPushSender, createApnsClient, createFcmClient, createWebPushClient, normalizeMessage, parseServiceAccount, http2Transport };
