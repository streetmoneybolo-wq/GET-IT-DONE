'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeEmail, createEmailCipher, renewalFromUpgradeChatOrder, upgradeChatContact,
  stripeContact, createResendSender, maskEmail } = require('./member-email');

const KEY = 'test-only-member-email-key-that-is-long-enough-123456';

test('member emails normalize, encrypt, fingerprint, and mask without plaintext storage', () => {
  assert.equal(normalizeEmail('  Member@Example.COM '), 'member@example.com');
  assert.equal(normalizeEmail('not-an-email'), null);
  const cipher = createEmailCipher({ encryptionKey: KEY, hashKey: KEY + '-lookup' });
  const encrypted = cipher.encrypt('member@example.com');
  assert.ok(Buffer.isBuffer(encrypted));
  assert.equal(encrypted.includes(Buffer.from('member@example.com')), false);
  assert.equal(cipher.decrypt(encrypted), 'member@example.com');
  assert.match(cipher.hash('member@example.com'), /^[a-f0-9]{64}$/);
  assert.equal(maskEmail('member@example.com'), 'm***@example.com');
});

test('Upgrade.Chat authenticated order maps email, Discord id, order id, and renewal', () => {
  const order = { uuid: 'order-1', purchased_at: '2026-09-01T12:00:00Z', is_subscription: true,
    user: { email: 'Buyer@Example.com', discord_id: '123456789' },
    order_items: [{ interval: 'month', interval_count: 1 }] };
  assert.equal(renewalFromUpgradeChatOrder(order), '2026-10-01T12:00:00.000Z');
  assert.deepEqual(upgradeChatContact(order), { email: 'buyer@example.com', source: 'upgrade_chat',
    sourceCustomerRef: 'order-1', discordUserId: '123456789', renewalAt: '2026-10-01T12:00:00.000Z' });
  assert.equal(upgradeChatContact({ uuid: 'order-2', user: { discord_id: '1' } }), null);
});

test('Stripe contact mapping uses collected billing email and immutable customer id', () => {
  const contact = stripeContact({ id: 'evt_1', data: { object: { customer: 'cus_1',
    customer_details: { email: 'StripeBuyer@Example.com' }, metadata: { discord_user_id: '444' },
    current_period_end: 1_800_000_000 } } });
  assert.equal(contact.email, 'stripebuyer@example.com');
  assert.equal(contact.sourceCustomerRef, 'cus_1');
  assert.equal(contact.discordUserId, '444');
  assert.equal(contact.renewalAt, new Date(1_800_000_000_000).toISOString());
});

test('Resend sender is fail-closed and sends only server-side fields', async () => {
  assert.equal(createResendSender({}).configured, false);
  const calls = [];
  const sender = createResendSender({ apiKey: 'secret', from: 'SML <members@stockmarketloop.com>',
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, async json() { return { id: 'email_1' }; } }; } });
  const result = await sender.send({ to: 'member@example.com', subject: 'Renewal', html: '<p>Notice</p>', idempotencyKey: 'renewal:1' });
  assert.deepEqual(result, { id: 'email_1' });
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(JSON.parse(calls[0].options.body).to[0], 'member@example.com');
});
