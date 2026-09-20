import { PermissionFlagsBits } from 'discord.js';
import { access } from 'node:fs/promises';
import { mutateJson, paths, readJson } from './storage.js';

const UNKNOWN_MEMBER = 10007;
const inviteCache = new Map();
const recentGuildJoins = new Map();
const AUTOMOD_QUARANTINED_USERNAME = 1 << 7;
const AUTOMOD_QUARANTINED_GUILD_TAG = 1 << 10;
const DISCORD_SAFETY_SIGNAL_PATTERNS = [
  { key: 'unusual_dm_activity', pattern: /\bunusual\s+dm\s+activity\b/i },
  { key: 'timed_out', pattern: /\btimed\s+out\b|\btime(?:d)?\s*out\b/i },
  { key: 'unusual_account_activity', pattern: /\bunusual\s+account\s+activity\b/i },
  { key: 'quarantined', pattern: /\bquarantined\b|\bautomod\s+quarantined\b/i },
];

export function configuredBlockedUserIds(settings) {
  const policy = settings.memberSecurity || {};
  return (policy.blockedUserIds || [])
    .map((entry) => typeof entry === 'string'
      ? { id: entry.trim(), label: '' }
      : { id: String(entry?.id || '').trim(), label: String(entry?.label || '').trim() })
    .filter((entry, index, entries) => /^\d{17,20}$/.test(entry.id) && entries.findIndex((item) => item.id === entry.id) === index);
}

function configuredBlockedGuilds(settings) {
  return (settings.memberSecurity?.blockedGuilds || [])
    .map((entry) => ({ id: String(entry?.id || '').trim(), label: String(entry?.label || '').trim() }))
    .filter((entry) => /^\d{17,20}$/.test(entry.id));
}

async function audit(event) {
  await mutateJson(paths.memberSecurityAudit, [], (events) => {
    events.push({ at: new Date().toISOString(), ...event });
    if (events.length > 5000) events.splice(0, events.length - 5000);
  });
}

function autoBanSignalsEnabled(settings) {
  return settings.memberSecurity?.discordSafetyAutoBan?.enabled === true;
}

function protectedGuildId(settings) {
  return String(settings.memberSecurity?.protectedGuildId || '');
}

function memberFlagsValue(member) {
  const raw = member?.flags;
  if (typeof raw === 'number') return raw;
  if (typeof raw?.bitfield === 'number') return raw.bitfield;
  if (typeof raw?.valueOf === 'function') {
    const value = raw.valueOf();
    if (typeof value === 'number') return value;
  }
  return 0;
}

function activeTimeoutSignal(member) {
  const until = member?.communicationDisabledUntilTimestamp
    || (member?.communicationDisabledUntil ? new Date(member.communicationDisabledUntil).getTime() : 0);
  return Number(until || 0) > Date.now();
}

export function discordSafetySignalsFromMember(member) {
  const signals = [];
  if (activeTimeoutSignal(member)) signals.push('timed_out');
  const flags = memberFlagsValue(member);
  if ((flags & AUTOMOD_QUARANTINED_USERNAME) !== 0) signals.push('automod_quarantined_username');
  if ((flags & AUTOMOD_QUARANTINED_GUILD_TAG) !== 0) signals.push('automod_quarantined_guild_tag');
  return [...new Set(signals)];
}

function safetySignalsFromText(text) {
  const source = String(text || '');
  return DISCORD_SAFETY_SIGNAL_PATTERNS
    .filter(({ pattern }) => pattern.test(source))
    .map(({ key }) => key);
}

async function banSafetySignalUser(guild, userId, signals, source) {
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionFlagsBits.BanMembers)) {
    const reason = 'Discord safety signal matched, but the bot lacks Ban Members permission.';
    await audit({ type: 'discord_safety_auto_ban_failed', guildId: guild.id, userId, signals, source, reason });
    return { actionTaken: false, reason };
  }
  try {
    await guild.members.ban(userId, {
      deleteMessageSeconds: 0,
      reason: `StockMarketLoop Connect auto-ban: Discord safety signal (${signals.join(', ')})`.slice(0, 500),
    });
    await audit({ type: 'discord_safety_auto_banned', guildId: guild.id, userId, signals, source, action: 'ban' });
    return { actionTaken: true, action: 'ban', signals };
  } catch (error) {
    const reason = String(error?.message || error).slice(0, 500);
    await audit({ type: 'discord_safety_auto_ban_failed', guildId: guild.id, userId, signals, source, reason });
    return { actionTaken: false, reason };
  }
}

export async function enforceDiscordSafetyMemberBan(member, settings, source = 'member_update') {
  if (!autoBanSignalsEnabled(settings)) return { skipped: true, reason: 'disabled' };
  if (member.guild.id !== protectedGuildId(settings)) return { skipped: true, reason: 'outside protected guild' };
  if (member.user?.bot) return { skipped: true, reason: 'bot' };
  if ((settings.memberSecurity?.exemptUserIds || []).map(String).includes(member.id)) return { skipped: true, reason: 'exempt user' };
  if ((settings.memberSecurity?.exemptRoleIds || []).some((roleId) => member.roles?.cache?.has(String(roleId)))) return { skipped: true, reason: 'exempt role' };

  const signals = discordSafetySignalsFromMember(member);
  if (!signals.length) return { skipped: true, reason: 'no signal' };
  return banSafetySignalUser(member.guild, member.id, signals, source);
}

export async function enforceDiscordSafetyMessageBan(message, settings) {
  if (!autoBanSignalsEnabled(settings)) return false;
  if (!message.guild || message.guild.id !== protectedGuildId(settings)) return false;
  const text = [
    message.content,
    ...(message.embeds || []).flatMap((embed) => [
      embed.title,
      embed.description,
      ...(embed.fields || []).flatMap((field) => [field.name, field.value]),
      embed.footer?.text,
      embed.author?.name,
    ]),
  ].filter(Boolean).join('\n');
  const signals = [...new Set(safetySignalsFromText(text))];
  if (!signals.length) return false;

  const ids = new Set();
  for (const user of message.mentions?.users?.values?.() || []) ids.add(user.id);
  for (const match of text.matchAll(/<@!?(\d{17,20})>/g)) ids.add(match[1]);
  const protectedIds = new Set([
    message.client.user?.id,
    message.guild.ownerId,
    ...(settings.memberSecurity?.exemptUserIds || []).map(String),
  ].filter(Boolean));
  const candidateIds = [...ids].filter((id) => !protectedIds.has(id));
  if (!candidateIds.length) {
    await audit({ type: 'discord_safety_signal_detected_without_user', guildId: message.guild.id, messageId: message.id, channelId: message.channelId, signals });
    return false;
  }
  for (const userId of candidateIds) await banSafetySignalUser(message.guild, userId, signals, 'safety_alert_message');
  return true;
}

async function recordJoinRisk(member, settings) {
  const policy = settings.memberSecurity || {};
  if (member.guild.id !== String(policy.protectedGuildId || '') || member.user.bot) return;

  const now = Date.now();
  const accountAgeDays = Math.max(0, (now - Number(member.user.createdTimestamp || now)) / 86400000);
  const reviewDays = Math.max(0, Number(policy.newAccountReviewDays || 0));
  if (reviewDays && accountAgeDays < reviewDays) {
    await audit({
      type: 'new_account_review',
      userId: member.id,
      accountAgeDays: Number(accountAgeDays.toFixed(2)),
      action: 'audit_only',
    });
  }

  const burst = policy.joinBurst || {};
  if (!burst.enabled) return;
  const windowMs = Math.max(5, Number(burst.windowSeconds || 30)) * 1000;
  const threshold = Math.max(2, Number(burst.threshold || 5));
  const recent = (recentGuildJoins.get(member.guild.id) || []).filter((timestamp) => now - timestamp <= windowMs);
  recent.push(now);
  recentGuildJoins.set(member.guild.id, recent);
  if (recent.length >= threshold) {
    await audit({
      type: 'join_burst_detected',
      guildId: member.guild.id,
      joins: recent.length,
      windowSeconds: Math.round(windowMs / 1000),
      action: 'audit_only',
    });
  }
}

async function blockExactMember(member, settings) {
  const policy = settings.memberSecurity || {};
  if (!policy.exactUserBlockEnabled || member.guild.id !== String(policy.protectedGuildId || '')) return null;
  const matched = configuredBlockedUserIds(settings).find((entry) => entry.id === member.id);
  if (!matched) return null;

  const reason = `Owner-reported safety block${matched.label ? `: ${matched.label}` : ''}`.slice(0, 500);
  const me = member.guild.members.me;
  if (me?.permissions.has(PermissionFlagsBits.BanMembers) && member.bannable) {
    await member.ban({ deleteMessageSeconds: 0, reason });
    await audit({ type: 'exact_user_blocked', userId: member.id, action: 'ban', label: matched.label });
    return { blocked: true, actionTaken: true, action: 'ban', exactUserId: true };
  }
  if (me?.permissions.has(PermissionFlagsBits.KickMembers) && member.kickable) {
    await member.kick(reason);
    await audit({ type: 'exact_user_blocked', userId: member.id, action: 'kick_fallback', label: matched.label });
    return { blocked: true, actionTaken: true, action: 'kick', exactUserId: true };
  }

  const failure = 'Exact user ID matched, but the bot lacks permission or role position to ban or kick this member.';
  await audit({ type: 'exact_user_block_failed', userId: member.id, reason: failure, label: matched.label });
  return { blocked: true, actionTaken: false, reason: failure, exactUserId: true };
}

export async function enforceConfiguredUserBlocks(client, settings) {
  const policy = settings.memberSecurity || {};
  if (!policy.exactUserBlockEnabled) return { skipped: true, reason: 'disabled' };
  const protectedGuildId = String(policy.protectedGuildId || '');
  if (!/^\d{17,20}$/.test(protectedGuildId)) return { skipped: true, reason: 'protectedGuildId is missing or invalid' };
  const blockedUsers = configuredBlockedUserIds(settings);
  if (!blockedUsers.length) return { skipped: true, reason: 'no valid blocked user IDs' };

  const guild = await client.guilds.fetch(protectedGuildId).catch(() => null);
  if (!guild) return { skipped: true, reason: 'protected server is unavailable to the bot' };
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionFlagsBits.BanMembers)) {
    await audit({ type: 'startup_exact_block_failed', guildId: guild.id, reason: 'bot lacks Ban Members permission' });
    return { blocked: 0, failed: blockedUsers.length, reason: 'bot lacks Ban Members permission' };
  }

  let blocked = 0;
  let failed = 0;
  for (const entry of blockedUsers) {
    try {
      await guild.members.ban(entry.id, {
        deleteMessageSeconds: 0,
        reason: `Owner-reported safety block${entry.label ? `: ${entry.label}` : ''}`.slice(0, 500),
      });
      blocked += 1;
      await audit({ type: 'startup_exact_user_blocked', userId: entry.id, guildId: guild.id, action: 'ban', label: entry.label });
    } catch (error) {
      failed += 1;
      await audit({ type: 'startup_exact_block_failed', userId: entry.id, guildId: guild.id, reason: String(error?.message || error).slice(0, 500) });
    }
  }
  return { blocked, failed };
}

export async function sendNewMemberWarning(user, guild, settings) {
  const policy = settings.memberSecurity || {};
  const warning = policy.newMemberWarning || {};
  if (!warning.enabled || guild.id !== String(policy.protectedGuildId || '') || user.bot) return { skipped: true };

  const reserved = await mutateJson(paths.memberWarningLog, {}, (log) => {
    if (log[user.id]) return false;
    log[user.id] = { firstSeenAt: new Date().toISOString(), guildId: guild.id, status: 'pending' };
    return true;
  });
  if (!reserved) return { skipped: true, duplicate: true };

  const payload = { content: String(warning.message || '').slice(0, 1900) };
  if (warning.imagePath) {
    const imageAvailable = await access(warning.imagePath).then(() => true).catch(() => false);
    if (imageAvailable) payload.files = [warning.imagePath];
  }

  const sent = await user.send(payload).then(() => true).catch(() => false);
  await mutateJson(paths.memberWarningLog, {}, (log) => {
    if (log[user.id]) log[user.id].status = sent ? 'delivered' : 'dm_closed_or_failed';
  });
  await audit({ type: sent ? 'new_member_warning_delivered' : 'new_member_warning_failed', userId: user.id });
  return { delivered: sent };
}

export async function ensureMemberSecurityGrandfatherSnapshot(client, settings) {
  const policy = settings.memberSecurity || {};
  const protectedGuildId = String(policy.protectedGuildId || '');
  const existing = await readJson(paths.memberSecurityGrandfathered, {});
  if (Array.isArray(existing.userIds)) {
    if (existing.protectedGuildId !== protectedGuildId) {
      throw new Error('Grandfather snapshot belongs to a different protected server; refusing to replace it automatically.');
    }
    return { created: false, count: existing.userIds?.length || 0, capturedAt: existing.capturedAt };
  }

  const guild = await client.guilds.fetch(protectedGuildId);
  const members = await guild.members.fetch();
  const snapshot = {
    protectedGuildId,
    capturedAt: new Date().toISOString(),
    userIds: [...members.keys()].sort(),
  };
  await mutateJson(paths.memberSecurityGrandfathered, {}, (value) => {
    if (Array.isArray(value.userIds)) throw new Error('Grandfather snapshot was created concurrently; refusing to overwrite it.');
    Object.assign(value, snapshot);
  });
  await audit({ type: 'grandfather_snapshot_created', protectedGuildId, memberCount: snapshot.userIds.length });
  return { created: true, count: snapshot.userIds.length, capturedAt: snapshot.capturedAt };
}

async function isGrandfathered(protectedGuildId, userId) {
  const snapshot = await readJson(paths.memberSecurityGrandfathered, {});
  return snapshot?.protectedGuildId === protectedGuildId && (snapshot.userIds || []).includes(String(userId));
}

function inviteCodes(content) {
  const codes = new Set();
  const pattern = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]+)/gi;
  for (const match of String(content || '').matchAll(pattern)) codes.add(match[1]);
  return [...codes];
}

async function resolveInviteGuildId(client, code) {
  const cached = inviteCache.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached.guildId;
  const invite = await client.fetchInvite(code);
  const guildId = String(invite.guild?.id || '');
  inviteCache.set(code, { guildId, expiresAt: Date.now() + 10 * 60 * 1000 });
  return guildId;
}

export async function moderateBlockedInviteMessage(message, settings) {
  const policy = settings.memberSecurity || {};
  if (!policy.blockInviteLinks || message.guildId !== String(policy.protectedGuildId || '')) return false;
  const codes = inviteCodes(message.content);
  if (!codes.length) return false;
  const blockedGuilds = configuredBlockedGuilds(settings);
  if (!blockedGuilds.length) return false;

  for (const code of codes) {
    let destinationGuildId;
    try {
      destinationGuildId = await resolveInviteGuildId(message.client, code);
    } catch {
      continue;
    }
    const matched = blockedGuilds.find((guild) => guild.id === destinationGuildId);
    if (!matched) continue;

    const deleted = await message.delete().then(() => true).catch(() => false);
    await audit({
      type: deleted ? 'blocked_invite_removed' : 'blocked_invite_delete_failed',
      userId: message.author.id,
      messageId: message.id,
      channelId: message.channelId,
      matchedGuildId: matched.id,
    });
    if (deleted) {
      await message.author.send(`Your message in **${message.guild.name}** was removed because it contained an invite to a blocked Discord server. Replacing or regenerating the invite code does not bypass this rule.`).catch(() => {});
    }
    return true;
  }
  return false;
}

export async function memberSecurityReadiness(client, settings) {
  const policy = settings.memberSecurity || {};
  if (!policy.enabled) return { ready: false, reason: 'disabled' };
  if (process.env.SECURITY_GATE_MEMBERS_INTENT !== '1') {
    return { ready: false, reason: 'SECURITY_GATE_MEMBERS_INTENT is not enabled' };
  }
  if (!/^\d{17,20}$/.test(String(policy.protectedGuildId || ''))) {
    return { ready: false, reason: 'protectedGuildId is missing or invalid' };
  }
  const blockedGuilds = configuredBlockedGuilds(settings);
  if (blockedGuilds.length !== 2) {
    return { ready: false, reason: 'both exact blocked-server IDs are required' };
  }
  const protectedGuild = await client.guilds.fetch(policy.protectedGuildId).catch(() => null);
  if (!protectedGuild) return { ready: false, reason: 'protected server is unavailable to the bot' };
  for (const blocked of blockedGuilds) {
    const guild = await client.guilds.fetch(blocked.id).catch(() => null);
    if (!guild) return { ready: false, reason: `${blocked.label || blocked.id} is unavailable to the bot` };
  }
  return { ready: true, blockedGuilds };
}

async function findConfirmedBlockedMembership(client, userId, blockedGuilds) {
  for (const blocked of blockedGuilds) {
    const guild = await client.guilds.fetch(blocked.id);
    try {
      const member = await guild.members.fetch(userId);
      if (member) return blocked;
    } catch (error) {
      const code = Number(error?.code || error?.rawError?.code || 0);
      if (code === UNKNOWN_MEMBER) continue;
      throw new Error(`Could not verify ${blocked.label || blocked.id}: ${error?.message || error}`);
    }
  }
  return null;
}

export async function enforceMemberSecurity(member, settings) {
  const policy = settings.memberSecurity || {};
  if (member.guild.id !== String(policy.protectedGuildId || '')) return { skipped: true };
  if (member.user.bot) return { skipped: true };
  await recordJoinRisk(member, settings);

  // Explicit stable-ID blocks are independent from the broader cross-server
  // membership policy. They are checked before grandfather/exemption rules so
  // a known blocked account cannot regain access by leaving and rejoining.
  const exact = await blockExactMember(member, settings);
  if (exact) return exact;

  if (!policy.enabled) return { skipped: true, reason: 'membership gate disabled' };
  if (await isGrandfathered(member.guild.id, member.id)) {
    await audit({ type: 'grandfathered_allowed', userId: member.id });
    return { allowed: true, grandfathered: true };
  }
  if ((policy.exemptUserIds || []).map(String).includes(member.id)) return { skipped: true };
  if ((policy.exemptRoleIds || []).some((roleId) => member.roles.cache.has(String(roleId)))) return { skipped: true };

  const readiness = await memberSecurityReadiness(member.client, settings);
  if (!readiness.ready) {
    await audit({ type: 'verification_unavailable', userId: member.id, reason: readiness.reason });
    return { skipped: true, reason: readiness.reason };
  }

  let matched;
  try {
    matched = await findConfirmedBlockedMembership(member.client, member.id, readiness.blockedGuilds);
  } catch (error) {
    await audit({ type: 'verification_error', userId: member.id, reason: String(error.message || error).slice(0, 500) });
    return { skipped: true, reason: error.message };
  }
  if (!matched) {
    await audit({ type: 'allowed', userId: member.id });
    return { allowed: true };
  }

  const me = member.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.KickMembers) || !member.kickable) {
    const reason = 'Confirmed match, but the bot cannot kick this member.';
    await audit({ type: 'action_failed', userId: member.id, matchedGuildId: matched.id, reason });
    return { blocked: true, actionTaken: false, reason };
  }

  const reason = `Membership policy: confirmed member of ${matched.label || matched.id}`;
  await member.kick(reason);
  await audit({ type: 'removed', userId: member.id, matchedGuildId: matched.id, action: 'kick' });
  return { blocked: true, actionTaken: true, matchedGuildId: matched.id };
}
