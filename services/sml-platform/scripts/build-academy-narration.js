#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { SEED_LESSONS } = require('../platform/academy/curriculum');

const output = path.resolve(__dirname, '../content/making-easy-money-academy-101-lesson-voice-script.md');
const moduleCount = new Set(SEED_LESSONS.map((lesson) => lesson.moduleId)).size;
const spoken = [];

spoken.push(`# Making Easy Money Academy: 101-Lesson Voice Script

## Voice-generation directions — do not read this section aloud

Use only a voice that the account owner has supplied or has permission to use. Read the spoken script naturally in a confident, conversational teaching voice. Do not imitate any third party. Target 125 to 140 words per minute. Pause briefly at headings, after questions, and between lessons. Emphasize definitions without sounding theatrical. Say ticker symbols one letter at a time when applicable. Never imply guaranteed returns. Preserve the educational-risk statements.

## Spoken script

Welcome to Making Easy Money Academy.

This is a complete guided tour through ${SEED_LESSONS.length} interactive lessons organized across ${moduleCount} modules. The purpose is not to hand you predictions. It is to teach you how markets work, how evidence should be tested, how risk should be controlled, and how professional decisions are made when the future is uncertain.

Nothing in this program is financial, legal, tax, or investment advice. Markets can move quickly. Options can expire worthless. Short positions can create substantial losses. Leverage can magnify mistakes. Every example is educational, and every simulated trade should be treated as a process exercise rather than a promise.

As you listen, pause when a question is presented. State your answer before the explanation. In the interactive Academy, complete the matching decision lab and record what evidence would change your conclusion.
`);

let currentModule = 0;
for (const lesson of SEED_LESSONS) {
  if (lesson.moduleId !== currentModule) {
    currentModule = lesson.moduleId;
    spoken.push(`\n## Module ${currentModule}\n\nWe are beginning module ${currentModule}. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.\n`);
  }
  spoken.push(`\n### Lesson ${lesson.moduleId}.${lesson.lessonId}: ${lesson.title}\n\n${lesson.description}\n`);
  lesson.steps.forEach((step, index) => spoken.push(`\nPoint ${index + 1}. ${step}\n`));
  spoken.push(`\nKnowledge check. ${lesson.question.prompt}\n`);
  for (const [key, value] of Object.entries(lesson.question.options)) spoken.push(`\nOption ${key}. ${value}\n`);
  spoken.push(`\nThe best answer is option ${lesson.question.correct}. ${lesson.question.options[lesson.question.correct]}. ${lesson.question.explanation}\n`);
  spoken.push(`\nBefore continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.\n`);
}

spoken.push(`\n## Closing\n\nYou have reached the end of the Making Easy Money Academy voice curriculum. Completion is not the same thing as mastery. Return to the simulations, work through the calculations, review primary sources, and grade the quality of your process rather than the luck of one outcome. The strongest market student is not the person who sounds most certain. It is the person who can state the evidence, quantify the risk, recognize what is unknown, and change course when the facts change.\n`);

const text = spoken.join('');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, text, 'utf8');
const words = (text.match(/\b[\w’'-]+\b/g) || []).length;
console.log(JSON.stringify({ output, lessons: SEED_LESSONS.length, words, estimatedMinutesAt130Wpm: Math.ceil(words / 130) }, null, 2));
