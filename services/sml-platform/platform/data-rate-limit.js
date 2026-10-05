'use strict';

/* Per-caller fixed-window limiter for the heavy Academy data routes. It runs before authentication, so it must not trust anything the caller can
 * forge: callers are keyed by the connecting address as seen by the platform's own proxy (the LAST X-Forwarded-For entry, which the proxy appends;
 * earlier entries are client-supplied and ignored), falling back to the socket address. A cold cache fans out to the vendors, so this cap bites there first.
 * The key table is bounded; when it is full, new callers share one overflow bucket instead of being refused, so a flood of fake addresses cannot lock
 * real users out, it only makes the flood compete with itself. Returns { ok, remaining, retryAfterSec }. */
function createDataRateLimit({ limit = 240, windowMs = 60_000, now = Date.now, maxKeys = 20_000, overflowMultiplier = 10 } = {}) {
  let bucket = -1, hits = new Map();
  function keyOf(request) {
    const xff = String((request.headers && request.headers['x-forwarded-for']) || '').split(',').map((x) => x.trim()).filter(Boolean);
    const ip = xff.length ? xff[xff.length - 1] : String((request.socket && request.socket.remoteAddress) || '');
    return 'i:' + (ip || 'unknown');
  }
  function take(request, cost = 1) {
    const t = now(), b = Math.floor(t / windowMs);
    if (b !== bucket) { bucket = b; hits = new Map(); }
    let key = keyOf(request), cap = limit;
    if (!hits.has(key) && hits.size >= maxKeys) { key = 'overflow'; cap = limit * overflowMultiplier; }
    const n = (hits.get(key) || 0) + cost;
    hits.set(key, n);
    return { ok: n <= cap, remaining: Math.max(0, cap - n), retryAfterSec: Math.max(1, Math.ceil(((b + 1) * windowMs - t) / 1000)) };
  }
  return { take, keyOf };
}

module.exports = { createDataRateLimit };
