'use strict';

/* =============================================================================
 * MEM Academy billing: the dedicated Stripe client.
 *
 * - Key: SML_ACADEMY_BILLING_STRIPE_KEY only (a restricted rk_ key on MEM).
 *   It never reads STRIPE_SECRET_KEY (whose account is unverified) or any
 *   WordPress key.
 * - Stripe-Version pinned to 2022-11-15, the MEM account default, so an SDK
 *   bump can never change a response shape under the engine. The readers in
 *   stripe-shapes.js still accept the newer shapes too.
 * - Every list is paged to the end (limit 100) up to a page cap. A list that
 *   hits the cap returns complete:false, which the engine treats exactly like
 *   a failed call: grants may proceed, revokes may not.
 * - Every write carries a deterministic Idempotency-Key chosen by the caller.
 * ========================================================================== */

const Stripe = require('stripe');
const { isStripeMissing } = require('./stripe-shapes');

const API_VERSION = '2022-11-15';
const DEFAULT_MAX_PAGES = 20;
const SNOWFLAKE = /^[0-9]{15,24}$/;

function createStripeApi({ key, stripe = null, fetchImpl = null, maxPages = DEFAULT_MAX_PAGES } = {}) {
  if (!stripe && !key) throw new TypeError('createStripeApi: SML_ACADEMY_BILLING_STRIPE_KEY is required');
  const client = stripe || new Stripe(key, {
    apiVersion: API_VERSION,
    maxNetworkRetries: 2,
    timeout: 10_000,
    telemetry: false,
    ...(fetchImpl ? { httpClient: Stripe.createFetchHttpClient(fetchImpl) } : {})
  });

  async function pageList(resource, params, cap = maxPages) {
    const data = [];
    let startingAfter = null;
    for (let pages = 1; ; pages += 1) {
      const page = await resource.list({ ...params, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
      const rows = Array.isArray(page && page.data) ? page.data : [];
      data.push(...rows);
      if (!page || !page.has_more || !rows.length) return { data, complete: true };
      if (pages >= cap) return { data, complete: false };
      startingAfter = rows[rows.length - 1].id;
    }
  }

  async function pageSearch(resource, query, cap = maxPages) {
    const data = [];
    let next = null;
    for (let pages = 1; ; pages += 1) {
      const page = await resource.search({ query, limit: 100, ...(next ? { page: next } : {}) });
      const rows = Array.isArray(page && page.data) ? page.data : [];
      data.push(...rows);
      if (!page || !page.has_more || !page.next_page) return { data, complete: true };
      if (pages >= cap) return { data, complete: false };
      next = page.next_page;
    }
  }

  return {
    apiVersion: API_VERSION,
    raw: client,

    /* ---------------- reads ---------------- */
    async retrieveCustomer(id) {
      try {
        const customer = await client.customers.retrieve(id);
        return customer && customer.deleted ? { id, deleted: true } : customer;
      } catch (error) {
        if (isStripeMissing(error)) return { id, deleted: true, missing: true };
        throw error;
      }
    },
    listSubscriptions: (customer) => pageList(client.subscriptions, { customer, status: 'all' }),
    listPaymentIntents: (customer) => pageList(client.paymentIntents, { customer }),
    listCharges: (customer) => pageList(client.charges, { customer }),
    /* Newest first; only the most recent paid invoice decides the current
       period's refund state, so one page is complete for that purpose. */
    async listPaidInvoices(subscription) {
      const page = await client.invoices.list({ subscription, status: 'paid', limit: 10 });
      return { data: Array.isArray(page && page.data) ? page.data : [], complete: true };
    },
    listDisputesForCharge: (charge) => pageList(client.disputes, { charge }, 2),
    listRecentDisputes: (sinceSeconds) => pageList(client.disputes, { created: { gte: sinceSeconds }, expand: ['data.charge'] }),
    retrievePaymentIntent: (id) => client.paymentIntents.retrieve(id, { expand: ['latest_charge'] }),
    retrieveCharge: (id) => client.charges.retrieve(id),
    retrieveInvoice: (id) => client.invoices.retrieve(id),
    retrievePrice: (id) => client.prices.retrieve(id, { expand: ['product'] }),
    retrieveCheckoutSession: (id) => client.checkout.sessions.retrieve(id),
    /* null when the coupon does not exist (win-back intro coupons) */
    async retrieveCoupon(id) {
      try { return await client.coupons.retrieve(id); } catch (error) {
        if (isStripeMissing(error)) return null;
        throw error;
      }
    },
    listOpenCheckoutSessions: (customer) => pageList(client.checkout.sessions, { customer, status: 'open' }, 2),
    listSubscriptionsByPrice: (price, status) => pageList(client.subscriptions, { price, status }),
    searchAcademySubscriptions: () => pageSearch(client.subscriptions, "metadata['sml_kind']:'mem_academy'"),
    searchLifetimePaymentIntents: () => pageSearch(client.paymentIntents,
      "metadata['sml_kind']:'mem_academy' AND metadata['mem_academy_package']:'lifetime' AND status:'succeeded'"),
    searchAcademyCustomers: () => pageSearch(client.customers, "metadata['sml_kind']:'mem_academy'"),
    async searchCustomersByDiscordId(discordId) {
      if (!SNOWFLAKE.test(String(discordId))) throw new TypeError('searchCustomersByDiscordId: snowflake required');
      return pageSearch(client.customers, `metadata['mem_academy_discord_user']:'${discordId}'`, 2);
    },
    retrieveAccount: () => client.accounts.retrieve(),
    listWebhookEndpoints: () => pageList(client.webhookEndpoints, {}, 2),

    /* ---------------- writes (always with an Idempotency-Key) ---------------- */
    createCustomer: (params, idempotencyKey) => client.customers.create(params, { idempotencyKey }),
    updateCustomer: (id, params, idempotencyKey) => client.customers.update(id, params, { idempotencyKey }),
    createCoupon: (params, idempotencyKey) => client.coupons.create(params, { idempotencyKey }),
    createCheckoutSession: (params, idempotencyKey) => client.checkout.sessions.create(params, { idempotencyKey }),
    expireCheckoutSession: (id, idempotencyKey) => client.checkout.sessions.expire(id, {}, { idempotencyKey }),
    createPortalSession: (params, idempotencyKey) => client.billingPortal.sessions.create(params, { idempotencyKey }),
    updateSubscription: (id, params, idempotencyKey) => client.subscriptions.update(id, params, { idempotencyKey }),
    cancelSubscription: (id, params, idempotencyKey) => client.subscriptions.cancel(id, params, { idempotencyKey }),
    updatePaymentIntent: (id, params, idempotencyKey) => client.paymentIntents.update(id, params, { idempotencyKey }),
    createTestClock: (params, idempotencyKey) => client.testHelpers.testClocks.create(params, { idempotencyKey })
  };
}

module.exports = { createStripeApi, API_VERSION };
