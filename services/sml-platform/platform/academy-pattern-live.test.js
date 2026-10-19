'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PL = require('./academy-pattern-live');

const pat = (o) => Object.assign({ type: 'ascending_triangle', name: 'Ascending Triangle', dir: 'bull', status: 'forming', confidence: 0.7, startIdx: 60, endIdx: 95, breakIdx: -1, points: [{ i: 60, p: 10, label: 'Low 1' }], lines: [{ i1: 60, p1: 12, i2: 95, p2: 12, role: 'upper' }] }, o);
const bars = (n = 100) => Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000_000 + i * 300_000, o: 10 + (i % 5) * 0.1, h: 10.6 + (i % 5) * 0.1, l: 9.8, c: 10.3 + (i % 3) * 0.1, v: 1000 + i }));

test('rankExamples prefers a confident, still-forming, recent pattern of the same type and direction; failed ones never show', () => {
  const found = [
    { symbol: 'OLD', last: 99, result: { charts: [pat({ confidence: 0.9, status: 'confirmed', endIdx: 40, breakIdx: 42 })] } },
    { symbol: 'LIVE', last: 99, result: { charts: [pat({ confidence: 0.72, status: 'forming', endIdx: 97 })] } },
    { symbol: 'DEAD', last: 99, result: { charts: [pat({ confidence: 0.95, status: 'failed' })] } },
    { symbol: 'FAM', last: 99, result: { charts: [pat({ type: 'symmetrical_triangle', name: 'Symmetrical Triangle', confidence: 0.8, status: 'forming', endIdx: 98 })] } },
    { symbol: 'OTHER', last: 99, result: { charts: [pat({ type: 'double_top', confidence: 0.9 })] } },
    { symbol: 'BEAR', last: 99, result: { charts: [pat({ dir: 'bear', confidence: 0.72, status: 'forming', endIdx: 97 })] } }
  ];
  const r = PL.rankExamples(found, { type: 'ascending_triangle', dir: 'bull' });
  assert.deepEqual(r.map((x) => x.symbol), ['LIVE', 'BEAR', 'OLD', 'FAM']);
  assert.equal(r[0].exact, true); assert.equal(r[3].exact, false);
  assert.ok(r[0].score > r[2].score, 'a live forming pattern beats one that broke 57 bars ago');
});

test('the service scans the universe once per interval with bounded concurrency, caches it, and frames each example', async () => {
  let t = 1_700_000_000_000, calls = 0, peak = 0, inflight = 0;
  const candles = async (sym) => { calls++; inflight++; peak = Math.max(peak, inflight); await new Promise((r) => setTimeout(r, 5)); inflight--; return { bars: bars(sym === 'THIN' ? 10 : 100) }; };
  const scanner = async () => ({ rows: [{ symbol: 'AAA', name: 'Aaa Inc', price: 10.5, changePct: 1.2 }, { symbol: 'BBB', name: 'Bbb', price: 20 }, { symbol: 'THIN', name: 'Thin' }, { symbol: 'ME', name: 'Me' }] });
  const detect = (b) => ({ ok: true, charts: b.length > 50 ? [pat({ confidence: b[0].c > 0 ? 0.75 : 0.5 })] : [] });
  const svc = PL.createPatternLive({ candles, scanner, patterns: { detect }, now: () => t, concurrency: 2, extra: ['SPY'] });
  const r = await svc.examples({ type: 'ascending_triangle', tf: '5m', exclude: 'ME', dir: 'bull' });
  assert.equal(r.ok, true); assert.equal(r.cached, false);
  assert.equal(r.universe, 5); assert.equal(calls, 5, 'every symbol fetched once'); assert.ok(peak <= 2, 'concurrency bounded: ' + peak);
  assert.deepEqual(r.examples.map((e) => e.symbol).sort(), ['AAA', 'BBB', 'SPY'], 'ME excluded, THIN too short');
  const a = r.examples.find((e) => e.symbol === 'AAA');
  assert.equal(a.name, 'Aaa Inc'); assert.equal(a.changePct, 1.2); assert.equal(a.pattern.type, 'ascending_triangle');
  assert.ok(a.bars.length >= 40 && a.bars.length <= 90, 'framed bars ' + a.bars.length);
  assert.equal(a.offset + a.bars.length, 100, 'the frame ends at the last bar');
  assert.ok(a.offset <= 60 - 6, 'the frame starts before the pattern');
  // a second pattern on the same interval reuses the scan
  const r2 = await svc.examples({ type: 'double_top', tf: '5m' });
  assert.equal(r2.cached, true); assert.equal(calls, 5); assert.deepEqual(r2.examples, [], 'no double tops in this universe');
  // after the ttl the interval is scanned again
  t += 130_000;
  const r3 = await svc.examples({ type: 'ascending_triangle', tf: '5m' });
  assert.equal(r3.cached, false); assert.equal(calls, 10);
  assert.equal((await svc.examples({ type: '', tf: '5m' })).ok, false);
});

test('a failing candle source or scanner still answers with what it has', async () => {
  const svc = PL.createPatternLive({ candles: async () => { throw new Error('provider down'); }, scanner: async () => { throw new Error('no scanner'); }, patterns: { detect: () => ({ ok: true, charts: [] }) }, extra: ['SPY'] });
  const r = await svc.examples({ type: 'double_bottom', tf: '1D' });
  assert.equal(r.ok, true); assert.deepEqual(r.examples, []); assert.equal(r.universe, 1); assert.equal(r.scanned, 0);
});

test('a slow scan answers within the wait with a partial result and finishes on the next ask', async () => {
  let t = 1_700_000_000_000; let release = null; const gate = new Promise((r) => { release = r; });
  const candles = async (sym) => { if (sym === 'SLOW') await gate; return { bars: bars(100) }; };
  const scanner = async () => ({ rows: [{ symbol: 'FAST' }, { symbol: 'SLOW' }] });
  const svc = PL.createPatternLive({ candles, scanner, patterns: { detect: () => ({ ok: true, charts: [pat()] }) }, now: () => t, concurrency: 2, maxWaitMs: 50, extra: [] });
  const r1 = await svc.examples({ type: 'ascending_triangle', tf: '5m' });
  assert.equal(r1.partial, true); assert.deepEqual(r1.examples.map((e) => e.symbol), ['FAST']);
  release();
  await new Promise((r) => setTimeout(r, 20));
  const r2 = await svc.examples({ type: 'ascending_triangle', tf: '5m' });
  assert.equal(r2.partial, false); assert.equal(r2.cached, true); assert.deepEqual(r2.examples.map((e) => e.symbol).sort(), ['FAST', 'SLOW']);
});
