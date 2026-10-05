'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSetups, levelsBeyond, gradeOf } = require('./academy-setups');

function series(n, { start = 100, drift = 0.002, wave = 0.02, step = 86_400_000, t0 = Date.parse('2025-01-01T14:30:00Z'), period = 11 } = {}) {
  const out = []; let prev = start;
  for (let i = 0; i < n; i++) {
    const trend = start * Math.exp(drift * i), c = trend * (1 + wave * Math.sin((i * 2 * Math.PI) / period) + 0.004 * Math.sin(i * 1.7));
    const o = prev, h = Math.max(o, c) * (1 + 0.004 + 0.002 * Math.abs(Math.sin(i))), l = Math.min(o, c) * (1 - 0.004 - 0.002 * Math.abs(Math.cos(i)));
    out.push({ t: t0 + i * step, o, h, l, c, v: 1_000_000 + (i % 7) * 100_000 }); prev = c;
  }
  return out;
}
const mk = (dir) => ({
  daily: series(320, { drift: dir * 0.0025 }), weekly: series(130, { drift: dir * 0.012, step: 7 * 86_400_000, period: 9 }),
  m15: series(400, { drift: dir * 0.0006, step: 900_000, period: 17 }), m5: null
});

test('an uptrend produces long setups with entry, stop below, targets above and a positive risk-reward', () => {
  const bars = mk(1), price = bars.daily[bars.daily.length - 1].c;
  const r = buildSetups({ symbol: 'UP', price, bars });
  assert.equal(r.available, true);
  const live = r.cards.filter((c) => c.available && c.side === 'long');
  assert.ok(live.length >= 2, 'at least two long horizons, got ' + r.cards.map((c) => c.horizon + ':' + c.side));
  for (const c of live) {
    assert.ok(c.stop < c.entry, `${c.horizon} stop below entry`);
    assert.ok(c.targets.length >= 1 && c.targets[0].price > c.entry);
    assert.ok(c.riskReward > 0);
    assert.ok(c.score >= 0 && c.score <= 100); assert.match(c.scoreGrade, /^[ABCD]$/);
    assert.match(c.invalidation, /below/);
    assert.ok(c.evidence.length >= 1 && c.evidence[0].label === 'MEM ALGO');
  }
  assert.ok(r.bestFit && r.bestFit.side === 'long');
  assert.match(r.summary, /Best fit/);
  assert.match(r.disclaimer, /Educational/);
});

test('a downtrend produces short setups with stop above entry, a short-selling warning and a defined-risk alternative', () => {
  const bars = mk(-1), price = bars.daily[bars.daily.length - 1].c;
  const r = buildSetups({ symbol: 'DN', price, bars });
  const shorts = r.cards.filter((c) => c.available && c.side === 'short');
  assert.ok(shorts.length >= 1, 'short setups, got ' + r.cards.map((c) => c.horizon + ':' + c.side));
  for (const c of shorts) {
    assert.ok(c.stop > c.entry); assert.ok(c.targets[0].price < c.entry);
    assert.match(c.shortNote, /unlimited upside risk/); assert.match(c.shortNote, /bear put spread/);
    assert.match(c.invalidation, /above/);
  }
  assert.ok(r.bestShort);
});

test('context moves the score and shows up as evidence for or against', () => {
  const bars = mk(1), price = bars.daily[bars.daily.length - 1].c;
  const base = buildSetups({ symbol: 'UP', price, bars });
  const good = buildSetups({ symbol: 'UP', price, bars, flow: { ready: true, bias: 'bullish', score: 60 }, absorption: { available: true, score: 60, state: 'buyers_absorbing', label: 'Buyers are absorbing the selling' }, sentiment: { available: true, score: 0.5, scorePct: 50, label: 'bullish' } });
  const bad = buildSetups({ symbol: 'UP', price, bars, flow: { ready: true, bias: 'bearish', score: -60 }, sentiment: { available: true, score: -0.5, scorePct: -50, label: 'bearish' }, earnings: { daysAway: 1 }, shortData: { avgRatio: 20 } });
  const swing = (r) => r.cards.find((c) => c.horizon === 'swing');
  if (swing(base).side === 'long') {
    assert.ok(swing(good).score >= swing(base).score, 'agreeing context does not lower the score');
    assert.ok(swing(bad).score < swing(base).score, 'disagreeing context lowers it');
    assert.ok(swing(bad).evidence.some((e) => e.label === 'Earnings' && e.tone === 'against'));
    assert.ok(swing(good).evidence.some((e) => e.label === 'Absorption' && e.tone === 'for'));
  }
});

test('missing history and missing price are reported honestly', () => {
  assert.equal(buildSetups({ symbol: 'X', price: 0, bars: {} }).reason, 'no_live_price');
  const none = buildSetups({ symbol: 'X', price: 10, bars: { daily: series(20) } });
  assert.equal(none.available, false); assert.equal(none.reason, 'not_enough_history');
  const partial = buildSetups({ symbol: 'X', price: 100, bars: { daily: series(320, { drift: 0.0025 }) } });
  assert.equal(partial.cards.find((c) => c.horizon === 'long').reason, 'not_enough_history');
  assert.equal(partial.cards.find((c) => c.horizon === 'day').available, false);
});

test('levelsBeyond returns only levels past the entry, nearest first', () => {
  const a = { pivots: { highs: [{ price: 120 }, { price: 105 }, { price: 99 }], lows: [{ price: 90 }, { price: 80 }] }, liquidity: [{ kind: 'EQH', level: 110, takenAt: null }, { kind: 'EQH', level: 130, takenAt: 5 }], structure: { orderBlocks: [] } };
  assert.deepEqual(levelsBeyond(a, 100, 'long').map((l) => l.price), [105, 110, 120]);
  assert.deepEqual(levelsBeyond(a, 100, 'short').map((l) => l.price), [90, 80]);
  assert.equal(levelsBeyond(null, 100, 'long').length, 0);
});

test('grades', () => { assert.deepEqual([80, 65, 50, 10].map(gradeOf), ['A', 'B', 'C', 'D']); });
