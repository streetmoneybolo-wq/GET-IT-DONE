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

/* The shapes below are copied from real posts in the monitored channels (Render log, 2026-10-18 backfill). */
const bold = (s) => Array.from(s).map((ch) => {
  if (ch >= 'A' && ch <= 'Z') return String.fromCodePoint(0x1D400 + ch.charCodeAt(0) - 65);
  if (ch >= 'a' && ch <= 'z') return String.fromCodePoint(0x1D41A + ch.charCodeAt(0) - 97);
  if (ch >= '0' && ch <= '9') return String.fromCodePoint(0x1D7CE + ch.charCodeAt(0) - 48);
  return ch;
}).join('');
const eq = (r) => r && [r.kind, r.symbol, r.entryPrice, r.targetPrice, r.targetIsMinimum, r.needsReview];

test('real channel formats: pipe-separated option alerts', () => {
  assert.deepEqual(opt(parse('@everyone SPY CALLS | 779 | DAILY')), ['option', 'SPY', 'CALL', 779, '2026-10-16', false]);
  assert.deepEqual(opt(parse('@everyone SPY CALLS \\\\ 777 | Daily')), ['option', 'SPY', 'CALL', 777, '2026-10-16', false]);
  assert.deepEqual(opt(parse('@everyone SPY PUTS | 742 | DAILY')), ['option', 'SPY', 'PUT', 742, '2026-10-16', false]);
});

test('real channel formats: Unicode bold with STRIKE and EXP labels', () => {
  assert.deepEqual(opt(parse('@everyone 🔥 ' + bold('SPY CALLS | STRIKE 763 | DAILY') + ' 🔥 📈 ' + bold('Current Share Price') + ': $760')), ['option', 'SPY', 'CALL', 763, '2026-10-16', false]);
  assert.deepEqual(opt(parse('@everyone 🔥 ' + bold('IONQ CALLS | STRIKE $50 | EXP 10/23/26') + ' 🔥 💵 ' + bold('CURRENT SHARE PRICE') + ': $46.90')), ['option', 'IONQ', 'CALL', 50, '2026-10-23', false]);
  assert.deepEqual(opt(parse('@everyone ' + bold('ZS PUTS | STRIKE $192.5 | EXP 10.02.26 DISTANCE: BELOW CURRENT PRICE'))), ['option', 'ZS', 'PUT', 192.5, '2026-10-02', false]);
  assert.deepEqual(opt(parse('@everyone 🔥 ' + bold('WMT PUTS | STRIKE $103 | EXP 10/02') + ' 🔥')), ['option', 'WMT', 'PUT', 103, '2027-10-02', false]);
  assert.deepEqual(opt(parse('🔥 ' + bold('SPY CALL ALERT — STRIKE $769 | EXP TODAY') + ' 🔥 📈 ' + bold('SETUP') + ': High‑volatility same‑day contract')), ['option', 'SPY', 'CALL', 769, '2026-10-16', false]);
  assert.deepEqual(opt(parse('@everyone 🔥 ' + bold('SPY PUTS | STRIKE 776 | HEDGE PLAY') + ' 🔥 📉 Current contract price: $0.49')), ['option', 'SPY', 'PUT', 776, null, true]);
});

test('real channel formats: ALERT wording and markdown bold', () => {
  assert.deepEqual(opt(parse('🚨 SPY ALERT — 775 PUTS (DAILY) 🚨 SPY showing weakness on the intraday.')), ['option', 'SPY', 'PUT', 775, '2026-10-16', false]);
  assert.deepEqual(opt(parse('@everyone **$OKLO puts 35 1/15/27 ** Contract: about $4.20 a share, so $420 a contract (bid 4.10, ask 4.30).')), ['option', 'OKLO', 'PUT', 35, '2027-01-15', false]);
  assert.deepEqual(opt(parse('@everyone **$HOOD calls 140 10/23/26 ** Contract: about $2.71 a share')), ['option', 'HOOD', 'CALL', 140, '2026-10-23', false]);
});

test('real channel formats: stock alerts', () => {
  assert.deepEqual(eq(parse('@everyone **$TXG entry $87 pt $120 plus ** Distance: $120 is 39.5% above $86.')), ['equity', 'TXG', 87, 120, true, false]);
  assert.deepEqual(eq(parse('@everyone CJMB enter $2 pt 2.44 plus')), ['equity', 'CJMB', 2, 2.44, true, false]);
  assert.deepEqual(eq(parse('@everyone SNEX $137 (pre split) pt $180 plus')), ['equity', 'SNEX', 137, 180, true, false]);
  assert.deepEqual(eq(parse('@everyone 🔥 ' + bold('BTTC ENTRY $0.54 | PT $0.68+ (HIGH RISK DAY TRADE)') + ' 🔥 📈 ' + bold('SETUP') + ': BTTC showing sharp intraday volatility')), ['equity', 'BTTC', 0.54, 0.68, true, false]);
  assert.deepEqual(eq(parse('@everyone ' + bold('MX ENTRY $4.04 | PT $5.00 (SWING TRADE) DISTANCE') + ': $5 sits above current range')), ['equity', 'MX', 4.04, 5, false, false]);
});

test('real channel formats: short sales are captured but held for review', () => {
  const a = parse('@everyone ' + bold('IONS ENTRY $45.58 PT $32 & LOWER (SHORT SALE) DISTANCE: $32 IS ABOUT 30% BELOW $45.58'));
  assert.deepEqual([eq(a), a.direction], [['equity', 'IONS', 45.58, 32, false, true], 'short']);
  const b = parse('@everyone ' + bold('SMX ENTRY $7.20 | PT $4.88 OR LOWER (SHORT SALE) SETUP') + ': Clean breakdown structure');
  assert.deepEqual([eq(b), b.direction], [['equity', 'SMX', 7.2, 4.88, false, true], 'short']);
});

test('real channel chatter, target updates and status posts stay unparsed', () => {
  for (const s of [
    '@everyone 👆👆👆 DID ANYONE ORDER SOME MONEY HONEY ...spy puts to be sold',
    'Wait for retrace to 769 and re-enter puts?',
    'nahhh that would be more harm then good',
    '@everyone 🔥 ' + bold('ABAT PT SMASHED — NEW PT SET $3.08+') + ' 🔥 🎯 Original PT hit',
    '@everyone ' + bold('YMT PT SMASHED — NEW TARGET $3.00+'),
    '@everyone JLHL new pt set for 13 plus',
    '@everyone HIHO pt smahed new ot set for 1.82 plus',
    '@everyone GMEX entry pt smashed new pt set for 2.44 plus',
    '@everyone SPY CALSS ARE NOW IN THE MONEY',
    '🔥 ' + bold('SPY CALLS — GETTING RISKY') + ' 🔥',
    '@everyone SPY CALLS',
    '@everyone AEON CONSIDER PORFITS',
    '@everyone looks like a homerun to me',
    '@everyone anyone still holding the spy puts 👆👆',
    'https://cdn.discordapp.com/attachments/1/2/Easy_Money_Academy_w.gif',
    '@everyone',
  ]) assert.equal(parse(s), null, s);
});
