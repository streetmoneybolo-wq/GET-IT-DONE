'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatStore, createChatHub, CHANNELS, MAX_BODY } = require('./academy-chat');

const U1 = '200000000000000001', U2 = '200000000000000002';

/* A fake connection: just records what was sent to it, in order, parsed back to objects. */
function fakeConn() {
  const sent = [];
  return { send: (json) => sent.push(JSON.parse(json)), sent };
}
function fakeVerify(map) {
  return (authorization) => {
    const token = /^Bearer\s+(\S+)$/i.exec(String(authorization || ''));
    const session = token && map[token[1]];
    return session ? { ok: true, ...session } : { ok: false, status: 401, code: 'authorization_required' };
  };
}

test('the four trading-style channels are fixed and named', () => {
  assert.deepEqual(CHANNELS.map((c) => c.key), ['day', 'swing', 'short', 'options']);
  assert.ok(CHANNELS.every((c) => c.label));
});

test('a bad token is refused; a good one authenticates to that member', () => {
  const hub = createChatHub({ store: createChatStore(), verifySession: fakeVerify({ good: { userId: U1, tier: 'member' } }) });
  assert.equal(hub.authenticate('bad'), null);
  assert.deepEqual(hub.authenticate('good'), { userId: U1, tier: 'member' });
});

test('joining sends channel history, and posting broadcasts only to members currently in that channel', async () => {
  const store = createChatStore();
  const hub = createChatHub({ store, verifySession: fakeVerify({ t1: { userId: U1 }, t2: { userId: U2 } }) });
  const a = fakeConn(), b = fakeConn();
  const ha = hub.open(a, { ...hub.authenticate('t1'), authorName: 'Ace' });
  const hb = hub.open(b, { ...hub.authenticate('t2'), authorName: 'Bo' });

  await ha.receive(JSON.stringify({ type: 'join', channel: 'day' }));
  await hb.receive(JSON.stringify({ type: 'join', channel: 'swing' }));
  assert.deepEqual(a.sent[0], { type: 'history', channel: 'day', messages: [] });
  assert.deepEqual(b.sent[0], { type: 'history', channel: 'swing', messages: [] });

  await ha.receive(JSON.stringify({ type: 'message', body: 'SPY breaking out' }));
  assert.equal(a.sent[1].type, 'message');
  assert.equal(a.sent[1].message.body, 'SPY breaking out');
  assert.equal(a.sent[1].message.authorName, 'Ace');
  assert.equal(b.sent.length, 1, 'the swing-channel member never sees a day-channel post');

  // b switches into 'day' and immediately gets its history, including the post that already happened
  await hb.receive(JSON.stringify({ type: 'join', channel: 'day' }));
  const lastForB = b.sent[b.sent.length - 1];
  assert.equal(lastForB.type, 'history');
  assert.equal(lastForB.messages.length, 1);
  assert.equal(lastForB.messages[0].body, 'SPY breaking out');
});

test('an unknown channel, an empty body and a too-long body are all rejected', async () => {
  const hub = createChatHub({ store: createChatStore(), verifySession: fakeVerify({ t: { userId: U1 } }) });
  const conn = fakeConn();
  const h = hub.open(conn, { ...hub.authenticate('t'), authorName: 'Ace' });
  await h.receive(JSON.stringify({ type: 'join', channel: 'nope' }));
  assert.deepEqual(conn.sent.at(-1), { type: 'error', error: 'unknown_channel' });
  await h.receive(JSON.stringify({ type: 'message', body: 'hi' }));
  assert.deepEqual(conn.sent.at(-1), { type: 'error', error: 'join_first' }, 'no channel joined yet');
  await h.receive(JSON.stringify({ type: 'join', channel: 'day' }));
  await h.receive(JSON.stringify({ type: 'message', body: '   ' }));
  assert.deepEqual(conn.sent.at(-1), { type: 'error', error: 'empty_message' });
  await h.receive(JSON.stringify({ type: 'message', body: 'x'.repeat(MAX_BODY + 50) }));
  assert.equal(conn.sent.at(-1).message.body.length, MAX_BODY);
});

test('a member is rate-limited after too many messages in the window, and it clears once the window passes', async () => {
  let clock = 0;
  const hub = createChatHub({ store: createChatStore(), verifySession: fakeVerify({ t: { userId: U1 } }), now: () => clock, rateLimit: 3, rateWindowMs: 1000 });
  const conn = fakeConn();
  const h = hub.open(conn, { ...hub.authenticate('t'), authorName: 'Ace' });
  await h.receive(JSON.stringify({ type: 'join', channel: 'day' }));
  for (let i = 0; i < 3; i++) await h.receive(JSON.stringify({ type: 'message', body: 'm' + i }));
  assert.notEqual(conn.sent.at(-1).type, 'error', 'the first 3 within the limit go through');
  await h.receive(JSON.stringify({ type: 'message', body: 'm4' }));
  assert.deepEqual(conn.sent.at(-1), { type: 'error', error: 'rate_limited' });
  clock += 1001;
  await h.receive(JSON.stringify({ type: 'message', body: 'm5' }));
  assert.notEqual(conn.sent.at(-1).type, 'error', 'the window has passed');
});

test('a member can delete only their own message, and the deletion is broadcast', async () => {
  const store = createChatStore();
  const hub = createChatHub({ store, verifySession: fakeVerify({ t1: { userId: U1 }, t2: { userId: U2 } }) });
  const a = fakeConn(), b = fakeConn();
  const ha = hub.open(a, { ...hub.authenticate('t1'), authorName: 'Ace' });
  const hb = hub.open(b, { ...hub.authenticate('t2'), authorName: 'Bo' });
  await ha.receive(JSON.stringify({ type: 'join', channel: 'options' }));
  await hb.receive(JSON.stringify({ type: 'join', channel: 'options' }));
  await ha.receive(JSON.stringify({ type: 'message', body: 'IV crush incoming' }));
  const id = a.sent.at(-1).message.id;

  await hb.receive(JSON.stringify({ type: 'delete', id }));
  assert.deepEqual(b.sent.at(-1), { type: 'error', error: 'not_found' }, 'bo did not author it');

  await ha.receive(JSON.stringify({ type: 'delete', id }));
  assert.deepEqual(a.sent.at(-1), { type: 'deleted', channel: 'options', id: String(id) });
  assert.deepEqual(b.sent.at(-1), { type: 'deleted', channel: 'options', id: String(id) }, 'broadcast to everyone in the channel, not just the author');
});

test('closing a connection drops it from its channel so it stops receiving broadcasts', async () => {
  const store = createChatStore();
  const hub = createChatHub({ store, verifySession: fakeVerify({ t1: { userId: U1 }, t2: { userId: U2 } }) });
  const a = fakeConn(), b = fakeConn();
  const ha = hub.open(a, { ...hub.authenticate('t1'), authorName: 'Ace' });
  const hb = hub.open(b, { ...hub.authenticate('t2'), authorName: 'Bo' });
  await ha.receive(JSON.stringify({ type: 'join', channel: 'short' }));
  await hb.receive(JSON.stringify({ type: 'join', channel: 'short' }));
  ha.onClose();
  await hb.receive(JSON.stringify({ type: 'message', body: 'still here' }));
  assert.equal(a.sent.length, 1, 'a only ever got its own join history, nothing after closing');
});

test('the store keeps history per channel and only its author can remove a message', async () => {
  const store = createChatStore();
  await store.add({ channel: 'day', discordId: U1, authorName: 'Ace', body: 'one' });
  const two = await store.add({ channel: 'day', discordId: U1, authorName: 'Ace', body: 'two' });
  await store.add({ channel: 'swing', discordId: U2, authorName: 'Bo', body: 'unrelated' });
  assert.deepEqual((await store.history('day')).map((m) => m.body), ['one', 'two']);
  assert.equal(await store.remove({ id: two.id, discordId: U2 }), null, 'wrong author');
  assert.equal(await store.remove({ id: two.id, discordId: U1 }), 'day');
  assert.deepEqual((await store.history('day')).map((m) => m.body), ['one']);
});
