'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMarketGauges, createVixFetcher, changeFromDaily } = require('./market-gauges');

test('day change comes from the last two daily closes', () => {
  assert.deepEqual(changeFromDaily([{ c: 100 }, { c: 101.5 }]), { price: 101.5, changePct: 1.5 });
  assert.equal(changeFromDaily([{ c: 100 }]), null);
  assert.equal(changeFromDaily([{ c: 0 }, { c: 5 }]), null);
  assert.equal(changeFromDaily(null), null);
});

test('gauges combine SPY, QQQ and VIX; a missing VIX entitlement is negatively cached', async () => {
  let t = 1_000, vixCalls = 0;
  const g = createMarketGauges({
    now: () => t,
    candles: async (s) => ({ bars: s === 'SPY' ? [{ c: 500 }, { c: 495 }] : [{ c: 400 }, { c: 404 }] }),
    vix: async () => { vixCalls += 1; return null; }
  });
  const a = await g.get();
  assert.equal(a.spy.changePct, -1); assert.equal(a.qqq.changePct, 1); assert.equal(a.vix, null);
  t += 61_000; await g.get(); t += 61_000; await g.get();
  assert.equal(vixCalls, 1, 'not retried for ten minutes');
  t += 11 * 60_000; await g.get();
  assert.equal(vixCalls, 2);
});

test('a failing candle source degrades to null for that index only', async () => {
  const g = createMarketGauges({ candles: async (s) => { if (s === 'QQQ') throw new Error('x'); return { bars: [{ c: 1 }, { c: 2 }] }; }, vix: async () => ({ level: 19 }) });
  const r = await g.get();
  assert.equal(r.spy.changePct, 100); assert.equal(r.qqq, null); assert.equal(r.vix.level, 19);
});

test('vix fetcher reads the previous close and returns null on refusal or without a key', async () => {
  const ok = createVixFetcher({ apiKey: 'k', fetchImpl: async () => ({ ok: true, json: async () => ({ results: [{ c: 17.4 }] }) }) });
  assert.deepEqual(await ok(), { level: 17.4 });
  const refused = createVixFetcher({ apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 403 }) });
  assert.equal(await refused(), null);
  assert.equal(await createVixFetcher({ apiKey: '' })(), null);
});
