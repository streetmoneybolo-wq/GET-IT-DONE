'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  API_SERVICE, WORKER_SERVICE, SHARED_KEY, FLAG_KEY, buildPlan, run
} = require('./render-configure-dispute-evidence');

const SECRET_A = 'a'.repeat(64);

function fixedRandom(seed = 7) {
  let n = seed;
  return (bytes) => Buffer.alloc(bytes, n++);
}

/* Fake Render API: two services, per-service env var maps, records writes. */
function fakeRender({ apiVars = {}, workerVars = {} } = {}) {
  const state = { api: new Map(Object.entries(apiVars)), worker: new Map(Object.entries(workerVars)) };
  const calls = [];
  const ids = { 'srv-api': 'api', 'srv-worker': 'worker' };
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url);
    const method = options.method || 'GET';
    calls.push({ method, path: u.pathname + u.search, auth: options.headers && options.headers.authorization });
    const json = (status, body) => ({ ok: status < 300, status, async json() { return body; } });
    if (method === 'GET' && u.pathname === '/v1/services') {
      const names = u.searchParams.getAll('name');
      const rows = [];
      if (names.includes(API_SERVICE)) rows.push({ service: { id: 'srv-api', name: API_SERVICE } });
      if (names.includes(WORKER_SERVICE)) rows.push({ service: { id: 'srv-worker', name: WORKER_SERVICE } });
      rows.push({ service: { id: 'srv-other', name: 'loop-kick' } });
      return json(200, rows);
    }
    const envList = /^\/v1\/services\/(srv-[a-z]+)\/env-vars$/.exec(u.pathname);
    if (method === 'GET' && envList) {
      const map = state[ids[envList[1]]];
      return json(200, [...map.entries()].map(([key, value]) => ({ envVar: { key, value }, cursor: key })));
    }
    const envSet = /^\/v1\/services\/(srv-[a-z]+)\/env-vars\/([A-Z_]+)$/.exec(u.pathname);
    if (method === 'PUT' && envSet) {
      const body = JSON.parse(options.body);
      state[ids[envSet[1]]].set(envSet[2], body.value);
      return json(200, { key: envSet[2], value: body.value });
    }
    const deploy = /^\/v1\/services\/(srv-[a-z]+)\/deploys$/.exec(u.pathname);
    if (method === 'POST' && deploy) {
      return json(201, { id: `dep-${deploy[1]}`, status: 'created', deployMode: JSON.parse(options.body).deployMode });
    }
    return json(404, {});
  };
  return { state, calls, fetchImpl };
}

test('plan: fresh services get the flag on both, one shared generated key, and API-only generated secrets', () => {
  const plan = buildPlan({ env: {}, existing: { api: new Map(), worker: new Map() }, random: fixedRandom() });
  const keys = plan.writes.map((w) => `${w.service}:${w.key}:${w.reason}`);
  assert.deepEqual(keys, [
    `api:${FLAG_KEY}:flag`, `worker:${FLAG_KEY}:flag`,
    `api:${SHARED_KEY}:generate`, `worker:${SHARED_KEY}:generate`,
    'api:SML_CONNECT_REVIEW_URL_SECRET:generate', 'api:SML_UC_WEBHOOK_PATH_TOKEN:generate'
  ]);
  const shared = plan.writes.filter((w) => w.key === SHARED_KEY);
  assert.equal(shared[0].value, shared[1].value, 'both services receive the identical encryption key');
  assert.match(shared[0].value, /^[0-9a-f]{64}$/);
  assert.match(plan.upgradeChatWebhookUrl, /^https:\/\/sml-platform-api\.onrender\.com\/v1\/upgrade-chat\/webhook\/[A-Za-z0-9_-]+$/);
});

test('plan: an existing shared key is never rotated; a one-sided key is copied; a mismatch is refused', () => {
  const kept = buildPlan({ env: {}, existing: { api: new Map([[SHARED_KEY, SECRET_A], [FLAG_KEY, '1']]), worker: new Map([[SHARED_KEY, SECRET_A], [FLAG_KEY, '1']]) }, random: fixedRandom() });
  assert.equal(kept.writes.some((w) => w.key === SHARED_KEY || w.key === FLAG_KEY), false);

  const copied = buildPlan({ env: {}, existing: { api: new Map([[SHARED_KEY, SECRET_A]]), worker: new Map() }, random: fixedRandom() });
  const copy = copied.writes.find((w) => w.key === SHARED_KEY);
  assert.deepEqual({ service: copy.service, reason: copy.reason, value: copy.value }, { service: 'worker', reason: 'copy-from-api', value: SECRET_A });

  assert.throws(() => buildPlan({ env: {}, existing: { api: new Map([[SHARED_KEY, SECRET_A]]), worker: new Map([[SHARED_KEY, 'b'.repeat(64)]]) } }), /differs between/);
});

test('plan: owner-supplied Discord and PayPal values are forwarded only to the service that needs them, and only when present', () => {
  const env = {
    SML_DISCORD_CONNECT_PUBLIC_KEY: 'pub', SML_DISCORD_CONNECT_APP_ID: '123', SML_DISCORD_CONNECT_BOT_TOKEN: 'tok',
    SML_CONNECT_BOT_ENABLED: '1', SML_PAYPAL_CLIENT_SECRET: '', SML_PAYPAL_ENV: ' sandbox '
  };
  const plan = buildPlan({ env, existing: { api: new Map(), worker: new Map() }, random: fixedRandom() });
  const forwarded = plan.writes.filter((w) => w.reason === 'forward').map((w) => `${w.service}:${w.key}`);
  assert.deepEqual(forwarded, [
    'api:SML_CONNECT_BOT_ENABLED', 'api:SML_DISCORD_CONNECT_PUBLIC_KEY', 'api:SML_DISCORD_CONNECT_APP_ID', 'api:SML_PAYPAL_ENV',
    'worker:SML_CONNECT_BOT_ENABLED', 'worker:SML_DISCORD_CONNECT_BOT_TOKEN', 'worker:SML_PAYPAL_ENV'
  ]);
  assert.equal(plan.writes.find((w) => w.key === 'SML_PAYPAL_ENV').value, 'sandbox');
  assert.equal(plan.writes.some((w) => w.key === 'SML_DISCORD_CONNECT_BOT_TOKEN' && w.service === 'api'), false, 'the bot token never goes to the API service');
});

test('run: dry run reads but never writes or deploys, and prints key names without values', async () => {
  const render = fakeRender();
  const lines = [];
  const result = await run({ env: { RENDER_API_KEY: 'rnd_test' }, argv: [], fetchImpl: render.fetchImpl, random: fixedRandom(), log: (l) => lines.push(l) });
  assert.equal(result.applied, false);
  assert.equal(render.calls.some((c) => c.method === 'PUT' || c.method === 'POST'), false);
  assert.ok(render.calls.every((c) => c.auth === 'Bearer rnd_test'));
  assert.equal(render.state.api.size, 0);
  const out = lines.join('\n');
  assert.match(out, /plan api {4}SML_EVIDENCE_ENCRYPTION_KEY \(generate\)/);
  assert.doesNotMatch(out, /[0-9a-f]{64}/, 'no generated value may appear in output');
});

test('run: apply upserts one variable at a time on the right service, then deploys both with deploy_only', async () => {
  const render = fakeRender({ apiVars: { STRIPE_SECRET_KEY: 'sk_live_x' } });
  const lines = [];
  const result = await run({ env: { RENDER_API_KEY: 'rnd_test', SML_DISCORD_CONNECT_BOT_TOKEN: 'bot-token-value' }, argv: ['--apply'], fetchImpl: render.fetchImpl, random: fixedRandom(), log: (l) => lines.push(l) });
  assert.equal(result.applied, true);
  assert.equal(render.state.api.get(FLAG_KEY), '1');
  assert.equal(render.state.worker.get(FLAG_KEY), '1');
  assert.equal(render.state.api.get(SHARED_KEY), render.state.worker.get(SHARED_KEY));
  assert.equal(render.state.api.get('STRIPE_SECRET_KEY'), 'sk_live_x', 'untouched variables survive: the full-replace endpoint is never used');
  assert.equal(render.state.worker.get('SML_DISCORD_CONNECT_BOT_TOKEN'), 'bot-token-value');
  assert.equal(render.state.api.has('SML_DISCORD_CONNECT_BOT_TOKEN'), false);
  assert.equal(render.calls.some((c) => c.method === 'PUT' && /\/env-vars$/.test(c.path)), false, 'PUT on the collection endpoint (full replace) must never happen');
  const deploys = render.calls.filter((c) => c.method === 'POST');
  assert.deepEqual(deploys.map((c) => c.path), ['/v1/services/srv-api/deploys', '/v1/services/srv-worker/deploys']);
  assert.deepEqual(result.deploys, [{ service: API_SERVICE, deployId: 'dep-srv-api' }, { service: WORKER_SERVICE, deployId: 'dep-srv-worker' }]);
  const out = lines.join('\n');
  assert.doesNotMatch(out, /bot-token-value|sk_live_x/);
  assert.match(out, /upgrade-chat\/webhook\//, 'the owner is told the exact Upgrade.Chat URL to register');
  assert.doesNotMatch(out, new RegExp(render.state.api.get(SHARED_KEY)));
});

test('run: refuses without an API key and when a service is missing', async () => {
  await assert.rejects(run({ env: {}, argv: [], fetchImpl: async () => { throw new Error('should not be called'); }, log: () => {} }), /RENDER_API_KEY/);
  const fetchImpl = async () => ({ ok: true, status: 200, async json() { return [{ service: { id: 'x', name: API_SERVICE } }]; } });
  await assert.rejects(run({ env: { RENDER_API_KEY: 'k' }, argv: [], fetchImpl, log: () => {} }), /could not find both services/);
});

test('run: a rejected key produces an actionable message and never echoes the value', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, async json() { return { message: 'unauthorized' }; } });
  await assert.rejects(
    run({ env: { RENDER_API_KEY: 'deploy-hook-url-pasted-by-mistake' }, argv: [], fetchImpl, log: () => {} }),
    (error) => {
      assert.match(error.message, /not a valid Render API key/);
      assert.match(error.message, /rnd_/, 'the message states the expected key prefix');
      assert.doesNotMatch(error.message, /deploy-hook-url-pasted-by-mistake/, 'the rejected credential is never echoed');
      return true;
    }
  );
});
