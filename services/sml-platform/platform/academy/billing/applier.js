'use strict';

/* =============================================================================
 * MEM Academy billing: the role outbox applier.
 *
 * Executes academy_billing_role_state rows through the existing rate-limited
 * group-subs/src/discord-sync.js client (unchanged; fetchImpl is mandatory).
 *
 *   - Claims due rows with a lease (revokes first) and releases the row lock
 *     BEFORE the Discord call.
 *   - Finishes with a compare-and-set on the claimed generation: if a resync
 *     changed the desired value while the call was in flight, the write is
 *     discarded and the (newer) row stays pending for the next pass.
 *   - Only the configured engine role ids (academy, and the optional lifetime
 *     role) and the configured EXTERNAL role ids (role_key 'external') can
 *     ever be sent. Any other id throws before a single request is made.
 *   - Revokes need SML_ACADEMY_BILLING_REVOKES_ENABLED=1; otherwise the row is
 *     marked 'suppressed' and audited.
 *   - Revokes also need the Stripe account confirmed by preflight
 *     (revokesAllowed). A key on the wrong account makes every Customer 404,
 *     which reads as "no purchases"; until preflight confirms the account,
 *     only grants are claimed and any revoke row stays queued, untouched.
 *
 * Discord error classes (read from the JSON error code, which discord-sync
 * does not parse, via a capturing fetch wrapper):
 *   10007 Unknown Member on a grant -> awaiting_member, backoff 10m, 30m, 2h,
 *                                      then 6h, for up to 90 days -> failed
 *   404 on a revoke (member gone)   -> synced
 *   10011 Unknown Role / 10004      -> CONFIG latch: every row waits, alert
 *   403 / 50013 / 50001             -> PERMISSION latch: one probe per 30 min
 *   401                             -> TOKEN latch: one probe per 30 min
 *   429                             -> honoured inside discord-sync
 *   anything else                   -> backoff 30 s x 2^n capped at 1 h;
 *                                      failed after 20 attempts
 *
 * EXTERNAL roles (role_key 'external': Monarch / Elite / Premium, only ids in
 * SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS):
 *   - a DELETE is sent only when the ledger (academy_billing_external_grants)
 *     says state 'revoked' with had_role_before=false, re-read right before
 *     the call; anything else is refused (suppressed + external_revoke_refused),
 *     so the engine never removes a role it did not put there;
 *   - and only on an Upgrade.Chat "none" at most UC_ANSWER_TTL_MS old: a
 *     DELETE that waited longer (a blocked row, a latch, the revoke hold, a
 *     backoff) waits 5 more minutes while the member is made due, so the
 *     resync asks Upgrade.Chat again first (a member may have paid Upgrade.Chat
 *     for the role meanwhile); these waits count toward the 20 attempts;
 *   - a 403 or Unknown Role on an external role (for example Monarch sitting
 *     above the bot's top role) blocks THAT row only (retried every 30 min,
 *     failed after 20 attempts), never the global latch, so Academy Student
 *     grants keep flowing.
 * ========================================================================== */

const { createSyncClient } = require('../../../group-subs/src/discord-sync');
const audit = require('./audit');
const { CODES } = require('./discord');
const { ROLE_MAX_ATTEMPTS } = require('./store');
const { ucAnswerStale } = require('./external');

const LATCH_PROBE_MS = 30 * 60_000;
const AWAITING_BACKOFF_MS = [10 * 60_000, 30 * 60_000, 2 * 3600_000];
const AWAITING_STEADY_MS = 6 * 3600_000;
const AWAITING_MAX_MS = 90 * 24 * 3600_000;
const AUDIT_REASON = 'MEM Academy entitlement';
/* An external DELETE whose Upgrade.Chat answer is too old waits this long
   for the resync to ask again. */
const UC_STALE_RETRY_MS = 5 * 60_000;

/** Wrap fetch so the Discord JSON error code of each role call is kept. */
function createCapturingFetch(fetchImpl) {
  const codes = new Map();
  async function capturing(url, init) {
    const response = await fetchImpl(url, init);
    if (response.status < 400 || response.status === 429) {
      if (response.status === 429) {
        /* discord-sync reads the 429 body itself; hand it a readable copy. */
        let text = '';
        try { text = await response.text(); } catch (_) { text = ''; }
        return { status: 429, headers: response.headers, json: async () => (text ? JSON.parse(text) : {}), text: async () => text };
      }
      codes.delete(url);
      return response;
    }
    let text = '';
    try { text = await response.text(); } catch (_) { text = ''; }
    let code = null;
    try { const parsed = JSON.parse(text); code = Number.isInteger(parsed && parsed.code) ? parsed.code : null; } catch (_) { code = null; }
    codes.set(url, { status: response.status, code });
    return { status: response.status, headers: response.headers, json: async () => (text ? JSON.parse(text) : {}), text: async () => text };
  }
  return { fetch: capturing, lastError: (url) => codes.get(url) || null };
}

function roleUrl(guildId, userId, roleId) {
  return `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`;
}

function createApplier({ config, store, bot = null, fetchImpl = globalThis.fetch, sleep, logger = () => {}, now = Date.now,
  syncClient = null, preflightOk = () => true, revokesAllowed = () => true, maxOpsPerRun = 50 } = {}) {
  const engineIds = new Map(Object.entries(config.engineRoleIds).filter(([, id]) => Boolean(id)).map(([key, id]) => [String(id), key]));
  const externalIds = new Set((config.externalRoleIds || []).map(String));
  const neverGrant = config.neverGrantRoleIds instanceof Set ? config.neverGrantRoleIds : new Set();
  const capture = createCapturingFetch(fetchImpl);
  const client = syncClient || createSyncClient({ token: config.botToken, fetchImpl: capture.fetch, sleep, now, maxOpsPerRun });
  const latch = { kind: null, since: null, lastProbeAt: 0 };
  let running = null;
  let revokesHeld = false;

  function assertEngineRole(row) {
    const roleId = String(row.role_id);
    if (row.role_key === 'external') {
      if (!externalIds.has(roleId) || neverGrant.has(roleId) || engineIds.has(roleId)) {
        throw new Error(`academy_billing_foreign_role_refused:${roleId.slice(0, 24)}`);
      }
      return;
    }
    const key = engineIds.get(roleId);
    if (!key || key !== row.role_key || config.protectedRoleIds.has(roleId)) {
      throw new Error(`academy_billing_foreign_role_refused:${roleId.slice(0, 24)}`);
    }
  }

  /* The last line of defence for an external DELETE: the ledger must say the
     engine granted this role to a member who did not hold it before, that
     the revoke was decided (state 'revoked'), and on a recent Upgrade.Chat
     answer. Returns 'ok', 'refused' or 'stale'. */
  async function externalRevokeGate(pk) {
    if (typeof store.getExternalGrant !== 'function') return 'refused';
    const grant = await store.getExternalGrant(store.pool, pk.discordId, pk.roleId);
    if (!grant || grant.had_role_before !== false || grant.state !== 'revoked') return 'refused';
    return ucAnswerStale(grant, now()) ? 'stale' : 'ok';
  }

  function setLatch(kind, detail) {
    if (latch.kind !== kind) {
      latch.kind = kind;
      latch.since = now();
      logger('error', 'academy_billing_discord_blocked', { latch: kind, ...detail });
    }
    latch.lastProbeAt = now();
  }

  function awaitingDelay(row) {
    const since = row.awaiting_since ? new Date(row.awaiting_since).getTime() : now();
    const step = Math.max(0, Number(row.attempts || 1) - 1);
    return { since, delay: step < AWAITING_BACKOFF_MS.length ? AWAITING_BACKOFF_MS[step] : AWAITING_STEADY_MS };
  }

  async function auditRow(row, fields) {
    await audit.appendStandalone(store.pool, {
      actor: 'applier', livemode: config.livemode, discordUserId: String(row.discord_user_id), roleKey: row.role_key, ...fields
    }, { now });
  }

  async function applyOne(row) {
    assertEngineRole(row);
    const pk = { discordId: String(row.discord_user_id), roleId: String(row.role_id), generation: Number(row.generation) };
    if (!row.desired && !config.revokesEnabled) {
      const n = await store.finishRoleRow(store.pool, { ...pk, state: 'suppressed' });
      if (n) await auditRow(row, { action: 'role_suppressed', outcome: 'suppressed', reason: 'revokes_disabled' });
      return 'suppressed';
    }
    const external = row.role_key === 'external';
    const gate = external && !row.desired ? await externalRevokeGate(pk) : 'ok';
    if (gate === 'refused') {
      const n = await store.finishRoleRow(store.pool, { ...pk, state: 'suppressed', error: 'external_revoke_refused' });
      if (n) await auditRow(row, { action: 'external_revoke_refused', outcome: 'suppressed', reason: 'ledger_not_engine_granted', details: { roleId: pk.roleId } });
      logger('warn', 'academy_billing_external_revoke_refused', { discordUserId: pk.discordId, roleId: pk.roleId });
      return 'refused';
    }
    if (gate === 'stale') {
      /* Not on an old Upgrade.Chat answer: make the member due, so the resync
         asks again (and re-queues, cancels or parks this DELETE). */
      const failed = Number(row.attempts || 1) >= ROLE_MAX_ATTEMPTS;
      const n = await store.finishRoleRow(store.pool, { ...pk, state: failed ? 'failed' : 'pending', error: 'uc_answer_stale',
        nextAttemptAt: failed ? null : now() + UC_STALE_RETRY_MS });
      if (n && failed) await auditRow(row, { action: 'role_failed', outcome: 'failed_permanent', reason: 'uc_answer_stale', details: { roleId: pk.roleId } });
      if (n && typeof store.setNextCheck === 'function') await store.setNextCheck(store.pool, pk.discordId, now()).catch(() => {});
      logger('info', 'academy_billing_external_revoke_needs_fresh_uc', { discordUserId: pk.discordId, roleId: pk.roleId });
      return 'stale';
    }
    const op = { action: row.desired ? 'grant' : 'revoke', guildId: config.guildId, userId: pk.discordId, roleId: pk.roleId, reason: AUDIT_REASON };
    const url = roleUrl(config.guildId, pk.discordId, pk.roleId);
    const result = await client.editRole(op);
    const captured = capture.lastError(url);
    const code = captured ? captured.code : null;

    /* An external role the bot cannot write (above its top role, or gone):
       this row waits, everything else keeps flowing. */
    if (external && (result.status === 403 || (result.status === 404 && code === CODES.UNKNOWN_ROLE))) {
      const attempts = Number(row.attempts || 1);
      const error = result.status === 403 ? 'external_role_forbidden' : 'external_role_unknown';
      const failed = attempts >= ROLE_MAX_ATTEMPTS;
      const n = await store.finishRoleRow(store.pool, { ...pk, state: failed ? 'failed' : 'pending', httpStatus: result.status, error,
        nextAttemptAt: failed ? null : now() + LATCH_PROBE_MS });
      if (n && (failed || Number(row.last_http_status) !== result.status)) {
        await auditRow(row, { action: failed ? 'role_failed' : 'role_blocked', outcome: failed ? 'failed_permanent' : 'failed_retryable',
          httpStatus: result.status, reason: error, details: { roleId: pk.roleId } });
      }
      logger('warn', 'academy_billing_external_role_blocked', { roleId: pk.roleId, status: result.status, code, error });
      return failed ? 'failed' : 'blocked';
    }

    if (result.ok) {
      if (result.status === 404 && op.action === 'revoke' && code === CODES.UNKNOWN_ROLE) {
        setLatch('config', { status: 404, code });
        await store.releaseRoleRow(store.pool, pk);
        return 'latched';
      }
      const n = await store.finishRoleRow(store.pool, { ...pk, state: 'synced', httpStatus: result.status });
      if (n) {
        await auditRow(row, { action: row.desired ? 'role_granted' : 'role_revoked', outcome: 'applied', httpStatus: result.status,
          reason: result.status === 404 ? 'member_absent' : null });
      }
      return n ? 'synced' : 'superseded';
    }

    if (result.status === 404) {
      if (code === CODES.UNKNOWN_ROLE || code === CODES.UNKNOWN_GUILD) {
        setLatch('config', { status: 404, code });
        await store.releaseRoleRow(store.pool, pk);
        return 'latched';
      }
      /* Unknown Member (10007) or an unlabelled 404 on a grant. */
      const { since, delay } = awaitingDelay(row);
      if (now() - since > AWAITING_MAX_MS) {
        const n = await store.finishRoleRow(store.pool, { ...pk, state: 'failed', httpStatus: 404, error: 'member_absent_90d' });
        if (n) await auditRow(row, { action: 'role_failed', outcome: 'failed_permanent', httpStatus: 404, reason: 'member_absent_90d' });
        return 'failed';
      }
      const firstTime = row.state !== 'awaiting_member';
      const n = await store.finishRoleRow(store.pool, { ...pk, state: 'awaiting_member', httpStatus: 404, error: 'member_not_in_guild',
        nextAttemptAt: now() + delay });
      if (n && firstTime) {
        let banned = null;
        if (bot && typeof bot.getBan === 'function') {
          try { banned = await bot.getBan(pk.discordId); } catch (_) { banned = null; }
        }
        await auditRow(row, { action: banned ? 'member_banned' : 'role_awaiting_member', outcome: 'waiting_member', httpStatus: 404,
          reason: banned ? 'banned_while_entitled' : 'member_not_in_guild' });
        if (banned) logger('warn', 'academy_billing_member_banned', { discordUserId: pk.discordId });
      }
      return 'awaiting_member';
    }
    if (result.status === 401) {
      setLatch('token', { status: 401 });
      await store.releaseRoleRow(store.pool, pk);
      return 'latched';
    }
    if (result.status === 403) {
      setLatch('permission', { status: 403, code });
      await store.releaseRoleRow(store.pool, pk);
      return 'latched';
    }
    /* Retryable (5xx, network, exhausted 429) or an unexpected status. */
    const attempts = Number(row.attempts || 1);
    if (attempts >= ROLE_MAX_ATTEMPTS) {
      const n = await store.finishRoleRow(store.pool, { ...pk, state: 'failed', httpStatus: result.status || null, error: String(result.error || 'failed') });
      if (n) await auditRow(row, { action: 'role_failed', outcome: 'failed_permanent', httpStatus: result.status || null, reason: 'max_attempts' });
      return 'failed';
    }
    const delay = Math.min(3600_000, 30_000 * 2 ** Math.max(0, attempts - 1));
    await store.finishRoleRow(store.pool, { ...pk, state: 'pending', httpStatus: result.status || null, error: String(result.error || 'retry'),
      nextAttemptAt: now() + delay });
    return 'retry';
  }

  async function runOnce({ limit = 20 } = {}) {
    if (config.roleMode !== 'enforce') return { skipped: 'role_mode' };
    if (!preflightOk()) return { skipped: 'preflight' };
    let probing = false;
    if (latch.kind) {
      if (now() - latch.lastProbeAt < LATCH_PROBE_MS) return { skipped: `latched_${latch.kind}` };
      probing = true;
    }
    const holdRevokes = !revokesAllowed();
    if (holdRevokes !== revokesHeld) {
      revokesHeld = holdRevokes;
      logger(holdRevokes ? 'warn' : 'info', holdRevokes ? 'academy_billing_revokes_held' : 'academy_billing_revokes_released',
        { reason: 'stripe_account_unconfirmed' });
    }
    const rows = await store.claimRoleRows(probing ? 1 : limit, undefined, { grantsOnly: holdRevokes });
    const counts = {};
    for (const row of rows) {
      const held = holdRevokes && !row.desired;
      if ((latch.kind && !probing) || held) {
        await store.releaseRoleRow(store.pool, { discordId: String(row.discord_user_id), roleId: String(row.role_id), generation: Number(row.generation) });
        if (held) counts.held = (counts.held || 0) + 1;
        continue;
      }
      const outcome = await applyOne(row);
      counts[outcome] = (counts[outcome] || 0) + 1;
      if (probing) {
        /* A row-level external block, a refused revoke or one waiting for a
           fresh Upgrade.Chat answer proves nothing about the global latch:
           keep probing with the next row. */
        if (outcome === 'blocked' || outcome === 'refused' || outcome === 'stale') continue;
        if (outcome !== 'latched') {
          logger('info', 'academy_billing_discord_unblocked', { latch: latch.kind });
          latch.kind = null;
          latch.since = null;
        }
        probing = false;
      }
    }
    return { claimed: rows.length, counts, latch: latch.kind };
  }

  /** Serialized: overlapping kicks share one in-flight pass. */
  function run(options) {
    if (!running) {
      running = runOnce(options).finally(() => { running = null; });
    }
    return running;
  }

  return { run, runOnce, applyOne, latch: () => ({ ...latch }), assertEngineRole };
}

module.exports = { createApplier, createCapturingFetch, AWAITING_BACKOFF_MS, AWAITING_MAX_MS, LATCH_PROBE_MS, UC_STALE_RETRY_MS };
