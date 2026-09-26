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
  assert.match(html, /from '\.\/sdk\/index\.mjs'/);
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

test('the injected module parses as a classic script', () => {
  const source = fs.readFileSync(path.join(__dirname, 'academy-loop-kick.js'), 'utf8');
  assert.doesNotThrow(() => new Function(source));
});
