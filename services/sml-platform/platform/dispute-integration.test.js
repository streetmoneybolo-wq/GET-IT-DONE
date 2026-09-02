'use strict';

/* Integration surface of the dispute-evidence subsystem: server routes,
 * Stripe post-commit fan-out, runtime flag gating, the disputed-access
 * policy inside the existing outbox enrichment, and log hygiene. */

const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer, DISPUTE_ACTIONS } = require('./server');
const { hmac } = require('./wordpress-gateway');
const { createDisputeRuntime, createStripeFanout } = require('./dispute-runtime');
const { getConfig } = require('./config');
const W = require('./billing-worker');
const { sanitize } = require('./logger');

const NOW_MS = 1_700_000_000_000;
const SECRET = 'billing-api-test-secret';

async function withServer(options, run) {
  const server = createServer({
    checkDatabase: async () => true,
    acceptWordPressEvent: async () => 'accepted',
    logger: () => {},
    now: () => NOW_MS,
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

function signed(body, secret = SECRET, timestamp = '1700000000') {
  return {
    'content-type': 'application/json',
    'x-sml-timestamp': timestamp,
    'x-sml-signature': `sha256=${hmac(secret, timestamp, body)}`
  };
}

/* ---------------------------------------------------------------------------
 * Routes fail closed until configured
 * ------------------------------------------------------------------------- */

test('PayPal, Upgrade.Chat, and Discord routes answer 503 integration_unconfigured while their handlers are absent', async () => {
  await withServer({}, async (base) => {
    for (const path of ['/v1/paypal/webhook', '/v1/upgrade-chat/webhook/some-token', '/v1/discord/interactions']) {
      const response = await fetch(`${base}${path}`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
      assert.equal(response.status, 503, path);
      assert.deepEqual(await response.json(), { ok: false, error: 'integration_unconfigured' });
    }
  });
});

test('configured webhook handlers receive the raw body; oversized bodies never reach them', async () => {
  const seen = [];
  const paypalWebhook = { async handle(_request, response, rawBody) { seen.push(['paypal', rawBody]); response.writeHead(200); response.end('{}'); } };
  const discordInteractions = { async handleRequest(_request, response, rawBody) { seen.push(['discord', rawBody]); response.writeHead(200); response.end('{}'); } };
  const upgradeChatWebhook = { async handle(request, response) { seen.push(['uc', request.url]); response.writeHead(200); response.end('{}'); } };
  await withServer({ paypalWebhook, discordInteractions, upgradeChatWebhook }, async (base) => {
    await fetch(`${base}/v1/paypal/webhook`, { method: 'POST', body: '{"id":"WH-1"}' });
    await fetch(`${base}/v1/discord/interactions`, { method: 'POST', body: '{"type":1}' });
    await fetch(`${base}/v1/upgrade-chat/webhook/tok`, { method: 'POST', body: '{}' });
    const big = await fetch(`${base}/v1/discord/interactions`, { method: 'POST', body: 'x'.repeat(70 * 1024) });
    assert.equal(big.status, 413);
  });
  assert.deepEqual(seen, [['paypal', '{"id":"WH-1"}'], ['discord', '{"type":1}'], ['uc', '/v1/upgrade-chat/webhook/tok']]);
});

test('dispute admin routes require JSON, a valid HMAC, and an enabled service; unknown actions are 404', async () => {
  const body = JSON.stringify({ limit: 5 });
  await withServer({ billingApiSecret: SECRET }, async (base) => {
    const noJson = await fetch(`${base}/v1/billing/disputes/list`, { method: 'POST', body, headers: { 'content-type': 'text/plain' } });
    assert.equal(noJson.status, 415);
    const badSig = await fetch(`${base}/v1/billing/disputes/list`, { method: 'POST', body, headers: signed(body, 'wrong') });
    assert.equal(badSig.status, 401);
    const disabled = await fetch(`${base}/v1/billing/disputes/list`, { method: 'POST', body, headers: signed(body) });
    assert.equal(disabled.status, 503);
    assert.deepEqual(await disabled.json(), { ok: false, error: 'integration_unconfigured' });
    const unknown = await fetch(`${base}/v1/billing/disputes/delete-everything`, { method: 'POST', body, headers: signed(body) });
    assert.equal(unknown.status, 404);
  });
  await withServer({}, async (base) => {
    const noSecret = await fetch(`${base}/v1/billing/disputes/list`, { method: 'POST', body, headers: signed(body) });
    assert.equal(noSecret.status, 503, 'no configured secret fails closed before touching the service');
  });
});

test('an enabled dispute service answers 200 with its result, 400 for TypeErrors, 503 for other failures, without leaking inputs to logs', async () => {
  const logs = [];
  const inputs = [];
  const disputeService = {
    async listCases(input) { inputs.push(input); return { cases: [], webhooks: null }; },
    async caseDetail() { throw new TypeError('dispute case not found'); },
    async buildPacket() { throw new Error('database gone'); },
    async redeemReviewToken() { return { authorized: false }; }
  };
  const body = JSON.stringify({ limit: 5, token: 'super-secret-review-token' });
  await withServer({ billingApiSecret: SECRET, disputeService, logger: (level, event, fields) => logs.push({ level, event, fields }) }, async (base) => {
    const ok = await fetch(`${base}/v1/billing/disputes/list`, { method: 'POST', body, headers: signed(body) });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, cases: [], webhooks: null });
    const bad = await fetch(`${base}/v1/billing/disputes/detail`, { method: 'POST', body, headers: signed(body) });
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { ok: false, error: 'invalid_request', message: 'dispute case not found' });
    const boom = await fetch(`${base}/v1/billing/disputes/build-packet`, { method: 'POST', body, headers: signed(body) });
    assert.equal(boom.status, 503);
    const missing = await fetch(`${base}/v1/billing/disputes/link-admin`, { method: 'POST', body, headers: signed(body) });
    assert.equal(missing.status, 503, 'an action the service does not implement is unconfigured, not a crash');
  });
  assert.equal(inputs[0].limit, 5);
  assert.equal(JSON.stringify(logs).includes('super-secret-review-token'), false);
  assert.ok(logs.every((line) => line.event === 'dispute_request_failed'));
  assert.deepEqual(Object.keys(DISPUTE_ACTIONS).sort(), [
    'admins', 'approve-submit', 'build-packet', 'detail', 'health', 'issue-review-token', 'link-admin',
    'list', 'record-consent', 'record-policy', 'record-terms-version', 'redeem-review-token'
  ]);
});

test('health reports the applied schema version when a reader is supplied and tolerates reader failure', async () => {
  await withServer({ schemaVersion: async () => '012' }, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true, service: 'sml-platform-api', database: 'connected', schema: '012' });
  });
  await withServer({ schemaVersion: async () => { throw new Error('no ledger'); } }, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true, service: 'sml-platform-api', database: 'connected', schema: null });
  });
});

/* ---------------------------------------------------------------------------
 * Stripe post-commit fan-out
 * ------------------------------------------------------------------------- */

test('the Stripe fan-out runs the ledger and dispute projections after the existing accept, isolates their failures, and returns the original status', async () => {
  const calls = [];
  const logs = [];
  const accept = createStripeFanout({
    acceptStripeEvent: async (event) => { calls.push(['accept', event.id]); return 'processed'; },
    ledger: { async applyStripeEvent(row) { calls.push(['ledger', row.event_id, row.event_created_at]); if (row.event_id === 'evt_fail') throw new Error('ledger down'); } },
    disputeCases: { async applyStripeDisputeEvent(row) { calls.push(['case', row.event_id]); } },
    logger: (level, event, fields) => logs.push({ level, event, fields })
  });
  assert.equal(await accept({ id: 'evt_1', type: 'charge.dispute.created', created: 1_700_000_000, data: { object: {} } }), 'processed');
  assert.equal(await accept({ id: 'evt_fail', type: 'invoice.paid', created: 1_700_000_000, data: { object: {} } }), 'processed');
  assert.deepEqual(calls, [
    ['accept', 'evt_1'], ['ledger', 'evt_1', '2023-11-14T22:13:20.000Z'], ['case', 'evt_1'],
    ['accept', 'evt_fail'], ['ledger', 'evt_fail', '2023-11-14T22:13:20.000Z']
  ]);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].event, 'stripe_ledger_post_commit_failed');
  const passthrough = async () => 'duplicate';
  assert.equal(createStripeFanout({ acceptStripeEvent: passthrough }), passthrough);
});

/* ---------------------------------------------------------------------------
 * Runtime flag gating
 * ------------------------------------------------------------------------- */

const BASE_ENV = { DATABASE_URL: 'postgres://u:p@localhost:5432/x', STRIPE_SECRET_KEY: 'sk_test_x' };
const pool = { async query() { return { rows: [] }; }, async connect() { return { async query() { return { rows: [] }; }, release() {} }; } };

test('the runtime is fully absent with the flag off or without an encryption key', () => {
  const logs = [];
  const off = createDisputeRuntime({ config: getConfig(BASE_ENV), pool, logger: (l, e) => logs.push(e) });
  assert.equal(off.enabled, false);
  assert.equal(off.reason, 'flag_off');
  assert.equal(off.paypalWebhook, null);
  assert.deepEqual(off.outboxHandlers, {});
  const accept = async () => 'x';
  assert.equal(off.wrapStripeAccept(accept), accept);
  const noKey = createDisputeRuntime({ config: getConfig({ ...BASE_ENV, SML_DISPUTE_EVIDENCE_ENABLED: '1' }), pool, logger: (l, e) => logs.push(e) });
  assert.equal(noKey.enabled, false);
  assert.equal(noKey.reason, 'missing_encryption_key');
  assert.deepEqual(logs, ['dispute_evidence_disabled_missing_key']);
});

test('with the flag and key set, collection surfaces exist while PayPal and the Connect bot stay off until their own configuration', () => {
  const config = getConfig({ ...BASE_ENV, SML_DISPUTE_EVIDENCE_ENABLED: '1', SML_EVIDENCE_ENCRYPTION_KEY: 'k'.repeat(32) });
  const runtime = createDisputeRuntime({ config, pool, stripe: { disputes: {} } });
  assert.equal(runtime.enabled, true);
  assert.ok(runtime.disputeService && typeof runtime.disputeService.listCases === 'function');
  assert.ok(runtime.paypalWebhook && typeof runtime.paypalWebhook.handle === 'function');
  assert.equal(runtime.paypalClient, null);
  assert.equal(runtime.discordInteractions, null);
  assert.equal(runtime.upgradeChatReconciler, null);
  assert.deepEqual(Object.keys(runtime.outboxHandlers).sort(), ['connect_role_reconcile', 'connect_role_status', 'dispute_alert', 'dispute_deadline']);
  const withBot = createDisputeRuntime({
    config: getConfig({ ...BASE_ENV, SML_DISPUTE_EVIDENCE_ENABLED: '1', SML_EVIDENCE_ENCRYPTION_KEY: 'k'.repeat(32),
      SML_CONNECT_BOT_ENABLED: '1', SML_PAYPAL_ENABLED: '1', SML_PAYPAL_CLIENT_ID: 'id', SML_PAYPAL_CLIENT_SECRET: 'secret' }),
    pool, upgradeChat: { async getOrder() { return {}; } }
  });
  assert.ok(withBot.discordInteractions && typeof withBot.discordInteractions.handleRequest === 'function');
  assert.ok(withBot.paypalClient);
  assert.ok(withBot.upgradeChatReconciler);
});

test('runtime sweeps are isolated: one failing sweep is logged and the others still run', async () => {
  const config = getConfig({ ...BASE_ENV, SML_DISPUTE_EVIDENCE_ENABLED: '1', SML_EVIDENCE_ENCRYPTION_KEY: 'k'.repeat(32) });
  const logs = [];
  const failingPool = {
    async query(sql) {
      if (/FROM stripe_events e/.test(sql)) throw new Error('relation missing');
      return { rows: [] };
    },
    async connect() { return { async query() { return { rows: [] }; }, release() {} }; }
  };
  const runtime = createDisputeRuntime({ config, pool: failingPool, logger: (level, event, fields) => logs.push({ level, event, sweep: fields.sweep }) });
  const results = await runtime.runSweeps();
  assert.equal(results.ledger, null);
  assert.equal(results.stripeCatchUp, 0);
  assert.equal(results.deadlines, 0);
  assert.deepEqual(results.usage, { scanned: 0, recorded: 0, duplicate: 0, skipped: 0, failed: 0 });
  assert.deepEqual(logs, [{ level: 'warn', event: 'dispute_sweep_failed', sweep: 'stripe_ledger' }]);
});

/* ---------------------------------------------------------------------------
 * Disputed-access policy inside the existing reconcile enrichment
 * ------------------------------------------------------------------------- */

function accessClient({ policyRows, tableMissing = false }) {
  const audits = [];
  const client = {
    audits,
    async query(sql) {
      const text = String(sql).replace(/\s+/g, ' ');
      if (text.startsWith('SELECT s.id,s.user_id')) {
        return { rows: [{ id: 44, user_id: 7, group_id: 9, status: 'active', access_until: null, connected_account_id: 'acct_1',
          discord_user_id: '1051212765475377172', guild_id: '938894329076940820', grants: [{ target: 'discord_guild_role', roleRef: '939031140679970867' }] }] };
      }
      if (text.startsWith('SELECT c.id AS case_id, p.on_dispute')) {
        if (tableMissing) throw Object.assign(new Error('relation "dispute_access_policies" does not exist'), { code: '42P01' });
        return { rows: policyRows };
      }
      return { rows: [] };
    }
  };
  const store = { async appendChained(_c, { scopeKey, fields }) { audits.push({ scopeKey, fields }); return { id: 1 }; } };
  return { client, store };
}

test('the safe default keeps access: no policy row, policy disabled, or schema not yet applied', async () => {
  const row = { intent_type: 'subscription_access_reconcile', payload: { subscriptionId: 44 }, source_key: 'k' };
  const none = accessClient({ policyRows: [] });
  assert.equal((await W.enrichAccessPayload(none.client, row, { disputePolicyEnabled: true, store: none.store })).payload.active, true);
  const disabled = accessClient({ policyRows: [{ case_id: 3, on_dispute: 'suspend_access' }] });
  assert.equal((await W.enrichAccessPayload(disabled.client, row)).payload.active, true);
  const missing = accessClient({ policyRows: [], tableMissing: true });
  assert.equal((await W.enrichAccessPayload(missing.client, row, { disputePolicyEnabled: true })).payload.active, true);
});

test('a disclosed suspend_access policy with an open case forces active=false and audits the decision on the case chain', async () => {
  const { client, store } = accessClient({ policyRows: [{ case_id: 3, on_dispute: 'suspend_access' }] });
  const enriched = await W.enrichAccessPayload(client, { intent_type: 'subscription_access_reconcile', payload: { subscriptionId: 44 }, source_key: 'subscription-intent:9' }, { disputePolicyEnabled: true, store });
  assert.equal(enriched.payload.active, false);
  assert.equal(enriched.payload.disputeSuspended, true);
  assert.equal(enriched.payload.disputeCaseId, 3);
  assert.equal(client.audits.length, 1);
  assert.equal(client.audits[0].scopeKey, 3);
  assert.equal(client.audits[0].fields.action, 'access_suspended_by_dispute_policy');
  assert.equal(client.audits[0].fields.detail.subscription_id, 44);
});

/* ---------------------------------------------------------------------------
 * Log hygiene
 * ------------------------------------------------------------------------- */

test('the shared logger strips secret-like keys, and dispute modules never log payloads or emails', () => {
  const cleaned = sanitize({ eventId: 'evt_1', stripeWebhookSecret: 'whsec_x', discordConnectBotToken: 'tok', authorization: 'Bearer y', nested: { paypalClientSecret: 'z', ok: 1 } });
  assert.deepEqual(cleaned, { eventId: 'evt_1', nested: { ok: 1 } });
  const fs = require('node:fs');
  const path = require('node:path');
  const sources = ['stripe-ledger.js', 'usage-consumer.js', 'dispute-notifier.js', 'connect-adapter.js', 'dispute-runtime.js', 'dispute-service.js', 'dispute-cases.js', 'paypal-webhook.js', 'discord-interactions.js', 'connect-commands.js'];
  for (const file of sources) {
    const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.doesNotMatch(text, /console\.(log|error|warn)\(/, `${file} must use the injected logger`);
    /* A logged KEY named payload/rawBody/email/ip is the leak; reading a scalar
       off `payload.x` (e.g. a guild id) is not. */
    assert.doesNotMatch(text, /log\([^)]*[{,]\s*(payload|rawBody|email|purchase_ip|purchaseIp|ip)\s*[,}:]/i, `${file} must not log payloads, emails, or IPs`);
  }
});
