'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProfileWall, cleanBody } = require('./academy-profile-wall');

const A = '100000000000000001', B = '100000000000000002', OWN = '100000000000000009';

test('bodies are plain, bounded text', () => {
  assert.equal(cleanBody('  hi\u0000 there   <b>x</b>\n\n\n\nmore '), 'hi there <b>x</b>\n\nmore');
  assert.equal(cleanBody('x'.repeat(600)).length, 500);
  assert.equal(cleanBody('   '), '');
});

test('members post on a wall, newest first, with paging and a count', async () => {
  let t = 1_800_000_000_000;
  const wall = createProfileWall({ now: () => t });
  assert.equal((await wall.post(A, 'bad', 'Ben', 'x')).error, 'invalid_user');
  assert.equal((await wall.post(A, B, 'Ben', '   ')).error, 'empty');
  const first = await wall.post(A, B, 'Ben <script>', 'Great entry on SPY');
  assert.equal(first.ok, true); assert.equal(first.item.authorName, 'Ben script'); assert.equal(first.item.profileId, A);
  t += 30_000; await wall.post(A, B, 'Ben', 'second');
  t += 30_000; await wall.post(A, A, 'Ana', 'thanks');
  const page = await wall.list(A, { limit: 2 });
  assert.deepEqual(page.items.map((c) => c.body), ['thanks', 'second']); assert.equal(page.count, 3); assert.equal(page.more, true);
  const older = await wall.list(A, { limit: 2, before: page.items[1].id });
  assert.deepEqual(older.items.map((c) => c.body), ['Great entry on SPY']); assert.equal(older.more, false);
  assert.equal((await wall.list(B)).count, 0);
});

test('a double tap is not a second comment, and posting is rate limited per author', async () => {
  let t = 1_800_000_000_000;
  const wall = createProfileWall({ now: () => t, perMinute: 2, perHour: 3 });
  const one = await wall.post(A, B, 'Ben', 'same words');
  const again = await wall.post(A, B, 'Ben', 'same words');
  assert.equal(again.duplicate, true); assert.equal(again.item.id, one.item.id);
  assert.equal((await wall.list(A)).count, 1);
  t += 1000; await wall.post(A, B, 'Ben', 'two');
  t += 1000; assert.equal((await wall.post(A, B, 'Ben', 'three')).error, 'slow_down');
  t += 61_000; await wall.post(A, B, 'Ben', 'three');
  t += 61_000; assert.equal((await wall.post(A, B, 'Ben', 'four')).error, 'too_many_today');
  t += 3_600_001; assert.equal((await wall.post(A, B, 'Ben', 'four')).ok, true);
});

test('author, wall owner and elevated callers can remove; others cannot; removed comments disappear', async () => {
  const wall = createProfileWall();
  const c = (await wall.post(A, B, 'Ben', 'hello')).item;
  assert.equal((await wall.remove(c.id, OWN)).error, 'forbidden');
  assert.equal((await wall.remove(c.id, OWN, { elevated: true })).ok, true);
  assert.equal((await wall.remove(c.id, B)).error, 'not_found');
  const d = (await wall.post(A, B, 'Ben', 'again')).item;
  assert.equal((await wall.remove(d.id, A)).ok, true, 'the wall owner may remove');
  const e = (await wall.post(B, A, 'Ana', 'on Ben\'s wall')).item;
  assert.equal((await wall.remove(e.id, A)).ok, true, 'the author may remove');
  assert.equal((await wall.list(A)).count, 0);
});

test('with a database every path goes through SQL', async () => {
  const rows = []; let id = 0;
  const pool = { query: async (sql, p) => {
    if (/INSERT INTO academy_profile_wall/.test(sql)) { const r = { id: String(++id), profile_id: p[0], author_id: p[1], author_name: p[2], body: p[3], created_at: new Date(1_800_000_000_000 + id), deleted_at: null }; rows.push(r); return { rows: [r] }; }
    if (/SELECT count/.test(sql)) return { rows: [{ n: rows.filter((r) => r.profile_id === p[0] && !r.deleted_at).length }] };
    if (/WHERE profile_id=\$1 AND author_id=\$2/.test(sql)) { const m = rows.filter((r) => r.profile_id === p[0] && r.author_id === p[1] && !r.deleted_at); return { rows: m.slice(-1) }; }
    if (/WHERE profile_id=\$1 AND deleted_at IS NULL/.test(sql)) { const m = rows.filter((r) => r.profile_id === p[0] && !r.deleted_at && (!p[2] || Number(r.id) < Number(p[2]))).sort((a, b) => Number(b.id) - Number(a.id)); return { rows: m.slice(0, p[1]) }; }
    if (/WHERE id=\$1 AND deleted_at IS NULL/.test(sql)) return { rows: rows.filter((r) => r.id === p[0] && !r.deleted_at) };
    if (/UPDATE academy_profile_wall SET deleted_at/.test(sql)) { const r = rows.find((x) => x.id === p[0]); if (r) { r.deleted_at = new Date(); r.deleted_by = p[1]; } return { rows: [] }; }
    if (/CREATE/.test(sql)) return { rows: [] };
    throw new Error('unexpected sql: ' + sql);
  } };
  const wall = createProfileWall({ pool });
  await wall.ensureSchema();
  const c = await wall.post(A, B, 'Ben', 'db hello');
  assert.equal(c.ok, true); assert.equal(c.item.id, '1'); assert.equal(c.item.createdAt, new Date(1_800_000_000_001).toISOString());
  await wall.post(A, B, 'Ben', 'db two');
  const page = await wall.list(A, { limit: 1 });
  assert.deepEqual([page.items[0].body, page.count, page.more], ['db two', 2, true]);
  assert.equal((await wall.list(A, { limit: 1, before: page.items[0].id })).items[0].body, 'db hello');
  assert.equal((await wall.remove('1', OWN)).error, 'forbidden');
  assert.equal((await wall.remove('1', A)).ok, true);
  assert.equal((await wall.list(A)).count, 1);
});
