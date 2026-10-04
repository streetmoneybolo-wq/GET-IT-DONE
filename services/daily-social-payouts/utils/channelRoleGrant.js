/* Give a fixed set of roles to everyone who can see a channel and is missing them.
   planChannelRoleGrants is pure (easy to test); the CLI in scripts/grantChannelRoles.js does the Discord calls. */

const SNOWFLAKE = /^\d{15,25}$/;

export function cleanIds(list) {
  return [...new Set((Array.isArray(list) ? list : []).map((v) => String(v || '').replace(/\D/g, '')).filter((v) => SNOWFLAKE.test(v)))];
}

/* members: [{ id, bot, roleIds: string[], canView: boolean }]. Returns who needs which roles. Bots and people who cannot see the channel are left alone. */
export function planChannelRoleGrants(members, roleIds) {
  const wanted = cleanIds(roleIds);
  const grants = [];
  let skippedBots = 0, cannotView = 0, alreadyComplete = 0;
  for (const m of members || []) {
    if (m.bot) { skippedBots += 1; continue; }
    if (!m.canView) { cannotView += 1; continue; }
    const have = new Set(m.roleIds || []);
    const missing = wanted.filter((r) => !have.has(r));
    if (!missing.length) { alreadyComplete += 1; continue; }
    grants.push({ id: String(m.id), missing });
  }
  return { grants, skippedBots, cannotView, alreadyComplete, wanted };
}
