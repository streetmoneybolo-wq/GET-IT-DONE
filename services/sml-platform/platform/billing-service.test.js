'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSellerOnboarding } = require('./billing-service');

test('seller onboarding requires explicit acceptance of the current 6% fee', async () => {
  await assert.rejects(
    createSellerOnboarding({ query: async () => ({ rows: [] }) }, {}, {
      ownerUserId: 9, acceptedSellerTerms: true, acceptedDisputeDebits: true,
      acceptedMembershipFeeBps: 500
    }),
    /6% membership fee acceptance/
  );
});

test('an existing seller can explicitly re-accept 6% without creating another Stripe account', async () => {
  const queries = [];
  const pool = {
    query: async (text, values) => {
      queries.push({ text, values });
      if (text.startsWith('SELECT')) return { rows: [{
        id: 4, owner_user_id: 9, connected_account_id: 'acct_existing',
        membership_fee_bps_accepted: 500, membership_fee_accepted_at: '2026-08-01T00:00:00Z'
      }] };
      return { rows: [{
        id: 4, owner_user_id: 9, connected_account_id: 'acct_existing',
        membership_fee_bps_accepted: 600, membership_fee_accepted_at: '2026-09-02T00:00:00Z'
      }] };
    }
  };
  let accountCreates = 0;
  const stripe = {
    accounts: { create: async () => { accountCreates += 1; } },
    accountLinks: { create: async (input) => ({ url: `https://connect.stripe.test/${input.account}` }) }
  };

  const result = await createSellerOnboarding(pool, stripe, {
    ownerUserId: 9, acceptedSellerTerms: true, acceptedDisputeDebits: true,
    acceptedMembershipFeeBps: 600,
    refreshUrl: 'https://stockmarketloop.com/groups/test/?billing=refresh',
    returnUrl: 'https://stockmarketloop.com/groups/test/?billing=complete'
  });

  assert.equal(accountCreates, 0);
  assert.equal(result.sellerId, 4);
  assert.equal(result.onboardingUrl, 'https://connect.stripe.test/acct_existing');
  assert.ok(queries.some((query) => query.text.startsWith('UPDATE marketplace_sellers')));
  assert.deepEqual(queries.at(-1).values, [9, 600]);
});

test('a new seller stores the accepted 6% fee with the newly created connected account', async () => {
  const queries = [];
  const pool = {
    query: async (text, values) => {
      queries.push({ text, values });
      if (text.startsWith('SELECT')) return { rows: [] };
      return { rows: [{ id: 8, connected_account_id: values[1] }] };
    }
  };
  const stripe = {
    accounts: { create: async () => ({ id: 'acct_new' }) },
    accountLinks: { create: async () => ({ url: 'https://connect.stripe.test/acct_new' }) }
  };

  const result = await createSellerOnboarding(pool, stripe, {
    ownerUserId: 12, email: 'owner@example.com', country: 'US',
    acceptedSellerTerms: true, acceptedDisputeDebits: true,
    acceptedMembershipFeeBps: 600,
    refreshUrl: 'https://stockmarketloop.com/groups/test/?billing=refresh',
    returnUrl: 'https://stockmarketloop.com/groups/test/?billing=complete'
  });

  assert.equal(result.sellerId, 8);
  assert.equal(result.onboardingUrl, 'https://connect.stripe.test/acct_new');
  const insert = queries.find((query) => query.text.startsWith('INSERT INTO marketplace_sellers'));
  assert.deepEqual(insert.values, [12, 'acct_new', 600]);
});

/* ---- owner-created membership products ---------------------------------- */
const { createGroupPlan, listGroupPlans, archiveGroupPlan } = require('./billing-service');

function planFixtures({ cardPayments = false } = {}) {
  const queries = [];
  const seller = { id: 4, owner_user_id: 9, connected_account_id: 'acct_seller', charges_enabled: true, details_submitted: true,
    membership_fee_bps_accepted: 600, membership_fee_accepted_at: '2026-09-02T00:00:00Z', card_payments_enabled: cardPayments };
  const client = {
    async query(text, values) {
      queries.push({ text, values });
      if (/INSERT INTO group_plans/.test(text)) {
        return { rows: [{ id: 77, group_id: values[0], slug: values[1], name: values[2], description: values[3], interval_key: values[4],
          interval_count: values[5], price_cents: values[6], currency: values[7], stripe_price_id: values[8], stripe_product_id: values[9],
          platform_fee_bps: values[10], created_by_user_id: values[11], active: true, created_at: '2026-09-26T00:00:00Z' }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const pool = {
    async query(text, values) { queries.push({ text, values }); if (/FROM marketplace_sellers/.test(text)) return { rows: [seller] }; return { rows: [] }; },
    async connect() { return client; }
  };
  const stripeCalls = [];
  const stripe = {
    products: { create: async (input, opts) => { stripeCalls.push(['products.create', input, opts]); return { id: 'prod_1' }; },
      update: async (id, input) => { stripeCalls.push(['products.update', id, input]); return { id }; } },
    prices: { create: async (input, opts) => { stripeCalls.push(['prices.create', input, opts]); return { id: 'price_1' }; },
      update: async (id, input) => { stripeCalls.push(['prices.update', id, input]); return { id }; } },
    accounts: { update: async (id, input) => { stripeCalls.push(['accounts.update', id, input]); return { id }; } }
  };
  return { pool, stripe, queries, stripeCalls };
}

test('creating a membership product makes the Stripe product and recurring price, then the plan and its role grant', async () => {
  const { pool, stripe, queries, stripeCalls } = planFixtures();
  const result = await createGroupPlan(pool, stripe, {
    groupId: 12, ownerUserId: 9, name: '  Premium   Alerts ', description: 'Every alert, every day.',
    priceCents: 2999, intervalKey: 'quarterly', grantsRole: 'premium'
  });
  assert.equal(stripeCalls[0][0], 'products.create');
  assert.equal(stripeCalls[0][1].name, 'Premium Alerts');
  assert.equal(stripeCalls[0][1].description, 'Every alert, every day.');
  assert.equal(stripeCalls[0][1].metadata.sml_group_id, '12');
  assert.equal(stripeCalls[1][0], 'prices.create');
  assert.deepEqual(stripeCalls[1][1].recurring, { interval: 'month', interval_count: 3 });
  assert.equal(stripeCalls[1][1].unit_amount, 2999);
  assert.equal(stripeCalls[1][1].product, 'prod_1');
  const insertPlan = queries.find((q) => /INSERT INTO group_plans/.test(q.text));
  assert.equal(insertPlan.values[8], 'price_1');
  assert.equal(insertPlan.values[9], 'prod_1');
  assert.equal(insertPlan.values[10], 600, 'products carry the 6% membership fee');
  const insertGrant = queries.find((q) => /INSERT INTO plan_role_grants/.test(q.text));
  assert.deepEqual(insertGrant.values, [77, 'premium', 'premium']);
  assert.ok(stripeCalls.some((c) => c[0] === 'accounts.update'), 'card_payments is requested for an older seller');
  assert.equal(result.plan.id, 77);
  assert.equal(result.plan.intervalLabel, '3 months');
  assert.equal(result.plan.grantsRole, 'premium');
  assert.match(result.plan.slug, /^premium-alerts-[0-9a-f]{6}$/);
});

test('a product is refused before any Stripe call when the input or the seller is not ready', async () => {
  const { pool, stripe, stripeCalls } = planFixtures({ cardPayments: true });
  const base = { groupId: 12, ownerUserId: 9, name: 'Alerts', priceCents: 500, intervalKey: 'monthly' };
  await assert.rejects(createGroupPlan(pool, stripe, { ...base, priceCents: 50 }), /between \$1\.00/);
  await assert.rejects(createGroupPlan(pool, stripe, { ...base, intervalKey: 'daily' }), /billing interval/);
  await assert.rejects(createGroupPlan(pool, stripe, { ...base, name: 'A' }), /2-80 characters/);
  await assert.rejects(createGroupPlan(pool, stripe, { ...base, grantsRole: 'owner' }), /granted role/);
  await assert.rejects(createGroupPlan(pool, stripe, { ...base, currency: 'eur' }), /USD/);
  const notReady = { query: async () => ({ rows: [] }), connect: async () => { throw new Error('should not connect'); } };
  await assert.rejects(createGroupPlan(notReady, stripe, base), /not ready/);
  assert.equal(stripeCalls.length, 0);
});

test('listing returns active products with their granted role; archiving retires the Stripe price', async () => {
  const rows = [{ id: 77, group_id: 12, slug: 'alerts-abc123', name: 'Alerts', description: null, interval_key: 'monthly', interval_count: 1,
    price_cents: 999, currency: 'usd', stripe_price_id: 'price_1', stripe_product_id: 'prod_1', platform_fee_bps: 600, active: true,
    created_at: '2026-09-26T00:00:00Z', grants: [{ target: 'sml_group_role', role_ref: 'member' }] }];
  const pool = { query: async (text, values) => (/UPDATE group_plans/.test(text) ? { rows: [{ ...rows[0], active: false }] } : { rows }) };
  const listed = await listGroupPlans(pool, {}, { groupId: 12 });
  assert.equal(listed.plans.length, 1);
  assert.equal(listed.plans[0].grantsRole, 'member');
  assert.equal(listed.plans[0].intervalLabel, 'month');
  const { stripe, stripeCalls } = planFixtures();
  const archived = await archiveGroupPlan(pool, stripe, { groupId: 12, planId: 77 });
  assert.equal(archived.plan.active, false);
  assert.deepEqual(stripeCalls.map((c) => c[0]), ['prices.update', 'products.update']);
  assert.deepEqual(stripeCalls[0].slice(1), ['price_1', { active: false }]);
  const missing = { query: async () => ({ rows: [] }) };
  await assert.rejects(archiveGroupPlan(missing, stripe, { groupId: 12, planId: 5 }), /not found/);
});
