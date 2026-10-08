import { Routes } from 'discord.js';
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

// Owner 2026-09-22: Making Easy Money runs two Discord servers. Website access
// follows the paid roles in the ORIGINAL server only (paired with website group
// 7): Upgrade.Chat grants and removes those as billing changes. The clean
// migration server's paid roles come from fixed member lists and are never
// removed when someone cancels, so they never unlock paid website access.
// /link-sml, /refresh-sml-access and member events in the clean server sync
// that member's roles in the original server.
const COMMUNITIES = [{
  guildId: '938894329076940820', // paired with website group 7
  alsoGuildIds: ['1547568823920623658'], // clean migration server
}];

function communityFor(guildId) {
  const id = cleanId(guildId);
  return COMMUNITIES.find((community) => community.guildId === id || community.alsoGuildIds.includes(id)) || null;
}

// One member's roles, read raw over REST: no privileged gateway intent needed,
// and no dependence on the bot's role cache (empty for a server that was
// unavailable at startup). Only "not a member" reads as no roles; every other
// failure throws, so an outage never reads as "roles removed".
async function currentRoleIds(client, guildId, discordUserId) {
  let member;
  try {
    member = await client.rest.get(Routes.guildMember(guildId, discordUserId));
  } catch (error) {
    if (error?.code === 10007 || error?.code === 10013) return []; // Unknown Member / Unknown User
    throw error;
  }
  if (!Array.isArray(member?.roles)) throw new Error('Discord returned a member without a role list.');
  return member.roles.map(cleanId).filter((roleId) => roleId && roleId !== guildId);
}

function syncCommunityMember(client, community, discordUserId, discordTag = '', reason = 'role_update') {
  const cleanUserId = cleanId(discordUserId);
  if (!client?.rest || !cleanUserId) return Promise.resolve({ skipped: true, reason: 'invalid_discord_user' });
  return syncRoleIds({ guildId: community.guildId, discordUserId: cleanUserId, discordTag, readRoleIds: () => currentRoleIds(client, community.guildId, cleanUserId), reason });
}

// Syncs run one at a time per server and member. readRoleIds runs inside that
// queue, so a slow read can never be posted after a newer one; skip(roleIds)
// may decline an unchanged post.
async function syncRoleIds({ guildId, discordUserId, discordTag = '', roleIds = [], readRoleIds = null, skip = null, reason = 'role_update' }) {
  const cleanGuildId = cleanId(guildId);
  const cleanUserId = cleanId(discordUserId);
  if (!isRoleSyncGuild(cleanGuildId)) return { skipped: true, reason: 'guild_not_configured' };
  if (!cleanUserId) return { skipped: true, reason: 'invalid_discord_user' };
  const key = `${cleanGuildId}:${cleanUserId}`;
  const previous = queues.get(key) || Promise.resolve();
  const endpoint = isLegacyRoleSyncGuild(cleanGuildId)
    ? '/wp-json/sml-discord-site/v1/bot/sync-roles'
    : '/wp-json/sml-discord-site/v2/bot/sync-roles';
  const task = previous.catch(() => {}).then(async () => {
    const ids = [...new Set((readRoleIds ? await readRoleIds() : roleIds).map(cleanId).filter(Boolean))].sort();
    if (skip?.(ids)) return { skipped: true, reason: 'unchanged', roleIds: ids };
    const body = await wpRequest(endpoint, {
      method: 'POST',
      body: JSON.stringify({
        guild_id: cleanGuildId,
        discord_user_id: cleanUserId,
        discord_tag: String(discordTag || '').slice(0, 190),
        role_ids: ids,
        reason: String(reason || 'role_update').slice(0, 64),
      }),
    });
    return { ...body, roleIds: ids };
  });
  // The caller handles task's failure. This queue copy must never reject
  // unhandled: Node ends the whole bot on an unhandled rejection.
  const settled = task.catch(() => {}).finally(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  queues.set(key, settled);
  return task;
}

export function syncMemberRoles(member, reason = 'role_update') {
  const community = communityFor(member?.guild?.id);
  if (community) {
    return syncCommunityMember(member?.client || member?.guild?.client, community, member?.user?.id || member?.id, member?.user?.tag || member?.user?.username || '', reason);
  }
  return syncRoleIds({
    guildId: member?.guild?.id,
    discordUserId: member?.user?.id || member?.id,
    discordTag: member?.user?.tag || member?.user?.username || '',
    roleIds: roleIdsFromMember(member),
    reason,
  });
}

export function revokeMemberRoles(member, reason = 'member_left') {
  // In a community the paired server's current roles decide, whichever server was left.
  if (communityFor(member?.guild?.id)) return syncMemberRoles(member, reason);
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
  // The link is already saved. A failed role read or sync must not report the
  // link as failed; the scheduled check below applies the access shortly.
  try {
    const community = communityFor(guild?.id);
    if (community) {
      return { ...result, sync: await syncCommunityMember(guild.client, community, user?.id, user?.tag || user?.username || '', 'identity_linked') };
    }
    // Slash-command interactions normally include a GuildMember, even when the
    // privileged Guild Members gateway intent is unavailable. If Discord gives
    // us only a partial member object, fetch just this member over REST instead
    // of silently syncing an empty role list.
    const currentMember = member?.roles?.cache ? member : await guild.members.fetch(user.id);
    return { ...result, sync: await syncMemberRoles(currentMember, 'identity_linked') };
  } catch (error) {
    return { ...result, sync: null, syncError: String(error?.message || error).slice(0, 300) };
  }
}

// Every linked member is re-checked on a timer: role changes reach the bot as
// gateway events only while it runs with the Server Members intent, and never
// while this PC is asleep. A settled answer is not re-sent for 6 to 9 hours
// (spread, so a restart does not re-send everyone at once) unless the roles,
// the website account or the website's role mappings change; an answer that
// found a paid or manual membership is re-checked hourly.
const lastSent = new Map();
const RESEND_MS = 6 * 60 * 60 * 1000;
let linkedCheckRunning = false;

export async function syncLinkedMembersOnce(client) {
  if (!roleSyncEnabled() || linkedCheckRunning) return { skipped: true };
  linkedCheckRunning = true;
  try {
    await refreshDynamicRoleSyncGuilds().catch(() => {});
    const result = await wpRequest('/wp-json/sml-discord-site/v1/bot/linked');
    const links = Array.isArray(result?.links) ? result.links : [];
    const version = String(result?.version || '');
    const candidates = [...new Set([...COMMUNITIES.map((community) => community.guildId), ...dynamicRoleSyncGuildIds()])]
      .filter((guildId) => isRoleSyncGuild(guildId) && (!communityFor(guildId) || communityFor(guildId).guildId === guildId));
    // A server the bot cannot read is skipped for this run with one warning,
    // instead of one failing Discord request per linked member.
    const targets = [];
    for (const guildId of candidates) {
      try {
        await client.rest.get(Routes.guild(guildId));
        targets.push(guildId);
      } catch (error) {
        console.warn(`Linked member access check skipped Discord server ${guildId}: ${error.message || error}`);
      }
    }
    const seen = new Set();
    let changed = 0;
    let failed = 0;
    for (const link of links) {
      const discordUserId = cleanId(link?.discord_user_id);
      if (!discordUserId) continue;
      const granted = new Set((Array.isArray(link?.granted_guilds) ? link.granted_guilds : []).map(cleanId));
      const prefix = `${Math.max(0, Math.trunc(Number(link?.user_id) || 0))}|${version}|`; // website user id, not a Discord id
      for (const guildId of targets) {
        const key = `${guildId}:${discordUserId}`;
        seen.add(key);
        const skip = (roleIds) => {
          const previous = lastSent.get(key);
          // Holds no role there, the website lists no grant and nothing held was sent before: nothing to change.
          if (!roleIds.length && !granted.has(guildId) && !(previous && !previous.signature.endsWith('|'))) return true;
          return Boolean(previous && previous.signature === prefix + roleIds.join(',') && Date.now() < previous.until);
        };
        try {
          const synced = await syncRoleIds({ guildId, discordUserId, discordTag: String(link?.discord_tag || ''), readRoleIds: () => currentRoleIds(client, guildId, discordUserId), skip, reason: 'scheduled_check' });
          if (!synced?.skipped) {
            const guarded = (synced?.results || []).some((row) => String(row?.action || '').startsWith('protected_'));
            if (synced?.linked === true) lastSent.set(key, { signature: prefix + (synced.roleIds || []).join(','), until: Date.now() + (guarded ? 60 * 60 * 1000 : RESEND_MS * (1 + Math.random() / 2)) });
            else lastSent.delete(key);
          }
          if (synced?.changed) changed += 1;
        } catch (error) {
          failed += 1;
          lastSent.delete(key);
          console.warn(`Linked member access check failed safely for ${discordUserId} in ${guildId}: ${error.message || error}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    for (const key of lastSent.keys()) if (!seen.has(key)) lastSent.delete(key);
    return { links: links.length, changed, failed };
  } finally {
    linkedCheckRunning = false;
  }
}

export function startLinkedMemberSync(client, intervalSeconds = 600) {
  const run = async () => {
    const result = await syncLinkedMembersOnce(client).catch((error) => ({ error }));
    if (result?.error) console.error('Linked member access check failed safely:', result.error.message || result.error);
    else if (result?.changed || result?.failed) console.log(`Linked member access check: ${result.links} linked, ${result.changed} changed, ${result.failed} failed.`);
  };
  setTimeout(run, 60_000);
  return setInterval(run, Math.max(120, Number(intervalSeconds) || 600) * 1000);
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
