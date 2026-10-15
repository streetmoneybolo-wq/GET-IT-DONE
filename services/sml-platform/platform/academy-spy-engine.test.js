'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compose, regimeOf, baseRates, constituentRead, breadthRead, createCalibration } = require('./academy-spy-engine');

const DAY = 86_400_000;
function daily(n, { start = 400, drift = 0.0008, wobble = 0.006, vol = 5e7, t0 = Date.UTC(2025, 0, 6, 21) } = {}) {
  const out = []; let px = start, t = t0;
  for (let i = 0; i < n;) { const wd = new Date(t).getUTCDay(); if (wd !== 0 && wd !== 6) { const o = px * (1 + Math.sin(i / 3) * 0.001), c = px * (1 + drift + Math.sin(i / 4) * wobble); out.push({ t, o, h: Math.max(o, c) * 1.004, l: Math.min(o, c) * 0.996, c, v: vol }); px = c; i += 1; } t += DAY; }
  return out;
}

test('regime: a steady up-drift reads as trend up, a flat wobble as range', () => {
  const up = regimeOf(daily(260, { drift: 0.0015, wobble: 0.002 }));
  assert.equal(up.kind, 'trend-up', JSON.stringify(up));
  const flat = regimeOf(daily(260, { drift: 0, wobble: 0.012 }));
  assert.ok(flat.kind === 'range' || flat.kind === 'high-vol', flat.kind);
  assert.equal(regimeOf(daily(30)).kind, 'unknown');
});

test('base rates count what SPY did after the same streak', () => {
  const r = baseRates(daily(300));
  assert.ok(r.sessions === 300 && r.anyDayUpPct > 0);
  assert.ok(r.streak.length >= 1 && (r.streak.nextUpPct == null || (r.streak.nextUpPct >= 0 && r.streak.nextUpPct <= 100)));
});

test('the heavyweights are weighted by index weight and leadership is classified', () => {
  const list = [
    { symbol: 'NVDA', weight: 0.075, changePct: 3, rvol: 2 }, { symbol: 'MSFT', weight: 0.065, changePct: 1 }, { symbol: 'AAPL', weight: 0.06, changePct: -0.5 },
    { symbol: 'AMZN', weight: 0.04, changePct: 0.8 }, { symbol: 'META', weight: 0.03, changePct: 2 }, { symbol: 'AVGO', weight: 0.025, changePct: -1 },
    { symbol: 'GOOGL', weight: 0.022, changePct: 0.4 }, { symbol: 'TSLA', weight: 0.018, changePct: 4, earningsDays: 2 }, { symbol: 'JPM', weight: 0.015, changePct: -0.2 }, { symbol: 'LLY', weight: 0.013, changePct: 0.1 }
  ];
  const c = constituentRead(list);
  assert.equal(c.n, 10);
  assert.ok(c.weightedChangePct > 0 && c.score > 0);
  assert.equal(c.rows[0].symbol, 'NVDA', 'NVDA has the most pull: weight × move × volume');
  assert.ok(c.earningsSoon.some((x) => x.symbol === 'TSLA'));
  assert.ok(['broad', 'narrow', 'mixed', 'broad-down'].includes(c.leadership));
  assert.equal(constituentRead([]), null);
});

test('breadth: a thrust day scores strongly positive', () => {
  const b = breadthRead({ n: 500, advancing: 420, declining: 70, above20Pct: 72, upVolume: 8e9, downVolume: 2e9 });
  assert.equal(b.thrust, true); assert.ok(b.score > 0.5);
  assert.equal(breadthRead(null), null);
});

test('compose: a bullish tape with broad breadth gives a bullish day and swing read with confidence, and flips', () => {
  const spy = daily(260, { drift: 0.0015, wobble: 0.002 });
  const last = spy[spy.length - 1].c;
  const intraday = []; for (let i = 0; i < 40; i++) { const o = last * (1 + i * 0.0003), c = o * 1.0003; intraday.push({ t: Date.UTC(2026, 0, 6, 14, 30) + i * 300000, o, h: c * 1.0005, l: o * 0.9995, c, v: 1e6 }); }
  const out = compose({
    spyDaily: spy, spyIntraday: intraday,
    quotes: { SPY: { last: last * 1.01, changePct: 1.0 }, QQQ: { changePct: 1.4 }, IWM: { changePct: 1.6 }, RSP: { changePct: 1.2 }, XLK: { changePct: 1.5 }, XLY: { changePct: 1.3 }, XLF: { changePct: 1.1 }, XLI: { changePct: 1.0 }, XLC: { changePct: 0.9 }, XLB: { changePct: 0.8 }, XLP: { changePct: 0.1 }, XLU: { changePct: -0.2 }, XLV: { changePct: 0.3 }, XLRE: { changePct: 0.2 }, TLT: { changePct: 0.5 }, HYG: { changePct: 0.4 }, LQD: { changePct: 0.1 }, UUP: { changePct: -0.3 }, GLD: { changePct: 0.1 }, CPER: { changePct: 1.2 }, IBIT: { changePct: 3 } },
    vix: { level: 14, change: -7 },
    gamma: { gex: 1.2e9, flip: last * 0.98, callWall: last * 1.03, putWall: last * 0.96 },
    constituents: [{ symbol: 'NVDA', weight: 0.075, changePct: 2 }, { symbol: 'MSFT', weight: 0.065, changePct: 1.2 }, { symbol: 'AAPL', weight: 0.06, changePct: 0.9 }, { symbol: 'AMZN', weight: 0.04, changePct: 1.5 }, { symbol: 'META', weight: 0.03, changePct: 1.1 }],
    breadth: { n: 500, advancing: 400, declining: 90, above20Pct: 70, upVolume: 7e9, downVolume: 3e9 },
    calendar: { risk: 0, events: [] }
  });
  assert.equal(out.ok, true);
  assert.equal(out.regime.kind, 'trend-up');
  assert.ok(out.day.bias >= 15, JSON.stringify(out.day));
  assert.ok(out.swing.bias >= 15, JSON.stringify(out.swing));
  assert.ok(out.day.confidence >= 50 && out.day.confidence <= 100);
  assert.ok(out.signals.length >= 10);
  assert.ok(out.flips.length >= 1);
  assert.ok(out.constituents && out.rotation && out.volatility && out.gamma && out.crossAsset && out.intraday && out.baseRates);
  // the same tape into an FOMC day loses confidence
  const risky = compose({ spyDaily: spy, quotes: { SPY: { last, changePct: 0.5 } }, calendar: { risk: 1, events: [{ label: 'FOMC' }] } });
  assert.ok(risky.day.confidence < out.day.confidence);
});

test('compose: a stressed tape reads bearish and a VIX crush from stress is noted', () => {
  const spy = daily(260, { drift: -0.0015, wobble: 0.002 });
  const out = compose({ spyDaily: spy, quotes: { SPY: { last: spy[spy.length - 1].c, changePct: -1.5 }, XLK: { changePct: -2 }, XLY: { changePct: -1.8 }, XLF: { changePct: -1.5 }, XLI: { changePct: -1.2 }, XLP: { changePct: 0.2 }, XLU: { changePct: 0.4 }, XLV: { changePct: 0.1 } }, vix: { level: 32, change: 9 }, breadth: { n: 500, advancing: 60, declining: 430 }, constituents: [{ symbol: 'NVDA', weight: 0.075, changePct: -3 }, { symbol: 'MSFT', weight: 0.065, changePct: -2 }, { symbol: 'AAPL', weight: 0.06, changePct: -1.5 }] });
  assert.ok(out.day.bias <= -15 && out.swing.bias <= -15, JSON.stringify({ d: out.day, s: out.swing }));
  assert.equal(out.breadth.washout, true);
});

test('calibration records forecasts and scores them against the next closes', async () => {
  let saved = null;
  const store = { read: async () => saved, write: async (v) => { saved = JSON.parse(JSON.stringify(v)); } };
  const cal = createCalibration({ store, now: () => 1 });
  const spy = daily(40);
  const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const key = (ms) => { const p = {}; for (const x of ET.formatToParts(new Date(ms))) p[x.type] = x.value; return `${p.year}-${p.month}-${p.day}`; };
  const i = 20, up = spy[i + 1].c > spy[i].c;
  await cal.record({ date: key(spy[i].t), dayBias: up ? 40 : -40, swingBias: 10, dayConfidence: 60, swingConfidence: 50, spyClose: spy[i].c });
  await cal.record({ date: key(spy[i + 2].t), dayBias: up ? -40 : 40, swingBias: -30, dayConfidence: 60, swingConfidence: 50, spyClose: spy[i + 2].c });
  await cal.settle(spy);
  const s = await cal.summary();
  assert.equal(s.forecasts, 2);
  assert.equal(s.day.calls, 2);
  assert.equal(s.day.hits, 1);
  assert.equal(s.day.hitRatePct, 50);
  assert.ok(s.day.brier != null && s.day.brier >= 0 && s.day.brier <= 1);
  assert.equal(s.swing.calls, 1, 'a swing bias under 15 is no call');
  assert.ok(saved && saved.forecasts);
});
