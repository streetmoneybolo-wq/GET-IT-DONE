'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcademyProgress } = require('./academy-progress');

function fakePool() {
  const calls = [];
  return { calls, query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('INSERT INTO academy_students')) return { rows: [{ id: 7 }], rowCount: 1 };
    if (sql.includes('SELECT module_id')) return { rows: [{ module_id: 10, lesson_id: 1, score: 83, completed_at: '2026-09-20', started_at: '2026-09-20' }] };
    return { rows: [{ module_id: params[1], lesson_id: params[2], score: params[3], completed_at: params[3] >= 70 ? '2026-09-20' : null }], rowCount: 1 };
  } };
}

test('Academy simulation progress is isolated by authenticated Discord user', async () => {
  const pool = fakePool();
  const progress = createAcademyProgress({ pool, guildId: '123456789012345678' });
  assert.deepEqual(await progress.save('987654321098765432', { moduleId: 10, lessonId: 1, score: 83 }), { moduleId: 10, lessonId: 1, score: 83, completed: true });
  assert.deepEqual(await progress.read('987654321098765432'), [{ moduleId: 10, lessonId: 1, score: 83, completed: true, startedAt: '2026-09-20', completedAt: '2026-09-20' }]);
  assert.equal(pool.calls[0].params[1], '987654321098765432');
});

test('Academy simulation progress rejects malformed scores and users', async () => {
  const progress = createAcademyProgress({ pool: fakePool(), guildId: '123456789012345678' });
  await assert.rejects(progress.save('bad', { moduleId: 1, lessonId: 1, score: 80 }), /invalid_user/);
  await assert.rejects(progress.save('987654321098765432', { moduleId: 1, lessonId: 1, score: 101 }), /invalid_score/);
});
