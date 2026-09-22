'use strict';

const { ACADEMY_HUBS } = require('./commands');

const DISCORD_API = 'https://discord.com/api/v10';
const ACADEMY_BANNER_URL = 'https://sml-platform-api.onrender.com/academy-activity/assets/mem-academy-banner.gif?v=20260922-2';

function launcher(hub) {
  const isBriefing = hub.command === 'briefing';
  const toolButtons = Array.isArray(hub.tools) ? hub.tools.slice(0, 5).map((tool) => ({
    type: 2,
    style: 2,
    label: tool.label,
    ...(tool.emoji ? { emoji: { name: tool.emoji } } : {}),
    custom_id: `academy:hub:${tool.command}`
  })) : [];
  const components = [{ type: 1, components: [{ type: 2, style: isBriefing ? 3 : 1, label: hub.button, custom_id: `academy:hub:${hub.command}` }] }];
  if (toolButtons.length) components.push({ type: 1, components: toolButtons });
  const academyCard = {
    color: hub.color,
    title: hub.title,
    description: `${hub.topic}\n\n**One click. No slash command. No public student data.**`,
    fields: isBriefing ? [
      { name: '🎯 Daily action', value: 'One realistic step for saving, cash flow, debt awareness, portfolio funding, risk, or trading discipline.' },
      { name: '🧰 Built for real life', value: 'Small enough for an average person to complete today. You never need to post your income, balances, or account numbers.' },
      { name: '🔒 Private', value: 'Your generated briefing is visible only to you.' }
    ] : hub.command === 'lesson' ? [
      { name: '🎓 Core curriculum', value: '101 lessons across 28 modules with the live chart and interactive simulations.' },
      { name: '🧠 Practice tools', value: 'Glossary · Flashcards · Private Quiz · Daily Chart Challenge · Market Replay' },
      { name: '🔒 One channel, private work', value: 'Choose a button below. Your tool response, answers, and results are visible only to you.' }
    ] : [
      { name: '🎓 Curriculum', value: '101 lessons across 28 modules', inline: true },
      { name: '🔒 Privacy', value: 'Your response is visible only to you', inline: true },
      { name: '⚡ Included', value: 'Quizzes · Flashcards · Challenges · Progress · Badges · Discipline · Replays · Glossary · Leaderboard' }
    ],
    footer: { text: 'Educational only · Not financial advice' }
  };
  return {
    content: '',
    // Discord renders embeds in order. Keep the wide animated Academy banner
    // above every channel-specific module card in the same pinned message.
    embeds: [{ color: hub.color, image: { url: ACADEMY_BANNER_URL } }, academyCard],
    components,
    allowed_mentions: { parse: [] }
  };
}

function createDiscordClient(token, fetchImpl = fetch) {
  return async function discord(path, { method = 'GET', body } = {}) {
    const response = await fetchImpl(`${DISCORD_API}${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const raw = await response.text();
    const payload = raw ? JSON.parse(raw) : null;
    if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${raw.slice(0, 500)}`);
    return payload;
  };
}

async function findLauncher(discord, channelId, command) {
  const messages = await discord(`/channels/${channelId}/messages?limit=50`);
  return messages.find((message) => message.author?.bot && message.components?.some((row) => row.components?.some((item) => item.custom_id === `academy:hub:${command}`))) || null;
}

async function publishAcademyHubs({ token, guildId, categoryId, apply = true, hubs = ACADEMY_HUBS, fetchImpl } = {}) {
  token = String(token || '').trim();
  guildId = String(guildId || '').trim();
  categoryId = String(categoryId || '').trim();
  if (!token || !/^\d{15,24}$/.test(guildId) || !/^\d{15,24}$/.test(categoryId)) {
    throw new Error('SML_ACADEMY_BOT_TOKEN, SML_ACADEMY_GUILD_ID, and SML_ACADEMY_CATEGORY_ID are required');
  }

  const discord = createDiscordClient(token, fetchImpl);
  const channels = await discord(`/guilds/${guildId}/channels`);
  const operations = [];
  // The daily briefing is the Academy's primary entry point, so publish it
  // first. A permissions problem in an unrelated legacy channel cannot stop
  // the simplified experience from reaching members.
  const orderedHubs = [...hubs].sort((left, right) => Number(right.command === 'briefing') - Number(left.command === 'briefing'));
  for (const hub of orderedHubs) {
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

    const existing = await findLauncher(discord, channel.id, hub.command);
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
  return { applied: apply, guildId, categoryId, operations };
}

module.exports = { ACADEMY_BANNER_URL, launcher, createDiscordClient, findLauncher, publishAcademyHubs };
