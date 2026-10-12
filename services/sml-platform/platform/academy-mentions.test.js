'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMentionService, ACTIVE_DAYS } = require('./academy-mentions');

const G = '100000000000000001', A = '200000000000000001', B = '200000000000000002', C = '200000000000000003';
const fakeDm = (fail = new Set()) => { const sent = []; return { sent, send: async (id, content) => { sent.push({ id, content }); return fail.has(id) ? { ok: false, code: 50007 } : { ok: true, messageId: '1' }; } }; };

test('only members who signed in to the app are offered, by name fragment, prefix matches first and never the asker', async () => {
  let t = 1_000_000; const svc = createMentionService({ guildId: G, now: () => t });
  await svc.touch({ userId: A, displayName: 'Ace Trader' }); t += 1000;
  await svc.touch({ userId: B, displayName: 'Trader Bo' }); t += 1000;
  await svc.touch({ userId: C, displayName: '' }); // signed in but no name known: cannot be tagged
  assert.deepEqual(await svc.search('tra'), [{ id: B, name: 'Trader Bo' }, { id: A, name: 'Ace Trader' }]);
  assert.deepEqual(await svc.search('tra', { exclude: B }), [{ id: A, name: 'Ace Trader' }]);
  assert.deepEqual((await svc.search('')).map((u) => u.id), [B, A]);
  assert.deepEqual(await svc.search('zzz'), []);
});

test('a member not seen for a long time, or without live access, cannot be tagged any more; unknown ids are dropped', async () => {
  let t = 1_000_000; const access = new Map([[A, true], [B, false]]);
  const svc = createMentionService({ guildId: G, now: () => t, hasAccess: async (id) => access.get(id) !== false });
  await svc.touch({ userId: A, displayName: 'Ace' }); await svc.touch({ userId: B, displayName: 'Bo' });
  assert.deepEqual(await svc.resolve([A, B, '999', C]), [{ id: A, name: 'Ace' }]);
  t += (ACTIVE_DAYS + 1) * 86_400_000;
  assert.deepEqual(await svc.resolve([A]), []);
  assert.deepEqual(await svc.search('a'), []);
  await svc.touch({ userId: A }); // signed in again, name kept
  assert.deepEqual(await svc.resolve([A]), [{ id: A, name: 'Ace' }]);
});

test('a tagged member gets one DM naming the sender, room and text; the sender is never DMed; a failed DM is reported, not thrown', async () => {
  const dm = fakeDm(new Set([B])); const logs = [];
  const svc = createMentionService({ guildId: G, dm, logger: (l, e, d) => logs.push([l, e, d]), channelLabels: { day: 'Day Trade' } });
  const res = await svc.notify({ sender: { userId: A, displayName: 'Ace Trader' }, mentions: [{ id: A, name: 'Ace Trader' }, { id: B, name: 'Bo' }, { id: C, name: 'Cy' }], message: { id: 7, body: '@Bo @Cy look at   SPY' }, channel: 'day' });
  assert.deepEqual(res, { sent: [C], skipped: [A, B] });
  assert.deepEqual(dm.sent.map((x) => x.id), [B, C]);
  assert.equal(dm.sent[1].content, '**Ace Trader** tagged you in the Academy live chat (Day Trade):\n> @Bo @Cy look at SPY\nOpen the Academy app in Discord to reply.');
  assert.ok(logs.some(([, e, d]) => e === 'academy_chat_mention_dm_failed' && d.recipient === B && d.code === 50007));
  assert.ok(logs.some(([, e, d]) => e === 'academy_chat_mention_dm' && d.sent === 1 && d.messageId === '7'));
});

test('the same sender cannot DM the same member again inside the cooldown, and a member gets at most maxPerHour DMs', async () => {
  let t = 0; const dm = fakeDm();
  const svc = createMentionService({ guildId: G, dm, now: () => t, cooldownMs: 60_000, maxPerHour: 2 });
  const tag = (from) => svc.notify({ sender: { userId: from, displayName: 'x' }, mentions: [{ id: C, name: 'Cy' }], message: { body: '@Cy' }, channel: 'global' });
  assert.deepEqual((await tag(A)).sent, [C]);
  assert.deepEqual((await tag(A)).sent, []); // cooldown
  assert.deepEqual((await tag(B)).sent, [C]); // another sender is fine
  t += 61_000;
  assert.deepEqual((await tag(A)).sent, []); // the hourly cap for C is spent
  t += 3_600_001;
  assert.deepEqual((await tag(A)).sent, [C]);
  assert.equal(dm.sent.length, 3);
});

test('without a guild nothing is recorded or offered, and without a DM client notify is a no-op', async () => {
  const svc = createMentionService({});
  assert.equal(svc.configured, false);
  assert.equal(await svc.touch({ userId: A, displayName: 'Ace' }), false);
  assert.deepEqual(await svc.search('a'), []);
  assert.deepEqual(await svc.notify({ sender: { userId: A }, mentions: [{ id: B, name: 'Bo' }] }), { sent: [], skipped: [] });
});

test('Postgres mode: touch upserts the name and sign-in, search and resolve filter on the guild and recent sign-in, add stores tags as JSON', async () => {
  const calls = [];
  const pool = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: /SELECT/.test(sql) ? [{ discord_id: A, display_name: 'Ace Trader' }] : [] }; } };
  const svc = createMentionService({ pool, guildId: G });
  await svc.touch({ userId: A, displayName: 'Ace <Trader>' });
  assert.match(calls[0].sql, /INSERT INTO academy_students .*ON CONFLICT \(guild_id, discord_id\) DO UPDATE SET last_seen_at=now\(\)/s);
  assert.deepEqual(calls[0].params, [G, A, 'Ace Trader']);
  assert.deepEqual(await svc.search('a%e', { exclude: B }), [{ id: A, name: 'Ace Trader' }]);
  assert.match(calls[1].sql, /last_seen_at > to_timestamp\(\$2::double precision\)/);
  assert.equal(calls[1].params[2], '%a\\%e%'); // LIKE wildcards in what was typed are literal
  assert.equal(calls[1].params[4], B);
  assert.deepEqual(await svc.resolve([A, 'junk']), [{ id: A, name: 'Ace Trader' }]);
  assert.deepEqual(calls[2].params.slice(0, 2), [G, [A]]);
});
