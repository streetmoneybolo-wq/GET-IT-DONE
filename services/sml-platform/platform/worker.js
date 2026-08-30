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

async function main() {
  const config = getConfig();
  const database = createDatabase(config);
  const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null;
  const wordpress = createWordPressHandler({
    url: config.wordpressBillingBridgeUrl,
    secret: config.wordpressBillingBridgeSecret
  });
  const discord = createDiscordAccessHandler(config.discordBotToken);
  const membershipAccess = async (payload, row) => {
    await wordpress(payload, row);
    if (discord) await discord(payload, row);
    else if ((payload.grants || []).some((g) => g.target === 'discord_guild_role')) {
      throw new Error('DISCORD_BOT_TOKEN is not configured');
    }
  };
  const processOutbox = createOutboxWorker(database.pool, {
    loop_bucks_credit: wordpress,
    subscription_access_reconcile: membershipAccess,
    subscription_notify: wordpress,
    cancel_external_subscription: wordpress,
    seller_recovery: createStripeRecoveryHandler(stripe),
    seller_restore: createStripeRestoreHandler(stripe)
  });
  let stopping = false;

  async function tick() {
    if (stopping) return;
    try {
      await database.health();
      const expired = await expireGrace(database.pool);
      const promoted = await promoteSubscriptionIntents(database.pool);
      let processed = 0;
      let failed = 0;
      for (let i = 0; i < 50; i += 1) {
        const outcome = await processOutbox();
        if (outcome === 'empty') break;
        if (outcome === 'processed') processed++;
        else failed++;
      }
      log('info', 'billing_worker_tick', { expired, promoted, processed, failed });
    } catch (error) {
      log('error', 'worker_database_unavailable', { error });
    }
  }

  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    log('info', 'worker_shutdown_started', { signal });
    await database.close();
    log('info', 'worker_shutdown_complete', { signal });
    process.exit(0);
  }

  await tick();
  const timer = setInterval(() => { void tick(); }, config.workerIntervalMs);
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
