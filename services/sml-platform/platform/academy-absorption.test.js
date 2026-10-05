'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { absorptionMeter, classifyTicks } = require('./academy-absorption');

const NOW = 1_000_000_000_000;
// builds ticks across `minutes`: price series fn(i) with per-print size, prints evenly spaced
function ticks(n, minutes, priceAt, size = 100) {
  return Array.from({ length: n }, (_, i) => [NOW - minutes * 60_000 + (i * minutes * 60_000) / n, priceAt(i, n), size]);
}
// jittered down/up pattern: many downticks but price ends flat
const flatSelling = (i) => 100 + (i % 2 === 0 ? 0.01 : 0) - (i % 7 === 0 ? 0.01 : 0) + (i % 3 === 0 ? 0 : -0.001);

test('classifies prints by the tick rule', () => {
  const r = classifyTicks([[1, 10, 5], [2, 10.1, 5], [3, 10.0, 5], [4, 10.0, 5]]);
  assert.deepEqual(r.map((x) => x.d), [0, 1, -1, -1]);
});

test('heavy selling that does not move price reads as buyers absorbing', () => {
  // 120 prints: sell-side ticks dominate (more down-ticks), but price ends where it started
  const arr = []; let p = 100;
  for (let i = 0; i < 120; i++) { p = i % 4 === 3 ? p + 0.03 : p - 0.01; arr.push([NOW - 5 * 60_000 + i * 2500, +p.toFixed(3), i % 4 === 3 ? 100 : 300]); }
  const m = absorptionMeter({ ticks: arr, now: NOW, expectedMovePct: 0.002 });
  assert.equal(m.available, true);
  assert.ok(m.score > 25, 'buyers absorbing, score ' + m.score);
  assert.match(m.state, /^buyers/);
  assert.match(m.explain, /Aggressive selling dominated/);
});

test('heavy buying that stalls reads as sellers absorbing', () => {
  const arr = []; let p = 100;
  for (let i = 0; i < 120; i++) { p = i % 4 === 3 ? p - 0.03 : p + 0.01; arr.push([NOW - 5 * 60_000 + i * 2500, +p.toFixed(3), i % 4 === 3 ? 100 : 300]); }
  const m = absorptionMeter({ ticks: arr, now: NOW, expectedMovePct: 0.002 });
  assert.ok(m.score < -25, 'sellers absorbing, score ' + m.score);
  assert.match(m.state, /^sellers/);
});

test('a clean trend (price follows the aggressors) is not absorption', () => {
  const m = absorptionMeter({ ticks: ticks(120, 5, (i) => 100 + i * 0.02), now: NOW, expectedMovePct: 0.002 });
  assert.ok(Math.abs(m.score) < 25, 'trend, score ' + m.score);
  assert.equal(m.state, 'none');
});

test('too few prints is reported, never a made-up number', () => {
  const m = absorptionMeter({ ticks: ticks(5, 5, () => 100), now: NOW });
  assert.equal(m.available, false); assert.equal(m.reason, 'too_few_prints');
  assert.equal(absorptionMeter({ ticks: null, now: NOW }).available, false);
});

test('order-book absorption alone is enough, and blends with the tape when both exist', () => {
  const l2only = absorptionMeter({ ticks: [], now: NOW, flow: { ready: true, absorption: { state: 'buy', strength: 0.8, buyVol: 5000, sellVol: 900 } } });
  assert.equal(l2only.available, true); assert.ok(l2only.score >= 55); assert.equal(l2only.state, 'buyers_absorbing');
  const arr = []; let p = 100;
  for (let i = 0; i < 120; i++) { p = i % 4 === 3 ? p + 0.03 : p - 0.01; arr.push([NOW - 5 * 60_000 + i * 2500, +p.toFixed(3), i % 4 === 3 ? 100 : 300]); }
  const both = absorptionMeter({ ticks: arr, now: NOW, expectedMovePct: 0.002, flow: { ready: true, absorption: { state: 'buy', strength: 0.9 } } });
  assert.equal(both.agreement, true);
  const conflict = absorptionMeter({ ticks: arr, now: NOW, expectedMovePct: 0.002, flow: { ready: true, absorption: { state: 'sell', strength: 0.9 } } });
  assert.equal(conflict.agreement, false);
});

test('recorded outcomes are attached only when enough were measured', () => {
  const arr = []; let p = 100;
  for (let i = 0; i < 120; i++) { p = i % 4 === 3 ? p + 0.03 : p - 0.01; arr.push([NOW - 5 * 60_000 + i * 2500, +p.toFixed(3), i % 4 === 3 ? 100 : 300]); }
  const good = absorptionMeter({ ticks: arr, now: NOW, expectedMovePct: 0.002, history: [{ kind: 'absorb', side: 'bull', events: 60, measured: 55, avg_pct: 0.031, hit_rate: 0.58 }] });
  assert.deepEqual(good.history, { signals: 60, measured: 55, hitRatePct: 58, avgMoveAfter5mPct: 0.031 });
  const thin = absorptionMeter({ ticks: arr, now: NOW, expectedMovePct: 0.002, history: [{ kind: 'absorb', side: 'bull', events: 5, measured: 4, avg_pct: 0.1, hit_rate: 1 }] });
  assert.equal(thin.history, undefined);
});
