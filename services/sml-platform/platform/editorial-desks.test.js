'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DESKS, chooseContentKind, chooseDesk, eventFingerprint, subjectFingerprint, validateAssignment } = require('./editorial-desks');

test('defines exactly fifteen distinct specialist desks and author slugs', () => {
  assert.equal(DESKS.length, 15);
  assert.equal(new Set(DESKS.map((desk) => desk.key)).size, 15);
  assert.equal(new Set(DESKS.map((desk) => desk.authorSlug)).size, 15);
  assert.equal(new Set(DESKS.map((desk) => desk.voice)).size, 15);
  assert.equal(new Set(DESKS.map((desk) => desk.layout)).size, 15);
});

test('one subject lock spans articles and short posts for the same ticker topic and day', () => {
  const event = { ticker: '$NVDA', eventType: 'earnings', sourceEventId: 'call-1', occurredAt: '2026-08-31T20:05:00Z' };
  assert.equal(subjectFingerprint(event), 'NVDA|earnings|2026-08-31');
  assert.equal(validateAssignment({ ...event, contentKind: 'short_post' }).subjectFingerprint, 'NVDA|earnings|2026-08-31');
  assert.equal(chooseContentKind({ ...event, contentKind: 'article' }), 'article');
  assert.equal(chooseContentKind({ ...event, contentKind: 'short_post' }), 'short_post');
  assert.equal(chooseContentKind({ ...event, importanceScore: 90 }), 'article');
  assert.equal(chooseContentKind({ ...event, importanceScore: 40 }), 'short_post');
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
