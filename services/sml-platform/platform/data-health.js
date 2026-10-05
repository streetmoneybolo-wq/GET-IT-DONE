'use strict';

/* Provider health registry + circuit breaker for the Academy data pipeline.
 * - every provider call is timed and recorded (success / failure / http status)
 * - after `failThreshold` consecutive failures the circuit opens and calls fail fast for a cool-down that doubles (capped),
 *   then ONE trial call is let through (half-open); success closes the circuit
 * - a 429 honours Retry-After (seconds or HTTP date) instead of hammering the vendor
 * snapshot() feeds /health and the user-visible data-status chip. */

function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return 0;
  const s = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.min(10 * 60_000, Math.round(Number(s) * 1000));
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.max(0, Math.min(10 * 60_000, t - now)) : 0;
}

function createDataHealth({ now = Date.now, failThreshold = 5, openMs = 20_000, maxOpenMs = 5 * 60_000, degradedWindowMs = 5 * 60_000 } = {}) {
  const provs = new Map();
  function rec(name) {
    if (!provs.has(name)) {
      provs.set(name, { name, calls: 0, ok: 0, failed: 0, consecutive: 0, lastOkAt: 0, lastErrorAt: 0, lastError: '', lastStatus: 0,
        totalMs: 0, lastMs: 0, openUntil: 0, backoffMs: openMs, trial: false, blockedUntil: 0, opened: 0 });
    }
    return provs.get(name);
  }

  function canCall(name) {
    const r = rec(name), t = now();
    if (r.blockedUntil > t) return false;
    if (r.openUntil > t) return false;
    if (r.openUntil && r.openUntil <= t) { // half-open: one trial at a time
      if (r.trial) return false;
      r.trial = true;
    }
    return true;
  }
  function retryInMs(name) { const r = rec(name), t = now(); return Math.max(0, r.blockedUntil - t, r.openUntil - t); }

  function success(name, ms = 0, status = 200) {
    const r = rec(name);
    r.calls += 1; r.ok += 1; r.consecutive = 0; r.lastOkAt = now(); r.lastStatus = status; r.lastMs = ms; r.totalMs += ms;
    r.openUntil = 0; r.trial = false; r.backoffMs = openMs;
  }
  function failure(name, error, { status = 0, retryAfterMs = 0, ms = 0 } = {}) {
    const r = rec(name), t = now();
    r.calls += 1; r.failed += 1; r.consecutive += 1; r.lastErrorAt = t; r.lastStatus = status; r.lastMs = ms; r.totalMs += ms;
    r.lastError = String((error && error.message) || error || 'error').slice(0, 160);
    const wasTrial = r.trial; r.trial = false;
    if (retryAfterMs > 0) r.blockedUntil = Math.max(r.blockedUntil, t + retryAfterMs);
    if (wasTrial || r.consecutive >= failThreshold) {
      r.backoffMs = wasTrial ? Math.min(maxOpenMs, r.backoffMs * 2) : r.backoffMs;
      r.openUntil = t + r.backoffMs; r.opened += 1;
    }
  }

  /* fetch through the breaker. Returns the Response (callers keep their own !ok handling); throws on network errors / open circuit. */
  async function guardedFetch(name, url, options, fetchImpl = fetch) {
    if (!canCall(name)) {
      const err = new Error(`circuit_open_${name}`); err.code = 'circuit_open'; err.provider = name; err.retryInMs = retryInMs(name); throw err;
    }
    const t0 = now();
    try {
      const response = await fetchImpl(url, options);
      const ms = now() - t0, status = Number(response.status) || 0;
      if (status === 429) {
        failure(name, 'rate_limited_429', { status, ms, retryAfterMs: parseRetryAfter(response.headers && response.headers.get && response.headers.get('retry-after'), now()) || 5_000 });
      } else if (status >= 500) failure(name, `http_${status}`, { status, ms });
      else if (status === 401 || status === 403) failure(name, `auth_${status}`, { status, ms });
      else success(name, ms, status);
      return response;
    } catch (error) {
      failure(name, error, { ms: now() - t0 });
      throw error;
    }
  }

  function stateOf(r, t) {
    if (!r.calls) return 'unknown';
    if (r.blockedUntil > t) return 'rate_limited';
    if (r.openUntil > t) return 'down';
    if (r.consecutive > 0 && t - r.lastErrorAt < degradedWindowMs) return 'degraded';
    if (r.lastErrorAt && r.lastErrorAt > r.lastOkAt && t - r.lastErrorAt < degradedWindowMs) return 'degraded';
    return 'ok';
  }

  function snapshot(extra = {}) {
    const t = now(), providers = {};
    let worst = 'ok';
    const rank = { ok: 0, unknown: 0, degraded: 1, rate_limited: 1, down: 2 };
    for (const r of provs.values()) {
      const state = stateOf(r, t);
      providers[r.name] = {
        state, calls: r.calls, failures: r.failed, consecutiveFailures: r.consecutive, lastOkAt: r.lastOkAt || null, lastErrorAt: r.lastErrorAt || null,
        lastError: r.lastError || null, lastStatus: r.lastStatus || null, avgMs: r.calls ? Math.round(r.totalMs / r.calls) : null,
        retryInMs: Math.max(0, r.blockedUntil - t, r.openUntil - t) || 0, timesOpened: r.opened
      };
      if (rank[state] > rank[worst]) worst = state;
    }
    for (const [name, v] of Object.entries(extra)) { // out-of-band providers (websocket, order flow)
      providers[name] = v;
      const st = v && v.state;
      if (st && rank[st] > rank[worst]) worst = st;
    }
    return { overall: worst, at: t, providers };
  }

  return { canCall, success, failure, guardedFetch, snapshot, retryInMs, rec, provs };
}

module.exports = { createDataHealth, parseRetryAfter };
