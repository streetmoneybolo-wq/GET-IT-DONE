'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ACADEMY_HUBS, TEXT_LESSON_ID } = require('./commands');

const DISCORD_API = 'https://discord.com/api/v10';
const ACADEMY_BANNER_FILE = 'making-easy-money-academy.gif';
const ACADEMY_BANNER_PATH = path.join(__dirname, '..', 'assets', 'mem-academy-banner.gif');

function launcher(hub) {
  const isBriefing = hub.command === 'briefing';
  const toolButtons = Array.isArray(hub.tools) ? hub.tools.slice(0, 5).map((tool) => ({
    type: 2,
    style: 2,
    label: tool.label,
    ...(tool.emoji ? { emoji: { name: tool.emoji } } : {}),
    custom_id: `academy:hub:${tool.command}`
  })) : [];
  const primary = [{ type: 2, style: isBriefing ? 3 : 1, label: hub.button, custom_id: `academy:hub:${hub.command}` }];
  // The lesson launcher opens the Activity (LAUNCH_ACTIVITY). Discord clients
  // that cannot run Activities still get the same lesson as a private card.
  if (hub.command === 'lesson') primary.push({ type: 2, style: 2, label: 'Text Lesson', emoji: { name: '📄' }, custom_id: TEXT_LESSON_ID });
  const components = [{ type: 1, components: primary }];
  if (toolButtons.length) components.push({ type: 1, components: toolButtons });
  const academyCard = {
    color: hub.color,
    title: hub.title,
    description: `**⚡ YOUR NEXT LEVEL STARTS NOW**\n${hub.topic}\n\n**Pick one action. Practice the skill. Track the progress. Come back sharper.**`,
    fields: isBriefing ? [
      { name: '🎯 TODAY\'S MONEY MOVE', value: 'Get one realistic action for saving, cash flow, debt awareness, portfolio funding, risk, or trading discipline.' },
      { name: '💵 SMALL ACTION. REAL MOMENTUM.', value: 'Complete a practical step today that an average person can actually repeat tomorrow.' },
      { name: '🔒 BUILT FOR YOU', value: 'Your generated briefing and financial details stay private.' }
    ] : hub.command === 'lesson' ? [
      { name: '🎓 101 LESSONS. 28 MODULES. ONE MISSION.', value: 'Build the knowledge, discipline, and decision-making process of a stronger trader.' },
      { name: '📈 TRAIN WITH THE MARKET', value: 'Live charts · Interactive simulations · Market replay · Daily chart challenges' },
      { name: '🧠 TEST YOUR EDGE', value: 'Glossary · Flashcards · Private quizzes · Progress that moves at your pace' }
    ] : [
      { name: '🚀 KEEP BUILDING', value: '101 college-level lessons across 28 focused modules', inline: true },
      { name: '🔒 YOUR PRIVATE WORKSPACE', value: 'Your personal results are visible only to you', inline: true },
      { name: '⚡ EVERYTHING WORKS TOGETHER', value: 'Quizzes · Flashcards · Challenges · Progress · Badges · Discipline · Replays · Glossary · Leaderboard' }
    ],
    footer: { text: 'Educational only · Not financial advice' }
  };
  return {
    content: '',
    embeds: [academyCard],
    components,
    allowed_mentions: { parse: [] }
  };
}

function bannerUpload() {
  return {
    body: {
      content: '',
      attachments: [{ id: 0, filename: ACADEMY_BANNER_FILE, description: 'Making Easy Money Academy animated banner' }],
      allowed_mentions: { parse: [] }
    },
    file: { path: ACADEMY_BANNER_PATH, filename: ACADEMY_BANNER_FILE, contentType: 'image/gif' }
  };
}

function createDiscordClient(token, fetchImpl = fetch) {
  return async function discord(path, { method = 'GET', body, file } = {}) {
    let requestBody;
    let headers = { Authorization: `Bot ${token}` };
    if (file) {
      const form = new FormData();
      form.append('payload_json', JSON.stringify(body || {}));
      form.append('files[0]', new Blob([fs.readFileSync(file.path)], { type: file.contentType }), file.filename);
      requestBody = form;
    } else if (body) {
      headers = { ...headers, 'Content-Type': 'application/json' };
      requestBody = JSON.stringify(body);
    }
    const response = await fetchImpl(`${DISCORD_API}${path}`, {
      method,
      headers,
      body: requestBody
    });
    const raw = await response.text();
    const payload = raw ? JSON.parse(raw) : null;
    if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${raw.slice(0, 500)}`);
    return payload;
  };
}

async function findBanner(discord, channelId) {
  const messages = await discord(`/channels/${channelId}/messages?limit=50`);
  return messages.find((message) => message.author?.bot && message.attachments?.some((attachment) => attachment.filename === ACADEMY_BANNER_FILE)) || null;
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

    let existing = await findLauncher(discord, channel.id, hub.command);
    let banner = await findBanner(discord, channel.id);
    if (!banner) {
      banner = await discord(`/channels/${channel.id}/messages`, { method: 'POST', ...bannerUpload() });
      // During the one-time migration, recreate the launcher after the banner
      // so Discord displays two distinct posts in the requested visual order.
      if (existing) {
        await discord(`/channels/${channel.id}/messages/${existing.id}`, { method: 'DELETE' });
        existing = null;
      }
    }
    const message = existing
      ? await discord(`/channels/${channel.id}/messages/${existing.id}`, { method: 'PATCH', body: launcher(hub) })
      : await discord(`/channels/${channel.id}/messages`, { method: 'POST', body: launcher(hub) });
    try {
      await discord(`/channels/${channel.id}/pins/${banner.id}`, { method: 'PUT' });
      await discord(`/channels/${channel.id}/pins/${message.id}`, { method: 'PUT' });
    } catch (error) {
      operations[operations.length - 1].pinWarning = error.message;
    }
    operations[operations.length - 1].channelId = channel.id;
    operations[operations.length - 1].bannerMessageId = banner.id;
    operations[operations.length - 1].messageId = message.id;
  }
  return { applied: apply, guildId, categoryId, operations };
}

module.exports = { ACADEMY_BANNER_FILE, bannerUpload, launcher, createDiscordClient, findBanner, findLauncher, publishAcademyHubs };
