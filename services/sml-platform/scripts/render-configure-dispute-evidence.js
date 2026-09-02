#!/usr/bin/env node
'use strict';

/* =============================================================================
 * render-configure-dispute-evidence — one-command Render configuration for the
 * dispute-evidence system. Runs on the OWNER's machine with the owner's
 * RENDER_API_KEY; generated secrets are created locally and sent straight to
 * Render, so no value ever passes through a chat or a log.
 *
 *   RENDER_API_KEY=… node scripts/render-configure-dispute-evidence.js            # plan only
 *   RENDER_API_KEY=… node scripts/render-configure-dispute-evidence.js --apply    # write + deploy
 *   … --apply --rebuild                                                          # build_and_deploy instead of deploy_only
 *
 * What it does (per the Render API reference, verified 2026-09-02):
 *   GET  /v1/services?name=…              find sml-platform-api / sml-platform-worker
 *   GET  /v1/services/{id}/env-vars       read what already exists (never rotates a key)
 *   PUT  /v1/services/{id}/env-vars/{key} upsert ONE variable (never the full-replace endpoint)
 *   POST /v1/services/{id}/deploys        make the new values live
 *
 * Shared key rule: SML_EVIDENCE_ENCRYPTION_KEY must be identical on both
 * services. Existing on both and equal -> kept; existing on one -> copied to
 * the other; missing on both -> generated once. Different on both -> refuse.
 *
 * Optional forwarding: any of the names in FORWARDED_* present in this
 * process's environment is forwarded to the service that needs it (Discord
 * public key/app id -> API, bot token -> worker, PayPal -> both).
 * ========================================================================== */

const crypto = require('node:crypto');

const API_BASE = 'https://api.render.com/v1';
const API_SERVICE = 'sml-platform-api';
const WORKER_SERVICE = 'sml-platform-worker';
const WEBHOOK_HOST = 'https://sml-platform-api.onrender.com';

const FLAG_KEY = 'SML_DISPUTE_EVIDENCE_ENABLED';
const SHARED_KEY = 'SML_EVIDENCE_ENCRYPTION_KEY';
const API_GENERATED = ['SML_CONNECT_REVIEW_URL_SECRET', 'SML_UC_WEBHOOK_PATH_TOKEN'];
const FORWARDED_API = [
  'SML_CONNECT_BOT_ENABLED', 'SML_DISCORD_CONNECT_PUBLIC_KEY', 'SML_DISCORD_CONNECT_APP_ID',
  'SML_PAYPAL_ENABLED', 'SML_PAYPAL_ENV', 'SML_PAYPAL_CLIENT_ID', 'SML_PAYPAL_CLIENT_SECRET', 'SML_PAYPAL_WEBHOOK_ID'
];
const FORWARDED_WORKER = [
  'SML_CONNECT_BOT_ENABLED', 'SML_DISCORD_CONNECT_BOT_TOKEN',
  'SML_PAYPAL_ENABLED', 'SML_PAYPAL_ENV', 'SML_PAYPAL_CLIENT_ID', 'SML_PAYPAL_CLIENT_SECRET'
];

function defaultRandom(bytes) {
  return crypto.randomBytes(bytes);
}

function createRenderClient({ apiKey, fetchImpl = globalThis.fetch }) {
  if (!apiKey) throw new Error('RENDER_API_KEY is required (create one under Account settings -> API keys)');
  async function request(method, path, body) {
    const response = await fetchImpl(`${API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) {
      /* Status only: an error body could echo a value. */
      throw new Error(`Render API ${method} ${path} failed with HTTP ${response.status}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  return {
    async findServices(names) {
      const query = names.map((name) => `name=${encodeURIComponent(name)}`).join('&');
      const rows = await request('GET', `/services?${query}&limit=50`);
      const found = new Map();
      for (const row of Array.isArray(rows) ? rows : []) {
        const service = row && row.service;
        if (service && names.includes(service.name)) found.set(service.name, service.id);
      }
      return found;
    },
    async listEnvVars(serviceId) {
      const values = new Map();
      let cursor = null;
      for (let page = 0; page < 20; page += 1) {
        const rows = await request('GET', `/services/${encodeURIComponent(serviceId)}/env-vars?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        if (!Array.isArray(rows) || !rows.length) break;
        for (const row of rows) {
          if (row && row.envVar && typeof row.envVar.key === 'string') values.set(row.envVar.key, row.envVar.value);
        }
        cursor = rows[rows.length - 1].cursor;
        if (rows.length < 100 || !cursor) break;
      }
      return values;
    },
    async setEnvVar(serviceId, key, value) {
      return request('PUT', `/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`, { value });
    },
    async createDeploy(serviceId, { rebuild = false } = {}) {
      return request('POST', `/services/${encodeURIComponent(serviceId)}/deploys`, {
        deployMode: rebuild ? 'build_and_deploy' : 'deploy_only'
      });
    }
  };
}

function present(env, key) {
  return typeof env[key] === 'string' && env[key].trim() !== '';
}

/**
 * Pure planning step. `existing` = { api: Map, worker: Map } of current env
 * vars; `env` = the owner's process environment; `random` = byte source.
 * Returns writes (with values, for the apply step) and the UC webhook URL.
 */
function buildPlan({ env = {}, existing, random = defaultRandom }) {
  const writes = [];
  const api = existing.api;
  const worker = existing.worker;
  const add = (service, key, value, reason) => writes.push({ service, key, value, reason });

  /* Flag on both services. */
  for (const [service, map] of [['api', api], ['worker', worker]]) {
    if (map.get(FLAG_KEY) !== '1') add(service, FLAG_KEY, '1', 'flag');
  }

  /* Shared encryption key: keep / copy / generate / refuse. */
  const apiKeyValue = present(api instanceof Map ? Object.fromEntries(api) : {}, SHARED_KEY) ? api.get(SHARED_KEY) : null;
  const workerKeyValue = present(worker instanceof Map ? Object.fromEntries(worker) : {}, SHARED_KEY) ? worker.get(SHARED_KEY) : null;
  if (apiKeyValue && workerKeyValue) {
    if (apiKeyValue !== workerKeyValue) {
      throw new Error(`${SHARED_KEY} differs between ${API_SERVICE} and ${WORKER_SERVICE}; resolve that in the Render dashboard before running this script`);
    }
  } else if (apiKeyValue && !workerKeyValue) {
    add('worker', SHARED_KEY, apiKeyValue, 'copy-from-api');
  } else if (!apiKeyValue && workerKeyValue) {
    add('api', SHARED_KEY, workerKeyValue, 'copy-from-worker');
  } else {
    const generated = random(32).toString('hex');
    add('api', SHARED_KEY, generated, 'generate');
    add('worker', SHARED_KEY, generated, 'generate');
  }

  /* API-only generated secrets: keep existing, otherwise generate. */
  for (const key of API_GENERATED) {
    if (!present(Object.fromEntries(api), key)) add('api', key, random(32).toString('base64url'), 'generate');
  }

  /* Forwarded values from the owner's environment (only when present). */
  for (const key of FORWARDED_API) {
    if (present(env, key) && api.get(key) !== env[key].trim()) add('api', key, env[key].trim(), 'forward');
  }
  for (const key of FORWARDED_WORKER) {
    if (present(env, key) && worker.get(key) !== env[key].trim()) add('worker', key, env[key].trim(), 'forward');
  }

  const ucToken = (writes.find((w) => w.service === 'api' && w.key === 'SML_UC_WEBHOOK_PATH_TOKEN') || {}).value
    || api.get('SML_UC_WEBHOOK_PATH_TOKEN') || null;
  return {
    writes,
    upgradeChatWebhookUrl: ucToken ? `${WEBHOOK_HOST}/v1/upgrade-chat/webhook/${ucToken}` : null
  };
}

async function run({ env = process.env, argv = process.argv.slice(2), fetchImpl, random = defaultRandom, log = console.log } = {}) {
  const apply = argv.includes('--apply');
  const rebuild = argv.includes('--rebuild');
  const client = createRenderClient({ apiKey: env.RENDER_API_KEY, fetchImpl });

  const services = await client.findServices([API_SERVICE, WORKER_SERVICE]);
  const apiId = services.get(API_SERVICE);
  const workerId = services.get(WORKER_SERVICE);
  if (!apiId || !workerId) {
    throw new Error(`could not find both services by name (${API_SERVICE}, ${WORKER_SERVICE}) with this API key`);
  }
  const existing = {
    api: await client.listEnvVars(apiId),
    worker: await client.listEnvVars(workerId)
  };
  const plan = buildPlan({ env, existing, random });

  log(`services: ${API_SERVICE}=${apiId} ${WORKER_SERVICE}=${workerId}`);
  if (!plan.writes.length) log('nothing to change: every managed variable is already set');
  for (const write of plan.writes) {
    /* Key names and reasons only. Values are never printed. */
    log(`${apply ? 'set ' : 'plan'} ${write.service.padEnd(6)} ${write.key} (${write.reason})`);
  }
  if (!apply) {
    log('dry run: re-run with --apply to write these variables and deploy both services');
    return { applied: false, plan: plan.writes.map(({ service, key, reason }) => ({ service, key, reason })) };
  }

  for (const write of plan.writes) {
    await client.setEnvVar(write.service === 'api' ? apiId : workerId, write.key, write.value);
  }
  const deploys = [];
  for (const [name, id] of [[API_SERVICE, apiId], [WORKER_SERVICE, workerId]]) {
    const deploy = await client.createDeploy(id, { rebuild });
    const deployId = deploy && (deploy.id || (deploy.deploy && deploy.deploy.id)) || 'queued';
    deploys.push({ service: name, deployId });
    log(`deploy ${name}: ${deployId}`);
  }
  if (plan.upgradeChatWebhookUrl) {
    log('Upgrade.Chat webhook URL to register in the Upgrade.Chat developer settings (keep this private):');
    log(plan.upgradeChatWebhookUrl);
  }
  log('verify: curl https://sml-platform-api.onrender.com/health (schema 012) and POST /v1/billing/disputes/list from wp-admin -> Disputes');
  return { applied: true, plan: plan.writes.map(({ service, key, reason }) => ({ service, key, reason })), deploys };
}

if (require.main === module) {
  run().then((result) => {
    process.exit(result.applied ? 0 : 0);
  }).catch((error) => {
    console.error(String(error && error.message || error));
    process.exit(1);
  });
}

module.exports = {
  API_GENERATED,
  API_SERVICE,
  FLAG_KEY,
  FORWARDED_API,
  FORWARDED_WORKER,
  SHARED_KEY,
  WORKER_SERVICE,
  buildPlan,
  createRenderClient,
  run
};
