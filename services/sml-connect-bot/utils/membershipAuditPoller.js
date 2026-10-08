import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readSettings } from './storage.js';

const stateFile = 'data/membership-lifecycle-audit-state.json';
const ACTION_MEMBER_ROLE_UPDATE = 25;
let started = false;

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function discord(pathname) {
  const response = await fetch(`https://discord.com/api/v10${pathname}`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || ''}` },
  });
  const body = await response.text();
  let json = null;
  try { json = body ? JSON.parse(body) : null; } catch {}
  if (!response.ok) throw new Error(`Discord GET ${pathname} failed ${response.status}: ${body.slice(0, 240)}`);
  return json;
}

function roleLookup(settings) {
  return new Map((settings.membershipLifecycle?.membershipRoles || [])
    .filter((role) => role?.id && role?.label)
    .map((role) => [String(role.id), String(role.label)]));
}

function changedRoles(entry, key) {
  const change = (entry.changes || []).find((item) => item.key === key);
  return Array.isArray(change?.new_value) ? change.new_value : [];
}

async function send(client, channelId, content) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  await channel.send({ content, allowedMentions: { users: [] } });
  return true;
}

function userLabel(users, id) {
  const user = (users || []).find((item) => String(item.id) === String(id));
  if (!user) return `<@${id}> / \`${id}\``;
  return `${user.global_name || user.username || 'Member'} (<@${id}> / \`${id}\`)`;
}

function executorLabel(users, id) {
  const user = (users || []).find((item) => String(item.id) === String(id));
  if (!user) return id ? `<@${id}>` : 'Unknown';
  return user.global_name || user.username || id;
}

async function pollOnce(client, firstRun = false) {
  const settings = await readSettings();
  const cfg = settings.membershipLifecycle || {};
  if (!cfg.enabled || !cfg.guildId) return { skipped: true };
  const roles = roleLookup(settings);
  if (!roles.size) return { skipped: true };

  const state = await readJson(stateFile, { seen: {} });
  state.seen ||= {};
  state.seen[cfg.guildId] ||= {};

  const audit = await discord(`/guilds/${cfg.guildId}/audit-logs?action_type=${ACTION_MEMBER_ROLE_UPDATE}&limit=50`);
  const entries = Array.isArray(audit.audit_log_entries) ? audit.audit_log_entries : [];
  const newestFirst = entries.sort((a, b) => BigInt(b.id) > BigInt(a.id) ? 1 : -1);
  let posted = 0;
  let marked = 0;

  for (const entry of newestFirst.reverse()) {
    if (state.seen[cfg.guildId][entry.id]) continue;
    const added = changedRoles(entry, '$add').filter((role) => roles.has(String(role.id)));
    const removed = changedRoles(entry, '$remove').filter((role) => roles.has(String(role.id)));
    state.seen[cfg.guildId][entry.id] = new Date().toISOString();
    marked += 1;
    if (firstRun) continue;

    for (const role of added) {
      await send(client, cfg.channels?.newSignups, [
        '💳 **New Membership / Signup**',
        `Member: ${userLabel(audit.users, entry.target_id)}`,
        `Membership: **${roles.get(String(role.id)) || role.name || 'Membership'}**`,
        `Role: <@&${role.id}>`,
        `Added by: ${executorLabel(audit.users, entry.user_id)}`,
        `Time: <t:${Math.floor(Date.now() / 1000)}:F>`,
      ].join('\n'));
      posted += 1;
    }
    for (const role of removed) {
      await send(client, cfg.channels?.canceledRoleRemoved, [
        '🔴 **Membership Role Removed / Canceled Access**',
        `Member: ${userLabel(audit.users, entry.target_id)}`,
        `Membership: **${roles.get(String(role.id)) || role.name || 'Membership'}**`,
        `Role removed: <@&${role.id}>`,
        `Removed by: ${executorLabel(audit.users, entry.user_id)}`,
        `Time: <t:${Math.floor(Date.now() / 1000)}:F>`,
      ].join('\n'));
      posted += 1;
    }
  }

  // Keep state compact.
  const seenEntries = Object.entries(state.seen[cfg.guildId]);
  if (seenEntries.length > 500) {
    state.seen[cfg.guildId] = Object.fromEntries(seenEntries.slice(-500));
  }
  await writeJson(stateFile, state);
  return { marked, posted };
}

export function startMembershipAuditPoller(client, intervalSeconds = 45) {
  if (started) return;
  started = true;
  pollOnce(client, true)
    .then((result) => console.log(`Membership audit watcher primed: ${result.marked || 0} recent role-change entries marked seen.`))
    .catch((error) => console.error('Membership audit watcher prime failed safely:', error.message || error));
  setInterval(() => {
    pollOnce(client, false)
      .then((result) => {
        if (result.posted) console.log(`Membership audit watcher posted ${result.posted} lifecycle events.`);
      })
      .catch((error) => console.error('Membership audit watcher failed safely:', error.message || error));
  }, Math.max(15, Number(intervalSeconds) || 45) * 1000);
}
