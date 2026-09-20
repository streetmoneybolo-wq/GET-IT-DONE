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
const { createAcademyAccess } = require('./academy-access');
const { createAcademyOAuth } = require('./academy-oauth');

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
const academyMarketCache = new Map();
const academyMarketInflight = new Map();
let academyScannerCache = { freshUntil: 0, staleUntil: 0, payload: null, inflight: null };
const academyDepthCache = new Map();
const academyDepthInflight = new Map();

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

/* The Activity runs on Discord's proxied origin, not Render's origin. Fetching
   the public SML feed in the browser would therefore fail the browser's CORS
   check. This narrow same-origin relay exposes only validated 5-minute candle
   data, has no credentials, and absorbs repeat opens with a short cache. */
async function getAcademyCandles(symbol, timeframe = '5m') {
  const safeSymbol = String(symbol || '').toUpperCase();
  if (!/^[A-Z0-9.:-]{1,10}$/.test(safeSymbol)) throw new TypeError('invalid_symbol');
  const safeTimeframe = String(timeframe || '5m');
  if (!/^(1m|3m|5m|10m|15m|30m|1h|2h|4h|1D|1W)$/.test(safeTimeframe)) throw new TypeError('invalid_timeframe');
  const cacheKey = `${safeSymbol}:${safeTimeframe}`;
  const cached = academyMarketCache.get(cacheKey);
  if (cached && cached.freshUntil > Date.now()) return cached.payload;
  if (academyMarketInflight.has(cacheKey)) return academyMarketInflight.get(cacheKey);
  const request = (async () => {
    try {
      const upstream = await fetch(`${REDDIT_HUB_ORIGIN}/wp-json/sml/v1/history?symbol=${encodeURIComponent(safeSymbol)}&tf=${encodeURIComponent(safeTimeframe)}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'StockMarketLoop-Academy-Activity/1.0' },
        signal: AbortSignal.timeout(7_000)
      });
      if (!upstream.ok) throw new Error(`academy_market_${upstream.status}`);
      const source = await upstream.json();
      /* The Activity draws at most 250 candles. Retaining a modest scrolling
       * window avoids parsing and serialising an unnecessarily large response. */
      const bars = Array.isArray(source?.bars) ? source.bars.slice(-600).map((bar) => ({
        t: Number(bar?.t), o: Number(bar?.o), h: Number(bar?.h), l: Number(bar?.l), c: Number(bar?.c), v: Number(bar?.v)
      })).filter((bar) => Number.isFinite(bar.t) && [bar.o, bar.h, bar.l, bar.c].every(Number.isFinite)) : [];
      if (!bars.length) throw new Error('academy_market_empty');
      const payload = { symbol: safeSymbol, tf: safeTimeframe, bars, asOf: Number(source?.asOf) || Date.now() };
      academyMarketCache.set(cacheKey, { freshUntil: Date.now() + 28_000, staleUntil: Date.now() + 300_000, payload });
      return payload;
    } catch (error) {
      /* A brief upstream slowdown should not blank or freeze an active lesson.
       * Stale prices are better than no chart, and expire after five minutes. */
      if (cached && cached.staleUntil > Date.now()) return { ...cached.payload, stale: true };
      throw error;
    } finally {
      academyMarketInflight.delete(cacheKey);
    }
  })();
  academyMarketInflight.set(cacheKey, request);
  return request;
}

async function getAcademyScanner() {
  const now = Date.now();
  if (academyScannerCache.payload && academyScannerCache.freshUntil > now) return academyScannerCache.payload;
  if (academyScannerCache.inflight) return academyScannerCache.inflight;
  academyScannerCache.inflight = (async () => {
    try {
      const upstream = await fetch(`${REDDIT_HUB_ORIGIN}/wp-json/sml-scanner/v1/live`, {
        headers: { Accept: 'application/json', 'User-Agent': 'StockMarketLoop-Academy-Activity/1.0' },
        signal: AbortSignal.timeout(7_000)
      });
      if (!upstream.ok) throw new Error(`academy_scanner_${upstream.status}`);
      const rows = sanitizeHubScanner(await upstream.json()).slice(0, 12);
      if (!rows.length) throw new Error('academy_scanner_empty');
      const payload = { rows, asOf: Date.now() };
      academyScannerCache = { freshUntil: Date.now() + 28_000, staleUntil: Date.now() + 300_000, payload, inflight: null };
      return payload;
    } catch (error) {
      if (academyScannerCache.payload && academyScannerCache.staleUntil > Date.now()) return { ...academyScannerCache.payload, stale: true };
      throw error;
    } finally {
      academyScannerCache.inflight = null;
    }
  })();
  return academyScannerCache.inflight;
}

async function getAcademyDepth(symbol) {
  const safeSymbol = String(symbol || '').toUpperCase();
  if (!/^[A-Z0-9.:-]{1,10}$/.test(safeSymbol)) throw new TypeError('invalid_symbol');
  const cached = academyDepthCache.get(safeSymbol);
  if (cached && cached.freshUntil > Date.now()) return cached.payload;
  if (academyDepthInflight.has(safeSymbol)) return academyDepthInflight.get(safeSymbol);
  const request = (async () => {
    try {
      const upstream = await fetch(`${REDDIT_HUB_ORIGIN}/wp-json/sml-scanner/v1/market-v2?symbol=${encodeURIComponent(safeSymbol)}&depth=10&ticks=0`, {
        headers: { Accept: 'application/json', 'User-Agent': 'StockMarketLoop-Academy-Activity/1.0' },
        signal: AbortSignal.timeout(7_000)
      });
      if (!upstream.ok) throw new Error(`academy_depth_${upstream.status}`);
      const source = await upstream.json();
      const clean = (rows) => Array.isArray(rows) ? rows.slice(0, 10).map((row, index) => ({
        level: Number(row?.level) || index + 1,
        price: Number(row?.price), size: Number(row?.size)
      })).filter((row) => Number.isFinite(row.price) && Number.isFinite(row.size) && row.size >= 0) : [];
      const payload = { symbol: safeSymbol, bids: clean(source?.book?.bids), asks: clean(source?.book?.asks), asOf: Number(source?.asof) || Date.now() };
      if (!payload.bids.length && !payload.asks.length) throw new Error('academy_depth_empty');
      academyDepthCache.set(safeSymbol, { freshUntil: Date.now() + 15_000, staleUntil: Date.now() + 120_000, payload });
      return payload;
    } catch (error) {
      if (cached && cached.staleUntil > Date.now()) return { ...cached.payload, stale: true };
      throw error;
    } finally {
      academyDepthInflight.delete(safeSymbol);
    }
  })();
  academyDepthInflight.set(safeSymbol, request);
  return request;
}

/*
 * The Discord Activity is deliberately a thin, non-authenticated host. Discord
 * itself controls who may launch the Activity; the embedded dashboard remains
 * read-only through its academy=1 mode. No Discord token, user identity, or
 * market credential is exposed to this page.
 */
function academyActivityHtml(initialMarket = {}) {
  const initialBars = JSON.stringify(Array.isArray(initialMarket.bars) ? initialMarket.bars.slice(-250) : []);
  const initialSymbol = JSON.stringify(String(initialMarket.symbol || 'SPY'));
  const initialScanner = JSON.stringify(Array.isArray(initialMarket.scanner?.rows) ? initialMarket.scanner.rows.slice(0, 12) : []);
  const initialDepth = JSON.stringify(initialMarket.depth && typeof initialMarket.depth === 'object' ? initialMarket.depth : { bids: [], asks: [] });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Making Easy Money Academy — Live Chart Lab</title>
<style>
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;background:#070b10;color:#eef4f7;font-family:system-ui,-apple-system,Segoe UI,sans-serif}main{height:100%;display:grid;grid-template-rows:auto auto auto 1fr}.bar{display:flex;align-items:center;gap:.65rem;padding:.55rem .8rem;background:#0d1720;border-bottom:1px solid #1f3942;font-size:.84rem}.dot{width:.5rem;height:.5rem;border-radius:999px;background:#00d084;box-shadow:0 0 12px #00d084}.status{margin-left:auto;color:#7f98a6;font:700 .7rem ui-monospace,monospace}.lesson-toggle{margin-left:auto;border:1px solid #00c47d;border-radius:6px;background:#092b23;color:#79efbd;font:800 .72rem system-ui;padding:6px 8px;cursor:pointer}.dashbar{display:flex;align-items:center;gap:10px;padding:6px 12px;background:#0a1118;border-bottom:1px solid #172a35;font:700 .69rem ui-monospace}.dashbrand{color:#00d084;letter-spacing:.06em}.academy-tag{padding:3px 6px;border-radius:4px;color:#94e9c4;background:#123d31}.market-state{margin-left:auto;color:#ffbf5d}.indices{display:flex;gap:7px;overflow:hidden;padding:7px 12px;background:#101923;border-bottom:1px solid #1c3140}.index{min-width:124px;border-right:1px solid #273947;padding-right:7px;font-size:.67rem;color:#94aab6}.index b{display:block;color:#eaf5f8;margin-bottom:2px}.index em{font-style:normal;color:#00d084}.shell{min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 220px}.chart{position:relative;min-height:0;padding:10px}.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:7px;padding:7px 9px;border:1px solid #1b3540;border-radius:8px 8px 0 0;background:#0a1118}.toolbar input{width:88px;background:#0d1720;border:1px solid #285061;border-radius:5px;color:#fff;padding:6px 8px;font-weight:800;text-transform:uppercase}.toolbar button{border:0;border-radius:5px;background:#00c47d;color:#042217;font-weight:800;padding:6px 9px;cursor:pointer}.toolbar small{color:#8295a3}.quote-chip{font:800 .7rem ui-monospace;color:#d7e9ef}.sell{color:#ff778b}.buy{color:#52e6ad}.intervals{display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-left:auto}.intervals button{padding:4px 5px;background:#162632;color:#9cb1bd}.intervals button.active{background:#00c47d;color:#042217}canvas{display:block;width:100%;height:calc(100% - 62px);min-height:260px;border:1px solid #1b3540;border-radius:0 0 8px 8px;background:linear-gradient(180deg,#0b141c,#070b10)}.side{border-left:1px solid #1b3540;background:#0a1118;padding:15px}.side h2{font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:#86a2b0;margin:0 0 12px}.quote{font:800 1.45rem ui-monospace,monospace}.change{font:700 .8rem ui-monospace,monospace;margin-top:3px}.meta{margin-top:18px;padding-top:14px;border-top:1px solid #1b3540;color:#8094a2;font-size:.75rem;line-height:1.55}.book{margin-top:14px;border-top:1px solid #1b3540;padding-top:12px}.book h3{font-size:.68rem;margin:0 0 7px;color:#86a2b0}.bookrow{display:flex;justify-content:space-between;font:700 .68rem ui-monospace;margin:5px 0}.bookrow .bidtxt{color:#52e6ad}.bookrow .asktxt{color:#ff778b}.lesson{position:fixed;z-index:20;top:48px;right:12px;width:min(390px,calc(100vw - 24px));max-height:calc(100vh - 60px);overflow:auto;display:none;padding:16px;border:1px solid #2c596a;border-radius:11px;background:#0b141c;box-shadow:0 16px 48px rgba(0,0,0,.55)}.lesson.open{display:block}.lesson small{color:#00d084;font-weight:800;letter-spacing:.09em}.lesson h2{font-size:1.08rem;margin:7px 0}.lesson p{font-size:.85rem;line-height:1.55;color:#c7d5dc}.scene{position:relative;height:105px;margin:12px 0;border:1px solid #25424f;border-radius:8px;background:radial-gradient(circle at 50% 50%,#163344,#091117 65%);overflow:hidden}.bid,.ask{position:absolute;padding:7px 9px;border-radius:6px;font:800 .75rem ui-monospace;animation:bob 1.8s ease-in-out infinite}.bid{left:15%;top:25px;background:#063c2c;color:#72f2b9}.ask{right:15%;bottom:22px;background:#4b1724;color:#ff91a2;animation-delay:-.8s}.trade{position:absolute;left:48%;top:43%;width:13px;height:13px;border-radius:50%;background:#ffd166;box-shadow:0 0 0 0 rgba(255,209,102,.7);animation:pulse 1.4s infinite}@keyframes bob{50%{transform:translateY(12px)}}@keyframes pulse{70%{box-shadow:0 0 0 18px rgba(255,209,102,0)}}.lesson-controls{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.lesson button{border:0;border-radius:6px;background:#00c47d;color:#042217;font-weight:800;padding:7px 9px;cursor:pointer}.lesson button.alt{background:#1c303b;color:#d9e8ee}.answers{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:9px}.answers button{background:#19303d;color:#e7f3f6;text-align:left}.answers button.good{background:#0b6a49}.answers button.bad{background:#6d2531}@media(max-width:720px){main{grid-template-rows:auto auto 1fr}.indices,.dashbar{display:none}.shell{grid-template-columns:1fr}.side{display:none}.chart{padding:7px}.bar span{display:none}.intervals{margin-left:0}}
</style><style>
.academy-scanner{margin-top:14px;border-top:1px solid #1b3540;padding-top:12px}.academy-scanner h3{font-size:.68rem;margin:0 0 7px;color:#86a2b0}.academy-scan-row{display:grid;grid-template-columns:1fr auto;gap:6px;padding:5px 0;border-bottom:1px solid rgba(42,66,78,.55);font:700 .68rem ui-monospace}.academy-scan-row small{grid-column:1/3;color:#8094a2;font-size:.59rem}.academy-positive{color:#52e6ad}.academy-negative{color:#ff778b}.academy-scan-empty{font-size:.7rem;color:#8094a2;padding:5px 0}
</style>
 </head><body><main><div class="bar"><i class="dot"></i><strong>Making Easy Money Academy</strong><span>Live Chart Lab · Educational use only</span><button class="lesson-toggle" id="lesson-toggle">Start Class</button><b class="status" id="status">CONNECTING</b></div><div class="dashbar"><b class="dashbrand">STOCKMARKETLOOP · ANALYST DASHBOARD</b><span class="academy-tag">ACADEMY MODE</span><span class="market-state">READ-ONLY TRAINING</span></div><div class="indices"><div class="index"><b>S&P 500</b><span>via SPY · <em id="idx-spy">—</em></span></div><div class="index"><b>NASDAQ</b><span>via QQQ · <em>LIVE</em></span></div><div class="index"><b>RUSSELL 2000</b><span>via IWM · <em>LIVE</em></span></div><div class="index"><b>MARKET BREADTH</b><span>Live dashboard tools</span></div></div><div class="shell"><section class="chart"><div class="toolbar"><input id="symbol" value="SPY" maxlength="10" aria-label="Ticker symbol"><button id="load">Load</button><span class="quote-chip sell">SELL <i id="sell">—</i></span><span class="quote-chip buy">BUY <i id="buy">—</i></span><small id="company">Live market data · Read-only</small><div class="intervals" aria-label="Chart intervals"><button data-tf="1m">1m</button><button data-tf="3m">3m</button><button data-tf="5m" class="active">5m</button><button data-tf="15m">15m</button><button data-tf="1h">1h</button><button data-tf="1D">1D</button></div></div><canvas id="chart" aria-label="Live interactive candlestick chart"></canvas></section><aside class="side"><h2 id="label">$SPY</h2><div class="quote" id="price">—</div><div class="change" id="change">Loading live market data</div><div class="book"><h3>TOP OF BOOK · ACADEMY VIEW</h3><div class="bookrow"><span class="bidtxt">BID</span><span id="bidbook">—</span></div><div class="bookrow"><span>SPREAD</span><span id="spread">—</span></div><div class="bookrow"><span class="asktxt">ASK</span><span id="askbook">—</span></div></div><div class="meta">Same dashboard layout and chart behavior as StockMarketLoop’s Analyst Dashboard. Academy mode intentionally excludes alerts, chirps, publishing, and trading actions.</div></aside></div></main><section class="lesson" id="lesson" aria-label="Academy lesson"><small>MODULE 1 · LESSON 1</small><h2 id="lesson-title">How price discovery works</h2><div class="scene"><span class="bid">BID $100.00</span><span class="trade"></span><span class="ask">ASK $100.05</span></div><p id="lesson-copy">A market brings buyers and sellers together. The bid is the price a buyer is offering; the ask is the price a seller is requesting. A trade occurs only when the two sides agree.</p><div class="answers" id="answers"><button data-answer="A">A. The bid is a guaranteed future price</button><button data-answer="B">B. The ask is what a seller currently requests</button><button data-answer="C">C. Every quote is a trading signal</button><button data-answer="D">D. The last trade predicts the next trade</button></div><p id="lesson-feedback" aria-live="polite"></p><div class="lesson-controls"><button id="read">Read Aloud</button><button class="alt" id="next-lesson">Next Concept</button><button class="alt" id="close-lesson">Back to Chart</button></div></section><script>
(()=>{const canvas=document.getElementById('chart'),ctx=canvas.getContext('2d'),sym=document.getElementById('symbol'),status=document.getElementById('status'),label=document.getElementById('label'),price=document.getElementById('price'),change=document.getElementById('change'),lesson=document.getElementById('lesson'),lessonTitle=document.getElementById('lesson-title'),lessonCopy=document.getElementById('lesson-copy'),feedback=document.getElementById('lesson-feedback'),answers=document.getElementById('answers');let bars=${initialBars},symbol=${initialSymbol},offset=0,scale=1,drag=null,slide=0;const slides=[['How price discovery works','A market brings buyers and sellers together. The bid is the price a buyer is offering; the ask is the price a seller is requesting. A trade occurs only when the two sides agree.'],['The spread is information','The difference between the bid and ask is called the spread. A narrower spread can indicate more active trading, while a wider spread can mean less liquidity or more uncertainty.'],['Read the chart in context','A candle records open, high, low, and close for a selected period. It describes what already occurred; it does not promise the next move.']];const esc=s=>String(s||'SPY').toUpperCase().replace(/[^A-Z0-9.:-]/g,'').slice(0,10)||'SPY';function renderSlide(){const item=slides[slide];lessonTitle.textContent=item[0];lessonCopy.textContent=item[1];feedback.textContent='';answers.style.display=slide===0?'grid':'none';document.getElementById('next-lesson').textContent=slide===slides.length-1?'Restart Class':'Next Concept'}function resize(){const r=canvas.getBoundingClientRect(),d=devicePixelRatio||1;canvas.width=Math.round(r.width*d);canvas.height=Math.round(r.height*d);ctx.setTransform(d,0,0,d,0);draw()}function draw(){const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;ctx.clearRect(0,0,w,h);if(!bars.length){ctx.fillStyle='#7f98a6';ctx.font='13px system-ui';ctx.fillText('Live market data is temporarily unavailable.',20,32);return}const pad={l:12,r:64,t:18,b:24},pw=w-pad.l-pad.r,ph=h-pad.t-pad.b,n=Math.max(12,Math.min(bars.length,Math.floor(105/scale))),end=Math.max(n,Math.min(bars.length,bars.length-offset)),view=bars.slice(end-n,end);let lo=Math.min(...view.map(b=>+b.l)),hi=Math.max(...view.map(b=>+b.h));if(hi===lo){hi+=1;lo-=1}const y=v=>pad.t+(hi-v)/(hi-lo)*ph;ctx.strokeStyle='rgba(116,153,170,.14)';ctx.lineWidth=1;for(let i=0;i<5;i++){const yy=pad.t+ph*i/4;ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(pad.l+pw,yy);ctx.stroke();ctx.fillStyle='#718694';ctx.font='10px ui-monospace';ctx.fillText((hi-(hi-lo)*i/4).toFixed(2),pad.l+pw+7,yy+3)}const step=pw/view.length;view.forEach((b,i)=>{const x=pad.l+(i+.5)*step,up=+b.c>=+b.o,color=up?'#00d084':'#ff5470';ctx.strokeStyle=color;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(x,y(+b.h));ctx.lineTo(x,y(+b.l));ctx.stroke();const top=y(Math.max(+b.o,+b.c)),bottom=y(Math.min(+b.o,+b.c));ctx.fillRect(x-step*.31,top,Math.max(1,step*.62),Math.max(1,bottom-top))});ctx.fillStyle='#90a5b3';ctx.font='10px ui-monospace';ctx.fillText('LIVE · 5M',pad.l,h-8)}function setQuote(){if(!bars.length){status.textContent='RETRY';change.textContent='Live data is temporarily unavailable';change.style.color='#ffb454';return}const last=bars[bars.length-1],prev=bars[bars.length-2]||last,delta=+last.c-+prev.c,pct=prev.c?(delta/+prev.c)*100:0;sym.value=symbol;label.textContent='$'+symbol;price.textContent='$'+Number(last.c).toFixed(2);change.textContent=(delta>=0?'▲ +':'▼ ')+delta.toFixed(2)+' ('+pct.toFixed(2)+'%)';change.style.color=delta>=0?'#00d084':'#ff5470';status.textContent='LIVE'}function load(){const s=esc(sym.value);location.assign(location.pathname+'?symbol='+encodeURIComponent(s))}document.getElementById('load').onclick=load;sym.addEventListener('keydown',e=>{if(e.key==='Enter')load()});document.getElementById('lesson-toggle').onclick=()=>{lesson.classList.add('open');renderSlide()};document.getElementById('close-lesson').onclick=()=>lesson.classList.remove('open');document.getElementById('next-lesson').onclick=()=>{slide=(slide+1)%slides.length;renderSlide()};document.getElementById('read').onclick=()=>{if(!('speechSynthesis'in window)){feedback.textContent='Read-aloud is unavailable in this Discord browser.';return}speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(lessonTitle.textContent+'. '+lessonCopy.textContent);utterance.rate=.93;speechSynthesis.speak(utterance)};answers.onclick=e=>{const target=e.target.closest('button[data-answer]');if(!target)return;const correct=target.dataset.answer==='B';answers.querySelectorAll('button').forEach(button=>button.className='');target.classList.add(correct?'good':'bad');feedback.textContent=correct?'Correct. The ask is the price a seller currently requests.':'Not quite. The correct answer is B: the ask is what a seller currently requests.'};canvas.addEventListener('wheel',e=>{e.preventDefault();scale=Math.max(.7,Math.min(4,scale*(e.deltaY>0?.86:1.16)));draw()},{passive:false});canvas.addEventListener('pointerdown',e=>{drag=e.clientX;canvas.setPointerCapture(e.pointerId)});canvas.addEventListener('pointermove',e=>{if(drag===null)return;offset=Math.max(0,Math.min(Math.max(0,bars.length-12),offset+Math.round((e.clientX-drag)/8)));drag=e.clientX;draw()});canvas.addEventListener('pointerup',()=>drag=null);new ResizeObserver(resize).observe(canvas);setQuote();draw();setInterval(()=>location.reload(),30000)})();
</script><script>
(()=>{const q=new URLSearchParams(location.search),tf=q.get('tf')||'5m',price=document.getElementById('price'),company=document.getElementById('company'),sell=document.getElementById('sell'),buy=document.getElementById('buy'),bid=document.getElementById('bidbook'),ask=document.getElementById('askbook'),spread=document.getElementById('spread'),idx=document.getElementById('idx-spy'),symbol=document.getElementById('symbol');function quote(){const value=Number(String(price.textContent).replace(/[^0-9.]/g,''));if(!Number.isFinite(value)||value<=0)return;const tick=Math.max(.01,value*.0001),bidValue=(value-tick).toFixed(2),askValue=(value+tick).toFixed(2);sell.textContent=bidValue;buy.textContent=askValue;bid.textContent=bidValue;ask.textContent=askValue;spread.textContent=(tick*2).toFixed(4);company.textContent='Live '+tf+' candles · Academy read-only';idx.textContent='LIVE';document.querySelectorAll('[data-tf]').forEach(button=>button.classList.toggle('active',button.dataset.tf===tf))}document.querySelectorAll('[data-tf]').forEach(button=>button.onclick=()=>location.assign(location.pathname+'?symbol='+encodeURIComponent(symbol.value)+'&tf='+encodeURIComponent(button.dataset.tf)));quote()})();
</script><script>
/* Preserve the selected timeframe when a learner changes tickers. This runs
   after the compact chart host so it intentionally replaces only its loader. */
(()=>{const symbol=document.getElementById('symbol'),load=document.getElementById('load'),timeframe=()=>new URLSearchParams(location.search).get('tf')||'5m',go=()=>{const clean=String(symbol.value||'SPY').toUpperCase().replace(/[^A-Z0-9.:-]/g,'').slice(0,10)||'SPY';location.assign(location.pathname+'?symbol='+encodeURIComponent(clean)+'&tf='+encodeURIComponent(timeframe()))};load.onclick=go;symbol.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.stopImmediatePropagation();go()}},true)})();
</script><script>
(()=>{const side=document.querySelector('.side'),rows=${initialScanner};if(!side)return;const panel=document.createElement('section');panel.className='academy-scanner';const heading=document.createElement('h3');heading.textContent='LIVE MARKET SCANNER';panel.appendChild(heading);if(!rows.length){const empty=document.createElement('div');empty.className='academy-scan-empty';empty.textContent='Scanner data is temporarily unavailable.';panel.appendChild(empty)}else{rows.forEach(row=>{const item=document.createElement('div'),symbol=document.createElement('span'),move=document.createElement('span'),detail=document.createElement('small'),pct=Number(row.changePct)||0;item.className='academy-scan-row';symbol.textContent='$'+String(row.symbol||'').slice(0,10);move.className=pct>=0?'academy-positive':'academy-negative';move.textContent=(pct>=0?'▲ +':'▼ ')+pct.toFixed(2)+'%';detail.textContent='Last $'+Number(row.price||0).toFixed(2)+' · Vol '+Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(Number(row.volume)||0);item.append(symbol,move,detail);panel.appendChild(item)})}side.insertBefore(panel,side.querySelector('.meta'))})();
</script><script>
(()=>{const side=document.querySelector('.side'),depth=${initialDepth};if(!side)return;const style=document.createElement('style');style.textContent='.academy-depth{margin-top:14px;border-top:1px solid #1b3540;padding-top:12px}.academy-depth h3{font-size:.68rem;margin:0 0 7px;color:#86a2b0}.academy-depth-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.academy-depth-col b{display:block;font:800 .58rem ui-monospace;margin-bottom:4px}.academy-depth-bid{color:#52e6ad}.academy-depth-ask{color:#ff778b}.academy-depth-row{display:flex;justify-content:space-between;gap:4px;padding:3px 0;border-bottom:1px solid rgba(42,66,78,.45);font:.58rem ui-monospace}.academy-depth-row span:last-child{color:#9db2bd}.academy-depth-empty{font-size:.7rem;color:#8094a2;padding:5px 0}';document.head.appendChild(style);const panel=document.createElement('section');panel.className='academy-depth';const title=document.createElement('h3');title.textContent='LEVEL 2 DEPTH · LIVE';panel.appendChild(title);const bids=Array.isArray(depth.bids)?depth.bids:[],asks=Array.isArray(depth.asks)?depth.asks:[];if(!bids.length&&!asks.length){const empty=document.createElement('div');empty.className='academy-depth-empty';empty.textContent='Level 2 is temporarily unavailable.';panel.appendChild(empty)}else{const grid=document.createElement('div');grid.className='academy-depth-grid';[['BID',bids,'academy-depth-bid'],['ASK',asks,'academy-depth-ask']].forEach(([name,rows,color])=>{const col=document.createElement('div');col.className='academy-depth-col';const head=document.createElement('b');head.className=color;head.textContent=name;col.appendChild(head);rows.slice(0,5).forEach(row=>{const item=document.createElement('div'),p=document.createElement('span'),s=document.createElement('span');item.className='academy-depth-row';p.textContent=Number(row.price).toFixed(2);s.textContent=Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(Number(row.size));item.append(p,s);col.appendChild(item)});grid.appendChild(col)});panel.appendChild(grid)}side.insertBefore(panel,side.querySelector('.meta'))})();
</script></body></html>`.replace('setInterval(()=>location.reload(),30000)', "let refreshPending=false;const keepWarm=async()=>{if(document.hidden||refreshPending)return;refreshPending=true;try{const query=new URLSearchParams(location.search),symbol=query.get('symbol')||'SPY',tf=query.get('tf')||'5m';const response=await fetch('/academy-activity/market?symbol='+encodeURIComponent(symbol)+'&tf='+encodeURIComponent(tf),{cache:'no-store'});document.getElementById('status').textContent=response.ok?'LIVE':'RETRY'}catch{document.getElementById('status').textContent='RETRY'}finally{refreshPending=false}};setInterval(keepWarm,15000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)keepWarm()})").replace('</body></html>', `<script>(()=>{const bar=document.querySelector('.bar'),state=document.querySelector('.market-state');if(!bar||!state)return;const unlock=document.createElement('button');unlock.type='button';unlock.id='academy-unlock';unlock.className='lesson-toggle';unlock.textContent='Unlock Academy Tools';bar.insertBefore(unlock,document.getElementById('status'));let session='';const show=(text,good)=>{state.textContent=text;state.style.color=good?'#52e6ad':'#ffbf5d'};const validate=async()=>{const response=await fetch('/academy-activity/session',{headers:{authorization:'Bearer '+session},cache:'no-store'});if(!response.ok)throw new Error('not_authorized');show('OPTIONS + EARNINGS UNLOCKED',true);unlock.textContent='Academy Tools Unlocked';unlock.disabled=true};window.addEventListener('message',async event=>{if(event.origin!==location.origin||!event.data||event.data.type!=='sml-academy-authorized')return;if(event.data.error){show('ACADEMY ROLE REQUIRED',false);return}session=String(event.data.sessionToken||'');try{await validate()}catch(_){show('AUTHORIZATION EXPIRED',false)}});unlock.onclick=()=>{show('CHECKING DISCORD ROLE…',false);const popup=window.open('/academy-activity/authorize','sml-academy-oauth','popup=yes,width=520,height=640');if(!popup){show('ALLOW POPUPS TO UNLOCK',false)}}})()</script></body></html>`).replace('</body></html>', `<script>(()=>{const shell=document.querySelector('.shell');if(!shell)return;const query=new URLSearchParams(location.search),symbol=(query.get('symbol')||'SPY').toUpperCase().replace(/[^A-Z0-9.:-]/g,'').slice(0,10)||'SPY';const frame=document.createElement('iframe');frame.className='academy-dashboard-frame';frame.title='StockMarketLoop Academy Chart Lab';frame.src='https://stockmarketloop.com/analyst-dashboard/?academy=1&symbol='+encodeURIComponent(symbol);frame.allow='fullscreen';frame.referrerPolicy='origin';shell.replaceChildren(frame);const style=document.createElement('style');style.textContent='.shell{display:block!important;min-height:0!important;padding:0!important}.academy-dashboard-frame{display:block;width:100%;height:100%;min-height:720px;border:0;background:#06090d}.chart,.side{display:none!important}@media(max-width:720px){.academy-dashboard-frame{min-height:640px}}';document.head.appendChild(style)})()</script></body></html>`);
}

function sendHtml(response, status, body) {
  /* Academy Activity replaces the legacy canvas with the real dashboard.
     Avoid attaching its obsolete ResizeObserver during that handoff. */
  const safeBody = typeof body === 'string'
    ? body.replace('new ResizeObserver(resize).observe(canvas);', '')
    : body;
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(safeBody),
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-src https://stockmarketloop.com; frame-ancestors https://discord.com https://*.discord.com https://*.discordapp.com; base-uri 'none'; form-action 'none'",
    'x-content-type-options': 'nosniff'
  });
  response.end(safeBody);
}

function sendRedirect(response, location) {
  response.writeHead(302, { location, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end();
}

function academyAuthorizationCompleteHtml({ ok, sessionToken = '', error = '' }) {
  const payload = JSON.stringify(ok ? { type: 'sml-academy-authorized', sessionToken } : { type: 'sml-academy-authorized', error: String(error || 'authorization_failed') });
  return `<!doctype html><meta charset="utf-8"><title>Academy authorization</title><body><p>${ok ? 'Academy access confirmed. You may close this window.' : 'Academy access was not granted. You may close this window.'}</p><script>if(window.opener){window.opener.postMessage(${payload},location.origin);window.close()}</script></body>`;
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
  paypalWebhook = null, upgradeChatWebhook = null, discordInteractions = null, disputeDiscordInteractions = null,
  disputeService = null, schemaVersion = null, corporate = null, corporateConflictCodes = null,
  academyAccess = null, academyOAuth = null, academyDataBridge = null,
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
    if (request.method === 'POST' && path === '/v1/discord/disputes/interactions') {
      if (!disputeDiscordInteractions) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const body = await readRequestBody(request, discordInteractionsModule.MAX_BODY_BYTES);
      if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
      await disputeDiscordInteractions.handleRequest(request, response, body.rawBody);
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
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      const symbol = params.get('symbol') || 'SPY';
      const timeframe = params.get('tf') || '5m';
      const [market, scanner, depth] = await Promise.allSettled([getAcademyCandles(symbol, timeframe), getAcademyScanner(), getAcademyDepth(symbol)]);
      if (market.status !== 'fulfilled') logger('warn', 'academy_activity_initial_market_failed', { error: market.reason });
      if (scanner.status !== 'fulfilled') logger('warn', 'academy_activity_scanner_failed', { error: scanner.reason });
      if (depth.status !== 'fulfilled') logger('warn', 'academy_activity_depth_failed', { error: depth.reason });
      const activity = market.status === 'fulfilled' ? market.value : { symbol, tf: timeframe, bars: [] };
      activity.scanner = scanner.status === 'fulfilled' ? scanner.value : { rows: [] };
      activity.depth = depth.status === 'fulfilled' ? depth.value : { bids: [], asks: [] };
      sendHtml(response, 200, academyActivityHtml(activity));
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/market') {
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      const symbol = params.get('symbol');
      const timeframe = params.get('tf') || '5m';
      try {
        sendJson(response, 200, await getAcademyCandles(symbol, timeframe));
      } catch (error) {
        logger(error instanceof TypeError ? 'warn' : 'error', 'academy_market_request_failed', { error });
        sendJson(response, error instanceof TypeError ? 400 : 503, { ok: false, error: error instanceof TypeError ? 'invalid_symbol' : 'temporary_unavailable' });
      }
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/access') {
      if (!academyAccess) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      try {
        const result = await academyAccess.verify(request.headers.authorization);
        sendJson(response, result.status || 200, result.ok ? { ok: true } : { ok: false, error: result.code });
      } catch (error) {
        logger('error', 'academy_access_check_failed', { error });
        sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
      }
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/authorize') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const result = academyOAuth.start();
      if (!result.ok) { sendJson(response, result.status || 503, { ok: false, error: result.code }); return; }
      sendRedirect(response, result.url);
      return;
    }

    if (request.method === 'GET' && path === '/v1/link/discord/callback') {
      if (!academyOAuth) { sendHtml(response, 503, academyAuthorizationCompleteHtml({ ok: false, error: 'integration_unconfigured' })); return; }
      try {
        const params = new URL(request.url || '/', 'http://localhost').searchParams;
        const result = await academyOAuth.complete({ code: params.get('code'), state: params.get('state') });
        sendHtml(response, result.ok ? 200 : (result.status || 403), academyAuthorizationCompleteHtml({ ok: result.ok, sessionToken: result.sessionToken, error: result.code }));
      } catch (error) {
        logger('error', 'academy_oauth_callback_failed', { error });
        sendHtml(response, 503, academyAuthorizationCompleteHtml({ ok: false, error: 'temporary_unavailable' }));
      }
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/session') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const result = academyOAuth.verifySession(request.headers.authorization);
      sendJson(response, result.ok ? 200 : (result.status || 401), result.ok ? { ok: true } : { ok: false, error: result.code });
      return;
    }

    if (request.method === 'GET' && /^\/academy-activity\/data\/(options|earnings)$/.test(path)) {
      if (!academyOAuth || !academyDataBridge) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      const kind = path.endsWith('/options') ? 'options' : 'earnings';
      const symbol = new URL(request.url || '/', 'http://localhost').searchParams.get('symbol');
      try {
        const result = await academyDataBridge.get(kind, symbol);
        sendJson(response, result.status || (result.ok ? 200 : 503), result.ok ? { ok: true, data: result.data } : { ok: false, error: result.code });
      } catch (error) {
        logger(error instanceof TypeError ? 'warn' : 'error', 'academy_data_request_failed', { kind, error });
        sendJson(response, error instanceof TypeError ? 400 : 503, { ok: false, error: error instanceof TypeError ? 'invalid_symbol' : 'academy_data_unavailable' });
      }
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
  const connectInteractions = disputes.discordInteractions;
  const academyAccess = createAcademyAccess({ guildId: config.academyGuildId, allowedRoleIds: [config.academyManagerRoleId, config.academyMonarchRoleId] });
  const academyOAuth = createAcademyOAuth({ clientId: config.discordClientId, clientSecret: config.discordClientSecret,
    redirectUri: config.discordRedirectUri, academyAccess });
  const { createAcademyDataBridge } = require('./academy-data-bridge');
  const academyDataBridge = createAcademyDataBridge({ baseUrl: config.academyBridgeUrl, secret: config.academyBridgeSecret });
  log('info', 'dispute_evidence_runtime', { enabled: disputes.enabled, reason: disputes.reason,
    paypal: !!disputes.paypalClient, connectBot: !!connectInteractions });
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
    discordInteractions: connectInteractions,
    disputeDiscordInteractions: disputes.disputeDiscordInteractions,
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
    corporateConflictCodes: CONFLICT_CODES,
    academyAccess, academyOAuth, academyDataBridge
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
