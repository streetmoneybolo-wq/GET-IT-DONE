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
  let imported = null;
  try {
    await client.query('BEGIN');
    const planResult = await client.query(
      `SELECT * FROM group_plans WHERE id = $1 AND group_id = $2 AND active = true FOR SHARE`,
      [input.planId, input.groupId]
    );
    plan = planResult.rows[0];
    if (!plan) throw new Error('membership plan not found');
    if (Number(plan.platform_fee_bps) !== MEMBERSHIP_FEE_BPS) throw new Error('membership plan fee is not 6%');
    const sellerResult = await client.query(
      `SELECT * FROM marketplace_sellers
        WHERE owner_user_id = $1 AND charges_enabled = true AND details_submitted = true
        FOR SHARE`, [input.ownerUserId]
    );
    seller = sellerResult.rows[0];
    if (!seller) throw new Error('seller Stripe account is not ready');
    if (!seller.seller_terms_accepted_at || !seller.dispute_debit_consent_at ||
        !seller.membership_fee_accepted_at ||
        Number(seller.membership_fee_bps_accepted) !== MEMBERSHIP_FEE_BPS) {
      throw new Error('seller marketplace consent is incomplete');
    }
    if (input.importedSubscriptionId != null) {
      const importedResult = await client.query(
        `SELECT * FROM subscriptions
          WHERE id = $1 AND user_id = $2 AND group_id = $3
            AND origin = 'discord_imported' AND superseded_by IS NULL
          FOR UPDATE`,
        [input.importedSubscriptionId, input.userId, input.groupId]
      );
      imported = importedResult.rows[0];
      if (!imported) throw new Error('eligible imported subscription not found');
      const renewal = new Date(imported.current_period_end).getTime();
      const verified = new Date(imported.external_renewal_verified_at).getTime();
      if (!imported.external_renewal_source || !Number.isFinite(renewal) || !Number.isFinite(verified) ||
          verified < Date.now() - 24 * 3600 * 1000) {
        throw new Error('external renewal date is not recently provider-verified');
      }
      if (renewal < Date.now() + 48 * 3600 * 1000) {
        throw new Error('external renewal date is too close for safe migration');
      }
      const existingResult = await client.query(
        `SELECT * FROM subscriptions
          WHERE migration_from_subscription_id = $1
            AND status = 'incomplete' AND stripe_checkout_session_id IS NOT NULL
          FOR UPDATE`, [imported.id]
      );
      if (existingResult.rows[0]) {
        subscription = existingResult.rows[0];
        await client.query('COMMIT');
        const prior = await stripe.checkout.sessions.retrieve(subscription.stripe_checkout_session_id);
        return { subscriptionId: subscription.id, checkoutUrl: checkoutUrl(prior), reused: true };
      }
    }
    const checkoutKey = key('membership');
    const inserted = await client.query(
      `INSERT INTO subscriptions (
         user_id, group_id, plan_id, origin, status, connected_account_id,
         fee_consent_at, platform_fee_bps, membership_checkout_key,
         migration_from_subscription_id
       ) VALUES ($1,$2,$3,$4,'incomplete',$5,now(),$6,$7,$8) RETURNING *`,
      [input.userId, input.groupId, input.planId,
        imported ? 'migrated' : 'sml_checkout', seller.connected_account_id,
        MEMBERSHIP_FEE_BPS, checkoutKey,
        imported ? imported.id : null]
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
    successUrl: input.successUrl, cancelUrl: input.cancelUrl,
    migrationRenewalAt: imported ? imported.current_period_end : null
  }), { idempotencyKey: subscription.membership_checkout_key });
  await pool.query(
    `UPDATE subscriptions SET stripe_checkout_session_id = $2 WHERE id = $1`,
    [subscription.id, session.id]
  );
  return { subscriptionId: subscription.id, checkoutUrl: checkoutUrl(session) };
}

async function createSellerOnboarding(pool, stripe, input) {
  if (!input.acceptedSellerTerms || !input.acceptedDisputeDebits ||
      Number(input.acceptedMembershipFeeBps) !== MEMBERSHIP_FEE_BPS) {
    throw new Error('seller terms, dispute debit consent, and the 6% membership fee acceptance are required');
  }
  let found = await pool.query('SELECT * FROM marketplace_sellers WHERE owner_user_id = $1', [input.ownerUserId]);
  let seller = found.rows[0];
  if (!seller) {
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
         owner_user_id, connected_account_id, seller_terms_accepted_at,
         dispute_debit_consent_at, membership_fee_bps_accepted,
         membership_fee_accepted_at
       ) VALUES ($1,$2,now(),now(),$3,now())
       ON CONFLICT (owner_user_id) DO UPDATE SET
         connected_account_id = EXCLUDED.connected_account_id,
         seller_terms_accepted_at = now(),
         dispute_debit_consent_at = now(),
         membership_fee_bps_accepted = EXCLUDED.membership_fee_bps_accepted,
         membership_fee_accepted_at = now()
       RETURNING *`, [input.ownerUserId, account.id, MEMBERSHIP_FEE_BPS]
    );
    seller = inserted.rows[0];
  } else if (!seller.membership_fee_accepted_at ||
      Number(seller.membership_fee_bps_accepted) !== MEMBERSHIP_FEE_BPS) {
    const updated = await pool.query(
      `UPDATE marketplace_sellers SET
         seller_terms_accepted_at=now(), dispute_debit_consent_at=now(),
         membership_fee_bps_accepted=$2, membership_fee_accepted_at=now(), updated_at=now()
       WHERE owner_user_id=$1 RETURNING *`,
      [input.ownerUserId, MEMBERSHIP_FEE_BPS]
    );
    seller = updated.rows[0];
  }
  const link = await stripe.accountLinks.create({
    account: seller.connected_account_id,
    refresh_url: input.refreshUrl,
    return_url: input.returnUrl,
    type: 'account_onboarding'
  });
  return { sellerId: seller.id, onboardingUrl: link.url };
}

async function verifyImportedRenewal(pool, _stripe, input) {
  const renewalMs = new Date(input.renewalAt).getTime();
  const now = Date.now();
  if (!Number.isFinite(renewalMs) || renewalMs < now + 48 * 3600 * 1000 ||
      renewalMs > now + 400 * 24 * 3600 * 1000) {
    throw new TypeError('provider renewal date is outside the safe migration window');
  }
  const source = String(input.provider || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(source)) throw new TypeError('invalid renewal provider');
  const result = await pool.query(
    `UPDATE subscriptions
        SET current_period_end = $4,
            external_renewal_source = $5,
            external_renewal_verified_at = now()
      WHERE id = $1 AND user_id = $2 AND group_id = $3
        AND origin = 'discord_imported' AND superseded_by IS NULL
        AND external_reference = $6
      RETURNING id, current_period_end, external_renewal_source`,
    [input.importedSubscriptionId, input.userId, input.groupId,
      new Date(renewalMs).toISOString(), source, String(input.externalReference || '')]
  );
  if (result.rowCount !== 1) throw new Error('matching imported subscription not found');
  return {
    importedSubscriptionId: result.rows[0].id,
    renewalAt: new Date(result.rows[0].current_period_end).toISOString(),
    provider: result.rows[0].external_renewal_source
  };
}

async function prepareUpgradeChatMigration(pool, stripe, input, context = {}) {
  if (!context.upgradeChat) throw new Error('Upgrade.Chat migration is not configured');
  const discordUserId = String(input.discordUserId || '');
  if (!/^\d{15,24}$/.test(discordUserId)) throw new TypeError('a linked Discord identity is required');
  const mapKey = `${input.groupId}:${input.planId}`;
  const productUuid = context.upgradeChatPlanMap && context.upgradeChatPlanMap[mapKey];
  if (!productUuid) throw new TypeError('this group plan has no Upgrade.Chat migration mapping');

  const verified = await context.upgradeChat.findMembership({ discordUserId, productUuid });
  if (!verified.cancelledAt) {
    throw new TypeError('cancel the existing Upgrade.Chat renewal before moving billing; paid access remains until its verified end date');
  }
  const renewalMs = new Date(verified.renewalAt).getTime();
  const nowMs = typeof context.now === 'function' ? context.now() : Date.now();
  if (!Number.isFinite(renewalMs) || renewalMs < nowMs + 48 * 3600 * 1000) {
    throw new TypeError('the provider renewal date is too close for safe migration');
  }

  const client = await pool.connect();
  let importedSubscriptionId;
  try {
    await client.query('BEGIN');
    if (input.guildId) {
      const guildId = String(input.guildId);
      if (!/^\d{15,24}$/.test(guildId)) throw new TypeError('invalid Discord server identity');
      await client.query(
        `INSERT INTO discord_identities (user_id,discord_user_id,linked_at,revoked_at)
         VALUES ($1,$2,now(),NULL)
         ON CONFLICT (user_id) DO UPDATE SET discord_user_id=EXCLUDED.discord_user_id,revoked_at=NULL`,
        [input.userId, discordUserId]
      );
      await client.query(
        `INSERT INTO discord_guild_links (group_id,guild_id,linked_by,linked_at,active)
         VALUES ($1,$2,$3,now(),true)
         ON CONFLICT (group_id) DO UPDATE SET guild_id=EXCLUDED.guild_id,active=true,last_verified_at=now(),last_error=NULL`,
        [input.groupId, guildId, input.ownerUserId]
      );
    }
    const inserted = await client.query(
      `INSERT INTO subscriptions (
         user_id, group_id, plan_id, origin, status, external_platform,
         external_reference, current_period_end, access_until,
         external_renewal_source, external_renewal_verified_at
       ) VALUES ($1,$2,$3,'discord_imported','active','upgrade_chat',$4,$5,$5,'upgrade_chat',now())
       ON CONFLICT (external_platform, external_reference) WHERE origin = 'discord_imported' DO NOTHING
       RETURNING id`,
      [input.userId, input.groupId, input.planId, verified.externalReference, new Date(renewalMs).toISOString()]
    );
    if (inserted.rows[0]) {
      importedSubscriptionId = inserted.rows[0].id;
    } else {
      const found = await client.query(
        `SELECT * FROM subscriptions
          WHERE origin='discord_imported' AND external_platform='upgrade_chat' AND external_reference=$1
          FOR UPDATE`, [verified.externalReference]
      );
      const row = found.rows[0];
      if (!row || String(row.user_id) !== String(input.userId) || String(row.group_id) !== String(input.groupId)) {
        throw new TypeError('provider subscription is already linked to another account or group');
      }
      importedSubscriptionId = row.id;
      if (!row.superseded_by) {
        await client.query(
          `UPDATE subscriptions SET plan_id=$2,status='active',current_period_end=$3,access_until=$3,
             external_renewal_source='upgrade_chat',external_renewal_verified_at=now(),updated_at=now()
           WHERE id=$1`, [row.id, input.planId, new Date(renewalMs).toISOString()]
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
    throw error;
  } finally {
    client.release();
  }
  const checkout = await createMembershipCheckout(pool, stripe, { ...input, importedSubscriptionId });
  return { ...checkout, importedSubscriptionId, renewalAt: new Date(renewalMs).toISOString(), provider: 'upgrade_chat' };
}

module.exports = {
  createLoopBuckCheckout,
  createMembershipCheckout,
  createSellerOnboarding,
  verifyImportedRenewal,
  prepareUpgradeChatMigration,
  checkoutUrl
};
