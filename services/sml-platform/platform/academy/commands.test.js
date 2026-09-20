'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcademyCommands } = require('./commands');

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
