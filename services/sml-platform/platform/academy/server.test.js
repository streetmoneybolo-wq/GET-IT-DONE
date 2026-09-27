'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcademyServer } = require('./server');

async function withServer(options, run) {
  const server = createAcademyServer({
    interactions: null,
    checkDatabase: async () => true,
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

test('Academy health is isolated from the main platform endpoint', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      service: 'making-easy-money-academy',
      database: 'connected'
    });
  });
});

test('Academy interactions fail closed until its separate app is configured', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/v1/academy/interactions`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: 'integration_unconfigured' });
  });
});

test('Academy endpoint delegates only to the Academy interaction handler', async () => {
  let received = '';
  await withServer({
    interactions: {
      async handleRequest(_request, response, rawBody) {
        received = rawBody.toString('utf8');
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"type":1}');
      }
    }
  }, async (base) => {
    const response = await fetch(`${base}/v1/academy/interactions`, { method: 'POST', body: '{"type":1}' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { type: 1 });
  });
  assert.equal(received, '{"type":1}');
});


/* ---- Integration: billing engine + hub gate wiring on the academy service ---- */
const crypto = require('node:crypto');
const { createAcademyBilling } = require('./billing');
const { createAcademyInteractions } = require('./runtime');
const { getConfig } = require('../config');

const GUILD = '938894329076940820';
const APP_ID = '1551336038713139370';
const MONARCH = '1260433215189946420';
const STUDENT_ROLE = '1553000000000000001';
const USER = '111222333444555666';
const PAID_LOCK = /part of the paid Making Easy Money Academy/;
const REFUSED = 'The Academy is not available in this server yet.';

test('billing engine is inert with the default env: no pool, no jobs, every /v1/academy/billing/* path 404s', async () => {
  const intervals = [];
  const timers = { setInterval: (...args) => { intervals.push(args); return 0; }, clearInterval() {} };
  const academyBilling = createAcademyBilling({
    env: { SML_ACADEMY_GUILD_ID: GUILD, SML_ACADEMY_BOT_TOKEN: 'bot-token', SML_ACADEMY_APP_ID: APP_ID, SML_ACADEMY_CLIENT_SECRET: 'client-secret' },
    databaseUrl: 'postgres://user:pass@127.0.0.1:9/never', timers, logger: () => {}
  });
  assert.equal(academyBilling.enabled, false);
  assert.equal(academyBilling.reason, 'disabled');
  assert.equal('store' in academyBilling, false, 'the inert engine builds no pool or store');
  await academyBilling.start();
  assert.equal(intervals.length, 0, 'no jobs are scheduled');
  assert.equal(academyBilling.handoff.configured, false);
  assert.equal((await academyBilling.handoff.mint({ discordUserId: USER, source: 'hub' })).ok, false);
  await withServer({ academyBilling }, async (base) => {
    for (const [method, path] of [['GET', '/v1/academy/billing/buy'], ['GET', '/v1/academy/billing/start?h=x'],
      ['POST', '/v1/academy/billing/webhook'], ['POST', '/v1/academy/billing/checkout'], ['GET', '/v1/academy/billing/status'],
      ['GET', '/v1/academy/billing/success?session_id=cs_test_1'], ['GET', '/v1/academy/billing/manage']]) {
      const response = await fetch(`${base}${path}`, { method, body: method === 'POST' ? '{}' : undefined });
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.deepEqual(await response.json(), { ok: false, error: 'not_found' });
    }
  });
  await academyBilling.stop();
});

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUBLIC_KEY_HEX = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex');

function recordingPool() {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rows: [{ id: 7, current_module: 5, current_lesson: 1, xp: 0, streak_days: 0 }], rowCount: 1 };
    }
  };
}

function academyRuntime(extraEnv = {}, { billing = null } = {}) {
  const pool = recordingPool();
  const config = getConfig({ DATABASE_URL: 'postgres://runtime-test', SML_ACADEMY_ENABLED: '1', SML_ACADEMY_GUILD_ID: GUILD,
    SML_ACADEMY_PUBLIC_KEY: PUBLIC_KEY_HEX, SML_ACADEMY_APP_ID: APP_ID, ...extraEnv });
  const interactions = createAcademyInteractions({ config, pool, billing, now: () => 1_700_000_000_000,
    fetchImpl: async () => { throw new Error('no network in tests'); } });
  async function send(payload) {
    const body = JSON.stringify({ id: 'interaction_1', token: 'token', application_id: APP_ID, guild_id: GUILD, ...payload });
    const timestamp = '1700000000';
    const signature = crypto.sign(null, Buffer.concat([Buffer.from(timestamp), Buffer.from(body)]), privateKey).toString('hex');
    const response = { statusCode: 0, body: '', writeHead(code) { this.statusCode = code; }, end(text) { this.body = text; } };
    await interactions.handleRequest({ headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp } }, response, Buffer.from(body));
    assert.equal(response.statusCode, 200);
    return JSON.parse(response.body);
  }
  const member = (roles) => ({ user: { id: USER }, roles, permissions: '0' });
  return {
    pool,
    slash: (name, roles) => send({ type: 2, data: { name, options: [] }, member: member(roles) }),
    click: (customId, roles) => send({ type: 3, data: { custom_id: customId, component_type: 2 }, member: member(roles) })
  };
}

test('academy runtime: with every gate flag unset the hub is unchanged (Monarch + Administrator; lessons open)', async () => {
  const seen = [];
  const billing = { handoff: { configured: false, async mint() { return { ok: false }; } }, onMemberSeen: (id) => seen.push(id) };
  const hub = academyRuntime({}, { billing });
  assert.match((await hub.slash('academy', [MONARCH])).data.content, /^Welcome to Making Easy Money Academy/);
  assert.equal((await hub.slash('academy', [STUDENT_ROLE])).data.content, REFUSED);
  const lesson = await hub.click('academy:start:5:1', []);
  assert.doesNotMatch(String(lesson.data && lesson.data.content), PAID_LOCK, 'no lesson is locked by default');
  assert.ok(hub.pool.queries.some((entry) => /academy_students/.test(entry.sql)), 'the roleless click reached the lesson as before');
  assert.deepEqual(seen, [USER], 'hub clicks reach the engine hook (a no-op unless the engine runs in enforce mode)');
});

test('academy runtime: SML_ACADEMY_HUB_ROLE_GATE, SML_ACADEMY_MONARCH_ACCESS=0 and SML_ACADEMY_ACCESS_ROLE_IDS reach the hub; an inert engine mints no buy link', async () => {
  const billing = createAcademyBilling({ env: {}, logger: () => {} });
  const hub = academyRuntime({ SML_ACADEMY_HUB_ROLE_GATE: '1', SML_ACADEMY_MONARCH_ACCESS: '0', SML_ACADEMY_ACCESS_ROLE_IDS: STUDENT_ROLE,
    SML_ACADEMY_BILLING_IN_DISCORD_LINKS: '1', SML_ACADEMY_BILLING_PUBLIC_URL: 'https://making-easy-money-academy.onrender.com' }, { billing });
  const locked = await hub.click('academy:start:5:1', []);
  assert.match(locked.data.content, PAID_LOCK);
  assert.deepEqual(locked.data.components, [], 'the inert engine offers no link');
  assert.equal(hub.pool.queries.length, 0, 'no student row and no handoff row are written for a locked lesson');
  const free = await hub.click('academy:start:0:1', []);
  assert.doesNotMatch(String(free.data && free.data.content), PAID_LOCK, 'free preview lessons stay open');
  assert.equal((await hub.slash('academy', [MONARCH])).data.content, REFUSED);
  assert.match((await hub.slash('academy', [STUDENT_ROLE])).data.content, /^Welcome to Making Easy Money Academy/);
  const unlocked = await hub.click('academy:start:5:1', [STUDENT_ROLE]);
  assert.doesNotMatch(String(unlocked.data && unlocked.data.content), PAID_LOCK);
});
