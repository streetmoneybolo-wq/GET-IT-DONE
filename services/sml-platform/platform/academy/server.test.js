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

