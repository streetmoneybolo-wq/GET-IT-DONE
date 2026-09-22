'use strict';

/* Module 0, "Start Here": the beginner track.
 *
 * Nothing in modules 1-28 is written for someone who has never bought a share.
 * These twenty lessons are, and they run FIRST in the curriculum, so the picker
 * opens on Lesson 0.1 rather than on market microstructure.
 *
 * The lessons are authored in three sibling files so several authors can work
 * without touching one another's file. This module is the only thing that
 * knows about all three: it concatenates them, orders them by lessonId, and
 * guarantees the two invariants the rest of the platform relies on.
 *
 *   1. Every lesson carries a simulation with at least three rounds. The
 *      authoring files already call simulationFor(), but a file that forgets
 *      would otherwise ship a lesson the Activity deck cannot run, so the
 *      simulation is filled in here when it is missing.
 *   2. Lesson ids are unique inside the module. A duplicate would quietly
 *      shadow an authored example or knowledge check (both are keyed
 *      "0.<lessonId>"), so it throws at load instead.
 *
 * Worked examples live in ../examples-data/start-here-*.js and knowledge checks
 * in ../quizzes-data/start-here-*.js, both keyed to the ids used here.
 */

const { simulationFor } = require('../simulations');

const SOURCES = Object.freeze(['./starter-a', './starter-b', './starter-c']);
const MODULE_ID = 0;

function collect() {
  const lessons = [];
  for (const source of SOURCES) {
    const exported = require(source);
    const list = Array.isArray(exported) ? exported : Object.values(exported || {});
    for (const lesson of list) {
      if (!lesson || typeof lesson !== 'object') throw new Error(`${source}: exported a non-lesson entry`);
      if (lesson.moduleId !== MODULE_ID) throw new Error(`${source}: lesson ${lesson.moduleId}.${lesson.lessonId} is not in module ${MODULE_ID}`);
      /* simulationFor() is deterministic, so filling a gap here produces the
       * same simulation the authoring file would have produced itself. */
      lessons.push(lesson.simulation ? lesson : { ...lesson, simulation: simulationFor(lesson) });
    }
  }
  const seen = new Set();
  for (const lesson of lessons) {
    const id = `${lesson.moduleId}.${lesson.lessonId}`;
    if (seen.has(id)) throw new Error(`Start Here lesson ${id} is authored twice`);
    seen.add(id);
  }
  return lessons.sort((left, right) => left.lessonId - right.lessonId);
}

const START_HERE_LESSONS = Object.freeze(collect());

module.exports = { START_HERE_LESSONS, START_HERE_MODULE_ID: MODULE_ID, SOURCES };
