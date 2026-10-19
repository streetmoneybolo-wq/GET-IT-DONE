'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommunity } = require('./academy-community');
const { createTickerTalk } = require('./academy-ticker-talk');
const { createProfilePages } = require('./academy-profile-pages');
const { createTraderAlerts } = require('./academy-trader-alerts');

const T0 = Date.UTC(2026, 9, 19, 14, 0, 0);
const ME = '100000000000000001', ACE = '200000000000000002', BEA = '300000000000000003';

async function world() {
  let clock = T0; const now = () => clock;
  const talk = createTickerTalk({ now, logger: () => {} });
  const profiles = createProfilePages({ now });
  const alerts = createTraderAlerts({ now, candles: async () => ({ bars: [{ t: clock - 90_000, o: 10, h: 10, l: 10, c: 10, v: 1 }, { t: clock - 30_000, o: 10, h: 12, l: 10, c: 11, v: 1 }] }), logger: () => {} });
  const names = async (id) => ({ [ME]: 'Me', [ACE]: 'Ace', [BEA]: 'Bea' }[id] || '');
  const c = createCommunity({ talk, alerts, profiles, names, now, logger: () => {} });
  const tick = (ms) => { clock += ms; };
  return { talk, profiles, alerts, c, tick, now };
}

test('suggest: ranked by the week, never the viewer or someone already followed, with a reason', async () => {
  const w = await world();
  const author = (id, name) => ({ id, name });
  for (let i = 0; i < 3; i++) await w.talk.post('SPY', author(ACE, 'Ace'), { body: 'SPY read ' + i }); w.tick(61_000);
  await w.talk.post('NVDA', author(BEA, 'Bea'), { body: 'NVDA read' });
  await w.alerts.post(BEA, { symbol: 'NVDA', entry: 10, targets: [12] });
  await w.profiles.follow(ME, ACE, true);
  const s = await w.c.suggest(ME);
  assert.deepEqual(s.traders.map((t) => t.id), [BEA], 'Ace is already followed; Bea posted an alert and a comment');
  assert.equal(s.traders[0].name, 'Bea'); assert.match(s.traders[0].reason, /1 alert this week · 1 comment this week/);
  assert.equal(s.following, 1);
  const anon = await w.c.suggest('');
  assert.deepEqual(anon.traders.map((t) => t.id), [BEA, ACE], 'an alert outranks comments');
  assert.equal((await w.c.suggest(BEA)).traders.some((t) => t.id === BEA), false, 'never yourself');
});

test('following: one stream of comments and alerts from the people a member follows; follow does both follows', async () => {
  const w = await world();
  const r = await w.c.follow(ME, BEA, true);
  assert.equal(r.ok, true); assert.equal(r.following, true); assert.equal(r.followers, 1);
  assert.deepEqual(await w.profiles.followers(BEA), [ME]); assert.equal((await w.alerts.followState(ME, BEA)).following, true);
  assert.equal((await w.c.follow(ME, ME)).error, 'invalid_user');
  await w.talk.post('SPY', { id: BEA, name: 'Bea' }, { body: 'SPY is heavy' }); w.tick(61_000);
  await w.alerts.post(BEA, { symbol: 'AMD', entry: 10, targets: [12] }); w.tick(1_000);
  await w.talk.post('TSLA', { id: ACE, name: 'Ace' }, { body: 'not followed' });
  const f = await w.c.following(ME);
  assert.equal(f.following, 1); assert.deepEqual(f.items.map((i) => i.kind), ['alert', 'comment']);
  assert.equal(f.items[0].symbol, 'AMD'); assert.equal(f.items[1].body, 'SPY is heavy'); assert.equal(f.items[1].authorName, 'Bea');
  assert.deepEqual((await w.c.following(ACE)).items, [], 'Ace follows nobody');
  await w.c.follow(ME, BEA, false);
  assert.equal((await w.c.following(ME)).following, 0);
});

test('inbox: replies to my comments, new followers, targets smashed on charts I follow, only since the moment given', async () => {
  const w = await world();
  const mine = await w.talk.post('SPY', { id: ME, name: 'Me' }, { body: 'my read' }); w.tick(61_000);
  await w.c.follow(ME, BEA, true);
  const sinceIso = new Date(w.now()).toISOString(); w.tick(1_000);
  await w.talk.post('SPY', { id: ACE, name: 'Ace' }, { body: 'reply from Ace', parentId: mine.comment.id }); w.tick(61_000);
  await w.talk.post('SPY', { id: ME, name: 'Me' }, { body: 'my own reply', parentId: mine.comment.id }); w.tick(61_000);
  await w.profiles.follow(ACE, ME, true); w.tick(1_000);
  const al = await w.alerts.post(BEA, { symbol: 'AMD', entry: 10, targets: [12] }); w.tick(1_000);
  await w.alerts.update(BEA, al.alert.id, { kind: 'pt_hit', targetIndex: 0, price: 12, body: 'smashed' });
  const inbox = await w.c.inbox(ME, { since: sinceIso });
  assert.deepEqual(inbox.events.map((e) => e.kind), ['pt_hit', 'alert', 'follow', 'reply']);
  assert.equal(inbox.events[3].fromName, 'Ace'); assert.equal(inbox.events[3].rootId, mine.comment.id);
  assert.equal(inbox.events[2].from, ACE); assert.equal(inbox.events[2].fromName, 'Ace');
  assert.equal(inbox.events[0].symbol, 'AMD'); assert.equal(inbox.events[0].pct, 20);
  const later = await w.c.inbox(ME, { since: new Date(w.now() + 1).toISOString() });
  assert.deepEqual(later.events, [], 'nothing new after the moment given');
  assert.equal((await w.c.inbox('bad')).error, 'invalid_user');
});
