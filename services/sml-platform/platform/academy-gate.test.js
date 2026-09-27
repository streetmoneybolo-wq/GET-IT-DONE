'use strict';

/* The Academy gate flags on the API (sml-platform-api): the content gate, free
   sessions, closed-alert tiering and in-Discord buy links. Every test runs
   with the flag off (academyGate null, as main() builds it when all flags are
   unset) and on. No network: stockmarketloop.com is stubbed below. */

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { createServer, academyActivityHtml } = require('./server');
const { createAcademyContentGate } = require('./academy-access');
const { SEED_LESSONS } = require('./academy/curriculum');

const GUILD = '938894329076940820';
const USER = '420000000000000042';

const realFetch = globalThis.fetch;
const upstream = { history: [] };
globalThis.fetch = async (url, options) => {
  const target = String(url);
  if (!target.startsWith('https://stockmarketloop.com/')) return realFetch(url, options);
  const parsed = new URL(target);
  if (parsed.pathname === '/wp-json/sml/v1/history') {
    upstream.history.push(parsed.searchParams.get('symbol'));
    return new Response(JSON.stringify({ bars: [{ t: 1_700_000_000_000, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }] }), { status: 200 });
  }
  if (parsed.pathname === '/wp-json/sml-scanner/v1/live') return new Response(JSON.stringify({ rows: [{ symbol: 'SPY', price: 500 }, { symbol: 'AAPL', price: 200 }, { symbol: 'QQQ', price: 400 }] }), { status: 200 });
  if (parsed.pathname === '/wp-json/sml-scanner/v1/market-v2') return new Response(JSON.stringify({ book: { bids: [{ price: 1, size: 1 }], asks: [{ price: 1.1, size: 1 }] } }), { status: 200 });
  return new Response('{}', { status: 404 });
};

const TIERS = { 'Bearer member': 'member', 'Bearer academy': 'academy', 'Bearer free': 'free', 'Bearer legacy': undefined };
function oauth(completeActivity = async () => ({ ok: false, status: 401, code: 'authorization_failed' })) {
  return {
    verifySession: (authorization) => (Object.prototype.hasOwnProperty.call(TIERS, authorization)
      ? { ok: true, userId: USER, ...(TIERS[authorization] ? { tier: TIERS[authorization] } : {}) }
      : { ok: false, status: 401, code: 'authorization_required' }),
    completeActivity
  };
}
function gate({ contentGate = true, alertsTiering = false, inDiscordLinks = false, handoff = null } = {}) {
  return Object.freeze({
    ...createAcademyContentGate({ enabled: contentGate, freePreview: 'M0,M29:1-10', freeSymbols: ['SPY', 'QQQ'], alertsTiering }),
    freeSessions: true, inDiscordLinks, guildId: GUILD, handoff
  });
}
function stubs() {
  const calls = [];
  return {
    calls,
    academyVoice: { configured: true, getLessonAudio: async ({ moduleId, lessonId }) => { calls.push(['voice', moduleId, lessonId]); return { audio: Buffer.from('ID3'), cached: false, partMs: [1] }; } },
    academySlideDesigner: { configured: true, getLessonDesign: async ({ moduleId, lessonId }) => { calls.push(['design', moduleId, lessonId]); return { cached: true, design: { slides: [] } }; } },
    academyProgress: { configured: true, read: async () => ({}), state: async () => null, save: async (_user, input) => ({ saved: `${input.moduleId}.${input.lessonId}` }), saveResume: async () => ({}) },
    academyAlerts: {
      snapshot: (...args) => { calls.push(['snapshot', ...args]); return { ok: true, alerts: [] }; },
      detail: async (...args) => { calls.push(['detail', ...args]); return { id: args[0] }; },
      avatar: async () => null
    },
    academyDataBridge: { get: async () => ({ ok: true, data: { chain: [] } }) },
    loopKickBridge: { configured: true, session: async () => ({ ok: true, token: 'site-session' }) },
    academyOrderFlow: { get: (symbol) => ({ symbol }), live: (symbol) => ({ symbol, ready: true, tape: [] }), peek: () => null },
    academyMassive: { status: () => ({ enabled: true }), watch: () => {}, peek: () => null, on: () => () => {} },
    marketHistory: { enabled: true, get: async (symbol, tf) => ({ ok: true, data: { symbol, tf, bars: [] } }) }
  };
}
async function withServer(options, run) {
  const server = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted', logger: () => {}, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((resolve) => server.close(resolve)); }
}
const get = (base, path, token) => realFetch(`${base}${path}`, token ? { headers: { authorization: token } } : {});
const post = (base, path, body, token) => realFetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: token } : {}) }, body: JSON.stringify(body) });

test('content gate off: the curriculum, lesson audio and every symbol stay public, exactly as before', async () => {
  const s = stubs();
  await withServer({ ...s, academyOAuth: oauth(), academyGate: null }, async (base) => {
    const curriculum = await get(base, '/academy-activity/curriculum');
    assert.match(curriculum.headers.get('cache-control'), /public, max-age=3600/);
    const payload = await curriculum.json();
    assert.equal(payload.lessons.length, SEED_LESSONS.length);
    assert.equal(payload.lessons.some((lesson) => lesson.locked), false);
    assert.equal((await get(base, '/academy-activity/speech?moduleId=5&lessonId=1')).status, 200);
    assert.equal((await get(base, '/academy-activity/market?symbol=AAPL')).status, 200);
    assert.equal((await get(base, '/academy-activity/orderflow?symbol=AAPL')).status, 200);
    assert.equal((await get(base, '/academy-activity/live?symbol=AAPL')).status, 200);
    const scanner = await (await get(base, '/academy-activity/scanner')).json();
    assert.deepEqual(scanner.rows.map((row) => row.symbol), ['SPY', 'AAPL', 'QQQ']);
    assert.equal('locked' in scanner, false);
    assert.equal((await get(base, '/academy-activity/mem-algo.js', 'Bearer member')).status, 404, 'the gated model route does not exist');
    const progress = await post(base, '/academy-activity/progress', { moduleId: 5, lessonId: 1, score: 80 }, 'Bearer free');
    assert.equal(progress.status, 200, 'with the gate off even a free session saves any lesson (the content is public)');
  });
});

test('content gate on: anonymous and free callers get the free preview; paid sessions get every lesson, never from a shared cache', async () => {
  await withServer({ academyOAuth: oauth(), academyGate: gate() }, async (base) => {
    const anonymous = await get(base, '/academy-activity/curriculum');
    assert.equal(anonymous.status, 200);
    assert.equal(anonymous.headers.get('cache-control'), 'private, no-store');
    assert.equal(anonymous.headers.get('x-academy-access'), 'preview');
    assert.match(anonymous.headers.get('vary'), /Authorization/);
    const preview = await anonymous.json();
    assert.equal(preview.gated, true);
    assert.equal(preview.lessons.length, SEED_LESSONS.length, 'every lesson is listed so the picker still shows what unlocks');
    const free = preview.lessons.filter((lesson) => !lesson.locked);
    assert.equal(free.length, 30);
    assert.ok(free.every((lesson) => lesson.moduleId === 0 || (lesson.moduleId === 29 && lesson.lessonId <= 10)));
    const text = JSON.stringify(preview.lessons.filter((lesson) => lesson.locked));
    for (const seed of SEED_LESSONS.filter((lesson) => !(lesson.moduleId === 0 || (lesson.moduleId === 29 && lesson.lessonId <= 10)))) {
      assert.equal(text.includes(seed.question.explanation), false, `M${seed.moduleId}.${seed.lessonId} quiz explanation must not leak`);
      assert.equal(text.includes(seed.steps[1]), false, `M${seed.moduleId}.${seed.lessonId} lesson body must not leak`);
    }
    const freeSession = await (await get(base, '/academy-activity/curriculum', 'Bearer free')).json();
    assert.deepEqual(freeSession, preview);
    for (const token of ['Bearer member', 'Bearer academy', 'Bearer legacy']) {
      const full = await get(base, '/academy-activity/curriculum', token);
      assert.equal(full.headers.get('x-academy-access'), 'full', token);
      assert.equal(full.headers.get('cache-control'), 'private, no-store', token);
      const body = await full.json();
      assert.equal(body.lessons.filter((lesson) => lesson.locked).length, 0, token);
      assert.equal(body.lessons.length, SEED_LESSONS.length);
    }
    assert.equal((await get(base, '/academy-activity/curriculum', 'Bearer expired')).status, 401, 'a dead session renews rather than silently downgrading');
  });
});

test('content gate on: lesson audio, slide design and progress follow the free preview for free and anonymous callers', async () => {
  const s = stubs();
  await withServer({ ...s, academyOAuth: oauth(), academyGate: gate() }, async (base) => {
    assert.equal((await get(base, '/academy-activity/speech?moduleId=0&lessonId=1')).status, 200);
    assert.equal((await get(base, '/academy-activity/speech?moduleId=29&lessonId=10')).status, 200);
    const locked = await get(base, '/academy-activity/speech?moduleId=5&lessonId=1');
    assert.equal(locked.status, 403);
    assert.equal((await locked.json()).error, 'lesson_locked');
    assert.equal((await get(base, '/academy-activity/speech?moduleId=5&lessonId=1', 'Bearer free')).status, 403);
    assert.equal((await get(base, '/academy-activity/speech?moduleId=5&lessonId=1', 'Bearer academy')).status, 200);
    assert.equal((await get(base, '/academy-activity/speech?moduleId=5&lessonId=1', 'Bearer nope')).status, 401);
    assert.equal(s.calls.filter(([kind, m]) => kind === 'voice' && m === '5').length, 1, 'narration was generated only for the paid session');

    assert.equal((await get(base, '/academy-activity/slide-design?moduleId=5&lessonId=1', 'Bearer free')).status, 403);
    assert.equal((await get(base, '/academy-activity/slide-design?moduleId=0&lessonId=1', 'Bearer free')).status, 200);
    assert.equal((await get(base, '/academy-activity/slide-design?moduleId=5&lessonId=1', 'Bearer member')).status, 200);

    assert.equal((await post(base, '/academy-activity/progress', { moduleId: 5, lessonId: 1, score: 80 }, 'Bearer free')).status, 403);
    assert.equal((await post(base, '/academy-activity/progress', { moduleId: 0, lessonId: 1, score: 80 }, 'Bearer free')).status, 200);
    assert.equal((await post(base, '/academy-activity/progress', { moduleId: 5, lessonId: 1, score: 80 }, 'Bearer academy')).status, 200);
  });
});

test('content gate on: live data serves only the free symbols to free and anonymous callers', async () => {
  const s = stubs();
  await withServer({ ...s, academyOAuth: oauth(), academyGate: gate() }, async (base) => {
    assert.equal((await get(base, '/academy-activity/market?symbol=SPY')).status, 200);
    assert.equal((await get(base, '/academy-activity/market?symbol=qqq')).status, 200);
    const refused = await get(base, '/academy-activity/market?symbol=AAPL');
    assert.equal(refused.status, 403);
    assert.deepEqual(await refused.json(), { ok: false, error: 'academy_access_required', freeSymbols: ['SPY', 'QQQ'] });
    assert.equal((await get(base, '/academy-activity/market?symbol=AAPL', 'Bearer free')).status, 403);
    assert.equal((await get(base, '/academy-activity/market?symbol=AAPL', 'Bearer academy')).status, 200);
    assert.equal((await get(base, '/academy-activity/market?symbol=AAPL', 'Bearer legacy')).status, 200);
    assert.equal((await get(base, '/academy-activity/market?symbol=AAPL', 'Bearer nope')).status, 401);
    for (const route of ['orderflow', 'live']) {
      assert.equal((await get(base, `/academy-activity/${route}?symbol=AAPL`)).status, 403, route);
      assert.equal((await get(base, `/academy-activity/${route}?symbol=SPY`)).status, 200, route);
      assert.equal((await get(base, `/academy-activity/${route}?symbol=AAPL`, 'Bearer member')).status, 200, route);
    }
    assert.equal((await get(base, '/academy-activity/stream?symbol=AAPL')).status, 403, 'the stream cannot carry a session, so it serves free symbols only');
    const controller = new AbortController();
    const stream = await realFetch(`${base}/academy-activity/stream?symbol=SPY`, { signal: controller.signal });
    assert.equal(stream.status, 200);
    controller.abort();
    const anonymous = await (await get(base, '/academy-activity/scanner')).json();
    assert.deepEqual(anonymous.rows.map((row) => row.symbol), ['SPY', 'QQQ']);
    assert.equal(anonymous.locked, true);
    const member = await (await get(base, '/academy-activity/scanner', 'Bearer academy')).json();
    assert.deepEqual(member.rows.map((row) => row.symbol), ['SPY', 'AAPL', 'QQQ']);
    assert.equal((await get(base, '/academy-activity/scanner', 'Bearer nope')).status, 401);
  });
});

function runModel(source) {
  const window = {};
  vm.runInNewContext(source, { window, document: { getElementById: () => null, querySelector: () => null }, localStorage: { getItem: () => null, setItem: () => {} } });
  return window.MemAlgoEngine;
}

test('content gate on: MEM ALGO leaves the page; paid sessions load all five strategies, a free session the Day strategy only', async () => {
  await withServer({ academyOAuth: oauth(), academyGate: gate() }, async (base) => {
    assert.equal((await get(base, '/academy-activity/mem-algo.js')).status, 401);
    const full = await get(base, '/academy-activity/mem-algo.js', 'Bearer academy');
    assert.equal(full.status, 200);
    assert.match(full.headers.get('content-type'), /javascript/);
    assert.equal(full.headers.get('cache-control'), 'private, no-store');
    const all = runModel(await full.text());
    assert.deepEqual(Object.keys(all.STRATEGIES), ['day', 'swing', 'mid', 'long', 'short']);
    const teaserSource = await (await get(base, '/academy-activity/mem-algo.js', 'Bearer free')).text();
    const teaser = runModel(teaserSource);
    assert.deepEqual(Object.keys(teaser.STRATEGIES), ['day']);
    assert.equal(typeof teaser.analyze, 'function');
    /* Moved from the part review: the teaser SOURCE holds the Day strategy
       only, so a free session can neither read nor run the paid ones. */
    assert.equal(all.resolveParams('swing', {}, '1D').fast, 20, 'precondition: the paid Swing model uses EMA 20');
    for (const key of ['swing', 'mid', 'long', 'short']) {
      assert.equal(teaser.resolveParams(key, {}, '1D').fast, all.STRATEGIES.day.params.fast, `${key} falls back to the Day parameters`);
      assert.equal(teaserSource.includes(all.STRATEGIES[key].label), false, `the paid "${all.STRATEGIES[key].label}" definition is not served`);
      assert.equal(teaserSource.includes(all.STRATEGIES[key].blurb), false);
    }
    assert.equal(teaser.analyze([], 'swing').mode, 'swing', 'the panel still works; it just runs Day parameters');
    assert.equal(teaser.analyze([], 'swing').params.fast, 9);
  });
});

function classicScripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(([, attributes]) => !/type\s*=\s*["']?module/i.test(attributes)).map(([, , source]) => source);
}

test('the Activity page is unchanged with the flags off, and gated with them on', async () => {
  const market = { symbol: 'SPY', tf: '5m', bars: [], scanner: { rows: [] }, depth: { bids: [], asks: [] } };
  const plain = academyActivityHtml(market, { appId: '1551336038713139370' });
  assert.equal(academyActivityHtml(market, { appId: '1551336038713139370', gate: null }), plain);
  assert.doesNotMatch(plain, /SML_ACADEMY_GATE/);
  assert.match(plain, /window\.MemAlgoEngine=module\.exports/);

  const linksOnly = academyActivityHtml(market, { appId: '1551336038713139370', gate: { contentGate: false, links: true } });
  assert.match(linksOnly, /window\.SML_ACADEMY_GATE=\{"gate":false,"links":true\}/);
  assert.match(linksOnly, /window\.MemAlgoEngine=module\.exports/, 'the model stays inline without the content gate');
  assert.ok(linksOnly.indexOf('SML_ACADEMY_GATE') < linksOnly.indexOf('<body>'), 'the gate client runs before every page script');

  upstream.history.length = 0;
  await withServer({ academyOAuth: oauth(), academyGate: gate(), academyAppId: '1551336038713139370' }, async (base) => {
    const html = await (await get(base, '/academy-activity/?symbol=AAPL')).text();
    assert.match(html, /window\.SML_ACADEMY_GATE=\{"gate":true,"links":false\}/);
    assert.doesNotMatch(html, /window\.MemAlgoEngine=module\.exports/);
    assert.match(html, /\/academy-activity\/mem-algo\.js/);
    assert.ok(upstream.history.includes('SPY'), 'the page opens on a free symbol');
    assert.equal(upstream.history.includes('AAPL'), false, 'a locked symbol is never fetched for the page');
    assert.doesNotMatch(html, /"symbol":"AAPL"/, 'the embedded scanner holds free symbols only');
    for (const source of classicScripts(html)) assert.doesNotThrow(() => new Function(source), source.slice(0, 80));
  });
  await withServer({ academyOAuth: oauth(), academyGate: null, academyAppId: '1551336038713139370' }, async (base) => {
    const html = await (await get(base, '/academy-activity/')).text();
    assert.doesNotMatch(html, /SML_ACADEMY_GATE/);
    assert.match(html, /window\.MemAlgoEngine=module\.exports/);
  });
});

test('the gate client is plain script: it parses, and carries no template syntax, backticks or backslashes', () => {
  const html = academyActivityHtml({ symbol: 'SPY', bars: [] }, { gate: { contentGate: true, links: true } });
  const start = html.indexOf('<script>window.SML_ACADEMY_GATE=');
  const source = html.slice(start + '<script>'.length, html.indexOf('</script>', start));
  assert.doesNotThrow(() => new Function(source));
  assert.equal(source.includes('`'), false);
  assert.equal(source.includes('${'), false);
  assert.equal(source.includes(String.fromCharCode(92)), false);
  for (const route of ['curriculum', 'market', 'scanner', 'orderflow', 'live']) assert.match(source, new RegExp(`'/academy-activity/${route}'`));
  assert.match(source, /Get Academy access/);
  assert.ok(source.includes("'/academy-activity/buy'"), 'the buy link is minted on demand');
  assert.equal(source.includes('payload.buy.url'), false, 'the token response never carries a URL');
  assert.match(source, /visibilitychange/);
});

test('alerts: members see the live desk; free sessions a teaser; academy sessions closed alerts only with tiering on', async () => {
  const off = stubs();
  await withServer({ ...off, academyOAuth: oauth(), academyGate: null }, async (base) => {
    await get(base, '/academy-activity/alerts', 'Bearer member');
    await get(base, '/academy-activity/alerts', 'Bearer academy');
    await get(base, '/academy-activity/alerts?detail=123', 'Bearer academy');
    assert.deepEqual(off.calls, [['snapshot'], ['snapshot'], ['detail', '123']], 'tiering off: everyone admitted sees the live desk, as before');
    const free = await get(base, '/academy-activity/alerts', 'Bearer free');
    assert.equal(free.status, 200);
    assert.deepEqual(off.calls.at(-1), ['snapshot', { view: 'teaser' }], 'a free session never sees alerts, even with tiering off');
    const freeDetail = await get(base, '/academy-activity/alerts?detail=123', 'Bearer free');
    assert.equal(freeDetail.status, 403);
  });
  const on = stubs();
  await withServer({ ...on, academyOAuth: oauth(), academyGate: gate({ contentGate: false, alertsTiering: true }) }, async (base) => {
    await get(base, '/academy-activity/alerts', 'Bearer academy');
    await get(base, '/academy-activity/alerts?detail=123', 'Bearer academy');
    await get(base, '/academy-activity/alerts', 'Bearer member');
    await get(base, '/academy-activity/alerts', 'Bearer legacy');
    assert.deepEqual(on.calls, [['snapshot', { view: 'closed' }], ['detail', '123', { closedOnly: true }], ['snapshot'], ['snapshot']]);
  });
});

test('free sessions cannot reach the paid desk tools: options, earnings and LOOP-KICK', async () => {
  const s = stubs();
  await withServer({ ...s, academyOAuth: oauth(), academyGate: null }, async (base) => {
    for (const path of ['/academy-activity/data/options?symbol=SPY', '/academy-activity/data/earnings?symbol=SPY', '/academy-activity/loop-kick/session']) {
      assert.equal((await get(base, path, 'Bearer free')).status, 403, path);
      assert.equal((await get(base, path, 'Bearer academy')).status, 200, path);
      assert.equal((await get(base, path, 'Bearer member')).status, 200, path);
    }
  });
});

test('the token exchange: no tier or buy ticket with the flags off; with SML_ACADEMY_BILLING_IN_DISCORD_LINKS a buy ticket, never a URL, a session or a mint', async () => {
  let next;
  const tickets = [];
  const academyOAuth = { ...oauth(async () => next), issueBuyTicket: (userId) => { tickets.push(userId); return `b1.ticket-for-${userId}.sig`; } };
  const minted = [];
  const handoff = { configured: true, mint: async (request) => { minted.push(request); return { ok: true, url: 'https://making-easy-money-academy.onrender.com/v1/academy/billing/start?h=one-time' }; } };
  const exchange = (base) => post(base, '/academy-activity/token', { code: 'c' });

  await withServer({ academyOAuth, academyGate: null }, async (base) => {
    next = { ok: true, accessToken: 'discord-access', sessionToken: 'session', userId: USER, tier: 'academy' };
    assert.deepEqual(await (await exchange(base)).json(), { ok: true, access_token: 'discord-access', sessionToken: 'session' });
    next = { ok: false, status: 403, code: 'academy_role_required', userId: USER, inGuild: true };
    const refused = await exchange(base);
    assert.equal(refused.status, 403);
    assert.deepEqual(await refused.json(), { ok: false, error: 'academy_role_required' });
  });
  await withServer({ academyOAuth, academyGate: gate({ contentGate: false, inDiscordLinks: false, handoff }) }, async (base) => {
    next = { ok: true, accessToken: 'discord-access', sessionToken: 'session', userId: USER, tier: 'academy' };
    assert.deepEqual(await (await exchange(base)).json(), { ok: true, access_token: 'discord-access', sessionToken: 'session', tier: 'academy' });
    next = { ok: false, status: 403, code: 'academy_role_required', userId: USER, inGuild: true };
    assert.deepEqual(await (await exchange(base)).json(), { ok: false, error: 'academy_role_required' }, 'links off: no buy ticket');
  });
  assert.equal(tickets.length, 0);
  await withServer({ academyOAuth, academyGate: gate({ contentGate: false, inDiscordLinks: true, handoff }) }, async (base) => {
    next = { ok: false, status: 403, code: 'academy_role_required', userId: USER, inGuild: true };
    const refused = await exchange(base);
    assert.equal(refused.status, 403);
    const body = await refused.json();
    assert.deepEqual(body, { ok: false, error: 'academy_role_required', buy: { ticket: `b1.ticket-for-${USER}.sig` } });
    assert.equal('sessionToken' in body || 'access_token' in body, false, 'a refusal never carries a session');
    next = { ok: true, accessToken: 'discord-access', sessionToken: 'session', userId: USER, tier: 'free' };
    const free = await (await exchange(base)).json();
    assert.equal(free.tier, 'free');
    assert.deepEqual(free.buy, { ticket: `b1.ticket-for-${USER}.sig` });
    next = { ok: true, accessToken: 'discord-access', sessionToken: 'session', userId: USER, tier: 'member' };
    assert.equal('buy' in await (await exchange(base)).json(), false, 'members are never offered a purchase');
    next = { ok: false, status: 403, code: 'academy_role_required', inGuild: false };
    assert.equal('buy' in await (await exchange(base)).json(), false, 'no verified id, no ticket');
    next = { ok: false, status: 401, code: 'authorization_failed', userId: USER };
    assert.equal('buy' in await (await exchange(base)).json(), false, 'only a role miss is offered a ticket');
  });
  assert.deepEqual(tickets, [USER, USER]);
  assert.equal(minted.length, 0, 'sign-in and renewals never mint a handoff code or write a row');
  await withServer({ academyOAuth, academyGate: gate({ contentGate: false, inDiscordLinks: true, handoff: { configured: false, mint: handoff.mint } }) }, async (base) => {
    next = { ok: false, status: 403, code: 'academy_role_required', userId: USER, inGuild: true };
    assert.deepEqual(await (await exchange(base)).json(), { ok: false, error: 'academy_role_required' }, 'an unconfigured minter (no https public URL) offers nothing');
  });
});

test('POST /academy-activity/buy: a valid ticket gets a one-time handoff URL, rate-limited per member; the route is absent unless links are on', async () => {
  let clock = 1_800_000_000_000;
  const academyOAuth = { ...oauth(), issueBuyTicket: () => 'good', verifyBuyTicket: (ticket) => (ticket === 'good' ? { userId: USER } : null) };
  const minted = [];
  let code = 0;
  const handoff = { configured: true, mint: async (request) => { minted.push(request); code += 1; return { ok: true, url: `https://making-easy-money-academy.onrender.com/v1/academy/billing/start?h=code-${code}` }; } };
  const buy = (base, body, headers = { 'content-type': 'application/json' }) => realFetch(`${base}/academy-activity/buy`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

  await withServer({ academyOAuth, academyGate: null }, async (base) => {
    assert.equal((await buy(base, { ticket: 'good' })).status, 404, 'flags off: no such route');
  });
  await withServer({ academyOAuth, academyGate: gate({ contentGate: false, inDiscordLinks: false, handoff }) }, async (base) => {
    assert.equal((await buy(base, { ticket: 'good' })).status, 404, 'links off: no such route');
  });
  await withServer({ academyOAuth, academyGate: gate({ contentGate: false, inDiscordLinks: true, handoff: { configured: false, mint: handoff.mint } }) }, async (base) => {
    assert.equal((await buy(base, { ticket: 'good' })).status, 404, 'unconfigured minter: no such route');
  });
  assert.equal(minted.length, 0);
  await withServer({ academyOAuth, academyGate: gate({ contentGate: false, inDiscordLinks: true, handoff }), now: () => clock }, async (base) => {
    assert.equal((await buy(base, { ticket: 'good' }, {})).status, 415);
    assert.equal((await buy(base, '{nope')).status, 400);
    const forged = await buy(base, { ticket: 'forged' });
    assert.equal(forged.status, 401);
    assert.equal(minted.length, 0, 'a bad ticket never mints');
    const first = await buy(base, { ticket: 'good' });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await first.json(), { ok: true, url: 'https://making-easy-money-academy.onrender.com/v1/academy/billing/start?h=code-1' });
    assert.deepEqual(minted, [{ discordUserId: USER, guildId: GUILD, source: 'activity' }]);
    for (let i = 0; i < 4; i += 1) assert.equal((await buy(base, { ticket: 'good' })).status, 200);
    const limited = await buy(base, { ticket: 'good' });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error, 'rate_limited');
    assert.equal(minted.length, 5);
    clock += 600_000;
    assert.equal((await buy(base, { ticket: 'good' })).status, 200, 'the window resets after 10 minutes');
  });
  const warnings = [];
  await withServer({ academyOAuth, logger: (level, event, fields) => { if (event === 'academy_billing_handoff_failed') warnings.push(fields); },
    academyGate: gate({ contentGate: false, inDiscordLinks: true, handoff: { configured: true, mint: async () => ({ ok: false, code: 'handoff_timeout' }) } }) }, async (base) => {
    const failed = await buy(base, { ticket: 'good' });
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { ok: false, error: 'temporary_unavailable' });
    assert.deepEqual(warnings, [{ code: 'handoff_timeout' }]);
  });
  await withServer({ academyOAuth, academyGate: gate({ contentGate: false, inDiscordLinks: true, handoff: { configured: true, mint: async () => { throw new Error('boom'); } } }) }, async (base) => {
    assert.equal((await buy(base, { ticket: 'good' })).status, 503, 'a throwing minter is a 503, never a crash');
  });
});

/* Moved from the part review (rejected, with evidence): the task says quiz
   answers never go to non-entitled callers. Locked lessons carry none. The
   free-preview lessons keep theirs because the Activity grades every round in
   the browser (academy-activity-curriculum.js, owned by another part), so
   stripping them would mark every free answer wrong. They are answers to free
   content. The guard below fails if the client stops grading locally, which is
   the moment to strip them too. */
test('content gate on: locked lessons carry no quiz answers; free-preview lessons keep theirs only because the Activity grades in the browser', async () => {
  const fs = require('node:fs');
  const pathModule = require('node:path');
  const { LOCKED_TEXT } = require('./academy-access');
  await withServer({ academyOAuth: oauth(), academyGate: gate() }, async (base) => {
    for (const token of [undefined, 'Bearer free']) {
      const preview = await (await get(base, '/academy-activity/curriculum', token)).json();
      const locked = preview.lessons.filter((lesson) => lesson.locked);
      assert.ok(locked.length > 0);
      for (const lesson of locked) {
        assert.equal(lesson.question, null, `M${lesson.moduleId}.${lesson.lessonId}`);
        assert.equal(lesson.simulation.rounds.length, 1);
        assert.equal(lesson.simulation.rounds[0].display, LOCKED_TEXT, 'the only round is the unlock placeholder');
      }
      const free = preview.lessons.filter((lesson) => !lesson.locked);
      assert.ok(free.every((lesson) => lesson.simulation.rounds.every((round) => typeof round.correct === 'string')), 'free quizzes stay gradable');
    }
  });
  const client = fs.readFileSync(pathModule.join(__dirname, 'academy-activity-curriculum.js'), 'utf8');
  assert.ok(client.includes('target.dataset.answer===item.correct'), 'the Activity no longer grades in the browser: strip free-preview answers from the gated curriculum too');
});

/* ---------- the gate client in a sandbox (moved from the part review) ---------- */
function gateClientSource(gateOptions) {
  const html = academyActivityHtml({ symbol: 'SPY', bars: [] }, { gate: gateOptions });
  const start = html.indexOf('<script>window.SML_ACADEMY_GATE=');
  assert.ok(start >= 0);
  return html.slice(start + '<script>'.length, html.indexOf('</script>', start));
}
function fakeElement(tag, id = '') {
  const el = {
    tagName: tag.toUpperCase(), id, className: '', style: {}, dataset: {}, children: [], parent: null, attributes: {}, textContent: '', value: '', disabled: false,
    appendChild(child) { child.parent = el; el.children.push(child); return child; },
    remove() { if (el.parent) el.parent.children = el.parent.children.filter((node) => node !== el); el.parent = null; },
    setAttribute(name, value) { el.attributes[name] = String(value); },
    matches(selector) { return selector.split(',').map((part) => part.trim()).some((part) => (part.startsWith('.') ? el.className.split(' ').includes(part.slice(1)) : el.tagName === part.toUpperCase())); },
    all() { return el.children.flatMap((node) => [node, ...node.all()]); },
    querySelectorAll(selector) { return el.all().filter((node) => node.matches(selector)); },
    querySelector(selector) { return selector.startsWith(':scope > ') ? el.children.find((node) => node.matches(selector.slice(9))) || null : el.querySelectorAll(selector)[0] || null; }
  };
  return el;
}
function bootGateClient({ gate: gateOptions = { contentGate: true, links: false }, respond = null, storage = null } = {}) {
  let clock = 1_000_000;
  let reloads = 0;
  const timers = [];
  const calls = [];
  const opened = [];
  const listeners = { window: {}, document: {} };
  const body = fakeElement('body');
  const bar = fakeElement('div');
  const notice = fakeElement('div', 'academy-auth-notice');
  const status = fakeElement('span', 'status');
  const standard = (path, auth) => {
    if (path === '/academy-activity/curriculum') return { status: 200, body: { gated: !auth, lessons: [] } };
    if (path === '/academy-activity/token') return { status: 200, body: { ok: true, access_token: 'discord', sessionToken: 'v1.paid', tier: 'academy' } };
    return { status: 404, body: {} };
  };
  const sandbox = {
    Headers, URL, Response,
    Date: { now: () => clock },
    setTimeout: (fn, ms) => { timers.push({ at: clock + Number(ms || 0), fn }); return timers.length; },
    MutationObserver: class { observe() {} },
    location: { href: 'https://1551336038713139370.discordsays.com/.proxy/', reload: () => { reloads += 1; } },
    document: {
      hidden: false, body,
      addEventListener: (type, fn) => { (listeners.document[type] ||= []).push(fn); },
      querySelector: (selector) => (selector === 'main .bar' ? bar : null),
      getElementById: (id) => (id === 'academy-auth-notice' ? notice : id === 'status' ? status : null),
      createElement: (tag) => fakeElement(tag)
    },
    fetch: async (input, init) => {
      const path = new URL(String(input), 'https://x.test').pathname;
      const auth = new Headers((init && init.headers) || {}).get('authorization');
      calls.push({ url: String(input), path, auth, method: (init && init.method) || 'GET', body: init && init.body });
      const reply = (respond || standard)(path, auth, init);
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
    }
  };
  if (storage) sandbox.sessionStorage = storage;
  sandbox.window = sandbox;
  sandbox.addEventListener = (type, fn) => { (listeners.window[type] ||= []).push(fn); };
  sandbox.smlAcademyReauth = async () => 'v1.paid';
  sandbox.smlAcademyOpenExternal = async (url) => { opened.push(url); return true; };
  vm.createContext(sandbox);
  vm.runInContext(gateClientSource(gateOptions), sandbox);
  const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
  async function advance(ms) {
    const until = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      if (!timers.length || timers[0].at > until) break;
      const due = timers.shift();
      clock = due.at;
      due.fn();
      await flush();
    }
    clock = until;
    await flush();
  }
  const signIn = async () => {
    sandbox.smlAcademySessionToken = 'v1.paid';
    body.dataset.academyAuth = 'ready';
    await sandbox.fetch('/academy-activity/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"code":"c"}' });
    await flush();
  };
  return { sandbox, calls, listeners, body, bar, notice, opened, advance, flush, signIn, reloads: () => reloads, now: () => clock };
}
const curriculumCalls = (client) => client.calls.filter((call) => call.path === '/academy-activity/curriculum');

for (const [label, beforeSignIn] of [
  ['the first sign-in hit a transient Discord error and the member pressed Retry', async (client) => { client.body.dataset.academyAuth = 'temporary_unavailable'; await client.advance(200); }],
  ['the first-time Discord consent took longer than 8 s', async (client) => { await client.advance(8_200); }]
]) {
  test(`gate client: a paying member gets the full curriculum after sign-in when ${label}`, async () => {
    const client = bootGateClient();
    const curriculum = client.sandbox.fetch('/academy-activity/curriculum?v=1', { cache: 'force-cache' });
    await beforeSignIn(client);
    assert.equal((await (await curriculum).json()).gated, true, 'precondition: the curriculum loaded before a session existed (free preview)');
    await client.signIn();
    for (const fn of client.listeners.window.focus || []) fn();
    for (const fn of client.listeners.document.visibilitychange || []) fn();
    await client.advance(1_000);
    assert.equal(client.reloads(), 1, 'the page reloads once so the full lessons load');
    await client.signIn();
    await client.advance(1_000);
    assert.equal(client.reloads(), 1, 'never twice');
  });
}

test('gate client: a sign-in inside the wait loads the full curriculum with no reload; a free session never reloads', async () => {
  const paid = bootGateClient();
  const curriculum = paid.sandbox.fetch('/academy-activity/curriculum?v=1', { cache: 'force-cache' });
  await paid.advance(300);
  await paid.signIn();
  await paid.advance(400);
  assert.equal((await (await curriculum).json()).gated, false);
  assert.equal(curriculumCalls(paid)[0].auth, 'Bearer v1.paid');
  await paid.advance(2_000);
  assert.equal(paid.reloads(), 0);

  const free = bootGateClient({ respond: (path, auth) => (path === '/academy-activity/token'
    ? { status: 200, body: { ok: true, access_token: 'discord', sessionToken: 'v1.free', tier: 'free' } }
    : { status: 200, body: { gated: true, lessons: [] } }) });
  const preview = free.sandbox.fetch('/academy-activity/curriculum?v=1', {});
  await free.advance(8_200);
  await preview;
  await free.signIn();
  await free.advance(2_000);
  assert.equal(free.reloads(), 0, 'free stays on the preview without reloading');
});

test('gate client: the reload guard (sessionStorage) waits longer after a gate reload and never loops', async () => {
  const store = {};
  const storage = { getItem: (key) => (key in store ? store[key] : null), setItem: (key, value) => { store[key] = String(value); } };
  store['sml-academy-gate-reload'] = String(1_000_000 - 1_000); // this page is the result of a reload 1 s ago
  const client = bootGateClient({ storage });
  const curriculum = client.sandbox.fetch('/academy-activity/curriculum?v=1', {});
  await client.advance(8_200);
  assert.equal(curriculumCalls(client).length, 0, 'right after a gate reload the curriculum waits up to 20 s for sign-in');
  await client.advance(12_000);
  assert.equal((await (await curriculum).json()).gated, true);
  await client.signIn();
  await client.advance(1_000);
  assert.equal(client.reloads(), 0, 'no second reload within 30 s of the last one');

  const fresh = {};
  const first = bootGateClient({ storage: { getItem: (key) => (key in fresh ? fresh[key] : null), setItem: (key, value) => { fresh[key] = String(value); } } });
  const late = first.sandbox.fetch('/academy-activity/curriculum?v=1', {});
  await first.advance(8_200);
  await late;
  await first.signIn();
  await first.advance(1_000);
  assert.equal(first.reloads(), 1);
  assert.equal(fresh['sml-academy-gate-reload'], String(first.now() - 700), 'the reload time is remembered for the next page');
});

test('gate client: Get Academy access posts the buy ticket, then opens the one-time URL it gets back (never a token in a URL)', async () => {
  let code = 0;
  let fail = false;
  const client = bootGateClient({
    gate: { contentGate: false, links: true },
    respond: (path) => {
      if (path === '/academy-activity/token') return { status: 403, body: { ok: false, error: 'academy_role_required', buy: { ticket: 'b1.ticket.sig' } } };
      if (path === '/academy-activity/buy') { if (fail) return { status: 503, body: { ok: false, error: 'temporary_unavailable' } }; code += 1; return { status: 200, body: { ok: true, url: `https://academy.example/v1/academy/billing/start?h=code-${code}` } }; }
      return { status: 404, body: {} };
    }
  });
  client.body.dataset.academyAuth = 'academy_role_required';
  await client.sandbox.fetch('/academy-activity/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"code":"c"}' });
  await client.flush();
  const wrap = client.notice.querySelector('.academy-buy');
  assert.ok(wrap, 'the refusal notice offers Get Academy access');
  assert.equal(client.calls.some((call) => call.path === '/academy-activity/buy'), false, 'nothing is minted until the member asks');
  const button = wrap.querySelector('button');
  assert.equal(button.textContent, 'Get Academy access');
  button.onclick();
  await client.flush();
  const buys = client.calls.filter((call) => call.path === '/academy-activity/buy');
  assert.equal(buys.length, 1);
  assert.equal(buys[0].method, 'POST');
  assert.equal(buys[0].url, '/academy-activity/buy', 'the ticket travels in the body, not the URL');
  assert.deepEqual(JSON.parse(buys[0].body), { ticket: 'b1.ticket.sig' });
  assert.deepEqual(client.opened, ['https://academy.example/v1/academy/billing/start?h=code-1']);
  assert.equal(wrap.querySelectorAll('input').length, 1);
  assert.equal(wrap.querySelector('input').value, 'https://academy.example/v1/academy/billing/start?h=code-1');
  button.onclick();
  await client.flush();
  assert.deepEqual(wrap.querySelectorAll('input').map((field) => field.value), ['https://academy.example/v1/academy/billing/start?h=code-2'], 'each press mints a fresh one-time link');
  fail = true;
  button.onclick();
  await client.flush();
  assert.equal(wrap.querySelectorAll('input').length, 0);
  assert.match(wrap.querySelector('.academy-buy-error').textContent, /Could not start checkout/);
  assert.equal(button.disabled, false, 'the member can try again');
  assert.equal(client.opened.length, 2);
});
