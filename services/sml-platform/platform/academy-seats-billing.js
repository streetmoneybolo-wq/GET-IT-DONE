'use strict';

/* =============================================================================
 * Academy seats: the money side. A Discord server owner buys N seats, per seat
 * per month, through Stripe Checkout; academy-seats.js hands those seats out.
 *
 * Why this is not the MEM Academy billing engine next door
 * (platform/academy/billing): that engine sells ONE plan to ONE member and
 * grants Discord roles for it — every line item is `quantity: 1`, every price
 * carries a role set, and it owns its own pool, timers and migrations. Seats
 * are the opposite shape: one subscription whose quantity IS the product, no
 * roles, and the grant goes to members the buyer names afterwards. So seats get
 * their own small path rather than a quantity bolted through that engine.
 *
 * Configuration (inert until all three are set, like everything else here):
 *   SML_ACADEMY_SEATS_PRICE_ID        a recurring monthly per-unit price
 *   SML_ACADEMY_SEATS_STRIPE_KEY      falls back to SML_ACADEMY_BILLING_STRIPE_KEY
 *   SML_ACADEMY_SEATS_WEBHOOK_SECRET  comma-separated during a rotation
 *   SML_ACADEMY_SEATS_RETURN_URL      where Checkout and the portal come back to
 *   SML_ACADEMY_SEATS_MIN             smallest team that can be bought (default 5)
 *   SML_ACADEMY_SEATS_UNIT_AMOUNT     what a seat costs, in cents (default 2999 = $29.99)
 *   SML_ACADEMY_SEATS_CURRENCY        currency for that amount (default usd)
 *
 * THE PRICE SHOWN IS THE PRICE CHARGED. The panel has to quote a figure before anyone will buy,
 * and a figure typed into config drifts from the Stripe price the day the Stripe price changes.
 * So the real price is read back from Stripe once, cached, and it wins; the configured amount is
 * only what the panel shows until that read lands (and all it ever has, on a deployment with no
 * Stripe key). A tiered price has no single unit amount, so its first tier is quoted as a 'from'.
 *
 * The buyer's Discord id travels in subscription metadata
 * (`mem_seats_discord_owner`), so the webhook can bind a subscription to an
 * owner without a lookup table, and the binding survives a database rollback.
 * The Stripe customer is whatever Checkout creates; we learn its id from the
 * first webhook and keep it for the billing portal. Nothing here needs the
 * Stripe search permission.
 *
 * SEAT COUNT = SUBSCRIPTION QUANTITY. The owner changes it in the billing
 * portal (adjustable quantity is on in Checkout too), Stripe prorates, and
 * `customer.subscription.updated` brings the new number back. Shrinking below
 * the number of members seated releases the newest seats; academy-seats.js
 * decides that part.
 *
 * GRACE. Seats are written as passes that expire at the period end, so a
 * renewal that Stripe tells us about late would lock a team out in the gap.
 * Every period end therefore carries GRACE_HOURS on top. A cancellation does
 * not wait for that: it ends the seats at once.
 *
 * A failed card is `past_due`, which keeps the seats until the period (plus
 * grace) runs out — Stripe is still retrying, and killing a paying team's
 * access the minute a card expires is the wrong trade. `unpaid` and `canceled`
 * end them.
 * ========================================================================== */

const { verifySignature, parseEvent, MAX_BODY_BYTES } = require('./stripe-webhook');

const SNOWFLAKE = /^\d{15,25}$/;
const PRICE_ID = /^price_[A-Za-z0-9]+$/;
const GRACE_HOURS = 24;
/* Stripe statuses that still mean "this team has paid for seats". */
const LIVE_STATUSES = Object.freeze(['active', 'trialing', 'past_due']);
/* Checkout links die after this; Stripe's own minimum is 30 minutes. */
const SESSION_TTL_MINUTES = 35;
/* The smallest team that can be bought. A floor exists so seats are a TEAM product and never a
   cheaper way to put one person on Trader: at any sane per-seat price, a team of this size costs
   more than an individual Trader plan, which is what keeps the two from competing.
   SML_ACADEMY_SEATS_MIN moves it without a deploy. */
const DEFAULT_MIN_SEATS = 5;
/* $29.99 a seat: clearly under Trader at $49.99, so buying for a team is worth doing, but high
   enough that the five-seat floor costs more than one Trader plan and seats never become the
   cheap way to put one person on Trader. */
const DEFAULT_UNIT_AMOUNT = 2999;
const DEFAULT_CURRENCY = 'usd';

const text = (v) => String(v == null ? '' : v).trim();
const csv = (v) => text(v).split(',').map((s) => s.trim()).filter(Boolean);

/* PURE: the Checkout Session parameters, so the shape is testable without Stripe.
   `sml_kind` is its own value ('mem_academy_seats'), never the Academy engine's
   'mem_academy', so neither engine's reconciler can mistake the other's rows. */
function checkoutParams({ priceId, ownerId, seats, minSeats = 1, maxSeats, returnUrl, nowSeconds }) {
  const metadata = { sml_kind: 'mem_academy_seats', mem_seats_discord_owner: String(ownerId), mem_seats_v: '1' };
  return {
    mode: 'subscription',
    line_items: [{
      price: priceId,
      quantity: seats,
      /* the buyer can size the team before paying as well as after, but not below the floor:
         Stripe enforces this on its own page, so the quantity that comes back is always valid */
      adjustable_quantity: { enabled: true, minimum: minSeats, maximum: maxSeats }
    }],
    /* no promotion codes: Discord's price-parity rule covers the Academy line */
    allow_promotion_codes: false,
    client_reference_id: `seats:${ownerId}`,
    metadata,
    subscription_data: { metadata },
    success_url: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}seats=ok`,
    cancel_url: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}seats=cancelled`,
    expires_at: nowSeconds + SESSION_TTL_MINUTES * 60
  };
}

/* PURE: what a Stripe subscription object means for seats. */
function readSubscription(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const ownerId = text(sub.metadata && sub.metadata.mem_seats_discord_owner);
  if (!SNOWFLAKE.test(ownerId)) return null;
  const item = (sub.items && Array.isArray(sub.items.data) ? sub.items.data : [])[0] || {};
  const quantity = Number(item.quantity);
  const periodEndSeconds = Number(
    /* 2025+ API versions moved the period onto the item; accept both */
    Number.isFinite(Number(item.current_period_end)) ? item.current_period_end : sub.current_period_end
  );
  const liveStatus = LIVE_STATUSES.includes(text(sub.status));
  return {
    ownerId,
    subscriptionId: text(sub.id) || null,
    customerId: text(typeof sub.customer === 'string' ? sub.customer : (sub.customer && sub.customer.id)) || null,
    status: liveStatus ? 'active' : 'ended',
    seats: liveStatus && Number.isInteger(quantity) && quantity > 0 ? quantity : 0,
    periodEnd: liveStatus && Number.isFinite(periodEndSeconds) && periodEndSeconds > 0
      ? new Date((periodEndSeconds + GRACE_HOURS * 3600) * 1000).toISOString()
      : null
  };
}

function createSeatsBilling({ env = process.env, seats = null, stripe = null, now = () => Date.now(), logger = () => {} } = {}) {
  const priceId = text(env.SML_ACADEMY_SEATS_PRICE_ID);
  const key = text(env.SML_ACADEMY_SEATS_STRIPE_KEY) || text(env.SML_ACADEMY_BILLING_STRIPE_KEY);
  const webhookSecrets = csv(env.SML_ACADEMY_SEATS_WEBHOOK_SECRET);
  const returnUrl = text(env.SML_ACADEMY_SEATS_RETURN_URL) || 'https://stockmarketloop.com/academy/';
  const maxSeats = (seats && seats.MAX_SEATS) || 1000;
  const unitAmount = (() => {
    const raw = text(env.SML_ACADEMY_SEATS_UNIT_AMOUNT);
    if (!raw) return DEFAULT_UNIT_AMOUNT;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 10_000_00) { logger('warn', 'academy_seats_amount_invalid', { value: raw.slice(0, 12) }); return DEFAULT_UNIT_AMOUNT; }
    return n;
  })();
  const currency = (text(env.SML_ACADEMY_SEATS_CURRENCY) || DEFAULT_CURRENCY).toLowerCase();
  /* what Stripe actually charges, once we have asked it; null until then */
  let livePrice = null;

  const minSeats = (() => {
    const raw = Number(text(env.SML_ACADEMY_SEATS_MIN));
    if (!text(env.SML_ACADEMY_SEATS_MIN)) return DEFAULT_MIN_SEATS;
    if (!Number.isInteger(raw) || raw < 1 || raw > maxSeats) { logger('warn', 'academy_seats_min_invalid', { value: text(env.SML_ACADEMY_SEATS_MIN).slice(0, 12) }); return DEFAULT_MIN_SEATS; }
    return raw;
  })();

  const priceOk = PRICE_ID.test(priceId);
  if (priceId && !priceOk) logger('warn', 'academy_seats_price_invalid', { priceId: priceId.slice(0, 24) });

  let client = stripe;
  function api() {
    if (client) return client;
    /* required lazily: a deployment with no seats price never loads the SDK */
    const Stripe = require('stripe');
    const raw = new Stripe(key, { apiVersion: '2022-11-15', maxNetworkRetries: 2, timeout: 10_000, telemetry: false });
    client = {
      createCheckoutSession: (params, idempotencyKey) => raw.checkout.sessions.create(params, { idempotencyKey }),
      createPortalSession: (params, idempotencyKey) => raw.billingPortal.sessions.create(params, { idempotencyKey }),
      retrieveSubscription: (id) => raw.subscriptions.retrieve(id),
      retrievePrice: (id) => raw.prices.retrieve(id)
    };
    return client;
  }

  const configured = Boolean(priceOk && (key || stripe) && seats);
  const webhookConfigured = Boolean(webhookSecrets.length && seats);

  /* What a seat costs, for the panel. Stripe is the authority and is asked once; until it answers
     (or forever, with no Stripe key) the configured amount stands in. A failed read is not an
     error worth surfacing: the panel just keeps quoting the configured figure. */
  async function price() {
    if (livePrice) return livePrice;
    const fallback = { unitAmount, currency, interval: 'month', from: false, source: 'config' };
    if (!configured) return fallback;
    try {
      const p = await api().retrievePrice(priceId);
      const tiers = Array.isArray(p && p.tiers) ? p.tiers : null;
      const amount = Number.isFinite(Number(p && p.unit_amount)) && p.unit_amount !== null
        ? Number(p.unit_amount)
        : (tiers && tiers.length ? Number(tiers[0].unit_amount) : NaN);
      if (!Number.isFinite(amount)) return fallback;
      livePrice = {
        unitAmount: amount,
        currency: text(p.currency).toLowerCase() || currency,
        interval: (p.recurring && text(p.recurring.interval)) || 'month',
        /* a tiered price has no single figure, so the panel says "from" */
        from: Boolean(tiers && tiers.length > 1),
        source: 'stripe'
      };
      if (livePrice.unitAmount !== unitAmount) {
        logger('info', 'academy_seats_price_differs', { configured: unitAmount, stripe: livePrice.unitAmount });
      }
      return livePrice;
    } catch (error) {
      logger('warn', 'academy_seats_price_read_failed', { error: String((error && error.message) || error).slice(0, 160) });
      return fallback;
    }
  }

  /* Start a purchase. An owner who already has a live subscription is sent to
     the portal to change the seat count instead, so nobody is charged twice. */
  async function checkout(ownerId, wanted) {
    const owner = text(ownerId);
    if (!configured) return { ok: false, status: 503, code: 'seats_billing_unconfigured' };
    if (!SNOWFLAKE.test(owner)) return { ok: false, status: 400, code: 'invalid_owner' };
    const count = Number(wanted);
    if (!Number.isInteger(count) || count < minSeats || count > maxSeats) return { ok: false, status: 400, code: 'invalid_seats', minSeats, maxSeats };

    const held = await seats.get(owner);
    if (held.ok && held.live) return { ok: false, status: 409, code: 'already_subscribed', seats: held.seats };

    try {
      const session = await api().createCheckoutSession(
        checkoutParams({ priceId, ownerId: owner, seats: count, minSeats, maxSeats, returnUrl, nowSeconds: Math.floor(now() / 1000) }),
        /* one open session per owner per seat count per hour */
        `seats-checkout-${owner}-${count}-${Math.floor(now() / 3600_000)}`
      );
      if (!session || !session.url) return { ok: false, status: 502, code: 'checkout_failed' };
      logger('info', 'academy_seats_checkout_started', { ownerId: owner, seats: count });
      return { ok: true, url: session.url, seats: count };
    } catch (error) {
      logger('error', 'academy_seats_checkout_failed', { ownerId: owner, error: String((error && error.message) || error).slice(0, 160) });
      return { ok: false, status: 502, code: 'checkout_failed' };
    }
  }

  /* Change the seat count, change the card, or cancel: all of it is Stripe's portal. */
  async function portal(ownerId) {
    const owner = text(ownerId);
    if (!configured) return { ok: false, status: 503, code: 'seats_billing_unconfigured' };
    if (!SNOWFLAKE.test(owner)) return { ok: false, status: 400, code: 'invalid_owner' };
    const billing = await seats.billingOf(owner);
    const customer = billing && billing.customerId;
    if (!customer) return { ok: false, status: 404, code: 'no_subscription' };
    try {
      const session = await api().createPortalSession({ customer, return_url: returnUrl }, `seats-portal-${owner}-${Math.floor(now() / 60_000)}`);
      if (!session || !session.url) return { ok: false, status: 502, code: 'portal_failed' };
      return { ok: true, url: session.url };
    } catch (error) {
      logger('error', 'academy_seats_portal_failed', { ownerId: owner, error: String((error && error.message) || error).slice(0, 160) });
      return { ok: false, status: 502, code: 'portal_failed' };
    }
  }

  /* Apply one Stripe subscription object. Shared by the webhook and a resync. */
  async function applySubscription(sub, eventAt = null) {
    const read = readSubscription(sub);
    if (!read) return { ok: false, code: 'not_a_seats_subscription' };
    const out = await seats.setSubscription(read.ownerId, {
      seats: read.seats,
      periodEnd: read.periodEnd,
      status: read.status,
      eventAt,
      customerId: read.customerId,
      subscriptionId: read.subscriptionId
    });
    if (!out.ok) {
      logger('error', 'academy_seats_apply_failed', { ownerId: read.ownerId, code: out.code });
      return { ok: false, code: out.code };
    }
    logger('info', out.stale ? 'academy_seats_event_stale' : 'academy_seats_applied', {
      ownerId: read.ownerId, status: read.status, seats: read.seats, used: out.used, dropped: (out.dropped || []).length
    });
    return { ok: true, ownerId: read.ownerId, applied: !out.stale };
  }

  /* The webhook. Verifies before parsing — the signature is over the exact bytes. */
  async function webhook({ rawBody, signature }) {
    if (!webhookConfigured) return { ok: false, status: 503, code: 'stripe_unconfigured' };
    const verified = verifySignature({ secret: webhookSecrets, header: signature, rawBody, now: now() });
    if (!verified.ok) return { ok: false, status: verified.status, code: verified.error };
    const parsed = parseEvent(rawBody);
    if (!parsed.ok) return { ok: false, status: parsed.status, code: parsed.error };
    const event = parsed.event;
    const object = (event.data && event.data.object) || null;

    try {
      if (event.type === 'checkout.session.completed') {
        /* the session carries the subscription id, not the subscription */
        if (text(object && object.mode) !== 'subscription') return { ok: true, status: 200, ignored: 'not_subscription_mode' };
        if (text(object && object.metadata && object.metadata.sml_kind) !== 'mem_academy_seats') return { ok: true, status: 200, ignored: 'not_seats' };
        const subId = text(typeof object.subscription === 'string' ? object.subscription : (object.subscription && object.subscription.id));
        if (!subId) return { ok: true, status: 200, ignored: 'no_subscription' };
        const sub = await api().retrieveSubscription(subId);
        const applied = await applySubscription(sub, event.created);
        return { ok: true, status: 200, ...applied };
      }
      if (event.type === 'customer.subscription.created'
        || event.type === 'customer.subscription.updated'
        || event.type === 'customer.subscription.deleted') {
        /* a deleted subscription still arrives with its last status; force the end */
        const sub = event.type === 'customer.subscription.deleted' ? { ...object, status: 'canceled' } : object;
        const applied = await applySubscription(sub, event.created);
        /* another product's subscription on the same endpoint is not an error */
        return { ok: true, status: 200, ...(applied.code === 'not_a_seats_subscription' ? { ignored: applied.code } : applied) };
      }
      return { ok: true, status: 200, ignored: event.type };
    } catch (error) {
      logger('error', 'academy_seats_webhook_failed', { type: event.type, error: String((error && error.message) || error).slice(0, 160) });
      return { ok: false, status: 503, code: 'seats_billing_unavailable' };
    }
  }

  /* Read Stripe back for one owner. Stripe gives up retrying a webhook after three days, and a
     deploy during a renewal can lose one, so the owner's own page can repair its state. */
  async function resync(ownerId) {
    const owner = text(ownerId);
    if (!configured) return { ok: false, status: 503, code: 'seats_billing_unconfigured' };
    if (!SNOWFLAKE.test(owner)) return { ok: false, status: 400, code: 'invalid_owner' };
    const billing = await seats.billingOf(owner);
    if (!billing || !billing.subscriptionId) return { ok: false, status: 404, code: 'no_subscription' };
    try {
      const sub = await api().retrieveSubscription(billing.subscriptionId);
      /* no eventAt: a direct read of Stripe is never out of order */
      const applied = await applySubscription(sub);
      return applied.ok ? { ok: true, ...(await seats.get(owner)) } : { ok: false, status: 502, code: applied.code };
    } catch (error) {
      logger('error', 'academy_seats_resync_failed', { ownerId: owner, error: String((error && error.message) || error).slice(0, 160) });
      return { ok: false, status: 502, code: 'resync_failed' };
    }
  }

  return Object.freeze({
    configured, webhookConfigured, priceId: priceOk ? priceId : null, returnUrl, graceHours: GRACE_HOURS, minSeats, maxSeats,
    unitAmount, currency, price,
    checkout, portal, webhook, applySubscription, resync, MAX_BODY_BYTES
  });
}

module.exports = {
  createSeatsBilling, checkoutParams, readSubscription,
  GRACE_HOURS, LIVE_STATUSES, DEFAULT_MIN_SEATS, DEFAULT_UNIT_AMOUNT, DEFAULT_CURRENCY
};
