import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAlertMessage } from '../utils/alertParser.js';

const AT = '2026-10-16T15:52:29Z'; // a Thursday; 2026-10-17 is the Saturday after
const parse = (s) => parseAlertMessage(s, AT);
const opt = (r) => r && [r.kind, r.symbol, r.contractType, r.strike, r.expiration, r.needsReview];

test('original option and stock formats still parse exactly as before', () => {
  assert.deepEqual(opt(parse('SPY CALLS 580 10/17')), ['option', 'SPY', 'CALL', 580, '2026-10-17', false]);
  assert.deepEqual(opt(parse('$NVDA put 120.5 daily')), ['option', 'NVDA', 'PUT', 120.5, '2026-10-16', false]);
  const eq = parse('AAPL entry 230 pt 245 plus');
  assert.deepEqual([eq.kind, eq.symbol, eq.entryPrice, eq.targetPrice, eq.targetIsMinimum, eq.needsReview], ['equity', 'AAPL', 230, 245, true, false]);
  assert.equal(parse('AAPL entry 230 pt 245').targetIsMinimum, false);
  assert.equal(parse('AAPL ENTRY 40 CENTS pt 1,20').targetPrice, 1.2);
});

test('strike before the type, with the c/p shorthand', () => {
  assert.deepEqual(opt(parse('SPY 580C 10/17')), ['option', 'SPY', 'CALL', 580, '2026-10-17', false]);
  assert.deepEqual(opt(parse('SPY 580 C')), ['option', 'SPY', 'CALL', 580, null, true]);
  assert.deepEqual(opt(parse('$SPY $580 call 10/17')), ['option', 'SPY', 'CALL', 580, '2026-10-17', false]);
  assert.deepEqual(opt(parse('NVDA 120.5p 0DTE')), ['option', 'NVDA', 'PUT', 120.5, '2026-10-16', false]);
  assert.deepEqual(opt(parse('TSLA 10/24 250 PUTS')), ['option', 'TSLA', 'PUT', 250, '2026-10-24', false]);
  assert.deepEqual(opt(parse('SPY 580 CALLS today')), ['option', 'SPY', 'CALL', 580, '2026-10-16', false]);
});

test('BTO prefix and an @ premium', () => {
  const r = parse('BTO SPY 10/17 580C @ 1.20');
  assert.deepEqual(opt(r), ['option', 'SPY', 'CALL', 580, '2026-10-17', false]);
  assert.equal(r.entryPrice, 1.2);
  assert.equal(parse('🚨 ALERT: BUY $AMD 11/21 250c at .85').entryPrice, 0.85);
  assert.equal(parse('BTO SPY 10/17 580C').entryPrice, undefined);
});

test('stocks with other entry words, @, or no entry word', () => {
  const a = parse('AAPL @ 230 pt 245');
  assert.deepEqual([a.kind, a.symbol, a.entryPrice, a.targetPrice, a.needsReview], ['equity', 'AAPL', 230, 245, false]);
  assert.deepEqual([parse('AAPL 230 target 245').entryPrice, parse('AAPL 230 target 245').targetPrice], [230, 245]);
  const b = parse('long AAPL buy 230 tp: 245 +');
  assert.deepEqual([b.symbol, b.targetPrice, b.targetIsMinimum], ['AAPL', 245, true]);
  const c = parse('$AAPL @ 230');
  assert.deepEqual([c.kind, c.symbol, c.entryPrice, c.targetPrice, c.needsReview], ['equity', 'AAPL', 230, null, true]);
});

test('management posts are not new alerts', () => {
  for (const s of ['SPY 580C out at 2.10', 'sold SPY 580C', 'trimmed half of SPY 580c', 'STC SPY 580C @ 2.40', 'took profits on AAPL 230 pt 245', 'stopped out AAPL @ 228', 'closing the NVDA 120p runner']) {
    assert.equal(parse(s), null, s);
  }
});

test('commentary and lower-case words are not tickers', () => {
  for (const s of ['check the 580 c levels', 'buy 580c', 'what a day', 'calls 580', 'at 230 pt 245', 'the AAPL thesis is intact', 'in at 230']) {
    assert.equal(parse(s), null, s);
  }
  assert.equal(parse('spy 580c'), null);           // lower-case ticker without $
  assert.equal(parse('$spy 580c').symbol, 'SPY');  // $ makes it a ticker
});

test('the first real ticker wins when noise words come first', () => {
  assert.equal(parse('BUY NOW SPY 580C').symbol, 'SPY');
  assert.equal(parse('ADD AMD 250c 11/21').symbol, 'AMD');
});
