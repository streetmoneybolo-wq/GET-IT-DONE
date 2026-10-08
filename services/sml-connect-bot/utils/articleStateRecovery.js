import path from 'node:path';
import { parseAlertMessage } from './alertParser.js';

const DEFAULT_MILESTONES = [100, 200, 500, 700, 900, 1200];
const completedStatuses = new Set(['published', 'drafted', 'superseded']);

function channelRefs(settings) {
  const refs = new Map();
  const monitor = settings.alertMonitor || {};
  if (monitor.sources?.length) {
    for (const row of monitor.sources) if (row.channelId && row.guildId) refs.set(String(row.channelId), String(row.guildId));
    return refs;
  }
  for (const id of monitor.channelIds || []) refs.set(String(id), String(monitor.guildId || ''));
  for (const row of settings.discordAlertMirror?.channels || []) {
    if (row.sourceChannelId) refs.set(String(row.sourceChannelId), String(row.sourceGuildId || ''));
    if (row.targetChannelId) refs.set(String(row.targetChannelId), String(row.targetGuildId || ''));
  }
  return refs;
}

function recoverVisual(message, parsed, visualFiles, uploads, now) {
  const matches = visualFiles.filter((filename) => path.basename(filename).startsWith(`${parsed.symbol.toLowerCase()}-grandmaster-obi-discord-alert-${message.id}-`) && /-[a-f0-9]{12}\.png$/i.test(filename));
  const selected = matches.find((filename) => uploads[`${message.id}:${path.basename(filename).match(/-([a-f0-9]{12})\.png$/i)[1]}`]?.mediaId) || (matches.length === 1 ? matches[0] : null);
  if (!selected) return null;
  const hash = path.basename(selected).match(/-([a-f0-9]{12})\.png$/i)[1];
  return {
    path: selected, filename: path.basename(selected), hash, width: 1200, height: 675,
    recoveredAt: now, title: `Grandmaster-OBI $${parsed.symbol} Discord alert record`,
    altText: `$${parsed.symbol} stock alert record posted by Grandmaster-OBI in the Making Easy Money Discord`,
    caption: `Rendered record of the original $${parsed.symbol} alert by ${message.authorTag || 'Grandmaster-OBI'} in the Making Easy Money Discord at ${message.createdAt}.`,
    description: `Editorial evidence image recovered for Discord message ${message.id}. The image preserves the original alert record.`,
  };
}

function auditMilestone(row) {
  const explicit = Number(row.milestoneGainPercent);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const match = String(row.jobId || row.id || '').match(/:milestone:(\d+)(?::|$)/);
  return match ? Number(match[1]) : null;
}

/** Pure reconstruction. No files, remote APIs, publication or messaging. */
export function recoverArticleState({ alerts = [], jobs = [], backupAlerts = [], backupJobs = [], archive = {}, audit = [], visualFiles = [], uploads = {}, settings = {}, now = new Date().toISOString() }) {
  const recoveredAlerts = new Map();
  const recoveredJobs = new Map();
  const references = channelRefs(settings);
  const milestones = settings.alertMonitor?.milestoneGainPercents || DEFAULT_MILESTONES;
  const reports = { existingAlerts: alerts.length, existingJobs: jobs.length, archiveAdded: 0, backupAlertsAdded: 0, auditJobsAdded: 0, missingSources: [], missingVisuals: [], publicationReviewHolds: [], ignoredArchiveRows: 0 };
  // Current valid data always wins over old backups. Clone to keep caller state immutable.
  for (const row of alerts) if (row?.messageId) recoveredAlerts.set(String(row.messageId), structuredClone(row));
  for (const row of jobs) if (row?.id) recoveredJobs.set(String(row.id), structuredClone(row));
  for (const row of backupAlerts) if (row?.messageId && !recoveredAlerts.has(String(row.messageId))) {
    recoveredAlerts.set(String(row.messageId), structuredClone(row));
    reports.backupAlertsAdded += 1;
  }
  for (const row of backupJobs) if (row?.id && !recoveredJobs.has(String(row.id))) recoveredJobs.set(String(row.id), structuredClone(row));
  for (const [channelId, rows] of Object.entries(archive.messages || {})) {
    if (!references.has(channelId)) continue;
    for (const row of rows || []) {
      if (!row?.id || row.authorBot || row.bot || !row.content || !Number.isFinite(Date.parse(row.createdAt))) { reports.ignoredArchiveRows += 1; continue; }
      const source = settings.alertMonitor?.sources?.find((ref) => String(ref.channelId) === channelId);
      if (source?.authorIds?.length && !source.authorIds.includes(row.authorId)) { reports.ignoredArchiveRows += 1; continue; }
      // The local archive contains original human messages. Never parse copied
      // bridge payloads as a second original alert.
      if (/^\*\*GrandMaster (?:Swings|LongTerm)\*\*\s*\nPosted by /i.test(row.content)) { reports.ignoredArchiveRows += 1; continue; }
      const parsed = parseAlertMessage(row.content, row.createdAt, settings.alertMonitor?.marketTimezone || 'America/New_York');
      if (!parsed) continue;
      const existing = recoveredAlerts.get(String(row.id));
      if (existing) continue;
      const visual = recoverVisual(row, parsed, visualFiles, uploads, now);
      const needsVisual = settings.articleAutomation?.alertVisuals?.enabled !== false && settings.articleAutomation?.alertVisuals?.required !== false && !visual;
      recoveredAlerts.set(String(row.id), {
        messageId: String(row.id), guildId: archive.channels?.[channelId]?.guildId || references.get(channelId), channelId,
        authorId: row.authorId || '', authorName: row.authorTag || '', messageTimestamp: row.createdAt,
        edited: false, needsReview: Boolean(parsed.needsReview || needsVisual), current: parsed,
        alertVisual: visual, alertVisualError: needsVisual ? 'Recovered source requires alert visual hydration.' : '',
        recoveryNeedsVisual: needsVisual, recoveredAt: now, recoverySource: 'protected-channel-archive',
        revisions: [{ observedAt: now, eventType: 'state-recovery', content: row.content, parsed, alertVisualHash: visual?.hash || '' }],
        trackingStatus: parsed.needsReview || needsVisual ? 'awaiting-review' : 'ready-for-market-data',
        performanceTracking: { tradingDayLimit: Number(settings.alertMonitor?.trackingTradingDays || 5), highestVerifiedPrice: null, highestVerifiedAt: null, completedMilestones: [], firstMilestoneArticleAt: null, endOfDayRecapCompleted: false },
      });
      reports.archiveAdded += 1;
    }
  }
  // Audit is durable evidence of WordPress delivery. A missing pending state
  // must never cause an already delivered job to be placed back in the queue.
  const sortedAudit = [...audit].sort((a, b) => String(a.completedAt || '').localeCompare(String(b.completedAt || '')));
  for (const row of sortedAudit) {
    if (!row.jobId || !row.alertMessageId || !Number(row.wordpressPostId)) continue;
    const id = String(row.alertMessageId);
    const previousJob = recoveredJobs.get(row.jobId);
    const status = row.wordpressStatus === 'publish' ? 'published' : 'drafted';
    const milestone = auditMilestone(row);
    const completedMilestones = milestone ? milestones.filter((value) => Number(value) <= milestone).map(Number) : [];
    if (!previousJob) reports.auditJobsAdded += 1;
    const job = {
      ...previousJob, id: row.jobId, alertMessageId: id, type: row.type || (/:eod:/.test(row.jobId) ? 'eod' : 'milestone'),
      // A later draft audit must not undo a publication known to be complete.
      status: previousJob?.status === 'published' ? 'published' : status,
      wordpressPostId: Number(row.wordpressPostId), wordpressUrl: row.wordpressUrl || previousJob?.wordpressUrl || `https://stockmarketloop.com/?p=${Number(row.wordpressPostId)}`,
      wordpressEditUrl: row.wordpressEditUrl || previousJob?.wordpressEditUrl || '',
      attempts: Number(previousJob?.attempts || 0), completedAt: row.completedAt || previousJob?.completedAt || now,
      nextAttemptAt: null, lastError: null, recoveredAt: now, recoverySource: 'article-audit',
      ...(milestone ? { milestoneGainPercent: milestone, crossedMilestones: [...new Set([...(previousJob?.crossedMilestones || []), ...completedMilestones])] } : {}),
    };
    recoveredJobs.set(row.jobId, job);
    let alert = recoveredAlerts.get(id);
    if (!alert) {
      alert = { messageId: id, guildId: '', channelId: '', authorId: '', authorName: '', messageTimestamp: '', current: { kind: 'equity', symbol: row.symbol || '', raw: '' }, needsReview: true, recoverySourceMissing: true, trackingStatus: 'complete', recoverySource: 'article-audit-only', recoveredAt: now, revisions: [], performanceTracking: {} };
      recoveredAlerts.set(id, alert);
    }
    const tracking = alert.performanceTracking ||= {};
    tracking.completedMilestones = [...new Set([...(tracking.completedMilestones || []), ...completedMilestones])].sort((a, b) => a - b);
    if (job.type === 'eod') tracking.endOfDayRecapCompleted = true;
    if (milestone) tracking.firstMilestoneArticleAt ||= row.completedAt || now;
    tracking.lastArticlePostId = Number(row.wordpressPostId);
    tracking.lastArticleUrl = job.wordpressUrl;
  }
  for (const alert of recoveredAlerts.values()) {
    // Missing publication history is not proof that an old alert was never
    // published: several historical stories were produced by manual scripts.
    // Preserve recovered evidence, but require reconciliation before replay.
    if (!alerts.some((row) => row.messageId === alert.messageId) && !sortedAudit.some((row) => row.alertMessageId === alert.messageId)) {
      alert.recoveryPublicationReview = true;
      alert.needsReview = true;
      alert.trackingStatus = 'awaiting-review';
      alert.recoveryReviewReason = 'Recovered historical alert has no reconciled publication ledger; automatic replay is held to prevent duplicates.';
    }
    if (alert.recoveryPublicationReview) reports.publicationReviewHolds.push(alert.messageId);
    const archivedAge = Date.parse(now) - Date.parse(alert.messageTimestamp || '');
    if (!alerts.some((row) => row.messageId === alert.messageId) && archivedAge > 14 * 86400_000) {
      if (sortedAudit.some((row) => row.alertMessageId === alert.messageId)) alert.trackingStatus = 'complete';
      else { alert.needsReview = true; alert.recoveryHistoricalReview = true; alert.trackingStatus = 'awaiting-review'; }
    }
    if (alert.recoverySourceMissing) reports.missingSources.push(alert.messageId);
    if (alert.recoveryNeedsVisual) reports.missingVisuals.push(alert.messageId);
    const tracking = alert.performanceTracking ||= {};
    const completed = new Set(tracking.completedMilestones || []);
    tracking.queuedMilestones = [...new Set([...recoveredJobs.values()].filter((job) => job.alertMessageId === alert.messageId && !completedStatuses.has(job.status)).flatMap((job) => job.crossedMilestones || []))].filter((value) => !completed.has(value));
    if (tracking.endOfDayRecapCompleted) tracking.endOfDayRecapQueued = false;
  }
  return { alerts: [...recoveredAlerts.values()], jobs: [...recoveredJobs.values()], report: { ...reports, alerts: recoveredAlerts.size, jobs: recoveredJobs.size } };
}
