import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// State goes to a throwaway directory; set before the modules read DATA_DIR.
const dir = await mkdtemp(path.join(os.tmpdir(), 'social-payouts-'));
process.env.DATA_DIR = dir;

const storage = await import('../utils/storage.js');
const { createInstanceLock } = await import('../src/bot/instanceLock.js');
const reviews = await import('../src/features/pendingReviews.js');
const apps = await import('../src/features/socialApplications.js');
const { handleInteraction } = await import('../src/bot/interactions.js');
const { buildIntents } = await import('../src/bot/events.js');
const { GatewayIntentBits } = await import('discord.js');

test('settings overlays merge key by key: siblings survive, arrays replace, null removes', async () => {
  const merged = storage.deepMerge(
    { a: { x: 1, y: 2 }, list: [1, 2], keep: true, drop: 'me' },
    { a: { y: 9 }, list: [3], drop: null },
  );
  assert.deepEqual(merged, { a: { x: 1, y: 9 }, list: [3], keep: true });
  await writeFile(storage.paths.settingsOverrides, JSON.stringify({ socialApplications: { autoReviewMinutes: 1 } }));
  const settings = await storage.readSettings();
  assert.equal(settings.socialApplications.autoReviewMinutes, 1);
  assert.ok(settings.socialApplications.acceptedRoleId !== undefined || Object.keys(settings.socialApplications).length > 1, 'the rest of socialApplications is kept');
});

test('durable storage is required on Render', () => {
  assert.throws(() => storage.assertDurableStorage({ RENDER: 'true' }), /DATA_DIR/);
  assert.doesNotThrow(() => storage.assertDurableStorage({ RENDER: 'true', DATA_DIR: '/var/data' }));
  assert.doesNotThrow(() => storage.assertDurableStorage({}));
});

test('appended audit records stay in order and each line is valid JSON', async () => {
  const file = path.join(dir, 'audit.ndjson');
  await Promise.all([1, 2, 3, 4, 5].map((n) => storage.appendRecord(file, { n })));
  const lines = (await readFile(file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((row) => row.n), [1, 2, 3, 4, 5]);
});

test('only one copy of the bot owns the data: a second waits, then loses; a stale lock is taken over', async () => {
  const file = path.join(dir, 'lock.json');
  let clock = 1_000_000;
  const now = () => clock;
  const quiet = { warn() {}, error() {} };
  const first = createInstanceLock({ file, now, waitMs: 0, pollMs: 1, log: quiet });
  const second = createInstanceLock({ file, now, waitMs: 0, pollMs: 1, log: quiet });
  assert.equal(await first.acquire(), true);
  assert.equal(await second.acquire(), false, 'a live owner keeps the lock');
  clock += 60_000; // the first copy stopped refreshing
  assert.equal(await second.acquire(), true, 'a stale lock is taken over');
  await first.release(); // must not delete the new owner's lock
  assert.equal(JSON.parse(await readFile(file, 'utf8')).id, second.id);
  await second.release();
});

test('pending application reviews are saved, counted, and dropped after too many failures', async () => {
  await reviews.addPendingReview({ id: 'a', links: [], dueAt: 1, attempts: 0 });
  await reviews.addPendingReview({ id: 'a', links: [], dueAt: 1, attempts: 0 }); // same id is not queued twice
  await reviews.addPendingReview({ id: 'b', links: [], dueAt: 1, attempts: 0 });
  assert.equal((await reviews.listPendingReviews()).length, 2);
  for (let i = 0; i < 5; i += 1) await reviews.bumpReviewAttempt('b');
  assert.deepEqual((await reviews.listPendingReviews()).map((row) => row.id), ['a']);
  await reviews.removePendingReview('a');
  assert.equal((await reviews.listPendingReviews()).length, 0);
});

test('application links are recognised by platform and de-duplicated', () => {
  const links = apps.extractSocialApplicationLinks('https://www.reddit.com/user/example/ and https://bsky.app/profile/x.bsky.social, https://example.com/nope https://www.reddit.com/user/example/');
  assert.deepEqual(links.map((link) => link.platform), ['reddit', 'bluesky']);
  assert.equal(apps.extractPaypalEmail('my paypal is Someone.Name+tag@Example.com thanks'), 'someone.name+tag@example.com');
});

test('a review that came due while the bot was down runs on startup and is then removed from the queue', async () => {
  const sent = [];
  const roles = [];
  const client = {
    channels: { fetch: async () => ({ id: 'thread', send: async (payload) => { sent.push(['thread', payload.content]); } }) },
    users: { fetch: async () => ({ send: async (content) => { sent.push(['dm', content]); } }) },
    guilds: { fetch: async () => ({ members: { fetch: async () => ({ roles: { add: async (id) => { roles.push(id); } } }) } }) },
  };
  await reviews.addPendingReview({
    id: 'overdue-1', threadId: 'thread', channelId: 'c', messageId: 'm', guildId: 'g', userId: 'u1', username: 'Applicant#0001',
    links: [{ platform: 'facebook', url: 'https://www.facebook.com/example' }], dueAt: Date.now() - 60_000, attempts: 0,
  });
  assert.equal(await apps.resumePendingApplicationReviews(client), 1);
  for (let i = 0; i < 100 && (await reviews.listPendingReviews()).length; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await reviews.listPendingReviews()).length, 0, 'the finished review leaves the queue');
  assert.ok(sent.some(([where, text]) => where === 'thread' && /Application accepted/.test(text)));
  assert.ok(sent.some(([where, text]) => where === 'dm' && /Application accepted/.test(text)));
  const audit = (await readFile(storage.paths.ambassadorEligibility, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(audit.at(-1).userId, 'u1');
  assert.equal(audit.at(-1).approved, true);
  apps.cancelApplicationReviewTimers();
});

test('the router hands an unclaimed slash command to its command and reports failures without crashing', async () => {
  const calls = [];
  const client = { commands: new Map([['ping', { execute: async () => { calls.push('ran'); } }], ['boom', { execute: async () => { throw new Error('x'); } }]]) };
  const base = { isButton: () => false, isModalSubmit: () => false, isChatInputCommand: () => true, deferred: false, replied: false };
  await handleInteraction({ ...base, commandName: 'ping' }, client);
  assert.deepEqual(calls, ['ran']);
  const replies = [];
  const originalError = console.error; console.error = () => {};
  await handleInteraction({ ...base, commandName: 'boom', reply: async (payload) => { replies.push(payload.content); } }, client);
  console.error = originalError;
  assert.match(replies[0], /failed safely/);
});

test('the member intent is on by default and can be turned off', () => {
  assert.ok(buildIntents({}).includes(GatewayIntentBits.GuildMembers));
  assert.ok(!buildIntents({ MEMBERS_INTENT: '0' }).includes(GatewayIntentBits.GuildMembers));
  assert.ok(buildIntents({}).includes(GatewayIntentBits.MessageContent));
});

test('the one-time backup copies every state file once and never overwrites it', async () => {
  const { backupStateOnce } = await import('../src/bot/backup.js');
  const data = await mkdtemp(path.join(os.tmpdir(), 'sp-backup-'));
  await writeFile(path.join(data, 'payout-ledger.json'), '[{"id":1}]');
  await writeFile(path.join(data, 'audit.ndjson'), '{"a":1}\n');
  await writeFile(path.join(data, 'notes.txt'), 'ignored');
  const first = await backupStateOnce(data);
  assert.equal(first.copied, 2);
  await writeFile(path.join(data, 'payout-ledger.json'), '[{"id":2}]');
  const second = await backupStateOnce(data);
  assert.equal(second.skipped, true);
  assert.equal(await readFile(path.join(first.target, 'payout-ledger.json'), 'utf8'), '[{"id":1}]');
});
