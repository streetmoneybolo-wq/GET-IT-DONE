'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const md = require('./market-direction');

const row = (ticker, ch, vol, minO, minC, t = 1_000_000) => ({ ticker, todaysChangePerc: ch, prevDay: { c: 50, v: 1_000_000 }, day: { v: vol, h: 0, l: 0 }, min: { t, o: minO, c: minC, av: vol } });

test('internals: advance/decline, up/down volume and a TICK-style count from the whole-market snapshot', () => {
  const rows = [];
  for (let i = 0; i < 80; i++) rows.push(row('U' + i, 1, 200_000, 10, 10.1));
  for (let i = 0; i < 20; i++) rows.push(row('D' + i, -1, 100_000, 10, 9.9));
  rows.push({ ticker: 'PENNY', todaysChangePerc: 5, prevDay: { c: 0.5, v: 9e6 } }); // under $2: left out
  rows.push(row('STALE', 1, 1, 10, 11, 1_000_000 - 600_000)); // a minute bar 10 minutes old is not a tick
  const it = md.internalsFrom(rows);
  assert.equal(it.universe, 101);
  assert.equal(it.adv, 81); assert.equal(it.dec, 20);
  assert.equal(it.adRatio, 4.05);
  assert.equal(it.upDownVolRatio, 8);
  assert.deepEqual([it.tick.up, it.tick.down, it.tick.net], [80, 20, 60]);
});

test('trend of a bar series: above a rising 20 average is up, below a falling one is down, too little history is unknown', () => {
  const up = Array.from({ length: 40 }, (_, i) => ({ c: 100 + i }));
  const down = Array.from({ length: 40 }, (_, i) => ({ c: 140 - i }));
  assert.equal(md.trendOf(up).dir, 1);
  assert.equal(md.trendOf(down).dir, -1);
  assert.equal(md.trendOf(up.slice(0, 10)), null);
});

test('options read: put/call volume inside the horizon and the biggest call / put open interest walls', () => {
  const today = Date.parse('2026-10-08');
  const rows = [
    { expiry: '2026-10-09', strike: 660, call: { volume: 1000, oi: 9000 }, put: { volume: 400, oi: 100 } },
    { expiry: '2026-10-09', strike: 640, call: { volume: 200, oi: 100 }, put: { volume: 600, oi: 12000 } },
    { expiry: '2026-12-18', strike: 700, call: { volume: 99999, oi: 99999 }, put: null } // outside 7 days
  ];
  const r = md.optionsRead(rows, 650, 7, today);
  assert.equal(r.pcVolume, 0.83);
  assert.deepEqual(r.callWall, { strike: 660, oi: 9000 });
  assert.deepEqual(r.putWall, { strike: 640, oi: 12000 });
});

test('the score: strong agreement is Bullish with high confidence; missing pieces are left out, not guessed', () => {
  const up = { dir: 1, ema20: 1 };
  const data = {
    session: 'open',
    quotes: { SPY: { price: 101, changePct: 1.2 }, QQQ: { changePct: 1.5 }, VIXY: { changePct: -5 }, IWM: { changePct: 1.8 }, RSP: { changePct: 1.1 }, XLK: { changePct: 2 }, XLY: { changePct: 1.5 }, XLC: { changePct: 1 }, XLF: { changePct: 1 }, XLI: { changePct: 1 }, XLP: { changePct: -0.2 }, XLU: { changePct: -0.4 }, XLV: { changePct: 0 }, XLRE: { changePct: -0.1 } },
    internals: { universe: 6000, adv: 4500, dec: 1400, adRatio: 3.2, pctAdvancing: 76, upDownVolRatio: 4, tick: { up: 900, down: 300, net: 600, ratio: 0.5 }, nearHigh: 0, nearLow: 0 },
    mtf: { SPY: { '5m': up, '15m': up, '1h': up, '4h': up } },
    levels: { SPY: { vwap: 100 } },
    tape: { SPY: { buy300: 9000, sell300: 3000, offBuy: 500, offSell: 100, big: [] } },
    options: null
  };
  const r = md.score('day', data);
  assert.equal(r.label, 'Bullish');
  assert.ok(r.bias >= 80, 'bias ' + r.bias);
  assert.equal(r.confidence, 100);
  const opt = r.components.find((c) => c.key === 'options');
  assert.equal(opt.available, false, 'no chain: options left out');
  assert.ok(r.coverage < 100);
  // flip the internals and the trend: the read follows the evidence
  const bear = { ...data, quotes: { ...data.quotes, SPY: { price: 99, changePct: -1.2 }, QQQ: { changePct: -1.5 }, VIXY: { changePct: 6 } }, internals: { ...data.internals, adv: 1000, dec: 5000, adRatio: 0.2, upDownVolRatio: 0.2, tick: { up: 200, down: 900, net: -700, ratio: -0.6 } }, mtf: { SPY: { '5m': { dir: -1 }, '15m': { dir: -1 }, '1h': { dir: -1 }, '4h': { dir: -1 } } }, tape: { SPY: { buy300: 1000, sell300: 9000 } } };
  assert.ok(md.score('day', bear).bias <= -40);
});

test('swing mode reads sector participation and daily trends; the checklist and flips name real levels', () => {
  const up = { dir: 1, ema20: 600 }, down = { dir: -1, ema20: 600 };
  const mtf = { SPY: { '1h': up, '4h': up, '1D': up, '1W': up }, QQQ: { '1D': up }, IWM: { '1D': down }, VIXY: { '1D': down } };
  md.SECTORS.forEach((s, i) => { mtf[s] = { '1D': i < 8 ? up : down }; });
  const data = { session: 'closed', quotes: { SPY: { price: 650, changePct: 0.3 } }, internals: null, mtf, levels: { SPY: { ema50: 630, ema200: 590, high20: 660, low20: 620 } }, options: null };
  const r = md.score('swing', data);
  const part = r.components.find((c) => c.key === 'participation');
  assert.equal(part.score, 2); assert.match(part.reasons[0], /8 of 11 sectors trending up/);
  assert.ok(r.bias > 40);
  const list = md.checklist('swing', data, r);
  assert.ok(list.some((x) => /50-day average \$630/.test(x.text)));
  assert.ok(md.flips('swing', data, r).some((x) => /\$630/.test(x)));
});

test('sessions follow New York time', () => {
  assert.equal(md.sessionOf(Date.parse('2026-10-08T13:00:00Z')), 'pre');   // 9:00 ET
  assert.equal(md.sessionOf(Date.parse('2026-10-08T15:00:00Z')), 'open');  // 11:00 ET
  assert.equal(md.sessionOf(Date.parse('2026-10-08T21:00:00Z')), 'after'); // 17:00 ET
  assert.equal(md.sessionOf(Date.parse('2026-10-10T15:00:00Z')), 'closed'); // Saturday
});

test('the service caches each source and never throws when one is down', async () => {
  let t = 1_000_000, calls = 0;
  const svc = md.createMarketDirection({
    now: () => t,
    snapshotAll: async () => { throw new Error('down'); },
    snapshotTickers: async () => { calls += 1; return [{ ticker: 'SPY', todaysChangePerc: 0.5, lastTrade: { p: 650 }, prevDay: { c: 647 } }]; },
    candles: async () => ({ bars: Array.from({ length: 60 }, (_, i) => ({ t: 1_700_000_000 + i * 300, o: 600 + i, h: 601 + i, l: 599 + i, c: 600 + i, v: 1000 })) })
  });
  const r = await svc.get('day');
  assert.equal(r.ok, true);
  assert.equal(r.components.find((c) => c.key === 'internals').available, false);
  await svc.get('day');
  assert.equal(calls, 1, 'cached');
  assert.match(r.disclaimer, /Not financial advice/);
});
