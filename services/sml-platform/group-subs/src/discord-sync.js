/* =============================================================================
 * StockMarketLoop — Discord role sync client
 *
 * Applies the grant/revoke operations that reconcile() produces.
 *
 * The hard part is not the two API calls, it is Discord's rate limiting. Getting
 * it wrong does not fail loudly — it gets the bot token temporarily banned, at
 * which point every member of every group silently stops receiving roles and
 * nobody finds out until they complain.
 *
 * What this handles:
 *   * per-bucket limits read from X-RateLimit-* response headers
 *   * 429 with retry_after, including the global limit which pauses everything
 *   * 5xx with exponential backoff and jitter
 *   * a per-run operation cap, so one enormous sweep cannot monopolise the token
 *   * 404 on member (they left the server) treated as SUCCESS for a revoke and
 *     a permanent, non-retryable failure for a grant
 *
 * `fetchImpl` and `sleep` are injected, so all of the above is testable without
 * a network or a real clock.
 * ========================================================================== */

'use strict';

const API = 'https://discord.com/api/v10';

const DEFAULTS = {
  maxAttempts: 3,
  maxOpsPerRun: 200,
  baseBackoffMs: 500,
  maxBackoffMs: 30000,
  /* Discord's global ceiling is ~50 req/s. Well under it: role edits are never
     urgent, and a throttled token is far more expensive than a slow sweep. */
  minIntervalMs: 120
};

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/* Deterministic jitter — a hash of the key rather than Math.random, so a test
   can assert exact delays while real traffic still spreads out. */
function jitter(key, spreadMs) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h % Math.max(1, spreadMs));
}

function roleRoute(guildId, userId, roleId) {
  return `${API}/guilds/${guildId}/members/${userId}/roles/${roleId}`;
}

/* All member-role edits in one guild share a bucket, so the guild is the key. */
function bucketKey(guildId) { return `guild:${guildId}:member-roles`; }

/* -------------------------------------------------------------------------- */

function createSyncClient(opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts);
  const fetchImpl = opts.fetchImpl;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const nowFn = opts.now || (() => Date.now());
  const token = opts.token || '';

  if (typeof fetchImpl !== 'function') throw new TypeError('createSyncClient: fetchImpl required');

  /* bucketKey -> earliest epoch ms at which the next request may go out */
  const buckets = new Map();
  let globalUntil = 0;
  let lastRequestAt = 0;

  function readyAt(key) {
    return Math.max(buckets.get(key) || 0, globalUntil, lastRequestAt + cfg.minIntervalMs);
  }

  async function waitFor(key) {
    const wait = readyAt(key) - nowFn();
    if (wait > 0) await sleep(wait);
  }

  /** Fold rate-limit headers into local state so the NEXT call already knows. */
  function absorbHeaders(headers, key) {
    if (!headers || typeof headers.get !== 'function') return;
    const remaining = headers.get('x-ratelimit-remaining');
    const resetAfter = headers.get('x-ratelimit-reset-after');
    if (remaining !== null && Number(remaining) <= 0 && resetAfter !== null) {
      buckets.set(key, nowFn() + Math.ceil(Number(resetAfter) * 1000));
    }
  }

  /**
   * One role edit with full retry handling.
   * Returns { ok, status, permanent, attempts, error }.
   * `permanent: true` means do not retry on the next sweep either.
   */
  async function editRole(op) {
    const { guildId, userId, roleId, action } = op;
    const key = bucketKey(guildId);
    const url = roleRoute(guildId, userId, roleId);
    const method = action === 'grant' ? 'PUT' : 'DELETE';
    let attempts = 0;
    let lastError = null;

    while (attempts < cfg.maxAttempts) {
      attempts++;
      await waitFor(key);
      lastRequestAt = nowFn();

      let res;
      try {
        res = await fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bot ${token}`,
            'X-Audit-Log-Reason': op.reason ? String(op.reason).slice(0, 100) : 'StockMarketLoop subscription sync'
          }
        });
      } catch (e) {
        lastError = `network: ${String(e && e.message).slice(0, 120)}`;
        await sleep(clamp(cfg.baseBackoffMs * 2 ** (attempts - 1) + jitter(url, 200), 0, cfg.maxBackoffMs));
        continue;
      }

      absorbHeaders(res.headers, key);

      /* 204 is the documented success for both PUT and DELETE here. */
      if (res.status === 204 || res.status === 200 || res.status === 201) {
        return { ok: true, status: res.status, attempts };
      }

      if (res.status === 429) {
        let retryAfterMs = 1000;
        let isGlobal = false;
        try {
          const body = await res.json();
          if (body && body.retry_after != null) retryAfterMs = Math.ceil(Number(body.retry_after) * 1000);
          isGlobal = !!(body && body.global);
        } catch (e) { /* body may be empty; the default stands */ }
        if (res.headers && res.headers.get && res.headers.get('x-ratelimit-global') === 'true') isGlobal = true;

        const until = nowFn() + retryAfterMs;
        /* A global limit pauses every bucket, not just this one. Treating it as
           bucket-local is how a token gets banned. */
        if (isGlobal) globalUntil = until; else buckets.set(key, until);

        lastError = `429 retry_after=${retryAfterMs}ms${isGlobal ? ' (global)' : ''}`;
        continue;   /* does not consume a "real" failure; the wait is the fix */
      }

      /* Member is not in the guild. For a revoke that is the desired end state;
         for a grant it is unfixable by retrying. */
      if (res.status === 404) {
        if (action === 'revoke') return { ok: true, status: 404, attempts, note: 'member absent — already effectively revoked' };
        return { ok: false, status: 404, attempts, permanent: true, error: 'member not in guild' };
      }

      /* Missing permission or role hierarchy. Retrying cannot help; a human
         must move the bot role or grant the permission. */
      if (res.status === 403) {
        return { ok: false, status: 403, attempts, permanent: true,
          error: 'forbidden — check MANAGE_ROLES and that the bot role sits above the target role' };
      }

      if (res.status === 401) {
        return { ok: false, status: 401, attempts, permanent: true, error: 'bot token rejected' };
      }

      if (res.status >= 500) {
        lastError = `discord ${res.status}`;
        await sleep(clamp(cfg.baseBackoffMs * 2 ** (attempts - 1) + jitter(url, 200), 0, cfg.maxBackoffMs));
        continue;
      }

      return { ok: false, status: res.status, attempts, permanent: true, error: `unexpected ${res.status}` };
    }

    return { ok: false, attempts, permanent: false, error: lastError || 'exhausted attempts' };
  }

  /**
   * Apply a batch. Revokes run FIRST: if the run is cut short by the cap or a
   * long global pause, it is safer to have removed access that ended than to
   * have granted access and never got round to removing someone else's.
   */
  async function applyOperations(ops = []) {
    const revokes = ops.filter((o) => o.action === 'revoke');
    const grants = ops.filter((o) => o.action === 'grant');
    const ordered = revokes.concat(grants).slice(0, cfg.maxOpsPerRun);
    const deferred = revokes.length + grants.length - ordered.length;

    const results = [];
    for (const op of ordered) {
      const r = await editRole(op);
      results.push(Object.assign({ op }, r));
    }

    const succeeded = results.filter((r) => r.ok);
    const permanent = results.filter((r) => !r.ok && r.permanent);
    const retryable = results.filter((r) => !r.ok && !r.permanent);

    return {
      results,
      applied: succeeded.length,
      permanentFailures: permanent,
      retryable,
      deferred,
      summary: `${succeeded.length} applied, ${permanent.length} permanent failures, ${retryable.length} to retry, ${deferred} deferred`
    };
  }

  return {
    applyOperations,
    editRole,
    /* exposed for the sweep runner to log and for tests to assert against */
    state: () => ({ buckets: Object.fromEntries(buckets), globalUntil, lastRequestAt })
  };
}

/** Turn reconcile() output into the operation shape this client consumes. */
function toOperations(reconcileResult, guildId) {
  const ops = [];
  for (const g of reconcileResult.toGrant || []) {
    if (g.target !== 'discord_guild_role') continue;
    ops.push({ action: 'grant', guildId, userId: g.discord_user_id, roleId: g.role_ref,
      subscription_id: g.subscription_id, reason: 'subscription active' });
  }
  for (const r of reconcileResult.toRevoke || []) {
    if (r.target !== 'discord_guild_role') continue;
    ops.push({ action: 'revoke', guildId, userId: r.discord_user_id, roleId: r.role_ref,
      subscription_id: r.subscription_id, reason: r.reason || 'subscription ended' });
  }
  return ops;
}

module.exports = { createSyncClient, toOperations, bucketKey, DEFAULTS };
