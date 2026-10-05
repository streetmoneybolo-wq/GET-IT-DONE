'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDataHealth, parseRetryAfter } = require('./data-health');

function clock(start = 1_000_000) { let t = start; return { now: () => t, tick: (ms) => { t += ms; } }; }
const res = (status, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[String(k).toLowerCase()] ?? null } });

test('parseRetryAfter handles seconds, http dates, junk, and caps', () => {
  assert.equal(parseRetryAfter('7'), 7000);
  assert.equal(parseRetryAfter('99999'), 600000);
  assert.equal(parseRetryAfter('abc'), 0);
  assert.equal(parseRetryAfter(null), 0);
  assert.equal(parseRetryAfter(new Date(1_005_000).toUTCString(), 1_000_000), 5000);
});

test('records successes and reports state ok', async () => {
  const c = clock(), h = createDataHealth({ now: c.now });
  await h.guardedFetch('massive', 'u', {}, async () => res(200));
  const s = h.snapshot();
  assert.equal(s.providers.massive.state, 'ok');
  assert.equal(s.overall, 'ok');
  assert.equal(s.providers.massive.calls, 1);
});

test('opens the circuit after consecutive failures, fails fast, then half-opens', async () => {
  const c = clock(), h = createDataHealth({ now: c.now, failThreshold: 3, openMs: 10_000 });
  let calls = 0;
  const boom = async () => { calls += 1; throw new Error('ECONNRESET'); };
  for (let i = 0; i < 3; i++) await assert.rejects(h.guardedFetch('wp', 'u', {}, boom), /ECONNRESET/);
  assert.equal(h.snapshot().providers.wp.state, 'down');
  await assert.rejects(h.guardedFetch('wp', 'u', {}, boom), (e) => e.code === 'circuit_open' && e.retryInMs > 0);
  assert.equal(calls, 3, 'no upstream call while open');
  c.tick(10_001);
  // trial call succeeds -> closes
  await h.guardedFetch('wp', 'u', {}, async () => res(200));
  assert.equal(h.snapshot().providers.wp.state, 'ok');
  await h.guardedFetch('wp', 'u', {}, async () => res(200));
});

test('a failed half-open trial re-opens with a longer cool-down', async () => {
  const c = clock(), h = createDataHealth({ now: c.now, failThreshold: 1, openMs: 1000, maxOpenMs: 8000 });
  const boom = async () => { throw new Error('x'); };
  await assert.rejects(h.guardedFetch('p', 'u', {}, boom));
  c.tick(1001);
  await assert.rejects(h.guardedFetch('p', 'u', {}, boom)); // trial fails
  assert.ok(h.retryInMs('p') >= 1900, 'cool-down doubled');
});

test('only one trial is let through while half-open', async () => {
  const c = clock(), h = createDataHealth({ now: c.now, failThreshold: 1, openMs: 1000 });
  await assert.rejects(h.guardedFetch('p', 'u', {}, async () => { throw new Error('x'); }));
  c.tick(1001);
  let release; const slow = new Promise((r) => { release = r; });
  const first = h.guardedFetch('p', 'u', {}, async () => { await slow; return res(200); });
  await assert.rejects(h.guardedFetch('p', 'u', {}, async () => res(200)), (e) => e.code === 'circuit_open');
  release(); await first;
});

test('429 honours Retry-After and surfaces rate_limited', async () => {
  const c = clock(), h = createDataHealth({ now: c.now });
  const r = await h.guardedFetch('massive', 'u', {}, async () => res(429, { 'retry-after': '12' }));
  assert.equal(r.status, 429);
  const s = h.snapshot();
  assert.equal(s.providers.massive.state, 'rate_limited');
  assert.equal(s.providers.massive.retryInMs, 12000);
  await assert.rejects(h.guardedFetch('massive', 'u', {}, async () => res(200)), (e) => e.code === 'circuit_open');
  c.tick(12_001);
  await h.guardedFetch('massive', 'u', {}, async () => res(200));
  assert.equal(h.snapshot().providers.massive.state, 'ok');
});

test('401/403 count as failures; plain 404 does not trip the breaker', async () => {
  const c = clock(), h = createDataHealth({ now: c.now, failThreshold: 2 });
  await h.guardedFetch('a', 'u', {}, async () => res(403));
  await h.guardedFetch('a', 'u', {}, async () => res(403));
  assert.equal(h.snapshot().providers.a.state, 'down');
  await h.guardedFetch('b', 'u', {}, async () => res(404));
  await h.guardedFetch('b', 'u', {}, async () => res(404));
  assert.equal(h.snapshot().providers.b.state, 'ok');
});

test('snapshot merges out-of-band providers and overall is the worst state', () => {
  const c = clock(), h = createDataHealth({ now: c.now });
  h.success('x', 5);
  const s = h.snapshot({ websocket: { state: 'down', detail: 'auth failed' } });
  assert.equal(s.overall, 'down');
  assert.equal(s.providers.websocket.detail, 'auth failed');
});

test('expected statuses for a provider (no index entitlement, a delisted symbol) never trip the breaker or show as an outage', async () => {
  const c = clock(), h = createDataHealth({ now: c.now, failThreshold: 2, soft: { 'massive-indices': [401, 403], history: [500] } });
  for (let i = 0; i < 6; i++) await h.guardedFetch('massive-indices', 'u', {}, async () => res(403));
  for (let i = 0; i < 6; i++) await h.guardedFetch('history', 'u', {}, async () => res(500));
  const s = h.snapshot();
  assert.equal(s.providers['massive-indices'].state, 'ok'); assert.equal(s.providers.history.state, 'ok'); assert.equal(s.overall, 'ok');
  // a real failure on a soft provider still counts
  await h.guardedFetch('history', 'u', {}, async () => res(503)); await h.guardedFetch('history', 'u', {}, async () => res(503));
  assert.equal(h.snapshot().providers.history.state, 'down');
});

test('a half-open trial that never reports back expires, so one hung call cannot block a provider forever', async () => {
  const c = clock(), h = createDataHealth({ now: c.now, failThreshold: 1, openMs: 1000, maxOpenMs: 4000 });
  await assert.rejects(h.guardedFetch('p', 'u', {}, async () => { throw new Error('x'); }));
  c.tick(1001);
  h.guardedFetch('p', 'u', {}, () => new Promise(() => {})); // hangs: never resolves
  await assert.rejects(h.guardedFetch('p', 'u', {}, async () => res(200)), (e) => e.code === 'circuit_open');
  c.tick(4001);
  const r = await h.guardedFetch('p', 'u', {}, async () => res(200));
  assert.equal(r.status, 200);
});
