'use strict';

const http = require('node:http');
const { getConfig } = require('../config');
const { createDatabase } = require('../database');
const { log } = require('../logger');
const { MAX_BODY_BYTES } = require('../discord-interactions');
const { createAcademyInteractions } = require('./runtime');

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

function createAcademyServer({ interactions, checkDatabase }) {
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
    sendJson(response, 404, { ok: false, error: 'not_found' });
  });
}

async function main() {
  const config = getConfig();
  const database = createDatabase(config);
  const interactions = createAcademyInteractions({ config, pool: database.pool });
  const server = createAcademyServer({ interactions, checkDatabase: database.health });
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(async () => {
      await database.close();
      log('info', 'academy_shutdown_complete', { signal });
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  server.listen(config.port, () => log('info', 'academy_started', {
    port: config.port,
    enabled: Boolean(interactions),
    guildId: config.academyGuildId || null
  }));
}

if (require.main === module) {
  main().catch((error) => {
    log('error', 'academy_start_failed', { error });
    process.exit(1);
  });
}

module.exports = { createAcademyServer, readBody, sendJson };
