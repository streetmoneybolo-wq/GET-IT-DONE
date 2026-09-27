'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ACADEMY_HUBS, ENTRY_POINT_COMMAND, LAUNCH_ID, TEXT_LESSON_ID, createAcademyCommands } = require('./commands');
const { SEED_LESSONS } = require('./curriculum');
const TOTAL_LESSONS = 121 + require('./street-smarts').STREET_LESSONS.length; // the original 29 modules plus the Street Smarts track
const TOTAL_MODULES = 30; // modules 0 to 29

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
  assert.match(allowed.response.data.content, new RegExp(`${TOTAL_LESSONS} interactive`));
  assert.match(allowed.response.data.content, new RegExp(`${TOTAL_MODULES} modules`));
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

test('Academy publishes a complete college-level curriculum (the original 121 lessons plus Street Smarts)', () => {
  assert.equal(SEED_LESSONS.length, TOTAL_LESSONS);
  assert.equal(new Set(SEED_LESSONS.map((lesson) => `${lesson.moduleId}:${lesson.lessonId}`)).size, TOTAL_LESSONS);
  // Module 0 is the Start Here beginner track and sorts ahead of module 1.
  assert.deepEqual([...new Set(SEED_LESSONS.map((lesson) => lesson.moduleId))], Array.from({ length: TOTAL_MODULES }, (_, index) => index));
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
  assert.deepEqual(sources, { authored: TOTAL_LESSONS });

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

test('every module, module 0 and Street Smarts included, can be selected from lesson and quiz commands', () => {
  const academy = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true });
  for (const commandName of ['lesson', 'quiz']) {
    const definition = academy.definitions.find((entry) => entry.name === commandName);
    const moduleOption = definition.options.find((entry) => entry.name === 'module');
    // Discord rejects a value outside the range, so a floor of 1 would have made
    // the whole Start Here track unreachable from both slash commands.
    assert.equal(moduleOption.min_value, 0);
    assert.equal(moduleOption.max_value, TOTAL_MODULES - 1);
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

/* ---------- hub role gate (SML_ACADEMY_HUB_ROLE_GATE) and buy links ---------- */
const commandsModule = require('./commands');
const STUDENT_ROLE = '1553000000000000001';
const LOCKED_LESSON = 'academy:start:5:1';
const roleless = (custom_id, roles = [], permissions = '0') => ({ type: 3, guild_id: GUILD, member: { user: { id: USER }, roles, permissions }, data: { custom_id } });
const slash = (name, roles) => ({ type: 2, guild_id: GUILD, member: { user: { id: USER }, roles, permissions: '0' }, data: { name } });
const isUnlock = (result) => /part of the paid Making Easy Money Academy/.test(result.response.data.content);

test('hub gate off (default): a roleless member keeps every lesson button, exactly as before', async () => {
  const academy = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true });
  const result = await academy.handle(roleless(LOCKED_LESSON));
  assert.match(result.response.data.embeds[0].title, /Module 5 · Lesson 1/);
  assert.equal(isUnlock(result), false);
  const buy = await academy.handle(roleless(commandsModule.BUY_ID));
  assert.equal(buy.response.data.content, 'This Academy control is no longer valid.', 'the buy button does not exist while links are off');
});

test('hub gate on: locked lessons get a private unlock note, free preview lessons and the launcher stay open', async () => {
  const academy = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true, hubRoleGate: true });
  const locked = await academy.handle(roleless(LOCKED_LESSON));
  assert.equal(isUnlock(locked), true);
  assert.equal(locked.response.data.flags, 64);
  assert.deepEqual(locked.response.data.components, [], 'no buy link while SML_ACADEMY_BILLING_IN_DISCORD_LINKS is off');
  for (const id of ['academy:start:0:1', 'academy:continue:0:20', 'academy:start:29:10', 'academy:flash:29:1']) {
    const open = await academy.handle(roleless(id));
    assert.equal(isUnlock(open), false, `${id} is a free preview lesson`);
  }
  assert.equal(isUnlock(await academy.handle(roleless('academy:start:29:11'))), true);
  assert.equal(isUnlock(await academy.handle(roleless('academy:answer:5:1:B'))), true, 'answers to locked lessons are gated too');
  assert.deepEqual((await academy.handle(roleless(LAUNCH_ID))).response, { type: 12 }, 'the Activity has its own server-side gate');
  assert.equal(isUnlock(await academy.handle(roleless('academy:hub:quiz'))), true, 'the module 1 quiz is locked');
  assert.equal(isUnlock(await academy.handle(roleless('academy:hub:academy'))), false, 'the welcome card stays open');
  assert.equal(isUnlock(await academy.handle(roleless('academy:hub:glossary'))), false);
  const withRole = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true, hubRoleGate: true, accessRoleIds: [STUDENT_ROLE] });
  assert.equal(isUnlock(await withRole.handle(roleless(LOCKED_LESSON, [STUDENT_ROLE]))), false, 'an Academy Student opens every lesson');
  assert.equal(isUnlock(await academy.handle(roleless(LOCKED_LESSON, [MONARCH]))), false, 'Monarch is admitted by default');
  assert.equal(isUnlock(await academy.handle(roleless(LOCKED_LESSON, [], '8'))), false, 'administrators are admitted');
});

test('SML_ACADEMY_MONARCH_ACCESS=0 drops Monarch from the hub; ACCESS roles reach the slash commands', async () => {
  const noMonarch = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true, hubRoleGate: true, monarchAccess: false });
  assert.equal(isUnlock(await noMonarch.handle(roleless(LOCKED_LESSON, [MONARCH]))), true);
  assert.match((await noMonarch.handle(slash('progress', [MONARCH]))).response.data.content, /not available/);
  const students = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true, accessRoleIds: [STUDENT_ROLE] });
  assert.doesNotMatch((await students.handle(slash('progress', [STUDENT_ROLE]))).response.data.content, /not available/);
  assert.match((await students.handle(slash('progress', []))).response.data.content, /not available/);
});

test('with SML_ACADEMY_BILLING_IN_DISCORD_LINKS the unlock note carries a one-time handoff link for the clicking member', async () => {
  const minted = [];
  const handoff = { mint: async (request) => { minted.push(request); return { ok: true, url: 'https://making-easy-money-academy.onrender.com/v1/academy/billing/start?h=abc' }; } };
  const academy = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true, hubRoleGate: true, inDiscordLinks: true, handoff });
  const locked = await academy.handle(roleless(LOCKED_LESSON));
  assert.deepEqual(locked.response.data.components, [{ type: 1, components: [{ type: 2, style: 5, label: 'Get Academy access', url: 'https://making-easy-money-academy.onrender.com/v1/academy/billing/start?h=abc' }] }]);
  assert.deepEqual(minted, [{ discordUserId: USER, guildId: GUILD, source: 'hub' }]);
  const buy = await academy.handle(roleless(commandsModule.BUY_ID));
  assert.equal(buy.response.data.flags, 64);
  assert.equal(buy.response.data.components[0].components[0].style, 5);
  const broken = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true, hubRoleGate: true, inDiscordLinks: true,
    handoff: { mint: async () => ({ ok: false, code: 'handoff_unavailable' }) } });
  const fallback = await broken.handle(roleless(LOCKED_LESSON));
  assert.equal(isUnlock(fallback), true);
  assert.deepEqual(fallback.response.data.components, [], 'a failed handoff still explains, without a link');
  const insecure = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true, hubRoleGate: true, inDiscordLinks: true,
    handoff: { mint: async () => ({ ok: true, url: 'http://insecure.example/pay' }) } });
  assert.deepEqual((await insecure.handle(roleless(LOCKED_LESSON))).response.data.components, []);
});

test('onMemberSeen hears every Academy button click and never delays or breaks the reply', async () => {
  const seen = [];
  const academy = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true, onMemberSeen: (id) => { seen.push(id); } });
  await academy.handle(roleless('academy:start:0:1'));
  await academy.handle(interaction('academy'));
  assert.deepEqual(seen, [USER], 'components only');
  const throwing = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true, onMemberSeen: () => { throw new Error('db down'); } });
  assert.match((await throwing.handle(roleless('academy:start:0:1'))).response.data.embeds[0].title, /Module 0/);
  const rejecting = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true, onMemberSeen: async () => { throw new Error('db down'); } });
  assert.match((await rejecting.handle(roleless('academy:start:0:1'))).response.data.embeds[0].title, /Module 0/);
});

test('academyHubGateOptions maps getConfig() with everything off by default', () => {
  const { getConfig } = require('../config');
  const off = commandsModule.academyHubGateOptions(getConfig({ DATABASE_URL: 'x' }));
  assert.deepEqual(off, { accessRoleIds: [], memberRoleIds: [], monarchAccess: true, hubRoleGate: false, freePreview: 'M0,M29:1-10', inDiscordLinks: false, handoff: null, onMemberSeen: null });
  const handoff = { mint: async () => ({ ok: false }) };
  const on = commandsModule.academyHubGateOptions(getConfig({ DATABASE_URL: 'x', SML_ACADEMY_ACCESS_ROLE_IDS: STUDENT_ROLE, SML_ACADEMY_BILLING_LIFETIME_ROLE_ID: '1553000000000000002',
    SML_ACADEMY_MONARCH_ACCESS: '0', SML_ACADEMY_HUB_ROLE_GATE: '1', SML_ACADEMY_BILLING_IN_DISCORD_LINKS: '1', SML_ACADEMY_FREE_PREVIEW: 'M0' }), { handoff });
  assert.deepEqual(on.accessRoleIds, [STUDENT_ROLE]);
  assert.deepEqual(on.memberRoleIds, ['1553000000000000002']);
  assert.equal(on.monarchAccess, false);
  assert.equal(on.hubRoleGate, true);
  assert.equal(on.inDiscordLinks, true);
  assert.equal(on.freePreview, 'M0');
  assert.equal(on.handoff, handoff);
});

test('hub gate on: the text lesson fallback returns the unlock note untouched when the next lesson is locked', async () => {
  const advanced = { async query(sql) { if (sql.includes('academy_students') && sql.includes('RETURNING *')) return { rows: [{ id: 42, xp: 0, current_module: 5, current_lesson: 1 }], rowCount: 1 }; return { rows: [], rowCount: 1 }; } };
  const gated = createAcademyCommands({ pool: advanced, guildId: GUILD, monarchRoleId: MONARCH, enabled: true, hubRoleGate: true });
  const locked = await gated.handle(roleless(TEXT_LESSON_ID));
  assert.equal(isUnlock(locked), true);
  assert.deepEqual(locked.response.data.embeds, []);
  const open = createAcademyCommands({ pool: advanced, guildId: GUILD, monarchRoleId: MONARCH, enabled: true });
  const text = await open.handle(roleless(TEXT_LESSON_ID));
  assert.match(text.response.data.content, /Text version of your next lesson/, 'gate off: unchanged');
  assert.match(text.response.data.embeds[0].title, /Module 5 · Lesson 1/);
});

/* Moved from the part review (review-gate.test.js). platform/academy/runtime.js
   is outside this change: it must spread academyHubGateOptions(config, { pool })
   into createAcademyCommands for the hub flags to reach Discord. This pins
   what that one-line spread does, straight from getConfig(). */
test('academyHubGateOptions(getConfig(env), { pool }) applies SML_ACADEMY_HUB_ROLE_GATE, SML_ACADEMY_MONARCH_ACCESS=0 and SML_ACADEMY_ACCESS_ROLE_IDS', async () => {
  const { getConfig } = require('../config');
  const config = getConfig({ DATABASE_URL: 'postgres://review', SML_ACADEMY_HUB_ROLE_GATE: '1', SML_ACADEMY_MONARCH_ACCESS: '0', SML_ACADEMY_ACCESS_ROLE_IDS: STUDENT_ROLE });
  const academy = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: config.academyMonarchRoleId, enabled: true,
    ...commandsModule.academyHubGateOptions(config, { pool: pool() }) });
  assert.equal(isUnlock(await academy.handle(roleless(LOCKED_LESSON))), true, 'SML_ACADEMY_HUB_ROLE_GATE=1: a roleless member gets the unlock note');
  assert.match((await academy.handle(slash('progress', [MONARCH]))).response.data.content, /not available/, 'SML_ACADEMY_MONARCH_ACCESS=0: Monarch loses the hub');
  assert.doesNotMatch((await academy.handle(slash('progress', [STUDENT_ROLE]))).response.data.content, /not available/, 'SML_ACADEMY_ACCESS_ROLE_IDS: an Academy Student reaches the hub');
  const defaults = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true,
    ...commandsModule.academyHubGateOptions(getConfig({ DATABASE_URL: 'postgres://review' }), { pool: pool() }) });
  assert.equal(isUnlock(await defaults.handle(roleless(LOCKED_LESSON))), false, 'flags unset: the hub is unchanged');
  assert.doesNotMatch((await defaults.handle(slash('progress', [MONARCH]))).response.data.content, /not available/);
});

test('with a pool, hub buy links are minted in process (one handoff row, only its hash), and only with IN_DISCORD_LINKS and an https public URL', async () => {
  const { getConfig } = require('../config');
  const { hashCode } = require('./billing/handoff');
  const inserts = [];
  const handoffPool = { query: async (sql, params) => { inserts.push({ sql, params }); return { rows: [], rowCount: 1 }; } };
  const env = { DATABASE_URL: 'postgres://review', SML_ACADEMY_HUB_ROLE_GATE: '1', SML_ACADEMY_BILLING_IN_DISCORD_LINKS: '1', SML_ACADEMY_BILLING_PUBLIC_URL: 'https://making-easy-money-academy.onrender.com' };
  const options = commandsModule.academyHubGateOptions(getConfig(env), { pool: handoffPool });
  assert.equal(options.handoff.configured, true);
  const academy = createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true, ...options });
  const locked = await academy.handle(roleless(LOCKED_LESSON));
  const link = locked.response.data.components[0].components[0];
  assert.equal(link.style, 5);
  const url = new URL(link.url);
  assert.equal(url.origin, 'https://making-easy-money-academy.onrender.com');
  assert.equal(url.pathname, '/v1/academy/billing/start');
  assert.equal(inserts.length, 1);
  assert.match(inserts[0].sql, /INSERT INTO academy_billing_handoffs/);
  assert.deepEqual(inserts[0].params, [hashCode(url.searchParams.get('h')), USER, GUILD, 'hub']);
  assert.equal(commandsModule.academyHubGateOptions(getConfig({ ...env, SML_ACADEMY_BILLING_IN_DISCORD_LINKS: '' }), { pool: handoffPool }).handoff, null, 'links off: no minter');
  assert.equal(commandsModule.academyHubGateOptions(getConfig(env)).handoff, null, 'no pool: no minter');
  const insecure = commandsModule.academyHubGateOptions(getConfig({ ...env, SML_ACADEMY_BILLING_PUBLIC_URL: 'http://making-easy-money-academy.onrender.com' }), { pool: handoffPool });
  assert.equal(insecure.handoff.configured, false);
  const fallback = await createAcademyCommands({ pool: pool(), guildId: GUILD, monarchRoleId: MONARCH, enabled: true, ...insecure }).handle(roleless(LOCKED_LESSON));
  assert.equal(isUnlock(fallback), true);
  assert.deepEqual(fallback.response.data.components, [], 'an unconfigured minter gives the note without a link');
  assert.equal(inserts.length, 1);
});
