'use strict';

const crypto = require('node:crypto');

/**
 * Signed client for the site's app identity plugin (plugins/sml-app-identity):
 *   POST /wp-json/sml-platform/v1/app/login   username + password (+ two-step code) -> the member
 *   POST /wp-json/sml-platform/v1/app/me      a member's profile, groups and wallet, by WordPress user id
 *   POST /wp-json/sml-platform/v1/app/proxy   one allow-listed WordPress REST call run AS that member
 *
 * Same HMAC family as the LOOP-KICK bridge: sign("{ts}.{path}.{sha256(body)}") with
 * SML_LOOP_KICK_BRIDGE_SECRET in x-sml-lk-timestamp / x-sml-lk-signature. The plugin verifies
 * every signature once (60 s window, replay burn), so the member's password crosses exactly one
 * TLS hop from this service to the site and is never stored here.
 */
const PASS_THROUGH = new Set([400, 401, 402, 403, 404, 409, 422, 423, 429]);

function createAppIdentity({ baseUrl = '', secret = '', fetchImpl = fetch, now = Date.now, timeoutMs = 10_000 } = {}) {
  const root = String(baseUrl || '').trim().replace(/\/+$/, '');
  const configured = /^https?:\/\//i.test(root) && String(secret).length >= 32;

  async function call(path, payload, { timeout = timeoutMs } = {}) {
    if (!configured) return { ok: false, status: 503, error: 'identity_unconfigured' };
    const body = JSON.stringify(payload);
    const ts = String(Math.floor(now() / 1000));
    const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
    const sig = crypto.createHmac('sha256', String(secret)).update(`${ts}.${path}.${bodyHash}`).digest('hex');
    let res;
    try {
      res = await fetchImpl(`${root}${path}`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'x-sml-lk-timestamp': ts, 'x-sml-lk-signature': `sha256=${sig}`, 'user-agent': 'StockMarketLoop-App-API/1.0' },
        body,
        signal: AbortSignal.timeout(timeout)
      });
    } catch (_) {
      return { ok: false, status: 503, error: 'identity_unavailable' };
    }
    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (res.ok && data && data.ok === true) return { ...data, ok: true, status: 200 };
    if (data && typeof data.error === 'string' && PASS_THROUGH.has(res.status)) {
      // the plugin's own member-facing refusal (invalid_credentials, two_step_required, ...), passed through untouched
      const { ok: _ok, ...rest } = data;
      return { ok: false, status: res.status, ...rest, error: String(data.error).slice(0, 64) };
    }
    if (data && typeof data.code === 'string' && PASS_THROUGH.has(res.status)) {
      // a WP_Error: code + message
      return { ok: false, status: res.status, error: String(data.code).replace(/^sml_(?:lkd|app)_/, '').slice(0, 64), message: String(data.message || '').slice(0, 200) };
    }
    return { ok: false, status: 503, error: 'identity_unavailable' };
  }

  /* username (or email) + password, plus the member's two-step code when the site asks for one. */
  function login({ login = '', password = '', code = '', device = {}, ip = '' } = {}) {
    return call('/wp-json/sml-platform/v1/app/login', {
      login: String(login).slice(0, 120),
      password: String(password).slice(0, 512),
      code: String(code || '').slice(0, 32),
      device: {
        id: String(device.id || '').slice(0, 80),
        name: String(device.name || '').slice(0, 80),
        platform: String(device.platform || '').slice(0, 16),
        appVersion: String(device.appVersion || '').slice(0, 32)
      },
      ip: String(ip || '').slice(0, 64)
    }, { timeout: 15_000 });
  }

  const me = (userId) => call('/wp-json/sml-platform/v1/app/me', { userId: Number(userId) });

  /* One WordPress REST request run as the member. `route` is the REST route ("/sml-feed/v1/slot"), never a URL. */
  function proxy({ userId, method = 'GET', route = '', query = {}, body = null } = {}) {
    return call('/wp-json/sml-platform/v1/app/proxy', {
      userId: Number(userId),
      method: String(method || 'GET').toUpperCase(),
      route: String(route || ''),
      query: query && typeof query === 'object' ? query : {},
      body: body && typeof body === 'object' ? body : null
    }, { timeout: 20_000 });
  }

  return { configured, login, me, proxy };
}

module.exports = { createAppIdentity };
