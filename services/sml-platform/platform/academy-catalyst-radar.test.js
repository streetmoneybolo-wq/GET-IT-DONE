'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const radar = require('./academy-catalyst-radar');

const NOW = Date.UTC(2026, 9, 14, 15, 0, 0);
const D = 86_400_000;
const bars = (todayVol = 1_000_000, jitter = 0.01) => Array.from({ length: 40 }, (_, i) => { const t = NOW - (39 - i) * D, c = 50 * (1 + Math.sin(i) * jitter); return { t, o: c, h: c * 1.01, l: c * 0.99, c, v: i === 39 ? todayVol : 1_000_000 }; });

test('realized vol, relative volume and ATM IV helpers', () => {
  assert.equal(radar.relVolume20(bars(3_000_000)), 3);
  assert.ok(radar.realizedVol(bars()) > 5 && radar.realizedVol(bars()) < 40);
  assert.equal(radar.realizedVol([]), null);
  const exp = new Date(NOW + 20 * D).toISOString().slice(0, 10);
  assert.equal(radar.atmIv([{ strike: 48, expiry: exp, call: { iv: 0.9 } }, { strike: 50, expiry: exp, call: { iv: 0.55 }, put: { iv: 0.6 } }], 50), 55);
  assert.equal(radar.atmIv([], 50), null);
});

test('scoring adds the fingerprints up, leans with the evidence, discounts news that is already out, tags scheduled catalysts', () => {
  const quiet = radar.scoreName({ relVol: 1, options: { available: true, unusual: [], putCall: { volume: 1 }, score: 0 } });
  assert.equal(quiet.score, 0); assert.equal(quiet.label, 'quiet'); assert.equal(quiet.lean, 'no lean');
  const hot = radar.scoreName({ relVol: 3.2, ivAtm: 90, realizedVol: 40, options: { available: true, unusual: [{ type: 'CALL', strike: 55 }, { type: 'CALL', strike: 60 }], putCall: { volume: 0.3 }, score: 0.5 }, social: { available: true, velocityRatio: 3.5, sources: { reddit: 7 }, score: 0.5 }, institutional: { available: true, bias: 55, label: 'institutions buying', tape: { sweeps: { n: 6 }, blocks: { n: 3 } } }, filings: { available: true, insiders: { cluster: true }, activistRecent: 1 }, shortDays: 9 });
  assert.equal(hot.score, 100); assert.equal(hot.label, 'extreme'); assert.equal(hot.lean, 'bullish'); assert.ok(hot.reasons.length >= 10);
  const out = radar.scoreName({ relVol: 2.5, news: { available: true, n: 3, score: 0.6 }, newsRecentH: 3, known: { type: 'earnings', date: '2026-10-16' } });
  assert.equal(out.score, 2); assert.deepEqual(out.tags, ['news already out', 'scheduled: earnings 2026-10-16']);
  const bearish = radar.scoreName({ options: { available: true, unusual: [{ type: 'PUT', strike: 40 }], putCall: { volume: 2.5 }, score: -0.5 }, institutional: { available: true, bias: -50, label: 'institutions selling', tape: {} } });
  assert.equal(bearish.lean, 'bearish'); assert.equal(bearish.score, 18);
});

test('scan: candidates from the moving names + known catalysts, evidence from every service, chain only for the top, cached', async () => {
  const chainCalls = [];
  const svc = radar.createCatalystRadar({
    now: () => NOW, deepChain: 2, candidates: 4,
    universe: async () => [{ symbol: 'HOT', price: 50, changePct: 6, relVolume: 3 }, { symbol: 'MEH', price: 20, changePct: 0.2, relVolume: 1 }, { symbol: 'KNOWN', price: 30, changePct: 0.1, relVolume: 1 }, { symbol: 'bad sym', price: 1 }, { symbol: 'QUIET', price: 10, changePct: 0, relVolume: 0.9 }, { symbol: 'ALSO', price: 10, changePct: 0, relVolume: 0.9 }],
    candles: async (s) => ({ bars: bars(s === 'HOT' ? 3_500_000 : 1_000_000) }),
    sentiment: async (s) => ({ ok: true, components: { options: { available: true, unusual: s === 'HOT' ? [{ type: 'CALL', strike: 55 }] : [], putCall: { volume: s === 'HOT' ? 0.3 : 1 }, score: s === 'HOT' ? 0.4 : 0 }, social: { available: true, velocityRatio: s === 'HOT' ? 4 : 1, sources: { reddit: s === 'HOT' ? 6 : 0 }, score: 0.2 }, news: { available: false } } }),
    institutional: async (s) => ({ ok: true, available: true, bias: s === 'HOT' ? 45 : 0, label: s === 'HOT' ? 'institutions buying' : 'balanced', tape: { sweeps: { n: s === 'HOT' ? 7 : 0 }, blocks: { n: 0 } } }),
    filings: async () => ({ ok: true, available: true, label: 'quiet', insiders: { cluster: false }, activistRecent: 0 }),
    shortData: async (s) => ({ interest: [{ days_to_cover: s === 'HOT' ? 9 : 1 }] }),
    chain: async (s) => { chainCalls.push(s); return [{ strike: 50, expiry: new Date(NOW + 20 * D).toISOString().slice(0, 10), call: { iv: 1.0 }, put: { iv: 1.0 } }]; },
    known: async () => [{ symbol: 'KNOWN', type: 'earnings', date: '2026-10-16' }]
  });
  const r = await svc.scan({ limit: 3 });
  assert.equal(r.available, true); assert.equal(r.universe, 5, 'the bad symbol is dropped'); assert.equal(r.scanned, 4);
  assert.equal(r.rows.length, 3); assert.equal(r.rows[0].symbol, 'HOT'); assert.equal(r.rows[0].label, 'extreme'); assert.equal(r.rows[0].lean, 'bullish');
  assert.ok(r.rows[0].ivAtm === 100 && r.rows[0].reasons.some((x) => /implied vol/.test(x.k)), 'chain read for the top name');
  assert.equal(chainCalls.length, 2, 'chain only for the deepChain strongest');
  const known = r.rows.find((x) => x.symbol === 'KNOWN'); assert.ok(known && known.tags[0] === 'scheduled: earnings 2026-10-16');
  assert.ok(r.rows.every((x) => x.bars === undefined), 'bars never leave the server');
  const again = await svc.scan({ limit: 1 }); assert.equal(again.rows.length, 1); assert.equal(chainCalls.length, 2, 'cached');
});

test('scan survives a broken universe and broken services', async () => {
  const svc = radar.createCatalystRadar({ now: () => NOW, universe: async () => { throw new Error('down'); }, candles: async () => null });
  const r = await svc.scan({}); assert.equal(r.ok, true); assert.equal(r.available, false); assert.equal(r.rows.length, 0);
});
