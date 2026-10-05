'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { marketState, isMarketOpen, yearTable, sessionOf } = require('./market-clock');

const utc = (s) => Date.parse(s);

test('regular session follows daylight saving, not a fixed UTC window', () => {
  // EDT (summer): 09:30 ET = 13:30Z
  assert.equal(isMarketOpen(utc('2026-06-10T13:29:00Z')), false);
  assert.equal(isMarketOpen(utc('2026-06-10T13:30:00Z')), true);
  assert.equal(isMarketOpen(utc('2026-06-10T19:59:00Z')), true);
  assert.equal(isMarketOpen(utc('2026-06-10T20:00:00Z')), false);
  // EST (winter): 09:30 ET = 14:30Z, so 13:45Z is still pre-market
  assert.equal(isMarketOpen(utc('2026-01-14T13:45:00Z')), false);
  assert.equal(marketState(utc('2026-01-14T13:45:00Z')).session, 'pre');
  assert.equal(isMarketOpen(utc('2026-01-14T14:30:00Z')), true);
  assert.equal(isMarketOpen(utc('2026-01-14T20:59:00Z')), true);
  assert.equal(isMarketOpen(utc('2026-01-14T21:00:00Z')), false);
});

test('extended hours sessions', () => {
  assert.equal(marketState(utc('2026-06-10T08:00:00Z')).session, 'pre'); // 04:00 ET
  assert.equal(marketState(utc('2026-06-10T07:59:00Z')).session, 'closed');
  assert.equal(marketState(utc('2026-06-10T21:00:00Z')).session, 'post'); // 17:00 ET
  assert.equal(marketState(utc('2026-06-11T00:00:00Z')).session, 'closed'); // 20:00 ET
  assert.equal(sessionOf(utc('2026-06-10T15:00:00Z')), 'regular');
});

test('weekends and holidays are closed', () => {
  assert.equal(marketState(utc('2026-06-13T15:00:00Z')).reason, 'weekend');
  assert.equal(isMarketOpen(utc('2026-06-13T15:00:00Z')), false);
  assert.equal(isMarketOpen(utc('2026-12-25T15:00:00Z')), false); // Friday Christmas
  assert.equal(marketState(utc('2026-12-25T15:00:00Z')).reason, 'Christmas Day');
});

test('2026 NYSE holiday calendar', () => {
  const h = [...yearTable(2026).hol.keys()].sort();
  assert.deepEqual(h, ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25']);
});

test('observed rules: Saturday July 4 closes Friday; Saturday New Year is not observed', () => {
  assert.equal(yearTable(2026).hol.get('2026-07-03'), 'Independence Day');
  assert.equal(yearTable(2022).hol.has('2021-12-31'), false);
  assert.equal(yearTable(2022).hol.has('2022-01-01'), false);
  assert.equal(yearTable(2023).hol.get('2023-01-02'), "New Year's Day"); // Sunday -> Monday
});

test('Good Friday and floating holidays across years', () => {
  assert.equal(yearTable(2025).hol.get('2025-04-18'), 'Good Friday');
  assert.equal(yearTable(2024).hol.get('2024-03-29'), 'Good Friday');
  assert.equal(yearTable(2025).hol.get('2025-05-26'), 'Memorial Day');
  assert.equal(yearTable(2025).hol.get('2025-11-27'), 'Thanksgiving Day');
});

test('early close days end the regular session at 13:00 ET', () => {
  // day after Thanksgiving 2025 (Nov 28): close 13:00 ET = 18:00Z
  assert.equal(isMarketOpen(utc('2025-11-28T17:59:00Z')), true);
  assert.equal(marketState(utc('2025-11-28T18:00:00Z')).session, 'post');
  assert.equal(marketState(utc('2025-11-28T18:00:00Z')).early, true);
  assert.equal(marketState(utc('2025-11-28T22:00:00Z')).session, 'closed'); // 17:00 ET
  assert.equal(yearTable(2025).early.has('2025-12-24'), true);
});
