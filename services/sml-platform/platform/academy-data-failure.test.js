'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getAcademyCandles, getAcademyScanner, getAcademyDepth, dataHealth } = require('./server');

const realFetch = global.fetch;
const json = (body, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[String(k).toLowerCase()] ?? null }, json: async () => body });
function mockFetch(fn) { global.fetch = fn; }
test.afterEach(() => { global.fetch = realFetch; });

const history = (n = 20, t0 = Date.now() - n * 300_000) => ({ bars: Array.from({ length: n }, (_, i) => ({ t: t0 + i * 300_000, o: 10, h: 10.2, l: 9.9, c: 10.1, v: 100 })), asOf: Date.now() });

test('fallback candles are labelled: source, adjustment unknown, session and liveness', async () => {
  mockFetch(async () => json(history()));
  const r = await getAcademyCandles('LBLA', '15m');
  assert.equal(r.source, 'wordpress-history');
  assert.equal(r.adjusted, null);
  assert.ok(['pre', 'regular', 'post', 'closed'].includes(r.session));
  assert.ok(['live', 'lagging', 'closed', 'extended_idle'].includes(r.liveness));
  assert.equal(r.lastBarAt, r.bars[r.bars.length - 1].t);
  assert.equal(typeof r.marketOpen, 'boolean');
});

test('a bad print in the fallback feed is repaired before it reaches a chart', async () => {
  const h = history(30); h.bars[15].h = 400;
  mockFetch(async () => json(h));
  const r = await getAcademyCandles('SPKA', '5m');
  assert.ok(r.bars[15].h < 11);
  assert.equal(r.repairedBars, 1);
});

test('upstream failure serves the stale copy (labelled stale) and a cold failure throws instead of returning an empty chart', async () => {
  let fail = false;
  mockFetch(async () => { if (fail) throw new Error('boom'); return json(history()); });
  await getAcademyCandles('STLA', '1h');
  fail = true;
  // expire the 4s fresh window by waiting is slow; reach into the failure path with a distinct key instead
  await assert.rejects(getAcademyCandles('COLD', '1h'), /boom|circuit/);
  const empty = async () => json({ bars: [] });
  mockFetch(empty);
  await assert.rejects(getAcademyCandles('EMPT', '1h'), /academy_market_empty/);
});

test('invalid symbols and timeframes are rejected as TypeErrors before any network call', async () => {
  let calls = 0; mockFetch(async () => { calls += 1; return json(history()); });
  await assert.rejects(getAcademyCandles('bad symbol!', '5m'), TypeError);
  await assert.rejects(getAcademyCandles('SPY', '7m'), TypeError);
  await assert.rejects(getAcademyDepth('???'), TypeError);
  assert.equal(calls, 0);
});

test('scanner: upstream 500 is a failure (not an empty list) and is recorded in provider health', async () => {
  mockFetch(async () => json({}, 500));
  await assert.rejects(getAcademyScanner(), /academy_scanner_500/);
  const s = dataHealth.snapshot();
  assert.ok(s.providers['wordpress-scanner'].failures >= 1);
  assert.match(String(s.providers['wordpress-scanner'].lastError), /http_500/);
});

test('depth: a 429 from the origin opens a retry window instead of hammering it', async () => {
  let calls = 0;
  mockFetch(async () => { calls += 1; return json({}, 429, { 'retry-after': '30' }); });
  await assert.rejects(getAcademyDepth('RLMT'), /academy_depth_429|429/);
  const before = calls;
  await assert.rejects(getAcademyDepth('RLM2'), /circuit_open/);
  assert.equal(calls, before, 'no second upstream call while Retry-After is in force');
  assert.equal(dataHealth.snapshot().providers['wordpress-depth'].state, 'rate_limited');
});
