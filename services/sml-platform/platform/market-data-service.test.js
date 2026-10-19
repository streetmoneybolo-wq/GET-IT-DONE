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

test('the history cache is bounded: a stale copy goes first, then the least recently refreshed, and nothing stays past the cap', async () => {
  let current = 1_800_000_000_000;
  const calls = [];
  const history = createMassiveHistory({ apiKey: 'secret', now: () => current, maxEntries: 3, fetchImpl: async (url) => {
    calls.push(url.match(/ticker\/([A-Z]+)\//)[1]);
    return new Response(JSON.stringify({ results: [{ t: 1000, o: 1, h: 2, l: 1, c: 2, v: 1 }] }), { status: 200 });
  } });
  for (const s of ['AAA', 'BBB', 'CCC']) await history.get(s, '1D');
  current += 1_000;
  await history.get('AAA', '1D'); // fresh: a hit (a hit does not count as a refresh)
  await history.get('DDD', '1D'); // a fourth key: the least recently refreshed (AAA) leaves
  assert.deepEqual(calls, ['AAA', 'BBB', 'CCC', 'DDD']);
  current += 1_000;
  await history.get('CCC', '1D'); await history.get('BBB', '1D');
  assert.equal(calls.length, 4, 'BBB and CCC were kept');
  await history.get('AAA', '1D');
  assert.equal(calls.length, 5, 'AAA had been evicted and is fetched again');
  // a copy past its stale window (six hours) is dropped before a live one
  current += 7 * 3600_000;
  await history.get('EEE', '1D');
  assert.deepEqual(calls.slice(-1), ['EEE']);
  for (const s of ['AAA', 'BBB', 'DDD']) await history.get(s, '1D');
  assert.equal(calls.length, 9, 'every stale copy was gone, so each was fetched afresh');
});

test('the queued source keeps a bounded number of answers and last-good copies', async () => {
  let clock = 1_000_000;
  let calls = 0;
  const source = { configured: true, get: async (kind, symbol) => ({ ok: true, status: 200, data: { kind, symbol, call: ++calls, chain: 'x'.repeat(10) } }) };
  const queued = createQueuedDataSource({ source, now: () => clock, minimumIntervalMs: 0, optionsTtlMs: 60_000, staleTtlMs: 300_000, maxEntries: 2, marketOpen: () => true });
  await queued.get('options', 'AAA'); await queued.get('options', 'BBB'); await queued.get('options', 'CCC');
  assert.equal(calls, 3);
  assert.equal((await queued.get('options', 'CCC')).cached, true);
  assert.equal((await queued.get('options', 'BBB')).cached, true, 'the two newest stay');
  await queued.get('options', 'AAA');
  assert.equal(calls, 4, 'the oldest had left the cache');
  // an expired answer leaves ahead of a live one; a last-good copy older than its stale window leaves too
  clock += 61_000;
  await queued.get('options', 'DDD');
  assert.equal(calls, 5);
  assert.equal((await queued.get('options', 'DDD')).cached, true);
  clock += 400_000;
  source.get = async () => ({ ok: false, status: 503, code: 'down' });
  const gone = await queued.get('options', 'DDD', {}, { priority: 'interactive' });
  assert.equal(gone.ok, false, 'no last-good copy survives past the stale window');
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

test('queued options source serves the last good chain, marked stale, while the bridge is failing, and remembers why', async () => {
  let clock = 1_800_000_000_000, fail = false;
  const source = { configured: true, get: async () => (fail
    ? { ok: false, status: 503, code: 'academy_data_unavailable', detail: 'The site did not answer in time.' }
    : { ok: true, status: 200, data: { ok: true, symbol: 'SPY', contracts: 12 } }) };
  const queued = createQueuedDataSource({ source, now: () => clock, minimumIntervalMs: 0, optionsTtlMs: 60_000, staleTtlMs: 2 * 60 * 60_000,
    setTimer: (resolve) => resolve(), marketOpen: () => true });
  const fresh = await queued.get('options', 'SPY');
  assert.equal(fresh.ok, true); assert.equal(fresh.stale, undefined);
  clock += 61_000; fail = true;
  const stale = await queued.get('options', 'SPY');
  assert.equal(stale.ok, true); assert.equal(stale.stale, true); assert.equal(stale.data.stale, true);
  assert.equal(stale.data.asOf, 1_800_000_000_000, 'the chain says when it was really fetched');
  assert.equal(stale.data.contracts, 12);
  assert.equal(queued.lastFailure('options', 'SPY').result.detail, 'The site did not answer in time.');
  assert.equal(queued.lastFailure('options', 'QQQ'), null);
  clock += 3 * 60 * 60_000;
  const gone = await queued.get('options', 'SPY');
  assert.equal(gone.ok, false, 'a chain older than the stale window is not served');
  assert.equal(gone.code, 'academy_data_unavailable');
  fail = false;
  clock += 31 * 60_000; // a background caller waits out the retry window before asking the site again
  const back = await queued.get('options', 'SPY');
  assert.equal(back.ok, true); assert.equal(back.stale, undefined);
  assert.equal(queued.lastFailure('options', 'SPY'), null, 'a good answer clears the remembered failure');
});

test('derived intervals are built from the Massive interval underneath them, aligned to the session', () => {
  const { resampleBars, DERIVED_TIMEFRAMES } = require('./market-data-service');
  const open = Date.UTC(2026, 9, 12, 13, 30); // 9:30 ET on an EDT day
  const m5 = Array.from({ length: 24 }, (_, i) => ({ t: open + i * 300_000, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 10 }));
  const h1 = resampleBars(m5, '1h');
  assert.deepEqual(h1.map((b) => b.t), [open, open + 3_600_000]);
  assert.equal(h1[0].o, 100); assert.equal(h1[0].h, 112); assert.equal(h1[0].l, 99); assert.equal(h1[0].c, 111.5); assert.equal(h1[0].v, 120);
  const m15 = resampleBars(m5, '15m');
  assert.equal(m15.length, 8); assert.equal(m15[1].t, open + 900_000); assert.equal(m15[1].o, 103);
  const m1 = Array.from({ length: 9 }, (_, i) => ({ t: open + i * 60_000, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 }));
  assert.equal(resampleBars(m1, '3m').length, 3);
  assert.equal(DERIVED_TIMEFRAMES['3m'].base, '1m');
  const months = [8, 9, 10, 11].map((m) => ({ t: Date.UTC(2026, m, 1), o: m, h: m + 1, l: m - 1, c: m + 0.5, v: 1 }));
  const q = resampleBars(months, '1Q');
  assert.deepEqual(q.map((b) => b.t), [Date.UTC(2026, 6, 1), Date.UTC(2026, 9, 1)]);
  assert.equal(q[1].o, 9); assert.equal(q[1].c, 11.5); assert.equal(q[1].v, 3);
  assert.deepEqual(resampleBars([{ t: 'x' }], '1h'), []);
  assert.deepEqual(resampleBars(m5, '7m'), []);
});

test('a member waiting on a click goes ahead of background sweeps, and a background sweep does not retry a symbol the site just refused', async () => {
  let clock = 1000;
  const order = [];
  const refuse = new Set(['BAD']);
  const source = { configured: true, get: async (kind, symbol) => { order.push(symbol); return refuse.has(symbol) ? { ok: false, status: 503, code: 'academy_data_unavailable', detail: 'Academy data is temporarily unavailable.' } : { ok: true, status: 200, data: { symbol } }; } };
  const queued = createQueuedDataSource({ source, now: () => clock, minimumIntervalMs: 100, backgroundRetryMs: 30 * 60_000,
    setTimer: (resolve, ms) => { clock += ms; resolve(); }, marketOpen: () => true });
  const a = queued.get('options', 'AAA');            // starts at once
  const b = queued.get('options', 'BBB');            // background, queued
  const c = queued.get('options', 'CCC', {}, { priority: 'interactive' }); // a click: must run before BBB
  await Promise.all([a, b, c]);
  assert.deepEqual(order, ['AAA', 'CCC', 'BBB']);
  const first = await queued.get('options', 'BAD');
  assert.equal(first.ok, false); assert.equal(order.filter((s) => s === 'BAD').length, 1);
  const again = await queued.get('options', 'BAD');
  assert.equal(again.ok, false); assert.equal(again.skipped, true, 'the sweep is answered from the remembered failure');
  assert.equal(order.filter((s) => s === 'BAD').length, 1, 'the site was not asked again');
  const click = await queued.get('options', 'BAD', {}, { priority: 'interactive' });
  assert.equal(click.ok, false); assert.equal(click.skipped, undefined);
  assert.equal(order.filter((s) => s === 'BAD').length, 2, 'a member\'s own click still tries the site');
  clock += 31 * 60_000;
  await queued.get('options', 'BAD');
  assert.equal(order.filter((s) => s === 'BAD').length, 3, 'after the window a sweep tries once more');
});
