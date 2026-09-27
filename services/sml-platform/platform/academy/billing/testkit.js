'use strict';

/* Shared fakes for the MEM Academy billing tests. No network, no database:
 *   - createFakeStore(): the store.js interface over in-memory maps, plus a
 *     fake pool that understands the audit and hand-off statements;
 *   - createFakeStripe(): the stripe-client.js interface over fixtures, with
 *     call recording and failure injection;
 *   - createFakeBot(): the discord.js bot interface;
 *   - env()/config(): a complete, valid test-mode configuration.
 */

const crypto = require('node:crypto');
const { parseBillingConfig } = require('./config');
const { DiscordError } = require('./discord');

const GUILD = '938894329076940820';
const APP = '1551336038713139370';
const ACADEMY_ROLE = '1600000000000000001';
const LIFETIME_ROLE = '1600000000000000002';
const MONARCH = '1260433215189946420';
const PREMIUM = '939031140679970867';
const USER = '300000000000000001';
const USER2 = '300000000000000002';
const USER3 = '300000000000000003';
const ACCOUNT = 'acct_1ND1yGBpqyUyWsXe';
const T0 = Date.parse('2026-10-05T12:00:00Z');
const S = (ms) => Math.floor(ms / 1000);

const PRICE_TABLE = {
  price_daily1: { package: 'daily', interval: 'day', count: 1, amount: 299 },
  price_weekly1: { package: 'weekly', interval: 'week', count: 1, amount: 999 },
  price_monthly1: { package: 'monthly', interval: 'month', count: 1, amount: 2999 },
  price_quarter1: { package: 'quarterly', interval: 'month', count: 3, amount: 7999 },
  price_semi1: { package: 'semiannual', interval: 'month', count: 6, amount: 14999 },
  price_year1: { package: 'yearly', interval: 'year', count: 1, amount: 19999 },
  price_life1: { package: 'lifetime', interval: null, count: null, amount: 129999 },
  price_monthold: { package: 'monthly', interval: 'month', count: 1, amount: 2499, sell: false }
};

/* Membership products (academy:false) used by ownerEnv(); not in the default
   PRICES_JSON. */
const MEMBERSHIP_PRICES = {
  price_premium1: { package: 'monthly', interval: 'month', count: 1, amount: 4999, product: 'prod_premium', name: 'Premium Member' },
  price_premlife1: { package: 'lifetime', interval: null, count: null, amount: 250000, product: 'prod_premium', name: 'Premium Member Lifetime' },
  /* The Upgrade.Chat store mirrors (2026-09-26), used by memEnv(). */
  price_elitelife: { package: 'lifetime', interval: null, count: null, amount: 749090, product: 'prod_elite_life', name: 'Elite Lifetime Access' },
  price_eliteyear: { package: 'yearly', interval: 'year', count: 1, amount: 84990, product: 'prod_elite_year', name: 'Elite Yearly Access' },
  price_elitemonth: { package: 'monthly', interval: 'month', count: 1, amount: 8990, product: 'prod_elite_month', name: 'Elite Monthly Access' },
  price_eliteweek: { package: 'weekly', interval: 'week', count: 1, amount: 3490, product: 'prod_elite_week', name: 'Elite Week Seat' },
  price_freetrial: { package: 'daily', interval: 'day', count: 1, amount: 790, product: 'prod_free_trial', name: 'Free Trial Access' }
};

/** PRICES_JSON for PRICE_TABLE; `extra` merges fields into entries by price id,
 *  e.g. pricesJson({ price_life1: { paymentMethods: ['card', 'us_bank_account'] } }). */
function pricesJson(extra = {}) {
  const out = {};
  for (const [id, p] of Object.entries(PRICE_TABLE)) out[id] = { package: p.package, sell: p.sell !== false, ...(extra[id] || {}) };
  return JSON.stringify(out);
}

/* The owner's Lifetime set-up: card or US bank account (ACH Direct Debit). */
const BANK_LIFETIME_ENV = Object.freeze({
  SML_ACADEMY_BILLING_PRICES_JSON: pricesJson({ price_life1: { paymentMethods: ['card', 'us_bank_account'] } })
});

function env(overrides = {}) {
  return {
    SML_ACADEMY_BILLING_ENABLED: '1',
    SML_ACADEMY_BILLING_CHECKOUT_ENABLED: '1',
    SML_ACADEMY_BILLING_ROLE_MODE: 'enforce',
    SML_ACADEMY_BILLING_REVOKES_ENABLED: '1',
    SML_ACADEMY_BILLING_WEBHOOK_SECRET: 'whsec_academytestsecret',
    SML_ACADEMY_BILLING_STRIPE_KEY: 'rk_test_academykey',
    SML_ACADEMY_BILLING_STRIPE_ACCOUNT_ID: ACCOUNT,
    SML_ACADEMY_BILLING_LIVEMODE: '0',
    SML_ACADEMY_BILLING_PRICES_JSON: pricesJson(),
    SML_ACADEMY_BILLING_ACADEMY_ROLE_ID: ACADEMY_ROLE,
    SML_ACADEMY_BILLING_LIFETIME_ROLE_ID: LIFETIME_ROLE,
    SML_ACADEMY_BILLING_GUILD_ID: GUILD,
    SML_ACADEMY_GUILD_ID: GUILD,
    SML_ACADEMY_BILLING_PORTAL_CONFIG_ID: 'bpc_academyDedicated1',
    SML_ACADEMY_BILLING_PUBLIC_URL: 'https://making-easy-money-academy.onrender.com',
    SML_ACADEMY_BILLING_INVITE_URL: 'https://discord.gg/makingeasymoney',
    SML_ACADEMY_BILLING_CONSENT_VERSION: '2026-10-01',
    SML_ACADEMY_BOT_TOKEN: 'academy-bot-token',
    SML_ACADEMY_APP_ID: APP,
    SML_ACADEMY_CLIENT_SECRET: 'academy-client-secret',
    ...overrides
  };
}

function config(overrides = {}) { return parseBillingConfig(env(overrides)); }

function clock(start = T0) {
  let t = start;
  const fn = () => t;
  fn.set = (v) => { t = v; };
  fn.advance = (ms) => { t += ms; };
  return fn;
}

/* ----------------------------------------------------------------------------
 * Stripe fixtures
 * ------------------------------------------------------------------------- */

const ACADEMY_PRODUCT = { id: 'prod_academy', object: 'product', active: true, metadata: { sml_kind: 'mem_academy' } };

function stripePrice(id, overrides = {}) {
  const membership = MEMBERSHIP_PRICES[id];
  if (membership) {
    return {
      id, object: 'price', active: true, livemode: false, currency: 'usd', unit_amount: membership.amount, billing_scheme: 'per_unit',
      type: membership.interval ? 'recurring' : 'one_time',
      recurring: membership.interval ? { interval: membership.interval, interval_count: membership.count, usage_type: 'licensed' } : null,
      tax_behavior: 'exclusive', product: { id: membership.product, object: 'product', active: true, name: membership.name, metadata: { sml_kind: 'mem_academy' } },
      ...overrides
    };
  }
  const p = PRICE_TABLE[id] || { package: 'monthly', interval: 'month', count: 1, amount: 3999 };
  return {
    id, object: 'price', active: true, livemode: false, currency: 'usd', unit_amount: p.amount, billing_scheme: 'per_unit',
    type: p.interval ? 'recurring' : 'one_time',
    recurring: p.interval ? { interval: p.interval, interval_count: p.count, usage_type: 'licensed' } : null,
    tax_behavior: 'exclusive', product: ACADEMY_PRODUCT, ...overrides
  };
}

function subscription({ id, customer, status = 'active', price = 'price_monthly1', created = S(T0) - 86400, start = null,
  periodStart = S(T0) - 3600, periodEnd = S(T0) + 29 * 86400, cancelAtPeriodEnd = false, cancelAt = null, metadata = null, basil = false,
  trialStart = null, trialEnd = null, trialSettings = null, defaultPaymentMethod = null } = {}) {
  const p = PRICE_TABLE[price] || MEMBERSHIP_PRICES[price] || { interval: 'month', count: 1 };
  const item = { id: `si_${id}`, price: { id: price, product: p.product || 'prod_academy', recurring: p.interval ? { interval: p.interval, interval_count: p.count } : null } };
  const sub = {
    id, object: 'subscription', customer, status, created, start_date: start || created,
    cancel_at_period_end: cancelAtPeriodEnd, cancel_at: cancelAt,
    metadata: metadata || { sml_kind: 'mem_academy', mem_academy_package: p.package, mem_academy_discord_user: '' },
    items: { data: [item] },
    trial_start: trialStart, trial_end: trialEnd
  };
  if (trialSettings) sub.trial_settings = trialSettings;
  if (defaultPaymentMethod) sub.default_payment_method = defaultPaymentMethod;
  if (basil) { item.current_period_start = periodStart; item.current_period_end = periodEnd; }
  else { sub.current_period_start = periodStart; sub.current_period_end = periodEnd; }
  return sub;
}

function invoice({ id, subscription: subId, charge = null, status = 'paid', created = S(T0) - 3600, basil = false } = {}) {
  const inv = { id, object: 'invoice', status, created };
  if (basil) {
    inv.parent = { subscription_details: { subscription: subId } };
    inv.payments = { data: charge ? [{ status: 'paid', payment: { type: 'charge', charge } }] : [] };
  } else {
    inv.subscription = subId;
    inv.charge = charge;
  }
  return inv;
}

function charge({ id, customer, amount = 2999, amountRefunded = 0, refunded = false, disputed = false, paymentIntent = null, invoiceId = null,
  created = S(T0) - 3600, status = 'succeeded' } = {}) {
  return { id, object: 'charge', customer, status, amount, amount_refunded: amountRefunded, refunded, disputed, payment_intent: paymentIntent, invoice: invoiceId, created };
}

/* nextAction: e.g. 'verify_with_microdeposits' for a bank account that still
   has to be verified (status 'requires_action'). */
function lifetimePi({ id, customer, discordId = USER, status = 'succeeded', latestCharge = null, amount = 129999, created = S(T0) - 7200, nextAction = null,
  price = 'price_life1' } = {}) {
  return {
    id, object: 'payment_intent', customer, status, amount, amount_received: status === 'succeeded' ? amount : 0, currency: 'usd', created, latest_charge: latestCharge,
    next_action: nextAction ? { type: nextAction } : null,
    metadata: { sml_kind: 'mem_academy', mem_academy_package: 'lifetime', mem_academy_discord_user: discordId, mem_academy_price: price }
  };
}

function academyCustomer(id, discordId, overrides = {}) {
  return { id, object: 'customer', livemode: false, metadata: { sml_kind: 'mem_academy', mem_academy_discord_user: discordId }, ...overrides };
}

/* The current period end, on the subscription (pre-basil) or on its item (basil). */
function setPeriodEnd(sub, end) {
  if (sub.current_period_end !== undefined) sub.current_period_end = end;
  else if (sub.items && sub.items.data[0]) sub.items.data[0].current_period_end = end;
}

function createFakeStripe(fixtures = {}) {
  const data = {
    customers: { ...(fixtures.customers || {}) },
    subscriptions: [...(fixtures.subscriptions || [])],
    paymentIntents: [...(fixtures.paymentIntents || [])],
    charges: [...(fixtures.charges || [])],
    invoices: [...(fixtures.invoices || [])],
    disputes: [...(fixtures.disputes || [])],
    sessions: { ...(fixtures.sessions || {}) },
    prices: { ...(fixtures.prices || {}) },
    endpoints: fixtures.endpoints || [],
    account: fixtures.account === undefined ? { id: ACCOUNT } : fixtures.account,
    /* 'classic' (what the engine's pinned 2022-11-15 Checkout creates) or
       'flexible': in classic mode a cancel_at set before trial_end also
       moves trial_end (and the period end) to it (docs.stripe.com
       billing/subscriptions/billing-mode/compare, "Preserve original trial
       end date when subscription cancels"). */
    billingMode: fixtures.billingMode || 'flexible',
    /* true: a trial that converts with a payment method gets a DRAFT first
       invoice (auto_advance) that is finalized and charged an hour after
       the trial end, as Stripe does (docs.stripe.com billing/subscriptions/
       trials/free-trials); a cancel before then leaves it uncollected. */
    invoiceDelay: fixtures.invoiceDelay === true
  };
  for (const id of [...Object.keys(PRICE_TABLE), ...Object.keys(MEMBERSHIP_PRICES)]) if (!data.prices[id]) data.prices[id] = stripePrice(id);
  const calls = [];
  const failures = new Map();
  const truncated = new Set(fixtures.truncated || []);
  let counter = 0;
  const idem = new Map();

  function call(name, args) {
    calls.push({ name, args });
    const fail = failures.get(name);
    if (fail) {
      if (typeof fail === 'function') { const err = fail(args); if (err) throw err; }
      else if (fail.remaining === undefined || fail.remaining-- > 0) throw fail.error || Object.assign(new Error('stripe 500'), { statusCode: 500, type: 'StripeAPIError' });
    }
  }
  const list = (name, rows) => ({ data: rows, complete: !truncated.has(name) });

  const api = {
    data, calls, failures,
    fail(name, error, remaining) { failures.set(name, { error, remaining }); },
    failWhen(name, fn) { failures.set(name, fn); },
    callsOf(name) { return calls.filter((c) => c.name === name); },
    writes() { return calls.filter((c) => /^(create|update|expire|cancel)/.test(c.name)); },

    async retrieveCustomer(id) { call('retrieveCustomer', [id]); return data.customers[id] || { id, deleted: true, missing: true }; },
    async listSubscriptions(customer) { call('listSubscriptions', [customer]); return list('listSubscriptions', data.subscriptions.filter((s) => s.customer === customer)); },
    async listPaymentIntents(customer) { call('listPaymentIntents', [customer]); return list('listPaymentIntents', data.paymentIntents.filter((p) => p.customer === customer)); },
    async listCharges(customer) { call('listCharges', [customer]); return list('listCharges', data.charges.filter((c) => c.customer === customer)); },
    async listPaidInvoices(subId) {
      call('listPaidInvoices', [subId]);
      const rows = data.invoices.filter((i) => (i.subscription === subId || (i.parent && i.parent.subscription_details.subscription === subId)) && i.status === 'paid')
        .sort((a, b) => b.created - a.created);
      return { data: rows.slice(0, 10), complete: true };
    },
    async listDisputesForCharge(chargeId) { call('listDisputesForCharge', [chargeId]); return list('listDisputesForCharge', data.disputes.filter((d) => d.charge === chargeId)); },
    async listRecentDisputes(since) {
      call('listRecentDisputes', [since]);
      return list('listRecentDisputes', data.disputes.map((d) => ({ ...d, charge: data.charges.find((c) => c.id === d.charge) || d.charge })));
    },
    async retrievePaymentIntent(id) { call('retrievePaymentIntent', [id]); const pi = data.paymentIntents.find((p) => p.id === id); if (!pi) throw Object.assign(new Error('missing'), { code: 'resource_missing', statusCode: 404 }); return pi; },
    async retrieveCharge(id) { call('retrieveCharge', [id]); const c = data.charges.find((x) => x.id === id); if (!c) throw Object.assign(new Error('missing'), { code: 'resource_missing', statusCode: 404 }); return c; },
    async retrieveInvoice(id) { call('retrieveInvoice', [id]); const i = data.invoices.find((x) => x.id === id); if (!i) throw Object.assign(new Error('missing'), { code: 'resource_missing' }); return i; },
    async retrievePrice(id) { call('retrievePrice', [id]); const p = data.prices[id]; if (!p) throw Object.assign(new Error('missing'), { code: 'resource_missing' }); return p; },
    async retrieveCheckoutSession(id) { call('retrieveCheckoutSession', [id]); const s = data.sessions[id]; if (!s) throw Object.assign(new Error('missing'), { code: 'resource_missing' }); return s; },
    async listOpenCheckoutSessions(customer) { call('listOpenCheckoutSessions', [customer]); return list('listOpenCheckoutSessions', Object.values(data.sessions).filter((s) => s.customer === customer && s.status === 'open')); },
    async listSubscriptionsByPrice(price, status) {
      call('listSubscriptionsByPrice', [price, status]);
      return list('listSubscriptionsByPrice', data.subscriptions.filter((s) => s.status === status && s.items.data.some((i) => i.price.id === price)));
    },
    async searchAcademySubscriptions() { call('searchAcademySubscriptions', []); return list('searchAcademySubscriptions', data.subscriptions.filter((s) => s.metadata && s.metadata.sml_kind === 'mem_academy')); },
    async searchLifetimePaymentIntents() { call('searchLifetimePaymentIntents', []); return list('searchLifetimePaymentIntents', data.paymentIntents.filter((p) => p.metadata && p.metadata.mem_academy_package === 'lifetime' && p.status === 'succeeded')); },
    async searchAcademyCustomers() { call('searchAcademyCustomers', []); return list('searchAcademyCustomers', Object.values(data.customers).filter((c) => c.metadata && c.metadata.sml_kind === 'mem_academy')); },
    async searchCustomersByDiscordId(id) { call('searchCustomersByDiscordId', [id]); return list('searchCustomersByDiscordId', Object.values(data.customers).filter((c) => c.metadata && c.metadata.mem_academy_discord_user === id)); },
    async retrieveAccount() { call('retrieveAccount', []); if (data.account instanceof Error) throw data.account; return data.account; },
    async listWebhookEndpoints() { call('listWebhookEndpoints', []); return { data: data.endpoints, complete: true }; },

    async createCustomer(params, key) {
      call('createCustomer', [params, key]);
      if (idem.has(key)) return idem.get(key);
      const customer = { id: `cus_new${++counter}`, object: 'customer', livemode: false, ...params };
      data.customers[customer.id] = customer;
      idem.set(key, customer);
      return customer;
    },
    async updateCustomer(id, params, key) { call('updateCustomer', [id, params, key]); const c = data.customers[id]; c.metadata = { ...c.metadata, ...(params.metadata || {}) }; return c; },
    async createCheckoutSession(params, key) {
      call('createCheckoutSession', [params, key]);
      if (idem.has(key)) return idem.get(key);
      const id = `cs_test_session${String(++counter).padStart(8, '0')}`;
      const session = { id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}`, status: 'open', customer: params.customer,
        mode: params.mode, metadata: params.metadata, client_reference_id: params.client_reference_id, payment_status: 'unpaid' };
      data.sessions[id] = session;
      idem.set(key, session);
      return session;
    },
    async expireCheckoutSession(id, key) { call('expireCheckoutSession', [id, key]); data.sessions[id].status = 'expired'; return data.sessions[id]; },
    async createPortalSession(params, key) { call('createPortalSession', [params, key]); return { id: 'bps_1', url: 'https://billing.stripe.com/p/session/test_1' }; },
    async updateSubscription(id, params, key) {
      call('updateSubscription', [id, params, key]);
      const sub = data.subscriptions.find((s) => s.id === id);
      if (params.cancel_at !== undefined) sub.cancel_at = params.cancel_at;
      if (params.cancel_at && data.billingMode === 'classic' && sub.status === 'trialing' && sub.trial_end && params.cancel_at < sub.trial_end) {
        sub.trial_end = params.cancel_at;
        setPeriodEnd(sub, params.cancel_at);
      }
      if (params.cancel_at_period_end !== undefined) sub.cancel_at_period_end = params.cancel_at_period_end;
      if (params.metadata) sub.metadata = { ...sub.metadata, ...params.metadata };
      return sub;
    },
    async cancelSubscription(id, params, key) {
      call('cancelSubscription', [id, params, key]);
      const sub = data.subscriptions.find((s) => s.id === id);
      sub.status = 'canceled';
      /* Stripe: cancelling sets auto_advance=false on the subscription's draft and open invoices (no automatic collection) */
      for (const inv of data.invoices) if ((inv.subscription === id) && ['draft', 'open'].includes(inv.status)) inv.auto_advance = false;
      return sub;
    },
    /**
     * Stripe's clock, one step, for trials and cancel_at (not renewals):
     * moves every subscription to `toSec` the way docs.stripe.com
     * billing/subscriptions/trials/free-trials and .../cancel describe it.
     *   - a trialing subscription set to cancel at or before its trial end
     *     (cancel_at, or cancel_at_period_end) is cancelled then, and nothing
     *     is invoiced;
     *   - otherwise, once its trial ends: with a default payment method (the
     *     subscription's, else the Customer's invoice_settings one) the first
     *     period is invoiced and charged; without one,
     *     trial_settings.end_behavior.missing_payment_method decides (cancel
     *     / pause / create_invoice, the last leaving it past_due unpaid);
     *   - a live subscription whose cancel_at has come is cancelled;
     *   - with invoiceDelay, the first invoice of a converted trial is a
     *     draft charged an hour after the trial end, unless a cancel turned
     *     its auto_advance off first.
     * Returns the invoices it created.
     */
    advanceClock(toSec) {
      const created = [];
      for (const sub of data.subscriptions) {
        if (sub.status === 'trialing' && sub.trial_end) {
          const stopAt = sub.cancel_at || (sub.cancel_at_period_end ? sub.trial_end : null);
          if (stopAt && stopAt <= sub.trial_end) {
            if (stopAt <= toSec) Object.assign(sub, { status: 'canceled', canceled_at: stopAt, ended_at: stopAt });
            continue;
          }
          if (sub.trial_end > toSec) continue;
          const customer = data.customers[sub.customer] || {};
          const pm = sub.default_payment_method || sub.default_source
            || (customer.invoice_settings && customer.invoice_settings.default_payment_method) || customer.default_source || null;
          const behavior = (sub.trial_settings && sub.trial_settings.end_behavior && sub.trial_settings.end_behavior.missing_payment_method) || 'create_invoice';
          if (!pm && behavior === 'cancel') { Object.assign(sub, { status: 'canceled', canceled_at: sub.trial_end, ended_at: sub.trial_end }); continue; }
          if (!pm && behavior === 'pause') { sub.status = 'paused'; continue; }
          const item = sub.items.data[0];
          const price = data.prices[item.price.id] || {};
          const n = ++counter;
          const periodEnd = sub.trial_end + ({ day: 1, week: 7, month: 30, year: 365 }[item.price.recurring && item.price.recurring.interval] || 30) * 86400;
          const delayed = Boolean(pm) && data.invoiceDelay;
          const inv = invoice({ id: `in_trialend${n}`, subscription: sub.id, charge: pm && !delayed ? `ch_trialend${n}` : null,
            status: delayed ? 'draft' : pm ? 'paid' : 'open', created: sub.trial_end });
          inv.amount_due = price.unit_amount || 0;
          if (delayed) Object.assign(inv, { auto_advance: true, customer: sub.customer });
          data.invoices.push(inv);
          created.push(inv);
          if (pm && !delayed) data.charges.push(charge({ id: `ch_trialend${n}`, customer: sub.customer, amount: price.unit_amount || 0, invoiceId: inv.id, created: sub.trial_end + 3600 }));
          sub.status = pm ? 'active' : 'past_due';
          if (sub.current_period_start !== undefined) sub.current_period_start = sub.trial_end;
          else item.current_period_start = sub.trial_end;
          setPeriodEnd(sub, sub.cancel_at && sub.cancel_at < periodEnd ? sub.cancel_at : periodEnd);
        }
        if (['active', 'past_due', 'trialing'].includes(sub.status) && sub.cancel_at && sub.cancel_at <= toSec) {
          Object.assign(sub, { status: 'canceled', canceled_at: sub.cancel_at, ended_at: sub.cancel_at });
        }
      }
      /* invoiceDelay: a draft first invoice still on automatic collection is finalized and charged an hour after it was created */
      for (const inv of data.invoices) {
        if (inv.status !== 'draft' || inv.auto_advance !== true || inv.created + 3600 > toSec) continue;
        const n = ++counter;
        Object.assign(inv, { status: 'paid', charge: `ch_draftpaid${n}` });
        data.charges.push(charge({ id: `ch_draftpaid${n}`, customer: inv.customer, amount: inv.amount_due || 0, invoiceId: inv.id, created: inv.created + 3600 }));
      }
      return created;
    },
    async updatePaymentIntent(id, params, key) { call('updatePaymentIntent', [id, params, key]); const pi = data.paymentIntents.find((p) => p.id === id); pi.metadata = { ...pi.metadata, ...(params.metadata || {}) }; return pi; },
    async createTestClock(params, key) { call('createTestClock', [params, key]); return { id: 'clock_1' }; }
  };
  return api;
}

/* ----------------------------------------------------------------------------
 * Discord
 * ------------------------------------------------------------------------- */

function createFakeBot({ members = {}, users = {}, roles = null, me = { id: APP }, guild = { id: GUILD }, auditAdds = [] } = {}) {
  const state = { members: { ...members }, calls: [], failMember: new Map(), bans: new Set() };
  const defaultRoles = [
    { id: GUILD, position: 0, permissions: '0', managed: false },
    { id: '1700000000000000021', position: 21, permissions: String(1n << 28n), managed: true },
    { id: ACADEMY_ROLE, position: 1, permissions: '0', managed: false },
    { id: LIFETIME_ROLE, position: 2, permissions: '0', managed: false },
    { id: MONARCH, position: 30, permissions: '0', managed: false }
  ];
  if (!state.members[APP]) state.members[APP] = ['1700000000000000021'];
  const bot = {
    state,
    async getMember(id) {
      state.calls.push(['getMember', id]);
      const fail = state.failMember.get(id) || state.failMember.get('*');
      if (fail) throw fail;
      const held = state.members[id];
      if (held === undefined || held === null) return { inGuild: false, roles: [] };
      return { inGuild: true, roles: held.slice(), userId: id };
    },
    async getUser(id) { state.calls.push(['getUser', id]); return users[id] || { id, username: `user${id.slice(-3)}`, globalName: '' }; },
    async getMe() { return me; },
    async getGuild() { return guild; },
    async listRoles() { return roles || defaultRoles; },
    async listMembers(after) {
      state.calls.push(['listMembers', after]);
      if (state.listMembersError) throw state.listMembersError;
      return Object.entries(state.members).filter(([id, r]) => r && BigInt(id) > BigInt(after)).map(([userId, r]) => ({ userId, roles: r }));
    },
    async auditLogRoleAdds({ after }) {
      state.calls.push(['auditLogRoleAdds', after]);
      if (state.auditError) throw state.auditError;
      return { adds: auditAdds, cursor: auditAdds.length ? auditAdds[auditAdds.length - 1].id : after };
    },
    async addMember(id) { state.calls.push(['addMember', id]); state.members[id] = []; return { added: true, status: 201 }; },
    async getBan(id) { return state.bans.has(id); }
  };
  return bot;
}

function discordError(kind, status, code) { return new DiscordError(kind, status, code); }

/* ----------------------------------------------------------------------------
 * Store
 * ------------------------------------------------------------------------- */

function createFakeStore({ livemode = false, guildId = GUILD, now = Date.now } = {}) {
  const db = {
    members: new Map(), comps: [], lifetime: new Map(), intents: new Map(), roles: new Map(), events: new Map(),
    runs: [], audit: [], handoffs: new Map(), external: new Map(), trials: new Map()
  };
  let compSeq = 0;
  let auditSeq = 0;
  const lm = Boolean(livemode);
  const mkey = (id) => `${id}|${lm}`;
  const rkey = (id, roleId) => `${lm}|${guildId}|${id}|${roleId}`;
  const locks = new Map();
  const queries = [];
  const iso = (v) => (v == null ? null : new Date(v));

  /* The fake client/pool understand only what bypasses the store API: the
     audit chain, the per-user lock and the hand-off table. */
  async function query(sql, params = []) {
    const text = String(sql);
    queries.push(text);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text.trim())) return { rows: [], rowCount: 0 };
    if (text.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
    if (text.startsWith('SELECT row_hash FROM academy_billing_audit')) {
      const last = db.audit[db.audit.length - 1];
      return { rows: last ? [{ row_hash: last.row_hash }] : [], rowCount: last ? 1 : 0 };
    }
    if (text.includes('INSERT INTO academy_billing_audit')) {
      const [at, livemodeV, runId, actor, action, discordUserId, roleKey, outcome, reason, refs, eventId, httpStatus, details, prevHash, rowHash] = params;
      db.audit.push({ id: ++auditSeq, at: new Date(at), livemode: livemodeV, run_id: runId, actor, action, discord_user_id: discordUserId,
        role_key: roleKey, outcome, reason, stripe_refs: JSON.parse(refs), event_id: eventId, http_status: httpStatus,
        details: JSON.parse(details), prev_hash: prevHash, row_hash: rowHash });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('FROM academy_billing_audit WHERE id >')) {
      const rows = db.audit.filter((r) => r.id > params[0]).slice(0, params[1]).map((r) => ({ ...r }));
      return { rows, rowCount: rows.length };
    }
    if (text.includes('INSERT INTO academy_billing_handoffs')) {
      db.handoffs.set(params[0], { code_sha256: params[0], discord_user_id: params[1], guild_id: params[2], source: params[3], purpose: 'buy',
        expires_at: now() + 5 * 60_000, used_at: null });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('UPDATE academy_billing_handoffs')) {
      const row = db.handoffs.get(params[0]);
      if (!row || row.used_at || row.expires_at <= now()) return { rows: [], rowCount: 0 };
      row.used_at = now();
      return { rows: [{ discord_user_id: row.discord_user_id, guild_id: row.guild_id, source: row.source, purpose: row.purpose }], rowCount: 1 };
    }
    if (text.includes('DELETE FROM academy_billing_handoffs')) return { rows: [], rowCount: 0 };
    if (text.includes('FROM schema_migrations')) return { rows: store.schema ? [{ ok: 1 }] : [], rowCount: store.schema ? 1 : 0 };
    throw new Error(`fake store: unexpected SQL ${text.slice(0, 80)}`);
  }
  const client = { query, release() {} };
  const pool = { query, connect: async () => client };

  async function withTx(fn) { return fn(client); }
  async function withUserTx(id, fn) {
    const prev = locks.get(id) || Promise.resolve();
    let release;
    const current = new Promise((r) => { release = r; });
    locks.set(id, prev.then(() => current));
    await prev;
    try { return await fn(client); } finally { release(); }
  }

  const unfinishedRevoke = (g) => {
    const o = db.roles.get(rkey(g.discord_user_id, g.role_id));
    return g.state === 'revoked' && Boolean(o) && o.desired === false && ['failed', 'suppressed'].includes(o.state);
  };

  const store = {
    db, pool, queries, livemode: lm, guildId, schema: true,
    withTx, withUserTx,
    async lockUser() {},
    async schemaPresent() { return store.schema; },
    async getMember(q, id) { const m = db.members.get(mkey(id)); return m ? { ...m } : null; },
    async getMemberByCustomer(q, cus) { const m = [...db.members.values()].find((x) => x.stripe_customer_id === cus && x.livemode === lm); return m ? { ...m } : null; },
    async memberIds() { return [...db.members.values()].filter((m) => m.livemode === lm && m.stripe_customer_id).map((m) => m.discord_user_id); },
    async dueMemberIds(q, limit) {
      return [...db.members.values()].filter((m) => m.livemode === lm && m.next_check_at && m.next_check_at.getTime() <= now())
        .sort((a, b) => a.next_check_at - b.next_check_at).slice(0, limit).map((m) => m.discord_user_id);
    },
    async ensureMember(q, { discordId, boundVia }) {
      if (!db.members.has(mkey(discordId))) {
        db.members.set(mkey(discordId), { discord_user_id: discordId, livemode: lm, guild_id: guildId, stripe_customer_id: null, stripe_account_id: null,
          bound_via: boundVia, rebound_to: null, next_check_at: null, last_synced_at: null, last_access: {}, created_at: new Date(now()) });
      }
      return db.members.get(mkey(discordId));
    },
    async setMemberCustomer(q, { discordId, customerId, accountId }) {
      const m = db.members.get(mkey(discordId));
      if (!m || m.stripe_customer_id) return 0;
      if ([...db.members.values()].some((x) => x.stripe_customer_id === customerId)) throw new Error('unique violation');
      m.stripe_customer_id = customerId; m.stripe_account_id = accountId; m.rebound_to = null;
      return 1;
    },
    async upsertRebuiltMember(q, { discordId, customerId, accountId }) {
      const m = db.members.get(mkey(discordId));
      if (!m) {
        db.members.set(mkey(discordId), { discord_user_id: discordId, livemode: lm, guild_id: guildId, stripe_customer_id: customerId, stripe_account_id: accountId,
          bound_via: 'stripe_rebuild', rebound_to: null, next_check_at: null, last_synced_at: null, last_access: {}, created_at: new Date(now()) });
        return 1;
      }
      if (m.stripe_customer_id || m.rebound_to) return 0;
      m.stripe_customer_id = customerId; m.stripe_account_id = accountId;
      return 1;
    },
    async updateMemberAccess(q, { discordId, lastAccess, nextCheckAt, snapshotAt }) {
      const m = db.members.get(mkey(discordId));
      if (!m) return 0;
      m.last_access = JSON.parse(JSON.stringify(lastAccess)); m.next_check_at = iso(nextCheckAt); m.last_synced_at = new Date(snapshotAt);
      return 1;
    },
    async setNextCheck(q, id, at) { const m = db.members.get(mkey(id)); if (m) m.next_check_at = iso(at); },
    async moveBinding(q, { fromId, toId, customerId, accountId }) {
      const from = db.members.get(mkey(fromId));
      if (!from || from.stripe_customer_id !== customerId) throw new Error('rebind_source_not_bound_to_customer');
      const to = db.members.get(mkey(toId));
      if (to && to.stripe_customer_id) throw new Error('rebind_target_already_bound');
      from.stripe_customer_id = null; from.rebound_to = toId; from.next_check_at = new Date(now());
      if (to) { to.stripe_customer_id = customerId; to.rebound_to = null; to.bound_via = 'admin'; }
      else db.members.set(mkey(toId), { discord_user_id: toId, livemode: lm, guild_id: guildId, stripe_customer_id: customerId, stripe_account_id: accountId,
        bound_via: 'admin', rebound_to: null, next_check_at: null, last_synced_at: null, last_access: {}, created_at: new Date(now()) });
      for (const row of db.lifetime.values()) if (row.discord_user_id === fromId && row.stripe_customer_id === customerId) row.discord_user_id = toId;
    },
    async compsFor(q, id) { return db.comps.filter((c) => c.discord_user_id === id && c.livemode === lm && !c.revoked_at).map((c) => ({ ...c })); },
    async compHolderIds() {
      return [...new Set(db.comps.filter((c) => c.livemode === lm && !c.revoked_at && (!c.expires_at || c.expires_at.getTime() > now())).map((c) => c.discord_user_id))];
    },
    async insertComp(q, { discordId, includeLifetimeRole, reason, grantedBy, expiresAt, grantsAcademy = true, externalRoleIds = [] }) {
      if (!grantsAcademy && !includeLifetimeRole && !externalRoleIds.length) throw new Error('check violation: comp grants nothing');
      if (externalRoleIds.some((id) => id == null) || new Set(externalRoleIds).size !== externalRoleIds.length) throw new Error('check violation: comp role ids');
      const row = { id: ++compSeq, discord_user_id: discordId, livemode: lm, include_lifetime_role: Boolean(includeLifetimeRole), reason, granted_by: grantedBy,
        expires_at: iso(expiresAt), revoked_at: null, grants_academy: Boolean(grantsAcademy), external_role_ids: externalRoleIds.map(String) };
      db.comps.push(row);
      return { ...row };
    },
    async revokeComp(q, { id, revokedBy }) {
      const row = db.comps.find((c) => c.id === Number(id) && !c.revoked_at);
      if (!row) return null;
      row.revoked_at = new Date(now()); row.revoked_by = revokedBy;
      return { id: row.id, discord_user_id: row.discord_user_id };
    },
    async lifetimeRows(q, id) { return [...db.lifetime.values()].filter((r) => r.discord_user_id === id && r.livemode === lm); },
    async lifetimeByPaymentIntent(q, pi) { const r = db.lifetime.get(pi); return r && r.livemode === lm ? r : null; },
    async lifetimeHolderIds() {
      return [...new Set([...db.lifetime.values()].filter((r) => r.livemode === lm && ['paid', 'partially_refunded', 'disputed', 'dispute_won'].includes(r.stripe_state)).map((r) => r.discord_user_id))];
    },
    async upsertLifetime(q, row) {
      const existing = db.lifetime.get(row.paymentIntentId) || {};
      db.lifetime.set(row.paymentIntentId, { ...existing, payment_intent_id: row.paymentIntentId, livemode: lm, discord_user_id: row.discordId,
        stripe_customer_id: row.customerId, stripe_price_id: existing.stripe_price_id || row.priceId, amount_cents: row.amountCents, currency: row.currency,
        paid_at: new Date(row.paidAt), latest_charge_id: row.chargeId || existing.latest_charge_id || null, stripe_state: row.state });
    },
    async insertIntent(q, intent) {
      db.intents.set(intent.id, { id: intent.id, discord_user_id: intent.discordId, guild_id: guildId, livemode: lm, package: intent.package,
        stripe_price_id: intent.priceId, stripe_customer_id: intent.customerId, bind_source: intent.bindSource, consent_kind: intent.consentKind,
        consent_version: intent.consentVersion, consent_sha256: intent.consentSha256, consented_at: new Date(intent.consentedAt),
        stripe_checkout_session_id: null, status: 'created', created_at: new Date(now()), expires_at: new Date(intent.expiresAt),
        trial_days: Number.isInteger(intent.trialDays) ? intent.trialDays : null });
    },
    async trialFor(q, id) { const row = db.trials.get(mkey(id)); return row ? { ...row } : null; },
    async recordTrial(q, { discordId, priceId = null, subscriptionId, startedAt, trialEndAt = null }) {
      if (db.trials.has(mkey(discordId))) return 0;
      db.trials.set(mkey(discordId), { discord_user_id: discordId, livemode: lm, first_price_id: priceId, stripe_subscription_id: subscriptionId,
        started_at: new Date(startedAt), trial_end_at: trialEndAt == null ? null : new Date(trialEndAt), recorded_at: new Date(now()) });
      return 1;
    },
    async recentCreatedIntent(q, id, seconds) {
      return [...db.intents.values()].find((i) => i.discord_user_id === id && i.status === 'created' && now() - i.created_at.getTime() < seconds * 1000) || null;
    },
    async markIntentOpen(q, { id, sessionId }) { const i = db.intents.get(id); if (i && ['created', 'open'].includes(i.status)) { i.status = 'open'; i.stripe_checkout_session_id = sessionId; } },
    async markIntentStatus(q, { id, sessionId, status }) {
      const rows = [];
      for (const i of db.intents.values()) {
        if (((id && i.id === id) || (sessionId && i.stripe_checkout_session_id === sessionId)) && i.livemode === lm && ['created', 'open'].includes(i.status)) {
          i.status = status;
          rows.push({ id: i.id, discord_user_id: i.discord_user_id, stripe_checkout_session_id: i.stripe_checkout_session_id });
        }
      }
      return rows;
    },
    async getIntentBySession(q, sessionId) { return [...db.intents.values()].find((i) => i.stripe_checkout_session_id === sessionId && i.livemode === lm) || null; },
    async getIntent(q, id) { return db.intents.get(id) || null; },
    async roleRowsFor(q, id) { return [...db.roles.values()].filter((r) => r.discord_user_id === id && r.livemode === lm).map((r) => ({ ...r })); },
    async insertRoleRow(q, { discordId, roleId, roleKey, desired, state, nextAttemptAt }) {
      const k = rkey(discordId, roleId);
      if (db.roles.has(k)) throw new Error('duplicate role row');
      db.roles.set(k, { livemode: lm, guild_id: guildId, discord_user_id: discordId, role_id: String(roleId), role_key: roleKey, desired, generation: 1, state,
        attempts: 0, next_attempt_at: iso(nextAttemptAt), awaiting_since: state === 'awaiting_member' ? new Date(now()) : null, updated_at: new Date(now()) });
    },
    async updateRoleRow(q, { discordId, roleId, desired, state, bump, nextAttemptAt, resetAttempts = true }) {
      const r = db.roles.get(rkey(discordId, roleId));
      if (!r) return null;
      r.desired = desired; r.state = state; if (bump) r.generation += 1; if (resetAttempts) r.attempts = 0;
      r.next_attempt_at = iso(nextAttemptAt); r.awaiting_since = state === 'awaiting_member' ? (r.awaiting_since || new Date(now())) : null; r.updated_at = new Date(now());
      return r.generation;
    },
    async claimRoleRows(limit = 20, leaseSeconds = 120, { grantsOnly = false } = {}) {
      const due = [...db.roles.values()].filter((r) => r.livemode === lm && r.guild_id === guildId && ['pending', 'awaiting_member'].includes(r.state)
        && (!r.next_attempt_at || r.next_attempt_at.getTime() <= now()) && (r.desired || !grantsOnly))
        .sort((a, b) => Number(a.desired) - Number(b.desired) || a.updated_at - b.updated_at).slice(0, limit);
      for (const r of due) { r.attempts += 1; r.next_attempt_at = new Date(now() + leaseSeconds * 1000); }
      return due.map((r) => ({ ...r }));
    },
    async finishRoleRow(q, { discordId, roleId, generation, state, nextAttemptAt, httpStatus, error }) {
      const r = db.roles.get(rkey(discordId, roleId));
      if (!r || r.generation !== Number(generation)) return 0;
      r.state = state; if (state === 'synced') { r.attempts = 0; r.applied_generation = r.generation; r.applied_desired = r.desired; r.last_applied_at = new Date(now()); }
      r.next_attempt_at = iso(nextAttemptAt); r.last_http_status = httpStatus || null; r.last_error = error || null;
      if (state === 'awaiting_member') r.awaiting_since = r.awaiting_since || new Date(now());
      if (state === 'synced') r.awaiting_since = null;
      return 1;
    },
    async releaseRoleRow(q, { discordId, roleId, generation }) {
      const r = db.roles.get(rkey(discordId, roleId));
      if (r && r.generation === Number(generation)) { r.next_attempt_at = null; r.attempts = Math.max(0, r.attempts - 1); }
    },
    async roleStateIds() { return [...new Set([...db.roles.values()].filter((r) => r.livemode === lm).map((r) => r.discord_user_id))]; },
    async markRoleSyncDue() {
      let n = 0;
      for (const m of db.members.values()) {
        if (m.livemode !== lm || (m.last_access && m.last_access.rolesQueued === true)) continue;
        if (m.next_check_at && m.next_check_at.getTime() <= now()) continue;
        m.next_check_at = new Date(now());
        n += 1;
      }
      return n;
    },
    async kickAwaiting(q, id) {
      let n = 0;
      for (const r of db.roles.values()) {
        if (r.discord_user_id !== id || !r.desired) continue;
        const gaveUp = r.state === 'failed' && ['member_absent_90d', 'member_not_in_guild'].includes(r.last_error);
        if (r.state !== 'awaiting_member' && !gaveUp) continue;
        if (gaveUp) { r.attempts = 0; r.awaiting_since = null; }
        r.state = 'pending'; r.next_attempt_at = null; n += 1;
      }
      return n;
    },
    async roleStatusFor(q, id) { return [...db.roles.values()].filter((r) => r.discord_user_id === id && r.livemode === lm).map((r) => ({ key: r.role_key, desired: r.desired, state: r.state })); },
    async externalGrantsFor(q, id) { return [...db.external.values()].filter((r) => r.discord_user_id === id && r.livemode === lm).map((r) => ({ ...r })); },
    async getExternalGrant(q, id, roleId) { const r = db.external.get(rkey(id, roleId)); return r ? { ...r } : null; },
    async insertExternalGrant(q, { discordId, roleId, hadRoleBefore, state, firstSourceRef = null, reason = null }) {
      const k = rkey(discordId, roleId);
      if (db.external.has(k)) return 0;
      if ((state === 'held' && !hadRoleBefore) || (state === 'revoked' && hadRoleBefore)) throw new Error(`check violation: ${state}/${hadRoleBefore}`);
      db.external.set(k, { livemode: lm, guild_id: guildId, discord_user_id: discordId, role_id: String(roleId), first_source_ref: firstSourceRef,
        had_role_before: Boolean(hadRoleBefore), state, generation: 1, last_reason: reason, uc_result: null, uc_checked_at: null,
        created_at: new Date(now()), updated_at: new Date(now()), state_changed_at: new Date(now()) });
      return 1;
    },
    async updateExternalGrant(q, { discordId, roleId, generation, state, reason = null, ucResult = null, ucChecked = false, hadRoleBefore = null }) {
      const r = db.external.get(rkey(discordId, roleId));
      if (!r || r.generation !== Number(generation)) return null;
      if (!['held', 'engine_granted', 'revoked', 'kept_external', 'needs_review', 'released'].includes(state)) throw new Error(`check violation: state ${state}`);
      const had = typeof hadRoleBefore === 'boolean' ? hadRoleBefore : r.had_role_before;
      if ((state === 'held' && !had) || (state === 'revoked' && had)) throw new Error(`check violation: ${state}/${had}`);
      if (r.state !== state) r.state_changed_at = new Date(now());
      r.state = state; r.last_reason = reason; r.generation += 1; r.updated_at = new Date(now()); r.had_role_before = had;
      if (ucChecked) { r.uc_result = ucResult; r.uc_checked_at = new Date(now()); }
      return r.generation;
    },
    async externalGrantHolderIds() {
      return [...new Set([...db.external.values()].filter((r) => r.livemode === lm
        && ((r.state === 'engine_granted' && !r.had_role_before) || unfinishedRevoke(r))).map((r) => r.discord_user_id))];
    },
    async externalReviewRows(q, { states = ['needs_review'], unfinished = false } = {}) {
      return [...db.external.values()].filter((r) => r.livemode === lm && (states.includes(r.state) || (unfinished && unfinishedRevoke(r)))).map((r) => {
        const o = db.roles.get(rkey(r.discord_user_id, r.role_id));
        return { ...r, outbox_state: o ? o.state : null, outbox_desired: o ? o.desired : null };
      });
    },
    async insertEvent(q, row) {
      if (db.events.has(row.eventId)) return 'duplicate';
      db.events.set(row.eventId, { event_id: row.eventId, type: row.type, livemode: Boolean(row.livemode), account: row.account || null,
        object_id: row.objectId, customer_id: row.customerId, subscription_id: row.subscriptionId, payment_intent_id: row.paymentIntentId,
        charge_id: row.chargeId, checkout_session_id: row.checkoutSessionId, invoice_id: row.invoiceId, meta_sml_kind: row.metaSmlKind,
        meta_discord_user: row.metaDiscordUser, meta_intent: row.metaIntent, payload_sha256: row.payloadSha256, status: row.status,
        ignore_reason: row.ignoreReason, attempts: 0, next_attempt_at: null, last_error: null, received_at: new Date(now()) });
      return 'inserted';
    },
    async claimEvents(limit = 25, leaseSeconds = 300) {
      const due = [...db.events.values()].filter((e) => ['pending', 'failed'].includes(e.status) && e.livemode === lm
        && (!e.next_attempt_at || e.next_attempt_at.getTime() <= now())).slice(0, limit);
      for (const e of due) { e.attempts += 1; e.next_attempt_at = new Date(now() + leaseSeconds * 1000); }
      return due.map((e) => ({ ...e }));
    },
    async finishEvent(q, { eventId, status, reason }) { const e = db.events.get(eventId); e.status = status; if (reason) e.ignore_reason = reason; e.next_attempt_at = null; e.last_error = null; },
    async retryEvent(q, { eventId, error, delaySeconds }) {
      const e = db.events.get(eventId);
      if (e.attempts >= 20) { e.status = 'dead'; e.next_attempt_at = null; }
      else { e.status = 'failed'; e.next_attempt_at = new Date(now() + 1000 * (delaySeconds != null ? delaySeconds : Math.min(21600, 30 * 2 ** Math.min(e.attempts, 20)))); }
      e.last_error = String(error).slice(0, 300);
      return { status: e.status, attempts: e.attempts };
    },
    async replayDeferred() { let n = 0; for (const e of db.events.values()) if (e.status === 'deferred' && e.livemode === lm) { e.status = 'pending'; e.attempts = 0; n += 1; } return n; },
    async replayEvent(q, id) { const e = db.events.get(id); if (!e || e.livemode !== lm) return null; e.status = 'pending'; e.attempts = 0; e.next_attempt_at = null; return { event_id: id, type: e.type }; },
    async pruneEvents() { return 0; },
    async startRun({ runId, mode, scope }) {
      if (db.runs.some((r) => !r.finished_at && now() - r.started_at < 30 * 60_000)) return false;
      db.runs.push({ run_id: runId, livemode: lm, mode, scope, started_at: now(), finished_at: null });
      return true;
    },
    async finishRun(q, run) {
      const r = db.runs.find((x) => x.run_id === run.runId);
      Object.assign(r, { finished_at: now(), stripe_complete: run.stripeComplete, entitled_academy: run.entitledAcademy, entitled_lifetime: run.entitledLifetime,
        holders_seen: run.holdersSeen, planned_grants: run.plannedGrants, planned_revokes: run.plannedRevokes, applied_grants: run.appliedGrants,
        applied_revokes: run.appliedRevokes, waiting_member: run.waitingMember, orphans: run.orphans, unmapped_prices: run.unmappedPrices,
        audit_log_cursor: run.auditLogCursor, brake: run.brake, error: run.error });
    },
    async previousRun() {
      const done = db.runs.filter((r) => r.finished_at && r.stripe_complete && !r.error);
      return done.length ? done[done.length - 1] : null;
    },
    async statusCounts() { return { members: [{ n: db.members.size }], events: [], roles: [], intents: [], lifetime: [], comps: [], lastRun: [], audit: [{ n: db.audit.length }] }; },
    async purgeTestRows() {
      const counts = { academy_billing_members: 0 };
      for (const [k, m] of db.members) if (!m.livemode) { db.members.delete(k); counts.academy_billing_members += 1; }
      return counts;
    }
  };
  return store;
}

/** Put a member with a Customer into the fake store. */
function bindMember(store, discordId, customerId, extra = {}) {
  store.db.members.set(`${discordId}|${store.livemode}`, {
    discord_user_id: discordId, livemode: store.livemode, guild_id: store.guildId, stripe_customer_id: customerId, stripe_account_id: ACCOUNT,
    bound_via: 'web_oauth', rebound_to: null, next_check_at: null, last_synced_at: null, last_access: {}, created_at: new Date(T0), ...extra
  });
}

function actions(store) { return store.db.audit.map((row) => row.action); }

/* ----------------------------------------------------------------------------
 * Upgrade.Chat (the platform/upgrade-chat.js client interface)
 * ------------------------------------------------------------------------- */

const ELITE = '1192450618485395466';
const FREE_TRIAL = '1542090070553526362';
const FREE_MEMBER = '1553281948527362100';
const UC_MONARCH_MONTHLY = '7f3b2c1d-9a8e-4f6b-8c5d-2e1f0a9b8c01';
const UC_MONARCH_LIFETIME = '7f3b2c1d-9a8e-4f6b-8c5d-2e1f0a9b8c02';
const UC_PREMIUM_MONTHLY = '7f3b2c1d-9a8e-4f6b-8c5d-2e1f0a9b8c03';

/**
 * subscriptions: { [discordId]: { [productUuid]: orderRef } } (findMembership hits)
 * orders:        { [discordId]: [order, ...] } (listOrders)
 * error:         an Error thrown by every call (a UC outage)
 */
function createFakeUc({ subscriptions = {}, orders = {}, error = null, incomplete = false } = {}) {
  const calls = [];
  const state = { subscriptions, orders, error, incomplete };
  return {
    calls,
    state,
    async findMembership({ discordUserId, productUuid }) {
      calls.push(['findMembership', discordUserId, productUuid]);
      if (state.error) throw state.error;
      const ref = (state.subscriptions[discordUserId] || {})[productUuid];
      if (!ref) throw new TypeError('no eligible Upgrade.Chat subscription was found for this Discord account');
      return { externalReference: ref, renewalAt: new Date(T0 + 86400_000).toISOString(), productUuid };
    },
    async listOrders({ discordUserId }) {
      calls.push(['listOrders', discordUserId]);
      if (state.error) throw state.error;
      return { data: state.orders[discordUserId] || [], complete: !state.incomplete };
    }
  };
}

/* The owner set-up (2026-09-26): no MEM Lifetime role; Lifetime also grants
   Monarch; a Premium membership product without the Academy; Upgrade.Chat
   configured for the external-role check. */
function ownerEnv({ uc = true, extraPrices = {}, ucMatch = 'mapped' } = {}) {
  const prices = JSON.parse(pricesJson({ price_life1: { roles: [MONARCH], paymentMethods: ['card', 'us_bank_account'] } }));
  prices.price_premium1 = { package: 'monthly', academy: false, roles: [PREMIUM] };
  prices.price_premlife1 = { package: 'lifetime', academy: false, roles: [PREMIUM] };
  Object.assign(prices, extraPrices);
  return {
    SML_ACADEMY_BILLING_LIFETIME_ROLE_ID: '',
    SML_ACADEMY_BILLING_PRICES_JSON: JSON.stringify(prices),
    /* these tests exercise the per-product match; memEnv() uses the default 'any' */
    ...(ucMatch ? { SML_ACADEMY_BILLING_UC_MATCH: ucMatch } : {}),
    ...(uc ? {
      UPGRADE_CHAT_CLIENT_ID: 'uc-client',
      UPGRADE_CHAT_CLIENT_SECRET: 'uc-secret',
      SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON: JSON.stringify({ [MONARCH]: [UC_MONARCH_MONTHLY, UC_MONARCH_LIFETIME], [PREMIUM]: [UC_PREMIUM_MONTHLY], [ELITE]: [] })
    } : {})
  };
}

/* The owner request of 2026-09-26: the Academy line (Lifetime grants the
   Academy Student role and Monarch ONLY, owner correction 2026-09-26: never
   Elite) plus the Making Easy Money memberships on the Upgrade.Chat store
   (academy:false): Elite Lifetime Access (Monarch + Elite, as Upgrade.Chat
   sells it), Elite Yearly / Monthly Access and Elite Week Seat (7-day free
   trial), and Free Trial Access (owner decision 2026-09-26, "3 DAY": a plain
   3-day free trial without a card that stops by itself and is never
   charged). Upgrade.Chat is checked in the default 'any' mode (no product
   map) unless ucMatch says otherwise. */
function memEnv({ uc = true, ucMatch = null, extraPrices = {} } = {}) {
  const prices = JSON.parse(pricesJson({ price_life1: { roles: [MONARCH], paymentMethods: ['card', 'us_bank_account'] } }));
  prices.price_elitelife = { package: 'lifetime', academy: false, roles: [MONARCH, ELITE] };
  prices.price_eliteyear = { package: 'yearly', academy: false, roles: [ELITE], trialDays: 7 };
  prices.price_elitemonth = { package: 'monthly', academy: false, roles: [ELITE], trialDays: 7 };
  prices.price_eliteweek = { package: 'weekly', academy: false, roles: [ELITE], trialDays: 7 };
  prices.price_freetrial = { package: 'daily', academy: false, roles: [ELITE], trialDays: 3, trialNoCard: true, cancelAfterDays: 3 };
  Object.assign(prices, extraPrices);
  return {
    SML_ACADEMY_BILLING_LIFETIME_ROLE_ID: '',
    SML_ACADEMY_BILLING_PRICES_JSON: JSON.stringify(prices),
    ...(ucMatch ? { SML_ACADEMY_BILLING_UC_MATCH: ucMatch } : {}),
    ...(uc ? { UPGRADE_CHAT_CLIENT_ID: 'uc-client', UPGRADE_CHAT_CLIENT_SECRET: 'uc-secret' } : {})
  };
}

/* An Upgrade.Chat order (the /v1/orders shape). */
function ucOrder({ uuid = 'uc-order-1', product = 'uc-product-1', subscription = true, interval = 'month', count = 1, purchasedAt = T0 - 5 * 86400_000,
  lastCharge = null, cancelledAt = null, deleted = null, freeTrialLength = 0, timeLimited = false } = {}) {
  return {
    uuid, purchased_at: new Date(purchasedAt).toISOString(), is_subscription: subscription, type: 'UPGRADE',
    cancelled_at: cancelledAt ? new Date(cancelledAt).toISOString() : null, deleted: deleted ? new Date(deleted).toISOString() : null,
    last_succeeded_charge: lastCharge ? { payment_processor_created: new Date(lastCharge).toISOString() } : null,
    order_items: [{ price: 1, quantity: 1, interval: subscription || timeLimited ? interval : null, interval_count: count,
      free_trial_length: freeTrialLength, is_time_limited: timeLimited, product: { uuid: product, name: 'x' } }]
  };
}

function randomId(prefix) { return `${prefix}_${crypto.randomBytes(6).toString('hex')}`; }

module.exports = {
  GUILD, APP, ACADEMY_ROLE, LIFETIME_ROLE, MONARCH, PREMIUM, ELITE, FREE_TRIAL, FREE_MEMBER, USER, USER2, USER3, ACCOUNT, T0, S,
  PRICE_TABLE, MEMBERSHIP_PRICES, ACADEMY_PRODUCT, BANK_LIFETIME_ENV, UC_MONARCH_MONTHLY, UC_MONARCH_LIFETIME, UC_PREMIUM_MONTHLY,
  env, config, clock, pricesJson, ownerEnv, memEnv, ucOrder, createFakeUc,
  stripePrice, subscription, invoice, charge, lifetimePi, academyCustomer,
  createFakeStripe, createFakeBot, createFakeStore, discordError, bindMember, actions, randomId
};
