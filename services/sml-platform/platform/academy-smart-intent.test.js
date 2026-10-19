'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SI = require('./academy-smart-intent');

/* a synthetic tape: `n` prints from t0, price path given by `pathFn(i)`, side given by `sideFn(i)`, size by `sizeFn(i)` */
function tape({ n = 600, t0 = 1_700_000_000_000, gapMs = 500, pathFn, sideFn, sizeFn = () => 100 }) {
  const out = [];
  for (let i = 0; i < n; i++) out.push([t0 + i * gapMs, Math.round(pathFn(i) * 100) / 100, sizeFn(i), sideFn(i)]);
  return out;
}
function book(t, mid, { bidBig = null, askBig = null, levels = 10 } = {}) {
  const bids = [], asks = [];
  for (let i = 1; i <= levels; i++) { bids.push({ price: Math.round((mid - i * 0.01) * 100) / 100, size: 300, orders: 3 }); asks.push({ price: Math.round((mid + i * 0.01) * 100) / 100, size: 300, orders: 3 }); }
  if (bidBig) { const l = bids.find((x) => Math.abs(x.price - bidBig.price) < 0.005); if (l) l.size = bidBig.size; }
  if (askBig) { const l = asks.find((x) => Math.abs(x.price - askBig.price) < 0.005); if (l) l.size = askBig.size; }
  return { t, bids, asks };
}
function bars(n = 120, start = 100, drift = 0) {
  const out = []; let p = start;
  for (let i = 0; i < n; i++) { const o = p, c = p + drift + (i % 3 === 0 ? 0.3 : -0.2); out.push({ t: 1_700_000_000_000 + i * 300_000, o, h: Math.max(o, c) + 0.25, l: Math.min(o, c) - 0.25, c, v: 10_000 + (i % 7) * 1500 }); p = c; }
  return out;
}

test('VPIN reads one-sided buckets as toxic and a two-sided tape as balanced', () => {
  const oneSided = SI.normalizeTrades({ ticks: tape({ pathFn: () => 100, sideFn: () => 'B' }) }).trades;
  const r1 = SI.vpin(oneSided, { bucket: 2000 });
  assert.equal(r1.ok, true); assert.ok(r1.vpin >= 0.95); assert.equal(r1.band, 'toxic');
  const twoSided = SI.normalizeTrades({ ticks: tape({ pathFn: () => 100, sideFn: (i) => (i % 2 ? 'B' : 'S') }) }).trades;
  const r2 = SI.vpin(twoSided, { bucket: 2000 });
  assert.equal(r2.ok, true); assert.ok(r2.vpin <= 0.05); assert.equal(r2.band, 'balanced');
  assert.equal(SI.vpin([], {}).ok, false);
});

test("Kyle's lambda is high when flow moves price and near zero when flow is absorbed", () => {
  // 20 minutes: every minute 120 prints; buy minutes push price up 20 bps, sell minutes push it down
  const ticks = []; let p = 100; const t0 = 1_700_000_000_000;
  for (let m = 0; m < 20; m++) { const side = m % 2 ? 'S' : 'B'; for (let i = 0; i < 120; i++) { p += (side === 'B' ? 1 : -1) * 0.0002 * 100 / 120; ticks.push([t0 + m * 60_000 + i * 500, Math.round(p * 1000) / 1000, 200, side]); } }
  const moved = SI.kyleLambda(SI.normalizeTrades({ ticks }).trades, { adv: 2_400_000 });
  assert.equal(moved.ok, true); assert.ok(moved.lambda > 1.5, 'lambda ' + moved.lambda); assert.ok(moved.r2 > 0.5);
  const flat = []; for (let m = 0; m < 20; m++) { const side = m % 2 ? 'S' : 'B'; for (let i = 0; i < 120; i++) flat.push([t0 + m * 60_000 + i * 500, 100 + (i % 2) * 0.01, 200, side]); }
  const absorbed = SI.kyleLambda(SI.normalizeTrades({ ticks: flat }).trades, { adv: 2_400_000 });
  assert.equal(absorbed.ok, true); assert.ok(Math.abs(absorbed.lambda) < 0.5, 'lambda ' + absorbed.lambda); assert.equal(absorbed.band, 'absorbed');
});

test('persistence finds a worked order in a long run of same-side prints and nothing in an alternating tape', () => {
  const worked = SI.normalizeTrades({ ticks: tape({ n: 400, pathFn: () => 100, sideFn: (i) => (Math.floor(i / 25) % 2 ? 'B' : 'B') }) }).trades;
  // all buys: variance is zero -> one-sided
  assert.equal(SI.persistence(worked).band, 'one-sided');
  const runs = SI.normalizeTrades({ ticks: tape({ n: 400, pathFn: () => 100, sideFn: (i) => (Math.floor(i / 20) % 3 === 0 ? 'S' : 'B') }) }).trades;
  const r = SI.persistence(runs);
  assert.equal(r.ok, true); assert.ok(r.acf >= 0.25, 'acf ' + r.acf); assert.equal(r.band, 'worked order'); assert.equal(r.side, 'buy');
  const alt = SI.normalizeTrades({ ticks: tape({ n: 400, pathFn: () => 100, sideFn: (i) => (i % 2 ? 'B' : 'S') }) }).trades;
  const a = SI.persistence(alt);
  assert.ok(a.acf < 0, 'acf ' + a.acf); assert.equal(a.band, 'ping-pong');
});

test('footprint separates institutional size from retail odd lots and reads the side of the big prints', () => {
  const inst = SI.normalizeTrades({ ticks: tape({ n: 200, pathFn: () => 100, sideFn: (i) => (i % 10 === 0 ? 'S' : 'B'), sizeFn: (i) => (i % 10 === 0 ? 5000 : 100) }) }).trades;
  const f = SI.footprint(inst);
  assert.equal(f.ok, true); assert.ok(f.largeShare > 0.5); assert.equal(f.side, 'sell'); assert.equal(f.who, 'institutions printing size');
  const retail = SI.normalizeTrades({ ticks: tape({ n: 200, pathFn: () => 100, sideFn: () => 'B', sizeFn: (i) => 5 + (i % 40) }) }).trades;
  const g = SI.footprint(retail);
  assert.ok(g.oddShare > 0.9); assert.equal(g.who, 'retail-heavy tape');
});

test('icebergs: far more executed at a price than it ever displayed means hidden size', () => {
  const t0 = 1_700_000_000_000;
  const snaps = []; for (let i = 0; i < 12; i++) snaps.push(book(t0 + i * 2500, 100.00));
  // buyers lift 100.01 (the ask) for 9,000 shares while the ask never shows more than 300
  const ticks = []; for (let i = 0; i < 90; i++) ticks.push([t0 + i * 300, 100.01, 100, 'B']);
  const trades = SI.normalizeTrades({ ticks }).trades;
  const r = SI.icebergs(trades, snaps);
  assert.equal(r.ok, true); assert.equal(r.side, 'seller'); assert.equal(r.levels[0].price, 100.01); assert.ok(r.levels[0].ratio >= 30);
  assert.equal(SI.icebergs(trades, []).ok, false);
});

test('spoofing: a big bid that vanishes untraded as price comes down is fake support', () => {
  const t0 = 1_700_000_000_000;
  const snaps = [];
  // big bid 5 ticks under the touch, then the touch drops two ticks and the big bid is gone with no prints there
  snaps.push(book(t0, 100.005, { bidBig: { price: 99.95, size: 8000 } }));
  snaps.push(book(t0 + 2500, 99.985));
  snaps.push(book(t0 + 5000, 99.985, { bidBig: { price: 99.93, size: 8000 } }));
  snaps.push(book(t0 + 7500, 99.965));
  const r = SI.spoofing(snaps, []);
  assert.equal(r.ok, true); assert.equal(r.bid, 2); assert.equal(r.ask, 0); assert.equal(r.intent, 'fake support (seller)');
  // the same bid traded through is not a spoof
  const traded = SI.spoofing(snaps, [{ t: t0 + 1000, p: 99.95, s: 8000, d: -1 }, { t: t0 + 6000, p: 99.93, s: 8000, d: -1 }]);
  assert.equal(traded.count, 0);
});

test('the liquidity map merges levels from every source within 0.15 ATR and scores agreement', () => {
  const price = 100, atr = 1;
  const smc = { structure: { trend: 1, events: [{ type: 'BOS', dir: 1, level: 99 }], orderBlocks: [{ dir: 1, top: 98.6, bottom: 98.2, invalidAt: null }] }, fvg: [{ dir: 1, top: 98.55, bottom: 98.3, filledAt: null }], liquidity: [{ kind: 'EQH', level: 102, count: 3, takenAt: null }], pivots: { highs: [{ price: 101.4 }], lows: [{ price: 98.9 }] }, range: { pos: 0.5 }, vwap: { vwap: 99.7 } };
  const snap = book(0, 100.005, { bidBig: { price: 99.95, size: 9000 } });
  const dark = { ok: true, levels: [{ price: 98.45, volume: 400_000, lean: 'buy' }] };
  const gamma = { available: true, callWall: { strike: 102, oi: 50000 }, putWall: { strike: 98.5, oi: 60000 }, flipStrike: 99.5 };
  const m = SI.liquidityMap({ price, atr, smc, snap, ice: { ok: true, levels: [] }, dark, gamma, prof: { poc: 99.5, vah: 100.8, val: 98.9, hvn: [] }, vwap: 99.7 });
  assert.equal(m.ok, true);
  const demand = m.levels.find((l) => l.sources.includes('orderBlock'));
  assert.ok(demand, 'demand cluster');
  assert.ok(demand.sources.includes('fvg') && demand.sources.includes('darkPool') && demand.sources.includes('putWall'), demand.sources.join());
  assert.equal(demand.role, 'support'); assert.equal(demand.grade, 'A');
  const ceiling = m.levels.find((l) => l.sources.includes('eqh'));
  assert.ok(ceiling.sources.includes('callWall')); assert.equal(ceiling.role, 'resistance');
  assert.equal(m.levels[0].price, demand.price, 'strongest cluster first');
});

test('analyze reads accumulation when sells are absorbed with icebergs on the bid and dark buying', () => {
  const t0 = 1_700_000_000_000;
  // sellers hit the bid hard (70% sells) but price holds flat: absorption
  const ticks = tape({ n: 800, t0, gapMs: 250, pathFn: (i) => (i % 10 < 7 ? 99.99 : 100.01), sideFn: (i) => (i % 10 < 7 ? 'S' : 'B'), sizeFn: (i) => (i % 10 === 0 ? 1200 : 100) });
  const snaps = []; for (let i = 0; i < 24; i++) snaps.push(book(t0 + 200_000 - (24 - i) * 2500, 100.00));
  const stats = { offBuy: 600_000, offSell: 300_000 };
  const r = SI.analyze({ symbol: 'TEST', ticks, snaps, bars: bars(), stats, darkPool: { levels: [{ price: 99.9, volume: 300_000, lean: 'buy' }], offSharePct: 52, typicalSharePct: 40 }, price: 100, adv: 5_000_000 });
  assert.equal(r.ok, true); assert.equal(r.source, 'massive');
  assert.equal(r.formulas.darkPool.band, 'dark buying');
  assert.ok(r.formulas.iceberg.ok && r.formulas.iceberg.side === 'buyer', JSON.stringify(r.formulas.iceberg));
  assert.equal(r.intent.phase, 'accumulation', JSON.stringify(r.intent));
  assert.equal(r.intent.side, 'buyers');
  assert.ok(r.intent.evidence.some((e) => e.key === 'absorption'));
  assert.ok(r.map.ok && r.map.levels.length > 0);
  assert.ok(r.glossary.lambda.includes('Kyle'));
});

test('analyze still answers with only bars (no tape, no book) and says what was missing', () => {
  const r = SI.analyze({ symbol: 'X', bars: bars(), price: 100 });
  assert.equal(r.ok, true); assert.equal(r.source, 'none'); assert.equal(r.present.tape, 'none'); assert.equal(r.present.book, false);
  assert.equal(r.formulas.vpin.ok, false); assert.equal(r.intent.phase, 'undecided');
  assert.ok(r.profile && r.profile.poc > 0);
});
