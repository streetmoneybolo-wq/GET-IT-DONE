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

module.exports = { createAcademyAccess };
