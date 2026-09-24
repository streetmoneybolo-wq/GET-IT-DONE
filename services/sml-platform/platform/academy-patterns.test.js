'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./academy-patterns');

/* ---------- deterministic generators ---------- */
function rngFn(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) { return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); }

// piecewise-linear closes through [index, price] waypoints, with noise and wicks
function pathBars(wps, seed, o) {
  const opt = Object.assign({ nz: 0.2, wk: 0.45 }, o || {});
  const r = rngFn(seed), n = wps[wps.length - 1][0] + 1, bars = [];
  let seg = 0, prev = wps[0][1];
  for (let i = 0; i < n; i++) {
    while (seg < wps.length - 2 && i > wps[seg + 1][0]) seg++;
    const [i0, p0] = wps[seg], [i1, p1] = wps[seg + 1];
    const tgt = p0 + (p1 - p0) * ((i - i0) / (i1 - i0));
    const c = i === n - 1 ? tgt : tgt + opt.nz * gauss(r);
    const oo = i === 0 ? tgt : prev;
    const h = Math.max(oo, c) + opt.wk * (0.3 + r()), l = Math.min(oo, c) - opt.wk * (0.3 + r());
    bars.push({ t: 1700000000000 + i * 60000, o: oo, h, l, c, v: 1000 + Math.round(200 * r()) });
    prev = c;
  }
  return bars;
}
function flip(bars, ref) {
  const R = ref || 200;
  return bars.map(b => ({ t: b.t, o: R - b.o, h: R - b.l, l: R - b.h, c: R - b.c, v: b.v }));
}
function trendBars(n, start, step, seed) {
  const r = rngFn(seed), bars = [];
  let prev = start;
  for (let i = 0; i < n; i++) {
    const c = start + step * (i + 1) + 0.12 * gauss(r), o = prev;
    bars.push({ t: 1700000000000 + i * 60000, o, h: Math.max(o, c) + 0.2 + 0.15 * r(), l: Math.min(o, c) - 0.2 - 0.15 * r(), c, v: 1000 });
    prev = c;
  }
  return bars;
}
const B = (o, c, h, l, i) => ({ t: 1700000000000 + (i || 0) * 60000, o, h, l, c, v: 1000 });
function lastAtr(bars) { const a = P.atr(bars, 14); return a[a.length - 1]; }
// scenario: context trend then pattern bars built from (p, u); mirror flips the pattern bars around p
function scen(ctx, builder, mirror) {
  const step = ctx === 'down' ? -0.7 : ctx === 'up' ? 0.7 : 0;
  const bars = trendBars(24, 100, step, 7 + (ctx === 'up' ? 1 : 0));
  const p = bars[bars.length - 1].c, u = lastAtr(bars);
  let add = builder(p, u);
  if (mirror) add = add.map(b => ({ o: 2 * p - b.o, c: 2 * p - b.c, h: 2 * p - b.l, l: 2 * p - b.h }));
  add.forEach((b, k) => bars.push({ t: 1700000000000 + (bars.length) * 60000, o: b.o, h: b.h, l: b.l, c: b.c, v: 1000 }));
  return bars;
}
function candleAt(bars, name) {
  const res = P.detect(bars);
  return { res, hit: res.candles.find(k => k.name === name && k.i === bars.length - 1) };
}
function chartOf(bars, type, opts) {
  const res = P.detect(bars, opts);
  return { res, hit: res.charts.find(c => c.type === type) };
}

/* ---------- candlestick builders (bullish-context shapes; u = ATR) ---------- */
const bd = {
  doji: (p, u) => [B(p, p + 0.02 * u, p + 0.4 * u, p - 0.35 * u)],
  longLegged: (p, u) => [B(p, p + 0.02 * u, p + 0.8 * u, p - 0.8 * u)],
  dragonfly: (p, u) => [B(p, p + 0.02 * u, p + 0.05 * u, p - 1.0 * u)],
  gravestone: (p, u) => [B(p, p - 0.02 * u, p + 1.0 * u, p - 0.05 * u)],
  hammer: (p, u) => [B(p - 0.2 * u, p + 0.1 * u, p + 0.15 * u, p - 1.4 * u)],
  inverted: (p, u) => [B(p - 0.1 * u, p + 0.2 * u, p + 1.3 * u, p - 0.15 * u)],
  marubozu: (p, u) => [B(p, p + 1.6 * u, p + 1.62 * u, p - 0.02 * u)],
  spinning: (p, u) => [B(p, p + 0.2 * u, p + 0.6 * u, p - 0.6 * u)],
  engulf: (p, u) => [B(p, p - 0.7 * u, p + 0.05 * u, p - 0.75 * u), B(p - 0.9 * u, p + 0.3 * u, p + 0.35 * u, p - 0.95 * u)],
  piercing: (p, u) => [B(p, p - 1.0 * u, p + 0.05 * u, p - 1.05 * u), B(p - 1.3 * u, p - 0.3 * u, p - 0.25 * u, p - 1.35 * u)],
  harami: (p, u) => [B(p, p - 1.2 * u, p + 0.05 * u, p - 1.25 * u), B(p - 0.85 * u, p - 0.45 * u, p - 0.3 * u, p - 1.0 * u)],
  haramiCross: (p, u) => [B(p, p - 1.2 * u, p + 0.05 * u, p - 1.25 * u), B(p - 0.7 * u, p - 0.68 * u, p - 0.3 * u, p - 1.05 * u)],
  tweezer: (p, u) => [B(p, p - 0.8 * u, p + 0.05 * u, p - 0.85 * u), B(p - 0.9 * u, p - 0.2 * u, p - 0.15 * u, p - 0.85 * u)],
  morning: (p, u) => [B(p, p - 1.2 * u, p + 0.05 * u, p - 1.25 * u), B(p - 1.55 * u, p - 1.65 * u, p - 1.35 * u, p - 1.9 * u), B(p - 1.6 * u, p - 0.4 * u, p - 0.35 * u, p - 1.65 * u)],
  morningDoji: (p, u) => [B(p, p - 1.2 * u, p + 0.05 * u, p - 1.25 * u), B(p - 1.55 * u, p - 1.56 * u, p - 1.3 * u, p - 1.8 * u), B(p - 1.6 * u, p - 0.4 * u, p - 0.35 * u, p - 1.65 * u)],
  soldiers: (p, u) => [B(p, p + 1.0 * u, p + 1.1 * u, p - 0.05 * u), B(p + 0.4 * u, p + 1.4 * u, p + 1.5 * u, p + 0.35 * u), B(p + 0.9 * u, p + 1.9 * u, p + 2.0 * u, p + 0.85 * u)],
  insideUp: (p, u) => [B(p, p - 1.2 * u, p + 0.05 * u, p - 1.25 * u), B(p - 1.0 * u, p - 0.5 * u, p - 0.45 * u, p - 1.05 * u), B(p - 0.5 * u, p + 0.3 * u, p + 0.35 * u, p - 0.55 * u)],
  rising: (p, u) => [B(p, p + 1.5 * u, p + 1.6 * u, p - 0.1 * u), B(p + 1.4 * u, p + 1.1 * u, p + 1.45 * u, p + 1.05 * u), B(p + 1.1 * u, p + 0.8 * u, p + 1.15 * u, p + 0.75 * u), B(p + 0.8 * u, p + 0.6 * u, p + 0.85 * u, p + 0.55 * u), B(p + 0.65 * u, p + 2.0 * u, p + 2.05 * u, p + 0.6 * u)]
};

const CANDLE_CASES = [
  // [expected name, context, builder, mirror, dir]
  ['doji', 'flat', bd.doji, false, 'neutral'],
  ['long_legged_doji', 'flat', bd.longLegged, false, 'neutral'],
  ['dragonfly_doji', 'down', bd.dragonfly, false, 'bull'],
  ['gravestone_doji', 'up', bd.gravestone, false, 'bear'],
  ['hammer', 'down', bd.hammer, false, 'bull'],
  ['hanging_man', 'up', bd.hammer, false, 'bear'],
  ['inverted_hammer', 'down', bd.inverted, false, 'bull'],
  ['shooting_star', 'up', bd.inverted, false, 'bear'],
  ['bullish_marubozu', 'flat', bd.marubozu, false, 'bull'],
  ['bearish_marubozu', 'flat', bd.marubozu, true, 'bear'],
  ['spinning_top', 'flat', bd.spinning, false, 'neutral'],
  ['bullish_engulfing', 'down', bd.engulf, false, 'bull'],
  ['bearish_engulfing', 'up', bd.engulf, true, 'bear'],
  ['piercing_line', 'down', bd.piercing, false, 'bull'],
  ['dark_cloud_cover', 'up', bd.piercing, true, 'bear'],
  ['bullish_harami', 'down', bd.harami, false, 'bull'],
  ['bearish_harami', 'up', bd.harami, true, 'bear'],
  ['bullish_harami_cross', 'down', bd.haramiCross, false, 'bull'],
  ['bearish_harami_cross', 'up', bd.haramiCross, true, 'bear'],
  ['tweezer_bottom', 'down', bd.tweezer, false, 'bull'],
  ['tweezer_top', 'up', bd.tweezer, true, 'bear'],
  ['morning_star', 'down', bd.morning, false, 'bull'],
  ['evening_star', 'up', bd.morning, true, 'bear'],
  ['morning_doji_star', 'down', bd.morningDoji, false, 'bull'],
  ['evening_doji_star', 'up', bd.morningDoji, true, 'bear'],
  ['three_white_soldiers', 'down', bd.soldiers, false, 'bull'],
  ['three_black_crows', 'up', bd.soldiers, true, 'bear'],
  ['three_inside_up', 'down', bd.insideUp, false, 'bull'],
  ['three_inside_down', 'up', bd.insideUp, true, 'bear'],
  ['rising_three_methods', 'up', bd.rising, false, 'bull'],
  ['falling_three_methods', 'down', bd.rising, true, 'bear']
];

for (const [name, ctx, builder, mirror, dir] of CANDLE_CASES) {
  test('candle: ' + name + ' is detected in the right context', () => {
    // tweezer_bottom uses the mirrored tweezer (equal lows, bear then bull) - handled by the case table
    const bars = scen(ctx, builder, mirror);
    const { hit, res } = candleAt(bars, name);
    assert.ok(hit, name + ' expected; got ' + JSON.stringify(res.candles.filter(k => k.i >= bars.length - 5).map(k => k.name + '@' + k.i)));
    assert.equal(hit.dir, dir);
    assert.ok(hit.strength >= 0.3 && hit.strength <= 1);
    assert.ok(hit.bars[1] === bars.length - 1 && hit.bars[0] <= hit.bars[1]);
  });
}

test('candle negatives: reversal shapes need the matching prior trend', () => {
  const n1 = candleAt(scen('up', bd.hammer, false), 'hammer');
  assert.equal(n1.hit, undefined, 'hammer shape in an uptrend must not be a hammer');
  const n2 = candleAt(scen('down', bd.hammer, false), 'hanging_man');
  assert.equal(n2.hit, undefined, 'hammer in a downtrend is not a hanging man');
  const n3 = candleAt(scen('flat', bd.hammer, false), 'hammer');
  assert.equal(n3.hit, undefined, 'no trend, no hammer');
  assert.equal(candleAt(scen('flat', bd.hammer, false), 'hanging_man').hit, undefined);
  assert.equal(candleAt(scen('down', bd.inverted, true), 'shooting_star').hit, undefined);
  assert.equal(candleAt(scen('down', bd.inverted, false), 'shooting_star').hit, undefined);
  assert.equal(candleAt(scen('up', bd.engulf, false), 'bullish_engulfing').hit, undefined);
  assert.equal(candleAt(scen('flat', bd.engulf, false), 'bullish_engulfing').hit, undefined);
  assert.equal(candleAt(scen('flat', bd.morning, false), 'morning_star').hit, undefined);
  assert.equal(candleAt(scen('up', bd.morning, false), 'morning_star').hit, undefined);
  assert.equal(candleAt(scen('up', bd.soldiers, false), 'three_white_soldiers').hit, undefined, 'soldiers after a rally are a continuation blow-off, not a reversal');
  assert.equal(candleAt(scen('flat', bd.piercing, false), 'piercing_line').hit, undefined);
  assert.equal(candleAt(scen('flat', bd.harami, false), 'bullish_harami').hit, undefined);
});

test('candle negatives: tiny noise candles are not dojis or hammers', () => {
  const bars = scen('down', (p, u) => [B(p, p + 0.001 * u, p + 0.05 * u, p - 0.05 * u)], false);
  const res = P.detect(bars);
  assert.equal(res.candles.filter(k => k.i === bars.length - 1).length, 0);
  // small-bodied, small-range candle after a decline: not a hammer
  const b2 = scen('down', (p, u) => [B(p, p + 0.05 * u, p + 0.06 * u, p - 0.3 * u)], false);
  assert.equal(candleAt(b2, 'hammer').hit, undefined);
});

test('candle: engulfing must actually engulf the body', () => {
  const bars = scen('down', (p, u) => [B(p, p - 0.7 * u, p + 0.05 * u, p - 0.75 * u), B(p - 0.6 * u, p - 0.05 * u, p, p - 0.65 * u)], false);
  assert.equal(candleAt(bars, 'bullish_engulfing').hit, undefined);
});

/* ---------- chart fixtures ---------- */
const FX = {
  doubleTop: () => pathBars([[0, 100], [25, 120], [40, 106], [55, 120.3], [82, 100]], 11),
  doubleTopUnequal: () => pathBars([[0, 100], [25, 120], [40, 106], [55, 125], [82, 100]], 11),
  doubleTopForming: () => pathBars([[0, 100], [25, 120], [40, 106], [55, 120.3], [62, 114.6]], 11),
  tripleTop: () => pathBars([[0, 100], [20, 120], [32, 108], [44, 120.2], [56, 108.3], [68, 119.8], [92, 100]], 12),
  tripleTopUneven: () => pathBars([[0, 100], [20, 120], [32, 108], [44, 127], [56, 108.3], [68, 119.8], [92, 100]], 12),
  hs: () => pathBars([[0, 92], [20, 117], [30, 106], [45, 126], [58, 106.5], [72, 117.5], [98, 96]], 13),
  hsAsym: () => pathBars([[0, 92], [20, 117], [30, 106], [45, 126], [58, 106.5], [72, 109], [98, 96]], 13),
  asc: () => pathBars([[0, 100], [15, 120], [26, 108], [37, 120.1], [47, 111], [57, 120], [66, 114], [74, 120.2], [92, 132]], 14),
  sym: () => pathBars([[0, 108], [10, 120], [20, 100], [30, 116], [40, 104], [50, 112], [60, 108], [66, 111], [78, 118]], 15),
  rise: () => pathBars([[0, 100], [13, 112], [22, 103.5], [35, 117.2], [45, 111.6], [56, 122], [66, 119], [71, 122.5], [92, 104]], 16, { nz: 0.1, wk: 0.2 }),
  rect: () => pathBars([[0, 100], [10, 112], [20, 100], [30, 112], [40, 100], [50, 112], [60, 100], [70, 112], [80, 100.2], [90, 106], [98, 120]], 17),
  flag: () => pathBars([[0, 100], [24, 100.5], [32, 118], [46, 115.5], [58, 126]], 18, { nz: 0.3, wk: 0.6 }),
  flagDeep: () => pathBars([[0, 100], [24, 100.5], [32, 118], [46, 106], [58, 126]], 18, { nz: 0.3, wk: 0.6 }),
  pennant: () => pathBars([[0, 100], [24, 100.5], [32, 118], [35, 112.8], [38, 117.4], [41, 114.2], [44, 116.4], [46, 115.2], [48, 115.9], [50, 115.5], [62, 126]], 19, { nz: 0.05, wk: 0.45 })
};

test('chart: double top confirmed with neckline break and measured target', () => {
  const { hit } = chartOf(FX.doubleTop(), 'double_top');
  assert.ok(hit); assert.equal(hit.dir, 'bear'); assert.equal(hit.status, 'confirmed');
  assert.ok(hit.confidence >= 0.5 && hit.confidence <= 1);
  assert.ok(Math.abs(hit.neckline - 106) < 1.5);
  assert.ok(hit.target < hit.neckline && Math.abs(hit.target - (hit.neckline - 14)) < 2);
  assert.equal(hit.points.length, 3);
  assert.ok(hit.invalidation > 120);
  assert.ok(hit.lines.some(l => l.role === 'neckline'));
});
test('chart: double top forming before the neckline breaks', () => {
  const { hit } = chartOf(FX.doubleTopForming(), 'double_top');
  assert.ok(hit); assert.equal(hit.status, 'forming');
});
test('chart: double top with unequal peaks (beyond tolerance) is rejected', () => {
  assert.equal(chartOf(FX.doubleTopUnequal(), 'double_top').hit, undefined);
});
test('chart: double top that is invalidated by a close above the peaks is failed', () => {
  const bars = pathBars([[0, 100], [25, 120], [40, 106], [55, 120.3], [62, 114.6], [75, 123]], 11);
  const res = P.detect(bars, { minConfidence: 0.1 });
  const d = res.charts.find(c => c.type === 'double_top');
  assert.ok(d && d.status === 'failed');
});
test('chart: double bottom (mirror) is bullish', () => {
  const { hit } = chartOf(flip(FX.doubleTop()), 'double_bottom');
  assert.ok(hit); assert.equal(hit.dir, 'bull'); assert.equal(hit.status, 'confirmed');
  assert.ok(hit.target > hit.neckline);
});
test('chart: triple top / triple bottom', () => {
  const t = chartOf(FX.tripleTop(), 'triple_top');
  assert.ok(t.hit && t.hit.dir === 'bear' && t.hit.status === 'confirmed');
  assert.equal(t.hit.points.length, 5);
  assert.equal(t.res.charts.some(c => c.type === 'double_top' && c.startIdx >= t.hit.startIdx && c.endIdx <= t.hit.endIdx), false, 'triple swallows its doubles');
  const b = chartOf(flip(FX.tripleTop()), 'triple_bottom');
  assert.ok(b.hit && b.hit.dir === 'bull');
  assert.equal(chartOf(FX.tripleTopUneven(), 'triple_top').hit, undefined);
});
test('chart: head and shoulders / inverse', () => {
  const t = chartOf(FX.hs(), 'head_and_shoulders');
  assert.ok(t.hit && t.hit.dir === 'bear' && t.hit.status === 'confirmed');
  assert.equal(t.hit.points.length, 5);
  assert.ok(Math.abs(t.hit.neckline - 106.3) < 2.5);
  assert.ok(t.hit.target < t.hit.neckline);
  const b = chartOf(flip(FX.hs()), 'inverse_head_and_shoulders');
  assert.ok(b.hit && b.hit.dir === 'bull' && b.hit.target > b.hit.neckline);
});
test('chart: head and shoulders needs symmetric shoulders', () => {
  assert.equal(chartOf(FX.hsAsym(), 'head_and_shoulders').hit, undefined);
});
test('chart: ascending / descending triangle', () => {
  const a = chartOf(FX.asc(), 'ascending_triangle');
  assert.ok(a.hit && a.hit.dir === 'bull' && a.hit.status === 'confirmed');
  assert.ok(a.hit.lines.some(l => l.role === 'upper') && a.hit.lines.some(l => l.role === 'lower'));
  const up = a.hit.lines.find(l => l.role === 'upper');
  assert.ok(Math.abs(up.p1 - up.p2) < 1.5, 'flat resistance');
  const d = chartOf(flip(FX.asc()), 'descending_triangle');
  assert.ok(d.hit && d.hit.dir === 'bear' && d.hit.status === 'confirmed');
});
test('chart: triangle needs >= 2 touches on each line and >= 5 pivots', () => {
  const cut = FX.asc().slice(0, 49);
  const res = P.detect(cut, { minConfidence: 0.1 });
  assert.equal(res.charts.filter(c => /triangle|wedge|rectangle/.test(c.type)).length, 0);
});
test('chart: symmetrical triangle breaks up and is labelled by its break', () => {
  const { hit } = chartOf(FX.sym(), 'symmetrical_triangle');
  assert.ok(hit); assert.equal(hit.status, 'confirmed'); assert.equal(hit.dir, 'bull');
});
test('chart: rising / falling wedge', () => {
  const r = chartOf(FX.rise(), 'rising_wedge');
  assert.ok(r.hit && r.hit.dir === 'bear' && r.hit.status === 'confirmed');
  const f = chartOf(flip(FX.rise()), 'falling_wedge');
  assert.ok(f.hit && f.hit.dir === 'bull' && f.hit.status === 'confirmed');
  assert.equal(chartOf(FX.rise(), 'falling_wedge').hit, undefined);
});
test('chart: horizontal rectangle range', () => {
  const { hit } = chartOf(FX.rect(), 'rectangle');
  assert.ok(hit); assert.equal(hit.status, 'confirmed'); assert.equal(hit.dir, 'bull');
  assert.ok(hit.confidence >= 0.5);
});
test('chart: bull flag and bear flag', () => {
  const f = chartOf(FX.flag(), 'bull_flag');
  assert.ok(f.hit, JSON.stringify(f.res.charts.map(c => c.type)));
  assert.equal(f.hit.dir, 'bull');
  assert.ok(f.hit.target > f.hit.level);
  const b = chartOf(flip(FX.flag()), 'bear_flag');
  assert.ok(b.hit && b.hit.dir === 'bear');
});
test('chart: a flag that retraces more than half the pole is rejected', () => {
  const res = P.detect(FX.flagDeep(), { minConfidence: 0.1 });
  assert.equal(res.charts.filter(c => /flag|pennant/.test(c.type)).length, 0);
});
test('chart: a small move is not a pole', () => {
  const bars = pathBars([[0, 100], [24, 100.5], [32, 104], [46, 102.8], [58, 106]], 18, { nz: 0.3, wk: 0.6 });
  const res = P.detect(bars, { minConfidence: 0.1 });
  assert.equal(res.charts.filter(c => /flag|pennant/.test(c.type)).length, 0);
});
test('chart: bull pennant / bear pennant', () => {
  const f = chartOf(FX.pennant(), 'bull_pennant');
  assert.ok(f.hit, JSON.stringify(f.res.charts.map(c => c.type)));
  assert.equal(f.hit.dir, 'bull');
  const b = chartOf(flip(FX.pennant()), 'bear_pennant');
  assert.ok(b.hit && b.hit.dir === 'bear');
});

test('levels: repeated turns near one price are clustered with touch counts', () => {
  const bars = pathBars([[0, 100], [10, 110], [20, 100.2], [30, 110.2], [40, 100.1], [50, 109.9], [60, 104]], 21);
  const res = P.detect(bars);
  const top = res.levels.find(l => Math.abs(l.p - 110) < 1.2);
  assert.ok(top && top.touches >= 3 && top.kind === 'resistance');
  const bot = res.levels.find(l => Math.abs(l.p - 100) < 1.2);
  assert.ok(bot && bot.touches >= 3 && bot.kind === 'support');
  assert.ok(res.levels.every(l => l.touches >= 2 && l.lastIdx >= l.firstIdx));
});
test('levels: a single swing is not a level', () => {
  const bars = pathBars([[0, 100], [20, 120], [40, 100]], 22);
  assert.equal(P.detect(bars).levels.filter(l => Math.abs(l.p - 120) < 1).length, 0);
});

test('gaps: gap up unfilled, gap down filled', () => {
  const bars = pathBars([[0, 100], [39, 101], [40, 101]], 23, { nz: 0.1, wk: 0.2 });
  const u = lastAtr(bars);
  // gap up at 41
  const last = bars[bars.length - 1];
  const g1 = { t: last.t + 60000, o: last.c + 6 * u, h: last.c + 6.5 * u, l: last.c + 5.8 * u, c: last.c + 6.1 * u, v: 1000 };
  bars.push(g1);
  for (let i = 0; i < 6; i++) { const p = bars[bars.length - 1]; bars.push({ t: p.t + 60000, o: p.c, h: p.c + 0.3 * u, l: p.c - 0.1 * u, c: p.c + 0.1 * u, v: 1000 }); }
  // gap down then fill
  const q = bars[bars.length - 1];
  const g2i = bars.length;
  bars.push({ t: q.t + 60000, o: q.c - 4 * u, h: q.c - 3.6 * u, l: q.c - 4.4 * u, c: q.c - 4 * u, v: 1000 });
  for (let i = 0; i < 4; i++) { const p = bars[bars.length - 1]; bars.push({ t: p.t + 60000, o: p.c, h: p.c + 2 * u, l: p.c - 0.1 * u, c: p.c + 1.8 * u, v: 1000 }); }
  const res = P.detect(bars);
  const up = res.gaps.find(g => g.dir === 'up'), dn = res.gaps.find(g => g.dir === 'down');
  assert.ok(up && up.i === 41 && up.filled === false && up.to > up.from);
  assert.ok(dn && dn.i === g2i && dn.filled === true);
  assert.equal(P.detect(trendBars(40, 100, 0.3, 3)).gaps.length, 0);
});

/* ---------- contract, robustness ---------- */
test('contract: result shape and index mapping', () => {
  const bars = FX.doubleTop();
  const res = P.detect(bars);
  assert.equal(res.ok, true);
  assert.ok(Number.isFinite(res.atr) && res.atr > 0);
  assert.ok(['up', 'down', 'flat'].includes(res.trend.dir) && res.trend.strength >= 0 && res.trend.strength <= 1);
  for (const c of res.charts) {
    assert.ok(c.confidence >= 0.5 && c.confidence <= 1);
    assert.ok(['forming', 'confirmed', 'failed'].includes(c.status));
    assert.ok(['bull', 'bear', 'neutral'].includes(c.dir));
    assert.ok(c.startIdx >= 0 && c.endIdx <= bars.length - 1 && c.startIdx <= c.endIdx);
    for (const p of c.points) assert.ok(Number.isFinite(p.p) && p.i >= 0 && p.i < bars.length);
    for (const l of c.lines) assert.ok(Number.isFinite(l.p1) && Number.isFinite(l.p2) && l.i2 >= l.i1);
    assert.ok(typeof c.note === 'string' && c.note.length > 0);
  }
  assert.equal(res.count, res.candles.length + res.charts.length);
  assert.ok(Array.isArray(res.summary) && res.summary.length > 0);
});
test('contract: helpers atr and pivots', () => {
  const bars = FX.doubleTop();
  const a = P.atr(bars, 14);
  assert.equal(a.length, bars.length);
  assert.ok(a.every(x => x > 0));
  const pv = P.pivots(bars, { atrMult: 2 });
  assert.ok(pv.length >= 4);
  const highs = pv.filter(p => p.type === 'high' && p.confirmed);
  assert.ok(highs.some(p => Math.abs(p.i - 25) <= 2) && highs.some(p => Math.abs(p.i - 55) <= 2));
  for (let k = 1; k < pv.length; k++) assert.notEqual(pv[k].type, pv[k - 1].type);
});
test('robustness: garbage input never throws and gives ok:false', () => {
  const junk = [undefined, null, 5, 'x', {}, [], [null], [{}], [1, 2, 3], [{ o: NaN, h: NaN, l: NaN, c: NaN }], new Array(50).fill(null),
    new Array(50).fill({ o: 'a', h: 'b', l: 'c', c: 'd' }), new Array(50).fill({ o: -1, h: -1, l: -1, c: -1 }),
    new Array(60).fill({ o: 5, h: 5, l: 5, c: 5, v: 0 }), trendBars(10, 100, 1, 1)];
  for (const j of junk) {
    let r;
    assert.doesNotThrow(() => { r = P.detect(j); });
    assert.equal(typeof r.ok, 'boolean');
    assert.ok(Array.isArray(r.candles) && Array.isArray(r.charts) && Array.isArray(r.levels) && Array.isArray(r.gaps) && Array.isArray(r.summary));
    if (!r.ok) assert.equal(r.count, 0);
  }
  assert.equal(P.detect(null).ok, false);
  assert.equal(P.detect([]).charts.length, 0);
  assert.doesNotThrow(() => P.detect(FX.doubleTop(), { minConfidence: 'x', maxAgeBars: -3 }));
  assert.doesNotThrow(() => { P.atr(null); P.pivots(null); P.atr([{}], 0); P.pivots([{}, {}]); });
  // flat market of identical bars must not hallucinate anything
  const flat = P.detect(new Array(80).fill(0).map((_, i) => ({ t: i, o: 10, h: 10, l: 10, c: 10, v: 5 })));
  assert.equal(flat.charts.length, 0);
});
test('robustness: non-finite bars are ignored and indices refer to the input array', () => {
  const base = FX.doubleTop();
  const clean = P.detect(base).charts.find(c => c.type === 'double_top');
  const shifted = [{ o: NaN, h: 1, l: 1, c: 1 }, null].concat(base);
  const s = P.detect(shifted).charts.find(c => c.type === 'double_top');
  assert.ok(clean && s);
  assert.equal(s.startIdx, clean.startIdx + 2);
  assert.equal(s.endIdx, clean.endIdx + 2);
  assert.deepEqual(s.points.map(p => p.i), clean.points.map(p => p.i + 2));
  // garbage in the middle shifts only later indices
  const mid = base.slice(0, 30).concat([{ o: 'x' }]).concat(base.slice(30));
  const m = P.detect(mid).charts.find(c => c.type === 'double_top');
  assert.ok(m && m.points[2].i === clean.points[2].i + 1 && m.points[0].i === clean.points[0].i);
});
test('determinism: identical input gives identical output', () => {
  const bars = FX.hs();
  assert.equal(JSON.stringify(P.detect(bars)), JSON.stringify(P.detect(bars)));
  const bars2 = FX.hs();
  assert.equal(JSON.stringify(P.detect(bars)), JSON.stringify(P.detect(bars2)));
});
test('options: maxAgeBars drops old unresolved structures and minConfidence filters', () => {
  const dt = pathBars([[0, 100], [25, 120], [40, 106], [55, 120.3], [82, 100], [400, 100.5]], 11, { nz: 0.05, wk: 0.1 });
  // the old confirmed pattern is far outside the recency window
  assert.equal(P.detect(dt, { maxAgeBars: 100 }).charts.filter(c => c.type === 'double_top').length, 0);
  const strict = P.detect(FX.doubleTop(), { minConfidence: 0.99 });
  assert.equal(strict.charts.length, 0);
});
test('speed: 600 bars under 30ms', () => {
  const r = rngFn(5), bars = [];
  let c = 100;
  for (let i = 0; i < 600; i++) { const o = c; c = Math.max(5, c + gauss(r)); bars.push({ t: i, o, h: Math.max(o, c) + Math.abs(gauss(r)) * 0.4, l: Math.min(o, c) - Math.abs(gauss(r)) * 0.4, c, v: 1000 }); }
  P.detect(bars); P.detect(bars);
  let best = Infinity;
  for (let k = 0; k < 7; k++) { const t0 = process.hrtime.bigint(); P.detect(bars); best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6); }
  assert.ok(best < 30, 'best of 7 = ' + best.toFixed(1) + 'ms');
});

test('false positives: 200 random walks of 300 bars stay quiet', () => {
  const N = 200, SERIES = 300;
  let totalCharts = 0, hsTriple = 0, confirmed = 0;
  const byType = {};
  for (let s = 0; s < N; s++) {
    const r = rngFn(1000 + s), bars = [];
    let c = 100;
    for (let i = 0; i < SERIES; i++) {
      const o = c; c = c * (1 + 0.01 * gauss(r));
      bars.push({ t: i, o, h: Math.max(o, c) * (1 + 0.004 * Math.abs(gauss(r))), l: Math.min(o, c) * (1 - 0.004 * Math.abs(gauss(r))), c, v: 1000 + 500 * r() });
    }
    const res = P.detect(bars);
    const ch = res.charts.filter(x => x.confidence >= 0.5);
    totalCharts += ch.length;
    ch.forEach(x => { byType[x.type] = (byType[x.type] || 0) + 1; if (x.status === 'confirmed') confirmed++; });
    if (ch.some(x => x.status === 'confirmed' && /head_and_shoulders|triple_/.test(x.type))) hsTriple++;
  }
  const avg = totalCharts / N;
  if (process.env.SML_PATTERNS_VERBOSE) console.log('FP avg charts/series', avg.toFixed(3), 'hs/triple confirmed rate', (hsTriple / N).toFixed(3), 'confirmed', confirmed, JSON.stringify(byType));
  assert.ok(avg < 1.5, 'avg charts per random series = ' + avg);
  assert.ok(hsTriple / N < 0.03, 'confirmed H&S/triple in ' + hsTriple + ' of ' + N + ' series');
});
