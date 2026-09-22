'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer, calculateWindowChange, calculateThreeMinuteChange } = require('./server');
const { hmac } = require('./wordpress-gateway');

async function withServer(options, run) {
  const server = createServer({
    checkDatabase: async () => true,
    acceptWordPressEvent: async () => 'accepted',
    logger: () => {},
    now: () => 1_700_000_000_000,
    ...options
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('S.I.R.E calculates the signed three-minute price change without exposing a rank', () => {
  const now = 1_700_000_180_000;
  const gain = calculateThreeMinuteChange(102.34, [{ t: now - 180_000, price: 100 }], now);
  const loss = calculateThreeMinuteChange(98.88, [{ t: now - 180_000, price: 100 }], now);
  assert.ok(Math.abs(gain.percent - 2.34) < 1e-10);
  assert.equal(gain.windowSeconds, 180);
  assert.ok(Math.abs(loss.percent + 1.12) < 1e-10);
  assert.equal(loss.windowSeconds, 180);
  const interpolated = calculateThreeMinuteChange(103, [
    { t: now - 190_000, price: 100 },
    { t: now - 170_000, price: 102 }
  ], now);
  assert.ok(Math.abs(interpolated.percent - ((103 - 101) / 101 * 100)) < 1e-10);
  assert.equal(interpolated.windowSeconds, 180);
  assert.deepEqual(calculateThreeMinuteChange(100, [{ t: now - 179_999, price: 99 }], now), {
    percent: null,
    windowSeconds: null
  });
  const serverSource = require('node:fs').readFileSync(require.resolve('./server'), 'utf8');
  assert.match(serverSource, /history\.slice\(-1_000\)/);
  assert.equal(calculateWindowChange(105, [{ t: now - 300_000, price: 100 }], now, 300_000).percent, 5);
});

test('health returns 200 only when the database check passes', async () => {
  await withServer({ checkDatabase: async () => true }, async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      service: 'sml-platform-api',
      database: 'connected'
    });
  });
});

test('health fails closed when the database check fails', async () => {
  await withServer({ checkDatabase: async () => { throw new Error('offline'); } }, async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      service: 'sml-platform-api',
      database: 'unavailable'
    });
  });
});

test('all other routes are a no-store 404', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/not-a-route`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});

test('Academy Activity serves the read-only live chart host for Discord', async () => {
  await withServer({ academyAppId: '1551336038713139370' }, async (base) => {
    const response = await fetch(`${base}/academy-activity/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors https:\/\/discord\.com/);
    assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.match(response.headers.get('content-security-policy'), /media-src 'self' blob:/);
    assert.match(response.headers.get('content-security-policy'), /frame-src 'none'/);
    const html = await response.text();
    assert.match(html, /Making Easy Money Academy/);
    assert.match(html, /Live interactive candlestick chart/);
    assert.match(html, /toggle\.textContent='Lessons \('/);
    assert.match(html, /Choose an Academy lesson/);
    assert.match(html, /academy-activity\/curriculum/);
    assert.match(html, /speechSynthesis/);
    assert.match(html, /academy-activity\/speech/);
    assert.match(html, /new Audio\(voiceUrl\)/);
    assert.match(html, /academy-voice-control/);
    assert.match(html, /playNarration/);
    assert.match(html, /render\(true\)/);
    assert.match(html, /Mute Voice/);
    assert.match(html, /voiceAudio\.muted=voiceMuted/);
    assert.match(html, /academy-live-deck/);
    assert.match(html, /Lesson presentation/);
    assert.match(html, /syncVoiceDeck/);
    assert.match(html, /parts\[safe\]\.match\(\/\\S\+\\s\*\/g\)/);
    assert.doesNotMatch(html, /parts\[safe\]\.split\(\/\(\\s\+\)\//);
    assert.match(html, /requestAnimationFrame\(syncVoiceDeck\)/);
    assert.match(html, /Starting the next lesson/);
    assert.match(html, /All 101 Academy lessons complete/);
    assert.match(html, /academy-activity\/slide-design/);
    assert.doesNotMatch(html, /CLAUDE DESIGNED|Playing Grandmaster-Obi|next lesson is preloading/i);
    assert.match(html, /copy\.hidden=true/);
    assert.match(html, /loadClaudeDesign/);
    assert.match(html, /ANALYST DASHBOARD/);
    assert.match(html, /data-tf="1D"/);
    assert.match(html, /TOP OF BOOK/);
    assert.match(html, /LIVE MARKET SCANNER/);
    assert.match(html, /academy-scan-table/);
    assert.match(html, /Search any U\.S\. symbol or company/);
    assert.match(html, /US STOCKS/);
    assert.match(html, /PREMARKET/);
    assert.match(html, /AFTER HOURS/);
    assert.match(html, /Pro Screener/);
    assert.match(html, /S\.I\.R\.E 3m %/);
    assert.match(html, /changeRate3min/);
    assert.doesNotMatch(html, /\['rank','#'\]/);
    assert.match(html, /Volume Ratio/);
    assert.match(html, /Dividend Yield/);
    assert.match(html, /Institutional Holdings/);
    assert.match(html, /Degree of Overlap/);
    assert.match(html, /Showing /);
    assert.match(html, /refreshScanner/);
    assert.match(html, /academy-activity\/scanner/);
    assert.match(html, /id="academy-scanner-host"/);
    assert.match(html, /College Options Chain Lab/);
    assert.match(html, /academy-lesson-open/);
    assert.match(html, /width:calc\(100% - var\(--academy-lesson-rail\)\)/);
    assert.match(html, /body\.academy-lesson-open \.academy-below/);
    assert.match(html, /id="options-expiry"/);
    assert.match(html, /Call IV/);
    assert.match(html, /intrinsic value is immediate exercise value/);
    assert.match(html, /sideFrom\(object\.call\|\|object\.calls\|\|object,object\.call\|\|object\.calls\?'':'call'\)/);
    assert.match(html, /Select any strike for derived economics and risk interpretation/);
    assert.match(html, /height:calc\(100dvh - 86px\)/);
    assert.match(html, /canvas\.addEventListener\('wheel',\(\)=>\{\},\{passive:true\}\)/);
    assert.match(html, /LEVEL 2 DEPTH/);
    assert.match(html, /academy-depth-row/);
    assert.match(html, /Unlock Academy Tools/);
    assert.match(html, /DiscordSDK/);
    assert.match(html, /academy-activity\/sdk\/index\.mjs/);
    assert.match(html, /guilds\.members\.read/);
    assert.match(html, /academy-activity\/token/);
    assert.match(html, /sml-academy-session/);
    assert.match(html, /LIVE INTERACTIVE ACADEMY/);
    assert.match(html, /academy-tools-open/);
    assert.match(html, /body\.academy-tools-open \.lesson\{z-index:2147483600\}/);
    assert.match(html, /id="academy-intro-video"/);
    assert.match(html, /making-easy-money-academy-intro\.mp4/);
    assert.match(html, /smlAcademyWarmPromise/);
    assert.match(html, /Preparing live chart, scanner, lessons, and Academy tools/);
    assert.match(html, /video\.addEventListener\('ended',finish/);
    assert.match(html, /const fitVideo=/);
    assert.match(html, /videoWidth\/video\.videoHeight/);
    assert.match(html, /new ResizeObserver\(fitVideo\)/);
    assert.match(html, /window\.visualViewport\?\.addEventListener\('resize',fitVideo/);
    assert.match(html, /academy-intro-rail-left/);
    assert.match(html, /academy-intro\.banner-mode/);
    assert.match(html, /availableWidth\/availableHeight>=2/);
    assert.match(html, /Tap to begin with sound/);
    assert.match(html, /keepWarm/);
    assert.doesNotMatch(html, /setInterval\(\(\)=>location\.reload\(\),30000\)/);
    assert.match(html, /let bars=\[/);
    assert.doesNotMatch(html, /location\.assign/);
    assert.match(html, /history\.replaceState/);
    assert.doesNotMatch(html, /academy-dashboard-frame/);
    assert.doesNotMatch(html, /<iframe/i);
    assert.doesNotMatch(html, /https:\/\/stockmarketloop\.com\/analyst-dashboard\/\?academy=1/);
    assert.doesNotMatch(html, /new ResizeObserver\(resize\)\.observe\(canvas\)/);
    assert.match(html, /const chartObserver=new ResizeObserver\(resize\)/);
    assert.match(html, /ctx\.setTransform\(\{a:d,b:0,c:0,d:d,e:0,f:0\}\)/);
    assert.doesNotMatch(html, /ctx\.setTransform\(d,0,0,d,0\)/);
    assert.match(html, /requestAnimationFrame\(resize\)/);
    assert.match(html, /setTimeout\(resize,1000\)/);
    assert.match(html, /simulation-progress/);
    assert.match(html, /academy-activity\/progress/);
    assert.match(html, /\['Options',\[9,23\]\]/);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.doesNotThrow(() => new Function(scripts.at(-1)[1]));
  });
});

test('Academy intro video supports cached byte-range streaming', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/academy-activity/assets/making-easy-money-academy-intro.mp4`, {
      headers: { range: 'bytes=0-1023' }
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.match(response.headers.get('cache-control'), /immutable/);
    assert.match(response.headers.get('content-range'), /^bytes 0-1023\/\d+$/);
    assert.equal((await response.arrayBuffer()).byteLength, 1024);
  });
});

test('Academy curriculum loads separately and is cacheable after first paint', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/academy-activity/curriculum`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /max-age=3600/);
    assert.equal(response.headers.get('content-encoding'), 'gzip');
    const payload = await response.json();
    assert.equal(payload.lessons.length, 101);
    const text = JSON.stringify(payload);
    assert.match(text, /Market Structure and Price Discovery/);
    assert.match(text, /Cash-secured put/);
    assert.match(text, /Grandmaster-Obi Alert Analysis and Falsification/);
    assert.match(text, /Capstone: Investment Committee Defense/);
  });
});

test('Discord Activity proxy root serves the same native Academy entry point', async () => {
  await withServer({ academyAppId: '1551336038713139370' }, async (base) => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors https:\/\/discord\.com/);
    assert.match(response.headers.get('content-security-policy'), /frame-src 'none'/);
    const html = await response.text();
    assert.match(html, /Making Easy Money Academy/);
    assert.match(html, /Live interactive candlestick chart/);
    assert.doesNotMatch(html, /<iframe/i);
  });
});

test('Academy Activity serves the official embedded SDK and exchanges Activity authorization codes', async () => {
  const calls = [];
  const academyOAuth = {
    completeActivity: async ({ code }) => {
      calls.push(code);
      return code === 'discord-code'
        ? { ok: true, accessToken: 'discord-access', sessionToken: 'academy-session' }
        : { ok: false, status: 401, code: 'authorization_failed' };
    }
  };
  await withServer({ academyOAuth }, async (base) => {
    const sdk = await fetch(`${base}/academy-activity/sdk/index.mjs`);
    assert.equal(sdk.status, 200);
    assert.match(sdk.headers.get('content-type'), /^text\/javascript/);
    assert.match(await sdk.text(), /DiscordSDK/);
    const token = await fetch(`${base}/academy-activity/token`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'discord-code' })
    });
    assert.equal(token.status, 200);
    assert.deepEqual(await token.json(), { ok: true, access_token: 'discord-access', sessionToken: 'academy-session' });
  });
  assert.deepEqual(calls, ['discord-code']);
});

test('Academy Activity stores simulation progress only for an authenticated Discord user', async () => {
  const calls = [];
  const academyProgress = {
    configured: true,
    read: async (userId) => { calls.push(['read', userId]); return [{ moduleId: 10, lessonId: 1, score: 80, completed: true }]; },
    save: async (userId, input) => { calls.push(['save', userId, input]); return { ...input, completed: input.score >= 70 }; }
  };
  const academyOAuth = { verifySession: (authorization) => authorization === 'Bearer academy-session' ? { ok: true, userId: '123456789012345678' } : { ok: false, status: 401, code: 'authorization_required' } };
  await withServer({ academyOAuth, academyProgress }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/progress`)).status, 401);
    const read = await fetch(`${base}/academy-activity/progress`, { headers: { authorization: 'Bearer academy-session' } });
    assert.equal(read.status, 200);
    const save = await fetch(`${base}/academy-activity/progress`, { method: 'POST', headers: { authorization: 'Bearer academy-session', 'content-type': 'application/json' }, body: JSON.stringify({ moduleId: 10, lessonId: 1, score: 80 }) });
    assert.equal(save.status, 200);
    assert.deepEqual(calls.map((entry) => entry.slice(0, 2)), [['read', '123456789012345678'], ['save', '123456789012345678']]);
  });
});

test('Academy lesson narration works in Discord without a session and honors authenticated sessions', async () => {
  const calls = [];
  const academyOAuth = {
    verifySession: (authorization) => authorization === 'Bearer academy-session'
      ? { ok: true, userId: 'member-123' }
      : { ok: false, status: 401, code: 'authorization_required' }
  };
  const academyVoice = {
    configured: true,
    getLessonAudio: async (input) => {
      calls.push(input);
      return { audio: Buffer.from('lesson-mp3'), cached: false };
    }
  };
  await withServer({ academyOAuth, academyVoice }, async (base) => {
    const anonymous = await fetch(`${base}/academy-activity/speech?moduleId=1&lessonId=1`, {
      headers: { 'x-forwarded-for': '203.0.113.9', 'user-agent': 'Discord-Activity-Test' }
    });
    assert.equal(anonymous.status, 200);
    assert.match(calls[0].userId, /^anonymous:[a-f0-9]{24}$/);
    const allowed = await fetch(`${base}/academy-activity/speech?moduleId=1&lessonId=1`, {
      headers: { authorization: 'Bearer academy-session' }
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('content-type'), 'audio/mpeg');
    assert.match(allowed.headers.get('cache-control'), /private/);
    assert.equal(Buffer.from(await allowed.arrayBuffer()).toString(), 'lesson-mp3');
  });
  assert.deepEqual(calls[1], { moduleId: '1', lessonId: '1', userId: 'member-123' });
});

test('Academy Claude slide design stays server-side, rate-scoped, and session-aware', async () => {
  const calls = [];
  const academyOAuth = {
    verifySession: (authorization) => authorization === 'Bearer academy-session'
      ? { ok: true, userId: 'member-123' }
      : { ok: false, status: 401, code: 'authorization_required' }
  };
  const academySlideDesigner = {
    configured: true,
    getLessonDesign: async (input) => {
      calls.push(input);
      return {
        cached: false,
        design: {
          provider: 'claude',
          model: 'claude-sonnet-5',
          slides: [{ heading: 'Auction', visual: 'Buyers and sellers meet.', callout: 'Price is discovered.', visualKind: 'auction' }]
        }
      };
    }
  };
  await withServer({ academyOAuth, academySlideDesigner }, async (base) => {
    const anonymous = await fetch(base + '/academy-activity/slide-design?moduleId=1&lessonId=1');
    assert.equal(anonymous.status, 401);
    assert.equal(calls.length, 0);
    const allowed = await fetch(base + '/academy-activity/slide-design?moduleId=1&lessonId=1', {
      headers: { authorization: 'Bearer academy-session' }
    });
    assert.equal(allowed.status, 200);
    const payload = await allowed.json();
    assert.equal(payload.provider, 'claude');
    assert.equal(payload.model, 'claude-sonnet-5');
    assert.equal(payload.slides[0].visualKind, 'auction');
    assert.equal(JSON.stringify(payload).includes('key'), false);
  });
  assert.deepEqual(calls[0], { moduleId: '1', lessonId: '1', userId: 'member-123' });
});

test('Academy private data is role-session gated before the WordPress bridge is called', async () => {
  let calls = 0;
  await withServer({
    academyOAuth: { verifySession: (authorization) => authorization === 'Bearer academy-session' ? { ok: true, userId: '1' } : { ok: false, status: 401, code: 'authorization_required' } },
    academyDataBridge: { get: async (kind, symbol) => { calls += 1; return { ok: true, status: 200, data: { kind, symbol } }; } }
  }, async (base) => {
    const denied = await fetch(`${base}/academy-activity/data/options?symbol=SPY`);
    assert.equal(denied.status, 401);
    assert.equal(calls, 0);
    const allowed = await fetch(`${base}/academy-activity/data/earnings?symbol=NVDA`, { headers: { authorization: 'Bearer academy-session' } });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { ok: true, data: { kind: 'earnings', symbol: 'NVDA' } });
    assert.equal(calls, 1);
  });
});

function signedHeaders(secret, body, timestamp = '1700000000') {
  return {
    'content-type': 'application/json',
    'x-sml-timestamp': timestamp,
    'x-sml-signature': `sha256=${hmac(secret, timestamp, body)}`
  };
}

function eventBody(overrides = {}) {
  return JSON.stringify({
    version: 1,
    eventId: '7dc5f64b-7c05-4f38-9c55-31fcfa798706',
    eventType: 'system.integration.ping',
    occurredAt: '2023-11-14T22:13:20.000Z',
    actorUserId: 42,
    subject: { type: 'integration', id: 'wordpress' },
    data: { source: 'test' },
    ...overrides
  });
}

test('WordPress gateway fails closed until its secret exists', async () => {
  const body = eventBody();
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/v1/wordpress/events`, {
      method: 'POST', body, headers: signedHeaders('not-configured', body)
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: 'integration_unconfigured' });
  });
});

test('WordPress gateway accepts one valid signed event and exposes no payload', async () => {
  const received = [];
  const body = eventBody();
  await withServer({
    wordpressWebhookSecret: 'gateway-test-secret',
    acceptWordPressEvent: async (event) => { received.push(event); return 'accepted'; }
  }, async (base) => {
    const response = await fetch(`${base}/v1/wordpress/events`, {
      method: 'POST', body, headers: signedHeaders('gateway-test-secret', body)
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      ok: true,
      eventId: '7dc5f64b-7c05-4f38-9c55-31fcfa798706',
      status: 'accepted'
    });
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].eventType, 'system.integration.ping');
  assert.match(received[0].payloadHash, /^[0-9a-f]{64}$/);
});

test('WordPress gateway recognizes a replay without processing it twice', async () => {
  const body = eventBody();
  await withServer({
    wordpressWebhookSecret: 'gateway-test-secret',
    acceptWordPressEvent: async () => 'duplicate'
  }, async (base) => {
    const response = await fetch(`${base}/v1/wordpress/events`, {
      method: 'POST', body, headers: signedHeaders('gateway-test-secret', body)
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      eventId: '7dc5f64b-7c05-4f38-9c55-31fcfa798706',
      status: 'duplicate'
    });
  });
});

test('WordPress gateway rejects bad signatures and old requests before storage', async () => {
  const body = eventBody();
  let calls = 0;
  await withServer({
    wordpressWebhookSecret: 'gateway-test-secret',
    acceptWordPressEvent: async () => { calls += 1; return 'accepted'; }
  }, async (base) => {
    const bad = await fetch(`${base}/v1/wordpress/events`, {
      method: 'POST', body, headers: { ...signedHeaders('wrong-secret', body) }
    });
    assert.equal(bad.status, 401);
    assert.deepEqual(await bad.json(), { ok: false, error: 'invalid_signature' });

    const old = await fetch(`${base}/v1/wordpress/events`, {
      method: 'POST', body, headers: signedHeaders('gateway-test-secret', body, '1600000000')
    });
    assert.equal(old.status, 401);
    assert.deepEqual(await old.json(), { ok: false, error: 'stale_request' });
  });
  assert.equal(calls, 0);
});

test('news webhook queues one authenticated source URL and collapses duplicates', async () => {
  const received = [];
  await withServer({
    newsIngestToken: 'news-test-token',
    enqueueNewsArticle: async (job) => {
      received.push(job);
      return received.length === 1
        ? { id: 71, status: 'accepted' }
        : { id: 71, status: 'duplicate' };
    }
  }, async (base) => {
    const body = JSON.stringify({ source_url: 'https://example.com/story?utm_source=test' });
    const first = await fetch(`${base}/v1/news/articles`, {
      method: 'POST',
      headers: { authorization: 'Bearer news-test-token', 'content-type': 'application/json' },
      body
    });
    assert.equal(first.status, 202);
    assert.deepEqual(await first.json(), { ok: true, jobId: 71, status: 'accepted', jobStatus: 'queued' });
    const second = await fetch(`${base}/v1/news/articles`, {
      method: 'POST',
      headers: { authorization: 'Bearer news-test-token', 'content-type': 'application/json' },
      body
    });
    assert.equal(second.status, 200);
    assert.equal((await second.json()).status, 'duplicate');
  });
  assert.equal(received[0].sourceUrl, 'https://example.com/story');
  assert.match(received[0].sourceUrlHash, /^[a-f0-9]{64}$/);
});

test('news webhook fails closed before storing unauthenticated or invalid requests', async () => {
  let calls = 0;
  await withServer({
    newsIngestToken: 'news-test-token',
    enqueueNewsArticle: async () => { calls += 1; return { id: 1, status: 'accepted' }; }
  }, async (base) => {
    const denied = await fetch(`${base}/v1/news/articles`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"source_url":"https://example.com"}'
    });
    assert.equal(denied.status, 401);
    const invalid = await fetch(`${base}/v1/news/articles`, {
      method: 'POST', headers: { authorization: 'Bearer news-test-token', 'content-type': 'application/json' }, body: '{"source_url":"http://localhost"}'
    });
    assert.equal(invalid.status, 422);
  });
  assert.equal(calls, 0);
});

test('alert routes are signed and owner-scoped before reaching the router', async () => {
  const calls = [];
  const body = JSON.stringify({ groupId: 7, ownerUserId: 42 });
  await withServer({
    alertRouterSecret: 'alert-test-secret',
    alertRouter: { listRoutes: async (...args) => { calls.push(args); return [{ id: 1 }]; } }
  }, async (base) => {
    const response = await fetch(`${base}/v1/alerts/routes/list`, {
      method: 'POST', body, headers: signedHeaders('alert-test-secret', body)
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true, routes: [{ id: 1 }] });
  });
  assert.deepEqual(calls, [[7, 42]]);
});

test('alert ingestion rejects bad signatures before the router is called', async () => {
  let calls = 0;
  const body = JSON.stringify({ groupId: 7 });
  await withServer({
    alertRouterSecret: 'alert-test-secret',
    alertRouter: { ingest: async () => { calls += 1; return { status: 'accepted' }; } }
  }, async (base) => {
    const response = await fetch(`${base}/v1/alerts/ingest`, {
      method: 'POST', body, headers: signedHeaders('wrong-secret', body)
    });
    assert.equal(response.status, 401);
  });
  assert.equal(calls, 0);
});
