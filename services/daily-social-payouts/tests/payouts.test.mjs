/**
 * Daily payout engine tests.  Run: node --test tests/payouts.test.mjs
 *
 * The money decisions live in pure functions (planDailyPayouts, the Reddit
 * removal verdict, the receiver crypto) precisely so they can be tested with
 * no Discord, no PayPal, and no bot process. What is defended here:
 *
 *   - nobody is paid without a confirmed receiver, twice in a day, or below
 *     the minimum; the cap skips whole members, never part-pays them
 *   - a hold is voided only on positive confirmation of removal
 *   - a stored address round-trips encrypted and is unreadable under a wrong
 *     key (fail closed, never a guessed payout)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'dsp-test-'));
process.env.PAYOUT_DETAILS_KEY = randomBytes(32).toString('hex');

const { planDailyPayouts, dailyPayoutConfig } = await import('../utils/dailyPayoutCycle.js');
const receivers = await import('../utils/payoutReceivers.js');

function group(userId, cents, entryCount = 1) {
  return {
    userId,
    userName: `user-${userId}`,
    totalCents: cents,
    entries: Array.from({ length: entryCount }, (_, index) => ({ id: `${userId}-e${index}`, amountCents: Math.round(cents / entryCount) })),
  };
}

/* ---------------- planDailyPayouts ---------------- */

test('pays only confirmed receivers at or over the minimum', () => {
  const plan = planDailyPayouts({
    groups: [group('a', 700), group('b', 700), group('c', 300)],
    receivers: new Map([['a', true], ['c', true]]),
    minCents: 500,
    dailyCapCents: 20_000,
    dayKey: '20260924',
  });
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].userId, 'a');
  assert.deepEqual(plan.skipped.map((s) => `${s.userId}:${s.reason}`).sort(), ['b:no_confirmed_receiver', 'c:below_minimum']);
});

test('the daily cap skips whole members and keeps their place — never a partial payment', () => {
  const plan = planDailyPayouts({
    groups: [group('first', 15_000), group('second', 12_000), group('third', 4_000)],
    receivers: new Map([['first', true], ['second', true], ['third', true]]),
    minCents: 500,
    dailyCapCents: 20_000,
    dayKey: '20260924',
  });
  assert.deepEqual(plan.items.map((item) => item.userId), ['first', 'third'], 'second does not fit whole; third still fits under the cap');
  assert.equal(plan.plannedCents, 19_000);
  const capped = plan.skipped.find((s) => s.userId === 'second');
  assert.equal(capped.reason, 'daily_cap');
  assert.equal(capped.totalCents, 12_000, 'the skipped member keeps the full balance for the next run');
});

test('a member already paid today is never paid twice', () => {
  const plan = planDailyPayouts({
    groups: [group('a', 900)],
    receivers: new Map([['a', true]]),
    paidToday: new Set(['a']),
    minCents: 500,
    dailyCapCents: 20_000,
    dayKey: '20260924',
  });
  assert.equal(plan.items.length, 0);
  assert.equal(plan.skipped[0].reason, 'already_paid_today');
});

test('sender item ids are deterministic per day+member (PayPal-side idempotency)', () => {
  const args = { groups: [group('a', 900)], receivers: new Map([['a', true]]), minCents: 0, dailyCapCents: 0, dayKey: '20260924' };
  const one = planDailyPayouts(args);
  const two = planDailyPayouts(args);
  assert.equal(one.items[0].senderItemId, 'daily-20260924-a');
  assert.equal(one.items[0].senderItemId, two.items[0].senderItemId);
});

test('zero and negative balances never enter a plan', () => {
  const plan = planDailyPayouts({
    groups: [group('a', 0), { ...group('b', -500), totalCents: -500 }],
    receivers: new Map([['a', true], ['b', true]]),
    minCents: 0,
    dailyCapCents: 0,
    dayKey: '20260924',
  });
  assert.equal(plan.items.length, 0);
  assert.equal(plan.plannedCents, 0);
});

test('config defaults are sane and bad env values fall back', () => {
  const config = dailyPayoutConfig({});
  assert.equal(config.minCents, 500);
  assert.equal(config.dailyCapCents, 20_000);
  assert.equal(config.hourUtc, 15);
  assert.equal(config.autoPayEnabled, false);
  const bad = dailyPayoutConfig({ PAYOUT_MIN_USD: 'lots', PAYOUT_DAILY_CAP_USD: 'NaN', PAYOUT_DAILY_HOUR_UTC: '99', PAYOUT_AUTO_DAILY: 'yes' });
  assert.equal(bad.minCents, 500);
  assert.equal(bad.dailyCapCents, 20_000);
  assert.equal(bad.hourUtc, 15);
  assert.equal(bad.autoPayEnabled, false, 'only the exact string 1 arms auto-pay');
});

/* ---------------- receiver vault ---------------- */

test('a saved address round-trips, renders masked, and deletes cleanly', async () => {
  const saved = await receivers.saveReceiver({ userId: '42', userName: 'tester', email: 'jordan.doe@gmail.com' });
  assert.match(saved.emailMasked, /^j\*+@g\*+\.com$/);
  const masked = await receivers.getReceiverMasked('42');
  assert.equal(masked.emailMasked, saved.emailMasked);
  const live = await receivers.resolveReceiverEmail('42');
  assert.equal(live.email, 'jordan.doe@gmail.com');
  const confirmed = await receivers.listConfirmedReceivers();
  assert.ok(confirmed.has('42'));
  assert.ok(!JSON.stringify(masked).includes('jordan.doe'), 'masked view never contains the live address');
  assert.equal(await receivers.removeReceiver('42'), true);
  assert.equal(await receivers.resolveReceiverEmail('42'), null);
});

test('a wrong key fails closed — no guessed payout address, ever', async () => {
  await receivers.saveReceiver({ userId: '77', userName: 'tester', email: 'someone@example.com' });
  const originalKey = process.env.PAYOUT_DETAILS_KEY;
  process.env.PAYOUT_DETAILS_KEY = randomBytes(32).toString('hex');
  try {
    assert.equal(await receivers.resolveReceiverEmail('77'), null);
  } finally {
    process.env.PAYOUT_DETAILS_KEY = originalKey;
  }
  const restored = await receivers.resolveReceiverEmail('77');
  assert.equal(restored.email, 'someone@example.com');
});

test('the store is disabled outright without a well-formed key', async () => {
  const originalKey = process.env.PAYOUT_DETAILS_KEY;
  process.env.PAYOUT_DETAILS_KEY = 'not-hex';
  try {
    assert.equal(receivers.receiverStoreStatus().enabled, false);
    await assert.rejects(() => receivers.saveReceiver({ userId: '9', userName: 'x', email: 'a@b.co' }), /64 hex/);
  } finally {
    process.env.PAYOUT_DETAILS_KEY = originalKey;
  }
});

test('junk emails are refused before anything touches disk', async () => {
  for (const bad of ['not-an-email', 'a@b', 'a b@c.com', '', 'a@'.padEnd(300, 'x') + '.com']) {
    await assert.rejects(() => receivers.saveReceiver({ userId: '1', userName: 'x', email: bad }));
  }
});

/* ---------------- ledger lifecycle ---------------- */

test('ledger: mature → notify once → pay once; paid entries resist re-mark and void', async () => {
  const ledger = await import('../utils/payoutLedger.js');
  const entry = await ledger.recordPublishedLinkPayout({
    post: { postID: 'p1', title: 'T', link: 'https://stockmarketloop.com/x/' },
    externalPost: { id: 'x1', userId: 'u1', userName: 'member', platform: 'reddit', url: 'https://www.reddit.com/r/stocks/comments/abc/x/', timestamp: new Date(Date.now() - 80 * 3_600_000).toISOString() },
    intent: null,
  });
  assert.equal(entry.status, 'pending_hold');

  const groups = await ledger.getPayableEntriesGroupedByUser();
  assert.equal(groups.length, 1, 'an 80-hour-old entry has matured past the 72h hold');
  assert.equal(groups[0].userId, 'u1');

  assert.equal(await ledger.markEntriesNotifiedPayable([entry.sourceId]), 1);
  assert.equal(await ledger.markEntriesNotifiedPayable([entry.sourceId]), 0, 'notification marks exactly once');

  const paid = await ledger.markPayoutEntriesPaid({ userId: 'u1', entryIds: [entry.sourceId], paidBy: 'test', receiver: 'j***@x***.com', payoutBatchId: 'daily-20260924-batch' });
  assert.equal(paid.changed, 1);
  const again = await ledger.markPayoutEntriesPaid({ userId: 'u1', entryIds: [entry.sourceId], paidBy: 'test', receiver: 'j***@x***.com', payoutBatchId: 'B2' });
  assert.equal(again.changed, 0, 'a paid entry cannot be paid again');
  assert.equal(await ledger.voidPayoutEntry(entry.sourceId), false, 'a paid entry cannot be voided');

  const dup = await ledger.recordPublishedLinkPayout({
    post: { postID: 'p1', title: 'T', link: 'https://stockmarketloop.com/x/' },
    externalPost: { id: 'x1', userId: 'u1', userName: 'member', platform: 'reddit', url: 'https://www.reddit.com/r/stocks/comments/abc/x/', timestamp: new Date().toISOString() },
    intent: null,
  });
  assert.equal(dup.sourceId, entry.sourceId, 'same source upserts, never double-credits');
  assert.equal(dup.status, 'paid', 'and returns the existing (already paid) row');
});

/* ---------------- PayPal batch guards (no network: guards fire first) ---------------- */

test('a payout batch refuses to run without the enable flag, and validates every item', async () => {
  const { createPayPalBatchPayout } = await import('../utils/paypalPayouts.js');
  process.env.PAYPAL_CLIENT_ID = 'x';
  process.env.PAYPAL_CLIENT_SECRET = 'y';
  delete process.env.PAYPAL_PAYOUTS_ENABLED;
  await assert.rejects(() => createPayPalBatchPayout({ items: [{ receiverEmail: 'a@b.co', amountCents: 100 }] }), /PAYPAL_PAYOUTS_ENABLED/);
  process.env.PAYPAL_PAYOUTS_ENABLED = '1';
  process.env.PAYPAL_PAYOUT_DRY_RUN = '1';
  await assert.rejects(() => createPayPalBatchPayout({ items: [] }), /at least one item/);
  await assert.rejects(() => createPayPalBatchPayout({ items: [{ receiverEmail: 'bad', amountCents: 100 }] }), /valid PayPal/);
  await assert.rejects(() => createPayPalBatchPayout({ items: [{ receiverEmail: 'a@b.co', amountCents: 0 }] }), /greater than/);
  const dry = await createPayPalBatchPayout({ items: [{ receiverEmail: 'a@b.co', amountCents: 150, senderItemId: 'daily-x-a' }, { receiverEmail: 'c@d.co', amountCents: 250 }], senderBatchId: 'batch-1' });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.batchId, 'DRY-RUN-batch-1');
  assert.equal(dry.totalCents, 400);
  assert.equal(dry.items.length, 2);
  assert.equal(dry.items[0].itemId, 'daily-x-a');
});

/* ---------------- Reddit removal verdicts (they decide voiding) ---------------- */

test('reddit URL normalization accepts only reddit post/comment URLs', async () => {
  const { redditJsonUrl } = await import('../utils/dailyPayoutCycle.js');
  assert.equal(redditJsonUrl('https://www.reddit.com/r/stocks/comments/abc/title/'), 'https://www.reddit.com/r/stocks/comments/abc/title.json');
  assert.equal(redditJsonUrl('https://old.reddit.com/r/stocks/comments/abc/title/?utm=1'), 'https://www.reddit.com/r/stocks/comments/abc/title.json');
  assert.equal(redditJsonUrl('https://evil.com/r/stocks/comments/abc/'), null);
  assert.equal(redditJsonUrl('https://notreddit.com.evil.com/r/x/comments/a/'), null);
  assert.equal(redditJsonUrl('https://www.reddit.com/user/someone/'), null);
  assert.equal(redditJsonUrl('not a url'), null);
});

test('a live post never reads as removed; removed/deleted states do', async () => {
  const { redditListingShowsRemoved } = await import('../utils/dailyPayoutCycle.js');
  const postUrl = 'https://www.reddit.com/r/stocks/comments/abc/title/';
  const listing = (post, comments = []) => [
    { data: { children: [{ data: post }] } },
    { data: { children: comments } },
  ];
  assert.equal(redditListingShowsRemoved(listing({ author: 'someone', selftext: 'hello', removed_by_category: null }), postUrl), false);
  assert.equal(redditListingShowsRemoved(listing({ author: 'someone', removed_by_category: 'moderator' }), postUrl), true);
  assert.equal(redditListingShowsRemoved(listing({ author: '[deleted]', selftext: '[removed]' }), postUrl), true);
  const commentUrl = 'https://www.reddit.com/r/stocks/comments/abc/title/def123/';
  assert.equal(redditListingShowsRemoved(listing({ author: 'x' }, [{ data: { id: 'def123', author: 'someone', body: 'still here' } }]), commentUrl), false);
  assert.equal(redditListingShowsRemoved(listing({ author: 'x' }, [{ data: { id: 'def123', author: '[deleted]', body: '[removed]' } }]), commentUrl), true);
  assert.equal(redditListingShowsRemoved(listing({ author: 'x' }, [{ data: { id: 'other', author: 'y', body: 'z' } }]), commentUrl), false, 'comment not found is NOT proof of removal');
  assert.equal(redditListingShowsRemoved(null, postUrl), false, 'garbage input never voids');
});

/* ---------------- review-driven regression tests ---------------- */

test('a blank PAYOUT_DAILY_HOUR_UTC (as .env.example ships it) means 15, not midnight', () => {
  assert.equal(dailyPayoutConfig({ PAYOUT_DAILY_HOUR_UTC: '' }).hourUtc, 15);
  assert.equal(dailyPayoutConfig({ PAYOUT_DAILY_HOUR_UTC: '  ' }).hourUtc, 15);
  assert.equal(dailyPayoutConfig({ PAYOUT_DAILY_HOUR_UTC: '0' }).hourUtc, 0, 'an explicit 0 is honored');
});

test('the payout lock serializes every money path — no interleaving', async () => {
  const { withPayoutLock } = await import('../utils/dailyPayoutCycle.js');
  const order = [];
  const slow = withPayoutLock(async () => {
    order.push('slow-start');
    await new Promise((resolve) => setTimeout(resolve, 50));
    order.push('slow-end');
    return 'slow';
  });
  const fast = withPayoutLock(async () => {
    order.push('fast');
    return 'fast';
  });
  assert.deepEqual(await Promise.all([slow, fast]), ['slow', 'fast']);
  assert.deepEqual(order, ['slow-start', 'slow-end', 'fast'], 'the second caller waits for the first');
  const failing = withPayoutLock(async () => { throw new Error('boom'); });
  await assert.rejects(failing, /boom/);
  assert.equal(await withPayoutLock(async () => 'after-failure'), 'after-failure', 'a failed run never wedges the lock');
});

test('the daily batch id is deterministic per (day, member set) — PayPal-side idempotency', async () => {
  const { dailyBatchId } = await import('../utils/dailyPayoutCycle.js');
  const one = dailyBatchId('20260924', ['b', 'a', 'c']);
  const two = dailyBatchId('20260924', ['c', 'a', 'b']);
  assert.equal(one, two, 'member order does not change the id — a crashed-run retry collides at PayPal instead of double-paying');
  assert.notEqual(one, dailyBatchId('20260924', ['a', 'b']), 'a different member set is a different batch');
  assert.notEqual(one, dailyBatchId('20260925', ['a', 'b', 'c']), 'a different day is a different batch');
  assert.match(one, /^daily-20260924-[0-9a-f]{10}$/);
});

test('a voided entry can never be flipped to paid', async () => {
  const ledger = await import('../utils/payoutLedger.js');
  const entry = await ledger.recordPublishedLinkPayout({
    post: { postID: 'p9', title: 'V', link: 'https://stockmarketloop.com/v/' },
    externalPost: { id: 'v9', userId: 'u9', userName: 'member', platform: 'reddit', url: 'https://www.reddit.com/r/stocks/comments/zzz/v/', timestamp: new Date(Date.now() - 80 * 3_600_000).toISOString() },
    intent: null,
  });
  assert.equal(await ledger.voidPayoutEntry(entry.sourceId, 'removed during hold'), true);
  const paid = await ledger.markPayoutEntriesPaid({ userId: 'u9', entryIds: [entry.sourceId], paidBy: 'test', receiver: 'x', payoutBatchId: 'B' });
  assert.equal(paid.changed, 0, 'voided is not an open status; the concurrent void wins');
});

test('an entry with corrupt payableAt is NOT payable in the batch path (fail closed)', async () => {
  const ledger = await import('../utils/payoutLedger.js');
  const entry = await ledger.recordPublishedLinkPayout({
    post: { postID: 'p8', title: 'C', link: 'https://stockmarketloop.com/c/' },
    externalPost: { id: 'c8', userId: 'u8', userName: 'member', platform: 'x', url: 'https://x.com/u/status/1', timestamp: 'not-a-date' },
    intent: null,
  });
  assert.ok(entry, 'entry records (payableAt falls back to now+hold)');
  const { mutateJson, paths } = await import('../utils/storage.js');
  await mutateJson(paths.payoutLedger, [], (rows) => {
    const row = rows.find((r) => r.sourceId === entry.sourceId);
    row.payableAt = 'garbage';
  });
  const groups = await ledger.getPayableEntriesGroupedByUser();
  assert.ok(!groups.some((g) => g.userId === 'u8'), 'corrupt hold data never becomes payable');
});

/* ---------------- article feed supply rules ---------------- */

test('article feed selection: first-run baseline logic, freshness, ordering, cap', async () => {
  const { selectNewPosts, articleFeedConfig } = await import('../utils/articleFeed.js');
  const now = Date.parse('2026-09-24T15:00:00Z');
  const post = (id, minsAgo) => ({ id, link: `https://stockmarketloop.com/a${id}/`, date_gmt: new Date(now - minsAgo * 60_000).toISOString().replace('Z', '') });

  const cursor = { seenIds: [1, 2] };
  const picked = selectNewPosts(cursor, [post(5, 10), post(4, 20), post(3, 30), post(2, 40), post(1, 50)], { maxPerCycle: 2, now });
  assert.deepEqual(picked.map((p) => p.id), [3, 4], 'oldest unseen first, capped; the over-cap post stays for the next cycle');

  const stale = selectNewPosts({ seenIds: [] }, [post(9, 60 * 30)], { maxPerCycle: 3, now });
  assert.equal(stale.length, 0, 'articles older than 24h are never auto-packaged (flood guard)');

  const future = selectNewPosts({ seenIds: [] }, [{ id: 8, link: 'https://x/', date_gmt: new Date(now + 3_600_000).toISOString().replace('Z', '') }], { maxPerCycle: 3, now });
  assert.equal(future.length, 0, 'far-future timestamps are refused');

  const junk = selectNewPosts({ seenIds: [] }, [{ id: 0, link: '' }, null, { id: 7, link: 'https://x/', date_gmt: 'garbage' }], { maxPerCycle: 3, now });
  assert.equal(junk.length, 0, 'malformed feed rows never select');

  const config = articleFeedConfig({ articleFeed: { enabled: true, pollSeconds: 5, maxPerCycle: 99 } });
  assert.equal(config.pollSeconds, 120, 'poll floor protects the site');
  assert.equal(config.maxPerCycle, 10, 'per-cycle ceiling protects the channels');
  assert.equal(articleFeedConfig({}).enabled, false, 'feed is opt-in via settings');
});

test('workflow-scoped duplicate suppression: each program packages once, legacy rows still block', async () => {
  const tracking = await import('../utils/tracking.js');
  const link = 'https://stockmarketloop.com/dup-test/';
  const base = { kind: 'channel-link', sharedBy: 'u', sharedByName: 'u', title: 'T', description: 'D', link, platformUrls: {} };
  const a = await tracking.createTrackedPost({ ...base, workflowId: 'prog-a' });
  await tracking.bindDiscordMessage(a.postID, { id: 'm1', channelId: 'c1', guildId: 'g1', url: 'https://discord/m1' });
  await tracking.bindEngagementMessage(a.postID, { id: 'm2', channelId: 'c2', guildId: 'g1', url: 'https://discord/m2' });
  assert.ok(await tracking.recentPostByLink(link, 24, 'prog-a'), 'same workflow sees the duplicate');
  assert.equal(await tracking.recentPostByLink(link, 24, 'prog-b'), null, 'a different program may package the same article');
  assert.ok(await tracking.recentPostByLink(link, 24), 'unscoped legacy callers still match');
});
