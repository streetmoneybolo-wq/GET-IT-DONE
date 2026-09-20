'use strict';

const { SEED_LESSONS } = require('./curriculum');
const EPHEMERAL = 64;
const ACADEMY_COMMANDS = new Set(['academy', 'enroll', 'lesson', 'progress', 'badges', 'glossary', 'flashcard', 'quiz', 'challenge', 'discipline', 'replay', 'leaderboard']);

// Phase 1 is an owner-only preview. Keeping this permission on the command
// definitions (rather than setting it once in Discord) means a later command
// registration cannot accidentally expose the unfinished Academy.
const PRIVATE_PREVIEW_PERMISSIONS = '8'; // Discord ADMINISTRATOR bit
const privatePreview = (command) => ({ ...command, default_member_permissions: PRIVATE_PREVIEW_PERMISSIONS });
const COMMAND_DEFINITIONS = [
  { type: 1, name: 'academy', description: 'Open Making Easy Money Academy', contexts: [0] },
  { type: 1, name: 'enroll', description: 'Enroll in Making Easy Money Academy', contexts: [0] },
  { type: 1, name: 'lesson', description: 'Open an Academy lesson', contexts: [0], options: [
    { type: 4, name: 'module', description: 'Module number', required: false, min_value: 1, max_value: 10 },
    { type: 4, name: 'lesson', description: 'Lesson number', required: false, min_value: 1, max_value: 99 }
  ] },
  { type: 1, name: 'progress', description: 'View your private Academy progress', contexts: [0] },
  { type: 1, name: 'badges', description: 'View your private Academy badges', contexts: [0] },
  { type: 1, name: 'glossary', description: 'Look up an Academy term', contexts: [0], options: [{ type: 3, name: 'term', description: 'Term to define', required: true, max_length: 80 }] },
  { type: 1, name: 'flashcard', description: 'Review an Academy flashcard', contexts: [0], options: [{ type: 3, name: 'topic', description: 'Topic to review', required: true, max_length: 80 }] },
  { type: 1, name: 'quiz', description: 'Start an Academy quiz', contexts: [0], options: [{ type: 4, name: 'module', description: 'Module number', required: true, min_value: 1, max_value: 10 }] },
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
function lessonFor(moduleId, lessonId) { return SEED_LESSONS.find((lesson) => lesson.moduleId === moduleId && lesson.lessonId === lessonId) || null; }

function createAcademyCommands({ pool, guildId, enabled = false, now = Date.now } = {}) {
  function canHandle(interaction) {
    const name = String(interaction?.data?.name || '').toLowerCase();
    const customId = String(interaction?.data?.custom_id || '');
    return (interaction?.type === 2 && ACADEMY_COMMANDS.has(name)) || (interaction?.type === 3 && customId.startsWith('academy:'));
  }
  function allowed(interaction) { return enabled && String(interaction?.guild_id || '') === String(guildId || ''); }
  async function student(interaction) {
    const id = userId(interaction); if (!/^\d{15,24}$/.test(id)) throw new TypeError('invalid Discord user');
    const result = await pool.query(`INSERT INTO academy_students (guild_id, discord_id) VALUES ($1,$2)
      ON CONFLICT (guild_id, discord_id) DO UPDATE SET discord_id=EXCLUDED.discord_id RETURNING *`, [guildId, id]);
    return result.rows[0];
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
      await student(interaction);
      if (parts[1] === 'start') return { response: response('', [lessonEmbed(lesson, lesson.steps[0])], [{ type: 1, components: [button('Continue', `academy:continue:${lesson.moduleId}:${lesson.lessonId}`, 1)] }]) };
      if (parts[1] === 'continue') return { response: response('', [lessonEmbed(lesson, `${lesson.steps.slice(1).join('\n\n')}\n\n**Practice:** ${lesson.question.prompt}`)], [{ type: 1, components: Object.entries(lesson.question.options).map(([key, label]) => button(`${key}. ${label}`.slice(0, 80), `academy:answer:${lesson.moduleId}:${lesson.lessonId}:${key}`, 2)) }]) };
      const chosen = parts[4];
      const correct = chosen === lesson.question.correct;
      return { response: response(`${correct ? 'Correct.' : 'Not quite.'} ${lesson.question.explanation}`, [lessonEmbed(lesson, `**Answer:** ${lesson.question.correct}. ${lesson.question.options[lesson.question.correct]}`)]) };
    }
    const name = String(interaction.data.name || '').toLowerCase();
    if (name === 'academy') return { response: response('Welcome to Making Easy Money Academy. Start with /enroll, then use /lesson module:1 lesson:1. Lessons are original educational material.', [], [{ type: 1, components: [button('Enroll', 'academy:start:1:1', 1)] }]) };
    if (name === 'enroll') { const row = await student(interaction); return { response: response(`You are enrolled. Your Academy profile started ${new Date(row.enrolled_at || now()).toISOString().slice(0, 10)}. Use /lesson module:1 lesson:1 to begin.`) }; }
    if (name === 'lesson') { const moduleId = Number(option(interaction, 'module', 1)); const lessonId = Number(option(interaction, 'lesson', 1)); const lesson = lessonFor(moduleId, lessonId); if (!lesson) return { response: response('That lesson is not seeded in Phase 1 yet. Try module 1 lesson 1, module 2 lesson 1, module 3 lesson 1, or module 7 lesson 1.') }; await student(interaction); return { response: response('', [lessonEmbed(lesson)], [{ type: 1, components: [button('Start Lesson', `academy:start:${moduleId}:${lessonId}`, 1)] }]) }; }
    if (name === 'progress') { const row = await student(interaction); const counts = await pool.query('SELECT count(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completed FROM academy_progress WHERE student_id=$1', [row.id]); return { response: response(`Private progress: ${counts.rows[0]?.completed || 0} completed lessons · ${row.xp || 0} XP · ${row.streak_days || 0}-day streak.`) }; }
    if (name === 'glossary') return { response: response(`Glossary lookup for “${text(option(interaction, 'term'))}” is being added with the approved Module 1–3 content pack.`) };
    return { response: response(`${name} is registered for the Academy roadmap and will unlock after its manager-approved content is published.`) };
  }
  return Object.freeze({ canHandle, handle, definitions: COMMAND_DEFINITIONS });
}

module.exports = { ACADEMY_COMMANDS, COMMAND_DEFINITIONS, createAcademyCommands };
