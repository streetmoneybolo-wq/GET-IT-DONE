'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ACADEMY_BANNER_FILE, bannerUpload, launcher, publishAcademyHubs } = require('./hub-publisher');

const briefing = {
  command: 'briefing', channelId: '1551147441993285692', channel: '🧭｜daily-financial-briefing',
  title: '🧭 Daily Financial Freedom Briefing', button: 'Generate My Daily Goal', color: 0x00d084,
  topic: 'A practical private daily action.'
};

test('briefing launcher is private, practical, and one click', () => {
  const payload = launcher(briefing);
  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].title, briefing.title);
  assert.equal(payload.components[0].components[0].custom_id, 'academy:hub:briefing');
  assert.equal(payload.components[0].components[0].style, 3);
  assert.match(payload.embeds[0].description, /NEXT LEVEL STARTS NOW/);
  assert.match(payload.embeds[0].fields.map((field) => field.value).join(' '), /average person/i);
  assert.match(payload.embeds[0].fields.map((field) => field.value).join(' '), /stay private/i);
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
  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].fields.map((field) => `${field.name} ${field.value}`).join(' '), /101 LESSONS/);
});

test('banner is a separate animated GIF upload', () => {
  const payload = bannerUpload();
  assert.equal(payload.file.filename, ACADEMY_BANNER_FILE);
  assert.equal(payload.file.contentType, 'image/gif');
  assert.equal(payload.body.attachments[0].filename, ACADEMY_BANNER_FILE);
});

test('publisher reuses the fixed briefing channel and pins its launcher', async () => {
  const calls = [];
  let messagePosts = 0;
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname + new URL(url).search;
    const multipart = options.body instanceof FormData;
    const body = multipart ? JSON.parse(options.body.get('payload_json')) : options.body ? JSON.parse(options.body) : null;
    const file = multipart ? options.body.get('files[0]') : null;
    calls.push({ path, method: options.method || 'GET', body, multipart, filename: file?.name || null });
    let payload;
    if (path === '/api/v10/guilds/938894329076940820/channels') payload = [{ id: briefing.channelId, name: 'old-name', topic: '', parent_id: '1551147000000000000' }];
    else if (path === `/api/v10/channels/${briefing.channelId}`) payload = { id: briefing.channelId, name: briefing.channel, topic: briefing.topic, parent_id: '1551147999999999999' };
    else if (path.includes('/messages?limit=50')) payload = [];
    else if (path.endsWith('/messages')) payload = { id: String(1551147555555555555n + BigInt(messagePosts++)), author: { bot: true } };
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
  const posts = calls.filter((call) => call.path.endsWith('/messages') && call.method === 'POST');
  assert.equal(posts.length, 2);
  assert.equal(posts[0].multipart, true);
  assert.equal(posts[0].filename, ACADEMY_BANNER_FILE);
  assert.equal(posts[1].multipart, false);
  assert.equal(calls.filter((call) => call.path.includes('/pins/') && call.method === 'PUT').length, 2);
});
