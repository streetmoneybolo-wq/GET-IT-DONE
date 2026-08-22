'use strict';

function integer(value, fallback, minimum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function getConfig(env = process.env) {
  const databaseUrl = String(env.DATABASE_URL || '').trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  return Object.freeze({
    databaseUrl,
    databaseSsl: String(env.DATABASE_SSL || '').trim(),
    port: integer(env.PORT, 10000, 1),
    workerIntervalMs: integer(env.SML_WORKER_INTERVAL_MS, 60_000, 60_000)
  });
}

module.exports = { getConfig };
