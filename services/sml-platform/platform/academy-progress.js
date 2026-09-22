'use strict';

const { SEED_LESSONS } = require('./academy/curriculum');

const ORDERED_LESSONS = SEED_LESSONS.slice().sort((left, right) => left.moduleId - right.moduleId || left.lessonId - right.lessonId);
/* Module 0 ("Start Here") is a real module, so the lower bound is read from the
 * curriculum. A hard-coded floor of 1 silently rejected every beginner lesson
 * with invalid_module, which lost the learner's score on all 20 of them. */
const MIN_MODULE_ID = Math.min(...SEED_LESSONS.map((lesson) => lesson.moduleId));

function integer(value, min, max, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new TypeError(`invalid_${name}`);
  return parsed;
}

function nextLessonAfter(moduleId, lessonId) {
  const index = ORDERED_LESSONS.findIndex((lesson) => lesson.moduleId === moduleId && lesson.lessonId === lessonId);
  const next = index >= 0 ? ORDERED_LESSONS[index + 1] : null;
  return next || ORDERED_LESSONS[index] || ORDERED_LESSONS[0];
}

/* Every read and write is keyed by (guild_id, discord_id) of the session's
 * authenticated member; nothing here is cached in process memory, so two
 * members studying at once never share lesson, score, or resume state. */
function createAcademyProgress({ pool, guildId } = {}) {
  const configured = !!(pool && typeof pool.query === 'function' && String(guildId || '').trim());
  async function student(discordId) {
    if (!configured) throw new Error('academy progress is not configured');
    const userId = String(discordId || '');
    if (!/^\d{15,24}$/.test(userId)) throw new TypeError('invalid_user');
    const result = await pool.query(`INSERT INTO academy_students (guild_id, discord_id) VALUES ($1,$2)
      ON CONFLICT (guild_id, discord_id) DO UPDATE SET discord_id=EXCLUDED.discord_id RETURNING *`, [String(guildId), userId]);
    return result.rows[0];
  }
  async function read(discordId) {
    const row = await student(discordId);
    const result = await pool.query(`SELECT module_id, lesson_id, score, completed_at, started_at
      FROM academy_progress WHERE student_id=$1 ORDER BY module_id, lesson_id`, [row.id]);
    return result.rows.map((entry) => ({ moduleId: Number(entry.module_id), lessonId: Number(entry.lesson_id), score: entry.score == null ? null : Number(entry.score), completed: !!entry.completed_at, startedAt: entry.started_at, completedAt: entry.completed_at }));
  }
  async function state(discordId) {
    const row = await student(discordId);
    const badges = await pool.query('SELECT badge_key FROM academy_badges WHERE student_id=$1 ORDER BY earned_at ASC', [row.id]);
    return {
      /* `?? `, not `|| `: a student sitting on module 0 has a current_module of
       * 0, and `0 || 1` would have bounced them out of the Start Here track. */
      currentModule: Number(row.current_module ?? ORDERED_LESSONS[0].moduleId),
      currentLesson: Number(row.current_lesson || ORDERED_LESSONS[0].lessonId),
      xp: Number(row.xp || 0),
      streakDays: Number(row.streak_days || 0),
      badges: badges.rows.map((entry) => String(entry.badge_key))
    };
  }
  async function save(discordId, input = {}) {
    // The route verifies the lesson exists in the curriculum; these bounds only
    // reject malformed input before it reaches SQL.
    const moduleId = integer(input.moduleId, MIN_MODULE_ID, 99, 'module');
    const lessonId = integer(input.lessonId, 1, 99, 'lesson');
    const score = integer(input.score, 0, 100, 'score');
    const row = await student(discordId);
    const result = await pool.query(`INSERT INTO academy_progress (student_id, module_id, lesson_id, score)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (student_id, module_id, lesson_id) DO UPDATE SET
        score=GREATEST(COALESCE(academy_progress.score,0), EXCLUDED.score)
      RETURNING module_id, lesson_id, score, completed_at`, [row.id, moduleId, lessonId, score]);
    const saved = result.rows[0];
    let completed = !!saved.completed_at;
    if (!completed && Number(saved.score) >= 70) {
      /* Re-checked under the row lock, so concurrent passing saves (two tabs,
       * a retry) can complete the lesson — and award XP — only once. */
      const completion = await pool.query(`UPDATE academy_progress SET completed_at=now()
        WHERE student_id=$1 AND module_id=$2 AND lesson_id=$3 AND completed_at IS NULL RETURNING id`, [row.id, moduleId, lessonId]);
      completed = true;
      if (completion.rowCount) {
        const next = nextLessonAfter(moduleId, lessonId);
        await pool.query(`UPDATE academy_students
          SET xp=xp+100, current_module=$2, current_lesson=$3,
              streak_days=CASE WHEN streak_last=CURRENT_DATE THEN streak_days WHEN streak_last=CURRENT_DATE - 1 THEN streak_days+1 ELSE 1 END,
              streak_last=CURRENT_DATE
          WHERE id=$1`, [row.id, next.moduleId, next.lessonId]);
        await pool.query(`INSERT INTO academy_badges (student_id, badge_key) VALUES ($1,'first_lesson')
          ON CONFLICT (student_id, badge_key) DO NOTHING`, [row.id]);
      }
    }
    return { moduleId: Number(saved.module_id), lessonId: Number(saved.lesson_id), score: Number(saved.score), completed };
  }
  return { configured, read, state, save };
}

module.exports = { createAcademyProgress, nextLessonAfter };
