'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('./academy-target-engine');
const F = require('./academy-alert-forensics');

/* a deterministic random walk: 120 daily candles and 6 sessions of 5-minute candles (09:30 to 16:00 ET, EDT = UTC-4) */
function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
function makeBars(seed = 7, start = 20) {
  const r = rng(seed), daily = [], b5 = [];
  let px = start;
  const lastDay = Date.UTC(2026, 9, 20);
  for (let d = 119; d >= 0; d--) {
    const t = lastDay - d * 86_400_000; const dow = new Date(t).getUTCDay(); if (dow === 0 || dow === 6) continue;
    const o = px, c = px * (1 + (r() - 0.5) * 0.04), h = Math.max(o, c) * (1 + r() * 0.015), l = Math.min(o, c) * (1 - r() * 0.015);
    daily.push({ t, o, h, l, c, v: 1e6 }); px = c;
    if (d < 9 && dow > 0 && dow < 6) {
      let p = o;
      for (let k = 0; k < 78; k++) { const t5 = t + (13 * 60 + 30) * 60_000 + k * 300_000; const c5 = p * (1 + (r() - 0.5) * 0.004); b5.push({ t: t5, o: p, h: Math.max(p, c5) * 1.001, l: Math.min(p, c5) * 0.999, c: c5, v: 10_000 + Math.floor(r() * 5000) }); p = c5; }
      px = p;
    }
  }
  return { daily, b5 };
}

test('suggestTargets: long and short ladders sit on the right side, ascend away from price, with a stop behind', () => {
  const { daily, b5 } = makeBars();
  for (const horizon of ['swing', 'position']) {
    const price = daily[daily.length - 1].c;
    const long = T.suggestTargets({ symbol: 'ABC', direction: 'long', horizon, price, daily, bars5: b5, now: Date.UTC(2026, 9, 21, 15) });
    const short = T.suggestTargets({ symbol: 'ABC', direction: 'short', horizon, price, daily, bars5: b5, now: Date.UTC(2026, 9, 21, 15) });
    assert.ok(long.ok && short.ok, horizon);
    assert.ok(long.targets[0].price > price && long.targets[1].price > long.targets[0].price && long.targets[2].price > long.targets[1].price);
    assert.ok(long.stop.price < price);
    assert.ok(short.targets[0].price < price && short.targets[1].price < short.targets[0].price && short.targets[2].price < short.targets[1].price);
    assert.ok(short.stop.price > price);
    for (const t of long.targets.concat(short.targets)) assert.ok(t.prob >= 2 && t.prob <= 95 && t.sample > 20);
    assert.ok(long.targets[0].prob >= long.targets[2].prob, 'the nearer target is the likelier one');
  }
});

test('suggestTargets: the day horizon needs 5-minute history and refuses without it; stronger agreement stretches the ladder', () => {
  const { daily } = makeBars();
  assert.equal(T.suggestTargets({ symbol: 'ABC', direction: 'long', horizon: 'day', price: 20, daily, bars5: [] }).reason, 'not_enough_history');
  const { b5 } = makeBars(11);
  const a = T.suggestTargets({ symbol: 'ABC', direction: 'long', horizon: 'swing', price: 20, daily, bars5: b5, align: 0.9, now: Date.UTC(2026, 9, 21, 15) });
  const b = T.suggestTargets({ symbol: 'ABC', direction: 'long', horizon: 'swing', price: 20, daily, bars5: b5, align: -0.9, now: Date.UTC(2026, 9, 21, 15) });
  assert.ok(a.targets[2].pct > b.targets[2].pct, 'agreement stretches, disagreement tightens');
  assert.ok(b.notes.some((n) => /lean against/.test(n)));
});

test('autoDirection: weighs the tools and says whether the lean is clear', () => {
  const up = T.autoDirection({ alignLong: 0.6, alignShort: -0.5, intentSide: 'long', intentStrength: 80, sentiment: 0.3, trend: 1 });
  assert.equal(up.direction, 'long'); assert.ok(up.clear); assert.ok(up.why.length >= 3);
  const down = T.autoDirection({ alignLong: -0.6, alignShort: 0.7, intentSide: 'short', intentStrength: 60, trend: -1 });
  assert.equal(down.direction, 'short');
  assert.equal(T.autoDirection({}).clear, false);
});

test('the learner keeps suggestions, judges them, and moves the quantile levels by predicted against realized', async () => {
  const { daily, b5 } = makeBars();
  let t = Date.UTC(2026, 9, 21, 15);
  const saved = [];
  const store = { read: async () => null, write: async (s) => { saved.push(JSON.parse(JSON.stringify(s))); } };
  // the stock rips straight through every target after the suggestion
  const price = daily[daily.length - 1].c;
  const ripped = [{ t: t + 600_000, o: price, h: price * 1.5, l: price * 0.999, c: price * 1.4, v: 1e5 }];
  const learner = T.createTargetLearner({ store, candles: async (sym, tf) => ({ bars: tf === '5m' ? ripped : daily }), now: () => t });
  const s = T.suggestTargets({ symbol: 'ABC', direction: 'long', horizon: 'swing', price, daily, bars5: b5, now: t });
  const id = await learner.log(s);
  assert.ok(id); assert.equal(await learner.log(s), id, 'the same suggestion in 30 minutes is kept once');
  t += 3_600_000;
  const r = await learner.settle();
  assert.equal(r.settled, 1);
  const sum = learner.summary();
  assert.equal(sum.settled, 1);
  const row = sum.buckets.find((x) => x.bucket === s.bucket);
  assert.deepEqual(row.hitRates, [100, 100, 100]);
  assert.ok(row.quantileShift.every((x) => x < 0), 'targets that were all reached were too near: the levels move down so the next ones are farther');
  assert.ok(saved.length >= 1, 'persisted');
  // the next suggestion in that bucket uses the learned shift and the realized hit rate
  const s2 = T.suggestTargets({ symbol: 'ABC', direction: 'long', horizon: 'swing', price, daily, bars5: b5, learned: learner.learned(), now: t });
  assert.ok(s2.targets[0].pct >= s.targets[0].pct, 'a farther first target after a bucket that always paid');
  assert.equal(s2.sample.learned, 1);
});

test('the learner judges a stopped suggestion as a miss and settles when the horizon runs out', async () => {
  const { daily, b5 } = makeBars();
  let t = Date.UTC(2026, 9, 21, 15);
  const price = daily[daily.length - 1].c;
  const drop = [{ t: t + 600_000, o: price, h: price * 1.0005, l: price * 0.7, c: price * 0.75, v: 1e5 }];
  const learner = T.createTargetLearner({ candles: async (sym, tf) => ({ bars: tf === '5m' ? drop : daily }), now: () => t });
  const s = T.suggestTargets({ symbol: 'ABC', direction: 'long', horizon: 'swing', price, daily, bars5: b5, now: t });
  await learner.log(s); t += 3_600_000;
  await learner.settle();
  const row = learner.summary().buckets[0];
  assert.deepEqual(row.hitRates, [0, 0, 0]); assert.equal(row.stopRate, 100);
  assert.ok(row.quantileShift.every((x) => x > 0), 'targets that missed were too far: the levels move up so the next ones are nearer');
});

test('forensics: the late chase after a volume burst in the after-hours session, and the target hit', () => {
  // prior regular close 1.77 at 15:55 ET; the burst starts 18:15 ET; the alert goes out at 18:30:16 ET; the target trades in the 19:20 candle
  const utc = (h, m) => Date.UTC(2026, 9, 20, h + 4, m);
  const bars = [];
  for (let i = 0; i < 80; i++) bars.push({ t: utc(9, 30) + i * 300_000, o: 1.77, h: 1.78, l: 1.76, c: 1.77, v: 200 });
  const px = [2.17, 2.32, 2.39, 2.37, 2.38, 2.46, 2.55, 2.59, 2.58, 2.58, 2.66, 2.7, 2.77, 2.84];
  px.forEach((c, i) => bars.push({ t: utc(18, 15) + i * 300_000, o: i ? px[i - 1] : 1.93, h: c * 1.02, l: (i ? px[i - 1] : 1.93) * 0.99, c, v: 87_000 + i * 1000 }));
  const daily = Array.from({ length: 20 }, (_, i) => ({ t: Date.UTC(2026, 8, 20) + i * 86_400_000, o: 1.8, h: 1.9, l: 1.7, c: 1.8, v: 5000 }));
  const rep = F.analyzeAlert({ symbol: 'AHT', side: 'long', entry: 2.37, target: 2.85, stop: 2.15, at: Date.UTC(2026, 9, 20, 22, 30, 16), bars5: bars, daily, detectedAt: Date.UTC(2026, 9, 21, 0, 17, 7) });
  assert.ok(rep.ok);
  assert.equal(rep.session, 'post'); assert.equal(rep.priorClose, 1.77); assert.ok(rep.thin);
  assert.equal(rep.ignition.rvol >= 100, true); assert.equal(Math.round(rep.latencyMin), 15);
  assert.ok(rep.runBeforeAlertPct > 30);
  assert.ok(rep.targetHit && !rep.targetHit.stopFirst);
  const codes = rep.lessons.map((l) => l.code);
  for (const c of ['late_alert', 'extended_hours', 'target_hit', 'slow_detection']) assert.ok(codes.includes(c), c);
  assert.equal(rep.features.hit, true); assert.equal(rep.features.session, 'post');
  // the learner keeps it once and counts it in its bands
  const learner = T.createTargetLearner({});
  return learner.ingestAlert('d:1', rep).then(async (first) => { assert.ok(first); assert.equal(await learner.ingestAlert('d:1', rep), false); const s = learner.summary(); assert.equal(s.alertsJudged, 1); assert.ok(s.alertBands.some((b) => b.band === 'latency:15m+' && b.hitRate === 100)); });
});

test('forensics: a stop that traded first is scored stopped, an alert before the burst is early', () => {
  const utc = (h, m) => Date.UTC(2026, 9, 20, h + 4, m);
  const bars = [];
  for (let i = 0; i < 80; i++) bars.push({ t: utc(9, 30) + i * 300_000, o: 10, h: 10.02, l: 9.98, c: 10, v: 20_000 });
  bars.push({ t: utc(16, 0), o: 10, h: 10.1, l: 9.2, c: 9.3, v: 30_000 });
  const rep = F.analyzeAlert({ symbol: 'XYZ', side: 'long', entry: 10, target: 11, stop: 9.5, at: utc(15, 59), bars5: bars, daily: [] });
  assert.ok(rep.ok); assert.equal(rep.stopHit.beforeTarget, true); assert.equal(rep.features.stopFirst, true);
  assert.equal(F.analyzeAlert({ symbol: 'X', entry: 0, at: 1, bars5: [] }).ok, false);
});

test('ignition: the AHT-style burst is read as fresh on its first candle, then extended, then fading', () => {
  const I = require('./academy-ignition');
  const utc = (h, m) => Date.UTC(2026, 9, 20, h + 4, m);
  const bars = [];
  for (let i = 0; i < 80; i++) bars.push({ t: utc(9, 30) + i * 300_000, o: 1.77, h: 1.78, l: 1.76, c: 1.77, v: 200 });
  const px = [2.17, 2.32, 2.39, 2.37, 2.38, 2.46, 2.55, 2.59, 2.58, 2.58, 2.66, 2.7, 2.77, 2.84, 2.74, 2.78, 2.74, 2.79, 2.77, 2.83, 2.97];
  px.forEach((c, i) => bars.push({ t: utc(18, 15) + i * 300_000, o: i ? px[i - 1] : 1.93, h: c * 1.02, l: (i ? px[i - 1] : 1.93) * 0.99, c, v: i < 14 ? 87_000 + i * 1000 : 9_000 }));
  const at = (h, m) => I.read(bars.filter((b) => b.t + 300_000 <= utc(h, m)), { now: utc(h, m) });
  const fresh = at(18, 20);
  assert.equal(fresh.state, 'fresh'); assert.equal(fresh.direction, 'long'); assert.ok(fresh.rvol >= 100); assert.ok(fresh.minutesAgo <= 10);
  assert.equal(at(18, 35).state, 'extended');
  assert.equal(at(19, 55).state, 'fading');
  assert.equal(I.read(bars.slice(0, 60), { now: utc(14, 30) }), null, 'a quiet tape has no ignition');
  // MEM ALGO carries it on intraday candles
  const algo = require('./academy-mem-algo');
  const res = algo.analyze(bars.filter((b) => b.t + 300_000 <= utc(18, 35)), 'day', {}, '5m', { now: utc(18, 35) });
  assert.ok(res.ignition && res.ignition.active);
});
