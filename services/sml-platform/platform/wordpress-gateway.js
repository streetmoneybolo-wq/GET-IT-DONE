'use strict';

const crypto = require('node:crypto');

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;
const EVENT_TYPES = new Set([
  'system.integration.ping',
  'creator.channel.updated',
  'creator.letter.published',
  'group.member.changed',
  'news.article.published',
  'usage.login',
  'usage.group_access',
  'usage.content_access',
  'usage.stream_access'
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(status, error) {
  return { ok: false, status, error };
}

function hmac(secret, timestamp, rawBody) {
  return crypto.createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left), 'utf8');
  const b = Buffer.from(String(right), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifySignature({ secret, timestamp, signature, rawBody, now = Date.now() }) {
  if (!secret) return fail(503, 'integration_unconfigured');
  if (!/^[0-9]{10}$/.test(String(timestamp || ''))) return fail(400, 'invalid_timestamp');
  if (!/^sha256=[a-f0-9]{64}$/i.test(String(signature || ''))) return fail(401, 'invalid_signature');

  const timestampSeconds = Number(timestamp);
  if (Math.abs(Math.floor(now / 1000) - timestampSeconds) > MAX_TIMESTAMP_SKEW_SECONDS) {
    return fail(401, 'stale_request');
  }

  const expected = `sha256=${hmac(secret, timestamp, rawBody)}`;
  if (!secureEqual(expected, signature)) return fail(401, 'invalid_signature');
  return { ok: true };
}

function cleanText(value, maximum) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= maximum ? cleaned : null;
}

function parseEvent(rawBody) {
  let body;
  try { body = JSON.parse(rawBody); } catch (_) { return fail(400, 'invalid_json'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.version !== 1) {
    return fail(422, 'invalid_event');
  }

  const eventId = cleanText(body.eventId, 36);
  const eventType = cleanText(body.eventType, 64);
  const occurredAt = cleanText(body.occurredAt, 40);
  const occurredAtMs = occurredAt ? Date.parse(occurredAt) : NaN;
  const actorUserId = body.actorUserId == null ? null : Number(body.actorUserId);
  const subject = body.subject == null ? {} : body.subject;

  if (!eventId || !UUID_RE.test(eventId) || !eventType || !EVENT_TYPES.has(eventType) || !Number.isFinite(occurredAtMs)) {
    return fail(422, 'invalid_event');
  }
  if (actorUserId !== null && (!Number.isSafeInteger(actorUserId) || actorUserId < 1)) {
    return fail(422, 'invalid_event');
  }
  if (!subject || typeof subject !== 'object' || Array.isArray(subject) || (body.data != null && (typeof body.data !== 'object' || Array.isArray(body.data)))) {
    return fail(422, 'invalid_event');
  }

  const subjectType = subject.type == null ? null : cleanText(subject.type, 48);
  const subjectId = subject.id == null ? null : cleanText(String(subject.id), 191);
  // A trusted WordPress producer may provide a stable UUID for one logical
  // change. It is distinct from eventId, which is regenerated on each delivery
  // attempt by the WordPress gateway. This lets the database collapse retries
  // without accepting an arbitrary caller-controlled idempotency key.
  const hasSourceEventKey = Object.prototype.hasOwnProperty.call(body.data || {}, 'sourceEventKey');
  const sourceEventKey = hasSourceEventKey
    ? cleanText(String(body.data.sourceEventKey), 36)
    : null;
  if (
    (subject.type != null && !subjectType) ||
    (subject.id != null && !subjectId) ||
    ((subjectType === null) !== (subjectId === null)) ||
    (hasSourceEventKey && (!sourceEventKey || !UUID_RE.test(sourceEventKey)))
  ) return fail(422, 'invalid_event');

  return {
    ok: true,
    event: {
      eventId: eventId.toLowerCase(),
      eventType,
      occurredAt: new Date(occurredAtMs).toISOString(),
      actorUserId,
      subjectType,
      subjectId,
      data: body.data || {},
      sourceEventKey: sourceEventKey ? sourceEventKey.toLowerCase() : null,
      payloadHash: crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex')
    }
  };
}

function readRequestBody(request, maximum = MAX_BODY_BYTES) {
  const length = Number(request.headers['content-length']);
  if (Number.isFinite(length) && length > maximum) return Promise.resolve(fail(413, 'payload_too_large'));

  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maximum) {
        request.pause();
        finish(fail(413, 'payload_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    request.once('end', () => finish({ ok: true, rawBody: Buffer.concat(chunks).toString('utf8') }));
    request.once('error', reject);
  });
}

module.exports = {
  EVENT_TYPES,
  MAX_BODY_BYTES,
  hmac,
  parseEvent,
  readRequestBody,
  verifySignature
};
