'use strict';

const { SEED_LESSONS } = require('./curriculum');
const EPHEMERAL = 64;
const ACADEMY_COMMANDS = new Set(['academy', 'enroll', 'lesson', 'progress', 'badges', 'glossary', 'flashcard', 'quiz', 'challenge', 'discipline', 'replay', 'leaderboard']);
const ACADEMY_HUBS = Object.freeze([
  { command: 'academy', channel: '🎓｜academy-home', title: '🎓 Academy Command Center', button: 'Open My Academy', color: 0x18d36e, topic: 'Your private Making Easy Money Academy dashboard: 101 college-level lessons across 28 modules, tools, milestones, and the live-chart lab. Click the launcher; only you can see your response.' },
  { command: 'enroll', channel: '🚀｜enroll-now', title: '🚀 Start Your Academy Journey', button: 'Enroll Me', color: 0x00c2ff, topic: 'Create your private Academy student profile and begin Module 1. Enrollment details are visible only to you.' },
  { command: 'lesson', channel: '📚｜academy-lessons-live-chart', title: '📚 Lesson Launchpad + Live Chart', button: 'Open My Next Lesson', color: 0x5865f2, topic: 'Work through 101 interactive lessons across 28 modules, simulations, quizzes, and the live-chart lab. Your lesson view and results stay private.' },
  { command: 'progress', channel: '📈｜my-progress', title: '📈 My Private Progress', button: 'Show My Progress', color: 0x2ecc71, topic: 'See your completed lessons, completion percentage, XP, learning streak, and next lesson. Only you can see your progress card.' },
  { command: 'badges', channel: '🏅｜my-badges', title: '🏅 My Badge Vault', button: 'Show My Badges', color: 0xf1c40f, topic: 'Open your private badge vault and see the learning milestones you have earned.' },
  { command: 'glossary', channel: '📖｜trading-glossary', title: '📖 Trading Glossary', button: 'Open Today\'s Term', color: 0x9b59b6, topic: 'Learn market structure, charting, risk, options, valuation, and execution vocabulary with clear educational definitions.' },
  { command: 'flashcard', channel: '🧠｜flashcard-lab', title: '🧠 Flashcard Lab', button: 'Draw My Flashcard', color: 0xe67e22, topic: 'Test recall with a private Academy flashcard, reveal the explanation, and jump into the full lesson.' },
  { command: 'quiz', channel: '📝｜quiz-arena', title: '📝 Private Quiz Arena', button: 'Start My Quiz', color: 0xe74c3c, topic: 'Run a private knowledge check drawn from your Academy curriculum. Your questions and answers are visible only to you.' },
  { command: 'challenge', channel: '📊｜daily-chart-challenge', title: '📊 Daily Chart Challenge', button: 'Open Today\'s Challenge', color: 0x1abc9c, topic: 'Practice context, triggers, invalidation, position risk, and no-trade decisions with a fresh private chart challenge.' },
  { command: 'discipline', channel: '🎧｜daily-discipline-audio', title: '🎧 Daily Discipline Desk', button: 'Open Today\'s Discipline', color: 0x3498db, topic: 'Build patience, risk control, trading psychology, journaling, and pre-trade discipline through a private daily coaching prompt.' },
  { command: 'replay', channel: '⏪｜market-replay-lab', title: '⏪ Market Replay Lab', button: 'Launch My Replay', color: 0x34495e, topic: 'Pause the market, declare a hypothesis and risk plan, then compare your reasoning with an educational replay lesson.' },
  { command: 'leaderboard', channel: '🏆｜learning-leaderboard', title: '🏆 Learning Leaderboard', button: 'View Milestones', color: 0xf39c12, topic: 'View anonymized Academy learning milestones based on completed education, XP, and study streaks—not trading profits.' }
]);
const HUB_OPTIONS = Object.freeze({
  glossary: [{ name: 'term', value: 'vwap' }],
  flashcard: [{ name: 'topic', value: 'risk' }],
  quiz: [{ name: 'module', value: 1 }],
  replay: [{ name: 'scenario', value: 'tape' }]
});

// Phase 1 is an owner-only preview. Keeping this permission on the command
// definitions (rather than setting it once in Discord) means a later command
// registration cannot accidentally expose the unfinished Academy.
const PRIVATE_PREVIEW_PERMISSIONS = '8'; // Discord ADMINISTRATOR bit
const privatePreview = (command) => ({ ...command, default_member_permissions: PRIVATE_PREVIEW_PERMISSIONS });
const ENTRY_POINT_COMMAND = Object.freeze({
  name: 'launch',
  description: 'Open the interactive Making Easy Money Academy workspace',
  type: 4,
  handler: 2,
  integration_types: [0],
  contexts: [0]
});
const COMMAND_DEFINITIONS = [
  { type: 1, name: 'academy', description: 'Open Making Easy Money Academy', contexts: [0] },
  { type: 1, name: 'enroll', description: 'Enroll in Making Easy Money Academy', contexts: [0] },
  { type: 1, name: 'lesson', description: 'Open an Academy lesson', contexts: [0], options: [
    { type: 4, name: 'module', description: 'Module number', required: false, min_value: 1, max_value: 28 },
    { type: 4, name: 'lesson', description: 'Lesson number', required: false, min_value: 1, max_value: 99 }
  ] },
  { type: 1, name: 'progress', description: 'View your private Academy progress', contexts: [0] },
  { type: 1, name: 'badges', description: 'View your private Academy badges', contexts: [0] },
  { type: 1, name: 'glossary', description: 'Look up an Academy term', contexts: [0], options: [{ type: 3, name: 'term', description: 'Term to define', required: true, max_length: 80 }] },
  { type: 1, name: 'flashcard', description: 'Review an Academy flashcard', contexts: [0], options: [{ type: 3, name: 'topic', description: 'Topic to review', required: true, max_length: 80 }] },
  { type: 1, name: 'quiz', description: 'Start an Academy quiz', contexts: [0], options: [{ type: 4, name: 'module', description: 'Module number', required: true, min_value: 1, max_value: 28 }] },
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
function normalized(value) { return text(value, 160).toLowerCase().replace(/[^a-z0-9$%+.-]+/g, ' ').trim(); }
function lessonsForModule(moduleId) { return SEED_LESSONS.filter((lesson) => lesson.moduleId === Number(moduleId)); }
function lessonSearch(value, lessons = SEED_LESSONS) {
  const query = normalized(value);
  if (!query) return null;
  const terms = query.split(/\s+/).filter(Boolean);
  return lessons.map((lesson) => {
    const haystack = normalized([lesson.title, lesson.description, ...lesson.steps].join(' '));
    const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
    return { lesson, score, titleMatch: normalized(lesson.title).includes(query) };
  }).sort((left, right) => Number(right.titleMatch) - Number(left.titleMatch) || right.score - left.score || left.lesson.moduleId - right.lesson.moduleId)[0]?.lesson || null;
}
function dailyLesson(scope, now = Date.now) {
  const day = Math.floor(Number(now()) / 86_400_000);
  const candidates = scope.length ? scope : SEED_LESSONS;
  return candidates[((day % candidates.length) + candidates.length) % candidates.length];
}

const GLOSSARY = Object.freeze({
  ask: 'The lowest displayed price at which a seller is currently offering shares.',
  bid: 'The highest displayed price at which a buyer is currently offering to buy shares.',
  spread: 'The difference between the best displayed bid and ask; one component of trading cost and liquidity.',
  vwap: 'Volume-weighted average price: cumulative traded value divided by cumulative volume for the measured session or window.',
  liquidity: 'The ability to trade size promptly with limited price impact and reasonable execution cost.',
  slippage: 'The difference between the expected decision price and the actual execution price.',
  catalyst: 'A new event or information item that can change cash-flow expectations, risk, positioning, or constraints.',
  volatility: 'The dispersion of returns; it measures variability, not direction and not loss by itself.',
  delta: 'An option estimate of price sensitivity to a small underlying move, holding other modeled inputs constant.',
  gamma: 'The rate at which an option delta changes as the underlying price changes.',
  theta: 'An option estimate of time-value sensitivity as expiration approaches, holding other modeled inputs constant.',
  vega: 'An option estimate of price sensitivity to a change in implied volatility.',
  float: 'Shares generally available for public trading after accounting for restricted or closely held stock.',
  'short squeeze': 'Forced or risk-driven short covering that can amplify an advance when liquidity and positioning are constrained.',
  support: 'A price area where demand previously absorbed supply; it is a hypothesis to test, not a guaranteed floor.',
  resistance: 'A price area where supply previously absorbed demand; it is a hypothesis to test, not a guaranteed ceiling.',
  invalidation: 'Predeclared evidence or price behavior that proves a trade thesis no longer deserves capital.',
  expectancy: 'Average outcome per trade: win probability times average win minus loss probability times average loss, before or after stated costs.',
  drawdown: 'The decline from an equity or portfolio peak to a later trough.',
  absorption: 'Aggressive orders transact repeatedly without proportional price progress, suggesting resting or replenishing liquidity.'
});
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
    // Component interactions can only be produced from an Academy message the
    // member is permitted to see. This opens the private launchers and their
    // follow-up controls to students without exposing the slash-command suite.
    if (interaction?.__academyHub || (interaction?.type === 3 && String(interaction?.data?.custom_id || '').startsWith('academy:'))) return true;
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
      if (parts.length === 3 && parts[1] === 'hub' && ACADEMY_COMMANDS.has(parts[2])) {
        return handle({
          ...interaction,
          type: 2,
          data: { name: parts[2], options: HUB_OPTIONS[parts[2]] || [] },
          // Preserve the privacy-safe component authorization when dispatching
          // into the shared slash-command implementation.
          __academyHub: true
        });
      }
      if ((parts.length !== 4 && parts.length !== 5) || !['start','continue','answer','flash'].includes(parts[1]) || !/^\d+$/.test(parts[2]) || !/^\d+$/.test(parts[3]) || (parts[1] === 'answer' && !/^[A-D]$/.test(parts[4] || ''))) return { response: response('This Academy control is no longer valid.') };
      const lesson = lessonFor(Number(parts[2]), Number(parts[3]));
      if (!lesson) return { response: response('This lesson is not available yet.') };
      const row = await student(interaction);
      if (parts[1] === 'flash') {
        return { response: response('', [lessonEmbed(lesson, `**Answer**\n${lesson.description}\n\n**Key principle**\n${lesson.steps[0]}\n\n**Apply it**\n${lesson.steps[2]}`)], [{ type: 1, components: [button('Start Full Lesson', `academy:start:${lesson.moduleId}:${lesson.lessonId}`, 1)] }]) };
      }
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
    if (name === 'academy') return { response: response(`Welcome to Making Easy Money Academy: ${SEED_LESSONS.length} interactive, college-level market lessons across ${new Set(SEED_LESSONS.map((entry) => entry.moduleId)).size} modules—plus quizzes, flashcards, challenges, private progress, badges, discipline lessons, replays, a glossary, and an anonymized learning leaderboard. Use the dedicated Academy channels; every launcher opens a view only you can see.`, [], [{ type: 1, components: [button('Begin Lesson 1', 'academy:start:1:1', 1), linkButton('Live Chart Lab', 'https://sml-platform-api.onrender.com/academy-activity/')] }]) };
    if (name === 'enroll') { const row = await student(interaction); return { response: response(`You are enrolled. Your private Academy profile started ${new Date(row.enrolled_at || now()).toISOString().slice(0, 10)}. Open the Lesson Launchpad to begin—no slash command required.`) }; }
    if (name === 'lesson') { const row = await student(interaction); const moduleId = Number(option(interaction, 'module', row.current_module || 1)); const lessonId = Number(option(interaction, 'lesson', row.current_lesson || 1)); const lesson = lessonFor(moduleId, lessonId); if (!lesson) return { response: response(`That lesson does not exist. The Academy currently contains ${SEED_LESSONS.length} lessons across modules 1–${Math.max(...SEED_LESSONS.map((entry) => entry.moduleId))}.`) }; return { response: response('', [lessonEmbed(lesson)], [{ type: 1, components: [button('Start Lesson', `academy:start:${moduleId}:${lessonId}`, 1)] }]) }; }
    if (name === 'progress') { const row = await student(interaction); const counts = await pool.query('SELECT count(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completed FROM academy_progress WHERE student_id=$1', [row.id]); const completed = counts.rows[0]?.completed || 0; const percent = Math.round((completed / SEED_LESSONS.length) * 100); return { response: response(`Private progress: ${completed}/${SEED_LESSONS.length} lessons (${percent}%) · ${row.xp || 0} XP · ${row.streak_days || 0}-day streak · Next: Module ${row.current_module || 1}, Lesson ${row.current_lesson || 1}.`) }; }
    if (name === 'badges') { const row = await student(interaction); const badges = await pool.query('SELECT badge_key FROM academy_badges WHERE student_id=$1 ORDER BY earned_at ASC', [row.id]); const earned = badges.rows.map((entry) => entry.badge_key === 'first_lesson' ? 'First Lesson' : text(entry.badge_key, 40)); return { response: response(earned.length ? `Your badges: ${earned.join(' · ')}` : 'No badges yet. Complete your first lesson to earn First Lesson.') }; }
    if (name === 'glossary') {
      const term = normalized(option(interaction, 'term'));
      const exact = GLOSSARY[term];
      const key = exact ? term : Object.keys(GLOSSARY).find((entry) => entry.includes(term) || term.includes(entry));
      if (key) return { response: response(`**${key.replace(/\b\w/g, (letter) => letter.toUpperCase())}** — ${GLOSSARY[key]}\n\nEducational definition; verify how a broker, exchange, or filing uses the term in context.`) };
      const match = lessonSearch(term);
      return { response: response(match ? `No exact glossary card yet. Best curriculum match: **Module ${match.moduleId}, Lesson ${match.lessonId} — ${match.title}**\n${match.description}` : `No Academy match was found for “${text(term)}”. Try a specific market, chart, risk, options, or execution term.`) };
    }
    if (name === 'flashcard') {
      const topic = option(interaction, 'topic');
      const lesson = lessonSearch(topic);
      if (!lesson) return { response: response(`No flashcard matched “${text(topic)}”. Try a lesson title or a specific topic such as VWAP, options, tape reading, risk, or valuation.`) };
      return { response: response(`**Flashcard · ${lesson.title}**\n\nBefore revealing the answer, explain this in your own words:\n${lesson.question.prompt}`, [], [{ type: 1, components: [button('Reveal Answer', `academy:flash:${lesson.moduleId}:${lesson.lessonId}`, 1)] }]) };
    }
    if (name === 'quiz') {
      const moduleId = Number(option(interaction, 'module'));
      const candidates = lessonsForModule(moduleId);
      if (!candidates.length) return { response: response(`Module ${moduleId} does not exist. Choose a module from 1 to 28.`) };
      const seed = [...userId(interaction)].reduce((total, digit) => total + Number(digit || 0), Math.floor(Number(now()) / 86_400_000));
      const lesson = candidates[seed % candidates.length];
      await student(interaction);
      return { response: response(`**Module ${moduleId} Knowledge Check**\n${lesson.question.prompt}`, [lessonEmbed(lesson, 'Choose the strongest evidence-based answer. Your result is private.')], [{ type: 1, components: Object.entries(lesson.question.options).map(([key, label]) => button(`${key}. ${label}`.slice(0, 80), `academy:answer:${lesson.moduleId}:${lesson.lessonId}:${key}`, 2)) }]) };
    }
    if (name === 'challenge') {
      const lesson = dailyLesson(SEED_LESSONS.filter((entry) => /chart|tape|replay|technical|momentum|pattern|risk/i.test(`${entry.title} ${entry.description}`)), now);
      await student(interaction);
      return { response: response(`**Today’s Chart Challenge**\n${lesson.steps[2]}\n\nWrite your context, trigger, invalidation, maximum risk, and no-trade condition before revealing later bars. Grade the process—not the outcome.`, [lessonEmbed(lesson)], [{ type: 1, components: [button('Study the Lesson', `academy:start:${lesson.moduleId}:${lesson.lessonId}`, 1)] }]) };
    }
    if (name === 'discipline') {
      const lesson = dailyLesson(SEED_LESSONS.filter((entry) => /discipline|psychology|bias|process|journal|risk|decision/i.test(`${entry.title} ${entry.description}`)), now);
      await student(interaction);
      return { response: response(`**Daily Discipline**\n${lesson.steps[0]}\n\nBefore your next decision, write what would invalidate the idea and the maximum loss you accept. If either is missing, the disciplined action is to wait.`, [lessonEmbed(lesson)], [{ type: 1, components: [button('Open Today’s Lesson', `academy:start:${lesson.moduleId}:${lesson.lessonId}`, 1)] }]) };
    }
    if (name === 'replay') {
      const scenario = option(interaction, 'scenario');
      const lesson = lessonSearch(scenario, SEED_LESSONS.filter((entry) => /replay|tape|auction|break|squeeze|halt|earnings|options|momentum/i.test(`${entry.title} ${entry.description} ${entry.steps.join(' ')}`)));
      if (!lesson) return { response: response(`No replay matched “${text(scenario)}”. Try tape, breakout, squeeze, halt, earnings, options, or momentum.`) };
      const rounds = lesson.simulation?.rounds || [];
      const preview = rounds.slice(0, 3).map((round, index) => `**Pause ${index + 1}:** ${round.prompt}\n${round.display}`).join('\n\n');
      return { response: response(`**Educational Replay · ${lesson.title}**\nPause before each decision, declare your hypothesis and risk, then compare with the explanation.`, [lessonEmbed(lesson, preview || lesson.steps.join('\n\n'))], [{ type: 1, components: [button('Open Full Lesson', `academy:start:${lesson.moduleId}:${lesson.lessonId}`, 1)] }]) };
    }
    if (name === 'leaderboard') {
      const leaders = await pool.query(`SELECT discord_id, xp, streak_days
        FROM academy_students WHERE guild_id=$1 AND xp > 0
        ORDER BY xp DESC, streak_days DESC, enrolled_at ASC LIMIT 10`, [guildId]);
      if (!leaders.rows.length) return { response: response('The learning leaderboard is empty. Complete a lesson correctly to record the first milestone.') };
      const lines = leaders.rows.map((entry, index) => `${index + 1}. Trader ••••${String(entry.discord_id || '').slice(-4)} — ${Number(entry.xp || 0)} XP · ${Number(entry.streak_days || 0)}-day streak`);
      return { response: response(`**Academy Learning Milestones**\n${lines.join('\n')}\n\nRanks reward completed learning—not trading profits or financial results.`) };
    }
    return { response: response('This Academy command is unavailable.') };
  }
  return Object.freeze({ canHandle, handle, definitions: COMMAND_DEFINITIONS });
}

module.exports = { ACADEMY_COMMANDS, ACADEMY_HUBS, COMMAND_DEFINITIONS, ENTRY_POINT_COMMAND, createAcademyCommands };
