'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const W = require('./billing-worker');

test('outbox retry delay is bounded exponential backoff', () => {
  assert.equal(W.retryDelaySeconds(0), 30);
  assert.equal(W.retryDelaySeconds(3), 240);
  assert.equal(W.retryDelaySeconds(99), 3600);
});

test('seller recovery reverses the original transfer before account debit', async () => {
  const calls = [];
  const stripe = {
    charges: {
      retrieve: async () => ({ transfer: 'tr_1' }),
      create: async (params, options) => { calls.push(['debit', params, options]); }
    },
    transfers: {
      retrieve: async () => ({ amount: 9500, amount_reversed: 0 }),
      createReversal: async (id, params, options) => { calls.push(['reverse', id, params, options]); }
    }
  };
  const handle = W.createStripeRecoveryHandler(stripe);
  await handle({ amountCents: 10000, chargeId: 'ch_1', connectedAccountId: 'acct_1',
    currency: 'usd', disputeId: 'dp_1', reason: 'dispute_principal' },
  { source_key: 'seller-recover-principal:dp_1' });
  assert.equal(calls[0][0], 'reverse');
  assert.equal(calls[0][2].amount, 9500);
  assert.equal(calls[1][0], 'debit');
  assert.equal(calls[1][1].amount, 500);
});

test('12.5% dispute fee uses a separate account debit', async () => {
  const calls = [];
  const stripe = {
    charges: { create: async (params) => { calls.push(params); } },
    transfers: {}
  };
  const handle = W.createStripeRecoveryHandler(stripe);
  await handle({ amountCents: 1250, connectedAccountId: 'acct_1', currency: 'usd',
    disputeId: 'dp_1', reason: 'platform_dispute_fee_12_5_percent' },
  { source_key: 'seller-recover-fee:dp_1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].amount, 1250);
  assert.equal(calls[0].source, 'acct_1');
});

test('a won dispute returns funds to the connected seller', async () => {
  const calls = [];
  const stripe = { transfers: { create: async (params, options) => calls.push({ params, options }) } };
  const handle = W.createStripeRestoreHandler(stripe);
  await handle({ amountCents: 10000, connectedAccountId: 'acct_1', currency: 'usd', disputeId: 'dp_1' },
    { source_key: 'seller-restore:dp_1' });
  assert.equal(calls[0].params.destination, 'acct_1');
  assert.equal(calls[0].params.amount, 10000);
});
