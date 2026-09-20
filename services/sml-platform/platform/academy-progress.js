'use strict';

function integer(value, min, max, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new TypeError(`invalid_${name}`);
  return parsed;
}

function createAcademyProgress({ pool, guildId } = {}) {
  const configured = !!(pool && typeof pool.query === 'function' && String(guildId || '').trim());
  async function studentId(discordId) {
    if (!configured) throw new Error('academy progress is not configured');
    const userId = String(discordId || '');
    if (!/^\d{15,24}$/.test(userId)) throw new TypeError('invalid_user');
    const result = await pool.query(`INSERT INTO academy_students (guild_id, discord_id) VALUES ($1,$2)
      ON CONFLICT (guild_id, discord_id) DO UPDATE SET discord_id=EXCLUDED.discord_id RETURNING id`, [String(guildId), userId]);
    return result.rows[0].id;
  }
  async function read(discordId) {
    const id = await studentId(discordId);
    const result = await pool.query(`SELECT module_id, lesson_id, score, completed_at, started_at
      FROM academy_progress WHERE student_id=$1 ORDER BY module_id, lesson_id`, [id]);
    return result.rows.map((row) => ({ moduleId: Number(row.module_id), lessonId: Number(row.lesson_id), score: row.score == null ? null : Number(row.score), completed: !!row.completed_at, startedAt: row.started_at, completedAt: row.completed_at }));
  }
  async function save(discordId, input = {}) {
    const moduleId = integer(input.moduleId, 1, 13, 'module');
    const lessonId = integer(input.lessonId, 1, 99, 'lesson');
    const score = integer(input.score, 0, 100, 'score');
    const id = await studentId(discordId);
    const result = await pool.query(`INSERT INTO academy_progress (student_id, module_id, lesson_id, score, completed_at)
      VALUES ($1,$2,$3,$4,CASE WHEN $4 >= 70 THEN now() ELSE NULL END)
      ON CONFLICT (student_id, module_id, lesson_id) DO UPDATE SET
        score=GREATEST(COALESCE(academy_progress.score,0), EXCLUDED.score),
        completed_at=CASE WHEN academy_progress.completed_at IS NOT NULL THEN academy_progress.completed_at WHEN EXCLUDED.score >= 70 THEN now() ELSE NULL END
      RETURNING module_id, lesson_id, score, completed_at`, [id, moduleId, lessonId, score]);
    const row = result.rows[0];
    return { moduleId: Number(row.module_id), lessonId: Number(row.lesson_id), score: Number(row.score), completed: !!row.completed_at };
  }
  return { configured, read, save };
}

module.exports = { createAcademyProgress };
