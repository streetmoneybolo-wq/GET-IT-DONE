import { AuditLogEvent, ChannelType, PermissionFlagsBits } from 'discord.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const archiveFile = 'data/protected-channel-archive.json';
const protectedGuildIds = new Set([
  '938894329076940820',
  '1547568823920623658',
]);
const tkUserId = '892826929869254727';
const maxMessagesPerChannel = 250;

async function readArchive() {
  if (!existsSync(archiveFile)) return { channels: {}, messages: {} };
  return JSON.parse(await readFile(archiveFile, 'utf8'));
}

async function writeArchive(data) {
  await mkdir(path.dirname(archiveFile), { recursive: true });
  await writeFile(archiveFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function overwrites(channel) {
  return [...(channel.permissionOverwrites?.cache?.values?.() || [])].map((overwrite) => ({
    id: overwrite.id,
    type: overwrite.type,
    allow: overwrite.allow.bitfield.toString(),
    deny: overwrite.deny.bitfield.toString(),
  }));
}

function snapshotChannel(channel) {
  if (!channel?.guildId || !protectedGuildIds.has(channel.guildId)) return null;
  return {
    id: channel.id,
    guildId: channel.guildId,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId || null,
    position: channel.rawPosition ?? channel.position ?? 0,
    topic: channel.topic || null,
    nsfw: Boolean(channel.nsfw),
    rateLimitPerUser: channel.rateLimitPerUser || 0,
    permissionOverwrites: overwrites(channel),
    archivedAt: new Date().toISOString(),
  };
}

function snapshotMessage(message) {
  if (!message?.guildId || !protectedGuildIds.has(message.guildId)) return null;
  if (!message.channelId || message.author?.bot) return null;
  return {
    id: message.id,
    authorId: message.author?.id || '',
    authorTag: message.author?.tag || message.author?.username || '',
    content: message.content || '',
    attachments: [...(message.attachments?.values?.() || [])].map((attachment) => attachment.url).filter(Boolean),
    createdAt: new Date(message.createdTimestamp || Date.now()).toISOString(),
  };
}

export async function snapshotProtectedChannels(client) {
  const data = await readArchive();
  for (const guildId of protectedGuildIds) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) continue;
    const channels = await guild.channels.fetch().catch(() => null);
    if (!channels) continue;
    for (const channel of channels.values()) {
      const snapshot = snapshotChannel(channel);
      if (snapshot) data.channels[channel.id] = snapshot;
    }
  }
  await writeArchive(data);
  return { channelSnapshots: Object.keys(data.channels).length };
}

export async function archiveProtectedChannelMessage(message) {
  const snapshot = snapshotMessage(message);
  if (!snapshot) return;
  const data = await readArchive();
  const channelSnapshot = snapshotChannel(message.channel);
  if (channelSnapshot) data.channels[message.channelId] = channelSnapshot;
  data.messages[message.channelId] ||= [];
  data.messages[message.channelId].push(snapshot);
  if (data.messages[message.channelId].length > maxMessagesPerChannel) {
    data.messages[message.channelId] = data.messages[message.channelId].slice(-maxMessagesPerChannel);
  }
  await writeArchive(data);
}

async function identifyRecentChannelDeleter(channel) {
  const guild = channel.guild;
  if (!guild?.members?.me?.permissions?.has(PermissionFlagsBits.ViewAuditLog)) return null;
  const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 6 }).catch(() => null);
  const entry = logs?.entries?.find((item) => {
    const age = Date.now() - item.createdTimestamp;
    return age < 15_000 && item.target?.id === channel.id;
  });
  if (!entry) return null;
  return {
    id: entry.executor?.id || '',
    tag: entry.executor?.tag || entry.executor?.username || '',
    reason: entry.reason || '',
  };
}

function supportedRestoreType(type) {
  return [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildVoice,
    ChannelType.GuildCategory,
    ChannelType.GuildForum,
    ChannelType.GuildStageVoice,
  ].includes(type);
}

function channelCreatePayload(snapshot) {
  const body = {
    name: snapshot.name,
    type: supportedRestoreType(snapshot.type) ? snapshot.type : ChannelType.GuildText,
    parent: snapshot.parentId || undefined,
    position: snapshot.position,
    permissionOverwrites: snapshot.permissionOverwrites || [],
    reason: 'Restoring channel deleted by blocked user',
  };
  if ([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(body.type)) {
    body.topic = snapshot.topic || undefined;
    body.nsfw = Boolean(snapshot.nsfw);
    body.rateLimitPerUser = snapshot.rateLimitPerUser || 0;
  }
  return body;
}

async function repostArchivedMessages(channel, deletedChannelId, data) {
  if (!channel?.isTextBased?.()) return 0;
  const messages = data.messages[deletedChannelId] || [];
  if (!messages.length) {
    await channel.send('⚠️ Channel restored, but no archived messages were available to repost. Discord does not expose deleted channel history after deletion unless it was already archived by the bot.').catch(() => {});
    return 0;
  }
  await channel.send(`🔁 **Restored archived messages from deleted channel**\nReposting the latest ${messages.length} archived member messages the bot had saved before deletion.`).catch(() => {});
  let posted = 0;
  for (const msg of messages.slice(-100)) {
    const attachmentText = msg.attachments?.length ? `\nAttachments:\n${msg.attachments.map((url) => `- ${url}`).join('\n')}` : '';
    const content = [
      `**${msg.authorTag || msg.authorId}** · ${msg.createdAt}`,
      msg.content || '_No text content._',
      attachmentText,
    ].join('\n').slice(0, 1900);
    await channel.send({ content, allowedMentions: { parse: [] } }).catch(() => {});
    posted += 1;
  }
  return posted;
}

export async function restoreChannelDeletedByTk(channel) {
  if (!channel?.guildId || !protectedGuildIds.has(channel.guildId)) return { skipped: true, reason: 'guild_not_protected' };
  const deleter = await identifyRecentChannelDeleter(channel);
  if (deleter?.id !== tkUserId) return { skipped: true, reason: 'not_deleted_by_tk', deleter };

  const data = await readArchive();
  const snapshot = data.channels[channel.id] || snapshotChannel(channel);
  if (!snapshot) return { skipped: true, reason: 'no_channel_snapshot', deleter };

  const guild = channel.guild;
  const restored = await guild.channels.create(channelCreatePayload(snapshot));
  const restoredMessages = await repostArchivedMessages(restored, channel.id, data);
  const newSnapshot = snapshotChannel(restored);
  if (newSnapshot) {
    data.channels[restored.id] = newSnapshot;
    data.messages[restored.id] = data.messages[channel.id] || [];
    await writeArchive(data);
  }
  return {
    restoredChannelId: restored.id,
    restoredMessages,
    deleter,
  };
}
