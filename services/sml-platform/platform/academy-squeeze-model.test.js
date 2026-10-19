'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('./academy-squeeze-model');

const bars = (n, step) => { const out = []; let p = 20; for (let i = 0; i < n; i++) { p *= 1 + step(i); out.push({ t: Date.UTC(2026, 7, 1) + i * 864e5, o: p, h: p * 1.01, l: p * 0.99, c: p, v: 2e6 }); } return out; };
/* a low-float name: 12M shares, a third of them sold short, the whole float traded twice today */
const loaded = {
  it: { shortInterest: 4e6, daysToCover: 8, tone: 'up', label: 'shorts added into a rising price: fighting the tape (squeeze fuel)' },
  svp: { avgRatio: 56, tone: 'up', label: 'absorbed', downOnHigh: 0, upOnHigh: 4 },
  float: { sharesFloat: 12e6 }, scanner: { volume: 24e6, rvol: 3.2, price: 20 },
  chain: { putCallOi: 1.5, putSkewPts: 3, putCallVol: 0.4 },
  bars: bars(40, (i) => (i >= 30 ? 0.03 : 0.001)),
  depth: { ready: true, pressure: { score: 60, label: 'strong buying pressure' }, walls: [{ side: 'bid' }, { side: 'bid' }], flow: { divergence: 'bullish' } },
  l2: { ready: true, absorption: { state: 'bull', strength: 0.8 } },
  tape: { count: 500, buy: 7e6, sell: 3e6, sweepN: 6, sweepBuy: 5, sweepSell: 1 },
  flowDays: { available: true, days: 4, score: 55, label: 'bullish week', deltaRatioAvg: 0.2 },
  intent: { formulas: { darkPool: { ok: true, dix: 0.62, heavy: true }, persistence: { ok: true, side: 'buy', band: 'worked order', acf: 0.3 }, iceberg: { ok: true, side: 'buyer', levels: [{ price: 21.5 }] }, spoof: { ok: true, intent: 'fake ceiling (buyer)' }, vpin: { ok: true, vpin: 0.55, band: 'informed' }, footprint: { ok: true, side: 'buy' }, lambda: { ok: true, band: 'normal', lambda: 2 } } },
  gamma: { available: true, regime: 'negative', price: 22.5, callWall: { strike: 23, distancePct: 2.1 }, flipStrike: 23, flipDistancePct: 2.2, zeroDteShare: 0.32, pressurePct: 22,
    byStrike: [{ strike: 20, callOi: 500, putOi: 4000 }, { strike: 22, callOi: 1500, putOi: 2000 }, { strike: 23, callOi: 9000, putOi: 800 }, { strike: 24, callOi: 7000, putOi: 400 }, { strike: 25, callOi: 3000, putOi: 300 }] },
  sentiment: { social: { available: true, postsPerHour: 40, baseline: 8 } }, earnings: { daysUntil: 3 }, marketOpen: true
};

test('fuel + spark + accelerant with no trap scores a squeeze candidate; the Q-STATE collapses to squeeze', () => {
  const m = Q.computeSqueeze(loaded);
  assert.ok(m.score >= 75, 'score ' + m.score); assert.equal(m.band, 'squeeze candidate');
  assert.ok(m.fuel.score >= 80 && m.spark.score >= 80 && m.accelerant.score >= 80, JSON.stringify([m.fuel.score, m.spark.score, m.accelerant.score]));
  assert.ok(m.trap.score <= 10, 'trap ' + m.trap.score);
  assert.equal(m.fuel.pctFloat, 33.3); assert.equal(m.fuel.floatKind, 'float'); assert.equal(m.fuel.burn, 6);
  assert.equal(m.fuel.floatShares, 12e6); assert.equal(m.fuel.floatBand, 'low float'); assert.equal(m.fuel.floatKey, 'low'); assert.equal(m.fuel.coverRatio, 0.5); assert.equal(m.fuel.floatTurn, 2); assert.equal(m.fuel.dollarFloat, 240e6);
  assert.equal(m.qstate.dominant, 'squeeze'); assert.ok(m.qstate.probs.squeeze >= 0.7, JSON.stringify(m.qstate.probs)); assert.ok(m.qstate.entropy < 0.6);
  assert.ok(m.coverage >= 0.95, 'coverage ' + m.coverage);
  assert.match(m.read, /SQUEEZE RISK \d+ \(squeeze candidate\)/); assert.match(m.read, /33\.3% of the float/); assert.match(m.read, /Supply: 12\.0M shares \(low float\), 0\.5 owed per free share, the float turned 2x today/); assert.match(m.qstate.note, /not quantum computing/);
  assert.ok(m.why.spark.length === 3 && m.why.fuel.length === 3);
});

test('supply and demand: the same short % of float is far more fuel on a 6M float than on a 600M float', () => {
  const base = { it: { shortInterest: 0, daysToCover: 4, tone: 'neutral', label: 'short interest steady' }, svp: { avgRatio: 50 }, scanner: { volume: 0, rvol: 2, price: 10 } };
  const small = Q.computeSqueeze({ ...loaded, it: { ...base.it, shortInterest: 1.2e6 }, float: { sharesFloat: 4e6 }, scanner: { volume: 6e6, rvol: 3, price: 10 } });
  const large = Q.computeSqueeze({ ...loaded, it: { ...base.it, shortInterest: 180e6 }, float: { sharesFloat: 600e6 }, scanner: { volume: 60e6, rvol: 3, price: 10 } });
  assert.equal(small.fuel.pctFloat, 30); assert.equal(large.fuel.pctFloat, 30, 'both are 30% short');
  assert.ok(small.fuel.score - large.fuel.score >= 20, 'fuel ' + small.fuel.score + ' vs ' + large.fuel.score);
  assert.ok(small.score > large.score, 'squeeze ' + small.score + ' vs ' + large.score);
  assert.equal(small.fuel.floatBand, 'micro float'); assert.equal(large.fuel.floatBand, 'large float');
  const fs = small.fuel.components.find((c) => c.key === 'floatSize'), fl = large.fuel.components.find((c) => c.key === 'floatSize');
  assert.equal(fs.pts, 20); assert.equal(fl.pts, 0); assert.match(fs.detail, /thin supply/);
  assert.equal(small.fuel.floatTurn, 1.5); assert.match(small.fuel.components.find((c) => c.key === 'floatTurn').detail, /whole supply changed hands/);
  assert.equal(small.fuel.dollarFloat, 40e6); assert.equal(small.fuel.components.find((c) => c.key === 'dollarFloat').pts, 5);
  /* more shares owed than exist free: the cover ratio tops out */
  const owed = Q.computeSqueeze({ ...loaded, it: { ...base.it, shortInterest: 2.2e6 }, float: { sharesFloat: 4e6 } });
  assert.equal(owed.fuel.coverRatio, 1.22); assert.match(owed.fuel.components.find((c) => c.key === 'coverRatio').detail, /more owed than exist free/);
  assert.equal(owed.fuel.components.find((c) => c.key === 'coverRatio').pts, 15);
  /* no float at all: the supply blocks are unknown, not zero, so the read is discounted rather than punished */
  const blind = Q.computeSqueeze({ ...loaded, float: null, scanner: { volume: 24e6, rvol: 3.2 } });
  for (const k of ['floatSize', 'coverRatio', 'floatTurn', 'dollarFloat']) assert.equal(blind.fuel.components.find((c) => c.key === k).known, false, k);
  assert.equal(blind.fuel.floatShares, null); assert.doesNotMatch(blind.read, /Supply:/);
});

test('fuel alone is not a squeeze: the score tops out in the thirties and the read names the missing spark', () => {
  const m = Q.computeSqueeze({ it: loaded.it, svp: loaded.svp, float: loaded.float, scanner: { volume: 1e6 }, chain: loaded.chain, bars: bars(40, () => 0), tape: { count: 300, buy: 1e6, sell: 1e6 }, depth: { ready: true, pressure: { score: 0, label: 'balanced' }, walls: [], flow: {} }, gamma: { available: true, regime: 'positive' }, marketOpen: true });
  assert.ok(m.fuel.score >= 70, 'fuel ' + m.fuel.score); assert.ok(m.spark.score <= 25, 'spark ' + m.spark.score);
  assert.ok(m.score <= 40 && m.score >= 15, 'score ' + m.score);
  assert.ok(m.missing.some((x) => /the spark/.test(x)));
  assert.notEqual(m.qstate.dominant, 'squeeze');
});

test('a pressed name scores press: shorts winning on down days, ask walls, the 20-day low gone', () => {
  const m = Q.computeSqueeze({ it: { shortInterest: 10e6, daysToCover: 1.5, tone: 'down', label: 'shorts added while price fell: they are pressing' }, svp: { avgRatio: 50, tone: 'down', label: 'pressing', downOnHigh: 4, upOnHigh: 0 }, float: { sharesFloat: 400e6 }, scanner: { volume: 5e6, rvol: 1.1, price: 30 }, bars: bars(40, (i) => (i >= 30 ? -0.03 : 0)), depth: { ready: true, pressure: { score: -55, label: 'strong selling pressure' }, walls: [{ side: 'ask' }, { side: 'ask' }], flow: { divergence: 'bearish' } }, tape: { count: 400, buy: 3e6, sell: 7e6, sweepN: 4, sweepBuy: 1, sweepSell: 3 }, intent: { formulas: { footprint: { ok: true, side: 'sell' }, lambda: { ok: true, band: 'high impact', lambda: 5 } } }, gamma: { available: true, regime: 'positive' }, marketOpen: true });
  assert.ok(m.trap.score >= 70, 'trap ' + m.trap.score); assert.ok(m.score <= 15, 'score ' + m.score);
  assert.equal(m.qstate.dominant, 'press'); assert.match(m.qstate.collapse, /collapses this to SQUEEZE/);
});

test('spark without fuel reads as a trap or chop, never a squeeze candidate', () => {
  const m = Q.computeSqueeze({ ...loaded, it: { shortInterest: 2e6, daysToCover: 0.8, tone: 'neutral', label: 'short interest steady' }, svp: { avgRatio: 35, tone: 'neutral', label: 'ordinary' }, float: { sharesFloat: 500e6 }, scanner: { volume: 24e6, rvol: 3.2, price: 40 }, chain: { putCallOi: 0.7 } });
  assert.ok(m.fuel.score <= 15, 'fuel ' + m.fuel.score); assert.ok(m.spark.score >= 75);
  assert.ok(m.score < 60, 'score ' + m.score + ' (the gamma ramp alone lifts it, the short fuel is missing)'); assert.notEqual(m.band, 'squeeze candidate');
  assert.ok(m.missing.some((x) => /the fuel/.test(x)));
  assert.ok(['trap', 'chop', 'press'].includes(m.qstate.dominant), m.qstate.dominant);
});

test('the gamma squeeze: dealers short the call ladder above spot, call buyers today, the flip within reach; without a chain it is unknown, not zero', () => {
  const m = Q.computeSqueeze(loaded);
  const g = m.gamma;
  assert.equal(g, m.accelerant, 'kept under both keys');
  assert.ok(g.score >= 90, 'gamma ' + g.score); assert.equal(g.band, 'gamma squeeze loaded');
  const c = (k) => g.components.find((x) => x.key === k);
  assert.equal(c('ladder').pts, 12); assert.match(c('ladder').detail, /56% of nearby open interest is calls within 10% above spot: a ladder/);
  assert.equal(c('callFlow').pts, 10); assert.match(c('callFlow').detail, /two to one/);
  assert.equal(c('flip').pts, 6); assert.match(c('flip').detail, /turns dealers into buyers/);
  assert.equal(c('hedge').pts, 8); assert.equal(c('gex').pts, 15); assert.equal(c('callWall').pts, 10);
  assert.equal(g.callWall.strike, 23); assert.equal(g.putCallVol, 0.4); assert.equal(g.regime, 'negative');
  assert.match(m.read, /GAMMA SQUEEZE \d+ \(gamma squeeze loaded\): call wall 23, put\/call volume 0\.4/);
  assert.match(m.formula, /0\.10 sqrt\(spark x gamma\)/);
  assert.ok(m.why.gamma.length === 3);
  /* the ramp reinforces a lit spark: the same name without the gamma ramp scores lower */
  const flat = Q.computeSqueeze({ ...loaded, gamma: { available: true, regime: 'positive', price: 22.5, callWall: { strike: 30, distancePct: 33 }, flipDistancePct: -20, flipStrike: 18, zeroDteShare: 0.05, pressurePct: 1, byStrike: [{ strike: 20, callOi: 100, putOi: 9000 }, { strike: 25, callOi: 100, putOi: 500 }] }, chain: { putCallOi: 1.5, putSkewPts: 3, putCallVol: 1.6 } });
  assert.ok(flat.gamma.score <= 15, 'flat gamma ' + flat.gamma.score); assert.equal(flat.gamma.band, 'no gamma ramp');
  assert.ok(m.score - flat.score >= 10, 'squeeze ' + m.score + ' vs ' + flat.score);
  assert.ok(m.qstate.probs.squeeze > flat.qstate.probs.squeeze);
  /* gamma loaded, buying not started: the read names the missing push */
  const quiet = Q.computeSqueeze({ it: loaded.it, svp: loaded.svp, float: loaded.float, scanner: { volume: 1e6, price: 20 }, chain: loaded.chain, gamma: loaded.gamma, bars: bars(40, () => 0), tape: { count: 300, buy: 1e6, sell: 1e6 }, marketOpen: true });
  assert.ok(quiet.missing.some((x) => /call ladder/.test(x)), JSON.stringify(quiet.missing));
  const none = Q.computeSqueeze({ ...loaded, gamma: null });
  assert.equal(none.gamma.score, null); assert.ok(none.gamma.components.every((x) => x.known === false)); assert.equal(none.gamma.band, 'unknown');
  assert.match(Q.aiPrompt('ABC', m, { price: 22 }), /GAMMA SQUEEZE \d+ \(gamma squeeze loaded\): Dealer gamma/);
});

test('a thin read is discounted and says what it lacked; nothing at all scores null', () => {
  const thin = Q.computeSqueeze({ it: { shortInterest: 30e6, daysToCover: 8 }, bars: loaded.bars });
  assert.ok(thin.coverage < 0.4, 'coverage ' + thin.coverage);
  const full = Q.computeSqueeze({ ...loaded });
  assert.ok(thin.score < full.score);
  assert.ok(thin.fuel.components.some((c) => c.key === 'pctFloat' && c.known === false && /float unknown/.test(c.detail)));
  const none = Q.computeSqueeze({});
  assert.equal(none.score, null); assert.equal(none.band, 'unknown'); assert.match(none.read, /Not enough data/);
});

test('with the market closed the ledger stands in for the tape, and shares outstanding stand in for the float', () => {
  const m = Q.computeSqueeze({ it: { shortInterest: 30e6, daysToCover: 6 }, float: { sharesOutstanding: 120e6 }, flowDays: { available: true, days: 3, score: 40, deltaRatioAvg: 0.25, label: 'bullish' }, bars: loaded.bars, marketOpen: false });
  assert.equal(m.fuel.floatKind, 'shares outstanding'); assert.equal(m.fuel.pctFloat, 25); assert.equal(m.fuel.floatBand, 'mid float'); assert.equal(m.fuel.coverRatio, 0.33);
  assert.ok(m.spark.components.some((c) => c.key === 'tape' && c.known && /ledger/.test(c.detail)));
});

test('the AI brief is cached, parsed from the model answer, and absent without a key', async () => {
  const m = Q.computeSqueeze(loaded);
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, json: async () => ({ model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Sure: {"headline":"Loaded and lit.","read":["Fuel is 30% of the float.","Buyers are lifting the offer."],"proves":["A close above 23"],"kills":["A close under the 20-day high"],"plan":["Trail under the breakout.","Shorts stand aside."],"confidence":"medium: the tape is one session"}' }] }) }; };
  const b = Q.createSqueezeBrief({ ai: { apiKey: 'k', model: 'claude-sonnet-5-5' }, fetchImpl, now: () => 1 });
  const v = await b.brief('ABC', m, { price: 22 });
  assert.equal(v.available, true); assert.equal(v.headline, 'Loaded and lit.'); assert.equal(v.read.length, 2); assert.equal(v.plan.length, 2);
  await b.brief('ABC', m, { price: 22 }); assert.equal(calls, 1, 'cached');
  assert.match(Q.aiPrompt('ABC', m, { price: 22 }), /FUEL \d+: Short % of float/);
  const off = Q.createSqueezeBrief({ ai: null });
  assert.equal((await off.brief('ABC', m)).reason, 'ai_unconfigured');
  const bad = Q.createSqueezeBrief({ ai: { apiKey: 'k' }, fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
  assert.equal((await bad.brief('ABC', m)).reason, 'ai_error');
});
