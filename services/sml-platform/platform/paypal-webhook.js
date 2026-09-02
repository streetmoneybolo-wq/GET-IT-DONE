'use strict';

/**
 * PayPal webhook handler for POST /v1/paypal/webhook.
 *
 * Order of operations (DESIGN §4b(7,8)) — everything cheap and local happens
 * BEFORE any outbound call:
 *   1. bounded concurrency + raw-body cap (256KB)
 *   2. per-IP and global token buckets (injected clock)
 *   3. fail closed 503 when SML_PAYPAL_WEBHOOK_ID or credentials are unset
 *   4. strict header shape prechecks (400)
 *   5. minimal envelope parse (400)
 *   6. verify-webhook-signature via the injected PayPal client
 *        — retryable/ambiguous → 503 (PayPal redelivers); FAILURE → 400
 *   7. acceptPayPalEvent transaction, then post-commit dispute handoff
 *
 * All cross-module dependencies (pool, paypalClient, disputeCases,
 * evidence store) are injected. No secret values, IP addresses, or provider
 * payloads are ever logged — this module does not log.
 */

const crypto = require('node:crypto');

const MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_SKEW_MS = 5 * 60 * 1000;

/* "UUID-ish": hex groups in the canonical 8-4-4-4-12 layout, without pinning
   version/variant bits — PayPal's transmission ids follow the layout but are
   not guaranteed RFC-4122 v4. */
const TRANSMISSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:?\d{2})$/;

function fail(status, error) {
  return { ok: false, status, error };
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function certUrlAllowed(value) {
  let url;
  try { url = new URL(value); } catch (_) { return false; }
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:' && !url.username && !url.password &&
    (host === 'paypal.com' || host.endsWith('.paypal.com'));
}

/**
 * Strict header shape prechecks, all local, all before any outbound call.
 * A malformed delivery is rejected 400 without spending a verify call on it.
 */
function precheckHeaders(headers, { now, skewMs = DEFAULT_SKEW_MS }) {
  const h = {};
  for (const [key, value] of Object.entries(headers || {})) {
    h[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }

  const transmissionId = String(h['paypal-transmission-id'] || '');
  if (!TRANSMISSION_ID_RE.test(transmissionId)) return fail(400, 'invalid_transmission_id');

  const transmissionTime = String(h['paypal-transmission-time'] || '');
  if (!RFC3339_RE.test(transmissionTime)) return fail(400, 'invalid_transmission_time');
  const timeMs = Date.parse(transmissionTime);
  if (!Number.isFinite(timeMs)) return fail(400, 'invalid_transmission_time');
  if (Math.abs(now - timeMs) > skewMs) return fail(400, 'transmission_time_out_of_tolerance');

  const certUrl = String(h['paypal-cert-url'] || '');
  if (!certUrlAllowed(certUrl)) return fail(400, 'invalid_cert_url');

  const signature = String(h['paypal-transmission-sig'] || '');
  const algorithm = String(h['paypal-auth-algo'] || '');
  if (!signature || signature.length > 4096 || !algorithm || algorithm.length > 64) {
    return fail(400, 'invalid_signature_headers');
  }

  return {
    ok: true,
    headers: {
      'paypal-transmission-id': transmissionId,
      'paypal-transmission-time': transmissionTime,
      'paypal-cert-url': certUrl,
      'paypal-transmission-sig': signature,
      'paypal-auth-algo': algorithm
    }
  };
}

/** Minimal envelope parse — semantics stay in dispute-cases. */
function parseEvent(rawBody) {
  let body;
  try { body = JSON.parse(rawBody); } catch (_) { return fail(400, 'invalid_json'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'invalid_event');

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const eventType = typeof body.event_type === 'string' ? body.event_type.trim() : '';
  if (!id || id.length > 128 || !eventType || eventType.length > 128) return fail(400, 'invalid_event');

  return {
    ok: true,
    event: {
      id,
      eventType,
      resourceType: typeof body.resource_type === 'string' && body.resource_type
        ? body.resource_type : null,
      createTime: typeof body.create_time === 'string' && Number.isFinite(Date.parse(body.create_time))
        ? new Date(Date.parse(body.create_time)).toISOString() : null,
      resource: body.resource && typeof body.resource === 'object' && !Array.isArray(body.resource)
        ? body.resource : {},
      payloadHash: crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex')
    }
  };
}

/* Token bucket with an injected clock. Capacity doubles as the per-minute
   refill rate. Bucket keys (IPs) live only in memory and are never logged. */
function createBucket(capacityPerMinute) {
  let tokens = capacityPerMinute;
  let last = null;
  return {
    take(nowMs) {
      if (last !== null) {
        tokens = Math.min(capacityPerMinute, tokens + ((nowMs - last) / 60_000) * capacityPerMinute);
      }
      last = nowMs;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
    idle(nowMs) { return last === null || nowMs - last > 120_000; }
  };
}

function createPayPalWebhookHandler({ pool, config, paypalClient, disputeCases, store,
  now = Date.now, limits = {} }) {
  const perIpPerMinute = limits.perIpPerMinute || 60;
  const globalPerMinute = limits.globalPerMinute || 600;
  const maxConcurrent = limits.maxConcurrent || 8;
  const skewMs = limits.skewMs || DEFAULT_SKEW_MS;
  const breakerThreshold = limits.breakerThreshold || 5;
  const breakerCooldownMs = limits.breakerCooldownMs || 30_000;

  const globalBucket = createBucket(globalPerMinute);
  const ipBuckets = new Map();
  let inFlight = 0;
  let consecutiveVerifyFailures = 0;
  let breakerOpenUntil = 0;

  function ipAllowed(ip, nowMs) {
    if (ipBuckets.size > 1024) {
      for (const [key, bucket] of ipBuckets) {
        if (bucket.idle(nowMs)) ipBuckets.delete(key);
      }
    }
    let bucket = ipBuckets.get(ip);
    if (!bucket) {
      bucket = createBucket(perIpPerMinute);
      ipBuckets.set(ip, bucket);
    }
    return bucket.take(nowMs);
  }

  /**
   * One transaction: INSERT paypal_events ON CONFLICT DO NOTHING (duplicate →
   * commit, 'duplicate'); otherwise normalize into billing_events through the
   * injected evidence store (hash-chained, scope = provider) and mark the raw
   * row processed. The dispute handoff happens OUTSIDE, after commit.
   */
  async function acceptPayPalEvent(event, rawBody, receivedAtIso) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO paypal_events (
           event_id, event_type, resource_type, payload, verification_status, status, received_at
         ) VALUES ($1, $2, $3, $4::jsonb, 'SUCCESS', 'received', $5)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [event.id, event.eventType, event.resourceType, rawBody, receivedAtIso]
      );

      if (inserted.rowCount !== 1) {
        await client.query('COMMIT');
        return 'duplicate';
      }

      const occurredAt = (typeof event.resource.update_time === 'string' &&
        Number.isFinite(Date.parse(event.resource.update_time)))
        ? new Date(Date.parse(event.resource.update_time)).toISOString()
        : (event.createTime || receivedAtIso);

      await store.appendChained(client, {
        table: 'billing_events',
        scopeKey: 'paypal',
        fields: {
          provider: 'paypal',
          provider_event_id: event.id,
          event_type: event.eventType,
          identity_id: null,
          subscription_id: null,
          transaction_id: null,
          payload_hash: event.payloadHash,
          raw_ref: event.id,
          status: 'applied',
          source: 'paypal',
          source_event_id: event.id,
          provider_account: null,
          occurred_at: occurredAt,
          received_at: receivedAtIso,
          provenance: {}
        }
      });

      await client.query(
        `UPDATE paypal_events SET processed_at = $2, status = 'processed' WHERE event_id = $1`,
        [event.id, receivedAtIso]
      );
      await client.query('COMMIT');
      return 'accepted';
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async function process(request, response, rawBody) {
    const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
      return sendJson(response, 413, { ok: false, error: 'payload_too_large' });
    }

    const nowMs = now();
    const ip = (request && request.socket && request.socket.remoteAddress) || 'unknown';
    if (!globalBucket.take(nowMs) || !ipAllowed(ip, nowMs)) {
      return sendJson(response, 429, { ok: false, error: 'rate_limited' });
    }

    /* Fail closed BEFORE any outbound call: an unverifiable delivery must
       never be acknowledged, and a 503 makes PayPal redeliver once the
       integration is configured. */
    if (!config || !config.paypalEnabled || !config.paypalWebhookId ||
        !config.paypalClientId || !config.paypalClientSecret || !paypalClient) {
      return sendJson(response, 503, { ok: false, error: 'integration_unconfigured' });
    }

    if (breakerOpenUntil > nowMs) {
      return sendJson(response, 503, { ok: false, error: 'verification_unavailable' });
    }

    const prechecked = precheckHeaders(request && request.headers, { now: nowMs, skewMs });
    if (!prechecked.ok) {
      return sendJson(response, prechecked.status, { ok: false, error: prechecked.error });
    }

    const parsed = parseEvent(raw);
    if (!parsed.ok) {
      return sendJson(response, parsed.status, { ok: false, error: parsed.error });
    }

    let verification;
    try {
      verification = await paypalClient.verifyWebhookSignature({
        headers: prechecked.headers,
        rawBody: raw,
        webhookId: config.paypalWebhookId
      });
    } catch (_) {
      /* Transport/5xx/token/ambiguous — 503 so PayPal retries. Repeated
         failures open the breaker so a provider outage cannot pin every
         request on a doomed outbound call. */
      consecutiveVerifyFailures += 1;
      if (consecutiveVerifyFailures >= breakerThreshold) breakerOpenUntil = now() + breakerCooldownMs;
      return sendJson(response, 503, { ok: false, error: 'verification_unavailable' });
    }
    consecutiveVerifyFailures = 0;
    breakerOpenUntil = 0;

    if (verification !== 'SUCCESS') {
      return sendJson(response, 400, { ok: false, error: 'verification_failed' });
    }

    const receivedAtIso = new Date(nowMs).toISOString();
    let status;
    try {
      status = await acceptPayPalEvent(parsed.event, raw, receivedAtIso);
    } catch (_) {
      return sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
    }

    /* Post-commit dispute handoff. Runs for duplicates too: a redelivery after
       a failed handoff hits the duplicate path, and applyPayPalDispute is an
       idempotent watermark-guarded upsert, so re-applying is safe while
       skipping would lose the case forever. A handoff failure is a 503 so
       PayPal redelivers. */
    if (/^CUSTOMER\.DISPUTE\./.test(parsed.event.eventType)) {
      try {
        await disputeCases.applyPayPalDispute(parsed.event.resource, {
          eventId: parsed.event.id,
          eventType: parsed.event.eventType,
          occurredAt: (typeof parsed.event.resource.update_time === 'string' &&
            Number.isFinite(Date.parse(parsed.event.resource.update_time)))
            ? new Date(Date.parse(parsed.event.resource.update_time)).toISOString()
            : (parsed.event.createTime || receivedAtIso)
        });
      } catch (_) {
        return sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
      }
    }

    return sendJson(response, 200, { ok: true, eventId: parsed.event.id, status });
  }

  async function handle(request, response, rawBody) {
    if (inFlight >= maxConcurrent) {
      return sendJson(response, 503, { ok: false, error: 'over_capacity' });
    }
    inFlight += 1;
    try {
      return await process(request, response, rawBody);
    } finally {
      inFlight -= 1;
    }
  }

  return { handle, acceptPayPalEvent };
}

module.exports = {
  MAX_BODY_BYTES,
  createPayPalWebhookHandler,
  parseEvent,
  precheckHeaders
};
