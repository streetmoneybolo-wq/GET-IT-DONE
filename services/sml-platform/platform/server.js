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
const paypalWebhookModule = require('./paypal-webhook');
const discordInteractionsModule = require('./discord-interactions');
const connectMigration = require('./connect-migration');

/* Dispute-evidence admin actions behind POST /v1/billing/disputes/{action}.
   Every action is HMAC-gated with SML_BILLING_API_SECRET (same scheme as the
   billing routes) and 503s while the dispute service is not enabled. */
const DISPUTE_ACTIONS = Object.freeze({
  list: 'listCases',
  detail: 'caseDetail',
  'build-packet': 'buildPacket',
  'issue-review-token': 'issueReviewToken',
  'redeem-review-token': 'redeemReviewToken',
  'approve-submit': 'approveAndSubmit',
  'record-policy': 'recordPolicy',
  'record-terms-version': 'recordTermsVersion',
  'record-consent': 'recordConsent',
  'link-admin': 'linkMerchantAdmin',
  admins: 'listMerchantAdmins',
  health: 'webhookHealth'
});

/*
 * Public, read-only adapter for the Reddit HUB.  Devvit cannot fetch the
 * StockMarketLoop personal domain directly, so the HUB calls this Render
 * service instead.  Nothing here accepts user input, exposes credentials, or
 * shares billing/dispute data.  A small process cache protects WordPress from
 * refresh bursts when a Reddit post is opened by multiple readers.
 */
const REDDIT_HUB_ORIGIN = 'https://stockmarketloop.com';
const REDDIT_HUB_CACHE_MS = 15_000;
let redditHubCache = { expiresAt: 0, payload: null };

function asHubObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asHubArray(value) {
  return Array.isArray(value) ? value : [];
}

function asHubText(value) {
  return typeof value === 'string' ? value : '';
}

function asHubNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

async function fetchRedditHubJson(path) {
  const response = await fetch(`${REDDIT_HUB_ORIGIN}${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'StockMarketLoop-Reddit-HUB/1.0' },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`upstream_${response.status}`);
  return response.json();
}

function sanitizeHubQuotes(value) {
  return asHubArray(asHubObject(value).rows).slice(0, 12).map((item) => {
    const row = asHubObject(item);
    return {
      symbol: asHubText(row.symbol || row.sym).toUpperCase().slice(0, 10),
      price: asHubNumber(row.price || row.last),
      change: asHubNumber(row.change || row.chg),
      changePct: asHubNumber(row.change_pct || row.chgPct),
      volume: asHubNumber(row.volume || row.v),
      bid: asHubNumber(row.bid) || undefined,
      ask: asHubNumber(row.ask) || undefined
    };
  }).filter((row) => /^[A-Z0-9.-]{1,10}$/.test(row.symbol));
}

function sanitizeHubScanner(value) {
  return asHubArray(asHubObject(value).rows).slice(0, 20).map((item) => {
    const row = asHubObject(item);
    return {
      symbol: asHubText(row.symbol || row.sym).toUpperCase().slice(0, 10),
      price: asHubNumber(row.price || row.last),
      changePct: asHubNumber(row.change_pct || row.chgPct),
      volume: asHubNumber(row.volume || row.v),
      postMarketPct: asHubNumber(row.postPct),
      quality: asHubText(row.quality).slice(0, 80)
    };
  }).filter((row) => /^[A-Z0-9.-]{1,10}$/.test(row.symbol));
}

function sanitizeHubNews(value) {
  return asHubArray(asHubObject(value).articles).slice(0, 24).map((item, index) => {
    const row = asHubObject(item);
    const author = asHubObject(row.author);
    return {
      id: asHubNumber(row.id) || index + 1,
      title: asHubText(row.title).slice(0, 240),
      excerpt: asHubText(row.excerpt).replace(/<[^>]*>/g, '').slice(0, 500),
      url: asHubText(row.url || row.link),
      image: asHubText(row.image || row.featured_image),
      author: asHubText(row.author_name || author.name || 'StockMarketLoop').slice(0, 120),
      publishedAt: asHubText(row.date || row.published_at)
    };
  }).filter((row) => row.title && row.url.startsWith('https://stockmarketloop.com/'));
}

async function getRedditHubBootstrap() {
  if (redditHubCache.payload && Date.now() < redditHubCache.expiresAt) return redditHubCache.payload;
  const symbols = 'SPY,QQQ,IWM,AAPL,NVDA,TSLA';
  const [quotes, movers, news] = await Promise.allSettled([
    fetchRedditHubJson(`/wp-json/sml-scanner/v1/quotes?symbols=${symbols}`),
    fetchRedditHubJson('/wp-json/sml-scanner/v1/live'),
    fetchRedditHubJson('/wp-json/sml-members/v1/news-feed')
  ]);
  const payload = {
    asOf: new Date().toISOString(),
    quotes: quotes.status === 'fulfilled' ? sanitizeHubQuotes(quotes.value) : [],
    movers: movers.status === 'fulfilled' ? sanitizeHubScanner(movers.value) : [],
    news: news.status === 'fulfilled' ? sanitizeHubNews(news.value) : [],
    sources: { authors: 19, brand: 'StockMarketLoop' }
  };
  redditHubCache = { expiresAt: Date.now() + REDDIT_HUB_CACHE_MS, payload };
  return payload;
}

async function handleDisputeRequest(request, response, options, methodName) {
  if (!contentTypeIsJson(request)) return sendJson(response, 415, { ok: false, error: 'content_type_required' });
  const body = await readRequestBody(request);
  if (!body.ok) return sendJson(response, body.status, { ok: false, error: body.error });
  const verified = verifySignature({
    secret: options.billingApiSecret,
    timestamp: request.headers['x-sml-timestamp'],
    signature: request.headers['x-sml-signature'],
    rawBody: body.rawBody,
    now: options.now()
  });
  if (!verified.ok) return sendJson(response, verified.status, { ok: false, error: verified.error });
  const service = options.disputeService;
  if (!service || typeof service[methodName] !== 'function') {
    return sendJson(response, 503, { ok: false, error: 'integration_unconfigured' });
  }
  let input;
  try {
    input = JSON.parse(body.rawBody);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid');
  } catch (_) {
    return sendJson(response, 400, { ok: false, error: 'invalid_json' });
  }
  try {
    const result = await service[methodName](input);
    sendJson(response, 200, { ok: true, ...(result && typeof result === 'object' ? result : { result }) });
  } catch (error) {
    const invalid = error instanceof TypeError;
    /* Only the action name and error class reach the log: inputs may carry
       review tokens and the service's own messages are neutral and PII-free. */
    options.logger(invalid ? 'warn' : 'error', 'dispute_request_failed', { action: methodName, error });
    sendJson(response, invalid ? 400 : 503, {
      ok: false,
      error: invalid ? 'invalid_request' : 'temporary_unavailable',
      ...(invalid ? { message: String(error.message).slice(0, 240) } : {})
    });
  }
}

/* Corporate-accounts admin actions behind POST /v1/corporate/{action}. Same
   HMAC scheme as billing; 503 until the corporate runtime is enabled. Refusals
   the operator must act on (cap reached, price moved, payment already used)
   are 409 with their code, distinct from malfunctions (503). */
async function handleCorporateRequest(request, response, options, action) {
  if (!contentTypeIsJson(request)) return sendJson(response, 415, { ok: false, error: 'content_type_required' });
  const body = await readRequestBody(request);
  if (!body.ok) return sendJson(response, body.status, { ok: false, error: body.error });
  const verified = verifySignature({
    secret: options.billingApiSecret,
    timestamp: request.headers['x-sml-timestamp'],
    signature: request.headers['x-sml-signature'],
    rawBody: body.rawBody,
    now: options.now()
  });
  if (!verified.ok) return sendJson(response, verified.status, { ok: false, error: verified.error });
  const runtime = options.corporate;
  if (!runtime || !runtime.enabled || !runtime.actions) {
    return sendJson(response, 503, { ok: false, error: 'integration_unconfigured' });
  }
  /* Own properties only: `actions` is a plain object, so a bare lookup would
     resolve /v1/corporate/constructor or /toString to Object.prototype methods. */
  const handler = Object.prototype.hasOwnProperty.call(runtime.actions, action) ? runtime.actions[action] : null;
  if (typeof handler !== 'function') return sendJson(response, 404, { ok: false, error: 'not_found' });
  let input;
  try {
    input = JSON.parse(body.rawBody);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid');
  } catch (_) {
    return sendJson(response, 400, { ok: false, error: 'invalid_json' });
  }
  try {
    const result = await handler(input);
    sendJson(response, 200, { ok: true, ...(result && typeof result === 'object' && !Array.isArray(result) ? result : { result }) });
  } catch (error) {
    const code = error && error.code;
    if (code === 'stripe_unconfigured') {
      return sendJson(response, 503, { ok: false, error: 'stripe_unconfigured' });
    }
    if (code && options.conflictCodes && options.conflictCodes.has(code)) {
      options.logger('warn', 'corporate_request_refused', { action, code });
      const extra = {};
      for (const key of ['remainingCents', 'netCents', 'alreadyRefunded']) {
        if (error[key] !== undefined) extra[key] = error[key];
      }
      return sendJson(response, 409, { ok: false, error: code, message: String(error.message).slice(0, 240), ...extra });
    }
    const invalid = error instanceof TypeError;
    options.logger(invalid ? 'warn' : 'error', 'corporate_request_failed', { action, error });
    sendJson(response, invalid ? 400 : 503, {
      ok: false,
      error: invalid ? 'invalid_request' : 'temporary_unavailable',
      ...(invalid ? { message: String(error.message).slice(0, 240) } : {})
    });
  }
}

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

/*
 * The Discord Activity is deliberately a thin, non-authenticated host. Discord
 * itself controls who may launch the Activity; the embedded dashboard remains
 * read-only through its academy=1 mode. No Discord token, user identity, or
 * market credential is exposed to this page.
 */
function academyActivityHtml() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Making Easy Money Academy — Live Chart Lab</title>
<style>html,body{width:100%;height:100%;margin:0;background:#070b10;color:#eef4f7;font-family:system-ui,sans-serif}main{height:100%;display:grid;grid-template-rows:auto 1fr}.bar{display:flex;align-items:center;gap:.65rem;padding:.55rem .8rem;background:#0d1720;border-bottom:1px solid #1f3942;font-size:.84rem}.dot{width:.5rem;height:.5rem;border-radius:999px;background:#00d084;box-shadow:0 0 12px #00d084}.frame{width:100%;height:100%;border:0;background:#070b10}</style>
</head><body><main><div class="bar"><i class="dot"></i><strong>Making Easy Money Academy</strong><span>Live Chart Lab · Educational use only</span></div><iframe class="frame" title="Live Chart Lab" src="https://stockmarketloop.com/analyst-dashboard/?academy=1&amp;activity=1" allow="fullscreen" referrerpolicy="strict-origin"></iframe></main></body></html>`;
}

function sendHtml(response, status, body) {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-src https://stockmarketloop.com; frame-ancestors https://discord.com https://*.discord.com https://*.discordapp.com; base-uri 'none'; form-action 'none'",
    'x-content-type-options': 'nosniff'
  });
  response.end(body);
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

async function handleConnectRequest(request, response, options, action) {
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
  if (!options.pool) {
    sendJson(response, 503, { ok: false, error: 'database_unconfigured' });
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
    const result = await action(options.pool, input);
    sendJson(response, 200, { ok: true, ...result });
  } catch (error) {
    const inputError = error instanceof TypeError;
    options.logger(inputError ? 'warn' : 'error', 'connect_migration_request_failed', { error });
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
  newsIngestToken = '',
  paypalWebhook = null, upgradeChatWebhook = null, discordInteractions = null,
  disputeService = null, schemaVersion = null, corporate = null, corporateConflictCodes = null,
  logger = log, now = Date.now }) {
  return http.createServer(async (request, response) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    const billingOptions = { billingApiSecret, stripe, pool, upgradeChat, upgradeChatPlanMap, logger, now };
    const connectOptions = { billingApiSecret, pool, logger, now };
    /* ---- dispute-evidence surfaces: every one 503s until configured ---- */
    if (request.method === 'POST' && path === '/v1/paypal/webhook') {
      if (!paypalWebhook) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const body = await readRequestBody(request, paypalWebhookModule.MAX_BODY_BYTES);
      if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
      await paypalWebhook.handle(request, response, body.rawBody);
      return;
    }
    if (request.method === 'POST' && path.startsWith('/v1/upgrade-chat/webhook/')) {
      if (!upgradeChatWebhook) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      await upgradeChatWebhook.handle(request, response);
      return;
    }
    if (request.method === 'POST' && path === '/v1/discord/interactions') {
      if (!discordInteractions) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const body = await readRequestBody(request, discordInteractionsModule.MAX_BODY_BYTES);
      if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
      await discordInteractions.handleRequest(request, response, body.rawBody);
      return;
    }
    if (request.method === 'POST' && path.startsWith('/v1/billing/disputes/')) {
      const methodName = DISPUTE_ACTIONS[path.slice('/v1/billing/disputes/'.length)];
      if (!methodName) { sendJson(response, 404, { ok: false, error: 'not_found' }); return; }
      await handleDisputeRequest(request, response, { billingApiSecret, disputeService, logger, now }, methodName);
      return;
    }
    if (request.method === 'POST' && path.startsWith('/v1/corporate/')) {
      const action = path.slice('/v1/corporate/'.length);
      await handleCorporateRequest(request, response,
        { billingApiSecret, corporate, conflictCodes: corporateConflictCodes, logger, now }, action);
      return;
    }
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
    if (request.method === 'POST' && path === '/v1/connect/migration/campaign') {
      await handleConnectRequest(request, response, connectOptions, connectMigration.upsertCampaign);
      return;
    }
    if (request.method === 'POST' && path === '/v1/connect/migration/mappings') {
      await handleConnectRequest(request, response, connectOptions, connectMigration.replacePlanMappings);
      return;
    }
    if (request.method === 'POST' && path === '/v1/connect/migration/memberships') {
      await handleConnectRequest(request, response, connectOptions, connectMigration.replaceMemberships);
      return;
    }
    if (request.method === 'POST' && path === '/v1/connect/migration/dashboard') {
      await handleConnectRequest(request, response, connectOptions, connectMigration.dashboard);
      return;
    }
    if (request.method === 'POST' && path === '/v1/connect/migration/event') {
      await handleConnectRequest(request, response, connectOptions, connectMigration.recordEvent);
      return;
    }
    if (request.method === 'GET' && path.startsWith('/v1/connect/public/')) {
      if (!pool) { sendJson(response, 503, { ok: false, error: 'database_unconfigured' }); return; }
      const slug = decodeURIComponent(path.slice('/v1/connect/public/'.length).replace(/\/$/, ''));
      try {
        const page = await connectMigration.publicHomepage(pool, slug, { recordView: true });
        if (!page) { sendJson(response, 404, { ok: false, error: 'not_found' }); return; }
        sendJson(response, 200, { ok: true, ...page });
      } catch (error) {
        const inputError = error instanceof TypeError;
        logger(inputError ? 'warn' : 'error', 'connect_public_request_failed', { error });
        sendJson(response, inputError ? 400 : 503, { ok: false, error: inputError ? 'invalid_request' : 'temporary_unavailable' });
      }
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

    if (request.method === 'GET' && path === '/v1/reddit-hub/bootstrap') {
      try {
        sendJson(response, 200, await getRedditHubBootstrap());
      } catch (error) {
        logger('warn', 'reddit_hub_bootstrap_failed', { error });
        sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
      }
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/') {
      sendHtml(response, 200, academyActivityHtml());
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
  const { createDisputeRuntime } = require('./dispute-runtime');
  const disputes = createDisputeRuntime({ config, pool: database.pool, stripe, upgradeChat, logger: log });
  const { createAcademyInteractions } = require('./academy/runtime');
  const academyInteractions = disputes.discordInteractions || createAcademyInteractions({ config, pool: database.pool });
  log('info', 'dispute_evidence_runtime', { enabled: disputes.enabled, reason: disputes.reason,
    paypal: !!disputes.paypalClient, connectBot: !!academyInteractions });
  const { createCorporateRuntime, CONFLICT_CODES } = require('./corporate-runtime');
  const corporate = createCorporateRuntime({ config, pool: database.pool, stripe, logger: log });
  log('info', 'corporate_runtime', { enabled: corporate.enabled, reason: corporate.reason });
  const schemaVersion = async () => {
    const found = await database.pool.query('SELECT MAX(version) AS version FROM schema_migrations', []);
    return found.rows[0] && found.rows[0].version != null ? String(found.rows[0].version) : null;
  };
  const server = createServer({
    checkDatabase: database.health,
    acceptWordPressEvent: database.acceptWordPressEvent,
    wordpressWebhookSecret: config.wordpressWebhookSecret,
    acceptStripeEvent: disputes.wrapStripeAccept(database.acceptStripeEvent),
    paypalWebhook: disputes.paypalWebhook,
    upgradeChatWebhook: disputes.upgradeChatWebhook,
    discordInteractions: academyInteractions,
    disputeService: disputes.disputeService,
    schemaVersion,
    stripeWebhookSecret: config.stripeWebhookSecret,
    billingApiSecret: config.billingApiSecret,
    upgradeChat,
    upgradeChatPlanMap: config.upgradeChatPlanMap,
    stripe,
    pool: database.pool,
    enqueueNewsArticle: database.enqueueNewsArticle,
    newsIngestToken: config.newsIngestToken,
    alertRouter,
    alertRouterSecret: config.alertRouterSecret,
    corporate,
    corporateConflictCodes: CONFLICT_CODES
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

module.exports = {
  createServer,
  sendJson,
  sendHtml,
  academyActivityHtml,
  handleBillingRequest,
  handleAlertRequest,
  handleDisputeRequest,
  handleConnectRequest,
  handleCorporateRequest,
  DISPUTE_ACTIONS
};
