'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOrderFlowService } = require('./academy-order-flow-service');
const { createOrderFlowStore } = require('./academy-order-flow-store');

function levels(b1, sizes, dir) { return sizes.map((size, i) => ({ level: i + 1, orders: 0, price: +(b1 + dir * i * 0.01).toFixed(2), size })); }
const bookJson = (t, o = {}) => ({ available: true, asof: t, book: { bids: levels(100, o.bid || [500, 400, 300, 250, 200, 200, 150, 150, 100, 100], -1), asks: levels(100.01, o.ask || [500, 400, 300, 250, 200, 200, 150, 150, 100, 100], 1) }, ticks: o.ticks || [] });

function harness(extra = {}) {
  let clock = 1_800_000_000_000; const calls = []; const recorded = []; const outcomes = [];
  let responder = (symbol, n) => ({ ok: true, json: async () => bookJson(clock, { ticks: [] }) });
  const store = { recordEvent: async (e) => { recorded.push(e); return recorded.length; }, recordOutcome: async (id, pct) => { outcomes.push([id, pct]); } };
  const svc = createOrderFlowService({ origin: 'https://example.test', now: () => clock, store, pollMs: 2500, idleMs: 120000, alwaysOn: ['SPY'], maxSymbols: 3, timers: { setTimeout: () => ({ unref() {} }), clearTimeout() {} },
    fetchImpl: async (url) => { const symbol = new URL(url).searchParams.get('symbol'); calls.push(symbol); return responder(symbol, calls.length); }, ...extra });
  return { svc, calls, recorded, outcomes, advance: (ms) => { clock += ms; }, setResponder: (fn) => { responder = fn; }, now: () => clock };
}

test('rejects bad symbols and keeps the polled set bounded', () => {
  const h = harness();
  assert.throws(() => h.svc.get('../etc'), /invalid_symbol/);
  h.svc.touch('SPY'); h.svc.get('AAPL'); h.svc.get('TSLA');
  assert.equal(h.svc.engines.size, 3);
  h.svc.get('NVDA'); // evicts the least recently viewed non-always-on symbol
  assert.equal(h.svc.engines.size, 3);
  assert.ok(h.svc.engines.has('SPY') && h.svc.engines.has('NVDA'));
});

test('polls each active symbol, builds history, and reports warming then live', async () => {
  const h = harness(); h.svc.start(); h.svc.get('SPY');
  const first = h.svc.get('SPY'); assert.equal(first.ready, false);
  for (let i = 0; i < 14; i++) { h.advance(2600); await h.svc.tick(); }
  const r = h.svc.get('SPY');
  assert.equal(r.ready, true); assert.equal(r.symbol, 'SPY'); assert.ok(r.grades && r.grades.long && r.grades.short);
  assert.ok(h.calls.every((s) => s === 'SPY'));
  h.svc.stop();
});

test('a closed market (no book) is reported as closed and polled slowly', async () => {
  const h = harness(); h.svc.start();
  h.setResponder(() => ({ ok: true, json: async () => ({ available: false, book: { bids: [], asks: [] } }) }));
  h.advance(3000); await h.svc.tick();
  const n = h.calls.length;
  assert.equal(h.svc.get('SPY').closed, true);
  h.advance(3000); await h.svc.tick(); // still inside the closed back-off
  assert.equal(h.calls.length, n);
  h.svc.stop();
});

test('failures back off and are surfaced, and recovery clears them', async () => {
  const h = harness(); h.svc.start();
  h.setResponder(() => ({ ok: false, status: 503, json: async () => ({}) }));
  for (let i = 0; i < 4; i++) { h.advance(70000); await h.svc.tick(); }
  const bad = h.svc.get('SPY'); assert.equal(bad.failing, true);
  h.setResponder(() => ({ ok: true, json: async () => bookJson(h.now()) }));
  h.advance(70000); await h.svc.tick();
  assert.equal(h.svc.get('SPY').failing, false);
  h.svc.stop();
});

test('events are recorded and their 5-minute outcome is filled in with the right sign', async () => {
  const h = harness(); h.svc.start(); h.svc.get('SPY');
  // calm baseline, then bids stack while asks are pulled
  let n = 0;
  h.setResponder(() => { n++; const stack = n > 40; return { ok: true, json: async () => bookJson(h.now(), stack ? { bid: [1200, 900, 700, 250, 200, 200, 150, 150, 100, 100], ask: [120, 100, 90, 250, 200, 200, 150, 150, 100, 100] } : {}) }; });
  for (let i = 0; i < 50; i++) { h.advance(2600); await h.svc.tick(); }
  assert.ok(h.recorded.length >= 1, 'an event was recorded');
  assert.ok(h.recorded.every((e) => ['stack', 'pull', 'absorb', 'iceberg', 'flip'].includes(e.kind) && ['bull', 'bear'].includes(e.side)));
  assert.ok(h.svc.pending.length >= 1);
  h.advance(310000); await h.svc.tick();
  assert.ok(h.outcomes.length >= 1);
  h.svc.stop();
});

test('idle symbols are dropped after two minutes but SPY stays', async () => {
  const h = harness(); h.svc.start(); h.svc.get('AAPL');
  h.advance(130000); await h.svc.tick();
  assert.ok(!h.svc.engines.has('AAPL')); assert.ok(h.svc.engines.has('SPY'));
  h.svc.stop();
});

test('the store validates what it writes and never throws without a database', async () => {
  const q = []; const store = createOrderFlowStore({ pool: { query: async (sql, args) => { q.push([sql, args]); return { rows: [{ id: 7 }], rowCount: 2 }; } } });
  assert.equal(await store.recordEvent({ symbol: 'SPY', ts: 1_800_000_000_000, kind: 'flip', side: 'bull', price: 500.5, strength: 2, score: 40, features: { note: 'x' } }), 7);
  assert.equal(q[0][1][5], 1, 'strength is clamped to 0..1');
  await assert.rejects(store.recordEvent({ symbol: 'sp y', ts: 1, kind: 'flip', side: 'bull' }), /invalid_event/);
  await assert.rejects(store.recordEvent({ symbol: 'SPY', ts: 1, kind: 'drop table', side: 'bull' }), /invalid_event/);
  const none = createOrderFlowStore({});
  assert.equal(await none.recordEvent({ symbol: 'SPY', ts: 1, kind: 'flip', side: 'bull' }), null);
  assert.deepEqual(await none.summary(), []);
});

test('live view: fast polling for a watched symbol, de-duplicated prints, model still fed at its own cadence', async () => {
  const h = harness(); h.svc.start();
  let n = 0;
  h.setResponder(() => { n++; const ticks = [{ id: 'a' + (n % 3), timestamp_ms: h.now() - 200, price: 100 + n * 0.01, size: 100 + n, direction: n % 2 ? 'BUY' : 'SELL' }]; return { ok: true, json: async () => bookJson(h.now(), { ticks }) }; });
  assert.equal(h.svc.live('SPY').ready, false);
  for (let i = 0; i < 6; i++) { h.advance(1050); await h.svc.tick(); }
  const v = h.svc.live('SPY');
  assert.equal(v.ready, true);
  assert.ok(v.book.bids.length && v.book.asks.length);
  assert.ok(v.tape.length >= 1 && v.tape.length <= 30);
  assert.ok(v.tape.every((t, i, a) => !i || a[i - 1].t >= t.t), 'newest first');
  assert.equal(new Set(v.tape.map((t) => t.t + ':' + t.price + ':' + t.size)).size, v.tape.length, 'no duplicate prints');
  assert.ok(n >= 5, 'polled about once a second while watched');
  assert.ok(h.svc.get('SPY').snapshots <= 3, 'the order-flow model is fed at ~2.5s, not every poll');
  assert.throws(() => h.svc.live('../x'), /invalid_symbol/);
  h.svc.stop();
});
