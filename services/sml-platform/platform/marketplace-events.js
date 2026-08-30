'use strict';

const { disputeFee } = require('./billing');

const TYPES = new Set([
  'account.updated',
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'customer.subscription.created',
  'customer.subscription.updated',
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed'
]);

function objectOf(event) {
  return event && event.data && event.data.object && typeof event.data.object === 'object'
    ? event.data.object : {};
}

async function outbox(client, sourceKey, intentType, payload) {
  await client.query(
    `INSERT INTO billing_outbox (source_key, intent_type, payload)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (source_key) DO NOTHING`,
    [sourceKey, intentType, JSON.stringify(payload)]
  );
}

async function settleLoopBucks(client, event, session) {
  if (!session.metadata || session.metadata.sml_kind !== 'loop_bucks') return 'ignored';
  if (session.payment_status !== 'paid') return 'waiting';
  const orderKey = String(session.metadata.order_key || '');
  if (!orderKey) throw new Error('Loop Bucks checkout is missing order_key');

  const found = await client.query(
    `SELECT * FROM loop_buck_orders WHERE order_key = $1 FOR UPDATE`,
    [orderKey]
  );
  const order = found.rows[0];
  if (!order) throw new Error('Loop Bucks order not found');

  const expectedPretax = Number(order.subtotal_cents) + Number(order.service_fee_cents);
  if (Number(session.amount_subtotal) !== expectedPretax) {
    throw new Error('Stripe amount does not match Loop Bucks order');
  }
  if (String(session.currency || '').toLowerCase() !== String(order.currency).toLowerCase()) {
    throw new Error('Stripe currency does not match Loop Bucks order');
  }

  const tax = Number(session.total_details && session.total_details.amount_tax || 0);
  const total = Number(session.amount_total);
  if (!Number.isSafeInteger(tax) || tax < 0 || total !== expectedPretax + tax) {
    throw new Error('Stripe tax total is invalid');
  }

  await client.query(
    `UPDATE loop_buck_orders
        SET status = CASE WHEN status = 'credited' THEN status ELSE 'paid'::loop_buck_order_status END,
            tax_cents = $2,
            total_cents = $3,
            stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, $4),
            stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, $5),
            paid_at = COALESCE(paid_at, to_timestamp($6))
      WHERE id = $1`,
    [order.id, tax, total, session.id, session.payment_intent || null, event.created]
  );

  await outbox(client, `loop-bucks:${order.order_key}`, 'loop_bucks_credit', {
    orderId: order.id,
    orderKey: order.order_key,
    userId: String(order.user_id),
    loopBucks: Number(order.loop_bucks),
    sourceRef: `purchase:${order.order_key}`
  });
  return 'processed';
}

async function findSeller(client, event, dispute) {
  const metadataSeller = dispute.metadata && String(dispute.metadata.sml_seller_id || '');
  if (/^[1-9][0-9]*$/.test(metadataSeller)) {
    const direct = await client.query('SELECT * FROM marketplace_sellers WHERE id = $1', [metadataSeller]);
    if (direct.rows[0]) return direct.rows[0];
  }
  if (event.account) {
    const direct = await client.query(
      'SELECT * FROM marketplace_sellers WHERE connected_account_id = $1', [event.account]
    );
    if (direct.rows[0]) return direct.rows[0];
  }
  const byCharge = await client.query(
    `SELECT ms.*
       FROM platform_fee_ledger pfl
       JOIN subscriptions s ON s.id = pfl.subscription_id
       JOIN marketplace_sellers ms ON ms.connected_account_id = s.connected_account_id
      WHERE pfl.stripe_charge_id = $1
      ORDER BY pfl.id DESC LIMIT 1`,
    [String(dispute.charge || '')]
  );
  return byCharge.rows[0] || null;
}

function disputeState(dispute) {
  const status = String(dispute.status || 'needs_response');
  if (status === 'won' || status === 'lost' || status === 'warning_closed') return status;
  if (status === 'under_review') return 'under_review';
  return 'needs_response';
}

async function ensureDispute(client, event, dispute) {
  const seller = await findSeller(client, event, dispute);
  /* A Loop Bucks/customer-platform dispute has no marketplace seller. The
     separate 12.5% seller fee must never be charged to an unrelated account. */
  if (!seller) return null;
  if (!seller.dispute_debit_consent_at) throw new Error('seller dispute-debit consent is missing');

  const principal = Number(dispute.amount || 0);
  if (!Number.isSafeInteger(principal) || principal <= 0) throw new Error('invalid dispute amount');
  const fee = disputeFee(principal);
  const state = disputeState(dispute);

  const result = await client.query(
    `INSERT INTO marketplace_disputes (
       stripe_dispute_id, seller_id, stripe_charge_id, disputed_principal_cents,
       platform_dispute_fee_cents, currency, state
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (stripe_dispute_id) DO UPDATE SET state = EXCLUDED.state
     RETURNING *`,
    [dispute.id, seller.id, dispute.charge, principal, fee, dispute.currency || seller.currency, state]
  );
  return { seller, row: result.rows[0] };
}

async function applyDispute(client, event, dispute) {
  const context = await ensureDispute(client, event, dispute);
  if (!context) return 'ignored';
  const { seller, row } = context;
  const base = { sellerId: seller.id, connectedAccountId: seller.connected_account_id,
    disputeId: dispute.id, chargeId: dispute.charge, currency: row.currency };

  if (event.type === 'charge.dispute.created') {
    await client.query(
      `INSERT INTO seller_ledger (seller_id, source_key, kind, amount_cents, currency, stripe_object_id, related_dispute_id)
       VALUES ($1, $2, 'dispute_hold', $3, $4, $5, $5)
       ON CONFLICT (source_key) DO NOTHING`,
      [seller.id, `dispute-hold:${dispute.id}`, -Number(row.disputed_principal_cents), row.currency, dispute.id]
    );
    await outbox(client, `seller-recover-principal:${dispute.id}`, 'seller_recovery', {
      ...base, amountCents: Number(row.disputed_principal_cents), reason: 'dispute_principal'
    });
  }

  if (event.type === 'charge.dispute.closed' && row.state === 'lost' && !row.fee_finalized_at) {
    await client.query(
      `INSERT INTO seller_ledger (seller_id, source_key, kind, amount_cents, currency, stripe_object_id, related_dispute_id)
       VALUES ($1, $2, 'dispute_fee', $3, $4, $5, $5)
       ON CONFLICT (source_key) DO NOTHING`,
      [seller.id, `dispute-fee:${dispute.id}`, -Number(row.platform_dispute_fee_cents), row.currency, dispute.id]
    );
    await outbox(client, `seller-recover-fee:${dispute.id}`, 'seller_recovery', {
      ...base, amountCents: Number(row.platform_dispute_fee_cents), reason: 'platform_dispute_fee_12_5_percent'
    });
    await client.query(
      `UPDATE marketplace_disputes SET fee_finalized_at = now(), resolved_at = now()
        WHERE stripe_dispute_id = $1`, [dispute.id]
    );
  }

  if (event.type === 'charge.dispute.closed' &&
      (row.state === 'won' || row.state === 'warning_closed')) {
    await client.query(
      `INSERT INTO seller_ledger (seller_id, source_key, kind, amount_cents, currency, stripe_object_id, related_dispute_id)
       VALUES ($1, $2, 'dispute_reversal', $3, $4, $5, $5)
       ON CONFLICT (source_key) DO NOTHING`,
      [seller.id, `dispute-restored:${dispute.id}`, Number(row.disputed_principal_cents), row.currency, dispute.id]
    );
    await outbox(client, `seller-restore:${dispute.id}`, 'seller_restore', {
      ...base, amountCents: Number(row.disputed_principal_cents), reason: 'dispute_won'
    });
    await client.query(
      `UPDATE marketplace_disputes SET resolved_at = now() WHERE stripe_dispute_id = $1`, [dispute.id]
    );
  }
  return 'processed';
}

async function applyMarketplaceEvent(client, event) {
  if (!TYPES.has(event.type)) return 'ignored';
  const object = objectOf(event);
  if (event.type === 'account.updated') {
    const result = await client.query(
      `UPDATE marketplace_sellers
          SET charges_enabled = $2, payouts_enabled = $3, details_submitted = $4
        WHERE connected_account_id = $1`,
      [object.id, !!object.charges_enabled, !!object.payouts_enabled, !!object.details_submitted]
    );
    return result.rowCount === 1 ? 'processed' : 'ignored';
  }
  if (event.type.startsWith('checkout.session.')) return settleLoopBucks(client, event, object);
  if (event.type.startsWith('customer.subscription.')) {
    const key = object.metadata && String(object.metadata.subscription_key || '');
    if (!key) return 'ignored';
    const result = await client.query(
      `UPDATE subscriptions
          SET stripe_subscription_id = COALESCE(stripe_subscription_id, $2),
              stripe_customer_id = COALESCE(stripe_customer_id, $3)
        WHERE membership_checkout_key = $1
          AND (stripe_subscription_id IS NULL OR stripe_subscription_id = $2)`,
      [key, object.id, typeof object.customer === 'string' ? object.customer : null]
    );
    if (result.rowCount !== 1) throw new Error('membership checkout key not found or already bound');
    return 'processed';
  }
  return applyDispute(client, event, object);
}

module.exports = { TYPES, applyMarketplaceEvent, settleLoopBucks, applyDispute, disputeState };
