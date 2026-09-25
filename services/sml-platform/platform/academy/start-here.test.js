'use strict';

/* Guards for module 0, "Start Here": the beginner track.
 *
 * Before it existed, 92% of the Academy was Intermediate or Advanced and a
 * first-time investor had nowhere to begin. These tests protect the two things
 * that make the track work: it holds to the same lesson contract as the other
 * 28 modules (so the voice, the slide designer and the Activity deck need no
 * special case), and it comes FIRST everywhere a learner meets the curriculum.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const { createServer } = require('../server');
const { SEED_LESSONS } = require('./curriculum');
const { START_HERE_LESSONS, START_HERE_MODULE_ID } = require('./start-here');
const { lessonParts, EXAMPLE_LEAD, CHECK_LEAD } = require('./lesson-parts');
const { validateExample } = require('./examples');
const { quizFor, validateQuiz, LETTERS } = require('./quizzes');
const { narrationFor } = require('../academy-voice');
const { partsFor, MAX_CACHE_ITEMS } = require('../academy-slide-designer');
const { academyCurriculumScript } = require('../academy-activity-curriculum');
const { LESSON_COUNT, MODULE_COUNT, FIRST_MODULE, FIRST_LESSON } = require('./commands');
const TOTAL_LESSONS = 121 + require('./street-smarts').STREET_LESSONS.length; // the original 29 modules plus the Street Smarts track

const START_HERE = SEED_LESSONS.filter((lesson) => lesson.moduleId === START_HERE_MODULE_ID);
const key = (lesson) => `${lesson.moduleId}.${lesson.lessonId}`;

async function withServer(run) {
  const server = createServer({
    checkDatabase: async () => true,
    acceptWordPressEvent: async () => 'accepted',
    logger: () => {},
    now: () => 1_700_000_000_000,
    academyAppId: '1551336038713139370'
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('the Start Here track is a complete module of twenty beginner lessons', () => {
  assert.equal(START_HERE_MODULE_ID, 0);
  assert.equal(START_HERE_LESSONS.length, 20);
  assert.equal(START_HERE.length, 20);
  assert.deepEqual(START_HERE.map((lesson) => lesson.lessonId), Array.from({ length: 20 }, (_, index) => index + 1));
  // Three authoring files, one module: no id may be claimed twice.
  assert.equal(new Set(START_HERE.map(key)).size, 20);
});

test('every Start Here lesson meets the same contract as the rest of the curriculum', () => {
  for (const lesson of START_HERE) {
    const id = key(lesson);

    // The whole track is for someone who has never bought a share.
    assert.equal(lesson.level, 'Foundation', `${id}: beginner lessons are Foundation level`);
    assert.equal(lesson.color, 0x00E676, `${id}: Foundation colour`);
    assert.ok(lesson.title && lesson.description, `${id}: needs a title and a description`);
    assert.match(lesson.duration, /^\d+ min$/, `${id}: duration`);

    // Exactly three steps, the last one a lab. commands.test.js enforces this
    // across the whole curriculum; it is repeated here so a Start Here-only
    // regression names the module that broke.
    assert.equal(lesson.steps.length, 3, `${id}: exactly three steps`);
    for (const step of lesson.steps) assert.equal(typeof step, 'string', `${id}: steps are strings`);
    assert.match(lesson.steps[2], /lab:/i, `${id}: third step is a lab`);

    // A simulation the Activity deck can actually run.
    assert.ok(lesson.simulation, `${id}: has a simulation`);
    assert.ok(Array.isArray(lesson.simulation.rounds), `${id}: simulation.rounds is an array`);
    assert.ok(lesson.simulation.rounds.length >= 3, `${id}: simulation needs at least three rounds`);

    // An authored whiteboard example, not the auto fallback.
    assert.ok(lesson.example, `${id}: has a worked example`);
    assert.equal(lesson.example.source, 'authored', `${id}: example is authored, not generated`);
    assert.equal(lesson.example.id, id, `${id}: example is keyed to this lesson`);
    assert.deepEqual(validateExample(lesson.example), [], id);

    // An authored knowledge check, and the lesson uses that exact check.
    const authored = quizFor(lesson.moduleId, lesson.lessonId);
    assert.ok(authored, `${id}: no authored knowledge check`);
    assert.deepEqual(lesson.question, authored, `${id}: lesson question and authored check have drifted apart`);
    assert.deepEqual(validateQuiz(lesson.question, id), [], id);
    assert.ok(LETTERS.includes(lesson.question.correct), `${id}: answer letter`);

    // Six narration parts: title, example, three steps, knowledge check last.
    const parts = lessonParts(lesson);
    assert.equal(parts.length, 6, `${id}: six narration parts`);
    assert.deepEqual(lesson.parts, parts, id);
    assert.equal(lesson.exampleIndex, 1, `${id}: the example is spoken second`);
    assert.deepEqual(parts, [
      lesson.title,
      `${EXAMPLE_LEAD} ${lesson.example.say.join(' ')}`,
      ...lesson.steps,
      `${CHECK_LEAD}${lesson.question.prompt}`
    ], id);

    // Voice, slide designer and client all read the same part list.
    assert.deepEqual(partsFor(lesson), parts, id);
    assert.deepEqual(narrationFor(lesson).split('\n\n'), parts, id);
    assert.match(lesson.narrationVersion, /^[0-9a-f]{12}$/, id);
  }
});

test('no Start Here slide asks a beginner to hold more than one breath of narration', () => {
  /* Every step is read aloud over a single slide. Step 2 was where caveats,
   * jurisdiction notes, cross-references and second concepts collected: nine
   * of the twenty ran past 100 words and one reached 172, so a learner got a
   * clear idea in step 1 and lost it in step 2. The ceilings below are the
   * ones the track now holds to, and they match the whiteboard's own limit of
   * 25 words a spoken sentence (LIMITS.sayWords in examples.js).
   *
   * The lab step is exempt from the sentence rule: it is one instruction for
   * the learner to carry out, not an explanation to follow by ear. */
  const STEP_WORDS = 100;
  const SENTENCE_WORDS = 25;
  const words = (text) => (String(text).match(/\S+/g) || []).length;
  for (const lesson of START_HERE) {
    lesson.steps.forEach((step, index) => {
      assert.ok(
        words(step) <= STEP_WORDS,
        `${key(lesson)} step ${index + 1} is ${words(step)} words; keep a narrated slide under ${STEP_WORDS}`
      );
      if (index === lesson.steps.length - 1) return;
      for (const sentence of step.split(/(?<=[.!?])\s+/)) {
        assert.ok(
          words(sentence) <= SENTENCE_WORDS,
          `${key(lesson)} step ${index + 1}: "${sentence}" is ${words(sentence)} words; split it at ${SENTENCE_WORDS}`
        );
      }
    });
  }
});

test('Start Here spells out "United States" rather than leaving "US" to the voice', () => {
  /* Text-to-speech reads a bare "US" as the pronoun "us", so "FINRA, which
   * oversees US brokerage firms" came out of the cloned voice as "oversees us
   * brokerage firms" - in the two options lessons, which carry the risk
   * warnings and the only outside attribution in the track. */
  for (const lesson of START_HERE) {
    const spoken = [lesson.title, lesson.description, ...lesson.steps, ...lesson.example.say,
      lesson.question.prompt, ...Object.values(lesson.question.options), lesson.question.explanation].join(' ');
    assert.doesNotMatch(spoken, /\bUS\b/, `${key(lesson)}: write "the United States"; the voice reads a bare "US" as "us"`);
  }
});

test('the Start Here rebalancing example actually puts all four slices back', () => {
  /* 0.16 is the one lesson whose lab asks the learner to work out the trades
   * themselves, so its arithmetic has to close. An earlier version moved two
   * of the four slices and then claimed all four were back on target: a
   * beginner who did the exercise got a different answer from the deck. */
  const { facts } = START_HERE.find((lesson) => lesson.lessonId === 16).example;
  const { home, world, bond, cash, total, target, sellHome, buyBond, leftover } = facts;
  assert.equal(home + world + bond + cash, total, '0.16: the four slices must add up to the total');
  assert.equal(target * 4, total, '0.16: the target is a quarter of the total');
  assert.equal(sellHome - buyBond, leftover, '0.16: the leftover is what the sale did not spend');
  assert.deepEqual(
    [home - sellHome, world, bond + buyBond, cash + leftover],
    [target, target, target, target],
    '0.16: after the trades the board says "all four on the target", so all four must land on it'
  );
});

test('the Start Here answer letter moves around and never runs three deep', () => {
  const sequence = START_HERE.map((lesson) => lesson.question.correct);
  for (const letter of LETTERS) {
    assert.ok(sequence.includes(letter), `answer ${letter} is never used in the Start Here track`);
  }
  let run = 1;
  for (let index = 1; index < sequence.length; index += 1) {
    run = sequence[index] === sequence[index - 1] ? run + 1 : 1;
    assert.ok(run <= 2, `${key(START_HERE[index])}: ${run} lessons in a row answer ${sequence[index]}`);
  }
});

test('no Start Here answer can be found by copying a phrase out of its own lesson', () => {
  const normalise = (text) => String(text)
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/,(?=\d)/g, '')
    .replace(/[^a-z0-9$%.]+/g, ' ')
    .split(' ')
    .map((token) => token.replace(/\.+$/, ''))
    .filter(Boolean)
    .join(' ');
  for (const lesson of START_HERE) {
    const answer = lesson.question.options[lesson.question.correct];
    const haystack = ` ${normalise([...lesson.steps, ...lesson.example.say].join(' '))} `;
    assert.ok(
      !haystack.includes(` ${normalise(answer)} `),
      `${key(lesson)}: the answer "${answer}" is written out in the lesson text`
    );
  }
});

test('Start Here teaches rules as rules, never as advice or a promise', () => {
  /* The track covers taxes, fees, options and "getting rich", which is exactly
   * where educational material slides into advice. These are the phrasings the
   * brief rules out. */
  const BANNED = [
    /\byou should\b/i,
    /\bguaranteed?\b/i,
    /\bwill (?:make|earn|return|double)\b/i,
    /\brisk[- ]free\b/i,
    /\bsecret\b/i,
    /\bact (?:now|fast)\b/i,
    /\bdon'?t miss\b/i,
    /\b(?:brian|dave|buster|clear\s?value)\b/i
  ];
  for (const lesson of START_HERE) {
    const text = JSON.stringify([
      lesson.title, lesson.description, lesson.steps, lesson.question, lesson.example
    ]);
    for (const pattern of BANNED) {
      assert.doesNotMatch(text, pattern, `${key(lesson)} contains ${pattern}`);
    }
  }

  /* Country-specific rules must say so. Every lesson that names a jurisdiction
   * has to admit, somewhere in the same lesson, that the rule is local. */
  const named = START_HERE.filter((lesson) => /United States|\bUS\b|FINRA/.test([...lesson.steps, ...lesson.example.say].join(' ')));
  assert.ok(named.length >= 3, 'expected the settlement, tax and options lessons to name a jurisdiction');
  for (const lesson of named) {
    const text = [...lesson.steps, lesson.description, ...lesson.example.say, lesson.question.explanation].join(' ');
    assert.match(
      text,
      /where you live|your own|by country|differ|elsewhere|local|varies|worth checking|many countries|anywhere/i,
      `${key(lesson)} names a country's rule without saying the rule is local`
    );
  }
});

test('Start Here comes first everywhere a learner meets the curriculum', () => {
  // 1. In the seed order, which drives the picker, the narration script and
  //    every "next lesson" walk.
  assert.equal(SEED_LESSONS[0].moduleId, START_HERE_MODULE_ID);
  assert.equal(SEED_LESSONS[0].lessonId, 1);
  assert.deepEqual(SEED_LESSONS.slice(0, 20).map(key), START_HERE.map(key));
  const moduleIds = [...new Set(SEED_LESSONS.map((lesson) => lesson.moduleId))];
  assert.deepEqual(moduleIds, Array.from({ length: 30 }, (_, index) => index)); // 0 to 29: Street Smarts is module 29
  assert.equal(moduleIds[0], 0, 'module 0 sorts ahead of module 1');

  // 2. In the totals the copy and the command bounds are built from.
  assert.equal(LESSON_COUNT, TOTAL_LESSONS);
  assert.equal(MODULE_COUNT, 30);
  assert.equal(FIRST_MODULE, 0);
  assert.equal(key(FIRST_LESSON), '0.1');

  // 3. In the slide-design cache, which must hold one entry per lesson.
  assert.equal(MAX_CACHE_ITEMS, SEED_LESSONS.length);
});

test('the indicator curriculum leaves module 0 alone', () => {
  /* attachIndicatorCurriculum() appends an "Indicator lab:" paragraph to the
   * last step of the lessons named in INDICATOR_CATEGORIES. Those are all in
   * modules 1-13; if one were ever pointed at module 0 it would bolt a wall of
   * indicator jargon onto a lesson written for someone who has never bought a
   * share, and blow the beginner reading level. */
  for (const lesson of START_HERE) {
    assert.doesNotMatch(lesson.steps.join(' '), /Indicator lab:/, `${key(lesson)} picked up indicator text`);
    assert.doesNotMatch(lesson.steps.join(' '), /Quote-statistics panel:/, key(lesson));
  }
  const authored = START_HERE_LESSONS.find((lesson) => lesson.lessonId === 1);
  const seeded = SEED_LESSONS.find((lesson) => lesson.moduleId === 0 && lesson.lessonId === 1);
  assert.deepEqual(seeded.steps, authored.steps, 'module 0 steps survive the curriculum pipeline unchanged');
});

test('the Start Here track is reachable in the served Activity page', async () => {
  await withServer(async (base) => {
    const page = await fetch(`${base}/academy-activity/`);
    assert.equal(page.status, 200);
    const html = await page.text();

    // The track filter: without this button the beginner lessons are only
    // reachable by scrolling past 28 modules of advanced material under "All".
    assert.match(html, /\['Start Here',\[0\]\]/);
    assert.ok(
      html.indexOf("['Start Here',[0]]") < html.indexOf("['Day Trading'"),
      'the Start Here track sits first among the named tracks'
    );
    // The intro overlay pre-warms the design for the lesson the deck opens on,
    // which is now 0.1 rather than 1.1.
    assert.match(html, /slide-design\?moduleId=0&lessonId=1/);
    assert.doesNotMatch(html, /slide-design\?moduleId=1&lessonId=1/);

    // The picker labels its groups "Module <id> — <first lesson title>", so
    // module 0 needs no special case to render.
    assert.match(html, /group\.label='Module '\+lesson\.moduleId/);

    // The curriculum the page fetches leads with module 0.
    const payload = await (await fetch(`${base}/academy-activity/curriculum`)).json();
    assert.equal(payload.lessons.length, TOTAL_LESSONS);
    assert.equal(payload.lessons[0].moduleId, 0);
    assert.equal(payload.lessons[0].lessonId, 1);
    assert.equal(payload.lessons.filter((lesson) => lesson.moduleId === 0).length, 20);
    for (const lesson of payload.lessons.filter((entry) => entry.moduleId === 0)) {
      assert.equal(lesson.level, 'Foundation');
      assert.equal(lesson.parts.length, 6);
      assert.ok(lesson.example, `${key(lesson)} ships its whiteboard example to the client`);
      assert.ok(lesson.simulation.rounds.length >= 3);
    }
  });
});

test('the injected curriculum script counts the lessons instead of naming a number', () => {
  const script = academyCurriculumScript(SEED_LESSONS);
  assert.match(script, new RegExp(`All ${TOTAL_LESSONS} Academy lessons complete\\.`));
  assert.doesNotMatch(script, /All 101 Academy lessons complete\./);
});
