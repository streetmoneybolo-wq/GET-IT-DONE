import { EmbedBuilder } from 'discord.js';
import { mutateJson, paths, readSettings } from './storage.js';

const labels = {
  link_posted: ['🔗', 'Article link posted'],
  share_opened: ['📤', 'Share composer opened'],
  external_link_returned: ['✅', 'Published post link returned'],
  comment: ['💬', 'Comment added'],
  like: ['👍', 'Like added'],
  upvote: ['⬆️', 'Upvote added'],
  boost: ['🚀', 'Boost added'],
  repost: ['🔁', 'Repost reaction added'],
  like_removed: ['↩️', 'Like removed'],
  upvote_removed: ['↩️', 'Upvote removed'],
  boost_removed: ['↩️', 'Boost removed'],
  repost_removed: ['↩️', 'Repost reaction removed'],
};

const internalXp = {
  comment: 8,
  like: 6,
  upvote: 6,
  boost: 5,
  repost: 12,
  like_removed: -6,
  upvote_removed: -6,
  boost_removed: -5,
  repost_removed: -12,
};

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

async function reserveEvent(eventKey) {
  let reserved = false;
  await mutateJson(paths.workReportEvents, [], (rows) => {
    const existing = rows.find((row) => row.eventKey === eventKey);
    if (existing) {
      if (existing.status === 'failed') {
        existing.status = 'pending';
        existing.retryAt = new Date().toISOString();
        reserved = true;
      }
      return;
    }
    rows.push({ eventKey, status: 'pending', createdAt: new Date().toISOString() });
    reserved = true;
    if (rows.length > 10_000) rows.splice(0, rows.length - 10_000);
  });
  return reserved;
}

async function finishEvent(eventKey, patch) {
  await mutateJson(paths.workReportEvents, [], (rows) => {
    const row = rows.find((entry) => entry.eventKey === eventKey);
    if (row) Object.assign(row, patch, { updatedAt: new Date().toISOString() });
  });
}

export async function reportWorkEvent(client, event) {
  const settings = await readSettings();
  const targets = settings.workReport?.channels?.length
    ? settings.workReport.channels
    : settings.workReport?.channelId ? [{ channelId: settings.workReport.channelId }] : [];
  if (!settings.workReport?.enabled || !targets.length || !event.eventKey) return false;
  let delivered = false;
  for (const target of targets) {
    const channelId = target.channelId;
    const deliveryKey = `${event.eventKey}:${channelId}`;
    if (!channelId || !await reserveEvent(deliveryKey)) continue;
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased()) throw new Error('Configured work-report channel is unavailable.');
    const [emoji, label] = labels[event.type] || ['📋', event.type || 'Work event'];
    const articleUrl = safeUrl(event.articleUrl || event.post?.link);
    const actionUrl = safeUrl(event.actionUrl);
    const verification = event.type === 'share_opened'
      ? 'Intent recorded — the composer opened, but publication is not yet verified.'
      : event.type === 'external_link_returned'
        ? 'Public post URL returned — counted as completed work.'
        : event.type === 'link_posted'
          ? 'Article intake recorded and connected to its tracking package.'
          : event.type.includes('removed')
            ? 'The earlier Discord reaction was removed and the user total was adjusted.'
            : 'Discord activity recorded directly by the bot.';
    const fields = [
      { name: '👤 Member', value: `**${String(event.userName || 'unknown').slice(0, 80)}**\nUser ID: \`${event.userId}\``, inline: true },
      { name: '✅ Work completed', value: label, inline: true },
      { name: '🕒 When', value: `<t:${Math.floor(Date.now() / 1000)}:F>\n<t:${Math.floor(Date.now() / 1000)}:R>`, inline: false },
    ];
    if (event.platform) fields.splice(2, 0, { name: '🌐 Platform', value: String(event.platform).slice(0, 80), inline: true });
    if (Object.hasOwn(internalXp, event.type)) {
      const points = internalXp[event.type];
      fields.push({
        name: '⭐ Internal XP',
        value: `${points > 0 ? '+' : ''}${points} XP · Non-redeemable and no cash value`,
        inline: true,
      });
    }
    if (event.post?.title) fields.push({ name: '📰 Work item', value: String(event.post.title).slice(0, 500), inline: false });
    if (event.content) fields.push({ name: '💬 Comment text', value: String(event.content).slice(0, 500), inline: false });
    if (articleUrl) fields.push({ name: '🔗 Article', value: articleUrl, inline: false });
    if (actionUrl && actionUrl !== articleUrl) fields.push({ name: '🔗 Completed public post', value: actionUrl, inline: false });
    if (event.payout?.amountUsd) fields.push({
      name: '💵 Payout ledger',
      value: `${event.payout.amountUsd} · ${event.payout.rateRule}\nStatus: ${String(event.payout.status || 'pending_hold').replaceAll('_', ' ')}\nPayable after: <t:${Math.floor(Date.parse(event.payout.payableAt || new Date()) / 1000)}:f> if still valid`,
      inline: false,
    });
    fields.push({ name: '🔎 Verification status', value: verification, inline: false });
    const message = await channel.send({
      embeds: [new EmbedBuilder().setColor(event.type.includes('removed') ? 0x6b7280 : event.type === 'external_link_returned' ? 0x22c55e : 0x00a8ff).setTitle(`${emoji} ${label}`).setDescription(`Activity report for **${String(event.userName || 'unknown').slice(0, 80)}**`).addFields(fields).setFooter({ text: `Work ID ${event.eventKey.slice(0, 80)}` })],
      allowedMentions: { parse: [] },
    });
      await finishEvent(deliveryKey, { status: 'sent', messageId: message.id, channelId: message.channelId });
      delivered = true;
    } catch (error) {
      await finishEvent(deliveryKey, { status: 'failed', error: String(error.message || error).slice(0, 300) });
      console.error(`Work-report event ${event.eventKey} to ${channelId} failed safely:`, error.message || error);
    }
  }
  return delivered;
}
