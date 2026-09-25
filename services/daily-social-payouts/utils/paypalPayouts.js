import { randomUUID } from 'node:crypto';
import { centsToUsd } from './payoutPolicy.js';
import { paypalPayoutStatus } from './paypalStatus.js';

function apiBase(mode) {
  return mode === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
}

function moneyValue(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

async function paypalAccessToken(status) {
  const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${apiBase(status.mode)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${credentials}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`PayPal token request failed (${response.status}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  if (!json.access_token) throw new Error('PayPal did not return an access token.');
  return json.access_token;
}

function assertItem({ receiverEmail, amountCents }) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(receiverEmail || ''))) throw new Error('Enter a valid PayPal payout email address.');
  if (Number(amountCents || 0) <= 0) throw new Error('Payout amount must be greater than $0.00.');
}

/**
 * One PayPal Payouts batch with one item per recipient. Every guard the
 * single-recipient path had applies to every item, and a batch with zero
 * valid items is refused rather than silently posted empty.
 */
export async function createPayPalBatchPayout({ items, senderBatchId, dryRunOverride = null }) {
  const status = paypalPayoutStatus();
  const currency = process.env.PAYPAL_PAYOUT_CURRENCY || 'USD';
  const dryRun = dryRunOverride ?? status.dryRun;
  if (!status.credentialsPresent) throw new Error(`PayPal credentials are missing: ${status.missing.join(', ')}`);
  if (!status.payoutsEnabled) throw new Error('PAYPAL_PAYOUTS_ENABLED=1 is required before payout actions can run.');
  if (!Array.isArray(items) || !items.length) throw new Error('A payout batch needs at least one item.');
  if (items.length > 500) throw new Error('A payout batch is limited to 500 items.');
  for (const item of items) assertItem(item);
  const totalCents = items.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
  const batchId = senderBatchId || `sml-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const normalized = items.map((item, index) => ({
    recipient_type: 'EMAIL',
    amount: { value: moneyValue(item.amountCents), currency },
    receiver: item.receiverEmail,
    note: String(item.note || 'Daily Social Payouts approved work payment').slice(0, 1000),
    sender_item_id: String(item.senderItemId || `sml-item-${randomUUID()}`).slice(0, 63),
  }));
  if (dryRun) {
    return {
      dryRun: true,
      batchId: `DRY-RUN-${batchId}`,
      status: 'SIMULATED',
      totalCents,
      amount: centsToUsd(totalCents),
      items: normalized.map((item, index) => ({
        itemId: item.sender_item_id,
        receiverEmail: items[index].receiverEmail,
        amountCents: Number(items[index].amountCents || 0),
        amount: centsToUsd(items[index].amountCents),
      })),
    };
  }
  const token = await paypalAccessToken(status);
  const response = await fetch(`${apiBase(status.mode)}/v1/payments/payouts`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: batchId,
        email_subject: 'Daily Social Payouts payment',
        email_message: 'You received a Daily Social Payouts payment for approved completed work.',
      },
      items: normalized,
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`PayPal payout failed (${response.status}): ${JSON.stringify(json).slice(0, 500)}`);
  }
  return {
    dryRun: false,
    batchId: json.batch_header?.payout_batch_id || batchId,
    status: json.batch_header?.batch_status || 'SUBMITTED',
    totalCents,
    amount: centsToUsd(totalCents),
    items: normalized.map((item, index) => ({
      itemId: item.sender_item_id,
      receiverEmail: items[index].receiverEmail,
      amountCents: Number(items[index].amountCents || 0),
      amount: centsToUsd(items[index].amountCents),
    })),
    raw: json,
  };
}

export async function createPayPalPayout({ receiverEmail, amountCents, note, senderItemId, dryRunOverride = null }) {
  const batch = await createPayPalBatchPayout({
    items: [{ receiverEmail, amountCents, note, senderItemId }],
    dryRunOverride,
  });
  const item = batch.items[0] || {};
  return {
    dryRun: batch.dryRun,
    batchId: batch.batchId,
    itemId: item.itemId || senderItemId || '',
    amount: centsToUsd(amountCents),
    receiverEmail,
    status: batch.status,
    raw: batch.raw,
  };
}
