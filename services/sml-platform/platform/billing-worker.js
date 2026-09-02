'use strict';

const crypto = require('node:crypto');

function retryDelaySeconds(attempts) {
  return Math.min(3600, 30 * (2 ** Math.min(Number(attempts || 0), 7)));
}

async function expireGrace(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const expired = await client.query(
      `SELECT id, user_id, group_id, stripe_subscription_id, access_until
         FROM subscriptions
        WHERE status IN ('grace','past_due','unpaid')
          AND failed_payment_count >= 3
          AND access_until <= now()
        FOR UPDATE SKIP LOCKED`
    );
    for (const row of expired.rows) {
      await client.query(
        `UPDATE subscriptions SET status = 'unpaid' WHERE id = $1`, [row.id]
      );
      await client.query(
        `INSERT INTO billing_outbox (source_key, intent_type, payload)
         VALUES ($1, 'subscription_access_reconcile', $2::jsonb)
         ON CONFLICT (source_key) DO NOTHING`,
        [`subscription-expired:${row.id}:${new Date(row.access_until).toISOString()}`, JSON.stringify({
          subscriptionId: row.id,
          stripeSubscriptionId: row.stripe_subscription_id,
          userId: String(row.user_id),
          groupId: String(row.group_id),
          reason: 'three_failed_attempts_and_72_hour_grace_expired'
        })]
      );
    }
    await client.query('COMMIT');
    return expired.rowCount;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
    throw error;
  } finally {
    client.release();
  }
}

async function promoteSubscriptionIntents(pool, limit = 100) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT * FROM subscription_intent_outbox
        WHERE status IN ('pending','failed') AND available_at <= now()
        ORDER BY available_at, id
        FOR UPDATE SKIP LOCKED LIMIT $1`, [limit]
    );
    for (const row of found.rows) {
      const type = row.intent_type === 'sync_roles' ? 'subscription_access_reconcile'
        : row.intent_type === 'notify' ? 'subscription_notify'
          : row.intent_type;
      await client.query(
        `INSERT INTO billing_outbox (source_key, intent_type, payload)
         VALUES ($1,$2,$3::jsonb) ON CONFLICT (source_key) DO NOTHING`,
        [`subscription-intent:${row.id}`, type, JSON.stringify(row.payload)]
      );
      await client.query(
        `UPDATE subscription_intent_outbox
            SET status = 'processed', processed_at = now(), last_error = NULL
          WHERE id = $1`, [row.id]
      );
    }
    await client.query('COMMIT');
    return found.rowCount;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
    throw error;
  } finally {
    client.release();
  }
}

const OPEN_DISPUTE_STATES = [
  'open', 'evidence_building', 'ready_for_review', 'approved', 'submitting', 'submitted', 'provider_review'
];
const UNDEFINED_TABLE = '42P01';

/**
 * Disputed-access policy (DESIGN v2 §4b.6). The merchant's explicitly
 * recorded policy for the subscription's merchant scope decides whether an
 * open dispute suspends access; the safe default (no policy row, or
 * keep_access) changes nothing. The decision is audited on the case chain
 * and surfaced in the payload so the WordPress bridge and the Discord
 * reconciler act on one deterministic answer. No other code touches roles.
 */
async function findDisputeSuspension(client, sub) {
  const found = await client.query(
    `SELECT c.id AS case_id, p.on_dispute
       FROM dispute_access_policies p
       JOIN dispute_cases c ON COALESCE(c.merchant_account, 'platform') = p.merchant_scope
       JOIN billing_identities bi ON bi.id = c.identity_id
      WHERE p.merchant_scope = COALESCE($1::text, 'platform')
        AND p.on_dispute = 'suspend_access'
        AND (bi.sml_user_id = $2 OR bi.wordpress_user_id = $2)
        AND c.case_state = ANY($3)
      ORDER BY c.id DESC
      LIMIT 1`,
    [sub.connected_account_id || null, Number(sub.user_id), OPEN_DISPUTE_STATES]
  );
  return found.rows[0] ? { caseId: Number(found.rows[0].case_id) } : null;
}

async function auditDisputeSuspension(client, store, sub, suspension, sourceKey) {
  if (!store || typeof store.appendChained !== 'function') return;
  const at = new Date().toISOString();
  await client.query('BEGIN');
  try {
    await store.appendChained(client, {
      table: 'dispute_audit_log',
      scopeKey: suspension.caseId,
      fields: {
        case_id: suspension.caseId,
        actor_kind: 'system',
        actor_ref: null,
        action: 'access_suspended_by_dispute_policy',
        detail: { subscription_id: Number(sub.id), group_id: Number(sub.group_id), outbox_source_key: sourceKey || null },
        source: 'sml_platform',
        source_event_id: sourceKey ? `access-reconcile:${sourceKey}` : null,
        provider_account: sub.connected_account_id || null,
        occurred_at: at,
        received_at: at,
        provenance: { policy: 'suspend_access' }
      }
    });
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
    throw error;
  }
}

async function enrichAccessPayload(client, row, options = {}) {
  if (!row || row.intent_type !== 'subscription_access_reconcile') return row;
  const payload = row.payload || {};
  const result = await client.query(
    `SELECT s.id,s.user_id,s.group_id,s.status,s.access_until,s.connected_account_id,
            di.discord_user_id,dg.guild_id,
            COALESCE(jsonb_agg(jsonb_build_object('target',g.target,'roleRef',g.role_ref))
              FILTER (WHERE g.id IS NOT NULL),'[]'::jsonb) AS grants
       FROM subscriptions s
       LEFT JOIN plan_role_grants g ON g.plan_id=s.plan_id
       LEFT JOIN discord_identities di ON di.user_id=s.user_id AND di.revoked_at IS NULL
       LEFT JOIN discord_guild_links dg ON dg.group_id=s.group_id AND dg.active=true
      WHERE ($1::bigint IS NOT NULL AND s.id=$1)
         OR ($2::text IS NOT NULL AND s.stripe_subscription_id=$2)
      GROUP BY s.id,di.discord_user_id,dg.guild_id
      LIMIT 1`,
    [payload.subscriptionId || null, payload.stripeSubscriptionId || payload.stripe_subscription_id || null]
  );
  if (!result.rows[0]) return row;
  const sub = result.rows[0];
  const active = sub.status === 'active' || sub.status === 'trialing' ||
    (['grace', 'past_due', 'unpaid'].includes(sub.status) && sub.access_until && new Date(sub.access_until) > new Date());
  let suspension = null;
  if (active && options.disputePolicyEnabled) {
    try {
      suspension = await findDisputeSuspension(client, sub);
    } catch (error) {
      /* The evidence schema may not be applied yet: no policy can exist, so
         the safe default (keep access) applies. Any other error surfaces. */
      if (!error || error.code !== UNDEFINED_TABLE) throw error;
      suspension = null;
    }
    if (suspension) await auditDisputeSuspension(client, options.store, sub, suspension, row.source_key);
  }
  return {
    ...row,
    payload: {
      ...payload,
      subscriptionId: sub.id,
      userId: String(sub.user_id),
      groupId: String(sub.group_id),
      discordUserId: sub.discord_user_id,
      guildId: sub.guild_id,
      active: suspension ? false : active,
      grants: sub.grants,
      ...(suspension ? {
        disputeSuspended: true,
        disputeCaseId: suspension.caseId,
        suspensionReason: 'merchant_policy_suspend_access_while_dispute_open'
      } : {})
    }
  };
}

async function claimOne(pool, options = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT * FROM billing_outbox
        WHERE status IN ('pending','failed') AND available_at <= now()
        ORDER BY available_at, id
        FOR UPDATE SKIP LOCKED LIMIT 1`
    );
    if (!found.rows[0]) {
      await client.query('COMMIT');
      return null;
    }
    const row = found.rows[0];
    await client.query(
      `UPDATE billing_outbox
          SET status = 'processing', attempts = attempts + 1, claimed_at = now(), last_error = NULL
        WHERE id = $1`, [row.id]
    );
    await client.query('COMMIT');
    return await enrichAccessPayload(client, { ...row, attempts: Number(row.attempts || 0) + 1 }, options);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
    throw error;
  } finally {
    client.release();
  }
}

async function finish(pool, row, error) {
  if (!error) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT * FROM billing_outbox WHERE id = $1 FOR UPDATE', [row.id]);
      const current = locked.rows[0];
      if (current && current.intent_type === 'seller_recovery' && Number(current.debt_recorded_cents) > 0) {
        const payload = current.payload || {};
        await client.query(
          `UPDATE marketplace_sellers
              SET debt_cents = GREATEST(0, debt_cents - $2)
            WHERE id = $1`, [payload.sellerId, Number(current.debt_recorded_cents)]
        );
      }
      await client.query(
        `UPDATE billing_outbox
            SET status = 'processed', processed_at = now(), last_error = NULL, debt_recorded_cents = 0
          WHERE id = $1`, [row.id]
      );
      await client.query('COMMIT');
    } catch (finishError) {
      try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
      throw finishError;
    } finally {
      client.release();
    }
    return;
  }
  const message = String(error && error.message || error).slice(0, 1000);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT * FROM billing_outbox WHERE id = $1 FOR UPDATE', [row.id]);
    const current = locked.rows[0];
    let debt = current ? Number(current.debt_recorded_cents || 0) : 0;
    if (current && current.intent_type === 'seller_recovery') {
      const payload = current.payload || {};
      const wanted = Number.isSafeInteger(error.unrecoveredCents)
        ? error.unrecoveredCents : Number(payload.amountCents || 0);
      const delta = Math.max(0, wanted - debt);
      if (delta > 0) {
        await client.query(
          `UPDATE marketplace_sellers SET debt_cents = debt_cents + $2 WHERE id = $1`,
          [payload.sellerId, delta]
        );
        debt += delta;
      }
    }
    await client.query(
      `UPDATE billing_outbox
          SET status = 'failed', last_error = $2, debt_recorded_cents = $4,
              available_at = now() + ($3 * interval '1 second')
        WHERE id = $1`,
      [row.id, message, retryDelaySeconds(row.attempts), debt]
    );
    await client.query('COMMIT');
  } catch (finishError) {
    try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
    throw finishError;
  } finally {
    client.release();
  }
}

function createOutboxWorker(pool, handlers, options = {}) {
  return async function processOne() {
    const row = await claimOne(pool, options);
    if (!row) return 'empty';
    const handler = handlers[row.intent_type];
    if (typeof handler !== 'function') {
      await finish(pool, row, new Error(`no handler for ${row.intent_type}`));
      return 'failed';
    }
    try {
      await handler(row.payload, row);
      await finish(pool, row, null);
      return 'processed';
    } catch (error) {
      await finish(pool, row, error);
      return 'failed';
    }
  };
}

function createWordPressHandler({ url, secret, fetchImpl = globalThis.fetch }) {
  if (!url || !secret) return null;
  return async function send(payload, row) {
    const body = JSON.stringify({
      sourceKey: row.source_key,
      intentType: row.intent_type,
      data: payload
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHmac('sha256', secret)
      .update(`${timestamp}.${body}`, 'utf8').digest('hex');
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sml-timestamp': timestamp,
        'x-sml-signature': signature,
        'idempotency-key': row.source_key
      },
      body
    });
    if (!response.ok) throw new Error(`WordPress billing bridge returned ${response.status}`);
  };
}

function createStripeRecoveryHandler(stripe) {
  if (!stripe) return null;
  return async function recover(payload, row) {
    const amount = Number(payload.amountCents);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('invalid seller recovery amount');
    let remaining = amount;

    if (payload.reason === 'dispute_principal') {
      const charge = await stripe.charges.retrieve(payload.chargeId);
      const transferId = typeof charge.transfer === 'string' ? charge.transfer
        : charge.transfer && charge.transfer.id;
      if (transferId) {
        const transfer = await stripe.transfers.retrieve(transferId);
        const reversible = Math.max(0, Number(transfer.amount || 0) - Number(transfer.amount_reversed || 0));
        const reverseAmount = Math.min(remaining, reversible);
        if (reverseAmount > 0) {
          await stripe.transfers.createReversal(transferId, {
            amount: reverseAmount,
            metadata: { sml_source_key: row.source_key, sml_dispute_id: payload.disputeId }
          }, { idempotencyKey: `${row.source_key}:reversal` });
          remaining -= reverseAmount;
        }
      }
    }

    if (remaining > 0) {
      /* Stripe Account Debits. This succeeds only for eligible Express/Custom
         accounts with binding consent and enough balance; otherwise the outbox
         remains failed and debt is recovered from future seller earnings. */
      try {
        await stripe.charges.create({
          amount: remaining,
          currency: payload.currency,
          source: payload.connectedAccountId,
          description: payload.reason === 'dispute_principal'
            ? 'Marketplace dispute principal recovery'
            : 'StockMarketLoop 12.5% seller dispute fee',
          metadata: { sml_source_key: row.source_key, sml_dispute_id: payload.disputeId }
        }, { idempotencyKey: `${row.source_key}:account-debit` });
      } catch (error) {
        error.unrecoveredCents = remaining;
        throw error;
      }
    }
  };
}

function createStripeRestoreHandler(stripe) {
  if (!stripe) return null;
  return async function restore(payload, row) {
    await stripe.transfers.create({
      amount: Number(payload.amountCents),
      currency: payload.currency,
      destination: payload.connectedAccountId,
      metadata: { sml_source_key: row.source_key, sml_dispute_id: payload.disputeId }
    }, { idempotencyKey: row.source_key });
  };
}

module.exports = {
  retryDelaySeconds,
  expireGrace,
  promoteSubscriptionIntents,
  claimOne,
  finish,
  createOutboxWorker,
  createWordPressHandler,
  createStripeRecoveryHandler,
  createStripeRestoreHandler,
  enrichAccessPayload,
  findDisputeSuspension
};
