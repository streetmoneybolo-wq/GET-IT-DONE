'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMassiveHistory, createMassiveOptions } = require('./market-data-service');
const { createDataHealth } = require('./data-health');
const { sanitizeBars } = require('./data-quality');

const json = (body, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[String(k).toLowerCase()] ?? null }, json: async () => body });

test('massive candles are labelled adjusted with the last bar time, and bad bars are repaired', async () => {
  const results = Array.from({ length: 12 }, (_, i) => ({ t: 1_000 + i * 60_000, o: 10, h: 10.1, l: 9.9, c: 10, v: 5 }));
  results[5].h = 40;
  const hist = createMassiveHistory({ apiKey: 'k', fetchImpl: async () => json({ results }), sanitize: (b, tf) => sanitizeBars(b, tf) });
  const r = await hist.get('SPY', '1m');
  assert.equal(r.data.adjusted, true);
  assert.equal(r.data.lastBarAt, results[11].t);
  assert.equal(r.data.repairedBars, 1);
  assert.ok(r.data.bars[5].h < 11);
});

test('a failing provider serves the stale copy and then reports unavailable, never an empty chart', async () => {
  let now = 1_000_000, fail = false;
  const results = [{ t: 1, o: 1, h: 2, l: 1, c: 1.5, v: 1 }];
  const hist = createMassiveHistory({ apiKey: 'k', now: () => now, fetchImpl: async () => { if (fail) throw new Error('down'); return json({ results }); } });
  assert.equal((await hist.get('SPY', '5m')).ok, true);
  fail = true; now += 60_000;
  const stale = await hist.get('SPY', '5m');
  assert.equal(stale.ok, true); assert.equal(stale.data.stale, true);
  now += 7 * 3600_000;
  const gone = await hist.get('SPY', '5m');
  assert.equal(gone.ok, false); assert.equal(gone.code, 'massive_history_unavailable');
});

test('429 from massive trips the breaker, honours Retry-After and recovers', async () => {
  let t = 5_000_000, n = 0;
  const health = createDataHealth({ now: () => t });
  const fetchImpl = (u, o) => health.guardedFetch('massive-rest', u, o, async () => { n += 1; return t < 5_000_000 + 10_000 ? json({}, 429, { 'retry-after': '10' }) : json({ results: [{ t: 1, o: 1, h: 2, l: 1, c: 1.5, v: 1 }] }); });
  const hist = createMassiveHistory({ apiKey: 'k', now: () => t, fetchImpl });
  assert.equal((await hist.get('QQQ', '5m')).ok, false);
  assert.equal(health.snapshot().providers['massive-rest'].state, 'rate_limited');
  const calls = n;
  t += 2_000;
  assert.equal((await hist.get('QQQ', '5m')).ok, false);
  assert.equal(n, calls, 'no upstream call during Retry-After');
  t += 9_000;
  assert.equal((await hist.get('QQQ', '5m')).ok, true);
  assert.equal(health.snapshot().providers['massive-rest'].state, 'ok');
});

test('options snapshot follows next_url across pages, stays on the provider host and reports completeness', async () => {
  const calls = [];
  const page = (n, next) => ({ results: Array.from({ length: 3 }, (_, i) => ({ id: `${n}-${i}` })), ...(next ? { next_url: next } : {}) });
  const fetchImpl = async (url) => {
    calls.push(url);
    if (!url.includes('cursor=')) return json(page(1, 'https://api.massive.com/v3/snapshot/options/SPY?cursor=a'));
    if (url.includes('cursor=a')) return json(page(2, 'https://api.massive.com/v3/snapshot/options/SPY?cursor=b'));
    return json(page(3, ''));
  };
  const opt = createMassiveOptions({ apiKey: 'k', enabled: true, fetchImpl, maxPages: 4 });
  const r = await opt.get('options', 'SPY');
  assert.equal(r.data.pages, 3); assert.equal(r.data.contracts, 9); assert.equal(r.data.complete, true);
  assert.equal(r.data.data.results.length, 9);

  const capped = createMassiveOptions({ apiKey: 'k', enabled: true, fetchImpl, maxPages: 2 });
  const c = await capped.get('options', 'SPY');
  assert.equal(c.data.pages, 2); assert.equal(c.data.complete, false);

  const evil = createMassiveOptions({ apiKey: 'k', enabled: true, maxPages: 4, fetchImpl: async (u) => { calls.push(u); return json(page(1, 'https://evil.example/steal')); } });
  const e = await evil.get('options', 'SPY');
  assert.equal(e.data.pages, 1); assert.equal(e.data.complete, false);
  assert.ok(!calls.some((u) => u.includes('evil.example')), 'never follows a foreign host');
});

test('a later options page failing keeps the pages already fetched and flags the chain incomplete', async () => {
  let n = 0;
  const opt = createMassiveOptions({ apiKey: 'k', enabled: true, maxPages: 4, fetchImpl: async () => { n += 1; return n === 1 ? json({ results: [{ id: 1 }], next_url: 'https://api.massive.com/x?cursor=1' }) : json({}, 500); } });
  const r = await opt.get('options', 'SPY');
  assert.equal(r.ok, true); assert.equal(r.data.complete, false); assert.equal(r.data.contracts, 1);
});

test('options paging never follows a downgraded (http) next_url on the provider host', async () => {
  const calls = [];
  const opt = createMassiveOptions({ apiKey: 'k', enabled: true, maxPages: 4, fetchImpl: async (u) => { calls.push(u); return json({ results: [{ id: 1 }], next_url: 'http://api.massive.com/v3/snapshot/options/SPY?cursor=x' }); } });
  const r = await opt.get('options', 'SPY');
  assert.equal(r.data.pages, 1); assert.equal(r.data.complete, false);
  assert.ok(calls.every((u) => u.startsWith('https://')));
});
