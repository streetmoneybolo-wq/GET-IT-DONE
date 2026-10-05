'use strict';
const crypto = require('node:crypto');

/* Per-caller fixed-window limiter for the heavy Academy data routes. Callers are keyed by a hash of their bearer token
 * (so one member cannot burn the shared Massive/WordPress budget), falling back to the client IP. A cold cache fans out to
 * the vendors, so the cap bites there first. Returns { ok, remaining, retryAfterSec }. */
function createDataRateLimit({ limit = 240, windowMs = 60_000, now = Date.now, maxKeys = 20_000 } = {}) {
  let bucket = -1, hits = new Map();
  function keyOf(request) {
    const auth = String((request.headers && request.headers.authorization) || '');
    if (/^Bearer\s+\S{16,}/i.test(auth)) return 't:' + crypto.createHash('sha256').update(auth).digest('hex').slice(0, 16);
    const ip = String((request.headers && request.headers['x-forwarded-for']) || (request.socket && request.socket.remoteAddress) || '').split(',')[0].trim();
    return 'i:' + (ip || 'unknown');
  }
  function take(request, cost = 1) {
    const t = now(), b = Math.floor(t / windowMs);
    if (b !== bucket) { bucket = b; hits = new Map(); }
    const key = keyOf(request);
    if (!hits.has(key) && hits.size >= maxKeys) return { ok: false, remaining: 0, retryAfterSec: Math.ceil(((b + 1) * windowMs - t) / 1000) };
    const n = (hits.get(key) || 0) + cost;
    hits.set(key, n);
    return { ok: n <= limit, remaining: Math.max(0, limit - n), retryAfterSec: Math.max(1, Math.ceil(((b + 1) * windowMs - t) / 1000)) };
  }
  return { take, keyOf };
}

module.exports = { createDataRateLimit };
