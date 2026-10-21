#!/usr/bin/env node
'use strict';

/* Diagnose and, only with --apply, grant one member Video / Go Live in one channel. */
const setup = require('./academy-discord-setup');
const { createClient, createRedactor, memberPermissions, sameOverwrites, PERMISSIONS: BASE_PERMISSIONS, ApiError } = setup;
const SNOWFLAKE = /^[0-9]{15,24}$/;
const PERMISSIONS = Object.freeze({ ...BASE_PERMISSIONS, STREAM: 1n << 9n });
const REQUIRED_ALLOW = PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.CONNECT | PERMISSIONS.SPEAK | PERMISSIONS.STREAM;
const ALL_PERMISSIONS = (1n << 64n) - 1n;
const EXIT = Object.freeze({ OK: 0, CONFIG: 1, AUTH: 2, FATAL: 3, TEXT_CHANNEL: 4, BOT_PERMISSION: 5 });

function bits(value) { try { return BigInt(String(value == null || value === '' ? '0' : value)); } catch (_) { return 0n; } }
function parseArgs(argv = []) {
  const positional = []; const flags = { apply: false, json: false, help: false };
  for (const arg of argv) {
    if (arg === '--apply') flags.apply = true; else if (arg === '--dry-run') flags.apply = false;
    else if (arg === '--json') flags.json = true; else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`); else positional.push(arg);
  }
  if (!flags.help && positional.length !== 2) throw new Error('CHANNEL_ID and USER_ID are required');
  if (!flags.help && positional.some((value) => !SNOWFLAKE.test(String(value)))) throw new Error('CHANNEL_ID and USER_ID must be Discord snowflakes');
  return { ...flags, channelId: positional[0] || null, userId: positional[1] || null };
}
function channelKind(type) {
  if (Number(type) === 2) return { label: 'voice', canStream: true, needsSpeaker: false };
  if (Number(type) === 13) return { label: 'stage', canStream: true, needsSpeaker: true };
  if (Number(type) === 0) return { label: 'text', canStream: false, needsSpeaker: false };
  return { label: `type ${String(type)}`, canStream: false, needsSpeaker: false };
}
function canonicalOverwrites(overwrites) { return (Array.isArray(overwrites) ? overwrites : []).map((entry) => ({ id: String(entry.id), type: Number(entry.type), allow: bits(entry.allow), deny: bits(entry.deny) })); }
function labelOverwrite(entry, { guildId, roleById, source }) {
  if (Number(entry.type) === 1) return `${source} member ${String(entry.id)}`;
  if (String(entry.id) === String(guildId)) return `${source} @everyone`;
  const role = roleById.get(String(entry.id)); return `${source} role ${role ? `"${role.name}"` : String(entry.id)} (${String(entry.id)})`;
}
/* Discord order: @everyone, combined roles, then a member-specific overwrite. */
function effectivePermissions({ guildId, userId, roles, memberRoleIds, ownerId, overwrites, source = 'channel' }) {
  const baseResult = memberPermissions({ guildId, roles, memberRoleIds, ownerId, botId: userId });
  const roleById = new Map((roles || []).map((role) => [String(role.id), role]));
  if (baseResult.administrator) return { permissions: ALL_PERMISSIONS, administrator: true, denySources: [], allowSources: [] };
  let permissions = baseResult.bitfield; const list = canonicalOverwrites(overwrites); const roleIds = new Set((memberRoleIds || []).map(String)); const denySources = []; const allowSources = [];
  const record = (entry) => { const overwrite = labelOverwrite(entry, { guildId, roleById, source }); for (const permission of ['STREAM', 'CONNECT']) { if ((entry.deny & PERMISSIONS[permission]) !== 0n) denySources.push({ permission, overwrite }); if ((entry.allow & PERMISSIONS[permission]) !== 0n) allowSources.push({ permission, overwrite }); } };
  const everyone = list.find((entry) => entry.type === 0 && entry.id === String(guildId));
  if (everyone) { permissions &= ~everyone.deny; permissions |= everyone.allow; record(everyone); }
  let roleAllow = 0n; let roleDeny = 0n;
  for (const entry of list) if (entry.type === 0 && roleIds.has(entry.id)) { roleAllow |= entry.allow; roleDeny |= entry.deny; record(entry); }
  permissions &= ~roleDeny; permissions |= roleAllow;
  const member = list.find((entry) => entry.type === 1 && entry.id === String(userId));
  if (member) { permissions &= ~member.deny; permissions |= member.allow; record(member); }
  return { permissions, administrator: false, denySources, allowSources };
}
function missingNames(bitfield) { return ['VIEW_CHANNEL', 'CONNECT', 'SPEAK', 'STREAM'].filter((name) => (bitfield & PERMISSIONS[name]) === 0n); }
function desiredMemberOverwrite(existing) { return { type: 1, allow: (bits(existing && existing.allow) | REQUIRED_ALLOW).toString(), deny: (bits(existing && existing.deny) & ~REQUIRED_ALLOW).toString() }; }
function syncedWithCategory(channel, parent) { return !!parent && sameOverwrites(channel.permission_overwrites, parent.permission_overwrites); }
function usage() { return 'Usage: DISCORD_BOT_TOKEN=... node scripts/discord-fix-channel-video.js CHANNEL_ID USER_ID [--apply] [--json]\n\nDefault: dry run only. --apply writes one member overwrite on the named channel.'; }

async function run({ env = process.env, argv = process.argv.slice(2), fetchImpl = globalThis.fetch, sleep, stdout, stderr } = {}) {
  const out = typeof stdout === 'function' ? stdout : (text) => process.stdout.write(text); const err = typeof stderr === 'function' ? stderr : (text) => process.stderr.write(text);
  let flags; const token = String(env.DISCORD_BOT_TOKEN || '').trim();
  try { flags = parseArgs(argv); if (flags.help) { out(`${usage()}\n`); return { code: EXIT.OK, summary: null }; } if (!token) throw new Error('DISCORD_BOT_TOKEN is required (set: no)'); } catch (error) { err(`${error.message}\n${usage()}\n`); return { code: EXIT.CONFIG, summary: null }; }
  const redact = createRedactor(token); const log = (line) => (flags.json ? err : out)(`${redact(line)}\n`); const wait = typeof sleep === 'function' ? sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const client = createClient({ token, fetchImpl, sleep: wait }); const request = async (method, path, options) => (await client.request(method, path, options)).json;
  const summary = { ok: true, dryRun: !flags.apply, tokenSet: true, channel: null, category: null, user: { id: flags.userId }, bot: null, diagnosis: null, change: null };
  try {
    const channel = await request('GET', `/channels/${flags.channelId}`); const kind = channelKind(channel.type); const guildId = String(channel.guild_id || '');
    if (!SNOWFLAKE.test(guildId)) throw new Error('The channel response did not include a guild_id; this tool only supports guild channels.');
    const parent = channel.parent_id ? await request('GET', `/channels/${channel.parent_id}`) : null;
    const [guild, roles, member, me] = await Promise.all([request('GET', `/guilds/${guildId}`), request('GET', `/guilds/${guildId}/roles`), request('GET', `/guilds/${guildId}/members/${flags.userId}`), request('GET', '/users/@me')]);
    const botMember = await request('GET', `/guilds/${guildId}/members/${String(me.id)}`);
    const userEffective = effectivePermissions({ guildId, userId: flags.userId, roles, memberRoleIds: Array.isArray(member.roles) ? member.roles.map(String) : [], ownerId: guild.owner_id, overwrites: channel.permission_overwrites });
    const botEffective = effectivePermissions({ guildId, userId: String(me.id), roles, memberRoleIds: Array.isArray(botMember.roles) ? botMember.roles.map(String) : [], ownerId: guild.owner_id, overwrites: channel.permission_overwrites });
    const sync = syncedWithCategory(channel, parent); const existingMember = (Array.isArray(channel.permission_overwrites) ? channel.permission_overwrites : []).find((entry) => Number(entry.type) === 1 && String(entry.id) === String(flags.userId)) || null;
    summary.channel = { id: String(channel.id), name: String(channel.name || ''), type: Number(channel.type), kind: kind.label, parentId: channel.parent_id ? String(channel.parent_id) : null, synchronizedWithCategory: sync };
    summary.category = parent ? { id: String(parent.id), name: String(parent.name || ''), synchronized: sync } : null;
    summary.bot = { id: String(me.id), canManageChannels: botEffective.administrator || (botEffective.permissions & PERMISSIONS.MANAGE_CHANNELS) !== 0n, canManageRoles: botEffective.administrator || (botEffective.permissions & PERMISSIONS.MANAGE_ROLES) !== 0n };
    summary.diagnosis = { effectivePermissions: userEffective.permissions.toString(), missing: missingNames(userEffective.permissions), streamAllowed: (userEffective.permissions & PERMISSIONS.STREAM) !== 0n, connectAllowed: (userEffective.permissions & PERMISSIONS.CONNECT) !== 0n, denySources: userEffective.denySources, allowSources: userEffective.allowSources, stageSpeakerRequired: kind.needsSpeaker };
    log('DISCORD_TOKEN: set'); log(`Channel: ${summary.channel.name || summary.channel.id} (${kind.label}, type ${channel.type})`); log(`Category: ${parent ? `${parent.name || parent.id} (${parent.id}); overwrites ${sync ? 'synced' : 'not synced'}` : 'none'}`);
    if (!kind.canStream) { summary.ok = false; summary.diagnosis.reason = 'Screen share is not possible in a text channel.'; log('STOP: Screen share / Go Live is not possible in a text channel. Use a voice or Stage channel.'); return { code: EXIT.TEXT_CHANNEL, summary }; }
    if (kind.needsSpeaker) log('Stage channel: you must also be a Stage speaker before you can share video.');
    log(`Your effective permissions: STREAM=${summary.diagnosis.streamAllowed ? 'allow' : 'missing'} CONNECT=${summary.diagnosis.connectAllowed ? 'allow' : 'missing'} SPEAK=${(userEffective.permissions & PERMISSIONS.SPEAK) !== 0n ? 'allow' : 'missing'}`);
    for (const denial of userEffective.denySources) log(`Deny source: ${denial.permission} denied by ${denial.overwrite}`); if (!userEffective.denySources.length) log('Deny source: none for STREAM or CONNECT.');
    const desired = desiredMemberOverwrite(existingMember); summary.change = { target: `member ${flags.userId} on channel ${channel.id}`, existing: existingMember ? { allow: String(existingMember.allow), deny: String(existingMember.deny) } : null, desired };
    if (!summary.bot.canManageChannels || !summary.bot.canManageRoles) { summary.ok = false; summary.diagnosis.reason = 'The bot cannot manage this channel overwrite.'; log(`BLOCKED: Bot needs MANAGE_CHANNELS and MANAGE_ROLES in this channel (MANAGE_CHANNELS=${summary.bot.canManageChannels ? 'yes' : 'no'}, MANAGE_ROLES=${summary.bot.canManageRoles ? 'yes' : 'no'}).`); log('Manual fix: Edit Channel -> Permissions -> add your member -> enable Video, Connect, Speak, and View Channel.'); return { code: EXIT.BOT_PERMISSION, summary }; }
    if (!flags.apply) { log(`DRY RUN: would PUT a member-only overwrite for ${flags.userId}; allow ${desired.allow}, deny ${desired.deny}.`); return { code: EXIT.OK, summary }; }
    await request('PUT', `/channels/${channel.id}/permissions/${flags.userId}`, { body: { allow: desired.allow, deny: desired.deny, type: 1 }, reason: 'Allow member to use video in this channel' });
    log(`APPLIED: member-only overwrite updated for ${flags.userId}. No role, category, @everyone, or other channel was changed.`); return { code: EXIT.OK, summary };
  } catch (error) { const kind = error instanceof ApiError ? error.kind : 'unexpected'; summary.ok = false; summary.error = { kind, message: redact(error.message || String(error)) }; log(`FATAL: ${summary.error.message}`); return { code: kind === 'unauthorized' || kind === 'forbidden' ? EXIT.AUTH : EXIT.FATAL, summary }; } finally { if (flags && flags.json) out(`${JSON.stringify(summary, null, 2)}\n`); }
}
if (require.main === module) run().then((result) => { process.exitCode = result.code; }).catch((error) => { process.stderr.write(`${error && error.message ? error.message : String(error)}\n`); process.exitCode = EXIT.FATAL; });
module.exports = { run, parseArgs, channelKind, effectivePermissions, desiredMemberOverwrite, syncedWithCategory, PERMISSIONS, REQUIRED_ALLOW, EXIT };
