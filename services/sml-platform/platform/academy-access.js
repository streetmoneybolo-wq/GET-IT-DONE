'use strict';

const DISCORD_API = 'https://discord.com/api/v10';

function createAcademyAccess({ guildId = '', allowedRoleIds = [], fetchImpl = fetch } = {}) {
  const roles = new Set(allowedRoleIds.map(String).filter(Boolean));
  async function verify(authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(String(authorization || ''));
    if (!guildId || !roles.size || !match) return { ok: false, status: 401, code: 'authorization_required' };
    const response = await fetchImpl(`${DISCORD_API}/users/@me/guilds/${encodeURIComponent(guildId)}/member`, {
      headers: { authorization: `Bearer ${match[1]}`, accept: 'application/json' },
      signal: AbortSignal.timeout(5_000)
    });
    if (response.status === 401) return { ok: false, status: 401, code: 'authorization_required' };
    if (response.status === 403 || response.status === 404) return { ok: false, status: 403, code: 'academy_role_required' };
    if (!response.ok) throw new Error(`discord_member_${response.status}`);
    const member = await response.json();
    const granted = Array.isArray(member.roles) && member.roles.some((role) => roles.has(String(role)));
    return granted ? { ok: true, userId: String(member.user?.id || '') } : { ok: false, status: 403, code: 'academy_role_required' };
  }
  return { verify };
}

/** Identity-only access: proves who the Discord user is, gates nothing else.
 *  The Connect app's LOOP-KICK Activity uses this — the real gate is the
 *  linked + verified stockmarketloop.com account, checked by the site. */
function createIdentityAccess({ fetchImpl = fetch } = {}) {
  async function verify(authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(String(authorization || ''));
    if (!match) return { ok: false, status: 401, code: 'authorization_required' };
    const response = await fetchImpl(`${DISCORD_API}/users/@me`, {
      headers: { authorization: `Bearer ${match[1]}`, accept: 'application/json' },
      signal: AbortSignal.timeout(5_000)
    });
    if (response.status === 401) return { ok: false, status: 401, code: 'authorization_required' };
    if (!response.ok) throw new Error(`discord_identity_${response.status}`);
    const user = await response.json();
    const userId = String(user?.id || '');
    return /^\d{15,24}$/.test(userId) ? { ok: true, userId } : { ok: false, status: 401, code: 'authorization_required' };
  }
  return { verify };
}

module.exports = { createAcademyAccess, createIdentityAccess };
