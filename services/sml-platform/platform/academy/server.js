'use strict';

const http = require('node:http');
const { getConfig } = require('../config');
const { createDatabase } = require('../database');
const { log } = require('../logger');
const { MAX_BODY_BYTES } = require('../discord-interactions');
const { createAcademyInteractions } = require('./runtime');
const { publishAcademyHubs } = require('./hub-publisher');
const { scheduleAcademyActivityInviteGuard } = require('./activity-invite-guard');
const { createAcademyBilling } = require('./billing');

async function readBody(request, maxBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) return { ok: false, status: 413, error: 'payload_too_large' };
    chunks.push(chunk);
  }
  return { ok: true, rawBody: Buffer.concat(chunks) };
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

function createAcademyServer({ interactions, checkDatabase, academyBilling = null }) {
  return http.createServer(async (request, response) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    if (request.method === 'GET' && path === '/health') {
      try {
        await checkDatabase();
        sendJson(response, 200, { ok: true, service: 'making-easy-money-academy', database: 'connected' });
      } catch (_) {
        sendJson(response, 503, { ok: false, service: 'making-easy-money-academy', database: 'unavailable' });
      }
      return;
    }
    if (request.method === 'POST' && path === '/v1/academy/interactions') {
      if (!interactions) {
        sendJson(response, 503, { ok: false, error: 'integration_unconfigured' });
        return;
      }
      const body = await readBody(request);
      if (!body.ok) {
        sendJson(response, body.status, { ok: false, error: body.error });
        return;
      }
      await interactions.handleRequest(request, response, body.rawBody);
      return;
    }
    // MEM Academy billing (flag-gated; every path 404s until the engine is
    // enabled, except the Stripe webhook). A throw here must never become an
    // unhandled rejection that takes the hub interactions down with it.
    if (academyBilling && path.startsWith('/v1/academy/billing/')) {
      try {
        if (await academyBilling.handle(request, response, path)) return;
      } catch (error) {
        log('error', 'academy_billing_unhandled', { error });
        if (!response.headersSent) sendJson(response, 500, { ok: false, error: 'internal_error' });
        else response.destroy();
        return;
      }
    }
    sendJson(response, 404, { ok: false, error: 'not_found' });
  });
}

async function main() {
  const config = getConfig();
  const database = createDatabase(config);
  // Built before the interactions so the hub can use its one-time buy links
  // (billing.handoff.mint) and re-kick waiting grants (billing.onMemberSeen).
  // With every SML_ACADEMY_BILLING_* flag off it is inert.
  let academyBilling = null;
  try {
    academyBilling = createAcademyBilling({
      env: process.env,
      databaseUrl: config.databaseUrl,
      databaseSsl: config.databaseSsl,
      logger: log
    });
  } catch (error) {
    log('error', 'academy_billing_init_failed', { error });
  }
  const interactions = createAcademyInteractions({ config, pool: database.pool, billing: academyBilling });
  const server = createAcademyServer({ interactions, checkDatabase: database.health, academyBilling });
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(async () => {
      if (academyBilling) await academyBilling.stop().catch(() => {});
      await database.close();
      log('info', 'academy_shutdown_complete', { signal });
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  server.listen(config.port, () => {
    log('info', 'academy_started', {
      port: config.port,
      enabled: Boolean(interactions),
      guildId: config.academyGuildId || null
    });
    // Keep the Academy's one-click channel launchers in sync after every
    // successful deploy. The operation is idempotent and reuses pinned channel
    // IDs, so a rename never creates a duplicate or loses permissions/history.
    if (config.academyBotToken && config.academyGuildId && config.academyCategoryId) {
      void publishAcademyHubs({
        token: config.academyBotToken,
        guildId: config.academyGuildId,
        categoryId: config.academyCategoryId,
        apply: true
      }).then((result) => log('info', 'academy_hubs_synced', {
        operations: result.operations.map(({ command, action, channelId }) => ({ command, action, channelId }))
      })).catch((error) => log('error', 'academy_hubs_sync_failed', { error }));
      if (config.academyAppId) {
        scheduleAcademyActivityInviteGuard({
          token: config.academyBotToken,
          guildId: config.academyGuildId,
          categoryId: config.academyCategoryId,
          applicationId: config.academyAppId
        }, { logger: log });
      }
    }
    // Billing jobs start only when SML_ACADEMY_BILLING_ENABLED=1 and schema 028
    // is present; otherwise start() only logs why it is idle.
    if (academyBilling) {
      void academyBilling.start().catch((error) => log('error', 'academy_billing_start_failed', { error }));
    }
  });
}

if (require.main === module) {
  main().catch((error) => {
    log('error', 'academy_start_failed', { error });
    process.exit(1);
  });
}

module.exports = { createAcademyServer, readBody, sendJson };
