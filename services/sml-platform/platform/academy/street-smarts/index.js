'use strict';

/* Module 29, "Street Smarts": the beginner-to-intermediate gap track.
 *
 * Start Here teaches the first steps. The advanced modules teach the college
 * material. In between sat the questions every new investor actually asks:
 * how prices get set, what a P/E is, whether to buy the dip, what a bond does,
 * why the market rises when the economy feels bad. These lessons answer those,
 * in plain words with everyday urban humour, each with a whiteboard example.
 *
 * Authored in five sibling files so several authors can work at once. This
 * module concatenates them, orders by lessonId and guarantees the invariants
 * the rest of the platform relies on (same as Start Here):
 *   1. every lesson carries a simulation (filled in here when missing);
 *   2. lesson ids are unique inside the module (a duplicate would silently
 *      shadow an authored example, both are keyed "29.<lessonId>").
 * Worked examples live in ../examples-data/street-*.js.
 */

const { simulationFor } = require('../simulations');

const SOURCES = Object.freeze(['./street-a', './street-b', './street-c', './street-d', './street-e']);
const MODULE_ID = 29;

function collect() {
  const lessons = [];
  for (const source of SOURCES) {
    const exported = require(source);
    const list = Array.isArray(exported) ? exported : Object.values(exported || {});
    for (const lesson of list) {
      if (!lesson || typeof lesson !== 'object') throw new Error(`${source}: exported a non-lesson entry`);
      if (lesson.moduleId !== MODULE_ID) throw new Error(`${source}: lesson ${lesson.moduleId}.${lesson.lessonId} is not in module ${MODULE_ID}`);
      lessons.push(lesson.simulation ? lesson : { ...lesson, simulation: simulationFor(lesson) });
    }
  }
  const seen = new Set();
  for (const lesson of lessons) {
    const id = `${lesson.moduleId}.${lesson.lessonId}`;
    if (seen.has(id)) throw new Error(`Street Smarts lesson ${id} is authored twice`);
    seen.add(id);
  }
  return lessons.sort((left, right) => left.lessonId - right.lessonId);
}

const STREET_LESSONS = Object.freeze(collect());

module.exports = { STREET_LESSONS, STREET_MODULE_ID: MODULE_ID, SOURCES };
