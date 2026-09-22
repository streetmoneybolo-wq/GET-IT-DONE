'use strict';

/* Authored whiteboard examples, keyed 'moduleId.lessonId'.
 *
 * Each module file exports an array of records made with E() or B() from
 * ../examples. reference.js is canonical for 1.1, 7.1 and 9.1 and is loaded
 * first, so if another file repeats one of those ids the reference version
 * wins (and assertAuthoredExamples() reports the duplicate).
 *
 * Loading never throws: a missing content file is skipped, any other load
 * problem is recorded in LOAD_ERRORS, and invalid records keep their errors.
 * At runtime attachWorkedExamples() then falls back to autoExample(); the
 * strict test (examples.test.js) fails on every recorded problem. */

const MODULES = Object.freeze([
  './reference',
  './start-here-a', './start-here-b', './start-here-c',
  './m01-13', './m14-20', './m21-28'
]);

const RECORDS = [];
const LOAD_ERRORS = [];
const SKIPPED = [];
const LOADED = [];

function missing(error, request) {
  return Boolean(error) && error.code === 'MODULE_NOT_FOUND' &&
    String(error.message).split('\n')[0].includes(`'${request}'`);
}

for (const request of MODULES) {
  let exported;
  try {
    exported = require(request);
  } catch (error) {
    if (missing(error, request)) SKIPPED.push(request);
    else LOAD_ERRORS.push({ module: request, message: String(error && error.message || error).split('\n')[0] });
    continue;
  }
  const list = Array.isArray(exported) ? exported
    : exported && typeof exported === 'object' ? Object.values(exported) : null;
  if (!list) {
    LOAD_ERRORS.push({ module: request, message: 'must export an array of E()/B() records' });
    continue;
  }
  LOADED.push(request);
  for (const record of list) RECORDS.push(record);
}

const AUTHORED = new Map();
const DUPLICATES = [];
for (const record of RECORDS) {
  const id = record && typeof record.id === 'string' ? record.id : '';
  if (!id) continue;
  if (AUTHORED.has(id)) DUPLICATES.push(id);
  else AUTHORED.set(id, record);
}

module.exports = {
  MODULES,
  RECORDS: Object.freeze(RECORDS),
  AUTHORED,
  DUPLICATES: Object.freeze(DUPLICATES),
  LOAD_ERRORS: Object.freeze(LOAD_ERRORS),
  SKIPPED: Object.freeze(SKIPPED),
  LOADED: Object.freeze(LOADED)
};
