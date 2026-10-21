'use strict';

const http = require('node:http');
const fs = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { monitorEventLoopDelay } = require('node:perf_hooks');
/* event-loop lag histogram, enabled by main() beside the memory telemetry: a stalled loop is what makes a synchronous route take seconds */
let loopMonitor = null;
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
const { createAcademyAccess, createIdentityAccess, createAcademyContentGate, ANALYST_TIERS } = require('./academy-access');
const { createLoopKickBridge } = require('./loop-kick-bridge');
const { createLoopKickConnect } = require('./loop-kick-connect');
const { createAcademyOAuth, createBillingHandoff } = require('./academy-oauth');
const { SEED_LESSONS } = require('./academy/curriculum');
const { academyCurriculumScript, academyCurriculumVersion } = require('./academy-activity-curriculum');
const { academyVisualLabScript } = require('./academy-visual-lab');
const { academyCartoonVisualsScript } = require('./academy-cartoon-visuals');
const { academySceneVisualsScript } = require('./academy-scene-visuals');
const { academyChartIntelligenceScript } = require('./academy-chart-intelligence');
const { academyQuoteStatisticsScript } = require('./academy-quote-statistics');
const { createAcademyProgress } = require('./academy-progress');
const { createOrderFlowService } = require('./academy-order-flow-service');
const { createOrderFlowStore } = require('./academy-order-flow-store');
const { createProfileWall } = require('./academy-profile-wall');
const { createDepthStore } = require('./academy-depth-store');
const { createDepthRecorder, parseSymbols: parseDepthSymbols } = require('./academy-depth-recorder');
const { replayDepth, dayBoundsNewYork } = require('./academy-depth-replay');
const { createFlowDaily } = require('./academy-flow-daily');
const { createSignalOutcomes } = require('./academy-signal-outcomes');
const { createMassiveStream } = require('./academy-massive-stream');
const { createSireFeed } = require('./academy-sire-feed');
const { createBrokerLinks, brokerLaunchHtml, moomooQuoteUrl, webullUrl, cleanSymbol: cleanBrokerSymbol } = require('./academy-brokers');
const { createDataHealth } = require('./data-health');
const { isMarketOpen, marketState, dayInfo: marketDayInfo } = require('./market-clock');
const { sanitizeBars, annotateCandles } = require('./data-quality');
const { sseWrite, sseEvent } = require('./sse-safe');
const { createPopoutService, validModule: validPopoutModule, validSymbol: validPopoutSymbol } = require('./academy-popout');
const { cleanLayout: cleanAcademyLayout, cleanScope: cleanLayoutScope, layoutKey: academyLayoutKey } = require('./academy-layout');
const { createCandleRecap } = require('./academy-candle-recap');
const { createSessionRecap } = require('./academy-session-recap');
const { createPersonaBots } = require('./academy-persona-bots');
const { createEditions } = require('./academy-editions');
const { createAutoTrade, createMoomooSimBroker } = require('./academy-autotrade');
const { createMarketDirectionV2 } = require('./academy-market-direction-v2');
const { createStoryDesk, createLettersPublisher, createPolisher } = require('./academy-story-desk');
const articleChart = require('./academy-article-chart');
const { createArticleWriter } = require('./academy-article-writer');
const { createNewsHeat } = require('./academy-story-engine');
const POPOUT_BASE = (() => { const u = String(process.env.SML_ACADEMY_POPOUT_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, ''); return /^https:\/\/[a-z0-9.-]+$/i.test(u) ? u : 'https://sml-platform-api.onrender.com'; })();
const { createPgStateStore } = require('./academy-state-store');
const { createPushService } = require('./academy-push');
const { createSentimentService, createSentimentMemory } = require('./academy-sentiment');
const { createGammaService } = require('./academy-gamma');
const { analyze: analyzeSmartIntent } = require('./academy-smart-intent');
const { createPatternLive } = require('./academy-pattern-live');
const { darkPoolSummary: liveDarkPoolSummary } = require('./academy-dark-pool-summary');
const { averageVolume: averageDailyVolume } = require('./academy-gamma');
const { createInstitutionalService } = require('./academy-institutional');
const { createFilingsService, DEFAULT_SEC_UA } = require('./academy-filings');
const { createFdaService } = require('./academy-fda');
const { createCatalystRadar } = require('./academy-catalyst-radar');
const { createChallenge, buildTradeEvent: buildChallengeTradeEvent } = require('./academy-challenge');
const challengePost = require('./academy-challenge-post');
const { createPaperService } = require('./academy-paper');
const challengeCard = require('./academy-challenge-card');
const memAlgoEngine = require('./academy-mem-algo');
const memSignalsLib = (() => { try { return require('./academy-mem-signals'); } catch (_) { return null; } })();
const patternsLib = (() => { try { return require('./academy-patterns'); } catch (_) { return null; } })();
const { createRedditService, mergeSocial } = require('./academy-reddit');
const { createClassifier } = require('./academy-classifier');
const { createEarningsPlaybook } = require('./academy-earnings-playbook');
const { createEarningsInsight } = require('./academy-earnings-insight');
const { createShortInsight } = require('./academy-short-insight');
const { createSqueezeList } = require('./academy-squeeze-list');
const { createPageAssets } = require('./academy-page-assets');
const { createEvolve } = require('./academy-evolve');
const { createGroupTools, GroupToolsInputError } = require('./academy-group-tools');
const { createMarketGauges, createVixFetcher, changeFromDaily } = require('./market-gauges');
const { createMarketDirection, massiveSnapshots } = require('./market-direction');
const { createWideScanner, createSharedSnapshot, clampLimit: clampScannerLimit } = require('./academy-scanner-wide');
const { createVolIndex } = require('./academy-vol-index');
const dataHealth = createDataHealth({ soft: { 'massive-indices': [401, 403], 'wordpress-history': [500] } });
const { createDataRateLimit } = require('./data-rate-limit');
const { createAppIdentity } = require('./app-identity');
const { createAppAuth, createAppSessionStore } = require('./app-auth');
const { createAppPushDevices } = require('./app-push-devices');
const { createAppPushSender, createApnsClient, createFcmClient, createWebPushClient } = require('./app-push-sender');
const { createAppApi } = require('./app-api');
const academyDataLimit = createDataRateLimit({ limit: Math.max(30, Number(process.env.ACADEMY_DATA_RATE_PER_MIN) || 240) });
const ACADEMY_LIMITED_PATHS = new Set(['/academy-activity/market', '/academy-activity/scanner', '/academy-activity/orderflow', '/academy-activity/live', '/academy-activity/data/short', '/academy-activity/data/earnings']);
let dataStatusExtras = () => ({});
const { createMassiveHistory, createMassiveOptions, createMassiveOptionBars, createQueuedDataSource, cleanSymbol: cleanMarketSymbol, allowedPublicOrigin, resampleBars, TIMEFRAMES: MASSIVE_TIMEFRAMES, DERIVED_TIMEFRAMES: MASSIVE_DERIVED_TIMEFRAMES } = require('./market-data-service');
const { createAlertsService, defaultChannels } = require('./academy-alerts');
const { createAlertSources, createAlertSourceStore, createDiscordDirectory } = require('./academy-alert-sources');
const { createClickAlertService, createClickAlertStore } = require('./academy-click-alert');
const { createAutoPtService } = require('./academy-auto-pt');
const { createTargetLearner, suggestTargets: suggestPriceTargets, autoDirection: pickDirection } = require('./academy-target-engine');
const alertForensics = require('./academy-alert-forensics');
const ignitionRead = require('./academy-ignition');
const { checkAlert: prealertCheck } = require('./academy-prealert');
const { createLiveRange, mergeRanges } = require('./academy-live-range');
let fallbackTargetLearner = null; // an in-memory learner for a server started without the database-backed one (tests)
const { createHedgeService } = require('./academy-hedge');
/* every member's paper trading account starts with this much; the owner's 1K -> 100K Challenge account keeps its own $1,000 */
const PAPER_START_CASH = require('./academy-paper').RULES.startCash;
const { createProfileService } = require('./academy-profile');
const { createTraderAlerts } = require('./academy-trader-alerts');
const { createTradingRoom } = require('./academy-trading-room');
const { createAlertLevels } = require('./academy-alert-levels');
const { createCommunity } = require('./academy-community');
const { createSocialNotify } = require('./academy-social-notify');
const { createAlertChartBilling } = require('./alert-chart-billing');
const { createLoopStallProfiler } = require('./loop-stall-profiler');
const { createProfilePages, MAX_UPLOAD_BYTES: PROFILE_UPLOAD_MAX } = require('./academy-profile-pages');
const { createAlertRecord } = require('./academy-alert-record');
const { createSnapshotService } = require('./academy-snapshot');
const { createMemLab, fileStore: memLabFileStore } = require('./academy-mem-lab-service');
const { parseTick, buildTickBars, mergeTrades } = require('./academy-tick-bars');
const { freeUserIds: loadFreeUserIds, withFreeUsers, OWNER_IDS } = require('./academy-free-users');
const { parsePrices: parsePassPrices, createPassStore, createPassService, createWalletClient, withPasses } = require('./academy-passes');
const { createEntitlements, withEntitlements, parseSkuIds } = require('./academy-entitlements');
const { createChatStore, createChatHub, attachChatServer } = require('./academy-chat');
const { createMentionService } = require('./academy-mentions');
const { createSignalRadar } = require('./academy-signal-radar');
const { createDmNotifier } = require('./academy-notify-dm');
const { sessionDarkPool } = require('./academy-dark-pool-session');
const { createDarkPoolMemory } = require('./academy-dark-pool-memory');
const { createDiscordDmClient } = require('./dispute-notifier');
const { createScreenerService, HORIZONS: SCREENER_HORIZONS } = require('./academy-screener');
const { WebSocketServer } = require('ws');
const { createOptionsStream } = require('./academy-options-stream');
const { createAcademyVoice } = require('./academy-voice');
const { createDisciplineProgress } = require('./academy/discipline-progress');
const { createAcademySlideDesigner } = require('./academy-slide-designer');
const { createAcademyMediaStore } = require('./academy-media-store');
const { createAcademyAsk } = require('./academy-ask');
const { createAskDesk } = require('./academy-ask-desk');
const { createAskLog } = require('./academy-ask-log');
const { createTickerTalk } = require('./academy-ticker-talk');
const { createAcademyTrial } = require('./academy-trial');
const { createAcademyBake, bakeTourLines } = require('./academy-bake');
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
const academyWideBodyCache = new Map(); // serialized wide scanner payloads, keyed by ranking version + limit + tier
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

/* the value of a settleWithin race, or null when it timed out or rejected */
async function settledValue(promise, timeoutMs) { const s = await settleWithin(promise, timeoutMs).catch(() => null); return s && s.status === 'fulfilled' ? s.value : null; }
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
  const response = await dataHealth.guardedFetch('wordpress-hub', `${REDDIT_HUB_ORIGIN}${path}`, {
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
  if (response.headersSent || response.writableEnded) return;
  const payload = JSON.stringify(body);
  const req = response.req;
  const acceptGzip = req && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  if (acceptGzip && payload.length > 256) {
    const compressed = zlib.gzipSync(Buffer.from(payload), { level: zlib.constants.Z_BEST_SPEED });
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': compressed.length,
      'content-encoding': 'gzip',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    });
    response.end(compressed);
  } else {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    });
    response.end(payload);
  }
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
  /* past fresh but recent: answer from the copy at once (marked stale) and refresh behind it, so a timeframe switch never waits on the site */
  const serveStale = cached && cached.staleUntil > Date.now() && Date.now() - (cached.payload.asOf || 0) < 10 * 60_000;
  const staleCopy = () => annotateCandles({ ...cached.payload, stale: true }, { source: cached.payload.source, adjusted: cached.payload.adjusted });
  if (academyMarketInflight.has(cacheKey)) return serveStale ? staleCopy() : academyMarketInflight.get(cacheKey);
  const request = (async () => {
    try {
      const upstream = await dataHealth.guardedFetch('wordpress-history', `${REDDIT_HUB_ORIGIN}/wp-json/sml/v1/history?symbol=${encodeURIComponent(safeSymbol)}&tf=${encodeURIComponent(safeTimeframe)}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'StockMarketLoop-Academy-Activity/1.0' },
        signal: AbortSignal.timeout(12_000)
      });
      if (!upstream.ok) throw new Error(`academy_market_${upstream.status}`);
      const source = await upstream.json();
      /* The Activity draws at most 250 candles. Retaining a modest scrolling
       * window avoids parsing and serialising an unnecessarily large response. */
      const bars = Array.isArray(source?.bars) ? source.bars.slice(-600).map((bar) => ({
        t: Number(bar?.t), o: Number(bar?.o), h: Number(bar?.h), l: Number(bar?.l), c: Number(bar?.c), v: Number(bar?.v)
      })).filter((bar) => Number.isFinite(bar.t) && [bar.o, bar.h, bar.l, bar.c].every(Number.isFinite)) : [];
      if (!bars.length) throw new Error('academy_market_empty');
      const clean = sanitizeBars(bars, safeTimeframe);
      if (!clean.bars.length) throw new Error('academy_market_empty');
      /* adjusted is unknown for this feed, so it is reported as null rather than guessed */
      const payload = annotateCandles({ symbol: safeSymbol, tf: safeTimeframe, bars: clean.bars, asOf: Number(source?.asOf) || Date.now() }, { source: 'wordpress-history', adjusted: null, repaired: clean.repaired });
      /* 160 symbol:timeframe copies (the six warm symbols take 42); a stale copy goes before the newest ones */
      if (academyMarketCache.size >= 160) {
        const t = Date.now();
        for (const [k, v] of academyMarketCache) if (v.staleUntil <= t) academyMarketCache.delete(k);
        while (academyMarketCache.size >= 160) academyMarketCache.delete(academyMarketCache.keys().next().value);
      }
      /* how long a copy is served without asking again: the live minute bars stay at 4 s; slower timeframes change slowly, so the
         daily and weekly candles (read by every Click-to-Alert and MEM ALGO read) are reused for minutes instead of fetched each time */
      const FRESH_MS = { '1m': 4_000, '3m': 4_000, '5m': 4_000, '10m': 6_000, '15m': 8_000, '30m': 15_000, '1h': 30_000, '2h': 45_000, '4h': 60_000, '1D': 60_000, '1W': 600_000, '1M': 1_800_000, '1Q': 3_600_000, '1Y': 3_600_000 };
      academyMarketCache.set(cacheKey, { freshUntil: Date.now() + (FRESH_MS[safeTimeframe] || 4_000), staleUntil: Date.now() + 1_800_000, payload });
      return payload;
    } catch (error) {
      /* A brief upstream slowdown should not blank or freeze an active lesson.
       * Stale prices are better than no chart, and expire after five minutes. */
      if (cached && cached.staleUntil > Date.now()) return annotateCandles({ ...cached.payload, stale: true }, { source: cached.payload.source, adjusted: cached.payload.adjusted });
      throw error;
    } finally {
      academyMarketInflight.delete(cacheKey);
    }
  })();
  academyMarketInflight.set(cacheKey, request);
  if (serveStale) { request.catch(() => {}); return staleCopy(); }
  return request;
}

/* The symbols members are looking at right now (any timeframe) have their other timeframes kept warm, so the next click on a
   timeframe button is answered from memory: the intraday set and the daily, for at most six symbols seen in the last three minutes. */
const academyActiveSymbols = new Map();
const ACADEMY_SIBLING_TFS = ['1m', '3m', '5m', '15m', '1h', '1D'];
function noteActiveSymbol(symbol) {
  const sym = String(symbol || '').toUpperCase();
  if (!/^[A-Z][A-Z0-9.:-]{0,9}$/.test(sym)) return;
  academyActiveSymbols.set(sym, Date.now());
  if (academyActiveSymbols.size > 40) academyActiveSymbols.delete(academyActiveSymbols.keys().next().value);
}
function activeSymbols(limit = 6, withinMs = 180_000) {
  const now = Date.now();
  return [...academyActiveSymbols.entries()].filter(([, at]) => now - at < withinMs).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([sym]) => sym);
}

/* The upstream history call takes ~2 s when cold, but the Activity page only waited 650 ms for it, so a cold cache produced a page with no candles.
   Keep the busiest charts warm in the background so the first paint always has data. Errors are logged (throttled) so a dead feed is visible. */
const ACADEMY_WARM = [['SPY', '5m'], ['QQQ', '5m'], ['SPY', '1D']];
let academyWarmFailLogged = 0;
let academyWarmHistory = null;
function startAcademyChartWarmers(log = logger, history = null) {
  academyWarmHistory = history;
  const tick = async () => {
    try { await getAcademyScanner(); } catch (error) { if (Date.now() - academyWarmFailLogged > 300_000) { academyWarmFailLogged = Date.now(); log('warn', 'academy_scanner_warm_failed', { error }); } }
    for (const [symbol, tf] of ACADEMY_WARM) {
      try { await getAcademyCandles(symbol, tf); }
      catch (error) {
        if (Date.now() - academyWarmFailLogged > 300_000) { academyWarmFailLogged = Date.now(); log('warn', 'academy_chart_warm_failed', { symbol, tf, error }); }
      }
    }
    /* the symbols on members' screens: every sibling timeframe primed through the same sources the chart reads */
    for (const symbol of activeSymbols()) {
      for (const tf of ACADEMY_SIBLING_TFS) {
        try {
          if (academyWarmHistory && academyWarmHistory.enabled && Object.prototype.hasOwnProperty.call(MASSIVE_TIMEFRAMES, tf)) await academyWarmHistory.get(symbol, tf);
          else await getAcademyCandles(symbol, tf);
        } catch (_) { /* the chart's own request reports a failing source */ }
      }
    }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, 15_000);
  if (timer.unref) timer.unref();
  return timer;
}

/* The site's scanner can take 15-20 s when it is busy. Members must never wait on that: once a copy exists it is served at once (marked stale) and
   refreshed in the background, and the warmer below keeps it fresh. Only the very first request after a restart waits for the origin. */
async function getAcademyScanner() {
  const now = Date.now();
  if (academyScannerCache.payload && academyScannerCache.freshUntil > now) return academyScannerCache.payload;
  if (academyScannerCache.payload && academyScannerCache.staleUntil > now) {
    if (!academyScannerCache.inflight) refreshAcademyScanner().catch(() => {});
    return { ...academyScannerCache.payload, stale: true };
  }
  return refreshAcademyScanner();
}

function refreshAcademyScanner() {
  if (academyScannerCache.inflight) return academyScannerCache.inflight;
  academyScannerCache.inflight = (async () => {
    try {
      const upstream = await dataHealth.guardedFetch('wordpress-scanner', `${REDDIT_HUB_ORIGIN}/wp-json/sml-scanner/v1/live`, {
        headers: { Accept: 'application/json', 'User-Agent': 'StockMarketLoop-Academy-Activity/1.0' },
        signal: AbortSignal.timeout(25_000)
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
      const payload = { rows, asOf: Date.now(), session: marketState().session, marketOpen: isMarketOpen(), source: 'wordpress-scanner' };
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
      const upstream = await dataHealth.guardedFetch('wordpress-depth', `${REDDIT_HUB_ORIGIN}/wp-json/sml-scanner/v1/market-v2?symbol=${encodeURIComponent(safeSymbol)}&depth=10&ticks=0`, {
        headers: { Accept: 'application/json', 'User-Agent': 'StockMarketLoop-Academy-Activity/1.0' },
        signal: AbortSignal.timeout(15_000)
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
const ACADEMY_CHART_GUARD = "<style>html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}main{min-height:560px}.chart{min-height:320px}.chart canvas{min-height:240px}#academy-back-to-chart{display:none}.academy-live-deck .academy-slide-visual:not(:has(svg)){display:none}.academy-live-deck:not(:has(.wb-svg,.sc-svg)) .academy-slide-callout{display:none}body.academy-lesson-open #mem-algo-panel,body.academy-lesson-open .academy-pro-panel,body.academy-lesson-open .academy-pro-palette{display:none!important}.academy-live-deck .academy-slide-title{font-size:1.05rem}.academy-live-deck .academy-caption{font-size:.85rem;font-weight:600;line-height:1.55}body:not(.academy-lesson-open) .academy-guide{display:none!important}@media(max-width:900px){.academy-guide{display:none!important}}@media(max-width:900px){body.academy-lesson-open #academy-back-to-chart{display:block;position:fixed;top:6px;right:6px;z-index:2147483601;padding:8px 12px;border:0;border-radius:999px;background:#00c47d;color:#042217;font:800 12px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.5);cursor:pointer}}</style><script>(()=>{if(window.__smlChartGuard)return;window.__smlChartGuard=1;\n/* crisp text: canvas text drawn at a fractional position is smeared across pixels; snap every unrotated label to the device pixel grid (the chart, its overlays and the panels draw hundreds of labels) */\n(()=>{try{const P=CanvasRenderingContext2D.prototype;if(P.__smlSnap)return;const ft=P.fillText,st=P.strokeText;const snap=function(f,t,x,y,mw){const m=this.getTransform();if(m.b||m.c||!m.a)return mw===undefined?f.call(this,t,x,y):f.call(this,t,x,y,mw);const k=m.a,sx=Math.round(x*k+m.e)/k-m.e/k,sy=Math.round(y*k+m.f)/k-m.f/k;return mw===undefined?f.call(this,t,sx,sy):f.call(this,t,sx,sy,mw)};P.fillText=function(t,x,y,mw){return snap.call(this,ft,t,x,y,mw)};P.strokeText=function(t,x,y,mw){return snap.call(this,st,t,x,y,mw)};P.__smlSnap=1}catch(_){}})();\nconst q=new URLSearchParams(location.search),SYM=()=>(q.get('symbol')||'SPY').toUpperCase(),TF=()=>q.get('tf')||'5m',status=document.getElementById('status'),canvas=document.getElementById('chart');\nconst bars=()=>{try{return window.smlAcademyChartState().bars}catch(_){return[]}},key=()=>'sml-academy-bars:'+SYM()+':'+TF();\nwindow.addEventListener('sml-academy-market',e=>{const b=e.detail&&e.detail.bars;if(b&&b.length>20){try{sessionStorage.setItem(key(),JSON.stringify({t:Date.now(),symbol:e.detail.symbol,bars:b.slice(-250)}))}catch(_){}}});\nconst restore=()=>{if(bars().length)return false;try{const c=JSON.parse(sessionStorage.getItem(key())||'null');if(c&&Array.isArray(c.bars)&&c.bars.length&&Date.now()-c.t<216e5){window.smlAcademyApplyMarket({symbol:c.symbol,bars:c.bars});if(status)status.textContent='STALE';return true}}catch(_){}return false};\nlet misses=0,reported=false,delay=1500;const started=Date.now();\nconst fix=async()=>{if(document.hidden&&bars().length)return;if(canvas&&(!canvas.clientWidth||!canvas.clientHeight))window.dispatchEvent(new Event('resize'));if(bars().length){misses=0;return}misses++;\ntry{const r=await fetch('/academy-activity/market?symbol='+encodeURIComponent(SYM())+'&tf='+encodeURIComponent(TF()),{cache:'no-store'}),p=await r.json();if(r.ok&&p&&Array.isArray(p.bars)&&p.bars.length){window.smlAcademyApplyMarket(p);if(status)status.textContent='LIVE';return}}catch(_){}\nrestore();if(!reported&&Date.now()-started>8000&&!bars().length){reported=true;try{navigator.sendBeacon('/academy-activity/report',new Blob([JSON.stringify({kind:'chart_blank',w:canvas?canvas.clientWidth:-1,h:canvas?canvas.clientHeight:-1,symbol:SYM(),tf:TF(),misses,hidden:document.hidden,ua:navigator.userAgent.slice(0,120)})],{type:'text/plain'}))}catch(_){}}};\nsetTimeout(restore,400);(function loop(){fix().finally(()=>setTimeout(loop,bars().length?10000:(delay=Math.min(8000,Math.round(delay*1.4)))))})();\ndocument.addEventListener('visibilitychange',()=>{if(!document.hidden)fix()});\n/* On a phone the lesson fills the screen and its Back to Chart button sits at the very bottom, so members never found the chart. Keep a Back to Chart button pinned on screen while a lesson is open. */\nconst backBtn=document.createElement('button');backBtn.id='academy-back-to-chart';backBtn.type='button';backBtn.textContent='\\u25A6 Back to Chart';backBtn.onclick=()=>{const c=document.getElementById('close-lesson');if(c)c.click()};document.body.appendChild(backBtn);\n/* The Indicator Engine is inserted inside the chart grid and takes the 1fr row, leaving the candles a 0px stage. Move it out, above the scanner. */\nconst lift=()=>{const box=document.querySelector('.chart > .academy-intelligence'),sc=document.querySelector('.academy-scanner');if(box&&sc&&sc.parentNode)sc.parentNode.insertBefore(box,sc);if(canvas&&(!canvas.clientHeight))window.dispatchEvent(new Event('resize'))};\nlift();const liftTimer=setInterval(lift,500);setTimeout(()=>clearInterval(liftTimer),20000);})();</script>";
/* MEM ALGO (Day & Swing trading model) — engine + chart panel, inlined so the Activity stays a single document behind Discord's proxy. */
/* The free-session MEM ALGO teaser (content gate): the engine SOURCE with its
   STRATEGIES registry cut down to the Day strategy, so the paid strategies are
   neither sent nor runnable (resolveParams/analyze fall back to Day for any
   other mode). Built once at startup and checked in a sandbox; if the engine
   file ever changes shape the teaser is '' and a free session gets no model
   (fail closed), never the full one. */
function academyMemAlgoDayOnlyModel(engine) {
  try {
    const registry = require('./academy-mem-algo').STRATEGIES;
    const start = engine.indexOf('const STRATEGIES = {');
    const end = start < 0 ? -1 : engine.indexOf('\n};', start);
    if (!registry || !registry.day || start < 0 || end < 0) return '';
    const source = engine.slice(0, start) + 'const STRATEGIES = { day: ' + JSON.stringify(registry.day) + ' };' + engine.slice(end + 3);
    const model = '(function(){var module={exports:{}},exports=module.exports;' + source + '\nwindow.MemAlgoEngine=module.exports;})();';
    const sandbox = { window: {} };
    require('node:vm').runInNewContext(model, sandbox, { timeout: 1_000 });
    const teaser = sandbox.window.MemAlgoEngine;
    const others = Object.keys(registry).filter((key) => key !== 'day').map((key) => registry[key]);
    const ok = teaser && JSON.stringify(Object.keys(teaser.STRATEGIES || {})) === '["day"]'
      && typeof teaser.analyze === 'function' && others.length > 0
      && others.every((strategy) => !source.includes(strategy.label) && !source.includes(strategy.blurb)
        && teaser.resolveParams(strategy.key, {}, '').fast === registry.day.params.fast);
    return ok ? model : '';
  } catch (_) { return ''; }
}
const ACADEMY_MEM_ALGO_PARTS = (() => {
  try {
    const engine = fs.readFileSync(pathModule.join(__dirname, 'academy-mem-algo.js'), 'utf8');
    const ui = fs.readFileSync(pathModule.join(__dirname, 'academy-mem-algo-ui.js'), 'utf8')
      /* the five scenarios per trade type: engine (window.SmlMemScenarios) + the panel section and chart layer, loaded right after the panel */
      + '\n' + (() => { try { return '(function(){var module={exports:{}},exports=module.exports;' + fs.readFileSync(pathModule.join(__dirname, 'academy-mem-scenarios.js'), 'utf8') + '\nwindow.SmlMemScenarios=module.exports;})();\n' + fs.readFileSync(pathModule.join(__dirname, 'academy-mem-scenarios-ui.js'), 'utf8'); } catch (_) { return ''; } })();
    const patterns = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-patterns.js'), 'utf8'); } catch (_) { return ''; } })();
    const pro = fs.readFileSync(pathModule.join(__dirname, 'academy-chart-pro.js'), 'utf8');
    const liveFeed = fs.readFileSync(pathModule.join(__dirname, 'academy-live.js'), 'utf8');
    const optionsCalc = fs.readFileSync(pathModule.join(__dirname, 'academy-options-calc.js'), 'utf8');
    const optionsDock = fs.readFileSync(pathModule.join(__dirname, 'academy-options-dock.js'), 'utf8');
    const chartLayout = fs.readFileSync(pathModule.join(__dirname, 'academy-chart-layout.js'), 'utf8');
    const depthTools = fs.readFileSync(pathModule.join(__dirname, 'academy-depth-tools.js'), 'utf8');
    const heatmap = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-heatmap.js'), 'utf8'); } catch (_) { return ''; } })();
    const smartMoney = fs.readFileSync(pathModule.join(__dirname, 'academy-smart-money.js'), 'utf8');
    const smcExplain = fs.readFileSync(pathModule.join(__dirname, 'academy-smc-explain.js'), 'utf8');
    const smartMoneyUi = fs.readFileSync(pathModule.join(__dirname, 'academy-smart-money-ui.js'), 'utf8');
    const sessionLevels = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-session-levels.js'), 'utf8'); } catch (_) { return ''; } })();
    const sessionLevelsUi = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-session-levels-ui.js'), 'utf8'); } catch (_) { return ''; } })();
    const autoTradeUi = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-autotrade-ui.js'), 'utf8'); } catch (_) { return ''; } })();
    const editionUi = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-edition-ui.js'), 'utf8'); } catch (_) { return ''; } })();
    const clickAlertUi = fs.readFileSync(pathModule.join(__dirname, 'academy-click-alert-ui.js'), 'utf8');
    const alertLineUi = fs.readFileSync(pathModule.join(__dirname, 'academy-alert-line.js'), 'utf8');
    const snapshotUi = fs.readFileSync(pathModule.join(__dirname, 'academy-snapshot-ui.js'), 'utf8');
    const tickerTalkUi = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-ticker-talk-ui.js'), 'utf8'); } catch (_) { return ''; } })();
    const autoLiveUi = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-auto-live.js'), 'utf8'); } catch (_) { return ''; } })();
    const alertLevelsUi = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-alert-levels-ui.js'), 'utf8'); } catch (_) { return ''; } })();
    const targetsUi = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-targets-ui.js'), 'utf8'); } catch (_) { return ''; } })();
    const smartIntentUi = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-smart-intent-ui.js'), 'utf8'); } catch (_) { return ''; } })();
    const patternLiveUi = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-pattern-live-ui.js'), 'utf8'); } catch (_) { return ''; } })();
    const trialCountdownUi = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-trial-countdown.js'), 'utf8'); } catch (_) { return ''; } })();
    const chartLockUi = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-chart-lock.js'), 'utf8'); } catch (_) { return ''; } })();
    const optionContract = fs.readFileSync(pathModule.join(__dirname, 'academy-option-contract.js'), 'utf8');
    const optionsBrokers = fs.readFileSync(pathModule.join(__dirname, 'academy-options-brokers.js'), 'utf8');
    /* buy-button preferences (one button for my broker, or one per broker), the Settings button beside Customize, and the options desk: the CHAIN
       toggle that puts the chain where the candles are, the contract mini chart, and one-click Buy / Sell on contracts */
    const buyPrefsSrc = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-buy-prefs.js'), 'utf8'); } catch (_) { return ''; } })();
    const buyPrefs = buyPrefsSrc ? '(function(){var module={exports:{}},exports=module.exports;' + buyPrefsSrc + '\nwindow.SmlBuyPrefs=module.exports;})();' : '';
    const settingsUi = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-settings-ui.js'), 'utf8'); } catch (_) { return ''; } })();
    const optionsDesk = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-options-desk.js'), 'utf8'); } catch (_) { return ''; } })();
    const alertsUi = fs.readFileSync(pathModule.join(__dirname, 'academy-alerts-ui.js'), 'utf8');
    const sirePanel = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-sire-panel.js'), 'utf8'); } catch (_) { return ''; } })();
    const liveCells = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-live-cells.js'), 'utf8'); } catch (_) { return ''; } })();
    const buySellPanel = fs.readFileSync(pathModule.join(__dirname, 'academy-buy-sell-panel.js'), 'utf8');
    const darkPool = fs.readFileSync(pathModule.join(__dirname, 'academy-dark-pool.js'), 'utf8');
    const shortSale = fs.readFileSync(pathModule.join(__dirname, 'academy-short-sale.js'), 'utf8');
    const squeezeListUi = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-squeeze-list-ui.js'), 'utf8'); } catch (_) { return ''; } })();
    const articleDeskUi = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-article-desk-ui.js'), 'utf8'); } catch (_) { return ''; } })();
    const evolveUi = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-evolve-ui.js'), 'utf8'); } catch (_) { return ''; } })();
    const alertChartUi = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-alert-chart-ui.js'), 'utf8'); } catch (_) { return ''; } })();
    const communityUi = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-community-ui.js'), 'utf8'); } catch (_) { return ''; } })();
    const earningsPanel = fs.readFileSync(pathModule.join(__dirname, 'academy-earnings-panel.js'), 'utf8');
    const earningsInsightUi = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-earnings-insight-ui.js'), 'utf8'); } catch (_) { return ''; } })();
    const catalystsPanel = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-catalysts-panel.js'), 'utf8'); } catch (_) { return ''; } })();
    const challengePanel = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-challenge-panel.js'), 'utf8'); } catch (_) { return ''; } })();
    const paperPanel = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-paper-panel.js'), 'utf8'); } catch (_) { return ''; } })();
    const sentimentPanel = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-sentiment-panel.js'), 'utf8'); } catch (_) { return ''; } })();
    const dataChip = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-data-chip.js'), 'utf8'); } catch (_) { return ''; } })();
    const toolbarNav = fs.readFileSync(pathModule.join(__dirname, 'academy-toolbar-nav.js'), 'utf8');
    const screenerUi = fs.readFileSync(pathModule.join(__dirname, 'academy-screener-ui.js'), 'utf8');
    const scannerHover = fs.readFileSync(pathModule.join(__dirname, 'academy-scanner-hover.js'), 'utf8');
    const belowCycle = fs.readFileSync(pathModule.join(__dirname, 'academy-below-cycle.js'), 'utf8');
    /* the page arranges itself around what has data (academy-layout-engine.js): the market trio in one row, an empty Level 2 collapsed with the scanner's top rows in its place, the indicator strip in one row, the calculator folded on phones */
    const layoutEngine = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-layout-engine.js'), 'utf8'); } catch (_) { return ''; } })();
    const memSignals = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-mem-signals.js'), 'utf8'); } catch (_) { return ''; } })();
    const runnerSrc = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-runner.js'), 'utf8'); } catch (_) { return ''; } })();
    const runnerScript = runnerSrc ? '(function(){var module={exports:{}},exports=module.exports;' + runnerSrc + '\nwindow.SmlRunner=module.exports;})();' : '';
    /* the depth insights (full book and tape, academy-depth-insights.js): the panel reads hold / add / trim / exit and options timing with it */
    const depthSrc = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-depth-insights.js'), 'utf8'); } catch (_) { return ''; } })();
    const depthScript = depthSrc ? '(function(){var module={exports:{}},exports=module.exports;' + depthSrc + '\nwindow.SmlDepthInsights=module.exports;})();' : '';
    /* the daily flow ledger's reader (academy-flow-read.js): the week's score and the week-says verdict, the same code the server runs */
    const flowReadSrc = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-flow-read.js'), 'utf8'); } catch (_) { return ''; } })();
    const flowReadScript = flowReadSrc ? '(function(){var module={exports:{}},exports=module.exports;' + flowReadSrc + '\nwindow.SmlFlowRead=module.exports;})();' : '';
    const patternScript = patterns ? '<script>(function(){var module={exports:{}},exports=module.exports;' + patterns + '\nwindow.SmlPatterns=window.SmlPatterns||module.exports;})();</script>' : '';
    const signalsScript = memSignals ? '(function(){var module={exports:{}},exports=module.exports;function require(){return window.MemAlgoEngine;};' + memSignals + '\nwindow.SmlMemSignals=module.exports;})();' : '';
    return {
      tools: patternScript + '<script>' + pro + '</script><script>' + liveFeed + '</script><script>' + chartLayout + '</script><script>' + depthTools + '</script>' + (heatmap ? '<script>' + heatmap + '</script>' : '') + '<script>' + buySellPanel + '</script><script>' + darkPool + '</script><script>' + smartMoney + '</script><script>' + smcExplain + '</script><script>' + smartMoneyUi + '</script>' + (sessionLevels && sessionLevelsUi ? '<script>' + sessionLevels + '</script><script>' + sessionLevelsUi + '</script>' : '') + (editionUi ? '<script>' + editionUi + '</script>' : '') + (autoTradeUi ? '<script>' + autoTradeUi + '</script>' : '') + '<script>' + optionsCalc + '</script><script>' + optionContract + '</script>' + (buyPrefs ? '<script>' + buyPrefs + '</script>' : '') + (settingsUi ? '<script>' + settingsUi + '</script>' : '') + '<script>' + optionsDock + '</script><script>' + optionsBrokers + '</script>' + (optionsDesk ? '<script>' + optionsDesk + '</script>' : '') + '<script>' + earningsPanel + '</script>' + (earningsInsightUi ? '<script>' + earningsInsightUi + '</script>' : '') + (catalystsPanel ? '<script>' + catalystsPanel + '</script>' : '') + (challengePanel ? '<script>' + challengePanel + '</script>' : '') + (paperPanel ? '<script>' + paperPanel + '</script>' : '') + '<script>' + shortSale + '</script>' + (squeezeListUi ? '<script>' + squeezeListUi + '</script>' : '') + (articleDeskUi ? '<script>' + articleDeskUi + '</script>' : '') + (evolveUi ? '<script>' + evolveUi + '</script>' : '') + (alertChartUi ? '<script>' + alertChartUi + '</script>' : '') + (communityUi ? '<script>' + communityUi + '</script>' : '') + (sentimentPanel ? '<script>' + sentimentPanel + '</script>' : '') + (dataChip ? '<script>' + dataChip + '</script>' : '') + '<script>' + alertsUi + '</script>' + (liveCells ? '<script>' + liveCells + '</script>' : '') + (sirePanel ? '<script>' + sirePanel + '</script>' : '') + '<script>' + toolbarNav + '</script><script>' + screenerUi + '</script><script>' + scannerHover + '</script><script>' + clickAlertUi + '</script><script>' + alertLineUi + '</script><script>' + snapshotUi + '</script>' + (tickerTalkUi ? '<script>' + tickerTalkUi + '</script>' : '') + (smartIntentUi ? '<script>' + smartIntentUi + '</script><script>' + targetsUi + '</script>' : '') + (alertLevelsUi ? '<script>' + alertLevelsUi + '</script>' : '') + (autoLiveUi ? '<script>' + autoLiveUi + '</script>' : '') + (patternLiveUi ? '<script>' + patternLiveUi + '</script>' : '') + (trialCountdownUi ? '<script>' + trialCountdownUi + '</script>' : '') + (chartLockUi ? '<script>' + chartLockUi + '</script>' : '') + '<script>' + belowCycle + '</script>' + (layoutEngine ? '<script>' + layoutEngine + '</script>' : ''),
      model: '(function(){var module={exports:{}},exports=module.exports;' + engine + '\nwindow.MemAlgoEngine=module.exports;})();' + (signalsScript ? '\n' + signalsScript : '') + (runnerScript ? '\n' + runnerScript : '') + (depthScript ? '\n' + depthScript : '') + (flowReadScript ? '\n' + flowReadScript : ''),
      teaserModel: academyMemAlgoDayOnlyModel(engine),
      ui
    };
  } catch (_) { return null; } // the chart must load even if the model files are missing
})();
const ACADEMY_MEM_ALGO = ACADEMY_MEM_ALGO_PARTS ? ACADEMY_MEM_ALGO_PARTS.tools + '<script>' + ACADEMY_MEM_ALGO_PARTS.model + '</script><script>' + ACADEMY_MEM_ALGO_PARTS.ui + '</script>' : '';
/* Content gate (SML_ACADEMY_CONTENT_GATE_ENABLED): the model and its panel leave
   the page and are served by /academy-activity/mem-algo.js to a signed-in
   session only, loaded once the session exists. Paid tiers get all five
   strategies; a free session gets the Day strategy alone, and the data routes
   serve it only the free symbols. */
const ACADEMY_MEM_ALGO_SOURCE = ACADEMY_MEM_ALGO_PARTS ? ACADEMY_MEM_ALGO_PARTS.model + '\n' + ACADEMY_MEM_ALGO_PARTS.ui : '';
const ACADEMY_MEM_ALGO_TEASER_SOURCE = ACADEMY_MEM_ALGO_PARTS && ACADEMY_MEM_ALGO_PARTS.teaserModel
  ? ACADEMY_MEM_ALGO_PARTS.teaserModel + '\n' + ACADEMY_MEM_ALGO_PARTS.ui
  : '';
const ACADEMY_MEM_ALGO_LOADER = "<script>(()=>{if(window.__smlMemAlgoLoader)return;window.__smlMemAlgoLoader=1;let loaded=false,busy=false;const load=async()=>{const token=window.smlAcademySessionToken;if(loaded||busy||!token)return;busy=true;try{const response=await fetch('/academy-activity/mem-algo.js',{headers:{authorization:'Bearer '+token},cache:'no-store'});if(response.ok){const code=await response.text();loaded=true;const script=document.createElement('script');script.textContent=code;document.body.appendChild(script)}}catch(_){}finally{busy=false}};window.addEventListener('sml-academy-session',()=>{void load()});void load()})();</script>";

const ACADEMY_MOOMOO_BUY = `<style>.toolbar .academy-brokers{display:contents}.toolbar button.academy-broker-buy{display:inline-flex;align-items:center;gap:5px;border:1px solid #2f6cf5;border-radius:5px;background:#12233f;color:#9cc0ff;font:800 .68rem system-ui;padding:5px 8px;cursor:pointer;white-space:nowrap}.toolbar button.academy-broker-buy:hover{background:#1a3157;color:#c4d9ff}.toolbar #academy-webull-buy{border-color:#1f8fff;background:#0d2238;color:#8fc8ff}.toolbar #academy-robinhood-buy{border-color:#2fbf4f;background:#0f2a17;color:#9ff0b0}.toolbar #academy-robinhood-buy:hover{background:#163a20;color:#c8ffd4}.toolbar #academy-moomoo-buy{border-color:#ff7a1a;background:#2e1707;color:#ffb877}.toolbar #academy-moomoo-buy:hover{background:#432209;color:#ffd2a6}.toolbar #academy-etoro-buy{border-color:#13c636;background:#0c2a14;color:#8ff0a6}.toolbar #academy-etoro-buy:hover{background:#12381c;color:#c4ffd2}</style><script>(()=>{if(document.getElementById('academy-moomoo-buy'))return;
const toolbar=document.querySelector('.toolbar');if(!toolbar)return;
const currentSymbol=()=>{const q=new URLSearchParams(location.search).get('symbol'),typed=document.getElementById('symbol')?.value;return String(q||typed||'SPY').toUpperCase().replace(/[^A-Z0-9.\-]/g,'').slice(0,10)||'SPY'};
/* moomoo and Webull open a launcher in the phone's browser: it opens the app on this ticker when installed, and otherwise sends
   the member to the owner's sign-up link. Robinhood's robinhood.com/stocks/ and eToro's etoro.com/markets/ links open their pages directly. Quote pages only, never an order ticket. */
const LAUNCH='https://sml-platform-api.onrender.com/academy-activity/open';
const brokers=[['moomoo','moomoo',(s)=>LAUNCH+'?b=moomoo&symbol='+encodeURIComponent(s)],['webull','Webull',(s)=>LAUNCH+'?b=webull&symbol='+encodeURIComponent(s)],['robinhood','Robinhood',(s)=>'https://robinhood.com/stocks/'+encodeURIComponent(s)],['etoro','eToro',(s)=>'https://www.etoro.com/markets/'+encodeURIComponent(String(s).toLowerCase())]];
const open=(url)=>{if(window.smlAcademyOpenExternal)void window.smlAcademyOpenExternal(url);else try{window.open(url,'_blank','noopener')}catch(_){}};
const buttons=brokers.map(([key,name,urlOf])=>{const b=document.createElement('button');b.id='academy-'+key+'-buy';b.type='button';b.className='academy-broker-buy';b.dataset.broker=key;b.dataset.short=name+' ↗';b.setAttribute('aria-label','Open this stock in '+name);b.onclick=()=>open(urlOf(currentSymbol()));return b});
const paint=()=>{const s=currentSymbol();buttons.forEach((b,i)=>{const name=brokers[i][1];b.dataset.full='Buy '+s+' on '+name+' ↗';if(!b.classList.contains('academy-broker-short'))b.textContent=b.dataset.full;b.title='Opens '+s+' in '+name+'. Any order is reviewed and placed by you in '+name+' — nothing is traded from the Academy.'})};paint();
const group=document.createElement('span');group.className='academy-brokers';buttons.forEach((b)=>group.appendChild(b));
const buyChip=toolbar.querySelector('.quote-chip.buy');const anchor=buyChip&&buyChip.nextSibling;anchor?toolbar.insertBefore(group,anchor):toolbar.appendChild(group);
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


/* LOOP-KICK client module: the header button + panel that embeds the real hosted
   phone through Discord's /.proxy/loop-kick mapping. Shared by the Academy page
   (panel mode) and the Connect app's standalone Activity (full screen). */
const ACADEMY_LOOP_KICK = (() => {
  try {
    const ui = (() => { try { return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-social-notify-ui.js'), 'utf8') + '</script>'; } catch (_) { return ''; } })();
    return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-loop-kick.js'), 'utf8') + '</script>' + ui;
  } catch (_) { return ''; }
})();

// Phone layout for the Live Chart Lab; appended last so its rules win by source order.
const OPTIONS_CHAIN_MODULE = (() => {
  try { return fs.readFileSync(pathModule.join(__dirname, 'academy-options-chain.js'), 'utf8'); } catch (_) { return 'window.SmlOptionsChain={normalize:()=>[],findSpot:()=>null,expirations:()=>[]};'; }
})();
const ACADEMY_MOBILE_COMPACT = (() => {
  try {
    return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-mobile-compact.js'), 'utf8') + '</script>';
  } catch (_) { return ''; }
})();
// Phone workspace (tabs along the bottom, every tool panel in flow under the chart); appended right after the phone compact pass.
const ACADEMY_MOBILE_SHELL = (() => {
  try {
    return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-mobile-shell.js'), 'utf8') + '</script>';
  } catch (_) { return ''; }
})();
// First-time walkthrough (spotlight tour, desktop and phone; skippable, shown once per device).
const ACADEMY_TOUR = (() => {
  try {
    const catalog = JSON.stringify(require('./academy/tour-content').catalogForPage()).replace(/</g, '\\u003c');
    return '<script>window.__smlTourCatalog=' + catalog + ';</script><script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-tour.js'), 'utf8') + '</script><script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-playbooks.js'), 'utf8') + '</script><script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-auto-tour.js'), 'utf8') + '</script>';
  } catch (_) { return ''; }
})();
// Desktop quote column as a tabbed tool window (QUOTE, BUY/SELL, DARK POOL, SHORT SALE, SENTIMENT, SMC, MEM ALGO).
const ACADEMY_SIDE_WINDOW = (() => {
  try {
    return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-side-window.js'), 'utf8') + '</script>';
  } catch (_) { return ''; }
})();
// One tool open at a time; a tap outside a floating popup closes it (desktop and phone).
const ACADEMY_ONE_AT_A_TIME = (() => {
  try {
    return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-one-at-a-time.js'), 'utf8') + '</script>';
  } catch (_) { return ''; }
})();
// Discord phone edges: keeps every control clear of the strips Discord's own bars cover on a phone.
const ACADEMY_DISCORD_EDGES = (() => {
  try {
    return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-discord-edges.js'), 'utf8') + '</script>';
  } catch (_) { return ''; }
})();
// Desktop compaction (header rows, quote column fill).
const ACADEMY_DESKTOP_COMPACT = (() => {
  try {
    return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-desktop-compact.js'), 'utf8') + '</script>';
  } catch (_) { return ''; }
})();
const ACADEMY_APPEARANCE = (() => {
  try {
    return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-appearance-ui.js'), 'utf8') + '</script>';
  } catch (_) { return ''; }
})();
/* Push notifications: the service worker, the app icon (drawn once, no text so no fonts are needed) and the web app manifest
   (iPhone and iPad only deliver web push to an Academy added to the Home Screen). */
const ACADEMY_PUSH_SW = (() => { try { return fs.readFileSync(pathModule.join(__dirname, 'academy-push-sw.js'), 'utf8'); } catch (_) { return ''; } })();
const ACADEMY_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#06110d"/><circle cx="256" cy="256" r="178" fill="none" stroke="#19e36b" stroke-width="22" opacity=".35"/><circle cx="256" cy="256" r="112" fill="none" stroke="#19e36b" stroke-width="22" opacity=".6"/><circle cx="256" cy="256" r="44" fill="#19e36b"/><path d="M96 392 L208 280 L270 334 L408 160" fill="none" stroke="#7ef0bd" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/><path d="M340 152 L414 152 L414 226" fill="none" stroke="#7ef0bd" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const academyIconPng = (() => { const memo = new Map(); return (size) => { if (memo.has(size)) return memo.get(size); let png = null; try { const { Resvg } = require('@resvg/resvg-js'); png = new Resvg(ACADEMY_ICON_SVG, { fitTo: { mode: 'width', value: size } }).render().asPng(); } catch (_) { png = null; } memo.set(size, png); return png; }; })();
const ACADEMY_MANIFEST = JSON.stringify({ name: 'Making Easy Money Academy', short_name: 'MEM Academy', start_url: '/academy-activity/', scope: '/academy-activity/', display: 'standalone', background_color: '#05090d', theme_color: '#06110d', icons: [{ src: '/academy-activity/push-icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/academy-activity/push-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }] });
/* The StockMarketLoop app shell (platform/app-shell): an installable web app over /v1/app, served at /app/. Files are read once at start. */
const APP_SHELL_DIR = pathModule.join(__dirname, 'app-shell');
const APP_SHELL = (() => {
  const files = {};
  for (const [name, type] of [['index.html', 'text/html; charset=utf-8'], ['app.js', 'text/javascript; charset=utf-8'], ['app.css', 'text/css; charset=utf-8'], ['sw.js', 'text/javascript; charset=utf-8']]) {
    try { files[name] = { body: fs.readFileSync(pathModule.join(APP_SHELL_DIR, name)), type }; } catch (_) { /* a missing file is a 404 */ }
  }
  return files;
})();
/* the StockMarketLoop app icon (app-shell/icons, the owner's artwork); the drawn mark below is only the fallback when a file is missing */
const APP_SHELL_ICONS = (() => { const out = {}; for (const name of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) { try { out[name] = fs.readFileSync(pathModule.join(APP_SHELL_DIR, 'icons', name)); } catch (_) { /* fallback below */ } } return out; })();
const APP_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#06110d"/><path d="M256 86c94 0 170 76 170 170s-76 170-170 170S86 350 86 256" fill="none" stroke="#19e36b" stroke-width="30" stroke-linecap="round" opacity=".9"/><path d="M118 322 L196 244 L252 296 L394 154" fill="none" stroke="#7ef0bd" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/><path d="M326 150 L398 150 L398 222" fill="none" stroke="#7ef0bd" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const APP_ICON_MASKABLE_SVG = APP_ICON_SVG.replace('rx="112"', 'rx="0"');
const appIconPng = (() => { const memo = new Map(); return (size, maskable = false) => { const key = size + (maskable ? 'm' : ''); if (memo.has(key)) return memo.get(key); let png = null; try { const { Resvg } = require('@resvg/resvg-js'); png = new Resvg(maskable ? APP_ICON_MASKABLE_SVG : APP_ICON_SVG, { fitTo: { mode: 'width', value: size } }).render().asPng(); } catch (_) { png = null; } memo.set(key, png); return png; }; })();
const APP_MANIFEST = JSON.stringify({ name: 'StockMarketLoop', short_name: 'StockMarketLoop', description: 'Live scanner, watchlist, charts, news and alerts for StockMarketLoop members.', id: '/app/', start_url: '/app/', scope: '/app/', display: 'standalone', orientation: 'portrait', background_color: '#06110d', theme_color: '#06110d', categories: ['finance', 'news'],
  icons: [{ src: '/app/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/app/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/app/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] });
/* The Trading Desk pop-out as an installable app window (academy-desk.js swaps the page's manifest link for this one). */
const ACADEMY_DESK_MANIFEST = JSON.stringify({ name: 'MEM Academy Trading Desk', short_name: 'Trading Desk', description: 'Your Making Easy Money Academy modules as one desk: chart, tape, Level 2, alerts, scanner and more, arranged your way.', id: '/academy-activity/?popout=desk', start_url: '/academy-activity/?popout=desk', scope: '/academy-activity/', display: 'standalone', display_override: ['window-controls-overlay', 'standalone'], orientation: 'any', background_color: '#060a10', theme_color: '#0a1020', categories: ['finance'], launch_handler: { client_mode: 'navigate-existing' },
  icons: [{ src: '/academy-activity/push-icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/academy-activity/push-icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/academy-activity/push-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] });
const ACADEMY_MANIFEST_HEAD = '<link rel="manifest" href="/academy-activity/manifest.webmanifest"><meta name="theme-color" content="#06110d"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="MEM Academy"><link rel="apple-touch-icon" href="/academy-activity/push-icon-192.png">';
/* Pop-out modules: the sign-in shim runs in <head> (only acts in a ?popout window), the UI after the page. */
const ACADEMY_POPOUT_HEAD = (() => {
  try { return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-popout-head.js'), 'utf8') + '</script>'; } catch (_) { return ''; }
})();
/* Market Direction panel (shared display file) + its Academy mount. */
const ACADEMY_DIRECTION = (() => {
  try { return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'market-direction-ui.js'), 'utf8') + '</script><script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-direction-mount.js'), 'utf8') + '</script><script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-unusual-volume.js'), 'utf8') + '</script><script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-sml-vix.js'), 'utf8') + '</script><script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-pt-notify.js'), 'utf8') + '</script><script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-signal-radar-ui.js'), 'utf8') + '</script><script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-hedge-ui.js'), 'utf8') + '</script>'; } catch (_) { return ''; }
})();
const ACADEMY_DESK = (() => {
  try { return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-desk.js'), 'utf8') + '</script>'; } catch (_) { return ''; }
})();
const ACADEMY_POPOUT_UI = (() => {
  try { return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-popout-ui.js'), 'utf8') + '</script>'; } catch (_) { return ''; }
})();
/* Windows inside the Activity + per-module customization (academy-customize.js); runs after the pop-out UI it builds on. */
const ACADEMY_CUSTOMIZE = (() => {
  try { return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-customize.js'), 'utf8') + '</script>'; } catch (_) { return ''; }
})();
/* Chart dock + CLEAN switch (academy-chart-dock.js): tool panels beside the plot, never over it. */
const ACADEMY_CHART_DOCK = (() => {
  try { return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-chart-dock.js'), 'utf8') + '</script>'; } catch (_) { return ''; }
})();
/* Candle recap (academy-candle-recap-ui.js): click a day/week/month/quarter/year candle for the full period read. */
const ACADEMY_CANDLE_RECAP = (() => {
  try { return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-candle-recap-ui.js'), 'utf8') + '</script>'; } catch (_) { return ''; }
})();
/* Member profile pages + the Academy section of the chat hover card (academy-profile-ui.js). */
/* Academy clipboard: select, copy and paste work everywhere in the Academy (academy-clipboard.js). */
const ACADEMY_CLIPBOARD = (() => {
  try { return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-clipboard.js'), 'utf8') + '</script>'; } catch (_) { return ''; }
})();
const ACADEMY_PROFILE_DESK = (() => {
  try { return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-profile-desk.js'), 'utf8') + '</script>'; } catch (_) { return ''; }
})();
const ACADEMY_PROFILE_MUSIC = (() => {
  try { return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-profile-music.js'), 'utf8') + '</script>'; } catch (_) { return ''; }
})();
const ACADEMY_PROFILE_FX = (() => {
  try { return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-profile-fx.js'), 'utf8') + '</script>'; } catch (_) { return ''; }
})();
/* Ask Obi, the owner's question desk (academy-ask-ui.js): the button shows only once the server confirms the owner. */
const ACADEMY_ASK_UI = (() => {
  try { return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-ask-ui.js'), 'utf8') + '</script>'; } catch (_) { return ''; }
})();
const ACADEMY_BAR_RAIL = (() => {
  try { return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-bar-rail.js'), 'utf8') + '</script>'; } catch (_) { return ''; }
})();
const ACADEMY_PROFILE_UI = (() => {
  try { return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-profile-ui.js'), 'utf8') + '</script>'; } catch (_) { return ''; }
})();
// Trading room: the room behind a trader's profile (channels, free and paid access, the owner's setup).
const ACADEMY_ROOM_UI = (() => {
  try { return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-room-ui.js'), 'utf8') + '</script>'; } catch (_) { return ''; }
})();
const ACADEMY_LB_UI = (() => {
  try {
    return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-lb-ui.js'), 'utf8') + '</script>';
  } catch (_) { return ''; }
})();
const ACADEMY_TICK_UI = (() => {
  try {
    return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-tick-ui.js'), 'utf8') + '</script>';
  } catch (_) { return ''; }
})();
const ACADEMY_CHAT_PANEL = (() => {
  try {
    return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-chat-panel.js'), 'utf8') + '</script>';
  } catch (_) { return ''; }
})();

function loopKickActivityHtml(options = {}) {
  const appId = JSON.stringify(String(options.appId || ''));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LOOP-KICK</title>
<style>html,body{margin:0;height:100%;background:#04070c;color:#cfdbe8;font:400 13px/1.5 system-ui,sans-serif}
#lk-status{position:fixed;top:14px;left:50%;transform:translateX(-50%);font:700 10px/1 system-ui,sans-serif;letter-spacing:1.2px;color:#5d7085;z-index:5}</style>
</head><body>
<div id="lk-status">CONNECTING</div>
<script>window.SML_LOOP_KICK_ACTIVITY={standalone:true,sessionRoute:'session-bridge',connectRoute:'connect',connectLinkRoute:'connect-link'};</script>
<script type="module">
import { DiscordSDK } from './sdk/v20261015/index.mjs';
const appId=${appId};
const statusEl=document.getElementById('lk-status');
let sdk=null,inflight=null;
const inDiscord=new URLSearchParams(location.search).has('frame_id');
async function signIn(){
  if(!sdk)sdk=new DiscordSDK(appId);
  await sdk.ready();
  const authorization=await sdk.commands.authorize({client_id:appId,response_type:'code',prompt:'none',scope:['identify']});
  const response=await fetch('token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:authorization.code})});
  let payload={};try{payload=await response.json()}catch(_){}
  if(!response.ok||!payload.ok||!payload.access_token||!payload.sessionToken)throw new Error(payload.error||'authorization_failed');
  await sdk.commands.authenticate({access_token:payload.access_token});
  return payload.sessionToken;
}
async function authenticate(){
  if(inflight)return inflight;
  inflight=(async()=>{
    try{
      const sessionToken=await signIn();
      window.smlAcademySessionToken=sessionToken;
      statusEl.style.display='none';
      window.dispatchEvent(new CustomEvent('sml-academy-session',{detail:{sessionToken}}));
      return sessionToken;
    }catch(error){
      const reason=String((error&&(error.message||error.code))||error||'').replace(/[^\\w .:_-]/g,' ').trim().slice(0,120);
      statusEl.textContent=(inDiscord?'SIGN-IN FAILED — REOPEN THE ACTIVITY':'OPEN THIS INSIDE DISCORD')+(reason?' · '+reason:'');
      return '';
    }finally{inflight=null}
  })();
  return inflight;
}
window.smlAcademyReauth=()=>authenticate();
window.smlAcademyOpenExternal=async(url)=>{
  const framed=inDiscord||(window.self!==window.top);
  if(framed){try{if(!sdk)sdk=new DiscordSDK(appId);await sdk.ready();await sdk.commands.openExternalLink({url});return true}catch(_){}}
  try{window.open(url,'_blank','noopener')}catch(_){}
  return false;
};
void authenticate();
</script>
${ACADEMY_LOOP_KICK}
</body></html>`;
}

/* Activity client for the Academy gate flags, placed in <head> only when a flag
   is on so it runs before every other script. (1) Content gate: curriculum and
   live-data requests carry the signed session (the curriculum waits up to 8 s
   for sign-in, 20 s right after a gate reload) and a 401 renews the session
   once. If the curriculum had to load as the free preview (no session yet, a
   transient sign-in error, a slow first consent, or a free session) and a
   paid session arrives later, the page reloads once so the full lessons load
   (at most one reload per 30 s, remembered in sessionStorage, else
   window.name). (2) Buy link (SML_ACADEMY_BILLING_IN_DISCORD_LINKS): a refused
   or free sign-in carries a signed buy ticket; 'Get Academy access' posts it
   to /academy-activity/buy, which mints the one-time handoff URL only then,
   opens it through Discord and shows it as copyable text in case nothing
   opened. (3) While access is missing, returning to the Activity re-checks the
   role, and an upgrade reloads the page. A plain string: no template syntax,
   backticks or backslashes. */
const ACADEMY_GATE_CLIENT = "(()=>{\nif(window.__smlAcademyGate)return;window.__smlAcademyGate=1;\nconst cfg=window.SML_ACADEMY_GATE||{};\nconst base=window.fetch.bind(window);\nconst gated=['/academy-activity/curriculum','/academy-activity/market','/academy-activity/scanner','/academy-activity/sire-stream','/academy-activity/orderflow','/academy-activity/live'];\nconst pathOf=input=>{try{return new URL(typeof input==='string'?input:(input&&input.url)||'',location.href).pathname}catch(_){return ''}};\nconst authState=()=>(document.body&&document.body.dataset.academyAuth)||'';\nconst paid=tier=>tier==='member'||tier==='academy';\nconst RELOAD_KEY='sml-academy-gate-reload';\nconst lastReload=()=>{try{const saved=sessionStorage.getItem(RELOAD_KEY);if(saved!==null)return Number(saved)||0}catch(_){}const name=String(window.name||'');return name.indexOf('smlgr:')===0?(Number(name.slice(6))||0):0};\nconst reloadedRecently=Date.now()-lastReload()<60000;\nlet reloading=false;\nconst reloadOnce=()=>{if(reloading||Date.now()-lastReload()<30000)return;reloading=true;const at=String(Date.now());try{sessionStorage.setItem(RELOAD_KEY,at)}catch(_){}try{const name=String(window.name||'');if(!name||name.indexOf('smlgr:')===0)window.name='smlgr:'+at}catch(_){}location.reload()};\nconst waitSession=ms=>new Promise(resolve=>{const token=window.smlAcademySessionToken||'';const state=authState();if(token||(state&&state!=='ready')){resolve(token);return}let done=false;const finish=()=>{if(done)return;done=true;window.removeEventListener('sml-academy-session',onSession);resolve(window.smlAcademySessionToken||'')};const onSession=()=>finish();window.addEventListener('sml-academy-session',onSession);const tick=()=>{if(done)return;const st=authState();if(window.smlAcademySessionToken||(st&&st!=='ready'))finish();else setTimeout(tick,150)};setTimeout(tick,150);setTimeout(finish,ms)});\nlet renewing=null,lastAuthAt=Date.now();\nconst renew=()=>{if(!renewing){renewing=Promise.resolve(typeof window.smlAcademyReauth==='function'?window.smlAcademyReauth():'').catch(()=>'');renewing.then(t=>{if(t)lastAuthAt=Date.now();renewing=null})}return renewing};\nconst withAuth=(init,token)=>{const options=Object.assign({},init||{});const headers=new Headers(options.headers||{});if(token){headers.set('authorization','Bearer '+token);options.cache='no-store'}options.headers=headers;return options};\nlet preview=false;\nconst upgradeIfPreview=()=>{if(cfg.gate&&preview&&paid(window.smlAcademyTier||''))setTimeout(reloadOnce,300)};\nconst mintBuy=ticket=>base('/academy-activity/buy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticket}),cache:'no-store'}).then(response=>response.json().then(payload=>response.ok&&payload&&payload.ok&&typeof payload.url==='string'?payload.url:'')).catch(()=>'');\n/* Discord checkout, when SKUs are configured and the Activity runs inside Discord. The SDK answer is only a hint: access is decided server-side from the entitlement (academy-entitlements.js), so a finished purchase just renews the session and lets the server re-read the tier. */const afterPurchase=async()=>{try{await renew()}catch(_){}if(paid(window.smlAcademyTier||''))reloadOnce()};window.smlAcademyOnEntitlement=()=>{afterPurchase().catch(()=>{})};const buyInDiscord=async()=>{const skus=Array.isArray(cfg.skus)?cfg.skus:[];const sdk=window.smlAcademySdk;if(!skus.length||!sdk||!sdk.commands||typeof sdk.commands.startPurchase!=='function')return false;try{await sdk.commands.startPurchase({sku_id:skus[0]})}catch(e){return false}await afterPurchase();return true};const buyButton=ticket=>{const wrap=document.createElement('span');wrap.className='academy-buy';wrap.style.cssText='display:inline-flex;gap:.4rem;align-items:center;flex-wrap:wrap';const button=document.createElement('button');button.type='button';button.textContent='Get Academy access';button.style.cssText='border:1px solid #75f5bf;background:#00c47d;color:#042217;border-radius:6px;padding:.25rem .6rem;font:inherit;font-weight:800;cursor:pointer';button.onclick=()=>{if(button.disabled)return;button.disabled=true;buyInDiscord().then(bought=>{if(bought){button.disabled=false;return null}return mintBuy(window.smlAcademyBuyTicket||ticket).then(url=>{button.disabled=false;wrap.querySelectorAll('input,.academy-buy-error').forEach(node=>node.remove());if(!url){const note=document.createElement('span');note.className='academy-buy-error';note.textContent='Could not start checkout. Try again in a moment.';wrap.appendChild(note);return}const open=window.smlAcademyOpenExternal;Promise.resolve(open?open(url):false).catch(()=>false).then(()=>{const field=document.createElement('input');field.readOnly=true;field.value=url;field.setAttribute('aria-label','Academy access link (one use, expires in a few minutes)');field.style.cssText='min-width:14rem;max-width:100%;background:#0b1620;color:#dffbee;border:1px solid #294554;border-radius:6px;padding:.2rem .4rem;font:inherit';field.onfocus=()=>field.select();wrap.appendChild(field)})})}).catch(()=>{button.disabled=false})};wrap.appendChild(button);return wrap};\nconst paint=()=>{const bar=document.querySelector('main .bar');if(!bar)return;const ticket=cfg.links?(window.smlAcademyBuyTicket||''):'';const state=authState(),tier=window.smlAcademyTier||'';if(state==='academy_role_required'&&ticket){const notice=document.getElementById('academy-auth-notice');if(notice&&!notice.querySelector('.academy-buy'))notice.appendChild(buyButton(ticket))}if(state==='ready'&&tier==='free'){setTimeout(()=>{const status=document.getElementById('status');if(status&&authState()==='ready'&&(window.smlAcademyTier||'')==='free')status.textContent='FREE PREVIEW'},0);if(ticket&&!bar.querySelector(':scope > .academy-buy'))bar.appendChild(buyButton(ticket))}if(state==='ready'&&tier!=='free'){const stale=bar.querySelector(':scope > .academy-buy');if(stale)stale.remove()}};\nwindow.fetch=async(input,init)=>{const path=pathOf(input);\nif(path==='/academy-activity/token'||path==='/academy-activity/renew'){const response=await base(input,init);try{response.clone().json().then(payload=>{if(!payload||typeof payload!=='object')return;window.smlAcademyTier=payload.ok?(payload.tier||'member'):'';if(payload.ok)lastAuthAt=Date.now();window.smlAcademyBuyTicket=payload.buy&&typeof payload.buy.ticket==='string'?payload.buy.ticket:'';paint();upgradeIfPreview()}).catch(()=>{})}catch(_){}return response}\nif(!cfg.gate||typeof input!=='string'||gated.indexOf(path)<0)return base(input,init);\nif(new Headers((init&&init.headers)||{}).has('authorization'))return base(input,init);\nconst lessons=path==='/academy-activity/curriculum';\nconst token=lessons?await waitSession(reloadedRecently?20000:8000):(window.smlAcademySessionToken||'');\nif(!token){if(lessons)preview=true;return base(input,init)}\nif(lessons&&(window.smlAcademyTier||'member')==='free')preview=true;\nconst response=await base(input,withAuth(init,token));\nif(response.status!==401)return response;\nconst fresh=await renew();\nif(lessons&&(!fresh||(window.smlAcademyTier||'member')==='free'))preview=true;\nreturn base(input,withAuth(init,fresh||''))};\nlet lastCheck=0;\nconst recheck=()=>{if(document.hidden||typeof window.smlAcademyReauth!=='function')return;const state=authState(),tier=window.smlAcademyTier||'';const sessionStale=Date.now()-lastAuthAt>13*60*1000;const needsUpgrade=state==='academy_role_required'||(state==='ready'&&tier==='free');if(!needsUpgrade&&!sessionStale)return;if(Date.now()-lastCheck<5000)return;lastCheck=Date.now();renew().then(()=>{setTimeout(()=>{if(cfg.gate&&authState()==='ready'&&paid(window.smlAcademyTier||''))reloadOnce()},300)}).catch(()=>{})};\ndocument.addEventListener('visibilitychange',recheck);window.addEventListener('focus',recheck);window.addEventListener('pageshow',recheck);\ndocument.addEventListener('DOMContentLoaded',()=>{new MutationObserver(paint).observe(document.body,{attributes:true,attributeFilter:['data-academy-auth']});paint()});\n})();";
function academyGateClientScript(gate) {
  const skus = Array.isArray(gate.skus) ? gate.skus : [];
  /* `skus` is left out entirely when nothing is sold through Discord, so the page is unchanged for everyone else */
  const config = skus.length ? { gate: Boolean(gate.contentGate), links: Boolean(gate.links), skus }
    : { gate: Boolean(gate.contentGate), links: Boolean(gate.links) };
  return '<script>window.SML_ACADEMY_GATE=' + JSON.stringify(config) + ';' + ACADEMY_GATE_CLIENT + '</script>';
}

/* The chart kit (academy-viz.js): one look for every graph, bar, meter and pie; loaded before every module that draws. */
const ACADEMY_VIZ_KIT = (() => { try { return '<script>' + fs.readFileSync(pathModule.join(__dirname, 'academy-viz.js'), 'utf8') + '</script>'; } catch (_) { return ''; } })();

function academyActivityHtml(initialMarket = {}, options = {}) {
  /* options.gate is passed only while an Academy gate flag is on; without it
     the page is byte-for-byte the ungated one. */
  const gate = options.gate && typeof options.gate === 'object' ? options.gate : null;
  const memAlgo = gate && gate.contentGate && ACADEMY_MEM_ALGO_PARTS ? ACADEMY_MEM_ALGO_PARTS.tools + ACADEMY_MEM_ALGO_LOADER : ACADEMY_MEM_ALGO;
  const html = academyActivityHtmlBase(initialMarket, options).replace(/<\/body>\s*<\/html>\s*$/i, () => ACADEMY_CHART_GUARD + ACADEMY_VIZ_KIT + memAlgo + ACADEMY_MOOMOO_BUY + ACADEMY_LOOP_KICK + ACADEMY_DISCORD_EDGES + ACADEMY_MOBILE_COMPACT + ACADEMY_MOBILE_SHELL + ACADEMY_SIDE_WINDOW + ACADEMY_ONE_AT_A_TIME + ACADEMY_DESKTOP_COMPACT + ACADEMY_TOUR + ACADEMY_CHAT_PANEL + ACADEMY_APPEARANCE + ACADEMY_LB_UI + ACADEMY_TICK_UI + ACADEMY_DIRECTION + ACADEMY_DESK + ACADEMY_POPOUT_UI + ACADEMY_CUSTOMIZE + ACADEMY_CHART_DOCK + ACADEMY_CANDLE_RECAP + ACADEMY_PROFILE_DESK + ACADEMY_PROFILE_MUSIC + ACADEMY_PROFILE_FX + ACADEMY_PROFILE_UI + ACADEMY_ROOM_UI + ACADEMY_ASK_UI + ACADEMY_BAR_RAIL + ACADEMY_CLIPBOARD + '</body></html>');
  const withPopout = html.replace('</head>', () => ACADEMY_MANIFEST_HEAD + ACADEMY_POPOUT_HEAD + '</head>');
  return gate ? withPopout.replace('</head>', () => academyGateClientScript(gate) + '</head>') : withPopout;
}

function academyActivityHtmlBase(initialMarket = {}, options = {}) {
  const initialBars = JSON.stringify(Array.isArray(initialMarket.bars) ? initialMarket.bars.slice(-250) : []);
  const initialSymbol = JSON.stringify(String(initialMarket.symbol || 'SPY'));
  const initialScanner = JSON.stringify(Array.isArray(initialMarket.scanner?.rows) ? initialMarket.scanner.rows.slice(0, 100) : []);
  /* What the content gate withheld from this render, so the panel's empty row can say so (gatedScanner). */
  const initialScanLock = JSON.stringify({ locked: Boolean(initialMarket.scanner?.locked), count: Number(initialMarket.scanner?.lockedCount) || 0 });
  const initialDepth = JSON.stringify(initialMarket.depth && typeof initialMarket.depth === 'object' ? initialMarket.depth : { bids: [], asks: [] });
  const academyAppId = JSON.stringify(String(options.appId || ''));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://discord.com"><link rel="dns-prefetch" href="https://discord.com"><link rel="modulepreload" href="/academy-activity/sdk/v20261015/index.mjs">
<title>Making Easy Money Academy — Live Chart Lab</title>
<style>
*{box-sizing:border-box}html,body{width:100%;min-height:100%;margin:0;background:#070b10;color:#eef4f7;font-family:system-ui,-apple-system,Segoe UI,sans-serif}html{scroll-behavior:smooth}body{overflow-x:hidden;overflow-y:auto;overscroll-behavior-y:contain}main{height:calc(100vh - 86px);height:calc(100svh - 86px);min-height:440px;display:grid;grid-template-rows:auto auto minmax(0,1fr)}@media(max-width:1180px){.bar>span{display:none}}@media(max-width:900px){.bar{gap:.4rem}.bar strong{font-size:.74rem}.bar-rail>button{padding:4px 6px!important}}.bar{display:flex;align-items:center;gap:.65rem;padding:.36rem .75rem;background:#0d1720;border-bottom:1px solid #1f3942;font-size:.8rem}.dot{width:.5rem;height:.5rem;border-radius:999px;background:#00d084;box-shadow:0 0 12px #00d084}.status{margin-left:0;color:#7f98a6;font:700 .7rem ui-monospace,monospace}.lesson-toggle{margin-left:auto;border:1px solid #00c47d;border-radius:6px;background:#092b23;color:#79efbd;font:800 .72rem system-ui;padding:6px 8px;cursor:pointer}.dashbar{display:flex;align-items:center;gap:8px;padding:0 12px;grid-row:2;grid-column:1;justify-self:end;align-self:center;z-index:2;background:transparent;border:0;font:700 .67rem ui-monospace;max-width:52%;overflow:hidden;white-space:nowrap}.dashbar .dashbrand,.dashbar .academy-tag{display:none}.indices{grid-row:2;grid-column:1}@media(max-width:1000px){.dashbar .market-state{display:none}}.dashbrand{color:#00d084;letter-spacing:.06em}.academy-tag{padding:3px 6px;border-radius:4px;color:#94e9c4;background:#123d31}.market-state{margin-left:auto;color:#ffbf5d}.indices{display:flex;gap:7px;overflow:hidden;padding:5px 12px;background:#101923;border-bottom:1px solid #1c3140}.index{min-width:124px;border-right:1px solid #273947;padding-right:7px;font-size:.64rem;color:#94aab6}.index b{display:block;color:#eaf5f8;margin-bottom:1px}.index em{font-style:normal;color:#00d084}.shell{min-height:0;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) 238px}.chart{position:relative;min-height:0;padding:6px;display:grid;grid-template-rows:auto minmax(0,1fr)}.toolbar{display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin:0;padding:4px 6px;border:1px solid #1b3540;border-radius:8px 8px 0 0;background:#0a1118}.toolbar input{width:82px;background:#0d1720;border:1px solid #285061;border-radius:5px;color:#fff;padding:5px 7px;font-weight:800;text-transform:uppercase}.toolbar button{border:0;border-radius:5px;background:#00c47d;color:#042217;font-weight:800;padding:4px 7px;cursor:pointer}.toolbar small{color:#8295a3}.quote-chip{font:800 .68rem ui-monospace;color:#d7e9ef}.sell{color:#ff778b}.buy{color:#52e6ad}.intervals{display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-left:auto}.intervals button{padding:4px 5px;background:#162632;color:#9cb1bd}.intervals button.active{background:#00c47d;color:#042217}canvas{display:block;width:100%;height:100%;min-height:0;touch-action:none;border:1px solid #1b3540;border-radius:0 0 8px 8px;background:linear-gradient(180deg,#0b141c,#070b10)}.side{min-height:0;overflow:hidden;border-left:1px solid #1b3540;background:#0a1118;padding:8px 10px;display:flex;flex-direction:column}.side>*{flex:0 0 auto}.side>.academy-tape{flex:1 1 auto;min-height:0;overflow:auto;scrollbar-width:thin}.side:not(:has(.academy-tape))>.academy-depth{flex:1 1 auto;min-height:0;overflow:auto;scrollbar-width:thin}.side .meta:empty{display:none}.side h2{font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;color:#86a2b0;margin:0 0 7px}.quote{font:800 1.25rem ui-monospace,monospace}.change{font:700 .72rem ui-monospace,monospace;margin-top:2px}.meta{margin-top:8px;padding-top:7px;border-top:1px solid #1b3540;color:#8094a2;font-size:.62rem;line-height:1.35}.options-focus{margin-top:8px;padding-top:7px;border-top:1px solid #ffd166;color:#ffd166;font:700 .64rem ui-monospace;line-height:1.4}.book{margin-top:8px;border-top:1px solid #1b3540;padding-top:7px}.book h3{font-size:.63rem;margin:0 0 5px;color:#86a2b0}.bookrow{display:flex;justify-content:space-between;font:700 .63rem ui-monospace;margin:3px 0}.bookrow .bidtxt{color:#52e6ad}.bookrow .asktxt{color:#ff778b}.academy-below{padding:14px;background:#070b10;border-top:1px solid #1f3942}.below-title{margin:0 0 8px;font:900 .8rem ui-monospace;color:#8ee8c1;letter-spacing:.08em}.options-chain{margin-top:12px;padding:12px;border:1px solid #1b3540;border-radius:10px;background:#0a1118}.options-chain h2{font-size:.9rem;margin:0 0 6px}.options-chain p{margin:0;color:#8fa5b1;font-size:.75rem}.options-chain button{margin-top:10px;border:0;border-radius:6px;background:#00c47d;color:#042217;font-weight:900;padding:8px 11px;cursor:pointer}.options-grid{display:grid;grid-template-columns:repeat(6,minmax(76px,1fr));gap:1px;margin-top:12px;background:#213744;border:1px solid #213744}.options-grid span{padding:6px;background:#0b141c;font:.66rem ui-monospace}.options-grid .head{background:#13242d;color:#8ee8c1;font-weight:900}.lesson{position:fixed;z-index:20;top:48px;right:12px;width:min(430px,calc(100vw - 24px));max-height:calc(100dvh - 76px);overflow:auto;display:none;padding:16px;border:1px solid #2c596a;border-radius:11px;background:#0b141c;box-shadow:0 16px 48px rgba(0,0,0,.55)}.lesson.open{display:block}.lesson small{color:#00d084;font-weight:800;letter-spacing:.09em}.lesson h2{font-size:1.08rem;margin:7px 0}.lesson p{font-size:.85rem;line-height:1.55;color:#c7d5dc}.scene{position:relative;height:105px;margin:12px 0;border:1px solid #25424f;border-radius:8px;background:radial-gradient(circle at 50% 50%,#163344,#091117 65%);overflow:hidden}.bid,.ask{position:absolute;padding:7px 9px;border-radius:6px;font:800 .75rem ui-monospace;animation:bob 1.8s ease-in-out infinite}.bid{left:15%;top:25px;background:#063c2c;color:#72f2b9}.ask{right:15%;bottom:22px;background:#4b1724;color:#ff91a2;animation-delay:-.8s}.trade{position:absolute;left:48%;top:43%;width:13px;height:13px;border-radius:50%;background:#ffd166;box-shadow:0 0 0 0 rgba(255,209,102,.7);animation:pulse 1.4s infinite}@keyframes bob{50%{transform:translateY(12px)}}@keyframes pulse{70%{box-shadow:0 0 0 18px rgba(255,209,102,0)}}.lesson-controls{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.lesson button{border:0;border-radius:6px;background:#00c47d;color:#042217;font-weight:800;padding:7px 9px;cursor:pointer}.lesson button.alt{background:#1c303b;color:#d9e8ee}.answers{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:9px}.answers button{background:#19303d;color:#e7f3f6;text-align:left}.answers button.good{background:#0b6a49}.answers button.bad{background:#6d2531}@media(max-height:720px){.indices{display:none}main{grid-template-rows:auto auto minmax(0,1fr)}.meta{display:none}}@media(max-width:720px){main{height:calc(100vh - 78px);height:calc(100svh - 78px);grid-template-rows:auto minmax(0,1fr)}.indices,.dashbar{display:none}.shell{grid-template-columns:1fr}.side{display:none}.chart{padding:5px}.bar span{display:none}.intervals{margin-left:0}.academy-below{padding:12px}.options-grid{grid-template-columns:repeat(3,minmax(72px,1fr))}}
</style><style>
.lesson-picker{width:100%;margin:8px 0 4px;padding:8px;border:1px solid #285061;border-radius:6px;background:#0d1720;color:#eef4f7;font-weight:800}.lesson button:disabled{opacity:.45;cursor:not-allowed}@media(max-width:720px){.answers{grid-template-columns:1fr}}
.academy-scanner{border:1px solid #1b3540;border-radius:10px;background:#0a1118;overflow:hidden}.academy-scan-head{display:flex;gap:9px;align-items:center;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid #1b3540}.academy-scan-title{font:900 .76rem ui-monospace;color:#eaf5f8}.academy-scan-live{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(82,230,173,.35);border-radius:999px;padding:3px 7px;color:#52e6ad;font:900 .58rem ui-monospace}.academy-scan-live:before{content:'';width:5px;height:5px;border-radius:50%;background:#52e6ad;box-shadow:0 0 8px #52e6ad}.academy-scan-tabs{display:flex;gap:4px;flex-wrap:wrap;padding:8px 12px;border-bottom:1px solid #1b3540}.academy-scan-tabs button,.academy-scan-tools button{border:1px solid #294554;border-radius:5px;background:#101e27;color:#9eb2bc;padding:5px 8px;font:800 .62rem ui-monospace;cursor:pointer}.academy-scan-tabs button.on{border-color:#00c47d;background:#0b3b2e;color:#7ef0bd}.academy-scan-tools{display:flex;gap:7px;align-items:center;flex-wrap:wrap;padding:8px 12px;border-bottom:1px solid #1b3540}.academy-scan-tools input,.academy-scan-tools select{height:30px;border:1px solid #294554;border-radius:5px;background:#0d1720;color:#eaf5f8;padding:5px 8px;font:700 .64rem system-ui}.academy-scan-tools input{min-width:240px;flex:1}.academy-monitor{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:#1b3540;border-bottom:1px solid #1b3540}.academy-monitor span{padding:8px 12px;background:#0d1720;color:#8fa5b1;font:.62rem ui-monospace}.academy-monitor b{display:block;margin-top:2px;color:#eaf5f8;font-size:.74rem}.academy-scan-wrap{max-width:100%;overflow:auto;overscroll-behavior:contain}.academy-scan-table{width:100%;min-width:940px;border-collapse:collapse;font:.64rem ui-monospace}.academy-scan-table th,.academy-scan-table td{padding:7px 8px;border-bottom:1px solid rgba(42,66,78,.55);white-space:nowrap;text-align:right}.academy-scan-table th{position:sticky;top:0;background:#13242d;color:#8ee8c1;cursor:pointer}.academy-scan-table th:nth-child(-n+3),.academy-scan-table td:nth-child(-n+3){text-align:left}.academy-scan-table tbody tr{cursor:pointer}.academy-scan-table tbody tr:hover{background:#10232b}.academy-scan-symbol{font-weight:900;color:#eef4f7}.academy-scan-name{display:block;max-width:150px;overflow:hidden;text-overflow:ellipsis;color:#738995;font-size:.55rem}.academy-positive{color:#52e6ad}.academy-negative{color:#ff778b}.academy-muted{color:#718694}.academy-scan-foot{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:9px 12px;color:#8094a2;font:.62rem ui-monospace}.academy-scan-pages{display:flex;gap:4px}.academy-scan-pages button{border:1px solid #294554;border-radius:4px;background:#101e27;color:#9eb2bc;padding:4px 7px;cursor:pointer}.academy-scan-pages button.on{background:#00c47d;color:#042217}.academy-scan-empty{font-size:.7rem;color:#8094a2;padding:14px}.academy-pro-note{padding:7px 12px;border-bottom:1px solid #1b3540;color:#8fa5b1;font:.6rem ui-monospace}@media(max-width:720px){.academy-monitor{grid-template-columns:1fr}.academy-scan-tools input{min-width:160px}}
#academy-unlock{margin-left:0;border:2px solid #75f5bf;background:#00c47d;color:#042217;box-shadow:0 0 14px rgba(0,196,125,.25)}body.academy-tools-open #academy-unlock{position:relative;inset:auto}
/* A lesson is a real layout rail, never an overlay. The chart, quote rail,
   scanner, and options lab all share the same reserved desktop width. */
:root{--academy-lesson-rail:clamp(390px,33vw,520px)}main,.academy-below{width:100%;transition:width .22s ease}.lesson{top:0;right:0;width:var(--academy-lesson-rail);height:100dvh;max-height:none;border-width:0 0 0 1px;border-radius:0;box-shadow:-16px 0 42px rgba(0,0,0,.42);overscroll-behavior:contain;scrollbar-gutter:stable}.lesson.open{display:block}body.academy-lesson-open main,body.academy-lesson-open .academy-below{width:calc(100% - var(--academy-lesson-rail))}body.academy-lesson-open .shell{grid-template-columns:minmax(0,1fr) clamp(205px,18vw,238px)}body.academy-lesson-open .toolbar small{display:none}
.options-chain{scroll-margin-top:12px}.options-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.options-actions{display:flex;align-items:end;gap:7px;flex-wrap:wrap}.options-actions label{display:grid;gap:3px;color:#8fa5b1;font:700 .58rem ui-monospace}.options-actions select{height:32px;border:1px solid #294554;border-radius:5px;background:#0d1720;color:#eaf5f8;padding:4px 7px}.options-actions button{margin-top:0}.options-summary{display:grid;grid-template-columns:repeat(5,minmax(110px,1fr));gap:1px;margin-top:12px;border:1px solid #213744;background:#213744}.options-summary span{padding:8px;background:#0d1720;color:#8fa5b1;font:.59rem ui-monospace}.options-summary b{display:block;margin-top:3px;color:#eef4f7;font-size:.73rem}.options-table-wrap{max-width:100%;margin-top:12px;overflow:auto;border:1px solid #213744;overscroll-behavior:contain}.options-table{width:100%;min-width:1420px;border-collapse:collapse;font:.61rem ui-monospace}.options-table th,.options-table td{padding:7px 8px;border-bottom:1px solid rgba(42,66,78,.55);white-space:nowrap;text-align:right}.options-table th{position:sticky;top:0;z-index:2;background:#13242d;color:#8ee8c1}.options-table th.strike,.options-table td.strike{position:sticky;left:0;z-index:1;text-align:center;background:#11222b;color:#ffd166;font-weight:900}.options-table th.strike{z-index:3}.options-table tr{cursor:pointer}.options-table tbody tr:hover td,.options-table tbody tr.selected td{background:#12352d}.options-table tbody tr.atm td{border-top:1px solid #ffd166;border-bottom:1px solid #ffd166}.options-call{color:#72f2b9}.options-put{color:#ff91a2}.options-contract{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}.options-contract article{padding:10px;border:1px solid #294554;border-radius:7px;background:#0b141c}.options-contract h3{margin:0 0 4px;color:#eef4f7;font-size:.7rem}.options-contract p{font:.63rem/1.45 system-ui}.options-glossary{margin-top:12px;padding:10px;border-left:3px solid #ffca55;background:#111a20;color:#9eb2bc;font:.67rem/1.5 system-ui}.options-error{color:#ff9dae!important}
@media(max-width:1100px){:root{--academy-lesson-rail:380px}body.academy-lesson-open .side{display:none}body.academy-lesson-open .shell{grid-template-columns:1fr}.options-summary{grid-template-columns:repeat(3,1fr)}.options-contract{grid-template-columns:repeat(2,1fr)}}
@media(max-width:820px){body.academy-lesson-open{overflow:hidden}body.academy-lesson-open main,body.academy-lesson-open .academy-below{width:100%}.lesson{width:100%;height:100dvh;border:0;border-radius:0}.options-summary{grid-template-columns:repeat(2,1fr)}.options-contract{grid-template-columns:1fr}}@media(min-width:821px){body.academy-lesson-open .bar>span{display:none}body.academy-lesson-open .bar strong{white-space:nowrap}body.academy-lesson-open .bar-rail>button{padding:4px 6px!important}body.academy-lesson-open .bar{gap:.45rem}}
</style>
 </head><body><main><div class="bar"><i class="dot"></i><strong>Making Easy Money Academy</strong><span>Live Chart Lab · Educational use only</span><button class="lesson-toggle" id="lesson-toggle">Start Class</button><button class="lesson-toggle" id="academy-unlock" type="button">Unlock Academy Tools</button><b class="status" id="status">CONNECTING</b></div><div class="dashbar"><b class="dashbrand">STOCKMARKETLOOP · ANALYST DASHBOARD</b><span class="academy-tag">ACADEMY MODE</span><span class="market-state">READ-ONLY TRAINING</span></div><div class="indices"><div class="index"><b>S&P 500</b><span>via SPY · <em id="idx-spy">—</em></span></div><div class="index"><b>NASDAQ</b><span>via QQQ · <em>LIVE</em></span></div><div class="index"><b>RUSSELL 2000</b><span>via IWM · <em>LIVE</em></span></div><div class="index"><b>MARKET BREADTH</b><span>Live dashboard tools</span></div></div><div class="shell"><section class="chart"><div class="toolbar"><input id="symbol" value="SPY" maxlength="10" aria-label="Ticker symbol"><button id="load">Load</button><span class="quote-chip sell">SELL <i id="sell">—</i></span><span class="quote-chip buy">BUY <i id="buy">—</i></span><small id="company">Live market data · Read-only</small><div class="intervals" aria-label="Chart intervals"><button data-tf="1m">1m</button><button data-tf="3m">3m</button><button data-tf="5m" class="active">5m</button><button data-tf="15m">15m</button><button data-tf="1h">1h</button><button data-tf="1D">1D</button><button data-tf="1W">1W</button><button data-tf="1M">1Mo</button><button data-tf="1Q">1Q</button><button data-tf="1Y">1Y</button></div></div><canvas id="chart" aria-label="Live interactive candlestick chart"></canvas></section><aside class="side"><h2 id="label">$SPY</h2><div class="quote" id="price">—</div><div class="change" id="change">Loading live market data</div><div class="book"><h3>TOP OF BOOK · ACADEMY VIEW</h3><div class="bookrow"><span class="bidtxt">BID</span><span id="bidbook">—</span></div><div class="bookrow"><span>SPREAD</span><span id="spread">—</span></div><div class="bookrow"><span class="asktxt">ASK</span><span id="askbook">—</span></div></div><div class="meta"></div><div class="options-focus" id="options-focus" hidden></div></aside></div></main><section class="academy-below" id="academy-below"><h2 class="below-title">SCANNER + OPTIONS LAB</h2><div id="academy-scanner-host"></div><section class="options-chain" id="options-chain"><div class="options-head"><div><h2>College Options Chain Lab</h2><p id="options-status">Unlock Academy Tools, then load a ticker’s verified educational options chain.</p></div><div class="options-actions"><label>Expiration<select id="options-expiry" disabled><option>Load chain first</option></select></label><label>Strikes<select id="options-range"><option value="12">12 around ATM</option><option value="20">20 around ATM</option><option value="40">40 around ATM</option><option value="all">All strikes</option></select></label><button id="load-options" type="button">Load Options Chain</button></div></div><div class="options-summary" id="options-summary" hidden></div><div class="options-table-wrap" id="options-table-wrap" hidden><table class="options-table"><thead><tr><th class="options-call">Call IV</th><th class="options-call">Delta</th><th class="options-call">Gamma</th><th class="options-call">Theta</th><th class="options-call">Vega</th><th class="options-call">Volume</th><th class="options-call">Open Int.</th><th class="options-call">Bid</th><th class="options-call">Ask</th><th class="options-call">Mid</th><th class="strike">Strike</th><th class="options-put">Mid</th><th class="options-put">Bid</th><th class="options-put">Ask</th><th class="options-put">Open Int.</th><th class="options-put">Volume</th><th class="options-put">Vega</th><th class="options-put">Theta</th><th class="options-put">Gamma</th><th class="options-put">Delta</th><th class="options-put">Put IV</th></tr></thead><tbody id="options-grid"></tbody></table></div><div class="options-contract" id="options-contract" hidden></div><div class="options-glossary"><strong>How to read this lab:</strong> midpoint is (bid + ask) ÷ 2; spread % measures execution friction; intrinsic value is immediate exercise value; extrinsic value is midpoint minus intrinsic value; call breakeven is strike + premium and put breakeven is strike − premium. Delta estimates price sensitivity, gamma estimates delta sensitivity, theta estimates time decay, vega estimates implied-volatility sensitivity, and open interest shows outstanding contracts—not directional intent. Values missing from the verified feed stay “—”.</div></section></section><section class="lesson" id="lesson" aria-label="Academy lesson"><small>MODULE 1 · LESSON 1</small><h2 id="lesson-title">How price discovery works</h2><div class="scene"><span class="bid">BID $100.00</span><span class="trade"></span><span class="ask">ASK $100.05</span></div><p id="lesson-copy">A market brings buyers and sellers together. The bid is the price a buyer is offering; the ask is what a seller currently requests. A trade occurs only when the two sides agree.</p><div class="answers" id="answers"><button data-answer="A">A. The bid is a guaranteed future price</button><button data-answer="B">B. The ask is what a seller currently requests</button><button data-answer="C">C. Every quote is a trading signal</button><button data-answer="D">D. The last trade predicts the next trade</button></div><p id="lesson-feedback" aria-live="polite"></p><div class="lesson-controls"><button id="read">Mute Voice</button><button class="alt" id="next-lesson">Next Concept</button><button class="alt" id="close-lesson">Back to Chart</button></div></section><script>
(()=>{const canvas=document.getElementById('chart'),ctx=canvas.getContext('2d'),sym=document.getElementById('symbol'),status=document.getElementById('status'),label=document.getElementById('label'),price=document.getElementById('price'),change=document.getElementById('change'),lesson=document.getElementById('lesson'),lessonTitle=document.getElementById('lesson-title'),lessonCopy=document.getElementById('lesson-copy'),feedback=document.getElementById('lesson-feedback'),answers=document.getElementById('answers');let bars=${initialBars},symbol=${initialSymbol},offset=0,scale=1,drag=null,slide=0;const slides=[['How price discovery works','A market brings buyers and sellers together. The bid is the price a buyer is offering; the ask is the price a seller is requesting. A trade occurs only when the two sides agree.'],['The spread is information','The difference between the bid and ask is called the spread. A narrower spread can indicate more active trading, while a wider spread can mean less liquidity or more uncertainty.'],['Read the chart in context','A candle records open, high, low, and close for a selected period. It describes what already occurred; it does not promise the next move.']];const esc=s=>String(s||'SPY').toUpperCase().replace(/[^A-Z0-9.:-]/g,'').slice(0,10)||'SPY';function renderSlide(){const item=slides[slide];lessonTitle.textContent=item[0];lessonCopy.textContent=item[1];feedback.textContent='';answers.style.display=slide===0?'grid':'none';document.getElementById('next-lesson').textContent=slide===slides.length-1?'Restart Class':'Next Concept'}function resize(){const r=canvas.getBoundingClientRect(),d=devicePixelRatio||1;canvas.width=Math.round(r.width*d);canvas.height=Math.round(r.height*d);ctx.setTransform(d,0,0,d,0);draw()}function draw(){const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;ctx.clearRect(0,0,w,h);if(!bars.length){ctx.fillStyle='#7f98a6';ctx.font='13px system-ui';ctx.fillText('Live market data is temporarily unavailable.',20,32);return}const pad={l:12,r:64,t:18,b:24},pw=w-pad.l-pad.r,ph=h-pad.t-pad.b,n=Math.max(12,Math.min(bars.length,Math.floor(105/scale))),end=Math.max(n,Math.min(bars.length,bars.length-offset)),view=bars.slice(end-n,end);let lo=Math.min(...view.map(b=>+b.l)),hi=Math.max(...view.map(b=>+b.h));if(hi===lo){hi+=1;lo-=1}const y=v=>pad.t+(hi-v)/(hi-lo)*ph;ctx.strokeStyle='rgba(116,153,170,.14)';ctx.lineWidth=1;for(let i=0;i<5;i++){const yy=pad.t+ph*i/4;ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(pad.l+pw,yy);ctx.stroke();ctx.fillStyle='#718694';ctx.font='10px ui-monospace';ctx.fillText((hi-(hi-lo)*i/4).toFixed(2),pad.l+pw+7,yy+3)}const step=pw/view.length;view.forEach((b,i)=>{const x=pad.l+(i+.5)*step,up=+b.c>=+b.o,color=up?'#00d084':'#ff5470';ctx.strokeStyle=color;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(x,y(+b.h));ctx.lineTo(x,y(+b.l));ctx.stroke();const top=y(Math.max(+b.o,+b.c)),bottom=y(Math.min(+b.o,+b.c));ctx.fillRect(x-step*.31,top,Math.max(1,step*.62),Math.max(1,bottom-top))});const focus=window.smlAcademyOptionsFocus;if(focus&&focus.strike!=null&&focus.strike>=lo&&focus.strike<=hi){const fy=y(focus.strike);ctx.save();ctx.strokeStyle='#ffd166';ctx.setLineDash([4,4]);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad.l,fy);ctx.lineTo(pad.l+pw,fy);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#ffd166';ctx.font='700 10px ui-monospace';ctx.fillText('$'+focus.strike.toFixed(2)+' strike',Math.max(pad.l,pad.l+pw-92),fy-4);ctx.restore()}ctx.fillStyle='#90a5b3';ctx.font='10px ui-monospace';ctx.fillText('LIVE · 5M',pad.l,h-8)}function setQuote(){if(!bars.length){status.textContent='RETRY';change.textContent='Live data is temporarily unavailable';change.style.color='#ffb454';return}const last=bars[bars.length-1],qc=window.smlAcademyChange?window.smlAcademyChange(symbol,+last.c):null;if(document.activeElement!==sym)sym.value=symbol;label.textContent='$'+symbol;price.textContent='$'+Number(last.c).toFixed(2);change.textContent=qc?qc.text:'';change.style.color=qc&&!qc.up?'#ff5470':'#00d084';status.textContent='LIVE'}function load(){const s=esc(sym.value);location.assign(location.pathname+'?symbol='+encodeURIComponent(s))}document.getElementById('load').onclick=load;sym.addEventListener('keydown',e=>{if(e.key==='Enter')load()});document.getElementById('lesson-toggle').onclick=()=>{if(lesson.classList.contains('open')){lesson.classList.remove('open');document.body.classList.remove('academy-lesson-open');return}lesson.classList.add('open');document.body.classList.add('academy-lesson-open');renderSlide()};document.getElementById('close-lesson').onclick=()=>{lesson.classList.remove('open');document.body.classList.remove('academy-lesson-open')};document.getElementById('next-lesson').onclick=()=>{slide=(slide+1)%slides.length;renderSlide()};document.getElementById('read').onclick=()=>{if(!('speechSynthesis'in window)){feedback.textContent='Read-aloud is unavailable in this Discord browser.';return}speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(lessonTitle.textContent+'. '+lessonCopy.textContent);utterance.rate=.93;speechSynthesis.speak(utterance)};answers.onclick=e=>{const target=e.target.closest('button[data-answer]');if(!target)return;const correct=target.dataset.answer==='B';answers.querySelectorAll('button').forEach(button=>button.className='');target.classList.add(correct?'good':'bad');feedback.textContent=correct?'Correct. The ask is the price a seller currently requests.':'Not quite. The correct answer is B: the ask is what a seller currently requests.'};canvas.addEventListener('wheel',e=>{e.preventDefault();scale=Math.max(.7,Math.min(4,scale*(e.deltaY>0?.86:1.16)));draw()},{passive:false});canvas.addEventListener('pointerdown',e=>{drag=e.clientX;canvas.setPointerCapture(e.pointerId)});canvas.addEventListener('pointermove',e=>{if(drag===null)return;offset=Math.max(0,Math.min(Math.max(0,bars.length-12),offset+Math.round((e.clientX-drag)/8)));drag=e.clientX;draw()});canvas.addEventListener('pointerup',()=>drag=null);window.addEventListener('sml-academy-options-focus',()=>draw());new ResizeObserver(resize).observe(canvas);setQuote();draw();setInterval(()=>location.reload(),30000)})();
</script><script>
(()=>{const price=document.getElementById('price'),company=document.getElementById('company'),sell=document.getElementById('sell'),buy=document.getElementById('buy'),bid=document.getElementById('bidbook'),ask=document.getElementById('askbook'),spread=document.getElementById('spread'),idx=document.getElementById('idx-spy'),symbol=document.getElementById('symbol');function quote(){const tf=new URLSearchParams(location.search).get('tf')||'5m',value=Number(String(price.textContent).replace(/[^0-9.]/g,''));if(!Number.isFinite(value)||value<=0)return;const tick=Math.max(.01,value*.0001),bidValue=(value-tick).toFixed(2),askValue=(value+tick).toFixed(2);sell.textContent=bidValue;buy.textContent=askValue;bid.textContent=bidValue;ask.textContent=askValue;spread.textContent=(tick*2).toFixed(4);company.textContent='Live '+tf+' candles · Academy read-only';idx.textContent='LIVE';document.querySelectorAll('[data-tf]').forEach(button=>button.classList.toggle('active',button.dataset.tf===tf))}window.smlAcademyRefreshQuote=quote;document.querySelectorAll('[data-tf]').forEach(button=>button.onclick=()=>window.smlAcademyNavigateMarket?.(symbol.value,button.dataset.tf));quote()})();
</script><script>
/* Preserve the selected timeframe when a learner changes tickers. This runs
   after the compact chart host so it intentionally replaces only its loader. */
(()=>{const symbol=document.getElementById('symbol'),load=document.getElementById('load'),status=document.getElementById('status'),label=document.getElementById('label'),clean=value=>String(value||'SPY').toUpperCase().replace(/[^A-Z0-9.:-]/g,'').slice(0,10)||'SPY';
/* A ticker or interval change shows something the moment it is asked for: the symbol, label and interval buttons update at once, a symbol seen in the last five minutes paints from memory while it refreshes, and one typed a moment ago is already fetched. Only the newest request may change the chart, so a slow earlier ticker can never overwrite the one typed last; identical requests share one network call. */
const cache=new Map(),FRESH=8000,USABLE=300000;let seq=0,prefetchTimer=0;
const currentTf=()=>new URLSearchParams(location.search).get('tf')||'5m';
const tfButtons=tf=>document.querySelectorAll('[data-tf]').forEach(button=>button.classList.toggle('active',button.dataset.tf===tf));
const remember=(key,payload)=>{cache.set(key,{at:Date.now(),payload});if(cache.size>30)cache.delete(cache.keys().next().value)};
const usable=payload=>payload&&Array.isArray(payload.bars)&&payload.bars.length;
/* Every timeframe of the symbol on screen is fetched behind the first one and kept warm, so a timeframe button paints from memory.
   When a timeframe has not arrived yet, its candles are built on the spot from the finest cached timeframe that divides it (3m from 1m,
   15m from 5m...) and painted as STALE until the real bars land. */
const TF_MS={'1m':60000,'3m':180000,'5m':300000,'15m':900000,'1h':3600000},WARM_TFS=['1m','3m','5m','15m','1h','1D'];let warmTimer=0,warmFor='';
const fresh=(ticker,tf)=>{const hit=cache.get(ticker+':'+tf);return hit&&Date.now()-hit.at<FRESH*5};
const warm=ticker=>{if(warmFor===ticker&&warmTimer)return;clearInterval(warmTimer);warmFor=ticker;const pass=()=>{if(clean(symbol.value)!==ticker&&String((window.smlAcademyChartState?.()||{}).symbol||'')!==ticker){clearInterval(warmTimer);warmTimer=0;warmFor='';return}if(document.hidden)return;const want=WARM_TFS.filter(t=>t!==currentTf()&&!fresh(ticker,t)&&!inflight.has(ticker+':'+t));want.forEach((t,i)=>setTimeout(()=>{if(warmFor===ticker)get(ticker,t).catch(()=>{})},200+i*220))};setTimeout(pass,400);warmTimer=setInterval(pass,45000)};
const derive=(ticker,tf)=>{const ms=TF_MS[tf];if(!ms)return null;for(const src of ['1m','3m','5m','15m']){const sm=TF_MS[src];if(src===tf||!sm||ms%sm!==0)continue;const hit=cache.get(ticker+':'+src);if(!hit||Date.now()-hit.at>USABLE||!usable(hit.payload))continue;const out=[];let cur=null;for(const b of hit.payload.bars){const t=Math.floor(Number(b.t)/ms)*ms;if(!cur||cur.t!==t){cur={t:t,o:b.o,h:b.h,l:b.l,c:b.c,v:Number(b.v)||0};out.push(cur)}else{if(b.h>cur.h)cur.h=b.h;if(b.l<cur.l)cur.l=b.l;cur.c=b.c;cur.v+=Number(b.v)||0}}if(out.length<3)continue;return Object.assign({},hit.payload,{tf:tf,bars:out.slice(-600),derived:true,derivedFrom:src,stale:true})}return null};
const inflight=new Map();
const get=(ticker,tf)=>{const key=ticker+':'+tf;if(inflight.has(key))return inflight.get(key);const request=(async()=>{const response=await fetch('/academy-activity/market?symbol='+encodeURIComponent(ticker)+'&tf='+encodeURIComponent(tf),{cache:'no-store'}),payload=await response.json();if(!response.ok||!usable(payload))throw new Error('market');remember(key,payload);return payload})();inflight.set(key,request);const clear=()=>{if(inflight.get(key)===request)inflight.delete(key)};request.then(clear,clear);return request};
/* While a new stock's candles are on their way the old price and chart must not sit under the new name: the readouts blank, the chart dims, and the live feed ignores ticks (window.smlNavPending) until the new data lands or the change fails */
const pendingUi=(on,restore)=>{const ph=document.getElementById('price'),chg=document.getElementById('change'),st=document.querySelector('.academy-chart-stage');if(!pendingUi.css){pendingUi.css=1;document.head.appendChild(Object.assign(document.createElement('style'),{textContent:'.sml-nav-pending canvas{opacity:.3;transition:opacity .12s}'}))}if(on){pendingUi.saved=[ph?ph.textContent:'',chg?chg.textContent:'',chg?chg.style.color:''];if(ph)ph.textContent='$–';if(chg)chg.textContent='';if(st)st.classList.add('sml-nav-pending');return}if(st)st.classList.remove('sml-nav-pending');window.smlNavPending='';if(restore&&pendingUi.saved){if(ph)ph.textContent=pendingUi.saved[0];if(chg){chg.textContent=pendingUi.saved[1];chg.style.color=pendingUi.saved[2]}}pendingUi.saved=null};
const commit=(ticker,tf,payload)=>{pendingUi(false);const keep=new URLSearchParams(location.search);keep.set('symbol',ticker);keep.set('tf',tf);history.replaceState(null,'',location.pathname+'?'+keep.toString());window.smlAcademyApplyMarket?.(payload);window.smlAcademyRefreshQuote?.()};
/* The change a trader reads on a quote is against the previous trading day's close (what the scanner and every platform use), never the previous candle of whatever interval is on screen. Taken from the daily candles; fetched once if they are not cached yet. */
const etDay=ms=>new Date(ms).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
const prevCloseOf=bars=>{if(!Array.isArray(bars)||!bars.length)return null;const today=etDay(Date.now()),dow=new Date(today+'T12:00:00Z').getUTCDay();let i=bars.length-1;while(i>=0&&etDay(Number(bars[i].t))>=today)i-=1;if(i>=0&&(dow===0||dow===6)&&etDay(Number(bars[i].t))<today)i-=1;const c=i>=0?Number(bars[i].c):NaN;return c>0?c:null};
window.smlAcademyPrevClose=(ticker,price)=>{const t=clean(ticker),key=t+':1D',hit=cache.get(key);if(!hit||Date.now()-hit.at>43200000){if(!inflight.has(key))get(t,'1D').then(()=>{window.smlAcademyRepaintQuote?.();window.smlAcademyRefreshQuote?.()}).catch(()=>{})}const prev=hit?prevCloseOf(hit.payload.bars):null;if(!(prev>0))return null;const p=Number(price);return p>0?{prev,delta:p-prev,pct:(p/prev-1)*100}:{prev,delta:null,pct:null}};
const etHm=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const etAt=t=>{const o={};for(const x of etHm.formatToParts(new Date(Number(t))))o[x.type]=x.value;return{day:o.year+'-'+o.month+'-'+o.day,min:Number(o.hour)*60+Number(o.minute)}};
window.smlAcademyPostSession=()=>{const m=window.smlChartModel&&window.smlChartModel(),bars=m&&m.bars;if(!Array.isArray(bars)||bars.length<2)return null;const end=etAt(bars[bars.length-1].t);if(!(end.min>=960&&end.min<1200))return null;let reg=null,post=null;for(let i=bars.length-1;i>=0;i--){const a=etAt(bars[i].t);if(a.day!==end.day)break;const c=Number(bars[i].c);if(!(c>0))continue;if(a.min>=960&&a.min<1200){if(post==null)post=c}else if(a.min<960&&a.min>=570){reg=c;break}}return reg>0&&post>0?{reg,post,pct:(post/reg-1)*100,delta:post-reg}:null};
window.smlAcademyChange=(ticker,price)=>{const ps=window.smlAcademyPostSession();const dc=window.smlAcademyPrevClose?window.smlAcademyPrevClose(ticker,ps?ps.reg:+price):null;if(!dc||dc.pct==null)return null;const up=dc.delta>=0;return{up,text:(up?'▲ +':'▼ ')+dc.delta.toFixed(2)+' ('+dc.pct.toFixed(2)+'%)'+(ps?'  ·  After hours '+(ps.delta>=0?'+':'')+ps.pct.toFixed(2)+'%':''),color:up?'#00d084':'#ff5470'}};
window.smlAcademyNavigateMarket=async(value,requestedTf)=>{const ticker=clean(value),tf=String(requestedTf||currentTf()),key=ticker+':'+tf,mine=++seq,previous=String((window.smlAcademyChartState?.()||{}).symbol||''),tfChanged=tf!==currentTf();
symbol.value=ticker;if(label)label.textContent='$'+ticker;status.textContent='LOADING';tfButtons(tf);window.smlAcademyPrevClose&&window.smlAcademyPrevClose(ticker);
const hit=cache.get(key);let shown=false;
/* an interval change always fetches fresh bars: a remembered payload may paint first, but it is labelled STALE and never ends the request */
if(hit&&Date.now()-hit.at<USABLE){commit(ticker,tf,hit.payload);shown=true;status.textContent=tfChanged?'STALE':'LIVE';if(!tfChanged&&Date.now()-hit.at<FRESH){warm(ticker);return}}
if(!shown){const built=derive(ticker,tf);if(built){commit(ticker,tf,built);shown=true;status.textContent='STALE'}}
if(!shown&&ticker!==previous){window.smlNavPending=ticker;pendingUi(true)}
try{const payload=await get(ticker,tf);if(mine!==seq)return;commit(ticker,tf,payload);status.textContent=payload.stale?'STALE':'LIVE';warm(ticker);
/* a copy the server answered from memory is followed by the fresh one a moment later, so the label settles on LIVE by itself */
if(payload.stale)setTimeout(()=>{if(mine!==seq)return;cache.delete(key);get(ticker,tf).then(fresh=>{if(mine===seq&&!fresh.stale){commit(ticker,tf,fresh);status.textContent='LIVE'}}).catch(()=>{})},1200)}
catch(error){if(mine!==seq)return;if(!shown){pendingUi(false,true);if(previous){symbol.value=previous;if(label)label.textContent='$'+previous}tfButtons(currentTf())}status.textContent='RETRY'}};
const prefetch=()=>{const ticker=clean(symbol.value),tf=currentTf(),key=ticker+':'+tf,hit=cache.get(key);if(ticker.length<2||!/^[A-Z][A-Z0-9.:-]*$/.test(ticker)||ticker===String((window.smlAcademyChartState?.()||{}).symbol||'')||inflight.has(key)||(hit&&Date.now()-hit.at<FRESH*3))return;get(ticker,tf).catch(()=>{})};
symbol.addEventListener('input',()=>{clearTimeout(prefetchTimer);prefetchTimer=setTimeout(prefetch,300)});
const go=()=>window.smlAcademyNavigateMarket(symbol.value);load.onclick=go;symbol.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.stopImmediatePropagation();go()}},true);
/* the symbol the page opened with gets its other timeframes fetched behind the first paint too */
setTimeout(()=>warm(clean(symbol.value)),1500)})();
</script><script>
(()=>{const host=document.getElementById('academy-scanner-host'),source=${initialScanner};window.__smlScanLock=${initialScanLock};if(!host)return;const etfs=new Set(['SPY','QQQ','IWM','DIA','VTI','VOO','XLF','XLE','XLK','XLV','XLI','XLY','XLP','XLU','XLB','SMH','SOXL','SOXS','TQQQ','SQQQ','UVXY','ARKK','GLD','SLV','USO','TLT','HYG','EEM','BITO','IBIT']);let rows=Array.isArray(source)?source:[],tab='stocks',query='',preset='full',colors='red-green',page=1,sortKey='changePct',sortDir=-1;const n=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v),compact=v=>{v=n(v);if(v==null)return'—';if(Math.abs(v)>=1e12)return(v/1e12).toFixed(2)+'T';if(Math.abs(v)>=1e9)return(v/1e9).toFixed(2)+'B';if(Math.abs(v)>=1e6)return(v/1e6).toFixed(2)+'M';if(Math.abs(v)>=1e3)return(v/1e3).toFixed(1)+'K';return String(Math.round(v))},signed=(v,suffix='')=>{v=n(v);return v==null?'—':(v>=0?'+':'')+v.toFixed(2)+suffix},session=()=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date()),x={};parts.forEach(p=>x[p.type]=p.value);if(x.weekday==='Sat'||x.weekday==='Sun')return'CLOSED';const mins=Number(x.hour)*60+Number(x.minute);return mins>=240&&mins<570?'PREMARKET':mins>=570&&mins<960?'MARKET OPEN':mins>=960&&mins<1200?'AFTER HOURS':'CLOSED'},field=(r,k)=>{if(k==='turnover')return n(r.price)*n(r.volume);if(k==='relVolume')return n(r.previousVolume)>0?n(r.volume)/n(r.previousVolume):null;if(k==='preMarketPct')return n(r.open)&&n(r.previousClose)?(n(r.open)-n(r.previousClose))/n(r.previousClose)*100:null;if(k==='sire')return r.sire;return r[k]},columns={core:[['rank','#'],['symbol','Symbol'],['name','Name'],['price','Latest'],['change','Chg'],['changePct','% Chg'],['volume','Volume'],['turnover','Turnover'],['preMarketPct','Pre-Mkt %Chg'],['postMarketPct','Post-Mkt %Chg'],['sire','S.I.R.E']],full:[['rank','#'],['symbol','Symbol'],['name','Name'],['price','Latest'],['change','Chg'],['changePct','% Chg'],['volume','Volume'],['turnover','Turnover'],['preMarketPct','Pre-Mkt %Chg'],['postMarketPct','Post-Mkt %Chg'],['sire','S.I.R.E'],['relVolume','Volume Ratio'],['bid','Bid'],['bidSize','Bid Size'],['ask','Ask'],['askSize','Ask Size']],pro:[['rank','#'],['symbol','Symbol'],['name','Name'],['price','Latest'],['change','Chg'],['changePct','% Chg'],['volume','Volume'],['turnover','Turnover'],['preMarketPct','Pre-Mkt %Chg'],['postMarketPct','Post-Mkt %Chg'],['sire','S.I.R.E'],['relVolume','Volume Ratio'],['bid','Bid'],['bidSize','Bid Size'],['ask','Ask'],['askSize','Ask Size'],['marketCap','Market Cap'],['peTtm','P/E TTM'],['pb','P/B'],['rsi','RSI'],['macd','MACD']]};const panel=document.createElement('section');panel.className='academy-scanner';panel.innerHTML='<div class="academy-scan-head"><strong class="academy-scan-title">LIVE MARKET SCANNER</strong><span class="academy-scan-live">Live stream</span></div><div class="academy-scan-tabs" role="tablist"><button data-tab="stocks" class="on">US STOCKS</button><button data-tab="etfs">ETFS</button><button data-tab="options">OPTIONS</button><button data-tab="premarket">PREMARKET</button><button data-tab="afterhours">AFTER HOURS</button></div><div class="academy-scan-tools"><input id="academy-scan-search" placeholder="Search any U.S. symbol or company..." aria-label="Search scanner"><select id="academy-scan-preset" title="Scanner columns"><option value="core">Core</option><option value="full" selected>Full</option><option value="pro">Pro Screener</option></select><select id="academy-scan-colors" title="Quote color scheme"><option value="red-green">Red / Green</option><option value="pink-green">Pink / Green</option></select><button id="academy-scan-refresh">Refresh</button></div><div class="academy-monitor"><span>BULLISH ALERTS TODAY<b id="academy-bulls">0</b></span><span>BEARISH ALERTS TODAY<b id="academy-bears">0</b></span><span>MARKET STATUS<b id="academy-market-state">'+session()+'</b></span></div><div class="academy-pro-note">Same Analyst Dashboard scanner controls and columns. Unsupported provider fields display — instead of estimated data.</div><div class="academy-scan-wrap"><table class="academy-scan-table"><thead id="academy-scan-head"></thead><tbody id="academy-scan-body"></tbody></table></div><div class="academy-scan-foot"><span id="academy-scan-count"></span><div class="academy-scan-pages" id="academy-scan-pages"></div></div>';host.appendChild(panel);const head=panel.querySelector('#academy-scan-head'),body=panel.querySelector('#academy-scan-body'),count=panel.querySelector('#academy-scan-count'),pages=panel.querySelector('#academy-scan-pages');let lastSort=0;const PHONE_KEEP=['symbol','price','changePct','volume'],phoneMQ=window.matchMedia('(max-width:720px)');function phoneCols(c){return phoneMQ.matches?c.filter(x=>PHONE_KEEP.includes(x[0])):c}function patchRows(){const map=new Map(rows.map(r=>[r.symbol,r]));body.querySelectorAll('tr[data-symbol]').forEach(tr=>{const r=map.get(tr.dataset.symbol);if(!r)return;tr.querySelectorAll('td[data-k]').forEach(td=>{const k=td.dataset.k;if(k==='sire')return;const v=field(r,k),t=display(k,v);if(td.textContent!==t)td.textContent=t;if(['change','changePct','preMarketPct','postMarketPct'].includes(k)){const c=cls(v);if(!td.classList.contains(c)){td.classList.remove('academy-positive','academy-negative','academy-muted');td.classList.add(c)}}})});panel.querySelector('#academy-bulls').textContent=rows.filter(r=>n(r.changePct)>0).length;panel.querySelector('#academy-bears').textContent=rows.filter(r=>n(r.changePct)<0).length;panel.querySelector('#academy-market-state').textContent=session()}function softRender(){const quiet=Date.now()-(window.__smlScanTouch||0)>5000&&Date.now()-lastSort>20000;if(quiet||!body.children.length){render();return}patchRows()}['pointerdown','touchstart','touchmove','wheel','scroll'].forEach(ev=>window.addEventListener(ev,()=>{window.__smlScanTouch=Date.now()},{passive:true,capture:true}));if(phoneMQ.addEventListener)phoneMQ.addEventListener('change',()=>render());function cls(v){v=n(v);return v==null?'academy-muted':v>=0?'academy-positive':'academy-negative'}function filtered(){let out=rows.map((r,i)=>({...r,sire:i+1}));if(tab==='etfs')out=out.filter(r=>etfs.has(r.symbol));else if(tab==='stocks')out=out.filter(r=>!etfs.has(r.symbol));else if(tab==='premarket')out=out.filter(r=>field(r,'preMarketPct')!=null).sort((a,b)=>(field(b,'preMarketPct')??-Infinity)-(field(a,'preMarketPct')??-Infinity));else if(tab==='afterhours')out=out.filter(r=>n(r.postMarketPct)!=null).sort((a,b)=>(n(b.postMarketPct)??-Infinity)-(n(a.postMarketPct)??-Infinity));if(query)out=out.filter(r=>(r.symbol+' '+(r.name||'')).toUpperCase().includes(query));out.sort((a,b)=>{const av=field(a,sortKey),bv=field(b,sortKey);if(sortKey==='symbol'||sortKey==='name')return sortDir*String(av||'').localeCompare(String(bv||''));if(av==null&&bv==null)return 0;if(av==null)return 1;if(bv==null)return-1;return sortDir*(Number(av)-Number(bv))});return out}function display(k,v){if(['changePct','preMarketPct','postMarketPct'].includes(k))return signed(v,'%');if(['price','bid','ask'].includes(k))return n(v)==null?'—':Number(v).toFixed(2);if(k==='change')return signed(v);if(['volume','turnover','marketCap'].includes(k))return compact(v);if(['bidSize','askSize'].includes(k))return n(v)==null?'—':compact(Number(v)*100);if(k==='relVolume')return n(v)==null?'—':Number(v).toFixed(2);return v==null||v===''?'—':String(v)}function render(){lastSort=Date.now();if(tab==='options'){document.getElementById('options-chain').scrollIntoView({behavior:'smooth',block:'start'});setTimeout(()=>{const lb=document.getElementById('load-options');if(lb&&!lb.disabled&&window.smlAcademySessionToken&&!document.querySelector('#options-grid tr'))lb.click()},450);tab='stocks';panel.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('on',b.dataset.tab==='stocks'))}const cols=phoneCols(columns[preset]||columns.full),all=filtered(),per=15,max=Math.max(1,Math.ceil(all.length/per));page=Math.min(page,max);const start=(page-1)*per,shown=all.slice(start,start+per);head.innerHTML='<tr>'+cols.map(([k,label])=>'<th data-sort="'+k+'">'+label+(sortKey===k?(sortDir<0?' ▼':' ▲'):'')+'</th>').join('')+'</tr>';body.innerHTML=shown.map((r,i)=>'<tr data-symbol="'+r.symbol+'">'+cols.map(([k])=>{if(k==='rank')return'<td class="academy-muted">'+(start+i+1)+'</td>';if(k==='symbol')return'<td><span class="academy-scan-symbol">'+r.symbol+'</span></td>';if(k==='name')return'<td><span class="academy-scan-name">'+(r.name||'—')+'</span></td>';const v=field(r,k);return'<td data-k="'+k+'" class="'+(['change','changePct','preMarketPct','postMarketPct','sire'].includes(k)?cls(v):'')+'">'+display(k,v)+'</td>'}).join('')+'</tr>').join('')||'<tr><td colspan="'+cols.length+'" class="academy-scan-empty">'+((window.__smlScanLock&&window.__smlScanLock.locked)?('The live scanner is part of Academy access.'+(window.__smlScanLock.count?' '+window.__smlScanLock.count+' tickers are ranking live right now.':'')):'No verified matches for this view.')+'</td></tr>';restoreLive();count.textContent='Showing '+(all.length?start+1:0)+' to '+Math.min(start+per,all.length)+' of '+all.length+' live results · VERIFIED MARKET FEED';pages.innerHTML='';for(let p=1;p<=Math.min(max,7);p++){const b=document.createElement('button');b.textContent=p;b.className=p===page?'on':'';b.onclick=()=>{page=p;render()};pages.appendChild(b)}panel.querySelector('#academy-bulls').textContent=rows.filter(r=>n(r.changePct)>0).length;panel.querySelector('#academy-bears').textContent=rows.filter(r=>n(r.changePct)<0).length;panel.querySelector('#academy-market-state').textContent=session()}panel.addEventListener('click',e=>{const tabButton=e.target.closest('[data-tab]');if(tabButton){tab=tabButton.dataset.tab;page=1;panel.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('on',b===tabButton));render();return}const th=e.target.closest('[data-sort]');if(th){const key=th.dataset.sort;if(sortKey===key)sortDir*=-1;else{sortKey=key;sortDir=-1}page=1;render();return}const tr=e.target.closest('tr[data-symbol]');if(tr){const symbol=document.getElementById('symbol');symbol.value=tr.dataset.symbol;document.getElementById('load').click()}});/* Live cells (moomoo model, shared with the SIRE panel): the stream patches price, change, % change, volume, turnover, S.I.R.E. and the top of book in place, boxing each cell that moved in its direction colour; the 4 s refresh below overlays the live values so a re-render never steps a price back. */const LIVE_FIELDS=['price','change','changePct','volume','bid','ask','bidSize','askSize','changeRate3min'],liveKey=f=>f==='changeRate3min'?'sire':f;function restoreLive(){const lc=window.smlLiveCells;if(!lc)return;body.querySelectorAll('tr[data-symbol]').forEach(tr=>tr.querySelectorAll('td[data-k]').forEach(td=>lc.restore(td,tr.dataset.symbol+':'+td.dataset.k)))}function overlayLive(){const lc=window.smlLiveCells;if(!lc||!lc.feed.streaming())return;rows.forEach(r=>{const l=lc.feed.get(r.symbol);if(!l)return;LIVE_FIELDS.forEach(f=>{if(l[f]!=null)r[f]=l[f]})})}function onLive(kind,list){const lc=window.smlLiveCells;if(kind!=='tick'||!lc)return;list.forEach(u=>{const r=rows.find(x=>x.symbol===u.symbol);if(!r||u.gone)return;const tr=body.querySelector('tr[data-symbol="'+u.symbol+'"]');let money=false;Object.keys(u.changed).forEach(f=>{if(!LIVE_FIELDS.includes(f))return;const prev=n(r[f]),cur=n(u.changed[f].to);r[f]=cur;if(f==='price'||f==='volume')money=true;if(!tr)return;const k=liveKey(f),td=tr.querySelector('td[data-k="'+k+'"]');if(!td)return;const v=field(r,k);td.textContent=display(k,v);if(['change','changePct','preMarketPct','postMarketPct','sire'].includes(k))td.className=cls(v);if(prev!=null&&cur!=null&&cur!==prev)lc.mark(td,cur>prev?1:-1,u.symbol+':'+k)});if(tr&&money){const td=tr.querySelector('td[data-k="turnover"]');if(td)td.textContent=display('turnover',field(r,'turnover'))}})}(function hookLive(t){const lc=window.smlLiveCells;if(!lc){if(t<150)setTimeout(()=>hookLive(t+1),200);return}lc.feed.subscribe(onLive)})(0);panel.querySelector('#academy-scan-search').oninput=e=>{query=String(e.target.value||'').trim().toUpperCase();page=1;render()};panel.querySelector('#academy-scan-preset').onchange=e=>{preset=e.target.value;render()};panel.querySelector('#academy-scan-colors').onchange=e=>{colors=e.target.value;panel.style.setProperty('--academy-down',colors==='pink-green'?'#ff69b4':'#ff778b')};panel.querySelector('#academy-scan-refresh').onclick=()=>location.reload();render()})();
</script><script>
(()=>{const side=document.querySelector('.side'),depth=${initialDepth};if(!side)return;const style=document.createElement('style');style.textContent='.academy-depth{margin-top:14px;border-top:1px solid #1b3540;padding-top:12px}.academy-depth h3{font-size:.68rem;margin:0 0 7px;color:#86a2b0}.academy-depth-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.academy-depth-col b{display:block;font:800 .58rem ui-monospace;margin-bottom:4px}.academy-depth-bid{color:#52e6ad}.academy-depth-ask{color:#ff778b}.academy-depth-row{display:flex;justify-content:space-between;gap:4px;padding:3px 0;border-bottom:1px solid rgba(42,66,78,.45);font:.58rem ui-monospace}.academy-depth-row span:last-child{color:#9db2bd}.academy-depth-empty{font-size:.7rem;color:#8094a2;padding:5px 0}';document.head.appendChild(style);const panel=document.createElement('section');panel.className='academy-depth';const title=document.createElement('h3');title.textContent='LEVEL 2 DEPTH · LIVE';panel.appendChild(title);const bids=Array.isArray(depth.bids)?depth.bids:[],asks=Array.isArray(depth.asks)?depth.asks:[];if(!bids.length&&!asks.length){const empty=document.createElement('div');empty.className='academy-depth-empty';empty.textContent='Level 2 is temporarily unavailable.';panel.appendChild(empty)}else{const grid=document.createElement('div');grid.className='academy-depth-grid';[['BID',bids,'academy-depth-bid'],['ASK',asks,'academy-depth-ask']].forEach(([name,rows,color])=>{const col=document.createElement('div');col.className='academy-depth-col';const head=document.createElement('b');head.className=color;head.textContent=name;col.appendChild(head);rows.slice(0,10).forEach(row=>{const item=document.createElement('div'),p=document.createElement('span'),s=document.createElement('span');item.className='academy-depth-row';p.textContent=Number(row.price).toFixed(2);s.textContent=Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(Number(row.size));item.append(p,s);col.appendChild(item)});grid.appendChild(col)});panel.appendChild(grid)}side.insertBefore(panel,side.querySelector('.meta'))})();
</script><script>
(()=>{const button=document.getElementById('load-options'),grid=document.getElementById('options-grid'),status=document.getElementById('options-status'),symbol=document.getElementById('symbol');if(!button||!grid||!status||!symbol)return;let session=String(window.smlAcademySessionToken||'');window.addEventListener('sml-academy-session',event=>{session=String(event.detail&&event.detail.sessionToken||'');if(session)status.textContent='Academy access verified. Choose a ticker and load its educational options chain.'});const clean=value=>String(value||'SPY').toUpperCase().replace(/[^A-Z0-9.:-]/g,'').slice(0,10)||'SPY';const optionRows=value=>{const found=[];const walk=node=>{if(found.length>=24||!node)return;if(Array.isArray(node)){node.forEach(walk);return}if(typeof node!=='object')return;const strike=Number(node.strike??node.strikePrice);if(Number.isFinite(strike))found.push(node);else Object.values(node).forEach(walk)};walk(value);return found};const cell=(text,head=false)=>{const span=document.createElement('span');span.textContent=String(text??'—');if(head)span.className='head';grid.appendChild(span)};button.onclick=async()=>{if(!session)session=String(window.smlAcademySessionToken||'');if(!session){status.textContent='Unlock Academy Tools first so Discord can verify your private Academy access.';return}button.disabled=true;status.textContent='Loading options chain…';try{const response=await fetch('/academy-activity/data/options?symbol='+encodeURIComponent(clean(symbol.value)),{headers:{authorization:'Bearer '+session},cache:'no-store'});const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'unavailable');const rows=optionRows(payload.data);grid.replaceChildren();['Expiry','Strike','Call bid','Call ask','Put bid','Put ask'].forEach(label=>cell(label,true));rows.forEach(row=>{cell(row.expiration??row.expiry??row.date);cell(Number(row.strike??row.strikePrice).toFixed(2));cell(row.callBid??row.call?.bid);cell(row.callAsk??row.call?.ask);cell(row.putBid??row.put?.bid);cell(row.putAsk??row.put?.ask)});grid.hidden=false;status.textContent=rows.length?'Educational chain loaded. Use Module 9 and Module 23 before interpreting it.':'The provider returned no displayable contracts for this ticker.'}catch(_){grid.hidden=true;status.textContent='Options data is temporarily unavailable. The options curriculum remains available in Lessons.'}finally{button.disabled=false}}})();
</script><script>
${OPTIONS_CHAIN_MODULE}
/* Provider-tolerant, educational options-chain renderer. It accepts paired
   strike rows or separate call/put contracts and never manufactures data. */
(()=>{const button=document.getElementById('load-options'),body=document.getElementById('options-grid'),status=document.getElementById('options-status'),symbol=document.getElementById('symbol'),expiry=document.getElementById('options-expiry'),range=document.getElementById('options-range'),wrap=document.getElementById('options-table-wrap'),summary=document.getElementById('options-summary'),inspector=document.getElementById('options-contract');if(!button||!body)return;let session=String(window.smlAcademySessionToken||''),chain=[],spot=null,selected=null,streamCtl=null;window.addEventListener('sml-academy-session',event=>{session=String(event.detail&&event.detail.sessionToken||'');if(session)status.textContent='Academy access verified. Load a ticker to inspect its verified chain.'});const n=value=>value==null||value===''||!Number.isFinite(Number(value))?null:Number(value),clean=value=>String(value||'SPY').toUpperCase().replace(/[^A-Z0-9.:-]/g,'').slice(0,10)||'SPY',pick=(object,keys)=>{for(const key of keys){const value=object&&object[key];if(value!==undefined&&value!==null&&value!=='')return value}return null},num=(object,keys)=>n(pick(object,keys)),dateOf=object=>String(pick(object,['expiration','expirationDate','expiry','expiryDate','date','expDate'])||'Unknown'),sideFrom=(object,prefix='')=>{const cap=prefix?prefix[0].toUpperCase()+prefix.slice(1):'',nested=object&&object[prefix]&&typeof object[prefix]==='object'?object[prefix]:{},value=(keys)=>num(nested,keys)??num(object,keys.flatMap(key=>prefix?[prefix+key[0].toUpperCase()+key.slice(1),prefix+'_'+key,key+cap]:[key]));return{bid:value(['bid','bidPrice']),ask:value(['ask','askPrice']),last:value(['last','lastPrice','price']),volume:value(['volume','vol']),oi:value(['openInterest','open_interest','oi']),iv:value(['impliedVolatility','implied_volatility','iv']),delta:value(['delta']),gamma:value(['gamma']),theta:value(['theta']),vega:value(['vega'])}},kindOf=object=>String(pick(object,['contractType','optionType','right','side','type'])||'').toLowerCase();const normalize=data=>window.SmlOptionsChain.normalize(data),findSpot=data=>window.SmlOptionsChain.findSpot(data),expirationsOf=(data,rows)=>window.SmlOptionsChain.expirations(data,rows);let expiryCache=new Map();const mid=side=>side&&side.bid!=null&&side.ask!=null?(side.bid+side.ask)/2:side?.last??null,fmt=(value,digits=2)=>value==null?'—':Number(value).toFixed(digits),whole=value=>value==null?'—':Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(value),pct=value=>value==null?'—':(value*100).toFixed(1)+'%',iso=value=>{const parsed=new Date(value+'T12:00:00');return Number.isNaN(parsed.valueOf())?value:parsed.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})},dte=value=>{const end=new Date(value+'T23:59:59'),now=new Date();return Number.isNaN(end.valueOf())?null:Math.max(0,Math.ceil((end-now)/86400000))};function metric(label,value){const item=document.createElement('span'),b=document.createElement('b');item.textContent=label;b.textContent=value;item.appendChild(b);summary.appendChild(item)}function td(row,text,className=''){const cell=document.createElement('td');cell.textContent=text;if(className)cell.className=className;row.appendChild(cell)}function sideCells(row,side,reverse=false){const values=reverse?[fmt(mid(side)),fmt(side?.bid),fmt(side?.ask),whole(side?.oi),whole(side?.volume),fmt(side?.vega,3),fmt(side?.theta,3),fmt(side?.gamma,3),fmt(side?.delta,3),pct(side?.iv)]:[pct(side?.iv),fmt(side?.delta,3),fmt(side?.gamma,3),fmt(side?.theta,3),fmt(side?.vega,3),whole(side?.volume),whole(side?.oi),fmt(side?.bid),fmt(side?.ask),fmt(mid(side))];values.forEach(value=>td(row,value))}function details(item){if(!item){inspector.hidden=true;return}selected=item;inspector.replaceChildren();const add=(title,text)=>{const article=document.createElement('article'),h=document.createElement('h3'),p=document.createElement('p');h.textContent=title;p.textContent=text;article.append(h,p);inspector.append(article)};const callMid=mid(item.call),putMid=mid(item.put),callIntrinsic=spot==null?null:Math.max(spot-item.strike,0),putIntrinsic=spot==null?null:Math.max(item.strike-spot,0),spread=side=>side?.bid!=null&&side?.ask!=null?side.ask-side.bid:null,spreadPct=side=>{const value=spread(side),center=mid(side);return value!=null&&center>0?value/center:null};add('Contract context',clean(symbol.value)+' · '+iso(item.expiry)+' · '+(dte(item.expiry)??'—')+' DTE · $'+fmt(item.strike)+' strike');add('Call economics','Mid $'+fmt(callMid)+' · spread '+pct(spreadPct(item.call))+' · intrinsic $'+fmt(callIntrinsic)+' · extrinsic $'+fmt(callMid==null||callIntrinsic==null?null:Math.max(0,callMid-callIntrinsic))+' · breakeven $'+fmt(callMid==null?null:item.strike+callMid));add('Put economics','Mid $'+fmt(putMid)+' · spread '+pct(spreadPct(item.put))+' · intrinsic $'+fmt(putIntrinsic)+' · extrinsic $'+fmt(putMid==null||putIntrinsic==null?null:Math.max(0,putMid-putIntrinsic))+' · breakeven $'+fmt(putMid==null?null:item.strike-putMid));add('Risk interpretation','A narrow spread may reduce entry friction. High open interest may improve depth but does not guarantee liquidity. Greeks are model estimates and change as price, time, and implied volatility change.');inspector.hidden=false}function stopStream(){if(streamCtl){try{streamCtl.abort()}catch(_){}streamCtl=null}}async function startStream(sym){stopStream();const ctl=new AbortController();streamCtl=ctl;let res;try{res=await fetch('/academy-activity/options-stream?symbol='+encodeURIComponent(sym),{headers:{authorization:'Bearer '+session},cache:'no-store',signal:ctl.signal})}catch(_){return}if(!res||!res.ok||!res.body)return;const reader=res.body.getReader(),decoder=new TextDecoder();let buf='';try{for(;;){const{value,done}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});const parts=buf.split('\\n\\n');buf=parts.pop();for(const part of parts){let event='message',data='';for(const line of part.split('\\n')){if(line.startsWith('event:'))event=line.slice(6).trim();else if(line.startsWith('data:'))data+=line.slice(5).trim()}if(!data)continue;let evtBody;try{evtBody=JSON.parse(data)}catch(_){continue}if(event==='update'&&evtBody&&Array.isArray(evtBody.rows)){let touched=false;for(const row of evtBody.rows){const key=row.expiry+'|'+row.strike,index=chain.findIndex(existing=>existing.expiry+'|'+existing.strike===key);if(index>=0)chain[index]=row;else chain.push(row);touched=true}if(evtBody.spot!=null&&evtBody.spot!==spot){spot=evtBody.spot;touched=true}if(touched){chain.sort((a,b)=>a.expiry.localeCompare(b.expiry)||a.strike-b.strike);render()}}}}}catch(_){}}function render(){const exp=expiry.value,all=chain.filter(row=>row.expiry===exp),atm=spot==null?0:all.reduce((best,row,index)=>Math.abs(row.strike-spot)<Math.abs(all[best]?.strike-spot)?index:best,0),limit=range.value==='all'?all.length:Number(range.value),start=Math.max(0,Math.min(all.length-limit,atm-Math.floor(limit/2))),rows=all.slice(start,start+limit);body.replaceChildren();rows.forEach(item=>{const tr=document.createElement('tr');if(item===selected)tr.classList.add('selected');if(all[atm]===item)tr.classList.add('atm');sideCells(tr,item.call);td(tr,fmt(item.strike),'strike');sideCells(tr,item.put,true);tr.onclick=()=>{body.querySelectorAll('tr').forEach(row=>row.classList.remove('selected'));tr.classList.add('selected');details(item);const focus={symbol:clean(symbol.value),strike:item.strike,expiry:item.expiry,dte:dte(item.expiry),callMid:mid(item.call),putMid:mid(item.put)};window.smlAcademyOptionsFocus=focus;window.dispatchEvent(new CustomEvent('sml-academy-options-focus',{detail:focus}));const banner=document.getElementById('options-focus');if(banner){banner.hidden=false;banner.textContent='OPTIONS FOCUS · '+focus.symbol+' $'+fmt(focus.strike)+' · '+iso(focus.expiry)+' ('+(focus.dte??'—')+' DTE) · call mid '+fmt(focus.callMid)+' · put mid '+fmt(focus.putMid)}};body.appendChild(tr)});wrap.hidden=!rows.length;summary.replaceChildren();metric('Underlying',spot==null?'—':'$'+fmt(spot));metric('Expiration',iso(exp));metric('Days to expiry',String(dte(exp)??'—'));metric('Contracts shown',String(rows.length));metric('ATM reference',all[atm]?'$'+fmt(all[atm].strike):'—');summary.hidden=!rows.length;if(rows.length)details(all[atm]||rows[0]);status.classList.remove('options-error');status.textContent=rows.length?'Verified chain loaded. Select any strike for derived economics and risk interpretation.':'No displayable contracts were returned for this expiration.'}range.onchange=render;expiry.onchange=async()=>{const value=expiry.value;if(!value||expiryCache.has(value)||!session){render();return}expiry.disabled=true;status.classList.remove('options-error');status.textContent='Loading '+iso(value)+' contracts…';try{const response=await fetch('/academy-activity/data/options?symbol='+encodeURIComponent(clean(symbol.value))+'&expiration='+encodeURIComponent(value),{headers:{authorization:'Bearer '+session},cache:'no-store'}),payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'unavailable');const more=normalize(payload.data).filter(row=>row.expiry===value);expiryCache.set(value,true);const keys=new Set(chain.map(row=>row.expiry+'|'+row.strike));more.forEach(row=>{if(!keys.has(row.expiry+'|'+row.strike))chain.push(row)});chain.sort((a,b)=>a.expiry.localeCompare(b.expiry)||a.strike-b.strike);spot=findSpot(payload.data)??spot}catch(_){status.classList.add('options-error');status.textContent='That expiration could not be loaded right now.'}finally{expiry.disabled=false;render()}};button.onclick=async()=>{if(!session)session=String(window.smlAcademySessionToken||'');if(!session){status.classList.add('options-error');status.textContent='Unlock Academy Tools first so Discord can verify private Academy access.';return}button.disabled=true;status.classList.remove('options-error');status.textContent='Loading verified options contracts…';try{const response=await fetch('/academy-activity/data/options?symbol='+encodeURIComponent(clean(symbol.value)),{headers:{authorization:'Bearer '+session},cache:'no-store'}),payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'unavailable');chain=normalize(payload.data);spot=findSpot(payload.data)??spot;expiryCache=new Map();chain.forEach(row=>expiryCache.set(row.expiry,true));const expirations=expirationsOf(payload.data,chain);expiry.replaceChildren();expirations.forEach(value=>{const option=document.createElement('option');option.value=value;option.textContent=iso(value)+' · '+(dte(value)??'—')+' DTE';expiry.appendChild(option)});const first=expirations.find(value=>expiryCache.has(value))||expirations[0];if(first)expiry.value=first;expiry.disabled=!expirations.length;selected=null;render();if(!chain.length)throw new Error('empty');startStream(clean(symbol.value))}catch(error){wrap.hidden=true;summary.hidden=true;inspector.hidden=true;status.classList.add('options-error');status.textContent=error.message==='empty'?'The provider returned data, but no recognized call/put contracts. Check the bridge mapping.':'Options data is temporarily unavailable. Check Academy bridge authorization and provider entitlement.'}finally{button.disabled=false}}})();
</script><script>
/* watchdog: if the sign-in module has not reported in 8 seconds, say so from a plain script and probe the SDK URL from inside this frame */
(()=>{setTimeout(()=>{if(window.smlAcademySessionToken||(document.body&&document.body.dataset.academyAuth))return;const send=(extra)=>{try{fetch('/academy-activity/diag',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({stage:'module_silent',inDiscord:new URLSearchParams(location.search).has('frame_id'),ua:navigator.userAgent.slice(0,80),href:location.href.slice(0,120)},extra||{})),keepalive:true}).catch(()=>{})}catch(_){}};fetch('/academy-activity/sdk/v20261015/index.mjs',{cache:'no-store'}).then(r=>r.text().then(t=>send({code:'sdk:'+r.status+':'+t.length+':'+(/export/.test(t)?'module':'notmodule')}))).catch(e=>send({code:'sdk:fetch_failed',message:String(e&&e.message||e).slice(0,120)}))},8000)})();
</script><script type="module">
import { DiscordSDK } from '/academy-activity/sdk/v20261015/index.mjs';
const academyAppId=${academyAppId};
const academyStatus=document.getElementById('status');
/* One Discord SDK instance per Activity. Sign-in failures show a plain
   recovery message in the top bar (the bar wraps, so the chart shrinks rather
   than being covered) and retry only when the member asks. */
let academySdk=null,academyAuthInflight=null;const academyInDiscord=new URLSearchParams(location.search).has('frame_id');
/* sign-in diagnostics: one tiny beacon per step so a silent stall on a member's machine shows up in the server log */
const academyT0=Date.now();const academyDiagSeen={};const academyDiag=(stage,extra)=>{try{const n=(academyDiagSeen[stage]=(academyDiagSeen[stage]||0)+1);if(n>(/fail|error|rejection/.test(stage)?4:2))return;fetch('/academy-activity/diag',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({stage,inDiscord:academyInDiscord,ms:Date.now()-academyT0,hasToken:!!window.smlAcademySessionToken,ua:navigator.userAgent.slice(0,80),href:location.href.slice(0,120)},extra||{})),keepalive:true}).catch(()=>{})}catch(_){}};
window.addEventListener('error',e=>academyDiag('page_error',{message:String(e&&e.message||'').slice(0,160)}));window.addEventListener('unhandledrejection',e=>academyDiag('page_rejection',{message:String(e&&e.reason&&(e.reason.message||e.reason)||'').slice(0,160)}));academyDiag('module_start');
const academyNoticeText={
  academy_role_required:['ACCESS REQUIRED','Academy lessons are for Making Easy Money members. The chart and scanner stay open; your lesson progress starts saving once your membership role is active in this server.','Check again'],
  authorization_required:['SIGN-IN NEEDED','Discord sign-in did not finish, so your lesson progress cannot save yet.','Sign in again'],
  authorization_failed:['SIGN-IN NEEDED','Discord sign-in did not finish, so your lesson progress cannot save yet.','Sign in again'],
  authorization_denied:['SIGN-IN NEEDED','Discord sign-in was cancelled, so your lesson progress cannot save yet.','Sign in again'],
  outside_discord:['OPEN IN DISCORD','Open the Academy from the Making Easy Money Discord server to save your lesson progress.',''],
  popout_expired:['WINDOW EXPIRED','This pop-out window has expired. Close it and pop the module out again from the Academy in Discord.',''],
  access_ended:['ACCESS ENDED','Your Academy access has ended, so this window stopped updating.',''],
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
/* Sessions last 15 minutes and the Discord SDK accepts authorize once per Activity (a second call fails with
   "Already authenticated"), so a renewal never calls the SDK again: the signed renewal key from sign-in is posted
   to /academy-activity/renew, which re-checks the member's access now and issues a new session. */
async function academyRenew(){
  const key=window.smlAcademyRenewKey;
  academyDiag('renew_start');
  const response=await fetch('/academy-activity/renew',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({renew:key}),cache:'no-store'});
  let payload={};try{payload=await response.json()}catch(_){}
  academyDiag('renew_response',{code:String(response.status)+':'+String(payload.error||(payload.ok?'ok':'bad'))});
  if(response.ok&&payload.ok&&payload.sessionToken){if(payload.renew)window.smlAcademyRenewKey=payload.renew;return {sessionToken:payload.sessionToken,displayName:String(payload.displayName||'')}}
  if(response.status===401||response.status===403){window.smlAcademyRenewKey='';const code=payload.error==='access_ended'?'academy_role_required':(payload.error||'authorization_required');throw Object.assign(new Error(code),{academyCode:code})}
  throw Object.assign(new Error('temporary_unavailable'),{academyCode:'temporary_unavailable'});
}
/* a second authorize on one Activity fails with "Already authenticated" (no renewal key left to use): a fresh page is the only way back in, at most once a minute */
function academyReloadForSignIn(){
  const KEY='sml-academy-auth-reload';let last=0;try{last=Number(sessionStorage.getItem(KEY))||0}catch(_){}
  if(Date.now()-last<60000)return false;
  try{sessionStorage.setItem(KEY,String(Date.now()))}catch(_){}
  academyDiag('signin_reload');setTimeout(()=>location.reload(),50);return true;
}
async function academySignIn(){
  if(window.smlAcademyPopoutSignIn)return window.smlAcademyPopoutSignIn();
  if(window.smlAcademyRenewKey)return academyRenew();
  academyDiag('sdk_ready_start');
  if(!academySdk){academySdk=new DiscordSDK(academyAppId);await academySdk.ready();window.smlAcademySdk=academySdk;try{academySdk.subscribe('ENTITLEMENT_CREATE',()=>{try{window.smlAcademyOnEntitlement&&window.smlAcademyOnEntitlement()}catch(_){}})}catch(_){}}
  try{window.smlAcademyGuildId=String(academySdk.guildId||'')}catch(_){}
  academyDiag('sdk_ready');
  let authorization;
  try{authorization=await academySdk.commands.authorize({client_id:academyAppId,response_type:'code',prompt:'none',scope:['identify','guilds.members.read']})}
  catch(e){if(/already authenticated/i.test(String(e&&e.message||e))&&academyInDiscord&&academyReloadForSignIn()){throw Object.assign(new Error('temporary_unavailable'),{academyCode:'temporary_unavailable'})}throw e}
  academyDiag('authorized',{code:authorization&&authorization.code?'yes':'no'});
  const response=await fetch('/academy-activity/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:authorization.code})});
  let payload={};try{payload=await response.json()}catch(_){}
  academyDiag('token_response',{code:String(response.status)+':'+String(payload.error||(payload.ok?'ok':'bad'))});
  if(!response.ok||!payload.ok||!payload.access_token||!payload.sessionToken){const code=payload.error||(response.status>=500?'temporary_unavailable':'authorization_failed');throw Object.assign(new Error(code),{academyCode:code})}
  if(payload.renew)window.smlAcademyRenewKey=payload.renew;
  /* the SDK accepts authenticate once per Activity; a silent renewal later only needs the new server session, so "Already authenticated" is success, not a failure to retry */
  if(!window.__academySdkAuthed){try{await academySdk.commands.authenticate({access_token:payload.access_token});window.__academySdkAuthed=true}catch(e){if(!/already authenticated/i.test(String(e&&e.message||e)))throw e;window.__academySdkAuthed=true}}
  academyDiag('authenticated');
  return {sessionToken:payload.sessionToken,displayName:String(payload.displayName||'')};
}
function authenticateAcademyActivity(){
  if(academyAuthInflight)return academyAuthInflight;
  academyAuthInflight=(async()=>{
    if(!academyAppId){if(academyStatus)academyStatus.textContent='AUTH UNAVAILABLE';return ''}
    try{
      if(academyStatus)academyStatus.textContent='VERIFYING';
      const {sessionToken,displayName}=await academySignIn();
      window.smlAcademySessionToken=sessionToken;
      if(displayName)window.smlAcademyDisplayName=displayName;
      document.body.dataset.academyAuth='ready';
      academyNotice('');
      if(typeof mainLastAuth!=='undefined')mainLastAuth=Date.now();
      window.dispatchEvent(new CustomEvent('sml-academy-session',{detail:{sessionToken,displayName}}));
      if(academyStatus)academyStatus.textContent='LIVE';
      return sessionToken;
    }catch(error){
      const raw=String(error&&(error.academyCode||error.message)||'');
      const code=error&&error.academyCode?raw:(/frame_id|instance_id|platform/i.test(raw)?'outside_discord':(/cancel|denied|5000|4002/i.test(raw)?'authorization_denied':'temporary_unavailable'));
      document.body.dataset.academyAuth=code.replace(/[^a-z0-9_-]/gi,'').slice(0,64);
      academyNotice(code);
      academyDiag('signin_failed',{code,message:raw.slice(0,160)});
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
  const inDiscord=academyInDiscord||new URLSearchParams(location.search).has('frame_id')||(window.self!==window.top&&/discord/i.test(String(document.referrer||'')+(location.ancestorOrigins&&location.ancestorOrigins[0]||'')));
  if(inDiscord){
    try{
      if(!academySdk){academySdk=new DiscordSDK(academyAppId);await academySdk.ready()}
      await academySdk.commands.openExternalLink({url});
      return true;
    }catch(_){/* fall through to a plain tab attempt */}
  }
  try{window.open(url,'_blank','noopener');return true}catch(_){return false}
};
let mainLastAuth=Date.now();
const mainRenewCheck=()=>{if(document.hidden)return;if(Date.now()-mainLastAuth>13*60*1000){mainLastAuth=Date.now();void authenticateAcademyActivity()}};
document.addEventListener('visibilitychange',mainRenewCheck);
window.addEventListener('focus',mainRenewCheck);
window.addEventListener('pageshow',mainRenewCheck);
void authenticateAcademyActivity();
</script></body></html>`
    .replace("#academy-unlock{", "body.academy-tools-open .lesson{z-index:2147483600}#academy-unlock{")
    .replace("ctx.setTransform(d,0,0,d,0)", "ctx.setTransform({a:d,b:0,c:0,d:d,e:0,f:0})")
    .replace("d=devicePixelRatio||1;canvas.width=", "d=1;canvas.width=")
    .replace("canvas.addEventListener('wheel',e=>{e.preventDefault();scale=Math.max(.7,Math.min(4,scale*(e.deltaY>0?.86:1.16)));draw()},{passive:false})", "canvas.addEventListener('wheel',()=>{},{passive:true})")
    .replace("function load(){const s=esc(sym.value);location.assign(location.pathname+'?symbol='+encodeURIComponent(s))}", "function load(){window.smlAcademyNavigateMarket?.(esc(sym.value))}")
    .replace("new ResizeObserver(resize).observe(canvas);setQuote();draw()", "const chartObserver=new ResizeObserver(resize);chartObserver.observe(canvas);window.addEventListener('resize',resize);document.addEventListener('visibilitychange',()=>{if(!document.hidden)resize()});requestAnimationFrame(resize);setTimeout(resize,250);setTimeout(resize,1000);setQuote();draw()")
    .replace('function renderSlide()', "window.smlAcademyChartState=()=>({bars:bars.slice(),symbol,offset,scale});window.smlAcademyRepaintQuote=()=>{if(bars.length)setQuote()};window.smlAcademyApplyMarket=payload=>{if(!payload||!Array.isArray(payload.bars)||!payload.bars.length)return;bars=payload.bars.slice(-600);symbol=esc(payload.symbol||sym.value);offset=0;setQuote();resize();window.smlAcademyRefreshQuote?.();window.dispatchEvent(new CustomEvent('sml-academy-market',{detail:{bars:bars.slice(),symbol}}))};queueMicrotask(()=>window.dispatchEvent(new CustomEvent('sml-academy-market',{detail:{bars:bars.slice(),symbol}})));function renderSlide()")
    .replace('setInterval(()=>location.reload(),30000)', "let refreshPending=false;const keepWarm=async()=>{if(refreshPending||(document.hidden&&window.smlAcademyChartState&&window.smlAcademyChartState().bars.length))return;const tfNow=new URLSearchParams(location.search).get('tf')||'5m';if(/T$/.test(tfNow)&&window.smlLiveTradeAt&&Date.now()-window.smlLiveTradeAt<15000&&window.smlAcademyChartState&&window.smlAcademyChartState().bars.length)return;refreshPending=true;try{const query=new URLSearchParams(location.search),symbol=query.get('symbol')||'SPY',tf=query.get('tf')||'5m';const response=await fetch('/academy-activity/market?symbol='+encodeURIComponent(symbol)+'&tf='+encodeURIComponent(tf),{cache:'no-store'}),payload=await response.json();if(!response.ok)throw new Error('market');if((new URLSearchParams(location.search).get('symbol')||'SPY')!==symbol||(new URLSearchParams(location.search).get('tf')||'5m')!==tf)return;window.smlAcademyApplyMarket?.(payload);document.getElementById('status').textContent='LIVE'}catch{document.getElementById('status').textContent='RETRY'}finally{refreshPending=false}};keepWarm();setInterval(keepWarm,5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)keepWarm()})")
    .replace("page=1,sortKey='changePct'", "page=1,sortKey='changeRate3min'")
    .replace("if(k==='sire')return r.sire", "if(k==='sire')return r.changeRate3min")
    .replace("rows.map((r,i)=>({...r,sire:i+1}))", "rows.map(r=>({...r}))")
    .replace("sideFrom(object.call||object.calls||object,'call')", "sideFrom(object.call||object.calls||object,object.call||object.calls?'':'call')")
    .replace("sideFrom(object.put||object.puts||object,'put')", "sideFrom(object.put||object.puts||object,object.put||object.puts?'':'put')")
    .replaceAll("['rank','#'],", '')
    .replaceAll("['sire','S.I.R.E']", "['sire','S.I.R.E.']")
    .replace("['changePct','preMarketPct','postMarketPct'].includes(k)", "['changePct','preMarketPct','postMarketPct','sire'].includes(k)")
    .replace("['macd','MACD']]", "['macd','MACD'],['high52','52wk High'],['low52','52wk Low'],['chg5mPct','% Chg 5M'],['chg5dPct','% Chg 5D'],['chg10dPct','% Chg 10D'],['chg20dPct','% Chg 20D'],['chg60dPct','% Chg 60D'],['chg120dPct','% Chg 120D'],['chg250dPct','% Chg 250D'],['ytdPct','YTD Chg'],['handTurnover','Hand Turnover'],['amplitude','Amplitude'],['peLyr','PE LYR'],['divYield','Dividend Yield'],['roe','ROE'],['roa','ROA'],['netMargin','Net Margin'],['grossMargin','Gross Margin'],['revenueGrowth','Revenue Growth'],['epsGrowth','EPS Growth'],['assetTurnover','Asset Turnover'],['inventoryTurnover','Inventory Turnover'],['currentRatio','Current Ratio'],['quickRatio','Quick Ratio'],['ma20','MA20'],['ma50','MA50'],['institutionalHoldings','Institutional Holdings'],['insiderHoldings','Insider Holdings'],['profitRatio','Profit Ratio'],['overlapDegree','Degree of Overlap']]")
    .replace("panel.querySelector('#academy-scan-refresh').onclick=()=>location.reload();render()", "window.smlAcademyScannerRows=()=>rows.slice();const refreshScanner=async()=>{const badge=panel.querySelector('.academy-scan-live');badge.textContent='Refreshing';try{const response=await fetch('/academy-activity/scanner',{cache:'no-store'}),payload=await response.json();if(!response.ok||!Array.isArray(payload.rows))throw new Error('unavailable');rows=payload.rows;overlayLive();softRender();window.dispatchEvent(new CustomEvent('sml-academy-scanner-update'));badge.textContent=(window.smlLiveCells&&window.smlLiveCells.feed.streaming())?'Live stream · streaming':'Live stream'}catch(_){badge.textContent='Reconnecting'}};panel.querySelector('#academy-scan-refresh').onclick=refreshScanner;render();window.dispatchEvent(new CustomEvent('sml-academy-scanner-update'));refreshScanner();setInterval(()=>{if(!document.hidden)refreshScanner()},4000)")
    /* Wide live scanner (pop-out): Top 100/250/500 selector, live Rank column with movement, 50 rows a page in a pop-out,
       a pager that reaches every page, and /academy-activity/scanner?limit=N refreshes. Other client readers of
       smlAcademyScannerRows (SIRE panel, intelligence, hover) keep the site rows only. */
    .replace("page=1,sortKey='changeRate3min',sortDir=-1;", `page=1,sortKey='changeRate3min',sortDir=-1;const popped=String(window.smlAcademyPopout||new URLSearchParams(location.search).get('popout')||'')==='scanner',TOPKEY='sml-academy-scan-top:'+(popped?'pop':'dock');let topN=popped?500:100;try{const saved=Number(localStorage.getItem(TOPKEY));if([100,250,500].includes(saved))topN=saved}catch(_){}if(topN>100){sortKey='liveRank';sortDir=1}const rankMove=m=>{m=Number(m);return!Number.isFinite(m)||!m?'':m>0?' <small style="color:#52e6ad;font-weight:800">▲'+m+'</small>':' <small style="color:#ff778b;font-weight:800">▼'+(-m)+'</small>'};`)
    .replace("else{sortKey=key;sortDir=-1}", "else{sortKey=key;sortDir=key==='liveRank'?1:-1}")
    .replace("const cols=columns[preset]||columns.full,all=filtered(),per=15,", "const cols=topN>100?[['liveRank','Rank']].concat(columns[preset]||columns.full):(columns[preset]||columns.full),all=filtered(),per=popped?50:15,")
    .replace(`if(k==='symbol')return'<td><span class="academy-scan-symbol">'`, `if(k==='liveRank')return'<td class="academy-scan-rank" style="white-space:nowrap;font-variant-numeric:tabular-nums">'+(r.liveRank||'—')+rankMove(r.rankMove)+'</td>';if(k==='symbol')return'<td><span class="academy-scan-symbol">'`)
    .replace("count.textContent='Showing '+(all.length?start+1:0)+' to '", "count.textContent=topN>100?'Showing '+(all.length?start+1:0)+'–'+Math.min(start+per,all.length)+' of '+all.length+' · ranked live by volume, move and momentum':'Showing '+(all.length?start+1:0)+' to '")
    /* The content gate empties the table (gatedScanner), so the count would read "0 to 0 of 0 live results"
       directly under the line saying 100 tickers are ranking. Count the withheld rows in the total instead. */
    .replace("count.textContent=topN>100?", "count.textContent=(window.__smlScanLock&&window.__smlScanLock.locked)?'Showing '+all.length+' of '+(all.length+(window.__smlScanLock.count||0))+' · Academy access required':topN>100?")
    .replace("for(let p=1;p<=Math.min(max,7);p++){const b=document.createElement('button');b.textContent=p;b.className=p===page?'on':'';b.onclick=()=>{page=p;render()};pages.appendChild(b)}", "const pgBtn=(label,p,on,dis)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.className=on?'on':'';if(dis)b.disabled=true;else b.onclick=()=>{page=p;render();const w=panel.querySelector('.academy-scan-wrap');if(w)w.scrollTop=0};pages.appendChild(b)},pgGap=()=>{const s=document.createElement('span');s.textContent='…';s.style.cssText='padding:0 4px;color:#6f8a97';pages.appendChild(s)};if(max>1)pgBtn('‹',page-1,false,page<=1);const pgWin=popped?7:5;let pgLo=Math.max(1,page-Math.floor(pgWin/2)),pgHi=Math.min(max,pgLo+pgWin-1);pgLo=Math.max(1,pgHi-pgWin+1);if(pgLo>1){pgBtn('1',1,page===1);if(pgLo>2)pgGap()}for(let p=pgLo;p<=pgHi;p++)pgBtn(String(p),p,p===page);if(pgHi<max){if(pgHi<max-1)pgGap();pgBtn(String(max),max,page===max)}if(max>1)pgBtn('›',page+1,false,page>=max);")
    .replace('<button id="academy-scan-refresh">Refresh</button>', '<select id="academy-scan-top" title="How many tickers to rank live"><option value="100">Top 100</option><option value="250">Top 250</option><option value="500">Top 500</option></select><button id="academy-scan-refresh">Refresh</button>')
    .replace("window.smlAcademyScannerRows=()=>rows.slice();const refreshScanner=async()=>{const badge=", "window.smlAcademyScannerRows=()=>rows.filter(r=>r&&r.source!=='massive');let scanBusy=false;const refreshScanner=async()=>{if(scanBusy)return;scanBusy=true;try{await refreshScannerNow()}finally{scanBusy=false}},refreshScannerNow=async()=>{const badge=")
    .replace("const response=await fetch('/academy-activity/scanner',{cache:'no-store'}),payload=await response.json();if(!response.ok||!Array.isArray(payload.rows))throw new Error('unavailable');rows=payload.rows;", "const asked=topN,response=await fetch('/academy-activity/scanner'+(asked>100?'?limit='+asked:''),{cache:'no-store'}),payload=await response.json();if(!response.ok||!Array.isArray(payload.rows))throw new Error('unavailable');if(asked!==topN)return;window.__smlScanLock={locked:!!payload.locked,count:Number(payload.lockedCount)||0};rows=payload.rows;")
    .replace("panel.querySelector('#academy-scan-refresh').onclick=refreshScanner;", "const topSel=panel.querySelector('#academy-scan-top');if(topSel){topSel.value=String(topN);topSel.onchange=()=>{topN=[100,250,500].includes(Number(topSel.value))?Number(topSel.value):100;try{localStorage.setItem(TOPKEY,String(topN))}catch(_){}if(topN>100){sortKey='liveRank';sortDir=1}else if(sortKey==='liveRank'){sortKey='changeRate3min';sortDir=-1}page=1;render();refreshScannerNow()}}panel.querySelector('#academy-scan-refresh').onclick=refreshScanner;")
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
  const script = `<script>(()=>{const lessons=${lessons};const panel=document.getElementById('lesson'),toggle=document.getElementById('lesson-toggle'),meta=panel&&panel.querySelector('small'),title=document.getElementById('lesson-title'),copy=document.getElementById('lesson-copy'),answers=document.getElementById('answers'),feedback=document.getElementById('lesson-feedback'),next=document.getElementById('next-lesson');if(!panel||!toggle||!meta||!title||!copy||!answers||!feedback||!next||!lessons.length)return;toggle.textContent='Lessons ('+lessons.length+')';const picker=document.createElement('select');picker.id='lesson-select';picker.className='lesson-picker';picker.setAttribute('aria-label','Choose an Academy lesson');lessons.forEach((lesson,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent='Module '+lesson.moduleId+' · Lesson '+lesson.lessonId+' — '+lesson.title;picker.appendChild(option)});title.parentNode.insertBefore(picker,title);const previous=document.createElement('button');previous.id='previous-lesson';previous.className='alt';previous.textContent='Previous Lesson';next.parentNode.insertBefore(previous,next);let current=0;const render=()=>{const lesson=lessons[current];picker.value=String(current);meta.textContent='MODULE '+lesson.moduleId+' · LESSON '+lesson.lessonId+' · '+(current+1)+' OF '+lessons.length;title.textContent=lesson.title;copy.textContent=lesson.steps.join('\\n\\n')+'\\n\\nPractice: '+lesson.question.prompt;feedback.textContent='';answers.replaceChildren();Object.entries(lesson.question.options).forEach(([key,value])=>{const button=document.createElement('button');button.dataset.answer=key;button.textContent=key+'. '+value;answers.appendChild(button)});answers.style.display='grid';previous.disabled=current===0;next.textContent=current===lessons.length-1?'Restart Curriculum':'Next Lesson'};toggle.onclick=()=>{if(panel.classList.contains('open')){panel.classList.remove('open');document.body.classList.remove('academy-lesson-open');return}panel.classList.add('open');render()};picker.onchange=()=>{current=Math.max(0,Math.min(lessons.length-1,Number(picker.value)||0));render()};previous.onclick=()=>{current=Math.max(0,current-1);render()};next.onclick=()=>{current=(current+1)%lessons.length;render()};answers.onclick=event=>{const target=event.target.closest('button[data-answer]');if(!target)return;const lesson=lessons[current],correct=target.dataset.answer===lesson.question.correct;answers.querySelectorAll('button').forEach(button=>button.className='');target.classList.add(correct?'good':'bad');feedback.textContent=correct?'Correct. '+lesson.question.explanation:'Not quite. The correct answer is '+lesson.question.correct+': '+lesson.question.options[lesson.question.correct]+'. '+lesson.question.explanation};render()})()</script>`;
  return body.replace('</body></html>', `${script}</body></html>`);
}

/* The page as it is sent: the Academy document gains the intro markup and the lesson, visual and statistics scripts. */
function academyFinalBody(body) {
  /* Academy Activity replaces the legacy canvas with the real dashboard.
     Avoid attaching its obsolete ResizeObserver during that handoff. */
  const strippedBody = typeof body === 'string'
    ? body.replace('new ResizeObserver(resize).observe(canvas);', '')
    : body;
  /* Function replacers: a string replacement would treat `$'`, `$&`, `$$` and
     `$\`` inside the injected scripts as substitution patterns (for example
     rest.includes('$') would be served as rest.includes(')) and break them. */
  return typeof strippedBody === 'string' && strippedBody.includes('id="lesson"')
    ? strippedBody.replace('<body>', () => `<body>${academyIntroMarkup()}`).replace('</body></html>', () => `${academyCurriculumScript(SEED_LESSONS)}${academyCartoonVisualsScript()}${academySceneVisualsScript()}${academyVisualLabScript()}${academyChartIntelligenceScript()}${academyQuoteStatisticsScript()}</body></html>`)
    : strippedBody;
}
/* assets (optional): { pageAssets, key, canonical } moves the page's unchanging inline scripts and styles into immutable
   external bundles (academy-page-assets.js); without it the page is sent inline, byte for byte as built. */
function sendHtml(response, status, body, assets = null) {
  const finalBody = academyFinalBody(body);
  const safeBody = assets && assets.pageAssets && typeof finalBody === 'string'
    ? assets.pageAssets.transform(finalBody, { key: assets.key, canonical: assets.canonical })
    : finalBody;
  const payload = zlib.gzipSync(Buffer.from(safeBody), { level: zlib.constants.Z_BEST_SPEED });
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': payload.length,
    'content-encoding': 'gzip',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; frame-src 'self'; frame-ancestors https://discord.com https://*.discord.com https://*.discordapp.com; base-uri 'none'; form-action 'none'",
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
</style><script>(()=>{const overlay=document.getElementById('academy-intro'),video=document.getElementById('academy-intro-video'),fallback=document.getElementById('academy-intro-fallback'),play=document.getElementById('academy-intro-play'),skip=document.getElementById('academy-intro-skip');if(!overlay||!video)return;let finished=false;const fitVideo=()=>{const box=overlay.getBoundingClientRect(),ratio=(video.videoWidth&&video.videoHeight?video.videoWidth/video.videoHeight:16/9),availableWidth=Math.max(1,box.width),availableHeight=Math.max(1,box.height);overlay.classList.toggle('banner-mode',availableWidth/availableHeight>=2&&availableWidth>=800);let width=availableWidth,height=width/ratio;if(height>availableHeight){height=availableHeight;width=height*ratio}video.style.width=Math.floor(width)+'px';video.style.height=Math.floor(height)+'px'};const warmUrls=['/academy-activity/curriculum?v=${ACADEMY_CURRICULUM_VERSION}','/academy-activity/market?symbol=SPY&tf=5m','/academy-activity/scanner','/academy-activity/slide-design?moduleId=${ACADEMY_FIRST_LESSON.moduleId}&lessonId=${ACADEMY_FIRST_LESSON.lessonId}'];window.smlAcademyWarmPromise=Promise.allSettled(warmUrls.map((url,index)=>fetch(url,{cache:index===0||index===3?'force-cache':'no-store'}).then(r=>{if(r.ok)window.smlAcademyWarmCache=window.smlAcademyWarmCache||{},window.smlAcademyWarmCache[url]=r.clone();return r})));const finish=()=>{if(finished)return;finished=true;overlay.classList.add('closing');setTimeout(()=>overlay.remove(),420);window.dispatchEvent(new Event('sml-academy-intro-complete'))};const attempt=()=>video.play().then(()=>{fallback.hidden=true}).catch(()=>{fallback.hidden=false});video.addEventListener('loadedmetadata',fitVideo,{once:true});video.addEventListener('ended',finish,{once:true});video.addEventListener('error',()=>{fallback.hidden=false});addEventListener('resize',fitVideo,{passive:true});window.visualViewport?.addEventListener('resize',fitVideo,{passive:true});new ResizeObserver(fitVideo).observe(overlay);play?.addEventListener('click',attempt);skip?.addEventListener('click',finish);let capTimer=0,fbSince=0;const armCap=()=>{clearTimeout(capTimer);const d=isFinite(video.duration)&&video.duration>0?video.duration:20;capTimer=setTimeout(finish,Math.min(45,d+4)*1000)};video.addEventListener('loadedmetadata',armCap,{once:true});armCap();setInterval(()=>{if(finished)return;if(fallback.hidden){fbSince=0;return}fbSince=fbSince||Date.now();if(Date.now()-fbSince>6000)finish()},500);fitVideo();if(matchMedia('(prefers-reduced-motion: reduce)').matches)fallback.hidden=false;else void attempt();setTimeout(()=>{if(video.readyState===0)fallback.hidden=false},3000)})()</script>`;
}

function sendAcademySdkModule(response, requestPath) {
  // an optional version segment (/sdk/v20261015/index.mjs) gives caches a path they have never seen; the files are the same
  const relative = requestPath.slice('/academy-activity/sdk/'.length).replace(/^v\d{6,10}\//, '');
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
    const acceptGzip = /\bgzip\b/.test(String((response.req && response.req.headers && response.req.headers['accept-encoding']) || ''));
    if (acceptGzip && payload.length > 256) {
      const compressed = zlib.gzipSync(payload, { level: zlib.constants.Z_BEST_SPEED });
      response.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'content-length': compressed.length,
        'content-encoding': 'gzip',
        'cache-control': 'public, max-age=86400, immutable',
        'x-content-type-options': 'nosniff'
      });
      response.end(compressed);
    } else {
      response.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'content-length': payload.length,
        'cache-control': 'public, max-age=86400, immutable',
        'x-content-type-options': 'nosniff'
      });
      response.end(payload);
    }
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

/* Site facts relay: the WordPress plugin (SML Group Settings Hub) posts a compact,
   gzip+base64 export of site facts in signed chunks; each chunk is written to the
   service log as one "SMLX" line so it can be read back from Render logs without
   database or site access. Nothing is stored. */
const SITE_EXPORT_CHUNK_LIMIT = 6000;
async function handleSiteExportIngest(request, response, options) {
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
  let input;
  try {
    input = JSON.parse(body.rawBody);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid');
  } catch (_) {
    sendJson(response, 400, { ok: false, error: 'invalid_json' });
    return;
  }
  const name = String(input.name || '');
  const seq = Number(input.seq);
  const total = Number(input.total);
  const data = String(input.data || '');
  if (!/^[a-z0-9._-]{1,60}$/.test(name) || !Number.isInteger(seq) || !Number.isInteger(total) || seq < 1 || total < 1 || seq > total || total > 5000
    || data.length > SITE_EXPORT_CHUNK_LIMIT || !/^[A-Za-z0-9+/=]*$/.test(data)) {
    sendJson(response, 400, { ok: false, error: 'invalid_request' });
    return;
  }
  (options.siteExportSink || ((line) => console.log(line)))('SMLX ' + JSON.stringify({ name, seq, total, data }));
  sendJson(response, 201, { ok: true, name, seq, total });
}

/* Group Pro Tools: the StockMarketLoop group plugin asks for one tool at a time, signed with the same secret as every other site-to-platform call.
   WordPress has already decided who may use the group and whether the member gets the full tool or a preview. */
const groupToolsLimit = createDataRateLimit({ limit: Math.max(60, Number(process.env.GROUP_TOOLS_RATE_PER_MIN) || 600), windowMs: 60_000 });
/* The alerts desk for stockmarketloop.com groups. WordPress decides who may see what (group role) and signs the request with the shared
   billing secret; this answers with the same desk the Academy shows: 'live' (full alerts), 'closed' (case studies) or 'teaser' (a count only). */
async function handleSiteAlerts(request, response, options) {
  if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
  const body = await readRequestBody(request);
  if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
  const verified = verifySignature({ secret: options.billingApiSecret, timestamp: request.headers['x-sml-timestamp'], signature: request.headers['x-sml-signature'], rawBody: body.rawBody, now: options.now() });
  if (!verified.ok) { sendJson(response, verified.status, { ok: false, error: verified.error }); return; }
  if (!options.academyAlerts) { sendJson(response, 503, { ok: false, error: 'alerts_disabled' }); return; }
  let input;
  try { input = JSON.parse(body.rawBody); } catch (_) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
  if (!input || typeof input !== 'object') { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
  const view = ['live', 'closed', 'teaser'].includes(input.view) ? input.view : 'teaser';
  const gate = groupToolsLimit.take({ headers: { 'x-forwarded-for': 'site-alerts:' + String(Number(input.groupId) || String(input.discordUserId || '').replace(/[^0-9]/g, '').slice(0, 25) || 'none') }, socket: {} });
  if (!gate.ok) { response.setHeader('retry-after', String(gate.retryAfterSec)); sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
  /* A signed-in member whose stockmarketloop.com account is linked to Discord gets their own Academy desk: the sources they follow,
     at their Academy level (or the group's, whichever is better). Never anyone else's sources. */
  const memberId = /^\d{15,25}$/.test(String(input.discordUserId || '')) ? String(input.discordUserId) : '';
  if (memberId && options.academyAlertSources && options.academyAlertSources.siteDesk) {
    try {
      const desk = await options.academyAlertSources.siteDesk(memberId, input.groupId ? view : '');
      if (input.detail) {
        const alertId = String(input.detail).replace(/[^0-9]/g, '').slice(0, 24);
        const src = options.academyAlerts.allows(alertId, desk.sources);
        if (!src || src.view === 'teaser') { sendJson(response, src ? 403 : 404, { ok: false, error: src ? 'membership_required' : 'alert_not_found' }); return; }
        const one = await options.academyAlerts.detail(alertId, { closedOnly: src.view === 'closed' });
        if (!one) { sendJson(response, 404, { ok: false, error: 'alert_not_found' }); return; }
        sendJson(response, 200, { ok: true, view: desk.view, alert: one });
        return;
      }
      sendJson(response, 200, { ...options.academyAlerts.snapshot({ sources: desk.sources }), view: desk.view, tier: desk.tier, sources: desk.sources.length, perMember: true });
    } catch (error) {
      options.logger('error', 'site_alerts_failed', { error });
      sendJson(response, 503, { ok: false, error: 'alerts_temporarily_unavailable' });
    }
    return;
  }
  try {
    // per-member desks: the site reads the owner's streams (the presets), all shown the way WordPress chose
    const sources = options.academyAlertSources && options.academyAlertSources.presetSources ? options.academyAlertSources.presetSources(view) : null;
    if (input.detail) {
      if (view === 'teaser') { sendJson(response, 403, { ok: false, error: 'membership_required' }); return; }
      const alertId = String(input.detail).replace(/[^0-9]/g, '').slice(0, 24);
      if (sources && !options.academyAlerts.allows(alertId, sources)) { sendJson(response, 404, { ok: false, error: 'alert_not_found' }); return; }
      const one = await options.academyAlerts.detail(alertId, view === 'closed' ? { closedOnly: true } : undefined);
      if (!one) { sendJson(response, 404, { ok: false, error: 'alert_not_found' }); return; }
      sendJson(response, 200, { ok: true, view, alert: one });
      return;
    }
    const snap = sources ? options.academyAlerts.snapshot({ sources }) : (view === 'live' ? options.academyAlerts.snapshot() : options.academyAlerts.snapshot({ view }));
    sendJson(response, 200, { ...snap, view });
  } catch (error) {
    options.logger('error', 'site_alerts_failed', { error });
    sendJson(response, 503, { ok: false, error: 'alerts_temporarily_unavailable' });
  }
}

async function handleGroupTools(request, response, options) {
  if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
  const body = await readRequestBody(request);
  if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
  const verified = verifySignature({ secret: options.billingApiSecret, timestamp: request.headers['x-sml-timestamp'], signature: request.headers['x-sml-signature'], rawBody: body.rawBody, now: options.now() });
  if (!verified.ok) { sendJson(response, verified.status, { ok: false, error: verified.error }); return; }
  if (!options.groupTools) { sendJson(response, 503, { ok: false, error: 'group_tools_disabled' }); return; }
  let input;
  try { input = JSON.parse(body.rawBody); } catch (_) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
  if (!input || typeof input !== 'object') { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
  const gid = String(Number(input.groupId) || 'none');
  const gate = groupToolsLimit.take({ headers: { 'x-forwarded-for': 'group:' + gid }, socket: {} });
  if (!gate.ok) { response.setHeader('retry-after', String(gate.retryAfterSec)); sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
  try {
    const params = input.params && typeof input.params === 'object' ? input.params : {};
    const data = await options.groupTools.run(String(input.tool || ''), { symbol: input.symbol, symbols: input.symbols, params, preview: input.preview === true });
    sendJson(response, 200, data && typeof data === 'object' && 'ok' in data ? data : { ok: true, ...data });
  } catch (error) {
    if (error instanceof GroupToolsInputError) { sendJson(response, 400, { ok: false, error: error.code }); return; }
    options.logger('error', 'group_tools_failed', { error });
    sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
  }
}

/* Discord tracked links: who tapped which link, for the site dashboard. Signed
   with the billing bridge secret like every other site-to-platform call. */
async function handleLinkReport(request, response, options) {
  if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
  const body = await readRequestBody(request);
  if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
  const verified = verifySignature({ secret: options.billingApiSecret, timestamp: request.headers['x-sml-timestamp'], signature: request.headers['x-sml-signature'], rawBody: body.rawBody, now: options.now() });
  if (!verified.ok) { sendJson(response, verified.status, { ok: false, error: verified.error }); return; }
  if (!options.linkTracker) { sendJson(response, 503, { ok: false, error: 'link_tracker_disabled' }); return; }
  let input;
  try { input = JSON.parse(body.rawBody); } catch (_) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
  try {
    const result = await options.linkTracker.report({ guildId: input && input.guildId, linkId: input && input.linkId, limit: input && input.limit });
    sendJson(response, 200, { ok: true, ...result });
  } catch (error) {
    if (error instanceof TypeError) { sendJson(response, 400, { ok: false, error: String(error.message) }); return; }
    options.logger('error', 'link_report_failed', { error });
    sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
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

let streamClients = 0;
const darkPoolCache = new Map(); // symbol -> { until, payload } for /academy-activity/dark-pool
const smartIntentCache = new Map(); // symbol|tf -> { until, payload } for /academy-activity/intent
const articleChartCache = new Map(); // symbol -> { until, payload } for the public /academy-activity/article-chart feed
const SITE_ORIGIN = String(process.env.SML_WORDPRESS_URL || 'https://stockmarketloop.com').replace(/\/$/, '');
/* Live pattern examples (academy-pattern-live.js): which other stocks are forming the same formation on the same interval right now */
const patternLive = createPatternLive({ candles: (sym, tf) => getAcademyCandles(sym, tf), scanner: () => getAcademyScanner(), patterns: (() => { try { return require('./academy-patterns'); } catch (_) { return null; } })(), logger: (level, event, data) => { try { console.log(JSON.stringify({ level, event, ...(data || {}) })); } catch (_) { /* ignore */ } } });
/* 4:00 AM ET of the market clock's date as a timestamp: the start of today's prints (academy-dark-pool-memory.js sessionView) */
function etDayStartMs(st) {
  try { const et = String(st && st.et || ''); const asUtc = Date.parse(et.replace(' ', 'T') + ':00Z'); if (!Number.isFinite(asUtc)) return null; const offset = Math.round((Date.now() - asUtc) / 60_000) * 60_000; return Date.parse(et.slice(0, 10) + 'T04:00:00Z') + offset; } catch (_) { return null; }
}
const deskServedAt = new Map(); // userId -> last time the desk snapshot was logged for them
/* Real-time trades and quotes from Massive replace the (minutes-old) tape and top of book whenever they are fresh; moomoo still supplies the deeper Level 2 ladder. */
function mergeLive(base, massive, symbolRaw) {
  if (massive) massive.watch(symbolRaw);
  const ms = massive ? massive.peek(symbolRaw) : null;
  if (!ms) return base;
  const rt = ms.quote ? { bid: ms.quote.bid, ask: ms.quote.ask, bs: ms.quote.bs, as: ms.quote.as, t: ms.quote.t, fresh: ms.quoteFresh } : null;
  const out = Object.assign({}, base, { source: 'massive', stats: ms.stats || null, tape: ms.tape.length ? ms.tape : (base.tape || []), last: Number.isFinite(ms.last) ? ms.last : base.last, rt });
  if (!out.ready) { out.ready = true; out.symbol = String(symbolRaw).toUpperCase(); out.book = { bids: ms.quote ? [{ price: ms.quote.bid, size: ms.quote.bs }] : [], asks: ms.quote ? [{ price: ms.quote.ask, size: ms.quote.as }] : [] }; out.asOf = ms.quote ? ms.quote.t : Date.now(); out.topOnly = true; out.failing = false; }
  return out;
}

/* a streaming route sends its headers at once and is untouched; a data route that has not answered by then is cut with a 503 */
const ACADEMY_ROUTE_BUDGET_MS = Number(process.env.SML_ACADEMY_ROUTE_BUDGET_MS) || 20_000;

function createServer({ checkDatabase, acceptWordPressEvent, wordpressWebhookSecret = '',
  acceptStripeEvent, stripeWebhookSecret = '', billingApiSecret = '', stripe = null,
  pool = null, upgradeChat = null, upgradeChatPlanMap = {},
  alertRouter = null, alertRouterSecret = '',
  enqueueNewsArticle = async () => { throw new Error('not configured'); },
  newsIngestToken = '',
  paypalWebhook = null, upgradeChatWebhook = null, discordInteractions = null, disputeDiscordInteractions = null, dailySocialPayoutsInteractions = null,
  disputeService = null, schemaVersion = null, corporate = null, corporateConflictCodes = null,
  academyAccess = null, academyOAuth = null, academyDataBridge = null, academyProgress = null, academyVoice = null, academyOrderFlow = null, academyAlerts = null, academySentiment = null, groupTools = null, academyAlertSources = null, academyOptionsStream = null, academyClickAlert = null, academyProfiles = null, academySnapshot = null, academyMemLab = null, academyPasses = null, academyClickAlertPasses = null, academyMassive = null, academySireFeed = null, academyScreener = null, academyPopout = null, academyTierLive = null, academyFreeSessions = false, marketDirection = null, academySmlVix = null, academyAutoPt = null, targetLearner = null, academyHedge = null, academyPush = null, academyWideScanner = null, academyMentions = null, academySignals = null,
  marketHistory = null, publicMarketDataEnabled = false, brokerLinks = createBrokerLinks(),
  academyDiscipline = null,
  academySlideDesigner = null, academyAsk = null, academyTrial = null, academyAppId = '', academyGate = null,
  loopKickBridge = null, loopKickConnect = null, connectOAuth = null, connectAppId = '',
  memberEmail = null, siteExportSink = null, linkTracker = null, verifyGate = null,
  appApi = null,
  /* Academy data services and the challenge/paper surfaces live in main(); the handler only sees what is passed here */
  academyGamma = null, academyInstitutional = null, academyFilings = null, academyPaper = null, paperQuote = async () => null, academyFlowDaily = null, academySignalOutcomes = null, optionBars = null, tickerTalk = null,
  getEarningsPlaybook = () => null, getEarningsInsight = () => null, getShortInsight = () => null, getSqueezeList = () => null, getFdaService = () => null, getCatalystRadar = () => null, getChallenge = () => null,
  siteTierDirectory = null, challengeShare = { channelId: '' }, postChallengeTrade = async () => {},
  getCandleRecap = () => null, getStoryDesk = () => null, darkPoolMemory = null, academyProfilePages = null, academyProfileWall = null,
  autoTrade = null, sessionRecap = null, personaRegistry = null, academyEditions = null, analystDeskFor = async () => ({ ok: false, error: 'analyst_unavailable' }), storyPublisher = null,
  pageAssets = null, routeBudgetMs = ACADEMY_ROUTE_BUDGET_MS, academyEvolve = null, traderAlerts = null, traderAlertsCheckout = null, academyCommunity = null, academySocialNotify = null, alertChartBilling = null, tradingRoom = null, alertLevels = null,
  logger = log, now = Date.now }) {
  const publicStreamByIp = new Map();
  let publicStreamTotal = 0;
  const requestIp = (request) => String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown').split(',')[0].trim();

  /* Shared by the Academy and the standalone LOOP-KICK Activity once the caller's Discord session is verified. */
  async function handleLoopKickConnect(request, response, session) {
    if (!loopKickConnect) { sendJson(response, 503, { ok: false, error: 'connect_unconfigured' }); return; }
    const who = { discordUserId: session.userId, discordTag: String(session.displayName || '') };
    if (request.method === 'GET') {
      const link = loopKickConnect.connectUrl(who);
      const { status, ...body } = link;
      sendJson(response, status || (link.ok ? 200 : 503), body);
      return;
    }
    if (!loopKickConnect.configured) { sendJson(response, 503, { ok: false, error: 'connect_unconfigured' }); return; }
    if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
    const raw = await readRequestBody(request, 4096);
    if (!raw.ok) { sendJson(response, raw.status, { ok: false, error: raw.error }); return; }
    let input = null;
    try { input = JSON.parse(raw.rawBody); } catch (_) { input = null; }
    if (!input || typeof input !== 'object') { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
    const result = await loopKickConnect.connect({
      ...who,
      login: typeof input.login === 'string' ? input.login : '',
      password: typeof input.password === 'string' ? input.password : '',
      code: typeof input.code === 'string' ? input.code : '',
      ip: requestIp(request)
    });
    const { status, ...body } = result;
    sendJson(response, status || (result.ok ? 200 : 503), body);
  }
  const corsHeaders = (origin) => ({
    ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'Accept',
    'access-control-max-age': '86400'
  });
  const corsJson = (request, response, status, body) => {
    const origin = String(request.headers.origin || '');
    const payload = JSON.stringify(body);
    response.writeHead(status, { ...corsHeaders(origin), 'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    response.end(payload);
  };
  /* Academy gate. academyGate is null while every gate flag is off, and then
     nothing below changes a response. With SML_ACADEMY_CONTENT_GATE_ENABLED a
     free or anonymous caller gets the free preview lessons and the free
     symbols only. A caller's tier is its Activity session's tier, 'anonymous'
     without an Authorization header, or null for a header that is not a live
     session (the client renews and retries). */
  const contentGateOn = Boolean(academyGate && academyGate.enabled);
  const callerTier = (request) => {
    const authorization = String(request.headers.authorization || '').trim();
    if (!authorization) return 'anonymous';
    const session = academyOAuth && typeof academyOAuth.verifySession === 'function' ? academyOAuth.verifySession(authorization) : null;
    return session && session.ok ? (session.tier || 'member') : null;
  };
  const tierEntitled = (tier) => tier === 'member' || tier === 'academy' || tier === 'trader';
  /* Analyst level: the publishing side — the member's own alert chart and seller tools, Click-to-Alert into
     their own server, and the Article Desk. Role holders (member/academy) keep everything they had; a
     'trader' SKU buyer reads the market but does not reach these. ANALYST_TIERS is shared with main(). */
  const tierAnalyst = (tier) => ANALYST_TIERS.includes(tier);
  /* True when a live-data request may continue; otherwise the refusal is sent. */
  const allowGatedSymbol = (request, response, symbol) => {
    if (!contentGateOn) return true;
    const tier = callerTier(request);
    if (tier === null) { sendJson(response, 401, { ok: false, error: 'authorization_required' }); return false; }
    if (tierEntitled(tier) || academyGate.isFreeSymbol(symbol)) return true;
    sendJson(response, 403, { ok: false, error: 'academy_access_required', freeSymbols: academyGate.freeSymbols });
    return false;
  };
  const lessonOpenTo = (tier, moduleId, lessonId) => !contentGateOn || tierEntitled(tier) || academyGate.isFreeLesson(moduleId, lessonId);
  /* The free scanner keeps only the free symbols, which are rarely among the movers, so it is usually empty.
     `lockedCount` lets the panel say what is behind the gate instead of claiming the market has nothing in it. */
  const gatedScanner = (payload) => {
    const all = Array.isArray(payload && payload.rows) ? payload.rows : [];
    const rows = all.filter((row) => academyGate.isFreeSymbol(row && row.symbol));
    return { ...payload, rows, locked: true, lockedCount: Math.max(0, all.length - rows.length), freeSymbols: academyGate.freeSymbols };
  };
  /* The SIRE panel's live feed: scanner rows kept moving by Massive trades, pushed over SSE. Idle until the first viewer. */
  const sireFeed = academySireFeed || createSireFeed({ scanner: getAcademyScanner, massive: academyMassive, logger, now });
  let previewCurriculumGzip = null;
  const previewCurriculum = () => {
    if (!previewCurriculumGzip) {
      const full = JSON.parse(academyCurriculumPayload);
      previewCurriculumGzip = zlib.gzipSync(Buffer.from(JSON.stringify({ version: full.version, gated: true, lessons: academyGate.previewLessons(full.lessons) })), { level: zlib.constants.Z_BEST_SPEED });
    }
    return previewCurriculumGzip;
  };
  /* SML_ACADEMY_BILLING_IN_DISCORD_LINKS with a configured handoff minter. */
  const buyLinksOn = Boolean(academyGate && academyGate.inDiscordLinks && academyGate.handoff
    && typeof academyGate.handoff.mint === 'function' && academyGate.handoff.configured !== false && academyOAuth);
  const gateClientOptions = academyGate ? { contentGate: contentGateOn, links: buyLinksOn,
    skus: Array.isArray(academyGate.discordSkus) ? academyGate.discordSkus : [] } : null;
  /* The Activity page's immutable bundles (academy-page-assets.js). Which inline blocks are static is learned once per
     page variant from two renders with different synthetic markets; the bundles are built at startup so the first
     member's open never pays for compressing them. */
  const academyPageOptions = () => (gateClientOptions ? { appId: academyAppId, gate: gateClientOptions } : { appId: academyAppId });
  const academyCanonicalPages = (pageOptions) => [
    academyFinalBody(academyActivityHtml({ symbol: 'SPY', tf: '5m', bars: [{ t: 1, o: 1, h: 2, l: 1, c: 2, v: 1 }], scanner: { rows: [] }, depth: { bids: [], asks: [] } }, pageOptions)),
    academyFinalBody(academyActivityHtml({ symbol: 'QQQ', tf: '1h', bars: [], scanner: { rows: [{ symbol: 'QQQ', price: 1 }] }, depth: { bids: [[1, 1]], asks: [[2, 1]] } }, pageOptions))
  ];
  const academyPageAssetsFor = () => { if (!pageAssets) return null; const pageOptions = academyPageOptions(); return { pageAssets, key: JSON.stringify(pageOptions), canonical: () => academyCanonicalPages(pageOptions) }; };
  if (pageAssets) {
    const warm = setTimeout(() => {
      try { const a = academyPageAssetsFor(); const t0 = now(); pageAssets.transform(academyCanonicalPages(academyPageOptions())[0], { key: a.key, canonical: a.canonical }); logger('info', 'academy_page_assets_warm', { ms: now() - t0, ...pageAssets.stats }); }
      catch (error) { logger('warn', 'academy_page_assets_warm_failed', { error: String((error && error.message) || error) }); }
    }, 1500);
    if (warm.unref) warm.unref();
  }
  /* At most 5 handoff codes per Discord id per 10 minutes from /academy-activity/buy. */
  const buyMints = new Map();
  const allowBuyMint = (userId) => {
    const at = now();
    if (buyMints.size > 5_000) for (const [key, entry] of buyMints) if (at - entry.start >= 600_000) buyMints.delete(key);
    const entry = buyMints.get(userId);
    if (!entry || at - entry.start >= 600_000) { buyMints.set(userId, { start: at, count: 1 }); return true; }
    if (entry.count >= 5) return false;
    entry.count += 1;
    return true;
  };
  return http.createServer(async (request, response) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    if (path.startsWith('/academy-activity/')) {
      /* every Academy route is timed into the Evolve ledger (academy-evolve.js); a data route that has not answered by the budget is cut with a 503 */
      const startedAt = now();
      let timedOut = false;
      /* an article is gathered, written and (optionally) filed in one request: it gets a longer budget than a data read (it aims for ten seconds; this is the ceiling) */
      const budget = /^\/academy-activity\/(articles|story)\/write$/.test(path) ? 60_000 : routeBudgetMs;
      const watchdog = path === '/academy-activity/' ? null : setTimeout(() => {
        if (response.headersSent || response.writableEnded) return;
        timedOut = true;
        logger('warn', 'academy_route_timeout', { path: path.slice(0, 80), method: request.method });
        try { sendJson(response, 503, { ok: false, error: 'timeout' }); } catch (_) { try { response.destroy(); } catch (__) {} }
      }, budget);
      if (watchdog && watchdog.unref) watchdog.unref();
      response.once('close', () => { if (watchdog) clearTimeout(watchdog); });
      if (academyEvolve) response.once('finish', () => { try { academyEvolve.observeRoute(path, response.statusCode, now() - startedAt, { timeout: timedOut }); } catch (_) {} });
    }
    const billingOptions = { billingApiSecret, stripe, pool, upgradeChat, upgradeChatPlanMap, logger, now };
    const connectOptions = { billingApiSecret, pool, logger, now };

    /* The StockMarketLoop app shell at /app/: the page, its script and style, the service worker, manifest and icons. */
    if (request.method === 'GET' && (path === '/app' || path.startsWith('/app/'))) {
      if (path === '/app') { response.writeHead(301, { Location: '/app/' + (request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '') }); response.end(); return; }
      const name = path === '/app/' ? 'index.html' : path.slice('/app/'.length);
      if (name === 'manifest.webmanifest') { response.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }); response.end(APP_MANIFEST); return; }
      const icon = /^(icon-(192|512)|icon-maskable-512|apple-touch-icon)\.png$/.exec(name);
      if (icon) { const png = APP_SHELL_ICONS[name] || appIconPng(name === 'apple-touch-icon.png' ? 180 : Number(icon[2] || 512), name.startsWith('icon-maskable')); if (!png) { response.writeHead(404); response.end(); return; } response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }); response.end(png); return; }
      const file = APP_SHELL[name];
      if (!file) { sendJson(response, 404, { ok: false, error: 'not_found' }); return; }
      const headers = { 'Content-Type': file.type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': name === 'index.html' || name === 'sw.js' ? 'no-cache' : 'public, max-age=3600' };
      if (name === 'sw.js') headers['Service-Worker-Allowed'] = '/app/';
      if (name === 'index.html') headers['Content-Security-Policy'] = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https:; manifest-src 'self'; worker-src 'self'; base-uri 'none'; frame-ancestors 'none'";
      response.writeHead(200, headers); response.end(file.body); return;
    }
    /* The phone app's API (app-api.js): every /v1/app route, answered before anything else. */
    if (appApi && (path === '/v1/app' || path.startsWith('/v1/app/'))) {
      try { if (await appApi.handle(request, response, path)) return; }
      catch (error) { logger('error', 'app_api_failed', { error, path }); if (!response.headersSent) sendJson(response, 503, { ok: false, error: 'temporary_unavailable' }); else response.end(); return; }
    }

    /* Discord verification page (one-time links handed out by the Verify button). */
    if (path.startsWith('/verify/') && verifyGate) {
      try {
        if (await verifyGate.handleHttp(request, response, path, (req) => readRequestBody(req, 16_384))) return;
      } catch (error) {
        logger('error', 'verify_page_failed', { error });
        sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
        return;
      }
    }
    /* Tracked-link hand-off page (one-time /l/<token> links behind the Open button). */
    if (path.startsWith('/l/') && linkTracker && typeof linkTracker.handleHttp === 'function') {
      try {
        if (await linkTracker.handleHttp(request, response, path, (req) => readRequestBody(req, 4_096))) return;
      } catch (error) {
        logger('error', 'link_page_failed', { error });
        sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
        return;
      }
    }
    /* Market Direction for stockmarketloop.com (signed with the shared billing secret, like the alerts desk). */
    if (request.method === 'POST' && path === '/v1/group-tools/direction') {
      if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
      const body = await readRequestBody(request);
      if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
      const verified = verifySignature({ secret: billingOptions.billingApiSecret, timestamp: request.headers['x-sml-timestamp'], signature: request.headers['x-sml-signature'], rawBody: body.rawBody, now: billingOptions.now() });
      if (!verified.ok) { sendJson(response, verified.status, { ok: false, error: verified.error }); return; }
      if (!marketDirection) { sendJson(response, 503, { ok: false, error: 'direction_unavailable' }); return; }
      let input = {};
      try { input = JSON.parse(body.rawBody) || {}; } catch (_) { input = {}; }
      try { sendJson(response, 200, await marketDirection.get(input.mode === 'swing' ? 'swing' : 'day')); }
      catch (error) { logger('error', 'market_direction_failed', { error }); sendJson(response, 503, { ok: false, error: 'direction_temporarily_unavailable' }); }
      return;
    }
    /* Hedge & Income and the options-chain contract alert for the stockmarketloop.com analyst dashboard (signed like Market Direction).
       The site sends its own levels; Academy alert desks are never read (noAlerts) and no Academy entitlement applies. Educational only. */
    if (request.method === 'POST' && (path === '/v1/group-tools/hedge' || path === '/v1/group-tools/contract-alert-preview')) {
      if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
      const body = await readRequestBody(request, 384 * 1024); // the site sends the options chain it is showing
      const siteChain = (v) => (v && typeof v === 'object' && Array.isArray(v.contracts) && v.contracts.length <= 2500 ? v : null);
      if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
      const verified = verifySignature({ secret: billingOptions.billingApiSecret, timestamp: request.headers['x-sml-timestamp'], signature: request.headers['x-sml-signature'], rawBody: body.rawBody, now: billingOptions.now() });
      if (!verified.ok) { sendJson(response, verified.status, { ok: false, error: verified.error }); return; }
      let input = {};
      try { input = JSON.parse(body.rawBody) || {}; } catch (_) { input = {}; }
      const symbol = String(input.symbol || '').toUpperCase();
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      if (path === '/v1/group-tools/hedge') {
        if (!academyHedge) { sendJson(response, 503, { ok: false, error: 'hedge_unavailable', message: 'The live options feed is not connected right now.' }); return; }
        const level = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n < 1e7 ? n : null; };
        const strength = input.strength == null || input.strength === '' ? NaN : Number(input.strength);
        try {
          const out = await academyHedge.plan({
            symbol, shares: Math.min(1_000_000, Math.max(1, Math.round(Number(input.shares) || 100))), entry: level(input.entry), target: level(input.target), stop: level(input.stop),
            horizon: ['day', 'swing', 'mid', 'long', 'short'].includes(input.horizon) ? input.horizon : 'swing', side: input.side === 'short' ? 'short' : 'long',
            dir: ['bull', 'bear', 'neutral'].includes(input.dir) ? input.dir : null, strength: Number.isFinite(strength) ? Math.min(100, Math.max(0, strength)) : null,
            userId: null, view: 'site', noAlerts: true, chainData: siteChain(input.chain)
          });
          sendJson(response, out.ok ? 200 : (out.status || 503), out);
        } catch (error) { logger('error', 'site_hedge_failed', { symbol, error }); sendJson(response, 503, { ok: false, error: 'hedge_unavailable', message: 'Hedge ideas are not available right now.' }); }
        return;
      }
      if (!academyClickAlert || typeof academyClickAlert.sitePreview !== 'function') { sendJson(response, 503, { ok: false, error: 'contract_alert_unavailable' }); return; }
      const c = input.contract && typeof input.contract === 'object' ? input.contract : {};
      const type = c.type === 'call' || c.type === 'put' ? c.type : '';
      const strike = Number(c.strike), expiry = String(c.expiry || '');
      if (!type || !(strike > 0 && strike < 1e7) || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) { sendJson(response, 400, { ok: false, error: 'invalid_contract' }); return; }
      try {
        const out = await academyClickAlert.sitePreview({ symbol, contract: { type, strike, expiry }, chainData: siteChain(input.chain) });
        sendJson(response, out.ok ? 200 : (out.status || 503), out.ok ? out : { ok: false, error: out.code || 'contract_alert_failed', detail: out.detail || '' });
      } catch (error) { logger('error', 'site_contract_alert_failed', { symbol, error }); sendJson(response, 503, { ok: false, error: 'contract_alert_unavailable' }); }
      return;
    }
    if (request.method === 'POST' && path === '/v1/group-tools/alerts') {
      await handleSiteAlerts(request, response, { ...billingOptions, academyAlerts, academyAlertSources });
      return;
    }
    if (request.method === 'POST' && path === '/v1/group-tools/run') {
      await handleGroupTools(request, response, { ...billingOptions, groupTools });
      return;
    }
    if (request.method === 'POST' && path === '/v1/verify/report') {
      await handleLinkReport(request, response, { ...billingOptions, linkTracker: verifyGate ? { report: (input) => verifyGate.report(input) } : null });
      return;
    }

    /* Public chart relay. It is read-only, narrowly CORS-scoped and disabled
       until the site owner confirms a Massive Business redistribution plan. */
    if (path.startsWith('/market-data/')) {
      const origin = String(request.headers.origin || '');
      if (!allowedPublicOrigin(origin)) { sendJson(response, 403, { ok: false, error: 'origin_not_allowed' }); return; }
      if (request.method === 'OPTIONS') { response.writeHead(204, corsHeaders(origin)); response.end(); return; }
      if (!publicMarketDataEnabled) { corsJson(request, response, 503, { ok: false, error: 'public_market_data_disabled' }); return; }
      if (request.method !== 'GET') { corsJson(request, response, 405, { ok: false, error: 'method_not_allowed' }); return; }
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      let symbol;
      try { symbol = cleanMarketSymbol(params.get('symbol')); }
      catch (_) { corsJson(request, response, 400, { ok: false, error: 'invalid_symbol' }); return; }

      if (path === '/market-data/candles') {
        if (!marketHistory?.enabled) { corsJson(request, response, 503, { ok: false, error: 'history_disabled' }); return; }
        try {
          const result = await marketHistory.get(symbol, params.get('tf') || '5m');
          corsJson(request, response, result.status || (result.ok ? 200 : 503), result.ok ? result.data : { ok: false, error: result.code });
        } catch (error) { corsJson(request, response, error instanceof TypeError ? 400 : 503, { ok: false, error: error instanceof TypeError ? 'invalid_timeframe' : 'temporary_unavailable' }); }
        return;
      }

      if (path === '/market-data/snapshot') {
        if (!academyMassive?.status().enabled) { corsJson(request, response, 503, { ok: false, error: 'stream_disabled' }); return; }
        academyMassive.watch(symbol);
        const snapshot = academyMassive.peek(symbol);
        if (!snapshot) { corsJson(request, response, 503, { ok: false, error: 'quote_pending' }); return; }
        corsJson(request, response, 200, { ok: true, source: 'massive', ...snapshot });
        return;
      }

      if (path === '/market-data/stream') {
        if (!academyMassive?.status().enabled) { corsJson(request, response, 503, { ok: false, error: 'stream_disabled' }); return; }
        const ip = requestIp(request), active = publicStreamByIp.get(ip) || 0;
        if (active >= 4 || publicStreamTotal >= 400) { corsJson(request, response, 429, { ok: false, error: 'stream_limit' }); return; }
        publicStreamByIp.set(ip, active + 1); publicStreamTotal += 1;
        response.writeHead(200, { ...corsHeaders(origin), 'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        const write = (event, data) => { sseEvent(response, event, data); };
        academyMassive.watch(symbol);
        write('snapshot', { ok: true, source: 'massive', ...(academyMassive.peek(symbol) || { symbol, pending: true }) });
        let pendingQuote = null, quoteTimer = null, closed = false;
        const off = academyMassive.on(symbol, (event) => {
          if (event.type === 'trade') write('trade', event.trade);
          else { pendingQuote = event.quote; if (!quoteTimer) quoteTimer = setTimeout(() => { quoteTimer = null; if (pendingQuote) { write('quote', pendingQuote); pendingQuote = null; } }, 100); }
        });
        const beat = setInterval(() => { sseWrite(response, ': keep-alive\n\n'); }, 15_000);
        const done = () => { if (closed) return; closed = true; clearInterval(beat); if (quoteTimer) clearTimeout(quoteTimer); off(); publicStreamTotal = Math.max(0, publicStreamTotal - 1); const left = Math.max(0, (publicStreamByIp.get(ip) || 1) - 1); if (left) publicStreamByIp.set(ip, left); else publicStreamByIp.delete(ip); };
        request.on('close', done); response.on('close', done);
        return;
      }
      corsJson(request, response, 404, { ok: false, error: 'not_found' }); return;
    }
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
      if (!(academyVoice?.configured || academyVoice?.stored) || !academyDiscipline?.configured) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
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
        logger(invalid || (error && error.cached) ? 'warn' : 'error', 'academy_discipline_voice_failed', { error, userId: claims?.userId || null, cached: !!(error && error.cached) });
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
    /* Owner-created membership products (the site authorizes the owner) */
    if (request.method === 'POST' && path === '/v1/billing/plans/create') {
      await handleBillingRequest(request, response, billingOptions, billingService.createGroupPlan);
      return;
    }
    if (request.method === 'POST' && path === '/v1/billing/plans/list') {
      await handleBillingRequest(request, response, billingOptions, billingService.listGroupPlans);
      return;
    }
    if (request.method === 'POST' && path === '/v1/billing/plans/archive') {
      await handleBillingRequest(request, response, billingOptions, billingService.archiveGroupPlan);
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
    if (request.method === 'POST' && path === '/v1/links/report') {
      await handleLinkReport(request, response, { ...billingOptions, linkTracker });
      return;
    }
    if (request.method === 'POST' && path === '/v1/site-export/ingest') {
      await handleSiteExportIngest(request, response, { ...billingOptions, siteExportSink });
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
    /* the page's immutable script and style bundles (academy-page-assets.js) */
    if ((request.method === 'GET' || request.method === 'HEAD') && pageAssets && path.startsWith(pageAssets.prefix)) {
      if (pageAssets.serve(request, response)) return;
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
      if (contentGateOn) {
        const tier = callerTier(request);
        if (tier === null) { sendJson(response, 401, { ok: false, error: 'authorization_required' }); return; }
        const full = tierEntitled(tier);
        const gatedBody = full ? academyCurriculumPayloadGzip : previewCurriculum();
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': gatedBody.length,
          'content-encoding': 'gzip',
          'cache-control': full ? 'private, max-age=300, stale-while-revalidate=3600' : 'private, no-store',
          vary: 'Authorization',
          'x-academy-access': full ? 'full' : 'preview',
          'x-content-type-options': 'nosniff'
        });
        response.end(gatedBody);
        return;
      }
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
      const requestedSymbol = params.get('symbol') || 'SPY';
      /* The page loads before sign-in, so with the content gate on it opens on a free symbol. */
      const symbol = contentGateOn && !academyGate.isFreeSymbol(requestedSymbol) ? (academyGate.freeSymbols[0] || 'SPY') : requestedSymbol;
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
      if (contentGateOn) activity.scanner = gatedScanner(activity.scanner);
      activity.depth = depth.status === 'fulfilled' ? depth.value : { bids: [], asks: [] };
      sendHtml(response, 200, academyActivityHtml(activity, academyPageOptions()), academyPageAssetsFor());
      return;
    }

    if (contentGateOn && request.method === 'GET' && path === '/academy-activity/mem-algo.js') {
      const tier = callerTier(request);
      if (tier === null || tier === 'anonymous') { sendJson(response, 401, { ok: false, error: 'authorization_required' }); return; }
      const source = tierEntitled(tier) ? ACADEMY_MEM_ALGO_SOURCE : ACADEMY_MEM_ALGO_TEASER_SOURCE;
      if (!source) { sendJson(response, 503, { ok: false, error: 'model_unavailable' }); return; }
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-length': Buffer.byteLength(source),
        'cache-control': 'private, no-store', vary: 'Authorization', 'x-content-type-options': 'nosniff' });
      response.end(source);
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/loop-kick/session') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      if (!loopKickBridge || !loopKickBridge.configured) { sendJson(response, 503, { ok: false, error: 'loop_kick_unconfigured' }); return; }
      const minted = await loopKickBridge.session(session.userId);
      const { status, ...body } = minted;
      /* a member without a site account can make one with their Discord in one step (the trial sign-in does it) */
      if (!minted.ok && minted.error === 'not_linked' && academyTrial && academyTrial.configured) body.register_url = academyTrial.link + '?via=loopkick';
      sendJson(response, status || (minted.ok ? 200 : 503), body);
      return;
    }

    /* One-tap LOOP-KICK connection from inside the Academy: the member signs in with their stockmarketloop.com
       password here (POST connect), or takes a signed single-use link to finish on the site (GET connect-link).
       No code to copy, nothing to type in Discord. */
    if ((request.method === 'POST' && path === '/academy-activity/loop-kick/connect') || (request.method === 'GET' && path === '/academy-activity/loop-kick/connect-link')) {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      await handleLoopKickConnect(request, response, session);
      return;
    }

    if (request.method === 'GET' && path.startsWith('/loop-kick-activity/sdk/')) {
      sendAcademySdkModule(response, '/academy-activity/sdk/' + path.slice('/loop-kick-activity/sdk/'.length));
      return;
    }

    if (request.method === 'GET' && (path === '/loop-kick-activity/' || path === '/loop-kick-activity')) {
      sendHtml(response, 200, loopKickActivityHtml({ appId: connectAppId }));
      return;
    }

    if (request.method === 'POST' && path === '/loop-kick-activity/token') {
      if (!connectOAuth || !connectOAuth.activityConfigured) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
      const tokenBody = await readRequestBody(request, 4096);
      if (!tokenBody.ok) { sendJson(response, tokenBody.status, { ok: false, error: tokenBody.error }); return; }
      let input = null;
      try { input = JSON.parse(tokenBody.rawBody); } catch (_) { input = null; }
      if (!input || typeof input.code !== 'string') { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
      const result = await connectOAuth.completeActivity({ code: input.code });
      if (!result.ok) { sendJson(response, result.status || 401, { ok: false, error: result.code }); return; }
      sendJson(response, 200, { ok: true, access_token: result.accessToken, sessionToken: result.sessionToken });
      return;
    }

    if (request.method === 'GET' && path === '/loop-kick-activity/session-bridge') {
      if (!connectOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = connectOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (!loopKickBridge || !loopKickBridge.configured) { sendJson(response, 503, { ok: false, error: 'loop_kick_unconfigured' }); return; }
      const minted = await loopKickBridge.session(session.userId);
      const { status, ...body } = minted;
      /* a member without a site account can make one with their Discord in one step (the trial sign-in does it) */
      if (!minted.ok && minted.error === 'not_linked' && academyTrial && academyTrial.configured) body.register_url = academyTrial.link + '?via=loopkick';
      sendJson(response, status || (minted.ok ? 200 : 503), body);
      return;
    }

    if ((request.method === 'POST' && path === '/loop-kick-activity/connect') || (request.method === 'GET' && path === '/loop-kick-activity/connect-link')) {
      if (!connectOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = connectOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      await handleLoopKickConnect(request, response, session);
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/open') {
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      const broker = String(params.get('b') || '');
      const symbol = cleanBrokerSymbol(params.get('symbol'));
      if (!symbol || !['moomoo', 'webull'].includes(broker)) { sendJson(response, 400, { ok: false, error: symbol ? 'invalid_broker' : 'invalid_symbol' }); return; }
      const quoteUrl = broker === 'moomoo' ? moomooQuoteUrl(symbol) : await brokerLinks.urlFor('webull', symbol).catch(() => webullUrl(symbol, ''));
      sendHtml(response, 200, brokerLaunchHtml(broker, symbol, quoteUrl));
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/broker') {
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      try {
        const location = await brokerLinks.urlFor(String(params.get('b') || ''), params.get('symbol'));
        response.writeHead(302, { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
        response.end();
      } catch (error) {
        sendJson(response, error instanceof TypeError ? 400 : 503, { ok: false, error: error instanceof TypeError ? error.message : 'temporary_unavailable' });
      }
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/moomoo') {
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      const symbol = String(params.get('symbol') || 'SPY').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 10) || 'SPY';
      sendHtml(response, 200, academyMoomooLaunchHtml(symbol));
      return;
    }

    if (request.method === 'GET' && ACADEMY_LIMITED_PATHS.has(path)) {
      const gate = academyDataLimit.take(request);
      if (!gate.ok) {
        response.setHeader('retry-after', String(gate.retryAfterSec));
        sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec });
        return;
      }
    }

    if (request.method === 'GET' && path === '/academy-activity/data-status') {
      sendJson(response, 200, { ok: true, ...dataStatusSummary() });
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/market') {
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      const symbol = params.get('symbol');
      const timeframe = params.get('tf') || '5m';
      if (!allowGatedSymbol(request, response, symbol)) return;
      noteActiveSymbol(symbol);
      const tickSize = parseTick(timeframe);
      if (tickSize) {
        /* Tick charts: a candle every N trades, built from the Massive trade record (and recent trade history when the plan has it). */
        const sym = String(symbol || '').toUpperCase();
        if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym) || !academyMassive?.status().enabled) { sendJson(response, 503, { ok: false, error: 'ticks_unavailable' }); return; }
        academyMassive.watch(sym);
        try {
          const history = marketHistory?.enabled ? await marketHistory.trades(sym) : [];
          const bars = buildTickBars(mergeTrades(history, academyMassive.ticks(sym)), tickSize).slice(-1500);
          if (!bars.length) { sendJson(response, 503, { ok: false, error: 'ticks_warming', detail: 'Collecting trades for this symbol. Tick candles appear as they print.' }); return; }
          sendJson(response, 200, { symbol: sym, tf: timeframe, bars, asOf: Date.now(), source: 'massive-ticks', quality: 'built-from-trades' });
        } catch (error) {
          logger('error', 'academy_tick_request_failed', { error });
          sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
        }
        return;
      }
      try {
        // Massive serves only the timeframes in TIMEFRAMES; every other one (3m, 15m, 1h, 1Q, 1Y...) comes from the WordPress history feed, not a 400.
        /* 3m, 15m, 1h, 1Q... have no direct Massive series: they come from the WordPress history feed, and when that feed is throttled,
           down, or serving an interval it stopped updating (its 1h series ends months back), the bars are built from the Massive interval
           underneath them instead. Marked "massive-derived" so the UI can say so. */
        const derivedCandles = async (why) => {
          const cfg = MASSIVE_DERIVED_TIMEFRAMES[timeframe];
          if (!cfg || !marketHistory?.enabled) return null;
          const base = await marketHistory.get(symbol, cfg.base).catch(() => null);
          const bars = base?.ok ? resampleBars(base.data.bars, timeframe).slice(-600) : [];
          if (!bars.length) return null;
          logger('warn', 'academy_market_derived', { symbol: String(symbol || '').toUpperCase(), tf: timeframe, why });
          return annotateCandles({ symbol: String(symbol || '').toUpperCase(), tf: timeframe, bars, asOf: Date.now(), lastBarAt: bars[bars.length - 1].t, ...(base.data.stale ? { stale: true } : {}) }, { source: 'massive-derived', adjusted: true });
        };
        const massive = marketHistory?.enabled && Object.prototype.hasOwnProperty.call(MASSIVE_TIMEFRAMES, timeframe) ? await marketHistory.get(symbol, timeframe) : null;
        let payload = massive?.ok ? massive.data : null;
        if (!payload) {
          try { payload = await getAcademyCandles(symbol, timeframe); }
          catch (error) { if (error instanceof TypeError) throw error; payload = await derivedCandles(String(error && error.message || error)); if (!payload) throw error; }
          /* an intraday series the site stopped updating is worse than none: a 1h chart drawn from months-old bars reads as live */
          const cfg = MASSIVE_DERIVED_TIMEFRAMES[timeframe];
          const lastBar = payload && Array.isArray(payload.bars) && payload.bars.length ? Number(payload.bars[payload.bars.length - 1].t) : 0;
          if (cfg && cfg.ms && payload && payload.source === 'wordpress-history' && lastBar && Date.now() - lastBar > 2 * 86_400_000) {
            const fresh = await derivedCandles('site_history_stale_' + new Date(lastBar).toISOString().slice(0, 10));
            if (fresh) payload = fresh;
          }
        }
        sendJson(response, 200, payload);
      } catch (error) {
        // a symbol the feed has no bars for (thin names, a closed session on a short interval) is the data's answer, not a fault
        logger(error instanceof TypeError || (error && error.message === 'academy_market_empty') ? 'warn' : 'error', 'academy_market_request_failed', { error });
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

    /* Each member's own alert sources: pick a server, then a channel (or chosen posters in it), then follow. Members only; a member only ever sees
       servers they share with an Academy bot and channels they can already read in Discord. */
    if (path.startsWith('/academy-activity/alerts/') && ['/academy-activity/alerts/sources', '/academy-activity/alerts/guilds', '/academy-activity/alerts/channels', '/academy-activity/alerts/channel'].includes(path)) {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (!academyAlertSources) { sendJson(response, 503, { ok: false, error: 'alert_sources_disabled' }); return; }
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      try {
        if (request.method === 'GET' && path === '/academy-activity/alerts/sources') { sendJson(response, 200, { ok: true, ...(await academyAlertSources.list(session.userId)) }); return; }
        if (request.method === 'GET' && path === '/academy-activity/alerts/guilds') { sendJson(response, 200, { ok: true, guilds: await academyAlertSources.guilds(session.userId, params.get('current')) }); return; }
        if (request.method === 'GET' && path === '/academy-activity/alerts/channels') {
          const channels = await academyAlertSources.channels(session.userId, params.get('guild'));
          if (!channels) { sendJson(response, 404, { ok: false, error: 'guild_not_found' }); return; }
          sendJson(response, 200, { ok: true, channels }); return;
        }
        if (request.method === 'GET' && path === '/academy-activity/alerts/channel') {
          const id = String(params.get('channel') || '').replace(/[^0-9]/g, '').slice(0, 25);
          const one = id ? await academyAlertSources.preview(session.userId, id) : null;
          if (!one) { sendJson(response, 404, { ok: false, error: 'channel_not_found' }); return; }
          sendJson(response, 200, { ok: true, ...one }); return;
        }
        if ((request.method === 'POST' || request.method === 'DELETE') && path === '/academy-activity/alerts/sources') {
          if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
          const body = await readRequestBody(request, 2048);
          if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
          let input; try { input = JSON.parse(body.rawBody); } catch (_) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
          const result = request.method === 'POST' ? await academyAlertSources.add(session.userId, input) : await academyAlertSources.remove(session.userId, input);
          sendJson(response, 200, { ok: true, ...result }); return;
        }
        sendJson(response, 405, { ok: false, error: 'method_not_allowed' });
      } catch (error) {
        const code = error instanceof TypeError ? [400, 'invalid_source'] : error instanceof RangeError ? [409, 'too_many_sources'] : error && error.code === 'no_access' ? [403, 'no_access'] : null;
        if (!code) logger('error', 'academy_alert_sources_failed', { error });
        sendJson(response, code ? code[0] : 503, { ok: false, error: code ? code[1] : 'temporarily_unavailable' });
      }
      return;
    }

    /* Chat profile cards: a member's Discord avatar and profile, and their linked StockMarketLoop profile / channel / group (public fields only).
       Any signed-in Academy session may look at another member's card. The avatar comes back as bytes because the Activity page can only load images from its own origin. */
    /* Member profile pages (academy-profile-pages.js): the page, the hover card, follows, presence, link-card images, the song. */
    /* Social notifications for LOOP-KICK (academy-social-notify.js): new followers, Trading Wall comments, posts by the members
       a member follows, likes on and replies to their comments; and the likes themselves (Ticker Talk and Trading Wall comments). */
    if (path === '/academy-activity/notify' || path === '/academy-activity/notify/read' || path === '/academy-activity/likes') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      if (!academySocialNotify) { sendJson(response, 503, { ok: false, error: 'notify_disabled' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      const me = String(session.userId);
      const nq = new URL(request.url || '/', 'http://localhost').searchParams;
      const readJson = async (max = 8192) => { const raw = await readRequestBody(request, max).catch(() => null); try { return raw && raw.ok ? JSON.parse(raw.rawBody || '{}') : null; } catch (_) { return null; } };
      try {
        if (request.method === 'GET' && path === '/academy-activity/notify') { sendJson(response, 200, await academySocialNotify.list(me, { limit: nq.get('limit') || 30, before: nq.get('before') || '' })); return; }
        if (request.method === 'POST' && path === '/academy-activity/notify/read') {
          const b = (await readJson()) || {};
          sendJson(response, 200, await academySocialNotify.markRead(me, { ids: Array.isArray(b.ids) ? b.ids : null, all: b.all === true })); return;
        }
        if (request.method === 'GET' && path === '/academy-activity/likes') {
          const kind = String(nq.get('kind') || ''), ids = String(nq.get('ids') || '').split(',').map((v) => v.trim()).filter(Boolean);
          sendJson(response, 200, { ok: true, kind, likes: await academySocialNotify.likesFor(kind, ids, me) }); return;
        }
        if (request.method === 'POST' && path === '/academy-activity/likes') {
          const b = await readJson(1024); if (!b || typeof b !== 'object') { sendJson(response, 400, { ok: false, error: 'invalid_body' }); return; }
          const r = await academySocialNotify.like(String(b.kind || ''), String(b.id || ''), { id: me, name: session.displayName || '' }, b.on !== false);
          sendJson(response, r.ok ? 200 : (r.error === 'not_found' ? 404 : r.error === 'storage_unavailable' ? 503 : 400), r); return;
        }
        sendJson(response, 405, { ok: false, error: 'method_not_allowed' }); return;
      } catch (error) { logger('error', 'academy_social_notify_failed', { error: String((error && error.message) || error) }); sendJson(response, 503, { ok: false, error: 'temporary_unavailable' }); return; }
    }
    /* the engagement layer (academy-community.js): traders to follow, the Following stream, the inbox, one Follow that does both follows */
    if (path === '/academy-activity/community' || path.startsWith('/academy-activity/community/')) {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      if (!academyCommunity) { sendJson(response, 503, { ok: false, error: 'community_disabled' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      const me = String(session.userId);
      const cq = new URL(request.url || '/', 'http://localhost').searchParams;
      try {
        if (request.method === 'GET' && path === '/academy-activity/community/suggest') { sendJson(response, 200, await academyCommunity.suggest(me, { limit: cq.get('limit') || 6 })); return; }
        if (request.method === 'GET' && path === '/academy-activity/community/following') { sendJson(response, 200, await academyCommunity.following(me, { limit: cq.get('limit') || 40 })); return; }
        if (request.method === 'GET' && path === '/academy-activity/community/inbox') { sendJson(response, 200, await academyCommunity.inbox(me, { since: cq.get('since') || '' })); return; }
        if (request.method === 'POST' && path === '/academy-activity/community/follow') {
          if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
          const raw = await readRequestBody(request, 1024); let b = null; try { b = raw.ok ? JSON.parse(raw.rawBody) : null; } catch (_) { b = null; }
          if (!b || !/^\d{15,25}$/.test(String(b.user || ''))) { sendJson(response, 400, { ok: false, error: 'invalid_user' }); return; }
          const r = await academyCommunity.follow(me, String(b.user), b.on !== false);
          if (r.ok && b.on !== false && academySocialNotify) academySocialNotify.follow(me, String(b.user), session.displayName || '').catch(() => {});
          sendJson(response, r.ok ? 200 : 400, r); return;
        }
        sendJson(response, 404, { ok: false, error: 'not_found' }); return;
      } catch (error) { logger('error', 'academy_community_failed', { error: String((error && error.message) || error) }); sendJson(response, 503, { ok: false, error: 'temporary_unavailable' }); return; }
    }
    /* where Stripe sends a subscriber after paying for an Alert Chart, and a trader after Stripe onboarding (alert-chart-billing.js); no session: the browser is outside Discord */
    if (request.method === 'GET' && (path === '/academy-activity/alert-chart/paid' || path === '/academy-activity/alert-chart/stripe')) {
      const q = new URL(request.url || '/', 'http://localhost').searchParams;
      const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      let title = 'Alert Chart', lead = '', detail = '';
      if (path === '/academy-activity/alert-chart/stripe') {
        title = q.get('done') ? 'Stripe setup complete' : 'Stripe setup not finished';
        lead = q.get('done') ? 'Your Alert Chart can now take paid subscribers.' : 'Stripe needs a little more from you before your chart can take paid subscribers.';
        detail = q.get('done') ? 'Go back to the Academy: open your profile, then Channels &amp; prices, and tick premium on the channels you sell. Payouts come from stockmarketloop.com after its 6% processing fee.' : 'Go back to the Academy, open Channels &amp; prices and press Get paid with Stripe again to continue where you left off.';
      } else if (q.get('cancel')) {
        title = 'Checkout cancelled'; lead = 'Nothing was charged.'; detail = 'Go back to the Academy whenever you want to subscribe.';
      } else {
        const state = alertChartBilling && q.get('k') ? await alertChartBilling.checkoutState(q.get('k')).catch(() => null) : null;
        const paid = state && state.ok && (state.status === 'active');
        title = paid ? 'Payment received' : 'Thank you';
        lead = paid ? 'Your access is on.' : 'Your payment is being confirmed.';
        detail = paid ? 'Go back to the Academy: the premium alerts on this chart are unlocked for you' + (state.until ? ' until ' + esc(new Date(state.until).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })) : '') + '. stockmarketloop.com manages the subscription, receipts, refunds and disputes.' : 'Stripe confirms the payment to stockmarketloop.com within a minute; your access in the Academy turns on by itself. Reload the chart if it still shows locked after that.';
      }
      sendHtml(response, 200, '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + ' · Making Easy Money Academy</title><meta name="robots" content="noindex"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070b10;color:#dbe6ec;font:500 1rem/1.5 system-ui,sans-serif}main{max-width:520px;padding:28px 22px;border:1px solid #1b3540;border-radius:14px;background:#0a1118;margin:16px}h1{margin:0 0 6px;font:900 1.3rem system-ui,sans-serif;color:#fff}p.lead{color:#7ef0bd;font-weight:800;margin:0 0 10px}p{margin:0 0 10px}small{color:#7f98a6}</style></head><body><main><h1>' + esc(title) + '</h1><p class="lead">' + esc(lead) + '</p><p>' + detail + '</p><small>You can close this tab.</small></main></body></html>');
      return;
    }
    /* ALERT CHART (academy-trader-alerts.js): a trader's alerts as threads, followed (with a push opt-in) by members; premium channels need a grant */
    if (path === '/academy-activity/trader-alerts' || path.startsWith('/academy-activity/trader-alerts/')) {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      if (!traderAlerts) { sendJson(response, 503, { ok: false, error: 'alert_chart_disabled' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      const me = String(session.userId);
      const tq = new URL(request.url || '/', 'http://localhost').searchParams;
      const readBody = async (max = 16_384) => { const raw = await readRequestBody(request, max).catch(() => null); try { return raw && raw.ok ? JSON.parse(raw.rawBody || '{}') : null; } catch (_) { return null; } };
      const SNOW = /^\d{15,25}$/;
      try {
        if (request.method === 'GET' && path === '/academy-activity/trader-alerts') {
          const who = tq.get('user') || me; if (!SNOW.test(who)) { sendJson(response, 400, { ok: false, error: 'invalid_user' }); return; }
          sendJson(response, 200, await traderAlerts.list(who, { viewerId: me, limit: tq.get('limit') || 30, status: tq.get('status') || 'all' })); return;
        }
        if (request.method === 'GET' && path === '/academy-activity/trader-alerts/feed') { sendJson(response, 200, await traderAlerts.feed(me, { limit: tq.get('limit') || 40 })); return; }
        if (request.method === 'GET' && path === '/academy-activity/trader-alerts/settings') { sendJson(response, 200, { ok: true, settings: await traderAlerts.settingsOf(me), stats: await traderAlerts.stats(me) }); return; }
        if (request.method === 'POST' && path === '/academy-activity/trader-alerts/settings') { const b = await readBody(8192); if (!b) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; } sendJson(response, 200, await traderAlerts.saveSettings(me, b)); return; }
        if (request.method === 'POST' && path === '/academy-activity/trader-alerts') {
          if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
          const gate = academyDataLimit.take(request); if (!gate.ok) { sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
          const b = await readBody(8192); if (!b) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
          const r = await traderAlerts.post(me, b); sendJson(response, r.ok ? 200 : 400, r); return;
        }
        if (request.method === 'POST' && path === '/academy-activity/trader-alerts/follow') {
          const b = await readBody(1024); if (!b || !SNOW.test(String(b.trader || ''))) { sendJson(response, 400, { ok: false, error: 'invalid_user' }); return; }
          const r = await traderAlerts.follow(me, String(b.trader), { on: b.on !== false, push: typeof b.push === 'boolean' ? b.push : null }); sendJson(response, r.ok ? 200 : 400, r); return;
        }
        if (request.method === 'POST' && path === '/academy-activity/trader-alerts/grant') {
          if (!OWNER_IDS.includes(me)) { sendJson(response, 403, { ok: false, error: 'owner_only' }); return; }
          const b = await readBody(1024); if (!b) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
          const r = b.revoke ? await traderAlerts.revokeAccess(String(b.member || ''), String(b.trader || '')) : await traderAlerts.grantAccess(String(b.member || ''), String(b.trader || ''), { plan: String(b.plan || 'month'), source: 'owner', reference: String(b.reference || '') });
          sendJson(response, r.ok ? 200 : 400, r); return;
        }
        /* selling: the trader's seller status on stockmarketloop.com, and the consents + Stripe Express onboarding (alert-chart-billing.js) */
        if (request.method === 'GET' && path === '/academy-activity/trader-alerts/seller') {
          if (!alertChartBilling) { sendJson(response, 200, { ok: true, configured: false, ready: false, linked: false, consented: false, stripe: { connected: false, ready: false } }); return; }
          sendJson(response, 200, await alertChartBilling.sellerStatus(me)); return;
        }
        if (request.method === 'POST' && path === '/academy-activity/trader-alerts/seller') {
          if (!tierAnalyst(session.tier)) { sendJson(response, 403, { ok: false, error: 'academy_analyst_required' }); return; }
          if (!alertChartBilling) { sendJson(response, 503, { ok: false, error: 'billing_unconfigured' }); return; }
          const gate = academyDataLimit.take(request); if (!gate.ok) { sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
          const b = await readBody(1024); if (!b) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
          const r = await alertChartBilling.onboardSeller(me, { terms: b.terms === true, fee: b.fee === true, disputes: b.disputes === true, activity: b.activity === true });
          sendJson(response, r.ok ? 200 : r.error === 'consent_required' || r.error === 'site_not_linked' ? 400 : 503, r); return;
        }
        if (request.method === 'POST' && path === '/academy-activity/trader-alerts/checkout') {
          /* premium access is bought on stockmarketloop.com (Stripe Checkout through the site's marketplace); access lands from the webhook */
          const b = await readBody(1024); const trader = b && String(b.trader || ''), plan = b && String(b.plan || '');
          if (!SNOW.test(trader) || !(plan in traderAlerts.PLANS)) { sendJson(response, 400, { ok: false, error: 'invalid_request' }); return; }
          const start = traderAlertsCheckout || (alertChartBilling && alertChartBilling.configured ? (i) => alertChartBilling.checkout(i) : null);
          if (!start) { sendJson(response, 503, { ok: false, error: 'checkout_unavailable' }); return; }
          const gate = academyDataLimit.take(request); if (!gate.ok) { sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
          const r = await start({ memberId: me, traderId: trader, plan });
          sendJson(response, r && r.ok ? 200 : r && (r.error === 'plan_not_offered' || r.error === 'not_premium' || r.error === 'own_chart' || r.error === 'invalid_plan' || r.error === 'seller_not_ready') ? 400 : 503, r || { ok: false, error: 'checkout_unavailable' }); return;
        }
        const um = /^\/academy-activity\/trader-alerts\/(\d{1,18})\/update$/.exec(path);
        if (request.method === 'POST' && um) {
          const b = await readBody(8192); if (!b) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
          const r = await traderAlerts.update(me, um[1], b); sendJson(response, r.ok ? 200 : (r.error === 'not_found' ? 404 : r.error === 'not_yours' ? 403 : 400), r); return;
        }
        sendJson(response, 404, { ok: false, error: 'not_found' }); return;
      } catch (error) { logger('error', 'academy_trader_alerts_failed', { error: String((error && error.message) || error) }); sendJson(response, 503, { ok: false, error: 'temporary_unavailable' }); return; }
    }
    /* STANDING ALERT LEVELS (academy-alert-levels.js): the member's own open alerts for one symbol (entry, current target, stop), for the chart to keep in view */
    if (request.method === 'GET' && path === '/academy-activity/my-alert-levels') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (!alertLevels) { sendJson(response, 200, { ok: true, levels: [], asOf: Date.now() }); return; }
      const lq = new URL(request.url || '/', 'http://localhost').searchParams, lsym = String(lq.get('symbol') || '').toUpperCase();
      if (lsym && !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(lsym)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      try { sendJson(response, 200, await alertLevels.forMember(String(session.userId), lsym)); }
      catch (error) { logger('warn', 'academy_alert_levels_failed', { error: String((error && error.message) || error) }); sendJson(response, 200, { ok: true, levels: [], asOf: Date.now() }); }
      return;
    }

    /* TRADING ROOM (academy-trading-room.js): the room behind a trader's profile: channels that are public, free (members) or paid (by tier). Reads and chat need only a verified session; the owner's setup needs Academy access. */
    if (path === '/academy-activity/room' || path.startsWith('/academy-activity/room/')) {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      if (!tradingRoom) { sendJson(response, 503, { ok: false, error: 'rooms_disabled' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      const me = String(session.userId);
      const rq = new URL(request.url || '/', 'http://localhost').searchParams;
      const readBody = async (max = 16_384) => { const raw = await readRequestBody(request, max).catch(() => null); try { return raw && raw.ok ? JSON.parse(raw.rawBody || '{}') : null; } catch (_) { return null; } };
      const SNOW = /^\d{15,25}$/;
      const status = (r) => (r && r.ok ? 200 : r && (r.error === 'locked' || r.error === 'not_yours' || r.error === 'read_only') ? 403 : r && (r.error === 'no_room' || r.error === 'no_channel' || r.error === 'not_found') ? 404 : r && r.error === 'slow_mode' ? 429 : 400);
      try {
        const sub = path.slice('/academy-activity/room'.length);
        if (request.method === 'GET' && (sub === '' || sub === '/')) {
          const owner = rq.get('owner') || me; if (!SNOW.test(owner)) { sendJson(response, 400, { ok: false, error: 'invalid_user' }); return; }
          let sellerReady = false, seller = null;
          if (owner === me && alertChartBilling) { seller = await alertChartBilling.sellerStatus(me).catch(() => null); sellerReady = Boolean(seller && seller.ready); }
          const r = await tradingRoom.view(me, owner, { sellerReady }); if (seller && r.ok) r.seller = seller;
          const f = traderAlerts && owner !== me ? await traderAlerts.followState(me, owner).catch(() => null) : null; if (f && r.ok) r.following = Boolean(f.following);
          sendJson(response, status(r), r); return;
        }
        if (request.method === 'GET' && sub === '/channel') {
          const owner = rq.get('owner') || ''; if (!SNOW.test(owner)) { sendJson(response, 400, { ok: false, error: 'invalid_user' }); return; }
          const r = await tradingRoom.channelContent(me, owner, rq.get('channel') || '', { since: rq.get('since') || 0, limit: rq.get('limit') || 60 }); sendJson(response, status(r), r); return;
        }
        if (request.method === 'GET' && sub === '/members') {
          const r = await tradingRoom.members(me, { limit: rq.get('limit') || 100 }); sendJson(response, 200, r); return;
        }
        if (request.method === 'POST') {
          const b = await readBody(sub === '/settings' ? 65_536 : 4096); if (!b) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
          const owner = String(b.owner || ''), ownerOnly = () => { if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return true; } return false; };
          if (sub === '/post') {
            if (!SNOW.test(owner)) { sendJson(response, 400, { ok: false, error: 'invalid_user' }); return; }
            const gate = academyDataLimit.take(request); if (!gate.ok) { response.setHeader('retry-after', String(gate.retryAfterSec)); sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
            const r = await tradingRoom.post(me, owner, String(b.channel || ''), { body: b.body }); sendJson(response, status(r), r); return;
          }
          if (sub === '/delete') { const r = await tradingRoom.removePost(me, owner, String(b.id || '')); sendJson(response, status(r), r); return; }
          if (sub === '/pin') { const r = await tradingRoom.pinPost(me, owner, String(b.id || ''), b.on !== false); sendJson(response, status(r), r); return; }
          if (sub === '/follow') {
            if (!SNOW.test(owner) || !traderAlerts) { sendJson(response, 400, { ok: false, error: 'invalid_user' }); return; }
            const r = await traderAlerts.follow(me, owner, { on: b.on !== false, push: typeof b.push === 'boolean' ? b.push : null }); sendJson(response, r.ok ? 200 : 400, r); return;
          }
          if (sub === '/settings') { if (ownerOnly()) return; const r = await tradingRoom.save(me, b.room && typeof b.room === 'object' ? b.room : {}); sendJson(response, r.ok ? 200 : 400, r); return; }
          if (sub === '/template') { if (ownerOnly()) return; const r = await tradingRoom.applyTemplate(me, String(b.key || '')); sendJson(response, r.ok ? 200 : 400, r); return; }
          if (sub === '/ban') { if (ownerOnly()) return; const r = await tradingRoom.setBan(me, String(b.member || ''), b.on !== false); sendJson(response, r.ok ? 200 : 400, r); return; }
          if (sub === '/checkout') {
            const plan = String(b.plan || ''), tierId = String(b.tier || '');
            if (!SNOW.test(owner) || !tierId || !(traderAlerts && plan in traderAlerts.PLANS)) { sendJson(response, 400, { ok: false, error: 'invalid_request' }); return; }
            const start = traderAlertsCheckout || (alertChartBilling && alertChartBilling.configured ? (i) => alertChartBilling.checkout(i) : null);
            if (!start) { sendJson(response, 503, { ok: false, error: 'checkout_unavailable' }); return; }
            const gate = academyDataLimit.take(request); if (!gate.ok) { sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
            const r = await start({ memberId: me, traderId: owner, plan, tier: tierId });
            sendJson(response, r && r.ok ? 200 : r && (r.error === 'plan_not_offered' || r.error === 'not_premium' || r.error === 'own_chart' || r.error === 'invalid_plan' || r.error === 'seller_not_ready') ? 400 : 503, r || { ok: false, error: 'checkout_unavailable' }); return;
          }
        }
        sendJson(response, 404, { ok: false, error: 'not_found' }); return;
      } catch (error) { logger('error', 'academy_room_failed', { error: String((error && error.message) || error) }); sendJson(response, 503, { ok: false, error: 'temporary_unavailable' }); return; }
    }
    if (path === '/academy-activity/presence' || path === '/academy-activity/profiles' || path.startsWith('/academy-activity/profiles/')) {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      if (!academyProfilePages) { sendJson(response, 503, { ok: false, error: 'profiles_disabled' }); return; }
      const pq = new URL(request.url || '/', 'http://localhost').searchParams;
      // <audio> and <img> cannot send a header, so the song and link-image routes take the session token as ?t=
      const authz = request.headers.authorization || ((path.endsWith('/audio') || path.endsWith('/link-image')) && pq.get('t') ? 'Bearer ' + pq.get('t') : '');
      const session = academyOAuth.verifySession(authz);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      const SNOW = /^\d{15,25}$/;
      const readBody = async (max = 16_384) => { const raw = await readRequestBody(request, max).catch(() => null); try { return raw && raw.ok ? JSON.parse(raw.rawBody || '{}') : null; } catch (_) { return null; } };
      try {
        if (request.method === 'POST' && path === '/academy-activity/presence') { const b = await readBody(512); sendJson(response, 200, await academyProfilePages.beat(session.userId, b && b.guildId)); return; }
        if (request.method === 'GET' && path === '/academy-activity/profiles/link-image') {
          const img = await academyProfilePages.linkImage(pq.get('u') || '');
          if (!img) { response.writeHead(404); response.end(); return; }
          response.writeHead(200, { 'content-type': img.contentType, 'content-length': img.bytes.length, 'cache-control': 'private, max-age=21600', 'x-content-type-options': 'nosniff' }); response.end(img.bytes); return;
        }
        if (request.method === 'GET' && path === '/academy-activity/profiles/card') {
          const card = await academyProfilePages.card(pq.get('user') || '', session.userId);
          if (!card) { sendJson(response, 404, { ok: false, error: 'not_found' }); return; }
          sendJson(response, 200, { ok: true, card }); return;
        }
        if (request.method === 'GET' && path === '/academy-activity/profiles/leaderboard') { sendJson(response, 200, { ok: true, rows: await academyProfilePages.leaderboard(Math.min(100, Number(pq.get('limit')) || 25)) }); return; }
        if (request.method === 'POST' && path === '/academy-activity/profiles/orbit-image') {
          const b = await readBody(2048); if (!b || typeof b !== 'object') { sendJson(response, 400, { ok: false, error: 'invalid_body' }); return; }
          const r = await academyProfilePages.registerImage(b.url, session.userId); sendJson(response, r.ok ? 200 : 400, r); return;
        }
        if (request.method === 'POST' && path === '/academy-activity/profiles/audio-upload') {
          /* a song file from the member's own device: raw bytes in the body, checked by its first bytes, kept for them */
          const limit = PROFILE_UPLOAD_MAX;
          const declared = Number(request.headers['content-length']);
          if (Number.isFinite(declared) && declared > limit) { sendJson(response, 413, { ok: false, error: 'file_too_large' }); request.resume(); return; }
          const chunks = []; let size = 0, tooBig = false;
          await new Promise((resolve, reject) => {
            request.on('data', (c) => { size += c.length; if (size > limit) { tooBig = true; request.pause(); resolve(); } else chunks.push(c); });
            request.once('end', resolve); request.once('error', reject);
          });
          if (tooBig) { sendJson(response, 413, { ok: false, error: 'file_too_large' }); return; }
          const r = await academyProfilePages.uploadAudio(session.userId, Buffer.concat(chunks), pq.get('title') || '');
          sendJson(response, r.ok ? 200 : (r.error === 'file_too_large' ? 413 : r.error === 'storage_failed' ? 503 : 400), r); return;
        }
        if (request.method === 'PUT' && path === '/academy-activity/profiles/me') {
          const b = await readBody(32_768); if (!b || typeof b !== 'object') { sendJson(response, 400, { ok: false, error: 'invalid_body' }); return; }
          sendJson(response, 200, await academyProfilePages.save(session.userId, b)); return;
        }
        const m = /^\/academy-activity\/profiles\/(\d{15,25})(?:\/(follow|audio|wall)(?:\/(\d+))?)?$/.exec(path);
        if (!m) { sendJson(response, 404, { ok: false, error: 'not_found' }); return; }
        const who = m[1];
        if (m[2] === 'wall') {
          /* Trading Wall: read it, post on it, or remove a comment (its author, the wall's owner, or an Academy owner) */
          if (!academyProfileWall) { sendJson(response, 503, { ok: false, error: 'wall_disabled' }); return; }
          if (request.method === 'GET' && !m[3]) { sendJson(response, 200, { ok: true, ...(await academyProfileWall.list(who, { limit: pq.get('limit') || 20, before: pq.get('before') || '' })) }); return; }
          if (request.method === 'POST' && !m[3]) {
            const b = await readBody(4096); if (!b || typeof b !== 'object') { sendJson(response, 400, { ok: false, error: 'invalid_body' }); return; }
            const target = await academyProfilePages.settingsOf(who);
            if (target.flags && target.flags.showWall === false) { sendJson(response, 403, { ok: false, error: 'wall_closed' }); return; }
            const mine = await academyProfilePages.settingsOf(session.userId);
            let name = mine.displayName || '';
            if (!name && academyProfiles) { try { const c = await academyProfiles.profile(session.userId); name = c && c.discord ? (c.discord.name || c.discord.username || '') : ''; } catch (_) { name = ''; } }
            const r = await academyProfileWall.post(who, session.userId, name, b.body);
            if (r.ok && r.item && !r.duplicate && academySocialNotify) academySocialNotify.wallComment(who, r.item).catch(() => {});
            sendJson(response, r.ok ? 200 : (r.error === 'slow_down' || r.error === 'too_many_today' ? 429 : 400), r); return;
          }
          if (request.method === 'DELETE' && m[3]) {
            const elevated = String(session.userId) === who || OWNER_IDS.includes(String(session.userId));
            const r = await academyProfileWall.remove(m[3], session.userId, { profileId: who, elevated });
            sendJson(response, r.ok ? 200 : (r.error === 'forbidden' ? 403 : r.error === 'not_found' ? 404 : 400), r); return;
          }
          sendJson(response, 405, { ok: false, error: 'method_not_allowed' }); return;
        }
        if (m[2] === 'follow') {
          if (request.method !== 'POST' && request.method !== 'DELETE') { sendJson(response, 405, { ok: false, error: 'method_not_allowed' }); return; }
          const r = await academyProfilePages.follow(session.userId, who, request.method === 'POST');
          if (r.ok && request.method === 'POST' && academySocialNotify) academySocialNotify.follow(String(session.userId), who, session.displayName || '').catch(() => {});
          sendJson(response, r.ok ? 200 : 400, r); return;
        }
        if (m[2] === 'audio') {
          const settings = await academyProfilePages.settingsOf(who);
          const stream = settings.song && settings.song.kind === 'audio' ? await academyProfilePages.audioStream(settings.song.url, who) : null;
          if (!stream || (!stream.body && !stream.buffer)) { response.writeHead(404); response.end(); return; }
          if (stream.buffer) {
            const buf = stream.buffer, total = buf.length, rg = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.range || ''));
            const base = { 'content-type': stream.contentType, 'cache-control': 'private, no-cache', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff' };
            if (rg && (rg[1] || rg[2])) {
              let from = rg[1] === '' ? Math.max(0, total - Number(rg[2])) : Number(rg[1]), to = rg[1] === '' || rg[2] === '' ? total - 1 : Math.min(total - 1, Number(rg[2]));
              if (from > to || from >= total) { response.writeHead(416, { 'content-range': 'bytes */' + total }); response.end(); return; }
              response.writeHead(206, { ...base, 'content-range': 'bytes ' + from + '-' + to + '/' + total, 'content-length': to - from + 1 }); response.end(buf.subarray(from, to + 1)); return;
            }
            response.writeHead(200, { ...base, 'content-length': total }); response.end(buf); return;
          }
          const headers = { 'content-type': stream.contentType, 'cache-control': 'private, max-age=3600', 'accept-ranges': 'none', 'x-content-type-options': 'nosniff' };
          if (stream.length) headers['content-length'] = stream.length;
          response.writeHead(200, headers);
          const { Readable } = require('node:stream');
          Readable.fromWeb(stream.body).on('error', () => { try { response.end(); } catch (_) { /* closed */ } }).pipe(response); return;
        }
        if (request.method === 'GET') {
          const page = await academyProfilePages.page(who, session.userId);
          if (!page) { sendJson(response, 404, { ok: false, error: 'not_found' }); return; }
          if (academyProfiles) { try { const c = await academyProfiles.profile(who); page.discordName = c && c.discord ? (c.discord.name || c.discord.username || '') : ''; } catch (_) { page.discordName = ''; } }
          sendJson(response, 200, { ok: true, profile: page }); return;
        }
        sendJson(response, 405, { ok: false, error: 'method_not_allowed' });
      } catch (error) { logger('error', 'academy_profile_pages_failed', { error }); sendJson(response, 503, { ok: false, error: 'profiles_unavailable' }); }
      return;
    }
    if (request.method === 'GET' && (path === '/academy-activity/profile' || path === '/academy-activity/avatar')) {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      /* the avatar is an <img>: it cannot send a header, so it may carry the session token as ?t= */
      const avq = new URL(request.url || '/', 'http://localhost').searchParams;
      const session = academyOAuth.verifySession(request.headers.authorization || (path === '/academy-activity/avatar' && avq.get('t') ? 'Bearer ' + avq.get('t') : ''));
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (!academyProfiles) { sendJson(response, 503, { ok: false, error: 'profiles_disabled' }); return; }
      const who = avq.get('user') || '';
      try {
        if (path === '/academy-activity/profile') {
          const card = await academyProfiles.profile(who);
          if (!card) { sendJson(response, 404, { ok: false, error: 'not_found' }); return; }
          sendJson(response, 200, { ok: true, card }); return;
        }
        const image = await academyProfiles.avatar(who);
        if (!image) { sendJson(response, 404, { ok: false, error: 'not_found' }); return; }
        response.writeHead(200, { 'content-type': image.contentType, 'content-length': image.bytes.length, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' });
        response.end(image.bytes); return;
      } catch (error) {
        logger('error', 'academy_profile_failed', { error });
        sendJson(response, 503, { ok: false, error: 'temporarily_unavailable' }); return;
      }
    }

    /* MEM LAB operator routes (champion/challenger state). Needs ACADEMY_MEM_LAB_TOKEN as a Bearer token; promoting a challenger is always an explicit POST. */
    if (path.startsWith('/academy-activity/mem-lab/') && ['/academy-activity/mem-lab/report', '/academy-activity/mem-lab/approve', '/academy-activity/mem-lab/run'].includes(path)) {
      const want = String(process.env.ACADEMY_MEM_LAB_TOKEN || ''), got = String(request.headers.authorization || '').replace(/^Bearer /, '');
      const okToken = want.length >= 16 && got.length === want.length && require('crypto').timingSafeEqual(Buffer.from(got), Buffer.from(want));
      if (!okToken) { sendJson(response, 401, { ok: false, error: 'unauthorized' }); return; }
      if (!academyMemLab) { sendJson(response, 503, { ok: false, error: 'mem_lab_disabled' }); return; }
      try {
        if (request.method === 'GET' && path.endsWith('/report')) { sendJson(response, 200, { ok: true, ...(await academyMemLab.report()) }); return; }
        if (request.method === 'POST' && path.endsWith('/approve')) { const c = await academyMemLab.approve(); sendJson(response, c ? 200 : 404, { ok: !!c, champion: c }); return; }
        if (request.method === 'POST' && path.endsWith('/run')) { sendJson(response, 200, { ok: true, run: await academyMemLab.cycle() }); return; }
        sendJson(response, 405, { ok: false, error: 'method_not_allowed' }); return;
      } catch (error) { logger('error', 'academy_mem_lab_failed', { error }); sendJson(response, 503, { ok: false, error: 'temporarily_unavailable' }); return; }
    }

    /* Loop Bucks passes. The caller is a signed-in session, or (a member the role check turned away) the buy ticket from the refused sign-in in the x-academy-ticket header. */
    if (path.startsWith('/academy-activity/passes/') && ['/academy-activity/passes/status', '/academy-activity/passes/buy'].includes(path)) {
      const wantsAlert = new URL(request.url || '/', 'http://localhost').searchParams.get('product') === 'click_alert';
      const passSvc = wantsAlert ? academyClickAlertPasses : academyPasses;
      if (!passSvc || !passSvc.configured) { sendJson(response, 503, { ok: false, error: 'passes_not_configured' }); return; }
      let holder = null;
      if (academyOAuth) {
        const s = academyOAuth.verifySession(request.headers.authorization);
        if (s.ok) holder = { userId: s.userId };
        else if (typeof academyOAuth.verifyBuyTicket === 'function') holder = academyOAuth.verifyBuyTicket(request.headers['x-academy-ticket']);
      }
      if (!holder) { sendJson(response, 401, { ok: false, error: 'authorization_required' }); return; }
      try {
        if (request.method === 'GET' && path.endsWith('/status')) {
          const r = await passSvc.status(holder.userId);
          sendJson(response, r.ok ? 200 : (r.status || 503), r.ok ? r : { ok: false, error: r.code }); return;
        }
        if (request.method === 'POST' && path.endsWith('/buy')) {
          if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
          const body = await readRequestBody(request, 2048);
          if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
          let input; try { input = JSON.parse(body.rawBody); } catch (_) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
          const r = await passSvc.buy({ discordId: holder.userId, plan: String((input && input.plan) || ''), orderKey: String((input && input.orderKey) || '') });
          if (!r.ok) { sendJson(response, r.status || 400, { ok: false, error: r.code, ...(r.url ? { url: r.url } : {}), ...(r.balance != null ? { balance: r.balance, needed: r.needed } : {}) }); return; }
          sendJson(response, 200, { ok: true, pass: r.pass, balance: r.balance, duplicate: !!r.duplicate }); return;
        }
        sendJson(response, 405, { ok: false, error: 'method_not_allowed' });
      } catch (error) {
        logger('error', 'academy_passes_failed', { error });
        sendJson(response, 503, { ok: false, error: 'temporarily_unavailable' });
      }
      return;
    }
    if (request.method === 'GET' && path === '/academy-activity/passes/catalog') {
      sendJson(response, 200, { ok: true, configured: !!(academyPasses && academyPasses.configured), catalog: academyPasses && academyPasses.configured ? academyPasses.catalog() : [] }); return;
    }

    /* Quick Snapshot: post the chart as the member sees it to a channel they (and the Academy app) can post and attach in. */
    if (path.startsWith('/academy-activity/snapshot/') && ['/academy-activity/snapshot/status', '/academy-activity/snapshot/channels', '/academy-activity/snapshot/send'].includes(path)) {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (!academySnapshot) { sendJson(response, 503, { ok: false, error: 'snapshot_disabled' }); return; }
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      try {
        if (request.method === 'GET' && path === '/academy-activity/snapshot/status') { sendJson(response, 200, { ok: true, guilds: await academySnapshot.destinations(session.userId, params.get('current') || '') }); return; }
        if (request.method === 'GET' && path === '/academy-activity/snapshot/channels') {
          const channels = await academySnapshot.channels(session.userId, params.get('guild'));
          if (!channels) { sendJson(response, 404, { ok: false, error: 'server_unavailable' }); return; }
          sendJson(response, 200, { ok: true, channels }); return;
        }
        if (request.method === 'POST' && path === '/academy-activity/snapshot/send') {
          if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
          const body = await readRequestBody(request, 3_600_000);
          if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
          let input; try { input = JSON.parse(body.rawBody); } catch (_) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
          const m = input && typeof input.image === 'string' ? /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(input.image) : null;
          if (!m) { sendJson(response, 422, { ok: false, error: 'invalid_image', detail: 'The snapshot must be a PNG chart image under 2.5 MB.' }); return; }
          const out = await academySnapshot.send({ userId: session.userId, displayName: session.displayName }, { channelId: input.channelId, png: Buffer.from(m[1], 'base64'), symbol: input.symbol, tf: input.tf, note: input.note });
          if (!out.ok) { sendJson(response, out.status || 400, { ok: false, error: out.code, ...(out.detail ? { detail: out.detail } : {}) }); return; }
          sendJson(response, 200, out); return;
        }
        sendJson(response, 405, { ok: false, error: 'method_not_allowed' });
      } catch (error) {
        logger('error', 'academy_snapshot_failed', { error });
        sendJson(response, 503, { ok: false, error: 'temporarily_unavailable' });
      }
      return;
    }

    /* Click-to-Alert (a separate paid add-on, checked live against a Discord role): the member clicks a price on the chart, the Academy's data picks the horizon
       (day / swing / mid / long), and the alert is posted to a channel the member can post in, in GrandMaster-Obi's layout. */
    /* The alerts desk's two buttons: New PT (a PT SMASHED post with a higher target) and Sell (TAKE PROFITS), posted to the alert's own
       channel as a reply to the newest post on that stock. The member's own alerts, or any alert for the owner. */
    if (request.method === 'POST' && path === '/academy-activity/click-alert/desk') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (!academyClickAlert || typeof academyClickAlert.deskAction !== 'function' || !academyAlerts) { sendJson(response, 503, { ok: false, error: 'click_alert_disabled' }); return; }
      if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
      const body = await readRequestBody(request, 2048);
      if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
      let input; try { input = JSON.parse(body.rawBody); } catch (_) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
      if (!input || typeof input !== 'object') { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
      const action = input.action === 'sell' ? 'sell' : input.action === 'pt' ? 'pt' : input.action === 'move' ? 'move' : '';
      const alertId = String(input.alertId || '').replace(/[^0-9]/g, '').slice(0, 24);
      if (!action || !alertId) { sendJson(response, 400, { ok: false, error: 'invalid_action' }); return; }
      try {
        const rec = academyAlerts.alerts && typeof academyAlerts.alerts.get === 'function' ? academyAlerts.alerts.get(alertId) : null;
        if (!rec) { sendJson(response, 404, { ok: false, error: 'alert_not_found' }); return; }
        const owner = OWNER_IDS.includes(String(session.userId));
        if (!owner && String(rec.authorId || '') !== String(session.userId)) { sendJson(response, 403, { ok: false, error: 'not_your_alert', detail: 'Only the trader who posted an alert can update it.' }); return; }
        const ev = academyAlerts.evaluated && typeof academyAlerts.evaluated.get === 'function' ? academyAlerts.evaluated.get(alertId) : null;
        const ladderLast = ev && ev.ladder && Array.isArray(ev.ladder.updates) && ev.ladder.updates.length ? ev.ladder.updates[ev.ladder.updates.length - 1] : null;
        const alert = { id: rec.id, symbol: rec.symbol, entry: rec.entry, target: rec.target, currentTarget: ladderLast && Number(ladderLast.target) > 0 ? Number(ladderLast.target) : rec.target, at: rec.at, channelId: academyAlerts.channelIdFor ? academyAlerts.channelIdFor(rec.source) : '', plan: ev && ev.plan ? { action: ev.plan.action, target: ev.plan.target, stop: ev.plan.stop, reasons: ev.plan.reasons } : null };
        const out = await academyClickAlert.deskAction({ userId: session.userId, displayName: session.displayName }, { alert, action, target: input.target, mention: input.mention, asMe: input.asMe !== false });
        if (!out.ok) { sendJson(response, out.status || 400, { ok: false, error: out.code, ...(out.detail ? { detail: out.detail } : {}) }); return; }
        if (academyAlertSources && typeof academyAlertSources.followOwn === 'function') void academyAlertSources.followOwn(session.userId, alert.channelId, session.displayName);
        logger('info', 'academy_desk_action', { action, symbol: alert.symbol, repliedTo: out.repliedTo || null });
        sendJson(response, 200, out);
      } catch (error) {
        logger('error', 'academy_desk_action_failed', { error });
        sendJson(response, error && error.status === 429 ? 429 : 503, { ok: false, error: 'temporarily_unavailable' });
      }
      return;
    }
    if (path.startsWith('/academy-activity/click-alert/') && ['/academy-activity/click-alert/warm', '/academy-activity/click-alert/status', '/academy-activity/click-alert/channels', '/academy-activity/click-alert/chain', '/academy-activity/click-alert/preview', '/academy-activity/click-alert/send'].includes(path)) {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (!academyClickAlert) { sendJson(response, 503, { ok: false, error: 'click_alert_disabled' }); return; }
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      const fail = (out) => sendJson(response, out.status || 400, { ok: false, error: out.code, ...(out.detail ? { detail: out.detail } : {}), ...(out.entitlement ? { entitlement: out.entitlement } : {}) });
      try {
        /* the member just picked a ticker or armed ALERT: load what the next read needs so it finds it ready (never waits for it) */
        if (request.method === 'GET' && path === '/academy-activity/click-alert/warm') {
          sendJson(response, 200, { ok: true, warming: academyClickAlert.warm(params.get('symbol') || '', session.userId) }); return;
        }
        if (request.method === 'GET' && path === '/academy-activity/click-alert/status') {
          /* the subscription check and the server list are asked at the same moment; the list is dropped for a member who is not subscribed */
          const [entitlement, listed] = await Promise.all([academyClickAlert.entitlement(session.userId), academyClickAlert.destinations(session.userId, params.get('current') || '').catch(() => [])]);
          sendJson(response, 200, { ok: true, ...entitlement, guilds: entitlement.entitled ? listed : [] }); return;
        }
        if (request.method === 'GET' && path === '/academy-activity/click-alert/channels') {
          const entitlement = await academyClickAlert.entitlement(session.userId);
          if (!entitlement.entitled) { sendJson(response, 402, { ok: false, error: 'click_alert_subscription_required' }); return; }
          const channels = await academyClickAlert.channels(session.userId, params.get('guild'), { kind: ['stock', 'option'].includes(params.get('kind')) ? params.get('kind') : '', symbol: params.get('symbol') || '', horizon: ['day', 'swing', 'mid', 'long'].includes(params.get('horizon')) ? params.get('horizon') : '' });
          if (!channels) { sendJson(response, 404, { ok: false, error: 'server_unavailable' }); return; }
          sendJson(response, 200, { ok: true, channels }); return;
        }
        /* the contract picker on the ALERT panel: expirations, then strikes with live call/put quotes for one expiration */
        if (request.method === 'GET' && path === '/academy-activity/click-alert/chain') {
          const entitlement = await academyClickAlert.entitlement(session.userId);
          if (!entitlement.entitled) { sendJson(response, 402, { ok: false, error: 'click_alert_subscription_required' }); return; }
          const out = await academyClickAlert.chainFor({ symbol: params.get('symbol'), expiry: params.get('expiry') || '' });
          if (!out.ok) { fail(out); return; }
          sendJson(response, 200, out); return;
        }
        if (request.method === 'POST') {
          if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
          const body = await readRequestBody(request, 2048);
          if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
          let input; try { input = JSON.parse(body.rawBody); } catch (_) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
          if (!input || typeof input !== 'object') { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
          const out = path.endsWith('/preview') ? await academyClickAlert.preview(session.userId, input) : Array.isArray(input.channelIds) && input.channelIds.length ? await academyClickAlert.sendMany({ userId: session.userId, displayName: session.displayName }, input) : await academyClickAlert.send({ userId: session.userId, displayName: session.displayName }, input);
          if (!out.ok) { fail(out); return; }
          // the member's own alerts in that channel now belong on their desk (their bot's posts are attributed to them); never awaited
          if (path.endsWith('/send') && academyAlertSources && typeof academyAlertSources.followOwn === 'function') for (const cid of (Array.isArray(input.channelIds) && input.channelIds.length ? input.channelIds : [input.channelId]).slice(0, 5)) void academyAlertSources.followOwn(session.userId, cid, session.displayName);
          sendJson(response, 200, out); return;
        }
        sendJson(response, 405, { ok: false, error: 'method_not_allowed' });
      } catch (error) {
        logger('error', 'academy_click_alert_failed', { error });
        sendJson(response, error && error.status === 429 ? 429 : 503, { ok: false, error: 'temporarily_unavailable' });
      }
      return;
    }

    /* The alerts desk: the trader's posted alerts with risk grade, checklist and plan. Members only (the same Academy session as the options chain). */
    if (request.method === 'GET' && path === '/academy-activity/alerts') {
      const deskServedLog = (userId, snap) => {
        const k = String(userId), t = Date.now();
        if ((deskServedAt.get(k) || 0) > t - 60_000) return;
        deskServedAt.set(k, t); if (deskServedAt.size > 500) deskServedAt.delete(deskServedAt.keys().next().value);
        const list = Array.isArray(snap && snap.alerts) ? snap.alerts : [];
        logger('info', 'academy_desk_served', { userId: k, alerts: list.length, withPt: list.filter((a) => a.ptUpdates && a.ptUpdates.length).map((a) => a.symbol + ' ' + a.id + ' ' + a.ptUpdates.length), symbols: list.slice(0, 30).map((a) => a.symbol) });
      };
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (!academyAlerts) { sendJson(response, 503, { ok: false, error: 'alerts_disabled' }); return; }
      const id = new URL(request.url || '/', 'http://localhost').searchParams.get('detail');
      /* A 'free' session sees how many alerts there are, never the alerts. With
         SML_ACADEMY_ALERTS_TIERING an 'academy' session sees closed alerts only
         (case studies). Members see the live desk, as before. */
      const alertView = session.tier === 'free' ? 'teaser' : (session.tier === 'academy' && academyGate && academyGate.alertsTiering ? 'closed' : 'live');
      /* Per-member desk: only the member's own sources. The owner's streams keep the tiering above; any other channel shows live because the
         member can already read it in Discord (checked again here), and a channel they lost access to shows nothing. */
      if (academyAlertSources) {
        try {
          const sources = (await academyAlertSources.viewFor(session.userId, alertView)).filter((s) => s.access);
          if (id) {
            const alertId = String(id).replace(/[^0-9]/g, '').slice(0, 24);
            const src = academyAlerts.allows(alertId, sources);
            if (!src || src.view === 'teaser') { sendJson(response, src ? 403 : 404, { ok: false, error: src ? 'academy_access_required' : 'alert_not_found' }); return; }
            const one = await academyAlerts.detail(alertId, { closedOnly: src.view === 'closed' });
            if (!one) { sendJson(response, 404, { ok: false, error: 'alert_not_found' }); return; }
            sendJson(response, 200, { ok: true, alert: one });
          } else {
            const snap = academyAlerts.snapshot({ sources });
            deskServedLog(session.userId, snap);
            sendJson(response, 200, { ...snap, sources: sources.length, perMember: true, me: { userId: String(session.userId), owner: OWNER_IDS.includes(String(session.userId)) } });
          }
        } catch (error) { logger('error', 'academy_alerts_request_failed', { error }); sendJson(response, 503, { ok: false, error: 'alerts_temporarily_unavailable' }); }
        return;
      }
      try {
        if (id) {
          if (alertView === 'teaser') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
          const alertId = String(id).replace(/[^0-9]/g, '').slice(0, 24);
          const one = alertView === 'closed' ? await academyAlerts.detail(alertId, { closedOnly: true }) : await academyAlerts.detail(alertId);
          if (!one) { sendJson(response, 404, { ok: false, error: 'alert_not_found' }); return; }
          sendJson(response, 200, { ok: true, alert: one });
        } else sendJson(response, 200, { ...(alertView === 'live' ? academyAlerts.snapshot() : academyAlerts.snapshot({ view: alertView })), me: { userId: String(session.userId), owner: OWNER_IDS.includes(String(session.userId)) } });
      } catch (error) { logger('error', 'academy_alerts_request_failed', { error }); sendJson(response, 503, { ok: false, error: 'alerts_temporarily_unavailable' }); }
      return;
    }

    /* Tick-by-tick view: newest book levels and individual prints, polled by the Activity about once a second. Read-only, never cached. */
    /* Dark pool, session-wide: off-exchange prints from the Massive trade record (the live tape only knows prints since this server
       started watching the symbol). Cached a minute per symbol. */
    if (request.method === 'GET' && path === '/academy-activity/dark-pool') {
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      const sym = String(params.get('symbol') || '').toUpperCase();
      if (!allowGatedSymbol(request, response, sym)) return;
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      if (!marketHistory || !marketHistory.enabled) { sendJson(response, 503, { ok: false, error: 'trade_record_unavailable', detail: 'The trade record is not configured on this server.' }); return; }
      const hit = darkPoolCache.get(sym);
      if (hit && hit.until > Date.now()) { sendJson(response, 200, hit.payload); return; }
      try {
        if (academyMassive && typeof academyMassive.watch === 'function') academyMassive.watch(sym);
        const rows = await marketHistory.trades(sym, 50_000);
        const live = academyMassive && typeof academyMassive.peek === 'function' ? academyMassive.peek(sym) : null;
        const st = marketState();
        // today's 09:30 ET as a timestamp: the ET wall clock the market clock reports, shifted by the current ET offset
        let openMs = null;
        try { const et = String(st.et || ''); const asUtc = Date.parse(et.replace(' ', 'T') + ':00Z'); if (Number.isFinite(asUtc)) { const offset = Math.round((Date.now() - asUtc) / 60_000) * 60_000; openMs = Date.parse(et.slice(0, 10) + 'T09:30:00Z') + offset; } } catch (_) { openMs = null; }
        let summary = sessionDarkPool(rows, { price: live && Number(live.last) > 0 ? Number(live.last) : null, now: Date.now(), sessionOpenMs: openMs });
        // the plain-English read (academy-dark-pool-read.js) against the symbol's earlier sessions; today's footprint is remembered for tomorrow
        if (darkPoolMemory && summary.available) { try { summary = await darkPoolMemory.annotate(sym, summary, { date: String(st.et || '').slice(0, 10), price: live && Number(live.last) > 0 ? Number(live.last) : null, sinceMs: etDayStartMs(st) }); } catch (error) { logger('warn', 'academy_dark_pool_read_failed', { symbol: sym, error: String(error && error.message || error) }); } }
        const payload = { ok: true, symbol: sym, session: st.session, ...summary };
        if (!rows.length) payload.detail = st.session === 'closed' && !st.tradingDay ? 'No trades today (market closed).' : 'The trade record returned no prints for this symbol yet.';
        darkPoolCache.set(sym, { until: Date.now() + (rows.length ? 60_000 : 20_000), payload });
        if (darkPoolCache.size > 300) darkPoolCache.delete(darkPoolCache.keys().next().value);
        sendJson(response, 200, payload);
      } catch (error) {
        logger('warn', 'academy_dark_pool_failed', { symbol: sym, error: String(error && error.message || error) });
        sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
      }
      return;
    }
    if (request.method === 'GET' && path === '/academy-activity/live') {
      if (!academyOrderFlow) { sendJson(response, 503, { ok: false, error: 'orderflow_disabled' }); return; }
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      if (!allowGatedSymbol(request, response, params.get('symbol'))) return;
      try { sendJson(response, 200, mergeLive(academyOrderFlow.live(params.get('symbol')), academyMassive, params.get('symbol'))); }
      catch (error) { sendJson(response, error instanceof TypeError ? 400 : 503, { ok: false, error: error instanceof TypeError ? 'invalid_symbol' : 'temporary_unavailable' }); }
      return;
    }

    /* Real-time push of every trade and quote for one symbol (Server-Sent Events) from the shared Massive connection. The polled /live above stays as the fallback. */
    /* Market Direction for the Academy (any signed-in Academy session). */
    if (request.method === 'GET' && path === '/academy-activity/direction') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (!marketDirection) { sendJson(response, 503, { ok: false, error: 'direction_unavailable' }); return; }
      const mode = new URL(request.url || '/', 'http://localhost').searchParams.get('mode') === 'swing' ? 'swing' : 'day';
      try { sendJson(response, 200, await marketDirection.get(mode)); }
      catch (error) { logger('error', 'market_direction_failed', { error }); sendJson(response, 503, { ok: false, error: 'direction_temporarily_unavailable' }); }
      return;
    }
    /* SML VIX (any signed-in Academy session): the level, its move since today's 9:30 open and the readings this server has taken today. */
    if (request.method === 'GET' && path === '/academy-activity/vix') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (!academySmlVix) { sendJson(response, 503, { ok: false, error: 'vix_unavailable' }); return; }
      try {
        const v = await academySmlVix.get();
        const et = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
        const mins = (Number(et.find((p) => p.type === 'hour').value) % 24) * 60 + Number(et.find((p) => p.type === 'minute').value);
        const openMs = Date.now() - (mins - 570) * 60_000;
        const hist = academySmlVix.history().filter((h) => Date.now() - h.t < 18 * 3600_000);
        sendJson(response, v && v.ok ? 200 : 503, { ...(v || { ok: false }), change: mins >= 570 ? academySmlVix.changeSince(openMs) : null, history: hist.slice(-240) });
      } catch (error) { logger('error', 'sml_vix_failed', { error }); sendJson(response, 503, { ok: false, error: 'vix_unavailable' }); }
      return;
    }
    /* Unusual volume across the whole market (any signed-in Academy session). */
    /* Push notifications: the public key, subscribe / unsubscribe (Academy session), a test message to the member's own devices,
       and the service worker, icon and manifest (public, no member data). */
    if (request.method === 'GET' && path === '/academy-activity/push-sw.js') {
      response.writeHead(ACADEMY_PUSH_SW ? 200 : 404, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/academy-activity/' });
      response.end(ACADEMY_PUSH_SW); return;
    }
    if (request.method === 'GET' && (path === '/academy-activity/push-icon-192.png' || path === '/academy-activity/push-icon-512.png')) {
      const png = academyIconPng(path.includes('512') ? 512 : 192);
      if (!png) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }); response.end(png); return;
    }
    if (request.method === 'GET' && path === '/academy-activity/desk.webmanifest') {
      response.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' }); response.end(ACADEMY_DESK_MANIFEST); return;
    }
    if (request.method === 'GET' && path === '/academy-activity/manifest.webmanifest') {
      response.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' }); response.end(ACADEMY_MANIFEST); return;
    }
    if (path.startsWith('/academy-activity/push/')) {
      if (!academyOAuth || !academyPush) { sendJson(response, 503, { ok: false, error: 'push_unavailable' }); return; }
      if (request.method === 'GET' && path === '/academy-activity/push/key') {
        const key = await academyPush.publicKey().catch(() => null);
        sendJson(response, key ? 200 : 503, key ? { ok: true, publicKey: key } : { ok: false, error: 'push_unavailable' }); return;
      }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (request.method === 'GET' && path === '/academy-activity/push/status') { sendJson(response, 200, { ok: true, devices: await academyPush.count(session.userId) }); return; }
      if (request.method !== 'POST') { sendJson(response, 405, { ok: false, error: 'method_not_allowed' }); return; }
      if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
      const body = await readRequestBody(request, 4096);
      if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
      let input = {}; try { input = JSON.parse(body.rawBody) || {}; } catch (_) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
      if (path === '/academy-activity/push/subscribe') { const r = await academyPush.subscribe(session.userId, input.subscription || {}, { ua: request.headers['user-agent'] }); sendJson(response, r.ok ? 200 : 400, r); return; }
      if (path === '/academy-activity/push/unsubscribe') { sendJson(response, 200, await academyPush.unsubscribe(session.userId, String(input.endpoint || ''))); return; }
      if (path === '/academy-activity/push/test') {
        const r = await academyPush.sendTo(async (u) => u === String(session.userId), { kind: 'test', title: '🔔 Push alerts are on', body: 'You will get a notification here every time a new price target is set on an alert you follow.', tag: 'sml-push-test', url: '/academy-activity/' }, { urgency: 'normal', ttl: 600 });
        sendJson(response, 200, { ok: true, sent: r.sent }); return;
      }
      sendJson(response, 404, { ok: false, error: 'not_found' }); return;
    }
    /* Signal radar (academy-signal-radar.js): MEM ALGO buy signals across the market, with 10-15% targets. The owner's desk only. */
    if (request.method === 'GET' && path === '/academy-activity/signals') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (!academySignals || !academySignals.allowed(session.userId)) { sendJson(response, 403, { ok: false, error: 'owner_only' }); return; }
      const q = new URL(request.url || '/', 'http://localhost').searchParams;
      const since = Math.max(Date.now() - 7 * 86_400_000, Number(q.get('since')) || 0);
      sendJson(response, 200, { ok: true, signals: academySignals.recent(since, Number(q.get('limit')) || 40), status: academySignals.status(), now: Date.now() });
      return;
    }
    /* New price targets the engine set since ?since= (ms), for the Academy's pop-up notification. Only alerts the member can see live. */
    if (request.method === 'GET' && path === '/academy-activity/pt-updates') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (!academyAutoPt || !academyAlerts) { sendJson(response, 200, { ok: true, updates: [], now: Date.now() }); return; }
      const since = Math.max(Date.now() - 3 * 86_400_000, Number(new URL(request.url || '/', 'http://localhost').searchParams.get('since')) || 0);
      const alertView = session.tier === 'free' ? 'teaser' : (session.tier === 'academy' && academyGate && academyGate.alertsTiering ? 'closed' : 'live');
      try {
        const all = academyAutoPt.recent(since, 40);
        // a Click-to-Alert post's events are the sender's own; desk alerts need the member to see that alert live
        const mine = all.filter((u) => u.owner && String(u.owner) === String(session.userId));
        let desk = all.filter((u) => String(u.key).startsWith('d:') && !(u.owner && String(u.owner) === String(session.userId)));
        if (academyAlertSources) {
          const sources = (await academyAlertSources.viewFor(session.userId, alertView)).filter((x) => x.access);
          desk = desk.filter((u) => { const src = academyAlerts.allows(u.id, sources); return src && src.view === 'live'; });
        } else if (alertView !== 'live') desk = [];
        const list = mine.concat(desk).map(({ owner, ...u }) => u).sort((a, b) => b.at - a.at).slice(0, 20);
        sendJson(response, 200, { ok: true, updates: list, now: Date.now() });
      } catch (error) { logger('warn', 'pt_updates_failed', { error }); sendJson(response, 503, { ok: false, error: 'temporarily_unavailable' }); }
      return;
    }
    /* Hedge & Income (academy-hedge.js): option ideas that protect or earn on a position, ranked by MEM ALGO's read. Academy members;
       entry/target/stop default to the member's own newest live alert on the symbol, else ATR levels. Educational only. */
    if (request.method === 'GET' && path === '/academy-activity/hedge') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required', message: 'Hedge & income ideas are part of the full Academy. Unlock the Academy to see them.' }); return; }
      if (!academyHedge) { sendJson(response, 503, { ok: false, error: 'hedge_unavailable', message: 'The live options feed is not connected right now.' }); return; }
      const hq = new URL(request.url || '/', 'http://localhost').searchParams;
      const symbol = String(hq.get('symbol') || '').toUpperCase();
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      const level = (k) => { const v = Number(hq.get(k)); return Number.isFinite(v) && v > 0 && v < 1e7 ? v : null; };
      const strength = Number(hq.get('strength'));
      const hedgeView = session.tier === 'academy' && academyGate && academyGate.alertsTiering ? 'closed' : 'live';
      try {
        const out = await academyHedge.plan({
          symbol, shares: Math.min(1_000_000, Math.max(1, Math.round(Number(hq.get('shares')) || 100))), entry: level('entry'), target: level('target'), stop: level('stop'),
          horizon: ['day', 'swing', 'mid', 'long', 'short'].includes(hq.get('horizon')) ? hq.get('horizon') : 'swing', side: hq.get('side') === 'short' ? 'short' : 'long',
          dir: ['bull', 'bear', 'neutral'].includes(hq.get('dir')) ? hq.get('dir') : null, strength: Number.isFinite(strength) ? Math.min(100, Math.max(0, strength)) : null,
          userId: session.userId, view: hedgeView
        });
        sendJson(response, out.ok ? 200 : (out.status || 503), out);
      } catch (error) { logger('error', 'academy_hedge_failed', { symbol, error }); sendJson(response, 503, { ok: false, error: 'hedge_unavailable', message: 'Hedge ideas are not available right now.' }); }
      return;
    }
    if (request.method === 'GET' && path === '/academy-activity/unusual-volume') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (!marketDirection) { sendJson(response, 503, { ok: false, error: 'unusual_volume_unavailable' }); return; }
      try { sendJson(response, 200, await marketDirection.unusualVolume()); }
      catch (error) { logger('error', 'unusual_volume_failed', { error }); sendJson(response, 503, { ok: false, error: 'unusual_volume_unavailable' }); }
      return;
    }
    if (request.method === 'GET' && path === '/academy-activity/stream') {
      const symbol = String(new URL(request.url || '/', 'http://localhost').searchParams.get('symbol') || '').toUpperCase();
      if (!academyMassive || !academyMassive.status().enabled) { sendJson(response, 503, { ok: false, error: 'stream_disabled' }); return; }
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      /* EventSource cannot send the session header, so with the content gate on
         the stream carries the free symbols only; members fall back to the
         authenticated /live poll (the client's existing fallback). */
      if (!allowGatedSymbol(request, response, symbol)) return;
      if (streamClients >= 400) { sendJson(response, 503, { ok: false, error: 'stream_busy' }); return; }
      streamClients += 1;
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      const write = (event, data) => { sseEvent(response, event, data); };
      write('snapshot', mergeLive(academyOrderFlow ? academyOrderFlow.live(symbol) : { symbol, ready: false }, academyMassive, symbol));
      let pendingQuote = null, quoteTimer = null;
      const off = academyMassive.on(symbol, (evt) => {
        if (evt.type === 'trade') write('trade', evt.trade);
        else { pendingQuote = evt.quote; if (!quoteTimer) quoteTimer = setTimeout(() => { quoteTimer = null; if (pendingQuote) { write('quote', pendingQuote); pendingQuote = null; } }, 100); }
      });
      const beat = setInterval(() => { sseWrite(response, ': keep-alive\n\n'); }, 15_000);
      const done = () => { clearInterval(beat); if (quoteTimer) clearTimeout(quoteTimer); off(); streamClients -= 1; };
      request.on('close', done);
      return;
    }

    /* Live S.I.R.E. ranking for the SIRE panel (Server-Sent Events): one snapshot of the scanner
       rows, then only the symbols whose values moved, with the strongest movers ticking trade by
       trade from Massive. The client reads it with fetch (so the session header rides along);
       gated viewers get the free symbols only. The polled /scanner stays as the fallback. */
    if (request.method === 'GET' && path === '/academy-activity/sire-stream') {
      const tier = contentGateOn ? callerTier(request) : 'member';
      if (tier === null) { sendJson(response, 401, { ok: false, error: 'authorization_required' }); return; }
      if (streamClients >= 400) { sendJson(response, 503, { ok: false, error: 'stream_busy' }); return; }
      streamClients += 1;
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      const write = (event, data) => { sseEvent(response, event, data); };
      const filter = tierEntitled(tier) ? null : (symbol) => academyGate.isFreeSymbol(symbol);
      let off = () => {};
      try { off = sireFeed.subscribe(write, { filter }); }
      catch (error) { logger('error', 'sire_stream_failed', { error }); write('error', { ok: false, error: 'temporary_unavailable' }); }
      const beat = setInterval(() => { sseWrite(response, ': keep-alive\n\n'); }, 15_000);
      let closed = false;
      const done = () => { if (closed) return; closed = true; clearInterval(beat); off(); streamClients -= 1; };
      request.on('close', done); response.on('close', done);
      return;
    }

    /* Level 2 reading (pulling & stacking, absorption, bid/ask flip) for the MEM ALGO panel. Read-only, public like the chart, never cached. */
    /* Owner research endpoints for the full-depth recordings: what has been recorded, and a replay of one symbol's day through the
       Level 2 reader at ten levels and at the full book. */
    if (request.method === 'GET' && (path === '/academy-activity/depth/status' || path === '/academy-activity/depth/replay')) {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (!OWNER_IDS.includes(String(session.userId))) { sendJson(response, 403, { ok: false, error: 'owner_only' }); return; }
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      try {
        if (path === '/academy-activity/depth/status') {
          sendJson(response, 200, { ok: true, recorder: academyDepthRecorder ? academyDepthRecorder.status() : { running: false, disabled: true }, stored: await depthStore.status() });
          return;
        }
        const symbol = String(params.get('symbol') || 'SPY').toUpperCase(), date = String(params.get('date') || ''), end = String(params.get('end') || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (end && !/^\d{4}-\d{2}-\d{2}$/.test(end))) { sendJson(response, 400, { ok: false, error: 'date_required' }); return; }
        const { fromMs, toMs } = dayBoundsNewYork(date, end || undefined);
        sendJson(response, 200, { ok: true, symbol, date, end: end || date, ...(await replayDepth(depthStore.read(symbol, fromMs, toMs))) });
      } catch (error) {
        sendJson(response, error instanceof TypeError ? 400 : 503, { ok: false, error: error instanceof TypeError ? 'invalid_symbol' : 'temporary_unavailable' });
      }
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/orderflow') {
      if (!academyOrderFlow) { sendJson(response, 503, { ok: false, error: 'orderflow_disabled' }); return; }
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      if (!allowGatedSymbol(request, response, params.get('symbol'))) return;
      try { sendJson(response, 200, academyOrderFlow.get(params.get('symbol'))); }
      catch (error) { sendJson(response, error instanceof TypeError ? 400 : 503, { ok: false, error: error instanceof TypeError ? 'invalid_symbol' : 'temporary_unavailable' }); }
      return;
    }

    /* The order-book heat map (academy-heatmap.js): columns of resting size since `since`, from the order-flow service's rolling history. */
    if (request.method === 'GET' && path === '/academy-activity/heatmap') {
      if (!academyOrderFlow || typeof academyOrderFlow.heatmap !== 'function') { sendJson(response, 503, { ok: false, error: 'orderflow_disabled' }); return; }
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      if (!allowGatedSymbol(request, response, params.get('symbol'))) return;
      try { sendJson(response, 200, academyOrderFlow.heatmap(params.get('symbol'), Number(params.get('since')) || 0)); }
      catch (error) { sendJson(response, error instanceof TypeError ? 400 : 503, { ok: false, error: error instanceof TypeError ? 'invalid_symbol' : 'temporary_unavailable' }); }
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/scanner') {
      const scannerTier = contentGateOn ? callerTier(request) : 'member';
      if (scannerTier === null) { sendJson(response, 401, { ok: false, error: 'authorization_required' }); return; }
      try {
        /* ?limit=101..500 (the scanner pop-out): the wide list ranked live; missing or <=100 keeps the site list. */
        const rawLimit = new URL(request.url || '/', 'http://localhost').searchParams.get('limit');
        const wideLimit = rawLimit === null || rawLimit === '' ? 0 : clampScannerLimit(rawLimit, 0);
        if (wideLimit > 100 && academyWideScanner) {
          let wide = null;
          try { wide = await academyWideScanner.get(wideLimit); } catch (error) { logger('warn', 'academy_wide_scanner_failed', { error }); }
          if (wide) {
            const full = tierEntitled(scannerTier);
            const cacheKey = wide.version + ':' + wide.limit + ':' + (full ? 'f' : 'g') + ':' + (wide.stale ? 's' : '');
            let entry = academyWideBodyCache.get(cacheKey);
            if (!entry) {
              const json = Buffer.from(JSON.stringify(full ? wide : gatedScanner(wide)));
              entry = { json, gz: zlib.gzipSync(json, { level: zlib.constants.Z_BEST_SPEED }) };
              if (academyWideBodyCache.size > 12) academyWideBodyCache.clear();
              academyWideBodyCache.set(cacheKey, entry);
            }
            const gzipOk = /\bgzip\b/i.test(String(request.headers['accept-encoding'] || ''));
            const body = gzipOk ? entry.gz : entry.json;
            response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store', vary: 'Accept-Encoding, Authorization', 'x-content-type-options': 'nosniff', ...(gzipOk ? { 'content-encoding': 'gzip' } : {}) });
            response.end(body);
            return;
          }
        }
        const scannerPayload = await getAcademyScanner();
        sendJson(response, 200, tierEntitled(scannerTier) ? scannerPayload : gatedScanner(scannerPayload));
      } catch (error) {
        logger('error', 'academy_scanner_request_failed', { error });
        sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
      }
      return;
    }

    /* Indicator Engine screener: the last sweep's readings for every tracked symbol (same gate as the scanner it is built from). */
    if (request.method === 'GET' && path === '/academy-activity/screener') {
      if (!academyScreener) { sendJson(response, 503, { ok: false, error: 'screener_disabled' }); return; }
      const screenerTier = contentGateOn ? callerTier(request) : 'member';
      if (screenerTier === null) { sendJson(response, 401, { ok: false, error: 'authorization_required' }); return; }
      sendJson(response, 200, academyScreener.snapshot());
      return;
    }
    /* A call or put for a screened lean, from the same verified options chain (and the same gate) as the options lab. */
    if (request.method === 'GET' && path === '/academy-activity/screener/option') {
      if (!academyOAuth || !academyDataBridge || !academyScreener) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      const optParams = new URL(request.url || '/', 'http://localhost').searchParams;
      const symbol = String(optParams.get('symbol') || '').toUpperCase();
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      const side = optParams.get('side') === 'put' ? 'put' : 'call';
      const horizon = SCREENER_HORIZONS[optParams.get('horizon')] ? optParams.get('horizon') : 'swing';
      try {
        /* the chain, the daily candles and the day's candles are read together; the chain is cached by the bridge (a minute fresh, fifteen stale) so a hover that warmed it makes the click instant */
        const warm = optParams.get('warm') === '1';
        const chainP = academyDataBridge.get('options', symbol, {}, { priority: 'interactive' });
        if (warm) { const c = await chainP; sendJson(response, 200, { ok: true, warmed: true, available: !!c.ok, cached: !!c.cached }); return; }
        const wantsDay = horizon === 'day';
        const swept = academyScreener.barsFor(symbol) || [];
        const [chain, p1, p5] = await Promise.all([chainP, swept.length ? Promise.resolve(null) : settledValue(getAcademyCandles(symbol, '1D'), 3_000), wantsDay ? settledValue(getAcademyCandles(symbol, '5m'), 3_000) : Promise.resolve(null)]);
        const daily = swept.length ? swept : ((p1 && Array.isArray(p1.bars) && p1.bars) || []);
        const bars5 = p5 && Array.isArray(p5.bars) ? p5.bars : [];
        const peek = academyMassive && typeof academyMassive.peek === 'function' ? academyMassive.peek(symbol) : null;
        const lastClose = daily.length ? Number(daily[daily.length - 1].c) : null;
        const price = peek && Number(peek.last) > 0 ? Number(peek.last) : lastClose;
        /* the target engine's ladder for this stock and direction: the contract is judged against it, and it is also the plan for the shares */
        const dirName = side === 'put' ? 'short' : 'long';
        const engineHorizon = horizon === 'day' ? 'day' : horizon === 'swing' ? 'swing' : 'position';
        let ladder = price ? suggestPriceTargets({ symbol, direction: dirName, horizon: engineHorizon, price, bars5, daily, learned: (targetLearner || fallbackTargetLearner || { learned: () => null }).learned() }) : null;
        if ((!ladder || !ladder.ok) && price && engineHorizon === 'day') ladder = suggestPriceTargets({ symbol, direction: dirName, horizon: 'swing', price, bars5, daily });
        if (ladder && !ladder.ok) ladder = null;
        const shares = ladder ? { direction: ladder.direction, horizon: ladder.horizonLabel, targets: ladder.targets.map((t) => ({ price: t.price, pct: t.pct, prob: t.prob })), stop: { price: ladder.stop.price, pct: ladder.stop.pct } } : null;
        if (!chain.ok) {
          const detail = String(chain.detail || '');
          if (/unusable response|no (listed )?options|not (found|listed)/i.test(detail)) {
            sendJson(response, 200, { ok: true, symbol, side, horizon, suggestion: { verdict: 'NONE', available: false, noOptions: true, reason: symbol + ' has no listed options we can read, so there is no contract to suggest. The target ladder below is the plan for the shares.' }, shares });
            return;
          }
          if (chain.status === 429) { sendJson(response, 429, { ok: false, error: 'busy', detail: 'The options feed is busy. Retrying in a few seconds.', retryAfterSec: chain.retryAfterSec || 15, shares }); return; }
          sendJson(response, chain.status || 503, { ok: false, error: chain.code, detail: detail || 'Options data is unavailable right now.', shares });
          return;
        }
        const rows = require('./academy-alert-options').normalizeChain(chain.data);
        const suggestion = academyScreener.optionFor({ symbol, side, horizon, rows, price, bars: daily, targets: ladder ? { t1: ladder.targets[0].price, t2: ladder.targets[1].price } : null });
        sendJson(response, 200, { ok: true, symbol, side, horizon, suggestion, shares, source: { cached: !!chain.cached, stale: !!chain.stale, ageSec: chain.ageSec || 0 } });
      } catch (error) {
        logger('error', 'academy_screener_option_failed', { symbol, error });
        sendJson(response, 503, { ok: false, error: 'option_suggestion_unavailable' });
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

    /* Pop-out windows (academy-popout.js): a module opened in the member's own browser window. */
    if (path.startsWith('/academy-activity/popout/')) {
      if (!academyOAuth || !academyPopout || typeof academyOAuth.issuePopoutSession !== 'function') { sendJson(response, 503, { ok: false, error: 'popout_unavailable' }); return; }
      const readJson = async () => {
        if (!contentTypeIsJson(request)) return { error: [415, 'content_type_required'] };
        const body = await readRequestBody(request, 4096);
        if (!body.ok) return { error: [body.status, body.error] };
        try { const v = JSON.parse(body.rawBody); return v && typeof v === 'object' ? { value: v } : { error: [400, 'invalid_json'] }; } catch (_) { return { error: [400, 'invalid_json'] }; }
      };
      const sessionOf = () => academyOAuth.verifySession(request.headers.authorization);
      /* from a signed-in Activity: a one-time ticket inside the link Discord opens */
      if (request.method === 'POST' && path === '/academy-activity/popout/ticket') {
        const session = sessionOf();
        if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
        const input = await readJson();
        if (input.error) { sendJson(response, input.error[0], { ok: false, error: input.error[1] }); return; }
        const mod = String(input.value.module || '');
        const symbol = String(input.value.symbol || 'SPY').toUpperCase();
        if (!validPopoutModule(mod)) { sendJson(response, 400, { ok: false, error: 'invalid_module' }); return; }
        const ticket = academyPopout.issueTicket({ userId: session.userId, tier: session.tier, displayName: session.displayName });
        if (!ticket) { sendJson(response, 429, { ok: false, error: 'rate_limited' }); return; }
        const query = new URLSearchParams({ popout: mod, symbol: validPopoutSymbol(symbol) ? symbol : 'SPY' });
        if (mod === 'profile' && /^\d{15,25}$/.test(String(input.value.user || ''))) query.set('user', String(input.value.user));
        sendJson(response, 200, { ok: true, url: `${POPOUT_BASE}/academy-activity/?${query}#pt=${ticket}` });
        return;
      }
      /* in the new window: ticket -> session + a renewal key (12 h, this browser only) */
      if (request.method === 'POST' && path === '/academy-activity/popout/exchange') {
        const input = await readJson();
        if (input.error) { sendJson(response, input.error[0], { ok: false, error: input.error[1] }); return; }
        const record = academyPopout.consumeTicket(input.value.ticket);
        if (!record) { sendJson(response, 401, { ok: false, error: 'popout_expired' }); return; }
        const sessionToken = academyOAuth.issuePopoutSession(record.userId, record.tier, record.displayName);
        if (!sessionToken) { sendJson(response, 503, { ok: false, error: 'popout_unavailable' }); return; }
        logger('info', 'academy_popout_opened', {});
        sendJson(response, 200, { ok: true, sessionToken, tier: record.tier, displayName: record.displayName, renew: academyOAuth.issuePopoutRenewal(record.userId, record.displayName) });
        return;
      }
      /* every 12 minutes, and on any 401: a new session, but only after re-checking the member's access now */
      if (request.method === 'POST' && path === '/academy-activity/popout/renew') {
        const input = await readJson();
        if (input.error) { sendJson(response, input.error[0], { ok: false, error: input.error[1] }); return; }
        const who = academyOAuth.verifyPopoutRenewal(input.value.renew);
        if (!who) { sendJson(response, 401, { ok: false, error: 'popout_expired' }); return; }
        let tier = 'none';
        try { tier = academyTierLive ? await academyTierLive(who.userId) : 'none'; } catch (_) { sendJson(response, 503, { ok: false, error: 'temporary_unavailable' }); return; }
        if (tier === 'free' && !academyFreeSessions) tier = 'none';
        if (tier === 'none') { sendJson(response, 403, { ok: false, error: 'access_ended' }); return; }
        sendJson(response, 200, { ok: true, sessionToken: academyOAuth.issuePopoutSession(who.userId, tier, who.displayName), tier, displayName: who.displayName, renew: academyOAuth.issuePopoutRenewal(who.userId, who.displayName) });
        return;
      }
      /* the link between one member's windows */
      if (path === '/academy-activity/popout/bus') {
        const session = sessionOf();
        if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
        if (request.method === 'POST') {
          const input = await readJson();
          if (input.error) { sendJson(response, input.error[0], { ok: false, error: input.error[1] }); return; }
          const n = academyPopout.publish(session.userId, input.value);
          sendJson(response, n < 0 ? 429 : 200, n < 0 ? { ok: false, error: 'rate_limited' } : { ok: true, delivered: n });
          return;
        }
        if (request.method === 'GET') {
          response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
          const off = academyPopout.subscribe(session.userId, (msg) => sseEvent(response, 'link', msg));
          if (!off) { sseEvent(response, 'busy', { ok: false }); response.end(); return; }
          sseWrite(response, ': linked\n\n');
          const beat = setInterval(() => { sseWrite(response, ': keep-alive\n\n'); }, 20_000);
          // a session lasts 15 minutes: close after 14 so the window reconnects with its renewed session
          const limit = setTimeout(() => { try { response.end(); } catch (_) { /* gone */ } }, 14 * 60 * 1000);
          request.on('close', () => { clearInterval(beat); clearTimeout(limit); off(); });
          return;
        }
      }
      sendJson(response, 404, { ok: false, error: 'not_found' });
      return;
    }

    /* Member layouts, per user in academy_state_kv (academy-layout.js): scope=desk is the Trading Desk browser window
       (academy-desk.js), scope=activity the windows floating inside the Activity plus per-module customization
       (academy-customize.js). */
    if (path === '/academy-activity/desk/layout' && academyOAuth && pool) {
      const deskSession = academyOAuth.verifySession(request.headers.authorization);
      if (!deskSession.ok) { sendJson(response, deskSession.status || 401, { ok: false, error: deskSession.code }); return; }
      const layoutKey = academyLayoutKey(deskSession.userId, cleanLayoutScope(new URL(request.url || '/', 'http://localhost').searchParams.get('scope')));
      if (request.method === 'GET') {
        try {
          const r = await pool.query('SELECT value FROM academy_state_kv WHERE key = $1', [layoutKey]);
          sendJson(response, 200, { ok: true, layout: (r && r.rows && r.rows[0]) ? r.rows[0].value : null });
        } catch (_) { sendJson(response, 200, { ok: true, layout: null }); }
        return;
      }
      if (request.method === 'PUT') {
        if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
        const body = await readRequestBody(request, 16384);
        if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
        let parsed;
        try { parsed = JSON.parse(body.rawBody); } catch (_) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
        const layout = cleanAcademyLayout(parsed);
        if (!layout) { sendJson(response, 400, { ok: false, error: 'invalid_layout' }); return; }
        try {
          await pool.query('INSERT INTO academy_state_kv (key, value, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [layoutKey, JSON.stringify(layout)]);
          sendJson(response, 200, { ok: true });
        } catch (_) { sendJson(response, 500, { ok: false, error: 'storage_failed' }); }
        return;
      }
      sendJson(response, 405, { ok: false, error: 'method_not_allowed' });
      return;
    }

    /* Article Desk (academy-story-desk.js; routes /academy-activity/articles and the older /story): owner only. GET = status; POST /write { symbol, publish } = one piece on demand. */
    if (path === '/academy-activity/story' || path === '/academy-activity/story/write' || path === '/academy-activity/articles' || path === '/academy-activity/articles/write' || path === '/academy-activity/articles/voice') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      const isOwner = OWNER_IDS.includes(String(session.userId));
      /* an Analyst whose stockmarketloop.com account is linked writes and files letters under their own byline; the desk's record, schedule and voice stay the owner's */
      let analyst = null;
      if (!isOwner) {
        if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
        analyst = await analystDeskFor(session.userId, session.displayName, session.tier).catch(() => ({ ok: false, error: 'analyst_check_failed' }));
        if (!analyst.ok) { sendJson(response, 403, { ok: false, error: analyst.error === 'analyst_edition_required' || analyst.error === 'site_not_linked' ? analyst.error : 'owner_only', detail: analyst.error }); return; }
      }
      const desk = getStoryDesk();
      if (!desk) { sendJson(response, 503, { ok: false, error: 'story_desk_off' }); return; }
      try {
        if (request.method === 'GET') { sendJson(response, 200, isOwner ? { ok: true, ...(await desk.status()) } : { ok: true, analyst: true, byline: analyst.as.byline, authorPath: analyst.as.authorPath, day: '', count: 0, record: null }); return; }
        if (request.method === 'POST' && (path === '/academy-activity/story/write' || path === '/academy-activity/articles/write')) {
          const raw = await readRequestBody(request, 2_048).catch(() => null);
          let body = {}; try { body = raw && raw.ok ? JSON.parse(raw.rawBody || '{}') : {}; } catch (_) { body = {}; }
          /* a ticker ("NVDA") or a market topic ("oil", "the fed") the desk maps to its proxy; file:false composes the
             copy-and-paste package (HTML, CSS, head) without filing a letter */
          const subject = String(body.symbol || body.topic || '').trim().slice(0, 40);
          if (!subject) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
          const out = await desk.write(subject, analyst ? { publish: body.publish === true, file: body.file !== false, as: analyst.as } : { publish: body.publish === true, file: body.file !== false });
          sendJson(response, out.ok ? 200 : (out.error === 'invalid_symbol' ? 400 : 200), out);
          return;
        }
        if (!isOwner) { sendJson(response, 403, { ok: false, error: 'owner_only' }); return; }
        /* the owner picks which articles are read in full in their own voice: { slug, on } */
        if (request.method === 'POST' && path === '/academy-activity/articles/voice') {
          const raw = await readRequestBody(request, 1_024).catch(() => null);
          let body = {}; try { body = raw && raw.ok ? JSON.parse(raw.rawBody || '{}') : {}; } catch (_) { body = {}; }
          const out = await desk.setFullVoice(String(body.slug || '').slice(0, 120), body.on !== false);
          if (!out) { sendJson(response, 404, { ok: false, error: 'no_such_article_audio' }); return; }
          sendJson(response, 200, { ok: true, ...out });
          return;
        }
        sendJson(response, 405, { ok: false, error: 'method_not_allowed' });
      } catch (error) { logger('error', 'academy_story_failed', { error }); sendJson(response, 503, { ok: false, error: 'story_unavailable' }); }
      return;
    }

    /* Edition (academy-editions.js): Trader or Analyst, with the analyst checklist. Any signed-in member reads.
       Choosing Trader needs Academy access; choosing ANALYST needs analyst level — the Analyst SKU, or a role
       holder. Everything the Analyst edition unlocks (the Article Desk, the Alert Chart seller tools, the
       member's own bot) keys off academyEditions.get(), so this one check is what the Analyst price buys. */
    if (path === '/academy-activity/edition') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      const me = String(session.userId);
      if (!academyEditions) { sendJson(response, 503, { ok: false, error: 'edition_unavailable' }); return; }
      try {
        if (request.method === 'POST') {
          if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
          const raw = await readRequestBody(request, 512).catch(() => null);
          let body = {}; try { body = raw && raw.ok ? JSON.parse(raw.rawBody || '{}') : {}; } catch (_) { body = {}; }
          if (String(body.edition || '').toLowerCase() === 'analyst' && !tierAnalyst(session.tier)) {
            sendJson(response, 403, { ok: false, error: 'academy_analyst_required' }); return;
          }
          const set = await academyEditions.set(me, body.edition);
          if (!set.ok) { sendJson(response, set.status || 400, { ok: false, error: set.code }); return; }
        } else if (request.method !== 'GET') { sendJson(response, 405, { ok: false, error: 'method_not_allowed' }); return; }
        const [seller, persona] = await Promise.all([
          alertChartBilling ? alertChartBilling.sellerStatus(me).catch(() => null) : null,
          personaRegistry ? personaRegistry.status(me).catch(() => null) : null
        ]);
        sendJson(response, 200, await academyEditions.summary(me, { seller, persona, letters: { configured: !!(storyPublisher && storyPublisher.signed && storyPublisher.signed()) }, owner: OWNER_IDS.includes(me), tier: session.tier }));
      } catch (error) { logger('error', 'academy_edition_failed', { error }); sendJson(response, 503, { ok: false, error: 'edition_unavailable' }); }
      return;
    }
    /* Auto-trade (academy-autotrade.js): owner only. GET status, POST { enabled, mode, maxPositionUsd, ... } or { kill: true, flatten }. Simulated moomoo account only. */
    if (path === '/academy-activity/autotrade') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (!OWNER_IDS.includes(String(session.userId))) { sendJson(response, 403, { ok: false, error: 'owner_only' }); return; }
      if (!autoTrade) { sendJson(response, 503, { ok: false, error: 'autotrade_unavailable' }); return; }
      try {
        if (request.method === 'POST') {
          const raw = await readRequestBody(request, 2_048).catch(() => null);
          let body = {}; try { body = raw && raw.ok ? JSON.parse(raw.rawBody || '{}') : {}; } catch (_) { body = {}; }
          if (body.kill === true) await autoTrade.kill({ flatten: body.flatten === true }); else await autoTrade.setSettings(body);
        } else if (request.method !== 'GET') { sendJson(response, 405, { ok: false, error: 'method_not_allowed' }); return; }
        sendJson(response, 200, await autoTrade.status());
      } catch (error) { logger('error', 'academy_autotrade_failed', { error }); sendJson(response, 503, { ok: false, error: 'autotrade_unavailable' }); }
      return;
    }
    /* Persona bot (academy-persona-bots.js): the analyst's own Discord bot for their alerts. GET status (?guild=&channel= adds the posting check), POST { token }, DELETE. */
    if (path === '/academy-activity/persona') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      const me = String(session.userId);
      if (!personaRegistry) { sendJson(response, 503, { ok: false, error: 'persona_unavailable' }); return; }
      try {
        if (request.method === 'GET') { const rq = new URL(request.url || '/', 'http://localhost').searchParams; sendJson(response, 200, { ok: true, ...(await personaRegistry.status(me, { guildId: rq.get('guild') || '', channelId: rq.get('channel') || '' })) }); return; }
        if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
        if (request.method === 'POST') {
          const raw = await readRequestBody(request, 1_024).catch(() => null);
          let body = {}; try { body = raw && raw.ok ? JSON.parse(raw.rawBody || '{}') : {}; } catch (_) { body = {}; }
          const r = await personaRegistry.set(me, body.token);
          if (!r.ok) { sendJson(response, r.status || 400, { ok: false, error: r.code, detail: r.detail || '' }); return; }
          sendJson(response, 200, { ok: true, bot: r.bot, inviteUrl: r.inviteUrl }); return;
        }
        if (request.method === 'DELETE') { const r = await personaRegistry.remove(me); sendJson(response, r.ok ? 200 : (r.status || 400), r.ok ? { ok: true } : { ok: false, error: r.code, detail: r.detail || '' }); return; }
        sendJson(response, 405, { ok: false, error: 'method_not_allowed' });
      } catch (error) { logger('error', 'academy_persona_failed', { error }); sendJson(response, 503, { ok: false, error: 'persona_unavailable' }); }
      return;
    }
    /* Candle recap (academy-candle-recap.js): one higher-timeframe candle read in full. Any signed-in member. */
    if (request.method === 'GET' && path === '/academy-activity/candle-recap') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      const svc = getCandleRecap();
      if (!svc) { sendJson(response, 503, { ok: false, error: 'recap_unavailable' }); return; }
      const rq = new URL(request.url || '/', 'http://localhost').searchParams;
      const bar = ['o', 'h', 'l', 'c', 'v'].every((k) => Number.isFinite(Number(rq.get(k)))) ? { o: Number(rq.get('o')), h: Number(rq.get('h')), l: Number(rq.get('l')), c: Number(rq.get('c')), v: Number(rq.get('v')) } : null;
      try {
        const out = await svc.recap({ symbol: rq.get('symbol'), tf: rq.get('tf'), t: rq.get('t'), bar });
        sendJson(response, out.ok ? 200 : (out.error === 'invalid_request' ? 400 : 503), out);
      } catch (error) { logger('error', 'academy_candle_recap_failed', { error }); sendJson(response, 503, { ok: false, error: 'recap_unavailable' }); }
      return;
    }
    /* Session recap (academy-session-recap.js): today's session written at the bell with its lettered chart. Any signed-in member.
       ?format=svg returns the picture alone; the JSON carries the three sections, the events and the SVG. */
    if (request.method === 'GET' && path === '/academy-activity/session-recap') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      const gate = academyDataLimit.take(request);
      if (!gate.ok) { response.setHeader('retry-after', String(gate.retryAfterSec)); sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
      const rq = new URL(request.url || '/', 'http://localhost').searchParams;
      const symbol = String(rq.get('symbol') || 'SPY').toUpperCase();
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      const t = Number(rq.get('t')) > 0 ? Number(rq.get('t')) : Date.now();
      if (!sessionRecap) { sendJson(response, 503, { ok: false, error: 'recap_unavailable' }); return; }
      try {
        const out = await sessionRecap.build({ symbol, t });
        if (rq.get('format') === 'svg') {
          if (!out.ok || !out.svg) { sendJson(response, 503, { ok: false, error: out.error || 'recap_unavailable' }); return; }
          response.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'private, max-age=60', 'x-content-type-options': 'nosniff' }); response.end(out.svg); return;
        }
        if (out.ok) { const { png, chartInput, ...rest } = out; sendJson(response, 200, rest); } else sendJson(response, out.error === 'bars_unavailable' ? 503 : 200, out);
      } catch (error) { logger('error', 'academy_session_recap_failed', { error }); sendJson(response, 503, { ok: false, error: 'recap_unavailable' }); }
      return;
    }

    /* Client diagnostics: the Activity reports which sign-in step it reached (and any page error) so a silent failure on a
       member's machine can be read from the server log. Unauthenticated by design (it fires before there is a session),
       tiny, and it stores nothing: one stderr line per beacon. */
    if (request.method === 'POST' && path === '/academy-activity/diag') {
      const gate = academyDataLimit.take(request);
      if (!gate.ok) { response.writeHead(204); response.end(); return; }
      const body = await readRequestBody(request, 2_048).catch(() => null);
      let info = null; try { info = body && body.ok ? JSON.parse(body.rawBody || '{}') : null; } catch (_) { info = null; }
      if (info && typeof info === 'object') {
        const clean = {}; for (const k of ['stage', 'code', 'message', 'inDiscord', 'ua', 'href', 'ms', 'hasToken']) if (info[k] != null) clean[k] = String(info[k]).slice(0, 200);
        console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', event: 'academy_client_diag', ...clean }));
      }
      response.writeHead(204, { 'cache-control': 'no-store' }); response.end(); return;
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
        /* SML_ACADEMY_BILLING_IN_DISCORD_LINKS: a refused or free-tier member gets
           a signed buy ticket (this Discord id, 15 minutes; not a session). The
           one-time handoff code is minted by POST /academy-activity/buy only
           when the member presses 'Get Academy access', so sign-in and the
           15-minute renewals never wait on it or write a row. */
        /* a signed-in member becomes taggable in the live chat: their display name and this sign-in are recorded (never awaited) */
        if (result.ok && result.userId && academyMentions && typeof academyMentions.touch === 'function') academyMentions.touch({ userId: result.userId, displayName: result.displayName }).catch((error) => log('warn', 'academy_mention_touch_failed', { error: String(error && error.message || error) }));
        let buy = null;
        if ((buyLinksOn || (academyPasses && academyPasses.configured)) && result.userId && typeof academyOAuth.issueBuyTicket === 'function'
          && ((!result.ok && result.code === 'academy_role_required') || (result.ok && result.tier === 'free'))) {
          const ticket = academyOAuth.issueBuyTicket(result.userId);
          if (ticket) buy = { ticket };
        }
        /* the renewal key (12 h, signed, never a session): the Discord SDK takes authorize once per Activity, so the
           15-minute renewals go through POST /academy-activity/renew with this key instead of a second authorize */
        const renewKey = result.ok && result.userId && typeof academyOAuth.issuePopoutRenewal === 'function' ? academyOAuth.issuePopoutRenewal(result.userId, result.displayName) : '';
        sendJson(response, result.ok ? 200 : (result.status || 401), result.ok
          ? { ok: true, access_token: result.accessToken, sessionToken: result.sessionToken, ...(academyGate && result.tier ? { tier: result.tier } : {}), ...(result.displayName ? { displayName: result.displayName } : {}), ...(renewKey ? { renew: renewKey } : {}), ...(buy ? { buy } : {}) }
          : { ok: false, error: result.code, ...(buy ? { buy } : {}) });
      } catch (error) {
        logger('error', 'academy_activity_oauth_failed', { error });
        sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
      }
      return;
    }

    /* Sessions last 15 minutes. The Discord SDK accepts authorize once per Activity (a second call fails with
       "Already authenticated"), so a running Activity renews with the signed key it received at sign-in: a new
       session is issued only after the member's access is re-checked now (the same key and rule as pop-out windows). */
    if (request.method === 'POST' && path === '/academy-activity/renew') {
      if (!academyOAuth || typeof academyOAuth.verifyPopoutRenewal !== 'function' || typeof academyOAuth.issuePopoutSession !== 'function') { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
      const body = await readRequestBody(request, 4096);
      if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
      let input;
      try { input = JSON.parse(body.rawBody); } catch (_) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
      const who = academyOAuth.verifyPopoutRenewal(input && typeof input === 'object' ? input.renew : '');
      if (!who) { sendJson(response, 401, { ok: false, error: 'authorization_required' }); return; }
      let tier = 'none';
      try { tier = academyTierLive ? await academyTierLive(who.userId) : 'none'; }
      catch (error) { logger('warn', 'academy_activity_renew_failed', { error: String((error && error.message) || error) }); sendJson(response, 503, { ok: false, error: 'temporary_unavailable' }); return; }
      if (tier === 'free' && !academyFreeSessions) tier = 'none';
      if (tier === 'none') { logger('info', 'academy_activity_renew_refused', {}); sendJson(response, 403, { ok: false, error: 'access_ended' }); return; }
      const sessionToken = academyOAuth.issuePopoutSession(who.userId, tier, who.displayName);
      if (!sessionToken) { sendJson(response, 503, { ok: false, error: 'temporary_unavailable' }); return; }
      let buy = null;
      if (tier === 'free' && (buyLinksOn || (academyPasses && academyPasses.configured)) && typeof academyOAuth.issueBuyTicket === 'function') { const ticket = academyOAuth.issueBuyTicket(who.userId); if (ticket) buy = { ticket }; }
      logger('info', 'academy_activity_renewed', { tier });
      sendJson(response, 200, { ok: true, sessionToken, tier, ...(who.displayName ? { displayName: who.displayName } : {}), renew: academyOAuth.issuePopoutRenewal(who.userId, who.displayName), ...(buy ? { buy } : {}) });
      return;
    }

    /* SML_ACADEMY_BILLING_IN_DISCORD_LINKS: a buy ticket from the token
       exchange becomes a one-time handoff URL (academy_billing_handoffs: five
       minutes, single use). The route does not exist while the flag is off. */
    if (buyLinksOn && request.method === 'POST' && path === '/academy-activity/buy') {
      if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
      const body = await readRequestBody(request, 4096);
      if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
      let input;
      try { input = JSON.parse(body.rawBody); } catch (_) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
      const holder = typeof academyOAuth.verifyBuyTicket === 'function' ? academyOAuth.verifyBuyTicket(input && input.ticket) : null;
      if (!holder) { sendJson(response, 401, { ok: false, error: 'authorization_required' }); return; }
      if (!allowBuyMint(holder.userId)) { sendJson(response, 429, { ok: false, error: 'rate_limited' }); return; }
      let minted;
      try { minted = await academyGate.handoff.mint({ discordUserId: holder.userId, guildId: academyGate.guildId, source: 'activity' }); }
      catch (_) { minted = { ok: false, code: 'handoff_unavailable' }; }
      if (!minted || !minted.ok) {
        logger('warn', 'academy_billing_handoff_failed', { code: (minted && minted.code) || 'handoff_unavailable' });
        sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
        return;
      }
      sendJson(response, 200, { ok: true, url: minted.url });
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
        if (!lessonOpenTo(session.tier || 'member', input.moduleId, input.lessonId)) { sendJson(response, 403, { ok: false, error: 'lesson_locked' }); return; }
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
      /* a baked store answers with no key configured: the recordings were paid for once */
      if (!academyVoice || !(academyVoice.configured || academyVoice.stored)) {
        sendJson(response, 503, { ok: false, error: 'integration_unconfigured' });
        return;
      }
      const authorization = String(request.headers.authorization || '').trim();
      let voiceUserId, voiceTier = 'anonymous';
      if (authorization) {
        const session = academyOAuth && academyOAuth.verifySession(authorization);
        if (!session || !session.ok) {
          sendJson(response, session?.status || 401, { ok: false, error: session?.code || 'authorization_required' });
          return;
        }
        voiceUserId = session.userId;
        voiceTier = session.tier || 'member';
      } else {
        const forwarded = String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown').split(',')[0].trim();
        const userAgent = String(request.headers['user-agent'] || '').slice(0, 160);
        voiceUserId = `anonymous:${crypto.createHash('sha256').update(`${forwarded}\0${userAgent}`).digest('hex').slice(0, 24)}`;
      }
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      if (!lessonOpenTo(voiceTier, params.get('moduleId'), params.get('lessonId'))) { sendJson(response, 403, { ok: false, error: 'lesson_locked' }); return; }
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
        logger(invalid || (error && error.cached) ? 'warn' : 'error', 'academy_voice_request_failed', {
          error, userId: voiceUserId, moduleId: params.get('moduleId'), lessonId: params.get('lessonId'), cached: !!(error && error.cached)
        });
        sendJson(response, invalid ? 400 : (limited ? 429 : 503), {
          ok: false, error: invalid ? 'invalid_lesson' : (limited ? 'rate_limited' : 'voice_temporarily_unavailable')
        });
      }
      return;
    }

    /* The guided tour and the first-use tool cards, in the Academy's voice: ids only, the text lives in academy/tour-content.js */
    /* The Auto Live desk speaks in the owner's voice. Owner only (the desk is), one line per request, each line stored once by its text. */
    if (request.method === 'POST' && path === '/academy-activity/desk-speech') {
      if (!academyVoice || !(academyVoice.configured || academyVoice.stored)) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth && academyOAuth.verifySession(request.headers.authorization);
      if (!session || !session.ok) { sendJson(response, session?.status || 401, { ok: false, error: session?.code || 'authorization_required' }); return; }
      if (!OWNER_IDS.includes(String(session.userId))) { sendJson(response, 403, { ok: false, error: 'owner_only' }); return; }
      if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
      const body = await readRequestBody(request, 4096);
      if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
      let input; try { input = JSON.parse(body.rawBody); } catch (_) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
      const text = String(input && input.text || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 600) { sendJson(response, 400, { ok: false, error: 'invalid_line' }); return; }
      try {
        const result = await academyVoice.getPartsAudio({ parts: [text], userId: session.userId });
        response.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': result.audio.length, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-academy-voice-cache': result.cached ? 'hit' : 'miss' });
        response.end(result.audio);
      } catch (error) {
        const limited = error && (error.code === 'rate_limited' || error.code === 'provider_rate_limited');
        logger('warn', 'academy_desk_voice_failed', { error, userId: session.userId });
        sendJson(response, limited ? 429 : 503, { ok: false, error: limited ? 'rate_limited' : 'voice_temporarily_unavailable' });
      }
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/tour-speech') {
      if (!academyVoice || !(academyVoice.configured || academyVoice.stored)) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const authorization = String(request.headers.authorization || '').trim();
      let tourUserId;
      if (authorization) {
        const session = academyOAuth && academyOAuth.verifySession(authorization);
        if (!session || !session.ok) { sendJson(response, session?.status || 401, { ok: false, error: session?.code || 'authorization_required' }); return; }
        tourUserId = session.userId;
      } else {
        const forwarded = String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown').split(',')[0].trim();
        const userAgent = String(request.headers['user-agent'] || '').slice(0, 160);
        tourUserId = `anonymous:${crypto.createHash('sha256').update(`${forwarded}\0${userAgent}`).digest('hex').slice(0, 24)}`;
      }
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      if (require('./academy/tour-content').isOwnerOnly(params.get('kind'), params.get('id')) && !OWNER_IDS.includes(String(tourUserId))) { sendJson(response, 403, { ok: false, error: 'owner_only' }); return; }
      try {
        const result = await academyVoice.getTourAudio({ kind: params.get('kind'), id: params.get('id'), userId: tourUserId });
        response.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': result.audio.length, 'cache-control': 'private, max-age=604800', 'x-content-type-options': 'nosniff', 'x-academy-voice-cache': result.cached ? 'hit' : 'miss' });
        response.end(result.audio);
      } catch (error) {
        const invalid = error instanceof TypeError;
        const limited = error && (error.code === 'rate_limited' || error.code === 'provider_rate_limited');
        logger(invalid || (error && error.cached) ? 'warn' : 'error', 'academy_tour_voice_failed', { error, userId: tourUserId, kind: params.get('kind'), id: params.get('id'), cached: !!(error && error.cached) });
        sendJson(response, invalid ? 400 : (limited ? 429 : 503), { ok: false, error: invalid ? 'invalid_tour_line' : (limited ? 'rate_limited' : 'voice_temporarily_unavailable') });
      }
      return;
    }

    /* Listen to an article in the Academy voice. Public (a reader of a Loop Letter has no Academy session), but it can only voice the listen script of a piece the
       desk itself wrote (looked up by slug and checked against its hash), each part is stored once by its text, and a visitor is rate limited. The URL carries the
       script's hash, so a browser or CDN can keep the file for good. Range requests are answered so a player can seek. */
    if ((request.method === 'GET' || request.method === 'HEAD') && path === '/academy-activity/article-audio') {
      if (!academyVoice || !(academyVoice.configured || academyVoice.stored)) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const desk = getStoryDesk();
      const q = new URL(request.url || '/', 'http://localhost').searchParams;
      const entry = desk && typeof desk.audioFor === 'function' ? await desk.audioFor(String(q.get('slug') || '').slice(0, 120), String(q.get('v') || '').slice(0, 24)) : null;
      if (!entry) { sendJson(response, 404, { ok: false, error: 'no_such_article_audio' }); return; }
      /* intro (the opening, a few hundred characters) is always available; the whole piece in the owner's voice only for articles the owner picked */
      const wantFull = q.get('mode') === 'full';
      if (wantFull && !entry.full) { sendJson(response, 403, { ok: false, error: 'full_voice_not_enabled' }); return; }
      const voiceParts = wantFull ? entry.parts : (Array.isArray(entry.intro) && entry.intro.length ? entry.intro : entry.parts.slice(0, 1));
      const forwarded = String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown').split(',')[0].trim();
      const listener = `article:${crypto.createHash('sha256').update(`${forwarded}\0${String(request.headers['user-agent'] || '').slice(0, 160)}`).digest('hex').slice(0, 24)}`;
      try {
        const result = await academyVoice.getPartsAudio({ parts: voiceParts, userId: listener });
        const total = result.audio.length, range = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.range || ''));
        const headers = { 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*', 'x-academy-voice-reused': `${result.reused}/${result.total}` };
        let start = 0, end = total - 1, status = 200;
        if (range && (range[1] !== '' || range[2] !== '')) {
          start = range[1] === '' ? Math.max(0, total - Number(range[2])) : Number(range[1]); end = range[1] === '' || range[2] === '' ? total - 1 : Math.min(total - 1, Number(range[2]));
          if (!(start <= end) || start >= total) { response.writeHead(416, { 'content-range': `bytes */${total}` }); response.end(); return; }
          status = 206; headers['content-range'] = `bytes ${start}-${end}/${total}`;
        }
        headers['content-length'] = end - start + 1;
        response.writeHead(status, headers);
        response.end(request.method === 'HEAD' ? undefined : result.audio.subarray(start, end + 1));
      } catch (error) {
        const limited = error && (error.code === 'rate_limited' || error.code === 'provider_rate_limited');
        logger(error && error.cached ? 'warn' : 'error', 'academy_article_audio_failed', { error, slug: String(q.get('slug') || '').slice(0, 80), cached: !!(error && error.cached) });
        sendJson(response, limited ? 429 : 503, { ok: false, error: limited ? 'rate_limited' : 'voice_temporarily_unavailable' });
      }
      return;
    }

    /* The listen page: the opening in the owner's voice (stored once), then the rest read by the listener's own browser voice (free); or the whole piece in the owner's voice when the owner turned that on for the article. */
    if (request.method === 'GET' && path === '/academy-activity/article-listen') {
      const desk = getStoryDesk();
      const slug = String(new URL(request.url || '/', 'http://localhost').searchParams.get('slug') || '').slice(0, 120);
      const entry = desk && typeof desk.audioFor === 'function' ? await desk.audioFor(slug) : null;
      if (!entry) { sendJson(response, 404, { ok: false, error: 'no_such_article_audio' }); return; }
      const base = '/academy-activity/article-audio?slug=' + encodeURIComponent(slug);
      const data = { intro: base + '&v=' + entry.introHash + '&mode=intro', full: entry.full ? base + '&v=' + entry.hash + '&mode=full' : '', rest: entry.full ? '' : String(entry.rest || ''), title: String(entry.intro && entry.intro[0] || '').split(/(?<=[.?!])\s/)[0].slice(0, 160) };
      const json = JSON.stringify(data).replace(/</g, '\\u003c');
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Listen to this article</title><style>body{margin:0;background:#0b1119;color:#e8eff4;font:500 16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:20px}main{max-width:520px;width:100%;text-align:center}h1{font-size:18px;margin:0 0 6px;color:#9fb4c2;font-weight:700;letter-spacing:.08em;text-transform:uppercase}p.t{font-size:22px;line-height:1.3;margin:0 0 22px;font-weight:800}button{border:0;border-radius:999px;background:#00c47d;color:#04140d;font:800 16px system-ui;padding:14px 28px;cursor:pointer}button.s{background:#16232f;color:#cfe0ea;margin-left:8px}small{display:block;margin-top:16px;color:#8da3b2}#st{margin-top:14px;color:#9fb4c2;min-height:1.4em}</style></head><body><main><h1>Listen</h1><p class="t" id="t"></p><div><button id="go" type="button">Play</button><button id="no" class="s" type="button" hidden>Stop</button></div><div id="st" role="status"></div><small>The opening is read in the Making Easy Money voice.<span id="free"></span> Educational analysis, not financial advice.</small></main><script>(function(){var D=${json},go=document.getElementById('go'),no=document.getElementById('no'),st=document.getElementById('st'),stop=false,au=null;document.getElementById('t').textContent=D.title;if(D.rest)document.getElementById('free').textContent=' The rest is read by your device\\u2019s own voice.';function say(t){st.textContent=t}function chunks(t){var o=[],c='';t.split(/(?<=[.!?])\\s+/).forEach(function(s){if(c&&(c+' '+s).length>180){o.push(c);c=s}else c=c?c+' '+s:s});if(c)o.push(c);return o}function speak(text,done){if(!('speechSynthesis'in window)||!text){done();return}var parts=chunks(text),i=0,v=(speechSynthesis.getVoices()||[]).filter(function(x){return/^en/i.test(x.lang)})[0];(function next(){if(stop||i>=parts.length){done();return}var u=new SpeechSynthesisUtterance(parts[i++]);if(v)u.voice=v;u.lang='en-US';u.rate=1;u.onend=next;u.onerror=next;try{speechSynthesis.speak(u)}catch(e){done()}})()}function fin(){go.disabled=false;go.textContent='Play again';no.hidden=true;say('Finished.')}go.onclick=function(){stop=false;go.disabled=true;no.hidden=false;say('Playing\\u2026');au=new Audio(D.full||D.intro);au.onended=function(){if(D.full){fin();return}speak(D.rest,fin)};au.onerror=function(){say('The voice is not available right now.');if(D.rest)speak(D.rest,fin);else fin()};au.play().catch(function(){say('Tap Play again to allow audio.');go.disabled=false;no.hidden=true})};no.onclick=function(){stop=true;try{if(au)au.pause()}catch(e){}try{speechSynthesis.cancel()}catch(e){}fin();say('Stopped.')}})();</script></body></html>`;
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'" });
      response.end(html);
      return;
    }

    /* The trial countdown (academy-trial-countdown.js): how long the signed-in member's free trial has left, from the pass itself */
    if (request.method === 'GET' && path === '/academy-activity/trial-status') {
      if (!academyOAuth || !academyTrial || typeof academyTrial.statusFor !== 'function') { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      try { const st = await academyTrial.statusFor(session.userId); sendJson(response, st.ok ? 200 : 400, st); }
      catch (error) { logger('warn', 'academy_trial_status_failed', { error: String(error && error.message || error) }); sendJson(response, 503, { ok: false, error: 'temporarily_unavailable' }); }
      return;
    }
    /* The free trial link (academy-trial.js): public pages, Discord sign-in, a pass on the account; no session needed */
    if (academyTrial && path.startsWith('/academy-activity/trial')) {
      if (await academyTrial.handle(request, response, path, new URL(request.url || '/', 'http://localhost'))) return;
    }

    /* Ticker Talk: comments on a ticker's chart. Signed-in members read, post, reply, tag members, attach pictures and links.
       <img> cannot send a header, so the image routes take the session token as ?t= like the profile pages do. */
    if (path === '/academy-activity/talk' || path.startsWith('/academy-activity/talk/')) {
      if (!academyOAuth || !tickerTalk) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const tq = new URL(request.url || '/', 'http://localhost').searchParams;
      const imageRead = request.method === 'GET' && (path === '/academy-activity/talk/link-image' || /^\/academy-activity\/talk\/image\/\d+$/.test(path));
      const authz = request.headers.authorization || (imageRead && tq.get('t') ? 'Bearer ' + tq.get('t') : '');
      const session = academyOAuth.verifySession(authz);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      const me = String(session.userId);
      const elevated = OWNER_IDS.includes(me);
      const status = (r) => (r.ok ? 200 : r.error === 'slow_down' || r.error === 'too_many_today' ? 429 : r.error === 'forbidden' ? 403 : r.error === 'not_found' || r.error === 'parent_not_found' ? 404 : r.error === 'file_too_large' ? 413 : r.error === 'storage_unavailable' ? 503 : 400);
      try {
        if (imageRead && path === '/academy-activity/talk/link-image') {
          const img = academyProfilePages ? await academyProfilePages.linkImage(tq.get('u') || '') : null;
          if (!img) { response.writeHead(404); response.end(); return; }
          response.writeHead(200, { 'content-type': img.contentType, 'content-length': img.bytes.length, 'cache-control': 'private, max-age=21600', 'x-content-type-options': 'nosniff' }); response.end(img.bytes); return;
        }
        if (imageRead) {
          const img = await tickerTalk.image(path.split('/')[4]);
          if (!img) { response.writeHead(404); response.end(); return; }
          response.writeHead(200, { 'content-type': img.contentType, 'content-length': img.bytes.length, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' }); response.end(img.bytes); return;
        }
        if (request.method === 'GET' && path === '/academy-activity/talk/members') {
          const users = academyMentions ? await academyMentions.search(tq.get('q') || '', { limit: 8, exclude: me }) : [];
          sendJson(response, 200, { ok: true, users: (users || []).map((u) => ({ id: String(u.id || ''), name: String(u.name || '') })).filter((u) => u.id && u.name) }); return;
        }
        if (request.method === 'POST' && path === '/academy-activity/talk/image') {
          const limit = tickerTalk.MAX_IMAGE_BYTES;
          const declared = Number(request.headers['content-length']);
          if (Number.isFinite(declared) && declared > limit) { sendJson(response, 413, { ok: false, error: 'file_too_large' }); request.resume(); return; }
          const chunks = []; let size = 0, tooBig = false;
          await new Promise((resolve, reject) => {
            request.on('data', (c) => { size += c.length; if (size > limit) { tooBig = true; request.pause(); resolve(); } else chunks.push(c); });
            request.once('end', resolve); request.once('error', reject);
          });
          if (tooBig) { sendJson(response, 413, { ok: false, error: 'file_too_large' }); return; }
          const r = await tickerTalk.storeImage(me, Buffer.concat(chunks));
          sendJson(response, status(r), r); return;
        }
        const m = /^\/academy-activity\/talk\/([A-Za-z0-9.\-^=:%]{1,24})(?:\/(count|\d+))?$/.exec(path);
        if (!m) { sendJson(response, 404, { ok: false, error: 'not_found' }); return; }
        let symbol = m[1]; try { symbol = decodeURIComponent(m[1]); } catch (_) { symbol = m[1]; }
        if (request.method === 'GET' && m[2] === 'count') { const n = await tickerTalk.count(symbol); sendJson(response, 200, { ok: true, symbol: String(symbol).toUpperCase(), count: n }); return; }
        if (request.method === 'GET' && !m[2]) {
          const r = await tickerTalk.list(symbol, { limit: tq.get('limit') || 20, before: tq.get('before') || '' });
          if (r.ok && academySocialNotify && Array.isArray(r.comments) && r.comments.length) {
            // like counts ride along with the page (academy-social-notify.js); a missing count is zero, never an error
            try {
              const all = r.comments.flatMap((c) => [c, ...(c.replies || [])]);
              const likes = await academySocialNotify.likesFor('talk', all.map((c) => c.id), me);
              for (const c of all) { const l = likes[String(c.id)]; c.likes = l ? l.likes : 0; c.liked = !!(l && l.liked); }
            } catch (_) { /* the page still shows */ }
          }
          sendJson(response, r.ok ? 200 : 400, { ...r, viewer: { id: me, elevated } }); return;
        }
        if (request.method === 'POST' && !m[2]) {
          const raw = await readRequestBody(request, 16_384).catch(() => null);
          let b = null; try { b = raw && raw.ok ? JSON.parse(raw.rawBody || '{}') : null; } catch (_) { b = null; }
          if (!b || typeof b !== 'object') { sendJson(response, 400, { ok: false, error: 'invalid_body' }); return; }
          let name = '';
          if (academyProfilePages) { try { name = (await academyProfilePages.settingsOf(me)).displayName || ''; } catch (_) { name = ''; } }
          if (!name && academyProfiles) { try { const c = await academyProfiles.profile(me); name = c && c.discord ? (c.discord.name || c.discord.username || '') : ''; } catch (_) { name = ''; } }
          if (!name) name = session.displayName || 'Member';
          const r = await tickerTalk.post(symbol, { id: me, name }, { body: b.body, parentId: b.parentId, imageIds: b.imageIds, mentions: b.mentions });
          if (r.ok && r.comment && academySocialNotify) {
            // followers hear about a new comment on a ticker; the parent's author hears about a reply (LOOP-KICK, academy-social-notify.js)
            const c = r.comment;
            if (c.parentId == null) academySocialNotify.followedPost({ id: me, name }, { source: 'talk', id: c.id, symbol: c.symbol, body: c.body }).catch(() => {});
            else tickerTalk.get(c.parentId).then((p) => (p ? academySocialNotify.reply(p.authorId, c) : null)).catch(() => {});
          }
          if (r.ok && academyMentions && r.comment && Array.isArray(r.comment.mentions) && r.comment.mentions.length) {
            academyMentions.notify({ sender: { userId: me, displayName: name }, mentions: r.comment.mentions, message: { id: r.comment.id, body: r.comment.body }, channel: 'Ticker Talk $' + r.comment.symbol }).catch(() => {});
          }
          sendJson(response, status(r), r); return;
        }
        if (request.method === 'DELETE' && m[2] && m[2] !== 'count') {
          const r = await tickerTalk.remove(m[2], me, { elevated });
          sendJson(response, status(r), r); return;
        }
        sendJson(response, 405, { ok: false, error: 'method_not_allowed' }); return;
      } catch (error) {
        log('warn', 'academy_ticker_talk_failed', { path, error: String(error && error.message || error) });
        sendJson(response, 500, { ok: false, error: 'talk_failed' }); return;
      }
    }

    /* Ask Obi's log, for backtesting: every question and answer with the call it made. Owner only. */
    if (path === '/academy-activity/ask/log' || path === '/academy-activity/ask/stats' || /^\/academy-activity\/ask\/log\/\d+\/score$/.test(path)) {
      const session = academyOAuth && academyOAuth.verifySession(request.headers.authorization);
      if (!session || !session.ok) { sendJson(response, session?.status || 401, { ok: false, error: session?.code || 'authorization_required' }); return; }
      const owner = Boolean(academyAsk && academyAsk.owners && academyAsk.owners.has(String(session.userId)));
      if (!owner) { sendJson(response, 403, { ok: false, error: 'owner_only' }); return; }
      const store = academyAsk.log;
      if (!store) { sendJson(response, 503, { ok: false, error: 'log_unavailable' }); return; }
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      if (request.method === 'GET' && path === '/academy-activity/ask/stats') { sendJson(response, 200, { ok: true, ...(await store.stats()) }); return; }
      if (request.method === 'GET' && path === '/academy-activity/ask/log') { sendJson(response, 200, { ok: true, stored: store.configured, rows: await store.list({ limit: Number(params.get('limit')) || 100, directionOnly: params.get('direction') === '1', unscored: params.get('unscored') === '1' }) }); return; }
      if (request.method === 'POST' && path !== '/academy-activity/ask/log' && path !== '/academy-activity/ask/stats') {
        const raw = await readRequestBody(request, 4096).catch(() => null);
        let body = null; try { body = raw && raw.ok ? JSON.parse(raw.rawBody || '{}') : null; } catch (_) { body = null; }
        const id = path.split('/')[4];
        const r = await store.score(id, { outcome: body && body.outcome, note: body && body.note });
        sendJson(response, r.ok ? 200 : (r.error === 'not_found' ? 404 : 400), r);
        return;
      }
      sendJson(response, 405, { ok: false, error: 'method_not_allowed' });
      return;
    }

    /* Ask Obi: owner only. GET says whether the signed-in account may use it (the client shows the button on yes);
       POST { question } answers from the Academy's own material in Obi's voice. Nobody else gets past the owner check. */
    if (path === '/academy-activity/ask') {
      const session = academyOAuth && academyOAuth.verifySession(request.headers.authorization);
      if (!session || !session.ok) { sendJson(response, session?.status || 401, { ok: false, error: session?.code || 'authorization_required' }); return; }
      const owner = Boolean(academyAsk && academyAsk.owners && academyAsk.owners.has(String(session.userId)));
      if (request.method === 'GET') { sendJson(response, 200, { ok: true, owner, configured: Boolean(owner && academyAsk && academyAsk.configured) }); return; }
      if (request.method !== 'POST') { sendJson(response, 405, { ok: false, error: 'method_not_allowed' }); return; }
      if (!owner) { sendJson(response, 403, { ok: false, error: 'owner_only' }); return; }
      if (!academyAsk.configured) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const raw = await readRequestBody(request, 16_384).catch(() => null);
      let body = null; try { body = raw && raw.ok ? JSON.parse(raw.rawBody || '{}') : null; } catch (_) { body = null; }
      if (!body || typeof body.question !== 'string' || !body.question.trim()) { sendJson(response, 400, { ok: false, error: 'empty_question' }); return; }
      try {
        const result = await academyAsk.ask({ question: body.question, userId: session.userId, symbol: typeof body.symbol === 'string' ? body.symbol : '' });
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        const invalid = error instanceof TypeError;
        const limited = error && (error.code === 'rate_limited' || error.code === 'provider_rate_limited');
        logger(invalid ? 'warn' : 'error', 'academy_ask_failed', { error, userId: session.userId });
        sendJson(response, invalid ? 400 : (limited ? 429 : 503), { ok: false, error: invalid ? 'empty_question' : (limited ? (error.code === 'rate_limited' ? 'rate_limited' : 'provider_rate_limited') : (error.code || 'ask_failed')), detail: invalid || !error.status ? '' : 'Claude answered ' + error.status });
      }
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/slide-design') {
      /* the designer answers with a built-in deck when Claude is not configured, so only a missing designer is a 503 */
      if (!academySlideDesigner) {
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
      if (!lessonOpenTo(session.tier || 'member', params.get('moduleId'), params.get('lessonId'))) { sendJson(response, 403, { ok: false, error: 'lesson_locked' }); return; }
      try {
        const result = await academySlideDesigner.getLessonDesign({
          moduleId: params.get('moduleId'), lessonId: params.get('lessonId'), userId: designUserId
        });
        sendJson(response, 200, { ok: true, cached: result.cached, ...result.design });
      } catch (error) {
        const invalid = error instanceof TypeError;
        const limited = error && (error.code === 'rate_limited' || error.code === 'provider_rate_limited');
        // a failure remembered from the last few minutes is answered without calling the provider again; it is not a new error
        logger(invalid || (error && error.cached) ? 'warn' : 'error', 'academy_slide_design_failed', {
          error, userId: designUserId, moduleId: params.get('moduleId'), lessonId: params.get('lessonId'), cached: !!(error && error.cached)
        });
        sendJson(response, invalid ? 400 : (limited ? 429 : 503), {
          ok: false, error: invalid ? 'invalid_lesson' : (limited ? 'rate_limited' : 'design_temporarily_unavailable')
        });
      }
      return;
    }

    /* Live push of whatever chain is currently loaded (Server-Sent Events), the same one-poll-per-symbol
       shape as /academy-activity/sire-stream. Requires a real session, unconditionally (unlike sire-stream,
       options data is never shown to a free session) — a plain EventSource cannot carry that header, so the
       client reads this with fetch, exactly like it already does for /academy-activity/data/options. */
    if (request.method === 'GET' && path === '/academy-activity/options-stream') {
      if (!academyOAuth || !academyOptionsStream) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      const symbol = new URL(request.url || '/', 'http://localhost').searchParams.get('symbol');
      if (streamClients >= 400) { sendJson(response, 503, { ok: false, error: 'stream_busy' }); return; }
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      const write = (event, data) => { sseEvent(response, event, data); };
      const off = academyOptionsStream.subscribe(symbol, write);
      if (!off) { write('error', { ok: false, error: 'invalid_symbol' }); response.end(); return; }
      streamClients += 1;
      const beat = setInterval(() => { sseWrite(response, ': keep-alive\n\n'); }, 15_000);
      let closed = false;
      const done = () => { if (closed) return; closed = true; clearInterval(beat); off(); streamClients -= 1; };
      request.on('close', done); response.on('close', done);
      return;
    }

    /* One options contract's own candles (the premium), for the mini chart that opens on a double-click in the chain.
       Members only, like the chain itself; the contract is the OCC symbol (SPY251219C00600000) the chain row names. */
    if (request.method === 'GET' && path === '/academy-activity/option-bars') {
      if (!academyOAuth || !optionBars || !optionBars.enabled) { sendJson(response, 503, { ok: false, error: 'option_bars_unavailable' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      const obq = new URL(request.url || '/', 'http://localhost').searchParams;
      try {
        const result = await optionBars.get(obq.get('contract'), obq.get('tf') || '5m');
        sendJson(response, result.status || (result.ok ? 200 : 503), result.ok ? { ok: true, ...result.data } : { ok: false, error: result.code });
      } catch (error) {
        if (error instanceof TypeError) { sendJson(response, 400, { ok: false, error: error.message }); return; }
        logger('error', 'academy_option_bars_failed', { error });
        sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
      }
      return;
    }

    if (request.method === 'GET' && /^\/academy-activity\/data\/(options|earnings)$/.test(path)) {
      if (!academyOAuth || !academyDataBridge) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      const kind = path.endsWith('/options') ? 'options' : 'earnings';
      const dataParams = new URL(request.url || '/', 'http://localhost').searchParams;
      const symbol = dataParams.get('symbol');
      try {
        const result = await academyDataBridge.get(kind, symbol, { expiration: dataParams.get('expiration') || '' }, { priority: 'interactive' });
        sendJson(response, result.status || (result.ok ? 200 : 503), result.ok ? { ok: true, data: result.data, ...(result.stale ? { stale: true } : {}) } : { ok: false, error: result.code, ...(result.detail ? { detail: result.detail } : {}) });
      } catch (error) {
        logger(error instanceof TypeError ? 'warn' : 'error', 'academy_data_request_failed', { kind, error });
        sendJson(response, error instanceof TypeError ? 400 : 503, { ok: false, error: error instanceof TypeError ? 'invalid_symbol' : 'academy_data_unavailable' });
      }
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/data/short') {
      if (!academyOAuth || !academyAlerts) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      const dataParams = new URL(request.url || '/', 'http://localhost').searchParams;
      const symbol = String(dataParams.get('symbol') || '').toUpperCase();
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      try {
        // The alerts desk's lookup swallows provider failures and returns null, so null is an outage (or an unreachable feed), not an empty answer.
        const data = await academyAlerts.shortData(symbol);
        if (data == null) { sendJson(response, 503, { ok: false, error: 'short_data_unavailable' }); return; }
        sendJson(response, 200, { ok: true, data });
      } catch (error) {
        logger(error instanceof TypeError ? 'warn' : 'error', 'academy_short_data_request_failed', { error });
        sendJson(response, error instanceof TypeError ? 400 : 503, { ok: false, error: error instanceof TypeError ? 'invalid_symbol' : 'short_data_unavailable' });
      }
      return;
    }

    /* Short-sale insight (academy-short-insight.js): short volume against the price path, short interest against the price, the
       "pressing" and "squeeze" scores from the Level 3 book, the Massive tape, the flow ledger and the chain, and a verdict for a
       short seller and for a long. Paid tiers, like the short data itself. */
    if (request.method === 'GET' && path === '/academy-activity/short-insight') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      const svc = getShortInsight();
      if (!svc) { sendJson(response, 503, { ok: false, error: 'insight_unavailable' }); return; }
      const gate = academyDataLimit.take(request);
      if (!gate.ok) { response.setHeader('retry-after', String(gate.retryAfterSec)); sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
      const sq = new URL(request.url || '/', 'http://localhost').searchParams;
      const symbol = String(sq.get('symbol') || '').toUpperCase();
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      try { const out = await svc.insight(symbol); sendJson(response, out.ok ? 200 : (out.status || 503), out); }
      catch (error) { logger('error', 'academy_short_insight_failed', { symbol, error }); sendJson(response, 503, { ok: false, error: 'insight_unavailable' }); }
      return;
    }

    /* The owner's squeeze list (academy-squeeze-list.js): the top 20 SQUEEZE RISK names across the active market. The GET says whether the
       account is the owner (the button shows on that); everyone else is refused. */
    /* ACADEMY EVOLVE (academy-evolve.js): the page's beacons (anyone), the knobs (anyone), the brief and the proposal queue (owner only) */
    if (request.method === 'POST' && path === '/academy-activity/evolve/event') {
      if (!academyEvolve) { sendJson(response, 204, {}); return; }
      const gate = academyDataLimit.take(request);
      if (!gate.ok) { response.writeHead(429, { 'retry-after': String(gate.retryAfterSec) }); response.end(); return; }
      const body = await readRequestBody(request, 8192);
      if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
      let input = null;
      try { input = JSON.parse(body.rawBody); } catch (_) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
      const events = input && Array.isArray(input.events) ? input.events.slice(0, 40) : (input && typeof input === 'object' ? [input] : []);
      let taken = 0;
      for (const ev of events) if (academyEvolve.observeEvent(ev)) taken += 1;
      response.writeHead(204, { 'cache-control': 'no-store' }); response.end();
      void taken;
      return;
    }
    if (request.method === 'GET' && path === '/academy-activity/evolve/config') {
      if (!academyEvolve) { sendJson(response, 503, { ok: false, error: 'evolve_unavailable' }); return; }
      sendJson(response, 200, { ok: true, ...academyEvolve.config() });
      return;
    }
    /* the builder session reads this over plain HTTPS: proposals and brief summaries only, nothing a member wrote */
    if (request.method === 'GET' && path === '/academy-activity/evolve/queue') {
      if (!academyEvolve) { sendJson(response, 503, { ok: false, error: 'evolve_unavailable' }); return; }
      sendJson(response, 200, await academyEvolve.queue());
      return;
    }
    if (path === '/academy-activity/evolve' || path.startsWith('/academy-activity/evolve/')) {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      const owner = OWNER_IDS.includes(String(session.userId));
      const eq = new URL(request.url || '/', 'http://localhost').searchParams;
      if (!owner) { sendJson(response, eq.get('probe') ? 200 : 403, { ok: !!eq.get('probe'), owner: false, error: eq.get('probe') ? undefined : 'owner_only' }); return; }
      if (eq.get('probe')) { sendJson(response, 200, { ok: true, owner: true }); return; }
      if (!academyEvolve) { sendJson(response, 503, { ok: false, error: 'evolve_unavailable' }); return; }
      if (request.method === 'GET' && path === '/academy-activity/evolve') { sendJson(response, 200, await academyEvolve.snapshot()); return; }
      if (request.method === 'POST') {
        if (!contentTypeIsJson(request)) { sendJson(response, 415, { ok: false, error: 'content_type_required' }); return; }
        const body = await readRequestBody(request, 4096);
        if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
        let input = {};
        try { input = JSON.parse(body.rawBody) || {}; } catch (_) { sendJson(response, 400, { ok: false, error: 'invalid_json' }); return; }
        if (path === '/academy-activity/evolve/run') {
          try { const brief = await academyEvolve.runBrief({ reason: 'owner' }); sendJson(response, 200, { ok: true, brief }); }
          catch (error) { logger('error', 'academy_evolve_run_failed', { error: String((error && error.message) || error) }); sendJson(response, 503, { ok: false, error: 'brief_failed' }); }
          return;
        }
        if (path === '/academy-activity/evolve/proposal') {
          const row = academyEvolve.setProposal(String(input.id || ''), String(input.status || ''));
          sendJson(response, row ? 200 : 404, row ? { ok: true, proposal: row } : { ok: false, error: 'not_found' });
          return;
        }
        if (path === '/academy-activity/evolve/knob') {
          const k = academyEvolve.setKnob(String(input.knob || ''), input.value, { pinned: typeof input.pinned === 'boolean' ? input.pinned : null });
          sendJson(response, k ? 200 : 404, k ? { ok: true, knob: k } : { ok: false, error: 'not_found' });
          return;
        }
      }
      sendJson(response, 404, { ok: false, error: 'not_found' });
      return;
    }
    if (request.method === 'GET' && path === '/academy-activity/squeeze-list') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      const owner = OWNER_IDS.includes(String(session.userId));
      const zq = new URL(request.url || '/', 'http://localhost').searchParams;
      if (!owner) { sendJson(response, zq.get('probe') ? 200 : 403, { ok: !!zq.get('probe'), owner: false, error: zq.get('probe') ? undefined : 'owner_only' }); return; }
      if (zq.get('probe')) { sendJson(response, 200, { ok: true, owner: true }); return; }
      const svc = getSqueezeList();
      if (!svc) { sendJson(response, 503, { ok: false, owner: true, error: 'insight_unavailable' }); return; }
      try { sendJson(response, 200, { owner: true, ...svc.list({ refresh: zq.get('refresh') === '1' }) }); }
      catch (error) { logger('error', 'academy_squeeze_list_failed', { error }); sendJson(response, 503, { ok: false, owner: true, error: 'insight_unavailable' }); }
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/sentiment') {
      if (!academyOAuth || !academySentiment) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      const gate = academyDataLimit.take(request);
      if (!gate.ok) { response.setHeader('retry-after', String(gate.retryAfterSec)); sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
      const symbol = String(new URL(request.url || '/', 'http://localhost').searchParams.get('symbol') || '').toUpperCase();
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      try { sendJson(response, 200, await academySentiment.get(symbol)); }
      catch (error) { logger('error', 'academy_sentiment_failed', { error }); sendJson(response, 503, { ok: false, error: 'sentiment_unavailable' }); }
      return;
    }

    /* Gamma pressure (academy-gamma.js): Academy members, paid tiers. Dealer side is inferred and labelled as such. */
    /* Live pattern examples: other stocks forming the same chart pattern on the same interval right now, one click away. */
    if (request.method === 'GET' && path === '/academy-activity/pattern-live') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      const gate = academyDataLimit.take(request);
      if (!gate.ok) { response.setHeader('retry-after', String(gate.retryAfterSec)); sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
      const pq = new URL(request.url || '/', 'http://localhost').searchParams;
      const type = String(pq.get('type') || '').toLowerCase().replace(/[^a-z_]/g, '').slice(0, 40), tf = String(pq.get('tf') || '5m').slice(0, 4), exclude = String(pq.get('exclude') || '').toUpperCase().slice(0, 10), dir = String(pq.get('dir') || '').slice(0, 7), kind = String(pq.get('kind') || 'chart').slice(0, 6);
      if (!type) { sendJson(response, 400, { ok: false, error: 'invalid_pattern' }); return; }
      try { sendJson(response, 200, await patternLive.examples({ kind, type, tf, exclude, dir, limit: Math.min(8, Number(pq.get('limit')) || 6) })); }
      catch (error) { logger('warn', 'academy_pattern_live_failed', { type, tf, error: String(error && error.message || error) }); sendJson(response, 503, { ok: false, error: 'pattern_live_unavailable' }); }
      return;
    }

    /* Smart-money intent (academy-smart-intent.js): the Massive tape, the moomoo book, the dark-pool prints, the gamma walls, the SMC
       map and the volume profile fused into one read: what the big money is doing and where it is placed. Members only; 15 s cache. */
    /* The Article Desk's live chart feed (academy-article-desk.js): a published piece on stockmarketloop.com polls this for
       the last price and the recent candles, so its chart and price chips move. Public by design (the article is public),
       one symbol per call, rate-limited, cached 30 s, and answered with CORS for the site's origin only. */
    /* one symbol's chart feed: the recent daily and intraday candles and the last price, cached 30 s, or null */
    const articleChartPayload = async (symbol) => {
      const hit = articleChartCache.get(symbol);
      if (hit && hit.until > Date.now()) return hit.payload;
      const candlesOf = async (tf) => { if (marketHistory && marketHistory.enabled) { const r = await marketHistory.get(symbol, tf); if (r && r.ok) return r.data; } return getAcademyCandles(symbol, tf); };
      const [dailyP, intraP] = await Promise.all([settledValue(candlesOf('1D'), 4_000), settledValue(candlesOf('5m'), 4_000)]);
      const pack = (r, n) => (r && Array.isArray(r.bars) ? r.bars.slice(-n).map((b) => [Number(b.t), Number(b.o), Number(b.h), Number(b.l), Number(b.c), Number(b.v) || 0]) : []);
      const daily = pack(dailyP, 80), intraday = pack(intraP, 160);
      const peek = academyMassive && typeof academyMassive.peek === 'function' ? academyMassive.peek(symbol) : null;
      const lastBar = intraday.length ? intraday[intraday.length - 1] : (daily.length ? daily[daily.length - 1] : null);
      const last = peek && Number(peek.last) > 0 ? Number(peek.last) : (lastBar ? lastBar[4] : null);
      const prevClose = daily.length >= 2 ? daily[daily.length - 2][4] : null;
      if (last == null) return null;
      const payload = { ok: true, symbol, asOf: Date.now(), quote: { last, prevClose, changePct: prevClose ? Math.round((last / prevClose - 1) * 10000) / 100 : null, source: peek && Number(peek.last) > 0 ? 'live' : 'bars' }, daily, intraday };
      articleChartCache.set(symbol, { until: Date.now() + 30_000, payload });
      if (articleChartCache.size > 300) articleChartCache.delete(articleChartCache.keys().next().value);
      return payload;
    };
    if (request.method === 'GET' && path === '/academy-activity/article-chart') {
      const origin = String(request.headers.origin || '');
      const allowed = origin && (origin === SITE_ORIGIN || /^https:\/\/([a-z0-9-]+\.)*stockmarketloop\.com$/i.test(origin) || /^https:\/\/[a-z0-9-]+\.onrender\.com$/i.test(origin));
      const cors = allowed ? corsHeaders(origin) : {};
      const send = (status, body) => { const payload = JSON.stringify(body); response.writeHead(status, { ...cors, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), 'cache-control': 'public, max-age=20', 'x-content-type-options': 'nosniff' }); response.end(payload); };
      const gate = academyDataLimit.take(request);
      if (!gate.ok) { response.setHeader('retry-after', String(gate.retryAfterSec)); send(429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
      const cq = new URL(request.url || '/', 'http://localhost').searchParams;
      const symbol = String(cq.get('symbol') || '').toUpperCase();
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { send(400, { ok: false, error: 'invalid_symbol' }); return; }
      try {
        const payload = await articleChartPayload(symbol);
        if (!payload) { send(503, { ok: false, error: 'no_data' }); return; }
        send(200, payload);
      } catch (error) { logger('warn', 'academy_article_chart_failed', { symbol, error: String(error && error.message || error) }); send(503, { ok: false, error: 'temporary_unavailable' }); }
      return;
    }
    /* The chart as a small page of its own, for places that allow an iframe but no script (and for anyone who opens the
       link): the candles and the last price drawn on the server from the same feed, fresh at every load, with a script
       that keeps the price line moving where script is allowed. Any page may frame it: it is public data and does nothing. */
    if (request.method === 'GET' && path === '/academy-activity/article-chart-embed') {
      const symbol = String(new URL(request.url || '/', 'http://localhost').searchParams.get('symbol') || '').toUpperCase();
      const sendHtml = (status, html) => { response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=30', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors *" }); response.end(html); };
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendHtml(400, '<!doctype html><title>Invalid symbol</title><p>Invalid symbol</p>'); return; }
      const gate = academyDataLimit.take(request);
      if (!gate.ok) { response.setHeader('retry-after', String(gate.retryAfterSec)); sendHtml(429, '<!doctype html><title>Busy</title><p>Busy, try again shortly.</p>'); return; }
      let payload = null;
      try { payload = await articleChartPayload(symbol); } catch (error) { logger('warn', 'academy_article_chart_failed', { symbol, error: String(error && error.message || error) }); }
      const bars = payload ? payload.daily.map((b) => ({ t: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] })) : [];
      const drawn = payload ? articleChart.candleChart({ symbol, bars, price: payload.quote.last, count: 60, title: `$${symbol} daily`, subtitle: `Last ${payload.quote.last >= 1 ? '$' + Number(payload.quote.last).toFixed(2) : '$' + Number(payload.quote.last).toFixed(4)}${payload.quote.changePct != null ? ' · ' + (payload.quote.changePct >= 0 ? '+' : '') + Number(payload.quote.changePct).toFixed(2) + '%' : ''}. Delayed or as of the last trade. Not advice.` }) : { ok: false };
      const body = drawn.ok ? drawn.svg : '<div id="s">CHART TEMPORARILY UNAVAILABLE</div>';
      const script = drawn.ok ? `<script>(function(){var q=${JSON.stringify(symbol)};function px(v){return (Math.abs(v)>=1?'$'+Number(v).toFixed(2):'$'+Number(v).toFixed(4))}function move(p){var s=document.querySelector('svg.mem-chart');if(!s)return;var lo=+s.getAttribute('data-ymin'),hi=+s.getAttribute('data-ymax'),top=+s.getAttribute('data-top'),h=+s.getAttribute('data-h');if(!(hi>lo))return;var y=top+(hi-Math.min(hi,Math.max(lo,p)))/(hi-lo)*h,g=s.querySelector('.mem-live');if(!g)return;var ln=g.querySelector('line'),rc=g.querySelector('rect'),tx=g.querySelector('text');if(ln){ln.setAttribute('y1',y.toFixed(1));ln.setAttribute('y2',y.toFixed(1))}if(rc)rc.setAttribute('y',(y-9).toFixed(1));if(tx){tx.setAttribute('y',(y+4).toFixed(1));tx.textContent=px(p)}}function load(){fetch('/academy-activity/article-chart?symbol='+encodeURIComponent(q),{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(j){if(j&&j.ok&&j.quote&&j.quote.last>0)move(j.quote.last)}).catch(function(){})}setInterval(load,30000)})();</script>` : '';
      sendHtml(drawn.ok ? 200 : 503, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>$${symbol} chart</title><style>html,body{margin:0;background:#0b1119;color:#dbe6ee;font-family:system-ui,sans-serif}svg{display:block;width:100%;height:auto}#s{min-height:220px;display:grid;place-items:center;color:#8aa0ad;font:700 12px ui-monospace,monospace;letter-spacing:.08em}</style></head><body>${body}${script}</body></html>`);
      return;
    }
    if (request.method === 'GET' && path === '/academy-activity/intent') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      const gate = academyDataLimit.take(request);
      if (!gate.ok) { response.setHeader('retry-after', String(gate.retryAfterSec)); sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
      const iq = new URL(request.url || '/', 'http://localhost').searchParams;
      const symbol = String(iq.get('symbol') || '').toUpperCase(), tf = String(iq.get('tf') || '5m');
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      const ck = symbol + '|' + tf, hit = smartIntentCache.get(ck);
      if (hit && hit.until > Date.now()) { sendJson(response, 200, hit.payload); return; }
      try {
        if (academyMassive && typeof academyMassive.watch === 'function') academyMassive.watch(symbol);
        const [barsP, dailyP, gammaP] = await Promise.all([
          settledValue(getAcademyCandles(symbol, tf), 2_500),
          settledValue(getAcademyCandles(symbol, '1D'), 2_500),
          academyGamma ? settledValue(academyGamma.get(symbol), 2_000) : Promise.resolve(null)
        ]);
        const bars = barsP && Array.isArray(barsP.bars) ? barsP.bars : [];
        const adv = dailyP && Array.isArray(dailyP.bars) ? averageDailyVolume(dailyP.bars, 20) : null;
        const peek = academyMassive && typeof academyMassive.peek === 'function' ? academyMassive.peek(symbol) : null;
        const ticks = academyMassive && typeof academyMassive.ticks === 'function' ? academyMassive.ticks(symbol, 6000) : [];
        const deep = academyOrderFlow && typeof academyOrderFlow.deep === 'function' ? academyOrderFlow.deep(symbol) : null;
        const price = peek && Number(peek.last) > 0 ? Number(peek.last) : (deep && deep.prints.length ? Number(deep.prints[deep.prints.length - 1].price) : (bars.length ? Number(bars[bars.length - 1].c) : null));
        let smc = null; try { const lib = require('./academy-smart-money'); smc = bars.length >= 20 ? lib.analyze(bars) : null; } catch (_) { smc = null; }
        const dpHit = darkPoolCache.get(symbol);
        let darkPool = dpHit && dpHit.until > Date.now() && dpHit.payload && dpHit.payload.available ? dpHit.payload : null;
        if (!darkPool && peek && peek.stats) { try { const sum = liveDarkPoolSummary(peek.stats, { price }); darkPool = sum && sum.available ? sum : null; } catch (_) { darkPool = null; } }
        const read = analyzeSmartIntent({ symbol, ticks, prints: deep ? deep.prints : [], snaps: deep ? deep.snaps : [], bars, smc, darkPool, gamma: gammaP && gammaP.available ? gammaP : null, stats: peek ? peek.stats : null, price, adv, tick: price && price < 1 ? 0.0001 : 0.01, now: Date.now() });
        const payload = { ...read, tf, book: deep ? { closed: !!deep.closed, failing: !!deep.failing, asOf: deep.asOf } : null };
        smartIntentCache.set(ck, { until: Date.now() + 15_000, payload });
        if (smartIntentCache.size > 200) smartIntentCache.delete(smartIntentCache.keys().next().value);
        sendJson(response, 200, payload);
      } catch (error) { logger('warn', 'academy_intent_failed', { symbol, error: String(error && error.message || error) }); sendJson(response, 503, { ok: false, error: 'intent_unavailable' }); }
      return;
    }
    /* Price-target suggestion for the direction a member picks (academy-target-engine.js): three targets with odds, a stop, and the
       reasoning, from the stock's own history, the other tools, and the engine's own track record. direction=long|short|auto. */
    if (request.method === 'GET' && path === '/academy-activity/targets') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      const gate = academyDataLimit.take(request);
      if (!gate.ok) { response.setHeader('retry-after', String(gate.retryAfterSec)); sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
      const tl = targetLearner || (fallbackTargetLearner || (fallbackTargetLearner = createTargetLearner({})));
      const tq = new URL(request.url || '/', 'http://localhost').searchParams;
      const symbol = String(tq.get('symbol') || '').toUpperCase();
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      const wantDir = ['long', 'short'].includes(tq.get('direction')) ? tq.get('direction') : 'auto';
      const horizon = ['day', 'swing', 'position'].includes(tq.get('horizon')) ? tq.get('horizon') : 'swing';
      try {
        if (academyMassive && typeof academyMassive.watch === 'function') academyMassive.watch(symbol);
        const [p5, p1] = await Promise.all([settledValue(getAcademyCandles(symbol, '5m'), 4_000), settledValue(getAcademyCandles(symbol, '1D'), 4_000)]);
        const bars5 = p5 && Array.isArray(p5.bars) ? p5.bars : [], daily = p1 && Array.isArray(p1.bars) ? p1.bars : [];
        if (!bars5.length && !daily.length) { sendJson(response, 503, { ok: false, error: 'no_candles' }); return; }
        const peek = academyMassive && typeof academyMassive.peek === 'function' ? academyMassive.peek(symbol) : null;
        const last = bars5.length ? bars5[bars5.length - 1] : daily[daily.length - 1];
        const price = peek && Number(peek.last) > 0 ? Number(peek.last) : Number(last.c);
        /* what the other tools say, for each direction (MEM ALGO horizons, smart-money intent if it was read lately, sentiment, trend) */
        const evFor = async (side) => (academyClickAlert ? settledValue(academyClickAlert.evidenceFor(symbol, side), 4_000) : null);
        const [evLong, evShort] = wantDir === 'auto' ? await Promise.all([evFor('long'), evFor('short')]) : [wantDir === 'long' ? await evFor('long') : null, wantDir === 'short' ? await evFor('short') : null];
        const intentHit = smartIntentCache.get(symbol + '|5m'), intent = intentHit && intentHit.payload && intentHit.payload.intent ? intentHit.payload.intent : null;
        const sent = academySentiment ? await settledValue(Promise.resolve(academySentiment.get(symbol)), 2_500) : null;
        const sma20 = daily.length >= 20 ? daily.slice(-20).reduce((a, b) => a + Number(b.c), 0) / 20 : null;
        const auto = pickDirection({ alignLong: evLong && Number.isFinite(evLong.alignment) ? evLong.alignment : null, alignShort: evShort && Number.isFinite(evShort.alignment) ? evShort.alignment : null, intentSide: intent ? intent.side : null, intentStrength: intent ? intent.strength : 0, sentiment: sent && sent.available !== false && Number.isFinite(sent.score) ? Number(sent.score) : null, trend: sma20 ? Math.max(-1, Math.min(1, (price / sma20 - 1) * 10)) : null });
        const direction = wantDir === 'auto' ? auto.direction : wantDir;
        const ev = direction === 'long' ? evLong : evShort;
        const align = ev && Number.isFinite(ev.alignment) ? ev.alignment : null;
        const result = suggestPriceTargets({ symbol, direction, horizon, price, bars5, daily, align, learned: tl.learned() });
        if (!result.ok) { sendJson(response, 422, { ok: false, error: result.reason, symbol, detail: result.reason === 'not_enough_history' ? (horizon === 'day' ? 'The day horizon needs about a week of 5-minute candles for this stock; try swing.' : 'Not enough daily history for this stock yet.') : '' }); return; }
        const ignition = bars5.length ? ignitionRead.read(bars5, { now: Date.now() }) : null;
        if (ignition && ignition.active && ignition.direction === direction && (ignition.state === 'extended' || ignition.state === 'fading')) result.notes.unshift('A volume burst started ' + ignition.minutesAgo + ' minutes ago and price is already ' + ignition.fromClosePct + '% from the close: ' + (ignition.state === 'fading' ? 'volume is fading, so favour the nearer targets.' : 'this is a chase, so wait for a pull-back to a level.'));
        void tl.log(result).catch(() => {});
        const learning = tl.summary();
        sendJson(response, 200, { ...result, requested: wantDir, auto: wantDir === 'auto' ? auto : null, align, ignition, learning: { suggestionsOpen: learning.open, judged: learning.settled, bucketJudged: (learning.buckets.find((b) => b.bucket === result.bucket) || { n: 0 }).n } });
      } catch (error) { logger('warn', 'academy_targets_failed', { symbol, error: String(error && error.message || error) }); sendJson(response, 503, { ok: false, error: 'targets_unavailable' }); }
      return;
    }
    /* The pre-alert check for any alert a member is about to send by hand (the Click-to-Alert panel runs the same check inside its preview). */
    if (request.method === 'GET' && path === '/academy-activity/prealert') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      const gate = academyDataLimit.take(request);
      if (!gate.ok) { response.setHeader('retry-after', String(gate.retryAfterSec)); sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
      const pq = new URL(request.url || '/', 'http://localhost').searchParams;
      const symbol = String(pq.get('symbol') || '').toUpperCase();
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      const side = pq.get('side') === 'short' ? 'short' : 'long';
      const nn = (k) => { const v = Number(pq.get(k)); return Number.isFinite(v) && v > 0 ? v : null; };
      const entry = nn('entry'), target = nn('target'), stop = nn('stop');
      if (!target) { sendJson(response, 400, { ok: false, error: 'invalid_target' }); return; }
      const horizon = ['day', 'swing', 'mid', 'long'].includes(pq.get('horizon')) ? pq.get('horizon') : 'swing';
      try {
        const [p5, p1] = await Promise.all([settledValue(getAcademyCandles(symbol, '5m'), 4_000), settledValue(getAcademyCandles(symbol, '1D'), 4_000)]);
        const bars5 = p5 && Array.isArray(p5.bars) ? p5.bars : [], daily = p1 && Array.isArray(p1.bars) ? p1.bars : [];
        const peek = academyMassive && typeof academyMassive.peek === 'function' ? academyMassive.peek(symbol) : null;
        const last = bars5.length ? bars5[bars5.length - 1] : daily[daily.length - 1];
        const price = peek && Number(peek.last) > 0 ? Number(peek.last) : (last ? Number(last.c) : null);
        if (!(price > 0)) { sendJson(response, 503, { ok: false, error: 'no_price' }); return; }
        const [ev, earn] = await Promise.all([academyClickAlert ? settledValue(academyClickAlert.evidenceFor(symbol, side), 4_000) : null, academyAlerts && typeof academyAlerts.nextEarnings === 'function' ? settledValue(academyAlerts.nextEarnings(symbol), 3_000) : null]);
        const tl = targetLearner || fallbackTargetLearner;
        const result = prealertCheck({ symbol, side, entry: entry || price, target, stop, price, bars5, daily, alignment: ev && Number.isFinite(ev.alignment) ? ev.alignment : null, earningsDays: earn && earn.daysAway != null ? Number(earn.daysAway) : null, horizon, learned: tl ? tl.learned() : null });
        if (!result.ok) { sendJson(response, 422, { ok: false, error: result.reason }); return; }
        sendJson(response, 200, result);
      } catch (error) { logger('warn', 'academy_prealert_failed', { symbol, error: String(error && error.message || error) }); sendJson(response, 503, { ok: false, error: 'prealert_unavailable' }); }
      return;
    }
    /* Owner only: what the target engine has learned, and the forensics of the desk alerts on a symbol. */
    if (request.method === 'GET' && (path === '/academy-activity/targets/learning' || path === '/academy-activity/alert-forensics')) {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (!OWNER_IDS.includes(String(session.userId))) { sendJson(response, 403, { ok: false, error: 'owner_only' }); return; }
      const tl = targetLearner || (fallbackTargetLearner || (fallbackTargetLearner = createTargetLearner({})));
      if (path === '/academy-activity/targets/learning') { sendJson(response, 200, { ok: true, ...tl.summary() }); return; }
      const symbol = String(new URL(request.url || '/', 'http://localhost').searchParams.get('symbol') || '').toUpperCase();
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      try {
        const [p5, p1] = await Promise.all([settledValue(getAcademyCandles(symbol, '5m'), 6_000), settledValue(getAcademyCandles(symbol, '1D'), 6_000)]);
        const list = academyAutoPt ? academyAutoPt.snapshot().filter((a) => a.symbol === symbol).sort((x, y) => y.at - x.at).slice(0, 5) : [];
        const reports = list.map((a) => ({ key: a.key, status: a.status, report: alertForensics.analyzeAlert({ symbol, side: a.side, entry: a.entry, target: a.target, stop: a.stop, at: a.at, bars5: p5 && p5.bars, daily: p1 && p1.bars, detectedAt: a.hitAt }) }));
        sendJson(response, 200, { ok: true, symbol, alerts: reports });
      } catch (error) { logger('warn', 'academy_forensics_failed', { symbol, error: String(error && error.message || error) }); sendJson(response, 503, { ok: false, error: 'forensics_unavailable' }); }
      return;
    }
    if (request.method === 'GET' && path === '/academy-activity/gamma') {
      if (!academyOAuth || !academyGamma) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      const gate = academyDataLimit.take(request);
      if (!gate.ok) { response.setHeader('retry-after', String(gate.retryAfterSec)); sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
      const symbol = String(new URL(request.url || '/', 'http://localhost').searchParams.get('symbol') || '').toUpperCase();
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      try { sendJson(response, 200, await academyGamma.get(symbol)); }
      catch (error) { logger('error', 'academy_gamma_failed', { error }); sendJson(response, 503, { ok: false, error: 'gamma_unavailable' }); }
      return;
    }

    /* Institutional flow (academy-institutional.js): Academy members, paid tiers. Estimates from public prints and broker size buckets. */
    if (request.method === 'GET' && path === '/academy-activity/institutional') {
      if (!academyOAuth || !academyInstitutional) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      const gate = academyDataLimit.take(request);
      if (!gate.ok) { response.setHeader('retry-after', String(gate.retryAfterSec)); sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
      const symbol = String(new URL(request.url || '/', 'http://localhost').searchParams.get('symbol') || '').toUpperCase();
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      try { sendJson(response, 200, await academyInstitutional.get(symbol)); }
      catch (error) { logger('error', 'academy_institutional_failed', { error }); sendJson(response, 503, { ok: false, error: 'institutional_unavailable' }); }
      return;
    }

    /* The daily flow ledger read as a window (academy-flow-daily.js + academy-flow-read.js): the week for the swing and hold models. */
    if (request.method === 'GET' && path === '/academy-activity/flow-days') {
      if (!academyOAuth || !academyFlowDaily || !academyFlowDaily.configured) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      const params = new URL(request.url || '/', 'http://localhost').searchParams;
      const symbol = String(params.get('symbol') || '').toUpperCase();
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      const days = Math.max(2, Math.min(30, Number(params.get('days')) || 10));
      try { sendJson(response, 200, await academyFlowDaily.summary(symbol, days)); }
      catch (error) { logger('error', 'academy_flow_days_failed', { error }); sendJson(response, 503, { ok: false, error: 'flow_days_unavailable' }); }
      return;
    }

    /* How the newer signals have done (academy-signal-outcomes.js): hit rates and average moves per signal, side and band, and the sweep-versus-wall outcomes. */
    if (request.method === 'GET' && path === '/academy-activity/signal-outcomes') {
      if (!academyOAuth || !academySignalOutcomes || !academySignalOutcomes.configured) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      const days = Math.max(1, Math.min(365, Number(new URL(request.url || '/', 'http://localhost').searchParams.get('days')) || 30));
      try { sendJson(response, 200, await academySignalOutcomes.summary(days)); }
      catch (error) { logger('error', 'academy_signal_outcomes_failed', { error }); sendJson(response, 503, { ok: false, error: 'signal_outcomes_unavailable' }); }
      return;
    }

    /* Earnings playbook: the best upcoming reports with priced vs historical moves and the plays for each (?days, ?limit), or one symbol (?symbol). Paid tiers. */
    if (request.method === 'GET' && path === '/academy-activity/earnings-playbook') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      const gate = academyDataLimit.take(request);
      if (!gate.ok) { response.setHeader('retry-after', String(gate.retryAfterSec)); sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
      const svc = getEarningsPlaybook();
      if (!svc) { sendJson(response, 503, { ok: false, error: 'playbook_unavailable' }); return; }
      const pq = new URL(request.url || '/', 'http://localhost').searchParams;
      const symbol = String(pq.get('symbol') || '').toUpperCase();
      if (symbol && !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      try { sendJson(response, 200, symbol ? await svc.detail(symbol) : await svc.list({ days: Number(pq.get('days')) || 14, limit: Number(pq.get('limit')) || 10 })); }
      catch (error) { logger('error', 'academy_earnings_playbook_failed', { error }); sendJson(response, 503, { ok: false, error: 'playbook_unavailable' }); }
      return;
    }

    /* Earnings insight (academy-earnings-insight.js): the company's own quarters, the trend in margins and costs, a model of the next
       report with its own error band, the street, the priced move, short interest, filings, and an AI brief. Paid tiers. */
    if (request.method === 'GET' && path === '/academy-activity/earnings-insight') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      const svc = getEarningsInsight();
      if (!svc) { sendJson(response, 503, { ok: false, error: 'insight_unavailable' }); return; }
      const gate = academyDataLimit.take(request);
      if (!gate.ok) { response.setHeader('retry-after', String(gate.retryAfterSec)); sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
      const eq = new URL(request.url || '/', 'http://localhost').searchParams;
      const symbol = String(eq.get('symbol') || '').toUpperCase();
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      try { const out = await svc.insight(symbol); sendJson(response, out.ok ? 200 : (out.status || 503), out); }
      catch (error) { logger('error', 'academy_earnings_insight_failed', { symbol, error }); sendJson(response, 503, { ok: false, error: 'insight_unavailable' }); }
      return;
    }

    /* FDA decisions: upcoming PDUFA dates with approval/impact reads and plays (?days), or one symbol (?symbol). Paid tiers. */
    if (request.method === 'GET' && path === '/academy-activity/fda') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      const gate = academyDataLimit.take(request);
      if (!gate.ok) { response.setHeader('retry-after', String(gate.retryAfterSec)); sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
      const svc = getFdaService();
      if (!svc) { sendJson(response, 503, { ok: false, error: 'fda_unavailable' }); return; }
      const fq = new URL(request.url || '/', 'http://localhost').searchParams;
      const symbol = String(fq.get('symbol') || '').toUpperCase();
      if (symbol && !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      try { sendJson(response, 200, symbol ? await svc.detail(symbol) : await svc.upcoming({ days: Number(fq.get('days')) || 60, limit: Number(fq.get('limit')) || 15 })); }
      catch (error) { logger('error', 'academy_fda_failed', { error }); sendJson(response, 503, { ok: false, error: 'fda_unavailable' }); }
      return;
    }

    /* Surprise-news radar: moving names scored on pre-announcement fingerprints (?limit). Paid tiers. */
    if (request.method === 'GET' && path === '/academy-activity/catalyst-radar') {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      const gate = academyDataLimit.take(request);
      if (!gate.ok) { response.setHeader('retry-after', String(gate.retryAfterSec)); sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
      const svc = getCatalystRadar();
      if (!svc) { sendJson(response, 503, { ok: false, error: 'radar_unavailable' }); return; }
      try { sendJson(response, 200, await svc.scan({ limit: Number(new URL(request.url || '/', 'http://localhost').searchParams.get('limit')) || 20 })); }
      catch (error) { logger('error', 'academy_catalyst_radar_failed', { error }); sendJson(response, 503, { ok: false, error: 'radar_unavailable' }); }
      return;
    }

    /* Paper trading: MINE (per member) and CHALLENGE (the owner's account; owner only). Simulated throughout. */
    if (path === '/academy-activity/paper' || path.startsWith('/academy-activity/paper/')) {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      const owner = OWNER_IDS.includes(String(session.userId));
      const pq = new URL(request.url || '/', 'http://localhost').searchParams;
      const sub = path.slice('/academy-activity/paper'.length);
      if (pq.get('account') === 'challenge' && !owner) { sendJson(response, 403, { ok: false, error: 'owner_only' }); return; }
      const accountOf = (name) => (name === 'challenge' ? 'challenge' : 'u:' + session.userId);
      const opts = (name) => (name === 'challenge' ? { cash: 1000, name: "Grandmaster-obi's Challenge", owner: OWNER_IDS[0] || '' } : { cash: PAPER_START_CASH, name: 'My paper account', owner: String(session.userId) });
      try {
        if (request.method === 'GET' && sub === '') { const name = pq.get('account') === 'challenge' ? 'challenge' : 'me'; const snap = await academyPaper.snapshot(accountOf(name), opts(name)); sendJson(response, 200, { ...snap, account: name, me: { owner } }); return; }
        if (request.method === 'GET' && sub === '/calendar') { const name = pq.get('account') === 'challenge' ? 'challenge' : 'me'; sendJson(response, 200, await academyPaper.month(accountOf(name), pq.get('month'))); return; }
        if (request.method === 'GET' && sub === '/day') { const name = pq.get('account') === 'challenge' ? 'challenge' : 'me'; sendJson(response, 200, await academyPaper.day(accountOf(name), pq.get('date'))); return; }
        if (request.method === 'GET' && sub === '/chain') {
          if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
          const symbol = String(pq.get('symbol') || '').toUpperCase(); if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
          const rows = academyAlerts ? await academyAlerts.chainFor(symbol).catch(() => null) : null;
          if (!Array.isArray(rows) || !rows.length) { sendJson(response, 503, { ok: false, error: 'chain_unavailable' }); return; }
          const q = await paperQuote(symbol).catch(() => null);
          const list = rows.map((r) => ({ expiry: String(r.expiry || r.expiration || '').slice(0, 10), strike: Number(r.strike), call: r.call ? { bid: Number(r.call.bid) || null, ask: Number(r.call.ask) || null, oi: Number(r.call.oi ?? r.call.open_interest) || 0 } : null, put: r.put ? { bid: Number(r.put.bid) || null, ask: Number(r.put.ask) || null, oi: Number(r.put.oi ?? r.put.open_interest) || 0 } : null })).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.expiry) && r.strike > 0).sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike);
          sendJson(response, 200, { ok: true, symbol, spot: q && q.last ? q.last : null, expirations: [...new Set(list.map((r) => r.expiry))], rows: list }); return;
        }
        if (request.method === 'POST' && (sub === '/order' || sub === '/reset')) {
          const raw = await readRequestBody(request, 4_096).catch(() => null);
          let body = null; try { body = raw && raw.ok ? JSON.parse(raw.rawBody || '{}') : null; } catch (_) { body = null; }
          if (!body || typeof body !== 'object') { sendJson(response, 400, { ok: false, error: 'invalid_body' }); return; }
          const name = body.account === 'challenge' ? 'challenge' : 'me';
          if (name === 'challenge' && !owner) { sendJson(response, 403, { ok: false, error: 'owner_only' }); return; }
          if (sub === '/reset') { sendJson(response, 200, await academyPaper.reset(accountOf(name), opts(name))); return; }
          if (body.kind === 'option' && session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required', message: 'Options paper trading is part of the full Academy.' }); return; }
          const snapBefore = name === 'challenge' && body.kind !== 'option' ? await academyPaper.load('challenge', opts('challenge')).then((a) => JSON.parse(JSON.stringify({ positions: a.positions, trades: a.trades.slice(-200), cash: a.cash }))).catch(() => null) : null;
          const res = await academyPaper.order(accountOf(name), body, opts(name));
          sendJson(response, res.ok ? 200 : 400, res);
          // a hand trade on the challenge account is announced like any other, with the same disclosure
          if (res.ok && snapBefore) { try { const after = await academyPaper.load('challenge').then((a) => JSON.parse(JSON.stringify({ positions: a.positions, trades: a.trades.slice(-200), cash: a.cash }))); await postChallengeTrade(buildChallengeTradeEvent({ symbol: res.trade.symbol, side: res.trade.side, before: snapBefore, after, res, reason: body.note ? String(body.note).slice(0, 200) : 'by hand', now: Date.now() })); } catch (error) { logger('warn', 'challenge_hand_trade_post_failed', { error: String(error && error.message || error) }); } }
          return;
        }
        sendJson(response, 404, { ok: false, error: 'not_found' });
      } catch (error) { logger('error', 'academy_paper_failed', { error }); sendJson(response, 503, { ok: false, error: 'paper_unavailable' }); }
      return;
    }

    /* The challenge (simulated) is the owner's tool: every route answers the owner only (members follow it in the Discord channel). */
    if (path === '/academy-activity/challenge' || path.startsWith('/academy-activity/challenge/')) {
      if (!academyOAuth) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      const owner = OWNER_IDS.includes(String(session.userId)), me = { owner };
      if (!owner) { sendJson(response, 403, { ok: false, error: 'owner_only' }); return; }
      const c = getChallenge();
      if (!c) { sendJson(response, 503, { ok: false, error: 'challenge_off' }); return; }
      const sub = path.slice('/academy-activity/challenge'.length);
      try {
        if (request.method === 'GET' && sub === '') { const snap = await c.snapshot(); delete snap.byId; sendJson(response, 200, { ...snap, me }); return; }
        if (request.method === 'GET' && sub === '/ideas') { const since = Number(new URL(request.url || '/', 'http://localhost').searchParams.get('since')) || 0; sendJson(response, 200, { ok: true, ideas: await c.ideas({ since }), now: Date.now(), me }); return; }
        if (request.method === 'POST') {
          if (!owner) { sendJson(response, 403, { ok: false, error: 'owner_only' }); return; }
          const raw = await readRequestBody(request, 2_048).catch(() => null);
          let body = {}; try { body = raw && raw.ok ? JSON.parse(raw.rawBody || '{}') : {}; } catch (_) { body = {}; }
          if (!body || typeof body !== 'object') body = {};
          if (sub === '/take') { sendJson(response, 200, await c.take(body.id, { qty: body.qty })); return; }
          if (sub === '/skip') { sendJson(response, 200, await c.skip(body.id)); return; }
          if (sub === '/reset') { const snap = await c.reset(); delete snap.byId; sendJson(response, 200, { ...snap, me }); return; }
          if (sub === '/share') {
            const channelId = String(body.channelId || challengeShare.channelId || process.env.SML_CHALLENGE_CHANNEL_ID || '').trim();
            if (!/^\d{5,25}$/.test(channelId)) { sendJson(response, 400, { ok: false, error: 'no_channel', message: 'Paste the Discord channel id for the challenge posts once; it is remembered.' }); return; }
            const snap = await c.snapshot(); const art = challengeCard.render(snap, { now: Date.now() });
            if (!art.png) { sendJson(response, 503, { ok: false, error: 'image_unavailable', message: 'The picture engine is not available on this server.' }); return; }
            const s = snap.paper.summary, content = `**1K → 100K Challenge** · ${s.equity >= 0 ? '$' + s.equity.toLocaleString('en-US', { minimumFractionDigits: 2 }) : ''} · ${(s.returnPct >= 0 ? '+' : '') + s.returnPct}% on $${Math.round(s.deposited).toLocaleString('en-US')} put in${body.note ? '\n' + String(body.note).slice(0, 400) : ''}\n_Simulated account on real prices. Not advice._`;
            try { const posted = await siteTierDirectory.post(channelId, { content, allowed_mentions: { parse: [] } }, [{ name: art.name, bytes: art.png, contentType: 'image/png', alt: 'Challenge account card' }]); challengeShare.channelId = channelId; sendJson(response, 200, { ok: true, messageId: posted.id, channelId: posted.channelId }); }
            catch (error) { logger('warn', 'challenge_share_failed', { error: String(error && error.message || error) }); sendJson(response, Number(error && error.status) === 404 ? 404 : 503, { ok: false, error: 'post_failed', message: Number(error && error.status) === 404 ? 'The Academy bot is not in that server or channel.' : 'Discord did not accept the post. Try again in a minute.' }); }
            return;
          }
        }
        sendJson(response, 404, { ok: false, error: 'not_found' });
      } catch (error) { logger('error', 'academy_challenge_failed', { error }); sendJson(response, 503, { ok: false, error: 'challenge_unavailable' }); }
      return;
    }

    /* SEC filings (academy-filings.js): Academy members, paid tiers. Public EDGAR data, cached six hours per symbol. */
    if (request.method === 'GET' && path === '/academy-activity/filings') {
      if (!academyOAuth || !academyFilings) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const session = academyOAuth.verifySession(request.headers.authorization);
      if (!session.ok) { sendJson(response, session.status || 401, { ok: false, error: session.code }); return; }
      if (session.tier === 'free') { sendJson(response, 403, { ok: false, error: 'academy_access_required' }); return; }
      const gate = academyDataLimit.take(request);
      if (!gate.ok) { response.setHeader('retry-after', String(gate.retryAfterSec)); sendJson(response, 429, { ok: false, error: 'rate_limited', retryAfterSec: gate.retryAfterSec }); return; }
      const symbol = String(new URL(request.url || '/', 'http://localhost').searchParams.get('symbol') || '').toUpperCase();
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) { sendJson(response, 400, { ok: false, error: 'invalid_symbol' }); return; }
      try { sendJson(response, 200, await academyFilings.get(symbol)); }
      catch (error) { logger('error', 'academy_filings_failed', { error }); sendJson(response, 503, { ok: false, error: 'filings_unavailable' }); }
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
        ...(schema !== undefined ? { schema } : {}),
        /* provider health never fails the probe (the database does); it makes a dead vendor visible to monitors */
        data: dataStatusSummary(),
        /* what the process weighs, in MB: the instance has 512 MB and is killed without a word when it passes that */
        memory: memorySample()
      });
    } catch (error) {
      logger('error', 'health_database_unavailable', { error });
      sendJson(response, 503, { ok: false, service: 'sml-platform-api', database: 'unavailable' });
    }
  });
}

/** The process's memory in whole megabytes: resident set, V8 heap (total and in use), off-heap (Buffers, native) and the heap limit. */
function memorySample() {
  const m = process.memoryUsage();
  const mb = (n) => Math.round(n / 1048576);
  let heapLimit = null;
  try { heapLimit = mb(require('v8').getHeapStatistics().heap_size_limit); } catch (_) { heapLimit = null; }
  const out = { rss: mb(m.rss), heapTotal: mb(m.heapTotal), heapUsed: mb(m.heapUsed), external: mb(m.external), arrayBuffers: mb(m.arrayBuffers || 0), heapLimit, uptimeS: Math.round(process.uptime()) };
  if (loopMonitor) {
    const ns = (v) => Math.round(Number(v) / 1e6);
    out.loopP50 = ns(loopMonitor.percentile(50)); out.loopP99 = ns(loopMonitor.percentile(99)); out.loopMax = ns(loopMonitor.max);
    loopMonitor.reset();
  }
  return out;
}

function dataStatusSummary() {
  try {
    const snap = dataHealth.snapshot(dataStatusExtras());
    const providers = {};
    /* public: state only. Error text (auth codes, upstream messages) stays in the logs. */
    for (const [name, v] of Object.entries(snap.providers)) providers[name] = { state: v.state, ...(v.detail ? { detail: v.detail } : {}), ...(v.retryInMs ? { retryInMs: v.retryInMs } : {}) };
    const st = marketState();
    return { overall: snap.overall, session: st.session, marketOpen: st.open, et: st.et, providers };
  } catch (_) { return { overall: 'unknown' }; }
}

/* The UI is told which vendor answered (the two have different shapes and depth) and whether the preferred one was skipped. */
function tagOptionsSource(result, source, fellBack) {
  if (!result || !result.ok || !result.data || typeof result.data !== 'object') return result;
  return { ...result, data: { ...result.data, source, ...(fellBack ? { fallback: true } : {}), session: marketState().session, asOf: result.data.asOf || Date.now() } };
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
  /* Activity gate. With every Academy flag unset this is exactly manager +
     Monarch, all tier 'member'. SML_ACADEMY_MONARCH_ACCESS=0 drops Monarch;
     SML_ACADEMY_MEMBER_ROLE_IDS and the engine's lifetime role are member tier;
     SML_ACADEMY_ACCESS_ROLE_IDS adds the 'academy' tier ('Academy Student'). */
  const academyMemberRoleIds = [config.academyManagerRoleId, ...(config.academyMonarchAccess ? [config.academyMonarchRoleId] : []),
    ...config.academyMemberRoleIds, config.academyLifetimeRoleId].filter(Boolean);
  const academyGateFlags = config.academyContentGateEnabled || config.academyFreeSessions || config.academyAlertsTiering || config.academyBillingInDiscordLinks || Boolean(parseSkuIds(config.academyDiscordSkus).length);
  /* Loop Bucks passes: a member who has loaded Loop Bucks on stockmarketloop.com can buy Academy access in the app. Off until SML_ACADEMY_LB_PRICES is set; ACADEMY_LB_PASSES=off removes it. */
  /* one pass store for bought passes and the free trial, so a trial is recognised by the same access path */
  const academyPassStore = createPassStore({ pool: database.pool });
  const academyPasses = process.env.ACADEMY_LB_PASSES === 'off' ? null : createPassService({
    store: academyPassStore, wallet: createWalletClient({ baseUrl: config.loopKickBridgeUrl, secret: config.loopKickBridgeSecret }),
    prices: parsePassPrices(process.env.SML_ACADEMY_LB_PRICES), logger: log
  });
  const academyTrial = createAcademyTrial({
    clientId: config.academyAppId, clientSecret: config.academyClientSecret, publicUrl: config.academyTrialPublicUrl, store: academyPassStore,
    days: config.academyTrialDays, enabled: config.academyTrialEnabled, logger: log,
    buyUrl: config.academyBillingPublicUrl ? config.academyBillingPublicUrl + '/v1/academy/billing/buy' : '', botToken: config.academyBotToken,
    /* the server invite is an optional extra on the launch steps: the Academy runs anywhere in Discord once the Connect bot and the Academy are on the account */
    inviteUrl: String(process.env.SML_ACADEMY_INVITE_URL || process.env.SML_ACADEMY_BILLING_INVITE_URL || ''),
    /* sign up with Discord: the site account is made or matched during the trial sign-in (loop-kick-bridge register; built below, so late-bound) */
    bridge: () => loopKickBridge
  });
  log('info', 'academy_trial_runtime', { configured: academyTrial.configured, days: academyTrial.days, link: academyTrial.configured ? academyTrial.link : '', redirectUri: academyTrial.configured ? academyTrial.redirectUri : '' });
  if (academyTrial.configured) academyTrial.inspect().then((d) => log(d.checked && (!d.redirectRegistered || !d.userInstall) ? 'warn' : 'info', 'academy_trial_discord_check', d)).catch(() => {});
  /* Click-to-Alert paid with Loop Bucks: its own prices (SML_CLICK_ALERT_LB_PRICES), the same wallet. SML_CLICK_ALERT_SUBSCRIBE_URL adds a "subscribe with a card" button. */
  const academyClickAlertPasses = process.env.ACADEMY_LB_PASSES === 'off' ? null : createPassService({
    store: createPassStore({ pool: database.pool }), wallet: createWalletClient({ baseUrl: config.loopKickBridgeUrl, secret: config.loopKickBridgeSecret }),
    prices: parsePassPrices(process.env.SML_CLICK_ALERT_LB_PRICES), product: 'click_alert', subscribeUrl: process.env.SML_CLICK_ALERT_SUBSCRIBE_URL || '', logger: log
  });
  const academyAccessBase = createAcademyAccess({ guildId: config.academyGuildId,
    allowedRoleIds: [...academyMemberRoleIds, ...config.academyAccessRoleIds], memberRoleIds: academyMemberRoleIds,
    retryRateLimited: academyGateFlags || config.academyAccessRoleIds.length > 0,
    /* a member outside the Academy server is named by /users/@me so a held pass (bought, or the free trial) can let them in */
    identityAccess: config.academyBillingInDiscordLinks || academyTrial.configured || !!academyPasses ? createIdentityAccess({}) : null });
  const freeUsers = loadFreeUserIds();
  /* a pass already held only needs the store (the free trial writes one), so the pass check is on whenever the pass service exists, whether or not the Loop Bucks shop (prices + wallet) is configured */
  /* Discord in-app purchases (academy-entitlements.js): a member who bought Academy access inside the
     Activity gets in on that entitlement, with no role to grant. Off until SML_ACADEMY_DISCORD_SKUS is set. */
  const academyEntitlements = createEntitlements({
    appId: config.academyAppId, botToken: config.academyBotToken, skuIds: config.academyDiscordSkus, logger: log
  });
  if (academyEntitlements.configured) log('info', 'academy_entitlements_ready', { skus: academyEntitlements.skus().length });
  const academyAccessRoles = withFreeUsers(academyPasses ? withPasses(academyAccessBase, academyPasses) : academyAccessBase, freeUsers, createIdentityAccess({}));
  /* last in the chain: only a member refused for the Academy role is looked up against Discord's entitlements */
  const academyAccess = academyEntitlements.configured ? withEntitlements(academyAccessRoles, academyEntitlements) : academyAccessRoles;
  const academyOAuth = createAcademyOAuth({ clientId: config.academyAppId, clientSecret: config.academyClientSecret,
    redirectUri: config.discordRedirectUri, academyAccess, freeSessions: config.academyFreeSessions });
  /* The Academy in-app chat (switchable Day Trade / Swing Trade / Short Sale / Options Trading
     channels), over a real WebSocket at /academy-activity/chat. Reuses the same session tokens
     the Activity's HTTP routes verify with, so a chat connection is just as authenticated. */
  /* @mentions: who may be tagged (members who have signed in to the Academy, see the token route
     below) and the Discord DM a tagged member gets, from the Academy bot. hasAccess is checked at
     post time against the member's live tier (academyTierLive is defined further down; it is only
     called once the server is serving). */
  const academyDmClient = createDiscordDmClient({ token: config.academyBotToken || config.discordBotToken });
  const academyMentions = createMentionService({
    pool: database.pool, guildId: config.academyGuildId, logger: log,
    dm: academyDmClient,
    hasAccess: (userId) => academyTierLive(userId).then((tier) => tier !== 'none')
  });
  let academySocialNotify = null; // built below, once the follow / talk / wall stores exist; the chat hub reaches it late
  const academyChatHub = process.env.ACADEMY_CHAT === 'off' ? null : createChatHub({
    store: createChatStore({ pool: database.pool }), verifySession: (auth) => academyOAuth.verifySession(auth), logger: log, mentions: academyMentions,
    /* a root message in a live chat room is a post: the author's followers hear about it in LOOP-KICK */
    onPost: (row, who) => (academySocialNotify && row && row.parentId == null ? academySocialNotify.followedPost({ id: who.userId, name: who.displayName }, { source: 'chat', id: row.id, room: who.channel, body: row.body }) : null)
  });
  const academyGate = academyGateFlags ? Object.freeze({
    ...createAcademyContentGate({ enabled: config.academyContentGateEnabled, freePreview: config.academyFreePreview,
      freeSymbols: config.academyFreeSymbols, alertsTiering: config.academyAlertsTiering }),
    freeSessions: config.academyFreeSessions,
    inDiscordLinks: config.academyBillingInDiscordLinks,
    guildId: config.academyGuildId,
    /* the SKUs the Activity may offer through Discord's own checkout (academy-entitlements.js) */
    discordSkus: parseSkuIds(config.academyDiscordSkus),
    // In process over the shared database (the engine's issueHandoff); see createBillingHandoff.
    handoff: config.academyBillingInDiscordLinks
      ? createBillingHandoff({ pool: database.pool, publicUrl: config.academyBillingPublicUrl }) : null
  }) : null;
  // The API's Academy guild is otherwise never logged; the billing engine's preflight compares it with its own.
  log('info', 'academy_gate_runtime', { guildId: config.academyGuildId || null, contentGate: config.academyContentGateEnabled,
    freeSessions: config.academyFreeSessions, alertsTiering: config.academyAlertsTiering, inDiscordLinks: config.academyBillingInDiscordLinks,
    monarchAccess: config.academyMonarchAccess, accessRoles: config.academyAccessRoleIds.length, memberRoles: academyMemberRoleIds.length,
    handoff: Boolean(academyGate && academyGate.handoff && academyGate.handoff.configured) });
  const loopKickBridge = createLoopKickBridge({ baseUrl: config.loopKickBridgeUrl, secret: config.loopKickBridgeSecret, appUrl: config.loopKickAppUrl });
  const connectOAuth = config.discordConnectAppId && config.discordConnectClientSecret
    ? createAcademyOAuth({ clientId: config.discordConnectAppId, clientSecret: config.discordConnectClientSecret, academyAccess: createIdentityAccess({}) })
    : null;
  const { createAcademyDataBridge } = require('./academy-data-bridge');
  /* SML_ACADEMY_BRIDGE_TIMEOUT_MS: how long one site request may take. A cold ticker is fetched from the moomoo bridge
     before the site can answer, which takes well over the old 8 s; abandoning those made every chain load fail. */
  const rawAcademyDataBridge = createAcademyDataBridge({ baseUrl: config.academyBridgeUrl, secret: config.academyBridgeSecret, timeoutMs: Number(process.env.SML_ACADEMY_BRIDGE_TIMEOUT_MS) || undefined, fetchImpl: (u, o) => dataHealth.guardedFetch('moomoo-bridge', u, o) });
  const queuedMoomooBridge = createQueuedDataSource({
    source: rawAcademyDataBridge,
    // Five cold options calls per minute is the safe ceiling; cached and
    // identical in-flight requests never enter this queue.
    minimumIntervalMs: 12_100,
    marketOpen: (timestamp) => isMarketOpen(timestamp)
  });
  const massiveOptions = createMassiveOptions({ apiKey: config.massiveApiKey, enabled: config.massiveOptionsEnabled, fetchImpl: (u, o) => dataHealth.guardedFetch('massive-options', u, o), maxPages: Math.max(1, Math.min(8, Number(process.env.MASSIVE_OPTIONS_MAX_PAGES) || 4)) });
  const massiveShared = new Map(), massiveFlight = new Map();
  const massiveOptionsShared = (symbol, params = {}) => {
    const key = String(symbol || '').toUpperCase() + ':' + String(params.expiration || '');
    const hit = massiveShared.get(key);
    if (hit && Date.now() - hit.at < 8_000) return Promise.resolve(hit.v);
    if (massiveFlight.has(key)) return massiveFlight.get(key);
    const pr = massiveOptions.get('options', symbol, params).then((v) => {
      if (v && v.ok) { if (massiveShared.size >= 80) massiveShared.delete(massiveShared.keys().next().value); massiveShared.set(key, { at: Date.now(), v }); }
      return v;
    }).finally(() => massiveFlight.delete(key));
    massiveFlight.set(key, pr); return pr;
  };
  const academyDataBridge = {
    configured: queuedMoomooBridge.configured || massiveOptions.configured,
    /* opts.priority 'interactive': a member is waiting on this call (the chain lab, Click-to-Alert, the hedge panel); it goes to the
       front of the site queue. Everything else is a background sweep and takes the slots nobody is waiting on. */
    async get(kind, symbol, params = {}, opts = {}) {
      let fellBack = false;
      if (kind === 'options' && massiveOptions.configured) {
        /* the provider's snapshot is several pages: asked once for everyone who wants it in the same moment, and remembered for 8 s,
           instead of once per caller (the chain, the expiration list and the stream each asked separately) */
        const preferred = await massiveOptionsShared(symbol, params);
        if (preferred.ok) return tagOptionsSource(preferred, 'massive', false);
        fellBack = true;
      }
      const answer = await queuedMoomooBridge.get(kind, symbol, params, opts);
      /* the member-facing routes only say "unavailable"; the bridge's real reason (timeout, provider refusal, site error) goes here */
      if (answer && !answer.ok) log('warn', 'academy_data_source_failed', { kind, symbol: String(symbol || '').toUpperCase(), status: answer.status, code: answer.code, detail: answer.detail || '' });
      else if (answer && answer.stale) log('warn', 'academy_data_source_stale', { kind, symbol: String(symbol || '').toUpperCase(), asOf: answer.data && answer.data.asOf, detail: answer.failure && answer.failure.detail || '' });
      return tagOptionsSource(answer, 'moomoo', fellBack);
    }
  };
  /* Live push for whatever options chain is currently loaded, the same shared-poll-per-symbol
     shape as the SIRE feed: once loaded, a chain keeps refreshing on its own instead of going
     stale until someone clicks Load again. */
  const academyOptionsStream = academyDataBridge.configured ? createOptionsStream({
    fetchChain: (symbol) => academyDataBridge.get('options', symbol), logger: log
  }) : null;
  const academyProgress = createAcademyProgress({ pool: database.pool, guildId: config.academyGuildId });
  const orderFlowStore = createOrderFlowStore({ pool: database.pool });
  const academyOrderFlow = process.env.ACADEMY_ORDERFLOW === 'off' ? null : createOrderFlowService({
    origin: REDDIT_HUB_ORIGIN, store: orderFlowStore, logger: log, fetchImpl: (u, o) => dataHealth.guardedFetch('wordpress-orderflow', u, o),
    /* the Massive tape's sweeps for the sweep-versus-wall reader (the stream is built a few lines down; this is only called once polling runs) */
    tape: (s) => { try { const p = academyMassive && typeof academyMassive.peek === 'function' ? academyMassive.peek(s) : null; return p ? p.stats : null; } catch (_) { return null; } }
  });
  /* Research desk: the full order book (up to 60 levels a side) for SPY and QQQ, recorded to academy_depth_snapshots during market hours so the
     Level 2 signals can be replayed and measured. ACADEMY_DEPTH_RECORDER=off disables it; see academy-depth-recorder.js for the other settings. */
  const depthStore = createDepthStore({ pool: database.pool });
  const academyDepthRecorder = process.env.ACADEMY_DEPTH_RECORDER === 'off' ? null : createDepthRecorder({
    origin: REDDIT_HUB_ORIGIN, store: depthStore, logger: log, isMarketOpen,
    symbols: parseDepthSymbols(process.env.ACADEMY_DEPTH_RECORD_SYMBOLS),
    pollMs: Math.max(1000, Math.min(60_000, Number(process.env.ACADEMY_DEPTH_RECORD_POLL_MS) || 2500)),
    levels: Math.max(10, Math.min(60, Number(process.env.ACADEMY_DEPTH_RECORD_LEVELS) || 60)),
    retentionDays: Math.max(1, Math.min(365, Number(process.env.ACADEMY_DEPTH_RETENTION_DAYS) || 30)),
    fetchImpl: (u, o) => dataHealth.guardedFetch('wordpress-depth', u, o)
  });
  const alertTokens = [['alerts', config.alertsBotToken], ['connect', config.discordConnectBotToken], ['discord', config.discordBotToken], ['academy', config.academyBotToken]].filter(([, t]) => t).map(([label, token]) => ({ label, token }));
  const academyMassive = process.env.ACADEMY_MASSIVE_STREAM === 'off' ? null : createMassiveStream({ apiKey: config.massiveApiKey, logger: log });
  /* The Indicator Engine screener sweeps the scanner's symbols (ACADEMY_SCREENER_SYMBOLS, default 40) every ten minutes, reading each from the same cached candles the chart uses. */
  const academyScreener = process.env.ACADEMY_SCREENER === 'off' ? null : createScreenerService({
    candles: getAcademyCandles, logger: log, maxSymbols: Math.max(5, Math.min(100, Number(process.env.ACADEMY_SCREENER_SYMBOLS) || 40)),
    universe: async () => { const s = await getAcademyScanner(); return Array.isArray(s && s.rows) ? s.rows : []; }
  });
  dataStatusExtras = () => {
    const out = {};
    if (!config.massiveApiKey) out['massive-rest'] = { state: 'unconfigured' };
    if (academyMassive) {
      const w = academyMassive.status(), open = isMarketOpen();
      let state = 'ok', detail = '';
      if (!w.enabled) { state = 'unconfigured'; }
      else if (w.failedAuth) { state = 'down'; detail = 'websocket login rejected'; }
      else if (open && w.symbols > 0 && !w.connected) { state = 'degraded'; detail = 'reconnecting'; }
      else if (open && w.symbols > 0 && w.lastMessageAt && Date.now() - w.lastMessageAt > 120_000) { state = 'degraded'; detail = 'no data for over 2 minutes'; }
      out.websocket = { state, ...(detail ? { detail } : {}), connected: w.connected, symbols: w.symbols, filtered: w.filtered };
    }
    return out;
  };
  const marketHistory = createMassiveHistory({ apiKey: config.massiveApiKey, fetchImpl: (u, o) => dataHealth.guardedFetch('massive-rest', u, o), sanitize: (bars, tf) => sanitizeBars(bars, tf) });
  /* one contract's own candles for the options mini chart (same Massive key and breaker as the stock history) */
  const optionBars = createMassiveOptionBars({ apiKey: config.massiveApiKey, fetchImpl: (u, o) => dataHealth.guardedFetch('massive-rest', u, o) });
  /* Each member picks their own alert sources (servers -> channels or posters); SML_ACADEMY_ALERT_SOURCES=off brings back the fixed two-stream desk. */
  const perMemberAlerts = process.env.SML_ACADEMY_ALERT_SOURCES !== 'off';
  const academyAlerts = process.env.ACADEMY_ALERTS === 'off' ? null : createAlertsService({
    tokens: alertTokens, channels: perMemberAlerts ? [] : defaultChannels(), origin: REDDIT_HUB_ORIGIN, optionsChain: async (symbol) => { const r = await academyDataBridge.get('options', symbol); return r && r.ok ? r.data : null; }, earnings: async (symbol) => { const r = await academyDataBridge.get('earnings', symbol); return r && r.ok ? r.data : null; }, candles: (symbol, tf) => getAcademyCandles(symbol, tf), logger: log,
    orderFlow: (symbol) => (academyOrderFlow ? academyOrderFlow.peek(symbol) : null),
    patterns: (() => { try { return require('./academy-patterns').detect; } catch (_) { return null; } })(),
    // which member sent each Click-to-Alert post (their bot or the channel webhook is Discord's author): academyClickAlert is created further down
    attribution: async () => { const m = new Map(); if (!academyClickAlert) return m; for (const r of await academyClickAlert.store.recent({ sinceMs: 45 * 86_400_000 })) if (r.userId && r.messageId) m.set(String(r.messageId), { userId: String(r.userId), name: '' }); return m; }
  });
  /* Sentiment desk: scored news, StockTwits tags + velocity, options positioning (put/call, unusual flow, GEX, max pain) and market gauges (SPY/QQQ, VIX). */
  const sentimentCandles = async (symbol, tf) => {
    if (marketHistory.enabled && Object.prototype.hasOwnProperty.call(MASSIVE_TIMEFRAMES, tf)) { const r = await marketHistory.get(symbol, tf); if (r.ok) return r.data; }
    return getAcademyCandles(symbol, tf);
  };
  /* Market Direction engine: one shared read for the Academy panel and the stockmarketloop.com dashboard panel. */
  /* SML VIX: the CBOE VIX method on live SPY options (moomoo through the site bridge); two chain reads every 2 minutes in market hours */
  const smlVix = academyDataBridge.configured ? createVolIndex({
    chain: (symbol, expiration) => academyDataBridge.get('options', symbol, expiration ? { expiration } : {}),
    isOpen: (t) => isMarketOpen(t), logger: log
  }) : null;
  /* One Massive whole-market snapshot (~5 MB) shared by Market Direction internals and the wide live scanner. */
  const academySnapshots = String(config.massiveApiKey || '').trim() ? massiveSnapshots({ apiKey: config.massiveApiKey, fetchImpl: (u, o) => dataHealth.guardedFetch('massive-rest', u, o) }) : null;
  const academySharedSnapshot = academySnapshots ? createSharedSnapshot({ snapshotAll: academySnapshots.snapshotAll, logger: log, session: () => marketState().session }) : null;
  /* Live scanner pop-out: up to 500 liquid US stocks ranked live (site scanner rows + the whole-market snapshot). */
  const academyWideScanner = academySharedSnapshot && process.env.ACADEMY_WIDE_SCANNER !== 'off' ? createWideScanner({
    snapshots: academySharedSnapshot, base: () => getAcademyScanner(), logger: log,
    history: academySirePriceHistory, windowChange: calculateWindowChange, state: () => marketState()
  }) : null;
  const marketDirectionV1 = academySnapshots ? createMarketDirection({
    volIndex: smlVix,
    snapshotAll: academySharedSnapshot.snapshotAll, snapshotTickers: academySnapshots.snapshotTickers,
    candles: getAcademyCandles,
    tape: academyMassive && academyMassive.status().enabled ? academyMassive : null,
    /* the desk's background sweep: a ticker the provider lists no options for (thin names from the alert channels) is remembered for
       six hours, so the sweep stops asking the site for it every pass and tripping the site's rate limit for everyone else */
    optionsChain: academyDataBridge.configured ? (() => {
      const noChain = new Map(); const NO_CHAIN_MS = 6 * 3_600_000;
      return async (symbol) => {
        const key = String(symbol || '').toUpperCase(); const seen = noChain.get(key);
        if (seen && Date.now() - seen < NO_CHAIN_MS) return null;
        const r = await academyDataBridge.get('options', symbol);
        if (r && r.ok) { noChain.delete(key); return r.data; }
        if (r && /unusable response|no options|not optionable|no contracts/i.test(String(r.detail || ''))) { if (noChain.size >= 500) noChain.delete(noChain.keys().next().value); noChain.set(key, Date.now()); }
        return null;
      };
    })() : null,
    normalizeChain: require('./academy-alert-options').normalizeChain,
    logger: log
  }) : null;
  /* Market Direction v2 (academy-market-direction-v2.js) wraps the read above with the heavyweights inside SPY, breadth,
     regime-aware scoring with base rates, dealer gamma, cross-asset appetite, the catalyst calendar and a track record.
     Same payload fields, so the panel, MEM ALGO's direction factor, the challenge gate and the paper recap all read it as before.
     The services it leans on (gamma, sentiment, the earnings playbook) are created further down; they are reached lazily. */
  const marketDirection = marketDirectionV1 ? createMarketDirectionV2({
    base: marketDirectionV1,
    snapshotAll: academySharedSnapshot.snapshotAll, snapshotTickers: academySnapshots.snapshotTickers,
    candles: (symbol, tf) => sentimentCandles(symbol, tf),
    volIndex: smlVix,
    gamma: { get: (symbol) => (typeof academyGamma !== 'undefined' && academyGamma ? academyGamma.get(symbol) : null) },
    sentiment: { get: (symbol) => (typeof academySentiment !== 'undefined' && academySentiment ? academySentiment.get(symbol) : null) },
    company: academyAlerts && typeof academyAlerts.company === 'function' ? (symbol) => academyAlerts.company(symbol) : null,
    earningsWindow: (days) => { const pb = getEarningsPlaybook(); return pb && typeof pb.window === 'function' ? pb.window(days) : []; },
    calendarExtra: process.env.SML_MACRO_EVENTS || null,
    store: createPgStateStore({ pool: database.pool, key: 'spy-direction-calibration', defaultValue: () => ({ forecasts: {} }), logger: log }),
    logger: log
  }) : null;
  /* the sentiment panel's VIX gauge: the vendor index when the plan has it, else the SML VIX (CBOE method on SPY options) */
  const vendorVix = createVixFetcher({ apiKey: config.massiveApiKey, fetchImpl: (u, o) => dataHealth.guardedFetch('massive-indices', u, o) });
  const marketGauges = createMarketGauges({ candles: sentimentCandles, vix: async () => { const v = await vendorVix().catch(() => null); if (v) return v; if (!smlVix) return null; const s = await smlVix.get().catch(() => null); return s && s.ok ? { level: s.level, source: 'sml-vix' } : null; } });
  /* Reddit mentions (academy-reddit.js) ride inside the social leg next to StockTwits: official OAuth when the script-app
     credentials are set, public listing otherwise; SML_ACADEMY_REDDIT=off disables it. */
  const academyReddit = createRedditService({
    clientId: String(process.env.SML_REDDIT_CLIENT_ID || ''), clientSecret: String(process.env.SML_REDDIT_CLIENT_SECRET || ''),
    userAgent: String(process.env.SML_REDDIT_USER_AGENT || 'web:stockmarketloop-academy:1.0 (by /u/stockmarketloop)'),
    enabled: process.env.SML_ACADEMY_REDDIT !== 'off', logger: log
  });
  /* Claude reads headlines and untagged posts for the sentiment composite (academy-classifier.js); off without ANTHROPIC_API_KEY or with SML_ACADEMY_AI_SENTIMENT=off. */
  const sentimentClassifier = config.anthropicApiKey && process.env.SML_ACADEMY_AI_SENTIMENT !== 'off'
    ? createClassifier({ apiKey: config.anthropicApiKey, model: String(process.env.SML_ACADEMY_SENTIMENT_MODEL || 'claude-haiku-5-5'), logger: log })
    : null;
  /* ACADEMY EVOLVE: the Academy learns from its own use (academy-evolve.js); its knobs feed the services created below */
  const academyEvolve = createEvolve({
    store: createPgStateStore({ pool: database.pool, key: 'academy-evolve', defaultValue: () => ({}), logger: log }),
    ai: config.anthropicApiKey ? { apiKey: config.anthropicApiKey, model: config.academyAskModel } : null, logger: log,
    sources: { data: async () => dataStatusSummary(), outcomes: async () => (academySignalOutcomes && typeof academySignalOutcomes.summary === 'function' ? academySignalOutcomes.summary(7) : null) }
  });
  await academyEvolve.load();
  const academySentiment = academyAlerts ? createSentimentService({ ttlMs: academyEvolve.knob('sentimentTtlMs'),
    news: (s) => academyAlerts.newsFor(s), chain: (s) => academyAlerts.chainFor(s), market: () => marketGauges.get(), classifier: sentimentClassifier,
    social: async (s) => { const [st, rd] = await Promise.all([academyAlerts.socialFor(s).catch(() => null), academyReddit.posts(s)]); return mergeSocial(st, rd); },
    quote: async (s) => changeFromDaily((await sentimentCandles(s, '1D')).bars),
    memory: createSentimentMemory({ store: createPgStateStore({ pool: database.pool, key: 'sentiment', defaultValue: () => ({ baselines: {}, history: {} }), logger: log }), logger: log }),
    logger: log
  }) : null;
  /* Gamma pressure for the Academy: dealer hedge shares per 1% move against the stock's daily volume, walls, flip, 0DTE share. */
  const academyGamma = academyAlerts ? createGammaService({
    chain: (s) => academyAlerts.chainFor(s), candles: (s, tf) => sentimentCandles(s, tf),
    quote: async (s) => changeFromDaily((await sentimentCandles(s, '1D')).bars), logger: log
  }) : null;
  /* Earnings playbook (academy-earnings-playbook.js): built on first use because it leans on the Hedge & Income planner, which is created further down. */
  let earningsPlaybook = null;
  const getEarningsPlaybook = () => {
    if (earningsPlaybook || !academyDataBridge || !academyDataBridge.configured || !academyAlerts) return earningsPlaybook;
    earningsPlaybook = createEarningsPlaybook({
      calendar: async (month) => { const r = await academyDataBridge.get('calendar', 'US', { expiration: month + '-01' }); const d = r && r.ok && r.data ? (r.data.data || r.data) : null; return d && Array.isArray(d.events) ? d : null; },
      history: async (s) => { const r = await academyDataBridge.get('earnings', s); return r && r.ok ? r.data : null; },
      chain: (s) => academyAlerts.chainFor(s), candles: (s, tf) => sentimentCandles(s, tf),
      hedge: typeof academyHedge !== 'undefined' && academyHedge ? academyHedge : null,
      sentiment: academySentiment ? (s) => academySentiment.get(s) : null, logger: log
    });
    return earningsPlaybook;
  };
  /* FDA decisions (academy-fda.js): PDUFA dates from 8-K releases on EDGAR, approval and impact reads, plays with a hedge. Built on first use. */
  let fdaService = null;
  /* Earnings insight (academy-earnings-insight.js): built on first use from the site's financials feed, the bridge's earnings records,
     the playbook's priced move, the short feed, filings, news, and Claude for the brief when ANTHROPIC_API_KEY is set. */
  let earningsInsight = null;
  const siteJson = async (path) => { const res = await fetch(REDDIT_HUB_ORIGIN + path, { headers: { accept: 'application/json', 'user-agent': 'StockMarketLoop-Academy-Earnings/1.0' }, signal: AbortSignal.timeout(20_000) }); if (!res.ok) throw new Error('site_' + res.status); return res.json(); };
  const getEarningsInsight = () => {
    if (earningsInsight || process.env.SML_ACADEMY_EARNINGS_INSIGHT === 'off') return earningsInsight;
    earningsInsight = createEarningsInsight({
      financials: (s) => siteJson('/wp-json/sml-short/v1/financials?symbol=' + encodeURIComponent(s)),
      history: academyDataBridge && academyDataBridge.configured ? async (s) => { const r = await academyDataBridge.get('earnings', s); return r && r.ok ? r.data : null; } : null,
      playbook: (s) => { const pb = getEarningsPlaybook(); return pb ? pb.detail(s) : null; },
      news: (s) => siteJson('/wp-json/sml-ticker-news/v1/feed?symbol=' + encodeURIComponent(s)),
      filings: (s) => siteJson('/wp-json/sml-massive/v1/market-data/filings?symbol=' + encodeURIComponent(s) + '&limit=30'),
      shortData: (s) => siteJson('/wp-json/sml-short/v1/short?symbol=' + encodeURIComponent(s) + '&days=10'),
      ai: config.anthropicApiKey ? { apiKey: config.anthropicApiKey, model: config.academyAskModel } : null, logger: log
    });
    return earningsInsight;
  };
  /* Short-sale insight (academy-short-insight.js): the short feed read with the Level 3 book, the Massive tape, the flow ledger and the chain. Built on first use. */
  /* the smart-money intent read for the squeeze model (academy-smart-intent.js over the signed tape, the full book, the gamma walls and the volume profile) */
  const smartIntentFor = async (sym) => {
    if (academyMassive && typeof academyMassive.watch === 'function') academyMassive.watch(sym);
    const [barsP, gammaP] = await Promise.all([settledValue(getAcademyCandles(sym, '5m'), 2_500), academyGamma ? settledValue(academyGamma.get(sym), 2_000) : Promise.resolve(null)]);
    const bars = barsP && Array.isArray(barsP.bars) ? barsP.bars : [];
    const peek = academyMassive && typeof academyMassive.peek === 'function' ? academyMassive.peek(sym) : null;
    const ticks = academyMassive && typeof academyMassive.ticks === 'function' ? academyMassive.ticks(sym, 6000) : [];
    const deep = academyOrderFlow && typeof academyOrderFlow.deep === 'function' ? academyOrderFlow.deep(sym) : null;
    const price = peek && Number(peek.last) > 0 ? Number(peek.last) : (bars.length ? Number(bars[bars.length - 1].c) : null);
    let smc = null; try { smc = bars.length >= 20 ? require('./academy-smart-money').analyze(bars) : null; } catch (_) { smc = null; }
    let darkPool = null; if (peek && peek.stats) { try { const sum = liveDarkPoolSummary(peek.stats, { price }); darkPool = sum && sum.available ? sum : null; } catch (_) { darkPool = null; } }
    return analyzeSmartIntent({ symbol: sym, ticks, prints: deep ? deep.prints : [], snaps: deep ? deep.snaps : [], bars, smc, darkPool, gamma: gammaP && gammaP.available ? gammaP : null, stats: peek ? peek.stats : null, price, tick: price && price < 1 ? 0.0001 : 0.01, now: Date.now() });
  };
  let shortInsight = null;
  const getShortInsight = () => {
    if (shortInsight || process.env.SML_ACADEMY_SHORT_INSIGHT === 'off' || !academyAlerts) return shortInsight;
    const memAlgo = require('./academy-mem-algo');
    /* the scanner row for a symbol: float, shares outstanding, today's volume and relative volume (the wide scanner first, then the hub scanner) */
    const scannerRow = async (sym) => {
      const pick = (rows) => (Array.isArray(rows) ? rows.find((r) => String(r && r.symbol || '').toUpperCase() === sym) : null);
      let row = null;
      try { if (typeof academyWideScanner !== 'undefined' && academyWideScanner) { const w = await academyWideScanner.get(400); row = pick(w && w.rows) || null; } } catch (_) { row = null; }
      if (!row) { try { const sc = await getAcademyScanner(); row = pick(sc && sc.rows) || null; } catch (_) { row = null; } }
      if (row && (Number(row.sharesFloat) > 0 || Number(row.sharesOutstanding) > 0)) return row;
      /* a Massive-only row (or no row) has no float: the company record's shares outstanding stand in, so the squeeze
         model's supply math (float size, cover ratio, float turnover) still has a number to work with */
      try {
        const co = await settledValue(academyAlerts.company(sym), 3_000);
        const c = co && typeof co === 'object' ? (co.results || co.company || co) : null;
        const shares = c ? Number(c.share_class_shares_outstanding ?? c.weighted_shares_outstanding ?? c.sharesOutstanding ?? c.shares_outstanding) : NaN;
        if (Number.isFinite(shares) && shares > 0) return { ...(row || { symbol: sym }), sharesOutstanding: shares, marketCap: Number(c.market_cap ?? c.marketCap) || (row && row.marketCap) || null };
      } catch (_) { /* no company record */ }
      return row;
    };
    shortInsight = createShortInsight({
      shortData: (s) => academyAlerts.shortData(s), candles: (s, tf) => sentimentCandles(s, tf),
      orderFlow: academyOrderFlow ? (s) => academyOrderFlow.get(s) : null, tape: academyMassive ? (s) => academyMassive.peek(s) : null,
      flowDays: academyFlowDaily && academyFlowDaily.configured ? (s, d) => academyFlowDaily.summary(s, d) : null,
      chain: (s) => academyAlerts.chainFor(s), memAlgo: (bars) => memAlgo.analyze(bars, 'short', {}, '1D', {}),
      float: scannerRow, gamma: academyGamma ? (s) => academyGamma.get(s) : null, sentiment: academySentiment ? (s) => academySentiment.get(s) : null,
      intent: smartIntentFor, earnings: (s) => academyAlerts.nextEarnings(s), marketOpen: () => { try { return marketState().session === 'open'; } catch (_) { return null; } },
      ai: config.anthropicApiKey && process.env.SML_ACADEMY_SQUEEZE_AI !== 'off' ? { apiKey: config.anthropicApiKey, model: config.academyAskModel } : null, logger: log
    });
    return shortInsight;
  };
  /* the owner's squeeze list: the wide scanner's active names scored through the short insight, a few at a time */
  let squeezeList = null;
  const getSqueezeList = () => {
    if (squeezeList) return squeezeList;
    const si = getShortInsight(); if (!si) return null;
    /* two phases: the cheap fuel read screens the whole wide ranking plus the low-float lane, the top names get the full read;
       the last list lives in academy_state_kv so the button answers at once after a restart */
    squeezeList = createSqueezeList({ concurrency: academyEvolve.knob('squeezeConcurrency'), maxSymbols: academyEvolve.knob('squeezeMaxSymbols'), limit: 100, quickConcurrency: Number(process.env.SML_ACADEMY_SQUEEZE_QUICK_WORKERS) || 4,
      memoryOk: () => process.memoryUsage().rss < (Number(process.env.SML_ACADEMY_SQUEEZE_PAUSE_MB) || 1500) * 1024 * 1024, // the API runs on the 2 GB plan with a 1536 MB heap cap; pause only when it really is short
      insight: (s) => si.insight(s, { brief: false }), quick: typeof si.quick === 'function' ? (s) => si.quick(s) : null,
      store: createPgStateStore({ pool: database.pool, key: 'squeeze-list', defaultValue: () => ({ rows: [], at: 0 }), logger: log }),
      quickStore: createPgStateStore({ pool: database.pool, key: 'squeeze-quick', defaultValue: () => ({ items: {}, at: 0 }), logger: log }),
      universe: async () => { const w = typeof academyWideScanner !== 'undefined' && academyWideScanner ? await academyWideScanner.get(400) : await getAcademyScanner(); return w && Array.isArray(w.rows) ? w.rows : []; }, logger: log });
    return squeezeList;
  };
  /* the list is pre-built shortly after boot so the first press of SQUEEZE is served, not started; ACADEMY_SQUEEZE_PREWARM=off skips it */
  /* the pre-build waits until the boot has settled, and only runs when memory has room (the stored list serves the button meanwhile) */
  if (process.env.ACADEMY_SQUEEZE_PREWARM !== 'off') { const pre = setTimeout(() => { try { const rss = process.memoryUsage().rss / 1048576; if (rss > (Number(process.env.SML_ACADEMY_SQUEEZE_PREWARM_MB) || 420)) { log('info', 'squeeze_list_prewarm_skipped', { rss: Math.round(rss) }); return; } const l = getSqueezeList(); if (l) l.list({ touch: false }); } catch (error) { log('warn', 'squeeze_list_prewarm_failed', { error: String(error && error.message || error) }); } }, 4 * 60_000); if (pre.unref) pre.unref(); }
  const getFdaService = () => {
    if (fdaService || process.env.SML_ACADEMY_FDA === 'off') return fdaService;
    fdaService = createFdaService({
      userAgent: String(process.env.SML_SEC_USER_AGENT || DEFAULT_SEC_UA),
      candles: (s, tf) => sentimentCandles(s, tf), chain: academyAlerts ? (s) => academyAlerts.chainFor(s) : null,
      company: academyAlerts && typeof academyAlerts.company === 'function' ? (s) => academyAlerts.company(s) : null,
      shortData: academyAlerts && typeof academyAlerts.shortData === 'function' ? (s) => academyAlerts.shortData(s) : null,
      hedge: typeof academyHedge !== 'undefined' && academyHedge ? academyHedge : null, logger: log
    });
    return fdaService;
  };
  /* Surprise-news radar (academy-catalyst-radar.js): the wide scanner's moving names scored on pre-announcement fingerprints. Built on first use. */
  let catalystRadar = null;
  const getCatalystRadar = () => {
    if (catalystRadar || process.env.SML_ACADEMY_RADAR === 'off') return catalystRadar;
    catalystRadar = createCatalystRadar({
      universe: async () => { const w = typeof academyWideScanner !== 'undefined' && academyWideScanner ? await academyWideScanner.get(300) : null; return w && Array.isArray(w.rows) ? w.rows : []; },
      candles: (s, tf) => sentimentCandles(s, tf),
      sentiment: academySentiment ? (s) => academySentiment.get(s) : null,
      institutional: academyInstitutional ? (s) => academyInstitutional.get(s) : null,
      filings: academyFilings ? (s) => academyFilings.get(s) : null,
      shortData: academyAlerts && typeof academyAlerts.shortData === 'function' ? (s) => academyAlerts.shortData(s) : null,
      chain: academyAlerts ? (s) => academyAlerts.chainFor(s) : null,
      known: async () => { const pb = getEarningsPlaybook(), fd = getFdaService(); const [e, f] = await Promise.all([pb ? pb.window(7).catch(() => []) : [], fd ? fd.upcoming({ days: 7, limit: 40 }).catch(() => null) : null]); return (Array.isArray(e) ? e : []).concat(f && f.available ? f.events.map((x) => ({ symbol: x.symbol, type: 'FDA', date: x.date })) : []); },
      logger: log
    });
    return catalystRadar;
  };
  /* The $1,000 -> $100,000 challenge (academy-challenge.js): MEM ALGO's own SIMULATED portfolio on real prices, ticking every five
     minutes in regular hours. Built on first tick because it grades with services declared further down. SML_ACADEMY_CHALLENGE=off stops it. */
  let challenge = null; const challengeShare = { channelId: '' };
  let academyFlowDaily = null; // the daily flow ledger, built further down once the institutional service exists
  const HTF_OF = { '5m': '15m', '1D': '1W' };
  const challengeCtxFor = async (symbol, tf, bars) => {
    const get = async (fn, ms = 8_000) => { try { return await Promise.race([fn(), new Promise((r) => setTimeout(() => r(null), ms))]); } catch (_) { return null; } };
    const [htf, bench, earn, dir, sent, gx, inst, fil, week] = await Promise.all([
      HTF_OF[tf] ? get(() => sentimentCandles(symbol, HTF_OF[tf])) : null, symbol === 'SPY' ? null : get(() => sentimentCandles('SPY', tf)),
      academyAlerts ? get(() => academyAlerts.nextEarnings(symbol), 6_000) : null, marketDirection ? get(() => marketDirection.get(tf === '5m' ? 'day' : 'swing')) : null,
      academySentiment ? get(() => academySentiment.get(symbol), 10_000) : null, academyGamma ? get(() => academyGamma.get(symbol), 15_000) : null,
      academyInstitutional ? get(() => academyInstitutional.get(symbol), 6_000) : null, academyFilings ? get(() => academyFilings.get(symbol), 10_000) : null,
      academyFlowDaily && academyFlowDaily.configured ? get(() => academyFlowDaily.summary(symbol, 10), 4_000) : null
    ]);
    return { htf: htf && htf.bars ? htf.bars : null, bench: bench && bench.bars ? bench.bars : null, benchSelf: symbol === 'SPY',
      patterns: patternsLib && patternsLib.detect ? (b) => patternsLib.detect(b) : null, patternCache: new Map(),
      signals: memSignalsLib ? memSignalsLib.allVotes(bars) : null, orderFlow: academyOrderFlow ? (() => { try { return academyOrderFlow.get(symbol); } catch (_) { return null; } })() : null,
      earnings: earn && earn.daysAway != null ? { daysAway: earn.daysAway } : null, direction: dir, sentiment: sent, darkPool: null, gamma: gx, institutional: inst, filings: fil, flowDays: week && week.ok ? week : null };
  };
  /* a Discord DM to the owner from the Academy bot: open (or reuse) the DM channel, then post */
  const dmChannels = new Map();
  const discordDm = async (userId, content) => {
    const token = config.academyBotToken || config.alertsBotToken || config.discordBotToken; if (!token || !/^\d{5,25}$/.test(String(userId))) return false;
    const headers = { authorization: `Bot ${token}`, 'content-type': 'application/json', 'user-agent': 'StockMarketLoop-Academy/1.0' };
    try {
      let ch = dmChannels.get(String(userId));
      if (!ch) { const r = await fetch('https://discord.com/api/v10/users/@me/channels', { method: 'POST', headers, body: JSON.stringify({ recipient_id: String(userId) }), signal: AbortSignal.timeout(8_000) }); if (!r.ok) return false; const j = await r.json(); ch = String(j.id || ''); if (!ch) return false; dmChannels.set(String(userId), ch); }
      const r2 = await fetch(`https://discord.com/api/v10/channels/${ch}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: String(content).slice(0, 1900), allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(8_000) });
      return r2.ok;
    } catch (error) { log('warn', 'challenge_dm_failed', { error: String(error && error.message || error) }); return false; }
  };
  /* every challenge buy or sell goes to the channel: the words, the order card (logo, shares, price, total) and, on buys, the two scenario charts */
  const challengeLogos = challengePost.createLogoLookup({ apiKey: config.massiveApiKey, logger: log });
  const postChallengeTrade = async (ev) => {
    const channelId = String(challengeShare.channelId || process.env.SML_CHALLENGE_CHANNEL_ID || '').trim();
    if (!/^\d{5,25}$/.test(channelId)) { log('info', 'challenge_trade_not_posted', { symbol: ev.symbol, reason: 'no_channel' }); return; }
    const brand = await challengeLogos.lookup(ev.symbol).catch(() => null);
    const files = [];
    const card = challengePost.renderOrderCard(ev, { logo: brand && brand.logo, company: brand && brand.name, now: Date.now() });
    if (card.png) files.push({ name: card.name, bytes: card.png, contentType: 'image/png', alt: card.alt });
    if (ev.side === 'buy' && academyClickAlert && OWNER_IDS.length) {
      try {
        const pv = await academyClickAlert.preview(OWNER_IDS[0], { symbol: ev.symbol, target: ev.target || undefined, autoTarget: !ev.target });
        for (const im of (pv && pv.ok && pv.scenarios ? pv.scenarios.images : []) || []) { const png = challengeCardPng(im.svg); if (png) files.push({ name: im.name, bytes: png, contentType: 'image/png', alt: im.alt }); }
      } catch (error) { log('warn', 'challenge_scenarios_failed', { symbol: ev.symbol, error: String(error && error.message || error) }); }
    }
    try { await siteTierDirectory.post(channelId, { content: challengePost.composeTrade(ev), allowed_mentions: { parse: [] } }, files); }
    catch (error) { log('warn', 'challenge_trade_post_failed', { symbol: ev.symbol, error: String(error && error.message || error) }); }
  };
  const challengeCardPng = (svg) => { try { return require('./academy-scenario-image').png(svg); } catch (_) { return null; } };
  const getChallenge = () => {
    if (challenge || process.env.SML_ACADEMY_CHALLENGE === 'off') return challenge;
    challenge = createChallenge({
      onTrade: postChallengeTrade,
      store: createPgStateStore({ pool: database.pool, key: 'challenge-ideas', defaultValue: () => null, logger: log }), paper: academyPaper,
      candles: (s, tf) => sentimentCandles(s, tf), analyze: memAlgoEngine.analyze, ctxFor: challengeCtxFor,
      universe: async () => { const core = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AMD', 'AVGO', 'JPM', 'XOM', 'COST', 'NFLX', 'CRM', 'LLY', 'UNH', 'V', 'MA'].map((symbol) => ({ symbol })); const w = typeof academyWideScanner !== 'undefined' && academyWideScanner ? await academyWideScanner.get(80).catch(() => null) : null; return core.concat(w && Array.isArray(w.rows) ? w.rows.filter((r) => Number(r.price) >= 5) : []); },
      direction: marketDirection ? () => marketDirection.get('swing') : null, nextEarnings: academyAlerts ? (s) => academyAlerts.nextEarnings(s) : null,
      notify: async (idea) => {
        const text = challengePost.composeIdea(idea);
        for (const uid of OWNER_IDS) await discordDm(uid, text);
        if (academyPush) { try { await academyPush.sendTo(async (u) => OWNER_IDS.includes(String(u)), { kind: 'challenge', title: `💡 1K→100K: BUY ${idea.symbol} (grade ${idea.grade} ${idea.score})`, body: `${idea.qty} shares near $${idea.entry}, stop $${idea.stop}. Open the Academy to take it.`, tag: 'sml-challenge-' + idea.id, url: '/academy-activity/' }, { topic: 'challenge' + idea.id }); } catch (_) { /* push is best effort */ } }
      },
      logger: log
    });
    return challenge;
  };
  if (process.env.SML_ACADEMY_CHALLENGE !== 'off') {
    const runTick = () => { const c = getChallenge(); if (c) c.tick().catch((error) => log('warn', 'challenge_tick_error', { error: String(error && error.message || error) })); };
    const t0 = setTimeout(runTick, 90_000); if (t0.unref) t0.unref();
    const ti = setInterval(runTick, 5 * 60_000); if (ti.unref) ti.unref();
  }
  /* Paper trading (academy-paper.js): SIMULATED accounts on real prices. Live quote from the Massive stream when the symbol is watched
     (works pre/after-market), else the last 5-minute candle; option quotes from the chain the alerts desk already loads. */
  const paperQuote = async (symbol) => {
    const sym = String(symbol || '').toUpperCase();
    if (academyMassive && typeof academyMassive.peek === 'function') { try { if (typeof academyMassive.watch === 'function') academyMassive.watch(sym); const p = academyMassive.peek(sym, 120_000); if (p && (p.quote || p.last > 0)) return { bid: p.quote ? p.quote.bid : null, ask: p.quote ? p.quote.ask : null, last: p.last > 0 ? p.last : null, live: true }; } catch (_) { /* fall through */ } }
    const r = await sentimentCandles(sym, '5m').catch(() => null); const bars = r && Array.isArray(r.bars) ? r.bars : [];
    return bars.length ? { last: Number(bars[bars.length - 1].c), live: false } : null;
  };
  const paperOptionQuote = async ({ symbol, expiry, strike, right }) => {
    if (!academyAlerts) return null;
    const rows = await academyAlerts.chainFor(String(symbol || '').toUpperCase()).catch(() => null); if (!Array.isArray(rows)) return null;
    const row = rows.find((r) => String(r.expiry || r.expiration || '').slice(0, 10) === expiry && Math.abs(Number(r.strike) - Number(strike)) < 1e-6); if (!row) return null;
    const leg = right === 'P' ? row.put : row.call; if (!leg) return null;
    return { bid: Number(leg.bid) || null, ask: Number(leg.ask) || null, last: Number(leg.last) || null, oi: Number(leg.oi ?? leg.open_interest) || 0 };
  };
  const paperMarketDay = async (date) => {
    const r = await sentimentCandles('SPY', '1D').catch(() => null); const bars = r && Array.isArray(r.bars) ? r.bars : [];
    const i = bars.findIndex((b) => new Date(b.t).toISOString().slice(0, 10) === date); if (i < 1) return null;
    const out = { ok: true, spyChangePct: Math.round((bars[i].c / bars[i - 1].c - 1) * 10000) / 100, spyClose: bars[i].c };
    if (marketDirection && date === new Date().toISOString().slice(0, 10)) { const d = await marketDirection.get('day').catch(() => null); if (d && d.ok) { out.label = d.label; out.vix = d.vol && d.vol.level != null ? d.vol.level : null; } }
    return out;
  };
  /* Candle recap: bars for any chart timeframe (Massive direct, or derived like the market route), FINRA files, the
     smart-money and pattern libraries, the short-data feed, today's off-exchange tape and the sentiment service. */
  let candleRecap = null;
  const candleBarsFor = async (symbol, tf) => {
    if (!marketHistory || !marketHistory.enabled) return [];
    if (Object.prototype.hasOwnProperty.call(MASSIVE_TIMEFRAMES, tf)) { const r = await marketHistory.get(symbol, tf); return r && r.ok && r.data && Array.isArray(r.data.bars) ? r.data.bars : []; }
    const cfg = MASSIVE_DERIVED_TIMEFRAMES[tf];
    if (cfg) { const base = await marketHistory.get(symbol, cfg.base); return base && base.ok && base.data && Array.isArray(base.data.bars) ? resampleBars(base.data.bars, tf) : []; }
    return [];
  };
  /* Dark pool memory (academy-dark-pool-memory.js): per-symbol session footprints so the dark pool read can compare today
     with yesterday. Durable in academy_state_kv under dark-pool-memory. */
  const darkPoolMemory = createDarkPoolMemory({ store: createPgStateStore({ pool: database.pool, key: 'dark-pool-memory', defaultValue: () => ({ symbols: {} }), logger: log }), logger: log });
  const getCandleRecap = () => {
    if (candleRecap) return candleRecap;
    let smcLib = null; try { smcLib = require('./academy-smart-money'); } catch (_) { smcLib = null; }
    candleRecap = createCandleRecap({
      barsFor: candleBarsFor, fetchImpl: (u, o) => fetch(u, o), smc: smcLib, patterns: patternsLib,
      shortData: academyAlerts ? (s) => academyAlerts.shortData(s) : null,
      sentiment: academySentiment || null,
      darkPoolToday: marketHistory && marketHistory.enabled ? async (s) => { const rows = await marketHistory.trades(s, 50_000); const sum = sessionDarkPool(rows, { now: Date.now() }); const st = marketState(); return sum.available ? darkPoolMemory.annotate(s, sum, { date: String(st.et || '').slice(0, 10), sinceMs: etDayStartMs(st) }) : sum; } : null,
      logger: log
    });
    return candleRecap;
  };
  const academyPaper = createPaperService({
    storeFor: (id) => createPgStateStore({ pool: database.pool, key: 'paper:' + id, defaultValue: () => null, logger: log }),
    quote: paperQuote, optionQuote: paperOptionQuote, marketDay: paperMarketDay, logger: log
  });
  /* Institutional flow for the Academy: moomoo order-size buckets (via the site bridge) + sweeps and blocks from the Massive tape. */
  const academyInstitutional = createInstitutionalService({
    capital: academyDataBridge && academyDataBridge.configured ? async (s) => { const r = await academyDataBridge.get('capital', s); return r && r.ok && r.data && r.data.ok !== false ? (r.data.data || r.data) : null; } : null,
    tape: academyMassive && typeof academyMassive.peek === 'function' ? (s) => { if (typeof academyMassive.watch === 'function') academyMassive.watch(s); const p = academyMassive.peek(s); return p ? p.stats : null; } : null,
    logger: log
  });
  /* The daily flow ledger (academy_flow_days): the tape, the full-depth pressure, the Level 2 events and moomoo's size buckets folded once a
     minute per tracked symbol, so the swing and hold models read the week. ACADEMY_FLOW_DAYS=off disables it. */
  academyFlowDaily = process.env.ACADEMY_FLOW_DAYS === 'off' ? null : createFlowDaily({
    pool: database.pool, orderFlow: academyOrderFlow, massive: academyMassive, institutional: academyInstitutional, logger: log,
    extraSymbols: parseDepthSymbols(process.env.ACADEMY_DEPTH_RECORD_SYMBOLS)
  });
  /* Outcome measurement for the newer signals (academy_signal_outcomes): the depth reading's signals stamped with the mid and scored 1, 5 and 15 minutes
     later; the week's read stamped at the open and scored off the ledger 1, 3 and 5 trading days later. ACADEMY_SIGNAL_OUTCOMES=off disables it. */
  const academySignalOutcomes = process.env.ACADEMY_SIGNAL_OUTCOMES === 'off' ? null : createSignalOutcomes({ pool: database.pool, orderFlow: academyOrderFlow, flowDaily: academyFlowDaily, logger: log });
  /* SEC filings for the Academy: Form 4 insider buys/sells and 13D/13G stakes straight from EDGAR (no vendor, no key). */
  const academyFilings = process.env.SML_ACADEMY_FILINGS === 'off' ? null : createFilingsService({
    userAgent: String(process.env.SML_SEC_USER_AGENT || DEFAULT_SEC_UA), logger: log
  });
  /* Group Pro Tools for StockMarketLoop groups (setups, absorption, dark pool, options strategies, dashboard). */
  const groupTools = process.env.GROUP_TOOLS === 'off' ? null : createGroupTools({
    candles: sentimentCandles, stream: academyMassive, orderFlow: academyOrderFlow, orderFlowStore,
    alerts: academyAlerts, sentiment: academySentiment, logger: log
  });
  const siteTierDirectory = createDiscordDirectory({ tokens: alertTokens, logger: log });
  /* Session recap (academy-session-recap.js): the day written at the bell, morning / afternoon / into tomorrow, with its lettered chart.
     Any signed-in member can read it on /academy-activity/session-recap; after the close it is posted once to SML_SESSION_RECAP_CHANNEL_ID
     by the owner's Grandmaster-Obi bot (SML_OBI_BOT_TOKEN, the bot that already carries the alerts), or by the shared alert bots when that
     token is not set. The bot needs View Channel, Send Messages and Attach Files in the recap channel. */
  const recapDirectory = process.env.SML_OBI_BOT_TOKEN ? createDiscordDirectory({ tokens: [{ label: 'obi', token: process.env.SML_OBI_BOT_TOKEN }], logger: log }) : siteTierDirectory;
  const sessionRecap = createSessionRecap({
    barsFor: candleBarsFor, gamma: academyGamma ? (s) => academyGamma.get(s) : null,
    calendar: (o) => require('./academy-market-calendar').upcoming(o), calendarExtra: process.env.SML_MACRO_EVENTS || null, dayInfo: marketDayInfo,
    png: challengeCardPng, post: (channelId, body, files) => recapDirectory.post(channelId, body, files),
    store: createPgStateStore({ pool: database.pool, key: 'session-recap', defaultValue: () => ({ posted: {} }), logger: log }),
    channelId: String(process.env.SML_SESSION_RECAP_CHANNEL_ID || '').trim(), symbol: String(process.env.SML_SESSION_RECAP_SYMBOL || 'SPY').toUpperCase(), logger: log
  });
  if (/^\d{5,25}$/.test(String(process.env.SML_SESSION_RECAP_CHANNEL_ID || '').trim())) {
    const runRecap = () => sessionRecap.tick().then((r) => { if (r && r.ok) log('info', 'session_recap_posted', { day: r.day }); else if (r && r.error && !['outside_window', 'already_posted', 'not_trading_day'].includes(r.error)) log('warn', 'session_recap_skipped', { why: r.error }); }).catch((error) => log('warn', 'session_recap_tick_failed', { error }));
    setTimeout(runRecap, 2 * 60_000).unref(); setInterval(runRecap, 60_000).unref();
  }
  /* A member's Academy level right now, read by the bot (no Discord login needed): roles, free users and day passes.
     Used by the stockmarketloop.com alerts desk and by pop-out windows when they renew. */
  const academyTierLive = async (userId) => {
    if (freeUsers.has(userId)) return 'member';
    const held = await siteTierDirectory.memberRoles(config.academyGuildId, userId).catch(() => null);
    const memberRoles = academyMemberRoleIds.map(String).filter(Boolean);
    const accessRoles = config.academyAccessRoleIds.map(String);
    if (held && held.some((r) => memberRoles.includes(r))) return 'member';
    if (held && held.some((r) => accessRoles.includes(r))) return 'academy';
    if (academyPasses && await academyPasses.hasActive(userId).catch(() => false)) return 'academy';
    if (academyEntitlements.configured && await academyEntitlements.hasActive(userId).catch(() => false)) return 'academy';
    return held ? 'free' : 'none';
  };
  const academyAlertSources = academyAlerts && perMemberAlerts ? createAlertSources({
    store: createAlertSourceStore({ pool: database.pool }), directory: createDiscordDirectory({ tokens: alertTokens, logger: log }),
    alerts: academyAlerts, presets: defaultChannels(), logger: log,
    alertsTiering: !!(academyGate && academyGate.alertsTiering), ownerIds: [...OWNER_IDS],
    /* a linked stockmarketloop.com member's Academy level, read from their roles in the Academy server (no Discord login needed) */
    tierFor: academyTierLive
  }) : null;
  const academyPopout = createPopoutService();
  /* Quick Snapshot (chart picture to a Discord channel). ACADEMY_SNAPSHOT=off removes it. */
  const academySnapshot = process.env.ACADEMY_SNAPSHOT === 'off' ? null : createSnapshotService({ directory: createDiscordDirectory({ tokens: alertTokens, logger: log }), logger: log });
  /* MEM LAB: opt-in (ACADEMY_MEM_LAB=on). Reads the scanner's daily candles, proposes gated improvements; a human approves via the operator route. */
  const academyMemLab = process.env.ACADEMY_MEM_LAB === 'on' ? createMemLab({
    sources: [{ name: 'academy-scanner-1D', load: async () => { const rows = ((await getAcademyScanner()) || {}).rows || []; const out = []; for (const r of rows.slice(0, 60)) { try { out.push({ symbol: String(r.symbol).toUpperCase(), bars: (await getAcademyCandles(String(r.symbol).toUpperCase(), '1D')).bars }); } catch (_) {} } return out; } }],
    store: createPgStateStore({ pool: database.pool, key: 'mem-lab', fallback: memLabFileStore(process.env.ACADEMY_MEM_LAB_FILE || '/tmp/sml-mem-lab.json'), defaultValue: () => ({ champion: null, pending: null, runs: [] }), logger: log }), autoPromote: process.env.ACADEMY_MEM_LAB_AUTOPROMOTE === 'on', log
  }) : null;
  if (academyMemLab) academyMemLab.schedule();
  /* Chat profile cards (avatar, Discord profile, linked StockMarketLoop profile). ACADEMY_PROFILE_CARDS=off removes them. */
  /* Member profile pages (schema 045): settings, follows, presence per server, the post feed and the paper leaderboard. */
  /* Trading Wall: comments members leave on each other's profile pages (academy-profile-wall.js). */
  const academyProfileWall = createProfileWall({ pool: database.pool, logger: log });
  void academyProfileWall.ensureSchema();
  /* The alert record (academy-alert-record.js): every Click-to-Alert post and the owner's desk alerts since SML_ALERT_RECORD_SINCE
   * (2026-10-05), scored against the bars; the 90-day win rate and top ten are public on every profile. SML_ALERT_RECORD=off disables it. */
  const academyAlertRecord = process.env.SML_ALERT_RECORD === 'off' ? null : createAlertRecord({
    pool: database.pool, candles: (s, tf) => sentimentCandles(s, tf),
    quote: async (s) => { const p = academyMassive ? academyMassive.peek(s) : null; if (p && Number.isFinite(p.last) && p.last > 0) return { last: p.last }; const c = changeFromDaily((await sentimentCandles(s, '1D')).bars); return c && Number.isFinite(c.price) ? { last: c.price } : null; },
    deskAlerts: academyAlerts ? () => academyAlerts.records() : null, backfill: academyAlerts ? (sinceMs) => academyAlerts.backfill({ sinceMs }) : null,
    ownerIds: [...OWNER_IDS], since: process.env.SML_ALERT_RECORD_SINCE || '2026-10-05', logger: log
  });
  if (academyAlertRecord) { void academyAlertRecord.ensureSchema(); academyAlertRecord.start(); }
  const academyProfilePages = process.env.ACADEMY_PROFILE_PAGES === 'off' ? null : createProfilePages({
    pool: database.pool, chat: createChatStore({ pool: database.pool }), paper: academyPaper, tierLive: academyTierLive,
    directory: createDiscordDirectory({ tokens: alertTokens, logger: log }), wall: academyProfileWall, talk: () => tickerTalk, bridge: loopKickBridge, alertRecord: academyAlertRecord, logger: log
  });
  if (academyProfilePages) void academyProfilePages.ensureSchema();
  const academyProfiles = process.env.ACADEMY_PROFILE_CARDS === 'off' ? null : createProfileService({ directory: createDiscordDirectory({ tokens: alertTokens, logger: log }), bridge: loopKickBridge, logger: log });
  /* Click-to-Alert is off until SML_ACADEMY_CLICK_ALERT_ROLE_IDS names the role the separate subscription grants. ACADEMY_CLICK_ALERT=off disables it outright. */
  /* A member's own bot (their name and picture) carries the alerts posted into their server: the owner's from SML_OBI_BOT_TOKEN, an
     analyst's from the token they paste in the Academy (academy-persona-bots.js: checked with Discord, stored encrypted under
     SML_PERSONA_ENCRYPTION_KEY, SML_EMAIL_ENCRYPTION_KEY as the fallback key). Without one the shared bots (SML Connect) post. */
  const personaRegistry = createPersonaBots({
    store: createPgStateStore({ pool: database.pool, key: 'persona-bots', defaultValue: () => ({ users: {} }), logger: log }),
    encryptionKey: process.env.SML_PERSONA_ENCRYPTION_KEY || process.env.SML_EMAIL_ENCRYPTION_KEY || '',
    createDirectory: ({ label, token }) => createDiscordDirectory({ tokens: [{ label, token }], logger: log }),
    ownerIds: OWNER_IDS, ownerToken: process.env.SML_OBI_BOT_TOKEN || '', logger: log
  });
  const personaBots = personaRegistry.map;
  void personaRegistry.load().then((r) => { if (r && r.ok && r.loaded) log('info', 'persona_bots_loaded', { loaded: r.loaded }); }).catch((error) => log('warn', 'persona_bots_load_failed', { error }));
  /* Trader or Analyst edition, chosen by the member (academy-editions.js) */
  const academyEditions = createEditions({ store: createPgStateStore({ pool: database.pool, key: 'academy-editions', defaultValue: () => ({ users: {} }), logger: log }), logger: log });
  /* an analyst's own letters publisher: the same signed service call as the owner's, made as their linked site account */
  const analystPublishers = new Map();
  const analystPublisherFor = (wpUserId) => {
    const id = Number(wpUserId) || 0; if (!id || !config.academyBridgeSecret) return null;
    let pub = analystPublishers.get(id);
    if (!pub) { pub = createLettersPublisher({ siteUrl: config.wordpressUrl, authorId: id, secret: config.academyBridgeSecret, serviceUserId: id, minIntervalMs: 1500, retryCount: 4, logger: log }); analystPublishers.set(id, pub); if (analystPublishers.size > 200) analystPublishers.delete(analystPublishers.keys().next().value); }
    return pub;
  };
  /* the analyst's Article Desk: who they write as, or null when the edition, the site link or the letters publisher is missing */
  const analystDeskFor = async (userId, displayName, tier = '') => {
    const me = String(userId || '');
    /* the stored edition is a choice; analyst level is what pays for it, so both must hold (an edition picked
       before the Analyst SKU existed does not keep the publishing tools) */
    if (tier && !tierAnalyst(tier)) return { ok: false, error: 'academy_analyst_required' };
    if (await academyEditions.get(me) !== 'analyst') return { ok: false, error: 'analyst_edition_required' };
    const wp = alertChartBilling ? await alertChartBilling.wpUserOf(me).catch(() => 0) : 0;
    if (!wp) return { ok: false, error: 'site_not_linked' };
    const publisher = analystPublisherFor(wp);
    if (!publisher || !publisher.signed()) return { ok: false, error: 'letters_unconfigured' };
    let ident = null; try { ident = await publisher.identity(); } catch (error) { return { ok: false, error: 'letters_identity_failed', detail: String(error && error.message || error) }; }
    return { ok: true, as: { publisher, byline: String(displayName || (ident && ident.name) || 'Analyst').slice(0, 60), authorPath: '/n/' + (ident && ident.slug ? String(ident.slug) : String(wp)) + '/', userId: me }, wp, ident };
  };
  const academyClickAlert = process.env.ACADEMY_CLICK_ALERT === 'off' ? null : createClickAlertService({
    getBars: getAcademyCandles, directory: createDiscordDirectory({ tokens: alertTokens, logger: log }),
    /* Click-to-Alert rides with the Analyst level: an Analyst posts it into their own server, so paying for
       Analyst is entitlement enough and the separate subscription role is no longer the only way in. The tier
       is read live (roles, Loop Bucks pass, Discord entitlement), so an ended Analyst stops posting at once. */
    analyst: async (userId) => ANALYST_TIERS.includes(await academyTierLive(String(userId || '')).catch(() => '')),
    /* posting caps (Discord posts, per member per hour / per day, per channel per hour); unset = the service defaults, 0 = no cap */
    limits: { userHour: process.env.SML_CLICK_ALERT_USER_HOUR, userDay: process.env.SML_CLICK_ALERT_USER_DAY, channelHour: process.env.SML_CLICK_ALERT_CHANNEL_HOUR },
    /* the member is waiting on this chain: ask the site directly at interactive priority rather than through the alert desk's
       background cache, which may be holding an empty answer from a sweep that was refused */
    chain: academyDataBridge.configured ? async (s) => { const r = await academyDataBridge.get('options', s, {}, { priority: 'interactive' }); return r && r.ok && r.data ? require('./academy-alert-options').normalizeChain(r.data) : null; } : (s) => (academyAlerts ? academyAlerts.chainFor(s) : null),
    chainExpiry: academyDataBridge.configured ? async (s, expiration) => { const r = await academyDataBridge.get('options', s, { expiration }, { priority: 'interactive' }); return r && r.ok ? r.data : null; } : null,
    /* why the last chain load for this symbol failed (bridge timeout, provider refusal), for the member-facing message */
    chainDetail: (s) => { const f = queuedMoomooBridge.lastFailure('options', s); return f && f.result ? String(f.result.detail || '') : ''; },
    /* every expiration the bridge lists (the chain itself loads the nearest ones), for the contract picker */
    expirations: academyDataBridge.configured ? async (s) => { const r = await academyDataBridge.get('options', s, {}, { priority: 'interactive' }); if (!(r && r.ok && r.data)) return []; const oc = require('./academy-options-chain'); return oc.expirations(r.data, oc.normalize(r.data)); } : null,
    /* the catalyst check: next earnings date (bridge) and this week's news (hub ticker feed) */
    catalysts: { earnings: academyDataBridge.configured ? async (s) => { const r = await academyDataBridge.get('earnings', s); return r && r.ok ? r.data : null; } : null, news: academyAlerts ? (s) => academyAlerts.newsFor(s) : null },
    store: createClickAlertStore({ pool: database.pool }), academyGuildId: config.academyGuildId, passes: academyClickAlertPasses, freeUserIds: freeUsers, personas: personaBots,
    roleIds: String(process.env.SML_ACADEMY_CLICK_ALERT_ROLE_IDS || '').split(',').map((v) => v.trim()).filter(Boolean),
    footer: process.env.SML_ACADEMY_CLICK_ALERT_FOOTER !== 'off', logger: log
  });
  /* Auto price-target updates (ACADEMY_AUTO_PT=dry decides and logs only, =on also posts): every alert is watched for five days; when its target is hit the Academy's data,
     sentiment and the market outlook decide a new target 12% to 40% beyond the live price. Off unless switched on. */
  /* desk (default): new targets are decided and shown on the Academy alerts desk with their write-up, nothing is posted; on: also posted to the alert's channel; dry: log only; off */
  const AUTO_PT_MODE = ['on', 'dry', 'desk', 'off'].includes(String(process.env.ACADEMY_AUTO_PT || '').toLowerCase()) ? String(process.env.ACADEMY_AUTO_PT).toLowerCase() : 'desk';
  // only the owner's own alert channels are ever posted to; alerts from channels members follow elsewhere stay on the desk
  const ownAlertChannels = new Set(defaultChannels().flatMap((c) => [String(c.id || ''), String(c.mirrorId || '')]).filter(Boolean));
  /* Web Push (phones and desktops, Academy closed): keys and subscriptions in academy_state_kv. ACADEMY_PUSH=off removes it. */
  const academyPush = process.env.ACADEMY_PUSH === 'off' ? null : createPushService({ pool: database.pool, subStore: createPgStateStore({ pool: database.pool, key: 'push-subs', defaultValue: () => ({ subs: {} }), logger: log }), logger: log });
  /* ALERT CHART: each trader's alerts as threads with live gain numbers; pushes go to followers who asked (academy-trader-alerts.js) */
  const traderAlerts = process.env.ACADEMY_ALERT_CHART === 'off' ? null : createTraderAlerts({
    pool: database.pool, candles: (symbol, tf) => getAcademyCandles(symbol, tf), push: academyPush, logger: log,
    names: async (id) => {
      try { if (academyProfilePages) { const s = await academyProfilePages.settingsOf(id); if (s && s.displayName) return s.displayName; } } catch (_) { /* fall through */ }
      try { if (academyProfiles) { const c = await academyProfiles.profile(id); return c && c.discord ? (c.discord.name || c.discord.username || '') : ''; } } catch (_) { /* fall through */ }
      return '';
    }
  });
  if (traderAlerts) traderAlerts.ensureSchema().catch(() => {});
  /* the member's own open alerts as standing lines on the chart (academy-alert-levels.js) */
  const alertLevels = createAlertLevels({ record: academyAlertRecord, traderAlerts, logger: log });
  /* TRADING ROOM: the room behind each profile (channels, free and paid access, tiers); ACADEMY_ROOMS=off removes it */
  const tradingRoom = process.env.ACADEMY_ROOMS === 'off' || !traderAlerts ? null : createTradingRoom({
    pool: database.pool, traderAlerts, logger: log,
    names: async (id) => {
      try { if (academyProfilePages) { const s = await academyProfilePages.settingsOf(id); if (s && s.displayName) return s.displayName; } } catch (_) { /* fall through */ }
      try { if (academyProfiles) { const c = await academyProfiles.profile(id); return c && c.discord ? (c.discord.name || c.discord.username || '') : ''; } } catch (_) { /* fall through */ }
      return '';
    }
  });
  if (tradingRoom) tradingRoom.ensureSchema().catch(() => {});
  /* would this member see this desk alert live right now? (their Academy level, read live from their roles, and the sources they follow) */
  const memberSeesAlertLive = async (userId, alertId) => {
    if (!academyAlerts) return false;
    const tier = await academyTierLive(String(userId)).catch(() => 'none');
    if (tier !== 'member' && tier !== 'academy') return false;
    const view = tier === 'academy' && academyGate && academyGate.alertsTiering ? 'closed' : 'live';
    if (!academyAlertSources) return view === 'live';
    const sources = (await academyAlertSources.viewFor(String(userId), view)).filter((x) => x.access);
    const src = academyAlerts.allows(String(alertId), sources);
    return !!(src && src.view === 'live');
  };
  /* who a price-target event goes to: a desk alert reaches every member who sees it live; a Click-to-Alert post reaches the member who sent it */
  const ptAudience = (u) => (String(u.key || '').startsWith('c:') ? (userId) => String(userId) === String(u.owner || '') : (userId) => memberSeesAlertLive(userId, String(u.key).slice(2)));
  /* Discord DMs (the Academy bot) for what should reach a member away from the app: their own alert's target hit or raised, and the
     owner's buy signals. Push cannot reach anyone inside the Discord app, so this is the path that always works. */
  // who the buy-signal radar is for: the owner, plus SML_ACADEMY_SIGNAL_USER_IDS
  const signalUserIds = new Set([...OWNER_IDS, ...String(process.env.SML_ACADEMY_SIGNAL_USER_IDS || '').split(',').map((v) => v.trim()).filter((v) => /^\d{15,25}$/.test(v))]);
  const academyDm = createDmNotifier({ dm: academyDmClient, logger: log, recipientsFor: (kind, p) => (kind === 'signal' ? [...signalUserIds] : (p && /^\d{5,25}$/.test(String(p.owner || '')) ? [String(p.owner)] : [])) });
  const pushTargetHit = (u) => {
    if (u && u.symbol) academyDm.targetHit(u).catch(() => {});
    if (!academyPush || !u || !u.symbol || (String(u.key || '').startsWith('c:') && !u.owner)) return;
    const px = (v) => (Number(v) >= 1 ? Number(v).toFixed(2) : Number(v).toFixed(4));
    const id = String(u.key).slice(2);
    const msg = {
      kind: 'pt', id, symbol: u.symbol, tag: 'sml-pthit-' + id, sticky: true,
      title: '🎯 ' + u.symbol + ' hit your price target $' + px(u.target),
      body: 'Entry $' + px(u.entry) + '. ' + (u.suggested ? 'MEM ALGO suggests a new PT of $' + px(u.suggested) + '. ' : '') + 'Open the Academy to post a new price target.',
      url: '/academy-activity/?symbol=' + encodeURIComponent(u.symbol) + '&ptalert=' + encodeURIComponent(id),
      update: { ...u }
    };
    academyPush.sendTo(ptAudience(u), msg, { topic: 'pthit' + id })
      .then((r) => log('info', 'push_target_hit', { symbol: u.symbol, ...r }))
      .catch((error) => log('warn', 'push_target_hit_failed', { error }));
  };
  const pushNewTarget = (u) => {
    if (u && u.symbol) academyDm.newTarget(u).catch(() => {});
    if (!academyPush || !u || !/^[dc]:/.test(String(u.key || ''))) return;
    const up = u.side !== 'short', px = (v) => (Number(v) >= 1 ? Number(v).toFixed(2) : Number(v).toFixed(4));
    const id = String(u.key).slice(2);
    const msg = {
      kind: 'pt', id, symbol: u.symbol, tag: 'sml-pt-' + id, sticky: true,
      title: '🎯 ' + u.symbol + ' new price target $' + px(u.target) + ' (' + (up ? '+' : '−') + u.pct + '%)',
      body: 'PT ' + u.n + ' $' + px(u.previous) + ' smashed.' + (u.stopRange ? ' Stop ' + (up ? 'raised to below $' : 'lowered to above $') + px(u.stopRange.low) + '–$' + px(u.stopRange.high) + '.' : '') + (u.why && u.why[0] ? ' ' + u.why.slice(0, 2).join('. ') + '.' : ''),
      url: '/academy-activity/?symbol=' + encodeURIComponent(u.symbol) + '&ptalert=' + encodeURIComponent(id),
      update: { key: u.key, id, symbol: u.symbol, n: u.n, at: u.at, target: u.target, previous: u.previous, pct: u.pct, price: u.price, entry: u.entry, side: u.side, stop: u.stop, stopRange: u.stopRange, stopWas: u.stopWas, signals: u.signals, story: u.story }
    };
    academyPush.sendTo(ptAudience(u), msg, { topic: 'pt' + id })
      .then((r) => log('info', 'push_new_target', { symbol: u.symbol, ...r }))
      .catch((error) => log('warn', 'push_new_target_failed', { error }));
  };
  /* The watcher reads the live trade feed for the range since each alert (academy-live-range.js), so a target that trades is seen within seconds, not
     on the next five-minute turn over delayed candles; the candles still cover what happened before the server started. ACADEMY_LIVE_RANGE=off restores candles only. */
  const liveRange = academyMassive && String(process.env.ACADEMY_LIVE_RANGE || 'on').toLowerCase() !== 'off'
    ? createLiveRange({ stream: academyMassive, logger: log, onCross: (symbol) => { if (academyAutoPt) academyAutoPt.tick().then((r) => { if (r && r.ran && (r.hits || r.posted)) log('info', 'auto_pt_live_cross', { symbol, ...r }); }).catch(() => {}); } })
    : null;
  const academyAutoPt = academyClickAlert && AUTO_PT_MODE !== 'off' ? createAutoPtService({
    mode: AUTO_PT_MODE, logger: log, onUpdate: pushNewTarget, onHit: pushTargetHit,
    listAlerts: async () => {
      const desk = academyAlerts ? academyAlerts.active().filter((a) => a.kind === 'equity' && a.symbol && a.target > 0 && a.entry > 0).map((a) => ({ key: 'd:' + a.id, windowMs: (a.channel === 'longterm' ? 90 : 14) * 86_400_000, symbol: a.symbol, side: 'long', entry: a.entry, target: a.target, at: a.at, channelId: academyAlerts.channelIdFor(a.source), postable: ownAlertChannels.has(String(academyAlerts.channelIdFor(a.source))), ...(a.via === 'academy' && /^\d{5,25}$/.test(String(a.authorId || '')) ? { userId: String(a.authorId) } : {}), price: (() => { const ev = academyAlerts.evaluated.get(a.id); return ev && ev.quote && Number(ev.quote.last) > 0 ? Number(ev.quote.last) : null; })() })) : [];
      const click = (await academyClickAlert.store.recent({ sinceMs: 6 * 86_400_000 }).catch(() => [])).map((r) => ({ key: 'c:' + r.messageId, userId: r.userId, symbol: r.symbol, side: r.side, entry: r.entry, target: r.target, stop: Number(r.stop) > 0 ? Number(r.stop) : undefined, at: r.at, channelId: r.channelId, postable: ownAlertChannels.has(String(r.channelId)) }));
      const deskIds = new Set(desk.map((d) => d.key.slice(2)));
      return desk.concat(click.filter((c) => !deskIds.has(c.key.slice(2)))); // the desk copy of a message wins
    },
    range: async (symbol, since) => { const candles = await academyClickAlert.rangeSince(symbol, since).catch(() => null); return mergeRanges(candles, liveRange ? liveRange.range(symbol, since) : null); }, evidence: academyClickAlert.evidenceFor, post: academyClickAlert.postAutoUpdate, compose: academyClickAlert.composeAutoUpdate,
    postClose: academyClickAlert.postAutoClose, openThread: academyClickAlert.startThread, threads: String(process.env.ACADEMY_PT_THREADS || 'on').toLowerCase() !== 'off',
    runnerFor: async (symbol, side, entry, at) => { const lib = require('./academy-runner'); const p = await sentimentCandles(symbol, '1D').catch(() => null); return lib.trailFor({ daily: p && Array.isArray(p.bars) ? p.bars : [], entry, sinceT: at, side }); },
    earningsFor: academyAlerts ? async (symbol) => { const e = await academyAlerts.nextEarnings(symbol).catch(() => null); return e && e.daysAway != null ? Number(e.daysAway) : null; } : null,
    sentiment: academySentiment ? (s) => academySentiment.get(s) : null, market: () => marketGauges.get(),
    store: createPgStateStore({ pool: database.pool, key: 'auto-pt', defaultValue: () => ({ alerts: {} }), logger: log })
  }) : null;
  if (academyAutoPt) {
    const runAutoPt = () => academyAutoPt.tick().then((r) => { if (r && r.ran && (r.hits || r.posted || r.errors)) log('info', 'auto_pt_tick', r); }).catch((error) => log('warn', 'auto_pt_tick_failed', { error }));
    setTimeout(runAutoPt, 90_000).unref(); setInterval(runAutoPt, 5 * 60_000).unref();
    log('info', 'auto_pt_enabled', { mode: AUTO_PT_MODE });
    // the alerts desk works toward the newest target and shows each update's write-up
    void academyAutoPt.load().catch(() => {});
    if (liveRange) {
      const syncLive = () => {
        const t = Date.now();
        for (const a of academyAutoPt.snapshot()) {
          if (a.status !== 'watching' || !a.symbol || t - a.at > (a.windowMs || 14 * 86_400_000)) { if (a.symbol) liveRange.unwatch(a.symbol, a.key); continue; }
          liveRange.track(a.symbol, a.watchSince || a.at, { key: a.key, side: a.side, target: a.watchTarget });
        }
        liveRange.prune();
      };
      /* one line every ten minutes (and one at the first sync): which stocks the watcher is following on the live trade feed, how many minutes of trades each holds */
      const logLive = () => { const sum = liveRange.summary(); log('info', 'live_range_tracking', { symbols: sum.length, withTrades: sum.filter((x) => x.minutes > 0).length, top: sum.slice(0, 8) }); };
      setTimeout(() => { syncLive(); logLive(); }, 45_000).unref(); setInterval(syncLive, 60_000).unref(); setInterval(logLive, 10 * 60_000).unref();
    }

    if (academyAlerts && typeof academyAlerts.setPtLadder === 'function') academyAlerts.setPtLadder((key) => academyAutoPt.forKey(key));
  }
  /* The target learner (academy-target-engine.js): every price-target suggestion served is judged when its horizon has run, and every desk alert
     the watcher followed is read by the forensics module, so the next suggestion starts from what actually happened. ACADEMY_TARGET_LEARNING=off keeps the
     suggestions but stops the judging. */
  const targetLearner = createTargetLearner({ store: createPgStateStore({ pool: database.pool, key: 'target-learning', defaultValue: () => ({}), logger: log }), candles: (symbol, tf) => sentimentCandles(symbol, tf), logger: log });
  void targetLearner.load().catch(() => {});
  if (academyClickAlert && typeof academyClickAlert.setLearned === 'function') academyClickAlert.setLearned(() => targetLearner.learned());
  if (String(process.env.ACADEMY_TARGET_LEARNING || 'on').toLowerCase() !== 'off') {
    setInterval(() => { targetLearner.settle().then((r) => { if (r && r.settled) log('info', 'target_learner_settled', r); }).catch((error) => log('warn', 'target_learner_settle_failed', { error })); }, 10 * 60_000).unref();
    const judgeAlerts = async () => {
      if (!academyAutoPt) return;
      const t = Date.now(), seen = targetLearner._state().alerts.analyzed;
      const todo = academyAutoPt.snapshot().filter((a) => a.symbol && a.entry > 0 && a.at && !seen[a.key] && t - a.at > 3 * 3_600_000 && t - a.at < 9 * 86_400_000).sort((x, y) => y.at - x.at).slice(0, 4);
      for (const a of todo) {
        try {
          const [p5, p1] = await Promise.all([sentimentCandles(a.symbol, '5m').catch(() => null), sentimentCandles(a.symbol, '1D').catch(() => null)]);
          const rep = alertForensics.analyzeAlert({ symbol: a.symbol, side: a.side, entry: a.entry, target: a.target, stop: a.stop, at: a.at, bars5: p5 && p5.bars, daily: p1 && p1.bars, detectedAt: a.hitAt });
          if (rep.ok) { await targetLearner.ingestAlert(a.key, rep); log('info', 'alert_forensics', { key: a.key, symbol: a.symbol, session: rep.session, latencyMin: rep.latencyMin, runBeforePct: rep.runBeforeAlertPct, hit: rep.features.hit, lessons: rep.lessons.map((l) => l.code) }); }
          else await targetLearner.ingestAlert(a.key, { ok: true, at: a.at, symbol: a.symbol, side: a.side, features: { session: 'unknown' }, lessons: [{ code: 'no_candles' }] });
        } catch (error) { log('warn', 'alert_forensics_failed', { symbol: a.symbol, error: String(error && error.message || error) }); }
      }
    };
    setTimeout(() => { judgeAlerts().catch(() => {}); setInterval(() => { judgeAlerts().catch(() => {}); }, 15 * 60_000).unref(); }, 3 * 60_000).unref();
    /* One-shot replay for the owner: ACADEMY_FORENSICS_REPLAY=AHT,INO logs the full forensics report of every desk alert on those symbols, once, a few
       minutes after boot (the stored alerts are read from the watcher's own state). Clear the variable afterwards. */
    const replay = String(process.env.ACADEMY_FORENSICS_REPLAY || '').toUpperCase().split(',').map((x) => x.trim()).filter((x) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(x)).slice(0, 5);
    if (replay.length && academyAutoPt) setTimeout(async () => {
      for (const symbol of replay) {
        try {
          const [p5, p1] = await Promise.all([sentimentCandles(symbol, '5m').catch(() => null), sentimentCandles(symbol, '1D').catch(() => null)]);
          for (const a of academyAutoPt.snapshot().filter((x) => x.symbol === symbol).sort((x, y) => y.at - x.at).slice(0, 3)) {
            const report = alertForensics.analyzeAlert({ symbol, side: a.side, entry: a.entry, target: a.target, stop: a.stop, at: a.at, bars5: p5 && p5.bars, daily: p1 && p1.bars, detectedAt: a.hitAt });
            log('info', 'alert_forensics_replay', { key: a.key, status: a.status, hitAt: a.hitAt ? new Date(a.hitAt).toISOString() : null, report });
          }
        } catch (error) { log('warn', 'alert_forensics_replay_failed', { symbol, error: String(error && error.message || error) }); }
      }
    }, 4 * 60_000).unref();
  }
  /* Signal radar: MEM ALGO buy signals across the wide scanner's universe, for the owner (OWNER_IDS + SML_ACADEMY_SIGNAL_USER_IDS).
     ACADEMY_SIGNAL_RADAR=off removes it. Reads 25 symbols a minute through Massive REST (sentimentCandles), so a 300-name universe
     is covered about every 12 minutes in the regular session; outside it only the daily (swing) read runs. */
  const pushSignal = (sig) => {
    if (!academyPush || !sig) return;
    const px = (v) => (Number(v) >= 1 ? Number(v).toFixed(2) : Number(v).toFixed(4));
    const msg = {
      kind: 'signal', id: sig.id, symbol: sig.symbol, tag: 'sml-signal-' + sig.symbol + '-' + sig.style, sticky: false,
      title: '🟢 BUY SIGNAL ' + sig.symbol + ' · ' + sig.label + ' · grade ' + sig.grade,
      body: 'Entry $' + px(sig.entry) + ' → PT $' + px(sig.target) + ' (+' + sig.pct + '%), stop $' + px(sig.stop) + '. ' + (sig.why && sig.why[0] ? sig.why[0] + '.' : ''),
      url: '/academy-activity/?symbol=' + encodeURIComponent(sig.symbol) + '&signal=' + encodeURIComponent(sig.id),
      signal: sig
    };
    academyPush.sendTo((userId) => signalUserIds.has(String(userId)), msg, { topic: 'signal' + sig.symbol + sig.style })
      .then((r) => log('info', 'push_signal', { symbol: sig.symbol, style: sig.style, ...r }))
      .catch((error) => log('warn', 'push_signal_failed', { error }));
  };
  /* Article Desk: the Academy's reads on the names in play, turned into speculative, SEO-ready Loop Letters under the owner's
     byline, each with a GIF of the path to the price target. Drafts unless SML_STORY_AUTOPUBLISH=on and the signed-in WordPress
     account (SML_LETTERS_USERNAME / SML_LETTERS_APP_PASSWORD, else the news account) is the byline's own account. SML_STORY_DESK=off
     switches it off; SML_STORY_LLM=on lets the newsroom model polish the voice (never the numbers). */
  const STORY_DESK_ON = String(process.env.SML_STORY_DESK || 'on').toLowerCase() !== 'off';
  const storyPublisher = createLettersPublisher({ siteUrl: config.wordpressUrl, username: process.env.SML_LETTERS_USERNAME || config.wordpressUsername, appPassword: process.env.SML_LETTERS_APP_PASSWORD || config.wordpressAppPassword, authorId: Number(process.env.SML_LETTERS_AUTHOR_ID) || 258456581,
    /* the signed service request the data bridge plugin accepts (the site ignores Basic auth on its REST API) */
    secret: config.academyBridgeSecret, serviceUserId: Number(process.env.SML_LETTERS_SERVICE_USER_ID) || Number(process.env.SML_LETTERS_AUTHOR_ID) || 258456581,
    /* WordPress and its edge protection throttle rapid signed uploads.  A letter has several dependent calls, so serialise
       them inside the publisher rather than making the Story Desk retry a whole article and create duplicate drafts. */
    minIntervalMs: 1500, retryCount: 4, logger: log });
  const storyDesk = STORY_DESK_ON && marketHistory && marketHistory.enabled ? createStoryDesk({
    universe: async () => {
      const seen = new Set(), rows = [];
      const push = (r) => { const sym = String(r && r.symbol || '').toUpperCase(); if (!sym || seen.has(sym)) return; seen.add(sym); rows.push({ symbol: sym, price: Number(r.price) || null, changePct: Number(r.changePct) || null, volume: Number(r.volume) || null, name: r.name || '' }); };
      if (academyWideScanner) { try { const w = await academyWideScanner.get(150); (w && w.rows || []).forEach(push); } catch (_) { /* next source */ } }
      if (academyAlerts) { try { academyAlerts.active().forEach((a) => push({ symbol: a.symbol })); } catch (_) { /* next source */ } }
      try { const pb = getEarningsPlaybook(); if (pb) (await pb.window(7) || []).forEach((e) => push({ symbol: e.symbol })); } catch (_) { /* next source */ }
      try { const rd = getCatalystRadar(); if (rd) { const sc = await rd.scan({ limit: 40 }); (sc && sc.rows || []).forEach(push); } } catch (_) { /* next source */ }
      return rows;
    },
    candles: (symbol, tf) => sentimentCandles(symbol, tf),
    gamma: academyGamma || null,
    shortData: academyAlerts ? (sym) => academyAlerts.shortData(sym) : null,
    finra: getCandleRecap() ? getCandleRecap().finra : null,
    institutional: academyInstitutional || null,
    darkPool: async (sym) => { const rows = await marketHistory.trades(sym, 50_000); return sessionDarkPool(rows, { now: Date.now() }); },
    smc: (() => { try { return require('./academy-smart-money'); } catch (_) { return null; } })(),
    sentiment: academySentiment || null,
    earnings: academyAlerts ? (sym) => academyAlerts.nextEarnings(sym) : null,
    playbook: (sym) => { const pb = getEarningsPlaybook(); return pb && typeof pb.detail === 'function' ? pb.detail(sym) : null; },
    direction: marketDirection ? () => marketDirection.get('swing') : null,
    runner: (() => { try { return require('./academy-runner'); } catch (_) { return null; } })(),
    company: academyAlerts && typeof academyAlerts.company === 'function' ? (sym) => academyAlerts.company(sym) : null,
    heat: createNewsHeat({ logger: log }),
    publisher: storyPublisher,
    polisher: createPolisher({ apiKey: String(process.env.SML_STORY_LLM || '').toLowerCase() === 'on' ? config.openaiApiKey : '', model: config.openaiModel, logger: log }),
    dm: discordDm, ownerIds: [...OWNER_IDS],
    store: createPgStateStore({ pool: database.pool, key: 'story-desk', defaultValue: () => ({ written: {}, log: [], day: '', count: 0 }), logger: log }),
    marketState: (t) => marketState(t), autopublish: String(process.env.SML_STORY_AUTOPUBLISH || '').toLowerCase() === 'on', logger: log,
    /* the dossier: every insight the Academy has on the name, for the article composer (academy-article-desk.js) */
    insights: {
      shortInsight: (s) => { const si = getShortInsight(); return si ? si.insight(s) : null; },
      earningsInsight: (s) => { const e = getEarningsInsight(); return e ? e.insight(s) : null; },
      intent: smartIntentFor,
      darkPool: async (sym) => {
        const rows = await marketHistory.trades(sym, 50_000);
        const live = academyMassive && typeof academyMassive.peek === 'function' ? academyMassive.peek(sym) : null;
        const st = marketState(), price = live && Number(live.last) > 0 ? Number(live.last) : null;
        let summary = sessionDarkPool(rows, { price, now: Date.now() });
        if (darkPoolMemory && summary.available) { try { summary = await darkPoolMemory.annotate(sym, summary, { date: String(st.et || '').slice(0, 10), price, sinceMs: etDayStartMs(st) }); } catch (_) { /* the summary stands */ } }
        return summary;
      },
      sentiment: academySentiment ? (s) => academySentiment.get(s) : null,
      filings: academyFilings ? (s) => academyFilings.get(s) : null,
      company: academyAlerts && typeof academyAlerts.company === 'function' ? (s) => academyAlerts.company(s) : null,
      news: academyAlerts && typeof academyAlerts.newsFor === 'function' ? (s) => academyAlerts.newsFor(s) : null,
      alerts: academyAlerts ? async () => academyAlerts.active() : null,
      patterns: async (s) => { const r = await sentimentCandles(s, '1D'); return r && Array.isArray(r.bars) && r.bars.length >= 30 ? require('./academy-patterns').detect(r.bars.slice(-160)) : null; },
      memAlgo: async (s) => { const r = await sentimentCandles(s, '1D'); return r && Array.isArray(r.bars) && r.bars.length >= 60 ? require('./academy-mem-algo').analyze(r.bars, 'swing', {}, '1D', {}) : null; }
    },
    chartEndpoint: config.academyTrialPublicUrl ? config.academyTrialPublicUrl + '/academy-activity/article-chart' : '',
    /* the listen-to-this-article audio element points here (served by /academy-activity/article-audio below) */
    audioEndpoint: config.academyTrialPublicUrl && config.academyVoiceId && String(process.env.SML_ARTICLE_AUDIO || 'on').toLowerCase() !== 'off' ? config.academyTrialPublicUrl + '/academy-activity/article-audio' : '',
    /* the prose is written by the model as the byline from the fact sheet (SML_STORY_WRITER=off keeps the house writer only) */
    writer: createArticleWriter({ ai: config.anthropicApiKey && String(process.env.SML_STORY_WRITER || 'on').toLowerCase() !== 'off' ? { apiKey: config.anthropicApiKey, model: config.academyAskModel } : null, logger: log }),
    discordUrl: String(process.env.SML_ACADEMY_INVITE_URL || process.env.SML_ACADEMY_BILLING_INVITE_URL || ''),
    /* the scheduled reads: the market and the Nasdaq after the open (9:45 ET) and into the close (15:50 ET); SML_STORY_SCHEDULE=off skips them */
    schedule: String(process.env.SML_STORY_SCHEDULE || 'on').toLowerCase() === 'off' ? [] : [{ at: 585, subjects: ['the market', 'nasdaq'] }, { at: 950, subjects: ['the market', 'nasdaq'] }],
    memoryOk: () => process.memoryUsage().rss < (Number(process.env.SML_STORY_PAUSE_MB) || 1500) * 1024 * 1024
  }) : null;
  /* the Article Desk keeps the names people ask for gathered ahead of time, so a request starts from the engine's own read (SML_STORY_WARM=off skips it) */
  if (storyDesk && String(process.env.SML_STORY_WARM || 'on').toLowerCase() !== 'off') {
    const warmTick = () => { storyDesk.warm().catch((error) => log('warn', 'story_warm_failed', { error: String(error && error.message || error) })); };
    setTimeout(warmTick, 90_000).unref();
    const warmTimer = setInterval(warmTick, 5 * 60_000); if (warmTimer.unref) warmTimer.unref();
  }
  const getStoryDesk = () => storyDesk;
  if (storyDesk) {
    let storySkip = '';
    const runStoryDesk = () => storyDesk.tick().then((r) => {
      if (r && !r.skipped) { storySkip = ''; log('info', 'story_desk_tick', { scanned: r.scanned, candidates: r.candidates, ranked: r.ranked, filed: r.filed, results: (r.results || []).map((x) => x.symbol + ':' + x.angle + ':' + (x.error || (x.published ? 'published' : 'draft')) + (x.writer ? ':' + x.writer : '')) }); }
      else if (r && r.skipped && r.skipped !== storySkip) { storySkip = r.skipped; log('info', 'story_desk_skipped', { why: r.skipped }); }
      else if (!r) log('info', 'story_desk_skipped', { why: 'busy_or_failed' });
    }).catch((error) => log('warn', 'story_desk_tick_failed', { error }));
    setTimeout(runStoryDesk, 3 * 60_000).unref(); setInterval(runStoryDesk, 30 * 60_000).unref();
    /* the old letters, rebuilt in the compact layout: two every four minutes until none is left. OFF unless SML_STORY_REBUILD=on:
       it rewrote published letters on every deploy (a block fewer each time) and raced a member's own edits in the editor */
    if (String(process.env.SML_STORY_REBUILD || 'off').toLowerCase() === 'on') {
      const rebuildTimer = setInterval(() => storyDesk.rebuildOld({ limit: 2 }).then((r) => {
        if (r && (r.rebuilt || r.failed || r.halted)) log('info', 'story_rebuild_run', r);
        if (r && (r.halted || (r.ok && r.remaining === 0) || r.skipped === 'halted')) clearInterval(rebuildTimer);
      }).catch((error) => log('warn', 'story_rebuild_run_failed', { error })), 4 * 60_000);
      rebuildTimer.unref(); setTimeout(() => storyDesk.rebuildOld({ limit: 2 }).catch(() => {}), 90_000).unref();
    }
    log('info', 'story_desk_enabled', { autopublish: String(process.env.SML_STORY_AUTOPUBLISH || '').toLowerCase() === 'on', llm: String(process.env.SML_STORY_LLM || '').toLowerCase() === 'on', letters: storyPublisher.configured() });
    /* a boot-time test: SML_STORY_TEST_SYMBOLS=NVDA,TSLA writes those names once at startup and logs the whole result */
    const storyTest = String(process.env.SML_STORY_TEST_SYMBOLS || '').split(',').map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(x)).slice(0, 6);
    if (storyTest.length) setTimeout(async () => {
      for (const sym of storyTest) {
        try {
          const r = await storyDesk.write(sym);
          log('info', 'story_test_result', { symbol: sym, ok: r.ok, error: r.error || '', angle: r.story && r.story.angle, rank: r.story && r.story.rank, score: r.story && r.story.score, pt: r.story && r.story.pt, ptPct: r.story && r.story.ptPct, lean: r.story && r.story.lean, heat: r.story && r.story.heat, title: r.draft && r.draft.title, meta: r.draft && r.draft.meta, words: r.draft && r.draft.wordCount, facts: r.story && r.story.facts, path: r.story && r.story.path, filed: r.filed ? { error: r.filed.error, letterId: r.filed.letterId, url: r.filed.url, asByline: r.filed.asByline } : null });
        } catch (error) { log('warn', 'story_test_failed', { symbol: sym, error: String(error && error.message || error) }); }
      }
    }, 20_000).unref();
  }
  /* a one-shot letter action at startup: SML_STORY_LETTER_OPS=publish:142;draft:128 publishes letter 142 and takes 128 back to a draft
     (also private / public for visibility). Each result is logged as story_letter_op; clear the variable afterwards. */
  if (typeof storyPublisher !== 'undefined' && storyPublisher && storyPublisher.configured()) {
    const letterOps = String(process.env.SML_STORY_LETTER_OPS || '').split(';').map((x) => x.trim().split(':')).filter(([op, id]) => ['publish', 'draft', 'private', 'public'].includes(op) && /^\d{1,7}$/.test(id || '')).slice(0, 6);
    if (letterOps.length) setTimeout(async () => {
      for (const [op, rawId] of letterOps) {
        const id = Number(rawId);
        try {
          let result;
          if (op === 'publish') result = await storyPublisher.publishLetter(id);
          else { await storyPublisher.updateLetter(id, op === 'draft' ? { status: 'draft' } : { visibility: op }); result = await storyPublisher.getLetter(id); }
          log('info', 'story_letter_op', { op, id, result });
        } catch (error) { log('warn', 'story_letter_op_failed', { op, id, error: String(error && error.message || error), body: error && error.body }); }
      }
    }, 25_000).unref();
  }
  const signalRadar = process.env.ACADEMY_SIGNAL_RADAR === 'off' ? null : createSignalRadar({
    universe: async () => {
      const cap = Math.max(50, Math.min(500, Number(process.env.ACADEMY_SIGNAL_RADAR_UNIVERSE) || 300));
      if (academyWideScanner) { try { const w = await academyWideScanner.get(cap); if (w && Array.isArray(w.rows) && w.rows.length) return w.rows; } catch (error) { log('warn', 'signal_radar_wide_failed', { error }); } }
      const s = await getAcademyScanner().catch(() => null); return s && Array.isArray(s.rows) ? s.rows.slice(0, cap) : [];
    },
    candles: sentimentCandles, analyze: require('./academy-mem-algo').analyze, state: () => marketState(), push: pushSignal, logger: log,
    pushBatch: (found) => { academyDm.signals(found).catch(() => {}); }, // one Discord DM per sweep, however many symbols it found
    perTick: Math.max(5, Math.min(60, Number(process.env.ACADEMY_SIGNAL_RADAR_PER_TICK) || 25)),
    store: createPgStateStore({ pool: database.pool, key: 'signal-radar', defaultValue: () => ({ signals: [] }), logger: log })
  });
  const academySignals = signalRadar ? { recent: signalRadar.recent, status: signalRadar.status, allowed: (userId) => signalUserIds.has(String(userId)) } : null;
  /* Auto-trade (academy-autotrade.js): the owner's MEM ALGO buy signals placed on a moomoo SIMULATED account through the OpenD trade bridge
     (tools/moomoo-sim-bridge). Off and dry by default; SML_MOOMOO_TRADE_BRIDGE + SML_MOOMOO_TRADE_SECRET connect it. Simulation only, no real-money path. */
  const autoTrade = createAutoTrade({
    broker: createMoomooSimBroker({ baseUrl: process.env.SML_MOOMOO_TRADE_BRIDGE || '', secret: process.env.SML_MOOMOO_TRADE_SECRET || '' }),
    signals: async (since) => (signalRadar ? signalRadar.recent(since, 100) : []), marketState: (t) => marketState(t),
    store: createPgStateStore({ pool: database.pool, key: 'autotrade', defaultValue: () => ({}), logger: log }), logger: log
  });
  setTimeout(() => { const runAuto = () => autoTrade.tick().then((r) => { if (r && (r.placed.length || r.exits.length)) log('info', 'autotrade_tick', { placed: r.placed, exits: r.exits }); }).catch((error) => log('warn', 'autotrade_tick_failed', { error })); setInterval(runAuto, 60_000).unref(); }, 70_000).unref();
  if (signalRadar) {
    const runRadar = () => signalRadar.tick().then((r) => { if (r && r.ran && r.found) log('info', 'signal_radar_tick', r); }).catch((error) => log('warn', 'signal_radar_tick_failed', { error }));
    setTimeout(runRadar, 45_000).unref(); setInterval(runRadar, 60_000).unref();
    void signalRadar.load().catch(() => {});
    log('info', 'signal_radar_enabled', { owners: signalUserIds.size });
  }
  /* Hedge & Income: the live chain (up to 3 expirations per request, cached 60 s), daily candles for ATR levels, and the member's own alert desk */
  const academyHedge = academyDataBridge.configured ? createHedgeService({
    /* straight to the site's moomoo chain (served from its own cache in about a second); the shared path pages the whole Massive
       chain and then waits in the rate-limited moomoo queue, which took up to 45 s for a cold ticker. That path stays as the fallback. */
    chain: async (symbol, expiration) => {
      const params = expiration ? { expiration } : {};
      if (rawAcademyDataBridge.configured) { const fast = await rawAcademyDataBridge.get('options', symbol, params).catch(() => null); if (fast && fast.ok) return fast; }
      return academyDataBridge.get('options', symbol, params, { priority: 'interactive' });
    },
    candles: getAcademyCandles, logger: log,
    alertsFor: academyAlerts ? async (userId, view) => {
      if (academyAlertSources) { const sources = (await academyAlertSources.viewFor(userId, view)).filter((s) => s.access); return academyAlerts.snapshot({ sources }).alerts || []; }
      return academyAlerts.snapshot().alerts || [];
    } : null,
    ptLadder: academyAutoPt ? (key) => academyAutoPt.forKey(key) : null
  }) : null;
  /* generated lesson media (Claude decks, ElevenLabs narration) is paid for once and kept in academy_media (schema 046) */
  const academyMedia = createAcademyMediaStore({ pool: database.pool, logger: log });
  const academyVoice = createAcademyVoice({
    apiKey: config.elevenLabsApiKey, voiceId: config.academyVoiceId,
    modelId: config.academyVoiceModel, lessons: SEED_LESSONS, store: academyMedia
  });
  const academyDiscipline = createDisciplineProgress({ pool: database.pool });
  const academySlideDesigner = createAcademySlideDesigner({
    apiKey: config.anthropicApiKey, model: config.academyClaudeModel, lessons: SEED_LESSONS, store: academyMedia
  });
  /* Ask Obi: the owner's question desk, grounded in every lesson and discipline episode */
  /* Ask Obi keeps every question and answer (academy_ask_log, migration 050) so its direction calls can be backtested, and a
     direction question carries the desk's live market read (Market Direction, SML VIX, SPY) so the call is today's read. */
  const askLog = createAskLog({ pool: database.pool, logger: log });
  askLog.ensureSchema().catch(() => {});
  /* Ticker Talk: the comment section under each ticker on the live chart (academy_ticker_talk, migration 054). */
  const tickerTalk = createTickerTalk({ pool: database.pool, logger: log, linkCard: academyProfilePages ? (u) => academyProfilePages.linkCard(u) : null });
  const academyCommunity = createCommunity({ talk: tickerTalk, alerts: traderAlerts, profiles: academyProfilePages, logger: log, names: async (id) => {
    try { if (academyProfilePages) { const s = await academyProfilePages.settingsOf(id); if (s && s.displayName) return s.displayName; } } catch (_) { /* fall through */ }
    try { if (academyProfiles) { const c = await academyProfiles.profile(id); return c && c.discord ? (c.discord.name || c.discord.username || '') : ''; } } catch (_) { /* fall through */ }
    return '';
  } });
  tickerTalk.ensureSchema().catch(() => {});
  /* Social notifications for LOOP-KICK (academy_notifications + academy_likes, migration 055). ACADEMY_SOCIAL_NOTIFY=off removes them. */
  academySocialNotify = process.env.ACADEMY_SOCIAL_NOTIFY === 'off' ? null : createSocialNotify({ pool: database.pool, profiles: academyProfilePages, talk: tickerTalk, wall: academyProfileWall, logger: log, names: async (id) => {
    try { if (academyProfilePages) { const s = await academyProfilePages.settingsOf(id); if (s && s.displayName) return s.displayName; } } catch (_) { /* fall through */ }
    try { if (academyProfiles) { const c = await academyProfiles.profile(id); return c && c.discord ? (c.discord.name || c.discord.username || '') : ''; } } catch (_) { /* fall through */ }
    return '';
  } });
  if (academySocialNotify) academySocialNotify.ensureSchema().catch(() => {});
  /* the desk read that rides with a question about a stock or the market (academy-ask-desk.js): the daily tape, extension in ATRs,
     MEM ALGO's bias and latest signal, the smart-money map, today's VWAP and range, patterns, float and short picture, sentiment, earnings */
  const askScannerRow = async (sym) => {
    const pick = (rows) => (Array.isArray(rows) ? rows.find((r) => String(r && r.symbol || '').toUpperCase() === sym) : null);
    let row = null;
    try { if (academyWideScanner) { const w = await academyWideScanner.get(400); row = pick(w && w.rows) || null; } } catch (_) { row = null; }
    if (!row) { try { const sc = await getAcademyScanner(); row = pick(sc && sc.rows) || null; } catch (_) { row = null; } }
    return row;
  };
  const askDesk = createAskDesk({
    candles: (s, tf) => getAcademyCandles(s, tf), memAlgo: require('./academy-mem-algo'), smartMoney: require('./academy-smart-money'), patterns: require('./academy-patterns'),
    scannerRow: askScannerRow,
    shortQuick: (s) => { const si = getShortInsight(); return si && typeof si.quick === 'function' ? si.quick(s) : null; },
    sentiment: academySentiment ? (s) => academySentiment.get(s) : null,
    earnings: academyDataBridge.configured ? async (s) => { const r = await academyDataBridge.get('earnings', s); return r && r.ok ? r.data : null; } : null,
    marketDirection, smlVix, logger: log
  });
  const askContext = ({ subject, horizon, question }) => askDesk.read({ subject, horizon, question });
  /* a lower-case word is a ticker when the scanners know it (so "hubc" is HUBC and "worth" stays a word) */
  const askKnownSymbols = { at: 0, set: new Set() };
  const askIsSymbol = (w) => {
    if (Date.now() - askKnownSymbols.at > 120_000) {
      askKnownSymbols.at = Date.now();
      (async () => { const next = new Set(); try { if (academyWideScanner) for (const r of ((await academyWideScanner.get(400)) || {}).rows || []) next.add(String(r.symbol || '').toUpperCase()); } catch (_) { /* keep */ } try { for (const r of ((await getAcademyScanner()) || {}).rows || []) next.add(String(r.symbol || '').toUpperCase()); } catch (_) { /* keep */ } if (next.size) askKnownSymbols.set = next; })().catch(() => {});
    }
    /* unknown to the scanners is not "not a ticker": thin names live outside them, so only a scanner hit says yes early and a miss defers to the shape */
    return askKnownSymbols.set.has(String(w).toUpperCase()) || /^[A-Z]{3,5}$/.test(String(w));
  };
  const academyAsk = Object.assign(createAcademyAsk({ apiKey: config.anthropicApiKey, model: config.academyAskModel, lessons: SEED_LESSONS, episodes: require('./academy/discipline-content').EPISODES, logger: log, context: askContext, log: askLog, isSymbol: askIsSymbol }), { owners: config.academyAskUserIds, log: askLog });
  log('info', 'academy_media_runtime', { durable: academyMedia.durable, voice: academyVoice.configured ? 'live' : (academyVoice.stored ? 'baked' : 'off'), designer: academySlideDesigner.configured ? 'live' : 'built-in', bake: !!config.academyBake });
  log('info', 'dispute_evidence_runtime', { enabled: disputes.enabled, reason: disputes.reason,
    paypal: !!disputes.paypalClient, connectBot: !!connectInteractions });
  const { createCorporateRuntime, CONFLICT_CODES } = require('./corporate-runtime');
  const corporate = createCorporateRuntime({ config, pool: database.pool, stripe, logger: log });
  log('info', 'corporate_runtime', { enabled: corporate.enabled, reason: corporate.reason });
  const schemaVersion = async () => {
    const found = await database.pool.query('SELECT MAX(version) AS version FROM schema_migrations', []);
    return found.rows[0] && found.rows[0].version != null ? String(found.rows[0].version) : null;
  };
  /* The phone app's API (/v1/app). Sign-in is the member's stockmarketloop.com account, checked by the site's app identity
     plugin over the LOOP-KICK bridge channel; sessions live in app_sessions (schema 042). Off with SML_APP_API=0. */
  const appIdentity = createAppIdentity({ baseUrl: config.loopKickBridgeUrl, secret: config.loopKickBridgeSecret, fetchImpl: (u, o) => dataHealth.guardedFetch('app-identity', u, o) });
  /* LOOP-KICK ↔ Discord connection from inside the Academy: site password sign-in over the app identity bridge, then the signed link route. */
  const loopKickConnect = createLoopKickConnect({ bridge: loopKickBridge, identity: appIdentity, secret: config.loopKickBridgeSecret, siteBase: config.loopKickBridgeUrl || REDDIT_HUB_ORIGIN, logger: log });
  const appAuth = createAppAuth({ store: createAppSessionStore({ pool: database.pool }), identity: appIdentity, secret: config.appTokenSecret, logger: log });
  /* premium Alert Charts sold through stockmarketloop.com's marketplace (Stripe Connect, 6% fee, disputes); off without Stripe or with ACADEMY_ALERT_CHART_BILLING=off */
  const alertChartBilling = !traderAlerts || process.env.ACADEMY_ALERT_CHART_BILLING === 'off' ? null : createAlertChartBilling({
    pool: database.pool, stripe, billingService, loopKickBridge, loopKickConnect, traderAlerts, rooms: tradingRoom, publicBase: POPOUT_BASE, logger: log,
    names: async (id) => { try { if (academyProfilePages) { const s = await academyProfilePages.settingsOf(id); if (s && s.displayName) return s.displayName; } } catch (_) { /* fall through */ } try { if (academyProfiles) { const c = await academyProfiles.profile(id); return c && c.discord ? (c.discord.name || c.discord.username || '') : ''; } } catch (_) { /* fall through */ } return ''; }
  });
  if (alertChartBilling) { alertChartBilling.ensureSchema().catch(() => {}); log('info', 'alert_chart_billing_runtime', { configured: alertChartBilling.configured, stripe: Boolean(stripe), publicBase: POPOUT_BASE }); }
  /* one SIRE feed shared by the Academy's SIRE panel and the app's scanner stream (idle until the first viewer) */
  const appSireFeed = createSireFeed({ scanner: getAcademyScanner, massive: academyMassive, logger: log });
  /* native + web push to app devices: each sender is off until its credentials exist (SML_APNS_*, SML_FCM_SERVICE_ACCOUNT; web reuses the VAPID keys) */
  const appPushDevices = createAppPushDevices({ pool: database.pool });
  const appPushSender = createAppPushSender({
    devices: appPushDevices, logger: log,
    apns: createApnsClient({ keyId: config.apnsKeyId, teamId: config.apnsTeamId, key: config.apnsKey, bundleId: config.apnsBundleId, env: config.apnsEnv, logger: log }),
    fcm: createFcmClient({ serviceAccount: config.fcmServiceAccount, fetchImpl: (u, o) => dataHealth.guardedFetch('fcm', u, o), logger: log }),
    web: createWebPushClient({ pool: database.pool, logger: log })
  });
  const appApi = config.appApiEnabled ? createAppApi({
    auth: appAuth, identity: appIdentity, scanner: getAcademyScanner, sireFeed: appSireFeed, massive: academyMassive, marketHistory, candles: getAcademyCandles,
    news: academyAlerts ? (symbol) => academyAlerts.newsFor(symbol) : null, timeframes: MASSIVE_TIMEFRAMES,
    pushDevices: appPushDevices, pushSender: appPushSender, siteSecret: config.appPushSiteSecret, corsOrigins: config.appCorsOrigins, logger: log
  }) : null;
  log('info', 'app_api_runtime', { enabled: Boolean(appApi), identity: appIdentity.configured, auth: appAuth.configured, tokenSecret: config.appTokenSecret ? (process.env.SML_APP_TOKEN_SECRET ? 'own' : 'bridge') : 'none', push: appPushSender.status() });
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
    linkTracker: disputes.linkTracker,
    verifyGate: disputes.verifyGate,
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
    academyAccess, academyOAuth, academyDataBridge, academyProgress, academyVoice, academySlideDesigner, academyAsk, academyTrial, academyOrderFlow, academyAlerts, academySentiment, groupTools, academyAlertSources, academyOptionsStream, academyClickAlert, academyProfiles, academySnapshot, academyMemLab, academyPasses, academyClickAlertPasses, academyMassive, academyScreener, academyPopout, academyTierLive, academyFreeSessions: !!config.academyFreeSessions, marketDirection, academySmlVix: smlVix, academyAutoPt, targetLearner, academyHedge, academyWideScanner, academyPush, academyMentions, academySignals,
    marketHistory, publicMarketDataEnabled: config.massivePublicChartsEnabled,
    brokerLinks: createBrokerLinks({ apiKey: config.massiveApiKey }),
    academyDiscipline,
    academyGamma, academyInstitutional, academyFilings, academyPaper, paperQuote, academyFlowDaily, academySignalOutcomes, optionBars, tickerTalk, getEarningsPlaybook, getEarningsInsight, getShortInsight, getSqueezeList, getFdaService, getCatalystRadar, getChallenge, siteTierDirectory, challengeShare, postChallengeTrade, getCandleRecap, getStoryDesk, darkPoolMemory, academyProfilePages, academyProfileWall, autoTrade, sessionRecap, personaRegistry, academyEditions, analystDeskFor, storyPublisher, pageAssets: createPageAssets({ logger: log }), academyEvolve, traderAlerts, academyCommunity, academySocialNotify, alertChartBilling, tradingRoom, alertLevels,
    academyAppId: config.academyAppId,
    academyGate,
    loopKickBridge, loopKickConnect, connectOAuth, connectAppId: config.discordConnectAppId,
    memberEmail,
    appApi, academySireFeed: appSireFeed
  });
  const academyChatWss = academyChatHub ? attachChatServer(server, academyChatHub, { WebSocketServer }) : null;
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'shutdown_started', { signal });
    if (academyOrderFlow) academyOrderFlow.stop();
    if (academyDepthRecorder) academyDepthRecorder.stop();
    if (academyAlerts) academyAlerts.stop();
    if (academyAlertSources) academyAlertSources.stop();
    if (academyMassive) academyMassive.stop();
    if (academyScreener) academyScreener.stop();
    if (academyFlowDaily) academyFlowDaily.stop();
    if (academySignalOutcomes) academySignalOutcomes.stop();
    if (academyChatWss) academyChatWss.close();
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
    log('info', 'api_started', { port: config.port, memory: memorySample() });
    /* one line a minute on what the process weighs, so a climb toward the 512 MB kill line is visible in the log before it happens */
    try { loopMonitor = monitorEventLoopDelay({ resolution: 20 }); loopMonitor.enable(); } catch (_) { loopMonitor = null; }
    /* names what blocked the loop when a pause over three seconds is seen (loop-stall-profiler.js); SML_LOOP_PROFILE=off removes it */
    const stallProfiler = process.env.SML_LOOP_PROFILE === 'off' ? null : createLoopStallProfiler({ logger: log });
    if (stallProfiler) stallProfiler.start().then((on) => log('info', 'loop_profiler_runtime', { on })).catch(() => {});
    const memoryTimer = setInterval(() => { const m = memorySample(); academyEvolve.observeMemory(m); log(m.rss >= 440 || (m.loopP99 || 0) >= 500 ? 'warn' : 'info', 'memory_sample', m); if (stallProfiler) stallProfiler.onSample({ loopMax: m.loopMax || 0, loopP99: m.loopP99 || 0 }).catch(() => {}); }, 60_000);
    /* the daily brief runs in the quiet hour; a crash in it is logged and never stops the server */
    const evolveTimer = setInterval(() => { if (academyEvolve.due()) academyEvolve.runBrief({ reason: 'scheduled' }).catch((error) => log('warn', 'academy_evolve_brief_failed', { error: String((error && error.message) || error) })); }, 10 * 60_000);
    if (evolveTimer.unref) evolveTimer.unref();
    if (memoryTimer.unref) memoryTimer.unref();
    startAcademyChartWarmers(log, marketHistory);
    if (academyOrderFlow) {
      academyOrderFlow.start();
    }
    if (academyDepthRecorder) academyDepthRecorder.start();
    if (academyAlerts) academyAlerts.start();
    if (academyAlertSources) academyAlertSources.start();
    if (academyMassive) academyMassive.start();
    if (academyScreener) academyScreener.start();
    if (academySignalOutcomes) academySignalOutcomes.start();
    if (academyFlowDaily && academyFlowDaily.start()) {
      /* the days before the ledger existed, for the recorded symbols, from the full book's prints; once, shortly after start */
      const syms = academyDepthRecorder ? academyDepthRecorder.symbols : parseDepthSymbols(process.env.ACADEMY_DEPTH_RECORD_SYMBOLS);
      setTimeout(async () => { for (const s of syms) { try { const n = await academyFlowDaily.backfill(s, 30); if (n) log('info', 'academy_flow_days_backfilled', { symbol: s, days: n }); } catch (error) { log('warn', 'academy_flow_days_backfill_failed', { symbol: s, error: String(error && error.message || error).slice(0, 160) }); } } }, 45_000).unref();
    }
    /* SML_ACADEMY_BAKE=1: generate every missing lesson deck and narration once, in the background, into academy_media */
    if (config.academyBake) {
      const bake = createAcademyBake({ lessons: SEED_LESSONS, designer: academySlideDesigner, voice: academyVoice, store: academyMedia, logger: log });
      const which = { design: config.academyBake !== 'voice', voice: config.academyBake !== 'design' };
      setTimeout(() => { bake.run(which).catch((error) => log('error', 'academy_bake_failed', { error })); }, 15_000).unref();
    }
    /* the tour and first-use tool lines, recorded once (about fifty short clips); later starts only confirm them. SML_ACADEMY_TOUR_BAKE=off skips it */
    if (process.env.SML_ACADEMY_TOUR_BAKE !== 'off' && academyVoice && academyVoice.configured && academyMedia) {
      setTimeout(() => { bakeTourLines({ voice: academyVoice, store: academyMedia, logger: log }).catch((error) => log('error', 'academy_tour_bake_failed', { error })); }, 30_000).unref();
    }
    if (academyOrderFlow) {
      const pruneTimer = setInterval(() => { orderFlowStore.prune(90).catch(() => {}); }, 24 * 3_600_000);
      if (pruneTimer.unref) pruneTimer.unref();
    }
    // No Discord write happens at startup: bulk-deleting the Connect bot's old
    // Activity messages on every restart looked like abuse to Discord's
    // anti-spam system. scripts/cleanup-connect-activity-messages.js remains a
    // manual, one-off tool.
  });
}

if (require.main === module) {
  main().catch((error) => {
    log('error', 'api_start_failed', { error });
    process.exit(1);
  });
}

module.exports = {
  getAcademyCandles, getAcademyScanner, getAcademyDepth, dataHealth, createServer,
  sendJson,
  sendHtml,
  academyActivityHtml,
  loopKickActivityHtml,
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
