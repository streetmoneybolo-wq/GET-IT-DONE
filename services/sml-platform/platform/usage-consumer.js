'use strict';

/* =============================================================================
 * usage-consumer — copies accepted WordPress gateway `usage.*` events into the
 * hash-chained service_usage_events ledger (DESIGN v2 §4b.2).
 *
 * The gateway row is a signed, verified statement from WordPress that an
 * authenticated user performed an action. The WordPress user id on it is a
 * trusted person identifier, so the consumer links (or finds) the verified
 * billing identity through the identity graph before recording usage.
 *
 * Recorded: usage type, entitlement reference, timestamps, provenance.
 * Never recorded: IP addresses, user agents, device data (v1 policy — the
 * privacy-policy prerequisite is documented in DISPUTE-EVIDENCE-DEPLOY.md).
 * ========================================================================== */

const USAGE_TYPES = Object.freeze({
  'usage.login': 'login',
  'usage.group_access': 'group_access',
  'usage.content_access': 'content_access',
  'usage.stream_access': 'stream_access'
});

const UNIQUE_VIOLATION = '23505';
const MAX_SWEEP_LIMIT = 500;

function cleanText(value, maximum = 191) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= maximum ? cleaned : null;
}

function entitlementRef(row) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const explicit = cleanText(payload.entitlement) || cleanText(payload.planRef);
  if (explicit) return explicit;
  const groupId = payload.groupId != null ? String(payload.groupId) : null;
  if (groupId && /^\d{1,18}$/.test(groupId)) return `group:${groupId}`;
  const subjectType = cleanText(row.subject_type, 48);
  const subjectId = cleanText(row.subject_id, 191);
  if (subjectType && subjectId) return `${subjectType}:${subjectId}`;
  return null;
}

function createUsageConsumer({ pool, store, graph, now, logger } = {}) {
  if (!pool) throw new TypeError('a pg pool is required');
  if (!store) throw new TypeError('an evidence store is required');
  if (!graph) throw new TypeError('an identity graph is required');
  const clock = now || Date.now;
  const log = typeof logger === 'function' ? logger : () => {};

  async function consumeRow(row) {
    const usageType = USAGE_TYPES[row.event_type];
    if (!usageType) return 'skipped';
    const actorUserId = Number(row.actor_user_id);
    if (!Number.isSafeInteger(actorUserId) || actorUserId < 1) return 'skipped';
    const occurredAt = row.occurred_at instanceof Date
      ? row.occurred_at.toISOString()
      : new Date(Date.parse(String(row.occurred_at))).toISOString();
    const receivedAt = new Date(clock()).toISOString();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const identityId = await graph.linkVerified(client, {
        provider: 'wordpress',
        refType: 'user',
        refValue: String(actorUserId),
        wordpress_user_id: actorUserId,
        sml_user_id: actorUserId,
        via: `wordpress_gateway:${row.event_id}`,
        prov: {
          source: 'wordpress',
          source_event_id: row.event_id,
          provider_account: null,
          occurred_at: occurredAt,
          received_at: receivedAt,
          provenance: { link_via: 'signed_wordpress_gateway_event' }
        }
      });
      await store.appendChained(client, {
        table: 'service_usage_events',
        scopeKey: identityId,
        fields: {
          identity_id: identityId,
          usage_type: usageType,
          entitlement_ref: entitlementRef(row),
          source: 'wordpress',
          source_event_id: row.event_id,
          provider_account: null,
          occurred_at: occurredAt,
          received_at: receivedAt,
          /* Deliberately excludes payload contents: no IP, agent, or device
           * telemetry is copied in v1. */
          provenance: {
            gateway_row_id: row.id == null ? null : Number(row.id),
            subject_type: cleanText(row.subject_type, 48),
            subject_id: cleanText(row.subject_id, 191)
          }
        }
      });
      await client.query('COMMIT');
      return 'recorded';
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
      if (error && error.code === UNIQUE_VIOLATION) return 'duplicate';
      throw error;
    } finally {
      client.release();
    }
  }

  async function sweep(limit = 200) {
    const bounded = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, MAX_SWEEP_LIMIT) : 200;
    const found = await pool.query(
      `SELECT e.id, e.event_id, e.event_type, e.occurred_at, e.actor_user_id,
              e.subject_type, e.subject_id, e.payload
         FROM wordpress_gateway_events e
        WHERE e.event_type = ANY($1)
          AND e.actor_user_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM service_usage_events s
             WHERE s.source = 'wordpress' AND s.source_event_id = e.event_id)
        ORDER BY e.id ASC
        LIMIT $2`,
      [Object.keys(USAGE_TYPES), bounded]
    );
    const summary = { scanned: found.rows.length, recorded: 0, duplicate: 0, skipped: 0, failed: 0 };
    for (const row of found.rows) {
      try {
        const outcome = await consumeRow(row);
        summary[outcome] += 1;
      } catch (error) {
        summary.failed += 1;
        log('warn', 'usage_consumer_row_failed', { eventId: row.event_id, error });
      }
    }
    return summary;
  }

  return { consumeRow, sweep };
}

module.exports = { USAGE_TYPES, createUsageConsumer, entitlementRef };
