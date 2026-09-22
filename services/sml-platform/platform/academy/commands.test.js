'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ACADEMY_HUBS, ENTRY_POINT_COMMAND, LAUNCH_ID, TEXT_LESSON_ID, createAcademyCommands } = require('./commands');
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
  assert.match(allowed.response.data.content, /121 interactive/);
  assert.match(allowed.response.data.content, /29 modules/);
  // The welcome copy is counted from the curriculum, so it cannot go stale.
  assert.match(allowed.response.data.content, new RegExp(`${SEED_LESSONS.length} interactive`));
  assert.match(allowed.response.data.content, new RegExp(`${new Set(SEED_LESSONS.map((lesson) => lesson.moduleId)).size} modules`));
});

test('all dedicated channel launchers work for members and remain ephemeral', async () => {
  const academy = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true, now: () => Date.UTC(2026, 8, 21) });
  assert.equal(ACADEMY_HUBS.length, 8);
  assert.equal(new Set(ACADEMY_HUBS.map((hub) => hub.command)).size, 8);
  for (const hub of ACADEMY_HUBS) {
    const input = { type: 3, guild_id: GUILD, member: { user: { id: USER }, roles: [], permissions: '0' }, data: { custom_id: `academy:hub:${hub.command}` } };
    const result = await academy.handle(input);
    if (hub.command === 'lesson') { assert.deepEqual(result.response, { type: 12 }, 'lesson launcher must open the Activity'); continue; }
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

test('Academy publishes a complete 121-lesson college-level curriculum', () => {
  assert.equal(SEED_LESSONS.length, 121);
  assert.equal(new Set(SEED_LESSONS.map((lesson) => `${lesson.moduleId}:${lesson.lessonId}`)).size, 121);
  // Module 0 is the Start Here beginner track and sorts ahead of module 1.
  assert.deepEqual([...new Set(SEED_LESSONS.map((lesson) => lesson.moduleId))], Array.from({ length: 29 }, (_, index) => index));
  for (const entry of SEED_LESSONS) {
    assert.equal(entry.steps.length, 3);
    assert.match(entry.steps[2], /lab:/i);
    assert.equal(Object.keys(entry.question.options).length, 4);
    assert.ok(entry.question.options[entry.question.correct]);
    assert.ok(entry.simulation);
    assert.ok(entry.simulation.rounds.length >= 3);
  }
  assert.ok(SEED_LESSONS.find((entry) => entry.moduleId === 3 && entry.lessonId === 1).simulation.rounds.length > 50);
  const putLesson = SEED_LESSONS.find((entry) => entry.moduleId === 9 && entry.lessonId === 1);
  assert.match(putLesson.steps.join(' '), /cash-secured put/i);
  // The worked numbers live only on the whiteboard example; the steps teach the
  // rules, qualify the floor, and show the seller's side of the same contract.
  assert.match(putLesson.steps[0], /For someone who also owns the shares, the strike works like a temporary price floor/);
  assert.match(putLesson.steps[2], /\$45.*\$2.*\$43/s);
  assert.doesNotMatch(putLesson.steps.join(' '), /Worked example|\$50\b|\$55|\$40|\$300/);
  assert.match(putLesson.question.explanation, /\$250/);
  assert.match(SEED_LESSONS.find((entry) => entry.moduleId === 10 && entry.lessonId === 1).title, /Read the Tape/i);
  assert.match(SEED_LESSONS.find((entry) => entry.moduleId === 11 && entry.lessonId === 2).title, /Grandmaster-Obi/i);
  assert.match(SEED_LESSONS.find((entry) => entry.moduleId === 17 && entry.lessonId === 4).title, /Regression/i);
  assert.match(SEED_LESSONS.find((entry) => entry.moduleId === 22 && entry.lessonId === 2).title, /Duration/i);
  assert.match(SEED_LESSONS.find((entry) => entry.moduleId === 28 && entry.lessonId === 5).title, /Capstone/i);
});

test('every lesson has an authored whiteboard example spoken between the title and its three steps', () => {
  const { lessonParts, EXAMPLE_LEAD, CHECK_LEAD } = require('./lesson-parts');
  const { validateExample } = require('./examples');
  const { narrationFor } = require('../academy-voice');
  const { partsFor } = require('../academy-slide-designer');
  const forbiddenNames = /\b(?:brian|dave|buster|clear\s?value)\b/i;
  const sources = {};
  for (const entry of SEED_LESSONS) {
    const id = `${entry.moduleId}.${entry.lessonId}`;
    const example = entry.example;
    sources[example && example.source] = (sources[example && example.source] || 0) + 1;
    assert.equal(example.source, 'authored', `${id} uses an authored example, not the auto fallback`);
    assert.equal(example.id, id);
    assert.deepEqual(validateExample(example), [], id);
    // Examples are narration only: exactly three steps, none of them the example.
    assert.equal(entry.steps.length, 3, id);
    for (const step of entry.steps) {
      assert.equal(step.includes(EXAMPLE_LEAD), false, `${id} step contains the example`);
      for (const sentence of example.say) assert.equal(step.includes(sentence), false, `${id} step repeats an example sentence`);
    }
    // One part list for voice, slide designer and Activity client.
    const parts = lessonParts(entry);
    assert.deepEqual(entry.parts, parts, id);
    assert.deepEqual(partsFor(entry), parts, id);
    assert.deepEqual(narrationFor(entry).split('\n\n'), parts, id);
    assert.deepEqual(parts, [entry.title, `${EXAMPLE_LEAD} ${example.say.join(' ')}`, ...entry.steps, `${CHECK_LEAD}${entry.question.prompt}`], id);
    assert.equal(entry.exampleIndex, 1, id);
    assert.equal(parts.at(-1), `${CHECK_LEAD}${entry.question.prompt}`, `${id} knowledge check stays last`);
    // Original, fictional, educational: no reference-creator names anywhere in the example.
    assert.doesNotMatch(JSON.stringify(example), forbiddenNames, id);
  }
  assert.deepEqual(sources, { authored: 121 });

  // 9.1 pins: the steps keep the worked put contract and the example agrees with them.
  const put = SEED_LESSONS.find((entry) => entry.moduleId === 9 && entry.lessonId === 1);
  assert.equal(put.question.correct, 'C');
  assert.equal(put.question.options.C, '$2.50');
  // The check uses different numbers, so the example never speaks an option first.
  for (const option of Object.values(put.question.options)) {
    if (option !== '$0') assert.equal(new RegExp(`\\${option.replace('.', '\\.')}\\b`).test(put.parts[1]), false, `9.1 example speaks the check option ${option}`);
  }
  assert.deepEqual([put.example.facts.strike, put.example.facts.premium, put.example.facts.breakEven, put.example.facts.netLow, put.example.facts.netHigh], [45, 2, 43, 300, -200]);
});

test('the long-form voice script is generated from the shared lesson parts and is up to date', () => {
  const fs = require('node:fs');
  const { OUTPUT, buildNarrationScript, lessonBlock } = require('../../scripts/build-academy-narration');
  const text = buildNarrationScript(SEED_LESSONS);
  let cursor = 0;
  for (const entry of SEED_LESSONS) {
    const id = `${entry.moduleId}.${entry.lessonId}`;
    const [title, example, ...rest] = entry.parts;
    const check = rest.pop();
    const block = lessonBlock(entry);
    const expected = [`### Lesson ${id}: ${title}`, example, ...rest.map((step, index) => `Point ${index + 1}. ${step}`), check];
    let at = 0;
    for (const line of expected) {
      const found = block.indexOf(`\n${line}\n`, at);
      assert.ok(found >= 0, `${id} voice script is missing, or reorders: ${line.slice(0, 60)}`);
      at = found + line.length;
    }
    const start = text.indexOf(block, cursor);
    assert.ok(start >= cursor, `${id} block appears in curriculum order`);
    cursor = start + block.length;
  }
  const committed = fs.readFileSync(OUTPUT, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(committed, text, 'content/making-easy-money-academy-101-lesson-voice-script.md is stale: run node scripts/build-academy-narration.js');
});

test('all 29 modules, module 0 included, can be selected from lesson and quiz commands', () => {
  const academy = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true });
  for (const commandName of ['lesson', 'quiz']) {
    const definition = academy.definitions.find((entry) => entry.name === commandName);
    const moduleOption = definition.options.find((entry) => entry.name === 'module');
    // Discord rejects a value outside the range, so a floor of 1 would have made
    // the whole Start Here track unreachable from both slash commands.
    assert.equal(moduleOption.min_value, 0);
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
    interaction('briefing'),
    interaction('discipline'),
    interaction('replay', { options: [{ name: 'scenario', value: 'breakout' }] })
  ];
  for (const input of cases) {
    const result = await academy.handle(input);
    assert.ok(result.response.data.content.length > 20);
    assert.doesNotMatch(result.response.data.content, /roadmap|being added|unlock after/i);
  }
});

test('each member receives an independent private lesson session', async () => {
  const studentLookups = [];
  const db = {
    async query(sql, values = []) {
      if (sql.includes('academy_students') && sql.includes('RETURNING *')) {
        studentLookups.push(values);
        return { rows: [{ id: studentLookups.length, xp: 0, streak_days: 0, current_module: 1, current_lesson: 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }
  };
  const academy = createAcademyCommands({ pool: db, guildId: GUILD, monarchRoleId: MONARCH, enabled: true });
  const firstUser = '123456789012345678';
  const secondUser = '987654321098765432';
  const request = (id) => ({ type: 3, guild_id: GUILD, member: { user: { id }, roles: [], permissions: '0' }, data: { custom_id: TEXT_LESSON_ID } });

  const first = await academy.handle(request(firstUser));
  const second = await academy.handle(request(secondUser));

  assert.equal(first.response.data.flags, 64);
  assert.equal(second.response.data.flags, 64);
  assert.deepEqual(studentLookups, [[GUILD, firstUser], [GUILD, secondUser]]);
});

test('daily financial briefing is private, practical, and stable for the member and day', async () => {
  const academy = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true, now: () => Date.UTC(2026, 8, 22) });
  const first = await academy.handle(interaction('briefing'));
  const second = await academy.handle(interaction('briefing'));
  assert.equal(first.response.data.flags, 64);
  assert.equal(first.response.data.content, second.response.data.content);
  assert.match(first.response.data.content, /Daily Financial Freedom Goal/);
  assert.match(first.response.data.content, /Today’s action/);
  assert.match(first.response.data.content, /Finish line/);
  assert.match(first.response.data.content, /general financial education/);
  assert.doesNotMatch(first.response.data.content, /guarantee|buy this stock|profit target/i);
});

test('daily discipline returns a private native Discord MP3 follow-up', async () => {
  const audio = Buffer.from('native-discord-mp3');
  const academy = createAcademyCommands({
    pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true,
    disciplineAudio: async ({ episodeId, userId }) => {
      assert.equal(episodeId, 1);
      assert.equal(userId, USER);
      return { audio, partCount: 3 };
    }
  });
  const result = await academy.handle(interaction('discipline'));
  assert.equal(result.response.data.flags, 64);
  assert.match(result.response.data.content, /no browser required/i);
  const followUp = await result.followUp();
  assert.equal(followUp.file.buffer, audio);
  assert.equal(followUp.file.contentType, 'audio/mpeg');
  assert.match(followUp.content, /The Art of Doing Nothing/);
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

test('the lesson hub primary action launches the Activity instead of a text-only lesson', async () => {
  const db = pool();
  const academy = createAcademyCommands({ pool: db, guildId: GUILD, monarchRoleId: MONARCH, enabled: true });
  const member = { user: { id: USER }, roles: [], permissions: '0' };
  for (const customId of ['academy:hub:lesson', LAUNCH_ID]) {
    const result = await academy.handle({ type: 3, guild_id: GUILD, member, data: { custom_id: customId } });
    assert.deepEqual(result.response, { type: 12 });
  }
  // Launching reads no member data: the Activity resolves the student itself
  // from the Discord-authorized session.
  assert.equal(db.calls.length, 0);
  const hub = ACADEMY_HUBS.find((entry) => entry.command === 'lesson');
  assert.equal(hub.channelId, '1551459038405992488');
});

test('Academy text surfaces offer the in-Discord Activity, never an external browser link', async () => {
  const academy = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true });
  const results = [
    await academy.handle(interaction('academy')),
    await academy.handle(interaction('lesson')),
    await academy.handle(component('academy:answer:1:1:B'))
  ];
  for (const result of results) {
    const buttons = result.response.data.components.flatMap((row) => row.components);
    assert.ok(buttons.some((item) => item.custom_id === LAUNCH_ID), 'launch control present');
    assert.ok(buttons.every((item) => !item.url), 'no link buttons that leave Discord');
  }
});

test('text lesson fallback explains the situation and offers a retry launch', async () => {
  const academy = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true });
  const result = await academy.handle({ type: 3, guild_id: GUILD, member: { user: { id: USER }, roles: [], permissions: '0' }, data: { custom_id: TEXT_LESSON_ID } });
  assert.equal(result.response.type, 4);
  assert.equal(result.response.data.flags, 64);
  assert.match(result.response.data.content, /did not open/);
  // A student with no saved position starts at the beginning of the curriculum,
  // which is now Module 0 Lesson 1 of the Start Here track.
  assert.match(result.response.data.embeds[0].title, /Module 0 · Lesson 1/);
  const buttons = result.response.data.components.flatMap((row) => row.components);
  const ids = buttons.map((item) => item.custom_id);
  assert.equal(new Set(ids).size, ids.length, 'Discord rejects duplicate custom_ids in one message');
  assert.ok(buttons.some((item) => item.custom_id === LAUNCH_ID && /Again/.test(item.label)));
  assert.ok(ids.includes('academy:start:0:1'));
});
