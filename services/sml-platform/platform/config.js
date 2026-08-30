'use strict';

function integer(value, fallback, minimum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function jsonObject(value, name) {
  if (!String(value || '').trim()) return Object.freeze({});
  let parsed;
  try { parsed = JSON.parse(value); } catch (_) { throw new Error(`${name} must be valid JSON`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${name} must be a JSON object`);
  for (const [key, entry] of Object.entries(parsed)) {
    if (!/^\d+:\d+$/.test(key) || !/^[0-9a-f-]{20,50}$/i.test(String(entry))) {
      throw new Error(`${name} contains an invalid group:plan mapping`);
    }
  }
  return Object.freeze(parsed);
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
    stripeSecretKey: String(env.STRIPE_SECRET_KEY || '').trim(),
    billingApiSecret: String(env.SML_BILLING_API_SECRET || '').trim(),
    wordpressBillingBridgeUrl: String(env.SML_WORDPRESS_BILLING_BRIDGE_URL || '').trim(),
    wordpressBillingBridgeSecret: String(env.SML_WORDPRESS_BILLING_BRIDGE_SECRET || '').trim(),
    upgradeChatClientId: String(env.UPGRADE_CHAT_CLIENT_ID || '').trim(),
    upgradeChatClientSecret: String(env.UPGRADE_CHAT_CLIENT_SECRET || '').trim(),
    upgradeChatPlanMap: jsonObject(env.UPGRADE_CHAT_PLAN_MAP_JSON, 'UPGRADE_CHAT_PLAN_MAP_JSON'),
    discordBotToken: String(env.DISCORD_BOT_TOKEN || '').trim()
  });
}

module.exports = { getConfig };
