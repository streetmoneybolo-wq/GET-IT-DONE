'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createMassiveHistory, createMassiveOptions, createQueuedDataSource, allowedPublicOrigin } = require('./market-data-service');

test('Massive history uses bearer auth, normalizes bars and caches identical requests', async () => {
  let calls = 0;
  const history = createMassiveHistory({ apiKey: 'secret', now: () => Date.UTC(2026, 8, 25), fetchImpl: async (url, options) => {
    calls += 1;
    assert.match(url, /\/v2\/aggs\/ticker\/SPY\/range\/5\/minute\//);
    assert.equal(options.headers.authorization, 'Bearer secret');
    assert.equal(url.includes('secret'), false);
    return new Response(JSON.stringify({ results: [{ t: 1000, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }] }), { status: 200 });
  } });
  const first = await history.get('spy', '5m');
  const second = await history.get('SPY', '5m');
  assert.equal(first.ok, true);
  assert.equal(first.data.bars[0].c, 1.5);
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
});

test('Massive history returns stale cache during a provider outage', async () => {
  let current = 1_800_000_000_000, fail = false;
  const history = createMassiveHistory({ apiKey: 'secret', now: () => current, fetchImpl: async () => {
    if (fail) throw new Error('down');
    return new Response(JSON.stringify({ results: [{ t: 1000, o: 1, h: 2, l: 1, c: 2, v: 1 }] }), { status: 200 });
  } });
  await history.get('AAPL', '1m');
  current += 21_000; fail = true;
  const result = await history.get('AAPL', '1m');
  assert.equal(result.ok, true);
  assert.equal(result.data.stale, true);
});

test('queued options source coalesces, caches and serializes cold calls', async () => {
  let calls = 0, clock = 1000;
  const waits = [];
  const source = { configured: true, get: async (kind, symbol) => ({ ok: true, status: 200, data: { kind, symbol, call: ++calls } }) };
  const queued = createQueuedDataSource({ source, now: () => clock, minimumIntervalMs: 100,
    setTimer: (resolve, ms) => { waits.push(ms); clock += ms; resolve(); }, marketOpen: () => true });
  const [a, b] = await Promise.all([queued.get('options', 'SPY'), queued.get('options', 'SPY')]);
  assert.equal(a.data.call, 1); assert.equal(b.data.call, 1); assert.equal(calls, 1);
  await queued.get('options', 'QQQ');
  assert.equal(calls, 2); assert.deepEqual(waits, [100]);
  const cached = await queued.get('options', 'SPY');
  assert.equal(cached.cached, true); assert.equal(calls, 2);
});

test('public origin allowlist accepts the site and creator subdomains only', () => {
  assert.equal(allowedPublicOrigin('https://stockmarketloop.com'), true);
  assert.equal(allowedPublicOrigin('https://creator.stockmarketloop.com'), true);
  assert.equal(allowedPublicOrigin('http://stockmarketloop.com'), false);
  assert.equal(allowedPublicOrigin('https://stockmarketloop.com.attacker.test'), false);
});

test('Massive options adapter is disabled by default and never invents empty contracts', async () => {
  const disabled = createMassiveOptions({ apiKey: 'secret' });
  assert.equal((await disabled.get('options', 'SPY')).code, 'massive_options_disabled');
  const empty = createMassiveOptions({ apiKey: 'secret', enabled: true, fetchImpl: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }) });
  assert.equal((await empty.get('options', 'SPY')).code, 'massive_options_empty');
});
