'use strict';

const http = require('node:http');
const fs = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const pathModule = require('node:path');
const { getConfig } = require('./config');
const { createDatabase } = require('./database');
const { log } = require('./logger');
const { parseEvent, readRequestBody, verifySignature } = require('./wordpress-gateway');
const stripeWebhook = require('./stripe-webhook');
const Stripe = require('stripe');
const billingService = require('./billing-service');
const { createUpgradeChatClient } = require('./upgrade-chat');
const { createMemberEmailService, createResendSender, stripeContact } = require('./member-email');
const newsWebhook = require('./news-webhook');
const paypalWebhookModule = require('./paypal-webhook');
const discordInteractionsModule = require('./discord-interactions');
const dailySocialPayoutsModule = require('./dsp-interactions');
const connectMigration = require('./connect-migration');
const { createAcademyAccess } = require('./academy-access');
const { createAcademyOAuth } = require('./academy-oauth');
const { SEED_LESSONS } = require('./academy/curriculum');
const { academyCurriculumScript, academyCurriculumVersion } = require('./academy-activity-curriculum');
const { academyVisualLabScript } = require('./academy-visual-lab');
const { academyCartoonVisualsScript } = require('./academy-cartoon-visuals');
const { academyChartIntelligenceScript } = require('./academy-chart-intelligence');
const { academyQuoteStatisticsScript } = require('./academy-quote-statistics');
const { createAcademyProgress } = require('./academy-progress');
const { createOrderFlowService } = require('./academy-order-flow-service');
const { createOrderFlowStore } = require('./academy-order-flow-store');
const { createAlertsService, defaultChannels } = require('./academy-alerts');
const { createAcademyVoice } = require('./academy-voice');
const { createDisciplineProgress } = require('./academy/discipline-progress');
const { createAcademySlideDesigner } = require('./academy-slide-designer');
const { cleanupConnectActivityMessages, getLastCleanupResult } = require('../scripts/cleanup-connect-activity-messages');
const ACADEMY_SDK_ROOT = pathModule.join(pathModule.dirname(require.resolve('@discord/embedded-app-sdk/package.json')), 'output');
const ACADEMY_INTRO_PATH = pathModule.join(__dirname, 'assets', 'making-easy-money-academy-intro.mp4');
const ACADEMY_BANNER_PATH = pathModule.join(__dirname, 'assets', 'mem-academy-banner.gif');

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
const academyReportLimit = { bucket: 0, n: new Map() };
let academyScannerCache = { freshUntil: 0, staleUntil: 0, payload: null, inflight: null };
const academySirePriceHistory = new Map();
const academyDepthCache = new Map();
const academyDepthInflight = new Map();
/* parts/example/exampleIndex/narrationVersion come from the shared narration
   builder, so the client deck, the voice and the slide designer all use the
   same part list. The version busts browser caches when narration changes. */
const ACADEMY_CURRICULUM_VERSION = academyCurriculumVersion(SEED_LESSONS);
/* The lesson the deck opens on, so the intro overlay pre-warms the design the
 * learner is actually about to see. It became 0.1 when the Start Here track
 * landed; the warm-up used to name module 1 lesson 1 by hand. */
const ACADEMY_FIRST_LESSON = SEED_LESSONS.slice()
  .sort((left, right) => left.moduleId - right.moduleId || left.lessonId - right.lessonId)[0];
const academyCurriculumPayload = JSON.stringify({ version: ACADEMY_CURRICULUM_VERSION, lessons: SEED_LESSONS.map((lesson) => ({
  moduleId: lesson.moduleId, lessonId: lesson.lessonId, title: lesson.title,
  description: lesson.description, duration: lesson.duration, level: lesson.level,
  steps: lesson.steps, question: lesson.question, simulation: lesson.simulation,
  parts: lesson.parts, example: lesson.example, exampleIndex: lesson.exampleIndex,
  narrationVersion: lesson.narrationVersion
})) });
const academyCurriculumPayloadGzip = zlib.gzipSync(Buffer.from(academyCurriculumPayload), {
  level: zlib.constants.Z_BEST_SPEED
});

async function settleWithin(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs); });
  return Promise.race([
    Promise.resolve(promise).then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason })),
    timeout
  ]).finally(() => clearTimeout(timer));
}

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
  return asHubArray(asHubObject(value).rows).slice(0, 100).map((item) => {
    const row = asHubObject(item);
    return {
      symbol: asHubText(row.symbol || row.sym).toUpperCase().slice(0, 10),
      name: asHubText(row.name).slice(0, 100),
      price: asHubNumber(row.price || row.last),
      change: asHubNumber(row.change || row.chg),
      changePct: asHubNumber(row.change_pct || row.chgPct),
      volume: asHubNumber(row.volume || row.v),
      previousVolume: asHubNumber(row.previousVolume || row.pv),
      previousClose: asHubNumber(row.previousClose || row.pc),
      open: asHubNumber(row.open || row.o),
      high: asHubNumber(row.high || row.h),
      low: asHubNumber(row.low || row.l),
      close: asHubNumber(row.close || row.c),
      bid: asHubNumber(row.bid),
      bidSize: asHubNumber(row.bidSize || row.bs),
      ask: asHubNumber(row.ask),
      askSize: asHubNumber(row.askSize || row.as),
      postMarketPct: asHubNumber(row.postPct),
      postMarketPrice: asHubNumber(row.postMarketPrice || row.post_price || row.postPrice),
      turnoverRate: asHubNumber(row.turnoverRate || row.turnover_rate || row.handTurnover),
      turnover: asHubNumber(row.turnover || row.amount),
      volatility: asHubNumber(row.volatility),
      amplitude: asHubNumber(row.amplitude),
      volumeRatio: asHubNumber(row.volumeRatio || row.volume_ratio || row.relV),
      rvol: asHubNumber(row.rvol || row.relativeVolume || row.relV),
      avgPrice: asHubNumber(row.avgPrice || row.averagePrice || row.avg_price),
      high52: asHubNumber(row.high52 || row.week52High || row.high_52_week),
      low52: asHubNumber(row.low52 || row.week52Low || row.low_52_week),
      historicalHigh: asHubNumber(row.historicalHigh || row.historical_high),
      historicalLow: asHubNumber(row.historicalLow || row.historical_low),
      marketCap: asHubNumber(row.marketCap || row.market_cap || row.mcap),
      peTtm: asHubNumber(row.peTtm || row.pe_ttm),
      peLyr: asHubNumber(row.peLyr || row.pe_lyr),
      pb: asHubNumber(row.pb),
      roe: asHubNumber(row.roe),
      roa: asHubNumber(row.roa),
      dividendYield: asHubNumber(row.dividendYield || row.dividend_yield || row.divYield),
      dividendTtm: asHubNumber(row.dividendTtm || row.dividend_ttm),
      sharesOutstanding: asHubNumber(row.sharesOutstanding || row.totalShares || row.shares_outstanding),
      floatMarketCap: asHubNumber(row.floatMarketCap || row.float_market_cap),
      sharesFloat: asHubNumber(row.sharesFloat || row.floatShares || row.shares_float),
      minTradingUnit: asHubNumber(row.minTradingUnit || row.lotSize || row.min_trading_unit),
      bidAskRatio: asHubNumber(row.bidAskRatio || row.bid_ask_ratio),
      rsi: asHubNumber(row.rsi),
      macd: asHubNumber(row.macd),
      bidAskPressure: asHubNumber(row.bidAskPressure || row.bid_ask_pressure),
      orderImbalance: asHubNumber(row.orderImbalance || row.order_imbalance),
      depthImbalance: asHubNumber(row.depthImbalance || row.depth_imbalance),
      quality: asHubText(row.quality).slice(0, 80)
    };
  }).filter((row) => /^[A-Z0-9.-]{1,10}$/.test(row.symbol));
}

function calculateWindowChange(currentPrice, history, sampledAt, windowMs) {
  const current = Number(currentPrice);
  const safeWindow = Number(windowMs);
  const target = Number(sampledAt) - safeWindow;
  if (!Number.isFinite(current) || current <= 0 || !Array.isArray(history) || !Number.isFinite(safeWindow) || safeWindow <= 0) return { percent: null, windowSeconds: null };
  const valid = history.filter((sample) => Number.isFinite(Number(sample?.t)) && Number(sample?.price) > 0);
  const before = valid.filter((sample) => Number(sample.t) <= target).at(-1);
  const after = valid.find((sample) => Number(sample.t) >= target);
  if (!before) return { percent: null, windowSeconds: null };
  let baselinePrice = Number(before.price);
  if (after && Number(after.t) > Number(before.t)) {
    const weight = (target - Number(before.t)) / (Number(after.t) - Number(before.t));
    baselinePrice += (Number(after.price) - baselinePrice) * weight;
  }
  return {
    percent: ((current - baselinePrice) / baselinePrice) * 100,
    windowSeconds: after ? Math.round(safeWindow / 1000) : Math.round((Number(sampledAt) - Number(before.t)) / 1000)
  };
}

function calculateThreeMinuteChange(currentPrice, history, sampledAt) {
  return calculateWindowChange(currentPrice, history, sampledAt, 180_000);
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
  if (!/^(1m|3m|5m|10m|15m|30m|1h|2h|4h|1D|1W|1M|1Q|1Y)$/.test(safeTimeframe)) throw new TypeError('invalid_timeframe');
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
      academyMarketCache.set(cacheKey, { freshUntil: Date.now() + 4_000, staleUntil: Date.now() + 1_800_000, payload });
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

/* The upstream history call takes ~2 s when cold, but the Activity page only waited 650 ms for it, so a cold cache produced a page with no candles.
   Keep the busiest charts warm in the background so the first paint always has data. Errors are logged (throttled) so a dead feed is visible. */
const ACADEMY_WARM = [['SPY', '5m'], ['QQQ', '5m'], ['SPY', '1D']];
let academyWarmFailLogged = 0;
function startAcademyChartWarmers(log = logger) {
  const tick = async () => {
    for (const [symbol, tf] of ACADEMY_WARM) {
      try { await getAcademyCandles(symbol, tf); }
      catch (error) {
        if (Date.now() - academyWarmFailLogged > 300_000) { academyWarmFailLogged = Date.now(); log('warn', 'academy_chart_warm_failed', { symbol, tf, error }); }
      }
    }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, 15_000);
  if (timer.unref) timer.unref();
  return timer;
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
      const sampledAt = Date.now();
      const rows = sanitizeHubScanner(await upstream.json()).map((row) => {
        const history = (academySirePriceHistory.get(row.symbol) || [])
          .filter((sample) => sample.t >= sampledAt - 3_900_000);
        if (Number.isFinite(row.price) && row.price > 0) history.push({ t: sampledAt, price: row.price });
        academySirePriceHistory.set(row.symbol, history.slice(-1_000));
        const sire = calculateThreeMinuteChange(row.price, history, sampledAt);
        const rate = (seconds) => calculateWindowChange(row.price, history, sampledAt, seconds * 1_000).percent;
        return { ...row,
          changeRate30sec: rate(30), changeRate1min: rate(60), changeRate3min: sire.percent,
          changeRate5min: rate(300), changeRate15min: rate(900), changeRate1hour: rate(3_600),
          sireWindowSeconds: sire.windowSeconds };
      });
      for (const [symbol, history] of academySirePriceHistory) {
        if (!history.length || history.at(-1).t < sampledAt - 3_900_000) academySirePriceHistory.delete(symbol);
      }
      if (!rows.length) throw new Error('academy_scanner_empty');
      const payload = { rows, asOf: Date.now() };
      academyScannerCache = { freshUntil: Date.now() + 4_000, staleUntil: Date.now() + 300_000, payload, inflight: null };
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
/* Chart guard: a CSS floor + watchdog appended to the Activity page (see ACADEMY_CHART_GUARD). */
const ACADEMY_CHART_GUARD = "<style>main{min-height:560px}.chart{min-height:320px}.chart canvas{min-height:240px}#academy-back-to-chart{display:none}.academy-live-deck .academy-slide-visual:not(:has(svg)){display:none}.academy-live-deck:not(:has(.wb-svg)) .academy-slide-callout{display:none}body.academy-lesson-open #mem-algo-panel,body.academy-lesson-open .academy-pro-panel,body.academy-lesson-open .academy-pro-palette{display:none!important}.academy-live-deck .academy-slide-title{font-size:1.05rem}.academy-live-deck .academy-caption{font-size:.85rem;font-weight:600;line-height:1.55}body:not(.academy-lesson-open) .academy-guide{display:none!important}@media(max-width:900px){.academy-guide{display:none!important}}@media(max-width:900px){body.academy-lesson-open #academy-back-to-chart{display:block;position:fixed;top:6px;right:6px;z-index:2147483601;padding:8px 12px;border:0;border-radius:999px;background:#00c47d;color:#042217;font:800 12px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.5);cursor:pointer}}</style><script>(()=>{if(window.__smlChartGuard)return;window.__smlChartGuard=1;\nconst q=new URLSearchParams(location.search),SYM=()=>(q.get('symbol')||'SPY').toUpperCase(),TF=()=>q.get('tf')||'5m',status=document.getElementById('status'),canvas=document.getElementById('chart');\nconst bars=()=>{try{return window.smlAcademyChartState().bars}catch(_){return[]}},key=()=>'sml-academy-bars:'+SYM()+':'+TF();\nwindow.addEventListener('sml-academy-market',e=>{const b=e.detail&&e.detail.bars;if(b&&b.length>20){try{sessionStorage.setItem(key(),JSON.stringify({t:Date.now(),symbol:e.detail.symbol,bars:b.slice(-250)}))}catch(_){}}});\nconst restore=()=>{if(bars().length)return false;try{const c=JSON.parse(sessionStorage.getItem(key())||'null');if(c&&Array.isArray(c.bars)&&c.bars.length&&Date.now()-c.t<216e5){window.smlAcademyApplyMarket({symbol:c.symbol,bars:c.bars});if(status)status.textContent='STALE';return true}}catch(_){}return false};\nlet misses=0,reported=false,delay=1500;const started=Date.now();\nconst fix=async()=>{if(document.hidden&&bars().length)return;if(canvas&&(!canvas.clientWidth||!canvas.clientHeight))window.dispatchEvent(new Event('resize'));if(bars().length){misses=0;return}misses++;\ntry{const r=await fetch('/academy-activity/market?symbol='+encodeURIComponent(SYM())+'&tf='+encodeURIComponent(TF()),{cache:'no-store'}),p=await r.json();if(r.ok&&p&&Array.isArray(p.bars)&&p.bars.length){window.smlAcademyApplyMarket(p);if(status)status.textContent='LIVE';return}}catch(_){}\nrestore();if(!reported&&Date.now()-started>8000&&!bars().length){reported=true;try{navigator.sendBeacon('/academy-activity/report',new Blob([JSON.stringify({kind:'chart_blank',w:canvas?canvas.clientWidth:-1,h:canvas?canvas.clientHeight:-1,symbol:SYM(),tf:TF(),misses,hidden:document.hidden,ua:navigator.userAgent.slice(0,120)})],{type:'text/plain'}))}catch(_){}}};\nsetTimeout(restore,400);(function loop(){fix().finally(()=>setTimeout(loop,bars().length?10000:(delay=Math.min(8000,Math.round(delay*1.4)))))})();\ndocument.addEventListener('visibilitychange',()=>{if(!document.hidden)fix()});\n/* On a phone the lesson fills the screen and its Back to Chart button sits at the very bottom, so members never found the chart. Keep a Back to Chart button pinned on screen while a lesson is open. */\nconst backBtn=document.createElement('button');backBtn.id='academy-back-to-chart';backBtn.type='button';backBtn.textContent='\\u25A6 Back to Chart';backBtn.onclick=()=>{const c=document.getElementById('close-lesson');if(c)c.click()};document.body.appendChild(backBtn);\n/* The Indicator Engine is inserted inside the chart grid and takes the 1fr row, leaving the candles a 0px stage. Move it out, above the scanner. */\nconst lift=()=>{const box=document.querySelector('.chart > .academy-intelligence'),sc=document.querySelector('.academy-scanner');if(box&&sc&&sc.parentNode)sc.parentNode.insertBefore(box,sc);if(canvas&&(!canvas.clientHeight))window.dispatchEvent(new Event('resize'))};\nlift();const liftTimer=setInterval(lift,500);setTimeout(()=>clearInterval(liftTimer),20000);})();</script>";
/* MEM ALGO (Day & Swing trading model) — engine + chart panel, inlined so the Activity stays a single document behind Discord's proxy. */
const ACADEMY_MEM_ALGO = (() => {
  try {
    const engine = fs.readFileSync(pathModule.join(__dirname, 'academy-mem-algo.js'), 'utf8');
    const ui = fs.readFileSync(pathModule.join(__dirname, 'academy-mem-algo-ui.js'), 'utf8');
    const patterns = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-patterns.js'), 'utf8'); } catch (_) { return ''; } })();
    const pro = fs.readFileSync(pathModule.join(__dirname, 'academy-chart-pro.js'), 'utf8');
    const liveFeed = fs.readFileSync(pathModule.join(__dirname, 'academy-live.js'), 'utf8');
    const optionsCalc = fs.readFileSync(pathModule.join(__dirname, 'academy-options-calc.js'), 'utf8');
    const optionsDock = fs.readFileSync(pathModule.join(__dirname, 'academy-options-dock.js'), 'utf8');
    const alertsUi = fs.readFileSync(pathModule.join(__dirname, 'academy-alerts-ui.js'), 'utf8');
    const patternScript = patterns ? '<script>(function(){var module={exports:{}},exports=module.exports;' + patterns + '\nwindow.SmlPatterns=window.SmlPatterns||module.exports;})();</script>' : '';
    return patternScript + '<script>' + pro + '</script><script>' + liveFeed + '</script><script>' + optionsCalc + '</script><script>' + optionsDock + '</script><script>' + alertsUi + '</script><script>(function(){var module={exports:{}},exports=module.exports;' + engine + '\nwindow.MemAlgoEngine=module.exports;})();</script><script>' + ui + '</script>';
  } catch (_) { return ''; } // the chart must load even if the model files are missing
})();

const ACADEMY_MOOMOO_BUY = `<style>#academy-moomoo-buy{display:inline-flex;align-items:center;gap:5px;border:1px solid #2f6cf5;border-radius:5px;background:#12233f;color:#9cc0ff;font:800 .68rem system-ui;padding:5px 8px;cursor:pointer;white-space:nowrap}#academy-moomoo-buy:hover{background:#1a3157;color:#c4d9ff}</style><script>(()=>{if(document.getElementById('academy-moomoo-buy'))return;
const toolbar=document.querySelector('.toolbar');if(!toolbar)return;
const currentSymbol=()=>{const q=new URLSearchParams(location.search).get('symbol'),typed=document.getElementById('symbol')?.value;return String(q||typed||'SPY').toUpperCase().replace(/[^A-Z0-9.\-]/g,'').slice(0,10)||'SPY'};
/* moomoo's /stock/ URLs are NOT iOS universal links (absent from their AASA), so on phones we route
   through moomoo's own first-party /deeplink/ bridge, which IS allowlisted and opens the installed app
   on that exact stock (double-encoding required - the page unescapes twice). Only ftmm://url/ targets,
   never ftmm://trade/ - the button must always land on the quote page, not an order ticket. */
const moomooUrl=(s)=>{const stockUrl='https://www.moomoo.com/stock/'+encodeURIComponent(s)+'-US';const mobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);return mobile?'https://www.moomoo.com/deeplink/?target='+encodeURIComponent('ftmm://url/'+encodeURIComponent(stockUrl)):'https://sml-platform-api.onrender.com/academy-activity/moomoo?symbol='+encodeURIComponent(s)};
const btn=document.createElement('button');btn.id='academy-moomoo-buy';btn.type='button';
const paint=()=>{btn.textContent='Buy '+currentSymbol()+' on moomoo ↗';btn.title='Opens '+currentSymbol()+' in your moomoo app. Any order is reviewed and placed by you in moomoo — nothing is traded from the Academy.'};paint();
btn.setAttribute('aria-label','Open this stock in the moomoo app');
btn.onclick=()=>{const s=currentSymbol();const url=moomooUrl(s);if(window.smlAcademyOpenExternal)void window.smlAcademyOpenExternal(url);else try{window.open(url,'_blank','noopener')}catch(_){}};
const buyChip=toolbar.querySelector('.quote-chip.buy');(buyChip&&buyChip.nextSibling)?toolbar.insertBefore(btn,buyChip.nextSibling):toolbar.appendChild(btn);
new MutationObserver(paint).observe(document.getElementById('label')||document.body,{childList:true,characterData:true,subtree:true});
window.addEventListener('popstate',paint)})();</script>`;

/**
 * Standalone launcher the Academy's moomoo button opens in the SYSTEM browser
 * (Discord's openExternalLink only carries https). Phones bounce straight to
 * moomoo's universal-link bridge and land inside the moomoo app on this stock.
 *
 * Desktop reality, verified 2026-09-25 at the registry level on a machine with
 * the client installed: the moomoo desktop app registers NO URL protocol (258
 * schemes enumerated, none moomoo/futu), no moomoo page attempts a desktop
 * launch, and moomoo's website has no real-money order entry - orders happen
 * in the mobile app ("Trade") or the desktop app ("Quick Trade") only. So on
 * desktop the fastest honest path is: copy the ticker, open moomoo desktop,
 * paste into search, Quick Trade. Do not re-add protocol-launch machinery
 * without re-verifying - an unregistered scheme throws a browser error dialog.
 *
 * Only quote destinations, never a trade deep link: every order is reviewed
 * and placed by the member inside moomoo.
 */
const MOOMOO_DOWNLOAD_URL = 'https://www.moomoo.com/download';

function academyMoomooLaunchHtml(symbol) {
  const sym = JSON.stringify(symbol);
  const downloadUrl = JSON.stringify(MOOMOO_DOWNLOAD_URL);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trade ${symbol} on moomoo</title>
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#070b10;color:#eef4f7;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.card{width:min(450px,calc(100vw - 32px));padding:26px;border:1px solid #1f3942;border-radius:14px;background:#0d1720;text-align:center}.card h1{margin:0 0 6px;font-size:1.15rem}.card .sym{color:#79efbd;font-family:ui-monospace,monospace}.card p{margin:0 0 16px;color:#8fa5b1;font-size:.85rem;line-height:1.5}.steps{margin:0 0 16px;padding:12px 14px;border:1px solid #294554;border-radius:9px;background:#0a1118;text-align:left;color:#c7d5dc;font-size:.82rem;line-height:1.65}.steps b{color:#79efbd}button.copy{width:100%;margin:0 0 9px;padding:12px 14px;border:0;border-radius:8px;background:#00c47d;color:#042217;font:800 .95rem system-ui;cursor:pointer}button.copy.done{background:#0b6a49;color:#dffbee}.card a{display:block;margin:9px 0;padding:11px 14px;border-radius:8px;font-weight:800;text-decoration:none}.secondary{border:1px solid #2f6cf5;background:#12233f;color:#9cc0ff}.tertiary{border:1px solid #294554;background:#101e27;color:#9eb2bc;font-weight:700}.note{margin-top:14px;color:#63798a;font-size:.72rem;line-height:1.5}</style></head><body><div class="card">
<h1>Trade <span class="sym">${symbol}</span> on moomoo</h1>
<p id="lead">Buy and sell happen inside your own moomoo app.</p>
<div class="steps" id="desktop-steps"><b>1.</b> Copy the ticker below.<br><b>2.</b> Open your <b>moomoo desktop</b> app.<br><b>3.</b> Paste ${symbol} into search, then use <b>Quick Trade</b>.</div>
<button class="copy" id="copy-sym" type="button">Copy ${symbol}</button>
<a id="open-web" class="secondary" href="#" target="_blank" rel="noopener">View ${symbol} on moomoo web</a>
<a id="get-app" class="tertiary" href="#" target="_blank" rel="noopener">Get moomoo</a>
<div class="note">Nothing is traded from the Academy. moomoo is a separate brokerage - your account, your decisions.</div>
</div><script>(()=>{
const SYM=${sym},DL=${downloadUrl};
const stockUrl='https://www.moomoo.com/stock/'+encodeURIComponent(SYM)+'-US';
const mobileBridge='https://www.moomoo.com/deeplink/?target='+encodeURIComponent('ftmm://url/'+encodeURIComponent(stockUrl));
document.getElementById('open-web').href=stockUrl;
document.getElementById('get-app').href=DL;
if(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)){location.replace(mobileBridge);return}
const btn=document.getElementById('copy-sym');
btn.onclick=async()=>{try{await navigator.clipboard.writeText(SYM);btn.textContent=SYM+' copied ✓ — now open moomoo desktop';btn.classList.add('done')}catch(_){btn.textContent='Select and copy: '+SYM}};
})();</script></body></html>`;
}

function academyActivityHtml(initialMarket = {}, options = {}) {
  return academyActivityHtmlBase(initialMarket, options).replace(/<\/body>\s*<\/html>\s*$/i, () => ACADEMY_CHART_GUARD + ACADEMY_MEM_ALGO + ACADEMY_MOOMOO_BUY + '</body></html>');
}

function academyActivityHtmlBase(initialMarket = {}, options = {}) {
  const initialBars = JSON.stringify(Array.isArray(initialMarket.bars) ? initialMarket.bars.slice(-250) : []);
  const initialSymbol = JSON.stringify(String(initialMarket.symbol || 'SPY'));
  const initialScanner = JSON.stringify(Array.isArray(initialMarket.scanner?.rows) ? initialMarket.scanner.rows.slice(0, 100) : []);
  const initialDepth = JSON.stringify(initialMarket.depth && typeof initialMarket.depth === 'object' ? initialMarket.depth : { bids: [], asks: [] });
  const academyAppId = JSON.stringify(String(options.appId || ''));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Making Easy Money Academy — Live Chart Lab</title>
<style>
*{box-sizing:border-box}html,body{width:100%;min-height:100%;margin:0;background:#070b10;color:#eef4f7;font-family:system-ui,-apple-system,Segoe UI,sans-serif}html{scroll-behavior:smooth}body{overflow-x:hidden;overflow-y:auto;overscroll-behavior-y:contain}main{height:calc(100dvh - 86px);min-height:440px;display:grid;grid-template-rows:auto auto auto minmax(0,1fr)}.bar{display:flex;align-items:center;gap:.65rem;padding:.48rem .75rem;background:#0d1720;border-bottom:1px solid #1f3942;font-size:.8rem}.dot{width:.5rem;height:.5rem;border-radius:999px;background:#00d084;box-shadow:0 0 12px #00d084}.status{margin-left:0;color:#7f98a6;font:700 .7rem ui-monospace,monospace}.lesson-toggle{margin-left:auto;border:1px solid #00c47d;border-radius:6px;background:#092b23;color:#79efbd;font:800 .72rem system-ui;padding:6px 8px;cursor:pointer}.dashbar{display:flex;align-items:center;gap:10px;padding:5px 12px;background:#0a1118;border-bottom:1px solid #172a35;font:700 .67rem ui-monospace}.dashbrand{color:#00d084;letter-spacing:.06em}.academy-tag{padding:3px 6px;border-radius:4px;color:#94e9c4;background:#123d31}.market-state{margin-left:auto;color:#ffbf5d}.indices{display:flex;gap:7px;overflow:hidden;padding:5px 12px;background:#101923;border-bottom:1px solid #1c3140}.index{min-width:124px;border-right:1px solid #273947;padding-right:7px;font-size:.64rem;color:#94aab6}.index b{display:block;color:#eaf5f8;margin-bottom:1px}.index em{font-style:normal;color:#00d084}.shell{min-height:0;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) 238px}.chart{position:relative;min-height:0;padding:8px;display:grid;grid-template-rows:auto minmax(0,1fr)}.toolbar{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin:0;padding:6px 8px;border:1px solid #1b3540;border-radius:8px 8px 0 0;background:#0a1118}.toolbar input{width:82px;background:#0d1720;border:1px solid #285061;border-radius:5px;color:#fff;padding:5px 7px;font-weight:800;text-transform:uppercase}.toolbar button{border:0;border-radius:5px;background:#00c47d;color:#042217;font-weight:800;padding:5px 8px;cursor:pointer}.toolbar small{color:#8295a3}.quote-chip{font:800 .68rem ui-monospace;color:#d7e9ef}.sell{color:#ff778b}.buy{color:#52e6ad}.intervals{display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-left:auto}.intervals button{padding:4px 5px;background:#162632;color:#9cb1bd}.intervals button.active{background:#00c47d;color:#042217}canvas{display:block;width:100%;height:100%;min-height:0;touch-action:none;border:1px solid #1b3540;border-radius:0 0 8px 8px;background:linear-gradient(180deg,#0b141c,#070b10)}.side{min-height:0;overflow:hidden;border-left:1px solid #1b3540;background:#0a1118;padding:10px}.side h2{font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;color:#86a2b0;margin:0 0 7px}.quote{font:800 1.25rem ui-monospace,monospace}.change{font:700 .72rem ui-monospace,monospace;margin-top:2px}.meta{margin-top:8px;padding-top:7px;border-top:1px solid #1b3540;color:#8094a2;font-size:.62rem;line-height:1.35}.book{margin-top:8px;border-top:1px solid #1b3540;padding-top:7px}.book h3{font-size:.63rem;margin:0 0 5px;color:#86a2b0}.bookrow{display:flex;justify-content:space-between;font:700 .63rem ui-monospace;margin:3px 0}.bookrow .bidtxt{color:#52e6ad}.bookrow .asktxt{color:#ff778b}.academy-below{min-height:100dvh;padding:18px;background:#070b10;border-top:1px solid #1f3942}.below-title{margin:0 0 12px;font:900 .8rem ui-monospace;color:#8ee8c1;letter-spacing:.08em}.options-chain{margin-top:18px;padding:14px;border:1px solid #1b3540;border-radius:10px;background:#0a1118}.options-chain h2{font-size:.9rem;margin:0 0 6px}.options-chain p{margin:0;color:#8fa5b1;font-size:.75rem}.options-chain button{margin-top:10px;border:0;border-radius:6px;background:#00c47d;color:#042217;font-weight:900;padding:8px 11px;cursor:pointer}.options-grid{display:grid;grid-template-columns:repeat(6,minmax(76px,1fr));gap:1px;margin-top:12px;background:#213744;border:1px solid #213744}.options-grid span{padding:6px;background:#0b141c;font:.66rem ui-monospace}.options-grid .head{background:#13242d;color:#8ee8c1;font-weight:900}.lesson{position:fixed;z-index:20;top:48px;right:12px;width:min(430px,calc(100vw - 24px));max-height:calc(100dvh - 76px);overflow:auto;display:none;padding:16px;border:1px solid #2c596a;border-radius:11px;background:#0b141c;box-shadow:0 16px 48px rgba(0,0,0,.55)}.lesson.open{display:block}.lesson small{color:#00d084;font-weight:800;letter-spacing:.09em}.lesson h2{font-size:1.08rem;margin:7px 0}.lesson p{font-size:.85rem;line-height:1.55;color:#c7d5dc}.scene{position:relative;height:105px;margin:12px 0;border:1px solid #25424f;border-radius:8px;background:radial-gradient(circle at 50% 50%,#163344,#091117 65%);overflow:hidden}.bid,.ask{position:absolute;padding:7px 9px;border-radius:6px;font:800 .75rem ui-monospace;animation:bob 1.8s ease-in-out infinite}.bid{left:15%;top:25px;background:#063c2c;color:#72f2b9}.ask{right:15%;bottom:22px;background:#4b1724;color:#ff91a2;animation-delay:-.8s}.trade{position:absolute;left:48%;top:43%;width:13px;height:13px;border-radius:50%;background:#ffd166;box-shadow:0 0 0 0 rgba(255,209,102,.7);animation:pulse 1.4s infinite}@keyframes bob{50%{transform:translateY(12px)}}@keyframes pulse{70%{box-shadow:0 0 0 18px rgba(255,209,102,0)}}.lesson-controls{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.lesson button{border:0;border-radius:6px;background:#00c47d;color:#042217;font-weight:800;padding:7px 9px;cursor:pointer}.lesson button.alt{background:#1c303b;color:#d9e8ee}.answers{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:9px}.answers button{background:#19303d;color:#e7f3f6;text-align:left}.answers button.good{background:#0b6a49}.answers button.bad{background:#6d2531}@media(max-height:720px){.indices{display:none}main{grid-template-rows:auto auto minmax(0,1fr)}.meta{display:none}}@media(max-width:720px){main{height:calc(100dvh - 78px);grid-template-rows:auto minmax(0,1fr)}.indices,.dashbar{display:none}.shell{grid-template-columns:1fr}.side{display:none}.chart{padding:5px}.bar span{display:none}.intervals{margin-left:0}.academy-below{padding:12px}.options-grid{grid-template-columns:repeat(3,minmax(72px,1fr))}}
</style><style>
.lesson-picker{width:100%;margin:8px 0 4px;padding:8px;border:1px solid #285061;border-radius:6px;background:#0d1720;color:#eef4f7;font-weight:800}.lesson button:disabled{opacity:.45;cursor:not-allowed}@media(max-width:720px){.answers{grid-template-columns:1fr}}
.academy-scanner{border:1px solid #1b3540;border-radius:10px;background:#0a1118;overflow:hidden}.academy-scan-head{display:flex;gap:9px;align-items:center;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid #1b3540}.academy-scan-title{font:900 .76rem ui-monospace;color:#eaf5f8}.academy-scan-live{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(82,230,173,.35);border-radius:999px;padding:3px 7px;color:#52e6ad;font:900 .58rem ui-monospace}.academy-scan-live:before{content:'';width:5px;height:5px;border-radius:50%;background:#52e6ad;box-shadow:0 0 8px #52e6ad}.academy-scan-tabs{display:flex;gap:4px;flex-wrap:wrap;padding:8px 12px;border-bottom:1px solid #1b3540}.academy-scan-tabs button,.academy-scan-tools button{border:1px solid #294554;border-radius:5px;background:#101e27;color:#9eb2bc;padding:5px 8px;font:800 .62rem ui-monospace;cursor:pointer}.academy-scan-tabs button.on{border-color:#00c47d;background:#0b3b2e;color:#7ef0bd}.academy-scan-tools{display:flex;gap:7px;align-items:center;flex-wrap:wrap;padding:8px 12px;border-bottom:1px solid #1b3540}.academy-scan-tools input,.academy-scan-tools select{height:30px;border:1px solid #294554;border-radius:5px;background:#0d1720;color:#eaf5f8;padding:5px 8px;font:700 .64rem system-ui}.academy-scan-tools input{min-width:240px;flex:1}.academy-monitor{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:#1b3540;border-bottom:1px solid #1b3540}.academy-monitor span{padding:8px 12px;background:#0d1720;color:#8fa5b1;font:.62rem ui-monospace}.academy-monitor b{display:block;margin-top:2px;color:#eaf5f8;font-size:.74rem}.academy-scan-wrap{max-width:100%;overflow:auto;overscroll-behavior:contain}.academy-scan-table{width:100%;min-width:940px;border-collapse:collapse;font:.64rem ui-monospace}.academy-scan-table th,.academy-scan-table td{padding:7px 8px;border-bottom:1px solid rgba(42,66,78,.55);white-space:nowrap;text-align:right}.academy-scan-table th{position:sticky;top:0;background:#13242d;color:#8ee8c1;cursor:pointer}.academy-scan-table th:nth-child(-n+3),.academy-scan-table td:nth-child(-n+3){text-align:left}.academy-scan-table tbody tr{cursor:pointer}.academy-scan-table tbody tr:hover{background:#10232b}.academy-scan-symbol{font-weight:900;color:#eef4f7}.academy-scan-name{display:block;max-width:150px;overflow:hidden;text-overflow:ellipsis;color:#738995;font-size:.55rem}.academy-positive{color:#52e6ad}.academy-negative{color:#ff778b}.academy-muted{color:#718694}.academy-scan-foot{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:9px 12px;color:#8094a2;font:.62rem ui-monospace}.academy-scan-pages{display:flex;gap:4px}.academy-scan-pages button{border:1px solid #294554;border-radius:4px;background:#101e27;color:#9eb2bc;padding:4px 7px;cursor:pointer}.academy-scan-pages button.on{background:#00c47d;color:#042217}.academy-scan-empty{font-size:.7rem;color:#8094a2;padding:14px}.academy-pro-note{padding:7px 12px;border-bottom:1px solid #1b3540;color:#8fa5b1;font:.6rem ui-monospace}@media(max-width:720px){.academy-monitor{grid-template-columns:1fr}.academy-scan-tools input{min-width:160px}}
#academy-unlock{margin-left:0;border:2px solid #75f5bf;background:#00c47d;color:#042217;box-shadow:0 0 14px rgba(0,196,125,.25)}body.academy-tools-open{overflow:hidden}body.academy-tools-open main{position:fixed;inset:0;z-index:2147483000;width:100vw;height:100dvh;background:#070b10}body.academy-tools-open #academy-unlock{position:relative;inset:auto}
/* A lesson is a real layout rail, never an overlay. The chart, quote rail,
   scanner, and options lab all share the same reserved desktop width. */
:root{--academy-lesson-rail:clamp(390px,33vw,520px)}main,.academy-below{width:100%;transition:width .22s ease}.lesson{top:0;right:0;width:var(--academy-lesson-rail);height:100dvh;max-height:none;border-width:0 0 0 1px;border-radius:0;box-shadow:-16px 0 42px rgba(0,0,0,.42);overscroll-behavior:contain;scrollbar-gutter:stable}.lesson.open{display:block}body.academy-lesson-open main,body.academy-lesson-open .academy-below{width:calc(100% - var(--academy-lesson-rail))}body.academy-lesson-open .shell{grid-template-columns:minmax(0,1fr) clamp(205px,18vw,238px)}body.academy-lesson-open .toolbar small{display:none}
.options-chain{scroll-margin-top:12px}.options-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.options-actions{display:flex;align-items:end;gap:7px;flex-wrap:wrap}.options-actions label{display:grid;gap:3px;color:#8fa5b1;font:700 .58rem ui-monospace}.options-actions select{height:32px;border:1px solid #294554;border-radius:5px;background:#0d1720;color:#eaf5f8;padding:4px 7px}.options-actions button{margin-top:0}.options-summary{display:grid;grid-template-columns:repeat(5,minmax(110px,1fr));gap:1px;margin-top:12px;border:1px solid #213744;background:#213744}.options-summary span{padding:8px;background:#0d1720;color:#8fa5b1;font:.59rem ui-monospace}.options-summary b{display:block;margin-top:3px;color:#eef4f7;font-size:.73rem}.options-table-wrap{max-width:100%;margin-top:12px;overflow:auto;border:1px solid #213744;overscroll-behavior:contain}.options-table{width:100%;min-width:1420px;border-collapse:collapse;font:.61rem ui-monospace}.options-table th,.options-table td{padding:7px 8px;border-bottom:1px solid rgba(42,66,78,.55);white-space:nowrap;text-align:right}.options-table th{position:sticky;top:0;z-index:2;background:#13242d;color:#8ee8c1}.options-table th.strike,.options-table td.strike{position:sticky;left:0;z-index:1;text-align:center;background:#11222b;color:#ffd166;font-weight:900}.options-table th.strike{z-index:3}.options-table tr{cursor:pointer}.options-table tbody tr:hover td,.options-table tbody tr.selected td{background:#12352d}.options-table tbody tr.atm td{border-top:1px solid #ffd166;border-bottom:1px solid #ffd166}.options-call{color:#72f2b9}.options-put{color:#ff91a2}.options-contract{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}.options-contract article{padding:10px;border:1px solid #294554;border-radius:7px;background:#0b141c}.options-contract h3{margin:0 0 4px;color:#eef4f7;font-size:.7rem}.options-contract p{font:.63rem/1.45 system-ui}.options-glossary{margin-top:12px;padding:10px;border-left:3px solid #ffca55;background:#111a20;color:#9eb2bc;font:.67rem/1.5 system-ui}.options-error{color:#ff9dae!important}
@media(max-width:1100px){:root{--academy-lesson-rail:380px}body.academy-lesson-open .side{display:none}body.academy-lesson-open .shell{grid-template-columns:1fr}.options-summary{grid-template-columns:repeat(3,1fr)}.options-contract{grid-template-columns:repeat(2,1fr)}}
@media(max-width:820px){body.academy-lesson-open{overflow:hidden}body.academy-lesson-open main,body.academy-lesson-open .academy-below{width:100%}.lesson{width:100%;height:100dvh;border:0;border-radius:0}.options-summary{grid-template-columns:repeat(2,1fr)}.options-contract{grid-template-columns:1fr}}
</style>
 </head><body><main><div class="bar"><i class="dot"></i><strong>Making Easy Money Academy</strong><span>Live Chart Lab · Educational use only</span><button class="lesson-toggle" id="lesson-toggle">Start Class</button><button class="lesson-toggle" id="academy-unlock" type="button">Unlock Academy Tools</button><b class="status" id="status">CONNECTING</b></div><div class="dashbar"><b class="dashbrand">STOCKMARKETLOOP · ANALYST DASHBOARD</b><span class="academy-tag">ACADEMY MODE</span><span class="market-state">READ-ONLY TRAINING</span></div><div class="indices"><div class="index"><b>S&P 500</b><span>via SPY · <em id="idx-spy">—</em></span></div><div class="index"><b>NASDAQ</b><span>via QQQ · <em>LIVE</em></span></div><div class="index"><b>RUSSELL 2000</b><span>via IWM · <em>LIVE</em></span></div><div class="index"><b>MARKET BREADTH</b><span>Live dashboard tools</span></div></div><div class="shell"><section class="chart"><div class="toolbar"><input id="symbol" value="SPY" maxlength="10" aria-label="Ticker symbol"><button id="load">Load</button><span class="quote-chip sell">SELL <i id="sell">—</i></span><span class="quote-chip buy">BUY <i id="buy">—</i></span><small id="company">Live market data · Read-only</small><div class="intervals" aria-label="Chart intervals"><button data-tf="1m">1m</button><button data-tf="3m">3m</button><button data-tf="5m" class="active">5m</button><button data-tf="15m">15m</button><button data-tf="1h">1h</button><button data-tf="1D">1D</button><button data-tf="1W">1W</button><button data-tf="1M">1Mo</button><button data-tf="1Q">1Q</button><button data-tf="1Y">1Y</button></div></div><canvas id="chart" aria-label="Live interactive candlestick chart"></canvas></section><aside class="side"><h2 id="label">$SPY</h2><div class="quote" id="price">—</div><div class="change" id="change">Loading live market data</div><div class="book"><h3>TOP OF BOOK · ACADEMY VIEW</h3><div class="bookrow"><span class="bidtxt">BID</span><span id="bidbook">—</span></div><div class="bookrow"><span>SPREAD</span><span id="spread">—</span></div><div class="bookrow"><span class="asktxt">ASK</span><span id="askbook">—</span></div></div><div class="meta">Chart and Level 2 stay together above the fold. Scroll only for the scanner and options lab.</div></aside></div></main><section class="academy-below" id="academy-below"><h2 class="below-title">SCANNER + OPTIONS LAB</h2><div id="academy-scanner-host"></div><section class="options-chain" id="options-chain"><div class="options-head"><div><h2>College Options Chain Lab</h2><p id="options-status">Unlock Academy Tools, then load a ticker’s verified educational options chain.</p></div><div class="options-actions"><label>Expiration<select id="options-expiry" disabled><option>Load chain first</option></select></label><label>Strikes<select id="options-range"><option value="12">12 around ATM</option><option value="20">20 around ATM</option><option value="40">40 around ATM</option><option value="all">All strikes</option></select></label><button id="load-options" type="button">Load Options Chain</button></div></div><div class="options-summary" id="options-summary" hidden></div><div class="options-table-wrap" id="options-table-wrap" hidden><table class="options-table"><thead><tr><th class="options-call">Call IV</th><th class="options-call">Delta</th><th class="options-call">Gamma</th><th class="options-call">Theta</th><th class="options-call">Vega</th><th class="options-call">Volume</th><th class="options-call">Open Int.</th><th class="options-call">Bid</th><th class="options-call">Ask</th><th class="options-call">Mid</th><th class="strike">Strike</th><th class="options-put">Mid</th><th class="options-put">Bid</th><th class="options-put">Ask</th><th class="options-put">Open Int.</th><th class="options-put">Volume</th><th class="options-put">Vega</th><th class="options-put">Theta</th><th class="options-put">Gamma</th><th class="options-put">Delta</th><th class="options-put">Put IV</th></tr></thead><tbody id="options-grid"></tbody></table></div><div class="options-contract" id="options-contract" hidden></div><div class="options-glossary"><strong>How to read this lab:</strong> midpoint is (bid + ask) ÷ 2; spread % measures execution friction; intrinsic value is immediate exercise value; extrinsic value is midpoint minus intrinsic value; call breakeven is strike + premium and put breakeven is strike − premium. Delta estimates price sensitivity, gamma estimates delta sensitivity, theta estimates time decay, vega estimates implied-volatility sensitivity, and open interest shows outstanding contracts—not directional intent. Values missing from the verified feed stay “—”.</div></section></section><section class="lesson" id="lesson" aria-label="Academy lesson"><small>MODULE 1 · LESSON 1</small><h2 id="lesson-title">How price discovery works</h2><div class="scene"><span class="bid">BID $100.00</span><span class="trade"></span><span class="ask">ASK $100.05</span></div><p id="lesson-copy">A market brings buyers and sellers together. The bid is the price a buyer is offering; the ask is what a seller currently requests. A trade occurs only when the two sides agree.</p><div class="answers" id="answers"><button data-answer="A">A. The bid is a guaranteed future price</button><button data-answer="B">B. The ask is what a seller currently requests</button><button data-answer="C">C. Every quote is a trading signal</button><button data-answer="D">D. The last trade predicts the next trade</button></div><p id="lesson-feedback" aria-live="polite"></p><div class="lesson-controls"><button id="read">Mute Voice</button><button class="alt" id="next-lesson">Next Concept</button><button class="alt" id="close-lesson">Back to Chart</button></div></section><script>
(()=>{const canvas=document.getElementById('chart'),ctx=canvas.getContext('2d'),sym=document.getElementById('symbol'),status=document.getElementById('status'),label=document.getElementById('label'),price=document.getElementById('price'),change=document.getElementById('change'),lesson=document.getElementById('lesson'),lessonTitle=document.getElementById('lesson-title'),lessonCopy=document.getElementById('lesson-copy'),feedback=document.getElementById('lesson-feedback'),answers=document.getElementById('answers');let bars=${initialBars},symbol=${initialSymbol},offset=0,scale=1,drag=null,slide=0;const slides=[['How price discovery works','A market brings buyers and sellers together. The bid is the price a buyer is offering; the ask is the price a seller is requesting. A trade occurs only when the two sides agree.'],['The spread is information','The difference between the bid and ask is called the spread. A narrower spread can indicate more active trading, while a wider spread can mean less liquidity or more uncertainty.'],['Read the chart in context','A candle records open, high, low, and close for a selected period. It describes what already occurred; it does not promise the next move.']];const esc=s=>String(s||'SPY').toUpperCase().replace(/[^A-Z0-9.:-]/g,'').slice(0,10)||'SPY';function renderSlide(){const item=slides[slide];lessonTitle.textContent=item[0];lessonCopy.textContent=item[1];feedback.textContent='';answers.style.display=slide===0?'grid':'none';document.getElementById('next-lesson').textContent=slide===slides.length-1?'Restart Class':'Next Concept'}function resize(){const r=canvas.getBoundingClientRect(),d=devicePixelRatio||1;canvas.width=Math.round(r.width*d);canvas.height=Math.round(r.height*d);ctx.setTransform(d,0,0,d,0);draw()}function draw(){const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;ctx.clearRect(0,0,w,h);if(!bars.length){ctx.fillStyle='#7f98a6';ctx.font='13px system-ui';ctx.fillText('Live market data is temporarily unavailable.',20,32);return}const pad={l:12,r:64,t:18,b:24},pw=w-pad.l-pad.r,ph=h-pad.t-pad.b,n=Math.max(12,Math.min(bars.length,Math.floor(105/scale))),end=Math.max(n,Math.min(bars.length,bars.length-offset)),view=bars.slice(end-n,end);let lo=Math.min(...view.map(b=>+b.l)),hi=Math.max(...view.map(b=>+b.h));if(hi===lo){hi+=1;lo-=1}const y=v=>pad.t+(hi-v)/(hi-lo)*ph;ctx.strokeStyle='rgba(116,153,170,.14)';ctx.lineWidth=1;for(let i=0;i<5;i++){const yy=pad.t+ph*i/4;ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(pad.l+pw,yy);ctx.stroke();ctx.fillStyle='#718694';ctx.font='10px ui-monospace';ctx.fillText((hi-(hi-lo)*i/4).toFixed(2),pad.l+pw+7,yy+3)}const step=pw/view.length;view.forEach((b,i)=>{const x=pad.l+(i+.5)*step,up=+b.c>=+b.o,color=up?'#00d084':'#ff5470';ctx.strokeStyle=color;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(x,y(+b.h));ctx.lineTo(x,y(+b.l));ctx.stroke();const top=y(Math.max(+b.o,+b.c)),bottom=y(Math.min(+b.o,+b.c));ctx.fillRect(x-step*.31,top,Math.max(1,step*.62),Math.max(1,bottom-top))});ctx.fillStyle='#90a5b3';ctx.font='10px ui-monospace';ctx.fillText('LIVE · 5M',pad.l,h-8)}function setQuote(){if(!bars.length){status.textContent='RETRY';change.textContent='Live data is temporarily unavailable';change.style.color='#ffb454';return}const last=bars[bars.length-1],prev=bars[bars.length-2]||last,delta=+last.c-+prev.c,pct=prev.c?(delta/+prev.c)*100:0;sym.value=symbol;label.textContent='$'+symbol;price.textContent='$'+Number(last.c).toFixed(2);change.textContent=(delta>=0?'▲ +':'▼ ')+delta.toFixed(2)+' ('+pct.toFixed(2)+'%)';change.style.color=delta>=0?'#00d084':'#ff5470';status.textContent='LIVE'}function load(){const s=esc(sym.value);location.assign(location.pathname+'?symbol='+encodeURIComponent(s))}document.getElementById('load').onclick=load;sym.addEventListener('keydown',e=>{if(e.key==='Enter')load()});document.getElementById('lesson-toggle').onclick=()=>{lesson.classList.add('open');document.body.classList.add('academy-lesson-open');renderSlide()};document.getElementById('close-lesson').onclick=()=>{lesson.classList.remove('open');document.body.classList.remove('academy-lesson-open')};document.getElementById('next-lesson').onclick=()=>{slide=(slide+1)%slides.length;renderSlide()};document.getElementById('read').onclick=()=>{if(!('speechSynthesis'in window)){feedback.textContent='Read-aloud is unavailable in this Discord browser.';return}speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(lessonTitle.textContent+'. '+lessonCopy.textContent);utterance.rate=.93;speechSynthesis.speak(utterance)};answers.onclick=e=>{const target=e.target.closest('button[data-answer]');if(!target)return;const correct=target.dataset.answer==='B';answers.querySelectorAll('button').forEach(button=>button.className='');target.classList.add(correct?'good':'bad');feedback.textContent=correct?'Correct. The ask is the price a seller currently requests.':'Not quite. The correct answer is B: the ask is what a seller currently requests.'};canvas.addEventListener('wheel',e=>{e.preventDefault();scale=Math.max(.7,Math.min(4,scale*(e.deltaY>0?.86:1.16)));draw()},{passive:false});canvas.addEventListener('pointerdown',e=>{drag=e.clientX;canvas.setPointerCapture(e.pointerId)});canvas.addEventListener('pointermove',e=>{if(drag===null)return;offset=Math.max(0,Math.min(Math.max(0,bars.length-12),offset+Math.round((e.clientX-drag)/8)));drag=e.clientX;draw()});canvas.addEventListener('pointerup',()=>drag=null);new ResizeObserver(resize).observe(canvas);setQuote();draw();setInterval(()=>location.reload(),30000)})();
</script><script>
(()=>{const price=document.getElementById('price'),company=document.getElementById('company'),sell=document.getElementById('sell'),buy=document.getElementById('buy'),bid=document.getElementById('bidbook'),ask=document.getElementById('askbook'),spread=document.getElementById('spread'),idx=document.getElementById('idx-spy'),symbol=document.getElementById('symbol');function quote(){const tf=new URLSearchParams(location.search).get('tf')||'5m',value=Number(String(price.textContent).replace(/[^0-9.]/g,''));if(!Number.isFinite(value)||value<=0)return;const tick=Math.max(.01,value*.0001),bidValue=(value-tick).toFixed(2),askValue=(value+tick).toFixed(2);sell.textContent=bidValue;buy.textContent=askValue;bid.textContent=bidValue;ask.textContent=askValue;spread.textContent=(tick*2).toFixed(4);company.textContent='Live '+tf+' candles · Academy read-only';idx.textContent='LIVE';document.querySelectorAll('[data-tf]').forEach(button=>button.classList.toggle('active',button.dataset.tf===tf))}window.smlAcademyRefreshQuote=quote;document.querySelectorAll('[data-tf]').forEach(button=>button.onclick=()=>window.smlAcademyNavigateMarket?.(symbol.value,button.dataset.tf));quote()})();
</script><script>
/* Preserve the selected timeframe when a learner changes tickers. This runs
   after the compact chart host so it intentionally replaces only its loader. */
(()=>{const symbol=document.getElementById('symbol'),load=document.getElementById('load'),status=document.getElementById('status'),clean=value=>String(value||'SPY').toUpperCase().replace(/[^A-Z0-9.:-]/g,'').slice(0,10)||'SPY';window.smlAcademyNavigateMarket=async(value,requestedTf)=>{const ticker=clean(value),tf=String(requestedTf||new URLSearchParams(location.search).get('tf')||'5m');status.textContent='LOADING';try{const response=await fetch('/academy-activity/market?symbol='+encodeURIComponent(ticker)+'&tf='+encodeURIComponent(tf),{cache:'no-store'}),payload=await response.json();if(!response.ok)throw new Error('market');history.replaceState(null,'',location.pathname+'?symbol='+encodeURIComponent(ticker)+'&tf='+encodeURIComponent(tf));window.smlAcademyApplyMarket?.(payload);window.smlAcademyRefreshQuote?.();status.textContent='LIVE'}catch(_){status.textContent='RETRY'}};const go=()=>window.smlAcademyNavigateMarket(symbol.value);load.onclick=go;symbol.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.stopImmediatePropagation();go()}},true)})();
</script><script>
(()=>{const host=document.getElementById('academy-scanner-host'),source=${initialScanner};if(!host)return;const etfs=new Set(['SPY','QQQ','IWM','DIA','VTI','VOO','XLF','XLE','XLK','XLV','XLI','XLY','XLP','XLU','XLB','SMH','SOXL','SOXS','TQQQ','SQQQ','UVXY','ARKK','GLD','SLV','USO','TLT','HYG','EEM','BITO','IBIT']);let rows=Array.isArray(source)?source:[],tab='stocks',query='',preset='full',colors='red-green',page=1,sortKey='changePct',sortDir=-1;const n=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v),compact=v=>{v=n(v);if(v==null)return'—';if(Math.abs(v)>=1e12)return(v/1e12).toFixed(2)+'T';if(Math.abs(v)>=1e9)return(v/1e9).toFixed(2)+'B';if(Math.abs(v)>=1e6)return(v/1e6).toFixed(2)+'M';if(Math.abs(v)>=1e3)return(v/1e3).toFixed(1)+'K';return String(Math.round(v))},signed=(v,suffix='')=>{v=n(v);return v==null?'—':(v>=0?'+':'')+v.toFixed(2)+suffix},session=()=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date()),x={};parts.forEach(p=>x[p.type]=p.value);if(x.weekday==='Sat'||x.weekday==='Sun')return'CLOSED';const mins=Number(x.hour)*60+Number(x.minute);return mins>=240&&mins<570?'PREMARKET':mins>=570&&mins<960?'MARKET OPEN':mins>=960&&mins<1200?'AFTER HOURS':'CLOSED'},field=(r,k)=>{if(k==='turnover')return n(r.price)*n(r.volume);if(k==='relVolume')return n(r.previousVolume)>0?n(r.volume)/n(r.previousVolume):null;if(k==='preMarketPct')return n(r.open)&&n(r.previousClose)?(n(r.open)-n(r.previousClose))/n(r.previousClose)*100:null;if(k==='sire')return r.sire;return r[k]},columns={core:[['rank','#'],['symbol','Symbol'],['name','Name'],['price','Latest'],['change','Chg'],['changePct','% Chg'],['volume','Volume'],['turnover','Turnover'],['preMarketPct','Pre-Mkt %Chg'],['postMarketPct','Post-Mkt %Chg'],['sire','S.I.R.E']],full:[['rank','#'],['symbol','Symbol'],['name','Name'],['price','Latest'],['change','Chg'],['changePct','% Chg'],['volume','Volume'],['turnover','Turnover'],['preMarketPct','Pre-Mkt %Chg'],['postMarketPct','Post-Mkt %Chg'],['sire','S.I.R.E'],['relVolume','Volume Ratio'],['bid','Bid'],['bidSize','Bid Size'],['ask','Ask'],['askSize','Ask Size']],pro:[['rank','#'],['symbol','Symbol'],['name','Name'],['price','Latest'],['change','Chg'],['changePct','% Chg'],['volume','Volume'],['turnover','Turnover'],['preMarketPct','Pre-Mkt %Chg'],['postMarketPct','Post-Mkt %Chg'],['sire','S.I.R.E'],['relVolume','Volume Ratio'],['bid','Bid'],['bidSize','Bid Size'],['ask','Ask'],['askSize','Ask Size'],['marketCap','Market Cap'],['peTtm','P/E TTM'],['pb','P/B'],['rsi','RSI'],['macd','MACD']]};const panel=document.createElement('section');panel.className='academy-scanner';panel.innerHTML='<div class="academy-scan-head"><strong class="academy-scan-title">LIVE MARKET SCANNER</strong><span class="academy-scan-live">Live stream</span></div><div class="academy-scan-tabs" role="tablist"><button data-tab="stocks" class="on">US STOCKS</button><button data-tab="etfs">ETFS</button><button data-tab="options">OPTIONS</button><button data-tab="premarket">PREMARKET</button><button data-tab="afterhours">AFTER HOURS</button></div><div class="academy-scan-tools"><input id="academy-scan-search" placeholder="Search any U.S. symbol or company..." aria-label="Search scanner"><select id="academy-scan-preset" title="Scanner columns"><option value="core">Core</option><option value="full" selected>Full</option><option value="pro">Pro Screener</option></select><select id="academy-scan-colors" title="Quote color scheme"><option value="red-green">Red / Green</option><option value="pink-green">Pink / Green</option></select><button id="academy-scan-refresh">Refresh</button></div><div class="academy-monitor"><span>BULLISH ALERTS TODAY<b id="academy-bulls">0</b></span><span>BEARISH ALERTS TODAY<b id="academy-bears">0</b></span><span>MARKET STATUS<b id="academy-market-state">'+session()+'</b></span></div><div class="academy-pro-note">Same Analyst Dashboard scanner controls and columns. Unsupported provider fields display — instead of estimated data.</div><div class="academy-scan-wrap"><table class="academy-scan-table"><thead id="academy-scan-head"></thead><tbody id="academy-scan-body"></tbody></table></div><div class="academy-scan-foot"><span id="academy-scan-count"></span><div class="academy-scan-pages" id="academy-scan-pages"></div></div>';host.appendChild(panel);const head=panel.querySelector('#academy-scan-head'),body=panel.querySelector('#academy-scan-body'),count=panel.querySelector('#academy-scan-count'),pages=panel.querySelector('#academy-scan-pages');function cls(v){v=n(v);return v==null?'academy-muted':v>=0?'academy-positive':'academy-negative'}function filtered(){let out=rows.map((r,i)=>({...r,sire:i+1}));if(tab==='etfs')out=out.filter(r=>etfs.has(r.symbol));else if(tab==='stocks')out=out.filter(r=>!etfs.has(r.symbol));else if(tab==='premarket')out=out.filter(r=>field(r,'preMarketPct')!=null).sort((a,b)=>(field(b,'preMarketPct')??-Infinity)-(field(a,'preMarketPct')??-Infinity));else if(tab==='afterhours')out=out.filter(r=>n(r.postMarketPct)!=null).sort((a,b)=>(n(b.postMarketPct)??-Infinity)-(n(a.postMarketPct)??-Infinity));if(query)out=out.filter(r=>(r.symbol+' '+(r.name||'')).toUpperCase().includes(query));out.sort((a,b)=>{const av=field(a,sortKey),bv=field(b,sortKey);if(sortKey==='symbol'||sortKey==='name')return sortDir*String(av||'').localeCompare(String(bv||''));if(av==null&&bv==null)return 0;if(av==null)return 1;if(bv==null)return-1;return sortDir*(Number(av)-Number(bv))});return out}function display(k,v){if(['changePct','preMarketPct','postMarketPct'].includes(k))return signed(v,'%');if(['price','bid','ask'].includes(k))return n(v)==null?'—':Number(v).toFixed(2);if(k==='change')return signed(v);if(['volume','turnover','marketCap'].includes(k))return compact(v);if(['bidSize','askSize'].includes(k))return n(v)==null?'—':compact(Number(v)*100);if(k==='relVolume')return n(v)==null?'—':Number(v).toFixed(2);return v==null||v===''?'—':String(v)}function render(){if(tab==='options'){document.getElementById('options-chain').scrollIntoView({behavior:'smooth',block:'start'});tab='stocks';panel.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('on',b.dataset.tab==='stocks'))}const cols=columns[preset]||columns.full,all=filtered(),per=15,max=Math.max(1,Math.ceil(all.length/per));page=Math.min(page,max);const start=(page-1)*per,shown=all.slice(start,start+per);head.innerHTML='<tr>'+cols.map(([k,label])=>'<th data-sort="'+k+'">'+label+(sortKey===k?(sortDir<0?' ▼':' ▲'):'')+'</th>').join('')+'</tr>';body.innerHTML=shown.map((r,i)=>'<tr data-symbol="'+r.symbol+'">'+cols.map(([k])=>{if(k==='rank')return'<td class="academy-muted">'+(start+i+1)+'</td>';if(k==='symbol')return'<td><span class="academy-scan-symbol">'+r.symbol+'</span></td>';if(k==='name')return'<td><span class="academy-scan-name">'+(r.name||'—')+'</span></td>';const v=field(r,k);return'<td class="'+(['change','changePct','preMarketPct','postMarketPct'].includes(k)?cls(v):'')+'">'+display(k,v)+'</td>'}).join('')+'</tr>').join('')||'<tr><td colspan="'+cols.length+'" class="academy-scan-empty">No verified matches for this view.</td></tr>';count.textContent='Showing '+(all.length?start+1:0)+' to '+Math.min(start+per,all.length)+' of '+all.length+' live results · VERIFIED MARKET FEED';pages.innerHTML='';for(let p=1;p<=Math.min(max,7);p++){const b=document.createElement('button');b.textContent=p;b.className=p===page?'on':'';b.onclick=()=>{page=p;render()};pages.appendChild(b)}panel.querySelector('#academy-bulls').textContent=rows.filter(r=>n(r.changePct)>0).length;panel.querySelector('#academy-bears').textContent=rows.filter(r=>n(r.changePct)<0).length;panel.querySelector('#academy-market-state').textContent=session()}panel.addEventListener('click',e=>{const tabButton=e.target.closest('[data-tab]');if(tabButton){tab=tabButton.dataset.tab;page=1;panel.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('on',b===tabButton));render();return}const th=e.target.closest('[data-sort]');if(th){const key=th.dataset.sort;if(sortKey===key)sortDir*=-1;else{sortKey=key;sortDir=-1}page=1;render();return}const tr=e.target.closest('tr[data-symbol]');if(tr){const symbol=document.getElementById('symbol');symbol.value=tr.dataset.symbol;document.getElementById('load').click()}});panel.querySelector('#academy-scan-search').oninput=e=>{query=String(e.target.value||'').trim().toUpperCase();page=1;render()};panel.querySelector('#academy-scan-preset').onchange=e=>{preset=e.target.value;render()};panel.querySelector('#academy-scan-colors').onchange=e=>{colors=e.target.value;panel.style.setProperty('--academy-down',colors==='pink-green'?'#ff69b4':'#ff778b')};panel.querySelector('#academy-scan-refresh').onclick=()=>location.reload();render()})();
</script><script>
(()=>{const side=document.querySelector('.side'),depth=${initialDepth};if(!side)return;const style=document.createElement('style');style.textContent='.academy-depth{margin-top:14px;border-top:1px solid #1b3540;padding-top:12px}.academy-depth h3{font-size:.68rem;margin:0 0 7px;color:#86a2b0}.academy-depth-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.academy-depth-col b{display:block;font:800 .58rem ui-monospace;margin-bottom:4px}.academy-depth-bid{color:#52e6ad}.academy-depth-ask{color:#ff778b}.academy-depth-row{display:flex;justify-content:space-between;gap:4px;padding:3px 0;border-bottom:1px solid rgba(42,66,78,.45);font:.58rem ui-monospace}.academy-depth-row span:last-child{color:#9db2bd}.academy-depth-empty{font-size:.7rem;color:#8094a2;padding:5px 0}';document.head.appendChild(style);const panel=document.createElement('section');panel.className='academy-depth';const title=document.createElement('h3');title.textContent='LEVEL 2 DEPTH · LIVE';panel.appendChild(title);const bids=Array.isArray(depth.bids)?depth.bids:[],asks=Array.isArray(depth.asks)?depth.asks:[];if(!bids.length&&!asks.length){const empty=document.createElement('div');empty.className='academy-depth-empty';empty.textContent='Level 2 is temporarily unavailable.';panel.appendChild(empty)}else{const grid=document.createElement('div');grid.className='academy-depth-grid';[['BID',bids,'academy-depth-bid'],['ASK',asks,'academy-depth-ask']].forEach(([name,rows,color])=>{const col=document.createElement('div');col.className='academy-depth-col';const head=document.createElement('b');head.className=color;head.textContent=name;col.appendChild(head);rows.slice(0,5).forEach(row=>{const item=document.createElement('div'),p=document.createElement('span'),s=document.createElement('span');item.className='academy-depth-row';p.textContent=Number(row.price).toFixed(2);s.textContent=Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(Number(row.size));item.append(p,s);col.appendChild(item)});grid.appendChild(col)});panel.appendChild(grid)}side.insertBefore(panel,side.querySelector('.meta'))})();
</script><script>
(()=>{const button=document.getElementById('load-options'),grid=document.getElementById('options-grid'),status=document.getElementById('options-status'),symbol=document.getElementById('symbol');if(!button||!grid||!status||!symbol)return;let session='';window.addEventListener('sml-academy-session',event=>{session=String(event.detail&&event.detail.sessionToken||'');if(session)status.textContent='Academy access verified. Choose a ticker and load its educational options chain.'});const clean=value=>String(value||'SPY').toUpperCase().replace(/[^A-Z0-9.:-]/g,'').slice(0,10)||'SPY';const optionRows=value=>{const found=[];const walk=node=>{if(found.length>=24||!node)return;if(Array.isArray(node)){node.forEach(walk);return}if(typeof node!=='object')return;const strike=Number(node.strike??node.strikePrice);if(Number.isFinite(strike))found.push(node);else Object.values(node).forEach(walk)};walk(value);return found};const cell=(text,head=false)=>{const span=document.createElement('span');span.textContent=String(text??'—');if(head)span.className='head';grid.appendChild(span)};button.onclick=async()=>{if(!session){status.textContent='Unlock Academy Tools first so Discord can verify your private Academy access.';return}button.disabled=true;status.textContent='Loading options chain…';try{const response=await fetch('/academy-activity/data/options?symbol='+encodeURIComponent(clean(symbol.value)),{headers:{authorization:'Bearer '+session},cache:'no-store'});const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'unavailable');const rows=optionRows(payload.data);grid.replaceChildren();['Expiry','Strike','Call bid','Call ask','Put bid','Put ask'].forEach(label=>cell(label,true));rows.forEach(row=>{cell(row.expiration??row.expiry??row.date);cell(Number(row.strike??row.strikePrice).toFixed(2));cell(row.callBid??row.call?.bid);cell(row.callAsk??row.call?.ask);cell(row.putBid??row.put?.bid);cell(row.putAsk??row.put?.ask)});grid.hidden=false;status.textContent=rows.length?'Educational chain loaded. Use Module 9 and Module 23 before interpreting it.':'The provider returned no displayable contracts for this ticker.'}catch(_){grid.hidden=true;status.textContent='Options data is temporarily unavailable. The options curriculum remains available in Lessons.'}finally{button.disabled=false}}})();
</script><script>
/* Provider-tolerant, educational options-chain renderer. It accepts paired
   strike rows or separate call/put contracts and never manufactures data. */
(()=>{const button=document.getElementById('load-options'),body=document.getElementById('options-grid'),status=document.getElementById('options-status'),symbol=document.getElementById('symbol'),expiry=document.getElementById('options-expiry'),range=document.getElementById('options-range'),wrap=document.getElementById('options-table-wrap'),summary=document.getElementById('options-summary'),inspector=document.getElementById('options-contract');if(!button||!body)return;let session='',chain=[],spot=null,selected=null;window.addEventListener('sml-academy-session',event=>{session=String(event.detail&&event.detail.sessionToken||'');if(session)status.textContent='Academy access verified. Load a ticker to inspect its verified chain.'});const n=value=>value==null||value===''||!Number.isFinite(Number(value))?null:Number(value),clean=value=>String(value||'SPY').toUpperCase().replace(/[^A-Z0-9.:-]/g,'').slice(0,10)||'SPY',pick=(object,keys)=>{for(const key of keys){const value=object&&object[key];if(value!==undefined&&value!==null&&value!=='')return value}return null},num=(object,keys)=>n(pick(object,keys)),dateOf=object=>String(pick(object,['expiration','expirationDate','expiry','expiryDate','date','expDate'])||'Unknown'),sideFrom=(object,prefix='')=>{const cap=prefix?prefix[0].toUpperCase()+prefix.slice(1):'',nested=object&&object[prefix]&&typeof object[prefix]==='object'?object[prefix]:{},value=(keys)=>num(nested,keys)??num(object,keys.flatMap(key=>prefix?[prefix+key[0].toUpperCase()+key.slice(1),prefix+'_'+key,key+cap]:[key]));return{bid:value(['bid','bidPrice']),ask:value(['ask','askPrice']),last:value(['last','lastPrice','price']),volume:value(['volume','vol']),oi:value(['openInterest','open_interest','oi']),iv:value(['impliedVolatility','implied_volatility','iv']),delta:value(['delta']),gamma:value(['gamma']),theta:value(['theta']),vega:value(['vega'])}},kindOf=object=>String(pick(object,['contractType','optionType','right','side','type'])||'').toLowerCase();function normalize(data){const rows=new Map(),seen=new Set();const add=(object,hint='')=>{if(!object||typeof object!=='object')return;const strike=num(object,['strike','strikePrice','strike_price','exercisePrice']);if(strike==null)return;const exp=dateOf(object),key=exp+'|'+strike,row=rows.get(key)||{expiry:exp,strike,call:null,put:null};const kind=kindOf(object)||hint;if(object.call||object.calls||kind.startsWith('c'))row.call=sideFrom(object.call||object.calls||object,'call');else if(['callBid','callAsk','callIv','callIV','callDelta'].some(key=>object[key]!=null))row.call=sideFrom(object,'call');if(object.put||object.puts||kind.startsWith('p'))row.put=sideFrom(object.put||object.puts||object,'put');else if(['putBid','putAsk','putIv','putIV','putDelta'].some(key=>object[key]!=null))row.put=sideFrom(object,'put');if(row.call||row.put)rows.set(key,row)};const walk=(node,hint='')=>{if(!node||typeof node!=='object'||seen.has(node))return;seen.add(node);if(Array.isArray(node)){node.forEach(item=>walk(item,hint));return}add(node,hint);for(const [key,value] of Object.entries(node)){const lower=key.toLowerCase(),next=lower.includes('call')?'call':lower.includes('put')?'put':hint;walk(value,next)}};walk(data);return[...rows.values()].sort((a,b)=>a.expiry.localeCompare(b.expiry)||a.strike-b.strike)}function findSpot(data){const direct=[data?.underlyingPrice,data?.underlying_price,data?.spotPrice,data?.spot,data?.underlying?.price,data?.quote?.price,data?.data?.underlyingPrice].map(n).find(value=>value!=null);if(direct!=null)return direct;return n(String(document.getElementById('price')?.textContent||'').replace(/[^0-9.-]/g,''))}const mid=side=>side&&side.bid!=null&&side.ask!=null?(side.bid+side.ask)/2:side?.last??null,fmt=(value,digits=2)=>value==null?'—':Number(value).toFixed(digits),whole=value=>value==null?'—':Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(value),pct=value=>value==null?'—':(value*100).toFixed(1)+'%',iso=value=>{const parsed=new Date(value+'T12:00:00');return Number.isNaN(parsed.valueOf())?value:parsed.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})},dte=value=>{const end=new Date(value+'T23:59:59'),now=new Date();return Number.isNaN(end.valueOf())?null:Math.max(0,Math.ceil((end-now)/86400000))};function metric(label,value){const item=document.createElement('span'),b=document.createElement('b');item.textContent=label;b.textContent=value;item.appendChild(b);summary.appendChild(item)}function td(row,text,className=''){const cell=document.createElement('td');cell.textContent=text;if(className)cell.className=className;row.appendChild(cell)}function sideCells(row,side,reverse=false){const values=reverse?[fmt(mid(side)),fmt(side?.bid),fmt(side?.ask),whole(side?.oi),whole(side?.volume),fmt(side?.vega,3),fmt(side?.theta,3),fmt(side?.gamma,3),fmt(side?.delta,3),pct(side?.iv)]:[pct(side?.iv),fmt(side?.delta,3),fmt(side?.gamma,3),fmt(side?.theta,3),fmt(side?.vega,3),whole(side?.volume),whole(side?.oi),fmt(side?.bid),fmt(side?.ask),fmt(mid(side))];values.forEach(value=>td(row,value))}function details(item){if(!item){inspector.hidden=true;return}selected=item;inspector.replaceChildren();const add=(title,text)=>{const article=document.createElement('article'),h=document.createElement('h3'),p=document.createElement('p');h.textContent=title;p.textContent=text;article.append(h,p);inspector.append(article)};const callMid=mid(item.call),putMid=mid(item.put),callIntrinsic=spot==null?null:Math.max(spot-item.strike,0),putIntrinsic=spot==null?null:Math.max(item.strike-spot,0),spread=side=>side?.bid!=null&&side?.ask!=null?side.ask-side.bid:null,spreadPct=side=>{const value=spread(side),center=mid(side);return value!=null&&center>0?value/center:null};add('Contract context',clean(symbol.value)+' · '+iso(item.expiry)+' · '+(dte(item.expiry)??'—')+' DTE · $'+fmt(item.strike)+' strike');add('Call economics','Mid $'+fmt(callMid)+' · spread '+pct(spreadPct(item.call))+' · intrinsic $'+fmt(callIntrinsic)+' · extrinsic $'+fmt(callMid==null||callIntrinsic==null?null:Math.max(0,callMid-callIntrinsic))+' · breakeven $'+fmt(callMid==null?null:item.strike+callMid));add('Put economics','Mid $'+fmt(putMid)+' · spread '+pct(spreadPct(item.put))+' · intrinsic $'+fmt(putIntrinsic)+' · extrinsic $'+fmt(putMid==null||putIntrinsic==null?null:Math.max(0,putMid-putIntrinsic))+' · breakeven $'+fmt(putMid==null?null:item.strike-putMid));add('Risk interpretation','A narrow spread may reduce entry friction. High open interest may improve depth but does not guarantee liquidity. Greeks are model estimates and change as price, time, and implied volatility change.');inspector.hidden=false}function render(){const exp=expiry.value,all=chain.filter(row=>row.expiry===exp),atm=spot==null?0:all.reduce((best,row,index)=>Math.abs(row.strike-spot)<Math.abs(all[best]?.strike-spot)?index:best,0),limit=range.value==='all'?all.length:Number(range.value),start=Math.max(0,Math.min(all.length-limit,atm-Math.floor(limit/2))),rows=all.slice(start,start+limit);body.replaceChildren();rows.forEach(item=>{const tr=document.createElement('tr');if(item===selected)tr.classList.add('selected');if(all[atm]===item)tr.classList.add('atm');sideCells(tr,item.call);td(tr,fmt(item.strike),'strike');sideCells(tr,item.put,true);tr.onclick=()=>{body.querySelectorAll('tr').forEach(row=>row.classList.remove('selected'));tr.classList.add('selected');details(item)};body.appendChild(tr)});wrap.hidden=!rows.length;summary.replaceChildren();metric('Underlying',spot==null?'—':'$'+fmt(spot));metric('Expiration',iso(exp));metric('Days to expiry',String(dte(exp)??'—'));metric('Contracts shown',String(rows.length));metric('ATM reference',all[atm]?'$'+fmt(all[atm].strike):'—');summary.hidden=!rows.length;if(rows.length)details(all[atm]||rows[0]);status.classList.remove('options-error');status.textContent=rows.length?'Verified chain loaded. Select any strike for derived economics and risk interpretation.':'No displayable contracts were returned for this expiration.'}range.onchange=render;expiry.onchange=render;button.onclick=async()=>{if(!session){status.classList.add('options-error');status.textContent='Unlock Academy Tools first so Discord can verify private Academy access.';return}button.disabled=true;status.classList.remove('options-error');status.textContent='Loading verified options contracts…';try{const response=await fetch('/academy-activity/data/options?symbol='+encodeURIComponent(clean(symbol.value)),{headers:{authorization:'Bearer '+session},cache:'no-store'}),payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'unavailable');chain=normalize(payload.data);spot=findSpot(payload.data);const expirations=[...new Set(chain.map(row=>row.expiry))].sort();expiry.replaceChildren();expirations.forEach(value=>{const option=document.createElement('option');option.value=value;option.textContent=iso(value)+' · '+(dte(value)??'—')+' DTE';expiry.appendChild(option)});expiry.disabled=!expirations.length;selected=null;render();if(!chain.length)throw new Error('empty')}catch(error){wrap.hidden=true;summary.hidden=true;inspector.hidden=true;status.classList.add('options-error');status.textContent=error.message==='empty'?'The provider returned data, but no recognized call/put contracts. Check the bridge mapping.':'Options data is temporarily unavailable. Check Academy bridge authorization and provider entitlement.'}finally{button.disabled=false}}})();
</script><script type="module">
import { DiscordSDK } from '/academy-activity/sdk/index.mjs';
const academyAppId=${academyAppId};
const academyStatus=document.getElementById('status');
/* One Discord SDK instance per Activity. Sign-in failures show a plain
   recovery message in the top bar (the bar wraps, so the chart shrinks rather
   than being covered) and retry only when the member asks. */
let academySdk=null,academyAuthInflight=null;
const academyNoticeText={
  academy_role_required:['ACCESS REQUIRED','Academy lessons are for Making Easy Money members. The chart and scanner stay open; your lesson progress starts saving once your membership role is active in this server.','Check again'],
  authorization_required:['SIGN-IN NEEDED','Discord sign-in did not finish, so your lesson progress cannot save yet.','Sign in again'],
  authorization_failed:['SIGN-IN NEEDED','Discord sign-in did not finish, so your lesson progress cannot save yet.','Sign in again'],
  authorization_denied:['SIGN-IN NEEDED','Discord sign-in was cancelled, so your lesson progress cannot save yet.','Sign in again'],
  outside_discord:['OPEN IN DISCORD','Open the Academy from the Making Easy Money Discord server to save your lesson progress.',''],
  temporary_unavailable:['OFFLINE','Academy sign-in is temporarily unavailable. The chart still works; try again in a moment to save your progress.','Retry']
};
function academyNotice(code){
  const bar=document.querySelector('main .bar');let notice=document.getElementById('academy-auth-notice');
  if(!code){if(notice)notice.remove();if(bar)bar.style.flexWrap='';return}
  const entry=academyNoticeText[code]||academyNoticeText.temporary_unavailable;
  if(academyStatus)academyStatus.textContent=entry[0];
  if(!bar)return;
  if(!notice){notice=document.createElement('div');notice.id='academy-auth-notice';notice.setAttribute('role','status');notice.style.cssText='order:99;flex:1 1 100%;display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;padding:.35rem .1rem 0;color:#ffd7a1;font-size:.78rem;line-height:1.35';bar.appendChild(notice)}
  bar.style.flexWrap='wrap';
  const text=document.createElement('div');text.textContent=entry[1];text.style.flex='1 1 260px';
  notice.replaceChildren(text);
  if(entry[2]){const retry=document.createElement('button');retry.type='button';retry.textContent=entry[2];retry.style.cssText='border:1px solid #75f5bf;background:#0b2a20;color:#dffbee;border-radius:6px;padding:.25rem .6rem;font:inherit;cursor:pointer';retry.onclick=()=>{retry.disabled=true;void authenticateAcademyActivity()};notice.appendChild(retry)}
}
async function academySignIn(){
  if(!academySdk){academySdk=new DiscordSDK(academyAppId);await academySdk.ready()}
  const authorization=await academySdk.commands.authorize({client_id:academyAppId,response_type:'code',prompt:'none',scope:['identify','guilds.members.read']});
  const response=await fetch('/academy-activity/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:authorization.code})});
  let payload={};try{payload=await response.json()}catch(_){}
  if(!response.ok||!payload.ok||!payload.access_token||!payload.sessionToken){const code=payload.error||(response.status>=500?'temporary_unavailable':'authorization_failed');throw Object.assign(new Error(code),{academyCode:code})}
  await academySdk.commands.authenticate({access_token:payload.access_token});
  return payload.sessionToken;
}
function authenticateAcademyActivity(){
  if(academyAuthInflight)return academyAuthInflight;
  academyAuthInflight=(async()=>{
    if(!academyAppId){if(academyStatus)academyStatus.textContent='AUTH UNAVAILABLE';return ''}
    try{
      if(academyStatus)academyStatus.textContent='VERIFYING';
      const sessionToken=await academySignIn();
      window.smlAcademySessionToken=sessionToken;
      document.body.dataset.academyAuth='ready';
      academyNotice('');
      window.dispatchEvent(new CustomEvent('sml-academy-session',{detail:{sessionToken}}));
      if(academyStatus)academyStatus.textContent='LIVE';
      return sessionToken;
    }catch(error){
      const raw=String(error&&(error.academyCode||error.message)||'');
      const code=error&&error.academyCode?raw:(/frame_id|instance_id|platform/i.test(raw)?'outside_discord':(/cancel|denied|5000|4002/i.test(raw)?'authorization_denied':'temporary_unavailable'));
      document.body.dataset.academyAuth=code.replace(/[^a-z0-9_-]/gi,'').slice(0,64);
      academyNotice(code);
      return '';
    }finally{academyAuthInflight=null}
  })();
  return academyAuthInflight;
}
/* Sessions last 15 minutes. Any Academy request that gets a 401 calls this
   once to renew silently (prompt:none) before retrying; concurrent callers
   share one renewal, and the renewal re-checks the member's role. */
window.smlAcademyReauth=()=>authenticateAcademyActivity();
/* External links from inside a Discord Activity must go through the SDK -
   the sandboxed iframe swallows plain window.open. Outside Discord (no
   frame_id) a normal new tab is correct. */
window.smlAcademyOpenExternal=async(url)=>{
  const inDiscord=new URLSearchParams(location.search).has('frame_id');
  if(inDiscord){
    try{
      if(!academySdk){academySdk=new DiscordSDK(academyAppId);await academySdk.ready()}
      await academySdk.commands.openExternalLink({url});
      return true;
    }catch(_){/* fall through to a plain tab attempt */}
  }
  try{window.open(url,'_blank','noopener');return true}catch(_){return false}
};
void authenticateAcademyActivity();
</script></body></html>`
    .replace("#academy-unlock{", "body.academy-tools-open .lesson{z-index:2147483600}#academy-unlock{")
    .replace("ctx.setTransform(d,0,0,d,0)", "ctx.setTransform({a:d,b:0,c:0,d:d,e:0,f:0})")
    .replace("d=devicePixelRatio||1;canvas.width=", "d=1;canvas.width=")
    .replace("canvas.addEventListener('wheel',e=>{e.preventDefault();scale=Math.max(.7,Math.min(4,scale*(e.deltaY>0?.86:1.16)));draw()},{passive:false})", "canvas.addEventListener('wheel',()=>{},{passive:true})")
    .replace("function load(){const s=esc(sym.value);location.assign(location.pathname+'?symbol='+encodeURIComponent(s))}", "function load(){window.smlAcademyNavigateMarket?.(esc(sym.value))}")
    .replace("new ResizeObserver(resize).observe(canvas);setQuote();draw()", "const chartObserver=new ResizeObserver(resize);chartObserver.observe(canvas);window.addEventListener('resize',resize);document.addEventListener('visibilitychange',()=>{if(!document.hidden)resize()});requestAnimationFrame(resize);setTimeout(resize,250);setTimeout(resize,1000);setQuote();draw()")
    .replace('function renderSlide()', "window.smlAcademyChartState=()=>({bars:bars.slice(),symbol,offset,scale});window.smlAcademyApplyMarket=payload=>{if(!payload||!Array.isArray(payload.bars)||!payload.bars.length)return;bars=payload.bars.slice(-600);symbol=esc(payload.symbol||sym.value);offset=0;setQuote();resize();window.smlAcademyRefreshQuote?.();window.dispatchEvent(new CustomEvent('sml-academy-market',{detail:{bars:bars.slice(),symbol}}))};queueMicrotask(()=>window.dispatchEvent(new CustomEvent('sml-academy-market',{detail:{bars:bars.slice(),symbol}})));function renderSlide()")
    .replace('setInterval(()=>location.reload(),30000)', "let refreshPending=false;const keepWarm=async()=>{if(refreshPending||(document.hidden&&window.smlAcademyChartState&&window.smlAcademyChartState().bars.length))return;refreshPending=true;try{const query=new URLSearchParams(location.search),symbol=query.get('symbol')||'SPY',tf=query.get('tf')||'5m';const response=await fetch('/academy-activity/market?symbol='+encodeURIComponent(symbol)+'&tf='+encodeURIComponent(tf),{cache:'no-store'}),payload=await response.json();if(!response.ok)throw new Error('market');window.smlAcademyApplyMarket?.(payload);document.getElementById('status').textContent='LIVE'}catch{document.getElementById('status').textContent='RETRY'}finally{refreshPending=false}};keepWarm();setInterval(keepWarm,5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)keepWarm()})")
    .replace("page=1,sortKey='changePct'", "page=1,sortKey='changeRate3min'")
    .replace("if(k==='sire')return r.sire", "if(k==='sire')return r.changeRate3min")
    .replace("rows.map((r,i)=>({...r,sire:i+1}))", "rows.map(r=>({...r}))")
    .replace("sideFrom(object.call||object.calls||object,'call')", "sideFrom(object.call||object.calls||object,object.call||object.calls?'':'call')")
    .replace("sideFrom(object.put||object.puts||object,'put')", "sideFrom(object.put||object.puts||object,object.put||object.puts?'':'put')")
    .replaceAll("['rank','#'],", '')
    .replaceAll("['sire','S.I.R.E']", "['sire','S.I.R.E 3m %']")
    .replace("['changePct','preMarketPct','postMarketPct'].includes(k)", "['changePct','preMarketPct','postMarketPct','sire'].includes(k)")
    .replace("['macd','MACD']]", "['macd','MACD'],['high52','52wk High'],['low52','52wk Low'],['chg5mPct','% Chg 5M'],['chg5dPct','% Chg 5D'],['chg10dPct','% Chg 10D'],['chg20dPct','% Chg 20D'],['chg60dPct','% Chg 60D'],['chg120dPct','% Chg 120D'],['chg250dPct','% Chg 250D'],['ytdPct','YTD Chg'],['handTurnover','Hand Turnover'],['amplitude','Amplitude'],['peLyr','PE LYR'],['divYield','Dividend Yield'],['roe','ROE'],['roa','ROA'],['netMargin','Net Margin'],['grossMargin','Gross Margin'],['revenueGrowth','Revenue Growth'],['epsGrowth','EPS Growth'],['assetTurnover','Asset Turnover'],['inventoryTurnover','Inventory Turnover'],['currentRatio','Current Ratio'],['quickRatio','Quick Ratio'],['ma20','MA20'],['ma50','MA50'],['institutionalHoldings','Institutional Holdings'],['insiderHoldings','Insider Holdings'],['profitRatio','Profit Ratio'],['overlapDegree','Degree of Overlap']]")
    .replace("panel.querySelector('#academy-scan-refresh').onclick=()=>location.reload();render()", "window.smlAcademyScannerRows=()=>rows.slice();const refreshScanner=async()=>{const badge=panel.querySelector('.academy-scan-live');badge.textContent='Refreshing';try{const response=await fetch('/academy-activity/scanner',{cache:'no-store'}),payload=await response.json();if(!response.ok||!Array.isArray(payload.rows))throw new Error('unavailable');rows=payload.rows;render();window.dispatchEvent(new CustomEvent('sml-academy-scanner-update'));badge.textContent='Live stream'}catch(_){badge.textContent='Reconnecting'}};panel.querySelector('#academy-scan-refresh').onclick=refreshScanner;render();window.dispatchEvent(new CustomEvent('sml-academy-scanner-update'));refreshScanner();setInterval(()=>{if(!document.hidden)refreshScanner()},4000)")
    .replaceAll('The provider returned no displayable contracts for this ticker.', 'No contracts are available for this ticker.')
    .replaceAll('No displayable contracts were returned for this expiration.', 'No contracts are available for this expiration.')
    .replaceAll('The provider returned data, but no recognized call/put contracts. Check the bridge mapping.', 'No compatible call or put contracts are available for this symbol.')
    .replaceAll('Options data is temporarily unavailable. Check Academy bridge authorization and provider entitlement.', 'Options data is temporarily unavailable. Try again shortly.')
    .replace('</body></html>', `<script>(()=>{const unlock=document.getElementById('academy-unlock'),state=document.querySelector('.market-state');if(!unlock||!state)return;let open=false;const render=()=>{document.body.classList.toggle('academy-tools-open',open);unlock.textContent=open?'Close Academy Tools':'Unlock Academy Tools';unlock.setAttribute('aria-pressed',String(open));state.textContent=open?'LIVE INTERACTIVE ACADEMY':'READ-ONLY TRAINING';state.style.color=open?'#52e6ad':'#ffbf5d'};unlock.onclick=()=>{open=!open;render()};render()})()</script></body></html>`);
}

function injectAcademyCurriculum(body) {
  const lessons = JSON.stringify(SEED_LESSONS.map((lesson) => ({
    moduleId: lesson.moduleId,
    lessonId: lesson.lessonId,
    title: lesson.title,
    steps: lesson.steps,
    question: lesson.question
  }))).replace(/</g, '\\u003c');
  const script = `<script>(()=>{const lessons=${lessons};const panel=document.getElementById('lesson'),toggle=document.getElementById('lesson-toggle'),meta=panel&&panel.querySelector('small'),title=document.getElementById('lesson-title'),copy=document.getElementById('lesson-copy'),answers=document.getElementById('answers'),feedback=document.getElementById('lesson-feedback'),next=document.getElementById('next-lesson');if(!panel||!toggle||!meta||!title||!copy||!answers||!feedback||!next||!lessons.length)return;toggle.textContent='Lessons ('+lessons.length+')';const picker=document.createElement('select');picker.id='lesson-select';picker.className='lesson-picker';picker.setAttribute('aria-label','Choose an Academy lesson');lessons.forEach((lesson,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent='Module '+lesson.moduleId+' · Lesson '+lesson.lessonId+' — '+lesson.title;picker.appendChild(option)});title.parentNode.insertBefore(picker,title);const previous=document.createElement('button');previous.id='previous-lesson';previous.className='alt';previous.textContent='Previous Lesson';next.parentNode.insertBefore(previous,next);let current=0;const render=()=>{const lesson=lessons[current];picker.value=String(current);meta.textContent='MODULE '+lesson.moduleId+' · LESSON '+lesson.lessonId+' · '+(current+1)+' OF '+lessons.length;title.textContent=lesson.title;copy.textContent=lesson.steps.join('\\n\\n')+'\\n\\nPractice: '+lesson.question.prompt;feedback.textContent='';answers.replaceChildren();Object.entries(lesson.question.options).forEach(([key,value])=>{const button=document.createElement('button');button.dataset.answer=key;button.textContent=key+'. '+value;answers.appendChild(button)});answers.style.display='grid';previous.disabled=current===0;next.textContent=current===lessons.length-1?'Restart Curriculum':'Next Lesson'};toggle.onclick=()=>{panel.classList.add('open');render()};picker.onchange=()=>{current=Math.max(0,Math.min(lessons.length-1,Number(picker.value)||0));render()};previous.onclick=()=>{current=Math.max(0,current-1);render()};next.onclick=()=>{current=(current+1)%lessons.length;render()};answers.onclick=event=>{const target=event.target.closest('button[data-answer]');if(!target)return;const lesson=lessons[current],correct=target.dataset.answer===lesson.question.correct;answers.querySelectorAll('button').forEach(button=>button.className='');target.classList.add(correct?'good':'bad');feedback.textContent=correct?'Correct. '+lesson.question.explanation:'Not quite. The correct answer is '+lesson.question.correct+': '+lesson.question.options[lesson.question.correct]+'. '+lesson.question.explanation};render()})()</script>`;
  return body.replace('</body></html>', `${script}</body></html>`);
}

function sendHtml(response, status, body) {
  /* Academy Activity replaces the legacy canvas with the real dashboard.
     Avoid attaching its obsolete ResizeObserver during that handoff. */
  const strippedBody = typeof body === 'string'
    ? body.replace('new ResizeObserver(resize).observe(canvas);', '')
    : body;
  /* Function replacers: a string replacement would treat `$'`, `$&`, `$$` and
     `$\`` inside the injected scripts as substitution patterns (for example
     rest.includes('$') would be served as rest.includes(')) and break them. */
  const safeBody = typeof strippedBody === 'string' && strippedBody.includes('id="lesson"')
    ? strippedBody.replace('<body>', () => `<body>${academyIntroMarkup()}`).replace('</body></html>', () => `${academyCurriculumScript(SEED_LESSONS)}${academyCartoonVisualsScript()}${academyVisualLabScript()}${academyChartIntelligenceScript()}${academyQuoteStatisticsScript()}</body></html>`)
    : strippedBody;
  const payload = zlib.gzipSync(Buffer.from(safeBody), { level: zlib.constants.Z_BEST_SPEED });
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': payload.length,
    'content-encoding': 'gzip',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; frame-src 'none'; frame-ancestors https://discord.com https://*.discord.com https://*.discordapp.com; base-uri 'none'; form-action 'none'",
    'x-content-type-options': 'nosniff'
  });
  response.end(payload);
}

function academyDisciplinePlayerHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#060a0d"><title>Daily Discipline Audio</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% 0,#173526 0,#07100d 38%,#030608 80%);color:#f3f7f5;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;display:grid;place-items:center;padding:24px}.player{width:min(720px,100%);border:1px solid #254b3b;border-radius:22px;background:rgba(5,12,10,.96);box-shadow:0 24px 80px #0009;overflow:hidden}.hero{padding:28px;background:linear-gradient(135deg,#11291f,#07110e);border-bottom:1px solid #214332}.eyebrow{color:#57eea9;font-size:.75rem;font-weight:900;letter-spacing:.14em}.hero h1{margin:.35rem 0 .4rem;font-size:clamp(1.75rem,6vw,3rem);line-height:1.05}.summary{margin:0;color:#a9bbb4}.body{padding:24px}.progress{height:8px;background:#14241e;border-radius:999px;overflow:hidden}.progress span{display:block;height:100%;width:0;background:linear-gradient(90deg,#00c978,#69ffb9);transition:width .25s}.time{display:flex;justify-content:space-between;color:#8fa39b;font-size:.78rem;margin:.55rem 0 1.5rem}.controls{display:flex;align-items:center;justify-content:center;gap:12px}.controls button{border:0;border-radius:999px;cursor:pointer;font-weight:900}.play{width:92px;height:92px;background:#00d084;color:#03130c;font-size:1.15rem;box-shadow:0 0 34px #00d08455}.skip{width:48px;height:48px;background:#17251f;color:#e9fff6}.status{min-height:1.5em;text-align:center;color:#9db0a8;margin:18px 0 0}.note{margin:22px 0 0;padding:14px;border-left:3px solid #00d084;background:#0a1712;color:#b8c8c1;font-size:.88rem}.done{color:#66f4b3;font-weight:800}.error{color:#ff8d95}</style></head><body><main class="player"><header class="hero"><div class="eyebrow">MAKING EASY MONEY ACADEMY · DAILY DISCIPLINE</div><h1 id="title">Preparing your episode…</h1><p class="summary" id="summary">Your position will be restored automatically.</p></header><section class="body"><div class="progress"><span id="bar"></span></div><div class="time"><span id="elapsed">0:00</span><span id="part">Loading</span></div><div class="controls"><button class="skip" id="back" aria-label="Back 15 seconds">−15</button><button class="play" id="play">PLAY</button><button class="skip" id="forward" aria-label="Forward 15 seconds">+15</button></div><p class="status" id="status">Loading your private progress…</p><p class="note">Keep this player open and the audio can continue while you browse other Discord text channels. Your place is saved automatically. Educational content only—not financial advice.</p><audio id="audio" preload="auto"></audio></section></main><script>
(()=>{const token=new URLSearchParams(location.search).get('token')||'',audio=document.getElementById('audio'),play=document.getElementById('play'),status=document.getElementById('status'),title=document.getElementById('title'),summary=document.getElementById('summary'),bar=document.getElementById('bar'),elapsed=document.getElementById('elapsed'),part=document.getElementById('part');let state=null,saving=false,lastSaved=0;const fmt=v=>{const s=Math.max(0,Math.floor(Number(v)||0));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')},api=(path,options={})=>fetch(path+(path.includes('?')?'&':'?')+'token='+encodeURIComponent(token),{cache:'no-store',...options}),setStatus=(copy,kind='')=>{status.textContent=copy;status.className='status '+kind},audioUrl=i=>'/academy-discipline/speech?episode='+state.episode.id+'&part='+i+'&token='+encodeURIComponent(token);const save=async completed=>{if(!state||saving)return;saving=true;try{await api('/academy-discipline/progress',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({episodeId:state.episode.id,partIndex:state.partIndex,playbackMs:Math.round(audio.currentTime*1000),completed:Boolean(completed)})});lastSaved=Date.now()}catch{}finally{saving=false}};const render=()=>{play.textContent=audio.paused?'PLAY':'PAUSE';elapsed.textContent=fmt(audio.currentTime);part.textContent='Part '+(state.partIndex+1)+' of '+state.episode.partCount;bar.style.width=((state.partIndex+(audio.duration?audio.currentTime/audio.duration:0))/state.episode.partCount*100)+'%'},loadPart=(index,resume=0,autoplay=false)=>{state.partIndex=index;audio.src=audioUrl(index);audio.onloadedmetadata=()=>{audio.currentTime=Math.min(Math.max(0,resume/1000),Math.max(0,audio.duration-.2));render();if(autoplay)void audio.play()};audio.load();if(index+1<state.episode.partCount){const next=new Audio();next.preload='auto';next.src=audioUrl(index+1)}};play.onclick=()=>{if(audio.paused)audio.play().catch(()=>setStatus('Tap Play again to allow audio.','error'));else audio.pause()};document.getElementById('back').onclick=()=>audio.currentTime=Math.max(0,audio.currentTime-15);document.getElementById('forward').onclick=()=>audio.currentTime=Math.min(audio.duration||0,audio.currentTime+15);audio.ontimeupdate=()=>{render();if(Date.now()-lastSaved>10000)void save(false)};audio.onplay=()=>{setStatus('Now playing. Your place is being saved.');render()};audio.onpause=()=>{void save(false);render()};audio.onended=()=>{if(state.partIndex+1<state.episode.partCount){void save(false);loadPart(state.partIndex+1,0,true)}else{void save(true);bar.style.width='100%';play.textContent='DONE';play.disabled=true;setStatus(state.nextAvailable?'Episode complete. Your next episode unlocks tomorrow.':'Episode complete. Your progress is saved; the next recording will appear when it is added.','done')}};addEventListener('pagehide',()=>{if(state)navigator.sendBeacon('/academy-discipline/progress?token='+encodeURIComponent(token),new Blob([JSON.stringify({episodeId:state.episode.id,partIndex:state.partIndex,playbackMs:Math.round(audio.currentTime*1000),completed:false})],{type:'application/json'}))});api('/academy-discipline/state').then(r=>r.json().then(j=>{if(!r.ok)throw new Error(j.error||'unavailable');return j})).then(payload=>{state=payload.state;title.textContent=state.episode.title;summary.textContent=state.episode.summary;if(state.completed){play.textContent='DONE';play.disabled=true;bar.style.width='100%';setStatus(state.nextAvailable?'Completed. The next episode unlocks tomorrow.':'Completed. The next recording will appear when it is added.','done');return}loadPart(state.partIndex,state.playbackMs);setStatus('Ready. Press Play to begin.');if('mediaSession'in navigator)navigator.mediaSession.metadata=new MediaMetadata({title:state.episode.title,artist:'Making Easy Money Academy',album:'Daily Discipline'})}).catch(()=>setStatus('This private player link expired. Return to the Daily Discipline channel and open it again.','error'))})();
</script></body></html>`;
}

function sendAcademyIntro(request, response) {
  let stat;
  try { stat = fs.statSync(ACADEMY_INTRO_PATH); } catch (_) { return sendJson(response, 404, { ok: false, error: 'not_found' }); }
  const size = stat.size;
  const etag = `"academy-intro-${size}-${Math.floor(stat.mtimeMs)}"`;
  const common = {
    'content-type': 'video/mp4',
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=31536000, immutable',
    etag,
    'x-content-type-options': 'nosniff'
  };
  if (!request.headers.range && request.headers['if-none-match'] === etag) {
    response.writeHead(304, common);
    response.end();
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(request.headers.range || ''));
  let start = 0;
  let end = size - 1;
  if (request.headers.range) {
    if (!match || (!match[1] && !match[2])) {
      response.writeHead(416, { ...common, 'content-range': `bytes */${size}` });
      response.end();
      return;
    }
    if (!match[1]) {
      const suffix = Math.min(size, Number(match[2]));
      start = size - suffix;
    } else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(size - 1, Number(match[2]));
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
      response.writeHead(416, { ...common, 'content-range': `bytes */${size}` });
      response.end();
      return;
    }
  }
  const partial = Boolean(request.headers.range);
  const length = end - start + 1;
  response.writeHead(partial ? 206 : 200, {
    ...common,
    'content-length': length,
    ...(partial ? { 'content-range': `bytes ${start}-${end}/${size}` } : {})
  });
  if (request.method === 'HEAD') { response.end(); return; }
  fs.createReadStream(ACADEMY_INTRO_PATH, { start, end }).pipe(response);
}

function sendAcademyBanner(request, response) {
  let stat;
  try { stat = fs.statSync(ACADEMY_BANNER_PATH); } catch (_) { return sendJson(response, 404, { ok: false, error: 'not_found' }); }
  const etag = `"mem-academy-banner-${stat.size}-${Math.floor(stat.mtimeMs)}"`;
  const headers = {
    'content-type': 'image/gif',
    'content-length': stat.size,
    'cache-control': 'public, max-age=31536000, immutable',
    etag,
    'x-content-type-options': 'nosniff'
  };
  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, headers);
    response.end();
    return;
  }
  response.writeHead(200, headers);
  if (request.method === 'HEAD') { response.end(); return; }
  fs.createReadStream(ACADEMY_BANNER_PATH).pipe(response);
}

function academyIntroMarkup() {
  return `<div class="academy-intro" id="academy-intro" role="dialog" aria-label="Making Easy Money Academy introduction"><div class="academy-intro-rail academy-intro-rail-left"><b>LEARN</b><span>PRACTICE</span><span>STRATEGIZE</span></div><video id="academy-intro-video" autoplay playsinline preload="auto"><source src="/academy-activity/assets/making-easy-money-academy-intro.mp4" type="video/mp4"></video><div class="academy-intro-rail academy-intro-rail-right"><b>EXECUTE</b><span>REVIEW</span><span>GROW</span></div><div class="academy-intro-fallback" id="academy-intro-fallback" hidden><strong>Making Easy Money Academy</strong><span>Tap to begin with sound</span><button id="academy-intro-play" type="button">PLAY INTRO</button></div><button class="academy-intro-skip" id="academy-intro-skip" type="button">Skip intro</button><span class="academy-intro-loading" aria-live="polite">Preparing live chart, scanner, lessons, and Academy tools…</span></div><style>
.academy-intro{position:fixed;inset:0;z-index:2147483647;display:block;overflow:hidden;background:radial-gradient(circle at 50% 45%,#153a2d 0,#07130f 34%,#020609 74%);opacity:1;transition:opacity .38s ease}.academy-intro:before{content:'';position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,255,151,.09) 1px,transparent 1px),linear-gradient(rgba(0,255,151,.06) 1px,transparent 1px);background-size:42px 42px;mask-image:linear-gradient(90deg,#000,transparent 44%,transparent 56%,#000);pointer-events:none}.academy-intro.closing{opacity:0;pointer-events:none}.academy-intro video{position:absolute;left:50%;top:50%;z-index:2;display:block;width:0;height:0;max-width:none;max-height:none;transform:translate(-50%,-50%);object-fit:fill;background:#020609;border:1px solid rgba(71,255,173,.38);border-radius:8px;box-shadow:0 0 52px rgba(0,255,151,.2)}.academy-intro-rail{display:none;position:absolute;z-index:1;top:50%;transform:translateY(-50%);width:clamp(130px,16vw,300px);gap:clamp(8px,2vh,20px);color:#8af5c6;font:800 clamp(.65rem,1.05vw,1rem) ui-monospace;letter-spacing:.12em;text-align:center}.academy-intro-rail b{color:#fff;font-size:1.25em}.academy-intro-rail span{color:#6ba990}.academy-intro-rail-left{left:2vw}.academy-intro-rail-right{right:2vw}.academy-intro.banner-mode .academy-intro-rail{display:grid}.academy-intro-skip{position:absolute;z-index:5;right:max(18px,env(safe-area-inset-right));top:max(16px,env(safe-area-inset-top));padding:8px 12px;border:1px solid rgba(255,255,255,.5);border-radius:999px;background:rgba(0,0,0,.58);color:#fff;font:800 .72rem system-ui;cursor:pointer}.academy-intro-loading{position:absolute;z-index:5;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);width:min(92%,620px);padding:8px 12px;border-radius:999px;background:rgba(0,0,0,.7);color:#baf7da;text-align:center;font:700 .66rem system-ui;letter-spacing:.02em}.academy-intro-fallback{position:absolute;z-index:4;inset:0;display:grid;place-content:center;gap:12px;text-align:center;background:radial-gradient(circle,#0c3b2b,#020609 70%)}.academy-intro-fallback[hidden]{display:none}.academy-intro-fallback strong{font-size:clamp(1.3rem,4vw,2.8rem)}.academy-intro-fallback span{color:#a6bbc5}.academy-intro-fallback button{justify-self:center;padding:11px 20px;border:1px solid #43e6a1;border-radius:8px;background:#00c47d;color:#032318;font-weight:900;cursor:pointer}@media(max-width:799px),(max-aspect-ratio:2/1){.academy-intro-rail{display:none!important}.academy-intro video{border-radius:0;box-shadow:none}}@media(prefers-reduced-motion:reduce){.academy-intro{transition:none}.academy-intro video{display:none}.academy-intro-fallback{display:grid!important}}
</style><script>(()=>{const overlay=document.getElementById('academy-intro'),video=document.getElementById('academy-intro-video'),fallback=document.getElementById('academy-intro-fallback'),play=document.getElementById('academy-intro-play'),skip=document.getElementById('academy-intro-skip');if(!overlay||!video)return;let finished=false;const fitVideo=()=>{const box=overlay.getBoundingClientRect(),ratio=(video.videoWidth&&video.videoHeight?video.videoWidth/video.videoHeight:16/9),availableWidth=Math.max(1,box.width),availableHeight=Math.max(1,box.height);overlay.classList.toggle('banner-mode',availableWidth/availableHeight>=2&&availableWidth>=800);let width=availableWidth,height=width/ratio;if(height>availableHeight){height=availableHeight;width=height*ratio}video.style.width=Math.floor(width)+'px';video.style.height=Math.floor(height)+'px'};const warmUrls=['/academy-activity/curriculum?v=${ACADEMY_CURRICULUM_VERSION}','/academy-activity/market?symbol=SPY&tf=5m','/academy-activity/scanner','/academy-activity/slide-design?moduleId=${ACADEMY_FIRST_LESSON.moduleId}&lessonId=${ACADEMY_FIRST_LESSON.lessonId}'];window.smlAcademyWarmPromise=Promise.allSettled(warmUrls.map((url,index)=>fetch(url,{cache:index===0||index===3?'force-cache':'no-store'})));const finish=()=>{if(finished)return;finished=true;overlay.classList.add('closing');setTimeout(()=>overlay.remove(),420);window.dispatchEvent(new Event('sml-academy-intro-complete'))};const attempt=()=>video.play().then(()=>{fallback.hidden=true}).catch(()=>{fallback.hidden=false});video.addEventListener('loadedmetadata',fitVideo,{once:true});video.addEventListener('ended',finish,{once:true});video.addEventListener('error',()=>{fallback.hidden=false});addEventListener('resize',fitVideo,{passive:true});window.visualViewport?.addEventListener('resize',fitVideo,{passive:true});new ResizeObserver(fitVideo).observe(overlay);play?.addEventListener('click',attempt);skip?.addEventListener('click',finish);fitVideo();if(matchMedia('(prefers-reduced-motion: reduce)').matches)fallback.hidden=false;else void attempt();setTimeout(()=>{if(video.readyState===0)fallback.hidden=false},3000)})()</script>`;
}

function sendAcademySdkModule(response, requestPath) {
  const relative = requestPath.slice('/academy-activity/sdk/'.length);
  if (!/^[A-Za-z0-9_./-]+\.mjs$/.test(relative) || relative.includes('..')) {
    sendJson(response, 404, { ok: false, error: 'not_found' });
    return;
  }
  const absolute = pathModule.resolve(ACADEMY_SDK_ROOT, relative);
  if (!absolute.startsWith(`${pathModule.resolve(ACADEMY_SDK_ROOT)}${pathModule.sep}`) && absolute !== pathModule.resolve(ACADEMY_SDK_ROOT, 'index.mjs')) {
    sendJson(response, 404, { ok: false, error: 'not_found' });
    return;
  }
  try {
    const payload = fs.readFileSync(absolute);
    response.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'content-length': payload.length,
      'cache-control': 'public, max-age=86400, immutable',
      'x-content-type-options': 'nosniff'
    });
    response.end(payload);
  } catch (_) {
    sendJson(response, 404, { ok: false, error: 'not_found' });
  }
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

async function handleMemberEmailRequest(request, response, options, action) {
  if (!options.memberEmail) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
  if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
  const body = await readRequestBody(request, 128 * 1024);
  if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
  const verified = verifySignature({ secret: options.billingApiSecret,
    timestamp: request.headers['x-sml-timestamp'], signature: request.headers['x-sml-signature'],
    rawBody: body.rawBody, now: options.now() });
  if (!verified.ok) { sendJson(response, verified.status, { ok: false, error: verified.error }); return; }
  let input;
  try { input = JSON.parse(body.rawBody); if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid'); }
  catch (_) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
  try { sendJson(response, 200, { ok: true, ...(await action(input)) }); }
  catch (error) {
    const invalid = error instanceof TypeError;
    options.logger(invalid ? 'warn' : 'error', 'member_email_request_failed', { error });
    sendJson(response, invalid ? 400 : 503, { ok: false, error: invalid ? 'invalid_request' : 'temporary_unavailable' });
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
  paypalWebhook = null, upgradeChatWebhook = null, discordInteractions = null, disputeDiscordInteractions = null, dailySocialPayoutsInteractions = null,
  disputeService = null, schemaVersion = null, corporate = null, corporateConflictCodes = null,
  academyAccess = null, academyOAuth = null, academyDataBridge = null, academyProgress = null, academyVoice = null, academyOrderFlow = null, academyAlerts = null,
  academyDiscipline = null,
  academySlideDesigner = null, academyAppId = '',
  memberEmail = null,
  logger = log, now = Date.now }) {
  return http.createServer(async (request, response) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    const billingOptions = { billingApiSecret, stripe, pool, upgradeChat, upgradeChatPlanMap, logger, now };
    const connectOptions = { billingApiSecret, pool, logger, now };
    if (request.method === 'GET' && (path === '/academy-discipline' || path === '/academy-discipline/')) {
      sendHtml(response, 200, academyDisciplinePlayerHtml());
      return;
    }
    if ((request.method === 'GET' && path === '/academy-discipline/state') || (request.method === 'POST' && path === '/academy-discipline/progress')) {
      const token = new URL(request.url || '/', 'http://localhost').searchParams.get('token');
      if (!academyDiscipline?.configured) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      try {
        const claims = await academyDiscipline.resolveToken(token);
        if (!claims.ok) { sendJson(response, 401, { ok: false, error: claims.code }); return; }
        if (request.method === 'GET') {
          sendJson(response, 200, { ok: true, state: await academyDiscipline.read(claims.userId, claims.guildId) });
          return;
        }
        if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
        const body = await readRequestBody(request, 4096);
        if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
        let input;
        try { input = JSON.parse(body.rawBody); } catch (_) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
        sendJson(response, 200, { ok: true, state: await academyDiscipline.save(claims.userId, claims.guildId, input) });
      } catch (error) {
        const invalid = error instanceof TypeError;
        logger(invalid ? 'warn' : 'error', 'academy_discipline_progress_failed', { error });
        sendJson(response, invalid ? 400 : 503, { ok: false, error: invalid ? 'invalid_progress' : 'temporary_unavailable' });
      }
      return;
    }
    if (request.method === 'GET' && path === '/academy-discipline/speech') {
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      if (!academyVoice?.configured || !academyDiscipline?.configured) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      let claims = null;
      try {
        claims = await academyDiscipline.resolveToken(params.get('token'));
        if (!claims.ok) { sendJson(response, 401, { ok: false, error: claims.code }); return; }
        const state = await academyDiscipline.read(claims.userId, claims.guildId);
        if (Number(params.get('episode')) !== state.episode.id) throw new TypeError('episode is not unlocked');
        const result = await academyVoice.getDisciplineAudio({ episodeId: params.get('episode'), partIndex: params.get('part'), userId: claims.userId });
        response.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': result.audio.length, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff', 'x-academy-voice-cache': result.cached ? 'hit' : 'miss' });
        response.end(result.audio);
      } catch (error) {
        const invalid = error instanceof TypeError;
        const limited = error?.code === 'rate_limited' || error?.code === 'provider_rate_limited';
        logger(invalid ? 'warn' : 'error', 'academy_discipline_voice_failed', { error, userId: claims?.userId || null });
        sendJson(response, invalid ? 400 : (limited ? 429 : 503), { ok: false, error: invalid ? 'invalid_audio_part' : (limited ? 'rate_limited' : 'voice_temporarily_unavailable') });
      }
      return;
    }
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
    if (request.method === 'POST' && path === '/v1/daily-social-payouts/interactions') {
      if (!dailySocialPayoutsInteractions) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const body = await readRequestBody(request, dailySocialPayoutsModule.MAX_BODY_BYTES);
      if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
      await dailySocialPayoutsInteractions.handle(request, response, body.rawBody);
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
    const memberEmailOptions = { billingApiSecret, memberEmail, logger, now };
    if (request.method === 'POST' && path === '/v1/member-email/analytics') {
      await handleMemberEmailRequest(request, response, memberEmailOptions, (input) => memberEmail.analytics(input));
      return;
    }
    if (request.method === 'POST' && path === '/v1/member-email/sync') {
      await handleMemberEmailRequest(request, response, memberEmailOptions, (input) => memberEmail.syncProviderRecords(input.limit));
      return;
    }
    if (request.method === 'POST' && path === '/v1/member-email/consent') {
      await handleMemberEmailRequest(request, response, memberEmailOptions, (input) => memberEmail.recordMarketingConsent(input));
      return;
    }
    if (request.method === 'POST' && path === '/v1/member-email/queue-renewals') {
      await handleMemberEmailRequest(request, response, memberEmailOptions, (input) => memberEmail.queueRenewals(input.daysBefore));
      return;
    }
    if (request.method === 'POST' && path === '/v1/member-email/special-offer') {
      await handleMemberEmailRequest(request, response, memberEmailOptions, (input) => memberEmail.queueSpecialOffer(input));
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

    if (request.method === 'GET' && path.startsWith('/academy-activity/sdk/')) {
      sendAcademySdkModule(response, path);
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && path === '/academy-activity/assets/making-easy-money-academy-intro.mp4') {
      sendAcademyIntro(request, response);
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && path === '/academy-activity/assets/mem-academy-banner.gif') {
      sendAcademyBanner(request, response);
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/curriculum') {
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': academyCurriculumPayloadGzip.length,
        'content-encoding': 'gzip',
        'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
        'x-content-type-options': 'nosniff'
      });
      response.end(academyCurriculumPayloadGzip);
      return;
    }

    /* Discord's Activity proxy always enters at `/`, even when the configured
       origin contains a path. Keep the canonical path for ordinary browser
       previews, but serve the same no-store Activity document at the proxy
       root so Discord never receives the API's JSON 404 page. */
    if (request.method === 'GET' && (path === '/' || path === '/academy-activity/')) {
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      const symbol = params.get('symbol') || 'SPY';
      const timeframe = params.get('tf') || '5m';
      const [market, scanner, depth] = await Promise.all([
        settleWithin(getAcademyCandles(symbol, timeframe), 1_800),
        settleWithin(getAcademyScanner(), 650),
        settleWithin(getAcademyDepth(symbol), 650)
      ]);
      if (market.status !== 'fulfilled') logger('warn', 'academy_activity_initial_market_failed', { error: market.reason });
      if (scanner.status !== 'fulfilled') logger('warn', 'academy_activity_scanner_failed', { error: scanner.reason });
      if (depth.status !== 'fulfilled') logger('warn', 'academy_activity_depth_failed', { error: depth.reason });
      const activity = market.status === 'fulfilled' ? market.value : { symbol, tf: timeframe, bars: [] };
      activity.scanner = scanner.status === 'fulfilled' ? scanner.value : { rows: [] };
      activity.depth = depth.status === 'fulfilled' ? depth.value : { bids: [], asks: [] };
      sendHtml(response, 200, academyActivityHtml(activity, { appId: academyAppId }));
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/moomoo') {
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      const symbol = String(params.get('symbol') || 'SPY').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 10) || 'SPY';
      sendHtml(response, 200, academyMoomooLaunchHtml(symbol));
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

    if (request.method === 'POST' && path === '/academy-activity/report') {
      const bucket = Math.floor(Date.now() / 60_000), ip = String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || '').split(',')[0].trim();
      if (academyReportLimit.bucket !== bucket) { academyReportLimit.bucket = bucket; academyReportLimit.n = new Map(); }
      const seen = (academyReportLimit.n.get(ip) || 0) + 1; academyReportLimit.n.set(ip, seen);
      const body = await readRequestBody(request, 1024);
      if (seen <= 5 && body.ok) {
        let info = {}; try { info = JSON.parse(body.rawBody) || {}; } catch (_) { /* text/plain beacons only */ }
        if (info.kind === 'perf') {
          const n = (v, d = 1) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10 ** d) / 10 ** d : null);
          const layers = {}; if (info.by && typeof info.by === 'object') for (const k of ['candles', 'indicators', 'memalgo']) if (k in info.by) layers[k] = n(info.by[k]);
          logger('info', 'academy_chart_perf', { fps: n(info.fps), p95: n(info.p95), worst: n(info.worst), frames: n(info.n, 0), layersMs: n(info.layers), proMs: n(info.pro), layers, dpr: n(info.dpr), cap: n(info.cap), w: n(info.w, 0), h: n(info.h, 0), tf: String(info.tf || '').slice(0, 4), bars: n(info.bars, 0), view: n(info.view, 0), mem: !!info.mem, patterns: !!info.patterns, ua: String(info.ua || '').slice(0, 90) });
        } else {
        logger('warn', 'academy_chart_client_blank', { kind: String(info.kind || '').slice(0, 24), w: Number(info.w), h: Number(info.h), symbol: String(info.symbol || '').slice(0, 10), tf: String(info.tf || '').slice(0, 4), misses: Number(info.misses), hidden: !!info.hidden, ua: String(info.ua || '').slice(0, 120) });
        }
      }
      response.writeHead(204, { 'cache-control': 'no-store' }); response.end();
      return;
    }

    /* The poster's Discord avatar, re-served from our own origin because the Activity's CSP blocks images from other hosts. Only avatars of people who posted an alert can be requested. */
    if (request.method === 'GET' && path === '/academy-activity/alerts/avatar') {
      const aid = String(new URL(request.url || '/', 'http://localhost').searchParams.get('a') || '').replace(/[^0-9]/g, '').slice(0, 24);
      const image = academyAlerts && aid ? await academyAlerts.avatar(aid).catch(() => null) : null;
      if (!image) { response.writeHead(404, { 'cache-control': 'public, max-age=300' }); response.end(); return; }
      response.writeHead(200, { 'content-type': image.type, 'cache-control': 'public, max-age=21600', 'content-length': image.body.length, 'x-content-type-options': 'nosniff' });
      response.end(image.body);
      return;
    }

    /* The alerts desk: the trader's posted alerts with risk grade, checklist and plan. Members only (the same Academy session as the options chain). */
    if (request.method === 'GET' && path === '/academy-activity/alerts') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (!academyAlerts) { sendJson(response, 503, { ok: false, error: 'alerts_disabled' }); return; }
      const id = new URL(request.url || '/', 'http://localhost').searchParams.get('detail');
      try {
        if (id) {
          const one = await academyAlerts.detail(String(id).replace(/[^0-9]/g, '').slice(0, 24));
          if (!one) { sendJson(response, 404, { ok: false, error: 'alert_not_found' }); return; }
          sendJson(response, 200, { ok: true, alert: one });
        } else sendJson(response, 200, academyAlerts.snapshot());
      } catch (error) { logger('error', 'academy_alerts_request_failed', { error }); sendJson(response, 503, { ok: false, error: 'alerts_temporarily_unavailable' }); }
      return;
    }

    /* Tick-by-tick view: newest book levels and individual prints, polled by the Activity about once a second. Read-only, never cached. */
    if (request.method === 'GET' && path === '/academy-activity/live') {
      if (!academyOrderFlow) { sendJson(response, 503, { ok: false, error: 'orderflow_disabled' }); return; }
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      try { sendJson(response, 200, academyOrderFlow.live(params.get('symbol'))); }
      catch (error) { sendJson(response, error instanceof TypeError ? 400 : 503, { ok: false, error: error instanceof TypeError ? 'invalid_symbol' : 'temporary_unavailable' }); }
      return;
    }

    /* Level 2 reading (pulling & stacking, absorption, bid/ask flip) for the MEM ALGO panel. Read-only, public like the chart, never cached. */
    if (request.method === 'GET' && path === '/academy-activity/orderflow') {
      if (!academyOrderFlow) { sendJson(response, 503, { ok: false, error: 'orderflow_disabled' }); return; }
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      try { sendJson(response, 200, academyOrderFlow.get(params.get('symbol'))); }
      catch (error) { sendJson(response, error instanceof TypeError ? 400 : 503, { ok: false, error: error instanceof TypeError ? 'invalid_symbol' : 'temporary_unavailable' }); }
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/scanner') {
      try {
        sendJson(response, 200, await getAcademyScanner());
      } catch (error) {
        logger('error', 'academy_scanner_request_failed', { error });
        sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
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

    if (request.method === 'POST' && path === '/academy-activity/token') {
      if (!academyOAuth || typeof academyOAuth.completeActivity !== 'function') { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
      const body = await readRequestBody(request, 4096);
      if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
      let input;
      try { input = JSON.parse(body.rawBody); } catch (_) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
      try {
        const result = await academyOAuth.completeActivity({ code: input.code });
        logger(result.ok ? 'info' : 'warn', result.ok ? 'academy_activity_oauth_completed' : 'academy_activity_oauth_refused', {
          ...(result.ok ? {} : { code: result.code, status: result.status })
        });
        sendJson(response, result.ok ? 200 : (result.status || 401), result.ok
          ? { ok: true, access_token: result.accessToken, sessionToken: result.sessionToken }
          : { ok: false, error: result.code });
      } catch (error) {
        logger('error', 'academy_activity_oauth_failed', { error });
        sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
      }
      return;
    }

    if ((request.method === 'GET' || request.method === 'POST') && path === '/academy-activity/progress') {
      if (!academyOAuth || !academyProgress || !academyProgress.configured) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      try {
        if (request.method === 'GET') {
          const [progress, student] = await Promise.all([academyProgress.read(session.userId), typeof academyProgress.state === 'function' ? academyProgress.state(session.userId) : null]);
          sendJson(response, 200, { ok: true, progress, student });
          return;
        }
        if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
        const body = await readRequestBody(request, 4096);
        if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
        let input;
        try { input = JSON.parse(body.rawBody); } catch (_) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
        const lessonExists = SEED_LESSONS.some((lesson) => lesson.moduleId === Number(input.moduleId) && lesson.lessonId === Number(input.lessonId));
        if (!lessonExists) { sendJson(response, 400, { ok: false, error: 'invalid_lesson' }); return; }
        sendJson(response, 200, { ok: true, progress: await academyProgress.save(session.userId, input) });
      } catch (error) {
        const invalid = error instanceof TypeError;
        logger(invalid ? 'warn' : 'error', 'academy_progress_request_failed', { error });
        sendJson(response, invalid ? 400 : 503, { ok: false, error: invalid ? 'invalid_progress' : 'temporary_unavailable' });
      }
      return;
    }

    if (request.method === 'POST' && path === '/academy-activity/resume') {
      if (!academyOAuth || !academyProgress || typeof academyProgress.saveResume !== 'function') { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
      const body = await readRequestBody(request, 1024);
      if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
      let input;
      try { input = JSON.parse(body.rawBody); } catch (_) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
      try {
        sendJson(response, 200, { ok: true, resume: await academyProgress.saveResume(session.userId, input) });
      } catch (error) {
        const invalid = error instanceof TypeError;
        if (!invalid) logger('error', 'academy_resume_request_failed', { error });
        sendJson(response, invalid ? 400 : 503, { ok: false, error: invalid ? 'invalid_resume' : 'temporary_unavailable' });
      }
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/speech') {
      if (!academyVoice || !academyVoice.configured) {
        sendJson(response, 503, { ok: false, error: 'integration_unconfigured' });
        return;
      }
      const authorization = String(request.headers.authorization || '').trim();
      let voiceUserId;
      if (authorization) {
        const session = academyOAuth && academyOAuth.verifySession(authorization);
        if (!session || !session.ok) {
          sendJson(response, session?.status || 401, { ok: false, error: session?.code || 'authorization_required' });
          return;
        }
        voiceUserId = session.userId;
      } else {
        const forwarded = String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown').split(',')[0].trim();
        const userAgent = String(request.headers['user-agent'] || '').slice(0, 160);
        voiceUserId = `anonymous:${crypto.createHash('sha256').update(`${forwarded}\0${userAgent}`).digest('hex').slice(0, 24)}`;
      }
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      try {
        const result = await academyVoice.getLessonAudio({
          moduleId: params.get('moduleId'), lessonId: params.get('lessonId'), userId: voiceUserId
        });
        response.writeHead(200, {
          'content-type': 'audio/mpeg',
          'content-length': result.audio.length,
          'cache-control': 'private, max-age=86400',
          'x-content-type-options': 'nosniff',
          'x-academy-voice-cache': result.cached ? 'hit' : 'miss',
          'x-academy-part-ms': Array.isArray(result.partMs) ? result.partMs.join(',') : ''
        });
        response.end(result.audio);
      } catch (error) {
        const invalid = error instanceof TypeError;
        const limited = error && (error.code === 'rate_limited' || error.code === 'provider_rate_limited');
        logger(invalid ? 'warn' : 'error', 'academy_voice_request_failed', {
          error, userId: voiceUserId, moduleId: params.get('moduleId'), lessonId: params.get('lessonId')
        });
        sendJson(response, invalid ? 400 : (limited ? 429 : 503), {
          ok: false, error: invalid ? 'invalid_lesson' : (limited ? 'rate_limited' : 'voice_temporarily_unavailable')
        });
      }
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/slide-design') {
      if (!academySlideDesigner || !academySlideDesigner.configured) {
        sendJson(response, 503, { ok: false, error: 'integration_unconfigured' });
        return;
      }
      const session = academyOAuth && academyOAuth.verifySession(request.headers.authorization);
      if (!session || !session.ok) {
        sendJson(response, session?.status || 401, { ok: false, error: session?.code || 'authorization_required' });
        return;
      }
      const designUserId = session.userId;
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      try {
        const result = await academySlideDesigner.getLessonDesign({
          moduleId: params.get('moduleId'), lessonId: params.get('lessonId'), userId: designUserId
        });
        sendJson(response, 200, { ok: true, cached: result.cached, ...result.design });
      } catch (error) {
        const invalid = error instanceof TypeError;
        const limited = error && (error.code === 'rate_limited' || error.code === 'provider_rate_limited');
        logger(invalid ? 'warn' : 'error', 'academy_slide_design_failed', {
          error, userId: designUserId, moduleId: params.get('moduleId'), lessonId: params.get('lessonId')
        });
        sendJson(response, invalid ? 400 : (limited ? 429 : 503), {
          ok: false, error: invalid ? 'invalid_lesson' : (limited ? 'rate_limited' : 'design_temporarily_unavailable')
        });
      }
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
        ...(process.env.RENDER_GIT_COMMIT ? { release: process.env.RENDER_GIT_COMMIT } : {}),
        ...(getLastCleanupResult() ? { connectActivityCleanup: getLastCleanupResult() } : {}),
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
  let memberEmail = null;
  if (config.memberEmailEnabled && config.memberEmailEncryptionKey && config.memberEmailHashKey) {
    memberEmail = createMemberEmailService({ pool: database.pool,
      encryptionKey: config.memberEmailEncryptionKey, hashKey: config.memberEmailHashKey,
      sender: createResendSender({ apiKey: config.resendApiKey, from: config.memberEmailFrom,
        replyTo: config.memberEmailReplyTo }), siteUrl: config.wordpressUrl,
      businessAddress: config.memberEmailBusinessAddress, logger: log });
  }
  log('info', 'member_email_runtime', { enabled: !!memberEmail,
    delivery: !!(config.resendApiKey && config.memberEmailFrom) });
  const { createAlertRouter } = require('./alert-router');
  const alertRouter = createAlertRouter(database.pool);
  const { createDisputeRuntime } = require('./dispute-runtime');
  const disputes = createDisputeRuntime({ config, pool: database.pool, stripe, upgradeChat, logger: log });
  const connectInteractions = disputes.discordInteractions;
  const dailySocialPayoutsInteractions = config.dailySocialPayoutsEnabled
    ? dailySocialPayoutsModule.createDailySocialPayoutsInteractions({ config, pool: database.pool }) : null;
  const academyAccess = createAcademyAccess({ guildId: config.academyGuildId, allowedRoleIds: [config.academyManagerRoleId, config.academyMonarchRoleId] });
  const academyOAuth = createAcademyOAuth({ clientId: config.academyAppId, clientSecret: config.academyClientSecret,
    redirectUri: config.discordRedirectUri, academyAccess });
  const { createAcademyDataBridge } = require('./academy-data-bridge');
  const academyDataBridge = createAcademyDataBridge({ baseUrl: config.academyBridgeUrl, secret: config.academyBridgeSecret });
  const academyProgress = createAcademyProgress({ pool: database.pool, guildId: config.academyGuildId });
  const orderFlowStore = createOrderFlowStore({ pool: database.pool });
  const academyOrderFlow = process.env.ACADEMY_ORDERFLOW === 'off' ? null : createOrderFlowService({ origin: REDDIT_HUB_ORIGIN, store: orderFlowStore, logger: log });
  const alertTokens = [['alerts', config.alertsBotToken], ['connect', config.discordConnectBotToken], ['discord', config.discordBotToken], ['academy', config.academyBotToken]].filter(([, t]) => t).map(([label, token]) => ({ label, token }));
  const academyAlerts = process.env.ACADEMY_ALERTS === 'off' ? null : createAlertsService({
    tokens: alertTokens, channels: defaultChannels(), origin: REDDIT_HUB_ORIGIN, optionsChain: async (symbol) => { const r = await academyDataBridge.get('options', symbol); return r && r.ok ? r.data : null; }, candles: (symbol, tf) => getAcademyCandles(symbol, tf), logger: log,
    orderFlow: (symbol) => (academyOrderFlow ? academyOrderFlow.peek(symbol) : null),
    patterns: (() => { try { return require('./academy-patterns').detect; } catch (_) { return null; } })()
  });
  const academyVoice = createAcademyVoice({
    apiKey: config.elevenLabsApiKey, voiceId: config.academyVoiceId,
    modelId: config.academyVoiceModel, lessons: SEED_LESSONS
  });
  const academyDiscipline = createDisciplineProgress({ pool: database.pool });
  const academySlideDesigner = createAcademySlideDesigner({
    apiKey: config.anthropicApiKey, model: config.academyClaudeModel, lessons: SEED_LESSONS
  });
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
    acceptStripeEvent: disputes.wrapStripeAccept(async (event) => {
      const status = await database.acceptStripeEvent(event);
      if (memberEmail) {
        try { await memberEmail.upsert(stripeContact(event), event.id); }
        catch (error) { log('error', 'member_email_stripe_sync_failed', { error, eventId: event.id }); }
      }
      return status;
    }),
    paypalWebhook: disputes.paypalWebhook,
    upgradeChatWebhook: disputes.upgradeChatWebhook,
    discordInteractions: connectInteractions,
    disputeDiscordInteractions: disputes.disputeDiscordInteractions,
    dailySocialPayoutsInteractions,
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
    academyAccess, academyOAuth, academyDataBridge, academyProgress, academyVoice, academySlideDesigner, academyOrderFlow, academyAlerts,
    academyDiscipline,
    academyAppId: config.academyAppId,
    memberEmail
  });
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'shutdown_started', { signal });
    if (academyOrderFlow) academyOrderFlow.stop();
    if (academyAlerts) academyAlerts.stop();
    server.close(async () => {
      await database.close();
      log('info', 'shutdown_complete', { signal });
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  server.listen(config.port, () => {
    log('info', 'api_started', { port: config.port });
    startAcademyChartWarmers(log);
    if (academyOrderFlow) {
      academyOrderFlow.start();
    }
    if (academyAlerts) academyAlerts.start();
    if (academyOrderFlow) {
      const pruneTimer = setInterval(() => { orderFlowStore.prune(90).catch(() => {}); }, 24 * 3_600_000);
      if (pruneTimer.unref) pruneTimer.unref();
    }
    if (config.discordConnectBotToken) {
      cleanupConnectActivityMessages({ token: config.discordConnectBotToken, apply: true })
        .then((result) => log('info', 'connect_activity_cleanup_complete', result))
        .catch((error) => log('error', 'connect_activity_cleanup_failed', { error }));
    }
  });
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
  handleMemberEmailRequest,
  DISPUTE_ACTIONS,
  calculateWindowChange,
  calculateThreeMinuteChange
};
