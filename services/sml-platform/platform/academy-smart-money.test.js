'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('./academy-smart-money');

const MIN = 60000;
const T0 = Date.UTC(2026, 8, 21, 14, 0); // 10:00 New York
const bar = (i, o, h, l, c, v = 1000, t = T0 + i * 5 * MIN) => ({ t, o, h, l, c, v });
/* a quiet base so the average range is small and every test move is clearly bigger than noise */
const base = (n = 30, p = 100) => Array.from({ length: n }, (_, i) => bar(i, p, p + 0.3, p - 0.3, p + (i % 2 ? 0.1 : -0.1)));

test('a bullish fair value gap is found, shrinks as price trades into it, and is marked filled when price closes the whole gap', () => {
  const b = base(); const n = b.length;
  b.push(bar(n, 100, 100.4, 99.8, 100.2), bar(n + 1, 100.2, 103, 100.1, 102.8), bar(n + 2, 102.8, 104, 102, 103.5)); // gap between 100.4 (high) and 102 (low)
  let g = S.fairValueGaps(b, S.atrSeries(b)).find((x) => x.dir > 0 && x.i === n + 1);
  assert.ok(g, 'gap found'); assert.equal(g.bottom, 100.4); assert.equal(g.top, 102); assert.equal(g.filledAt, null);
  b.push(bar(n + 3, 103.5, 103.6, 101.2, 101.5)); // dips in, partially
  g = S.fairValueGaps(b, S.atrSeries(b)).find((x) => x.i === n + 1); assert.equal(g.filledAt, null); assert.equal(g.top, 101.2);
  b.push(bar(n + 4, 101.5, 101.6, 100.0, 100.1)); // through the bottom
  g = S.fairValueGaps(b, S.atrSeries(b)).find((x) => x.i === n + 1); assert.equal(g.filledAt, n + 4);
});

test('a bearish gap is the mirror image', () => {
  const b = base(); const n = b.length;
  b.push(bar(n, 100, 100.2, 99.7, 99.8), bar(n + 1, 99.8, 99.9, 97, 97.2), bar(n + 2, 97.2, 98, 96.5, 96.8)); // gap between 99.7 (low) and 98 (high)
  const g = S.fairValueGaps(b, S.atrSeries(b)).find((x) => x.dir < 0 && x.i === n + 1);
  assert.ok(g); assert.equal(g.top, 99.7); assert.equal(g.bottom, 98);
});

test('structure: a close above the last swing high is a break of structure in an uptrend and a change of character after a downtrend', () => {
  // down leg (lower highs, lower lows) then an up leg that takes out the last lower high
  const path = [110, 109, 108, 107, 108, 109, 108, 107, 106, 105, 106, 107, 106, 105, 104, 103, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111];
  const b = path.map((c, i) => bar(i, c - 0.2, c + 0.5, c - 0.5, c));
  const a = S.analyze(base(20, 110).concat(b.map((x, i) => Object.assign({}, x, { t: T0 + (i + 20) * 5 * MIN }))));
  const kinds = a.structure.events.map((e) => e.type + (e.dir > 0 ? '+' : '-'));
  assert.ok(kinds.includes('BOS-'), 'the down leg breaks structure down: ' + kinds.join(','));
  assert.ok(kinds.includes('CHoCH+'), 'the recovery is a change of character: ' + kinds.join(','));
});

test('equal highs are grouped, and a wick through them that closes back under is a liquidity sweep', () => {
  const b = base(24, 100);
  const shape = [100, 101, 102, 103, 104, 103, 102, 101, 102, 103, 104, 103, 102, 101, 100];
  shape.forEach((c, i) => b.push(bar(b.length, c - 0.1, c + (c === 104 ? 0.01 : 0.2), c - 0.3, c)));
  b.push(bar(b.length, 103, 105, 102.8, 103.2), bar(b.length, 103.2, 103.4, 102.9, 103), bar(b.length, 103, 103.3, 102.8, 103.1), bar(b.length, 103.1, 103.3, 102.9, 103.0));
  const liq = S.liquidity(b, S.pivots(b), S.atrSeries(b));
  const eqh = liq.find((l) => l.kind === 'EQH');
  assert.ok(eqh, 'equal highs found'); assert.ok(eqh.count >= 2); assert.ok(eqh.sweptAt != null, 'swept');
});

test('opening gaps are found, sized, and marked filled when price returns to the prior close', () => {
  const day1 = Array.from({ length: 10 }, (_, i) => bar(i, 100, 100.5, 99.5, 100, 1000, Date.UTC(2026, 8, 21, 14, 0) + i * 5 * MIN));
  const day2 = Array.from({ length: 10 }, (_, i) => bar(10 + i, 102 + i * 0.1, 102.5 + i * 0.1, 101.8 + i * 0.1, 102 + i * 0.1, 1000, Date.UTC(2026, 8, 22, 14, 0) + i * 5 * MIN));
  let gaps = S.sessionGaps(day1.concat(day2)); assert.equal(gaps.length, 1);
  assert.equal(gaps[0].dir, 1); assert.ok(Math.abs(gaps[0].pct - 0.02) < 1e-9); assert.equal(gaps[0].filledAt, null);
  const day3 = [bar(20, 102.9, 103, 99.8, 100.1, 1000, Date.UTC(2026, 8, 23, 14, 0))];
  gaps = S.sessionGaps(day1.concat(day2, day3)); assert.equal(gaps.filter((g) => g.filledAt != null).length, 1);
});

test('session VWAP restarts each day and sits at the volume-weighted price', () => {
  const day1 = [bar(0, 100, 101, 99, 100, 1000, Date.UTC(2026, 8, 21, 14, 0)), bar(1, 100, 103, 100, 102, 3000, Date.UTC(2026, 8, 21, 14, 5))];
  const day2 = [bar(2, 200, 201, 199, 200, 500, Date.UTC(2026, 8, 22, 14, 0))];
  const v = S.vwapSeries(day1.concat(day2), { intraday: true });
  assert.ok(Math.abs(v[1].vwap - ((100 * 1000 + (103 + 100 + 102) / 3 * 3000) / 4000)) < 1e-9);
  assert.ok(Math.abs(v[2].vwap - 200) < 1e-9);
});

test('volume profile finds the point of control and a value area that holds 70% of the volume', () => {
  const b = [];
  for (let i = 0; i < 30; i++) b.push(bar(i, 100, 100.5, 99.5, 100, 1000)); // heavy at 100
  for (let i = 0; i < 10; i++) b.push(bar(30 + i, 105, 105.5, 104.5, 105, 100));
  const p = S.volumeProfile(b, 30);
  assert.ok(Math.abs(p.poc - 100) < 0.6, 'poc near 100: ' + p.poc);
  assert.ok(p.vah >= p.poc && p.val <= p.poc);
  assert.ok(p.vah < 105, 'the thin area at 105 is outside the value area');
});

test('heavy volume with no progress is flagged as absorption; heavy volume with a move is a spike', () => {
  const b = base(30);
  b.push(bar(30, 100, 100.15, 99.9, 100.05, 5000)); // 5x volume, tiny range
  b.push(bar(31, 100, 102, 99.9, 101.8, 4000)); // 4x volume, big range
  const f = S.volumeFlags(b, S.atrSeries(b));
  assert.equal(f.find((x) => x.i === 30).kind, 'absorption');
  assert.equal(f.find((x) => x.i === 31).kind, 'spike');
});

test('analyze returns a map and read() turns it into plain sentences; too little data returns null', () => {
  assert.equal(S.analyze(base(10)), null);
  const b = base(60); let px = 100; for (let leg = 0; leg < 6; leg++) { for (let k = 0; k < 5; k++) { px += 0.6; b.push(bar(b.length, px - 0.5, px + 0.2, px - 0.7, px, 1200)); } for (let k = 0; k < 3; k++) { px -= 0.4; b.push(bar(b.length, px + 0.4, px + 0.5, px - 0.2, px, 900)); } }
  const a = S.analyze(b); assert.ok(a && a.n === b.length);
  const lines = S.read(a); assert.ok(lines.length >= 2); assert.ok(lines.every((l) => typeof l.text === 'string' && l.text.length > 10));
});
