'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { upcoming, eventRisk, parseExtra } = require('./academy-market-calendar');

const at = (d) => Date.parse(d + 'T15:00:00Z');

test('the next ten days list FOMC, jobs, expiration and rebalancing with days away', () => {
  const list = upcoming({ now: at('2026-10-12'), days: 10 });
  const labels = list.map((e) => e.date + ' ' + e.label);
  assert.ok(labels.some((l) => l.startsWith('2026-10-16 Monthly options expiration')), labels.join('\n'));
  assert.ok(list.every((e) => e.daysAway >= 0 && e.daysAway <= 10));
  const fomc = upcoming({ now: at('2026-10-26'), days: 5 }).find((e) => e.kind === 'fomc');
  assert.ok(fomc && fomc.date === '2026-10-28' && fomc.daysAway === 2);
  const witch = upcoming({ now: at('2026-12-14'), days: 7 }).find((e) => e.kind === 'opex');
  assert.ok(witch && /triple witching/.test(witch.label) && witch.date === '2026-12-18');
  const jobs = upcoming({ now: at('2026-11-02'), days: 7 }).find((e) => e.kind === 'jobs');
  assert.ok(jobs && jobs.date === '2026-11-06');
});

test('owner events are parsed from JSON and merged', () => {
  assert.deepEqual(parseExtra('[{"date":"2026-10-14","label":"CPI 8:30 am","impact":3},{"date":"bad","label":"x"}]'), [{ date: '2026-10-14', label: 'CPI 8:30 am', kind: 'owner', impact: 3 }]);
  const list = upcoming({ now: at('2026-10-13'), days: 3, extra: '[{"date":"2026-10-14","label":"CPI 8:30 am","impact":3}]' });
  assert.ok(list.some((e) => e.kind === 'owner' && e.daysAway === 1));
});

test('event risk peaks on an FOMC day and is low on a quiet day', () => {
  const fomcDay = eventRisk({ now: at('2026-10-28') });
  assert.equal(fomcDay.score, 1);
  const quiet = eventRisk({ now: at('2026-10-20') });
  assert.ok(quiet.score < 0.5, String(quiet.score));
});
