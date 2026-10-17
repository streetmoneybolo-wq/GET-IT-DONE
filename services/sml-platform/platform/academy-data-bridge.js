'use strict';

const crypto = require('node:crypto');

const ALLOWED_KINDS = new Set(['options', 'earnings', 'capital', 'calendar']);

function cleanSymbol(value) {
  const symbol = String(value || '').toUpperCase().replace(/[^A-Z0-9.:-]/g, '').slice(0, 12);
  if (!symbol) throw new TypeError('invalid_symbol');
  return symbol;
}

function cleanExpiration(value) {
  if (value == null || value === '') return '';
  const expiration = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiration)) throw new TypeError('invalid_expiration');
  return expiration;
}

/*
 * Private Render -> WordPress data bridge.  The browser never receives the
 * signing key, and WordPress accepts only short-lived HMAC-signed requests.
 */
/* The site answers an options request from its own cache in about a second, but a
 * ticker nobody has loaded lately is fetched from the moomoo OpenD bridge first, and
 * that can take well over ten seconds. The timeout has to fit that cold path: when it
 * is shorter, every cold load is abandoned, the provider breaker opens, and the chain
 * never comes back even though the site itself is fine. */
const DEFAULT_TIMEOUT_MS = 25_000;

/* One short sentence the member can read: the site's own error message when it sent
 * one, otherwise what went wrong on the way there. */
function describeFailure(error) {
  const name = String((error && error.name) || '');
  const message = String((error && error.message) || '');
  if (name === 'TimeoutError' || name === 'AbortError' || /timed? ?out/i.test(message)) return 'The site did not answer in time.';
  if (error && error.code === 'circuit_open') return 'The site is cooling down after repeated failures. Try again in a minute.';
  return 'The site could not be reached.';
}

function createAcademyDataBridge({ baseUrl = '', secret = '', fetchImpl = fetch, now = Date.now, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const root = String(baseUrl || '').replace(/\/$/, '');
  const configured = /^https:\/\//i.test(root) && String(secret).length >= 32;
  const timeout = Math.max(1_000, Math.min(120_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));

  /* one request per kind/symbol at a time, and a failed one is remembered briefly so a
   * thin ticker (or a site that is cooling down) is not hit again by every viewer */
  const inflight = new Map();
  const failed = new Map();
  const FAILURE_MEMORY_MS = 15_000;

  function get(kind, symbol, params = {}) {
    let key;
    try {
      key = kind + ':' + cleanSymbol(symbol) + ':' + ((kind === 'options' || kind === 'calendar') ? cleanExpiration(params.expiration) : '');
    } catch (_) { return fetchOnce(kind, symbol, params); }
    const bad = failed.get(key);
    if (bad && now() - bad.at < FAILURE_MEMORY_MS) return Promise.resolve(bad.result);
    if (inflight.has(key)) return inflight.get(key);
    const run = fetchOnce(kind, symbol, params).then((result) => {
      if (result.ok) failed.delete(key); else if (result.code === 'academy_data_unavailable') {
        failed.set(key, { at: now(), result });
        if (failed.size > 200) failed.delete(failed.keys().next().value);
      }
      return result;
    }).finally(() => inflight.delete(key));
    inflight.set(key, run);
    return run;
  }

  async function fetchOnce(kind, symbol, params = {}) {
    if (!configured) return { ok: false, status: 503, code: 'academy_data_unconfigured' };
    if (!ALLOWED_KINDS.has(kind)) return { ok: false, status: 404, code: 'not_found' };
    const safeSymbol = cleanSymbol(symbol);
    const expiration = kind === 'options' || kind === 'calendar' ? cleanExpiration(params.expiration) : '';
    const path = `/wp-json/sml-academy-bridge/v1/${kind}?symbol=${encodeURIComponent(safeSymbol)}${expiration ? `&expiration=${encodeURIComponent(expiration)}` : ''}`;
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
        signal: AbortSignal.timeout(timeout)
      });
    } catch (error) {
      return { ok: false, status: 503, code: 'academy_data_unavailable', detail: describeFailure(error) };
    }
    if (!response.ok) {
      /* the site's REST error carries the real cause (the options provider guard rewrites it to name the provider); keep it for the member */
      let detail = '';
      try { const body = await response.json(); detail = String((body && (body.message || body.detail)) || '').replace(/\s+/g, ' ').trim().slice(0, 200); } catch (_) { detail = ''; }
      if (!detail) detail = response.status === 401 || response.status === 403 ? 'The site refused the Academy bridge signature.' : `The site answered ${response.status}.`;
      return { ok: false, status: response.status === 401 || response.status === 403 ? 503 : response.status, code: 'academy_data_unavailable', detail };
    }
    let data;
    try { data = await response.json(); } catch (_) { return { ok: false, status: 503, code: 'academy_data_unavailable', detail: 'The site sent an unreadable answer.' }; }
    return { ok: true, status: 200, data };
  }

  return { configured, get, timeoutMs: timeout };
}

module.exports = { createAcademyDataBridge, cleanSymbol, cleanExpiration };
