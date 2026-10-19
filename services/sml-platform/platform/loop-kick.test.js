'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createServer, academyActivityHtml, loopKickActivityHtml } = require('./server');
const { LOOP_KICK_ENTRY_COMMAND } = require('../scripts/register-loop-kick-command');

async function withServer(options, run) {
  const server = createServer({
    checkDatabase: async () => true,
    acceptWordPressEvent: async () => 'accepted',
    logger: () => {},
    now: () => 1_700_000_000_000,
    ...options,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const goodOAuth = { verifySession: (auth) => (auth === 'Bearer good' ? { ok: true, userId: '123456789012345678' } : { ok: false, status: 401, code: 'authorization_required' }) };

test('loop-kick session route requires the activity session', async () => {
  await withServer({ academyOAuth: goodOAuth, loopKickBridge: { configured: true, session: async () => ({ ok: true, status: 200, token: 't' }) } }, async (base) => {
    const r = await fetch(`${base}/academy-activity/loop-kick/session`);
    assert.equal(r.status, 401);
    assert.equal((await r.json()).error, 'authorization_required');
  });
});

test('loop-kick session route fails closed while unconfigured', async () => {
  await withServer({ academyOAuth: goodOAuth, loopKickBridge: { configured: false } }, async (base) => {
    const r = await fetch(`${base}/academy-activity/loop-kick/session`, { headers: { authorization: 'Bearer good' } });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error, 'loop_kick_unconfigured');
  });
});

test('loop-kick session route passes the site card shapes through', async () => {
  const bridge = { configured: true, session: async (id) => ({ ok: false, status: 403, error: 'not_linked', connect_url: 'https://s/c/', echoed: id }) };
  await withServer({ academyOAuth: goodOAuth, loopKickBridge: bridge }, async (base) => {
    const r = await fetch(`${base}/academy-activity/loop-kick/session`, { headers: { authorization: 'Bearer good' } });
    assert.equal(r.status, 403);
    const body = await r.json();
    assert.equal(body.error, 'not_linked');
    assert.equal(body.connect_url, 'https://s/c/');
    assert.equal(body.echoed, '123456789012345678');
  });
});

test('loop-kick session route returns the mint on success', async () => {
  const bridge = { configured: true, session: async () => ({ ok: true, status: 200, token: 'tok', expires_at: 9, app_url: 'https://phone' }) };
  await withServer({ academyOAuth: goodOAuth, loopKickBridge: bridge }, async (base) => {
    const r = await fetch(`${base}/academy-activity/loop-kick/session`, { headers: { authorization: 'Bearer good' } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.token, 'tok');
    assert.equal(body.app_url, 'https://phone');
  });
});

test('the one-tap connect routes sit behind the activity session and hand the member sign-in to the connect service', async () => {
  const calls = [];
  const loopKickConnect = {
    configured: true,
    connect: async (args) => { calls.push(['connect', args]); return args.password === 'right' ? { ok: true, status: 200, user: { id: 42, handle: 'obi' }, verified: true } : { ok: false, status: 403, error: 'two_step_required', method: 'email', hint: 'o•••@x' }; },
    connectUrl: (args) => { calls.push(['link', args]); return { ok: true, status: 200, url: 'https://stockmarketloop.com/connect-discord/?lk=v1.p.s', expires_at: 9 }; }
  };
  const oauth = { verifySession: (auth) => auth === 'Bearer good' ? { ok: true, userId: '123456789012345678', displayName: 'Obi' } : auth === 'Bearer free' ? { ok: true, userId: '123456789012345679', tier: 'free' } : { ok: false, status: 401, code: 'authorization_required' } };
  await withServer({ academyOAuth: oauth, connectOAuth: oauth, loopKickConnect }, async (base) => {
    const post = (path, auth, body, type = 'application/json') => fetch(`${base}${path}`, { method: 'POST', headers: { ...(auth ? { authorization: auth } : {}), 'content-type': type }, body });
    assert.equal((await post('/academy-activity/loop-kick/connect', '', '{}')).status, 401);
    assert.equal((await fetch(`${base}/academy-activity/loop-kick/connect-link`)).status, 401);
    assert.equal((await post('/academy-activity/loop-kick/connect', 'Bearer free', '{}')).status, 403);
    assert.equal((await post('/academy-activity/loop-kick/connect', 'Bearer good', 'login=x', 'text/plain')).status, 415);
    assert.equal((await post('/academy-activity/loop-kick/connect', 'Bearer good', '{bad')).status, 400);
    const stepped = await post('/academy-activity/loop-kick/connect', 'Bearer good', JSON.stringify({ login: 'obi', password: 'wrong' }));
    assert.equal(stepped.status, 403);
    assert.deepEqual(await stepped.json(), { ok: false, error: 'two_step_required', method: 'email', hint: 'o•••@x' });
    const done = await post('/academy-activity/loop-kick/connect', 'Bearer good', JSON.stringify({ login: 'obi', password: 'right', code: '123456' }));
    assert.equal(done.status, 200);
    assert.deepEqual(await done.json(), { ok: true, user: { id: 42, handle: 'obi' }, verified: true });
    assert.deepEqual(calls.at(-1), ['connect', { discordUserId: '123456789012345678', discordTag: 'Obi', login: 'obi', password: 'right', code: '123456', ip: '127.0.0.1' }]);
    const link = await fetch(`${base}/academy-activity/loop-kick/connect-link`, { headers: { authorization: 'Bearer good' } });
    assert.equal(link.status, 200);
    assert.deepEqual(await link.json(), { ok: true, url: 'https://stockmarketloop.com/connect-discord/?lk=v1.p.s', expires_at: 9 });
    assert.deepEqual(calls.at(-1), ['link', { discordUserId: '123456789012345678', discordTag: 'Obi' }]);
    // the Connect app's standalone Activity gets the same two routes, relative to /loop-kick-activity/
    assert.equal((await post('/loop-kick-activity/connect', '', '{}')).status, 401);
    const standalone = await post('/loop-kick-activity/connect', 'Bearer good', JSON.stringify({ login: 'obi', password: 'right' }));
    assert.equal(standalone.status, 200);
    assert.equal((await fetch(`${base}/loop-kick-activity/connect-link`, { headers: { authorization: 'Bearer good' } })).status, 200);
  });
  await withServer({ academyOAuth: oauth }, async (base) => {
    const r = await fetch(`${base}/academy-activity/loop-kick/connect`, { method: 'POST', headers: { authorization: 'Bearer good', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error, 'connect_unconfigured');
  });
});

test('the panel signs the member in from the "Connect your account" card instead of sending them to copy a code', () => {
  const source = fs.readFileSync(path.join(__dirname, 'academy-loop-kick.js'), 'utf8');
  assert.match(source, /showConnect\(j\)/);
  assert.match(source, /autocomplete="current-password"/);
  assert.match(source, /two_step_required/);
  assert.match(source, /discord_already_linked/);
  assert.match(source, /connect-link/);
  assert.doesNotMatch(source, /link-sml/);
  const html = loopKickActivityHtml({ appId: '1400000000000000000' });
  assert.match(html, /connectRoute:'connect',connectLinkRoute:'connect-link'/);
});

test('the academy page ships the LOOP-KICK module and button wiring', () => {
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m', bars: [], scanner: { rows: [] }, depth: { bids: [], asks: [] } }, { appId: '1551336038713139370' });
  assert.match(html, /academy-lk-btn/);
  assert.match(html, /sml-loop-kick:auth/);
  assert.match(html, /\.proxy\/loop-kick\//);
});

test('the standalone activity page authenticates with the Connect app and ships the module full screen', () => {
  const html = loopKickActivityHtml({ appId: '1400000000000000000' });
  assert.match(html, /1400000000000000000/);
  // relative on purpose: the Connect app's root mapping targets .../loop-kick-activity
  assert.match(html, /fetch\('token'/);
  assert.match(html, /sessionRoute:'session-bridge'/);
  assert.match(html, /from '\.\/sdk\/(v\d+\/)?index\.mjs'/);
  assert.doesNotMatch(html, /'\/loop-kick-activity\//);
  assert.match(html, /standalone:true/);
  assert.match(html, /academy-lk-panel/);
  assert.doesNotMatch(html, /id="lesson"/);
});

test('standalone token route uses the connect oauth and stays fail-closed', async () => {
  await withServer({}, async (base) => {
    const r = await fetch(`${base}/loop-kick-activity/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"code":"x"}' });
    assert.equal(r.status, 503);
  });
  const connectOAuth = { activityConfigured: true, completeActivity: async () => ({ ok: true, accessToken: 'at', sessionToken: 'st' }), verifySession: () => ({ ok: false, status: 401, code: 'authorization_required' }) };
  await withServer({ connectOAuth }, async (base) => {
    const r = await fetch(`${base}/loop-kick-activity/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"code":"x"}' });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.sessionToken, 'st');
  });
});

test('the entry point command launches the activity itself and can never post', () => {
  assert.equal(LOOP_KICK_ENTRY_COMMAND.type, 4);
  assert.equal(LOOP_KICK_ENTRY_COMMAND.handler, 2);
  assert.equal(LOOP_KICK_ENTRY_COMMAND.name, 'loop-kick');
  assert.deepEqual(LOOP_KICK_ENTRY_COMMAND.contexts, [0]);
});

test('no new file writes to Discord DMs or channels', () => {
  const files = ['academy-loop-kick.js', 'loop-kick-bridge.js'].map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8'));
  files.push(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'register-loop-kick-command.js'), 'utf8'));
  for (const source of files) {
    assert.doesNotMatch(source, /channels\/[^'"\s]*\/messages/);
    assert.doesNotMatch(source, /users\/@me\/channels/);
  }
});

test('the device floats like the site launcher: transparent window, clipped to the phone, draggable grip, pulsing button', () => {
  const source = fs.readFileSync(path.join(__dirname, 'academy-loop-kick.js'), 'utf8');
  assert.match(source, /#academy-lk-panel\{display:none;position:fixed;[^}]*background:none;[^}]*pointer-events:none\}/, 'no box around the phone, clicks fall through around it');
  assert.match(source, /allowtransparency/);
  assert.match(source, /clipPath = 'inset\(/, 'the frame is clipped to the surfaces the phone reports');
  assert.match(source, /sml-loop-kick:surface[\s\S]*fitSurfaces\(d\.surfaces\)/);
  assert.match(source, /id="academy-lk-grip"/);
  assert.match(source, /addEventListener\('pointerdown'/);
  assert.match(source, /setPointerCapture/);
  assert.match(source, /localStorage\.setItem\(POS_KEY/, 'the spot is remembered');
  assert.match(source, /right = '26px'; st\.bottom = '26px'/, 'bottom-right by default, like stockmarketloop.com');
  assert.match(source, /@keyframes academyLkPulse/);
  assert.match(source, /#academy-lk-btn\{[^}]*animation:academyLkPulse 2\.6s ease-in-out infinite\}/);
  assert.match(source, /d\.surface === 'closed' && S\.sawOpen[^\n]*closePanel\(\)/, 'the phone\'s own X hides the device');
  assert.doesNotMatch(source, /academy-lk-head/);
  assert.doesNotMatch(source, /querySelector\('\.side'\)/, 'no longer pinned over the quote column');
  // the Watch deck opens YouTube outside Discord (its player cannot load inside the Activity)
  const external = /var EXTERNAL_OK = (\/.*\/);/.exec(source);
  const re = new Function('return ' + external[1])();
  assert.ok(re.test('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
  assert.ok(re.test('https://youtu.be/dQw4w9WgXcQ'));
  assert.ok(re.test('https://stockmarketloop.com/watch/'));
  assert.ok(!re.test('https://www.youtube.com/'));
  assert.ok(!re.test('https://evil.example/'));
});

test('the injected module parses as a classic script', () => {
  const source = fs.readFileSync(path.join(__dirname, 'academy-loop-kick.js'), 'utf8');
  assert.doesNotThrow(() => new Function(source));
});
