'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSocialNotify } = require('./academy-social-notify');
const { createTickerTalk } = require('./academy-ticker-talk');
const { createProfileWall } = require('./academy-profile-wall');
const { createProfilePages } = require('./academy-profile-pages');

const A = '100000000000000001', B = '100000000000000002', C = '100000000000000003';

function build(t0 = 1_700_000_000_000) {
  let t = t0;
  const now = () => t;
  const talk = createTickerTalk({ now });
  const wall = createProfileWall({ now });
  const profiles = createProfilePages({ now, wall, talk: () => talk });
  const names = async (id) => ({ [A]: 'Ava', [B]: 'Ben', [C]: 'Cy' }[id] || '');
  const n = createSocialNotify({ profiles, talk, wall, names, now });
  return { n, talk, wall, profiles, tick: (ms) => { t += ms; } };
}

test('a follow, a wall comment, a like and a reply each land in the right inbox, never your own, once per ten minutes', async () => {
  const { n, talk, wall, tick } = build();
  const f = await n.follow(A, B);
  assert.equal(f.ok, true); assert.equal(f.item.kind, 'follow'); assert.equal(f.item.actorName, 'Ava');
  assert.equal((await n.follow(A, B)).skipped, 'duplicate', 'follow, unfollow, follow again is one notification');
  assert.equal((await n.follow(A, A)).skipped, 'self');
  const w = await wall.post(B, A, 'Ava', 'nice calls this week');
  const wc = await n.wallComment(B, w.item);
  assert.equal(wc.item.kind, 'wall_comment'); assert.equal(wc.item.body, 'nice calls this week'); assert.equal(wc.item.ref.profileId, B);
  const own = await wall.post(B, B, 'Ben', 'my own wall'); assert.equal((await n.wallComment(B, own.item)).skipped, 'self');
  const c = await talk.post('NVDA', { id: B, name: 'Ben' }, { body: 'holding into the close' });
  const l = await n.like('talk', c.comment.id, { id: A, name: 'Ava' }, true);
  assert.equal(l.ok, true); assert.equal(l.liked, true); assert.equal(l.likes, 1);
  assert.equal((await n.like('talk', c.comment.id, { id: A, name: 'Ava' }, true)).likes, 1, 'a second tap does not double count');
  const self = await n.like('talk', c.comment.id, { id: B }, true); assert.equal(self.likes, 2);
  const r = await talk.post('NVDA', { id: C, name: 'Cy' }, { body: 'same here', parentId: c.comment.id });
  await n.reply(B, r.comment);
  const box = await n.list(B);
  assert.deepEqual(box.items.map((x) => x.kind), ['reply', 'like', 'wall_comment', 'follow']);
  assert.equal(box.unread, 4); assert.equal(box.items[1].actorName, 'Ava'); assert.equal(box.items[1].ref.symbol, 'NVDA'); assert.equal(box.items[1].body, 'holding into the close');
  assert.equal((await n.list(A)).items.length, 0, 'Ava hears nothing about her own actions');
  assert.equal((await n.like('talk', c.comment.id, { id: A }, false)).likes, 1, 'unlike');
  const counts = await n.likesFor('talk', [c.comment.id, '999'], B);
  assert.deepEqual(counts, { [c.comment.id]: { likes: 1, liked: true }, 999: { likes: 0, liked: false } });
  assert.equal((await n.like('talk', '999', { id: A })).error, 'not_found');
  assert.equal((await n.like('nope', '1', { id: A })).error, 'invalid_like');
  tick(11 * 60_000);
  assert.equal((await n.follow(A, B)).item.kind, 'follow', 'after ten minutes a fresh follow is news again');
});

test('a post fans out to every follower of its author; reads and paging work; each member keeps the newest rows', async () => {
  const { n, profiles } = build();
  await profiles.follow(B, A); await profiles.follow(C, A);
  const r = await n.followedPost({ id: A, name: 'Ava' }, { source: 'talk', id: '12', symbol: 'tsla', body: 'breaking out' });
  assert.equal(r.sent, 2); assert.equal(r.followers, 2);
  const chat = await n.followedPost({ id: A }, { source: 'chat', id: '77', room: 'day-trading', body: 'morning' });
  assert.equal(chat.sent, 2);
  const bb = await n.list(B);
  assert.equal(bb.items.length, 2); assert.equal(bb.items[0].ref.source, 'chat'); assert.equal(bb.items[0].ref.room, 'day-trading'); assert.equal(bb.items[1].ref.symbol, 'TSLA'); assert.equal(bb.items[1].actorName, 'Ava');
  assert.equal((await n.list(A)).items.length, 0, 'the author is not their own follower');
  const one = await n.markRead(B, { ids: [bb.items[0].id] }); assert.equal(one.unread, 1);
  const page = await n.list(B, { limit: 1 }); assert.equal(page.more, true); assert.equal(page.items[0].read, true);
  const older = await n.list(B, { limit: 1, before: page.items[0].id }); assert.equal(older.items[0].id, bb.items[1].id); assert.equal(older.more, false);
  assert.equal((await n.markRead(B, { all: true })).unread, 0);
  assert.equal(await n.unread(C), 2);
  const small = createSocialNotify({ keep: 3, now: () => 1 });
  for (let i = 0; i < 5; i++) await small.add({ userId: B, kind: 'follow', actor: { id: String(100000000000000010 + i) }, ref: { id: String(i) } });
  assert.equal((await small.list(B)).items.length, 3);
  assert.equal((await small.add({ userId: 'x', kind: 'follow' })).ok, false);
  assert.equal((await small.add({ userId: B, kind: 'what' })).ok, false);
});

test('wall likes notify the wall comment author with the wall they sit on', async () => {
  const { n, wall } = build();
  const w = await wall.post(C, A, 'Ava', 'great thread');
  const l = await n.like('wall', w.item.id, { id: B, name: 'Ben' });
  assert.equal(l.likes, 1);
  const box = await n.list(A);
  assert.equal(box.items[0].kind, 'like'); assert.equal(box.items[0].ref.kind, 'wall'); assert.equal(box.items[0].ref.profileId, C); assert.equal(box.items[0].actorName, 'Ben');
  assert.equal(await wall.get('999'), null); assert.equal((await wall.get(w.item.id)).body, 'great thread');
});
