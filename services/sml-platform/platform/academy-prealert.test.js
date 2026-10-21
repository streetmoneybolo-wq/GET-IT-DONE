'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./academy-prealert');

function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
function history(seed = 7, start = 20) {
  const r = rng(seed), daily = [], b5 = []; let px = start;
  const lastDay = Date.UTC(2026, 9, 20);
  for (let d = 119; d >= 0; d--) {
    const t = lastDay - d * 86_400_000; const dow = new Date(t).getUTCDay(); if (dow === 0 || dow === 6) continue;
    const o = px, c = px * (1 + (r() - 0.5) * 0.04);
    daily.push({ t, o, h: Math.max(o, c) * (1 + r() * 0.015), l: Math.min(o, c) * (1 - r() * 0.015), c, v: 1e6 }); px = c;
    if (d < 9) { let p = o; for (let k = 0; k < 78; k++) { const t5 = t + (13 * 60 + 30) * 60_000 + k * 300_000; const c5 = p * (1 + (r() - 0.5) * 0.004); b5.push({ t: t5, o: p, h: Math.max(p, c5) * 1.001, l: Math.min(p, c5) * 0.999, c: c5, v: 10_000 + Math.floor(r() * 5000) }); p = c5; } px = p; }
  }
  return { daily, b5, price: daily[daily.length - 1].c };
}
const codes = (r) => r.findings.map((f) => f.code);

test('a clean setup in the regular session is not blocked, and a far first target is flagged with a nearer one suggested', () => {
  const { daily, b5, price } = history();
  const now = Date.UTC(2026, 9, 21, 15, 0); // 11:00 ET
  const near = P.checkAlert({ symbol: 'ABC', side: 'long', entry: price, target: price * 1.014, stop: price * 0.987, price, bars5: b5, daily, horizon: 'swing', now });
  assert.ok(near.ok); assert.notEqual(near.verdict, 'wait');
  assert.ok(codes(near).includes('target_realistic') || codes(near).includes('target_stretched'), 'the target is judged against the stock\'s own history');
  assert.ok(near.suggested && near.suggested.targets.length === 3);
  const far = P.checkAlert({ symbol: 'ABC', side: 'long', entry: price, target: price * 1.2, stop: price * 0.985, price, bars5: b5, daily, horizon: 'swing', now });
  assert.equal(far.verdict, 'wait');
  assert.ok(codes(far).includes('target_unrealistic'));
  const mid = P.checkAlert({ symbol: 'ABC', side: 'long', entry: price, target: price * 1.045, stop: price * 0.987, price, bars5: b5, daily, horizon: 'swing', now });
  assert.ok(['target_unlikely', 'target_stretched', 'target_realistic'].some((c) => codes(mid).includes(c)));
  assert.ok(codes(far).includes('use_first_target') && far.findings.find((f) => f.code === 'use_first_target').text.includes('odds'));
  assert.ok(far.score < near.score);
});

test('wrong-side target and stop, a missing stop and a stop inside the normal movement', () => {
  const { daily, b5, price } = history();
  const now = Date.UTC(2026, 9, 21, 15, 0);
  const wrong = P.checkAlert({ symbol: 'ABC', side: 'long', entry: price, target: price * 0.97, stop: price * 0.98, price, bars5: b5, daily, now });
  assert.equal(wrong.verdict, 'wait'); assert.ok(codes(wrong).includes('target_wrong_side'));
  const badStop = P.checkAlert({ symbol: 'ABC', side: 'long', entry: price, target: price * 1.02, stop: price * 1.01, price, bars5: b5, daily, now });
  assert.equal(badStop.verdict, 'wait'); assert.ok(codes(badStop).includes('stop_wrong_side'));
  const none = P.checkAlert({ symbol: 'ABC', side: 'long', entry: price, target: price * 1.02, price, bars5: b5, daily, now });
  assert.ok(codes(none).includes('no_stop') && none.verdict === 'caution');
  const tight = P.checkAlert({ symbol: 'ABC', side: 'long', entry: price, target: price * 1.03, stop: price * 0.999, price, bars5: b5, daily, now });
  assert.ok(codes(tight).includes('stop_tight'));
  const short = P.checkAlert({ symbol: 'ABC', side: 'short', entry: price, target: price * 0.98, stop: price * 1.012, price, bars5: b5, daily, now });
  assert.ok(!codes(short).includes('target_wrong_side') && !codes(short).includes('stop_wrong_side'), 'a short reads the sides the other way');
});

test('the other tools and the calendar: MEM ALGO against the side, earnings inside two days', () => {
  const { daily, b5, price } = history();
  const now = Date.UTC(2026, 9, 21, 15, 0);
  const r = P.checkAlert({ symbol: 'ABC', side: 'long', entry: price, target: price * 1.015, stop: price * 0.985, price, bars5: b5, daily, alignment: -0.6, earningsDays: 1, now });
  assert.ok(codes(r).includes('against_algo') && codes(r).includes('earnings_soon'));
  assert.equal(r.verdict, 'caution');
});

test('the AHT pattern: an after-hours alert fifteen minutes after the burst, 35% from the close, is a WAIT with the reasons', () => {
  const { daily } = history(3, 1.8);
  const utc = (h, m) => Date.UTC(2026, 9, 20, h + 4, m);
  const bars = [];
  for (let i = 0; i < 80; i++) bars.push({ t: utc(9, 30) + i * 300_000, o: 1.77, h: 1.78, l: 1.76, c: 1.77, v: 200 });
  const px = [2.17, 2.32, 2.39, 2.37];
  px.forEach((c, i) => bars.push({ t: utc(18, 15) + i * 300_000, o: i ? px[i - 1] : 1.93, h: c * 1.02, l: (i ? px[i - 1] : 1.93) * 0.99, c, v: 87_000 }));
  const r = P.checkAlert({ symbol: 'AHT', side: 'long', entry: 2.39, target: 2.85, stop: 2.15, price: 2.39, bars5: bars, daily, horizon: 'day', now: utc(18, 35) });
  assert.equal(r.verdict, 'wait'); assert.ok(codes(r).includes('chase'));
  assert.ok(codes(r).includes('extended_hours') && codes(r).includes('thin'));
  assert.match(r.headline, /^WAIT/);
  assert.equal(r.ignition.state, 'extended');
  // the same alert on the first burst candle is early, not a chase
  const early = P.checkAlert({ symbol: 'AHT', side: 'long', entry: 2.17, target: 2.5, stop: 2.0, price: 2.17, bars5: bars.slice(0, 81), daily, horizon: 'day', now: utc(18, 20) });
  assert.ok(codes(early).includes('fresh_burst')); assert.ok(!codes(early).includes('chase'));
  assert.equal(P.checkAlert({ symbol: 'X' }).ok, false);
});
