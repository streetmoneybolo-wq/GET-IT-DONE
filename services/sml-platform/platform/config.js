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
    workerIntervalMs: integer(env.SML_WORKER_INTERVAL_MS, 60_000, 60_000),
    // This is deliberately optional at boot.  Until Render and WordPress both
    // have the same secret configured, the gateway fails closed with 503 rather
    // than accepting an unauthenticated request.
    wordpressWebhookSecret: String(env.SML_WORDPRESS_WEBHOOK_SECRET || '').trim(),
    // Also optional at boot and fail-closed at the webhook route. Render owns
    // the whsec_ value; it is never committed or logged.
    stripeWebhookSecret: String(env.SML_STRIPE_WEBHOOK_SECRET || '').trim()
  });
}

module.exports = { getConfig };
