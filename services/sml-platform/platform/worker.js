'use strict';

const { getConfig } = require('./config');
const { createDatabase } = require('./database');
const { log } = require('./logger');
const Stripe = require('stripe');
const {
  expireGrace,
  createOutboxWorker,
  createWordPressHandler,
  createStripeRecoveryHandler,
  createStripeRestoreHandler
} = require('./billing-worker');

async function main() {
  const config = getConfig();
  const database = createDatabase(config);
  const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null;
  const wordpress = createWordPressHandler({
    url: config.wordpressBillingBridgeUrl,
    secret: config.wordpressBillingBridgeSecret
  });
  const processOutbox = createOutboxWorker(database.pool, {
    loop_bucks_credit: wordpress,
    subscription_access_reconcile: wordpress,
    seller_recovery: createStripeRecoveryHandler(stripe),
    seller_restore: createStripeRestoreHandler(stripe)
  });
  let stopping = false;

  async function tick() {
    if (stopping) return;
    try {
      await database.health();
      const expired = await expireGrace(database.pool);
      let processed = 0;
      let failed = 0;
      for (let i = 0; i < 50; i += 1) {
        const outcome = await processOutbox();
        if (outcome === 'empty') break;
        if (outcome === 'processed') processed++;
        else failed++;
      }
      log('info', 'billing_worker_tick', { expired, processed, failed });
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

module.exports = { main };
