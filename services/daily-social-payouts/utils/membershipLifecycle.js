function configured(settings, guildId) {
  const cfg = settings.membershipLifecycle || {};
  if (!cfg.enabled || String(cfg.guildId || '') !== String(guildId || '')) return null;
  return cfg;
}

function cleanRoles(member) {
  return new Set([...member?.roles?.cache?.keys?.() || []].map(String));
}

function roleMap(settings) {
  return new Map((settings.membershipLifecycle?.membershipRoles || [])
    .filter((role) => role?.id && role?.label)
    .map((role) => [String(role.id), String(role.label)]));
}

function userLine(userOrMember) {
  const user = userOrMember?.user || userOrMember;
  const id = user?.id || userOrMember?.id || '';
  const name = user?.globalName || user?.username || userOrMember?.displayName || 'Unknown member';
  return id ? `${name} (<@${id}> / \`${id}\`)` : name;
}

async function sendLog(client, channelId, content) {
  if (!channelId) return false;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  await channel.send({ content, allowedMentions: { users: [] } });
  return true;
}

export async function logNewMember(member, settings) {
  const cfg = configured(settings, member?.guild?.id);
  if (!cfg?.channels?.newMembers) return false;
  return sendLog(member.client, cfg.channels.newMembers, [
    '🟢 **New Member Joined**',
    `Member: ${userLine(member)}`,
    `Server: **${member.guild.name}**`,
    `Joined: <t:${Math.floor(Date.now() / 1000)}:F>`,
  ].join('\n'));
}

export async function logMembershipRoleChanges(previousMember, currentMember, settings) {
  const cfg = configured(settings, currentMember?.guild?.id);
  if (!cfg) return { skipped: true };
  const memberships = roleMap(settings);
  if (!memberships.size) return { skipped: true };
  const before = cleanRoles(previousMember);
  const after = cleanRoles(currentMember);
  const added = [];
  const removed = [];
  for (const [roleId, label] of memberships.entries()) {
    if (!before.has(roleId) && after.has(roleId)) added.push({ roleId, label });
    if (before.has(roleId) && !after.has(roleId)) removed.push({ roleId, label });
  }
  for (const role of added) {
    await sendLog(currentMember.client, cfg.channels?.newSignups, [
      '💳 **New Membership / Signup**',
      `Member: ${userLine(currentMember)}`,
      `Membership: **${role.label}**`,
      `Role: <@&${role.roleId}>`,
      `Time: <t:${Math.floor(Date.now() / 1000)}:F>`,
    ].join('\n'));
  }
  for (const role of removed) {
    await sendLog(currentMember.client, cfg.channels?.canceledRoleRemoved, [
      '🔴 **Membership Role Removed / Canceled Access**',
      `Member: ${userLine(currentMember)}`,
      `Membership: **${role.label}**`,
      `Role removed: <@&${role.roleId}>`,
      `Time: <t:${Math.floor(Date.now() / 1000)}:F>`,
    ].join('\n'));
  }
  return { added: added.length, removed: removed.length };
}

export async function logMemberLeft(member, settings) {
  const cfg = configured(settings, member?.guild?.id);
  if (!cfg?.channels?.canceledRoleRemoved) return false;
  const memberships = roleMap(settings);
  const held = [...cleanRoles(member)]
    .filter((roleId) => memberships.has(roleId))
    .map((roleId) => memberships.get(roleId));
  return sendLog(member.client, cfg.channels.canceledRoleRemoved, [
    '🚪 **Member Left Server**',
    `Member: ${userLine(member)}`,
    held.length ? `Membership roles held: **${held.join(', ')}**` : 'Membership roles held: none detected',
    `Time: <t:${Math.floor(Date.now() / 1000)}:F>`,
  ].join('\n'));
}
