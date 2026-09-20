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

export async function createPayPalPayout({ receiverEmail, amountCents, note, senderItemId, dryRunOverride = null }) {
  const status = paypalPayoutStatus();
  const currency = process.env.PAYPAL_PAYOUT_CURRENCY || 'USD';
  const dryRun = dryRunOverride ?? status.dryRun;
  if (!status.credentialsPresent) throw new Error(`PayPal credentials are missing: ${status.missing.join(', ')}`);
  if (!status.payoutsEnabled) throw new Error('PAYPAL_PAYOUTS_ENABLED=1 is required before payout actions can run.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(receiverEmail || ''))) throw new Error('Enter a valid PayPal payout email address.');
  if (Number(amountCents || 0) <= 0) throw new Error('Payout amount must be greater than $0.00.');
  const senderBatchId = `sml-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const itemId = senderItemId || `sml-item-${randomUUID()}`;
  if (dryRun) {
    return {
      dryRun: true,
      batchId: `DRY-RUN-${senderBatchId}`,
      itemId,
      amount: centsToUsd(amountCents),
      receiverEmail,
      status: 'SIMULATED',
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
        sender_batch_id: senderBatchId,
        email_subject: 'Daily Social Payouts payment',
        email_message: 'You received a Daily Social Payouts payment for approved completed work.',
      },
      items: [{
        recipient_type: 'EMAIL',
        amount: { value: moneyValue(amountCents), currency },
        receiver: receiverEmail,
        note: String(note || 'Daily Social Payouts approved work payment').slice(0, 1000),
        sender_item_id: itemId,
      }],
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`PayPal payout failed (${response.status}): ${JSON.stringify(json).slice(0, 500)}`);
  }
  return {
    dryRun: false,
    batchId: json.batch_header?.payout_batch_id || senderBatchId,
    itemId,
    amount: centsToUsd(amountCents),
    receiverEmail,
    status: json.batch_header?.batch_status || 'SUBMITTED',
    raw: json,
  };
}
