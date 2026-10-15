'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { qualify, trail, trailFor, dayStats, RULES } = require('./academy-runner');

const DAY = 86_400_000;
function daily(n, { start = 10, drift = 0.002, vol = 1_000_000, wick = 0.01, t0 = Date.UTC(2026, 0, 5, 17) } = {}) {
  const out = []; let px = start;
  for (let i = 0; i < n; i++) { const o = px, c = px * (1 + drift + Math.sin(i / 5) * 0.01); out.push({ t: t0 + i * DAY, o, h: Math.max(o, c) * (1 + wick), l: Math.min(o, c) * (1 - wick), c, v: vol }); px = c; }
  return out;
}
/* a runner day: opens near the prior close, grinds up all session, heavy volume, closes at the high */
function runnerDay(prevClose, { mult = 1.6, vol = 4_000_000, t0 = Date.UTC(2026, 1, 2, 14, 30) } = {}) {
  const out = []; const n = 78; let px = prevClose * 1.02;
  for (let i = 0; i < n; i++) { const o = px, c = prevClose * 1.02 + (prevClose * (mult - 1.02)) * ((i + 1) / n); out.push({ t: t0 + i * 5 * 60_000, o, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, c, v: vol / n }); px = c; }
  return out;
}
function fadeDay(prevClose, { t0 = Date.UTC(2026, 1, 2, 14, 30) } = {}) {
  const out = []; const n = 78; let px = prevClose * 1.25;
  for (let i = 0; i < n; i++) { const o = px, c = prevClose * 1.25 - prevClose * 0.22 * ((i + 1) / n); out.push({ t: t0 + i * 5 * 60_000, o, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, c, v: 100_000 }); px = c; }
  return out;
}

test('a strong, high-volume breakout day qualifies as a runner with a partial sale and an overnight stop', () => {
  const hist = daily(60);
  const prev = hist[hist.length - 1].c;
  const day = runnerDay(prev);
  const q = qualify({ intraday: day, daily: hist, entry: prev * 1.05, stop: prev * 1.0, qty: 100, riskDollars: 5 * prev, earningsDays: 20, shortRatio: 0.55, minutesET: 940 });
  assert.equal(q.hold, true, JSON.stringify({ gates: q.gates, score: q.score }));
  assert.ok(q.score >= RULES.minScore);
  assert.deepEqual(q.gates, []);
  assert.equal(q.plan.sellShares + q.plan.keepShares, 100);
  assert.ok(q.plan.keepShares <= 50);
  assert.ok(q.plan.stopOvernight >= prev * 1.05, 'never under breakeven');
  assert.ok(q.reasons.some((r) => /breakout/.test(r.text)));
  assert.match(q.summary, /RUNNER/);
});

test('gates: earnings tomorrow, a faded gap, or a red trade never hold overnight', () => {
  const hist = daily(60); const prev = hist[hist.length - 1].c;
  const earn = qualify({ intraday: runnerDay(prev), daily: hist, entry: prev * 1.05, stop: prev, earningsDays: 1, minutesET: 940 });
  assert.equal(earn.hold, false); assert.ok(earn.gates.some((g) => /Earnings/.test(g)));
  const faded = qualify({ intraday: fadeDay(prev), daily: hist, entry: prev * 1.1, stop: prev, minutesET: 940 });
  assert.equal(faded.hold, false); assert.ok(faded.gates.some((g) => /sold|faded|bottom/.test(g)));
  const red = qualify({ intraday: runnerDay(prev, { mult: 1.03 }), daily: hist, entry: prev * 1.2, stop: prev * 1.1, minutesET: 940 });
  assert.equal(red.hold, false); assert.ok(red.gates.some((g) => /R in profit/.test(g)));
  const early = qualify({ intraday: runnerDay(prev), daily: hist, entry: prev * 1.05, stop: prev, minutesET: 600 });
  assert.equal(early.hold, false); assert.ok(early.gates.some((g) => /3:30/.test(g)));
});

test('the trail only rises, tightens when the run goes parabolic, and exits on a climax or a close below the prior low', () => {
  const hist = daily(40, { drift: 0.001, wick: 0.04 }); // a name that normally swings 8% a day
  const entry = hist[hist.length - 1].c;
  // three orderly up days
  const run = hist.slice(); let px = entry;
  for (let i = 0; i < 3; i++) { const o = px, c = px * 1.04; run.push({ t: run[run.length - 1].t + DAY, o, h: c * 1.01, l: o * 0.99, c, v: 2_000_000 }); px = c; }
  const t1 = trail({ daily: run, entry, ext: Math.max(...run.slice(-3).map((b) => b.h)), daysHeld: 3 });
  assert.equal(t1.phase, 2); assert.equal(t1.k, RULES.kCalm); assert.ok(t1.stop >= entry); assert.equal(t1.exit, false);
  // then two giant days: parabolic, tighter trail, higher stop
  const par = run.slice(); for (let i = 0; i < 2; i++) { const o = px, c = px * 1.12; par.push({ t: par[par.length - 1].t + DAY, o, h: c * 1.01, l: o * 0.99, c, v: 3_000_000 }); px = c; }
  const t2 = trail({ daily: par, entry, ext: Math.max(...par.slice(-5).map((b) => b.h)), daysHeld: 5, currentStop: t1.stop });
  assert.equal(t2.phase, 3); assert.equal(t2.k, RULES.kParabolic); assert.ok(t2.stop > t1.stop); assert.equal(t2.parabolic, true);
  // a lower stop can never come back
  const t3 = trail({ daily: par, entry, ext: Math.max(...par.slice(-5).map((b) => b.h)), daysHeld: 5, currentStop: t2.stop * 1.5 });
  assert.ok(t3.stop >= Math.min(t2.stop * 1.5, par[par.length - 1].c * 0.995) - 0.001);
  // climax: 5x volume with a long upper wick
  const cl = par.slice(); { const o = px, c = px * 1.02; cl.push({ t: cl[cl.length - 1].t + DAY, o, h: px * 1.3, l: o * 0.98, c, v: 20_000_000 }); }
  const t4 = trail({ daily: cl, entry, ext: px * 1.3, daysHeld: 6, currentStop: t2.stop });
  assert.equal(t4.exit, true); assert.match(t4.exitReason, /climax/);
  // fade: a close below the prior session's low
  const fd = par.slice(); { const prevLow = fd[fd.length - 1].l; const o = px * 0.99, c = prevLow * 0.97; fd.push({ t: fd[fd.length - 1].t + DAY, o, h: o * 1.01, l: c * 0.99, c, v: 2_000_000 }); }
  const t5 = trail({ daily: fd, entry, ext: px * 1.01, daysHeld: 6, currentStop: t2.stop });
  assert.equal(t5.exit, true); assert.match(t5.exitReason, /prior session/);
  // the first night: breakeven or the breakout day's VWAP
  const t0 = trail({ daily: run, entry, ext: run[run.length - 1].h, daysHeld: 0, vwapDay: entry * 1.01 });
  assert.equal(t0.phase, 1); assert.equal(t0.stop, Math.round(entry * 1.01 * 10000) / 10000);
});

test('trailFor reads a desk alert from its date; shorts are not runners', () => {
  const hist = daily(50); const since = hist[44].t, entry = hist[44].c;
  const r = trailFor({ daily: hist, entry, sinceT: since });
  assert.ok(r && r.stop > 0 && r.phase >= 1);
  assert.equal(trailFor({ daily: hist, entry, sinceT: since, side: 'short' }), null);
});

test('dayStats reads the session: VWAP, opening range, late strength', () => {
  const d = dayStats(runnerDay(10));
  assert.ok(d.closeLoc > 0.9); assert.equal(d.aboveVwap, true); assert.equal(d.aboveOrh, true); assert.equal(d.highLate, true);
});
