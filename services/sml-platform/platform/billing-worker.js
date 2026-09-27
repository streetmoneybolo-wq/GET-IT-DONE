'use strict';

const crypto = require('node:crypto');
const { log: defaultLog } = require('./logger');

function retryDelaySeconds(attempts) {
  return Math.min(3600, 30 * (2 ** Math.min(Number(attempts || 0), 7)));
}

/* -------------------------------------------------------------------------- */
/* Dead-letter cap (PR-D)                                                      */
/* -------------------------------------------------------------------------- */

/* Without a cap a row that can never succeed (a bare payload for a Stripe
 * subscription with no subscriptions row, an intent with no handler) retries
 * every hour forever: retryDelaySeconds tops out at 3600 s and nothing else
 * stops it. SML_BILLING_OUTBOX_MAX_ATTEMPTS=N (20 recommended, roughly 14 hours
 * of retries) dead-letters such a row when its Nth attempt fails. Unset, 0 or
 * invalid means no cap, which is the legacy behaviour, so merging changes
 * nothing.
 *
 * The cap applies ONLY to rows that are unroutable (see unroutableReason):
 *   no_handler_registered  the worker registers no handler key for the intent
 *                          type. A key that is present but unconfigured (the
 *                          WordPress bridge or Stripe unset) is a transient
 *                          configuration gap and keeps retrying.
 *   no_subscription_row    a subscription_access_reconcile row whose payload
 *                          matched no subscriptions row when it was claimed
 *                          (Academy, Upgrade.Chat or Substack subscriptions on
 *                          the MEM account).
 *   no_recipient           a subscription_notify row with no user id (the
 *                          payment_failed notice for a rowless subscription).
 * Every other row keeps the legacy hourly retry however many attempts it has.
 * Each producer queues its row once under a unique source_key with ON CONFLICT
 * DO NOTHING (promoteSubscriptionIntents, expireGrace, the Connect reconcile),
 * so nothing would ever re-queue a dead grant or revoke: after an outage
 * longer than the cap a paying member would never get the role and a
 * canceled member would keep it. Real work therefore never dead-letters.
 *
 * billing_outbox_status_check (migration 008) allows only pending, processing,
 * processed and failed, and PR-D adds no migration. So a dead row keeps
 * status 'failed' and is parked with available_at = 'infinity': the claim
 * query (available_at <= now()) never selects it again. last_error starts
 * with 'dead_letter' and carries the reason. To find them:
 *   SELECT * FROM billing_outbox WHERE status = 'failed' AND available_at = 'infinity';
 * To retry one by hand, reset attempts too or it dies on its next failure:
 *   UPDATE billing_outbox SET available_at = now(), attempts = 0 WHERE id = ...;
 */
const MAX_ATTEMPTS_CEILING = 10000;
const RECOMMENDED_MAX_ATTEMPTS = 20;
const DEAD_LETTER_PREFIX = 'dead_letter';
const UNROUTABLE_REASONS = Object.freeze(['no_handler_registered', 'no_subscription_row', 'no_recipient']);

/* Intents whose permanent loss would lose money or keep charging a member:
 * a paid Loop Bucks credit, a seller debit or payout, and the cancellation of
 * the old external subscription after a migration. They keep the legacy
 * hourly retry whatever the cap says. */
const DEAD_LETTER_EXEMPT = new Set([
  'loop_bucks_credit',
  'seller_recovery',
  'seller_restore',
  'cancel_external_subscription'
]);

function parseMaxAttempts(value) {
  if (value == null) return 0;
  const text = String(value).trim();
  if (!text) return 0;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.min(MAX_ATTEMPTS_CEILING, Math.floor(n));
}

function resolveMaxAttempts(options = {}) {
  return parseMaxAttempts(options.maxAttempts !== undefined
    ? options.maxAttempts : process.env.SML_BILLING_OUTBOX_MAX_ATTEMPTS);
}

/* The attempt half of the rule: the cap is set, reached, and the intent is not
 * money-moving. finish() also requires the row to be unroutable. */
function isDeadLetter(intentType, attempts, maxAttempts) {
  return maxAttempts > 0 && !DEAD_LETTER_EXEMPT.has(intentType) &&
    Number(attempts || 0) >= maxAttempts;
}

function hasRecipient(payload) {
  const p = payload || {};
  return [p.user_id, p.userId].some((v) => v != null && String(v).trim() !== '');
}

/**
 * Why a claimed row can never succeed however long it retries, or null when it
 * is real work. handlers is the worker's handler map; omit it (a direct
 * finish() call) and the no-handler rule is skipped. An access row counts as
 * rowless only when enrichAccessPayload looked and found nothing
 * (subscriptionRowFound === false); a row that was never enriched is treated as
 * real work.
 */
function unroutableReason(row, handlers) {
  const type = row && row.intent_type;
  if (!type || DEAD_LETTER_EXEMPT.has(type)) return null;
  if (handlers && typeof handlers === 'object' &&
      !Object.prototype.hasOwnProperty.call(handlers, type)) return 'no_handler_registered';
  if (type === 'subscription_access_reconcile') {
    return row.subscriptionRowFound === false ? 'no_subscription_row' : null;
  }
  if (type === 'subscription_notify') return hasRecipient(row.payload) ? null : 'no_recipient';
  return null;
}

function safeLog(logger, level, event, fields) {
  try { (typeof logger === 'function' ? logger : defaultLog)(level, event, fields); }
  catch (_) { /* logging must never change an outbox outcome */ }
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
  /* subscriptionRowFound tells the dead-letter cap whether this row is real
     work (see unroutableReason). It is not a column and never reaches SQL. */
  if (!result.rows[0]) return { ...row, subscriptionRowFound: false };
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
    subscriptionRowFound: true,
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

/**
 * Settle a claimed row. Returns 'processed', 'failed' (retried after backoff)
 * or 'dead' (the row is unroutable and the attempt cap was reached; see the
 * dead-letter note above). options.maxAttempts overrides
 * SML_BILLING_OUTBOX_MAX_ATTEMPTS; options.unroutable is the worker's
 * classification (null = real work), and when it is absent the row is
 * classified without the handler map; options.logger receives the
 * billing_outbox_dead line.
 */
async function finish(pool, row, error, options = {}) {
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
    return 'processed';
  }
  const message = String(error && error.message || error).slice(0, 1000);
  const maxAttempts = resolveMaxAttempts(options);
  const unroutable = Object.prototype.hasOwnProperty.call(options, 'unroutable')
    ? options.unroutable : unroutableReason(row, null);
  let dead = null;
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
    const attempts = Number(current && current.attempts != null ? current.attempts : row.attempts) || 0;
    const intentType = (current && current.intent_type) || row.intent_type;
    if (unroutable && isDeadLetter(intentType, attempts, maxAttempts)) {
      dead = { attempts, intentType };
      await client.query(
        `UPDATE billing_outbox
            SET status = 'failed', last_error = $2, debt_recorded_cents = $3,
                available_at = 'infinity'::timestamptz
          WHERE id = $1`,
        [row.id,
          `${DEAD_LETTER_PREFIX} (${unroutable}): gave up after ${attempts} attempts (cap ${maxAttempts}); last error: ${message}`.slice(0, 1000),
          debt]
      );
    } else {
      await client.query(
        `UPDATE billing_outbox
            SET status = 'failed', last_error = $2, debt_recorded_cents = $4,
                available_at = now() + ($3 * interval '1 second')
          WHERE id = $1`,
        [row.id, message, retryDelaySeconds(row.attempts), debt]
      );
    }
    await client.query('COMMIT');
  } catch (finishError) {
    try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
    throw finishError;
  } finally {
    client.release();
  }
  if (!dead) return 'failed';
  safeLog(options.logger, 'warn', 'billing_outbox_dead', {
    outboxId: row.id,
    sourceKey: row.source_key,
    intentType: dead.intentType,
    attempts: dead.attempts,
    maxAttempts,
    unroutable,
    reason: message
  });
  return 'dead';
}

/**
 * One outbox step: 'empty', 'processed', 'failed' or, only when a dead-letter
 * cap is configured and the row is unroutable, 'dead'. The cap is read once
 * here, from options.maxAttempts or SML_BILLING_OUTBOX_MAX_ATTEMPTS.
 */
function createOutboxWorker(pool, handlers, options = {}) {
  const settle = { maxAttempts: resolveMaxAttempts(options), logger: options.logger };
  if (settle.maxAttempts > 0) {
    safeLog(settle.logger, 'info', 'billing_outbox_dead_letter_cap', {
      maxAttempts: settle.maxAttempts, appliesTo: [...UNROUTABLE_REASONS], exempt: [...DEAD_LETTER_EXEMPT]
    });
  }
  const failed = async (row, error) => (await finish(pool, row, error, {
    ...settle, unroutable: unroutableReason(row, handlers)
  })) === 'dead' ? 'dead' : 'failed';
  return async function processOne() {
    const row = await claimOne(pool, options);
    if (!row) return 'empty';
    const handler = handlers[row.intent_type];
    if (typeof handler !== 'function') {
      return failed(row, new Error(`no handler for ${row.intent_type}`));
    }
    try {
      await handler(row.payload, row);
      await finish(pool, row, null, settle);
      return 'processed';
    } catch (error) {
      return failed(row, error);
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
  parseMaxAttempts,
  resolveMaxAttempts,
  isDeadLetter,
  unroutableReason,
  DEAD_LETTER_EXEMPT,
  DEAD_LETTER_PREFIX,
  UNROUTABLE_REASONS,
  RECOMMENDED_MAX_ATTEMPTS,
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
