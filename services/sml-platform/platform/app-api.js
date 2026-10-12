'use strict';

/* StockMarketLoop App API v1: every route under /v1/app, for the phone app and the PWA shell.
 *
 * Sign-in is the member's stockmarketloop.com account (app-auth.js + app-identity.js). Market data comes from this service's own
 * feeds (the shared Massive connection, the scanner cache, the candle relays), so the app never talks to the WordPress site and
 * never meets its per-IP rate limit. Everything that lives only in WordPress (feed, profile, groups, Loop Bucks, notifications)
 * is reached through one signed server-to-server proxy that runs the site's existing REST routes as the signed-in member.
 *
 * Contract rules the app can rely on:
 *   - JSON everywhere, `{ ok: true, ... }` or `{ ok: false, error: 'snake_code' }`; SSE streams for live data.
 *   - 401 `token_expired` means refresh and retry; any other 401 means sign in again.
 *   - 429 carries `retryAfterSec`. Limits are per member (600 requests a minute), never per IP, except sign-in itself.
 *   - CORS is open to stockmarketloop.com origins (and SML_APP_CORS_ORIGINS) so the PWA shell can call it from a browser. */

const { readRequestBody, verifySignature } = require('./wordpress-gateway');
const { sseWrite, sseEvent } = require('./sse-safe');
const { createDataRateLimit } = require('./data-rate-limit');
const { allowedPublicOrigin } = require('./market-data-service');

const PREFIX = '/v1/app';
const CONTRACT = '2026-10-12';
const SYMBOL = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const TIMEFRAME = /^(1m|3m|5m|10m|15m|30m|1h|2h|4h|1D|1W|1M|1Q|1Y)$/;
const MAX_STREAM_SYMBOLS = 20;

/* WordPress REST routes the proxy may run as the member. Anything that signs in, registers, resets or administers is refused here
 * even when a prefix matches: the app signs in through /auth/login only. */
const SITE_ALLOW = [
  'sml-feed/v1/', 'sml-feed-profiles/v1/', 'sml-members/v1/', 'sml-group-kick/v1/', 'sml-lb/v1/', 'sml-lbm/v1/', 'sml-boot/v1/',
  'sml-hub/v1/group/', 'sml-group-tools/v1/', 'sml-locsec/v1/', 'sml-loop-kick/v1/bootstrap', 'sml-loop-kick-post/v1/', 'sml-2step/v1/status', 'sml-2step/v1/sessions',
  'sml-scanner/v1/', 'sml-ticker-news/v1/', 'sml-sentiment/v1/', 'sml-mood/v1/', 'sml-tags/v1/', 'sml-watch/v1/', 'sml-profile-preview/v1/', 'sml-friends-profile/v1/',
  'sml-store/v1/', 'sml-storefront/v1/', 'sml-sub/v1/', 'sml-subscribers/v1/', 'sml-gifts/v1/', 'sml-emotes/v1/', 'sml-group-landing/v1/', 'sml-group-shell/v1/',
  'sml-group-score/v1/', 'sml-gextras/v1/', 'sml-cues/v1/', 'sml-playlists/v1/', 'sml-creator-videos/v1/', 'sml-creator-comments/v1/', 'sml-display-name/v1/', 'wp/v2/users/me'
];
const SITE_DENY = /(^|\/)(login|register|resend-code|webhook|reset|reconcile|admin|export|oauth|checkout|purchase-intent|upload|chirp-upload|profile-image|image)(\/|$)/;
// namespace/vN then plain segments: no percent-encoding, no '.' or '..' segments, nothing a route matcher could re-read
const SITE_ROUTE = /^[a-z0-9-]+\/v\d+(?:\/(?!\.{1,2}(?:\/|$))[\w.-]+)*$/;

function createAppApi({ auth = null, identity = null, scanner = null, sireFeed = null, massive = null, marketHistory = null, candles = null, news = null, timeframes = {},
  pushDevices = null, pushSender = null, siteSecret = '', corsOrigins = [], logger = () => {}, now = Date.now, maxStreams = 200, perUserPerMinute = 600 } = {}) {
  const userLimit = createDataRateLimit({ limit: perUserPerMinute, windowMs: 60_000, now });
  const loginIpLimit = createDataRateLimit({ limit: 10, windowMs: 60_000, now });
  const loginNameLimit = createDataRateLimit({ limit: 10, windowMs: 15 * 60_000, now });
  const keyed = (key) => ({ headers: { 'x-forwarded-for': key }, socket: {} });
  const extraOrigins = new Set((Array.isArray(corsOrigins) ? corsOrigins : String(corsOrigins || '').split(',')).map((o) => String(o || '').trim().toLowerCase()).filter(Boolean));
  const meCache = new Map();
  const liveCache = new Map();
  const touched = new Map();
  let streams = 0;
  const streamsByUser = new Map();

  /* ---- plumbing ---- */
  const corsFor = (request) => {
    const origin = String(request.headers.origin || '').trim();
    if (!origin) return {};
    const ok = extraOrigins.has(origin.toLowerCase()) || allowedPublicOrigin(origin);
    return ok ? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type, Accept', 'access-control-max-age': '86400' } : {};
  };
  const json = (request, response, status, body, extra = {}) => {
    const payload = JSON.stringify(body);
    response.writeHead(status, { ...corsFor(request), 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
    response.end(payload);
  };
  const fail = (request, response, status, error, extra = {}) => json(request, response, status, { ok: false, error, ...extra });
  const requestIp = (request) => { const xff = String(request.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean); return xff.length ? xff[xff.length - 1] : String(request.socket?.remoteAddress || 'unknown'); };
  async function readJson(request, response, max = 64 * 1024) {
    if (!/^application\/json(?:\s*;|$)/i.test(String(request.headers['content-type'] || ''))) { fail(request, response, 415, 'content_type_required'); return null; }
    const body = await readRequestBody(request, max);
    if (!body.ok) { fail(request, response, body.status || 400, body.error || 'invalid_body'); return null; }
    try { const parsed = body.rawBody.length ? JSON.parse(body.rawBody) : {}; if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape'); return parsed; }
    catch (_) { fail(request, response, 400, 'invalid_json'); return null; }
  }
  /* bearer + live session + per-member rate limit; sends the refusal itself and returns null */
  async function member(request, response, cost = 1, { queryToken = false } = {}) {
    if (!auth || !auth.configured) { fail(request, response, 503, 'app_auth_unconfigured'); return null; }
    // a browser's EventSource cannot set a header, so the two live streams also take the access token as ?access_token= (15-minute tokens, never logged)
    const fromQuery = queryToken && !request.headers.authorization ? String(params(request).get('access_token') || '') : '';
    const session = auth.verify(fromQuery ? 'Bearer ' + fromQuery : request.headers.authorization);
    if (!session.ok) { fail(request, response, session.status || 401, session.code); return null; }
    const t = now();
    let live = liveCache.get(session.sessionId);
    if (!live || live.until <= t) {
      live = { ok: await auth.sessionLive(session.sessionId).catch(() => true), until: t + 60_000 };
      if (liveCache.size > 20_000) liveCache.clear();
      liveCache.set(session.sessionId, live);
    }
    if (!live.ok) { fail(request, response, 401, 'session_revoked'); return null; }
    const limit = userLimit.take(keyed('u:' + session.userId), cost);
    if (!limit.ok) { fail(request, response, 429, 'rate_limited', { retryAfterSec: limit.retryAfterSec }); return null; }
    if ((touched.get(session.sessionId) || 0) <= t - 300_000) { touched.set(session.sessionId, t); if (touched.size > 20_000) touched.clear(); auth.touch(session.sessionId); }
    return session;
  }
  const params = (request) => new URL(request.url || '/', 'http://localhost').searchParams;
  function openStream(request, response, userId) {
    const mine = streamsByUser.get(userId) || 0;
    if (streams >= maxStreams || mine >= 4) { fail(request, response, 503, 'stream_busy'); return null; }
    streams += 1; streamsByUser.set(userId, mine + 1);
    response.writeHead(200, { ...corsFor(request), 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const beat = setInterval(() => { sseWrite(response, ': keep-alive\n\n'); }, 15_000);
    let closed = false;
    const cleanups = [];
    const done = () => { if (closed) return; closed = true; clearInterval(beat); streams -= 1; streamsByUser.set(userId, Math.max(0, (streamsByUser.get(userId) || 1) - 1)); for (const fn of cleanups) { try { fn(); } catch (_) { /* gone */ } } };
    request.on('close', done); response.on('close', done);
    return { write: (event, data) => sseEvent(response, event, data), onClose: (fn) => cleanups.push(fn) };
  }

  /* ---- routes ---- */
  async function handle(request, response, path) {
    if (path !== PREFIX && !path.startsWith(PREFIX + '/')) return false;
    const rest = path.slice(PREFIX.length).replace(/\/+$/, '') || '/';
    const method = request.method;

    if (method === 'OPTIONS') { response.writeHead(204, { ...corsFor(request), 'content-length': '0' }); response.end(); return true; }

    if (method === 'GET' && rest === '/') {
      json(request, response, 200, { ok: true, name: 'StockMarketLoop App API', version: 1, contract: CONTRACT,
        ready: Boolean(auth && auth.configured), market: Boolean(massive && massive.status && massive.status().enabled), scanner: Boolean(scanner), push: Boolean(pushDevices),
        pushSenders: pushSender ? pushSender.status() : { ios: false, android: false, web: false },
        accessTokenSeconds: auth ? Math.round(auth.accessTtlMs / 1000) : null, refreshTokenDays: auth ? Math.round(auth.refreshTtlMs / 86_400_000) : null });
      return true;
    }

    /* ---- sign-in ---- */
    if (method === 'POST' && rest === '/auth/login') {
      if (!auth || !auth.configured) { fail(request, response, 503, 'app_auth_unconfigured'); return true; }
      const ip = requestIp(request);
      const ipTake = loginIpLimit.take(keyed('ip:' + ip));
      if (!ipTake.ok) { fail(request, response, 429, 'rate_limited', { retryAfterSec: ipTake.retryAfterSec }); return true; }
      const body = await readJson(request, response, 8 * 1024); if (!body) return true;
      const name = String(body.login || body.username || body.email || '').trim().toLowerCase();
      if (name) { const nameTake = loginNameLimit.take(keyed('n:' + name)); if (!nameTake.ok) { fail(request, response, 429, 'rate_limited', { retryAfterSec: nameTake.retryAfterSec }); return true; } }
      const result = await auth.login({ login: name, password: typeof body.password === 'string' ? body.password : '', code: body.code, device: body.device, ip });
      const { status, ...payload } = result;
      json(request, response, status, payload);
      return true;
    }
    if (method === 'POST' && rest === '/auth/refresh') {
      if (!auth || !auth.configured) { fail(request, response, 503, 'app_auth_unconfigured'); return true; }
      const ipTake = loginIpLimit.take(keyed('ip:' + requestIp(request)), 0.25);
      if (!ipTake.ok) { fail(request, response, 429, 'rate_limited', { retryAfterSec: ipTake.retryAfterSec }); return true; }
      const body = await readJson(request, response, 4 * 1024); if (!body) return true;
      const result = await auth.refresh({ refreshToken: body.refreshToken });
      const { status, ...payload } = result;
      json(request, response, status, payload);
      return true;
    }
    if (method === 'POST' && rest === '/auth/logout') {
      if (!auth || !auth.configured) { fail(request, response, 503, 'app_auth_unconfigured'); return true; }
      const body = await readJson(request, response, 4 * 1024); if (!body) return true;
      await auth.logout({ refreshToken: body.refreshToken });
      json(request, response, 200, { ok: true });
      return true;
    }
    if (method === 'POST' && rest === '/auth/logout-all') {
      const session = await member(request, response); if (!session) return true;
      await auth.revokeAll(session.userId);
      liveCache.clear();
      json(request, response, 200, { ok: true });
      return true;
    }
    if (method === 'GET' && rest === '/auth/sessions') {
      const session = await member(request, response); if (!session) return true;
      json(request, response, 200, { ok: true, sessions: await auth.sessions(session.userId, session.sessionId) });
      return true;
    }
    let m = /^\/auth\/sessions\/([\w-]{8,64})$/.exec(rest);
    if (method === 'DELETE' && m) {
      const session = await member(request, response); if (!session) return true;
      const result = await auth.revokeSession(session.userId, m[1]);
      liveCache.delete(m[1]);
      json(request, response, result.status, result.ok ? { ok: true } : { ok: false, error: result.error });
      return true;
    }

    /* ---- the member ---- */
    if (method === 'GET' && rest === '/me') {
      const session = await member(request, response); if (!session) return true;
      const fresh = params(request).get('fresh') === '1';
      const cached = meCache.get(session.userId);
      if (cached && cached.until > now() && !fresh) { json(request, response, 200, { ...cached.data, cached: true }); return true; }
      const result = identity ? await identity.me(session.userId) : { ok: false, status: 503, error: 'identity_unconfigured' };
      if (!result.ok) { fail(request, response, result.status === 404 ? 401 : (result.status || 503), result.status === 404 ? 'account_gone' : result.error); return true; }
      const { status, ...data } = result;
      if (meCache.size > 10_000) meCache.clear();
      meCache.set(session.userId, { until: now() + 60_000, data });
      json(request, response, 200, data);
      return true;
    }

    /* ---- market data (this service's own feeds) ---- */
    m = /^\/tickers\/([A-Za-z0-9.\-]{1,10})\/(quote|candles|news)$/.exec(rest);
    if (method === 'GET' && m) {
      const session = await member(request, response); if (!session) return true;
      const symbol = m[1].toUpperCase(), kind = m[2];
      if (!SYMBOL.test(symbol)) { fail(request, response, 400, 'invalid_symbol'); return true; }
      if (kind === 'quote') {
        if (!massive || !massive.status || !massive.status().enabled) { fail(request, response, 503, 'market_unavailable'); return true; }
        massive.watch(symbol);
        const snap = massive.peek(symbol);
        json(request, response, 200, { ok: true, symbol, asOf: now(), ready: Boolean(snap), ...(snap ? { last: snap.last, quote: snap.quote || null, quoteFresh: snap.quoteFresh, lastTradeAt: snap.lastTradeAt || null, stats: snap.stats || null, tape: snap.tape || [] } : { warming: true }) });
        return true;
      }
      if (kind === 'candles') {
        const tf = params(request).get('tf') || '5m';
        if (!TIMEFRAME.test(tf)) { fail(request, response, 400, 'invalid_timeframe'); return true; }
        try {
          const viaMassive = marketHistory?.enabled && Object.prototype.hasOwnProperty.call(timeframes || {}, tf) ? await marketHistory.get(symbol, tf) : null;
          const data = viaMassive?.ok ? viaMassive.data : (candles ? await candles(symbol, tf) : null);
          if (!data) { fail(request, response, 503, 'candles_unavailable'); return true; }
          json(request, response, 200, { ok: true, ...data });
        } catch (error) {
          logger(error instanceof TypeError ? 'warn' : 'error', 'app_candles_failed', { error, symbol, tf });
          fail(request, response, error instanceof TypeError ? 400 : 503, error instanceof TypeError ? 'invalid_symbol' : 'candles_unavailable');
        }
        return true;
      }
      if (!news) { fail(request, response, 503, 'news_unavailable'); return true; }
      try { const articles = await news(symbol); json(request, response, 200, { ok: true, symbol, articles: Array.isArray(articles) ? articles : [], asOf: now() }); }
      catch (error) { logger('warn', 'app_news_failed', { error, symbol }); fail(request, response, 503, 'news_unavailable'); }
      return true;
    }
    if (method === 'GET' && rest === '/scanner') {
      const session = await member(request, response); if (!session) return true;
      if (!scanner) { fail(request, response, 503, 'scanner_unavailable'); return true; }
      try { json(request, response, 200, { ok: true, ...(await scanner()) }); }
      catch (error) { logger('error', 'app_scanner_failed', { error }); fail(request, response, 503, 'scanner_unavailable'); }
      return true;
    }
    if (method === 'GET' && rest === '/scanner/stream') {
      const session = await member(request, response, 5, { queryToken: true }); if (!session) return true;
      if (!sireFeed) { fail(request, response, 503, 'scanner_unavailable'); return true; }
      const stream = openStream(request, response, session.userId); if (!stream) return true;
      try { stream.onClose(sireFeed.subscribe(stream.write, {})); }
      catch (error) { logger('error', 'app_scanner_stream_failed', { error }); stream.write('error', { ok: false, error: 'scanner_unavailable' }); }
      return true;
    }
    if (method === 'GET' && rest === '/stream') {
      const session = await member(request, response, 5, { queryToken: true }); if (!session) return true;
      if (!massive || !massive.status || !massive.status().enabled) { fail(request, response, 503, 'market_unavailable'); return true; }
      const symbols = [...new Set(String(params(request).get('symbols') || '').toUpperCase().split(',').map((s) => s.trim()).filter(Boolean))];
      if (!symbols.length || symbols.length > MAX_STREAM_SYMBOLS || !symbols.every((s) => SYMBOL.test(s))) { fail(request, response, 400, 'invalid_symbols', { max: MAX_STREAM_SYMBOLS }); return true; }
      const stream = openStream(request, response, session.userId); if (!stream) return true;
      for (const symbol of symbols) {
        massive.watch(symbol);
        const snap = massive.peek(symbol);
        stream.write('snapshot', { symbol, ...(snap ? { last: snap.last, quote: snap.quote || null, quoteFresh: snap.quoteFresh, stats: snap.stats || null } : { warming: true }) });
        let pendingQuote = null, timer = null;
        const off = massive.on(symbol, (evt) => {
          if (evt.type === 'trade') stream.write('trade', { symbol, ...evt.trade });
          else { pendingQuote = evt.quote; if (!timer) timer = setTimeout(() => { timer = null; if (pendingQuote) { stream.write('quote', { symbol, ...pendingQuote }); pendingQuote = null; } }, 100); }
        });
        stream.onClose(() => { if (timer) clearTimeout(timer); off(); });
      }
      return true;
    }

    /* ---- push ---- */
    if (method === 'GET' && rest === '/push/vapid-key') {
      /* the PWA shell's web push key: public by nature, the same key the Academy's web push uses */
      const key = pushSender ? await pushSender.webPublicKey().catch(() => null) : null;
      if (!key) { fail(request, response, 503, 'web_push_unavailable'); return true; }
      json(request, response, 200, { ok: true, publicKey: key });
      return true;
    }
    if (method === 'POST' && rest === '/push/test') {
      /* a member pushes to their own registered devices: the builder's end-to-end check */
      const session = await member(request, response, 10); if (!session) return true;
      if (!pushSender || !pushSender.configured) { fail(request, response, 503, 'push_senders_off', { senders: pushSender ? pushSender.status() : null }); return true; }
      const body = (await readRequestBody(request, 2 * 1024)).rawBody || '';
      let custom = {}; try { custom = body ? JSON.parse(body) : {}; } catch (_) { custom = {}; }
      const own = custom && typeof custom === 'object' ? custom : {};
      const result = await pushSender.send(session.userId, { title: 'StockMarketLoop', body: 'Push is working on this device.', url: 'https://stockmarketloop.com/', collapseId: 'push-test',
        ...(typeof own.title === 'string' && own.title.trim() ? { title: own.title } : {}), ...(typeof own.body === 'string' && own.body.trim() ? { body: own.body } : {}) });
      json(request, response, 200, result);
      return true;
    }
    if (method === 'POST' && rest === '/push/send') {
      /* the site (alert plugins, Loop Kick) pushes to members' app devices. Signed like every other site -> platform call: x-sml-timestamp + x-sml-signature over "{ts}.{body}". */
      if (!siteSecret) { fail(request, response, 503, 'integration_unconfigured'); return true; }
      if (!/^application\/json(?:\s*;|$)/i.test(String(request.headers['content-type'] || ''))) { fail(request, response, 415, 'content_type_required'); return true; }
      const body = await readRequestBody(request, 256 * 1024);
      if (!body.ok) { fail(request, response, body.status || 400, body.error || 'invalid_body'); return true; }
      const verified = verifySignature({ secret: siteSecret, timestamp: request.headers['x-sml-timestamp'], signature: request.headers['x-sml-signature'], rawBody: body.rawBody, now: now() });
      if (!verified.ok) { fail(request, response, verified.status, verified.error); return true; }
      let input; try { input = JSON.parse(body.rawBody); } catch (_) { fail(request, response, 400, 'invalid_json'); return true; }
      if (!pushSender || !pushSender.configured) { fail(request, response, 503, 'push_senders_off'); return true; }
      const userIds = Array.isArray(input && input.userIds) ? input.userIds : (input && input.userId ? [input.userId] : []);
      if (!userIds.length || userIds.length > 500) { fail(request, response, 400, 'invalid_user_ids', { max: 500 }); return true; }
      const result = await pushSender.sendMany(userIds, input.message || {});
      json(request, response, result.ok ? 202 : 400, result);
      return true;
    }
    if (rest === '/push/devices' && (method === 'POST' || method === 'DELETE' || method === 'GET')) {
      const session = await member(request, response); if (!session) return true;
      if (!pushDevices) { fail(request, response, 503, 'push_unavailable'); return true; }
      if (method === 'GET') { json(request, response, 200, { ok: true, devices: await pushDevices.list(session.userId) }); return true; }
      const body = await readJson(request, response, 8 * 1024); if (!body) return true;
      const result = method === 'POST' ? await pushDevices.register(session.userId, body) : await pushDevices.remove(session.userId, body.token);
      const { status, ...payload } = result;
      json(request, response, status, payload);
      return true;
    }

    /* ---- the site, as the member ---- */
    m = /^\/site\/(.+)$/.exec(rest);
    if (m && (method === 'GET' || method === 'POST' || method === 'DELETE')) {
      const session = await member(request, response, 2); if (!session) return true;
      if (!identity || !identity.configured) { fail(request, response, 503, 'identity_unconfigured'); return true; }
      const route = m[1].replace(/^\/+/, '');
      if (!SITE_ROUTE.test(route) || SITE_DENY.test(route) || !SITE_ALLOW.some((p) => route === p.replace(/\/$/, '') || route.startsWith(p))) { fail(request, response, 404, 'site_route_not_allowed'); return true; }
      const query = {}; for (const [k, v] of params(request)) if (Object.keys(query).length < 40 && /^[\w\[\].-]{1,64}$/.test(k)) query[k] = String(v).slice(0, 1024);
      let body = null;
      if (method !== 'GET') { body = await readJson(request, response, 64 * 1024); if (!body) return true; }
      const result = await identity.proxy({ userId: session.userId, method, route: '/' + route, query, body });
      if (!result.ok) { fail(request, response, result.status || 503, result.error); return true; }
      const siteStatus = Number(result.siteStatus) || 200;
      json(request, response, siteStatus >= 200 && siteStatus < 600 ? siteStatus : 502, { ok: siteStatus < 400, route: '/' + route, status: siteStatus, body: result.body === undefined ? null : result.body }, { 'x-sml-site-status': String(siteStatus) });
      return true;
    }

    fail(request, response, 404, 'not_found');
    return true;
  }

  return { handle, PREFIX, CONTRACT, SITE_ALLOW, stats: () => ({ streams }) };
}

module.exports = { createAppApi, PREFIX, CONTRACT, SITE_ALLOW, SITE_DENY };
