import { createHash, randomUUID } from 'node:crypto';
import { EmbedBuilder } from 'discord.js';
import { centsToUsd } from './payoutPolicy.js';
import {
  getOpenEntries,
  getPayableEntriesGroupedByUser,
  markEntriesNotifiedPayable,
  markPayoutEntriesPaid,
  voidPayoutEntry,
} from './payoutLedger.js';
import { listConfirmedReceivers, resolveReceiverEmail } from './payoutReceivers.js';
import { createPayPalBatchPayout } from './paypalPayouts.js';
import { paypalPayoutStatus } from './paypalStatus.js';
import { paths, mutateJson, readJson, readSettings } from './storage.js';

/**
 * The daily cycle this bot is named for. Once a day it:
 *
 *   1. enforces holds - Reddit work whose public post is confirmed removed is
 *      voided (confirmed only; an unreachable page never voids anything),
 *   2. tells each member, once per entry, that held work has become payable,
 *   3. optionally pays every member with a confirmed saved PayPal receiver and
 *      a payable balance over the minimum, in ONE batch, then
 *   4. posts a numbers-only summary card to the work-report channel.
 *
 * Real money moves only behind three independent locks: PAYPAL_PAYOUTS_ENABLED=1,
 * PAYPAL_PAYOUT_DRY_RUN=0, and PAYOUT_AUTO_DAILY=1. Any other combination makes
 * step 3 a preview. A Discord click is never payment authorization; the inputs
 * here are matured ledger entries that each began as returned-link or
 * admin-approved proof.
 */

export function dailyPayoutConfig(env = process.env) {
  const minUsd = Number(env.PAYOUT_MIN_USD || 5);
  const capUsd = Number(env.PAYOUT_DAILY_CAP_USD || 200);
  const hourRaw = String(env.PAYOUT_DAILY_HOUR_UTC ?? '').trim();
  const hourUtc = hourRaw === '' ? 15 : Number(hourRaw);
  return {
    minCents: Math.max(0, Math.round((Number.isFinite(minUsd) ? minUsd : 5) * 100)),
    dailyCapCents: Math.max(0, Math.round((Number.isFinite(capUsd) ? capUsd : 200) * 100)),
    hourUtc: Number.isFinite(hourUtc) && hourUtc >= 0 && hourUtc <= 23 ? hourUtc : 15,
    autoPayEnabled: env.PAYOUT_AUTO_DAILY === '1',
  };
}

/**
 * Pure planning: which members get paid, which are skipped and why. All the
 * money decisions live here so they can be unit-tested without Discord,
 * PayPal, or the filesystem.
 *
 * groups     [{ userId, userName, entries:[{id|sourceId, amountCents}], totalCents }]
 *            already ordered oldest-waiting first
 * receivers  Map(userId -> truthy) of members with a CONFIRMED saved receiver
 * paidToday  Set(userId) already paid by an earlier run this same day
 */
/* One mutex for EVERY code path that can submit money: the scheduled cycle,
   /payout-admin run-daily, and /payout-admin pay all serialize through here,
   so two snapshots of "payable" can never both reach PayPal. */
let payoutChain = Promise.resolve();
export function withPayoutLock(fn) {
  const next = payoutChain.then(fn, fn);
  payoutChain = next.then(() => undefined, () => undefined);
  return next;
}

/* Deterministic per (day, member set): a crashed run retried with the same
   members re-uses the same sender_batch_id, and PayPal's batch idempotency
   rejects the duplicate instead of paying everyone twice. A different member
   set (a legitimate second batch) hashes to a different id. */
export function dailyBatchId(dayKey, userIds) {
  const digest = createHash('sha1').update([...userIds].sort().join(',')).digest('hex').slice(0, 10);
  return `daily-${dayKey}-${digest}`;
}

export function planDailyPayouts({ groups, receivers, paidToday = new Set(), minCents, dailyCapCents, dayKey }) {
  const items = [];
  const skipped = [];
  let plannedCents = 0;
  for (const group of groups || []) {
    const total = Number(group.totalCents || 0);
    if (total <= 0) continue;
    if (paidToday.has(group.userId)) {
      skipped.push({ userId: group.userId, reason: 'already_paid_today', totalCents: total });
      continue;
    }
    if (!receivers.has(group.userId)) {
      skipped.push({ userId: group.userId, reason: 'no_confirmed_receiver', totalCents: total });
      continue;
    }
    if (total < minCents) {
      skipped.push({ userId: group.userId, reason: 'below_minimum', totalCents: total });
      continue;
    }
    if (dailyCapCents > 0 && plannedCents + total > dailyCapCents) {
      skipped.push({ userId: group.userId, reason: 'daily_cap', totalCents: total });
      continue; // members are never part-paid; the next run picks them up first
    }
    items.push({
      userId: group.userId,
      userName: group.userName || '',
      amountCents: total,
      entryIds: group.entries.map((row) => row.id || row.sourceId),
      senderItemId: `daily-${dayKey}-${group.userId}`.slice(0, 63),
    });
    plannedCents += total;
  }
  return { items, skipped, plannedCents };
}

/* ---------------- hold enforcement (Reddit only, confirm-to-void) ---------------- */

export function redditJsonUrl(publicUrl) {
  try {
    const url = new URL(String(publicUrl || ''));
    if (!/(^|\.)reddit\.com$/.test(url.hostname)) return null;
    if (!/^\/r\/[^/]+\/comments\//.test(url.pathname)) return null;
    url.hostname = 'www.reddit.com';
    url.search = '';
    url.hash = '';
    url.pathname = `${url.pathname.replace(/\/$/, '')}.json`;
    return url.toString();
  } catch {
    return null;
  }
}

export function redditListingShowsRemoved(json, publicUrl) {
  try {
    const post = json?.[0]?.data?.children?.[0]?.data;
    if (!post) return false;
    const commentIdMatch = String(publicUrl).match(/\/comments\/[^/]+\/[^/]+\/([a-z0-9]+)/i);
    if (commentIdMatch) {
      const wanted = commentIdMatch[1].toLowerCase();
      const stack = [...(json?.[1]?.data?.children || [])];
      while (stack.length) {
        const node = stack.pop();
        const data = node?.data;
        if (!data) continue;
        if (String(data.id || '').toLowerCase() === wanted) {
          return data.author === '[deleted]' || data.body === '[removed]' || data.body === '[deleted]';
        }
        for (const reply of data.replies?.data?.children || []) stack.push(reply);
      }
      return false; // comment not found in the first page: not proof of removal
    }
    if (post.removed_by_category) return true;
    return post.author === '[deleted]' && (post.selftext === '[removed]' || post.selftext === '[deleted]');
  } catch {
    return false;
  }
}

async function checkRedditRemoved(publicUrl, fetchImpl) {
  const jsonUrl = redditJsonUrl(publicUrl);
  if (!jsonUrl) return { checked: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetchImpl(jsonUrl, {
      signal: controller.signal,
      headers: { 'user-agent': 'daily-social-payouts hold-verification (contact: server admin)' },
    });
    if (response.status === 404) return { checked: true, removed: true, why: 'HTTP 404' };
    if (!response.ok) return { checked: false }; // 403/429/5xx: fail open, keep the entry
    const json = await response.json().catch(() => null);
    if (!json) return { checked: false };
    return redditListingShowsRemoved(json, publicUrl)
      ? { checked: true, removed: true, why: 'Reddit reports the post/comment removed or deleted' }
      : { checked: true, removed: false };
  } catch {
    return { checked: false };
  } finally {
    clearTimeout(timer);
  }
}

async function enforceHolds({ fetchImpl }) {
  const now = Date.now();
  const open = await getOpenEntries();
  const inHold = open.filter((row) => (
    row.platform === 'reddit' &&
    row.publicUrl &&
    Date.parse(row.minimumPublicUntil || row.payableAt || '') > now
  ));
  const result = { checked: 0, voided: 0, voidedIds: [] };
  for (const row of inHold.slice(0, 20)) { // polite to Reddit, and bounded so an admin-triggered run finishes inside the interaction window
    const verdict = await checkRedditRemoved(row.publicUrl, fetchImpl);
    if (!verdict.checked) continue;
    result.checked += 1;
    if (verdict.removed) {
      const changed = await voidPayoutEntry(row.sourceId, `Public link no longer live during hold window (${verdict.why})`);
      if (changed) {
        result.voided += 1;
        result.voidedIds.push(row.sourceId);
      }
    }
  }
  return result;
}

/* ---------------- payable notifications ---------------- */

async function notifyNewlyPayable(client) {
  const now = Date.now();
  const open = await getOpenEntries();
  const due = open.filter((row) => Date.parse(row.payableAt || '') <= now && !row.notifiedPayableAt && Number(row.amountCents || 0) > 0);
  const byUser = new Map();
  for (const row of due) {
    const list = byUser.get(row.userId) || [];
    list.push(row);
    byUser.set(row.userId, list);
  }
  const result = { members: 0, entries: 0, dmFailed: 0 };
  for (const [userId, rows] of byUser) {
    const totalCents = rows.reduce((sum, row) => sum + Number(row.amountCents || 0), 0);
    let delivered = false;
    try {
      const user = await client.users.fetch(userId);
      const receiver = await getReceiverLine(userId);
      await user.send(
        `💵 **${centsToUsd(totalCents)} of your Daily Social Payouts work is now payable.**\n` +
        `${rows.length} verified item${rows.length === 1 ? '' : 's'} finished the hold window.\n\n` +
        `${receiver}\n` +
        'Use `/earnings` in the server to see the full ledger. Amounts stay payable and roll into the next payout run.'
      );
      delivered = true;
    } catch {
      result.dmFailed += 1; // closed DMs: recorded, never retried daily forever
    }
    await markEntriesNotifiedPayable(rows.map((row) => row.id || row.sourceId), { delivered });
    result.members += 1;
    result.entries += rows.length;
  }
  return result;
}

async function getReceiverLine(userId) {
  try {
    const { getReceiverMasked } = await import('./payoutReceivers.js');
    const saved = await getReceiverMasked(userId);
    return saved
      ? `Payouts go to your saved PayPal **${saved.emailMasked}**.`
      : 'No payout method is saved yet — run `/paypal set` in the server so the daily payout run can include you.';
  } catch {
    return 'Run `/paypal status` in the server to check your payout setup.';
  }
}

/* ---------------- the cycle ---------------- */

function dayKeyUtc(date = new Date()) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

async function blockedPayoutUserIds(dayKey) {
  const { getPayoutLedger } = await import('./payoutLedger.js');
  const rows = await getPayoutLedger();
  const out = new Set();
  for (const row of rows) {
    if (row.status !== 'paid') continue;
    /* Live batches store PayPal's opaque batch id, so the day marker is read
       from OUR item id (daily-{dayKey}-{userId}), with the batch id kept as a
       fallback for dry-run/preview shapes. */
    if (String(row.payoutItemId || '').startsWith(`daily-${dayKey}-`) || String(row.payoutBatchId || '').includes(`daily-${dayKey}`)) {
      out.add(row.userId);
    }
  }
  /* Crash-window guard, and it must NOT expire at UTC midnight: an intent is
     written BEFORE a batch is submitted, a settlement record after the ledger
     is marked. Any intent from the last 48h without its settlement blocks
     those members until an admin reconciles against PayPal - worst case a
     late payment, never an automatic double one. */
  const audit = await readJson(paths.payoutCycleAudit, []);
  const settledRuns = new Set(audit.filter((record) => record?.type === 'payment_settled').map((record) => record.runId));
  const cutoff = Date.now() - 48 * 3_600_000;
  for (const record of audit) {
    if (record?.type !== 'payment_intent') continue;
    const at = Date.parse(record.at || '');
    const settled = settledRuns.has(record.runId);
    const sameDay = record.dayKey === dayKey;
    if (sameDay || (!settled && Number.isFinite(at) && at >= cutoff)) {
      for (const userId of record.userIds || []) out.add(userId);
    }
  }
  return out;
}

async function appendCycleAudit(record) {
  await mutateJson(paths.payoutCycleAudit, [], (rows) => {
    rows.push(record);
    if (rows.length > 60) rows.splice(0, rows.length - 60);
  });
}

export async function getLastCycleRun() {
  const rows = await readJson(paths.payoutCycleAudit, []);
  return rows.length ? rows[rows.length - 1] : null;
}

async function postSummaryCard(client, summary) {
  try {
    const settings = await readSettings();
    const targets = settings.workReport?.channels?.length
      ? settings.workReport.channels
      : settings.workReport?.channelId ? [{ channelId: settings.workReport.channelId }] : [];
    if (!targets.length) return false;
    const embed = new EmbedBuilder()
      .setColor(summary.payments.executed ? 0x22c55e : 0x64748b)
      .setTitle('📊 Daily payout cycle')
      .setDescription(summary.payments.executed
        ? 'Holds enforced, members notified, and the payout batch was submitted.'
        : 'Holds enforced and members notified. The payment step ran as a preview only.')
      .addFields(
        { name: 'Hold checks', value: `${summary.holds.checked} verified · ${summary.holds.voided} voided`, inline: true },
        { name: 'Newly payable', value: `${summary.notifications.members} members · ${summary.notifications.entries} items`, inline: true },
        { name: summary.payments.executed ? 'Paid out' : 'Payable (preview)', value: `${summary.payments.items} members · ${centsToUsd(summary.payments.plannedCents)}`, inline: true },
        { name: 'Skipped', value: summarizeSkips(summary.payments.skipped), inline: false },
      )
      .setFooter({ text: `Run ${summary.runId} · ${summary.dryRun ? 'DRY RUN' : 'LIVE'}` })
      .setTimestamp();
    for (const target of targets) {
      const channel = await client.channels.fetch(target.channelId).catch(() => null);
      if (channel?.isTextBased()) await channel.send({ embeds: [embed] }).catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}

function summarizeSkips(skipped = []) {
  if (!skipped.length) return 'None';
  const counts = new Map();
  for (const skip of skipped) counts.set(skip.reason, (counts.get(skip.reason) || 0) + 1);
  return [...counts.entries()].map(([reason, count]) => `${count}× ${reason.replaceAll('_', ' ')}`).join(' · ');
}

/**
 * Run one full cycle. `dryRun` controls ONLY the payment step; hold
 * enforcement, notifications, and the summary always run for real.
 */
export function runDailyPayoutCycle(client, options = {}) {
  return withPayoutLock(() => runDailyPayoutCycleLocked(client, options));
}

async function runDailyPayoutCycleLocked(client, { dryRun = true, trigger = 'manual', fetchImpl = fetch } = {}) {
  const config = dailyPayoutConfig();
  const dayKey = dayKeyUtc();
  const runId = `daily-${dayKey}-${randomUUID().slice(0, 6)}`;
  const startedAt = new Date().toISOString();

  const holds = await enforceHolds({ fetchImpl });
  const notifications = await notifyNewlyPayable(client);

  const groups = await getPayableEntriesGroupedByUser();
  let receivers = new Map();
  try {
    receivers = await listConfirmedReceivers();
  } catch {
    receivers = new Map(); // receiver store unavailable: everyone skips as no_confirmed_receiver
  }
  const plan = planDailyPayouts({
    groups,
    receivers,
    paidToday: await blockedPayoutUserIds(dayKey),
    minCents: config.minCents,
    dailyCapCents: config.dailyCapCents,
    dayKey,
  });

  const payments = {
    planned: plan.items.length,
    plannedCents: plan.plannedCents,
    skipped: plan.skipped,
    items: plan.items.length,
    executed: false,
    batchId: '',
    errors: [],
  };

  const paypal = paypalPayoutStatus();
  /* The caller already encodes intent: the scheduler passes dryRun=false only
     when PAYOUT_AUTO_DAILY=1, and an admin passes it via execute:true. */
  const wantReal = !dryRun;
  if (plan.items.length && wantReal && paypal.readyForRealMoney) {
    const batchItems = [];
    for (const item of plan.items) {
      const receiver = await resolveReceiverEmail(item.userId).catch(() => null);
      if (!receiver) {
        payments.skipped.push({ userId: item.userId, reason: 'receiver_unreadable', totalCents: item.amountCents });
        continue;
      }
      batchItems.push({ ...item, receiverEmail: receiver.email, emailMasked: receiver.emailMasked });
    }
    if (batchItems.length) {
      try {
        /* Written BEFORE the batch leaves this process - see paidTodayUserIds. */
        await appendCycleAudit({
          type: 'payment_intent',
          runId,
          dayKey,
          userIds: batchItems.map((item) => item.userId),
          totalCents: batchItems.reduce((sum, item) => sum + item.amountCents, 0),
          at: new Date().toISOString(),
        });
        const batch = await createPayPalBatchPayout({
          items: batchItems.map((item) => ({
            receiverEmail: item.receiverEmail,
            amountCents: item.amountCents,
            senderItemId: item.senderItemId,
            note: `Daily Social Payouts daily run for Discord user ${item.userId}`,
          })),
          senderBatchId: dailyBatchId(dayKey, batchItems.map((item) => item.userId)),
          dryRunOverride: false,
        });
        payments.executed = !batch.dryRun;
        payments.batchId = batch.batchId;
        if (payments.executed) {
          for (const item of batchItems) {
            await markPayoutEntriesPaid({
              userId: item.userId,
              entryIds: item.entryIds,
              paidBy: `daily-cycle:${trigger}`,
              receiver: item.emailMasked, // masked on purpose: the ledger renders in Discord
              payoutBatchId: batch.batchId,
              payoutItemId: item.senderItemId,
              dryRun: false,
            });
            await sendPaidReceipt(client, item);
          }
        }
        payments.items = batchItems.length;
        payments.plannedCents = batchItems.reduce((sum, item) => sum + item.amountCents, 0);
        if (payments.executed) {
          await appendCycleAudit({ type: 'payment_settled', runId, dayKey, userIds: batchItems.map((item) => item.userId), at: new Date().toISOString() });
        }
      } catch (error) {
        payments.errors.push(String(error.message || error).slice(0, 300));
      }
    } else {
      payments.items = 0;
      payments.plannedCents = 0;
    }
  }

  const summary = { runId, dayKey, trigger, dryRun: !payments.executed, startedAt, finishedAt: new Date().toISOString(), holds, notifications, payments, config: { minCents: config.minCents, dailyCapCents: config.dailyCapCents, autoPayEnabled: config.autoPayEnabled, paypalReady: paypal.readyForRealMoney } };
  await appendCycleAudit(summary);
  await postSummaryCard(client, summary);
  return summary;
}

async function sendPaidReceipt(client, item) {
  try {
    const user = await client.users.fetch(item.userId);
    await user.send(
      `✅ **${centsToUsd(item.amountCents)} was sent to your PayPal ${item.emailMasked}.**\n` +
      `${item.entryIds.length} verified item${item.entryIds.length === 1 ? '' : 's'} paid in today's Daily Social Payouts run.\n` +
      'PayPal delivers the funds under its own timing. Use `/earnings` to see the paid entries.'
    );
  } catch {
    /* closed DMs: the payment stands, the ledger is the record */
  }
}

/* ---------------- scheduler ---------------- */

async function lastScheduledRun() {
  const rows = await readJson(paths.payoutCycleAudit, []);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!row?.type && (row?.trigger === 'scheduled' || row?.trigger === 'startup-catch-up')) return row;
  }
  return null;
}

export function startDailyPayoutScheduler(client) {
  const config = dailyPayoutConfig();
  let running = false;
  const tick = async (trigger) => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      /* "Past due and not yet run today" instead of an exact-hour window:
         restarts and downtime spanning the scheduled hour just run late the
         same day, and a manual preview never satisfies the schedule. */
      const scheduledAtMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), config.hourUtc);
      const last = await lastScheduledRun();
      if (Date.now() < scheduledAtMs || last?.dayKey === dayKeyUtc(now)) return;
      const summary = await runDailyPayoutCycle(client, { dryRun: !config.autoPayEnabled, trigger: 'scheduled' });
      console.log(`Daily payout cycle ${summary.runId}: holds ${summary.holds.voided} voided, ${summary.notifications.members} members notified, payments ${summary.payments.executed ? 'EXECUTED' : 'preview'} (${centsToUsd(summary.payments.plannedCents)}).`);
    } catch (error) {
      console.warn(`Daily payout cycle failed: ${error.message || error}`);
    } finally {
      running = false;
    }
  };
  setTimeout(() => tick('startup'), 30_000);
  const interval = setInterval(() => tick('interval'), 30 * 60_000);
  interval.unref?.();
  return interval;
}
