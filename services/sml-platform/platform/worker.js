'use strict';

const { getConfig } = require('./config');
const { createDatabase } = require('./database');
const { log } = require('./logger');
const Stripe = require('stripe');
const {
  expireGrace,
  promoteSubscriptionIntents,
  createOutboxWorker,
  createWordPressHandler,
  createStripeRecoveryHandler,
  createStripeRestoreHandler
} = require('./billing-worker');
const { createSyncClient } = require('../group-subs/src/discord-sync');
const { createAlertRouter, createDiscordClient, createTelegramClient, createWordPressClient } = require('./alert-router');

function createDiscordAccessHandler(token, fetchImpl = fetch) {
  if (!token) return null;
  const client = createSyncClient({ token, fetchImpl });
  return async function discordAccess(payload) {
    const grants = (payload.grants || []).filter((g) => g.target === 'discord_guild_role');
    if (!grants.length) return;
    if (!payload.guildId || !payload.discordUserId) throw new Error('linked Discord server and member identity are required');
    const action = payload.active ? 'grant' : 'revoke';
    const result = await client.applyOperations(grants.map((g) => ({
      action,
      guildId: String(payload.guildId),
      userId: String(payload.discordUserId),
      roleId: String(g.roleRef),
      reason: payload.active ? 'StockMarketLoop membership active' : 'StockMarketLoop membership ended'
    })));
    if (result.retryable.length || result.permanentFailures.length || result.deferred) {
      throw new Error(`Discord membership sync incomplete: ${result.summary}`);
    }
  };
}
const { createArticleGenerator } = require('./article-generator');
const { createNewsPipeline } = require('./news-pipeline');
const { fetchSourceArticle } = require('./source-article');
const { createWordPressPublisher } = require('./wordpress-publisher');

async function main() {
  const config = getConfig();
  const database = createDatabase(config);
  const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null;
  const wordpress = createWordPressHandler({
    url: config.wordpressBillingBridgeUrl,
    secret: config.wordpressBillingBridgeSecret
  });
  const discord = createDiscordAccessHandler(config.discordBotToken);
  const discordAlerts = createDiscordClient(config.discordBotToken);
  const telegramAlerts = createTelegramClient(config.telegramBotToken);
  const wordpressAlerts = createWordPressClient({
    url: `${config.wordpressUrl}/wp-json/sml-alert-router/v1/deliver`,
    secret: config.wordpressBillingBridgeSecret
  });
  const alertRouter = createAlertRouter(database.pool, {
    discord: discordAlerts,
    telegram: telegramAlerts,
    wordpress: wordpressAlerts,
    logger: log
  });
  const membershipAccess = async (payload, row) => {
    await wordpress(payload, row);
    if (discord) await discord(payload, row);
    else if ((payload.grants || []).some((g) => g.target === 'discord_guild_role')) {
      throw new Error('DISCORD_BOT_TOKEN is not configured');
    }
  };
  /* ---- dispute-evidence stack (null while disabled; sweeps no-op) ---- */
  let disputeCases = null;
  let ucReconciler = null;
  let disputePayPalClient = null;
  if (config.disputeEvidenceEnabled && config.evidenceEncryptionKeys.length) {
    const { createEvidenceStore } = require('./evidence-store');
    const { createIdentityGraph } = require('./identity-graph');
    const { createDisputeCases } = require('./dispute-cases');
    const { createPayPalClient } = require('./paypal-client');
    const { createUpgradeChatReconciler } = require('./upgrade-chat-reconcile');
    const providerLimits = require('./provider-limits');
    const store = createEvidenceStore({ pool: database.pool, keyList: config.evidenceEncryptionKeys });
    const graph = createIdentityGraph({ pool: database.pool, store });
    disputePayPalClient = config.paypalEnabled && config.paypalClientId && config.paypalClientSecret
      ? createPayPalClient({ env: config.paypalEnv, clientId: config.paypalClientId, clientSecret: config.paypalClientSecret })
      : null;
    disputeCases = createDisputeCases({ pool: database.pool, store, graph, limits: providerLimits });
    if (config.upgradeChatClientId && config.upgradeChatClientSecret) {
      const { createUpgradeChatClient } = require('./upgrade-chat');
      ucReconciler = createUpgradeChatReconciler({
        pool: database.pool,
        store,
        graph,
        upgradeChatClient: createUpgradeChatClient({ clientId: config.upgradeChatClientId, clientSecret: config.upgradeChatClientSecret })
      });
    }
  }

  /* dispute_alert rows fan out to WordPress (bridge intent 'dispute_notify' —
     the 0.4.0 bridge dispatches it to the admin plugin's adapter) and, best-
     effort, to a Discord DM via the Connect bot. WordPress delivery is the
     success criterion; DM failures (closed DMs, no mutual guild) must never
     wedge the outbox row, so they only log. */
  const disputeAlert = wordpress ? async (payload, row) => {
    await wordpress(payload, { ...row, intent_type: 'dispute_notify' });
    if (config.discordConnectBotToken && payload && payload.discordUserId) {
      try {
        const open = await fetch('https://discord.com/api/v10/users/@me/channels', {
          method: 'POST',
          headers: { authorization: `Bot ${config.discordConnectBotToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ recipient_id: String(payload.discordUserId) })
        });
        if (open.ok) {
          const channel = await open.json();
          await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
            method: 'POST',
            headers: { authorization: `Bot ${config.discordConnectBotToken}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              content: String(payload.notice || 'A dispute case needs your attention on Stock Market Loop Connect.').slice(0, 1800),
              allowed_mentions: { parse: [] }
            })
          });
        }
      } catch (dmError) {
        log('warn', 'dispute_alert_dm_failed', { error: dmError });
      }
    }
  } : null;

  const processOutbox = createOutboxWorker(database.pool, {
    loop_bucks_credit: wordpress,
    subscription_access_reconcile: membershipAccess,
    subscription_notify: wordpress,
    cancel_external_subscription: wordpress,
    seller_recovery: createStripeRecoveryHandler(stripe),
    seller_restore: createStripeRestoreHandler(stripe),
    ...(disputeAlert ? { dispute_alert: disputeAlert } : {})
  });
  let stopping = false;
  let pollingAlerts = false;
  let pipeline = null;

  const missing = [
    ['OPENAI_API_KEY', config.openaiApiKey],
    ['SML_WORDPRESS_USERNAME', config.wordpressUsername],
    ['SML_WORDPRESS_APP_PASSWORD', config.wordpressAppPassword]
  ].filter((entry) => !entry[1]).map((entry) => entry[0]);

  if (!missing.length) {
    pipeline = createNewsPipeline({
      database,
      fetchSource: fetchSourceArticle,
      generateArticle: createArticleGenerator({ apiKey: config.openaiApiKey, model: config.openaiModel }),
      publisher: createWordPressPublisher(config),
      logger: log,
      workerId: `render-${process.pid}`
    });
  } else {
    log('warn', 'news_pipeline_disabled', { missing });
  }

  async function tick() {
    if (stopping) return;
    try {
      await database.health();
      const expired = await expireGrace(database.pool);
      const promoted = await promoteSubscriptionIntents(database.pool);
      let billingProcessed = 0;
      let billingFailed = 0;
      for (let i = 0; i < 50; i += 1) {
        const outcome = await processOutbox();
        if (outcome === 'empty') break;
        if (outcome === 'processed') billingProcessed++;
        else billingFailed++;
      }
      let newsJobsProcessed = 0;
      if (pipeline) {
        /* Drain a small bounded batch each minute. A flood cannot starve the
           process or create an unbounded OpenAI bill in one tick. */
        for (let i = 0; i < 3; i += 1) {
          if (!await pipeline.runOnce()) break;
          newsJobsProcessed += 1;
        }
      }
      let alertsProcessed = 0;
      for (let i = 0; i < 50; i += 1) {
        const outcome = await alertRouter.processOne();
        if (outcome === 'empty') break;
        alertsProcessed += 1;
      }
      if (disputeCases) {
        /* Bounded, isolated dispute sweeps: one failing sweep logs and never
           blocks the others or the rest of the tick. */
        const sweeps = [
          ['dispute_catch_up', () => disputeCases.sweepStripeCatchUp(25)],
          ['dispute_deadlines', () => disputeCases.sweepDeadlines(new Date())],
          ['dispute_stuck_submissions', () => disputeCases.sweepStuckSubmissions({ stripe, paypalClient: disputePayPalClient })]
        ];
        if (ucReconciler) sweeps.push(['upgrade_chat_reconcile', () => ucReconciler.sweep({ limit: 25 })]);
        for (const [name, run] of sweeps) {
          try { await run(); } catch (sweepError) { log('error', `${name}_failed`, { error: sweepError }); }
        }
      }
      log('info', 'worker_ready_for_jobs', {
        jobs: ['billing_outbox', 'subscription_sweep', 'news_article_pipeline', 'alert_router'],
        expired,
        promoted,
        billingProcessed,
        billingFailed,
        newsJobsProcessed,
        alertsProcessed
      });
    } catch (error) {
      log('error', 'worker_database_unavailable', { error });
    }
  }

  async function pollAlerts() {
    if (stopping || pollingAlerts) return;
    pollingAlerts = true;
    try {
      const [discordResult, telegramResult] = await Promise.all([
        alertRouter.pollDiscordOnce(), alertRouter.pollTelegramOnce()
      ]);
      if (discordResult.ingested || telegramResult.ingested) {
        log('info', 'alert_sources_polled', { discord: discordResult, telegram: telegramResult });
      }
    } catch (error) {
      log('error', 'alert_source_poll_failed', { error });
    } finally {
      pollingAlerts = false;
    }
  }

  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    clearInterval(alertTimer);
    log('info', 'worker_shutdown_started', { signal });
    await database.close();
    log('info', 'worker_shutdown_complete', { signal });
    process.exit(0);
  }

  await tick();
  await pollAlerts();
  const timer = setInterval(() => { void tick(); }, config.workerIntervalMs);
  const alertTimer = setInterval(() => { void pollAlerts(); }, config.alertPollIntervalMs);
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
}

if (require.main === module) {
  main().catch((error) => {
    log('error', 'worker_start_failed', { error });
    process.exit(1);
  });
}

module.exports = { main, createDiscordAccessHandler };
