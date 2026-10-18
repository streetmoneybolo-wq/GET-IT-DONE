'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDepthRecorder, parseSymbols, cleanSide } = require('./academy-depth-recorder');

function levels(p1, n, dir, size = 100) { return Array.from({ length: n }, (_, i) => ({ level: i + 1, orders: 3, price: +(p1 + dir * i * 0.01).toFixed(2), size: size + i })); }
const book = (t, o = {}) => ({ available: true, asof: t, book: { bids: levels(100, o.depth || 60, -1, o.bidSize), asks: levels(100.01, o.depth || 60, 1, o.askSize) }, ticks: o.ticks || [] });

function harness(extra = {}) {
  let clock = 1_800_000_000_000; const calls = []; const rows = []; let prunes = 0;
  let responder = (symbol) => ({ ok: true, json: async () => book(clock) });
  const store = { configured: true, append: async (row) => { rows.push(row); return rows.length; }, prune: async () => { prunes += 1; return 0; } };
  const rec = createDepthRecorder({
    origin: 'https://example.test', store, now: () => clock, symbols: ['SPY', 'QQQ'], pollMs: 2500, levels: 60, timers: { setTimeout: () => ({ unref() {} }), clearTimeout() {} },
    fetchImpl: async (url) => { const u = new URL(url); calls.push([u.searchParams.get('symbol'), u.searchParams.get('depth')]); return responder(u.searchParams.get('symbol')); }, ...extra
  });
  return { rec, calls, rows, advance: (ms) => { clock += ms; }, setResponder: (fn) => { responder = fn; }, prunes: () => prunes };
}

test('parses the symbol list and cleans a side', () => {
  assert.deepEqual(parseSymbols(' spy, qqq ,bad symbol!,SPY'), ['SPY', 'QQQ']);
  assert.deepEqual(parseSymbols(''), ['SPY', 'QQQ']);
  assert.deepEqual(cleanSide([{ price: '100.5', size: 10, orders: 2 }, { price: 101, size: 5 }, { price: 'x', size: 1 }], true), [[101, 5, 0], [100.5, 10, 2]]);
});

test('asks the bridge for the full book and stores one row per symbol', async () => {
  const h = harness(); h.rec.start();
  const r = await h.rec.tick();
  assert.deepEqual(r.map((x) => [x.symbol, x.stored, x.depth]), [['SPY', true, 60], ['QQQ', true, 60]]);
  assert.deepEqual(h.calls, [['SPY', '60'], ['QQQ', '60']]);
  const row = h.rows[0];
  assert.equal(row.bids.length, 60); assert.equal(row.bids[0][0], 100); assert.equal(row.asks[0][0], 100.01);
  assert.equal(row.bidSize10, (100 + 109) * 10 / 2); assert.equal(row.bidSizeAll, (100 + 159) * 60 / 2);
  assert.deepEqual(row.bids[0], [100, 100, 3]); // price, size, order count
  h.rec.stop();
});

test('skips an unchanged book and keeps rows strictly ordered in time', async () => {
  const h = harness();
  await h.rec.tick();
  h.advance(2500); const r2 = await h.rec.tick();
  assert.deepEqual(r2.map((x) => x.reason), ['unchanged', 'unchanged']);
  assert.equal(h.rows.length, 2);
  // the bridge's "as of" stays the same but the book changed: the row still gets a later timestamp
  h.setResponder(() => ({ ok: true, json: async () => book(1_800_000_000_000, { bidSize: 500 }) }));
  await h.rec.tick();
  assert.equal(h.rows.length, 4);
  assert.ok(h.rows[2].t > h.rows[0].t);
});

test('new prints are stored once, in time order, and alone trigger a row', async () => {
  const h = harness();
  h.setResponder(() => ({ ok: true, json: async () => book(1_800_000_000_000, { ticks: [{ id: 'b', timestamp_ms: 1_800_000_000_500, price: 100.01, size: 10, direction: 'BUY' }, { id: 'a', timestamp_ms: 1_800_000_000_200, price: 100, size: 5, direction: 'SELL' }] }) }));
  await h.rec.tick();
  assert.deepEqual(h.rows[0].prints, [[1_800_000_000_200, 100, 5, 'S'], [1_800_000_000_500, 100.01, 10, 'B']]);
  h.advance(2500); const r = await h.rec.tick();
  assert.equal(r[0].reason, 'unchanged'); // same book, same prints -> nothing new
  h.setResponder(() => ({ ok: true, json: async () => book(1_800_000_000_000, { ticks: [{ id: 'c', timestamp_ms: 1_800_000_002_000, price: 100.01, size: 7, direction: 'BUY' }] }) }));
  h.advance(2500); const r3 = await h.rec.tick();
  assert.equal(r3[0].stored, true); assert.deepEqual(h.rows[h.rows.length - 1].prints, [[1_800_000_002_000, 100.01, 7, 'B']]);
});

test('closed market, crossed book, fetch and store failures never throw', async () => {
  const h = harness();
  h.setResponder(() => ({ ok: true, json: async () => ({ available: false, book: { bids: [], asks: [] } }) }));
  assert.deepEqual((await h.rec.tick()).map((x) => x.reason), ['closed', 'closed']);
  h.setResponder(() => ({ ok: true, json: async () => ({ available: true, asof: 1, book: { bids: [{ price: 101, size: 1 }], asks: [{ price: 100, size: 1 }] } }) }));
  assert.equal((await h.rec.tick())[0].reason, 'crossed');
  h.setResponder(() => ({ ok: false, status: 503 }));
  assert.equal((await h.rec.tick())[0].reason, 'fetch_failed');
  assert.equal(h.rec.status().perSymbol.SPY.failures, 1);
  assert.match(h.rec.status().perSymbol.SPY.lastError, /depth_503/);
  const failing = harness({ store: { configured: true, append: async () => { throw new Error('db down'); }, prune: async () => 0 } });
  assert.equal((await failing.rec.tick())[0].reason, 'store_failed');
});

test('does not poll while the market is closed, and prunes on its own cadence', async () => {
  let open = false;
  const h = harness({ isMarketOpen: () => open, pruneEveryMs: 10_000 });
  await h.rec.tick();
  assert.equal(h.calls.length, 0);
  assert.equal(h.prunes(), 1); // first tick prunes
  open = true; h.advance(2500); await h.rec.tick();
  assert.equal(h.calls.length, 2);
  assert.equal(h.prunes(), 1);
  h.advance(11_000); await h.rec.tick();
  assert.equal(h.prunes(), 2);
});

test('start refuses without a configured store', () => {
  const h = harness({ store: { configured: false } });
  assert.equal(h.rec.start(), false);
});
