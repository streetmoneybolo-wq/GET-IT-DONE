'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { issueDisciplineToken, verifyDisciplineToken } = require('./discipline-token');
const { EPISODES, splitNarration } = require('./discipline-content');

test('discipline player tokens are user-scoped, tamper-resistant, and expire', () => {
  const now = () => 1_800_000_000_000;
  const token = issueDisciplineToken({ secret: 'test-secret', userId: '123456789012345678', guildId: '938894329076940820', now, ttlMs: 1000 });
  assert.deepEqual(verifyDisciplineToken(token, 'test-secret', now), { ok: true, userId: '123456789012345678', guildId: '938894329076940820' });
  assert.equal(verifyDisciplineToken(`${token}x`, 'test-secret', now).ok, false);
  assert.deepEqual(verifyDisciplineToken(token, 'test-secret', () => now() + 1001), { ok: false, code: 'expired_token' });
});

test('daily discipline episode is split into bounded preloadable narration parts', () => {
  assert.equal(EPISODES[0].title, 'The Art of Doing Nothing');
  const parts = splitNarration(EPISODES[0].script);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => part.length <= 3200));
  assert.match(parts.join(' '), /Discipline gets paid/);
});
