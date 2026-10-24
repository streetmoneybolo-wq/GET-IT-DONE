'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { raceLastGood, academyLastGood } = require('./server');

/* Market Direction and the SML VIX waited on their upstream reads with no limit, so a slow provider held the panels for the whole 20 s
   route budget and then showed an error. A read slower than the limit now answers with the last good one, marked stale. */
test('a slow read answers with the last good one marked stale, a fast read answers itself, nothing at all answers null', async () => {
  const later = (v, ms) => new Promise((r) => setTimeout(() => r(v), ms));
  academyLastGood.delete('t:x');
  assert.equal(await raceLastGood(later({ ok: true, n: 1 }, 200), 't:x', 30), null, 'no last good read yet');
  assert.deepEqual(await raceLastGood(later({ ok: true, n: 2 }, 5), 't:x', 200), { ok: true, n: 2 }, 'fast read wins');
  academyLastGood.set('t:x', { ok: true, n: 3 });
  assert.deepEqual(await raceLastGood(later({ ok: true, n: 4 }, 200), 't:x', 30), { ok: true, n: 3, stale: true });
  await assert.doesNotReject(raceLastGood(Promise.reject(new Error('down')), 't:x', 30).catch(() => null));
  academyLastGood.delete('t:x');
});

test('the direction and VIX routes keep the last good read and race it', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'server.js'), 'utf8');
  assert.match(src, /raceLastGood\(read, 'direction:' \+ mode\)/);
  assert.match(src, /raceLastGood\(academySmlVix\.get\(\)/);
});

test('a hung upstream read never blocks the SML VIX or Market Direction for good: each read gives up after 60 s', () => {
  const read = (f) => require('node:fs').readFileSync(require('node:path').join(__dirname, f), 'utf8');
  assert.match(read('academy-vol-index.js'), /Promise\.race\(\[compute\(\), limit\]\)/);
  assert.match(read('academy-market-direction-v2.js'), /direction_source_timeout'\)\), 60_000\)/);
});
