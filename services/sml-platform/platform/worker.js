'use strict';

const { getConfig } = require('./config');
const { createDatabase } = require('./database');
const { log } = require('./logger');

async function main() {
  const config = getConfig();
  const database = createDatabase(config);
  let stopping = false;

  async function tick() {
    if (stopping) return;
    try {
      await database.health();
      log('info', 'worker_ready_for_jobs', { jobs: ['subscription_sweep', 'news_trigger_cycle'] });
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
