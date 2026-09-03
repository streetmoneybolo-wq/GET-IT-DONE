#!/usr/bin/env node
'use strict';

/* =============================================================================
 * verify-dispute-live — READ-ONLY end-to-end check of the dispute-evidence
 * system. Runs on the OWNER's machine with the owner's RENDER_API_KEY. It
 * reads the billing secret from Render and uses it in memory to sign three
 * read-only dispute calls, so nothing secret is ever printed or pasted.
 *
 *   RENDER_API_KEY=… node scripts/verify-dispute-live.js
 *
 * It performs NO writes: no env change, no deploy, and only the read-only
 * dispute actions (health, admins, list). It never builds or submits a packet.
 * ========================================================================== */

const crypto = require('node:crypto');
const { createRenderClient, API_SERVICE, WORKER_SERVICE } = require('./render-configure-dispute-evidence');

const PLATFORM = 'https://sml-platform-api.onrender.com';

/* Flags and selectors are safe to display. Credentials are reported by name. */
const SHOW_VALUE = new Set([
  'SML_DISPUTE_EVIDENCE_ENABLED', 'SML_CONNECT_BOT_ENABLED',
  'SML_PAYPAL_ENABLED', 'SML_PAYPAL_ENV', 'SML_CONNECT_REVIEW_URL_BASE'
]);

const API_EXPECTED = [
  'SML_DISPUTE_EVIDENCE_ENABLED', 'SML_EVIDENCE_ENCRYPTION_KEY', 'SML_BILLING_API_SECRET',
  'SML_CONNECT_REVIEW_URL_SECRET', 'SML_CONNECT_REVIEW_URL_BASE', 'SML_UC_WEBHOOK_PATH_TOKEN',
  'SML_CONNECT_BOT_ENABLED', 'SML_DISCORD_CONNECT_PUBLIC_KEY', 'SML_DISCORD_CONNECT_APP_ID',
  'SML_PAYPAL_ENABLED', 'SML_PAYPAL_ENV', 'SML_PAYPAL_CLIENT_ID', 'SML_PAYPAL_CLIENT_SECRET',
  'SML_PAYPAL_WEBHOOK_ID'
];
const WORKER_EXPECTED = [
  'SML_DISPUTE_EVIDENCE_ENABLED', 'SML_EVIDENCE_ENCRYPTION_KEY',
  'SML_CONNECT_BOT_ENABLED', 'SML_DISCORD_CONNECT_BOT_TOKEN',
  'SML_PAYPAL_ENABLED', 'SML_PAYPAL_ENV', 'SML_PAYPAL_CLIENT_ID', 'SML_PAYPAL_CLIENT_SECRET'
];

/** Exactly the scheme in wordpress-gateway.verifySignature / smlcda_signature. */
function sign(secret, timestamp, rawBody) {
  return `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')}`;
}

async function callDispute({ secret, action, payload, fetchImpl, now = Date.now }) {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Math.floor(now() / 1000));
  const response = await fetchImpl(`${PLATFORM}/v1/billing/disputes/${action}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sml-timestamp': timestamp,
      'x-sml-signature': sign(secret, timestamp, rawBody)
    },
    body: rawBody
  });
  let body = null;
  try { body = await response.json(); } catch (_) { /* non-JSON body stays null */ }
  return { status: response.status, body };
}

async function probe(path, fetchImpl) {
  const response = await fetchImpl(`${PLATFORM}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
  });
  return response.status;
}

function reportVars(log, label, vars, expected) {
  log(`\n${label}`);
  for (const key of expected) {
    const value = vars.get(key);
    const present = typeof value === 'string' && value.trim() !== '';
    if (!present) { log(`  MISSING  ${key}`); continue; }
    log(SHOW_VALUE.has(key) ? `  set      ${key} = ${value}` : `  set      ${key}`);
  }
}

async function run({ env = process.env, fetchImpl = globalThis.fetch, log = console.log, now = Date.now } = {}) {
  const client = createRenderClient({ apiKey: env.RENDER_API_KEY, fetchImpl });
  const services = await client.findServices([API_SERVICE, WORKER_SERVICE]);
  const apiId = services.get(API_SERVICE);
  const workerId = services.get(WORKER_SERVICE);
  if (!apiId || !workerId) throw new Error(`could not find both services (${API_SERVICE}, ${WORKER_SERVICE}) with this API key`);

  const apiVars = await client.listEnvVars(apiId);
  const workerVars = await client.listEnvVars(workerId);
  reportVars(log, `env on ${API_SERVICE}:`, apiVars, API_EXPECTED);
  reportVars(log, `env on ${WORKER_SERVICE}:`, workerVars, WORKER_EXPECTED);

  const apiKeyValue = apiVars.get('SML_EVIDENCE_ENCRYPTION_KEY');
  const workerKeyValue = workerVars.get('SML_EVIDENCE_ENCRYPTION_KEY');
  log('\nshared encryption key:');
  if (!apiKeyValue || !workerKeyValue) log('  CANNOT COMPARE — missing on one service; the worker cannot read what the API wrote');
  else if (apiKeyValue === workerKeyValue) log('  identical on both services (compared in memory, never printed)');
  else log('  MISMATCH — the two services cannot read each other\'s evidence. Fix before collecting more.');

  const paypalEnv = (apiVars.get('SML_PAYPAL_ENV') || '').trim();
  if (apiVars.get('SML_PAYPAL_ENABLED') === '1' && paypalEnv !== 'live' && paypalEnv !== 'sandbox') {
    log(`  NOTE: SML_PAYPAL_ENV is "${paypalEnv || '(unset)'}" which the service coerces to sandbox.`);
  }

  log('\nunauthenticated endpoint probes (expected once configured):');
  const healthResponse = await fetchImpl(`${PLATFORM}/health`);
  log(`  /health                    ${healthResponse.status}  ${JSON.stringify(await healthResponse.json())}`);
  log(`  /v1/discord/interactions   ${await probe('/v1/discord/interactions', fetchImpl)}  (401 = configured)`);
  log(`  /v1/paypal/webhook         ${await probe('/v1/paypal/webhook', fetchImpl)}  (400 = configured; this route has no 401)`);

  const secret = apiVars.get('SML_BILLING_API_SECRET');
  if (!secret) {
    log('\nsigned dispute calls: SKIPPED — SML_BILLING_API_SECRET is not set on the API service.');
    return { ok: false, reason: 'missing_billing_secret' };
  }

  log('\nsigned dispute calls (read-only; this is what the wp-admin console does):');
  const results = {};
  for (const [action, payload] of [['health', {}], ['admins', {}], ['list', { limit: 50 }]]) {
    try {
      const result = await callDispute({ secret, action, payload, fetchImpl, now });
      results[action] = result;
      const detail = result.body && result.body.ok === true
        ? JSON.stringify(result.body).slice(0, 600)
        : JSON.stringify(result.body && (result.body.message || result.body.error) || result.body);
      log(`  ${action.padEnd(7)} HTTP ${result.status}  ${detail}`);
    } catch (error) {
      log(`  ${action.padEnd(7)} request failed: ${String(error && error.message || error)}`);
    }
  }
  const listOk = results.list && results.list.status === 200;
  log(`\nverdict: the WordPress -> platform -> database path is ${listOk ? 'WORKING' : 'NOT working — see the line above'}.`);
  return { ok: Boolean(listOk), results };
}

if (require.main === module) {
  run().then((result) => process.exit(result.ok ? 0 : 1)).catch((error) => {
    console.error(String(error && error.message || error));
    process.exit(1);
  });
}

module.exports = { run, sign, callDispute, API_EXPECTED, WORKER_EXPECTED };
