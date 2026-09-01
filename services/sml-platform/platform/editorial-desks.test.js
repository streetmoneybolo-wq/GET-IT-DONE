'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DESKS, chooseDesk, eventFingerprint, validateAssignment } = require('./editorial-desks');

test('defines exactly fifteen distinct specialist desks and author slugs', () => {
  assert.equal(DESKS.length, 15);
  assert.equal(new Set(DESKS.map((desk) => desk.key)).size, 15);
  assert.equal(new Set(DESKS.map((desk) => desk.authorSlug)).size, 15);
});

test('event specialists take precedence over sector desks', () => {
  assert.equal(chooseDesk({ eventType: 'earnings', sector: 'Semiconductors' }).key, 'earnings');
  assert.equal(chooseDesk({ eventType: 'company_news', sector: 'Semiconductors' }).key, 'semiconductors-ai');
});

test('one verified event produces a stable global fingerprint', () => {
  const event = { ticker: '$NVDA', eventType: 'earnings', sourceEventId: 'Q2-2026', occurredAt: '2026-08-31T20:05:00Z' };
  assert.equal(eventFingerprint(event), 'NVDA|earnings|q2-2026|2026-08-31');
  assert.deepEqual(validateAssignment(event).eligible, true);
});

test('unowned topics fail closed instead of overlapping a desk', () => {
  assert.deepEqual(validateAssignment({ eventType: 'rumor', sector: 'unknown' }), { eligible: false, reason: 'no_exclusive_editorial_desk' });
});
