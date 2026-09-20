import { wpRequest } from './wordpressClient.js';

const DEFAULT_GUILD_IDS = ['1547568823920623658']; // Making Easy Money clean server
const queues = new Map();
const dynamicGuildIds = new Set();

function cleanId(value) {
  const id = String(value || '').replace(/\D/g, '');
  return /^\d{15,24}$/.test(id) ? id : '';
}

export function roleSyncEnabled() {
  return process.env.SML_ROLE_SYNC_ENABLED === '1';
}

export function roleSyncGuildIds() {
  const configured = String(process.env.SML_ROLE_SYNC_GUILD_IDS || '')
    .split(',')
    .map(cleanId)
    .filter(Boolean);
  return [...new Set(configured.length ? configured : DEFAULT_GUILD_IDS)];
}

export function dynamicRoleSyncGuildIds() {
  return [...dynamicGuildIds];
}

// New group owners pair their own Discord server through the v2 WordPress
// bridge. Keep that list in memory: gateway events must make a fast local
// decision instead of making a WordPress request for every member update.
export async function refreshDynamicRoleSyncGuilds() {
  if (!roleSyncEnabled()) {
    dynamicGuildIds.clear();
    return [];
  }
  const result = await wpRequest('/wp-json/sml-discord-site/v2/bot/configured-guilds');
  const ids = Array.isArray(result?.guild_ids) ? result.guild_ids.map(cleanId).filter(Boolean) : [];
  dynamicGuildIds.clear();
  for (const id of ids) dynamicGuildIds.add(id);
  return dynamicRoleSyncGuildIds();
}

export function isRoleSyncGuild(guildId) {
  const id = cleanId(guildId);
  return roleSyncEnabled() && (roleSyncGuildIds().includes(id) || dynamicGuildIds.has(id));
}

function isLegacyRoleSyncGuild(guildId) {
  return roleSyncGuildIds().includes(cleanId(guildId));
}

function roleIdsFromMember(member) {
  const guildId = cleanId(member?.guild?.id);
  if (!guildId || !member?.roles?.cache) return [];
  return [...member.roles.cache.keys()].filter((roleId) => roleId !== guildId).map(cleanId).filter(Boolean).sort();
}

async function syncRoleIds({ guildId, discordUserId, discordTag = '', roleIds = [], reason = 'role_update' }) {
  const cleanGuildId = cleanId(guildId);
  const cleanUserId = cleanId(discordUserId);
  if (!isRoleSyncGuild(cleanGuildId)) return { skipped: true, reason: 'guild_not_configured' };
  if (!cleanUserId) return { skipped: true, reason: 'invalid_discord_user' };
  const key = `${cleanGuildId}:${cleanUserId}`;
  const previous = queues.get(key) || Promise.resolve();
  const endpoint = isLegacyRoleSyncGuild(cleanGuildId)
    ? '/wp-json/sml-discord-site/v1/bot/sync-roles'
    : '/wp-json/sml-discord-site/v2/bot/sync-roles';
  const task = previous.catch(() => {}).then(() => wpRequest(endpoint, {
    method: 'POST',
    body: JSON.stringify({
      guild_id: cleanGuildId,
      discord_user_id: cleanUserId,
      discord_tag: String(discordTag || '').slice(0, 190),
      role_ids: [...new Set(roleIds.map(cleanId).filter(Boolean))],
      reason: String(reason || 'role_update').slice(0, 64),
    }),
  }));
  const settled = task.finally(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  queues.set(key, settled);
  return task;
}

export function syncMemberRoles(member, reason = 'role_update') {
  return syncRoleIds({
    guildId: member?.guild?.id,
    discordUserId: member?.user?.id || member?.id,
    discordTag: member?.user?.tag || member?.user?.username || '',
    roleIds: roleIdsFromMember(member),
    reason,
  });
}

export function revokeMemberRoles(member, reason = 'member_left') {
  return syncRoleIds({
    guildId: member?.guild?.id,
    discordUserId: member?.user?.id || member?.id,
    discordTag: member?.user?.tag || member?.user?.username || '',
    roleIds: [],
    reason,
  });
}

export async function linkSmlAccount({ code, user, guild, member }) {
  const cleanCode = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{10}$/.test(cleanCode)) throw new Error('Use the current 10-character code from stockmarketloop.com/connect-discord/.');
  if (!isRoleSyncGuild(guild?.id)) throw new Error('Run this command in a Discord server that is connected to a StockMarketLoop group.');
  const result = await wpRequest('/wp-json/sml-discord-site/v1/bot/link', {
    method: 'POST',
    body: JSON.stringify({
      code: cleanCode,
      discord_user_id: cleanId(user?.id),
      discord_tag: String(user?.tag || user?.username || '').slice(0, 190),
    }),
  });
  // Slash-command interactions normally include a GuildMember, even when the
  // privileged Guild Members gateway intent is unavailable. If Discord gives
  // us only a partial member object, fetch just this member over REST instead
  // of silently syncing an empty role list.
  const currentMember = member?.roles?.cache ? member : await guild.members.fetch(user.id);
  const sync = await syncMemberRoles(currentMember, 'identity_linked');
  return { ...result, sync };
}

export async function claimGroupDiscordServer({ code, guild, user }) {
  const cleanCode = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{10}$/.test(cleanCode)) throw new Error('Use the current 10-character group connection code from the group owner’s Discord Access panel.');
  const result = await wpRequest('/wp-json/sml-discord-site/v2/bot/claim-group', {
    method: 'POST',
    body: JSON.stringify({
      code: cleanCode,
      guild_id: cleanId(guild?.id),
      discord_user_id: cleanId(user?.id),
    }),
  });
  await refreshDynamicRoleSyncGuilds();
  await pushGuildCatalog(guild);
  return result;
}

export async function pushGuildCatalog(guild) {
  const guildId = cleanId(guild?.id);
  if (!guildId || !isRoleSyncGuild(guildId)) return { skipped: true, reason: 'guild_not_configured' };
  const [roles, channels] = await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
  const rolePayload = [...roles.values()]
    .map((role) => ({
      id: cleanId(role.id),
      name: String(role.name || '').slice(0, 190),
      position: Number(role.position || 0),
      color: Number(role.color || 0),
      managed: Boolean(role.managed),
    }))
    .filter((role) => role.id)
    .sort((a, b) => b.position - a.position);
  const channelPayload = [...channels.values()]
    .filter((channel) => channel && !channel.isThread?.())
    .map((channel) => ({
      id: cleanId(channel.id),
      name: String(channel.name || '').slice(0, 190),
      type: Number(channel.type),
      position: Number(channel.rawPosition ?? channel.position ?? 0),
      parent_id: cleanId(channel.parentId),
      permission_overwrites: channel.permissionOverwrites?.cache
        ? [...channel.permissionOverwrites.cache.values()].map((overwrite) => ({
          id: cleanId(overwrite.id),
          type: Number(overwrite.type),
          allow: overwrite.allow.bitfield.toString(),
          deny: overwrite.deny.bitfield.toString(),
        })).filter((overwrite) => overwrite.id)
        : [],
    }))
    .filter((channel) => channel.id)
    .sort((a, b) => a.position - b.position);
  return wpRequest('/wp-json/sml-discord-site/v2/bot/guild-catalog', {
    method: 'POST',
    body: JSON.stringify({
      guild_id: guildId,
      guild_name: String(guild.name || '').slice(0, 190),
      guild_icon_url: guild.iconURL?.({ extension: 'png', size: 128 }) || '',
      roles: rolePayload,
      channels: channelPayload,
    }),
  });
}

export function memberRoleIdsChanged(previousMember, currentMember) {
  return JSON.stringify(roleIdsFromMember(previousMember)) !== JSON.stringify(roleIdsFromMember(currentMember));
}
