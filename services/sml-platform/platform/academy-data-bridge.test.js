'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createAcademyDataBridge, cleanSymbol } = require('./academy-data-bridge');

test('academy data bridge signs a bounded options request', async () => {
  const calls = [];
  const bridge = createAcademyDataBridge({
    baseUrl: 'https://stockmarketloop.com/', secret: 'a'.repeat(32), now: () => 1_700_000_000_000,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ ok: true, symbol: 'SPY' }), { status: 200 }); }
  });
  const result = await bridge.get('options', 'spy<script>');
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'https://stockmarketloop.com/wp-json/sml-academy-bridge/v1/options?symbol=SPYSCRIPT');
  const path = '/wp-json/sml-academy-bridge/v1/options?symbol=SPYSCRIPT';
  const expected = crypto.createHmac('sha256', 'a'.repeat(32)).update(`1700000000.${path}`).digest('hex');
  assert.equal(calls[0].options.headers['x-sml-academy-signature'], `sha256=${expected}`);
});

test('academy data bridge fails closed while unconfigured', async () => {
  const bridge = createAcademyDataBridge({ baseUrl: 'https://stockmarketloop.com', secret: '' });
  assert.deepEqual(await bridge.get('earnings', 'NVDA'), { ok: false, status: 503, code: 'academy_data_unconfigured' });
  assert.throws(() => cleanSymbol('<>'), /invalid_symbol/);
});

test('academy data bridge includes a validated option expiration in its signature', async () => {
  const calls = [];
  const bridge = createAcademyDataBridge({ baseUrl: 'https://stockmarketloop.com', secret: 'b'.repeat(32), now: () => 1_700_000_000_000,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response('{}', { status: 200 }); } });
  assert.equal((await bridge.get('options', 'SPY', { expiration: '2026-10-16' })).ok, true);
  assert.match(calls[0].url, /expiration=2026-10-16$/);
  await assert.rejects(() => bridge.get('options', 'SPY', { expiration: 'tomorrow' }), /invalid_expiration/);
});

test('academy data bridge keeps the site\'s own reason for a refused request and names a timeout', async () => {
  const refused = createAcademyDataBridge({ baseUrl: 'https://stockmarketloop.com', secret: 'c'.repeat(32),
    fetchImpl: async () => new Response(JSON.stringify({ code: 'sml_academy_bridge_source', message: 'Academy data is temporarily unavailable.', data: { status: 503 } }), { status: 503 }) });
  const r1 = await refused.get('options', 'SPY');
  assert.equal(r1.ok, false); assert.equal(r1.code, 'academy_data_unavailable'); assert.equal(r1.status, 503);
  assert.equal(r1.detail, 'Academy data is temporarily unavailable.');

  const slow = createAcademyDataBridge({ baseUrl: 'https://stockmarketloop.com', secret: 'c'.repeat(32),
    fetchImpl: async () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; } });
  const r2 = await slow.get('options', 'SPY');
  assert.equal(r2.ok, false); assert.equal(r2.status, 503); assert.equal(r2.detail, 'The site did not answer in time.');

  const open = createAcademyDataBridge({ baseUrl: 'https://stockmarketloop.com', secret: 'c'.repeat(32),
    fetchImpl: async () => { const e = new Error('circuit_open_moomoo-bridge'); e.code = 'circuit_open'; throw e; } });
  assert.match((await open.get('options', 'SPY')).detail, /cooling down/);
});

test('academy data bridge gives the site long enough for a cold moomoo chain and honours an override', () => {
  assert.equal(createAcademyDataBridge({ baseUrl: 'https://stockmarketloop.com', secret: 'd'.repeat(32) }).timeoutMs, 25_000);
  assert.equal(createAcademyDataBridge({ baseUrl: 'https://stockmarketloop.com', secret: 'd'.repeat(32), timeoutMs: 40_000 }).timeoutMs, 40_000);
  assert.equal(createAcademyDataBridge({ baseUrl: 'https://stockmarketloop.com', secret: 'd'.repeat(32), timeoutMs: 'nope' }).timeoutMs, 25_000);
  assert.equal(createAcademyDataBridge({ baseUrl: 'https://stockmarketloop.com', secret: 'd'.repeat(32), timeoutMs: 10 }).timeoutMs, 1_000);
});

test('data bridge shares one in-flight request per symbol and remembers a failure for a few seconds', async () => {
  const { createAcademyDataBridge } = require('./academy-data-bridge');
  let calls = 0; let t = 1_000_000;
  const bridge = createAcademyDataBridge({
    baseUrl: 'https://example.com', secret: 'x'.repeat(40), now: () => t,
    fetchImpl: async () => { calls += 1; await new Promise((r) => setTimeout(r, 5)); return { ok: false, status: 503, json: async () => ({ message: 'cooling down' }) }; }
  });
  const [a, b] = await Promise.all([bridge.get('options', 'XHG'), bridge.get('options', 'XHG')]);
  assert.equal(calls, 1);
  assert.equal(a.ok, false); assert.equal(b.detail, 'cooling down');
  await bridge.get('options', 'XHG'); assert.equal(calls, 1, 'remembered');
  await bridge.get('earnings', 'XHG'); assert.equal(calls, 2, 'other kinds are unaffected');
  t += 16_000; await bridge.get('options', 'XHG'); assert.equal(calls, 3, 'retried after the memory window');
});

test('a 429 from the site pauses every bridge call for its retry-after, and a bridge call never waits longer than forty-five seconds', async () => {
  let clock = 1_700_000_000_000; const calls = [];
  const bridge = createAcademyDataBridge({
    baseUrl: 'https://stockmarketloop.com', secret: 'a'.repeat(32), now: () => clock, timeoutMs: 120_000,
    fetchImpl: async (url) => { calls.push(url); return new Response(JSON.stringify({ message: 'Too many requests' }), { status: 429, headers: { 'retry-after': '7' } }); }
  });
  assert.equal(bridge.timeoutMs, 45_000, 'capped: a member has given up long before two minutes');
  const first = await bridge.get('earnings', 'TSLG');
  assert.equal(first.status, 429); assert.equal(first.retryAfterSec, 7); assert.equal(bridge.paused(), 7);
  const second = await bridge.get('earnings', 'NVDA');
  assert.equal(second.status, 429); assert.match(second.detail, /rate limiting/); assert.equal(calls.length, 1, 'nothing else goes to the site while paused');
  clock += 8_000;
  assert.equal(bridge.paused(), 0);
  await bridge.get('earnings', 'AMD');
  assert.equal(calls.length, 2, 'after the pause the bridge tries again');
});

test('academy data bridge keeps a good chain for a minute and serves it as stale when the site fails or rate limits', async () => {
  let t = 1_700_000_000_000, calls = 0, mode = 'ok';
  const bridge = createAcademyDataBridge({
    baseUrl: 'https://stockmarketloop.com', secret: 'c'.repeat(32), now: () => t,
    fetchImpl: async () => { calls++; return mode === 'ok' ? new Response(JSON.stringify({ ok: true, rows: [1] }), { status: 200 }) : new Response(JSON.stringify({ message: 'slow down' }), { status: 429 }); }
  });
  const a = await bridge.get('options', 'NVDA');
  assert.equal(a.ok, true); assert.equal(calls, 1);
  t += 20_000;
  const b = await bridge.get('options', 'NVDA');
  assert.equal(calls, 1, 'a second read inside the minute costs no call'); assert.equal(b.cached, true); assert.equal(b.ageSec, 20);
  t += 70_000; mode = 'down';
  const c = await bridge.get('options', 'NVDA');
  assert.equal(c.ok, true); assert.equal(c.stale, true); assert.ok(c.ageSec >= 90, 'the last good chain, with its age, while the site rate limits');
  assert.equal(calls, 2);
  t += 20 * 60_000;
  const d = await bridge.get('options', 'NVDA');
  assert.equal(d.ok, false, 'after fifteen minutes a stale chain is no longer served');
});
