'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer } = require('./server');

async function withServer(checkDatabase, run) {
  const server = createServer({ checkDatabase, logger: () => {} });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('health returns 200 only when the database check passes', async () => {
  await withServer(async () => true, async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      service: 'sml-platform-api',
      database: 'connected'
    });
  });
});

test('health fails closed when the database check fails', async () => {
  await withServer(async () => { throw new Error('offline'); }, async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      service: 'sml-platform-api',
      database: 'unavailable'
    });
  });
});

test('all other routes are a no-store 404', async () => {
  await withServer(async () => true, async (base) => {
    const response = await fetch(`${base}/not-a-route`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});
