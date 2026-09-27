#!/usr/bin/env node
'use strict';

/* =============================================================================
 * Making Easy Money Academy — Discord launch setup, driven by the Academy bot.
 *
 * What it does (DRY RUN by default, `--apply` writes, `--json` prints a summary):
 *   1. Reads the bot user, the guild, its roles, the bot's member record and the
 *      channel list. Reports the bot's top role, its decoded permissions, and
 *      whether Monarch / Elite / Premium sit BELOW the bot (grants possible).
 *   2. Finds or creates the plain "Academy Student" role (permissions "0", not
 *      hoisted, not mentionable, no colour). A new role lands at the bottom.
 *   3. Mirrors the template role's (Premium) channel overwrites onto Academy
 *      Student, one PUT per channel overwrite, skipping identical ones, and makes
 *      sure the Academy category grants the student the Activity/voice bits.
 *      It never touches another role's or member's overwrite, never deletes,
 *      never edits @everyone, and never PATCHes a channel's whole ACL.
 *   4. Reuses or creates ONE permanent invite on the hub channel (--apply only).
 *   5. Prints a summary with warnings. Exit 0 even with warnings; non-zero when
 *      the config is unusable or the bot token / guild reads fail.
 *
 * A second `--apply` run makes zero writes.
 *
 * Safety notes:
 *   * A child of the Academy category with its own (unsynced) overwrites that
 *     hides itself from @everyone and gives the student nothing today is treated
 *     as PRIVATE (for example #academy-admin) and is listed for review, never
 *     opened. Everything the student can already see is upgraded in place.
 *   * A child that was synced with its category before a category write keeps
 *     following the category: if Discord did not propagate the write, the
 *     category's values are written to it explicitly (it is never "private").
 *   * The dry run predicts channel-level rejections from the documented rules
 *     (the bot needs VIEW_CHANNEL and MANAGE_ROLES in the channel, and may only
 *     allow/deny bits it holds there unless it has a MANAGE_ROLES overwrite).
 *   * Rate limits: 429 honours retry_after, bucket exhaustion honours
 *     x-ratelimit-reset-after, and writes are spaced by SML_ACADEMY_WRITE_DELAY_MS.
 *   * The bot token is never printed; every output line goes through a redactor.
 *
 * Environment:
 *   SML_ACADEMY_BOT_TOKEN           required
 *   SML_ACADEMY_GUILD_ID            default 938894329076940820
 *   SML_ACADEMY_BILLING_ACADEMY_ROLE_ID
 *                                   optional: the engine's student role id; when
 *                                   set and present it IS the student role (even
 *                                   if renamed), so no second role is created
 *   SML_ACADEMY_STUDENT_ROLE_NAME   default "Academy Student"
 *   SML_ACADEMY_TEMPLATE_ROLE_ID    default Premium 939031140679970867
 *   SML_ACADEMY_CATEGORY_ID         default 1551448153276944405
 *   SML_ACADEMY_INVITE_CHANNEL_ID   default 1551459038405992488 (#academy-lessons-live-chart)
 *   SML_ACADEMY_MONARCH_ROLE_ID / SML_ACADEMY_ELITE_ROLE_ID / SML_ACADEMY_PREMIUM_ROLE_ID
 *                                   optional tier overrides for the hierarchy report
 *   SML_ACADEMY_WRITE_DELAY_MS      default 350
 * ========================================================================== */

const API = 'https://discord.com/api/v10';
const SNOWFLAKE = /^[0-9]{15,24}$/;
const CHANNEL_CATEGORY = 4;

const DEFAULTS = Object.freeze({
  guildId: '938894329076940820',
  studentRoleName: 'Academy Student',
  templateRoleId: '939031140679970867',
  categoryId: '1551448153276944405',
  inviteChannelId: '1551459038405992488',
  tierRoles: Object.freeze({
    Monarch: '1260433215189946420',
    Elite: '1192450618485395466',
    Premium: '939031140679970867'
  }),
  writeDelayMs: 350
});

const PERMISSIONS = Object.freeze({
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  VIEW_AUDIT_LOG: 1n << 7n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MANAGE_ROLES: 1n << 28n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  USE_EMBEDDED_ACTIVITIES: 1n << 39n
});

const REPORTED_PERMISSIONS = Object.freeze(['MANAGE_ROLES', 'CREATE_INSTANT_INVITE', 'BAN_MEMBERS', 'MANAGE_CHANNELS', 'VIEW_AUDIT_LOG', 'ADMINISTRATOR']);
const REQUIRED_PERMISSIONS = Object.freeze(['MANAGE_ROLES', 'CREATE_INSTANT_INVITE', 'BAN_MEMBERS']);

/* Bits the Academy Student must hold inside the Academy category. */
const ACADEMY_ALLOW = PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.READ_MESSAGE_HISTORY | PERMISSIONS.SEND_MESSAGES
  | PERMISSIONS.USE_APPLICATION_COMMANDS | PERMISSIONS.USE_EMBEDDED_ACTIVITIES | PERMISSIONS.CONNECT | PERMISSIONS.SPEAK;

const EXIT = Object.freeze({ OK: 0, CONFIG: 1, AUTH: 2, FATAL: 3 });

/* ----------------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------------- */

class ConfigError extends Error {
  constructor(message) { super(message); this.name = 'ConfigError'; }
}

class ApiError extends Error {
  constructor(kind, status, code, message) {
    super(message || `discord_${kind}`);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

function classify(status, code) {
  if (status === 0) return 'network';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404 && code === 10004) return 'unknown_guild';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'unexpected';
}

/* ----------------------------------------------------------------------------
 * Arguments and configuration
 * ------------------------------------------------------------------------- */

function parseArgs(argv = []) {
  const flags = { apply: false, json: false, help: false };
  for (const arg of argv) {
    if (arg === '--apply') flags.apply = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--dry-run') flags.apply = false;
    else throw new ConfigError(`Unknown argument: ${arg}`);
  }
  return flags;
}

function snowflake(value, name, fallback) {
  const raw = String(value == null ? '' : value).trim() || fallback;
  if (!SNOWFLAKE.test(raw)) throw new ConfigError(`${name} must be a Discord snowflake`);
  return raw;
}

function readConfig(env = {}) {
  const token = String(env.SML_ACADEMY_BOT_TOKEN || '').trim();
  if (!token) throw new ConfigError('SML_ACADEMY_BOT_TOKEN is required');
  const studentRoleName = String(env.SML_ACADEMY_STUDENT_ROLE_NAME || '').trim() || DEFAULTS.studentRoleName;
  if (studentRoleName.length > 100) throw new ConfigError('SML_ACADEMY_STUDENT_ROLE_NAME is too long');
  const delay = env.SML_ACADEMY_WRITE_DELAY_MS == null || env.SML_ACADEMY_WRITE_DELAY_MS === '' ? DEFAULTS.writeDelayMs : Number(env.SML_ACADEMY_WRITE_DELAY_MS);
  if (!Number.isFinite(delay) || delay < 0) throw new ConfigError('SML_ACADEMY_WRITE_DELAY_MS must be a non-negative number');
  const studentRoleId = String(env.SML_ACADEMY_BILLING_ACADEMY_ROLE_ID || '').trim();
  if (studentRoleId && !SNOWFLAKE.test(studentRoleId)) throw new ConfigError('SML_ACADEMY_BILLING_ACADEMY_ROLE_ID must be a Discord snowflake');
  return {
    token,
    guildId: snowflake(env.SML_ACADEMY_GUILD_ID, 'SML_ACADEMY_GUILD_ID', DEFAULTS.guildId),
    studentRoleId: studentRoleId || null,
    studentRoleName,
    templateRoleId: snowflake(env.SML_ACADEMY_TEMPLATE_ROLE_ID, 'SML_ACADEMY_TEMPLATE_ROLE_ID', DEFAULTS.templateRoleId),
    categoryId: snowflake(env.SML_ACADEMY_CATEGORY_ID, 'SML_ACADEMY_CATEGORY_ID', DEFAULTS.categoryId),
    inviteChannelId: snowflake(env.SML_ACADEMY_INVITE_CHANNEL_ID, 'SML_ACADEMY_INVITE_CHANNEL_ID', DEFAULTS.inviteChannelId),
    tierRoles: {
      Monarch: snowflake(env.SML_ACADEMY_MONARCH_ROLE_ID, 'SML_ACADEMY_MONARCH_ROLE_ID', DEFAULTS.tierRoles.Monarch),
      Elite: snowflake(env.SML_ACADEMY_ELITE_ROLE_ID, 'SML_ACADEMY_ELITE_ROLE_ID', DEFAULTS.tierRoles.Elite),
      Premium: snowflake(env.SML_ACADEMY_PREMIUM_ROLE_ID, 'SML_ACADEMY_PREMIUM_ROLE_ID', DEFAULTS.tierRoles.Premium)
    },
    writeDelayMs: delay
  };
}

/** Every output line passes through this so the token can never leak. */
function createRedactor(token) {
  const secrets = [token];
  try { secrets.push(encodeURIComponent(token)); } catch (_) { /* token is plain ASCII in practice */ }
  return (text) => {
    let out = String(text);
    for (const secret of secrets) {
      if (secret && secret.length >= 8) out = out.split(secret).join('[redacted]');
    }
    return out;
  };
}

/* ----------------------------------------------------------------------------
 * Discord client: bot auth, 429 retry, bucket exhaustion pause
 * ------------------------------------------------------------------------- */

function createClient({ token, fetchImpl, sleep, maxRetries = 5, timeoutMs = 10000 }) {
  if (typeof fetchImpl !== 'function') throw new TypeError('createClient: fetchImpl required');

  function header(response, name) {
    if (!response || !response.headers || typeof response.headers.get !== 'function') return null;
    const value = response.headers.get(name);
    return value == null ? null : String(value);
  }

  async function request(method, path, { body, reason } = {}) {
    for (let attempt = 0; ; attempt += 1) {
      const headers = { accept: 'application/json', authorization: `Bot ${token}` };
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (reason) headers['x-audit-log-reason'] = encodeURIComponent(String(reason).slice(0, 100));
      let response;
      try {
        response = await fetchImpl(`${API}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined
        });
      } catch (error) {
        throw new ApiError('network', 0, null, `${method} ${path} network error: ${String(error && error.name || 'error').slice(0, 40)}`);
      }
      const status = Number(response.status);
      let text = '';
      if (status !== 204) {
        try { text = await response.text(); } catch (_) { text = ''; }
      }
      let json = null;
      if (text) {
        try { json = JSON.parse(text); } catch (_) { json = null; }
      }
      const code = json && Number.isInteger(json.code) ? json.code : null;

      if (status === 429) {
        if (attempt >= maxRetries) throw new ApiError('rate_limited', 429, code, `${method} ${path} rate limited after ${attempt + 1} attempts`);
        const fromBody = json && json.retry_after != null ? Number(json.retry_after) : NaN;
        const fromHeader = Number(header(response, 'retry-after'));
        const retryAfter = Number.isFinite(fromBody) && fromBody >= 0 ? fromBody : (Number.isFinite(fromHeader) && fromHeader >= 0 ? fromHeader : 1);
        await sleep(Math.min(60000, Math.ceil(retryAfter * 1000)));
        continue;
      }

      /* Bucket exhausted: pause before the NEXT call rather than eating a 429. */
      const remaining = header(response, 'x-ratelimit-remaining');
      if (remaining !== null && Number(remaining) <= 0) {
        const resetAfter = Number(header(response, 'x-ratelimit-reset-after'));
        if (Number.isFinite(resetAfter) && resetAfter > 0) await sleep(Math.min(60000, Math.ceil(resetAfter * 1000)));
      }

      if (status >= 200 && status < 300) return { status, json };
      const detail = json && json.message ? String(json.message).slice(0, 200) : '';
      throw new ApiError(classify(status, code), status, code, `${method} ${path} -> ${status}${detail ? ` ${detail}` : ''}`);
    }
  }

  return { request };
}

/* ----------------------------------------------------------------------------
 * Pure helpers (exported for tests)
 * ------------------------------------------------------------------------- */

function bits(value) {
  try { return BigInt(String(value == null || value === '' ? '0' : value)); } catch (_) { return 0n; }
}

function decodePermissions(bitfield, { administrator = false } = {}) {
  const flags = {};
  for (const name of REPORTED_PERMISSIONS) {
    flags[name] = administrator || (bitfield & PERMISSIONS[name]) !== 0n;
  }
  return flags;
}

/** Effective guild-level permissions of a member: @everyone plus each role. */
function memberPermissions({ guildId, roles, memberRoleIds, ownerId, botId }) {
  const byId = new Map((roles || []).map((role) => [String(role.id), role]));
  let bitfield = 0n;
  const everyone = byId.get(String(guildId));
  if (everyone) bitfield |= bits(everyone.permissions);
  let top = null;
  for (const id of memberRoleIds || []) {
    const role = byId.get(String(id));
    if (!role) continue;
    bitfield |= bits(role.permissions);
    if (!top || Number(role.position || 0) > Number(top.position || 0)) top = role;
  }
  const administrator = (ownerId != null && String(ownerId) === String(botId)) || (bitfield & PERMISSIONS.ADMINISTRATOR) !== 0n;
  return { bitfield, top, administrator, flags: decodePermissions(bitfield, { administrator }) };
}

function roleOverwrite(channel, roleId) {
  if (!roleId) return null;
  const list = Array.isArray(channel && channel.permission_overwrites) ? channel.permission_overwrites : [];
  return list.find((entry) => String(entry.id) === String(roleId) && Number(entry.type) === 0) || null;
}

function permissionNames(bitfield) {
  const names = [];
  let rest = bitfield;
  for (const [name, bit] of Object.entries(PERMISSIONS)) {
    if ((bitfield & bit) !== 0n) { names.push(name); rest &= ~bit; }
  }
  for (let i = 0n; rest !== 0n && i < 64n; i += 1n) {
    if ((rest & (1n << i)) !== 0n) { names.push(`bit ${i}`); rest &= ~(1n << i); }
  }
  return names;
}

/**
 * The bot's effective permissions inside one channel, computed the documented
 * way: base (@everyone + roles), then the @everyone overwrite, then the union of
 * its role overwrites (deny, then allow), then its member overwrite. Callers
 * skip this for ADMINISTRATOR, which bypasses overwrites entirely.
 */
function channelPermissions(channel, { guildId, botId, memberRoleIds, base }) {
  const list = Array.isArray(channel && channel.permission_overwrites) ? channel.permission_overwrites : [];
  let permissions = base;
  const everyone = list.find((entry) => Number(entry.type) === 0 && String(entry.id) === String(guildId));
  if (everyone) { permissions &= ~bits(everyone.deny); permissions |= bits(everyone.allow); }
  const mine = new Set((memberRoleIds || []).map(String));
  let allow = 0n;
  let deny = 0n;
  for (const entry of list) {
    if (Number(entry.type) === 0 && mine.has(String(entry.id))) { allow |= bits(entry.allow); deny |= bits(entry.deny); }
  }
  permissions &= ~deny;
  permissions |= allow;
  const member = list.find((entry) => Number(entry.type) === 1 && String(entry.id) === String(botId));
  if (member) { permissions &= ~bits(member.deny); permissions |= bits(member.allow); allow |= bits(member.allow); }
  return { permissions, manageRolesOverwrite: (allow & PERMISSIONS.MANAGE_ROLES) !== 0n };
}

/**
 * Why Discord would reject a PUT on this channel, per the Edit Channel
 * Permissions rules, or null when nothing in the documented rules blocks it.
 */
function predictRejection(channel, plan, context) {
  if (!context || context.administrator) return null;
  const effective = channelPermissions(channel, context);
  if ((effective.permissions & PERMISSIONS.VIEW_CHANNEL) === 0n) return { kind: 'cannot_view' };
  if ((effective.permissions & PERMISSIONS.MANAGE_ROLES) === 0n) return { kind: 'missing_manage_roles' };
  if (effective.manageRolesOverwrite) return null;
  const missing = (bits(plan.allow) | bits(plan.deny)) & ~effective.permissions;
  return missing === 0n ? null : { kind: 'missing_bits', bits: permissionNames(missing) };
}

function overwriteKey(entry) { return `${Number(entry.type)}:${String(entry.id)}`; }

/** Discord's "synced with category" is plain equality of the two overwrite sets. */
function sameOverwrites(left, right) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  if (a.length !== b.length) return false;
  const index = new Map(a.map((entry) => [overwriteKey(entry), entry]));
  for (const entry of b) {
    const other = index.get(overwriteKey(entry));
    if (!other) return false;
    if (bits(other.allow) !== bits(entry.allow) || bits(other.deny) !== bits(entry.deny)) return false;
  }
  return true;
}

function everyoneCanView(channel, guildId, roles) {
  const everyoneRole = (roles || []).find((role) => String(role.id) === String(guildId));
  let can = everyoneRole ? (bits(everyoneRole.permissions) & PERMISSIONS.VIEW_CHANNEL) !== 0n : true;
  const overwrite = roleOverwrite(channel, guildId);
  if (overwrite) {
    if ((bits(overwrite.deny) & PERMISSIONS.VIEW_CHANNEL) !== 0n) can = false;
    if ((bits(overwrite.allow) & PERMISSIONS.VIEW_CHANNEL) !== 0n) can = true;
  }
  return can;
}

/**
 * Decide what the student overwrite on one channel should be.
 *   template present  -> copy its allow/deny exactly
 *   academy channel   -> additionally force ACADEMY_ALLOW into allow, out of deny
 *     ('category' = the Academy category itself, always ensured;
 *      'child'    = an unsynced child: ensured unless it is private today)
 * Returns null when the channel needs nothing from us.
 */
function planChannel(channel, { templateRoleId, studentRoleId, academy, guildId, roles }) {
  const template = roleOverwrite(channel, templateRoleId);
  const current = roleOverwrite(channel, studentRoleId);
  if (!template && !academy) return null;

  let allow = 0n;
  let deny = 0n;
  let source = 'none';
  if (template) { allow = bits(template.allow); deny = bits(template.deny); source = 'template'; }
  else if (current) { allow = bits(current.allow); deny = bits(current.deny); source = 'existing'; }

  if (academy === 'child' && !template && !current && !everyoneCanView(channel, guildId, roles)) {
    return { action: 'private_skipped', source, allow: null, deny: null, current: null };
  }

  if (academy) { allow |= ACADEMY_ALLOW; deny &= ~ACADEMY_ALLOW; }

  if (current && bits(current.allow) === allow && bits(current.deny) === deny) {
    return { action: 'identical', source, allow, deny, current: { allow: bits(current.allow), deny: bits(current.deny) } };
  }
  return {
    action: template ? 'copy' : 'ensure',
    source,
    allow,
    deny,
    current: current ? { allow: bits(current.allow), deny: bits(current.deny) } : null
  };
}

/** Which Academy channels get the ensured bits: the category, plus children that keep their own ACL. */
function academyChannelIds(channels, categoryId) {
  const ids = new Set();
  const category = channels.find((channel) => String(channel.id) === String(categoryId));
  if (!category) return ids;
  ids.add(String(category.id));
  for (const channel of channels) {
    if (String(channel.parent_id || '') !== String(categoryId)) continue;
    const own = Array.isArray(channel.permission_overwrites) ? channel.permission_overwrites : [];
    if (!own.length) continue;
    if (sameOverwrites(own, category.permission_overwrites)) continue;
    ids.add(String(channel.id));
  }
  return ids;
}

function findStudentRole(roles, name) {
  const wanted = String(name).trim().toLowerCase();
  const matches = (roles || []).filter((role) => !role.managed && String(role.name || '').trim().toLowerCase() === wanted);
  matches.sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  return { role: matches[0] || null, duplicates: matches.length > 1 ? matches.length : 0 };
}

function channelLabel(channel) {
  return `${Number(channel.type) === CHANNEL_CATEGORY ? 'category' : 'channel'} "${channel.name || channel.id}" (${channel.id})`;
}

function inviteUrl(code) { return `https://discord.gg/${code}`; }

function isPermanentBotInvite(invite, botId) {
  return !!invite && !!invite.inviter && String(invite.inviter.id) === String(botId)
    && Number(invite.max_age || 0) === 0 && Number(invite.max_uses || 0) === 0 && !invite.temporary;
}

/* ----------------------------------------------------------------------------
 * The run
 * ------------------------------------------------------------------------- */

const USAGE = [
  'Usage: node scripts/academy-discord-setup.js [--apply] [--json]',
  '',
  '  (no flags)  dry run: read the guild, print the plan, write nothing',
  '  --apply     create the student role, mirror overwrites, create the invite',
  '  --json      print a machine-readable summary on stdout (logs go to stderr)',
  ''
].join('\n');

async function run({ env = process.env, argv = [], fetchImpl = globalThis.fetch, sleep, stdout, stderr } = {}) {
  const writeOut = typeof stdout === 'function' ? stdout : (text) => process.stdout.write(text);
  const writeErr = typeof stderr === 'function' ? stderr : (text) => process.stderr.write(text);
  const wait = typeof sleep === 'function' ? sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let flags;
  let cfg;
  try {
    flags = parseArgs(argv);
    if (flags.help) { writeOut(USAGE); return { code: EXIT.OK, summary: null }; }
    cfg = readConfig(env);
  } catch (error) {
    writeErr(`${error.message}\n${USAGE}`);
    return { code: EXIT.CONFIG, summary: null };
  }

  const redact = createRedactor(cfg.token);
  const log = (line) => (flags.json ? writeErr : writeOut)(`${redact(line)}\n`);
  const client = createClient({ token: cfg.token, fetchImpl, sleep: wait });
  const api = async (method, path, options) => (await client.request(method, path, options)).json;

  const summary = {
    ok: true,
    dryRun: !flags.apply,
    guild: null,
    bot: null,
    tiers: [],
    studentRole: null,
    overwrites: { copied: 0, ensured: 0, skipped: 0, followsCategory: 0, privateSkipped: 0, failed: 0, planned: [] },
    invite: null,
    writes: 0,
    warnings: []
  };
  const warn = (message) => { summary.warnings.push(message); };
  const finishJson = () => { if (flags.json) writeOut(`${JSON.stringify(summary, null, 2)}\n`); };
  const fatal = (error, phase) => {
    const kind = error instanceof ApiError ? error.kind : 'unexpected';
    log(`FATAL: ${phase} (${kind}): ${redact(error.message)}`);
    summary.ok = false;
    summary.error = { kind, message: redact(error.message) };
    finishJson();
    return { code: kind === 'unauthorized' || kind === 'forbidden' ? EXIT.AUTH : EXIT.FATAL, summary };
  };

  log(`Academy Discord setup — ${flags.apply ? 'APPLY' : 'DRY RUN (pass --apply to write)'}`);

  /* ---- Step 1: reads ---------------------------------------------------- */
  let me; let guild; let roles; let member; let channels;
  try {
    me = await api('GET', '/users/@me');
    guild = await api('GET', `/guilds/${cfg.guildId}`);
    roles = await api('GET', `/guilds/${cfg.guildId}/roles`);
    member = await api('GET', `/guilds/${cfg.guildId}/members/${String(me.id)}`);
    channels = await api('GET', `/guilds/${cfg.guildId}/channels`);
  } catch (error) {
    return fatal(error, 'Discord read failed');
  }
  roles = Array.isArray(roles) ? roles : [];
  channels = Array.isArray(channels) ? channels : [];
  const botId = String(me.id);
  const memberRoleIds = Array.isArray(member && member.roles) ? member.roles.map(String) : [];
  const perms = memberPermissions({ guildId: cfg.guildId, roles, memberRoleIds, ownerId: guild && guild.owner_id, botId });
  const top = perms.top;
  const has = (name) => perms.flags[name] === true;

  summary.guild = { id: String(guild.id || cfg.guildId), name: String(guild.name || '') };
  summary.bot = {
    userId: botId,
    username: String(me.username || ''),
    topRole: top ? { id: String(top.id), name: String(top.name || ''), position: Number(top.position || 0), managed: !!top.managed } : null,
    permissions: { bitfield: perms.bitfield.toString(), administrator: perms.administrator, flags: perms.flags }
  };
  log(`Guild: ${summary.guild.name || '(unnamed)'} (${summary.guild.id})`);
  log(`Bot: ${summary.bot.username || '(unknown)'} (${botId}) top role ${top ? `"${top.name}" position ${top.position}` : 'NONE (position 0)'}`);
  log(`Permissions: ${REPORTED_PERMISSIONS.map((name) => `${name}=${perms.flags[name] ? 'yes' : 'no'}`).join(' ')} (bitfield ${perms.bitfield.toString()})`);
  if (!top) warn('Bot holds no role in the guild; it cannot manage any role or overwrite until it has one above the tiers.');
  for (const name of REQUIRED_PERMISSIONS) {
    if (!has(name)) warn(`Bot lacks ${name}; grant it on the bot role in Server Settings -> Roles.`);
  }

  /* Tier hierarchy: a role is grantable only when it sits below the bot's top role. */
  const roleById = new Map(roles.map((role) => [String(role.id), role]));
  const topPosition = top ? Number(top.position || 0) : 0;
  for (const [label, id] of Object.entries(cfg.tierRoles)) {
    const role = roleById.get(id);
    if (!role) {
      summary.tiers.push({ label, id, found: false });
      warn(`${label} role ${id} not found in the guild.`);
      continue;
    }
    const position = Number(role.position || 0);
    const belowBot = !!top && position < topPosition;
    summary.tiers.push({ label, id, found: true, name: String(role.name || ''), position, belowBot });
    log(`Tier ${label}: "${role.name}" position ${position} -> ${belowBot ? 'below bot (grants possible)' : 'NOT below bot (owner must drag the bot role above it)'}`);
    if (!belowBot) warn(`Bot top role ${top ? `"${top.name}" (position ${topPosition})` : '(none)'} is not above ${label} "${role.name}" (position ${position}); drag the bot role above it or grants will fail.`);
  }

  /* ---- Step 2: student role -------------------------------------------- */
  /* The engine grants SML_ACADEMY_BILLING_ACADEMY_ROLE_ID; when it is set and
     present, that role IS the student role even if someone renamed it, so the
     overwrites land on the role students actually receive. */
  let student = null;
  let studentRenamed = false;
  if (cfg.studentRoleId) {
    const pinned = roleById.get(cfg.studentRoleId);
    if (pinned && !pinned.managed && cfg.studentRoleId !== cfg.guildId) {
      student = pinned;
      if (String(pinned.name || '').trim().toLowerCase() !== cfg.studentRoleName.toLowerCase()) {
        /* The engine-granted role keeps its id; only its display name is corrected. This is the
           single PATCH the script ever makes, and only on the pinned student role. */
        if (flags.apply && has('MANAGE_ROLES')) {
          try {
            const renamed = await api('PATCH', `/guilds/${cfg.guildId}/roles/${cfg.studentRoleId}`, {
              body: { name: cfg.studentRoleName },
              reason: 'Academy launch: name the engine-granted student role'
            });
            summary.writes += 1;
            await wait(cfg.writeDelayMs);
            pinned.name = String((renamed && renamed.name) || cfg.studentRoleName);
            studentRenamed = true;
            log(`Student role: renamed ${cfg.studentRoleId} to "${pinned.name}"`);
          } catch (error) {
            if (error instanceof ApiError && error.kind === 'unauthorized') return fatal(error, 'role rename rejected');
            warn(`Renaming ${cfg.studentRoleId} to "${cfg.studentRoleName}" failed: ${redact(error.message)}; using it under its current name "${pinned.name}".`);
          }
        } else {
          warn(`SML_ACADEMY_BILLING_ACADEMY_ROLE_ID ${cfg.studentRoleId} is named "${pinned.name}", not "${cfg.studentRoleName}"; ${flags.apply ? 'using it as the student role because the engine grants it' : '--apply will rename it (name only)'}.`);
        }
      }
    } else {
      warn(`SML_ACADEMY_BILLING_ACADEMY_ROLE_ID ${cfg.studentRoleId} is not a usable role in the guild; falling back to the role named "${cfg.studentRoleName}". Point the engine at the id this run reports.`);
    }
  }
  if (!student) {
    const found = findStudentRole(roles, cfg.studentRoleName);
    student = found.role;
    if (found.duplicates) warn(`${found.duplicates} roles are named "${cfg.studentRoleName}"; using the lowest one (${student.id}). Remove the extras by hand.`);
  }
  if (student) {
    summary.studentRole = { id: String(student.id), name: String(student.name), position: Number(student.position || 0), status: studentRenamed ? 'renamed' : 'existing' };
    log(`Student role: "${student.name}" (${student.id}) position ${student.position} — ${studentRenamed ? 'renamed' : 'existing'}`);
    if (top && Number(student.position || 0) >= topPosition) {
      warn(`"${student.name}" (position ${student.position}) is not below the bot's top role (position ${topPosition}); the bot cannot grant it. Drag it below the bot role.`);
    }
  } else if (!has('MANAGE_ROLES')) {
    summary.studentRole = { id: null, name: cfg.studentRoleName, position: null, status: 'blocked_missing_manage_roles' };
    log(`Student role: "${cfg.studentRoleName}" missing and the bot lacks MANAGE_ROLES — cannot create it.`);
    warn(`Cannot create "${cfg.studentRoleName}" without MANAGE_ROLES.`);
  } else if (!flags.apply) {
    summary.studentRole = { id: null, name: cfg.studentRoleName, position: null, status: 'would_create' };
    log(`Student role: "${cfg.studentRoleName}" missing — would create (plain, permissions 0, bottom of the list)`);
  } else {
    try {
      const created = await api('POST', `/guilds/${cfg.guildId}/roles`, {
        body: { name: cfg.studentRoleName, permissions: '0', color: 0, hoist: false, mentionable: false },
        reason: 'Academy launch: create the plain Academy Student role'
      });
      summary.writes += 1;
      await wait(cfg.writeDelayMs);
      student = created;
      roles.push(created);
      roleById.set(String(created.id), created);
      summary.studentRole = { id: String(created.id), name: String(created.name), position: Number(created.position || 0), status: 'created' };
      log(`Student role: created "${created.name}" (${created.id}) position ${created.position}`);
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'unauthorized') return fatal(error, 'role create rejected');
      summary.studentRole = { id: null, name: cfg.studentRoleName, position: null, status: 'create_failed' };
      warn(`Creating "${cfg.studentRoleName}" failed: ${redact(error.message)}`);
      log(`Student role: create FAILED — ${redact(error.message)}`);
    }
  }
  const studentId = student ? String(student.id) : null;
  if (studentId && studentId === cfg.guildId) throw new Error('refusing to treat @everyone as the student role');
  summary.engineRoleEnv = { variable: 'SML_ACADEMY_BILLING_ACADEMY_ROLE_ID', configured: cfg.studentRoleId, expected: studentId, inSync: !!studentId && studentId === cfg.studentRoleId };
  if (studentId && !summary.engineRoleEnv.inSync) log(`Engine env: set SML_ACADEMY_BILLING_ACADEMY_ROLE_ID=${studentId} (and list it in SML_ACADEMY_ACCESS_ROLE_IDS) so grants land on this role.`);

  /* ---- Step 3: overwrites ---------------------------------------------- */
  const canWriteOverwrites = flags.apply && !!studentId && has('MANAGE_ROLES');
  if (flags.apply && !studentId) warn('No student role id; overwrites are reported only.');
  if (flags.apply && studentId && !has('MANAGE_ROLES')) warn('Bot lacks MANAGE_ROLES; overwrites are reported only.');

  async function applyPlan(channel, plan, academy) {
    const entry = {
      channelId: String(channel.id),
      name: String(channel.name || ''),
      type: Number(channel.type),
      parentId: channel.parent_id ? String(channel.parent_id) : null,
      action: plan.action,
      source: plan.source,
      allow: plan.allow == null ? null : plan.allow.toString(),
      deny: plan.deny == null ? null : plan.deny.toString(),
      current: plan.current ? { allow: plan.current.allow.toString(), deny: plan.current.deny.toString() } : null
    };
    if (plan.action === 'identical') {
      summary.overwrites.skipped += 1;
      entry.result = 'skipped_identical';
    } else if (plan.action === 'private_skipped') {
      summary.overwrites.privateSkipped += 1;
      entry.result = 'private_review';
      log(`  REVIEW ${channelLabel(channel)}: private (hidden from @everyone, no student overwrite) — left untouched`);
    } else if (plan.action === 'follows_category') {
      summary.overwrites.followsCategory += 1;
      entry.result = 'follows_category';
    } else if (!canWriteOverwrites) {
      entry.result = flags.apply ? 'blocked' : 'planned';
      /* Dry-run prediction from the documented rules; the real API stays the judge on --apply. */
      const rejection = predictRejection(channel, plan, predictionContext);
      if (rejection) { entry.predicted = rejection.kind; if (rejection.bits) entry.predictedMissing = rejection.bits; }
      log(`  ${flags.apply ? 'BLOCKED' : 'PLAN'} PUT ${channelLabel(channel)} ${plan.action} allow=${entry.allow} deny=${entry.deny}${entry.current ? ` (now allow=${entry.current.allow} deny=${entry.current.deny})` : ' (new)'}${rejection ? ` [would be rejected: ${rejection.kind}${rejection.bits ? ` ${rejection.bits.join(',')}` : ''}]` : ''}`);
    } else {
      try {
        await client.request('PUT', `/channels/${channel.id}/permissions/${studentId}`, {
          body: { type: 0, allow: entry.allow, deny: entry.deny },
          reason: academy ? 'Academy launch: Academy Student access to the Academy category' : 'Academy launch: mirror Premium access for Academy Student'
        });
        summary.writes += 1;
        if (plan.action === 'copy') summary.overwrites.copied += 1; else summary.overwrites.ensured += 1;
        entry.result = 'written';
        log(`  PUT ${channelLabel(channel)} ${plan.action} allow=${entry.allow} deny=${entry.deny}`);
        await wait(cfg.writeDelayMs);
      } catch (error) {
        if (error instanceof ApiError && error.kind === 'unauthorized') throw error;
        summary.overwrites.failed += 1;
        entry.result = 'failed';
        entry.error = redact(error.message);
        warn(`Overwrite on ${channelLabel(channel)} failed: ${redact(error.message)}`);
        log(`  FAILED PUT ${channelLabel(channel)}: ${redact(error.message)}`);
      }
    }
    summary.overwrites.planned.push(entry);
  }

  const planOptions = () => ({ templateRoleId: cfg.templateRoleId, studentRoleId: studentId, guildId: cfg.guildId, roles });
  const predictionContext = { guildId: cfg.guildId, botId, memberRoleIds, base: perms.bitfield, administrator: perms.administrator };

  try {
    log(`Overwrites: mirroring template role ${cfg.templateRoleId}${roleById.has(cfg.templateRoleId) ? ` "${roleById.get(cfg.templateRoleId).name}"` : ' (NOT FOUND)'} + Academy category ${cfg.categoryId}`);
    if (!roleById.has(cfg.templateRoleId)) warn(`Template role ${cfg.templateRoleId} not found; only the Academy category is ensured.`);
    if (!channels.some((channel) => String(channel.id) === cfg.categoryId)) warn(`Academy category ${cfg.categoryId} not found in the channel list.`);

    let academyIds = academyChannelIds(channels, cfg.categoryId);
    const categories = channels.filter((channel) => Number(channel.type) === CHANNEL_CATEGORY);
    /* Children synced with their category BEFORE any write. They must still
       follow the category afterwards, even if Discord did not propagate. */
    const syncedBefore = new Set();
    for (const channel of channels) {
      if (Number(channel.type) === CHANNEL_CATEGORY || !channel.parent_id) continue;
      const parent = categories.find((category) => String(category.id) === String(channel.parent_id));
      if (parent && sameOverwrites(channel.permission_overwrites, parent.permission_overwrites)) syncedBefore.add(String(channel.id));
    }
    const categoryPlans = new Map();
    for (const category of categories) {
      const academy = String(category.id) === cfg.categoryId ? 'category' : false;
      const plan = planChannel(category, { ...planOptions(), academy });
      if (!plan) continue;
      categoryPlans.set(String(category.id), plan);
      await applyPlan(category, plan, !!academy);
    }

    /* Category writes propagate to synced children. Re-read so those children
       compare identical and are skipped; anything Discord did not propagate is
       written explicitly, which keeps it synced because the values match. */
    const categoryWrites = [...categoryPlans.values()].some((plan) => plan.action === 'copy' || plan.action === 'ensure');
    if (canWriteOverwrites && categoryWrites) {
      const refreshed = await api('GET', `/guilds/${cfg.guildId}/channels`);
      if (Array.isArray(refreshed)) channels = refreshed;
      academyIds = academyChannelIds(channels, cfg.categoryId);
    }
    const parents = new Map(channels.filter((channel) => Number(channel.type) === CHANNEL_CATEGORY).map((channel) => [String(channel.id), channel]));
    for (const channel of channels) {
      if (Number(channel.type) === CHANNEL_CATEGORY) continue;
      const parent = channel.parent_id ? parents.get(String(channel.parent_id)) : null;
      const parentPlan = parent ? categoryPlans.get(String(parent.id)) : null;
      const synced = !!parent && sameOverwrites(channel.permission_overwrites, parent.permission_overwrites);
      const parentWrote = !!parentPlan && (parentPlan.action === 'copy' || parentPlan.action === 'ensure');
      if (!synced && parentWrote && syncedBefore.has(String(channel.id))) {
        /* Discord did not propagate the category write to this synced child:
           write the category's values explicitly, which re-syncs it. It is
           never judged "private" — it was following the category a moment ago. */
        const current = roleOverwrite(channel, studentId);
        const identical = !!current && bits(current.allow) === parentPlan.allow && bits(current.deny) === parentPlan.deny;
        await applyPlan(channel, {
          action: identical ? 'identical' : parentPlan.action,
          source: 'category',
          allow: parentPlan.allow,
          deny: parentPlan.deny,
          current: current ? { allow: bits(current.allow), deny: bits(current.deny) } : null
        }, String(parent.id) === cfg.categoryId);
        continue;
      }
      const academy = academyIds.has(String(channel.id)) ? 'child' : false;
      const plan = planChannel(channel, { ...planOptions(), academy });
      /* A child synced with its category inherits the category's write (Discord
         propagates it). Report it as following the category unless we are
         applying and it still differs, in which case it is written explicitly. */
      const parentHandled = synced && parentPlan && (!plan || plan.action === 'identical' || (!canWriteOverwrites && (parentPlan.action === 'copy' || parentPlan.action === 'ensure')));
      if (parentHandled) {
        await applyPlan(channel, { action: 'follows_category', source: 'category', allow: parentPlan.allow, deny: parentPlan.deny, current: plan && plan.current ? plan.current : null }, false);
        continue;
      }
      if (!plan) continue;
      await applyPlan(channel, plan, !!academy);
    }
  } catch (error) {
    return fatal(error, 'overwrite pass aborted');
  }
  const o = summary.overwrites;
  log(`Overwrites: ${flags.apply ? `${o.copied} copied, ${o.ensured} ensured` : `${o.planned.filter((entry) => entry.result === 'planned').length} planned`}, ${o.skipped} identical, ${o.followsCategory} follow their category, ${o.privateSkipped} private (review), ${o.failed} failed`);

  /* Predicted rejections, one warning per kind. */
  const label = (entry) => `"${entry.name || entry.channelId}"`;
  const predictedByKind = (kind) => o.planned.filter((entry) => entry.predicted === kind);
  const cannotView = predictedByKind('cannot_view');
  if (cannotView.length) warn(`Bot cannot view ${cannotView.length} channel(s) it would write (no ADMINISTRATOR and no overwrite for its role there): ${cannotView.map(label).join(', ')}. Discord rejects those PUTs with Missing Access; give the bot role an allow overwrite on them (or ADMINISTRATOR) first.`);
  const noManage = predictedByKind('missing_manage_roles');
  if (noManage.length) warn(`Bot is denied MANAGE_ROLES inside ${noManage.length} channel(s) it would write: ${noManage.map(label).join(', ')}. Discord rejects those PUTs; lift the deny on the bot role there first.`);
  const missingBits = predictedByKind('missing_bits');
  if (missingBits.length) warn(`Bot does not hold every bit it would allow/deny in ${missingBits.length} channel(s): ${missingBits.map((entry) => `${label(entry)} lacks ${(entry.predictedMissing || []).join(', ')}`).join('; ')}. Discord only lets a bot allow/deny permissions it has in the channel; grant them to the bot role (or give it a MANAGE_ROLES overwrite there).`);

  /* ---- Step 4: invite -------------------------------------------------- */
  const inviteChannel = channels.find((channel) => String(channel.id) === cfg.inviteChannelId);
  summary.invite = { channelId: cfg.inviteChannelId, channelName: inviteChannel ? String(inviteChannel.name || '') : null, code: null, url: null, action: 'skipped' };
  if (!inviteChannel) {
    summary.invite.action = 'skipped_missing_channel';
    warn(`Invite channel ${cfg.inviteChannelId} not found; no invite created.`);
  } else {
    let existing = null;
    let listError = null;
    try {
      const invites = await api('GET', `/channels/${cfg.inviteChannelId}/invites`);
      existing = (Array.isArray(invites) ? invites : []).find((invite) => isPermanentBotInvite(invite, botId)) || null;
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'unauthorized') return fatal(error, 'invite list rejected');
      listError = error instanceof ApiError ? error.kind : 'unexpected';
    }
    if (existing) {
      summary.invite.code = String(existing.code);
      summary.invite.url = inviteUrl(existing.code);
      summary.invite.action = 'reused';
      log(`Invite: reusing permanent invite ${summary.invite.url} on #${inviteChannel.name}`);
    } else if (!has('CREATE_INSTANT_INVITE')) {
      summary.invite.action = 'blocked_missing_permission';
      log('Invite: bot lacks CREATE_INSTANT_INVITE — cannot create one.');
    } else if (!flags.apply) {
      summary.invite.action = 'would_create';
      log(`Invite: would create a permanent invite on #${inviteChannel.name}${listError ? ` (could not list existing invites: ${listError})` : ''}`);
    } else {
      try {
        const invite = await api('POST', `/channels/${cfg.inviteChannelId}/invites`, {
          body: { max_age: 0, max_uses: 0, temporary: false, unique: false },
          reason: 'Academy launch: permanent invite to the Academy hub'
        });
        summary.writes += 1;
        summary.invite.code = String(invite.code);
        summary.invite.url = inviteUrl(invite.code);
        summary.invite.action = 'created';
        log(`Invite: created ${summary.invite.url} on #${inviteChannel.name}`);
      } catch (error) {
        if (error instanceof ApiError && error.kind === 'unauthorized') return fatal(error, 'invite create rejected');
        summary.invite.action = 'create_failed';
        warn(`Creating the invite failed: ${redact(error.message)}`);
        log(`Invite: create FAILED — ${redact(error.message)}`);
      }
    }
  }

  /* ---- Step 5: summary ------------------------------------------------- */
  log(`Writes this run: ${summary.writes}`);
  if (summary.warnings.length) {
    log(`Warnings (${summary.warnings.length}):`);
    for (const message of summary.warnings) log(`  - ${message}`);
  } else {
    log('Warnings: none');
  }
  finishJson();
  return { code: EXIT.OK, summary };
}

async function main() {
  const result = await run({ env: process.env, argv: process.argv.slice(2) });
  process.exitCode = result.code;
}

if (require.main === module) {
  main().catch((error) => {
    const token = String(process.env.SML_ACADEMY_BOT_TOKEN || '').trim();
    process.stderr.write(`${createRedactor(token)(error && error.message ? error.message : String(error))}\n`);
    process.exitCode = EXIT.FATAL;
  });
}

module.exports = {
  run, parseArgs, readConfig, createClient, createRedactor, memberPermissions, decodePermissions, planChannel,
  academyChannelIds, sameOverwrites, findStudentRole, isPermanentBotInvite, channelPermissions, predictRejection,
  permissionNames, ApiError, ConfigError,
  PERMISSIONS, ACADEMY_ALLOW, DEFAULTS, EXIT, API
};
