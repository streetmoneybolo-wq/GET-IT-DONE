#!/usr/bin/env node
'use strict';

/*
 * Regenerates content/making-easy-money-academy-101-lesson-voice-script.md.
 * The 101 in the FILE NAME is historical and deliberately frozen, so the
 * committed path stays stable; the lesson count inside the document is counted
 * from the curriculum and moves with it.
 * Deterministic and offline: it only reads the curriculum.
 *
 * Each lesson's spoken lines come from lessonPartsInfo() in
 * platform/academy/lesson-parts.js, the same parts the ElevenLabs voice, the
 * slide designer and the Activity deck use: the title (as the heading), the
 * whiteboard "simple version" example, the three steps and the knowledge
 * check, which stays last. The description, answer options, answer and
 * reflection prompt are extra tour material for the long-form script.
 */

const fs = require('node:fs');
const path = require('node:path');
const { SEED_LESSONS } = require('../platform/academy/curriculum');
const { lessonPartsInfo } = require('../platform/academy/lesson-parts');

const OUTPUT = path.resolve(__dirname, '../content/making-easy-money-academy-101-lesson-voice-script.md');

function introduction(lessons) {
  const moduleCount = new Set(lessons.map((lesson) => lesson.moduleId)).size;
  return `# Making Easy Money Academy: ${lessons.length}-Lesson Voice Script

## Voice-generation directions — do not read this section aloud

Use only a voice that the account owner has supplied or has permission to use. Read the spoken script naturally in a confident, conversational teaching voice. Do not imitate any third party. Target 125 to 140 words per minute. Pause briefly at headings, after questions, and between lessons. Emphasize definitions without sounding theatrical. Say ticker symbols one letter at a time when applicable. Never imply guaranteed returns. Preserve the educational-risk statements.

## Spoken script

Welcome to Making Easy Money Academy.

This is a complete guided tour through ${lessons.length} interactive lessons organized across ${moduleCount} modules. The purpose is not to hand you predictions. It is to teach you how markets work, how evidence should be tested, how risk should be controlled, and how professional decisions are made when the future is uncertain.

Nothing in this program is financial, legal, tax, or investment advice. Markets can move quickly. Options can expire worthless. Short positions can create substantial losses. Leverage can magnify mistakes. Every example is educational, and every simulated trade should be treated as a process exercise rather than a promise.

As you listen, pause when a question is presented. State your answer before the explanation. In the interactive Academy, complete the matching decision lab and record what evidence would change your conclusion.
`;
}

function lessonBlock(lesson) {
  const { parts, exampleIndex } = lessonPartsInfo(lesson);
  const hasTitle = Boolean(lesson.title);
  const hasCheck = Boolean(lesson.question && lesson.question.prompt);
  const firstStep = exampleIndex >= 0 ? exampleIndex + 1 : (hasTitle ? 1 : 0);
  const steps = parts.slice(firstStep, hasCheck ? parts.length - 1 : parts.length);
  const out = [`\n### Lesson ${lesson.moduleId}.${lesson.lessonId}: ${hasTitle ? parts[0] : ''}\n\n${lesson.description}\n`];
  if (exampleIndex >= 0) out.push(`\n${parts[exampleIndex]}\n`);
  steps.forEach((step, index) => out.push(`\nPoint ${index + 1}. ${step}\n`));
  if (hasCheck) {
    const { question } = lesson;
    out.push(`\n${parts[parts.length - 1]}\n`);
    for (const [key, value] of Object.entries(question.options || {})) out.push(`\nOption ${key}. ${value}\n`);
    out.push(`\nThe best answer is option ${question.correct}. ${question.options[question.correct]}. ${question.explanation}\n`);
  }
  out.push('\nBefore continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.\n');
  return out.join('');
}

function buildNarrationScript(lessons = SEED_LESSONS) {
  const spoken = [introduction(lessons)];
  /* null, not 0: module 0 ("Start Here") is a real module, and seeding this
   * with 0 swallowed its heading. */
  let currentModule = null;
  for (const lesson of lessons) {
    if (lesson.moduleId !== currentModule) {
      currentModule = lesson.moduleId;
      spoken.push(`\n## Module ${currentModule}\n\nWe are beginning module ${currentModule}. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.\n`);
    }
    spoken.push(lessonBlock(lesson));
  }
  spoken.push('\n## Closing\n\nYou have reached the end of the Making Easy Money Academy voice curriculum. Completion is not the same thing as mastery. Return to the simulations, work through the calculations, review primary sources, and grade the quality of your process rather than the luck of one outcome. The strongest market student is not the person who sounds most certain. It is the person who can state the evidence, quantify the risk, recognize what is unknown, and change course when the facts change.\n');
  return spoken.join('');
}

function main() {
  const text = buildNarrationScript(SEED_LESSONS);
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, text, 'utf8');
  const words = (text.match(/\b[\w’'-]+\b/g) || []).length;
  console.log(JSON.stringify({ output: OUTPUT, lessons: SEED_LESSONS.length, words, estimatedMinutesAt130Wpm: Math.ceil(words / 130) }, null, 2));
}

if (require.main === module) main();

module.exports = { OUTPUT, buildNarrationScript, lessonBlock };
