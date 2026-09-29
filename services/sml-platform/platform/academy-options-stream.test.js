'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOptionsStream } = require('./academy-options-stream');

function fakeChain(rows, spot) {
  // shaped like the moomoo chain academy-options-chain.js documents: an object with a spot-ish
  // field findSpot() reads directly, and a contracts array normalize() walks into regardless of
  // where rows sit in the structure.
  return { ok: true, data: { quote: { price: spot }, contracts: rows.map((r) => ({ strike: r.strike, expiration: r.expiry, call: r.call, put: r.put })) } };
}
function events(write) { const out = []; return { write: (event, data) => out.push({ event, data }), out }; }
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('a fresh symbol feed pushes a snapshot immediately, even before any refresh interval fires', () => {
  let calls = 0;
  const fetchChain = async () => { calls += 1; return fakeChain([{ strike: 100, expiry: '2026-10-16', call: { bid: 1, ask: 1.1 }, put: { bid: 0.9, ask: 1 } }], 101); };
  const timers = { setInterval: () => 'timer', clearInterval: () => {} };
  const stream = createOptionsStream({ fetchChain, timers });
  const viewer = events();
  const unsub = stream.subscribe('spy', viewer.write);
  assert.notEqual(unsub, null);
  assert.equal(calls, 1, 'subscribing triggers an immediate fetch, not a wait for the first interval');
  // the snapshot itself only arrives synchronously with rows once the async refresh resolves
  assert.equal(viewer.out[0].event, 'snapshot');
});

test('two viewers of the same symbol share one poll; a third distinct symbol gets its own', async () => {
  const fetched = [];
  const fetchChain = async (symbol) => { fetched.push(symbol); return fakeChain([{ strike: 50, expiry: '2026-11-20', call: {}, put: {} }], 51); };
  let tick; const timers = { setInterval: (fn) => { tick = fn; return 1; }, clearInterval: () => { tick = null; } };
  const stream = createOptionsStream({ fetchChain, timers });
  const a = events(), b = events(), c = events();
  stream.subscribe('SPY', a.write);
  await flush();
  stream.subscribe('spy', b.write); // same symbol, different case
  stream.subscribe('QQQ', c.write);
  await flush();
  assert.deepEqual(fetched, ['SPY', 'QQQ'], 'SPY was fetched once for both viewers; QQQ got its own poll');
  assert.deepEqual(stream.status().map((s) => s.symbol).sort(), ['QQQ', 'SPY']);
});

test('only changed rows and a changed spot are pushed as an update; unchanged refreshes push nothing', async () => {
  let call = 0;
  const fetchChain = async () => {
    call += 1;
    if (call === 1) return fakeChain([{ strike: 100, expiry: '2026-10-16', call: { bid: 1, ask: 1.1 }, put: { bid: 0.9, ask: 1 } }], 101);
    if (call === 2) return fakeChain([{ strike: 100, expiry: '2026-10-16', call: { bid: 1, ask: 1.1 }, put: { bid: 0.9, ask: 1 } }], 101); // identical
    return fakeChain([{ strike: 100, expiry: '2026-10-16', call: { bid: 1.05, ask: 1.15 }, put: { bid: 0.9, ask: 1 } }], 103); // call side + spot moved
  };
  let refresh; const timers = { setInterval: (fn) => { refresh = fn; return 1; }, clearInterval: () => {} };
  const stream = createOptionsStream({ fetchChain, timers });
  const viewer = events();
  stream.subscribe('SPY', viewer.write);
  await flush();
  // an empty snapshot (nothing known yet), then the first refresh's rows arrive as an update — every row is "new" against an empty feed
  assert.deepEqual(viewer.out.map((e) => e.event), ['snapshot', 'update']);

  refresh(); await flush(); // call 2: identical data
  assert.equal(viewer.out.length, 2, 'an unchanged refresh pushes nothing further');

  refresh(); await flush(); // call 3: call side + spot changed
  assert.equal(viewer.out.length, 3);
  const update = viewer.out[2];
  assert.equal(update.event, 'update');
  assert.equal(update.data.spot, 103);
  assert.equal(update.data.rows.length, 1);
  assert.equal(update.data.rows[0].call.bid, 1.05);
});

test('the feed for a symbol stops once its last viewer unsubscribes, and restarts fresh for a new one', async () => {
  let starts = 0;
  const fetchChain = async () => { starts += 1; return fakeChain([{ strike: 10, expiry: '2026-12-18', call: {}, put: {} }], 10); };
  let refresh; const timers = { setInterval: (fn) => { refresh = fn; return 1; }, clearInterval: () => {} };
  const stream = createOptionsStream({ fetchChain, timers });
  const a = events();
  const unsubA = stream.subscribe('IWM', a.write);
  await flush();
  assert.equal(stream.status().length, 1);
  unsubA();
  assert.equal(stream.status().length, 0, 'no viewers left: the feed is gone');

  const b = events();
  stream.subscribe('IWM', b.write);
  await flush();
  assert.equal(b.out[0].event, 'snapshot', 'a fresh feed starts clean, not from stale rows');
});

test('an invalid symbol and a feed at capacity both refuse the subscription instead of throwing', async () => {
  const fetchChain = async () => fakeChain([], null);
  const stream = createOptionsStream({ fetchChain, maxSymbols: 1, timers: { setInterval: () => 1, clearInterval: () => {} } });
  assert.equal(stream.subscribe('not a symbol!', () => {}), null);
  stream.subscribe('AAA', () => {});
  assert.equal(stream.subscribe('BBB', () => {}), null, 'capacity reached: a second distinct symbol is refused');
});

test('a fetch failure is recorded but never thrown, and clears once the provider recovers', async () => {
  let fail = true;
  const fetchChain = async () => (fail ? { ok: false, code: 'provider_unavailable' } : fakeChain([{ strike: 1, expiry: '2027-01-15', call: {}, put: {} }], 1));
  let refresh; const timers = { setInterval: (fn) => { refresh = fn; return 1; }, clearInterval: () => {} };
  const stream = createOptionsStream({ fetchChain, timers });
  stream.subscribe('XYZ', () => {});
  await flush();
  assert.equal(stream.status()[0].error, 'provider_unavailable');
  fail = false;
  refresh(); await flush();
  assert.equal(stream.status()[0].error, null);
});
