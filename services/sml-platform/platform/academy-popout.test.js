'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPopoutService, validModule, validSymbol } = require('./academy-popout');

const U = '100000000000000001';
const V = '100000000000000002';

test('a pop-out ticket works once, for two minutes, and carries who it was made for', () => {
  let t = 1_000_000;
  const svc = createPopoutService({ now: () => t });
  const id = svc.issueTicket({ userId: U, tier: 'academy', displayName: 'Obi' });
  assert.ok(id.length >= 40);
  assert.deepEqual(svc.consumeTicket(id), { userId: U, tier: 'academy', displayName: 'Obi', expiresAt: 1_120_000 });
  assert.equal(svc.consumeTicket(id), null, 'single use');
  const late = svc.issueTicket({ userId: U, tier: 'member' });
  t += 121_000;
  assert.equal(svc.consumeTicket(late), null, 'expired');
  assert.equal(svc.consumeTicket('nope'), null);
  assert.equal(svc.issueTicket({ userId: 'x' }), '', 'needs a real Discord id');
});

test('one member can not pile up tickets', () => {
  const svc = createPopoutService({ maxTicketsPerUser: 3 });
  for (let i = 0; i < 3; i++) assert.ok(svc.issueTicket({ userId: U, tier: 'member' }));
  assert.equal(svc.issueTicket({ userId: U, tier: 'member' }), '');
  assert.ok(svc.issueTicket({ userId: V, tier: 'member' }), 'another member is not affected');
});

test('the link bus only reaches the same member\'s windows, and is rate limited', () => {
  const svc = createPopoutService({ publishLimit: 3 });
  const mine = [], theirs = [];
  const off = svc.subscribe(U, (m) => mine.push(m));
  svc.subscribe(V, (m) => theirs.push(m));
  assert.equal(svc.publish(U, { symbol: 'nvda', from: 'w1' }), 1);
  assert.equal(mine[0].symbol, 'NVDA'); assert.equal(mine[0].from, 'w1');
  assert.equal(theirs.length, 0, 'another member never hears it');
  assert.equal(svc.publish(U, { symbol: 'bad symbol!' }), 0);
  svc.publish(U, { symbol: 'AMD' });
  assert.equal(svc.publish(U, { symbol: 'TSLA' }), -1, 'rate limited');
  off(); off();
  assert.equal(svc.stats().streams, 1);
});

test('streams are capped per member', () => {
  const svc = createPopoutService({ maxStreamsPerUser: 2 });
  assert.ok(svc.subscribe(U, () => {}));
  assert.ok(svc.subscribe(U, () => {}));
  assert.equal(svc.subscribe(U, () => {}), null);
});

test('module ids and symbols are checked', () => {
  assert.ok(validModule('scanner')); assert.ok(validModule('level-2'));
  assert.ok(!validModule('../x')); assert.ok(!validModule(''));
  assert.ok(validSymbol('brk.b')); assert.ok(!validSymbol('1ABC')); assert.ok(!validSymbol('SPY;'));
});
