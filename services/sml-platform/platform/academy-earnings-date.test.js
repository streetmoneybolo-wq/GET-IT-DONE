'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractNextEarnings, earningsRisk } = require('./academy-earnings-date');

const NOW = Date.parse('2026-06-10T15:00:00Z');

test('finds the next unreported date across nested shapes', () => {
  const payload = { data: { earnings: [
    { date: '2026-03-01', epsEstimate: 1, epsActual: 1.1 },
    { date: '2026-06-24', epsEstimate: 1.2 },
    { date: '2026-09-20', epsEstimate: 1.3 }
  ] } };
  assert.deepEqual(extractNextEarnings(payload, NOW), { date: '2026-06-24', daysAway: 14, confirmedEstimate: true });
  assert.equal(extractNextEarnings({ nextEarningsDate: '2026-06-12' }, NOW).daysAway, 2);
  assert.equal(extractNextEarnings({ results: [{ reportDate: '2026-06-10', eps_estimate: 0.5 }] }, NOW).daysAway, 0);
});

test('past, reported or unrecognised payloads give null (unknown), never a fake "no earnings"', () => {
  assert.equal(extractNextEarnings({ earnings: [{ date: '2026-01-01', epsActual: 2 }] }, NOW), null);
  assert.equal(extractNextEarnings({ rows: [{ foo: 'bar' }] }, NOW), null);
  assert.equal(extractNextEarnings(null, NOW), null);
  assert.equal(extractNextEarnings({ rows: [{ fiscalDateEnding: '2026-12-31' }] }, NOW), null);
  assert.equal(extractNextEarnings({ date: '2026-07-01', epsActual: 3 }, NOW), null);
});

test('risk rises as the report approaches and is null when unknown', () => {
  assert.equal(earningsRisk(null), null);
  const r = (d) => earningsRisk({ daysAway: d }).r;
  assert.ok(r(0) > r(2) && r(2) > r(5) && r(5) > r(10) && r(10) > r(25) && r(25) > r(60));
  assert.match(earningsRisk({ daysAway: 1 }).detail, /tomorrow/);
});
