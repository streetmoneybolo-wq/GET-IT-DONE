'use strict';

/* The ONE place that decides what the Academy voice says for a lesson.
 * The ElevenLabs narration (academy-voice.js narrationFor), the slide designer
 * (academy-slide-designer.js partsFor) and the Activity client (lesson.parts in
 * the curriculum payload) all use lessonParts(), so slide counts, audio timing
 * and the knowledge check (always the LAST part) can never drift apart. */

const crypto = require('node:crypto');

const EXAMPLE_LEAD = 'Here is the simple version.';
const CHECK_LEAD = 'Knowledge check. ';

const validity = new WeakMap();

function sha12(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 12);
}

/* Returns the example when it passes the full contract validator, else null.
 * The validator lives in examples.js; it is required lazily because examples.js
 * itself requires this module. Frozen examples (everything the engine builds)
 * are validated once. */
function lessonExample(lesson) {
  const example = lesson && typeof lesson === 'object' ? lesson.example : null;
  if (!example || typeof example !== 'object') return null;
  if (validity.has(example)) return validity.get(example) ? example : null;
  let ok = false;
  try {
    ok = require('./examples').validateExample(example).length === 0;
  } catch (_) {
    ok = false;
  }
  if (Object.isFrozen(example)) validity.set(example, ok);
  return ok ? example : null;
}

function exampleText(example) {
  const say = example && Array.isArray(example.say)
    ? example.say.filter((sentence) => typeof sentence === 'string' && sentence.trim())
    : [];
  return say.length ? `${EXAMPLE_LEAD} ${say.join(' ')}` : '';
}

/* parts = [title, EXAMPLE_TEXT?, ...steps, 'Knowledge check. ' + prompt].filter(Boolean)
 * exampleIndex = position of EXAMPLE_TEXT in parts (always 1), or -1 when
 * there is none. The example only attaches after a title: a lesson without
 * one keeps its legacy parts, so the example can never become part 0 (the
 * Activity client only shows an example at an index above 0). */
function lessonPartsInfo(lesson) {
  const source = lesson && typeof lesson === 'object' ? lesson : {};
  const head = [source.title].filter(Boolean);
  const example = head.length ? lessonExample(source) : null;
  const text = example ? exampleText(example) : '';
  const steps = Array.isArray(source.steps) ? source.steps : [];
  const check = source.question && source.question.prompt ? CHECK_LEAD + source.question.prompt : '';
  const parts = [...head, text, ...steps, check].filter(Boolean);
  return { parts, exampleIndex: text ? 1 : -1, example: text ? example : null };
}

function lessonParts(lesson) {
  return lessonPartsInfo(lesson).parts;
}

function exampleIndexFor(lesson) {
  return lessonPartsInfo(lesson).exampleIndex;
}

function partsVersion(parts) {
  return sha12((Array.isArray(parts) ? parts : []).join('\n\n'));
}

/* First 12 hex chars of sha256(parts.join('\n\n')): identical to hashing the
 * exact text the voice sends to ElevenLabs. */
function narrationVersion(lesson) {
  return partsVersion(lessonParts(lesson));
}

/* First 12 hex chars of sha256 over every lesson's narrationVersion plus its
 * serialized example, in curriculum order. Changes whenever any narration or
 * any whiteboard frame changes. */
function curriculumVersion(lessons) {
  const hash = crypto.createHash('sha256');
  for (const lesson of Array.isArray(lessons) ? lessons : []) {
    const example = lesson && typeof lesson === 'object' && lesson.example ? lesson.example : null;
    hash.update(`${narrationVersion(lesson)}\0${JSON.stringify(example)}\n`);
  }
  return hash.digest('hex').slice(0, 12);
}

module.exports = {
  EXAMPLE_LEAD,
  CHECK_LEAD,
  exampleText,
  lessonExample,
  lessonParts,
  lessonPartsInfo,
  exampleIndexFor,
  partsVersion,
  narrationVersion,
  curriculumVersion
};
