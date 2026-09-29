'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createScreenerService, indicatorStates, horizonRead, optionFor, TIMEFRAMES, HORIZONS, INDICATORS, NON_DIRECTIONAL } = require('./academy-screener');

const DAY = 86_400_000;
/* Synthetic candles: a steady drift with a small ripple, so trend-following readings are unambiguous. */
function series(n, { start = 100, drift = 0.6, ripple = 0.4, tfMs = DAY, vol = 1_000_000 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const base = start + drift * i + Math.sin(i / 3) * ripple;
    const o = base - drift / 2, c = base + drift / 2;
    out.push({ t: 1_700_000_000_000 + i * tfMs, o, h: Math.max(o, c) + ripple, l: Math.min(o, c) - ripple, c, v: vol + (i % 7) * 50_000 });
  }
  return out;
}
const up = series(320, { drift: 0.6 });
const down = series(320, { start: 300, drift: -0.6 });

test('every indicator the engine lists is either screened with a reading or declared non-directional', () => {
  const screened = INDICATORS.map((x) => x.name);
  const engineList = ['SMA', 'EMA', 'WMA', 'DEMA', 'TEMA', 'Zero-Lag MA', 'Moving Average Ribbon', 'MA Crossovers', 'MACD', 'RSI', 'Stochastic (%K/%D)', 'ROC', 'Momentum (Rate of Change)', 'OBV', 'VWAP', 'Volume Oscillator', 'Accumulation/Distribution (A/D)', 'Chaikin Money Flow (CMF)', 'Money Flow Index (MFI)', 'ATR', 'Bollinger Bands', 'Keltner Channels', 'Standard Deviation', 'Historical Volatility', 'Donchian Channels', 'Price Channels', 'True Range', 'Amplitude'];
  for (const name of engineList) assert.ok(screened.includes(name) || NON_DIRECTIONAL.includes(name), name + ' is neither screened nor declared non-directional');
  assert.equal(new Set([...screened, ...NON_DIRECTIONAL]).size, engineList.length);
});

test('a steady uptrend reads bullish on the trend, momentum and breakout indicators; a steady downtrend reads bearish', () => {
  const bull = indicatorStates(up), bear = indicatorStates(down);
  for (const name of ['SMA', 'EMA', 'WMA', 'DEMA', 'TEMA', 'Zero-Lag MA', 'MA Crossovers', 'MACD', 'RSI', 'Stochastic (%K/%D)', 'ROC', 'Moving Average Ribbon', 'Donchian Channels', 'Bollinger Bands', 'Keltner Channels', 'VWAP', 'OBV']) {
    assert.equal(bull.states[name], 'bull', name + ' on an uptrend');
    assert.equal(bear.states[name], 'bear', name + ' on a downtrend');
  }
  assert.ok(bull.close > bull.close - 1 && Number.isFinite(bull.changePct));
  for (const name of NON_DIRECTIONAL) assert.equal(name in bull.states, false, name + ' must not be screened');
});

test('too few bars gives no reading rather than a guess', () => {
  assert.equal(indicatorStates(up.slice(0, 20)), null);
  assert.equal(indicatorStates([]), null);
});

test('horizonRead leans long on an uptrend and short on a downtrend, ranking the stronger case higher', () => {
  const longRead = horizonRead(up, 'swing', new Map()), shortRead = horizonRead(down, 'swing', new Map());
  assert.equal(longRead.dir, 1); assert.equal(longRead.tf, '1D'); assert.equal(longRead.mode, 'swing');
  assert.equal(shortRead.dir, -1);
  assert.ok(longRead.strength >= 1 && shortRead.strength >= 1);
  assert.equal(horizonRead(up, 'nope', new Map()), null);
  assert.equal(horizonRead(up.slice(0, 40), 'swing', new Map()), null, 'not enough bars to say anything');
});

test('the service sweeps the universe with the injected candles, keeps a symbol whose one timeframe fails, and respects maxSymbols', async () => {
  const calls = [];
  const candles = async (symbol, tf) => { calls.push(symbol + ':' + tf); if (symbol === 'BBB' && tf === '1W') throw new Error('upstream'); return { bars: symbol === 'CCC' ? down : up }; };
  const universe = async () => [{ symbol: 'aaa', name: 'A Co', price: 12.5 }, { symbol: 'BBB', name: 'B Co' }, { symbol: 'CCC' }, { symbol: 'DDD' }, { symbol: 'bad symbol!' }];
  const svc = createScreenerService({ candles, universe, maxSymbols: 3, now: () => 42 });
  const snap = await svc.refresh();
  assert.equal(snap.updatedAt, 42);
  assert.deepEqual(snap.symbols.map((s) => s.symbol), ['AAA', 'BBB', 'CCC']);
  const aaa = snap.symbols[0];
  assert.equal(aaa.name, 'A Co'); assert.equal(aaa.price, 12.5);
  for (const tf of TIMEFRAMES) assert.equal(aaa.byTf[tf].states.EMA, 'bull', 'AAA ' + tf);
  for (const key of Object.keys(HORIZONS)) assert.ok(aaa.horizons[key], 'AAA has a ' + key + ' read');
  const bbb = snap.symbols[1];
  assert.equal('1W' in bbb.byTf, false, 'the failed timeframe is simply missing');
  assert.equal(bbb.byTf['1D'].states.EMA, 'bull', 'the rest of BBB is still there');
  assert.equal(bbb.price, bbb.byTf['1D'].close, 'a missing scanner price falls back to the daily close');
  assert.equal(snap.symbols[2].horizons.swing.dir, -1);
  const out = svc.snapshot();
  assert.equal(out.ok, true); assert.deepEqual(out.timeframes, TIMEFRAMES); assert.ok(out.indicators.includes('MACD')); assert.equal(out.horizons.long.tf, '1W');
  assert.equal(calls.filter((c) => c.startsWith('DDD')).length, 0, 'the fourth symbol is beyond maxSymbols');
});

test('optionFor turns a long lean into a call and a short lean into a put, using the desk contract picker', () => {
  const now = Date.parse('2026-09-29T14:00:00Z');
  const expiry = new Date(now + 21 * DAY).toISOString().slice(0, 10);
  const side = (delta) => ({ bid: 2.4, ask: 2.5, last: 2.45, volume: 500, oi: 2000, iv: 0.35, delta, gamma: null, theta: -0.03, vega: null });
  const rows = [90, 95, 100, 105, 110].map((strike) => ({ expiry, strike, call: side(strike <= 100 ? 0.6 : 0.4), put: side(strike >= 100 ? -0.6 : -0.4) }));
  const call = optionFor({ symbol: 'AAA', side: 'call', horizon: 'swing', rows, price: 100, bars: up, now });
  assert.equal(call.verdict, 'CALL'); assert.equal(call.contract.type, 'CALL'); assert.match(call.reason, /leans long/);
  const put = optionFor({ symbol: 'AAA', side: 'put', horizon: 'swing', rows, price: 100, bars: down, now });
  assert.equal(put.verdict, 'PUT'); assert.equal(put.contract.type, 'PUT'); assert.match(put.reason, /leans short/);
  assert.equal(optionFor({ symbol: 'AAA', side: 'call', horizon: 'swing', rows: [], price: 100, bars: up, now }).verdict, 'NONE');
});
