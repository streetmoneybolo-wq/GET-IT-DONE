'use strict';

/* =============================================================================
 * connect-adapter — glue between the SML Connect command layer
 * (connect-commands.js) and the platform's dispute service, identity graph,
 * and EXISTING subscription/role engine.
 *
 *   createConnectAuthorizer   discord user -> verified identity -> verified
 *                             merchant/connected_account ref -> merchant scope.
 *                             No ref means no access. Re-evaluated per command.
 *   createConnectDisputeService  reshapes dispute-service results into the
 *                             snake_case rows the command renderers whitelist.
 *   createConnectRoleTools    /role-status and /role-reconcile enqueue outbox
 *                             intents only; the worker handlers below reuse the
 *                             existing `subscription_access_reconcile` pipeline
 *                             (no second role engine).
 * ========================================================================== */

const MERCHANT_REF_TYPES = ['merchant', 'connected_account'];
const SNOWFLAKE_RE = /^[0-9]{15,24}$/;
const RECONCILE_STATUSES = ['active', 'trialing', 'past_due', 'grace', 'unpaid', 'canceled', 'paused'];
const MAX_RECONCILE_ROWS = 200;

function scopeOf(caseRow) {
  return (caseRow && caseRow.merchant_account) || 'platform';
}

function minuteBucket(ms) {
  return new Date(Math.floor(ms / 60_000) * 60_000).toISOString().slice(0, 16);
}

function dayBucket(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/* ---------------------------------------------------------------------------
 * Authorization
 * ------------------------------------------------------------------------- */

function createConnectAuthorizer({ pool, store } = {}) {
  if (!pool) throw new TypeError('a pg pool is required');
  if (!store || typeof store.decryptValue !== 'function') throw new TypeError('an evidence store is required');

  async function scopesFor(identityId) {
    const found = await pool.query(
      `SELECT ref_value_enc FROM billing_identity_refs
        WHERE identity_id = $1 AND verification = 'verified' AND ref_type = ANY($2)
        ORDER BY id ASC`,
      [Number(identityId), MERCHANT_REF_TYPES]
    );
    const scopes = new Set();
    for (const row of found.rows) {
      try { scopes.add(store.decryptValue(row.ref_value_enc)); } catch (_) { /* undecryptable ref grants nothing */ }
    }
    return [...scopes].sort();
  }

  return async function authorize({ identityId, guildId } = {}) {
    if (!Number.isSafeInteger(Number(identityId)) || Number(identityId) < 1) return { ok: false };
    const scopes = await scopesFor(identityId);
    if (!scopes.length) return { ok: false };
    /* Guild -> group -> seller connected account, when the guild is linked and
       the admin holds that exact scope. Otherwise the platform scope when
       held, otherwise the first (sorted) scope the admin holds. */
    if (guildId && SNOWFLAKE_RE.test(String(guildId))) {
      const linked = await pool.query(
        `SELECT s.connected_account_id
           FROM discord_guild_links g
           JOIN group_plans p ON p.group_id = g.group_id
           JOIN subscriptions sub ON sub.plan_id = p.id AND sub.connected_account_id IS NOT NULL
           JOIN marketplace_sellers s ON s.connected_account_id = sub.connected_account_id
          WHERE g.guild_id = $1 AND g.active = true
          LIMIT 1`,
        [String(guildId)]
      );
      const account = linked.rows[0] && linked.rows[0].connected_account_id;
      if (account && scopes.includes(account)) return { ok: true, merchantScope: account };
    }
    if (scopes.includes('platform')) return { ok: true, merchantScope: 'platform' };
    return { ok: true, merchantScope: scopes[0] };
  };
}

/* ---------------------------------------------------------------------------
 * Dispute service reshaping for the command renderers
 * ------------------------------------------------------------------------- */

function toSnakeCase(summary) {
  if (!summary || typeof summary !== 'object') return {};
  return {
    id: summary.caseId,
    provider: summary.provider,
    provider_dispute_id: summary.providerDisputeId,
    reason: summary.reason,
    provider_status: summary.providerStatus,
    lifecycle_stage: summary.lifecycleStage,
    amount_cents: summary.amountCents,
    currency: summary.currency,
    due_by: summary.dueBy,
    case_state: summary.caseState,
    response_cycle: summary.responseCycle,
    merchant_account: summary.merchantAccount
  };
}

function createConnectDisputeService({ disputeService, reviewUrlBase } = {}) {
  if (!disputeService) throw new TypeError('a dispute service is required');
  const base = typeof reviewUrlBase === 'string' && reviewUrlBase.startsWith('https://')
    ? reviewUrlBase : 'https://stockmarketloop.com/connect-review/';

  return {
    async listCases({ merchantScope } = {}) {
      const result = await disputeService.listCases({ merchantScope, limit: 50 });
      return (result && Array.isArray(result.cases) ? result.cases : []).map(toSnakeCase);
    },
    async caseDetail({ caseId, merchantScope } = {}) {
      const detail = await disputeService.caseDetail({ caseId, merchantScope });
      const checklist = detail && detail.checklist && Array.isArray(detail.checklist)
        ? detail.checklist
        : (detail && Array.isArray(detail.requestedEvidence) ? detail.requestedEvidence : []);
      return { caseRow: toSnakeCase(detail && detail.case), checklist };
    },
    async buildPacket({ caseId, merchantScope, requestedByDiscordUser } = {}) {
      return disputeService.buildPacket({ caseId, merchantScope, discordUserId: requestedByDiscordUser });
    },
    async issueReviewToken(input = {}) {
      const issued = await disputeService.issueReviewToken(input);
      return Object.assign({}, issued, {
        url: `${base}?t=${encodeURIComponent(String(issued && issued.token || ''))}`
      });
    },
    async summarizePayments(input = {}) {
      return typeof disputeService.summarizePayments === 'function'
        ? disputeService.summarizePayments(input) : [];
    },
    async summarizeSubscriptions(input = {}) {
      return typeof disputeService.summarizeSubscriptions === 'function'
        ? disputeService.summarizeSubscriptions(input) : [];
    },
    async customerHistory(input = {}) {
      return typeof disputeService.customerHistory === 'function'
        ? disputeService.customerHistory(input) : {};
    }
  };
}

/* ---------------------------------------------------------------------------
 * Role tools: enqueue only. The worker handlers reuse the existing engine.
 * ------------------------------------------------------------------------- */

function createConnectRoleTools({ pool, now } = {}) {
  if (!pool) throw new TypeError('a pg pool is required');
  const clock = now || Date.now;

  async function enqueue(intentType, keyPrefix, { guildId, merchantScope, requestedByDiscordUser }) {
    if (!guildId || !SNOWFLAKE_RE.test(String(guildId))) throw new TypeError('a guild id is required');
    if (!requestedByDiscordUser || !SNOWFLAKE_RE.test(String(requestedByDiscordUser))) {
      throw new TypeError('a requesting Discord user is required');
    }
    /* One request per user per guild per minute collapses double-clicks. */
    const sourceKey = `${keyPrefix}:${guildId}:${requestedByDiscordUser}:${minuteBucket(clock())}`;
    const result = await pool.query(
      `INSERT INTO billing_outbox (source_key, intent_type, payload)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (source_key) DO NOTHING`,
      [sourceKey, intentType, JSON.stringify({
        guildId: String(guildId),
        merchantScope: merchantScope || null,
        requestedByDiscordUser: String(requestedByDiscordUser)
      })]
    );
    return { queued: true, duplicate: result.rowCount !== 1, sourceKey };
  }

  return {
    enqueueRoleStatus: (input) => enqueue('connect_role_status', 'connect-role-status', input || {}),
    enqueueRoleReconcile: (input) => enqueue('connect_role_reconcile', 'connect-role-reconcile', input || {})
  };
}

function createConnectRoleHandlers({ pool, store, dm = null, now, logger } = {}) {
  if (!pool) throw new TypeError('a pg pool is required');
  if (!store) throw new TypeError('an evidence store is required');
  const clock = now || Date.now;
  const log = typeof logger === 'function' ? logger : () => {};

  async function guildGroup(guildId) {
    const found = await pool.query(
      `SELECT group_id FROM discord_guild_links WHERE guild_id = $1 AND active = true LIMIT 1`,
      [String(guildId)]
    );
    return found.rows[0] ? Number(found.rows[0].group_id) : null;
  }

  async function audit(action, payload, detail) {
    const at = new Date(clock()).toISOString();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await store.appendChained(client, {
        table: 'dispute_audit_log',
        scopeKey: 0,
        fields: {
          case_id: null,
          actor_kind: 'discord_user',
          actor_ref: String(payload.requestedByDiscordUser),
          action,
          detail: detail || {},
          source: 'discord',
          source_event_id: null,
          provider_account: String(payload.guildId),
          occurred_at: at,
          received_at: at,
          provenance: { merchant_scope: payload.merchantScope || null }
        }
      });
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async function notify(payload, content) {
    if (!dm) return;
    try {
      await dm.send(payload.requestedByDiscordUser, content);
    } catch (error) {
      log('warn', 'connect_role_dm_failed', { guildId: payload.guildId, error });
    }
  }

  async function roleStatus(payload) {
    const groupId = await guildGroup(payload.guildId);
    if (groupId == null) {
      await audit('role_status_unlinked_guild', payload, {});
      await notify(payload, 'Role status: this server is not linked to a StockMarketLoop group.');
      return { linked: false };
    }
    const subs = await pool.query(
      `SELECT status, COUNT(*)::int AS n FROM subscriptions WHERE group_id = $1 GROUP BY status ORDER BY status`,
      [groupId]
    );
    const grants = await pool.query(
      `SELECT g.state, COUNT(*)::int AS n
         FROM role_grants g JOIN subscriptions s ON s.id = g.subscription_id
        WHERE s.group_id = $1 AND g.target = 'discord_guild_role'
        GROUP BY g.state ORDER BY g.state`,
      [groupId]
    );
    const pending = await pool.query(
      `SELECT COUNT(*)::int AS n FROM billing_outbox
        WHERE intent_type = 'subscription_access_reconcile' AND status IN ('pending','failed','processing')`,
      []
    );
    const subLine = subs.rows.map((r) => `${r.status} ${r.n}`).join(', ') || 'none';
    const grantLine = grants.rows.map((r) => `${r.state} ${r.n}`).join(', ') || 'none';
    const detail = { group_id: groupId, subscriptions: subs.rows, discord_role_grants: grants.rows, reconcile_queue: pending.rows[0] ? pending.rows[0].n : 0 };
    await audit('role_status_reported', payload, detail);
    await notify(payload,
      `Role status for group ${groupId}: subscriptions [${subLine}]; Discord role grants [${grantLine}]; reconcile queue ${detail.reconcile_queue}.`);
    return { linked: true, ...detail };
  }

  async function roleReconcile(payload) {
    const groupId = await guildGroup(payload.guildId);
    if (groupId == null) {
      await audit('role_reconcile_unlinked_guild', payload, {});
      await notify(payload, 'Role reconciliation: this server is not linked to a StockMarketLoop group.');
      return { linked: false, queued: 0 };
    }
    const subs = await pool.query(
      `SELECT id, stripe_subscription_id FROM subscriptions
        WHERE group_id = $1 AND status = ANY($2)
        ORDER BY id ASC LIMIT $3`,
      [groupId, RECONCILE_STATUSES, MAX_RECONCILE_ROWS]
    );
    const bucket = dayBucket(clock());
    let queued = 0;
    for (const sub of subs.rows) {
      const result = await pool.query(
        `INSERT INTO billing_outbox (source_key, intent_type, payload)
         VALUES ($1, 'subscription_access_reconcile', $2::jsonb)
         ON CONFLICT (source_key) DO NOTHING`,
        [`connect-reconcile:${payload.guildId}:${sub.id}:${bucket}`, JSON.stringify({
          subscriptionId: Number(sub.id),
          stripeSubscriptionId: sub.stripe_subscription_id || null,
          reason: 'connect_role_reconcile',
          requestedByDiscordUser: String(payload.requestedByDiscordUser)
        })]
      );
      if (result.rowCount === 1) queued += 1;
    }
    await audit('role_reconcile_queued', payload, { group_id: groupId, candidates: subs.rows.length, queued, cap: MAX_RECONCILE_ROWS });
    await notify(payload,
      `Role reconciliation queued for group ${groupId}: ${queued} of ${subs.rows.length} subscriptions enqueued (at most one per subscription per day). Changes apply through the existing reconciler.`);
    return { linked: true, queued, candidates: subs.rows.length };
  }

  return {
    connect_role_status: roleStatus,
    connect_role_reconcile: roleReconcile
  };
}

module.exports = {
  MAX_RECONCILE_ROWS,
  createConnectAuthorizer,
  createConnectDisputeService,
  createConnectRoleHandlers,
  createConnectRoleTools,
  scopeOf,
  toSnakeCase
};
