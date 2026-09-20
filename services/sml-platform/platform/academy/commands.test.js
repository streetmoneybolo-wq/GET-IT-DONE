'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcademyCommands } = require('./commands');
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
  assert.match(allowed.response.data.content, /Launch the Academy activity/);
});

test('Academy publishes a complete 26-lesson college-level curriculum', () => {
  assert.equal(SEED_LESSONS.length, 26);
  assert.equal(new Set(SEED_LESSONS.map((lesson) => `${lesson.moduleId}:${lesson.lessonId}`)).size, 26);
  assert.deepEqual([...new Set(SEED_LESSONS.map((lesson) => lesson.moduleId))], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  for (const entry of SEED_LESSONS) {
    assert.equal(entry.steps.length, 3);
    assert.match(entry.steps[2], /lab:/i);
    assert.equal(Object.keys(entry.question.options).length, 4);
    assert.ok(entry.question.options[entry.question.correct]);
  }
});
