'use strict';

const http = require('node:http');
const { getConfig } = require('./config');
const { createDatabase } = require('./database');
const { log } = require('./logger');

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(payload);
}

function createServer({ checkDatabase, logger = log }) {
  return http.createServer(async (request, response) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    if (request.method !== 'GET' || path !== '/health') {
      sendJson(response, 404, { ok: false, error: 'not_found' });
      return;
    }

    try {
      await checkDatabase();
      sendJson(response, 200, { ok: true, service: 'sml-platform-api', database: 'connected' });
    } catch (error) {
      logger('error', 'health_database_unavailable', { error });
      sendJson(response, 503, { ok: false, service: 'sml-platform-api', database: 'unavailable' });
    }
  });
}

async function main() {
  const config = getConfig();
  const database = createDatabase(config);
  const server = createServer({ checkDatabase: database.health });
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'shutdown_started', { signal });
    server.close(async () => {
      await database.close();
      log('info', 'shutdown_complete', { signal });
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  server.listen(config.port, () => log('info', 'api_started', { port: config.port }));
}

if (require.main === module) {
  main().catch((error) => {
    log('error', 'api_start_failed', { error });
    process.exit(1);
  });
}

module.exports = { createServer, sendJson };
