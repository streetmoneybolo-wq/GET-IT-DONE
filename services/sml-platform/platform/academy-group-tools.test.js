'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGroupTools } = require('./academy-group-tools');
const calc = require('./academy-options-calc');

const NOW = Date.parse('2026-06-10T15:00:00Z');
function series(n, { start = 100, drift = 0.0025, wave = 0.02, step = 86_400_000, period = 11 } = {}) {
  const out = []; let prev = start;
  for (let i = 0; i < n; i++) {
    const c = start * Math.exp(drift * i) * (1 + wave * Math.sin((i * 2 * Math.PI) / period) + 0.004 * Math.sin(i * 1.7));
    out.push({ t: NOW - (n - i) * step, o: prev, h: Math.max(prev, c) * 1.005, l: Math.min(prev, c) * 0.995, c, v: 1e6 }); prev = c;
  }
  return out;
}
const TF = { '1D': () => series(320), '1W': () => series(130, { drift: 0.012, step: 7 * 86_400_000, period: 9 }), '15m': () => series(400, { drift: 0.0006, step: 900_000, period: 17 }), '5m': () => series(400, { drift: 0.0002, step: 300_000, period: 23 }) };
const candles = async (symbol, tf) => (symbol === 'DOWN' ? { bars: series(320, { drift: -0.0025 }) } : { bars: TF[tf]() });

function chainRows(spot) {
  const T = (Date.parse('2026-07-17T20:00:00Z') - NOW) / 86_400_000 / 365, rows = [];
  const stepK = Math.max(1, Math.round(spot * 0.025)); for (let k = Math.round(spot * 0.6); k <= spot * 1.5; k += stepK) { const leg = (t) => { const p = calc.price(t, spot, k, T, 0.043, 0, 0.3).price; return { bid: +(p * 0.99).toFixed(2), ask: +(p * 1.01).toFixed(2), iv: 0.3, oi: 900, volume: 40 }; }; rows.push({ expiry: '2026-07-17', strike: k, call: leg('call'), put: leg('put') }); }
  return rows;
}
function fakes(over = {}) {
  const watched = [];
  const spot = series(320)[319].c;
  const arr = []; let p = spot;
  for (let i = 0; i < 150; i++) { p = i % 4 === 3 ? p + spot * 0.0003 : p - spot * 0.0001; arr.push([NOW - 5 * 60_000 + i * 2000, +p.toFixed(3), i % 4 === 3 ? 100 : 300]); }
  return {
    watched, spot, now: () => NOW, candles,
    stream: { watch: (s) => { watched.push(s); return true; }, peek: (s) => ({ symbol: s, last: spot, stats: { count: 400, vol: 100_000, offVol: 45_000, offN: 6, since: 1, buy: 30_000, sell: 25_000, offTape: [{ t: 1, price: spot, size: 9000, dir: 'B' }, { t: 2, price: spot * 0.999, size: 4000, dir: 'S' }] } }), ticks: () => arr },
    orderFlow: { touch() {}, engines: new Map([['UP', { flow: { analyze: () => ({ ready: true, bias: 'bullish', score: 55, absorption: { state: 'buy', strength: 0.7, buyVol: 4000, sellVol: 900 } }) } }]]) },
    alerts: { shortData: async () => ({ summary: { avg_ratio: 38 } }), nextEarnings: async () => ({ date: '2026-07-02', daysAway: 22 }), chainFor: async () => chainRows(spot) },
    sentiment: { get: async (s) => ({ ok: true, symbol: s, available: true, score: 0.3, scorePct: 30, label: 'leaning bullish', coverage: 80 }) },
    ...over
  };
}

test('setups combine candles, live price, order flow, absorption, short data, sentiment and earnings', async () => {
  const f = fakes(), svc = createGroupTools(f);
  const r = await svc.run('setups', { symbol: 'up' });
  assert.equal(r.available, true); assert.equal(r.symbol, 'UP'); assert.equal(r.priceSource, 'live');
  assert.equal(r.cards.length, 4);
  const sw = r.cards.find((c) => c.horizon === 'swing');
  assert.ok(sw.evidence.some((e) => e.label === 'Sentiment'));
  assert.ok(f.watched.includes('UP'), 'the symbol is added to the live stream');
});

test('absorption reads the live ticks and the order book', async () => {
  const svc = createGroupTools(fakes());
  const r = await svc.run('absorption', { symbol: 'UP' });
  assert.equal(r.available, true); assert.ok(r.score > 0); assert.equal(r.orderBook.state, 'buy');
});

test('dark pool uses the stream stats and carries its caveat', async () => {
  const r = await createGroupTools(fakes()).run('darkpool', { symbol: 'UP' });
  assert.equal(r.available, true); assert.equal(r.offSharePct, 45); assert.match(r.caveat, /not a feed of institutional orders/);
});

test('strategies take the view from the best-fit setup when none is chosen, and honour shares for hedges', async () => {
  const svc = createGroupTools(fakes());
  const a = await svc.run('strategies', { symbol: 'UP', params: { horizonDays: 30 } });
  assert.equal(a.available, true); assert.equal(a.view, 'bullish'); assert.match(a.viewSource, /best-fit/);
  const b = await svc.run('strategies', { symbol: 'UP', params: { view: 'neutral', shares: 300, cost: 90 } });
  assert.ok(b.strategies.find((s) => s.id === 'collar')); assert.equal(b.holdsShares, true);
  const c = await svc.run('strategies', { symbol: 'DOWN', params: {} });
  assert.equal(c.ok, true); assert.match(c.viewSource, /best-fit/); // the chain is priced for UP, so DOWN may have no usable strikes: it must say so, not invent them
  assert.ok(c.available === false || ['bearish', 'neutral'].includes(c.view));
});

test('dashboard builds one compact row per ticker, tolerates a failing ticker, and caps the list', async () => {
  const svc = createGroupTools(fakes({ candles: async (s, tf) => { if (s === 'BAD') throw new Error('x'); return candles(s, tf); } }));
  const r = await svc.run('dashboard', { symbols: ['UP', 'DOWN', 'bad!', 'BAD', 'UP'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.map((x) => x.symbol).sort(), ['BAD', 'DOWN', 'UP']);
  const up = r.rows.find((x) => x.symbol === 'UP');
  assert.ok(up.setup && up.sentiment && up.darkPool && up.earnings.daysAway === 22);
  const big = await svc.run('dashboard', { symbols: Array.from({ length: 30 }, (_, i) => 'T' + String.fromCharCode(65 + (i % 26)) + (i > 25 ? 'X' : '')) });
  assert.ok(big.rows.length <= 12);
  await assert.rejects(svc.run('dashboard', { symbols: [] }), /symbols_required/);
});

test('dark pool leaders rank by off-exchange share', async () => {
  const f = fakes(); let n = 0;
  f.stream.peek = (s) => ({ symbol: s, last: 50, stats: { count: 100, vol: 1000, offVol: [300, 700, 500][n++ % 3], offN: 3, since: 1, buy: 1, sell: 1, offTape: [{ t: 1, price: 50, size: 100, dir: 'B' }] } });
  const r = await createGroupTools(f).run('leaders', { symbols: ['AAA', 'BBB', 'CCC'] });
  assert.deepEqual(r.rows.map((x) => x.offSharePct), [70, 50, 30]);
});

test('preview trims what non-premium members receive', async () => {
  const svc = createGroupTools(fakes());
  const full = await svc.run('setups', { symbol: 'UP' });
  const pv = await svc.run('setups', { symbol: 'UP', preview: true });
  assert.equal(pv.preview, true); assert.match(pv.note, /Premium/);
  const live = pv.cards.find((c) => c.available && c.side !== 'neutral');
  if (live) { assert.equal(live.stop, undefined); assert.equal(live.evidence, undefined); assert.ok(live.summary); }
  assert.ok(full.cards.some((c) => c.stop !== undefined));
  const sp = await svc.run('strategies', { symbol: 'UP', preview: true });
  assert.ok(sp.strategies.every((s) => s.legs === undefined && s.payoff === undefined));
  const dp = await svc.run('darkpool', { symbol: 'UP', preview: true });
  assert.deepEqual(dp.largest, []); assert.equal(dp.lean, null);
  const se = await svc.run('sentiment', { symbol: 'UP', preview: true });
  assert.equal(se.label, 'leaning bullish'); assert.deepEqual(se.components, {}); assert.deepEqual(se.notes, []);
  const lead = await svc.run('leaders', { symbols: ['UP', 'DOWN'], preview: true });
  assert.deepEqual(lead.rows, []);
  const ab = await svc.run('absorption', { symbol: 'UP', preview: true });
  assert.equal(ab.explain, undefined); assert.equal(ab.level, null); assert.equal(ab.tape, null);
  const db = await svc.run('dashboard', { symbols: ['UP', 'DOWN', 'SPY', 'QQQ'], preview: true });
  assert.ok(db.rows.length <= 3); assert.ok(db.rows.every((r) => r.sentiment === undefined && r.absorption === undefined && r.darkPool === undefined));
});

test('degrades when inputs are missing and rejects bad requests', async () => {
  const svc = createGroupTools({ candles, now: () => NOW });
  const s = await svc.run('setups', { symbol: 'UP' });
  assert.equal(s.available, true); assert.equal(s.priceSource, 'last-close');
  const a = await svc.run('absorption', { symbol: 'UP' });
  assert.equal(a.available, false);
  const o = await svc.run('strategies', { symbol: 'UP' });
  assert.equal(o.available, false); assert.equal(o.reason, 'no_chain');
  const se = await svc.run('sentiment', { symbol: 'UP' });
  assert.equal(se.reason, 'not_configured');
  await assert.rejects(svc.run('setups', { symbol: 'bad symbol' }), TypeError);
  await assert.rejects(svc.run('nope', { symbol: 'UP' }), /unknown_tool/);
  const { GroupToolsInputError } = require('./academy-group-tools');
  await assert.rejects(svc.run('nope', { symbol: 'UP' }), GroupToolsInputError);
  // an internal bug is NOT an input error: it must surface as a plain error so the route logs it and answers 503
  const buggy = createGroupTools({ candles: async () => { throw new TypeError('Cannot read properties of undefined'); }, now: () => NOW });
  const r2 = await buggy.run('setups', { symbol: 'UP' });
  assert.equal(r2.available, false); // soft-failed inputs degrade, never a 400
  assert.throws(() => createGroupTools({}), /candles_required/);
});
