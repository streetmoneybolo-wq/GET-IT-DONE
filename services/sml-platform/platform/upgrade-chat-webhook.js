'use strict';

/**
 * Upgrade.Chat webhook — wake-up only (DESIGN v2 §4b(9)).
 *
 * Upgrade.Chat webhook deliveries are UNSIGNED, so nothing in the inbound
 * request is evidence. This handler treats the POST purely as a wake-up:
 *
 *   1. The route carries an unguessable path token segment
 *      (`/v1/upgrade-chat/webhook/{SML_UC_WEBHOOK_PATH_TOKEN}`), compared in
 *      constant time. Mismatch -> 404 with no detail; token unconfigured ->
 *      503 fail closed.
 *   2. The body is parsed only far enough to extract a UUID event id. The
 *      body itself is never stored, never logged, and never trusted.
 *   3. The id is confirmed via the authenticated API
 *      (`GET /v1/webhook-events/{id}/validate` must return {valid:true}) and
 *      the authoritative event/order bodies are re-fetched from the API.
 *   4. Only API-fetched data is written to `upgrade_chat_records`
 *      (supplemental=true always; UNIQUE webhook_event_id -> duplicate=200).
 */

const crypto = require('node:crypto');
const { readRequestBody } = require('./wordpress-gateway');

const ROUTE_PREFIX = '/v1/upgrade-chat/webhook/';
/* The body only ever needs to carry an id; anything larger is discarded
   before any outbound call is made (DESIGN §4b(8) DoS bounds). */
const MAX_BODY_BYTES = 64 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECORD_TYPE_RE = /^[a-z][a-z0-9._-]{0,63}$/i;
const UNIQUE_VIOLATION = '23505';

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(payload);
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left), 'utf8');
  const b = Buffer.from(String(right), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function pathToken(url) {
  let pathname;
  try { pathname = new URL(String(url || ''), 'http://localhost').pathname; } catch (_) { return null; }
  if (!pathname.startsWith(ROUTE_PREFIX)) return null;
  const token = pathname.slice(ROUTE_PREFIX.length);
  if (!token || token.includes('/')) return null;
  return token;
}

/* Extract the ONLY thing the unsigned body is allowed to contribute: a
   UUID-shaped webhook event id. Every other byte is ignored. */
function extractEventId(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const key of ['id', 'event_id', 'webhook_event_id']) {
    const value = body[key];
    if (typeof value === 'string' && UUID_RE.test(value.trim())) return value.trim().toLowerCase();
  }
  return null;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/* Find the order uuid inside the API-fetched event, wherever the API put it. */
function orderUuidFrom(apiEvent) {
  const event = asObject(apiEvent);
  if (!event) return null;
  for (const container of [event.data, event.body, event.order, event.resource, event.payload]) {
    const candidate = asObject(container);
    if (candidate && typeof candidate.uuid === 'string' && UUID_RE.test(candidate.uuid)) {
      return candidate.uuid.toLowerCase();
    }
  }
  return null;
}

function cleanColumn(value, maximum = 191) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= maximum ? cleaned : null;
}

function isoOrNull(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const ms = typeof value === 'number' ? value * (value < 1e12 ? 1000 : 1) : Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

function createUpgradeChatWebhookHandler({ pool, config, upgradeChatClient, store, logger, now }) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('a database pool is required');
  if (!store || typeof store.appendRow !== 'function') throw new TypeError('an evidence store is required');
  const log = typeof logger === 'function' ? logger : () => {};
  const clock = typeof now === 'function' ? now : Date.now;
  const settings = config || {};

  async function handle(request, response, rawBody) {
    const configuredToken = settings.upgradeChatWebhookPathToken;
    if (!configuredToken) {
      /* SML_UC_WEBHOOK_PATH_TOKEN unset: fail closed, matching convention. */
      sendJson(response, 503, { ok: false, error: 'integration_unconfigured' });
      return;
    }

    const presented = request && request.method === 'POST' ? pathToken(request.url) : null;
    if (presented === null || !secureEqual(presented, configuredToken)) {
      /* No detail: a caller without the token learns nothing about the route. */
      sendJson(response, 404, { ok: false, error: 'not_found' });
      return;
    }

    let raw = rawBody;
    if (typeof raw !== 'string') {
      const body = await readRequestBody(request, MAX_BODY_BYTES);
      if (!body.ok) {
        sendJson(response, body.status, { ok: false, error: body.error });
        return;
      }
      raw = body.rawBody;
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
      sendJson(response, 413, { ok: false, error: 'payload_too_large' });
      return;
    }

    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) {
      sendJson(response, 400, { ok: false, error: 'invalid_json' });
      return;
    }
    const eventId = extractEventId(parsed);
    if (!eventId) {
      sendJson(response, 400, { ok: false, error: 'invalid_event' });
      return;
    }

    if (!upgradeChatClient) {
      /* No API credentials means no way to authenticate the event: closed. */
      sendJson(response, 503, { ok: false, error: 'integration_unconfigured' });
      return;
    }

    /* Duplicate wake-ups are collapsed before spending any API budget. */
    let existing;
    try {
      existing = await pool.query(
        'SELECT id FROM upgrade_chat_records WHERE webhook_event_id = $1',
        [eventId]
      );
    } catch (error) {
      log('error', 'upgrade_chat_webhook_lookup_failed', { error, eventId });
      sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
      return;
    }
    if (existing.rows[0]) {
      sendJson(response, 200, { ok: true, status: 'duplicate' });
      return;
    }

    /* Authenticity + authoritative body come ONLY from the API. */
    let validation;
    let apiEvent;
    let order = null;
    let orderUuid = null;
    try {
      validation = await upgradeChatClient.validateWebhookEvent(eventId);
    } catch (error) {
      log('error', 'upgrade_chat_webhook_validate_failed', { error, eventId });
      sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
      return;
    }
    if (!validation || validation.valid !== true) {
      /* The API did not vouch for this id: definitive rejection, nothing stored. */
      sendJson(response, 400, { ok: false, error: 'event_not_validated' });
      return;
    }
    try {
      apiEvent = await upgradeChatClient.getWebhookEvent(eventId);
      orderUuid = orderUuidFrom(apiEvent);
      if (orderUuid) order = await upgradeChatClient.getOrder(orderUuid);
    } catch (error) {
      log('error', 'upgrade_chat_webhook_fetch_failed', { error, eventId });
      sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
      return;
    }

    const eventObject = asObject(apiEvent) || {};
    const orderObject = asObject(order);
    /* Column extraction reads the API-fetched order (or the API event's own
       data) — never `parsed`, which is attacker-writable. */
    const columnSource = orderObject || asObject(eventObject.data) || {};
    const user = asObject(columnSource.user) || {};
    const nowIso = new Date(clock()).toISOString();
    const recordType = typeof eventObject.type === 'string' && RECORD_TYPE_RE.test(eventObject.type)
      ? eventObject.type : 'order';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const stored = await store.appendRow(client, {
        table: 'upgrade_chat_records',
        fields: {
          webhook_event_id: eventId,
          uc_order_uuid: orderUuid,
          record_type: recordType,
          payload: { event: eventObject, order: orderObject },
          payment_processor: cleanColumn(columnSource.payment_processor, 32),
          payment_processor_record_id: cleanColumn(columnSource.payment_processor_record_id),
          discord_user_id: cleanColumn(user.discord_id, 32),
          supplemental: true,
          source: 'upgrade_chat',
          source_event_id: eventId,
          provider_account: null,
          occurred_at: isoOrNull(columnSource.purchased_at) || isoOrNull(eventObject.created) || nowIso,
          received_at: nowIso,
          provenance: { fetched_via: 'upgrade_chat_api', validated: true, order_uuid: orderUuid }
        }
      });
      await client.query('COMMIT');
      log('info', 'upgrade_chat_webhook_stored', { eventId, recordId: stored.id });
      sendJson(response, 202, { ok: true, status: 'stored', recordId: stored.id });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
      if (error && error.code === UNIQUE_VIOLATION) {
        sendJson(response, 200, { ok: true, status: 'duplicate' });
        return;
      }
      log('error', 'upgrade_chat_webhook_store_failed', { error, eventId });
      sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
    } finally {
      client.release();
    }
  }

  return { handle };
}

module.exports = {
  MAX_BODY_BYTES,
  ROUTE_PREFIX,
  createUpgradeChatWebhookHandler,
  extractEventId,
  orderUuidFrom,
  pathToken
};
