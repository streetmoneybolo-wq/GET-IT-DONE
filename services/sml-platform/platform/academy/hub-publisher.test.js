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

test('lesson launcher opens the Activity and keeps a private text fallback beside it', () => {
  const { TEXT_LESSON_ID } = require('./commands');
  const hub = require('./commands').ACADEMY_HUBS.find((entry) => entry.command === 'lesson');
  const payload = launcher(hub);
  const primary = payload.components[0].components;
  assert.equal(primary[0].custom_id, 'academy:hub:lesson');
  assert.equal(primary[0].style, 1);
  assert.equal(primary[1].custom_id, TEXT_LESSON_ID);
  assert.equal(launcher({ ...hub, command: 'progress', tools: [] }).components[0].components.length, 1);
});

test('republishing an existing lesson hub edits its launcher in place (no duplicate posts)', async () => {
  const hub = require('./commands').ACADEMY_HUBS.find((entry) => entry.command === 'lesson');
  const categoryId = '1551147999999999999';
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname + new URL(url).search;
    calls.push({ path, method: options.method || 'GET' });
    let payload = null;
    if (path === '/api/v10/guilds/938894329076940820/channels') payload = [{ id: hub.channelId, name: hub.channel, topic: hub.topic, parent_id: categoryId }];
    else if (path.includes('/messages?limit=50')) payload = [
      { id: '1', author: { bot: true }, attachments: [{ filename: ACADEMY_BANNER_FILE }], components: [] },
      { id: '2', author: { bot: true }, attachments: [], components: [{ type: 1, components: [{ custom_id: 'academy:hub:lesson' }] }] }
    ];
    else if (path.endsWith('/messages/2')) payload = { id: '2' };
    return { ok: true, status: 200, text: async () => payload == null ? '' : JSON.stringify(payload) };
  };
  for (let run = 0; run < 2; run += 1) {
    await publishAcademyHubs({ token: 't', guildId: '938894329076940820', categoryId, hubs: [hub], fetchImpl });
  }
  assert.equal(calls.filter((call) => call.method === 'POST').length, 0);
  assert.equal(calls.filter((call) => call.method === 'DELETE').length, 0);
  assert.equal(calls.filter((call) => call.method === 'PATCH' && call.path.endsWith('/messages/2')).length, 2);
});
