'use strict';

const lifecycle = require('../group-subs/src/lifecycle');
const { applyMarketplaceEvent } = require('./marketplace-events');

function stripeSubscriptionId(event) {
  const object = event && event.data && event.data.object;
  if (!object || typeof object !== 'object') return null;
  if (typeof object.subscription === 'string' && object.subscription) return object.subscription;
  if (object.subscription && typeof object.subscription === 'object' &&
      typeof object.subscription.id === 'string') return object.subscription.id;
  if (typeof object.id === 'string' && object.id.startsWith('sub_')) return object.id;
  return null;
}

function iso(value) {
  if (value == null) return null;
  return new Date(value).toISOString();
}

async function loadContext(client, event) {
  const subscriptionId = stripeSubscriptionId(event);
  if (!subscriptionId) return { subscription: null, plan: {} };

  const result = await client.query(
    `SELECT s.*, p.grace_days
       FROM subscriptions s
       LEFT JOIN group_plans p ON p.id = s.plan_id
      WHERE s.stripe_subscription_id = $1
      FOR UPDATE OF s`,
    [subscriptionId]
  );
  if (!result.rows[0]) return { subscription: null, plan: {} };

  const row = result.rows[0];
  return {
    subscription: row,
    plan: { grace_days: row.grace_days }
  };
}

async function updateSubscription(client, intent) {
  const columns = {
    status: (value) => value,
    current_period_end: iso,
    cancel_at_period_end: (value) => !!value,
    first_failed_at: iso,
    access_until: iso,
    canceled_at: iso,
    last_event_at: iso
  };
  const sets = [];
  const values = [intent.stripe_subscription_id];

  for (const [field, convert] of Object.entries(columns)) {
    if (!Object.prototype.hasOwnProperty.call(intent, field)) continue;
    values.push(convert(intent[field]));
    sets.push(`${field} = $${values.length}`);
  }
  if (intent.increment_failed_count) {
    sets.push('failed_payment_count = failed_payment_count + 1');
  }
  if (!sets.length) throw new Error('update_subscription contained no supported fields');

  await client.query(
    `UPDATE subscriptions SET ${sets.join(', ')} WHERE stripe_subscription_id = $1`,
    values
  );
}

async function enqueue(client, eventId, intentIndex, intent) {
  await client.query(
    `INSERT INTO subscription_intent_outbox (event_id, intent_index, intent_type, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (event_id, intent_index) DO NOTHING`,
    [eventId, intentIndex, intent.type, JSON.stringify(intent)]
  );
}

async function applyIntent(client, event, intent, intentIndex) {
  switch (intent.type) {
    case 'record_event':
      if (intent.event_id !== event.id) throw new Error('record_event id mismatch');
      return;

    case 'update_subscription':
      await updateSubscription(client, intent);
      return;

    case 'clear_failure_state':
      await client.query(
        `UPDATE subscriptions
            SET first_failed_at = NULL,
                failed_payment_count = 0,
                access_until = NULL
          WHERE stripe_subscription_id = $1`,
        [intent.stripe_subscription_id]
      );
      return;

    case 'record_fee':
      await client.query(
        `INSERT INTO platform_fee_ledger (
           subscription_id, group_id, stripe_invoice_id, stripe_charge_id,
           gross_cents, fee_cents, fee_bps, currency, consent_ref
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (stripe_invoice_id) DO NOTHING`,
        [
          intent.subscription_id, intent.group_id, intent.stripe_invoice_id,
          intent.stripe_charge_id, intent.gross_cents, intent.fee_cents,
          intent.fee_bps, intent.currency, intent.consent_ref
        ]
      );
      return;

    case 'sync_roles':
    case 'notify':
      await enqueue(client, event.id, intentIndex, intent);
      return;

    default:
      throw new Error(`unsupported lifecycle intent: ${intent.type}`);
  }
}

function resultStatus(result) {
  if (result.stale) return 'stale';
  if (result.ignored) return 'ignored';
  return 'processed';
}

function createStripeEventStore(pool, options = {}) {
  const handleEvent = options.handleEvent || lifecycle.handleEvent;
  const handleMarketplaceEvent = options.applyMarketplaceEvent || applyMarketplaceEvent;
  const now = options.now || Date.now;

  return async function acceptStripeEvent(event) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO stripe_events (
           event_id, event_type, api_version, event_created_at, status, payload
         ) VALUES ($1, $2, $3, $4, 'received', $5::jsonb)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [
          event.id,
          event.type,
          event.apiVersion,
          iso(event.created * 1000),
          JSON.stringify(event)
        ]
      );

      if (inserted.rowCount !== 1) {
        await client.query('COMMIT');
        return 'duplicate';
      }

      const marketplaceStatus = await handleMarketplaceEvent(client, event);
      const context = await loadContext(client, event);
      const result = handleEvent(event, {
        seenEventIds: new Set(),
        subscription: context.subscription,
        plan: context.plan,
        now: now()
      });
      if (!result || !result.ok) {
        throw new Error(result && result.error ? result.error : 'lifecycle rejected event');
      }

      for (let i = 0; i < result.intents.length; i += 1) {
        await applyIntent(client, event, result.intents[i], i);
      }

      const status = marketplaceStatus && marketplaceStatus !== 'ignored'
        ? marketplaceStatus : resultStatus(result);
      await client.query(
        `UPDATE stripe_events
            SET processed_at = now(), status = $2, error = NULL
          WHERE event_id = $1`,
        [event.id, status]
      );
      await client.query('COMMIT');
      return status;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
      throw error;
    } finally {
      client.release();
    }
  };
}

module.exports = {
  applyIntent,
  createStripeEventStore,
  loadContext,
  resultStatus,
  stripeSubscriptionId,
  updateSubscription
};
