'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  EVENT_TYPES,
  MAX_BODY_BYTES,
  hmac,
  parseEvent,
  verifySignature
} = require('./wordpress-gateway');

const rawEvent = JSON.stringify({
  version: 1,
  eventId: '7dc5f64b-7c05-4f38-9c55-31fcfa798706',
  eventType: 'news.article.published',
  occurredAt: '2023-11-14T22:13:20.000Z',
  subject: { type: 'post', id: '55' },
  data: { postId: 55 }
});

test('gateway only accepts an explicit small WordPress event allowlist', () => {
  assert.deepEqual([...EVENT_TYPES].sort(), [
    'creator.channel.updated',
    'creator.letter.published',
    'group.member.changed',
    'news.article.published',
    'system.integration.ping'
  ]);
  assert.equal(parseEvent(rawEvent).ok, true);
  assert.deepEqual(parseEvent(rawEvent).event.data, { postId: 55 });
  assert.equal(parseEvent(rawEvent.replace('news.article.published', 'admin.user.deleted')).ok, false);
});

test('gateway HMAC covers timestamp and exact raw JSON', () => {
  const secret = 'test-secret';
  const timestamp = '1700000000';
  const signature = `sha256=${hmac(secret, timestamp, rawEvent)}`;
  assert.deepEqual(verifySignature({ secret, timestamp, signature, rawBody: rawEvent, now: 1_700_000_000_000 }), { ok: true });
  assert.equal(verifySignature({ secret, timestamp, signature, rawBody: `${rawEvent} `, now: 1_700_000_000_000 }).error, 'invalid_signature');
  assert.equal(verifySignature({ secret, timestamp: '1699999000', signature, rawBody: rawEvent, now: 1_700_000_000_000 }).error, 'stale_request');
});

test('gateway payload limit stays intentionally small', () => {
  assert.equal(MAX_BODY_BYTES, 65_536);
  assert.equal(parseEvent(JSON.stringify({ version: 1 })).error, 'invalid_event');
});

test('gateway accepts only UUID source event keys for retry-safe producers', () => {
  const retryable = JSON.stringify({
    version: 1,
    eventId: '7dc5f64b-7c05-4f38-9c55-31fcfa798706',
    eventType: 'creator.channel.updated',
    occurredAt: '2023-11-14T22:13:20.000Z',
    subject: { type: 'channel', id: 'grandmasterobi' },
    data: { sourceEventKey: 'bd30f4d9-6e48-46c5-9f0f-b565b8202b6d', action: 'updated' }
  });
  assert.equal(parseEvent(retryable).ok, true);
  assert.equal(parseEvent(retryable).event.sourceEventKey, 'bd30f4d9-6e48-46c5-9f0f-b565b8202b6d');
  assert.equal(parseEvent(retryable.replace('bd30f4d9-6e48-46c5-9f0f-b565b8202b6d', 'not-a-uuid')).error, 'invalid_event');
});
