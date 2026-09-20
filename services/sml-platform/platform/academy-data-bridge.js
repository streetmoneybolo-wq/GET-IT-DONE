'use strict';

const crypto = require('node:crypto');

const ALLOWED_KINDS = new Set(['options', 'earnings']);

function cleanSymbol(value) {
  const symbol = String(value || '').toUpperCase().replace(/[^A-Z0-9.:-]/g, '').slice(0, 12);
  if (!symbol) throw new TypeError('invalid_symbol');
  return symbol;
}

/*
 * Private Render -> WordPress data bridge.  The browser never receives the
 * signing key, and WordPress accepts only short-lived HMAC-signed requests.
 */
function createAcademyDataBridge({ baseUrl = '', secret = '', fetchImpl = fetch, now = Date.now } = {}) {
  const root = String(baseUrl || '').replace(/\/$/, '');
  const configured = /^https:\/\//i.test(root) && String(secret).length >= 32;

  async function get(kind, symbol) {
    if (!configured) return { ok: false, status: 503, code: 'academy_data_unconfigured' };
    if (!ALLOWED_KINDS.has(kind)) return { ok: false, status: 404, code: 'not_found' };
    const safeSymbol = cleanSymbol(symbol);
    const path = `/wp-json/sml-academy-bridge/v1/${kind}?symbol=${encodeURIComponent(safeSymbol)}`;
    const timestamp = String(Math.floor(now() / 1000));
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${path}`).digest('hex');
    let response;
    try {
      response = await fetchImpl(`${root}${path}`, {
        headers: {
          accept: 'application/json',
          'x-sml-academy-timestamp': timestamp,
          'x-sml-academy-signature': `sha256=${signature}`
        },
        signal: AbortSignal.timeout(8_000)
      });
    } catch (_) {
      return { ok: false, status: 503, code: 'academy_data_unavailable' };
    }
    if (!response.ok) return { ok: false, status: response.status === 401 || response.status === 403 ? 503 : response.status, code: 'academy_data_unavailable' };
    let data;
    try { data = await response.json(); } catch (_) { return { ok: false, status: 503, code: 'academy_data_unavailable' }; }
    return { ok: true, status: 200, data };
  }

  return { configured, get };
}

module.exports = { createAcademyDataBridge, cleanSymbol };
