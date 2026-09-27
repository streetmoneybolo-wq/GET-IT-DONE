'use strict';

/* =============================================================================
 * MEM Academy billing: Discord bot reads (SML_ACADEMY_BOT_TOKEN).
 *
 * Role WRITES go through group-subs/src/discord-sync.js (see applier.js). This
 * module only reads, plus the optional auto-join PUT.
 *
 * Observations are classified strictly. For a member lookup only two answers
 * are usable:
 *   200            -> { inGuild:true, roles }
 *   404 code 10007 -> { inGuild:false }   (Unknown Member)
 * Everything else (429 after one honoured retry, 5xx, 401, 403, Unknown Guild,
 * timeouts) THROWS, so a flaky Discord can never be read as "holds no roles"
 * and trigger a wrong grant or a skipped revoke.
 * ========================================================================== */

const API = 'https://discord.com/api/v10';
const SNOWFLAKE = /^[0-9]{15,24}$/;

const CODES = Object.freeze({
  UNKNOWN_GUILD: 10004,
  UNKNOWN_MEMBER: 10007,
  UNKNOWN_ROLE: 10011,
  UNKNOWN_USER: 10013,
  UNKNOWN_BAN: 10026,
  MISSING_ACCESS: 50001,
  MISSING_PERMISSIONS: 50013
});

class DiscordError extends Error {
  constructor(kind, status, code, message) {
    super(message || `discord_${kind}`);
    this.name = 'DiscordError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

function classify(status, code) {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404 && code === CODES.UNKNOWN_ROLE) return 'unknown_role';
  if (status === 404 && code === CODES.UNKNOWN_GUILD) return 'unknown_guild';
  if (status === 404 && (code === CODES.UNKNOWN_MEMBER || code === CODES.UNKNOWN_USER)) return 'unknown_member';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'unexpected';
}

function createDiscordBot({ token, guildId, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  timeoutMs = 8000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('createDiscordBot: fetchImpl required');

  async function request(method, path, { body = null, reason = null, auth = 'bot', allow404 = false } = {}) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const headers = { accept: 'application/json' };
      if (auth === 'bot') headers.authorization = `Bot ${token}`;
      if (body) headers['content-type'] = 'application/json';
      if (reason) headers['x-audit-log-reason'] = encodeURIComponent(String(reason).slice(0, 100));
      let response;
      try {
        response = await fetchImpl(`${API}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (error) {
        throw new DiscordError('network', 0, null, `discord_network_${String(error && error.name || 'error').slice(0, 40)}`);
      }
      let json = null;
      if (response.status !== 204) {
        try { json = await response.json(); } catch (_) { json = null; }
      }
      const code = json && Number.isInteger(json.code) ? json.code : null;
      if (response.status === 429 && attempt === 1) {
        const retryAfter = Math.min(5, Math.max(0, Number(json && json.retry_after) || 1));
        await sleep(Math.ceil(retryAfter * 1000));
        continue;
      }
      if (response.status >= 200 && response.status < 300) return { status: response.status, json, code };
      if (allow404 && response.status === 404) return { status: 404, json, code };
      throw new DiscordError(classify(response.status, code), response.status, code);
    }
    throw new DiscordError('rate_limited', 429, null);
  }

  async function getMember(userId) {
    if (!SNOWFLAKE.test(String(userId))) throw new TypeError('getMember: snowflake required');
    const result = await request('GET', `/guilds/${guildId}/members/${userId}`, { allow404: true });
    if (result.status === 404) {
      if (result.code === CODES.UNKNOWN_MEMBER || result.code === CODES.UNKNOWN_USER) return { inGuild: false, roles: [] };
      throw new DiscordError(classify(404, result.code), 404, result.code);
    }
    const member = result.json || {};
    return {
      inGuild: true,
      roles: Array.isArray(member.roles) ? member.roles.map(String) : [],
      userId: member.user && member.user.id ? String(member.user.id) : String(userId)
    };
  }

  async function getUser(userId) {
    if (!SNOWFLAKE.test(String(userId))) return null;
    const result = await request('GET', `/users/${userId}`, { allow404: true });
    if (result.status === 404 || !result.json) return null;
    return { id: String(result.json.id), username: String(result.json.username || ''), globalName: result.json.global_name ? String(result.json.global_name) : '' };
  }

  const getMe = async () => (await request('GET', '/users/@me')).json;
  const getGuild = async () => (await request('GET', `/guilds/${guildId}`)).json;
  const listRoles = async () => (await request('GET', `/guilds/${guildId}/roles`)).json || [];

  /** One page of the member list (needs the Server Members intent). */
  async function listMembers(after = '0') {
    const result = await request('GET', `/guilds/${guildId}/members?limit=1000&after=${encodeURIComponent(after)}`);
    return Array.isArray(result.json) ? result.json.map((m) => ({ userId: String(m.user && m.user.id), roles: (m.roles || []).map(String) })) : [];
  }

  /**
   * MEMBER_ROLE_UPDATE (type 25) entries that ADDED an engine role, newer than
   * the cursor. Needs VIEW_AUDIT_LOG; a 403 throws 'forbidden'.
   */
  async function auditLogRoleAdds({ after = null, roleIds = [] } = {}) {
    const wanted = new Set(roleIds.map(String));
    const query = new URLSearchParams({ action_type: '25', limit: '100' });
    if (after) query.set('after', String(after));
    const result = await request('GET', `/guilds/${guildId}/audit-logs?${query.toString()}`);
    const entries = (result.json && Array.isArray(result.json.audit_log_entries)) ? result.json.audit_log_entries : [];
    const adds = [];
    let cursor = after;
    for (const entry of entries) {
      if (!cursor || BigInt(entry.id) > BigInt(cursor)) cursor = String(entry.id);
      for (const change of entry.changes || []) {
        if (change.key !== '$add') continue;
        const ids = (change.new_value || []).map((role) => String(role.id)).filter((id) => wanted.has(id));
        if (ids.length && SNOWFLAKE.test(String(entry.target_id))) adds.push({ id: String(entry.id), targetId: String(entry.target_id), roleIds: ids });
      }
    }
    return { adds, cursor };
  }

  /** Optional auto-join (guilds.join). The user token is used once, never stored. */
  async function addMember(userId, accessToken) {
    const result = await request('PUT', `/guilds/${guildId}/members/${userId}`, { body: { access_token: accessToken }, reason: 'MEM Academy purchase: member opted in' });
    return { added: result.status === 201 || result.status === 204 || result.status === 200, status: result.status };
  }

  /** true = banned, false = not banned, null = unknown (no BAN_MEMBERS). */
  async function getBan(userId) {
    try {
      const result = await request('GET', `/guilds/${guildId}/bans/${userId}`, { allow404: true });
      return result.status !== 404;
    } catch (error) {
      if (error instanceof DiscordError && error.kind === 'forbidden') return null;
      throw error;
    }
  }

  return { request, getMember, getUser, getMe, getGuild, listRoles, listMembers, auditLogRoleAdds, addMember, getBan };
}

/** Effective guild permissions of a member: @everyone plus each role. */
function memberPermissions({ guildId, roles, memberRoleIds }) {
  const byId = new Map((roles || []).map((role) => [String(role.id), role]));
  let bits = 0n;
  const everyone = byId.get(String(guildId));
  if (everyone) bits |= BigInt(String(everyone.permissions || '0'));
  let topPosition = 0;
  for (const id of memberRoleIds || []) {
    const role = byId.get(String(id));
    if (!role) continue;
    bits |= BigInt(String(role.permissions || '0'));
    topPosition = Math.max(topPosition, Number(role.position || 0));
  }
  return { bits, topPosition };
}

const PERMISSIONS = Object.freeze({
  CREATE_INSTANT_INVITE: 1n << 0n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  VIEW_AUDIT_LOG: 1n << 7n,
  MANAGE_ROLES: 1n << 28n
});

module.exports = { createDiscordBot, DiscordError, CODES, PERMISSIONS, memberPermissions, classify, API };
