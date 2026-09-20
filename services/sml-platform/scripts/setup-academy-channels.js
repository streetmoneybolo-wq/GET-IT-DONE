#!/usr/bin/env node
'use strict';

/* Permission-safe Academy channel setup. It is a dry run by default. `--apply`
 * is deliberately required because it creates a role and changes category ACLs. */
const token = String(process.env.SML_DISCORD_CONNECT_BOT_TOKEN || '').trim();
const guildId = String(process.env.SML_ACADEMY_GUILD_ID || '').trim();
const categoryId = String(process.env.SML_ACADEMY_CATEGORY_ID || '').trim();
const managerRoleId = String(process.env.SML_ACADEMY_MANAGER_ROLE_ID || '').trim();
const apply = process.argv.includes('--apply');
if (!token || !guildId || !categoryId || !managerRoleId) throw new Error('Academy Discord environment variables are required');
const plan = [
  ['academy-announcements', 'Academy module announcements and approved milestones.'],
  ['academy-lobby', 'Academy discussion, questions, and peer learning.'],
  ['start-here', 'Enrollment instructions and the /enroll command.'],
  ['lessons', 'Bot-led, original Academy lessons.'],
  ['chart-challenges', 'Manager-approved educational chart challenges.'],
  ['risk-calculator', 'Educational position-size and risk/reward tools.'],
  ['quiz-arena', 'Academy knowledge checks and quizzes.'],
  ['daily-discipline', 'Approved educational psychology lessons.'],
  ['achievements', 'Academy learning milestones and badges.'],
  ['academy-admin', 'Private Manager review and Academy publishing workflow.']
];
async function api(path, options = {}) {
  const response = await fetch(`https://discord.com/api/v10${path}`, { ...options, headers: { Authorization: `Bot ${token}`, 'content-type': 'application/json', ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} failed: ${response.status}`);
  return body;
}
(async () => {
  const roles = await api(`/guilds/${guildId}/roles`);
  const manager = roles.find((role) => role.id === managerRoleId);
  if (!manager) throw new Error('Configured Manager role does not exist');
  let academyRole = roles.find((role) => role.name === 'Academy Student');
  const existing = await api(`/guilds/${guildId}/channels`);
  const report = { dryRun: !apply, categoryId, managerRole: manager.name, role: academyRole?.id || 'would_create', channels: [] };
  if (!apply) { report.channels = plan.map(([name]) => ({ name, action: existing.some((channel) => channel.parent_id === categoryId && channel.name === name) ? 'keep' : 'create' })); console.log(JSON.stringify(report, null, 2)); return; }
  if (!academyRole) academyRole = await api(`/guilds/${guildId}/roles`, { method: 'POST', body: JSON.stringify({ name: 'Academy Student', mentionable: false, hoist: false }), headers: { 'X-Audit-Log-Reason': 'Create Making Easy Money Academy student role' } });
  const allowStudent = '68608'; // View Channel, Send Messages, Read Message History
  const managerAllow = '68608';
  const overwrites = [{ id: guildId, type: 0, allow: '0', deny: '1024' }, { id: academyRole.id, type: 0, allow: allowStudent, deny: '0' }, { id: managerRoleId, type: 0, allow: managerAllow, deny: '0' }];
  await api(`/channels/${categoryId}`, { method: 'PATCH', body: JSON.stringify({ permission_overwrites: overwrites }), headers: { 'X-Audit-Log-Reason': 'Configure Academy category access' } });
  for (const [name, topic] of plan) {
    if (existing.some((channel) => channel.parent_id === categoryId && channel.name === name)) { report.channels.push({ name, action: 'kept' }); continue; }
    const channel = await api(`/guilds/${guildId}/channels`, { method: 'POST', body: JSON.stringify({ name, type: 0, parent_id: categoryId, topic }), headers: { 'X-Audit-Log-Reason': 'Create Making Easy Money Academy channel' } });
    report.channels.push({ name, action: 'created', id: channel.id });
  }
  report.role = academyRole.id; report.dryRun = false; console.log(JSON.stringify(report, null, 2));
})().catch((error) => { console.error(error.message); process.exit(1); });
