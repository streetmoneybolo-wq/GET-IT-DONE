'use strict';

/**
 * Upgrade.Chat supplemental reconciliation sweep (DESIGN v2 §2 worker item).
 *
 * A bounded, READ-ONLY pass over `upgrade_chat_records` that matches each
 * record to authoritative processor rows (billing_transactions /
 * billing_subscriptions) by the processor record id Upgrade.Chat reports.
 *
 * Everything this module learns is written through INJECTED recorders, never
 * directly by this module:
 *   - matches   -> billing_identity_refs rows, always verification='candidate'
 *                  (Upgrade.Chat data can suggest a link, never prove one);
 *   - conflicts -> contradiction rows in provenance (e.g. Upgrade.Chat shows
 *                  no cancellation while the processor subscription is
 *                  canceled). Processor-derived rows are NEVER mutated:
 *                  Upgrade.Chat facts are supplemental (externally billed)
 *                  and do not override Stripe/PayPal records on conflict.
 *
 * Upgrade.Chat API use is rate-limited by a minimum interval between calls
 * with an injected clock, so a large sweep cannot burst the provider.
 */

const PROCESSOR_PROVIDERS = { PAYPAL: 'paypal', STRIPE: 'stripe' };
const CANCELED_STATUSES = new Set(['canceled', 'cancelled', 'expired', 'revoked', 'ended', 'inactive']);
const ACTIVE_STATUSES = new Set(['active', 'trialing']);
const MAX_SWEEP_LIMIT = 500;

function createMinIntervalLimiter({ minIntervalMs, now = Date.now, sleep }) {
  if (!Number.isSafeInteger(minIntervalMs) || minIntervalMs < 0) {
    throw new TypeError('invalid minimum call interval');
  }
  if (typeof sleep !== 'function') throw new TypeError('a sleep function is required');
  let nextAllowedAt = 0;
  return async function waitForSlot() {
    const current = now();
    const wait = nextAllowedAt - current;
    nextAllowedAt = Math.max(current, nextAllowedAt) + minIntervalMs;
    if (wait > 0) await sleep(wait);
  };
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/* The stored payload is {event, order} for webhook-fed rows, but older or
   imported rows may hold the order at the top level. */
function orderBody(payload) {
  const outer = asObject(payload);
  if (!outer) return null;
  const nested = asObject(outer.order);
  if (nested) return nested;
  const eventData = asObject(outer.event) && asObject(outer.event.data);
  if (eventData) return eventData;
  if ('payment_processor' in outer || 'cancelled_at' in outer || 'uuid' in outer) return outer;
  return null;
}

/* true / false / null (unknown) — never guesses when the payload is opaque. */
function upgradeChatSaysActive(payload) {
  const order = orderBody(payload);
  if (!order) return null;
  if (order.deleted) return false;
  if (order.cancelled_at) return false;
  return true;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createUpgradeChatReconciler({
  pool,
  lookups,
  recordCandidateRef,
  recordContradiction,
  upgradeChatClient = null,
  minIntervalMs = 12_000,
  now = Date.now,
  sleep = defaultSleep,
  logger
}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('a database pool is required');
  if (!lookups ||
      typeof lookups.findTransactionByProcessorRecordId !== 'function' ||
      typeof lookups.findSubscriptionByProcessorRecordId !== 'function') {
    throw new TypeError('processor lookup functions are required');
  }
  if (typeof recordCandidateRef !== 'function') throw new TypeError('a candidate-ref recorder is required');
  if (typeof recordContradiction !== 'function') throw new TypeError('a contradiction recorder is required');
  const log = typeof logger === 'function' ? logger : () => {};
  const waitForSlot = createMinIntervalLimiter({ minIntervalMs, now, sleep });

  async function sweep({ limit = 25, sinceId = 0 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SWEEP_LIMIT) {
      throw new TypeError('invalid sweep limit');
    }
    if (!Number.isSafeInteger(sinceId) || sinceId < 0) throw new TypeError('invalid sweep cursor');

    /* The ONLY SQL this module ever issues: a bounded SELECT over its own
       supplemental ledger. Processor tables are reached exclusively through
       the injected read-only lookups. */
    const result = await pool.query(
      `SELECT id, webhook_event_id, uc_order_uuid, record_type, payload,
              payment_processor, payment_processor_record_id, discord_user_id
         FROM upgrade_chat_records
        WHERE id > $2
          AND payment_processor IS NOT NULL
          AND payment_processor_record_id IS NOT NULL
        ORDER BY id ASC
        LIMIT $1`,
      [limit, sinceId]
    );

    const summary = {
      scanned: 0,
      matchedTransactions: 0,
      matchedSubscriptions: 0,
      candidates: 0,
      contradictions: 0,
      lastId: sinceId
    };

    for (const record of result.rows) {
      summary.scanned += 1;
      summary.lastId = record.id;

      const provider = PROCESSOR_PROVIDERS[String(record.payment_processor || '').toUpperCase()];
      if (!provider) continue;

      /* Optional refresh from the API so status conflicts reflect current
         Upgrade.Chat state; a failed refresh falls back to the stored copy. */
      let payload = record.payload;
      if (upgradeChatClient && record.uc_order_uuid) {
        try {
          await waitForSlot();
          const fresh = await upgradeChatClient.getOrder(record.uc_order_uuid);
          if (asObject(fresh)) payload = { ...asObject(payload), order: fresh };
        } catch (error) {
          log('warn', 'upgrade_chat_reconcile_refresh_failed', { recordId: record.id, error });
        }
      }

      const processorRecordId = record.payment_processor_record_id;
      const transaction = await lookups.findTransactionByProcessorRecordId(provider, processorRecordId);
      const subscription = await lookups.findSubscriptionByProcessorRecordId(provider, processorRecordId);

      const nowIso = new Date(now()).toISOString();
      const prov = {
        source: 'upgrade_chat',
        source_event_id: record.webhook_event_id || null,
        occurred_at: nowIso,
        received_at: nowIso,
        provenance: { via: 'upgrade_chat_reconcile', upgrade_chat_record_id: record.id }
      };

      const matches = [];
      if (transaction) {
        summary.matchedTransactions += 1;
        matches.push({ refType: 'uc_transaction', row: transaction, table: 'billing_transactions' });
      }
      if (subscription) {
        summary.matchedSubscriptions += 1;
        matches.push({ refType: 'uc_subscription', row: subscription, table: 'billing_subscriptions' });
      }

      for (const match of matches) {
        await recordCandidateRef({
          identityId: match.row.identity_id == null ? null : match.row.identity_id,
          provider: 'upgrade_chat',
          refType: match.refType,
          refValue: record.uc_order_uuid || processorRecordId,
          discordUserId: record.discord_user_id || null,
          /* Structural: Upgrade.Chat matching can only ever nominate. */
          verification: 'candidate',
          citedRecords: [
            { table: 'upgrade_chat_records', id: record.id },
            { table: match.table, id: match.row.id }
          ],
          prov
        });
        summary.candidates += 1;
      }

      if (subscription) {
        const ucActive = upgradeChatSaysActive(payload);
        const processorStatus = String(subscription.status || '').toLowerCase();
        let code = null;
        if (ucActive === true && CANCELED_STATUSES.has(processorStatus)) {
          code = 'upgrade_chat_active_processor_canceled';
        } else if (ucActive === false && ACTIVE_STATUSES.has(processorStatus)) {
          code = 'upgrade_chat_cancelled_processor_active';
        }
        if (code) {
          const order = orderBody(payload) || {};
          await recordContradiction({
            code,
            detail: {
              upgrade_chat_cancelled_at: order.cancelled_at || null,
              upgrade_chat_deleted: !!order.deleted,
              processor_status: subscription.status == null ? null : subscription.status,
              note: 'Upgrade.Chat data is supplemental (externally billed) and does not override processor records.'
            },
            citedRecords: [
              { table: 'upgrade_chat_records', id: record.id },
              { table: 'billing_subscriptions', id: subscription.id }
            ],
            prov
          });
          summary.contradictions += 1;
        }
      }
    }

    return summary;
  }

  return { sweep };
}

module.exports = {
  ACTIVE_STATUSES,
  CANCELED_STATUSES,
  MAX_SWEEP_LIMIT,
  createMinIntervalLimiter,
  createUpgradeChatReconciler,
  orderBody,
  upgradeChatSaysActive
};
