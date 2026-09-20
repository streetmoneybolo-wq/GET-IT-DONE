import { mutateJson, paths, readJson, readSettings } from './storage.js';
import { parseAlertMessage } from './alertParser.js';
import { createAlertVisual } from './alertVisual.js';

export function monitoredChannelRefs(settings) {
  const monitor = settings.alertMonitor || {};
  const refs = [];
  for (const ref of monitor.sources || []) {
    if (ref.guildId && ref.channelId) refs.push({ guildId: ref.guildId, channelId: ref.channelId });
  }
  if (monitor.guildId) {
    for (const channelId of monitor.channelIds || []) refs.push({ guildId: monitor.guildId, channelId });
  }
  for (const row of settings.discordAlertMirror?.channels || []) {
    if (row.sourceGuildId && row.sourceChannelId) refs.push({ guildId: row.sourceGuildId, channelId: row.sourceChannelId });
    if (row.targetGuildId && row.targetChannelId) refs.push({ guildId: row.targetGuildId, channelId: row.targetChannelId });
  }
  const seen = new Set();
  return refs.filter((ref) => {
    const key = `${ref.guildId}:${ref.channelId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function monitorsMessage(settings, message) {
  const refs = monitoredChannelRefs(settings);
  return refs.some((ref) => ref.guildId === message.guildId && ref.channelId === message.channelId);
}

export async function processAlertMessage(message, eventType = 'created') {
  const settings = await readSettings();
  const monitor = settings.alertMonitor || {};
  if (!monitor.enabled || !monitorsMessage(settings, message)) return false;
  // Bridges/webhooks are copies, not new original alerts.
  if (message.author?.bot || message.webhookId) return true;
  const source = (monitor.sources || []).find((row) => row.channelId === message.channelId && row.guildId === message.guildId);
  if (source?.authorIds?.length && !source.authorIds.includes(message.author?.id)) return true;
  if (!message.content) return true;
  const timestamp = message.createdAt?.toISOString?.() || new Date(message.createdTimestamp || Date.now()).toISOString();
  const parsed = parseAlertMessage(message.content, timestamp, monitor.marketTimezone || 'America/New_York');
  if (!parsed) {
    console.warn(`Unparsed message in monitored alert channel: ${message.id}`);
    return true;
  }
  const visualOptions = settings.articleAutomation?.alertVisuals || {};
  let alertVisual = null;
  let alertVisualError = '';
  if (visualOptions.enabled !== false) {
    try {
      alertVisual = await createAlertVisual(message, parsed, settings);
    } catch (error) {
      alertVisualError = String(error.message || error).slice(0, 500);
      console.error(`Alert visual generation failed safely for Discord message ${message.id}:`, alertVisualError);
    }
  }
  const visualReviewRequired = visualOptions.enabled !== false && visualOptions.required !== false && !alertVisual;
  await mutateJson(paths.monitoredAlerts, [], (alerts) => {
    const existing = alerts.find((alert) => alert.messageId === message.id);
    const observation = {
      observedAt: new Date().toISOString(),
      eventType,
      content: message.content,
      parsed,
      alertVisualHash: alertVisual?.hash || '',
      alertVisualError,
    };
    if (existing) {
      if (existing.recoveryNeedsVisual && alertVisual && !existing.edited && !parsed.needsReview && eventType !== 'updated' && !existing.recoverySourceMissing && !existing.recoveryPublicationReview && !existing.recoveryHistoricalReview) {
        existing.needsReview = false;
        existing.recoveryNeedsVisual = false;
        existing.trackingStatus = 'ready-for-market-data';
      }
      existing.edited = existing.edited || eventType === 'updated';
      existing.needsReview = existing.needsReview || eventType === 'updated' || parsed.needsReview || visualReviewRequired;
      existing.current = parsed;
      existing.alertVisual = alertVisual;
      existing.alertVisualError = alertVisualError;
      existing.revisions ||= [];
      existing.revisions.push(observation);
      return;
    }
    alerts.push({
      messageId: message.id,
      guildId: message.guildId,
      channelId: message.channelId,
      authorId: message.author?.id || '',
      authorName: message.author?.username || '',
      messageTimestamp: timestamp,
      edited: false,
      needsReview: parsed.needsReview || visualReviewRequired || eventType === 'backfill',
      recoveryHistoricalReview: eventType === 'backfill',
      current: parsed,
      alertVisual,
      alertVisualError,
      revisions: [observation],
      trackingStatus: parsed.needsReview || visualReviewRequired || eventType === 'backfill' ? 'awaiting-review' : 'ready-for-market-data',
      performanceTracking: {
        tradingDayLimit: Number(monitor.trackingTradingDays || 5),
        highestVerifiedPrice: null,
        highestVerifiedAt: null,
        completedMilestones: [],
        firstMilestoneArticleAt: null,
        endOfDayRecapCompleted: false,
      },
    });
  });
  console.log(`Captured ${parsed.kind} alert ${parsed.symbol} from Discord message ${message.id}${parsed.needsReview ? ' (review required)' : ''}.`);
  return true;
}

export async function backfillAlertHistory(client, perChannelLimit = 100) {
  const settings = await readSettings();
  const monitor = settings.alertMonitor || {};
  if (!monitor.enabled) return { checked: 0, captured: 0 };
  const existing = await readJson(paths.monitoredAlerts, []);
  const newestStored = existing.reduce((latest, row) => Math.max(latest, Date.parse(row.messageTimestamp || '') || 0), 0);
  let checked = 0;
  let captured = 0;
  let visualsHydrated = 0;
  const hydratedIds = new Set();
  for (const { channelId } of monitoredChannelRefs(settings)) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !channel.messages?.fetch) continue;
    const missingVisuals = existing.filter((row) => row.channelId === channelId && !row.alertVisual?.hash);
    for (const stored of missingVisuals) {
      const message = await channel.messages.fetch(stored.messageId).catch(() => null);
      if (!message) continue;
      checked += 1;
      await processAlertMessage(message, 'backfill-visual');
      const refreshed = await readJson(paths.monitoredAlerts, []);
      if (refreshed.find((row) => row.messageId === message.id)?.alertVisual?.hash) {
        visualsHydrated += 1;
        hydratedIds.add(message.id);
      }
    }
    const rows = await channel.messages.fetch({ limit: Math.max(1, Math.min(100, Number(perChannelLimit) || 100)) });
    const ordered = [...rows.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    for (const message of ordered) {
      if (message.author?.bot && message.author?.id === client.user?.id) continue;
      const stored = existing.find((row) => row.messageId === message.id);
      if (hydratedIds.has(message.id) || (newestStored && message.createdTimestamp <= newestStored && stored?.alertVisual?.hash)) continue;
      checked += 1;
      const had = Boolean(stored);
      await processAlertMessage(message, had ? 'backfill-visual' : 'backfill');
      const after = await readJson(paths.monitoredAlerts, []);
      if (!had && after.some((row) => row.messageId === message.id)) captured += 1;
      else if (had && after.find((row) => row.messageId === message.id)?.alertVisual?.hash) visualsHydrated += 1;
    }
  }
  console.log(`Alert startup backfill checked ${checked} messages, captured ${captured} alerts, and hydrated ${visualsHydrated} alert visuals.`);
  return { checked, captured, visualsHydrated };
}
