import { AuditLogEvent, PermissionFlagsBits } from 'discord.js';

const protectedGuildIds = new Set([
  '938894329076940820',
  '1547568823920623658',
]);
const tkUserId = '892826929869254727';
const ownerUserId = '1087769175453339648';
const recentBotMessages = new Map();
const maxRecentMessages = 500;

function snapshotMessage(message) {
  return {
    id: message.id,
    channelId: message.channelId,
    guildId: message.guildId,
    authorId: message.author?.id,
    content: message.content || '',
    embeds: message.embeds?.map((embed) => embed.toJSON?.() || embed.data || embed) || [],
    attachments: [...(message.attachments?.values?.() || [])].map((attachment) => attachment.url).filter(Boolean),
    createdTimestamp: message.createdTimestamp || Date.now(),
  };
}

function remember(message) {
  if (!message?.guildId || !protectedGuildIds.has(message.guildId)) return;
  if (!message.client?.user?.id || message.author?.id !== message.client.user.id) return;
  recentBotMessages.set(message.id, snapshotMessage(message));
  while (recentBotMessages.size > maxRecentMessages) {
    recentBotMessages.delete(recentBotMessages.keys().next().value);
  }
}

async function identifyRecentDeleter(message) {
  const guild = message.guild;
  if (!guild?.members?.me?.permissions?.has(PermissionFlagsBits.ViewAuditLog)) return null;
  const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 6 }).catch(() => null);
  const entry = logs?.entries?.find((item) => {
    const age = Date.now() - item.createdTimestamp;
    return age < 10_000
      && item.target?.id === message.client.user.id
      && item.extra?.channel?.id === message.channelId;
  });
  if (!entry) return null;
  return {
    id: entry.executor?.id || '',
    tag: entry.executor?.tag || entry.executor?.username || '',
    reason: entry.reason || '',
  };
}

async function repostDeletedBotMessage(message, snapshot, deleter) {
  const channel = await message.client.channels.fetch(snapshot.channelId).catch(() => null);
  if (!channel?.isTextBased()) return { skipped: true, reason: 'channel_unavailable' };

  const lines = [
    '@everyone',
    '🚨 **Deleted StockMarketLoop Connect notice restored** 🚨',
    deleter?.id
      ? `A protected bot notice was deleted by <@${deleter.id}> and has been restored automatically.`
      : 'A protected bot notice was deleted and has been restored automatically.',
    '',
    snapshot.content || '_Original bot message had no text content._',
  ];

  const attachmentLinks = snapshot.attachments.length
    ? `\n\n**Original attachments:**\n${snapshot.attachments.map((url) => `- ${url}`).join('\n')}`
    : '';

  const restored = await channel.send({
    content: `${lines.join('\n')}${attachmentLinks}`,
    embeds: snapshot.embeds,
    allowedMentions: { parse: ['everyone'], users: [deleter?.id, ownerUserId].filter(Boolean) },
  });

  return { restoredMessageId: restored.id, url: restored.url };
}

export function trackProtectedBotMessage(message) {
  remember(message);
}

export async function restoreProtectedBotMessageDelete(message) {
  if (!message?.guildId || !protectedGuildIds.has(message.guildId)) return { skipped: true, reason: 'guild_not_protected' };
  const snapshot = recentBotMessages.get(message.id) || (!message.partial ? snapshotMessage(message) : null);
  if (!snapshot || snapshot.authorId !== message.client.user.id) return { skipped: true, reason: 'not_known_bot_message' };

  const deleter = await identifyRecentDeleter(message);
  if (deleter?.id && deleter.id !== tkUserId) return { skipped: true, reason: 'deleted_by_non_tk', deleter };

  const result = await repostDeletedBotMessage(message, snapshot, deleter);
  recentBotMessages.delete(message.id);
  return { ...result, deleter };
}
