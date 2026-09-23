'use strict';

const { SEED_LESSONS } = require('./curriculum');
const EPHEMERAL = 64;
const ACADEMY_COMMANDS = new Set(['academy', 'enroll', 'lesson', 'progress', 'badges', 'glossary', 'flashcard', 'quiz', 'challenge', 'discipline', 'replay', 'leaderboard', 'launch']);

// Phase 1 is an owner-only preview. Keeping this permission on the command
// definitions (rather than setting it once in Discord) means a later command
// registration cannot accidentally expose the unfinished Academy.
const PRIVATE_PREVIEW_PERMISSIONS = '8'; // Discord ADMINISTRATOR bit
const privatePreview = (command) => ({ ...command, default_member_permissions: PRIVATE_PREVIEW_PERMISSIONS });
const COMMAND_DEFINITIONS = [
  // Primary Entry Point command (type 4) with handler 2 (DISCORD_LAUNCH_ACTIVITY):
  // Discord opens the Activity URL configured for this app in the Developer
  // Portal directly on the client. Our interaction endpoint is NOT called for
  // a normal launch, so `default_member_permissions` below (applied by
  // privatePreview) is the only way to keep this preview-gated for now -
  // there is no server-side check we can add for the launch itself. Widening
  // access later means removing the privatePreview() wrap and re-running
  // `npm run academy:register -- --apply`; it does not require a code change
  // to this handler.
  { type: 4, name: 'launch', description: 'Launch the Making Easy Money Academy live-chart Activity', handler: 2, contexts: [0] },
  { type: 1, name: 'academy', description: 'Open Making Easy Money Academy', contexts: [0] },
  { type: 1, name: 'enroll', description: 'Enroll in Making Easy Money Academy', contexts: [0] },
  { type: 1, name: 'lesson', description: 'Open an Academy lesson', contexts: [0], options: [
    { type: 4, name: 'module', description: 'Module number', required: false, min_value: 1, max_value: 13 },
    { type: 4, name: 'lesson', description: 'Lesson number', required: false, min_value: 1, max_value: 99 }
  ] },
  { type: 1, name: 'progress', description: 'View your private Academy progress', contexts: [0] },
  { type: 1, name: 'badges', description: 'View your private Academy badges', contexts: [0] },
  { type: 1, name: 'glossary', description: 'Look up an Academy term', contexts: [0], options: [{ type: 3, name: 'term', description: 'Term to define', required: true, max_length: 80 }] },
  { type: 1, name: 'flashcard', description: 'Review an Academy flashcard', contexts: [0], options: [{ type: 3, name: 'topic', description: 'Topic to review', required: true, max_length: 80 }] },
  { type: 1, name: 'quiz', description: 'Start an Academy quiz', contexts: [0], options: [{ type: 4, name: 'module', description: 'Module number', required: true, min_value: 1, max_value: 13 }] },
  { type: 1, name: 'challenge', description: 'Open today’s Academy chart challenge', contexts: [0] },
  { type: 1, name: 'discipline', description: 'Open today’s Academy discipline lesson', contexts: [0] },
  { type: 1, name: 'replay', description: 'Open an educational market replay', contexts: [0], options: [{ type: 3, name: 'scenario', description: 'Scenario name', required: true, max_length: 80 }] },
  { type: 1, name: 'leaderboard', description: 'View Academy learning milestones', contexts: [0] }
].map(privatePreview);

function text(value, max = 120) { return String(value || '').replace(/[\r\n`]/g, ' ').trim().slice(0, max); }
function response(content, embeds = [], components = []) { return { type: 4, data: { content, embeds, components, flags: EPHEMERAL } }; }
function options(interaction) { return Array.isArray(interaction?.data?.options) ? interaction.data.options : []; }
function option(interaction, name, fallback = null) { const found = options(interaction).find((entry) => entry?.name === name); return found == null ? fallback : found.value; }
function userId(interaction) { return String(interaction?.member?.user?.id || interaction?.user?.id || ''); }
function button(label, id, style = 2) { return { type: 2, style, label, custom_id: id }; }
function linkButton(label, url) { return { type: 2, style: 5, label, url }; }
function lessonFor(moduleId, lessonId) { return SEED_LESSONS.find((lesson) => lesson.moduleId === moduleId && lesson.lessonId === lessonId) || null; }
function nextLessonFor(lesson) {
  const ordered = SEED_LESSONS.slice().sort((left, right) => left.moduleId - right.moduleId || left.lessonId - right.lessonId);
  const index = ordered.findIndex((entry) => entry.moduleId === lesson.moduleId && entry.lessonId === lesson.lessonId);
  return index >= 0 ? ordered[index + 1] || null : null;
}

function createAcademyCommands({ pool, guildId, monarchRoleId = '', enabled = false, now = Date.now } = {}) {
  function canHandle(interaction) {
    const name = String(interaction?.data?.name || '').toLowerCase();
    const customId = String(interaction?.data?.custom_id || '');
    return (interaction?.type === 2 && ACADEMY_COMMANDS.has(name)) || (interaction?.type === 3 && customId.startsWith('academy:'));
  }
  function allowed(interaction) {
    if (!enabled || String(interaction?.guild_id || '') !== String(guildId || '')) return false;
    const roleIds = Array.isArray(interaction?.member?.roles) ? interaction.member.roles.map(String) : [];
    const permissions = BigInt(String(interaction?.member?.permissions || '0'));
    const administrator = (permissions & 8n) === 8n;
    return administrator || (!!monarchRoleId && roleIds.includes(String(monarchRoleId)));
  }
  async function student(interaction) {
    const id = userId(interaction); if (!/^\d{15,24}$/.test(id)) throw new TypeError('invalid Discord user');
    const result = await pool.query(`INSERT INTO academy_students (guild_id, discord_id) VALUES ($1,$2)
      ON CONFLICT (guild_id, discord_id) DO UPDATE SET discord_id=EXCLUDED.discord_id RETURNING *`, [guildId, id]);
    return result.rows[0];
  }
  async function startLesson(row, lesson) {
    await pool.query(`INSERT INTO academy_progress (student_id, module_id, lesson_id)
      VALUES ($1,$2,$3) ON CONFLICT (student_id, module_id, lesson_id) DO NOTHING`, [row.id, lesson.moduleId, lesson.lessonId]);
  }
  async function completeLesson(row, lesson) {
    /* The WHERE clause makes duplicate button presses harmless: only the
     * first correct answer can mark a lesson complete and award XP. */
    const completion = await pool.query(`INSERT INTO academy_progress (student_id, module_id, lesson_id, completed_at, score)
      VALUES ($1,$2,$3,now(),100)
      ON CONFLICT (student_id, module_id, lesson_id) DO UPDATE
      SET completed_at=now(), score=100
      WHERE academy_progress.completed_at IS NULL
      RETURNING id`, [row.id, lesson.moduleId, lesson.lessonId]);
    if (!completion.rowCount) return { newlyCompleted: false, xp: row.xp || 0, firstBadge: false };

    const next = nextLessonFor(lesson);
    const updated = await pool.query(`UPDATE academy_students
      SET xp=xp+100,
          current_module=$2,
          current_lesson=$3,
          streak_days=CASE
            WHEN streak_last=CURRENT_DATE THEN streak_days
            WHEN streak_last=CURRENT_DATE - 1 THEN streak_days+1
            ELSE 1 END,
          streak_last=CURRENT_DATE
      WHERE id=$1 RETURNING xp`, [row.id, next?.moduleId || lesson.moduleId, next?.lessonId || lesson.lessonId]);
    const badge = await pool.query(`INSERT INTO academy_badges (student_id, badge_key)
      VALUES ($1,'first_lesson') ON CONFLICT (student_id, badge_key) DO NOTHING RETURNING badge_key`, [row.id]);
    return { newlyCompleted: true, xp: updated.rows[0]?.xp || 0, firstBadge: badge.rowCount > 0 };
  }
  function lessonEmbed(lesson, segment = null) {
    return { color: lesson.color, author: { name: 'Making Easy Money Academy' }, title: `Module ${lesson.moduleId} · Lesson ${lesson.lessonId}: ${lesson.title}`,
      description: segment || lesson.description, fields: [{ name: 'Duration', value: lesson.duration, inline: true }, { name: 'Level', value: lesson.level, inline: true }],
      footer: { text: 'Educational content · Not financial advice' } };
  }
  async function handle(interaction) {
    if (!allowed(interaction)) return { response: response('The Academy is not available in this server yet.') };
    if (interaction.type === 3) {
      const parts = String(interaction.data.custom_id || '').split(':');
      if ((parts.length !== 4 && parts.length !== 5) || !['start','continue','answer'].includes(parts[1]) || !/^\d+$/.test(parts[2]) || !/^\d+$/.test(parts[3]) || (parts[1] === 'answer' && !/^[A-D]$/.test(parts[4] || ''))) return { response: response('This Academy control is no longer valid.') };
      const lesson = lessonFor(Number(parts[2]), Number(parts[3]));
      if (!lesson) return { response: response('This lesson is not available yet.') };
      const row = await student(interaction);
      if (parts[1] === 'start') {
        await startLesson(row, lesson);
        return { response: response('', [lessonEmbed(lesson, lesson.steps[0])], [{ type: 1, components: [button('Continue', `academy:continue:${lesson.moduleId}:${lesson.lessonId}`, 1)] }]) };
      }
      if (parts[1] === 'continue') return { response: response('', [lessonEmbed(lesson, `${lesson.steps.slice(1).join('\n\n')}\n\n**Practice:** ${lesson.question.prompt}`)], [{ type: 1, components: Object.entries(lesson.question.options).map(([key, label]) => button(`${key}. ${label}`.slice(0, 80), `academy:answer:${lesson.moduleId}:${lesson.lessonId}:${key}`, 2)) }]) };
      const chosen = parts[4];
      const correct = chosen === lesson.question.correct;
      if (!correct) return { response: response(`Not quite. ${lesson.question.explanation}`, [lessonEmbed(lesson, `**Answer:** ${lesson.question.correct}. ${lesson.question.options[lesson.question.correct]}`)], [{ type: 1, components: [button('Practice Again', `academy:continue:${lesson.moduleId}:${lesson.lessonId}`, 2)] }]) };
      const completion = await completeLesson(row, lesson);
      const next = nextLessonFor(lesson);
      const completionNote = completion.newlyCompleted
        ? `Lesson completed · +100 XP${completion.firstBadge ? ' · Badge earned: First Lesson' : ''}.`
        : 'You already completed this lesson. Review is always available.';
      const controls = [];
      if (next) controls.push(button(`Next: M${next.moduleId} L${next.lessonId}`, `academy:start:${next.moduleId}:${next.lessonId}`, 1));
      controls.push(button('Review Lesson', `academy:start:${lesson.moduleId}:${lesson.lessonId}`, 2));
      return { response: response(`Correct. ${lesson.question.explanation}\n\n${completionNote}`, [lessonEmbed(lesson, `**Answer:** ${lesson.question.correct}. ${lesson.question.options[lesson.question.correct]}\n\n**Live practice:** launch the Academy activity in Discord and use the chart controls to inspect candles.`)], controls.length ? [{ type: 1, components: controls }] : []) };
    }
    const name = String(interaction.data.name || '').toLowerCase();
    if (name === 'academy') return { response: response('Welcome to Making Easy Money Academy: a 26-lesson, college-level market curriculum across 13 modules. Start with /enroll, then use /lesson module:1 lesson:1. Launch the Academy activity inside Discord for the interactive live chart lab.', [], [{ type: 1, components: [button('Enroll', 'academy:start:1:1', 1), linkButton('Chart Lab Info', 'https://sml-platform-api.onrender.com/academy-activity/')] }]) };
    if (name === 'enroll') { const row = await student(interaction); return { response: response(`You are enrolled. Your Academy profile started ${new Date(row.enrolled_at || now()).toISOString().slice(0, 10)}. Use /lesson module:1 lesson:1 to begin.`) }; }
    if (name === 'lesson') { const moduleId = Number(option(interaction, 'module', 1)); const lessonId = Number(option(interaction, 'lesson', 1)); const lesson = lessonFor(moduleId, lessonId); if (!lesson) return { response: response('That lesson does not exist. The Academy contains modules 1–13, with lessons 1 and 2 in each module.') }; await student(interaction); return { response: response('', [lessonEmbed(lesson)], [{ type: 1, components: [button('Start Lesson', `academy:start:${moduleId}:${lessonId}`, 1)] }]) }; }
    if (name === 'progress') { const row = await student(interaction); const counts = await pool.query('SELECT count(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completed FROM academy_progress WHERE student_id=$1', [row.id]); return { response: response(`Private progress: ${counts.rows[0]?.completed || 0} completed lessons · ${row.xp || 0} XP · ${row.streak_days || 0}-day streak.`) }; }
    if (name === 'badges') { const row = await student(interaction); const badges = await pool.query('SELECT badge_key FROM academy_badges WHERE student_id=$1 ORDER BY earned_at ASC', [row.id]); const earned = badges.rows.map((entry) => entry.badge_key === 'first_lesson' ? 'First Lesson' : text(entry.badge_key, 40)); return { response: response(earned.length ? `Your badges: ${earned.join(' · ')}` : 'No badges yet. Complete your first lesson to earn First Lesson.') }; }
    if (name === 'glossary') return { response: response(`Glossary lookup for “${text(option(interaction, 'term'))}” is being added with the approved Module 1–3 content pack.`) };
    /* handler:2 (DISCORD_LAUNCH_ACTIVITY) means Discord normally opens the
     * Activity client-side without ever sending us this interaction. If we
     * do receive one anyway (e.g. the Activity URL mapping isn't configured
     * yet in the Developer Portal), fail with a clear, actionable message
     * instead of the generic "registered for the roadmap" copy below. */
    if (name === 'launch') return { response: response('The Academy Activity could not be launched. If this keeps happening, its Activity URL mapping may not be configured yet in the Discord Developer Portal.') };
    return { response: response(`${name} is registered for the Academy roadmap and will unlock after its manager-approved content is published.`) };
  }
  return Object.freeze({ canHandle, handle, definitions: COMMAND_DEFINITIONS });
}

module.exports = { ACADEMY_COMMANDS, COMMAND_DEFINITIONS, createAcademyCommands };
