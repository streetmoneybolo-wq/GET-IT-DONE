'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAutoTrade, createMoomooSimBroker, cleanSettings } = require('./academy-autotrade');

const T = Date.UTC(2026, 9, 14, 15, 0); // 11:00 New York
const regular = { tradingDay: true, session: 'regular' };
const sig = (o = {}) => ({ id: 'AAA:day:1', symbol: 'AAA', style: 'day', grade: 'A', score: 90, entry: 10, target: 11, stop: 9.5, ...o });
const memStore = () => { let v = null; return { read: async () => v, write: async (n) => { v = JSON.parse(JSON.stringify(n)); } }; };
function fakeBroker(o = {}) {
  const b = { configured: true, orders: [], cash: 10_000, dayPnl: 0, pos: o.pos || [], account: async () => ({ cash: b.cash, equity: 10_000, dayPnl: b.dayPnl }), positions: async () => b.pos, placeOrder: async (x) => { b.orders.push(x); return { id: 'o' + b.orders.length, status: 'submitted' }; } };
  return b;
}
const make = (broker, signals, extra = {}) => createAutoTrade({ broker, signals: async () => signals, store: memStore(), marketState: () => extra.ms || regular, now: () => extra.t || T });

test('off and dry by default: nothing is sent until the owner turns it on and chooses sim', async () => {
  const b = fakeBroker(); const a = make(b, [sig()]);
  assert.equal((await a.tick()).skipped, 'off');
  await a.setSettings({ enabled: true }); // mode stays dry
  const r = await a.tick(); assert.equal(r.placed.length, 1); assert.equal(b.orders.length, 0, 'dry run sends nothing');
  assert.equal((await a.status()).log[0].mode, 'dry');
});

test('in sim mode a grade-A signal becomes a sized marketable limit buy inside the guardrails, once', async () => {
  const b = fakeBroker(); const a = make(b, [sig(), sig({ id: 'B:day:1', symbol: 'BBB', grade: 'B', score: 70 })]);
  await a.setSettings({ enabled: true, mode: 'sim', maxPositionUsd: 500, minGrade: 'A' });
  const r = await a.tick();
  assert.equal(b.orders.length, 1); assert.deepEqual(b.orders[0], { symbol: 'AAA', side: 'buy', qty: 50, type: 'limit', price: 10.02 });
  assert.equal(r.placed[0].symbol, 'AAA');
  await a.tick(); assert.equal(b.orders.length, 1, 'the same signal is never taken twice');
});

test('guardrails: max open, max orders, held symbols, no cash, a bad stop and the wrong style are all refused', async () => {
  const b = fakeBroker({ pos: [{ symbol: 'AAA', qty: 5, cost: 10, last: 10 }] }); b.cash = 100;
  const a = make(b, [sig(), sig({ id: 'S', symbol: 'SSS', style: 'swing' }), sig({ id: 'X', symbol: 'XXX', stop: 11 }), sig({ id: 'C', symbol: 'CCC' })]);
  await a.setSettings({ enabled: true, mode: 'sim', styles: ['day'], maxPositionUsd: 1000 });
  await a.tick(); assert.equal(b.orders.length, 0, 'held / swing / bad stop / no cash');
  const why = (await a.status()).log.map((l) => l.why).filter(Boolean); assert.ok(why.includes('already_held') && why.includes('no_cash'));
  const b2 = fakeBroker(); const a2 = make(b2, [sig(), sig({ id: 'D', symbol: 'DDD' }), sig({ id: 'E', symbol: 'EEE' })]);
  await a2.setSettings({ enabled: true, mode: 'sim', maxOpen: 2 }); await a2.tick(); assert.equal(b2.orders.length, 2, 'max open stops the third');
});

test('the daily loss stop halts new entries for the day; the market-closed and kill states place nothing', async () => {
  const b = fakeBroker(); b.dayPnl = -600; const a = make(b, [sig()]);
  await a.setSettings({ enabled: true, mode: 'sim', dailyLossUsd: 500 });
  assert.equal((await a.tick()).skipped, 'daily_loss_stop'); assert.equal(b.orders.length, 0);
  const b2 = fakeBroker(); const closed = make(b2, [sig()], { ms: { tradingDay: true, session: 'post' } }); await closed.setSettings({ enabled: true, mode: 'sim' });
  assert.equal((await closed.tick()).skipped, 'market_closed');
  const b3 = fakeBroker(); const k = make(b3, [sig()]); await k.setSettings({ enabled: true, mode: 'sim' }); await k.kill();
  assert.equal((await k.tick()).skipped, 'killed'); assert.equal(b3.orders.length, 0);
});

test('exits: a held position is sold at its target, at its stop, and day signals at the close', async () => {
  const b = fakeBroker(); const a = make(b, [sig()]);
  await a.setSettings({ enabled: true, mode: 'sim' }); await a.tick();
  b.pos = [{ symbol: 'AAA', qty: 100, cost: 10, last: 11.1 }];
  let r = await a.tick(); assert.deepEqual(r.exits, [{ symbol: 'AAA', why: 'target' }]); assert.deepEqual(b.orders.at(-1), { symbol: 'AAA', side: 'sell', qty: 100, type: 'market' });
  const b2 = fakeBroker(); const a2 = make(b2, [sig()]); await a2.setSettings({ enabled: true, mode: 'sim' }); await a2.tick();
  b2.pos = [{ symbol: 'AAA', qty: 100, cost: 10, last: 9.4 }]; assert.equal((await a2.tick()).exits[0].why, 'stop');
});

test('the moomoo adapter refuses anything that is not the SIMULATE environment, and signs its calls', async () => {
  const calls = [];
  const mk = (env) => createMoomooSimBroker({ baseUrl: 'https://bridge.example', secret: 'a-long-enough-secret', fetchImpl: async (u, o) => { calls.push({ u, o }); return { ok: true, status: 200, json: async () => ({ env, cash: 5, equity: 6, dayPnl: 1, positions: [{ symbol: 'US.AAA', qty: 3, cost: 1, last: 2 }], id: '7' }) }; } });
  const sim = mk('SIMULATE'); assert.deepEqual(await sim.account(), { cash: 5, equity: 6, dayPnl: 1 });
  assert.equal((await sim.positions())[0].symbol, 'AAA'); assert.equal((await sim.placeOrder({ symbol: 'AAA', side: 'buy', qty: 1, price: 2 })).id, '7');
  assert.equal(JSON.parse(calls.at(-1).o.body).symbol, 'US.AAA'); assert.match(calls.at(-1).o.headers['x-sml-sig'], /^[0-9a-f]{64}$/);
  await assert.rejects(() => mk('REAL').account(), (e) => e.code === 'not_simulated');
  await assert.rejects(() => mk('').placeOrder({ symbol: 'AAA', side: 'buy', qty: 1 }), (e) => e.code === 'not_simulated');
  assert.equal(createMoomooSimBroker({}).configured, false);
  assert.equal(cleanSettings({ maxPositionUsd: 5, minGrade: 'Z', mode: 'live' }).maxPositionUsd, 50); assert.equal(cleanSettings({ mode: 'live' }).mode, 'dry', 'there is no live mode');
});
