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
