'use strict';

function integer(value, fallback, minimum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function jsonObject(value, fallback = {}) {
  if (!String(value || '').trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch (_) { return fallback; }
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
    stripeWebhookSecret: String(env.SML_STRIPE_WEBHOOK_SECRET || '').trim(),
    newsIngestToken: String(env.SML_NEWS_INGEST_TOKEN || '').trim(),
    openaiApiKey: String(env.OPENAI_API_KEY || '').trim(),
    openaiModel: String(env.SML_NEWS_OPENAI_MODEL || 'gpt-5-mini').trim(),
    wordpressUrl: String(env.SML_WORDPRESS_URL || 'https://stockmarketloop.com').replace(/\/$/, ''),
    wordpressUsername: String(env.SML_WORDPRESS_USERNAME || '').trim(),
    wordpressAppPassword: String(env.SML_WORDPRESS_APP_PASSWORD || '').trim(),
    wordpressAuthorSlug: String(env.SML_WORDPRESS_AUTHOR_SLUG || 'stockmarketloop').trim(),
    wordpressAuthorName: String(env.SML_WORDPRESS_AUTHOR_NAME || 'SML NEWS').trim(),
    /* Map editorial desk keys to existing numeric WordPress user IDs. */
    wordpressEditorialAuthors: Object.freeze(jsonObject(env.SML_NEWSROOM_AUTHORS_JSON))
  });
}

module.exports = { getConfig, jsonObject };
