'use strict';

/* Guards for module 29, "Street Smarts": plain-words lessons on the questions new investors actually ask.
 * The module is authored in five sibling files (street-a..e) by different authors, so every rule the track holds to is checked here:
 * the same lesson contract as every other module, a valid authored whiteboard example and knowledge check, a spoken-length budget,
 * no advice, no real companies, and answer letters that move around. */

const assert = require('node:assert/strict');
const test = require('node:test');

const { SEED_LESSONS } = require('./curriculum');
const { STREET_LESSONS, STREET_MODULE_ID } = require('./street-smarts');
const { lessonParts, EXAMPLE_LEAD, CHECK_LEAD } = require('./lesson-parts');
const { validateExample } = require('./examples');
const { validateQuiz, LETTERS } = require('./quizzes');
const { narrationFor } = require('../academy-voice');
const { partsFor } = require('../academy-slide-designer');

const STREET = SEED_LESSONS.filter((lesson) => lesson.moduleId === STREET_MODULE_ID);
const key = (lesson) => `${lesson.moduleId}.${lesson.lessonId}`;
const words = (text) => (String(text).match(/\S+/g) || []).length;
const ready = STREET.length >= 12; // the track-wide distribution rules only make sense once the track exists

test('Street Smarts is module 29 and every lesson id is unique and in range', () => {
  assert.equal(STREET_MODULE_ID, 29);
  assert.equal(STREET.length, STREET_LESSONS.length);
  assert.equal(new Set(STREET.map(key)).size, STREET.length);
  for (const lesson of STREET) assert.ok(Number.isInteger(lesson.lessonId) && lesson.lessonId >= 1 && lesson.lessonId <= 40, key(lesson));
});

test('every Street Smarts lesson meets the same contract as the rest of the curriculum', () => {
  for (const lesson of STREET) {
    const id = key(lesson);
    assert.equal(lesson.level, 'Foundation', `${id}: Street Smarts is Foundation level`);
    assert.equal(lesson.color, 0x00E676, `${id}: Foundation colour`);
    assert.ok(lesson.title && lesson.description, `${id}: needs a title and a description`);
    assert.ok(lesson.title.length <= 70, `${id}: title too long for a slide`);
    assert.match(lesson.duration, /^\d+ min$/, `${id}: duration`);
    assert.equal(lesson.steps.length, 3, `${id}: exactly three steps`);
    for (const step of lesson.steps) assert.equal(typeof step, 'string', `${id}: steps are strings`);
    assert.match(lesson.steps[2], /^Practice lab:/, `${id}: third step is a lab`);
    assert.ok(lesson.simulation && Array.isArray(lesson.simulation.rounds) && lesson.simulation.rounds.length >= 3, `${id}: simulation`);
    assert.ok(lesson.example, `${id}: has a worked example`);
    assert.equal(lesson.example.source, 'authored', `${id}: example is authored, not generated`);
    assert.equal(lesson.example.id, id, `${id}: example is keyed to this lesson`);
    assert.deepEqual(validateExample(lesson.example), [], id);
    assert.deepEqual(validateQuiz(lesson.question, id), [], id);
    assert.ok(LETTERS.includes(lesson.question.correct), `${id}: answer letter`);

    const parts = lessonParts(lesson);
    assert.equal(parts.length, 6, `${id}: six narration parts`);
    assert.deepEqual(lesson.parts, parts, id);
    assert.equal(lesson.exampleIndex, 1, `${id}: the example is spoken second`);
    assert.deepEqual(parts, [lesson.title, `${EXAMPLE_LEAD} ${lesson.example.say.join(' ')}`, ...lesson.steps, `${CHECK_LEAD}${lesson.question.prompt}`], id);
    assert.deepEqual(partsFor(lesson), parts, id);
    assert.deepEqual(narrationFor(lesson).split('\n\n'), parts, id);
    assert.match(lesson.narrationVersion, /^[0-9a-f]{12}$/, id);
  }
});

test('no Street Smarts slide asks a learner to hold more than one breath of narration', () => {
  for (const lesson of STREET) {
    lesson.steps.forEach((step, index) => {
      assert.ok(words(step) <= 100, `${key(lesson)} step ${index + 1} is ${words(step)} words; keep a narrated slide under 100`);
      if (index === lesson.steps.length - 1) return;
      for (const sentence of step.split(/(?<=[.!?])\s+/)) assert.ok(words(sentence) <= 25, `${key(lesson)} step ${index + 1}: "${sentence}" is ${words(sentence)} words; split it at 25`);
    });
    assert.ok(words(lesson.question.prompt) <= 40, `${key(lesson)}: the question is too long to hear once`);
  }
});

test('Street Smarts is written to be heard: no bare "US", no symbols the voice reads badly', () => {
  for (const lesson of STREET) {
    const spoken = [lesson.title, lesson.description, ...lesson.steps, ...lesson.example.say, lesson.question.prompt, ...Object.values(lesson.question.options), lesson.question.explanation].join(' ');
    assert.doesNotMatch(spoken, /\bUS\b/, `${key(lesson)}: write "the United States"; the voice reads a bare "US" as "us"`);
    assert.doesNotMatch(spoken, /[<>{}\[\]#@~_`|\\]/, `${key(lesson)}: a symbol the voice would read literally`);
  }
});

test('Street Smarts teaches, never advises or promises, and names no real company or ticker', () => {
  const BANNED = [
    /\byou should\b/i, /\bguaranteed?\b/i, /\bwill (?:make|earn|return|double)\b/i, /\brisk[- ]free\b/i, /\bsecret\b/i, /\bact (?:now|fast)\b/i, /\bdon'?t miss\b/i,
    /\bget rich quick\b/i, /\bcan'?t lose\b/i, /\b(?:brian|dave|buster|clear\s?value|martik)\b/i
  ];
  const REAL = /\b(?:apple|tesla|amazon|google|alphabet|microsoft|nvidia|meta|facebook|netflix|walmart|costco|disney|starbucks|mcdonald'?s|nike|coca[- ]cola|pepsi|ford|general motors|boeing|intel|amd|exxon|jpmorgan|goldman|morgan stanley|vanguard|fidelity|blackrock|schwab|robinhood|webull|berkshire|buffett|bitcoin|s&p|nasdaq|dow jones|spy|qqq|voo|vti)\b/i;
  for (const lesson of STREET) {
    const text = JSON.stringify([lesson.title, lesson.description, lesson.steps, lesson.question, lesson.example]);
    for (const pattern of BANNED) assert.doesNotMatch(text, pattern, `${key(lesson)} contains ${pattern}`);
    assert.doesNotMatch(text, REAL, `${key(lesson)} names a real company, fund or index: invent one`);
  }
});

test('the Street Smarts answer letter moves around and never runs three deep', { skip: !ready && 'needs the full track' }, () => {
  const sequence = STREET.map((lesson) => lesson.question.correct);
  for (const letter of LETTERS) assert.ok(sequence.includes(letter), `answer ${letter} is never used in the track`);
  const counts = Object.fromEntries(LETTERS.map((l) => [l, sequence.filter((x) => x === l).length]));
  const max = Math.ceil(sequence.length * 0.34);
  for (const letter of LETTERS) assert.ok(counts[letter] <= max, `answer ${letter} is right ${counts[letter]} times out of ${sequence.length}`);
  let run = 1;
  for (let index = 1; index < sequence.length; index += 1) {
    run = sequence[index] === sequence[index - 1] ? run + 1 : 1;
    assert.ok(run <= 2, `${key(STREET[index])}: ${run} lessons in a row answer ${sequence[index]}`);
  }
});

test('no Street Smarts answer can be found by copying a phrase out of its own lesson', () => {
  const normalise = (text) => String(text).toLowerCase().replace(/[‘’']/g, '').replace(/,(?=\d)/g, '').replace(/[^a-z0-9$%.]+/g, ' ').split(' ').map((t) => t.replace(/\.+$/, '')).filter(Boolean).join(' ');
  for (const lesson of STREET) {
    const answer = lesson.question.options[lesson.question.correct];
    const haystack = ` ${normalise([...lesson.steps, ...lesson.example.say].join(' '))} `;
    assert.ok(!haystack.includes(` ${normalise(answer)} `), `${key(lesson)}: the answer "${answer}" is written out in the lesson text`);
  }
});

test('every Street Smarts lesson has some personality: at least one light, everyday line in what is spoken', () => {
  /* The brief asks for plain words with everyday humour. A joke cannot be tested, but a lesson that reads like a textbook can be flagged:
   * each lesson must reach for at least one everyday, street-level picture (a shop, a food truck, a barbershop, a group chat, a side hustle, a sneaker drop...). */
  const EVERYDAY = /(?:barber|corner store|bodega|food truck|laundromat|sneaker|thrift|side hustle|group chat|cash app|cashapp|block party|cookout|car wash|nail salon|hair salon|wing spot|pizza|taco|tailor|flea market|swap meet|yard sale|garage sale|parking lot|bus stop|rent|paycheck|payday|hoodie|ramen|barbecue|bbq|mixtape|dj\b|open mic|hustle|neighborhood|apartment|landlord|snack|coupon|gym|streaming|subscription)/i;
  for (const lesson of STREET) {
    const spoken = [...lesson.steps, ...lesson.example.say].join(' ');
    assert.match(spoken, EVERYDAY, `${key(lesson)}: no everyday, street-level picture anywhere in the lesson`);
  }
});

test('Street Smarts comes after the core curriculum in the seed order (progress and the deck walk the same order)', () => {
  const order = SEED_LESSONS.map((lesson) => lesson.moduleId);
  const firstStreet = order.indexOf(STREET_MODULE_ID);
  if (firstStreet === -1) return;
  assert.ok(order.slice(firstStreet).every((m) => m === STREET_MODULE_ID), 'module 29 sits at the end, in one block');
});
