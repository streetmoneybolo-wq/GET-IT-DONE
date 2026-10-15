'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCandleRecap, parseFinra, periodOf, periodStats, masterRead, etDate } = require('./academy-candle-recap');

const DAY = 86400000;
const noonEt = (y, m, d) => Date.parse(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00:00-04:00`);
function dailyBars(n, start = noonEt(2026, 1, 5)) {
  const out = []; let px = 100, t = start;
  for (let i = 0; i < n; i++) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) { const o = px, c = px * (1 + Math.sin(i / 4) * 0.01 + 0.001); out.push({ t, o, h: Math.max(o, c) * 1.005, l: Math.min(o, c) * 0.995, c, v: 1_000_000 + (i % 7) * 100_000 }); px = c; }
    t += DAY;
  }
  return out;
}

test('periods: a day, the Monday-based week, the month, the quarter and the year', () => {
  const wed = noonEt(2026, 10, 14); // Wednesday
  const d = periodOf('1D', wed); assert.equal(d.label, '2026-10-14'); assert.ok(d.test({ y: 2026, m: 10, d: 14 })); assert.ok(!d.test({ y: 2026, m: 10, d: 15 }));
  const w = periodOf('1W', wed); assert.equal(w.from, '2026-10-12'); assert.equal(w.to, '2026-10-16'); assert.ok(w.test({ y: 2026, m: 10, d: 12 })); assert.ok(w.test({ y: 2026, m: 10, d: 18 })); assert.ok(!w.test({ y: 2026, m: 10, d: 19 }));
  const m = periodOf('1M', wed); assert.equal(m.label, 'October 2026'); assert.ok(m.test({ y: 2026, m: 10, d: 1 })); assert.ok(!m.test({ y: 2026, m: 11, d: 1 }));
  const q = periodOf('1Q', wed); assert.equal(q.label, 'Q4 2026'); assert.ok(q.test({ y: 2026, m: 12, d: 31 })); assert.ok(!q.test({ y: 2026, m: 9, d: 30 }));
  const y = periodOf('1Y', wed); assert.equal(y.label, '2026'); assert.ok(y.test({ y: 2026, m: 1, d: 2 }));
  assert.equal(periodOf('5m', wed), null);
  assert.equal(etDate(wed), '2026-10-14');
});

test('period statistics describe the candle, its conviction and its context', () => {
  const days = dailyBars(400);
  const idx1 = days.length - 1, idx0 = idx1 - 4;
  const s = periodStats(days, idx0, idx1, null);
  assert.equal(s.sessions, 5);
  assert.ok(s.closeLoc >= 0 && s.closeLoc <= 1);
  assert.ok(s.sma20 != null && s.sma50 != null && s.sma200 != null);
  assert.ok(s.rvol > 0.5 && s.rvol < 2);
  assert.ok(s.rangeAtr > 0);
  assert.ok(s.pos52 >= 0 && s.pos52 <= 1);
  assert.equal(s.ups + s.downs <= 5, true);
  assert.ok(['inside', 'outside', 'engulfing', 'overlap'].includes(s.relation));
  // the clicked bar's own values win when the client sends them
  const own = periodStats(days, idx1, idx1, { o: 100, h: 110, l: 99, c: 109.5, v: 5_000_000 });
  assert.equal(own.c, 109.5); assert.ok(own.closeLoc > 0.9); assert.equal(own.v, 5_000_000);
});

test('FINRA Reg SHO lines are parsed and summed across markets', () => {
  const txt = 'Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market\n20261014|SPY|1000|10|4000|B\n20261014|SPY|500|0|1000|Q\n20261014|AAPL|200|0|400|B\n\n';
  const m = parseFinra(txt);
  assert.deepEqual(m.get('SPY'), [1500, 10, 5000]);
  assert.deepEqual(m.get('AAPL'), [200, 0, 400]);
  assert.equal(m.has('Date'), false);
});

test('the master read scores a strong close on volume as bullish with levels and scenarios', () => {
  const stats = { o: 100, h: 110, l: 99, c: 109.5, prevClose: 100, changePct: 9.5, closeLoc: 0.95, bodyRatio: 0.86, upperWick: 0.05, lowerWick: 0.09, rvol: 2.1, rangeAtr: 2, gapPct: 0, sma20: 101, sma50: 98, pos52: 0.9, streakBefore: 1, relation: 'engulfing' };
  const read = masterRead({ stats, candle: { names: [{ name: 'Bullish engulfing', dir: 1, strength: 0.8 }] }, smc: { events: [{ type: 'BOS', dir: 1, level: 105 }], sweeps: [], fvgs: [{ dir: 1, top: 104, bottom: 102 }], range: { pos: 0.9 }, vwap: { level: 103, above: true } }, offExchange: { share: 0.55 }, shortSale: { ratio: 0.6, baselineRatio: 0.45 }, sentiment: { score: 0.5 }, period: { kind: 'day' } });
  assert.equal(read.bias, 'bullish');
  assert.ok(read.confidence > 40);
  assert.ok(read.factors.length >= 8);
  assert.ok(read.levels.some((l) => l.label === 'day high' && l.price === 110));
  assert.match(read.scenarios.bull, /110/);
  const weak = masterRead({ stats: { ...stats, c: 99.5, closeLoc: 0.05, upperWick: 0.6, lowerWick: 0.02, bodyRatio: 0.05, changePct: -0.5, relation: 'overlap' }, candle: null, smc: null, offExchange: null, shortSale: null, sentiment: null, period: { kind: 'day' } });
  assert.notEqual(weak.bias, 'bullish');
});

test('the service assembles a recap from bars, FINRA files and the optional feeds', async () => {
  const days = dailyBars(420);
  const last = days[days.length - 1];
  const dateKey = etDate(last.t);
  const fetchImpl = async (url) => ({ ok: url.includes(dateKey.replace(/-/g, '')), text: async () => `Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market\n${dateKey.replace(/-/g, '')}|SPY|300000|0|600000|B\n` });
  const smc = require('./academy-smart-money'), patterns = require('./academy-patterns');
  const svc = createCandleRecap({ barsFor: async (s, tf) => (tf === '1D' ? days : []), fetchImpl, smc, patterns, shortData: async () => ({ volume: [], summary: { avg_ratio: 0.5 } }), sentiment: { get: async () => ({ ok: true, score: 0.2, label: 'lean bullish', coverage: 80, components: { options: { crowdedLong: false } }, history: [] }) }, darkPoolToday: null, now: () => last.t + 3600_000 });
  const r = await svc.recap({ symbol: 'SPY', tf: '1D', t: last.t });
  assert.equal(r.ok, true);
  assert.equal(r.period.kind, 'day');
  assert.equal(r.stats.sessions, 1);
  assert.equal(r.offExchange.days.length, 1);
  assert.equal(r.offExchange.days[0].offExchange, 600000);
  assert.equal(r.shortSale.ratio, 0.5);
  assert.equal(r.sentiment.score, 0.2);
  assert.ok(['bullish', 'bearish', 'neutral'].includes(r.read.bias));
  assert.ok(r.smc && Array.isArray(r.smc.read));
  const bad = await svc.recap({ symbol: 'SPY', tf: '5m', t: last.t });
  assert.equal(bad.ok, false);
  const again = await svc.recap({ symbol: 'SPY', tf: '1D', t: last.t });
  assert.equal(again, r, 'cached');
});
