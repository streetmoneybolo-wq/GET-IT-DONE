'use strict';

/* =============================================================================
 * dispute-runtime — the ONE place the dispute-evidence subsystem is assembled
 * from config for both processes (API server and worker).
 *
 * Fail-closed by construction: with SML_DISPUTE_EVIDENCE_ENABLED unset (or
 * without an encryption key) every surface is absent — routes answer 503
 * integration_unconfigured, the worker registers no handlers or sweeps, the
 * Stripe accept path is untouched. PayPal, the Connect bot, and Upgrade.Chat
 * each stay off until their own flags/credentials are present.
 *
 * server.js / worker.js only call createDisputeRuntime() and read its
 * fields, which keeps their hunks small (the main<->release merge risk noted
 * in SUBSYSTEM-MAPS) and makes the wiring unit-testable with fakes.
 * ========================================================================== */

const { createEvidenceStore } = require('./evidence-store');
const { createIdentityGraph } = require('./identity-graph');
const { createDisputeCases, STRIPE_DISPUTE_EVENT_TYPES } = require('./dispute-cases');
const { createStripeLedger } = require('./stripe-ledger');
const providerLimits = require('./provider-limits');
const evidenceEngine = require('./evidence-engine');
const packetGenerator = require('./packet-generator');
const { createDisputeService } = require('./dispute-service');
const { createStripeFilesClient } = require('./stripe-files');
const { createPayPalClient } = require('./paypal-client');
const { createPayPalWebhookHandler } = require('./paypal-webhook');
const { createUpgradeChatWebhookHandler } = require('./upgrade-chat-webhook');
const { createUpgradeChatReconciler } = require('./upgrade-chat-reconcile');
const { createDiscordInteractions } = require('./discord-interactions');
const {
  createConnectAuthorizer, createConnectDisputeService, createConnectRoleTools, createConnectRoleHandlers
} = require('./connect-adapter');
const { createDisputeNotifier, createDiscordDmClient } = require('./dispute-notifier');
const { createUsageConsumer } = require('./usage-consumer');

/**
 * Post-commit fan-out for accepted Stripe events. The existing
 * acceptStripeEvent transaction is untouched; the ledger projection and the
 * dispute case projection each run afterwards in their own transactions and
 * can never change the webhook response (the worker sweeps catch up on any
 * failure here). Duplicates are fanned out too: a redelivery after a crashed
 * post-commit step is the recovery path, and both projections are idempotent.
 */
function createStripeFanout({ acceptStripeEvent, ledger = null, disputeCases = null, logger = () => {} }) {
  if (typeof acceptStripeEvent !== 'function') throw new TypeError('acceptStripeEvent is required');
  if (!ledger && !disputeCases) return acceptStripeEvent;
  return async function acceptWithFanout(event) {
    const status = await acceptStripeEvent(event);
    const row = {
      event_id: event.id,
      event_type: event.type,
      event_created_at: new Date(Number(event.created) * 1000).toISOString(),
      payload: event
    };
    if (ledger) {
      try { await ledger.applyStripeEvent(row); } catch (error) {
        logger('warn', 'stripe_ledger_post_commit_failed', { eventId: event.id, eventType: event.type, error });
      }
    }
    if (disputeCases && STRIPE_DISPUTE_EVENT_TYPES.has(event.type)) {
      try { await disputeCases.applyStripeDisputeEvent(row); } catch (error) {
        logger('warn', 'dispute_case_post_commit_failed', { eventId: event.id, eventType: event.type, error });
      }
    }
    return status;
  };
}

function disabledRuntime(reason) {
  return Object.freeze({
    enabled: false,
    reason,
    store: null,
    graph: null,
    disputeCases: null,
    ledger: null,
    paypalClient: null,
    paypalWebhook: null,
    upgradeChatWebhook: null,
    disputeService: null,
    discordInteractions: null,
    notifier: null,
    usageConsumer: null,
    upgradeChatReconciler: null,
    outboxHandlers: Object.freeze({}),
    wrapStripeAccept: (accept) => accept,
    runSweeps: async () => null,
    recordAccessOutcome: async () => null,
    schemaVersion: null
  });
}

function createDisputeRuntime({
  config,
  pool,
  stripe = null,
  upgradeChat = null,
  wordpressNotify = null,
  logger = () => {},
  fetchImpl = globalThis.fetch,
  now = Date.now
} = {}) {
  if (!config) throw new TypeError('config is required');
  if (!pool) throw new TypeError('a pg pool is required');
  if (!config.disputeEvidenceEnabled) return disabledRuntime('flag_off');
  if (!Array.isArray(config.evidenceEncryptionKeys) || !config.evidenceEncryptionKeys.length) {
    logger('warn', 'dispute_evidence_disabled_missing_key', { env: 'SML_EVIDENCE_ENCRYPTION_KEY' });
    return disabledRuntime('missing_encryption_key');
  }

  const store = createEvidenceStore({ pool, keyList: config.evidenceEncryptionKeys });
  const graph = createIdentityGraph({ pool, store });
  const disputeCases = createDisputeCases({ pool, store, graph, limits: providerLimits, now });
  const ledger = createStripeLedger({ pool, store, graph, now, logger });

  const paypalClient = config.paypalEnabled && config.paypalClientId && config.paypalClientSecret
    ? createPayPalClient({ env: config.paypalEnv, clientId: config.paypalClientId, clientSecret: config.paypalClientSecret, fetchImpl, now })
    : null;
  const paypalWebhook = createPayPalWebhookHandler({ pool, config, paypalClient, disputeCases, store, now });
  const upgradeChatWebhook = createUpgradeChatWebhookHandler({ pool, config, upgradeChatClient: upgradeChat, store, logger, now });

  const stripeFiles = config.stripeSecretKey ? createStripeFilesClient({ apiKey: config.stripeSecretKey }) : null;
  const disputeService = createDisputeService({
    pool, store, graph, stripe, stripeFiles, paypalClient,
    limits: providerLimits, engine: evidenceEngine, packetGenerator,
    reviewRefSecret: config.connectReviewUrlSecret, now
  });

  const authorize = createConnectAuthorizer({ pool, store });
  const roleTools = createConnectRoleTools({ pool, now });
  const connectService = createConnectDisputeService({ disputeService, reviewUrlBase: config.connectReviewUrlBase });
  const discordInteractions = config.connectBotEnabled
    ? createDiscordInteractions({
        config: {
          discordConnectPublicKey: config.discordConnectPublicKey,
          discordConnectAppId: config.discordConnectAppId,
          reviewUrlBase: config.connectReviewUrlBase
        },
        pool, graph, store, authorize,
        disputeService: connectService,
        reconciler: roleTools,
        fetchImpl, now
      })
    : null;
  const dm = config.connectBotEnabled ? createDiscordDmClient({ token: config.discordConnectBotToken, fetchImpl }) : null;
  const notifier = createDisputeNotifier({ pool, store, graph, dm, wordpress: wordpressNotify, now, logger });
  const roleHandlers = createConnectRoleHandlers({ pool, store, dm, now, logger });
  const usageConsumer = createUsageConsumer({ pool, store, graph, now, logger });

  /* Upgrade.Chat reconciliation: read-only against the supplemental ledger,
     matching through the processor record ids Upgrade.Chat reports. Matches
     become candidate refs (never verified), conflicts become audit rows. */
  const upgradeChatReconciler = upgradeChat
    ? createUpgradeChatReconciler({
        pool,
        lookups: {
          async findTransactionByProcessorRecordId(provider, recordId) {
            const found = await pool.query(
              `SELECT id, identity_id, status FROM billing_transactions
                WHERE provider = $1 AND provider_transaction_id = $2 ORDER BY id DESC LIMIT 1`,
              [provider, String(recordId)]
            );
            return found.rows[0] || null;
          },
          async findSubscriptionByProcessorRecordId(provider, recordId) {
            const found = await pool.query(
              `SELECT bs.id, bs.identity_id, s.status
                 FROM billing_subscriptions bs
                 LEFT JOIN subscriptions s ON s.id = bs.engine_subscription_id
                WHERE bs.provider = $1 AND bs.provider_subscription_id = $2
                ORDER BY bs.id DESC LIMIT 1`,
              [provider, String(recordId)]
            );
            return found.rows[0] || null;
          }
        },
        async recordCandidateRef({ provider, refType, refValue, discordUserId, prov, citedRecords }) {
          if (!discordUserId) return null; // no person identifier to nominate: nothing to record
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            const identityId = await graph.recordCandidate(client, {
              provider, refType, refValue,
              discord_user_id: String(discordUserId),
              prov: Object.assign({}, prov, { provenance: Object.assign({}, prov.provenance, { cited_records: citedRecords }) })
            });
            await client.query('COMMIT');
            return identityId;
          } catch (error) {
            try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
            throw error;
          } finally {
            client.release();
          }
        },
        async recordContradiction({ code, detail, citedRecords, prov }) {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await store.appendChained(client, {
              table: 'dispute_audit_log',
              scopeKey: 0,
              fields: {
                case_id: null,
                actor_kind: 'system',
                actor_ref: null,
                action: `upgrade_chat_contradiction:${code}`,
                detail: Object.assign({}, detail, { cited_records: citedRecords }),
                source: 'upgrade_chat',
                source_event_id: prov.source_event_id || null,
                provider_account: null,
                occurred_at: prov.occurred_at,
                received_at: prov.received_at,
                provenance: prov.provenance || {}
              }
            });
            await client.query('COMMIT');
          } catch (error) {
            try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
            throw error;
          } finally {
            client.release();
          }
        },
        upgradeChatClient: upgradeChat,
        now,
        logger
      })
    : null;
  let upgradeChatCursor = 0;

  const outboxHandlers = Object.freeze({
    dispute_alert: notifier.disputeAlert,
    dispute_deadline: notifier.disputeDeadline,
    connect_role_status: roleHandlers.connect_role_status,
    connect_role_reconcile: roleHandlers.connect_role_reconcile
  });

  function wrapStripeAccept(acceptStripeEvent) {
    return createStripeFanout({ acceptStripeEvent, ledger, disputeCases, logger });
  }

  async function guarded(name, work) {
    try {
      return await work();
    } catch (error) {
      logger('warn', 'dispute_sweep_failed', { sweep: name, error });
      return null;
    }
  }

  /** Bounded, independent sweeps for one worker tick. Each failure is logged and isolated. */
  async function runSweeps() {
    const results = {};
    results.ledger = await guarded('stripe_ledger', () => ledger.sweep(50));
    results.stripeCatchUp = await guarded('stripe_dispute_catch_up', () => disputeCases.sweepStripeCatchUp(25));
    results.deadlines = await guarded('dispute_deadlines', async () => (await disputeCases.sweepDeadlines()).length);
    results.stuckSubmissions = await guarded('stuck_submissions', () => disputeCases.sweepStuckSubmissions({ stripe, paypalClient }));
    results.usage = await guarded('usage_consumer', () => usageConsumer.sweep(200));
    if (upgradeChatReconciler) {
      results.upgradeChat = await guarded('upgrade_chat_reconcile', async () => {
        const summary = await upgradeChatReconciler.sweep({ limit: 25, sinceId: upgradeChatCursor });
        upgradeChatCursor = summary.scanned === 0 ? 0 : summary.lastId; // wrap to re-scan once the ledger is exhausted
        return summary;
      });
    }
    return results;
  }

  /**
   * Evidence of the EXISTING role/access engine's decisions: after a
   * subscription_access_reconcile row succeeds, record the entitlement as
   * granted or revoked for the verified identity behind the engine's own
   * subscription row. Never throws into the caller — an evidence write must
   * not fail a role operation; the failure is logged (ids only).
   */
  async function recordAccessOutcome(payload, row) {
    if (!payload || !payload.userId) return null;
    const userId = Number(payload.userId);
    if (!Number.isSafeInteger(userId) || userId < 1) return null;
    const at = new Date(now()).toISOString();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const identityId = await graph.linkVerified(client, {
        provider: 'sml',
        refType: 'user',
        refValue: String(userId),
        sml_user_id: userId,
        wordpress_user_id: userId,
        via: 'engine_subscription_access_reconcile',
        prov: { source: 'sml_platform', source_event_id: row && row.source_key ? `access-reconcile:${row.source_key}` : null, provider_account: payload.guildId || null, occurred_at: at, received_at: at, provenance: {} }
      });
      const roleRefs = (payload.grants || []).map((grant) => `${grant.target}:${grant.roleRef}`);
      await store.appendRow(client, {
        table: 'entitlement_events',
        fields: {
          identity_id: identityId,
          group_id: payload.groupId != null ? Number(payload.groupId) : null,
          plan_ref: roleRefs.length ? roleRefs.join(',') : null,
          action: payload.active ? 'granted' : 'revoked',
          cause: payload.suspensionReason || payload.reason || 'subscription_access_reconcile',
          source: 'sml_platform',
          source_event_id: row && row.source_key ? `access-reconcile:${row.source_key}` : null,
          provider_account: payload.guildId || null,
          occurred_at: at,
          received_at: at,
          provenance: {
            subscription_id: payload.subscriptionId == null ? null : Number(payload.subscriptionId),
            dispute_suspended: !!payload.disputeSuspended,
            dispute_case_id: payload.disputeCaseId == null ? null : Number(payload.disputeCaseId)
          }
        }
      });
      await client.query('COMMIT');
      return identityId;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
      logger('warn', 'access_outcome_evidence_failed', { sourceKey: row && row.source_key, error });
      return null;
    } finally {
      client.release();
    }
  }

  async function schemaVersion() {
    const found = await pool.query('SELECT MAX(version) AS version FROM schema_migrations', []);
    return found.rows[0] && found.rows[0].version != null ? String(found.rows[0].version) : null;
  }

  return Object.freeze({
    enabled: true,
    reason: null,
    store,
    graph,
    disputeCases,
    ledger,
    paypalClient,
    paypalWebhook,
    upgradeChatWebhook,
    disputeService,
    discordInteractions,
    notifier,
    usageConsumer,
    upgradeChatReconciler,
    outboxHandlers,
    wrapStripeAccept,
    runSweeps,
    recordAccessOutcome,
    schemaVersion
  });
}

module.exports = { createDisputeRuntime, createStripeFanout };
