'use strict';

const { ACADEMY_HUBS } = require('../platform/academy/commands');

const API = 'https://discord.com/api/v10';
const apply = process.argv.includes('--apply');
const token = String(process.env.SML_ACADEMY_BOT_TOKEN || process.env.DISCORD_ACADEMY_BOT_TOKEN || '').trim();
const guildId = String(process.env.SML_ACADEMY_GUILD_ID || process.env.SML_DISCORD_GUILD_ID || '').trim();
const categoryId = String(process.env.SML_ACADEMY_CATEGORY_ID || '').trim();

if (!token || !/^\d{15,24}$/.test(guildId) || !/^\d{15,24}$/.test(categoryId)) {
  throw new Error('SML_ACADEMY_BOT_TOKEN, SML_ACADEMY_GUILD_ID, and SML_ACADEMY_CATEGORY_ID are required');
}

async function discord(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bot ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) : null;
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${raw.slice(0, 500)}`);
  return payload;
}

function launcher(hub) {
  return {
    content: '',
    embeds: [{
      color: hub.color,
      title: hub.title,
      description: `${hub.topic}\n\n**One click. No slash command. No public student data.**`,
      fields: [
        { name: '🎓 Curriculum', value: '101 lessons across 28 modules', inline: true },
        { name: '🔒 Privacy', value: 'Your response is visible only to you', inline: true },
        { name: '⚡ Included', value: 'Quizzes · Flashcards · Challenges · Progress · Badges · Discipline · Replays · Glossary · Leaderboard' }
      ],
      footer: { text: 'Educational only · Not financial advice' }
    }],
    components: [{ type: 1, components: [{ type: 2, style: 1, label: hub.button, custom_id: `academy:hub:${hub.command}` }] }],
    allowed_mentions: { parse: [] }
  };
}

async function findLauncher(channelId, command) {
  const messages = await discord(`/channels/${channelId}/messages?limit=50`);
  return messages.find((message) => message.author?.bot && message.components?.some((row) => row.components?.some((item) => item.custom_id === `academy:hub:${command}`))) || null;
}

async function main() {
  const channels = await discord(`/guilds/${guildId}/channels`);
  const operations = [];
  for (const hub of ACADEMY_HUBS) {
    // A pinned channel id lets a renamed launcher keep its history and
    // permissions instead of creating a duplicate channel.
    let channel = (hub.channelId && channels.find((entry) => entry.id === hub.channelId))
      || channels.find((entry) => entry.parent_id === categoryId && entry.name === hub.channel);
    operations.push({ command: hub.command, channel: hub.channel, action: channel ? 'update' : 'create' });
    if (!apply) continue;

    if (!channel) {
      channel = await discord(`/guilds/${guildId}/channels`, { method: 'POST', body: { name: hub.channel, type: 0, parent_id: categoryId, topic: hub.topic } });
      channels.push(channel);
    } else if (channel.topic !== hub.topic || channel.name !== hub.channel || channel.parent_id !== categoryId) {
      channel = await discord(`/channels/${channel.id}`, { method: 'PATCH', body: { name: hub.channel, topic: hub.topic, parent_id: categoryId } });
    }

    const existing = await findLauncher(channel.id, hub.command);
    const message = existing
      ? await discord(`/channels/${channel.id}/messages/${existing.id}`, { method: 'PATCH', body: launcher(hub) })
      : await discord(`/channels/${channel.id}/messages`, { method: 'POST', body: launcher(hub) });
    try {
      await discord(`/channels/${channel.id}/pins/${message.id}`, { method: 'PUT' });
    } catch (error) {
      operations[operations.length - 1].pinWarning = error.message;
    }
    operations[operations.length - 1].channelId = channel.id;
    operations[operations.length - 1].messageId = message.id;
  }
  process.stdout.write(`${JSON.stringify({ applied: apply, guildId, categoryId, operations }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
