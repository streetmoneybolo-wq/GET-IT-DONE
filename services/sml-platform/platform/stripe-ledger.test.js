'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createStripeLedger, deriveOrigin } = require('./stripe-ledger');

const NOW = 1_756_900_000_000;
const T0 = 1_756_000_000; // unix seconds used inside Stripe objects

/* ---------------------------------------------------------------------------
 * In-memory fakes. The pool answers the exact SQL shapes the ledger issues;
 * the store records every appended row per table; the graph links identities
 * only through the trusted keys the ledger passes it.
 * ------------------------------------------------------------------------- */

function fakeDb({ engineSubscriptions = [] } = {}) {
  const tables = {
    billing_events: [], billing_subscriptions: [], billing_transactions: [],
    refund_events: [], cancellation_requests: [], entitlement_events: []
  };
  const stripeEvents = [];
  let nextId = 100;
  const calls = [];

  function client() {
    return {
      async query(sql, values = []) {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        calls.push(text);
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (text.startsWith('SELECT id FROM billing_events WHERE provider')) {
          const row = tables.billing_events.find((r) => r.provider_event_id === values[0]);
          return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
        }
        if (text.startsWith('SELECT user_id FROM subscriptions WHERE membership_checkout_key')) {
          const row = engineSubscriptions.find((r) => r.membership_checkout_key === values[0]);
          return { rows: row ? [{ user_id: row.user_id }] : [], rowCount: row ? 1 : 0 };
        }
        if (text.startsWith('SELECT user_id FROM subscriptions WHERE stripe_customer_id')) {
          const row = engineSubscriptions.find((r) => r.stripe_customer_id === values[0]);
          return { rows: row ? [{ user_id: row.user_id }] : [], rowCount: row ? 1 : 0 };
        }
        if (text.startsWith('SELECT id, origin, user_id, group_id FROM subscriptions WHERE stripe_subscription_id')) {
          const row = engineSubscriptions.find((r) => r.stripe_subscription_id === values[0]);
          return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        }
        if (text.startsWith('SELECT id, identity_id FROM billing_subscriptions WHERE provider')) {
          const row = tables.billing_subscriptions.find((r) => r.provider_subscription_id === values[0]);
          return { rows: row ? [{ id: row.id, identity_id: row.identity_id }] : [], rowCount: row ? 1 : 0 };
        }
        if (text.startsWith('SELECT id FROM billing_transactions WHERE provider')) {
          const row = tables.billing_transactions.find((r) => r.provider_transaction_id === values[0] && r.kind === values[1]);
          return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
        }
        if (text.startsWith('SELECT id, identity_id FROM billing_transactions WHERE provider')) {
          const row = tables.billing_transactions.find((r) => r.provider_transaction_id === values[0] && r.kind === 'charge');
          return { rows: row ? [{ id: row.id, identity_id: row.identity_id }] : [], rowCount: row ? 1 : 0 };
        }
        if (text.startsWith('SELECT id FROM refund_events WHERE provider')) {
          const row = tables.refund_events.find((r) => r.provider_refund_id === values[0]);
          return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
        }
        if (text.startsWith('SELECT e.event_id, e.event_type, e.event_created_at, e.payload FROM stripe_events e')) {
          const pending = stripeEvents.filter((e) => !tables.billing_events.some((b) => b.provider_event_id === e.event_id));
          return { rows: pending.slice(0, Number(values[0])), rowCount: pending.length };
        }
        throw new Error(`unexpected SQL: ${text.slice(0, 80)}`);
      },
      release() {}
    };
  }

  const store = {
    async appendRow(_client, { table, fields }) {
      const id = nextId++;
      tables[table].push({ id, ...fields });
      return { id, integrityHash: `h${id}` };
    },
    async appendChained(_client, { table, scopeKey, fields }) {
      const id = nextId++;
      tables[table].push({ id, scopeKey, ...fields });
      return { id, integrityHash: `h${id}` };
    }
  };

  const identities = new Map(); // `${provider}:${refType}:${value}` -> identity id
  const links = [];
  const graph = {
    async findByRef(_client, provider, refType, refValue) {
      const id = identities.get(`${provider}:${refType}:${refValue}`);
      return id ? { id, verification: 'verified' } : null;
    },
    async linkVerified(_client, input) {
      assert.equal(input.email_candidate, undefined, 'the ledger must never link through email');
      links.push(input);
      if (input.refValue === 'cus_conflict') throw new TypeError('identity_conflict');
      const key = `${input.provider}:${input.refType}:${input.refValue}`;
      if (!identities.has(key)) identities.set(key, 1000 + identities.size);
      return identities.get(key);
    }
  };

  return {
    tables, stripeEvents, calls, links, identities, store, graph,
    pool: { async connect() { return client(); }, async query(sql, values) { return client().query(sql, values); } }
  };
}

function eventRow(id, type, object, extra = {}) {
  const payload = { id, type, created: T0, data: { object, ...(extra.previous ? { previous_attributes: extra.previous } : {}) }, ...(extra.account ? { account: extra.account } : {}) };
  return { event_id: id, event_type: type, event_created_at: new Date(T0 * 1000).toISOString(), payload };
}

function subscriptionObject(overrides = {}) {
  return {
    id: 'sub_1', customer: 'cus_1', status: 'active', created: T0 - 86_400,
    current_period_end: T0 + 30 * 86_400, cancel_at_period_end: false,
    metadata: { subscription_key: 'mk_1' },
    items: { data: [{ price: { nickname: 'Gold', unit_amount: 1999, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } } }] },
    ...overrides
  };
}

function ledgerFor(db) {
  return createStripeLedger({ pool: db.pool, store: db.store, graph: db.graph, now: () => NOW, logger: () => {} });
}

/* ---------------------------------------------------------------------------
 * Origin wording is derived from facts only
 * ------------------------------------------------------------------------- */

test('origin: our checkout without trial is explicit_purchase; with trial is trial_auto_convert', () => {
  const object = subscriptionObject();
  assert.equal(deriveOrigin({ object, engineRow: { origin: 'sml_checkout' } }).origin, 'explicit_purchase');
  const trial = subscriptionObject({ trial_start: T0, trial_end: T0 + 7 * 86_400 });
  assert.equal(deriveOrigin({ object: trial, engineRow: { origin: 'sml_checkout' } }).origin, 'trial_auto_convert');
});

test('origin: a migration checkout is an explicit purchase even though Stripe deferred the first charge with a trial', () => {
  const object = subscriptionObject({ trial_start: T0, trial_end: T0 + 20 * 86_400 });
  const result = deriveOrigin({ object, engineRow: { origin: 'migrated' } });
  assert.equal(result.origin, 'explicit_purchase');
  assert.match(result.note, /migration/);
});

test('origin: manual_comp maps to admin_created; no trusted marker stays unknown', () => {
  assert.equal(deriveOrigin({ object: subscriptionObject(), engineRow: { origin: 'manual_comp' } }).origin, 'admin_created');
  assert.equal(deriveOrigin({ object: subscriptionObject({ metadata: {} }), engineRow: null }).origin, 'unknown');
  assert.equal(deriveOrigin({ object: subscriptionObject(), engineRow: null }).origin, 'unknown');
  assert.equal(deriveOrigin({ object: subscriptionObject({ metadata: { sml_origin: 'admin' } }), engineRow: null }).origin, 'admin_created');
});

/* ---------------------------------------------------------------------------
 * Subscription registry + identity linking through trusted keys only
 * ------------------------------------------------------------------------- */

test('subscription.created registers the subscription once, links the identity through the checkout key, and grants entitlement', async () => {
  const db = fakeDb({ engineSubscriptions: [{ id: 5, origin: 'sml_checkout', user_id: 42, group_id: 9, membership_checkout_key: 'mk_1', stripe_subscription_id: 'sub_1' }] });
  const ledger = ledgerFor(db);
  const result = await ledger.applyStripeEvent(eventRow('evt_1', 'customer.subscription.created', subscriptionObject()));
  assert.equal(result.status, 'applied');
  assert.equal(db.tables.billing_subscriptions.length, 1);
  const registry = db.tables.billing_subscriptions[0];
  assert.equal(registry.origin, 'explicit_purchase');
  assert.equal(registry.plan_name, 'Gold');
  assert.equal(registry.price_cents, 1999);
  assert.equal(registry.billing_interval, 'month');
  assert.equal(registry.engine_subscription_id, 5);
  assert.equal(registry.identity_id, 1000);
  assert.equal(db.links[0].via, 'stripe_checkout_key:mk_1');
  assert.equal(db.links[0].sml_user_id, 42);
  assert.equal(db.tables.entitlement_events.length, 1);
  assert.equal(db.tables.entitlement_events[0].action, 'granted');
  assert.equal(db.tables.entitlement_events[0].group_id, 9);
  assert.equal(db.tables.billing_events.length, 1);
  assert.equal(db.tables.billing_events[0].status, 'applied');
  assert.equal(db.tables.billing_events[0].scopeKey, 'stripe');
});

test('replaying the same event is a no-op duplicate, and out-of-order updated/created never duplicates the registry row', async () => {
  const db = fakeDb();
  const ledger = ledgerFor(db);
  const updated = eventRow('evt_upd', 'customer.subscription.updated', subscriptionObject({ metadata: {} }), { previous: { status: 'trialing' } });
  const created = eventRow('evt_cre', 'customer.subscription.created', subscriptionObject({ metadata: {} }));
  await ledger.applyStripeEvent(updated);
  await ledger.applyStripeEvent(created);
  const replay = await ledger.applyStripeEvent(updated);
  assert.equal(replay.status, 'duplicate');
  assert.equal(db.tables.billing_subscriptions.length, 1);
  assert.equal(db.tables.billing_subscriptions[0].origin, 'unknown');
  assert.equal(db.tables.billing_events.length, 2);
});

test('a checkout session the platform created links its client_reference_id; a foreign session does not', async () => {
  const db = fakeDb();
  const ledger = ledgerFor(db);
  await ledger.applyStripeEvent(eventRow('evt_cs1', 'checkout.session.completed', {
    id: 'cs_1', customer: 'cus_9', client_reference_id: '77', metadata: { sml_kind: 'loop_bucks' }
  }));
  assert.equal(db.links.length, 1);
  assert.equal(db.links[0].sml_user_id, 77);
  assert.equal(db.links[0].refValue, 'cus_9');
  await ledger.applyStripeEvent(eventRow('evt_cs2', 'checkout.session.completed', {
    id: 'cs_2', customer: 'cus_10', client_reference_id: '78', metadata: {}
  }));
  assert.equal(db.links.length, 1, 'a session without the platform marker must not create a verified link');
  assert.equal(db.tables.billing_events[1].identity_id, null);
});

test('an identity conflict is recorded in provenance and never throws or merges', async () => {
  const db = fakeDb({ engineSubscriptions: [{ id: 1, origin: 'sml_checkout', user_id: 1, group_id: 1, stripe_customer_id: 'cus_conflict' }] });
  const ledger = ledgerFor(db);
  const result = await ledger.applyStripeEvent(eventRow('evt_c', 'charge.succeeded', { id: 'ch_c', customer: 'cus_conflict', amount: 500, currency: 'usd', status: 'succeeded', created: T0 }));
  assert.equal(result.status, 'applied');
  assert.equal(db.tables.billing_events[0].provenance.identity_conflict, true);
  assert.equal(db.tables.billing_transactions[0].identity_id, null);
});

/* ---------------------------------------------------------------------------
 * Transactions, refunds, cancellations
 * ------------------------------------------------------------------------- */

test('invoice.paid and charge.succeeded for the same charge produce exactly one transaction keyed by the charge id', async () => {
  const db = fakeDb();
  const ledger = ledgerFor(db);
  await ledger.applyStripeEvent(eventRow('evt_i', 'invoice.paid', {
    id: 'in_1', charge: 'ch_1', customer: 'cus_1', subscription: 'sub_1', amount_paid: 1999, currency: 'usd',
    status_transitions: { paid_at: T0 - 10 }, created: T0 - 20
  }));
  await ledger.applyStripeEvent(eventRow('evt_ch', 'charge.succeeded', {
    id: 'ch_1', customer: 'cus_1', amount: 1999, currency: 'usd', status: 'succeeded', created: T0 - 10
  }));
  assert.equal(db.tables.billing_transactions.length, 1);
  const tx = db.tables.billing_transactions[0];
  assert.equal(tx.provider_transaction_id, 'ch_1');
  assert.equal(tx.status, 'succeeded');
  assert.equal(tx.occurred_at, new Date((T0 - 10) * 1000).toISOString());
  assert.equal(db.tables.billing_events[1].transaction_id, tx.id);
});

test('a failed invoice attempt is recorded as a failed charge without a charge id and never counts as a payment', async () => {
  const db = fakeDb();
  const ledger = ledgerFor(db);
  await ledger.applyStripeEvent(eventRow('evt_f', 'invoice.payment_failed', {
    id: 'in_2', charge: null, customer: 'cus_1', amount_due: 1999, currency: 'usd', attempt_count: 2, created: T0
  }));
  const tx = db.tables.billing_transactions[0];
  assert.equal(tx.status, 'failed');
  assert.equal(tx.provider_transaction_id, 'in_2:failed:2');
});

test('charge.refunded records each refund once and links it to the charge transaction', async () => {
  const db = fakeDb();
  const ledger = ledgerFor(db);
  await ledger.applyStripeEvent(eventRow('evt_ch', 'charge.succeeded', { id: 'ch_r', customer: 'cus_1', amount: 1000, currency: 'usd', status: 'succeeded', created: T0 }));
  const refunded = { id: 'ch_r', customer: 'cus_1', amount: 1000, currency: 'usd', status: 'succeeded', created: T0,
    refunds: { data: [{ id: 're_1', amount: 1000, currency: 'usd', reason: 'requested_by_customer', status: 'succeeded', created: T0 + 60 }] } };
  await ledger.applyStripeEvent(eventRow('evt_rf', 'charge.refunded', refunded));
  await ledger.applyStripeEvent(eventRow('evt_rf2', 'refund.updated', { id: 're_1', charge: 'ch_r', amount: 1000, currency: 'usd', status: 'succeeded', created: T0 + 60 }));
  assert.equal(db.tables.refund_events.length, 1);
  assert.equal(db.tables.refund_events[0].transaction_id, db.tables.billing_transactions[0].id);
  assert.equal(db.tables.billing_transactions.length, 1);
});

test('cancel_at_period_end records a cancellation request effective at period end; deletion records the terminal cancellation and revokes', async () => {
  const db = fakeDb();
  const ledger = ledgerFor(db);
  await ledger.applyStripeEvent(eventRow('evt_1', 'customer.subscription.created', subscriptionObject({ metadata: {} })));
  await ledger.applyStripeEvent(eventRow('evt_2', 'customer.subscription.updated',
    subscriptionObject({ metadata: {}, cancel_at_period_end: true, canceled_at: T0 + 100, cancellation_details: { reason: 'cancellation_requested' } }),
    { previous: { cancel_at_period_end: false } }));
  /* An unrelated update while cancel_at_period_end stays true adds nothing. */
  await ledger.applyStripeEvent(eventRow('evt_3', 'customer.subscription.updated',
    subscriptionObject({ metadata: {}, cancel_at_period_end: true, canceled_at: T0 + 100 }),
    { previous: { metadata: {} } }));
  await ledger.applyStripeEvent(eventRow('evt_4', 'customer.subscription.deleted',
    subscriptionObject({ metadata: {}, status: 'canceled', canceled_at: T0 + 100, ended_at: T0 + 30 * 86_400 })));
  assert.equal(db.tables.cancellation_requests.length, 2);
  assert.equal(db.tables.cancellation_requests[0].requested_at, new Date((T0 + 100) * 1000).toISOString());
  assert.equal(db.tables.cancellation_requests[0].effective_at, new Date((T0 + 30 * 86_400) * 1000).toISOString());
  assert.equal(db.tables.cancellation_requests[0].actor, 'cancellation_requested');
  const actions = db.tables.entitlement_events.map((row) => row.action);
  assert.deepEqual(actions, ['granted', 'revoked']);
});

test('dispute events link to the charge transaction; unrelated event types are recorded as ignored', async () => {
  const db = fakeDb();
  const ledger = ledgerFor(db);
  await ledger.applyStripeEvent(eventRow('evt_ch', 'charge.succeeded', { id: 'ch_d', customer: 'cus_1', amount: 1000, currency: 'usd', status: 'succeeded', created: T0 }));
  await ledger.applyStripeEvent(eventRow('evt_dp', 'charge.dispute.created', { id: 'dp_1', charge: 'ch_d', amount: 1000, currency: 'usd', reason: 'fraudulent', status: 'needs_response' }));
  const other = await ledger.applyStripeEvent(eventRow('evt_x', 'customer.created', { id: 'cus_new', email: 'someone@example.com' }));
  assert.equal(db.tables.billing_events[1].transaction_id, db.tables.billing_transactions[0].id);
  assert.equal(other.status, 'ignored');
  assert.equal(db.tables.billing_events[2].status, 'ignored');
  assert.equal(db.links.length, 0, 'customer objects carrying an email never link an identity');
});

test('the catch-up sweep applies pending stripe_events rows once and reports counts', async () => {
  const db = fakeDb();
  db.stripeEvents.push(
    eventRow('evt_s1', 'charge.succeeded', { id: 'ch_s', customer: 'cus_1', amount: 100, currency: 'usd', status: 'succeeded', created: T0 }),
    eventRow('evt_s2', 'product.updated', { id: 'prod_1' }),
    { event_id: 'evt_bad', event_type: 'charge.succeeded', event_created_at: null, payload: 'not json' }
  );
  const ledger = ledgerFor(db);
  const first = await ledger.sweep(10);
  assert.deepEqual({ scanned: first.scanned, applied: first.applied, ignored: first.ignored, failed: first.failed }, { scanned: 3, applied: 1, ignored: 1, failed: 1 });
  const second = await ledger.sweep(10);
  assert.equal(second.scanned, 1, 'only the unreadable row remains pending');
  assert.equal(second.failed, 1);
});

test('the ledger never emits log lines containing payloads, emails, or customer identifiers', async () => {
  const lines = [];
  const db = fakeDb();
  db.stripeEvents.push({ event_id: 'evt_bad', event_type: 'charge.succeeded', event_created_at: null, payload: { id: 'evt_bad', type: 'charge.succeeded', data: { object: { id: 'ch', customer: 'cus_secret', receipt_email: 'leak@example.com' } } } });
  const ledger = createStripeLedger({ pool: db.pool, store: db.store, graph: db.graph, now: () => NOW, logger: (level, event, fields) => lines.push(JSON.stringify({ level, event, fields: { ...fields, error: fields.error && fields.error.message } })) });
  await ledger.sweep(5);
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /leak@example\.com|cus_secret/);
});
