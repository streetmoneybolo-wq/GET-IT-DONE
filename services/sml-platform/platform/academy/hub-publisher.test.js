'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ACADEMY_BANNER_URL, launcher, publishAcademyHubs } = require('./hub-publisher');

const briefing = {
  command: 'briefing', channelId: '1551147441993285692', channel: '🧭｜daily-financial-briefing',
  title: '🧭 Daily Financial Freedom Briefing', button: 'Generate My Daily Goal', color: 0x00d084,
  topic: 'A practical private daily action.'
};

test('briefing launcher is private, practical, and one click', () => {
  const payload = launcher(briefing);
  assert.equal(payload.embeds[0].image.url, ACADEMY_BANNER_URL);
  assert.equal(payload.embeds[1].title, briefing.title);
  assert.equal(payload.components[0].components[0].custom_id, 'academy:hub:briefing');
  assert.equal(payload.components[0].components[0].style, 3);
  assert.match(payload.embeds[1].description, /One click/);
  assert.match(payload.embeds[1].fields.map((field) => field.value).join(' '), /average person/i);
  assert.match(payload.embeds[1].fields.map((field) => field.value).join(' '), /visible only to you/i);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
});

test('lesson launcher consolidates all five learning tools into one channel', () => {
  const hub = {
    command: 'lesson', channel: '📚｜academy-lessons-live-chart', title: 'Academy Learning Lab',
    button: 'Open My Next Lesson', color: 0x5865f2, topic: 'One learning channel.',
    tools: [
      { command: 'glossary', label: 'Trading Glossary', emoji: '📖' },
      { command: 'flashcard', label: 'Flashcards', emoji: '🧠' },
      { command: 'quiz', label: 'Quiz', emoji: '📝' },
      { command: 'challenge', label: 'Chart Challenge', emoji: '📊' },
      { command: 'replay', label: 'Market Replay', emoji: '⏪' }
    ]
  };
  const payload = launcher(hub);
  assert.equal(payload.components.length, 2);
  assert.deepEqual(payload.components[1].components.map((item) => item.custom_id), [
    'academy:hub:glossary', 'academy:hub:flashcard', 'academy:hub:quiz',
    'academy:hub:challenge', 'academy:hub:replay'
  ]);
  assert.equal(payload.embeds[0].image.url, ACADEMY_BANNER_URL);
  assert.match(payload.embeds[1].fields.map((field) => field.value).join(' '), /visible only to you/i);
});

test('publisher reuses the fixed briefing channel and pins its launcher', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname + new URL(url).search;
    calls.push({ path, method: options.method || 'GET', body: options.body && JSON.parse(options.body) });
    let payload;
    if (path === '/api/v10/guilds/938894329076940820/channels') payload = [{ id: briefing.channelId, name: 'old-name', topic: '', parent_id: '1551147000000000000' }];
    else if (path === `/api/v10/channels/${briefing.channelId}`) payload = { id: briefing.channelId, name: briefing.channel, topic: briefing.topic, parent_id: '1551147999999999999' };
    else if (path.includes('/messages?limit=50')) payload = [];
    else if (path.endsWith('/messages')) payload = { id: '1551147555555555555', author: { bot: true } };
    else payload = null;
    return { ok: true, status: 200, text: async () => payload == null ? '' : JSON.stringify(payload) };
  };

  const result = await publishAcademyHubs({
    token: 'test-token', guildId: '938894329076940820', categoryId: '1551147999999999999',
    hubs: [briefing], fetchImpl
  });

  assert.equal(result.operations[0].action, 'update');
  assert.equal(result.operations[0].channelId, briefing.channelId);
  assert.equal(calls.some((call) => call.path === `/api/v10/channels/${briefing.channelId}` && call.method === 'PATCH'), true);
  assert.equal(calls.some((call) => call.path.endsWith('/messages') && call.method === 'POST'), true);
  assert.equal(calls.some((call) => call.path.includes('/pins/') && call.method === 'PUT'), true);
});
