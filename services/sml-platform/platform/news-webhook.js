'use strict';

const crypto = require('node:crypto');

const MAX_BODY_BYTES = 16 * 1024;

function fail(status, error) {
  return { ok: false, status, error };
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyBearer(secret, authorization) {
  if (!secret) return fail(503, 'integration_unconfigured');
  const match = String(authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!match || !secureEqual(match[1], secret)) return fail(401, 'invalid_token');
  return { ok: true };
}

function normalizeSourceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let parsed;
  try { parsed = new URL(value.trim()); } catch (_) { return null; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname) return null;
  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase();
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) parsed.searchParams.delete(key);
  }
  parsed.searchParams.sort();
  return parsed.toString();
}

function parseNewsRequest(rawBody) {
  let body;
  try { body = JSON.parse(rawBody); } catch (_) { return fail(400, 'invalid_json'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(422, 'invalid_request');
  const sourceUrl = normalizeSourceUrl(body.source_url || body.sourceUrl);
  if (!sourceUrl) return fail(422, 'invalid_source_url');
  let sourceEventKey = null;
  if (body.source_event_key != null || body.sourceEventKey != null) {
    sourceEventKey = String(body.source_event_key || body.sourceEventKey).trim();
    if (!/^[A-Za-z0-9._:-]{1,191}$/.test(sourceEventKey)) return fail(422, 'invalid_source_event_key');
  }
  return {
    ok: true,
    job: {
      sourceUrl,
      sourceUrlHash: crypto.createHash('sha256').update(sourceUrl, 'utf8').digest('hex'),
      sourceEventKey
    }
  };
}

module.exports = { MAX_BODY_BYTES, normalizeSourceUrl, parseNewsRequest, verifyBearer };
