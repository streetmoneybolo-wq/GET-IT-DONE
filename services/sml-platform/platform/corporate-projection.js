/* =============================================================================
 * platform/corporate-projection.js — tell WordPress who is corporate
 *
 * WordPress renders the badge, the feed slot and the onboarding pool. It must
 * never DECIDE any of that: it reads a projection this service pushes. A feed
 * bug can then cost an impression; it cannot grant free placement.
 *
 * The projection is WHOLESALE, not incremental. WordPress replaces its entire
 * option with what arrives, so a suspension takes effect by absence and there is
 * no partial-update path that can leave a stale badge behind.
 *
 * That makes an empty or truncated push dangerous: a query that silently
 * returned nothing would wipe every badge on the site. So the payload carries
 * its own `count`, and an empty list must be flagged `empty: true` explicitly —
 * WordPress rejects a zero-length list that does not say it meant it. "None"
 * and "something broke" look identical on the wire otherwise.
 *
 * Signing matches the existing bridge exactly: HMAC-SHA256 over
 * `${timestamp}.${body}`, bare lowercase hex, `x-sml-timestamp` /
 * `x-sml-signature`. Do not invent a second scheme.
 * ========================================================================== */

'use strict';

const crypto = require('node:crypto');

/* WordPress rejects anything outside 300s (sml_ar_verify_delivery). Stay well
 * inside it so ordinary clock drift never costs a sync. */
const MAX_SKEW_SECONDS = 300;

/**
 * Canonical JSON: keys sorted at every level.
 *
 * The digest is used to skip unchanged pushes, so it has to be stable against
 * key order. JSON.stringify preserves insertion order, and a query plan change
 * that reorders columns would otherwise look like a content change forever.
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * Shape the rows WordPress needs — and nothing else.
 *
 * No billing, no spend, no verification details. WordPress has no use for them
 * and every field shipped is a field that can leak from a slower-moving surface.
 */
function buildProjection(rows, { now = Date.now } = {}) {
  const accounts = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.wpUserId != null)
    .map((r) => ({
      wpUserId: Number(r.wpUserId),
      handle: String(r.handle || '').toLowerCase(),
      name: String(r.name || ''),
      category: String(r.category || 'other'),
      badge: 'corporate',
      active: true
    }))
    /* Deterministic order, so the digest only changes when the CONTENT does. */
    .sort((a, b) => a.wpUserId - b.wpUserId);

  return {
    version: 1,
    generatedAt: new Date(now()).toISOString(),
    count: accounts.length,
    /* An explicit assertion that zero is the real answer, not a failed query. */
    empty: accounts.length === 0,
    accounts
  };
}

/** Digest over the accounts only — `generatedAt` changes every call. */
function projectionDigest(projection) {
  const accounts = projection && Array.isArray(projection.accounts) ? projection.accounts : [];
  return crypto.createHash('sha256').update(canonicalJson(accounts)).digest('hex');
}

/**
 * Build the publisher, or null when unconfigured.
 *
 * Returning null rather than a throwing stub matches createWordPressHandler and
 * lets the caller log "projection disabled" once at boot instead of failing on
 * every sync.
 */
function createProjectionPublisher({
  url, secret, fetchImpl = globalThis.fetch, now = Date.now, logger = () => {}
} = {}) {
  if (!url || !secret) return null;

  /**
   * @param {object} projection  from buildProjection
   * @param {object} [opts]
   * @param {string} [opts.lastDigest]  skip the push when the content is identical
   * @returns {Promise<{published: boolean, digest: string, skipped?: string}>}
   */
  async function publish(projection, opts = {}) {
    if (!projection || !Array.isArray(projection.accounts)) {
      throw new TypeError('publish requires a projection built by buildProjection');
    }
    /* A mismatch here means the payload was assembled or mutated by something
     * other than buildProjection — refuse rather than push a half-truth that
     * WordPress will apply wholesale. */
    if (projection.count !== projection.accounts.length) {
      throw new TypeError('projection count does not match its accounts');
    }

    const digest = projectionDigest(projection);
    if (opts.lastDigest && opts.lastDigest === digest) {
      return { published: false, skipped: 'unchanged', digest };
    }

    const body = JSON.stringify(projection);
    const timestamp = String(Math.floor(now() / 1000));
    const signature = crypto.createHmac('sha256', secret)
      .update(`${timestamp}.${body}`, 'utf8').digest('hex');

    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sml-timestamp': timestamp,
        'x-sml-signature': signature,
        /* Same content, same key: a retry cannot apply twice in a way that
         * differs from applying once. */
        'idempotency-key': `corporate-projection-${digest}`
      },
      body
    });

    if (!response || !response.ok) {
      const status = response ? response.status : 'no response';
      throw new Error(`corporate projection push failed: ${status}`);
    }

    logger('info', 'corporate_projection_published', { count: projection.count, digest: digest.slice(0, 12) });
    return { published: true, digest };
  }

  return { publish };
}

module.exports = {
  buildProjection,
  projectionDigest,
  createProjectionPublisher,
  canonicalJson,
  MAX_SKEW_SECONDS
};
