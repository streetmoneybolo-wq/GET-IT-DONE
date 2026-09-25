import { paths, mutateJson, readJson } from './storage.js';
import { centsToUsd, engagementRate, payoutPolicy, publishedLinkRate } from './payoutPolicy.js';

const openStatuses = new Set(['pending_hold', 'approved']);

function nowIso() {
  return new Date().toISOString();
}

function parseOrNow(timestamp) {
  const parsed = Date.parse(timestamp || '');
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function payableAtFrom(timestamp) {
  return new Date(parseOrNow(timestamp) + payoutPolicy.verificationHoldHours * 3_600_000).toISOString();
}

function normalizePlatform(platform) {
  return String(platform || '').toLowerCase();
}

async function upsertLedgerEntry(entry) {
  let saved = null;
  await mutateJson(paths.payoutLedger, [], (rows) => {
    const existing = rows.find((row) => row.sourceId === entry.sourceId);
    if (existing) {
      saved = existing;
      return;
    }
    const row = {
      id: entry.sourceId,
      ...entry,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    rows.push(row);
    saved = row;
  });
  return saved;
}

export async function recordPublishedLinkPayout({ post, externalPost, intent }) {
  const platform = normalizePlatform(externalPost?.platform);
  const submittedAt = externalPost?.timestamp || nowIso();
  const assignedAt = intent?.timestamp || post?.timestamp || submittedAt;
  const rate = publishedLinkRate({ platform, assignedAt, submittedAt });
  if (!rate) return null;
  return upsertLedgerEntry({
    sourceId: `external-link:${externalPost.id}`,
    type: 'published_link',
    status: 'pending_hold',
    userId: externalPost.userId,
    userName: externalPost.userName || '',
    platform,
    platformLabel: rate.label,
    action: 'published_link',
    amountCents: rate.cents,
    amountUsd: centsToUsd(rate.cents),
    rateRule: rate.rule,
    fastBonus: rate.fast,
    postID: post?.postID || '',
    postTitle: post?.title || '',
    articleUrl: post?.link || '',
    publicUrl: externalPost.url || '',
    assignedAt,
    submittedAt,
    payableAt: payableAtFrom(submittedAt),
    minimumPublicUntil: new Date(parseOrNow(submittedAt) + payoutPolicy.publicLinkMinimumHours * 3_600_000).toISOString(),
    holdHours: payoutPolicy.verificationHoldHours,
    notes: 'Pending hold. Void if the public link is removed, hidden, duplicated, or rejected before the verification threshold.',
  });
}

export async function recordApprovedProofPayout({ proof, post }) {
  if (!proof || proof.status !== 'approved') return null;
  const platform = normalizePlatform(proof.platform);
  const externalPost = post?.externalPosts?.find((entry) => entry.id === proof.externalPostId);
  const assignedAt = externalPost?.timestamp || post?.timestamp || proof.createdAt;
  const submittedAt = proof.reviewedAt || proof.createdAt || nowIso();
  const rate = engagementRate({ platform, action: proof.action, assignedAt, submittedAt });
  if (!rate) return null;
  return upsertLedgerEntry({
    sourceId: `proof:${proof.id}`,
    type: 'engagement_proof',
    status: 'pending_hold',
    userId: proof.userId,
    userName: proof.userName || '',
    platform,
    platformLabel: rate.label,
    action: proof.action,
    amountCents: rate.cents,
    amountUsd: centsToUsd(rate.cents),
    rateRule: rate.rule,
    fastBonus: rate.fast,
    postID: proof.postID || post?.postID || '',
    postTitle: post?.title || '',
    articleUrl: post?.link || '',
    publicUrl: proof.evidenceUrl || proof.attachment?.url || '',
    assignedAt,
    submittedAt,
    payableAt: payableAtFrom(submittedAt),
    minimumPublicUntil: new Date(parseOrNow(submittedAt) + payoutPolicy.publicLinkMinimumHours * 3_600_000).toISOString(),
    holdHours: payoutPolicy.verificationHoldHours,
    proofId: proof.id,
    reviewedBy: proof.reviewedBy || '',
    reviewedAt: proof.reviewedAt || '',
    notes: 'Approved proof pending hold. Void if the proof or related post is removed, hidden, duplicated, or later rejected.',
  });
}

export async function getPayoutLedger() {
  return readJson(paths.payoutLedger, []);
}

export async function getUserPayoutSummary(userId) {
  const rows = (await getPayoutLedger()).filter((row) => row.userId === userId);
  const now = Date.now();
  const totals = {
    pendingCents: 0,
    payableCents: 0,
    paidCents: 0,
    voidedCents: 0,
    totalEarnedCents: 0,
  };
  for (const row of rows) {
    const amount = Number(row.amountCents || 0);
    if (row.status === 'paid') totals.paidCents += amount;
    else if (['voided', 'voided_removed_before_threshold', 'rejected'].includes(row.status)) totals.voidedCents += amount;
    else if (openStatuses.has(row.status) && Date.parse(row.payableAt || '') <= now) totals.payableCents += amount;
    else if (openStatuses.has(row.status)) totals.pendingCents += amount;
    if (!['voided', 'voided_removed_before_threshold', 'rejected'].includes(row.status)) totals.totalEarnedCents += amount;
  }
  return {
    rows: rows.sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || '')),
    totals,
    formatted: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, centsToUsd(value)])),
  };
}

export async function getPayablePayoutEntries(userId) {
  const now = Date.now();
  return (await getPayoutLedger())
    .filter((row) => (
      row.userId === userId &&
      openStatuses.has(row.status) &&
      Date.parse(row.payableAt || '') <= now &&
      Number(row.amountCents || 0) > 0
    ))
    .sort((a, b) => Date.parse(a.createdAt || '') - Date.parse(b.createdAt || ''));
}

export async function markPayoutEntriesPaid({ userId, entryIds, paidBy, receiver, payoutBatchId, payoutItemId = '', dryRun = false }) {
  const ids = new Set(entryIds || []);
  let totalCents = 0;
  let changed = 0;
  const paidAt = nowIso();
  await mutateJson(paths.payoutLedger, [], (rows) => {
    for (const row of rows) {
      if (row.userId !== userId || !ids.has(row.id || row.sourceId) || !openStatuses.has(row.status)) continue;
      row.status = dryRun ? 'dry_run_paid_preview' : 'paid';
      row.paidAt = paidAt;
      row.paidBy = paidBy || '';
      row.payoutReceiver = receiver || '';
      row.payoutBatchId = payoutBatchId || '';
      row.payoutItemId = payoutItemId || '';
      row.updatedAt = paidAt;
      totalCents += Number(row.amountCents || 0);
      changed += 1;
    }
  });
  return { changed, totalCents, paidAt };
}

/**
 * Open (unpaid, unvoided) entries, for the daily cycle: hold enforcement,
 * payable notifications, and batch planning all start from this list.
 */
export async function getOpenEntries() {
  return (await getPayoutLedger()).filter((row) => openStatuses.has(row.status));
}

/**
 * Payable balances grouped per member, oldest member first so a daily cap
 * starves nobody permanently: whoever has waited longest is paid first.
 */
export async function getPayableEntriesGroupedByUser() {
  const now = Date.now();
  const groups = new Map();
  for (const row of await getPayoutLedger()) {
    if (!openStatuses.has(row.status)) continue;
    const payableAtMs = Date.parse(row.payableAt || '');
    if (!Number.isFinite(payableAtMs) || payableAtMs > now) continue; // corrupt hold data is never payable
    if (Number(row.amountCents || 0) <= 0) continue;
    const group = groups.get(row.userId) || { userId: row.userId, userName: row.userName || '', entries: [], totalCents: 0, oldestCreatedAt: row.createdAt || '' };
    group.entries.push(row);
    group.totalCents += Number(row.amountCents || 0);
    if (!group.userName && row.userName) group.userName = row.userName;
    if (Date.parse(row.createdAt || '') < Date.parse(group.oldestCreatedAt || '') || !group.oldestCreatedAt) group.oldestCreatedAt = row.createdAt || '';
    groups.set(row.userId, group);
  }
  return [...groups.values()].sort((a, b) => Date.parse(a.oldestCreatedAt || '') - Date.parse(b.oldestCreatedAt || ''));
}

/**
 * Mark entries as having had their "your balance is payable" notification
 * sent, so a member is told once per entry, not once per day forever.
 */
export async function markEntriesNotifiedPayable(sourceIds, { delivered = true } = {}) {
  const ids = new Set(sourceIds || []);
  let changed = 0;
  const at = nowIso();
  await mutateJson(paths.payoutLedger, [], (rows) => {
    for (const row of rows) {
      if (!ids.has(row.id || row.sourceId) || row.notifiedPayableAt) continue;
      row.notifiedPayableAt = at;
      row.notifiedPayableDelivered = Boolean(delivered);
      row.updatedAt = at;
      changed += 1;
    }
  });
  return changed;
}

export async function voidPayoutEntry(sourceId, reason = 'Removed before verification threshold') {
  let changed = false;
  await mutateJson(paths.payoutLedger, [], (rows) => {
    const row = rows.find((entry) => entry.sourceId === sourceId);
    if (!row || row.status === 'paid') return;
    row.status = 'voided_removed_before_threshold';
    row.voidReason = String(reason || '').slice(0, 300);
    row.updatedAt = nowIso();
    changed = true;
  });
  return changed;
}
