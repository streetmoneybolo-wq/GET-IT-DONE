'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const paper = require('./academy-paper');

const REG = Date.UTC(2026, 9, 14, 15, 0, 0); // Wed 2026-10-14 11:00 ET
const PRE = Date.UTC(2026, 9, 14, 11, 0, 0); // 7:00 ET
const NIGHT = Date.UTC(2026, 9, 15, 3, 0, 0); // 23:00 ET on the 14th
const D = 86_400_000;

test('stock: buy lifts the ask, sell hits the bid, average price, realized P&L and fees, no borrowing', () => {
  const a = paper.createAccount('u:1', { cash: 1000, now: REG });
  const r1 = paper.placeOrder(a, { kind: 'stock', symbol: 'aapl', side: 'buy', qty: 2 }, { bid: 99.9, ask: 100.1, last: 100 }, REG);
  assert.equal(r1.ok, true); assert.equal(r1.trade.price, 100.1); assert.equal(a.cash, 799.8); assert.equal(a.positions.AAPL.qty, 2);
  const r2 = paper.placeOrder(a, { kind: 'stock', symbol: 'AAPL', side: 'buy', qty: 2 }, { bid: 101.9, ask: 102.1 }, REG + 60_000);
  assert.equal(a.positions.AAPL.avg, 101.1); assert.equal(a.positions.AAPL.qty, 4);
  assert.equal(paper.placeOrder(a, { kind: 'stock', symbol: 'AAPL', side: 'buy', qty: 100 }, { ask: 102 }, REG).error, 'insufficient_cash');
  const r3 = paper.placeOrder(a, { kind: 'stock', symbol: 'AAPL', side: 'sell', qty: 3 }, { bid: 105, ask: 105.2 }, REG + 120_000);
  assert.equal(r3.ok, true); assert.equal(r3.realized, 11.7, '(105 - 101.1) x 3'); assert.equal(a.positions.AAPL.qty, 1);
  assert.equal(a.daily['2026-10-14'].realized, 11.7); assert.equal(a.daily['2026-10-14'].trades, 3);
  assert.ok(r2.trade.opening && !r3.trade.opening);
});

test('sessions: pre-market fills from last with slippage, options are regular-session only, nothing at night', () => {
  const a = paper.createAccount('u:2', { cash: 5000, now: PRE });
  const pre = paper.placeOrder(a, { kind: 'stock', symbol: 'TSLA', side: 'buy', qty: 1 }, { last: 200 }, PRE);
  assert.equal(pre.ok, true); assert.equal(pre.trade.session, 'pre'); assert.equal(pre.trade.price, 200.1, '5 bps slippage on last');
  assert.equal(paper.placeOrder(a, { kind: 'option', symbol: 'TSLA', side: 'buy', qty: 1, expiry: '2026-11-20', strike: 210, right: 'C' }, { bid: 5, ask: 5.2 }, PRE).error, 'options_regular_only');
  assert.equal(paper.placeOrder(a, { kind: 'stock', symbol: 'TSLA', side: 'buy', qty: 1 }, { last: 200 }, NIGHT).error, 'market_closed');
  assert.equal(paper.placeOrder(a, { kind: 'stock', symbol: 'TSLA', side: 'buy', qty: 1 }, null, REG).error, 'no_price');
});

test('options: contracts cost per-contract fees, shorts need collateral, expiry settles at intrinsic', () => {
  const a = paper.createAccount('u:3', { cash: 3000, now: REG });
  const buy = paper.placeOrder(a, { kind: 'option', symbol: 'NVDA', side: 'buy', qty: 2, expiry: '2026-10-16', strike: 180, right: 'C' }, { bid: 3, ask: 3.2, underlying: 182 }, REG);
  assert.equal(buy.ok, true); assert.equal(buy.trade.fee, 1.3); assert.equal(a.cash, r(3000 - 3.2 * 200 - 1.3)); assert.equal(buy.position.desc, 'NVDA 2026-10-16 180 call');
  assert.equal(paper.placeOrder(a, { kind: 'option', symbol: 'NVDA', side: 'sell', qty: 50, expiry: '2026-10-16', strike: 150, right: 'P' }, { bid: 1, ask: 1.1, underlying: 182 }, REG).error, 'insufficient_collateral');
  const write = paper.placeOrder(a, { kind: 'option', symbol: 'NVDA', side: 'sell', qty: 1, expiry: '2026-10-16', strike: 20, right: 'P' }, { bid: 1, ask: 1.1, underlying: 182 }, REG);
  assert.equal(write.ok, true); assert.equal(a.positions['NVDA|2026-10-16|20|P'].qty, -1);
  const key = 'NVDA|2026-10-16|180|C';
  paper.markAccount(a, { NVDA: { last: 190 }, [key]: { bid: 10, ask: 10.4 }, 'NVDA|2026-10-16|150|P': { bid: 0.05, ask: 0.1 } }, REG + 60_000);
  assert.equal(a.positions[key].mark, 10.2);
  const s = paper.summary(a, REG + 60_000); assert.ok(s.unrealized > 1300 && s.equity > 3000);
  // the Friday passes: the call is 10 in the money, the put is worthless
  paper.markAccount(a, { NVDA: { last: 190 } }, REG + 3 * D);
  assert.ok(!a.positions[key] && !a.positions['NVDA|2026-10-16|20|P'], 'both settled');
  const settled = a.trades.filter((t) => t.session === 'settlement'); assert.equal(settled.length, 2);
  assert.equal(settled.find((t) => t.desc.includes('call')).realized, r((10 - 3.2) * 200)); assert.equal(settled.find((t) => t.desc.includes('put')).realized, r((0 - 1) * 100 * -1));
  assert.equal(a.cash, r(3000 - 3.2 * 200 - 1.3 + 1 * 100 - 0.65 + 10 * 200));
});

test('short stock: proceeds credited, liability marked, buy-back realizes', () => {
  const a = paper.createAccount('u:4', { cash: 1000, now: REG });
  const sh = paper.placeOrder(a, { kind: 'stock', symbol: 'XYZ', side: 'sell', qty: 5 }, { bid: 100, ask: 100.2 }, REG);
  assert.equal(sh.ok, true); assert.equal(a.positions.XYZ.qty, -5); assert.equal(a.cash, 1500);
  paper.markAccount(a, { XYZ: { bid: 94, ask: 94.2 } }, REG + 60_000); assert.equal(paper.equityOf(a), r(1500 - 5 * 94.1));
  const cover = paper.placeOrder(a, { kind: 'stock', symbol: 'XYZ', side: 'buy', qty: 5 }, { bid: 94, ask: 94.2 }, REG + 120_000);
  assert.equal(cover.realized, 29); assert.equal(a.cash, 1029); assert.ok(!a.positions.XYZ);
});

test('calendar and day recap', () => {
  const a = paper.createAccount('u:5', { cash: 1000, now: REG });
  paper.placeOrder(a, { kind: 'stock', symbol: 'AAA', side: 'buy', qty: 5 }, { bid: 10, ask: 10 }, REG);
  paper.markAccount(a, { AAA: { bid: 11, ask: 11 } }, REG + 3_600_000);
  paper.placeOrder(a, { kind: 'stock', symbol: 'AAA', side: 'sell', qty: 5 }, { bid: 11, ask: 11 }, REG + 2 * 3_600_000);
  paper.markAccount(a, {}, REG + 3 * 3_600_000);
  const cal = paper.calendar(a, '2026-10'); assert.equal(cal.days.length, 1); assert.equal(cal.days[0].realized, 5); assert.equal(cal.green, 1); assert.equal(cal.best.date, '2026-10-14');
  const rec = paper.dayRecap(a, '2026-10-14', { ok: true, spyChangePct: -0.4, label: 'bearish' });
  assert.equal(rec.account.trades.length, 2); assert.ok(rec.insight.some((x) => /2 fills/.test(x))); assert.ok(rec.insight.some((x) => /beat the market/.test(x)));
  assert.ok(paper.dayRecap(a, '2026-10-01').insight.some((x) => /No activity/.test(x)));
});

test('service: load/create, order with live quotes, snapshot marks, month and day, reset', async () => {
  const saved = {}; const storeFor = (id) => ({ read: async () => saved[id] || null, write: async (v) => { saved[id] = JSON.parse(JSON.stringify(v)); } });
  const svc = paper.createPaperService({ storeFor, quote: async (s) => ({ bid: 50, ask: 50.2, last: 50.1 }), optionQuote: async (c) => ({ bid: 2, ask: 2.2 }), marketDay: async () => ({ ok: true, spyChangePct: -0.4 }), now: () => REG });
  const r1 = await svc.order('u:9', { kind: 'stock', symbol: 'MSFT', side: 'buy', qty: 4 }, { cash: 2000, name: 'Mine' });
  assert.equal(r1.ok, true); assert.equal(r1.trade.price, 50.2); assert.ok(saved['u:9'].positions.MSFT);
  const r2 = await svc.order('u:9', { kind: 'option', symbol: 'MSFT', side: 'buy', qty: 1, expiry: '2026-12-18', strike: 55, right: 'C' });
  assert.equal(r2.ok, true); assert.equal(r2.trade.price, 2.2);
  const snap = await svc.snapshot('u:9'); assert.equal(snap.simulated, true); assert.equal(snap.summary.positions.length, 2); assert.equal(snap.name, 'Mine');
  const m = await svc.month('u:9', '2026-10'); assert.equal(m.days.length, 1);
  const d = await svc.day('u:9', '2026-10-14'); assert.equal(d.market.spyChangePct, -0.4); assert.equal(d.account.trades.length, 2);
  const after = await svc.reset('u:9', { cash: 1000 }); assert.equal(after.summary.equity, 1000);
  assert.equal((await svc.order('u:9', { kind: 'stock', symbol: 'bad symbol', side: 'buy', qty: 1 })).error, 'invalid_symbol');
});

function r(v) { return Math.round(v * 100) / 100; }

test('every member starts with $25,000; an account opened at the old $1,000 is topped up once, as a deposit; the challenge account is left alone', async () => {
  assert.equal(paper.RULES.startCash, 25_000);
  const fresh = paper.createAccount('u:new', { now: REG });
  assert.equal(fresh.cash, 25_000); assert.equal(fresh.startCash, 25_000); assert.equal(fresh.deposits[0].amount, 25_000);
  const old = paper.createAccount('u:old', { cash: 1000, now: REG - 10 * D }); old.cash = 1234.56; // traded for a while at the old start
  const challenge = paper.createAccount('challenge', { cash: 1000, now: REG - 10 * D });
  const saved = { 'u:old': JSON.parse(JSON.stringify(old)), challenge: JSON.parse(JSON.stringify(challenge)) };
  const storeFor = (id) => ({ read: async () => saved[id] || null, write: async (v) => { saved[id] = JSON.parse(JSON.stringify(v)); } });
  const svc = paper.createPaperService({ storeFor, quote: async () => ({ bid: 50, ask: 50.2, last: 50.1 }), now: () => REG });
  const a = await svc.load('u:old');
  assert.equal(a.cash, 25_234.56); assert.equal(a.startCash, 25_000);
  assert.equal(a.deposits.filter((d) => d.kind === 'start-adjust').length, 1, 'one top-up deposit of the difference');
  assert.equal(a.deposits.find((d) => d.kind === 'start-adjust').amount, 24_000);
  assert.equal(saved['u:old'].cash, 25_234.56, 'persisted');
  const s = paper.summary(a, REG); assert.equal(s.deposited, 25_000); assert.equal(s.pnl, 234.56, 'P&L is measured against everything deposited, so the top-up is not a gain');
  const svc2 = paper.createPaperService({ storeFor, quote: async () => ({ bid: 50, ask: 50.2 }), now: () => REG + D });
  const again = await svc2.load('u:old'); assert.equal(again.deposits.filter((d) => d.kind === 'start-adjust').length, 1, 'never twice');
  const c = await svc2.load('challenge', { cash: 1000 }); assert.equal(c.cash, 1000, 'the 1K -> 100K challenge keeps its $1,000');
});
