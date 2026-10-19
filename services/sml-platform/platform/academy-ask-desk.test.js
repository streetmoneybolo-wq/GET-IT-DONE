'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('./academy-ask-desk');

/* 80 daily bars: a base around 2.00 that breaks out over the last 6 sessions to ~4.10 on heavy volume (the "still worth it?" case) */
function daily() {
  const out = []; let t = Date.UTC(2026, 5, 1, 20);
  for (let i = 0; i < 160; i++) {
    const base = i < 154 ? 2 + Math.sin(i / 5) * 0.08 : 2.1 + (i - 153) * 0.33;
    const o = base - 0.02, c = base + 0.02, h = c + 0.05, l = o - 0.05, v = i < 154 ? 800_000 : 6_000_000;
    out.push({ t, o, h, l, c, v }); t += 86_400_000;
  }
  return out;
}
function intraday(lastClose) {
  const out = []; const day = Date.UTC(2026, 7, 19, 13, 30); // 9:30 ET
  for (let i = 0; i < 70; i++) { const p = lastClose - 0.3 + i * 0.006; out.push({ t: day + i * 300_000, o: p, h: p + 0.03, l: p - 0.03, c: p + 0.01, v: 20_000 }); }
  return out;
}

test('the daily read turns the tape into the numbers Obi needs: change, 20-day range, averages, ATR, extension, relative volume', () => {
  const r = D.dailyRead('HUBC', daily());
  const text = r.lines.join('\n');
  assert.match(text, /^HUBC last 4\.\d\d \(\+\d+\.\d% on the day, \+\d+\.\d% in 5 days, \+\d+\.\d% in 20 days\)/);
  assert.match(text, /20-day high 4\.\d\d \(-?\d+\.\d% from it\), 20-day low 1\.\d\d \(\+\d+\.\d% above it\)\. 10-day low \d\.\d\d\./);
  assert.match(text, /20-day average 2\.\d\d, 50-day 2\.\d\d: price is \+\d+\.\d% from the 20-day/);
  assert.match(text, /ATR\(14\) 0\.\d\d \(\d+\.\d% a day is a normal move\)\. Extension: \d+\.\d ATRs above the 10-day low, \d+\.\d ATRs from the 20-day average\./);
  assert.match(text, /Volume 6\.0M vs \d\.\dM average \(\d\.\dx relative volume\)\./);
  assert.match(text, /\d up days in a row\./);
  const ext = Number(/Extension: ([\d.]+) ATRs above the 10-day low/.exec(text)[1]);
  assert.ok(ext > 3, 'a six-day 100% run is many ATRs extended: ' + ext);
  assert.deepEqual(D.dailyRead('X', [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }]).lines, [], 'one bar says nothing');
});

test('the desk read assembles the stock block from every source it has, names the stock first, and leaves a failing or slow source out', async () => {
  const bars = daily(), last = bars[bars.length - 1].c;
  const desk = D.createAskDesk({
    candles: async (s, tf) => (tf === '1D' ? { bars } : { bars: intraday(last) }),
    memAlgo: require('./academy-mem-algo'), smartMoney: require('./academy-smart-money'), patterns: require('./academy-patterns'),
    scannerRow: async () => ({ symbol: 'HUBC', name: 'Hub Cyber Security', sharesFloat: 12_500_000, marketCap: 50_000_000 }),
    shortQuick: async () => ({ ok: true, available: true, pctFloat: 18.4, daysToCover: 2.1, fuel: 61 }),
    sentiment: async () => ({ available: true, scorePct: 42, label: 'bullish', coverage: 75 }),
    earnings: async () => ({ events: [{ reportDate: '2026-09-02' }, { date: '2025-05-01' }] }),
    marketDirection: { get: async () => ({ ok: true, mode: 'day', session: 'open', label: 'Lean bullish', bias: 'up', confidence: 62, v2: {}, components: [] }) },
    smlVix: { get: async () => { throw new Error('vix down'); } },
    now: () => Date.UTC(2026, 7, 19, 15), timeoutMs: 500
  });
  const text = await desk.read({ subject: 'HUBC', horizon: 'today', question: 'is hubc worth it to enter still' });
  assert.ok(text.startsWith('THE STOCK ASKED ABOUT (HUBC):\nHUBC last '), text.slice(0, 80));
  assert.match(text, /MEM ALGO day read \(1D\): bias [A-Z]+\./, text);
  assert.match(text, /Today: high of day \d\.\d\d \(-?\d+\.\d% from it\), low of day \d\.\d\d, VWAP \d\.\d\d \(price [+-]\d+\.\d% from VWAP\)\./);
  assert.match(text, /Scanner: Hub Cyber Security, float 12\.5M, market cap 50\.0M\./);
  assert.match(text, /Short picture: 18\.4% of the float short, 2\.1 days to cover, squeeze fuel 61\/100\./);
  assert.match(text, /Sentiment: \+42 bullish \(75% of sources\)\./);
  assert.match(text, /Next earnings: 2026-09-02 \(14 days away\)\./);
  assert.match(text, /THE MARKET:\nMarket Direction \(day read, open\): Lean bullish, bias up, confidence 62\/100\./);
  assert.doesNotMatch(text, /SML VIX/, 'a failing source is left out, not guessed');
  assert.ok(text.indexOf('THE STOCK ASKED ABOUT') < text.indexOf('THE MARKET'), 'the stock comes before the market');
  // a market question carries only the market block; a stock the feed has nothing for says so
  const m = await desk.read({ subject: 'market', horizon: 'tomorrow' });
  assert.ok(m.startsWith('THE MARKET:'), m.slice(0, 40)); assert.doesNotMatch(m, /THE STOCK/);
  const none = D.createAskDesk({ candles: async () => ({ bars: [] }), timeoutMs: 200 });
  assert.match(await none.read({ subject: 'ZZZZ' }), /ZZZZ: no price history came back from the feed\./);
  const slow = D.createAskDesk({ candles: () => new Promise(() => {}), timeoutMs: 50 });
  assert.match(await slow.read({ subject: 'SLOW' }), /SLOW: no price history/, 'a hung source is dropped at the time box');
});

test('the next earnings date is found in any of the shapes the bridge returns', () => {
  const now = Date.UTC(2026, 7, 19);
  assert.deepEqual(D.nextEarnings([{ date: '2026-08-01' }, { date: '2026-08-27T00:00:00' }, { date: '2026-11-03' }], now), { date: '2026-08-27', days: 8 });
  assert.deepEqual(D.nextEarnings({ rows: [{ earnings_date: '2026-09-15' }] }, now), { date: '2026-09-15', days: 27 });
  assert.deepEqual(D.nextEarnings({ nextEarningsDate: '2026-08-20' }, now), { date: '2026-08-20', days: 1 });
  assert.equal(D.nextEarnings([{ date: '2026-01-01' }], now), null);
  assert.equal(D.nextEarnings(null, now), null);
});
