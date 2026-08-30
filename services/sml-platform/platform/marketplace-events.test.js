'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const M = require('./marketplace-events');

function fakeClient(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ text, values });
      return handler ? handler(text, values, calls) : { rowCount: 1, rows: [] };
    }
  };
}

test('paid Loop Bucks checkout credits only the database-owned amount', async () => {
  const db = fakeClient((text) => {
    if (text.startsWith('SELECT * FROM loop_buck_orders')) return { rows: [{
      id: 5, order_key: 'ord_5', user_id: '9', loop_bucks: 1000,
      subtotal_cents: 1000, service_fee_cents: 20, currency: 'usd'
    }] };
    return { rows: [], rowCount: 1 };
  });
  const event = { type: 'checkout.session.completed', created: 1700000000, data: { object: {
    id: 'cs_1', payment_status: 'paid', payment_intent: 'pi_1', currency: 'usd',
    amount_subtotal: 1020, amount_total: 1103, total_details: { amount_tax: 83 },
    metadata: { sml_kind: 'loop_bucks', order_key: 'ord_5', loop_bucks: '999999999' }
  } } };
  assert.equal(await M.applyMarketplaceEvent(db, event), 'processed');
  const queued = db.calls.find((c) => c.text.startsWith('INSERT INTO billing_outbox'));
  const payload = JSON.parse(queued.values[2]);
  assert.equal(payload.loopBucks, 1000);
  assert.equal(payload.userId, '9');
});

test('Loop Bucks fulfillment fails closed when Stripe money differs', async () => {
  const db = fakeClient((text) => text.startsWith('SELECT * FROM loop_buck_orders')
    ? { rows: [{ id: 5, order_key: 'ord_5', user_id: '9', loop_bucks: 1000,
      subtotal_cents: 1000, service_fee_cents: 20, currency: 'usd' }] }
    : { rows: [] });
  const event = { type: 'checkout.session.completed', created: 1700000000, data: { object: {
    id: 'cs_1', payment_status: 'paid', currency: 'usd', amount_subtotal: 1,
    amount_total: 1, total_details: { amount_tax: 0 },
    metadata: { sml_kind: 'loop_bucks', order_key: 'ord_5' }
  } } };
  await assert.rejects(() => M.applyMarketplaceEvent(db, event), /amount does not match/);
  assert.equal(db.calls.some((c) => c.text.startsWith('INSERT INTO billing_outbox')), false);
});

function disputeDb(state) {
  return fakeClient((text) => {
    if (text.startsWith('SELECT ms.*')) return { rows: [{ id: 4, connected_account_id: 'acct_4',
      dispute_debit_consent_at: '2026-08-30T00:00:00Z', currency: 'usd' }] };
    if (text.startsWith('INSERT INTO marketplace_disputes')) return { rows: [{
      stripe_dispute_id: 'dp_1', seller_id: 4, stripe_charge_id: 'ch_1',
      disputed_principal_cents: 10000, platform_dispute_fee_cents: 1250,
      currency: 'usd', state
    }] };
    return { rows: [], rowCount: 1 };
  });
}

test('a new seller dispute queues principal recovery but not the 12.5% fee yet', async () => {
  const db = disputeDb('needs_response');
  const event = { type: 'charge.dispute.created', account: null, data: { object: {
    id: 'dp_1', charge: 'ch_1', amount: 10000, currency: 'usd', status: 'needs_response'
  } } };
  assert.equal(await M.applyMarketplaceEvent(db, event), 'processed');
  assert.ok(db.calls.some((c) => c.values && c.values[0] === 'seller-recover-principal:dp_1'));
  assert.equal(db.calls.some((c) => c.values && c.values[1] === 'dispute-fee:dp_1'), false);
});

test('lost dispute finalizes a separate 12.5% seller fee', async () => {
  const db = disputeDb('lost');
  const event = { type: 'charge.dispute.closed', account: null, data: { object: {
    id: 'dp_1', charge: 'ch_1', amount: 10000, currency: 'usd', status: 'lost'
  } } };
  assert.equal(await M.applyMarketplaceEvent(db, event), 'processed');
  const fee = db.calls.find((c) => c.values && c.values[1] === 'dispute-fee:dp_1');
  assert.equal(fee.values[2], -1250);
  const recovery = db.calls.find((c) => c.values && c.values[0] === 'seller-recover-fee:dp_1');
  assert.equal(JSON.parse(recovery.values[2]).amountCents, 1250);
});

test('won dispute restores principal and never charges the seller fee', async () => {
  const db = disputeDb('won');
  const event = { type: 'charge.dispute.closed', account: null, data: { object: {
    id: 'dp_1', charge: 'ch_1', amount: 10000, currency: 'usd', status: 'won'
  } } };
  assert.equal(await M.applyMarketplaceEvent(db, event), 'processed');
  assert.ok(db.calls.some((c) => c.values && c.values[0] === 'seller-restore:dp_1'));
  assert.equal(db.calls.some((c) => c.values && c.values[1] === 'dispute-fee:dp_1'), false);
});
