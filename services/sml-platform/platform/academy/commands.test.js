'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ACADEMY_HUBS, ENTRY_POINT_COMMAND, createAcademyCommands } = require('./commands');
const { SEED_LESSONS } = require('./curriculum');

const GUILD = '938894329076940820';
const MONARCH = '1260433215189946420';
const USER = '123456789012345678';

function interaction(name, data = {}) {
  return { type: 2, guild_id: GUILD, member: { user: { id: USER }, roles: [MONARCH], permissions: '0' }, data: { name, ...data } };
}

function component(custom_id) {
  return { type: 3, guild_id: GUILD, member: { user: { id: USER }, roles: [MONARCH], permissions: '0' }, data: { custom_id } };
}

function pool() {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(sql);
      if (sql.includes('academy_students') && sql.includes('RETURNING *')) return { rows: [{ id: 42, xp: 0, streak_days: 0 }], rowCount: 1 };
      if (sql.includes('RETURNING id')) return { rows: [{ id: 7 }], rowCount: 1 };
      if (sql.includes('RETURNING xp')) return { rows: [{ xp: 100 }], rowCount: 1 };
      if (sql.includes('RETURNING badge_key')) return { rows: [{ badge_key: 'first_lesson' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }
  };
}

test('a correct Academy answer completes the lesson once and awards progress', async () => {
  const db = pool();
  const academy = createAcademyCommands({ pool: db, guildId: GUILD, monarchRoleId: MONARCH, enabled: true });
  const result = await academy.handle(component('academy:answer:1:1:B'));
  assert.match(result.response.data.content, /Lesson completed/);
  assert.match(result.response.data.content, /\+100 XP/);
  assert.ok(db.calls.some((sql) => sql.includes('academy_progress') && sql.includes('completed_at')));
  assert.ok(db.calls.some((sql) => sql.includes('academy_badges')));
});

test('Academy controls remain private to the configured Monarch preview role', async () => {
  const academy = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true });
  const denied = await academy.handle({ type: 2, guild_id: GUILD, member: { user: { id: USER }, roles: [], permissions: '0' }, data: { name: 'academy' } });
  assert.match(denied.response.data.content, /not available/);
  const allowed = await academy.handle(interaction('academy'));
  assert.match(allowed.response.data.content, /dedicated Academy channels/);
  assert.match(allowed.response.data.content, /101 interactive/);
  assert.match(allowed.response.data.content, /28 modules/);
});

test('all dedicated channel launchers work for members and remain ephemeral', async () => {
  const academy = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true, now: () => Date.UTC(2026, 8, 21) });
  assert.equal(ACADEMY_HUBS.length, 12);
  assert.equal(new Set(ACADEMY_HUBS.map((hub) => hub.command)).size, 12);
  for (const hub of ACADEMY_HUBS) {
    const input = { type: 3, guild_id: GUILD, member: { user: { id: USER }, roles: [], permissions: '0' }, data: { custom_id: `academy:hub:${hub.command}` } };
    const result = await academy.handle(input);
    assert.equal(result.response.data.flags, 64, `${hub.command} response must be private`);
    assert.notEqual(result.response.data.content, 'This Academy control is no longer valid.');
    assert.notEqual(result.response.data.content, 'The Academy is not available in this server yet.');
  }
});

test('Academy exposes a Discord-managed Activity entry point', () => {
  assert.deepEqual(ENTRY_POINT_COMMAND, {
    name: 'launch',
    description: 'Open the interactive Making Easy Money Academy workspace',
    type: 4,
    handler: 2,
    integration_types: [0],
    contexts: [0]
  });
});

test('member cannot use restricted slash command just because channel launchers are enabled', async () => {
  const academy = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true });
  const denied = await academy.handle({ type: 2, guild_id: GUILD, member: { user: { id: USER }, roles: [], permissions: '0' }, data: { name: 'progress' } });
  assert.match(denied.response.data.content, /not available/);
});

test('Academy publishes a complete 101-lesson college-level curriculum', () => {
  assert.equal(SEED_LESSONS.length, 101);
  assert.equal(new Set(SEED_LESSONS.map((lesson) => `${lesson.moduleId}:${lesson.lessonId}`)).size, 101);
  assert.deepEqual([...new Set(SEED_LESSONS.map((lesson) => lesson.moduleId))], Array.from({ length: 28 }, (_, index) => index + 1));
  for (const entry of SEED_LESSONS) {
    assert.equal(entry.steps.length, 3);
    assert.match(entry.steps[2], /lab:/i);
    assert.equal(Object.keys(entry.question.options).length, 4);
    assert.ok(entry.question.options[entry.question.correct]);
    assert.ok(entry.simulation);
    assert.ok(entry.simulation.rounds.length >= 3);
  }
  assert.ok(SEED_LESSONS.find((entry) => entry.moduleId === 3 && entry.lessonId === 1).simulation.rounds.length > 50);
  assert.match(SEED_LESSONS.find((entry) => entry.moduleId === 9 && entry.lessonId === 1).steps.join(' '), /cash-secured puts/i);
  assert.match(SEED_LESSONS.find((entry) => entry.moduleId === 10 && entry.lessonId === 1).title, /Read the Tape/i);
  assert.match(SEED_LESSONS.find((entry) => entry.moduleId === 11 && entry.lessonId === 2).title, /Grandmaster-Obi/i);
  assert.match(SEED_LESSONS.find((entry) => entry.moduleId === 17 && entry.lessonId === 4).title, /Regression/i);
  assert.match(SEED_LESSONS.find((entry) => entry.moduleId === 22 && entry.lessonId === 2).title, /Duration/i);
  assert.match(SEED_LESSONS.find((entry) => entry.moduleId === 28 && entry.lessonId === 5).title, /Capstone/i);
});

test('all 28 modules can be selected from lesson and quiz commands', () => {
  const academy = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true });
  for (const commandName of ['lesson', 'quiz']) {
    const definition = academy.definitions.find((entry) => entry.name === commandName);
    const moduleOption = definition.options.find((entry) => entry.name === 'module');
    assert.equal(moduleOption.max_value, 28);
  }
});

test('every registered Academy command returns working content instead of a roadmap placeholder', async () => {
  const db = pool();
  const academy = createAcademyCommands({ pool: db, guildId: GUILD, monarchRoleId: MONARCH, enabled: true, now: () => Date.UTC(2026, 8, 20) });
  const cases = [
    interaction('glossary', { options: [{ name: 'term', value: 'VWAP' }] }),
    interaction('flashcard', { options: [{ name: 'topic', value: 'tape reading' }] }),
    interaction('quiz', { options: [{ name: 'module', value: 28 }] }),
    interaction('challenge'),
    interaction('discipline'),
    interaction('replay', { options: [{ name: 'scenario', value: 'breakout' }] })
  ];
  for (const input of cases) {
    const result = await academy.handle(input);
    assert.ok(result.response.data.content.length > 20);
    assert.doesNotMatch(result.response.data.content, /roadmap|being added|unlock after/i);
  }
});

test('flashcards reveal a real lesson and the leaderboard protects Discord identities', async () => {
  const db = pool();
  const academy = createAcademyCommands({ pool: db, guildId: GUILD, monarchRoleId: MONARCH, enabled: true });
  const flash = await academy.handle(component('academy:flash:10:1'));
  assert.match(flash.response.data.embeds[0].description, /Key principle/);

  db.query = async (sql) => {
    if (sql.includes('FROM academy_students')) return { rows: [{ discord_id: USER, xp: 800, streak_days: 4 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  const leaders = await academy.handle(interaction('leaderboard'));
  assert.match(leaders.response.data.content, /800 XP/);
  assert.match(leaders.response.data.content, new RegExp(USER.slice(-4)));
  assert.doesNotMatch(leaders.response.data.content, new RegExp(USER));
});
