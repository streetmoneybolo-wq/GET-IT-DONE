'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcademyProgress, nextLessonAfter } = require('./academy-progress');

/* In-memory stand-in for the three Academy tables, keyed exactly like the
 * real schema: students by (guild_id, discord_id), progress by
 * (student_id, module_id, lesson_id). */
function memoryPool() {
  const students = []; const progress = new Map(); const badges = new Set();
  return { students, async query(sql, params) {
    if (sql.includes('INSERT INTO academy_students')) {
      let row = students.find((entry) => entry.guild_id === params[0] && entry.discord_id === params[1]);
      if (!row) { row = { id: students.length + 1, guild_id: params[0], discord_id: params[1], current_module: 1, current_lesson: 1, xp: 0, streak_days: 0 }; students.push(row); }
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (sql.includes('SELECT module_id')) return { rows: [...progress.values()].filter((entry) => entry.student_id === params[0]), rowCount: 0 };
    if (sql.includes('INSERT INTO academy_progress')) {
      const key = params.slice(0, 3).join(':');
      const row = progress.get(key) || { student_id: params[0], module_id: params[1], lesson_id: params[2], score: 0, completed_at: null, started_at: 'now' };
      row.score = Math.max(row.score || 0, params[3]); progress.set(key, row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (sql.includes('UPDATE academy_progress')) {
      const row = progress.get(params.join(':'));
      if (!row || row.completed_at) return { rows: [], rowCount: 0 };
      row.completed_at = 'now'; return { rows: [{ id: 1 }], rowCount: 1 };
    }
    if (sql.includes('UPDATE academy_students')) {
      const row = students.find((entry) => entry.id === params[0]);
      row.xp += 100; row.current_module = params[1]; row.current_lesson = params[2];
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO academy_badges')) { badges.add(`${params[0]}:first_lesson`); return { rows: [], rowCount: 1 }; }
    if (sql.includes('FROM academy_badges')) return { rows: [...badges].filter((key) => key.startsWith(`${params[0]}:`)).map((key) => ({ badge_key: key.split(':')[1] })), rowCount: 0 };
    throw new Error(`unexpected SQL: ${sql}`);
  } };
}

const GUILD = '938894329076940820';
const A = '111111111111111111';
const B = '222222222222222222';

test('two members studying at once keep separate progress and resume points', async () => {
  const pool = memoryPool();
  const progress = createAcademyProgress({ pool, guildId: GUILD });
  await progress.save(A, { moduleId: 3, lessonId: 1, score: 90 });
  await progress.save(B, { moduleId: 1, lessonId: 1, score: 40 });
  assert.deepEqual((await progress.read(A)).map((row) => [row.moduleId, row.lessonId, row.completed]), [[3, 1, true]]);
  assert.deepEqual((await progress.read(B)).map((row) => [row.moduleId, row.lessonId, row.completed]), [[1, 1, false]]);
  const next = nextLessonAfter(3, 1);
  assert.deepEqual(await progress.state(A), { currentModule: next.moduleId, currentLesson: next.lessonId, xp: 100, streakDays: 0, badges: ['first_lesson'] });
  assert.deepEqual(await progress.state(B), { currentModule: 1, currentLesson: 1, xp: 0, streakDays: 0, badges: [] });
  assert.ok(pool.students.every((row) => row.guild_id === GUILD));
});

test('a returning member resumes after their last completion and earns XP only once', async () => {
  const progress = createAcademyProgress({ pool: memoryPool(), guildId: GUILD });
  assert.equal((await progress.save(A, { moduleId: 14, lessonId: 1, score: 85 })).completed, true);
  await progress.save(A, { moduleId: 14, lessonId: 1, score: 100 });
  const state = await progress.state(A);
  assert.equal(state.xp, 100);
  assert.deepEqual([state.currentModule, state.currentLesson], [nextLessonAfter(14, 1).moduleId, nextLessonAfter(14, 1).lessonId]);
});

test('modules 14-28 save like every other module', async () => {
  const progress = createAcademyProgress({ pool: memoryPool(), guildId: GUILD });
  assert.deepEqual(await progress.save(A, { moduleId: 28, lessonId: 5, score: 83 }), { moduleId: 28, lessonId: 5, score: 83, completed: true });
});

test('module 0 Start Here lessons save and resume like every other module', async () => {
  const pool = memoryPool();
  const progress = createAcademyProgress({ pool, guildId: GUILD });
  // The module bound used to start at 1, which rejected all 20 beginner
  // lessons with invalid_module and threw away the learner's score.
  assert.deepEqual(await progress.save(A, { moduleId: 0, lessonId: 1, score: 90 }), { moduleId: 0, lessonId: 1, score: 90, completed: true });
  assert.deepEqual((await progress.read(A)).map((row) => [row.moduleId, row.lessonId, row.completed]), [[0, 1, true]]);
  const next = nextLessonAfter(0, 1);
  assert.deepEqual([next.moduleId, next.lessonId], [0, 2], 'the first Start Here lesson leads to the second');
  const state = await progress.state(A);
  assert.deepEqual([state.currentModule, state.currentLesson], [0, 2]);
});

test('a student resting on module 0 is not bumped into module 1', async () => {
  const pool = memoryPool();
  const progress = createAcademyProgress({ pool, guildId: GUILD });
  await progress.state(A);
  // `Number(row.current_module || 1)` turned a genuine module 0 into module 1.
  pool.students[0].current_module = 0;
  pool.students[0].current_lesson = 7;
  const state = await progress.state(A);
  assert.deepEqual([state.currentModule, state.currentLesson], [0, 7]);
});

test('Academy simulation progress rejects malformed scores and users', async () => {
  const progress = createAcademyProgress({ pool: memoryPool(), guildId: GUILD });
  await assert.rejects(progress.save('bad', { moduleId: 1, lessonId: 1, score: 80 }), /invalid_user/);
  await assert.rejects(progress.save(A, { moduleId: 1, lessonId: 1, score: 101 }), /invalid_score/);
  await assert.rejects(progress.save(A, { moduleId: -1, lessonId: 1, score: 80 }), /invalid_module/);
  await assert.rejects(progress.state(''), /invalid_user/);
});
