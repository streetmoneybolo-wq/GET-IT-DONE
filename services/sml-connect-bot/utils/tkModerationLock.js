import { AuditLogEvent, PermissionFlagsBits } from 'discord.js';

const protectedGuildIds = new Set([
  '938894329076940820',
  '1547568823920623658',
]);
const tkUserId = '892826929869254727';
const ownerUserId = '1087769175453339648';
const newServerInvite = 'https://discord.gg/UH2PkXGhrM';
const logChannelIds = [
  '1547569282794258515',
  '1547569284312469594',
  '938944228719997048',
].filter(Boolean);

async function findRecentAuditEntry(guild, type, targetId, maxAgeMs = 15_000) {
  if (!guild?.members?.me?.permissions?.has(PermissionFlagsBits.ViewAuditLog)) return null;
  const logs = await guild.fetchAuditLogs({ type, limit: 8 }).catch(() => null);
  return logs?.entries?.find((entry) => {
    const age = Date.now() - entry.createdTimestamp;
    return age < maxAgeMs && entry.target?.id === targetId;
  }) || null;
}

async function notify(client, content) {
  for (const channelId of logChannelIds) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) continue;
    await channel.send({
      content,
      allowedMentions: { users: [ownerUserId, tkUserId] },
    }).catch(() => {});
  }
}

export async function reverseTkBan(ban) {
  const guild = ban.guild;
  if (!guild?.id || !protectedGuildIds.has(guild.id)) return { skipped: true, reason: 'guild_not_protected' };
  const entry = await findRecentAuditEntry(guild, AuditLogEvent.MemberBanAdd, ban.user.id);
  if (entry?.executor?.id !== tkUserId) return { skipped: true, reason: 'not_tk_ban' };

  if (!guild.members.me?.permissions?.has(PermissionFlagsBits.BanMembers)) {
    await notify(guild.client, `🚨 <@${tkUserId}> banned <@${ban.user.id}> in **${guild.name}**, but I cannot unban because the bot is missing Ban Members permission. <@${ownerUserId}>`);
    return { blocked: true, reason: 'missing_ban_members' };
  }

  await guild.members.unban(ban.user.id, 'TK moderation lock: ban reversed; owner approval required');
  await notify(guild.client, `🚨 **TK ban reversed**\n<@${tkUserId}> banned <@${ban.user.id}> in **${guild.name}**. The bot immediately unbanned the member because TK cannot ban members without <@${ownerUserId}> approval.`);
  return { reversed: true, userId: ban.user.id, guildId: guild.id };
}

export async function reportTkKick(member) {
  const guild = member.guild;
  if (!guild?.id || !protectedGuildIds.has(guild.id)) return { skipped: true, reason: 'guild_not_protected' };
  const entry = await findRecentAuditEntry(guild, AuditLogEvent.MemberKick, member.id);
  if (entry?.executor?.id !== tkUserId) return { skipped: true, reason: 'not_tk_kick' };

  await member.user?.send?.(`# Making Easy Money access notice\nYou were removed from **${guild.name}** by TK. Making Easy Money moderation is now locked so TK cannot remove members without owner approval.\n\nJoin the updated Making Easy Money server here:\n${newServerInvite}\n\nIf you need help restoring access, DM <@${ownerUserId}>.`).catch(() => {});

  await notify(guild.client, `🚨 **TK kick detected**\n<@${tkUserId}> kicked <@${member.id}> from **${guild.name}**. Discord cannot force-rejoin a kicked member, so the bot DM’d the user the updated server invite and alerted <@${ownerUserId}>. TK is not authorized to kick/ban without owner approval.`);
  return { detected: true, userId: member.id, guildId: guild.id };
}
