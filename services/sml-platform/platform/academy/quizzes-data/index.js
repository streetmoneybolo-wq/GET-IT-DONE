'use strict';

/* Authored knowledge checks, keyed "moduleId.lessonId". Split by authoring range
 * (the three Start Here files for module 0, then the expansion modules 14-28) so
 * several authors can work without touching one another's file. A missing file is
 * skipped: those lessons keep the generated check instead of breaking the load.
 *
 * Note that quizFor() is only consulted by expansion.js buildLesson(); the Start
 * Here files import these checks directly, so the lesson and the authored data
 * cannot drift apart. start-here.test.js asserts they stay equal. */

const FILES = ['./start-here-a', './start-here-b', './start-here-c', './m14-17', './m18-22', './m23-28'];

const DATA = {};
for (const file of FILES) {
  let part = null;
  try {
    part = require(file);
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes(file.slice(2))) continue;
    throw error;
  }
  for (const [key, quiz] of Object.entries(part || {})) {
    if (!DATA[key]) DATA[key] = quiz;
  }
}

module.exports = DATA;
