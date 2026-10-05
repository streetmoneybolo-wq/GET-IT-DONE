'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTickFilter, classifyTrade, sanitizeBars, annotateCandles } = require('./data-quality');

test('tick filter rejects a lone spike but accepts a confirmed move', () => {
  const f = createTickFilter();
  for (let i = 0; i < 10; i++) assert.equal(f.check('X', { price: 100 + (i % 3) * 0.01 }).ok, true);
  assert.equal(f.check('X', { price: 140 }).ok, false); // lone bad print
  assert.equal(f.check('X', { price: 100.02 }).ok, true); // market never left
  assert.equal(f.check('X', { price: 120 }).ok, false);
  const c = f.check('X', { price: 120.1 }); // second print confirms a real gap
  assert.equal(c.ok, true); assert.equal(c.reason, 'confirmed_move');
  assert.equal(f.check('X', { price: 120.2 }).ok, true);
  assert.ok(f.stats.byReason.spike >= 2);
});

test('tick filter: a print near the live quote is trusted even if far from the median', () => {
  const f = createTickFilter();
  for (let i = 0; i < 6; i++) f.check('X', { price: 50 });
  const r = f.check('X', { price: 58, quote: { bid: 57.9, ask: 58.1, t: 1000 }, t: 1000 });
  assert.equal(r.ok, true);
});

test('tick filter: bad inputs and configured condition codes', () => {
  const f = createTickFilter({ excludeConditions: [37] });
  assert.equal(f.check('X', { price: 0 }).reason, 'bad_price');
  assert.equal(f.check('X', { price: NaN }).reason, 'bad_price');
  assert.equal(f.check('X', { price: 10, size: -5 }).reason, 'bad_size');
  assert.equal(f.check('X', { price: 10, conditions: [12, 37] }).reason, 'excluded_condition');
  assert.equal(f.check('X', { price: 10, conditions: [12] }).ok, true);
});

test('low priced names use the wider jump limit', () => {
  const f = createTickFilter();
  for (let i = 0; i < 6; i++) f.check('PNNY', { price: 0.5 });
  assert.equal(f.check('PNNY', { price: 0.58 }).ok, true); // +16% is normal for a 50c stock
  assert.equal(f.check('PNNY', { price: 0.9 }).ok, false);
});

test('classifyTrade uses the quote only when it is current, else the tick rule', () => {
  const q = { bid: 10, ask: 10.02, t: 1000 };
  assert.deepEqual(classifyTrade(10.02, { quote: q, tradeT: 1500 }), { dir: 'B', rule: 'quote' });
  assert.deepEqual(classifyTrade(10, { quote: q, tradeT: 1500 }), { dir: 'S', rule: 'quote' });
  assert.deepEqual(classifyTrade(10.01, { quote: q, tradeT: 1500 }), { dir: 'N', rule: 'quote' });
  // stale quote (9s old): fall back to tick rule
  assert.deepEqual(classifyTrade(10.05, { quote: q, tradeT: 10000, lastPrice: 10.03 }), { dir: 'B', rule: 'tick' });
  assert.deepEqual(classifyTrade(10.0, { quote: q, tradeT: 10000, lastPrice: 10.03 }), { dir: 'S', rule: 'tick' });
  assert.deepEqual(classifyTrade(10.03, { lastPrice: 10.03, lastDir: 'B' }), { dir: 'B', rule: 'tick' });
  assert.deepEqual(classifyTrade(10.03, {}), { dir: 'N', rule: 'none' });
  // crossed quote is ignored
  assert.equal(classifyTrade(10, { quote: { bid: 11, ask: 10, t: 1 }, tradeT: 1, lastPrice: 9 }).rule, 'tick');
});

test('sanitizeBars drops junk, fixes envelopes and removes a bad-print wick', () => {
  const mk = (t, c, extra = {}) => ({ t, o: c, h: c + 0.1, l: c - 0.1, c, v: 100, ...extra });
  const bars = [];
  for (let i = 0; i < 12; i++) bars.push(mk(1000 + i * 300000, 100 + i * 0.05));
  bars[6] = { ...bars[6], h: 190 }; // bad-print spike wick
  bars.push({ t: bars[11].t, o: 1, h: 1, l: 1, c: 1 }); // duplicate time
  bars.push({ t: 'x', o: 1, h: 1, l: 1, c: 1 }); // junk
  bars.push({ t: 9e9, o: 100, h: 99, l: 101, c: 100 }); // inverted high/low
  const r = sanitizeBars(bars, '5m');
  assert.equal(r.dropped, 2);
  assert.ok(r.bars[6].h < 101, 'spike wick removed');
  const last = r.bars[r.bars.length - 1];
  assert.ok(last.h >= 101 && last.l <= 99, 'envelope repaired');
  assert.ok(r.repaired >= 2);
});

test('sanitizeBars leaves daily bars alone (no wick repair) and keeps good data untouched', () => {
  const bars = Array.from({ length: 10 }, (_, i) => ({ t: i * 86400000 + 1, o: 10, h: i === 5 ? 30 : 10.5, l: 9.5, c: 10, v: 5 }));
  const r = sanitizeBars(bars, '1D');
  assert.equal(r.bars[5].h, 30);
  assert.equal(r.repaired, 0);
});

test('annotateCandles labels source, session and liveness honestly', () => {
  const now = Date.parse('2026-06-10T15:00:00Z'); // regular session
  const fresh = annotateCandles({ tf: '5m', bars: [{ t: now - 240000 }] }, { now, source: 'massive-rest', adjusted: true });
  assert.equal(fresh.liveness, 'live'); assert.equal(fresh.source, 'massive-rest'); assert.equal(fresh.adjusted, true); assert.equal(fresh.session, 'regular');
  const lag = annotateCandles({ tf: '5m', bars: [{ t: now - 3600000 }] }, { now, source: 'wordpress-history' });
  assert.equal(lag.liveness, 'lagging'); assert.equal(lag.adjusted, null);
  const closed = annotateCandles({ tf: '5m', bars: [{ t: now - 3600000 }] }, { now: Date.parse('2026-06-13T15:00:00Z') });
  assert.equal(closed.liveness, 'closed'); assert.equal(closed.marketOpen, false);
  assert.equal(annotateCandles({ tf: '1D', bars: [] }, { now }).lastBarAt, null);
});
