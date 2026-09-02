'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildPacketModel, SUPPLEMENTAL_LABEL } = require('./evidence-engine');
/* provider-limits is part of this same package; the engine still receives it
 * by injection (input key `limits`), never by requiring it itself. */
const limits = require('./provider-limits');

const NOW = Date.parse('2026-06-01T00:00:00.000Z');

/* Fresh fixture per call so tests can mutate freely. */
function fixture(overrides = {}) {
  return Object.assign({
    now: NOW,
    limits,
    caseRow: {
      id: 900, provider: 'stripe', provider_dispute_id: 'dp_1',
      reason: 'subscription_canceled', amount_cents: 1999, currency: 'usd',
      due_by: '2026-06-10T23:59:59.000Z', transaction_id: 5, subscription_id: 3,
      identity_id: 7, occurred_at: '2026-05-20T10:00:00.000Z', requested_evidence: []
    },
    subscriptionRow: {
      id: 3, provider: 'stripe', provider_subscription_id: 'sub_1',
      origin: 'explicit_purchase', occurred_at: '2026-01-05T00:00:00.000Z',
      plan_name: 'Loop Pro', plan_description: 'analyst chat access',
      price_cents: 1999, currency: 'usd', billing_interval: 'month',
      trial_start: null, trial_end: null
    },
    transactionRows: [
      { id: 1, kind: 'charge', amount_cents: 1999, currency: 'usd', status: 'succeeded', provider_transaction_id: 'ch_1', occurred_at: '2026-02-15T00:00:00.000Z' },
      { id: 2, kind: 'charge', amount_cents: 1999, currency: 'usd', status: 'succeeded', provider_transaction_id: 'ch_2', occurred_at: '2026-03-15T00:00:00.000Z' },
      { id: 4, kind: 'charge', amount_cents: 1999, currency: 'usd', status: 'succeeded', provider_transaction_id: 'ch_4', occurred_at: '2026-04-15T00:00:00.000Z' },
      { id: 5, kind: 'charge', amount_cents: 1999, currency: 'usd', status: 'succeeded', provider_transaction_id: 'ch_5', occurred_at: '2026-05-15T00:00:00.000Z' }
    ],
    refundRows: [],
    cancellationRows: [],
    consentRows: [
      {
        id: 51, identity_id: 7, terms_version_id: 41,
        control_label: 'I agree to the cancellation policy',
        displayed_price_cents: 1999, displayed_currency: 'usd', displayed_interval: 'month',
        trial_disclosure: null, accepted_at: '2026-01-05T00:00:00.000Z',
        checkout_session_ref: 'cs_1'
      }
    ],
    termsRows: [
      { id: 41, version_label: 'v3', doc_kind: 'cancellation_policy', effective_from: '2025-12-01T00:00:00.000Z' }
    ],
    usageRows: [
      { id: 21, usage_type: 'login', occurred_at: '2026-05-01T09:00:00.000Z' },
      { id: 22, usage_type: 'content_access', occurred_at: '2026-05-02T09:00:00.000Z' },
      { id: 23, usage_type: 'role_present', occurred_at: '2026-05-03T09:00:00.000Z' }
    ],
    entitlementRows: [
      { id: 31, action: 'granted', plan_ref: 'loop-pro', occurred_at: '2026-01-05T00:10:00.000Z' }
    ],
    notificationRows: [
      { id: 61, notice_type: 'renewal', channel: 'email', delivery_status: 'delivered', occurred_at: '2026-05-08T00:00:00.000Z' }
    ],
    upgradeChatRows: [],
    evidenceItems: [
      { id: 11, kind: 'customer_communication', cited_records: [{ table: 'billing_subscriptions', id: 3 }], file_sha256: 'sha-a', file_name: 'comm.pdf', superseded_by: null },
      { id: 12, kind: 'receipt', cited_records: [{ table: 'billing_transactions', id: 1 }, { table: 'billing_transactions', id: 2 }, { table: 'billing_transactions', id: 4 }], file_sha256: 'sha-b', file_name: 'receipts.pdf', superseded_by: null },
      { id: 13, kind: 'usage_export', body_text: 'usage export', cited_records: [{ table: 'service_usage_events', id: 21 }, { table: 'service_usage_events', id: 22 }], superseded_by: null },
      { id: 14, kind: 'entitlement_log', cited_records: [{ table: 'entitlement_events', id: 31 }], superseded_by: null },
      { id: 15, kind: 'policy_capture', cited_records: [{ table: 'terms_versions', id: 41 }], superseded_by: null },
      { id: 16, kind: 'notification_log', cited_records: [{ table: 'notification_delivery_events', id: 61 }], superseded_by: null }
    ]
  }, overrides);
}

function byId(model, id) {
  return model.assertions.find((assertion) => assertion.id === id) || null;
}

/* ---------------------------------------------------------------------------
 * Origin wording matrix (DESIGN §3, §4b(12))
 * ------------------------------------------------------------------------- */

test('origin wording: explicit_purchase says "purchased on" and never mentions a trial', () => {
  const model = buildPacketModel(fixture());
  const origin = byId(model, 'origin');
  assert.ok(origin);
  assert.equal(origin.text, 'The subscription was purchased on 2026-01-05.');
  assert.doesNotMatch(origin.text, /trial/i);
});

test('origin wording: trial_auto_convert with a consent-backed disclosure states disclosed automatic conversion', () => {
  const input = fixture();
  input.subscriptionRow.origin = 'trial_auto_convert';
  input.subscriptionRow.trial_start = '2026-01-05T00:00:00.000Z';
  input.subscriptionRow.trial_end = '2026-01-19T00:00:00.000Z';
  input.consentRows[0].trial_disclosure = '14-day trial, then 19.99 USD/month unless canceled';
  const model = buildPacketModel(input);
  const origin = byId(model, 'origin');
  assert.match(origin.text, /disclosed automatic conversion on 2026-01-19/);
  assert.ok(!model.warnings.some((w) => w.code === 'trial_disclosure_not_provable'));
});

test('trial wording gate: without a disclosure consent, "disclosed" is omitted and a warning is emitted', () => {
  const input = fixture();
  input.subscriptionRow.origin = 'trial_auto_convert';
  input.subscriptionRow.trial_start = '2026-01-05T00:00:00.000Z';
  input.subscriptionRow.trial_end = '2026-01-19T00:00:00.000Z';
  const model = buildPacketModel(input);
  const origin = byId(model, 'origin');
  assert.doesNotMatch(origin.text, /disclosed/);
  assert.match(origin.text, /converted to a paid subscription on 2026-01-19/);
  assert.ok(model.warnings.some((w) => w.code === 'trial_disclosure_not_provable'));
});

test('origin wording: upgrade_chat_import is labeled as billed externally via Upgrade.Chat', () => {
  const input = fixture();
  input.subscriptionRow.origin = 'upgrade_chat_import';
  const model = buildPacketModel(input);
  assert.match(byId(model, 'origin').text, /billed externally via Upgrade\.Chat/);
});

test('origin wording: unknown origin yields neutral minimal wording, an origin_not_provable warning, and is never upgraded', () => {
  const input = fixture();
  input.subscriptionRow.origin = 'unknown';
  const model = buildPacketModel(input);
  const origin = byId(model, 'origin');
  assert.equal(origin.text, 'A subscription record exists since 2026-01-05.');
  assert.doesNotMatch(origin.text, /purchas|trial|convert/i);
  assert.ok(model.warnings.some((w) => w.code === 'origin_not_provable'));
});

/* ---------------------------------------------------------------------------
 * Availability vs usage separation (DESIGN §3)
 * ------------------------------------------------------------------------- */

test('availability vs usage: entitlement rows yield availability assertions, never usage', () => {
  const model = buildPacketModel(fixture());
  const availability = byId(model, 'availability:entitlement:31');
  assert.ok(availability);
  assert.equal(availability.kind, 'availability');
  assert.match(availability.text, /was granted on 2026-01-05/);
});

test('usage assertions come only from authenticated usage kinds (login/content_access/api_action)', () => {
  const model = buildPacketModel(fixture());
  const usage = byId(model, 'usage:events');
  assert.ok(usage);
  assert.equal(usage.kind, 'usage');
  const citedIds = usage.citedRecords.map((rec) => rec.id).sort();
  assert.deepEqual(citedIds, [21, 22]); // role_present (23) is excluded
  assert.match(usage.text, /2 authenticated service usage events \(content_access, login\)/);
});

/* ---------------------------------------------------------------------------
 * Policy gates (DESIGN §3: effective_from <= transaction AND consent)
 * ------------------------------------------------------------------------- */

test('policy predates transaction: policy asserted only when effective_from <= charge and a consent references that version', () => {
  const model = buildPacketModel(fixture());
  const policy = byId(model, 'policy:41');
  assert.ok(policy);
  assert.equal(policy.kind, 'policy');
  assert.match(policy.text, /effective from 2025-12-01/);
  assert.match(policy.text, /accepted on 2026-01-05/);
  assert.ok(!model.warnings.some((w) => w.code === 'policy_not_provable'));
});

test('policy gate: a consent referencing a different terms version emits policy_not_provable and omits the claim', () => {
  const input = fixture();
  input.consentRows[0].terms_version_id = 999;
  const model = buildPacketModel(input);
  assert.equal(byId(model, 'policy:41'), null);
  assert.ok(model.warnings.some((w) => w.code === 'policy_not_provable'));
});

test('policy gate: terms effective after the disputed transaction emits policy_not_provable and omits the claim', () => {
  const input = fixture();
  input.termsRows[0].effective_from = '2026-06-01T00:00:00.000Z';
  const model = buildPacketModel(input);
  assert.equal(byId(model, 'policy:41'), null);
  assert.ok(model.warnings.some((w) => w.code === 'policy_not_provable'));
});

/* ---------------------------------------------------------------------------
 * Prior payments (DESIGN §3: historical fact, count + dates only)
 * ------------------------------------------------------------------------- */

test('prior payments are stated as count and dates only, with no future-authorization implication', () => {
  const model = buildPacketModel(fixture());
  const prior = byId(model, 'prior_payments');
  assert.equal(prior.text, '3 prior payments were completed on 2026-02-15, 2026-03-15, 2026-04-15.');
  assert.doesNotMatch(prior.text, /future|authoriz|agree|consent/i);
  assert.deepEqual(prior.citedRecords.map((rec) => rec.id), [1, 2, 4]);
});

/* ---------------------------------------------------------------------------
 * Upgrade.Chat is supplemental (DESIGN §3)
 * ------------------------------------------------------------------------- */

test('upgrade.chat rows are supplemental: labeled in the timeline and never the basis of an assertion', () => {
  const input = fixture();
  input.upgradeChatRows = [{
    id: 71, record_type: 'order', payload: {}, occurred_at: '2026-01-06T00:00:00.000Z'
  }];
  input.evidenceItems.push({
    id: 17, kind: 'uc_export', cited_records: [{ table: 'upgrade_chat_records', id: 71 }], superseded_by: null
  });
  const model = buildPacketModel(input);
  const timelineEntry = model.timeline.find((entry) =>
    entry.citedIds.some((rec) => rec.table === 'upgrade_chat_records'));
  assert.ok(timelineEntry);
  assert.ok(timelineEntry.label.includes(SUPPLEMENTAL_LABEL));
  for (const assertion of model.assertions) {
    assert.ok(!assertion.citedRecords.some((rec) => rec.table === 'upgrade_chat_records'),
      `assertion ${assertion.id} must not be based on Upgrade.Chat rows`);
  }
});

test('upgrade.chat conflict with processor rows produces a contradiction, not an assertion', () => {
  const input = fixture();
  input.upgradeChatRows = [{
    id: 71, record_type: 'order',
    payload: { cancelled_at: '2026-03-01T00:00:00.000Z' },
    occurred_at: '2026-01-06T00:00:00.000Z'
  }];
  const model = buildPacketModel(input);
  const conflict = model.contradictions.find((c) => c.code === 'upgrade_chat_cancellation_conflict');
  assert.ok(conflict);
  assert.ok(conflict.detail.includes(SUPPLEMENTAL_LABEL));
  assert.ok(!model.assertions.some((a) =>
    a.citedRecords.some((rec) => rec.table === 'upgrade_chat_records')));
});

/* ---------------------------------------------------------------------------
 * Refusal rule: assertions require supporting evidence items
 * ------------------------------------------------------------------------- */

test('every assertion carries at least one evidence item id; unsupported assertions are omitted with unsupported_assertion_omitted', () => {
  const input = fixture();
  /* Drop the item that cites the prior payment transactions. */
  input.evidenceItems = input.evidenceItems.filter((item) => item.id !== 12);
  const model = buildPacketModel(input);
  assert.equal(byId(model, 'prior_payments'), null);
  assert.ok(model.warnings.some((w) =>
    w.code === 'unsupported_assertion_omitted' && w.detail.includes("'prior_payments'")));
  assert.ok(byId(model, 'origin')); // still supported by item 11
  for (const assertion of model.assertions) {
    assert.ok(assertion.evidenceItemIds.length >= 1);
  }
});

test('empty evidence set asserts nothing', () => {
  const model = buildPacketModel(fixture({ evidenceItems: [] }));
  assert.deepEqual(model.assertions, []);
  assert.ok(model.warnings.filter((w) => w.code === 'unsupported_assertion_omitted').length >= 4);
});

test('superseded evidence items do not support assertions', () => {
  const input = fixture();
  const receiptItem = input.evidenceItems.find((item) => item.id === 12);
  receiptItem.superseded_by = 99;
  const model = buildPacketModel(input);
  assert.equal(byId(model, 'prior_payments'), null);
});

/* ---------------------------------------------------------------------------
 * Timeline
 * ------------------------------------------------------------------------- */

test('timeline is chronological and every entry carries citations', () => {
  const model = buildPacketModel(fixture());
  assert.ok(model.timeline.length >= 10);
  for (let i = 1; i < model.timeline.length; i += 1) {
    assert.ok(model.timeline[i - 1].at <= model.timeline[i].at, 'timeline out of order');
  }
  for (const entry of model.timeline) {
    assert.ok(Array.isArray(entry.citedIds) && entry.citedIds.length >= 1);
    assert.ok(entry.citedIds[0].table && entry.citedIds[0].id != null);
  }
});

/* ---------------------------------------------------------------------------
 * Date comparisons: charge vs cancellation request vs effective date
 * ------------------------------------------------------------------------- */

test('date comparison: a charge preceding the cancellation request is stated with both dates', () => {
  const input = fixture();
  input.cancellationRows = [{ id: 81, requested_at: '2026-05-20T12:00:00.000Z', channel: 'dashboard' }];
  input.evidenceItems.push({
    id: 18, kind: 'billing_export',
    cited_records: [{ table: 'billing_transactions', id: 5 }, { table: 'cancellation_requests', id: 81 }],
    superseded_by: null
  });
  const model = buildPacketModel(input);
  const timing = byId(model, 'cancellation_timing');
  assert.equal(timing.text,
    'The disputed charge (2026-05-15) preceded the cancellation request (2026-05-20).');
});

test('date comparison: a charge dated after the cancellation effective date becomes a contradiction, never an assertion', () => {
  const input = fixture();
  input.cancellationRows = [{
    id: 81, requested_at: '2026-04-01T00:00:00.000Z', effective_at: '2026-04-30T00:00:00.000Z', channel: 'email'
  }];
  const model = buildPacketModel(input);
  assert.equal(byId(model, 'cancellation_timing'), null);
  const conflict = model.contradictions.find((c) => c.code === 'charge_after_cancellation_effective');
  assert.ok(conflict);
  assert.match(conflict.detail, /2026-05-15/);
  assert.match(conflict.detail, /2026-04-30/);
});

test('deadline comparison: a due_by in the past yields a past_due warning', () => {
  const fresh = buildPacketModel(fixture());
  assert.ok(!fresh.warnings.some((w) => w.code === 'past_due'));
  const late = buildPacketModel(fixture({ now: Date.parse('2026-06-15T00:00:00.000Z') }));
  assert.ok(late.warnings.some((w) => w.code === 'past_due'));
});

/* ---------------------------------------------------------------------------
 * Stripe evidence draft restrictions
 * ------------------------------------------------------------------------- */

test('stripe evidence draft contains only fields allowed for the reason', () => {
  const input = fixture();
  input.caseRow.reason = 'duplicate';
  const model = buildPacketModel(input);
  assert.ok(model.stripeEvidence);
  const allowed = limits.stripeAllowedFields('duplicate');
  for (const field of Object.keys(model.stripeEvidence.fieldsObj)) {
    assert.ok(allowed.has(field), `field ${field} not allowed for duplicate`);
  }
  /* Cancellation policy data exists in the registries, but the reason
   * restriction refuses the cancellation fields. */
  assert.ok(!('cancellation_rebuttal' in model.stripeEvidence.fieldsObj));
  assert.ok(!('cancellation_policy_disclosure' in model.stripeEvidence.fieldsObj));
  assert.equal(model.paypalEvidence, null);
});

test('stripe duplicate reason identifies the other charge by id, dates, and amounts only', () => {
  const input = fixture();
  input.caseRow.reason = 'duplicate';
  const model = buildPacketModel(input);
  assert.equal(model.stripeEvidence.fieldsObj.duplicate_charge_id, 'ch_1');
  assert.match(model.stripeEvidence.fieldsObj.duplicate_charge_explanation, /ch_1 on 2026-02-15/);
  assert.match(model.stripeEvidence.fieldsObj.duplicate_charge_explanation, /disputed charge on 2026-05-15/);
});

test('access_activity_log is drafted from authenticated usage rows for digital product_not_received', () => {
  const input = fixture();
  input.caseRow.reason = 'product_not_received';
  const model = buildPacketModel(input);
  const log = model.stripeEvidence.fieldsObj.access_activity_log;
  assert.ok(log);
  assert.match(log, /2026-05-01T09:00:00\.000Z login/);
  assert.match(log, /content_access/);
  assert.doesNotMatch(log, /role_present/); // availability kinds never claim usage
});

test('stripe file plan takes one file per evidence field and only allowed fields', () => {
  const input = fixture();
  input.evidenceItems.push({
    id: 19, kind: 'customer_communication', cited_records: [], file_sha256: 'sha-c',
    file_name: 'second.pdf', superseded_by: null
  });
  input.evidenceItems.push({
    id: 20, kind: 'shipping_documentation', cited_records: [], file_sha256: 'sha-d',
    file_name: 'ship.pdf', superseded_by: null
  });
  const model = buildPacketModel(input);
  const fields = model.stripeEvidence.filesPlan.map((f) => f.field).sort();
  assert.deepEqual(fields, ['customer_communication', 'receipt']);
  assert.ok(model.warnings.some((w) => w.code === 'extra_file_for_field_omitted'));
  assert.ok(model.warnings.some((w) => w.code === 'file_field_not_allowed_for_reason'));
});

/* ---------------------------------------------------------------------------
 * §4b(11): customer_purchase_ip gating
 * ------------------------------------------------------------------------- */

test('customer_purchase_ip is emitted only with a checkout-matched consent and a predating privacy policy', () => {
  const input = fixture();
  input.transactionRows[3].checkout_session_ref = 'cs_1';
  input.consentRows[0].purchase_ip = '203.0.113.5';
  input.termsRows.push({
    id: 42, version_label: 'p1', doc_kind: 'privacy_policy', effective_from: '2025-01-01T00:00:00.000Z'
  });
  const model = buildPacketModel(input);
  assert.equal(model.stripeEvidence.fieldsObj.customer_purchase_ip, '203.0.113.5');
  assert.ok(!model.warnings.some((w) => w.code === 'disclosure_not_provable'));
});

test('customer_purchase_ip without a predating privacy policy is omitted with disclosure_not_provable', () => {
  const input = fixture();
  input.transactionRows[3].checkout_session_ref = 'cs_1';
  input.consentRows[0].purchase_ip = '203.0.113.5';
  const model = buildPacketModel(input);
  assert.ok(!('customer_purchase_ip' in model.stripeEvidence.fieldsObj));
  assert.ok(model.warnings.some((w) => w.code === 'disclosure_not_provable'));
});

test("customer_purchase_ip from a different checkout than the disputed transaction's is omitted", () => {
  const input = fixture();
  input.transactionRows[3].checkout_session_ref = 'cs_renewal';
  input.consentRows[0].purchase_ip = '203.0.113.5';
  input.consentRows[0].checkout_session_ref = 'cs_other';
  input.termsRows.push({
    id: 42, version_label: 'p1', doc_kind: 'privacy_policy', effective_from: '2025-01-01T00:00:00.000Z'
  });
  const model = buildPacketModel(input);
  assert.ok(!('customer_purchase_ip' in model.stripeEvidence.fieldsObj));
  assert.ok(model.warnings.some((w) => w.code === 'disclosure_not_provable'));
});

/* ---------------------------------------------------------------------------
 * PayPal evidence draft restrictions
 * ------------------------------------------------------------------------- */

test('paypal evidence is restricted to the requested types', () => {
  const input = fixture();
  input.caseRow.provider = 'paypal';
  input.caseRow.reason = 'CANCELED_RECURRING_BILLING';
  input.caseRow.requested_evidence = ['PROOF_OF_REFUND'];
  input.evidenceItems.push(
    {
      id: 25, kind: 'proof_of_refund', body_text: 'A refund of 19.99 USD was issued on 2026-05-16.',
      cited_records: [{ table: 'refund_events', id: 1 }], file_sha256: 'sha-r', file_name: 'refund.pdf',
      superseded_by: null
    },
    {
      id: 26, kind: 'shipping_export', body_json: { paypal_evidence_type: 'PROOF_OF_FULFILLMENT' },
      cited_records: [], superseded_by: null
    }
  );
  const model = buildPacketModel(input);
  assert.equal(model.stripeEvidence, null);
  assert.equal(model.paypalEvidence.evidences.length, 1);
  const entry = model.paypalEvidence.evidences[0];
  assert.equal(entry.evidence_type, 'PROOF_OF_REFUND');
  assert.deepEqual(entry.evidenceItemIds, [25]);
  assert.equal(entry.documents.length, 1);
  assert.ok(model.warnings.some((w) => w.code === 'evidence_type_not_requested_omitted'));
  assert.deepEqual(model.checklist, [{ kind: 'PROOF_OF_REFUND', state: 'present' }]);
});

/* ---------------------------------------------------------------------------
 * Neutral language + checklist + input validation
 * ------------------------------------------------------------------------- */

test('no template characterizes the customer', () => {
  const forbidden = /\b(?:lying|liar|dishonest|scam|scammer|thief|cheat|fraudulent customer|fraudster)\b/i;
  const inputs = [
    fixture(),
    fixture({ upgradeChatRows: [{ id: 71, record_type: 'order', payload: { cancelled_at: '2026-03-01T00:00:00.000Z' }, occurred_at: '2026-01-06T00:00:00.000Z' }] })
  ];
  const unknown = fixture();
  unknown.subscriptionRow.origin = 'unknown';
  inputs.push(unknown);
  for (const input of inputs) {
    const model = buildPacketModel(input);
    const texts = [
      ...model.assertions.map((a) => a.text),
      ...model.warnings.map((w) => `${w.code} ${w.detail}`),
      ...model.contradictions.map((c) => `${c.code} ${c.detail}`),
      ...model.timeline.map((entry) => entry.label),
      ...Object.values(model.stripeEvidence ? model.stripeEvidence.fieldsObj : {})
    ];
    for (const text of texts) assert.doesNotMatch(String(text), forbidden);
  }
});

test('checklist reflects present/weak/missing per reason via the injected limits', () => {
  const model = buildPacketModel(fixture());
  const states = new Map(model.checklist.map((entry) => [entry.kind, entry.state]));
  assert.equal(states.get('cancellation_rebuttal'), 'present');
  assert.equal(states.get('cancellation_policy_disclosure'), 'present');
  assert.equal(states.get('customer_communication'), 'present'); // file plan
  assert.equal(states.get('customer_name'), 'missing');
  assert.equal(states.get('service_documentation'), 'missing');

  /* A failed proof gate downgrades to weak, not missing. */
  const gated = fixture();
  gated.transactionRows[3].checkout_session_ref = 'cs_1';
  gated.consentRows[0].purchase_ip = '203.0.113.5'; // no privacy policy row
  const gatedModel = buildPacketModel(gated);
  const gatedStates = new Map(gatedModel.checklist.map((entry) => [entry.kind, entry.state]));
  assert.equal(gatedStates.get('customer_purchase_ip'), 'weak');
});

test('malformed input throws TypeError (service maps it to 400)', () => {
  assert.throws(() => buildPacketModel(null), TypeError);
  assert.throws(() => buildPacketModel({ caseRow: {}, limits }), TypeError); // no now
  assert.throws(() => buildPacketModel({ now: NOW, limits }), TypeError); // no caseRow
  assert.throws(() => buildPacketModel({ now: NOW, caseRow: {}, limits }), TypeError); // no provider
  assert.throws(() => buildPacketModel({ now: NOW, caseRow: { provider: 'stripe' } }), TypeError); // no limits
  assert.throws(() => buildPacketModel(fixture({ transactionRows: 'nope' })), TypeError);
});
