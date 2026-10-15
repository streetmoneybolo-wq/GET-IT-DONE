'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMarketDirectionV2, quoteFromSnapshot, HEAVY } = require('./academy-market-direction-v2');

const DAY = 86_400_000;
function daily(n, { start = 400, drift = 0.0012, t0 = Date.UTC(2025, 0, 6, 21) } = {}) {
  const out = []; let px = start, t = t0;
  for (let i = 0; i < n;) { const wd = new Date(t).getUTCDay(); if (wd !== 0 && wd !== 6) { const o = px, c = px * (1 + drift + Math.sin(i / 4) * 0.004); out.push({ t, o, h: Math.max(o, c) * 1.004, l: Math.min(o, c) * 0.996, c, v: 5e7 }); px = c; i += 1; } t += DAY; }
  return out;
}
const snapRow = (ticker, pct, cap) => ({ ticker, todaysChangePerc: pct, lastTrade: { p: 100 * (1 + pct / 100) }, prevDay: { c: 100, v: 1_000_000 }, day: { v: 1_500_000, vw: 99.5 }, min: { c: 100 } });

test('snapshot rows become quotes with change, previous close, volume and VWAP', () => {
  const q = quoteFromSnapshot(snapRow('SPY', 1.2));
  assert.equal(q.changePct, 1.2); assert.equal(q.prevClose, 100); assert.equal(q.volume, 1_500_000); assert.equal(q.vwap, 99.5);
});

test('v2 wraps the base read: same fields, plus heavyweights, breadth, calendar and a track record', async () => {
  const spy = daily(280);
  const nowMs = spy[spy.length - 1].t + DAY; // the session after the last closed day
  let saved = null;
  const store = { read: async () => saved, write: async (v) => { saved = JSON.parse(JSON.stringify(v)); } };
  const base = { get: async (m) => ({ ok: true, mode: m, session: 'open', bias: 10, label: 'Neutral', confidence: 50, coverage: 80, components: [{ key: 'tape', label: 'Tape', score: 1, weight: 15, available: true, reasons: ['x'] }], levels: { pdh: 401 }, options: null, vol: { level: 15.2, change: null, terms: [] }, checklist: [{ status: 'ok', text: 'c' }], flips: ['old flip'], unusualVolume: [], proxies: 'P.' }), unusualVolume: async () => ({ ok: true, rows: [] }) };
  const rows = [...HEAVY.map((s, i) => snapRow(s, 1 + (i % 3) * 0.5)), snapRow('SPY', 1.1), snapRow('QQQ', 1.5), snapRow('IWM', 1.8), snapRow('RSP', 1.3), snapRow('XLK', 1.6), snapRow('XLY', 1.2), snapRow('XLF', 1.0), snapRow('XLI', 0.9), snapRow('XLC', 0.8), snapRow('XLB', 0.7), snapRow('XLP', 0.1), snapRow('XLU', -0.1), snapRow('XLV', 0.2), snapRow('XLRE', 0.3), snapRow('TLT', 0.4), snapRow('HYG', 0.3), snapRow('LQD', 0.1), snapRow('UUP', -0.2), snapRow('GLD', 0.2), snapRow('CPER', 1.0), snapRow('IBIT', 2.5)];
  const all = []; for (let i = 0; i < 1200; i++) all.push({ ticker: 'T' + i, todaysChangePerc: i % 4 === 0 ? -0.5 : 0.8, prevDay: { c: 20, v: 500_000 }, day: { v: 400_000 }, min: { t: nowMs, c: 20, av: 400_000 } });
  const svc = createMarketDirectionV2({
    base, snapshotAll: async () => all, snapshotTickers: async () => rows,
    candles: async (s, tf) => ({ bars: tf === '1D' ? spy : [] }),
    volIndex: { get: async () => ({ ok: true, level: 14.5 }), changeSince: () => ({ pct: -6 }) },
    gamma: { get: async () => ({ available: true, netGex: 2e9, flipStrike: 395, callWall: { strike: 410 }, putWall: { strike: 390 } }) },
    sentiment: { get: async () => ({ ok: true, score: 0.3, label: 'lean bullish', components: { options: { crowdedLong: false } } }) },
    company: async (s) => ({ market_cap: s === 'NVDA' ? 4.5e12 : s === 'MSFT' ? 3.8e12 : 1e12 }),
    earningsWindow: async () => [{ symbol: 'TSLA', date: new Date(nowMs + 2 * DAY).toISOString().slice(0, 10) }],
    store, now: () => nowMs
  });
  const r = await svc.get('day');
  assert.equal(r.ok, true);
  assert.ok(['Bullish', 'Lean bullish', 'Neutral', 'Lean bearish', 'Bearish'].includes(r.label));
  assert.ok(r.bias >= 15, 'a broadly green tape reads bullish: ' + r.bias);
  assert.ok(Array.isArray(r.components) && r.components.length >= 8 && r.components.every((c) => c.available && Array.isArray(c.reasons)));
  assert.equal(r.levels.pdh, 401, 'base levels kept');
  assert.equal(r.vol.level, 15.2, 'base SML VIX kept');
  assert.ok(r.checklist.length === 1 && r.flips.includes('old flip'));
  assert.ok(r.v2.constituents && r.v2.constituents.n === HEAVY.length);
  assert.ok(r.v2.constituents.rows[0].weight > r.v2.constituents.rows[r.v2.constituents.rows.length - 1].weight || r.v2.constituents.rows[0].pull >= r.v2.constituents.rows[1].pull);
  assert.ok(r.v2.constituents.earningsSoon.some((x) => x.symbol === 'TSLA'));
  assert.ok(r.v2.breadth && r.v2.breadth.n === 1200);
  assert.ok(r.v2.calendar.events.some((e) => e.kind === 'earnings' && e.label === 'TSLA earnings'));
  assert.equal(r.v2.weightSource, 'market capitalization');
  assert.ok(r.v2.gamma && r.v2.gamma.flip === 395);
  assert.ok(r.calibration && r.calibration.forecasts === 1);
  assert.ok(saved && saved.forecasts);
  const s = await svc.get('swing');
  assert.equal(s.mode, 'swing');
  assert.ok(s.components.every((c) => c.key !== 'intraday'), 'intraday is a day-only signal');
});

test('without the base read or market caps the service still answers', async () => {
  const spy = daily(100);
  const svc = createMarketDirectionV2({ snapshotTickers: async () => [], candles: async () => ({ bars: spy }), now: () => spy[spy.length - 1].t + DAY });
  const r = await svc.get('day');
  assert.equal(r.ok, true);
  assert.equal(r.v2.weightSource, 'equal weight (market caps unavailable)');
  assert.equal(r.v2.constituents, null);
});
