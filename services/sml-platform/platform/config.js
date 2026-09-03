'use strict';

function integer(value, fallback, minimum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function decimal(value, fallback, minimum = 0) {
  const parsed = Number.parseFloat(value);
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
    discordBotToken: String(env.DISCORD_BOT_TOKEN || '').trim(),
    telegramBotToken: String(env.TELEGRAM_BOT_TOKEN || '').trim(),
    alertRouterSecret: String(env.SML_ALERT_ROUTER_SECRET || env.SML_BILLING_API_SECRET || '').trim(),
    alertPollIntervalMs: integer(env.SML_ALERT_POLL_INTERVAL_MS, 5_000, 1_000),
    newsIngestToken: String(env.SML_NEWS_INGEST_TOKEN || '').trim(),
    openaiApiKey: String(env.OPENAI_API_KEY || '').trim(),
    openaiModel: String(env.SML_NEWS_OPENAI_MODEL || 'gpt-5-mini').trim(),
    wordpressUrl: String(env.SML_WORDPRESS_URL || 'https://stockmarketloop.com').replace(/\/$/, ''),
    wordpressUsername: String(env.SML_WORDPRESS_USERNAME || '').trim(),
    wordpressAppPassword: String(env.SML_WORDPRESS_APP_PASSWORD || '').trim(),
    wordpressAuthorSlug: String(env.SML_WORDPRESS_AUTHOR_SLUG || 'stockmarketloop').trim(),
    wordpressAuthorName: String(env.SML_WORDPRESS_AUTHOR_NAME || 'SML NEWS').trim(),
    // --- dispute-evidence system (every surface fails closed while unset) ---
    disputeEvidenceEnabled: String(env.SML_DISPUTE_EVIDENCE_ENABLED || '').trim() === '1',
    evidenceEncryptionKeys: String(env.SML_EVIDENCE_ENCRYPTION_KEY || '').split(',').map((k) => k.trim()).filter(Boolean),
    paypalEnabled: String(env.SML_PAYPAL_ENABLED || '').trim() === '1',
    paypalClientId: String(env.SML_PAYPAL_CLIENT_ID || '').trim(),
    paypalClientSecret: String(env.SML_PAYPAL_CLIENT_SECRET || '').trim(),
    paypalEnv: String(env.SML_PAYPAL_ENV || 'sandbox').trim() === 'live' ? 'live' : 'sandbox',
    paypalWebhookId: String(env.SML_PAYPAL_WEBHOOK_ID || '').trim(),
    connectBotEnabled: String(env.SML_CONNECT_BOT_ENABLED || '').trim() === '1',
    discordConnectPublicKey: String(env.SML_DISCORD_CONNECT_PUBLIC_KEY || '').trim(),
    discordConnectAppId: String(env.SML_DISCORD_CONNECT_APP_ID || '').trim(),
    discordConnectBotToken: String(env.SML_DISCORD_CONNECT_BOT_TOKEN || '').trim(),
    connectReviewUrlSecret: String(env.SML_CONNECT_REVIEW_URL_SECRET || '').trim(),
    connectReviewUrlBase: String(env.SML_CONNECT_REVIEW_URL_BASE || 'https://stockmarketloop.com/connect-review/').trim(),
    upgradeChatWebhookPathToken: String(env.SML_UC_WEBHOOK_PATH_TOKEN || '').trim(),
    connectGuildIds: String(env.SML_CONNECT_GUILD_IDS || '').split(',').map((g) => g.trim()).filter(Boolean),
    // --- bounded Claude <-> Codex orchestration (disabled until explicitly enabled) ---
    aiOrchestratorEnabled: String(env.SML_AI_ORCHESTRATOR_ENABLED || '').trim() === '1',
    anthropicApiKey: String(env.ANTHROPIC_API_KEY || '').trim(),
    aiOpenAIModel: String(env.SML_AI_OPENAI_MODEL || 'gpt-5.4-mini').trim(),
    aiAnthropicModel: String(env.SML_AI_ANTHROPIC_MODEL || 'claude-sonnet-5').trim(),
    aiMaxOutputTokens: integer(env.SML_AI_MAX_OUTPUT_TOKENS, 3000, 256),
    aiMaxTasksPerTick: Math.min(3, integer(env.SML_AI_MAX_TASKS_PER_TICK, 1, 1)),
    aiVerifyHosts: String(env.SML_AI_VERIFY_HOSTS || 'sml-platform-api.onrender.com,stockmarketloop.com').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
    aiOpenAIInputUsdPerMillion: decimal(env.SML_AI_OPENAI_INPUT_USD_PER_MILLION, 0),
    aiOpenAIOutputUsdPerMillion: decimal(env.SML_AI_OPENAI_OUTPUT_USD_PER_MILLION, 0),
    aiAnthropicInputUsdPerMillion: decimal(env.SML_AI_ANTHROPIC_INPUT_USD_PER_MILLION, 0),
    aiAnthropicOutputUsdPerMillion: decimal(env.SML_AI_ANTHROPIC_OUTPUT_USD_PER_MILLION, 0)
  });
}

module.exports = { getConfig };
