'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decide, momentumStop, memberText } = require('./academy-alert-brain');

const strong = { alignment: 0.8, volPct: 5, tech: { relVol: 2.6, aboveVwap: true, breakout: true, rsi: 66, atr: 0.9 }, reads: { day: { dir: 1 }, swing: { dir: 1 }, mid: { dir: 1 }, long: { dir: 0 } }, levels: [{ price: 14.9 }] };
const proposal = { post: true, target: 13.8, pct: 15 };

test('a clean first target hit with momentum intact is RAISE with a wider stop and plain steps', () => {
  const d = decide({ symbol: 'ABCD', entry: 10, price: 12, target: 11.5, highSince: 12.2, updates: 0, channel: 'day', evidence: strong, proposal, market: 0.4, sentiment: 0.3 });
  assert.equal(d.action, 'RAISE');
  assert.equal(d.newTarget, 13.8);
  assert.ok(d.stop && d.stop.level < 12 && d.stop.level >= 10.05, JSON.stringify(d.stop));
  assert.equal(d.stop.fast, true);
  assert.equal(d.stop.k, 3, 'a fast day name gets 3 ATR of room');
  assert.equal(d.steps.length, 3);
  assert.match(d.steps[1], /stop/i);
  const txt = memberText({ decision: d, symbol: 'ABCD', entry: 10, price: 12, target: 11.5, n: 1 });
  assert.match(txt, /PT SMASHED · HOLDING/); assert.match(txt, /WHAT TO DO NOW/); assert.match(txt, /1\. Keep the position/);
});

test('a stretched, late or crowded move trims and raises; the third leg or an exhausted move sells', () => {
  const stretched = { ...strong, tech: { ...strong.tech, rsi: 86 } };
  const d1 = decide({ symbol: 'ABCD', entry: 10, price: 13, target: 12.5, highSince: 13.4, updates: 1, channel: 'swing', evidence: stretched, proposal });
  assert.equal(d1.action, 'TRIM_RAISE'); assert.ok([33, 50].includes(d1.trimPct)); assert.match(d1.steps[0], /Sell (33|50)% now/);
  const late = decide({ symbol: 'ABCD', entry: 10, price: 15, target: 14.5, highSince: 15, updates: 3, channel: 'swing', evidence: strong, proposal });
  assert.equal(late.action, 'SELL'); assert.equal(late.trimPct, 100); assert.equal(late.stop, null);
  const gone = decide({ symbol: 'ABCD', entry: 10, price: 11.6, target: 11.5, highSince: 16, updates: 0, channel: 'swing', evidence: { alignment: -0.5, volPct: 4, tech: { relVol: 0.6, aboveVwap: false, rsi: 45 }, reads: {}, levels: [] }, proposal, market: -0.5 });
  assert.equal(gone.action, 'SELL'); assert.ok(gone.warn.some((w) => /gave back|off the high/.test(w)), gone.warn.join(' | '));
  const big = decide({ symbol: 'ABCD', entry: 10, price: 13.5, target: 12, highSince: 13.6, updates: 0, channel: 'day', evidence: strong, proposal });
  assert.equal(big.action, 'TRIM_RAISE', 'a 35% winner on the first leg banks some even with momentum');
});

test('earnings inside two days or a runner exit means take the profit', () => {
  const e = decide({ symbol: 'ABCD', entry: 10, price: 12, target: 11.5, updates: 0, evidence: strong, proposal, earningsDays: 1 });
  assert.equal(e.action, 'SELL'); assert.ok(e.warn.some((w) => /earnings/.test(w)));
  const r = decide({ symbol: 'ABCD', entry: 10, price: 12, target: 11.5, updates: 0, evidence: strong, proposal, runner: { exit: true, exitReason: 'climax candle' } });
  assert.equal(r.action, 'SELL');
  const txt = memberText({ decision: r, symbol: 'ABCD', entry: 10, price: 12, target: 11.5, n: 2 });
  assert.match(txt, /TAKE PROFITS/); assert.match(txt, /Sell the whole position/);
});

test('momentum stops are wide, never under breakeven once 10% up, and never lowered', () => {
  const s = momentumStop({ entry: 10, price: 12, highSince: 12.5, atr: 0.5, volPct: 5, relVol: 2.5, channel: 'day' });
  assert.equal(s.k, 3); assert.ok(s.level <= 11.0 && s.level >= 10.05, JSON.stringify(s));
  const be = momentumStop({ entry: 10, price: 11.2, highSince: 11.3, atr: 1.2, volPct: 9, relVol: 3, channel: 'day' });
  assert.ok(be.level >= 10.05, 'breakeven floor: ' + be.level);
  const kept = momentumStop({ entry: 10, price: 12, highSince: 12.5, atr: 0.5, volPct: 5, relVol: 2.5, channel: 'day', prevStop: 11.5 });
  assert.equal(kept.level, 11.5);
  const tooClose = momentumStop({ entry: 10, price: 12, highSince: 12.01, atr: 0.01, volPct: 1, relVol: 1, channel: 'swing' });
  assert.ok(tooClose.level <= 12 * 0.985 + 1e-9, 'never within 1.5% of the price');
  const short = momentumStop({ side: 'short', entry: 10, price: 8, highSince: 7.8, atr: 0.4, volPct: 5, relVol: 2.5, channel: 'swing' });
  assert.ok(short.level > 8 && short.level <= 9.95);
});
