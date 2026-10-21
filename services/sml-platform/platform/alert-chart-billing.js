'use strict';

/* Premium Alert Charts, sold through stockmarketloop.com.
 *
 * A trader who sets a channel of their Alert Chart to premium gets paid through the site's marketplace: the same
 * Stripe Connect Express account, seller terms and dispute rules the site already offers Discord group owners
 * (marketplace_sellers, billing-service.js createSellerOnboarding). A subscriber buys 1 day, a week, a month, a year
 * or lifetime access in Stripe Checkout; stockmarketloop.com processes the payment, keeps 6% and pays the trader the
 * rest (a Connect destination charge). Access in the Academy (academy_alert_access, read by academy-trader-alerts.js)
 * is written only from the signed Stripe webhook, inside the same transaction as the rest of the marketplace events.
 *
 * Disputes: a chargeback on an Alert Chart sale runs through the marketplace dispute flow (marketplace-events.js):
 * the disputed amount is held back from the trader, and when the dispute is lost a 15% dispute fee goes to
 * stockmarketloop.com. The dispute context records how long the trader had been quiet; a chart with no alert or
 * update in the last 30 days is the "not fulfilling the subscription" case with low chances of winning.
 *
 * Identity: the Academy knows members by Discord id; the site's marketplace knows sellers by WordPress user id. A
 * trader must have their Discord linked to their stockmarketloop.com account (billing_identities /
 * discord_identities, or the site's own link table through the LOOP-KICK bridge card) before they can connect
 * Stripe. A subscriber needs no site account; their WordPress id is attached to the sale when it is known. */

const crypto = require('node:crypto');
const { buildAlertChartCheckout, ALERT_CHART_PLANS, ALERT_CHART_FEE_BPS, ALERT_CHART_DISPUTE_FEE_BPS } = require('./billing');

const SNOWFLAKE = /^\d{15,25}$/;
const DAY_MS = 86_400_000;
const GRACE_DAYS = 3;
const INACTIVE_DAYS = 30;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS alert_chart_sellers (
     trader_discord_id TEXT PRIMARY KEY, wp_user_id BIGINT NOT NULL, seller_id BIGINT,
     terms_accepted_at TIMESTAMPTZ, fee_bps_accepted INTEGER NOT NULL DEFAULT ${ALERT_CHART_FEE_BPS},
     dispute_fee_bps_accepted INTEGER NOT NULL DEFAULT ${ALERT_CHART_DISPUTE_FEE_BPS}, activity_rule_accepted_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS alert_chart_subscriptions (
     id BIGSERIAL PRIMARY KEY, checkout_key TEXT NOT NULL UNIQUE,
     subscriber_discord_id TEXT NOT NULL, subscriber_wp_user_id BIGINT,
     trader_discord_id TEXT NOT NULL, trader_wp_user_id BIGINT NOT NULL, seller_id BIGINT NOT NULL, connected_account_id TEXT NOT NULL,
     plan TEXT NOT NULL, price_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'usd', platform_fee_bps INTEGER NOT NULL DEFAULT ${ALERT_CHART_FEE_BPS},
     status TEXT NOT NULL DEFAULT 'checkout_open',
     stripe_checkout_session_id TEXT, stripe_subscription_id TEXT, stripe_customer_id TEXT, stripe_payment_intent_id TEXT,
     access_until TIMESTAMPTZ, paid_at TIMESTAMPTZ, canceled_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  'CREATE INDEX IF NOT EXISTS alert_chart_subscriptions_stripe_sub_idx ON alert_chart_subscriptions (stripe_subscription_id)',
  'CREATE INDEX IF NOT EXISTS alert_chart_subscriptions_pair_idx ON alert_chart_subscriptions (subscriber_discord_id, trader_discord_id)',
  `CREATE TABLE IF NOT EXISTS alert_chart_charges (
     stripe_payment_intent_id TEXT PRIMARY KEY, stripe_charge_id TEXT, subscription_id BIGINT NOT NULL,
     amount_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'usd', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  'CREATE INDEX IF NOT EXISTS alert_chart_charges_charge_idx ON alert_chart_charges (stripe_charge_id)',
  /* the access table the Academy reads (same definition as academy-trader-alerts.js, so either side may create it first) */
  'CREATE TABLE IF NOT EXISTS academy_alert_access (member_id TEXT NOT NULL, trader_id TEXT NOT NULL, plan TEXT NOT NULL, until TIMESTAMPTZ, source TEXT NOT NULL DEFAULT \'\', reference TEXT NOT NULL DEFAULT \'\', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (member_id, trader_id))',
  /* the room tier a sale was for (academy-trading-room.js); empty for a plain Alert Chart sale */
  'ALTER TABLE alert_chart_subscriptions ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT \'\'',
  'ALTER TABLE academy_alert_access ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT \'\'',
  /* which product a marketplace dispute is about, and the facts the case is decided on (creator inactivity) */
  'ALTER TABLE marketplace_disputes ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT \'membership\'',
  'ALTER TABLE marketplace_disputes ADD COLUMN IF NOT EXISTS context JSONB NOT NULL DEFAULT \'{}\''
];

function objectOf(event) { return event && event.data && event.data.object && typeof event.data.object === 'object' ? event.data.object : {}; }
function idOf(value) { return typeof value === 'string' ? value : value && typeof value === 'object' && typeof value.id === 'string' ? value.id : ''; }
function secondsOf(event, now) { const s = Number(event && event.created); return Number.isFinite(s) && s > 0 ? s : Math.floor(now() / 1000); }
/* a lookup that must not abort the webhook transaction when the Alert Chart tables are not there (billing switched off) */
async function probe(client, fn) {
  await client.query('SAVEPOINT alert_chart_probe');
  try { const out = await fn(); await client.query('RELEASE SAVEPOINT alert_chart_probe'); return out; }
  catch (_) { try { await client.query('ROLLBACK TO SAVEPOINT alert_chart_probe'); } catch (__) { /* not in a transaction */ } return null; }
}

/* ---------- the webhook side: runs inside the marketplace event transaction with a pg client ---------- */

async function grantAccess(client, { memberId, traderId, plan, until, reference, tier = '' }) {
  await client.query(
    `INSERT INTO academy_alert_access (member_id, trader_id, plan, until, source, reference, tier)
     VALUES ($1,$2,$3,$4,'stockmarketloop',$5,$6)
     ON CONFLICT (member_id, trader_id) DO UPDATE SET plan = EXCLUDED.plan, until = EXCLUDED.until, source = EXCLUDED.source, reference = EXCLUDED.reference, tier = EXCLUDED.tier, created_at = now()`,
    [memberId, traderId, plan, until, reference, String(tier || '')]
  );
}
async function endAccess(client, { memberId, traderId, reference, atSeconds }) {
  /* only the access this sale granted: a lifetime bought separately is never shortened by a lapsed monthly plan */
  await client.query(
    `UPDATE academy_alert_access SET until = LEAST(COALESCE(until, to_timestamp($4)), to_timestamp($4))
      WHERE member_id = $1 AND trader_id = $2 AND reference = $3`,
    [memberId, traderId, reference, atSeconds]
  );
}
async function recordCharge(client, { paymentIntentId, chargeId, subscriptionId, amountCents, currency }) {
  if (!paymentIntentId) return;
  await client.query(
    `INSERT INTO alert_chart_charges (stripe_payment_intent_id, stripe_charge_id, subscription_id, amount_cents, currency)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (stripe_payment_intent_id) DO UPDATE SET stripe_charge_id = COALESCE(alert_chart_charges.stripe_charge_id, EXCLUDED.stripe_charge_id)`,
    [paymentIntentId, chargeId || null, subscriptionId, Math.max(0, Number(amountCents) || 0), String(currency || 'usd').toLowerCase()]
  );
}

async function settleCheckout(client, event, session, now) {
  if (!session.metadata || session.metadata.sml_kind !== 'alert_chart') return 'ignored';
  if (session.payment_status !== 'paid') return 'waiting';
  const key = String(session.metadata.alert_chart_key || '');
  if (!key) throw new Error('Alert Chart checkout is missing alert_chart_key');
  const found = await client.query('SELECT * FROM alert_chart_subscriptions WHERE checkout_key = $1 FOR UPDATE', [key]);
  const row = found.rows[0];
  if (!row) throw new Error('Alert Chart checkout not found');
  if (session.amount_subtotal != null && Number(session.amount_subtotal) !== Number(row.price_cents)) throw new Error('Stripe amount does not match the Alert Chart price');
  if (session.currency && String(session.currency).toLowerCase() !== String(row.currency).toLowerCase()) throw new Error('Stripe currency does not match the Alert Chart price');
  const spec = ALERT_CHART_PLANS[row.plan];
  if (!spec) throw new Error('unknown Alert Chart plan on record');
  const paidSec = secondsOf(event, now);
  /* a one-time plan runs from the payment; a recurring plan's exact period end arrives with invoice.paid, this is the floor */
  const until = spec.days == null ? null : new Date(paidSec * 1000 + spec.days * DAY_MS + (spec.mode === 'subscription' ? GRACE_DAYS * DAY_MS : 0));
  await client.query(
    `UPDATE alert_chart_subscriptions
        SET status = 'active',
            stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, $2),
            stripe_subscription_id = COALESCE(stripe_subscription_id, $3),
            stripe_customer_id = COALESCE(stripe_customer_id, $4),
            stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, $5),
            paid_at = COALESCE(paid_at, to_timestamp($6)),
            access_until = CASE WHEN $7::timestamptz IS NULL THEN NULL ELSE GREATEST(COALESCE(access_until, $7::timestamptz), $7::timestamptz) END,
            updated_at = now()
      WHERE id = $1`,
    [row.id, session.id || null, idOf(session.subscription) || null, idOf(session.customer) || null, idOf(session.payment_intent) || null, paidSec, until]
  );
  await recordCharge(client, { paymentIntentId: idOf(session.payment_intent), chargeId: null, subscriptionId: row.id, amountCents: session.amount_total != null ? session.amount_total : row.price_cents, currency: session.currency || row.currency });
  await grantAccess(client, { memberId: row.subscriber_discord_id, traderId: row.trader_discord_id, plan: row.plan, until, reference: key, tier: row.tier });
  return 'processed';
}

async function settleInvoice(client, event, invoice, now) {
  const subId = idOf(invoice.subscription) || idOf(invoice.parent && invoice.parent.subscription_details && invoice.parent.subscription_details.subscription);
  const metaKey = invoice.subscription_details && invoice.subscription_details.metadata && String(invoice.subscription_details.metadata.alert_chart_key || '');
  let row = null;
  if (subId) row = await probe(client, async () => (await client.query('SELECT * FROM alert_chart_subscriptions WHERE stripe_subscription_id = $1 FOR UPDATE', [subId])).rows[0] || null);
  if (!row && metaKey) row = await probe(client, async () => (await client.query('SELECT * FROM alert_chart_subscriptions WHERE checkout_key = $1 FOR UPDATE', [metaKey])).rows[0] || null);
  if (!row) return 'ignored';
  if (String(invoice.status || 'paid') !== 'paid' && invoice.paid !== true) return 'waiting';
  const lines = invoice.lines && Array.isArray(invoice.lines.data) ? invoice.lines.data : [];
  let endSec = 0;
  for (const line of lines) if (line && line.period && Number(line.period.end) > endSec) endSec = Number(line.period.end);
  if (!endSec) endSec = Number(invoice.period_end) || secondsOf(event, now) + (ALERT_CHART_PLANS[row.plan] ? ALERT_CHART_PLANS[row.plan].days || 30 : 30) * 86_400;
  const until = new Date(endSec * 1000 + GRACE_DAYS * DAY_MS);
  await client.query(
    `UPDATE alert_chart_subscriptions
        SET status = 'active', stripe_subscription_id = COALESCE(stripe_subscription_id, $2), stripe_customer_id = COALESCE(stripe_customer_id, $3),
            paid_at = COALESCE(paid_at, to_timestamp($4)), access_until = $5, updated_at = now()
      WHERE id = $1`,
    [row.id, subId || null, idOf(invoice.customer) || null, secondsOf(event, now), until]
  );
  await recordCharge(client, { paymentIntentId: idOf(invoice.payment_intent), chargeId: idOf(invoice.charge) || null, subscriptionId: row.id, amountCents: invoice.amount_paid != null ? invoice.amount_paid : row.price_cents, currency: invoice.currency || row.currency });
  await grantAccess(client, { memberId: row.subscriber_discord_id, traderId: row.trader_discord_id, plan: row.plan, until, reference: row.checkout_key, tier: row.tier });
  return 'processed';
}

async function settleSubscription(client, event, sub, now) {
  if (!sub.metadata || sub.metadata.sml_kind !== 'alert_chart') return 'ignored';
  const key = String(sub.metadata.alert_chart_key || '');
  let row = key ? (await client.query('SELECT * FROM alert_chart_subscriptions WHERE checkout_key = $1 FOR UPDATE', [key])).rows[0] || null : null;
  if (!row && sub.id) row = (await client.query('SELECT * FROM alert_chart_subscriptions WHERE stripe_subscription_id = $1 FOR UPDATE', [sub.id])).rows[0] || null;
  if (!row) return 'ignored';
  const status = String(sub.status || 'active');
  const ended = event.type === 'customer.subscription.deleted' || status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired';
  const atSec = secondsOf(event, now);
  if (ended) {
    await client.query(
      `UPDATE alert_chart_subscriptions
          SET status = 'canceled', canceled_at = COALESCE(canceled_at, to_timestamp($2)),
              access_until = LEAST(COALESCE(access_until, to_timestamp($2)), to_timestamp($2)), updated_at = now()
        WHERE id = $1`,
      [row.id, atSec]
    );
    await endAccess(client, { memberId: row.subscriber_discord_id, traderId: row.trader_discord_id, reference: row.checkout_key, atSeconds: atSec });
    return 'processed';
  }
  await client.query(
    `UPDATE alert_chart_subscriptions
        SET stripe_subscription_id = COALESCE(stripe_subscription_id, $2), stripe_customer_id = COALESCE(stripe_customer_id, $3),
            status = CASE WHEN status = 'checkout_open' THEN status ELSE $4 END, updated_at = now()
      WHERE id = $1`,
    [row.id, sub.id || null, idOf(sub.customer) || null, status === 'past_due' ? 'past_due' : 'active']
  );
  return 'processed';
}

/** One Stripe event about an Alert Chart sale; 'ignored' when the event is about something else. */
async function applyAlertChartEvent(client, event, { now = Date.now } = {}) {
  const type = String(event && event.type || '');
  const object = objectOf(event);
  if (type.startsWith('checkout.session.')) return settleCheckout(client, event, object, now);
  if (type === 'invoice.paid') return settleInvoice(client, event, object, now);
  if (type.startsWith('customer.subscription.')) return settleSubscription(client, event, object, now);
  return 'ignored';
}

/** Is this dispute about an Alert Chart sale? The seller, the sale and how long the trader has been quiet. */
async function alertChartDisputeContext(client, dispute, { now = Date.now } = {}) {
  const chargeId = idOf(dispute && dispute.charge), paymentIntentId = idOf(dispute && dispute.payment_intent);
  if (!chargeId && !paymentIntentId) return null;
  const row = await probe(client, async () => (await client.query(
    `SELECT s.* FROM alert_chart_charges c JOIN alert_chart_subscriptions s ON s.id = c.subscription_id
      WHERE ($1 <> '' AND c.stripe_charge_id = $1) OR ($2 <> '' AND c.stripe_payment_intent_id = $2)
      ORDER BY c.created_at DESC LIMIT 1`,
    [chargeId, paymentIntentId]
  )).rows[0] || null);
  if (!row) return null;
  let lastMs = 0;
  try {
    const last = await client.query(
      `SELECT max(created_at) AS last FROM (
         SELECT created_at FROM academy_trader_alerts WHERE author_id = $1
         UNION ALL SELECT created_at FROM academy_trader_alert_updates WHERE author_id = $1) t`,
      [row.trader_discord_id]
    );
    lastMs = last.rows[0] && last.rows[0].last ? new Date(last.rows[0].last).getTime() : 0;
  } catch (_) { lastMs = 0; }
  const inactiveDays = lastMs ? Math.max(0, Math.floor((now() - lastMs) / DAY_MS)) : null;
  return {
    kind: 'alert_chart', sellerId: Number(row.seller_id), subscription: row, checkoutKey: String(row.checkout_key),
    traderDiscordId: String(row.trader_discord_id), subscriberDiscordId: String(row.subscriber_discord_id), plan: String(row.plan),
    inactiveDays, creatorInactive: inactiveDays == null || inactiveDays > INACTIVE_DAYS, inactiveRuleDays: INACTIVE_DAYS,
    disputeFeeBps: ALERT_CHART_DISPUTE_FEE_BPS
  };
}

/** The sale's access while a dispute runs: paused when the funds are pulled, back when the trader wins. */
async function pauseAlertChartAccess(client, context, { restore = false, now = Date.now } = {}) {
  const s = context && context.subscription; if (!s) return;
  if (restore) {
    await client.query(`UPDATE alert_chart_subscriptions SET status = CASE WHEN canceled_at IS NULL THEN 'active' ELSE 'canceled' END, updated_at = now() WHERE id = $1`, [s.id]);
    if (s.canceled_at == null) await grantAccess(client, { memberId: s.subscriber_discord_id, traderId: s.trader_discord_id, plan: s.plan, until: s.access_until || null, reference: s.checkout_key, tier: s.tier });
    return;
  }
  await client.query(`UPDATE alert_chart_subscriptions SET status = 'disputed', updated_at = now() WHERE id = $1`, [s.id]);
  await endAccess(client, { memberId: s.subscriber_discord_id, traderId: s.trader_discord_id, reference: s.checkout_key, atSeconds: Math.floor(now() / 1000) });
}

/* ---------- the service side: seller status, Stripe onboarding and checkout, for the Academy routes ---------- */

function createAlertChartBilling({ pool = null, stripe = null, billingService = null, loopKickBridge = null, loopKickConnect = null, traderAlerts = null,
  names = null, rooms = null, publicBase = '', logger = () => {}, now = Date.now } = {}) {
  const db = pool && typeof pool.query === 'function' ? pool : null;
  const base = String(publicBase || '').replace(/\/+$/, '');
  const baseHost = (() => { try { return new URL(base).hostname; } catch (_) { return ''; } })();
  const configured = Boolean(db && stripe && billingService && base);
  const wpCache = new Map();
  let schemaReady = null;

  function ensureSchema() {
    if (!db) return Promise.resolve();
    if (schemaReady) return schemaReady;
    schemaReady = (async () => {
      for (const sql of SCHEMA) {
        try { await db.query(sql); } catch (error) { logger('warn', 'alert_chart_billing_schema_failed', { error: String((error && error.message) || error), sql: sql.slice(0, 60) }); }
      }
    })();
    return schemaReady;
  }

  /* the member's stockmarketloop.com user id, from the identity tables or the site's own link table (the bridge card) */
  async function wpUserOf(discordId) {
    const id = String(discordId || ''); if (!SNOWFLAKE.test(id)) return 0;
    const hit = wpCache.get(id); if (hit && now() - hit.at < 300_000 && hit.value) return hit.value;
    let value = 0;
    if (db) {
      try { const r = await db.query('SELECT wordpress_user_id FROM billing_identities WHERE discord_user_id = $1 AND wordpress_user_id IS NOT NULL LIMIT 1', [id]); if (r.rows[0]) value = Number(r.rows[0].wordpress_user_id) || 0; } catch (_) { /* table may be absent */ }
      if (!value) { try { const r = await db.query('SELECT user_id FROM discord_identities WHERE discord_user_id = $1 LIMIT 1', [id]); if (r.rows[0]) value = Number(r.rows[0].user_id) || 0; } catch (_) { /* table may be absent */ } }
    }
    if (!value && loopKickBridge && typeof loopKickBridge.profile === 'function') {
      try { const p = await loopKickBridge.profile(id); if (p && p.ok && p.linked && p.card && Number(p.card.user_id) > 0) value = Number(p.card.user_id); } catch (_) { /* unlinked */ }
    }
    wpCache.set(id, { at: now(), value }); if (wpCache.size > 2000) wpCache.delete(wpCache.keys().next().value);
    return value;
  }
  function connectUrlFor(discordId) {
    try { const r = loopKickConnect && typeof loopKickConnect.connectUrl === 'function' ? loopKickConnect.connectUrl({ discordUserId: discordId }) : null; return r && r.ok ? r.url : 'https://stockmarketloop.com/connect-discord/'; } catch (_) { return 'https://stockmarketloop.com/connect-discord/'; }
  }

  async function sellerStatus(traderId) {
    const id = String(traderId || ''); if (!SNOWFLAKE.test(id)) return { ok: false, error: 'invalid_user' };
    await ensureSchema();
    const wp = await wpUserOf(id);
    let consent = null, seller = null;
    if (db) {
      try { consent = (await db.query('SELECT * FROM alert_chart_sellers WHERE trader_discord_id = $1', [id])).rows[0] || null; } catch (_) { consent = null; }
      if (wp) { try { seller = (await db.query('SELECT id, charges_enabled, details_submitted, payouts_enabled, card_payments_enabled FROM marketplace_sellers WHERE owner_user_id = $1', [wp])).rows[0] || null; } catch (_) { seller = null; } }
    }
    const stripeReady = Boolean(seller && seller.charges_enabled && seller.details_submitted);
    return {
      ok: true, configured, linked: wp > 0, connectUrl: wp > 0 ? '' : connectUrlFor(id),
      consented: Boolean(consent && consent.terms_accepted_at), stripe: { connected: Boolean(seller), ready: stripeReady, payouts: Boolean(seller && seller.payouts_enabled) },
      ready: configured && wp > 0 && Boolean(consent && consent.terms_accepted_at) && stripeReady,
      feeBps: ALERT_CHART_FEE_BPS, disputeFeeBps: ALERT_CHART_DISPUTE_FEE_BPS, inactiveDays: INACTIVE_DAYS, plans: Object.keys(ALERT_CHART_PLANS)
    };
  }

  /* consents, then the site's seller onboarding (a Stripe Express account link); the trader finishes on Stripe and comes back */
  async function onboardSeller(traderId, consents = {}) {
    const id = String(traderId || ''); if (!SNOWFLAKE.test(id)) return { ok: false, error: 'invalid_user' };
    if (!configured) return { ok: false, error: 'billing_unconfigured' };
    const c = consents || {};
    if (!(c.terms && c.fee && c.disputes && c.activity)) return { ok: false, error: 'consent_required' };
    await ensureSchema();
    const wp = await wpUserOf(id);
    if (!wp) return { ok: false, error: 'site_not_linked', connectUrl: connectUrlFor(id) };
    let onboarding;
    try {
      onboarding = await billingService.createSellerOnboarding(db, stripe, {
        ownerUserId: wp, acceptedSellerTerms: true, acceptedDisputeDebits: true, acceptedMembershipFeeBps: ALERT_CHART_FEE_BPS,
        refreshUrl: base + '/academy-activity/alert-chart/stripe?again=1', returnUrl: base + '/academy-activity/alert-chart/stripe?done=1'
      });
    } catch (error) {
      logger('warn', 'alert_chart_seller_onboarding_failed', { error: String((error && error.message) || error) });
      return { ok: false, error: 'onboarding_failed' };
    }
    try {
      await db.query(
        `INSERT INTO alert_chart_sellers (trader_discord_id, wp_user_id, seller_id, terms_accepted_at, fee_bps_accepted, dispute_fee_bps_accepted, activity_rule_accepted_at)
         VALUES ($1,$2,$3,now(),$4,$5,now())
         ON CONFLICT (trader_discord_id) DO UPDATE SET wp_user_id = EXCLUDED.wp_user_id, seller_id = EXCLUDED.seller_id, terms_accepted_at = now(),
           fee_bps_accepted = EXCLUDED.fee_bps_accepted, dispute_fee_bps_accepted = EXCLUDED.dispute_fee_bps_accepted, activity_rule_accepted_at = now(), updated_at = now()`,
        [id, wp, onboarding.sellerId || null, ALERT_CHART_FEE_BPS, ALERT_CHART_DISPUTE_FEE_BPS]
      );
    } catch (error) { logger('warn', 'alert_chart_seller_consent_failed', { error: String((error && error.message) || error) }); }
    logger('info', 'alert_chart_seller_onboarding', { trader: id, sellerId: onboarding.sellerId });
    return { ok: true, url: onboarding.onboardingUrl, sellerId: onboarding.sellerId };
  }

  /* a subscriber's Stripe Checkout for one plan of one trader's chart; the price is the trader's stored setting */
  async function checkout({ memberId, traderId, plan, tier = '' } = {}) {
    const me = String(memberId || ''), trader = String(traderId || ''), p = String(plan || '');
    if (!SNOWFLAKE.test(me) || !SNOWFLAKE.test(trader)) return { ok: false, error: 'invalid_user' };
    if (me === trader) return { ok: false, error: 'own_chart' };
    if (!ALERT_CHART_PLANS[p]) return { ok: false, error: 'invalid_plan' };
    if (!configured) return { ok: false, error: 'checkout_unavailable' };
    await ensureSchema();
    /* a trading room sells by tier (its own prices); a plain Alert Chart sells from the chart's price list */
    const tierId = String(tier || '').slice(0, 24);
    const offer = tierId && rooms && typeof rooms.offerFor === 'function' ? await rooms.offerFor(trader, tierId, p) : null;
    const settings = traderAlerts && typeof traderAlerts.settingsOf === 'function' ? await traderAlerts.settingsOf(trader) : null;
    if (tierId) { if (!offer || !offer.ok) return { ok: false, error: offer && offer.error === 'plan_not_offered' ? 'plan_not_offered' : 'not_premium' }; }
    else if (!settings || !settings.premium) return { ok: false, error: 'not_premium' };
    const priceCents = tierId ? Number(offer.priceCents) || 0 : Number(settings.prices && settings.prices[p]) || 0;
    if (priceCents < 100) return { ok: false, error: 'plan_not_offered' };
    const wpTrader = await wpUserOf(trader);
    if (!wpTrader) return { ok: false, error: 'seller_not_ready' };
    let consent = null; try { consent = (await db.query('SELECT terms_accepted_at FROM alert_chart_sellers WHERE trader_discord_id = $1', [trader])).rows[0] || null; } catch (_) { consent = null; }
    if (!consent || !consent.terms_accepted_at) return { ok: false, error: 'seller_not_ready' };
    let seller;
    try { seller = await billingService.readySeller(db, wpTrader); } catch (_) { return { ok: false, error: 'seller_not_ready' }; }
    const wpMember = await wpUserOf(me);
    const key = 'ac_' + crypto.randomUUID().replaceAll('-', '');
    const traderName = typeof names === 'function' ? await Promise.resolve(names(trader)).catch(() => '') : '';
    let inserted;
    try {
      inserted = await db.query(
        `INSERT INTO alert_chart_subscriptions (checkout_key, subscriber_discord_id, subscriber_wp_user_id, trader_discord_id, trader_wp_user_id, seller_id, connected_account_id, plan, price_cents, currency, platform_fee_bps, tier)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'usd',$10,$11) RETURNING id`,
        [key, me, wpMember || null, trader, wpTrader, seller.id, seller.connected_account_id, p, priceCents, ALERT_CHART_FEE_BPS, tierId]
      );
    } catch (error) { logger('warn', 'alert_chart_checkout_insert_failed', { error: String((error && error.message) || error) }); return { ok: false, error: 'checkout_unavailable' }; }
    let session;
    try {
      const params = buildAlertChartCheckout({
        plan: p, priceCents, currency: 'usd', checkoutKey: key, subscriberUserId: wpMember || null, sellerId: seller.id, connectedAccountId: seller.connected_account_id,
        traderName: String(traderName || '').slice(0, 40), onBehalfOf: Boolean(seller.card_payments_enabled), extraHosts: baseHost ? [baseHost] : [],
        successUrl: base + '/academy-activity/alert-chart/paid?k=' + encodeURIComponent(key), cancelUrl: base + '/academy-activity/alert-chart/paid?cancel=1'
      });
      session = await stripe.checkout.sessions.create(params, { idempotencyKey: key });
      if (!session || typeof session.url !== 'string' || !session.url.startsWith('https://')) throw new Error('Stripe did not return a Checkout URL');
    } catch (error) {
      logger('warn', 'alert_chart_checkout_failed', { error: String((error && error.message) || error) });
      try { await db.query(`UPDATE alert_chart_subscriptions SET status = 'failed', updated_at = now() WHERE id = $1`, [inserted.rows[0].id]); } catch (_) { /* best effort */ }
      return { ok: false, error: 'checkout_unavailable' };
    }
    try { await db.query('UPDATE alert_chart_subscriptions SET stripe_checkout_session_id = $2, updated_at = now() WHERE id = $1', [inserted.rows[0].id, session.id]); } catch (_) { /* the webhook binds it too */ }
    logger('info', 'alert_chart_checkout_opened', { member: me, trader, plan: p, priceCents });
    return { ok: true, url: session.url, checkoutKey: key, plan: p, tier: tierId, priceCents, feeBps: ALERT_CHART_FEE_BPS };
  }

  /* what the success page shows: whether the webhook has landed yet */
  async function checkoutState(checkoutKey) {
    const key = String(checkoutKey || ''); if (!/^ac_[a-f0-9]{32}$/.test(key) || !db) return { ok: false, error: 'not_found' };
    await ensureSchema();
    try {
      const r = await db.query('SELECT plan, status, access_until, trader_discord_id FROM alert_chart_subscriptions WHERE checkout_key = $1', [key]);
      const row = r.rows[0]; if (!row) return { ok: false, error: 'not_found' };
      return { ok: true, plan: String(row.plan), status: String(row.status), until: row.access_until ? new Date(row.access_until).toISOString() : null, trader: String(row.trader_discord_id) };
    } catch (_) { return { ok: false, error: 'not_found' }; }
  }

  return { configured, ensureSchema, wpUserOf, sellerStatus, onboardSeller, checkout, checkoutState, PLANS: ALERT_CHART_PLANS, GRACE_DAYS, INACTIVE_DAYS };
}

module.exports = { createAlertChartBilling, applyAlertChartEvent, alertChartDisputeContext, pauseAlertChartAccess, SCHEMA, GRACE_DAYS, INACTIVE_DAYS };
