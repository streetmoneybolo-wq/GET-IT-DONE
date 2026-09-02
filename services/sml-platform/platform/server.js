'use strict';

const http = require('node:http');
const { getConfig } = require('./config');
const { createDatabase } = require('./database');
const { log } = require('./logger');
const { parseEvent, readRequestBody, verifySignature } = require('./wordpress-gateway');
const stripeWebhook = require('./stripe-webhook');
const Stripe = require('stripe');
const billingService = require('./billing-service');
const { createUpgradeChatClient } = require('./upgrade-chat');
const newsWebhook = require('./news-webhook');

async function handleAlertRequest(request, response, options, action) {
  if (!contentTypeIsJson(request)) return sendJson(response, 415, { ok: false, error: 'content_type_required' });
  const body = await readRequestBody(request);
  if (!body.ok) return sendJson(response, body.status, { ok: false, error: body.error });
  const verified = verifySignature({
    secret: options.alertRouterSecret,
    timestamp: request.headers['x-sml-timestamp'],
    signature: request.headers['x-sml-signature'],
    rawBody: body.rawBody,
    now: options.now()
  });
  if (!verified.ok) return sendJson(response, verified.status, { ok: false, error: verified.error });
  let input;
  try { input = JSON.parse(body.rawBody); } catch (_) { return sendJson(response, 400, { ok: false, error: 'invalid_json' }); }
  try {
    const result = await action(input);
    sendJson(response, result && result.status === 'duplicate' ? 200 : 202, { ok: true, ...result });
  } catch (error) {
    const invalid = error instanceof TypeError;
    options.logger(invalid ? 'warn' : 'error', 'alert_router_request_failed', { error });
    sendJson(response, invalid ? 422 : 503, { ok: false, error: invalid ? 'invalid_request' : 'temporary_unavailable',
      ...(invalid ? { message: String(error.message).slice(0, 240) } : {}) });
  }
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(payload);
}

function contentTypeIsJson(request) {
  return /^application\/json(?:\s*;|$)/i.test(String(request.headers['content-type'] || ''));
}

async function handleWordPressEvent(request, response, options) {
  if (!contentTypeIsJson(request)) {
    sendJson(response, 415, { ok: false, error: 'content_type_required' });
    return;
  }

  const body = await readRequestBody(request);
  if (!body.ok) {
    sendJson(response, body.status, { ok: false, error: body.error });
    return;
  }

  const verified = verifySignature({
    secret: options.wordpressWebhookSecret,
    timestamp: request.headers['x-sml-timestamp'],
    signature: request.headers['x-sml-signature'],
    rawBody: body.rawBody,
    now: options.now()
  });
  if (!verified.ok) {
    sendJson(response, verified.status, { ok: false, error: verified.error });
    return;
  }

  const parsed = parseEvent(body.rawBody);
  if (!parsed.ok) {
    sendJson(response, parsed.status, { ok: false, error: parsed.error });
    return;
  }

  try {
    const status = await options.acceptWordPressEvent(parsed.event);
    options.logger('info', 'wordpress_event_received', {
      eventId: parsed.event.eventId,
      eventType: parsed.event.eventType,
      status
    });
    sendJson(response, status === 'accepted' ? 202 : 200, {
      ok: true,
      eventId: parsed.event.eventId,
      status
    });
  } catch (error) {
    options.logger('error', 'wordpress_event_store_failed', {
      error,
      eventId: parsed.event.eventId,
      eventType: parsed.event.eventType
    });
    sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
  }
}

async function handleStripeWebhook(request, response, options) {
  /* The raw bytes are read and verified BEFORE anything parses them. There is
     no body-parser anywhere in this server, which is what keeps that true. */
  const body = await readRequestBody(request, stripeWebhook.MAX_BODY_BYTES);
  if (!body.ok) {
    sendJson(response, body.status, { ok: false, error: body.error });
    return;
  }

  const verified = stripeWebhook.verifySignature({
    secret: options.stripeWebhookSecret,
    header: request.headers['stripe-signature'],
    rawBody: body.rawBody,
    now: options.now()
  });
  if (!verified.ok) {
    options.logger('warn', 'stripe_signature_rejected', { error: verified.error });
    sendJson(response, verified.status, { ok: false, error: verified.error });
    return;
  }

  const parsed = stripeWebhook.parseEvent(body.rawBody);
  if (!parsed.ok) {
    sendJson(response, parsed.status, { ok: false, error: parsed.error });
    return;
  }

  try {
    const status = await options.acceptStripeEvent(parsed.event);
    options.logger('info', 'stripe_event_received', {
      eventId: parsed.event.id,
      eventType: parsed.event.type,
      account: parsed.event.account,
      status
    });
    /* 'duplicate' is a success: Stripe retries aggressively and the event store
       is unique on event id, so a replay is the system working, not an error. */
    sendJson(response, 200, { ok: true, eventId: parsed.event.id, status });
  } catch (error) {
    options.logger('error', 'stripe_event_store_failed', {
      error,
      eventId: parsed.event.id,
      eventType: parsed.event.type
    });
    /* 503 so Stripe retries. Swallowing this with a 200 would silently drop a
       payment event forever. */
    sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
  }
}

async function handleBillingRequest(request, response, options, action) {
  if (!contentTypeIsJson(request)) {
    sendJson(response, 415, { ok: false, error: 'content_type_required' });
    return;
  }
  const body = await readRequestBody(request);
  if (!body.ok) {
    sendJson(response, body.status, { ok: false, error: body.error });
    return;
  }
  const verified = verifySignature({
    secret: options.billingApiSecret,
    timestamp: request.headers['x-sml-timestamp'],
    signature: request.headers['x-sml-signature'],
    rawBody: body.rawBody,
    now: options.now()
  });
  if (!verified.ok) {
    sendJson(response, verified.status, { ok: false, error: verified.error });
    return;
  }
  if (!options.stripe) {
    sendJson(response, 503, { ok: false, error: 'stripe_unconfigured' });
    return;
  }
  let input;
  try {
    input = JSON.parse(body.rawBody);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid');
  } catch (_) {
    sendJson(response, 400, { ok: false, error: 'invalid_json' });
    return;
  }
  try {
    const result = await action(options.pool, options.stripe, input, options);
    sendJson(response, 201, { ok: true, ...result });
  } catch (error) {
    options.logger('error', 'billing_request_failed', { error });
    const inputError = error instanceof TypeError || /not found|not ready|consent|fee is not/.test(String(error.message));
    sendJson(response, inputError ? 400 : 503, {
      ok: false,
      error: inputError ? 'invalid_request' : 'temporary_unavailable',
      ...(inputError ? { message: String(error.message).slice(0, 240) } : {})
    });
  }
}

async function handleNewsWebhook(request, response, options) {
  if (!contentTypeIsJson(request)) {
    sendJson(response, 415, { ok: false, error: 'content_type_required' });
    return;
  }
  const verified = newsWebhook.verifyBearer(options.newsIngestToken, request.headers.authorization);
  if (!verified.ok) {
    sendJson(response, verified.status, { ok: false, error: verified.error });
    return;
  }
  const body = await readRequestBody(request, newsWebhook.MAX_BODY_BYTES);
  if (!body.ok) {
    sendJson(response, body.status, { ok: false, error: body.error });
    return;
  }
  const parsed = newsWebhook.parseNewsRequest(body.rawBody);
  if (!parsed.ok) {
    sendJson(response, parsed.status, { ok: false, error: parsed.error });
    return;
  }
  try {
    const result = await options.enqueueNewsArticle(parsed.job);
    options.logger('info', 'news_article_enqueued', {
      jobId: result.id,
      status: result.status,
      sourceUrlHash: parsed.job.sourceUrlHash
    });
    sendJson(response, result.status === 'accepted' ? 202 : 200, {
      ok: true,
      jobId: result.id,
      status: result.status,
      jobStatus: result.status === 'duplicate' ? result.status : 'queued'
    });
  } catch (error) {
    options.logger('error', 'news_article_enqueue_failed', { error, sourceUrlHash: parsed.job.sourceUrlHash });
    sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
  }
}

function createServer({ checkDatabase, acceptWordPressEvent, wordpressWebhookSecret = '',
  acceptStripeEvent, stripeWebhookSecret = '', billingApiSecret = '', stripe = null,
  pool = null, upgradeChat = null, upgradeChatPlanMap = {},
  alertRouter = null, alertRouterSecret = '',
  enqueueNewsArticle = async () => { throw new Error('not configured'); },
  newsIngestToken = '', schemaVersion = null, logger = log, now = Date.now }) {
  return http.createServer(async (request, response) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    const billingOptions = { billingApiSecret, stripe, pool, upgradeChat, upgradeChatPlanMap, logger, now };
    const alertOptions = { alertRouterSecret, logger, now };
    const alertAction = (method) => (input) => {
      if (!alertRouter || typeof alertRouter[method] !== 'function') throw new Error('alert router is not configured');
      return alertRouter[method](...(method === 'listRoutes' ? [input.groupId, input.ownerUserId] : [input]));
    };
    if (request.method === 'POST' && path === '/v1/alerts/routes/list') {
      await handleAlertRequest(request, response, alertOptions, (input) => alertAction('listRoutes')(input).then((routes) => ({ routes })));
      return;
    }
    if (request.method === 'POST' && path === '/v1/alerts/routes/replace') {
      await handleAlertRequest(request, response, alertOptions, alertAction('replaceRoutes'));
      return;
    }
    if (request.method === 'POST' && path === '/v1/alerts/ingest') {
      await handleAlertRequest(request, response, alertOptions, alertAction('ingest'));
      return;
    }
    if (request.method === 'POST' && path === '/v1/billing/loop-bucks/checkout') {
      await handleBillingRequest(request, response, billingOptions, billingService.createLoopBuckCheckout);
      return;
    }
    if (request.method === 'POST' && path === '/v1/billing/memberships/checkout') {
      await handleBillingRequest(request, response, billingOptions, billingService.createMembershipCheckout);
      return;
    }
    if (request.method === 'POST' && path === '/v1/billing/sellers/onboard') {
      await handleBillingRequest(request, response, billingOptions, billingService.createSellerOnboarding);
      return;
    }
    if (request.method === 'POST' && path === '/v1/billing/migrations/verify-renewal') {
      await handleBillingRequest(request, response, billingOptions, billingService.verifyImportedRenewal);
      return;
    }
    if (request.method === 'POST' && path === '/v1/billing/migrations/upgrade-chat') {
      await handleBillingRequest(request, response, billingOptions, billingService.prepareUpgradeChatMigration);
      return;
    }
    if (request.method === 'POST' && path === '/v1/stripe/webhook') {
      await handleStripeWebhook(request, response, { acceptStripeEvent, stripeWebhookSecret, logger, now });
      return;
    }

    if (request.method === 'POST' && path === '/v1/wordpress/events') {
      await handleWordPressEvent(request, response, { acceptWordPressEvent, wordpressWebhookSecret, logger, now });
      return;
    }

    if (request.method === 'POST' && path === '/v1/news/articles') {
      await handleNewsWebhook(request, response, { enqueueNewsArticle, newsIngestToken, logger });
      return;
    }

    if (request.method !== 'GET' || path !== '/health') {
      sendJson(response, 404, { ok: false, error: 'not_found' });
      return;
    }

    try {
      await checkDatabase();
      /* The applied schema version is public metadata that lets a deploy be
         verified without dashboard access; it reveals no data or secret. */
      let schema;
      if (typeof schemaVersion === 'function') {
        try { schema = await schemaVersion(); } catch (_) { schema = null; }
      }
      sendJson(response, 200, {
        ok: true, service: 'sml-platform-api', database: 'connected',
        ...(schema !== undefined ? { schema } : {})
      });
    } catch (error) {
      logger('error', 'health_database_unavailable', { error });
      sendJson(response, 503, { ok: false, service: 'sml-platform-api', database: 'unavailable' });
    }
  });
}

async function main() {
  const config = getConfig();
  const database = createDatabase(config);
  const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null;
  const upgradeChat = config.upgradeChatClientId && config.upgradeChatClientSecret
    ? createUpgradeChatClient({ clientId: config.upgradeChatClientId, clientSecret: config.upgradeChatClientSecret }) : null;
  const { createAlertRouter } = require('./alert-router');
  const alertRouter = createAlertRouter(database.pool);
  const schemaVersion = async () => {
    const found = await database.pool.query('SELECT MAX(version) AS version FROM schema_migrations', []);
    return found.rows[0] && found.rows[0].version != null ? String(found.rows[0].version) : null;
  };
  const server = createServer({
    schemaVersion,
    checkDatabase: database.health,
    acceptWordPressEvent: database.acceptWordPressEvent,
    wordpressWebhookSecret: config.wordpressWebhookSecret,
    acceptStripeEvent: database.acceptStripeEvent,
    stripeWebhookSecret: config.stripeWebhookSecret,
    billingApiSecret: config.billingApiSecret,
    upgradeChat,
    upgradeChatPlanMap: config.upgradeChatPlanMap,
    stripe,
    pool: database.pool,
    enqueueNewsArticle: database.enqueueNewsArticle,
    newsIngestToken: config.newsIngestToken,
    alertRouter,
    alertRouterSecret: config.alertRouterSecret
  });
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'shutdown_started', { signal });
    server.close(async () => {
      await database.close();
      log('info', 'shutdown_complete', { signal });
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  server.listen(config.port, () => log('info', 'api_started', { port: config.port }));
}

if (require.main === module) {
  main().catch((error) => {
    log('error', 'api_start_failed', { error });
    process.exit(1);
  });
}

module.exports = { createServer, sendJson, handleBillingRequest, handleAlertRequest };
