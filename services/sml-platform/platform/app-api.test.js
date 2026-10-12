'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./server');
const { createAppApi } = require('./app-api');
const { createAppAuth, createAppSessionStore } = require('./app-auth');
const { createAppPushDevices } = require('./app-push-devices');

const SECRET = 'k'.repeat(48);
const START = Date.UTC(2026, 9, 12, 14, 30);

function fakeIdentity() {
  const proxied = [];
  return {
    configured: true, proxied,
    async login({ login, password, code }) {
      if (login === 'vaughn' && password === 'pw') return { ok: true, status: 200, user: { id: 7, login: 'vaughn', displayName: 'Vaughn' } };
      if (login === 'two.step' && password === 'pw') return code === '246810' ? { ok: true, status: 200, user: { id: 9, login: 'two.step' } } : { ok: false, status: 403, error: 'two_step_required', method: 'email', hint: 'v•••@example.com' };
      return { ok: false, status: 401, error: 'invalid_credentials' };
    },
    async me(userId) { return { ok: true, status: 200, user: { id: userId, login: 'vaughn', displayName: 'Vaughn', avatar: 'https://stockmarketloop.com/a.png' }, groups: [{ id: 77, name: 'Making Easy Money', role: 'owner' }], wallet: { loopBucks: 1200 }, twoStep: { enabled: true } }; },
    async proxy(call) { proxied.push(call); return { ok: true, status: 200, siteStatus: call.route.endsWith('/missing') ? 404 : 200, body: { echoed: call.route, method: call.method, query: call.query, body: call.body, as: call.userId } }; }
  };
}

function fakeMassive() {
  const listeners = new Map();
  return {
    status: () => ({ enabled: true }),
    watch() {},
    peek(sym) { return sym === 'COLD' ? null : { symbol: sym, last: 101.5, quote: { bid: 101.4, ask: 101.6, bs: 3, as: 5, t: START }, quoteFresh: true, lastTradeAt: START, stats: { count: 12 }, tape: [{ p: 101.5, s: 100, t: START }] }; },
    on(sym, fn) { listeners.set(sym, fn); return () => listeners.delete(sym); },
    emit(sym, evt) { const fn = listeners.get(sym); if (fn) fn(evt); },
    listeners
  };
}

async function withApp(run, { identity = fakeIdentity(), massive = fakeMassive(), extra = {} } = {}) {
  let t = START;
  const now = () => t;
  const auth = createAppAuth({ store: createAppSessionStore(), identity, secret: SECRET, now, logger: () => {} });
  const sireFeed = { subscribe(write) { write('snapshot', { rows: [{ s: 'NVDA', p: 1 }] }); return () => {}; } };
  const appApi = createAppApi({
    auth, identity, massive, sireFeed, now, logger: () => {},
    scanner: async () => ({ rows: [{ symbol: 'NVDA', price: 1 }], asOf: START, source: 'wordpress-scanner' }),
    marketHistory: { enabled: true, get: async (symbol, tf) => ({ ok: true, status: 200, data: { symbol, tf, bars: [{ t: 1, o: 1, h: 2, l: 1, c: 2, v: 10 }], source: 'massive-rest' } }) },
    timeframes: { '5m': {}, '1D': {} },
    candles: async (symbol, tf) => ({ symbol, tf, bars: [{ t: 2, o: 1, h: 1, l: 1, c: 1 }], source: 'wordpress-history' }),
    news: async (symbol) => (symbol === 'NVDA' ? [{ title: 'Nvidia beats', url: 'https://example.com/n' }] : null),
    pushDevices: createAppPushDevices({ now }),
    corsOrigins: ['https://app.example.com'],
    ...extra
  });
  const server = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted', logger: () => {}, now, appApi });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
    const res = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (_) { json = null; }
    return { status: res.status, json, headers: res.headers, text };
  };
  const signIn = async (login = 'vaughn', password = 'pw', extraBody = {}) => (await api('/v1/app/auth/login', { method: 'POST', body: { login, password, device: { id: 'd1', name: 'Test phone', platform: 'ios' }, ...extraBody } })).json;
  try { await run({ api, base, signIn, auth, identity, massive, clock: { advance: (ms) => { t += ms; } } }); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('discovery, sign-in, me: the app learns the contract, signs in with the site account, reads the member', async () => {
  await withApp(async ({ api, signIn }) => {
    const root = (await api('/v1/app')).json;
    assert.equal(root.ok, true); assert.equal(root.version, 1); assert.equal(root.ready, true); assert.equal(root.accessTokenSeconds, 900); assert.equal(root.refreshTokenDays, 60);

    assert.equal((await api('/v1/app/auth/login', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })).status, 415);
    assert.deepEqual((await api('/v1/app/auth/login', { method: 'POST', body: { login: 'vaughn', password: 'bad' } })).json, { ok: false, error: 'invalid_credentials' });
    const needs = await api('/v1/app/auth/login', { method: 'POST', body: { login: 'two.step', password: 'pw' } });
    assert.equal(needs.status, 403); assert.equal(needs.json.error, 'two_step_required'); assert.equal(needs.json.method, 'email'); assert.equal(needs.json.hint, 'v•••@example.com');
    const two = await signIn('two.step', 'pw', { code: '246810' });
    assert.equal(two.ok, true); assert.equal(two.user.id, 9);

    const s = await signIn();
    assert.equal(s.ok, true); assert.equal(s.user.displayName, 'Vaughn'); assert.ok(s.accessToken && s.refreshToken);

    assert.deepEqual((await api('/v1/app/me')).json, { ok: false, error: 'authorization_required' });
    const me = await api('/v1/app/me', { token: s.accessToken });
    assert.equal(me.status, 200); assert.equal(me.json.user.id, 7); assert.equal(me.json.groups[0].name, 'Making Easy Money'); assert.equal(me.json.wallet.loopBucks, 1200);
    assert.equal((await api('/v1/app/me', { token: s.accessToken })).json.cached, true, 'a second read within a minute is served from cache');
    assert.equal((await api('/v1/app/me?fresh=1', { token: s.accessToken })).json.cached, undefined);
    assert.equal((await api('/v1/app/nope', { token: s.accessToken })).status, 404);
  });
});

test('expired access tokens say token_expired; refresh brings a new pair; revoking a device cuts it off at once', async () => {
  await withApp(async ({ api, signIn, clock }) => {
    const s = await signIn();
    clock.advance(16 * 60_000);
    assert.deepEqual((await api('/v1/app/me', { token: s.accessToken })).json, { ok: false, error: 'token_expired' });
    const r = (await api('/v1/app/auth/refresh', { method: 'POST', body: { refreshToken: s.refreshToken } })).json;
    assert.equal(r.ok, true); assert.equal(r.userId, 7); assert.notEqual(r.refreshToken, s.refreshToken);
    assert.equal((await api('/v1/app/me', { token: r.accessToken })).status, 200);
    const reuse = await api('/v1/app/auth/refresh', { method: 'POST', body: { refreshToken: s.refreshToken } });
    assert.equal(reuse.status, 401); assert.equal(reuse.json.error, 'refresh_reused');

    const t2 = await signIn();
    const list = (await api('/v1/app/auth/sessions', { token: t2.accessToken })).json.sessions;
    assert.equal(list.length, 1, 'the reused family is gone; only the new sign-in remains'); assert.equal(list[0].current, true); assert.equal(list[0].device.name, 'Test phone');
    const other = await signIn();
    assert.equal((await api('/v1/app/auth/sessions/' + other.sessionId, { method: 'DELETE', token: t2.accessToken })).status, 200);
    assert.deepEqual((await api('/v1/app/me', { token: other.accessToken })).json, { ok: false, error: 'session_revoked' });
    assert.equal((await api('/v1/app/auth/logout', { method: 'POST', body: { refreshToken: t2.refreshToken } })).status, 200);
    assert.equal((await api('/v1/app/auth/refresh', { method: 'POST', body: { refreshToken: t2.refreshToken } })).json.error, 'refresh_revoked');
    const t3 = await signIn();
    assert.equal((await api('/v1/app/auth/logout-all', { method: 'POST', token: t3.accessToken, body: {} })).status, 200);
    assert.equal((await api('/v1/app/me', { token: t3.accessToken })).json.error, 'session_revoked');
  });
});

test('market data comes from this service: quote, candles (Massive then the site relay), news, scanner', async () => {
  await withApp(async ({ api, signIn }) => {
    const s = await signIn();
    const q = (await api('/v1/app/tickers/nvda/quote', { token: s.accessToken })).json;
    assert.equal(q.ok, true); assert.equal(q.symbol, 'NVDA'); assert.equal(q.last, 101.5); assert.equal(q.quote.bid, 101.4); assert.equal(q.tape.length, 1);
    const cold = (await api('/v1/app/tickers/COLD/quote', { token: s.accessToken })).json;
    assert.equal(cold.ready, false); assert.equal(cold.warming, true);
    assert.equal((await api('/v1/app/tickers/BAD$/quote', { token: s.accessToken })).status, 404, 'symbols are matched by the route pattern');
    assert.equal((await api('/v1/app/tickers/1ABC/quote', { token: s.accessToken })).json.error, 'invalid_symbol');
    const c5 = (await api('/v1/app/tickers/NVDA/candles?tf=5m', { token: s.accessToken })).json;
    assert.equal(c5.source, 'massive-rest'); assert.equal(c5.tf, '5m');
    const c3 = (await api('/v1/app/tickers/NVDA/candles?tf=3m', { token: s.accessToken })).json;
    assert.equal(c3.source, 'wordpress-history', 'a timeframe Massive lacks falls back to the site relay');
    assert.equal((await api('/v1/app/tickers/NVDA/candles?tf=7m', { token: s.accessToken })).json.error, 'invalid_timeframe');
    const n = (await api('/v1/app/tickers/NVDA/news', { token: s.accessToken })).json;
    assert.equal(n.articles[0].title, 'Nvidia beats');
    assert.deepEqual((await api('/v1/app/tickers/AMD/news', { token: s.accessToken })).json.articles, []);
    const sc = (await api('/v1/app/scanner', { token: s.accessToken })).json;
    assert.equal(sc.ok, true); assert.equal(sc.rows[0].symbol, 'NVDA');
    assert.equal((await api('/v1/app/scanner')).status, 401);
  });
});

test('live streams: the scanner feed and a multi-symbol quote stream over Server-Sent Events', async () => {
  await withApp(async ({ base, signIn, massive }) => {
    const s = await signIn();
    const readFirst = async (path, wait = 0) => {
      const controller = new AbortController();
      const res = await fetch(base + path, { headers: { authorization: 'Bearer ' + s.accessToken }, signal: controller.signal });
      assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /text\/event-stream/);
      const reader = res.body.getReader();
      let text = '';
      const first = await reader.read(); text += Buffer.from(first.value).toString();
      if (wait) { await new Promise((r) => setTimeout(r, wait)); massive.emit('NVDA', { type: 'trade', trade: { p: 102, s: 50 } }); massive.emit('AMD', { type: 'quote', quote: { bid: 1, ask: 2 } }); await new Promise((r) => setTimeout(r, 150)); const more = await reader.read(); text += Buffer.from(more.value).toString(); }
      controller.abort();
      return text;
    };
    const scanner = await readFirst('/v1/app/scanner/stream');
    assert.match(scanner, /event: snapshot\ndata: \{"rows":\[\{"s":"NVDA"/);
    const quotes = await readFirst('/v1/app/stream?symbols=nvda,AMD', 20);
    assert.match(quotes, /event: snapshot\ndata: \{"symbol":"NVDA","last":101.5/);
    assert.match(quotes, /event: trade\ndata: \{"symbol":"NVDA","p":102,"s":50\}/);
    assert.match(quotes, /event: quote\ndata: \{"symbol":"AMD","bid":1,"ask":2\}/);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(massive.listeners.size, 0, 'closing the stream unsubscribes every symbol');
    const tooMany = await fetch(base + '/v1/app/stream?symbols=' + Array.from({ length: 21 }, (_, i) => 'S' + i).join(','), { headers: { authorization: 'Bearer ' + s.accessToken } });
    assert.equal(tooMany.status, 400); assert.equal((await tooMany.json()).max, 20);
  });
});

test('the site, as the member: allow-listed WordPress routes run with the member\'s id; sign-in and admin routes are refused', async () => {
  await withApp(async ({ api, signIn, identity }) => {
    const s = await signIn();
    const feed = await api('/v1/app/site/sml-feed/v1/slot?page=2&kind=ticker', { token: s.accessToken });
    assert.equal(feed.status, 200); assert.equal(feed.headers.get('x-sml-site-status'), '200');
    assert.deepEqual(feed.json, { ok: true, route: '/sml-feed/v1/slot', status: 200, body: { echoed: '/sml-feed/v1/slot', method: 'GET', query: { page: '2', kind: 'ticker' }, body: null, as: 7 } });
    const vote = await api('/v1/app/site/sml-members/v1/post-vote', { method: 'POST', token: s.accessToken, body: { post: 5, dir: 1 } });
    assert.equal(vote.json.body.method, 'POST'); assert.deepEqual(vote.json.body.body, { post: 5, dir: 1 });
    const missing = await api('/v1/app/site/sml-lb/v1/missing', { token: s.accessToken });
    assert.equal(missing.status, 404); assert.equal(missing.json.ok, false); assert.equal(missing.json.status, 404);
    for (const bad of ['sml-members/v1/login', 'sml-members/v1/register', 'sml-lb/v1/reset', 'sml-lb/v1/webhook', 'sml-lb/v1/checkout', 'wp/v2/users', 'sml-hub/v1/export/relay', 'jetpack/v4/x', 'sml-feed/v1/..%2Fadmin']) {
      const r = await api('/v1/app/site/' + bad, { token: s.accessToken });
      assert.equal(r.json.error, 'site_route_not_allowed', bad);
    }
    assert.equal((await api('/v1/app/site/../etc', { token: s.accessToken })).status, 404, 'dot segments are resolved before routing and land nowhere');
    assert.equal(identity.proxied.length, 3);
    assert.equal((await api('/v1/app/site/sml-feed/v1/slot')).status, 401);
  });
});

test('push device tokens: register, list, remove; a token moves to whoever signs in on that phone', async () => {
  await withApp(async ({ api, signIn }) => {
    const s = await signIn();
    const reg = await api('/v1/app/push/devices', { method: 'POST', token: s.accessToken, body: { platform: 'ios', token: 'a'.repeat(64), deviceId: 'd1', appVersion: '1.0.0' } });
    assert.equal(reg.status, 200); assert.equal(reg.json.device.platform, 'ios'); assert.equal(reg.json.device.userId, 7);
    assert.equal((await api('/v1/app/push/devices', { method: 'POST', token: s.accessToken, body: { platform: 'windows', token: 'a'.repeat(64) } })).json.error, 'invalid_platform');
    assert.equal((await api('/v1/app/push/devices', { method: 'POST', token: s.accessToken, body: { platform: 'android', token: 'short' } })).json.error, 'invalid_token');
    const two = await signIn('two.step', 'pw', { code: '246810' });
    await api('/v1/app/push/devices', { method: 'POST', token: two.accessToken, body: { platform: 'ios', token: 'a'.repeat(64) } });
    assert.deepEqual((await api('/v1/app/push/devices', { token: s.accessToken })).json.devices, [], 'the phone now belongs to the other member');
    assert.equal((await api('/v1/app/push/devices', { token: two.accessToken })).json.devices.length, 1);
    assert.equal((await api('/v1/app/push/devices', { method: 'DELETE', token: two.accessToken, body: { token: 'a'.repeat(64) } })).json.removed, true);
    assert.deepEqual((await api('/v1/app/push/devices', { token: two.accessToken })).json.devices, []);
  });
});

test('sign-in is throttled per address and per account name; members are throttled per account, never per address', async () => {
  await withApp(async ({ api, signIn, clock }) => {
    let last;
    for (let i = 0; i < 11; i += 1) last = await api('/v1/app/auth/login', { method: 'POST', body: { login: 'vaughn', password: 'bad' } });
    assert.equal(last.status, 429); assert.equal(last.json.error, 'rate_limited'); assert.ok(last.json.retryAfterSec >= 1);
    clock.advance(60_000);
    const fromElsewhere = await api('/v1/app/auth/login', { method: 'POST', body: { login: 'vaughn', password: 'pw' }, headers: { 'x-forwarded-for': '203.0.113.9' } });
    assert.equal(fromElsewhere.status, 429, 'the account name itself is throttled for 15 minutes after repeated attempts');
    clock.advance(15 * 60_000);
    const s = await signIn();
    assert.equal(s.ok, true);
    for (let i = 0; i < 600; i += 1) await api('/v1/app/scanner', { token: s.accessToken });
    const over = await api('/v1/app/scanner', { token: s.accessToken });
    assert.equal(over.status, 429);
    const other = await signIn('two.step', 'pw', { code: '246810' });
    assert.equal((await api('/v1/app/scanner', { token: other.accessToken })).status, 200, 'another member on the same address is unaffected');
  });
});

test('CORS: stockmarketloop.com and the configured PWA origin may call from a browser; others get no CORS headers', async () => {
  await withApp(async ({ api }) => {
    const pre = await api('/v1/app/me', { method: 'OPTIONS', headers: { origin: 'https://app.example.com', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
    assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), 'https://app.example.com'); assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
    const sml = await api('/v1/app', { headers: { origin: 'https://www.stockmarketloop.com' } });
    assert.equal(sml.headers.get('access-control-allow-origin'), 'https://www.stockmarketloop.com');
    const evil = await api('/v1/app', { headers: { origin: 'https://evil.example.net' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
  });
});

test('without the identity plugin or signing secret every route fails closed with 503', async () => {
  await withApp(async ({ api }) => {
    assert.equal((await api('/v1/app')).json.ready, false);
    assert.deepEqual((await api('/v1/app/auth/login', { method: 'POST', body: { login: 'vaughn', password: 'pw' } })).json, { ok: false, error: 'app_auth_unconfigured' });
    assert.equal((await api('/v1/app/me', { headers: { authorization: 'Bearer a1.b.c' } })).status, 503);
  }, { identity: { configured: false } });
});
