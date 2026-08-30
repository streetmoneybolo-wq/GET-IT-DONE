'use strict';

const crypto = require('node:crypto');
const { loopBuckQuote, buildLoopBuckCheckout, buildMembershipCheckout, MEMBERSHIP_FEE_BPS } = require('./billing');

function key(prefix) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }

function checkoutUrl(session) {
  if (!session || typeof session.url !== 'string' || !session.url.startsWith('https://')) {
    throw new Error('Stripe did not return a Checkout URL');
  }
  return session.url;
}

async function createLoopBuckCheckout(pool, stripe, input) {
  const client = await pool.connect();
  let order;
  let packageRow;
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT * FROM loop_buck_packages WHERE slug = $1 AND active = true FOR SHARE`,
      [input.packageSlug]
    );
    packageRow = found.rows[0];
    if (!packageRow) throw new Error('Loop Bucks package not found');
    const quote = loopBuckQuote(Number(packageRow.price_cents));
    const orderKey = key('lb');
    const inserted = await client.query(
      `INSERT INTO loop_buck_orders (
         order_key, user_id, package_id, loop_bucks, subtotal_cents,
         service_fee_cents, total_cents, currency
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [orderKey, input.userId, packageRow.id, packageRow.loop_bucks,
        quote.subtotalCents, quote.serviceFeeCents, quote.totalCents, packageRow.currency]
    );
    order = inserted.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
    throw error;
  } finally {
    client.release();
  }

  const session = await stripe.checkout.sessions.create(buildLoopBuckCheckout({
    order, packageRow, successUrl: input.successUrl, cancelUrl: input.cancelUrl
  }), { idempotencyKey: order.order_key });
  await pool.query(
    `UPDATE loop_buck_orders SET status = 'checkout_open', stripe_checkout_session_id = $2 WHERE id = $1`,
    [order.id, session.id]
  );
  return { orderKey: order.order_key, checkoutUrl: checkoutUrl(session) };
}

async function createMembershipCheckout(pool, stripe, input) {
  const client = await pool.connect();
  let plan;
  let seller;
  let subscription;
  try {
    await client.query('BEGIN');
    const planResult = await client.query(
      `SELECT * FROM group_plans WHERE id = $1 AND group_id = $2 AND active = true FOR SHARE`,
      [input.planId, input.groupId]
    );
    plan = planResult.rows[0];
    if (!plan) throw new Error('membership plan not found');
    if (Number(plan.platform_fee_bps) !== MEMBERSHIP_FEE_BPS) throw new Error('membership plan fee is not 5%');
    const sellerResult = await client.query(
      `SELECT * FROM marketplace_sellers
        WHERE owner_user_id = $1 AND charges_enabled = true AND details_submitted = true
        FOR SHARE`, [input.ownerUserId]
    );
    seller = sellerResult.rows[0];
    if (!seller) throw new Error('seller Stripe account is not ready');
    if (!seller.seller_terms_accepted_at || !seller.dispute_debit_consent_at) {
      throw new Error('seller marketplace consent is incomplete');
    }
    const checkoutKey = key('membership');
    const inserted = await client.query(
      `INSERT INTO subscriptions (
         user_id, group_id, plan_id, origin, status, connected_account_id,
         fee_consent_at, platform_fee_bps, membership_checkout_key
       ) VALUES ($1,$2,$3,'sml_checkout','incomplete',$4,now(),$5,$6) RETURNING *`,
      [input.userId, input.groupId, input.planId, seller.connected_account_id,
        MEMBERSHIP_FEE_BPS, checkoutKey]
    );
    subscription = inserted.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
    throw error;
  } finally {
    client.release();
  }

  const session = await stripe.checkout.sessions.create(buildMembershipCheckout({
    plan, subscriptionKey: subscription.membership_checkout_key, userId: input.userId,
    connectedAccountId: seller.connected_account_id,
    successUrl: input.successUrl, cancelUrl: input.cancelUrl
  }), { idempotencyKey: subscription.membership_checkout_key });
  await pool.query(
    `UPDATE subscriptions SET stripe_checkout_session_id = $2 WHERE id = $1`,
    [subscription.id, session.id]
  );
  return { subscriptionId: subscription.id, checkoutUrl: checkoutUrl(session) };
}

async function createSellerOnboarding(pool, stripe, input) {
  let found = await pool.query('SELECT * FROM marketplace_sellers WHERE owner_user_id = $1', [input.ownerUserId]);
  let seller = found.rows[0];
  if (!seller) {
    if (!input.acceptedSellerTerms || !input.acceptedDisputeDebits) {
      throw new Error('seller terms and dispute debit consent are required');
    }
    const account = await stripe.accounts.create({
      type: 'express',
      country: input.country || 'US',
      email: input.email,
      capabilities: { transfers: { requested: true } },
      business_type: 'individual',
      metadata: { sml_owner_user_id: String(input.ownerUserId) }
    }, { idempotencyKey: `seller:${input.ownerUserId}` });
    const inserted = await pool.query(
      `INSERT INTO marketplace_sellers (
         owner_user_id, connected_account_id, seller_terms_accepted_at, dispute_debit_consent_at
       ) VALUES ($1,$2,now(),now())
       ON CONFLICT (owner_user_id) DO UPDATE SET connected_account_id = EXCLUDED.connected_account_id
       RETURNING *`, [input.ownerUserId, account.id]
    );
    seller = inserted.rows[0];
  }
  const link = await stripe.accountLinks.create({
    account: seller.connected_account_id,
    refresh_url: input.refreshUrl,
    return_url: input.returnUrl,
    type: 'account_onboarding'
  });
  return { sellerId: seller.id, onboardingUrl: link.url };
}

module.exports = {
  createLoopBuckCheckout,
  createMembershipCheckout,
  createSellerOnboarding,
  checkoutUrl
};
