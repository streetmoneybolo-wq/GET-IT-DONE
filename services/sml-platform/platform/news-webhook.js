'use strict';

const crypto = require('node:crypto');
const { validateAssignment } = require('./editorial-desks');

const MAX_BODY_BYTES = 128 * 1024;

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
  let assignment = null;
  let marketSnapshot = null;
  let officialSources = [];
  if (body.market_event != null || body.marketEvent != null) {
    const event = body.market_event || body.marketEvent;
    if (!event || typeof event !== 'object' || Array.isArray(event)) return fail(422, 'invalid_market_event');
    try { assignment = validateAssignment(event); } catch (_) { return fail(422, 'invalid_market_event'); }
    if (!assignment.eligible) return fail(422, assignment.reason);
    marketSnapshot = body.market_snapshot || body.marketSnapshot || null;
    if (marketSnapshot && (typeof marketSnapshot !== 'object' || Array.isArray(marketSnapshot))) return fail(422, 'invalid_market_snapshot');
    officialSources = body.official_sources || body.officialSources || [];
    if (!Array.isArray(officialSources) || officialSources.length > 10) return fail(422, 'invalid_official_sources');
    officialSources = officialSources.map((item) => ({
      label: String(item && item.label || 'Official announcement').slice(0, 160),
      url: normalizeSourceUrl(item && item.url),
      verified: item && item.verified === true
    }));
    if (officialSources.some((item) => !item.url)) return fail(422, 'invalid_official_sources');
  }
  return {
    ok: true,
    job: {
      sourceUrl,
      sourceUrlHash: crypto.createHash('sha256').update(sourceUrl, 'utf8').digest('hex'),
      sourceEventKey,
      editorialDesk: assignment && assignment.desk.key,
      topicFingerprint: assignment && assignment.fingerprint,
      marketSnapshot,
      officialSources
    }
  };
}

module.exports = { MAX_BODY_BYTES, normalizeSourceUrl, parseNewsRequest, verifyBearer };
