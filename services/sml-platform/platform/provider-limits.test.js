'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const L = require('./provider-limits');

/* ---------------------------------------------------------------------------
 * Researched constants (DOCS-RESEARCH.json, verified 2026-09-02)
 * ------------------------------------------------------------------------- */

test('Stripe evidence hash has exactly 27 fields split into 18 text and 9 file, disjoint', () => {
  assert.equal(L.STRIPE_EVIDENCE_TEXT_FIELDS.length, 18);
  assert.equal(L.STRIPE_EVIDENCE_FILE_FIELDS.length, 9);
  const all = new Set([...L.STRIPE_EVIDENCE_TEXT_FIELDS, ...L.STRIPE_EVIDENCE_FILE_FIELDS]);
  assert.equal(all.size, 27);
  for (const field of L.STRIPE_EVIDENCE_TEXT_FIELDS) {
    assert.ok(!L.STRIPE_EVIDENCE_FILE_FIELDS.includes(field), `${field} in both sets`);
  }
});

test('Stripe combined text cap is exactly 150,000 characters', () => {
  assert.equal(L.STRIPE_TEXT_COMBINED_CAP, 150000);
});

test('Stripe file rules: pdf/jpeg/png only, 4.5MB combined, <50 pages (19 for Mastercard), one file per field', () => {
  assert.deepEqual([...L.STRIPE_FILE_RULES.types], ['pdf', 'jpeg', 'png']);
  assert.equal(L.STRIPE_FILE_RULES.combinedBytesMax, Math.floor(4.5 * 1024 * 1024));
  assert.equal(L.STRIPE_FILE_RULES.combinedPagesMaxExclusive, 50);
  assert.equal(L.STRIPE_FILE_RULES.mastercardPagesMax, 19);
  assert.equal(L.STRIPE_FILE_RULES.oneFilePerField, true);
});

test('PayPal file rules match the documented constraints exactly', () => {
  assert.deepEqual([...L.PAYPAL_FILE_RULES.types], ['jpg', 'jpeg', 'gif', 'png', 'pdf']);
  assert.equal(L.PAYPAL_FILE_RULES.perFileBytes, 10 * 1024 * 1024);
  assert.equal(L.PAYPAL_FILE_RULES.perRequestBytes, 50 * 1024 * 1024);
  assert.equal(L.PAYPAL_FILE_RULES.notesMax, 2000);
});

test('PayPal evidence type subset only contains documented enum values', () => {
  for (const type of L.PAYPAL_EVIDENCE_TYPES) {
    assert.match(type, /^[A-Z_]+$/);
  }
  for (const required of ['PROOF_OF_FULFILLMENT', 'PROOF_OF_REFUND',
    'PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED', 'OTHER',
    'CANCELLATION_DETAILS', 'BILLING_AGREEMENT']) {
    assert.ok(L.PAYPAL_EVIDENCE_TYPES.includes(required), `missing ${required}`);
  }
});

/* ---------------------------------------------------------------------------
 * Per-reason recommended map
 * ------------------------------------------------------------------------- */

test('subscription_canceled recommends the cancellation_* fields plus customer_communication', () => {
  const fields = L.STRIPE_REASON_FIELD_MAP.subscription_canceled.recommended;
  for (const required of ['cancellation_policy', 'cancellation_policy_disclosure',
    'cancellation_rebuttal', 'customer_communication']) {
    assert.ok(fields.includes(required), `missing ${required}`);
  }
});

test('product_not_received has separate digital and physical variants', () => {
  const entry = L.STRIPE_REASON_FIELD_MAP.product_not_received;
  assert.deepEqual([...entry.digital],
    ['customer_purchase_ip', 'customer_name', 'customer_email_address', 'access_activity_log']);
  assert.ok(entry.physical.includes('shipping_tracking_number'));
  assert.ok(!entry.digital.includes('shipping_tracking_number'));
});

test('fraudulent and unrecognized are treated alike (documented as indistinguishable)', () => {
  assert.deepEqual(L.STRIPE_REASON_FIELD_MAP.fraudulent, L.STRIPE_REASON_FIELD_MAP.unrecognized);
});

test('credit_not_processed recommends refund_* fields; duplicate recommends duplicate_charge_*', () => {
  const credit = L.STRIPE_REASON_FIELD_MAP.credit_not_processed.recommended;
  for (const required of ['refund_policy', 'refund_policy_disclosure', 'refund_refusal_explanation']) {
    assert.ok(credit.includes(required), `missing ${required}`);
  }
  const duplicate = L.STRIPE_REASON_FIELD_MAP.duplicate.recommended;
  for (const required of ['duplicate_charge_id', 'duplicate_charge_documentation', 'duplicate_charge_explanation']) {
    assert.ok(duplicate.includes(required), `missing ${required}`);
  }
});

test('universal background fields are allowed for every reason, and unknown reasons fall back to general', () => {
  for (const reason of ['subscription_canceled', 'fraudulent', 'duplicate', 'general', 'bank_cannot_process']) {
    const allowed = L.stripeAllowedFields(reason);
    for (const field of L.STRIPE_BACKGROUND_FIELDS) {
      assert.ok(allowed.has(field), `${reason} missing background field ${field}`);
    }
  }
  const fallback = L.stripeAllowedFields('bank_cannot_process');
  assert.ok(fallback.has('uncategorized_text'));
  assert.ok(!fallback.has('cancellation_rebuttal'));
});

test('stripeRecommendedFields prefers the digital variant for product_not_received', () => {
  assert.deepEqual(L.stripeRecommendedFields('product_not_received'),
    ['customer_purchase_ip', 'customer_name', 'customer_email_address', 'access_activity_log']);
  assert.ok(L.stripeRecommendedFields('subscription_canceled').includes('cancellation_rebuttal'));
});

/* ---------------------------------------------------------------------------
 * validateStripeEvidence
 * ------------------------------------------------------------------------- */

test('validateStripeEvidence accepts an allowed, in-cap draft', () => {
  const result = L.validateStripeEvidence('subscription_canceled', {
    cancellation_rebuttal: 'The disputed charge preceded the cancellation request.',
    customer_communication: 'file_123'
  }, [{ field: 'customer_communication', fileType: 'pdf', bytes: 1024, pages: 2 }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test('validateStripeEvidence refuses unknown fields', () => {
  const result = L.validateStripeEvidence('general', { made_up_field: 'x' }, []);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.code === 'unknown_field' && v.field === 'made_up_field'));
});

test('validateStripeEvidence refuses fields not allowed for the reason', () => {
  const result = L.validateStripeEvidence('duplicate', {
    cancellation_rebuttal: 'not relevant to a duplicate dispute'
  }, []);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) =>
    v.code === 'field_not_allowed_for_reason' && v.field === 'cancellation_rebuttal'));
});

test('validateStripeEvidence enforces the 150,000 combined text cap', () => {
  const result = L.validateStripeEvidence('general', {
    uncategorized_text: 'a'.repeat(150001)
  }, []);
  assert.ok(result.violations.some((v) => v.code === 'combined_text_over_cap'));
});

test('validateStripeEvidence enforces file type, combined size, page count, and one-file-per-field', () => {
  const result = L.validateStripeEvidence('general', {}, [
    { field: 'uncategorized_file', fileType: 'gif', bytes: 3 * 1024 * 1024, pages: 30 },
    { field: 'uncategorized_file', fileType: 'pdf', bytes: 2 * 1024 * 1024, pages: 25 }
  ]);
  assert.equal(result.ok, false);
  const codes = result.violations.map((v) => v.code);
  assert.ok(codes.includes('file_type_not_allowed'));
  assert.ok(codes.includes('combined_file_size_over_cap'));
  assert.ok(codes.includes('combined_page_count_over_cap'));
  assert.ok(codes.includes('one_file_per_evidence_field'));
});

test('validateStripeEvidence flags the tighter Mastercard page limit as an advisory', () => {
  const result = L.validateStripeEvidence('general', {}, [
    { field: 'uncategorized_file', fileType: 'pdf', bytes: 1024, pages: 25 }
  ]);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => w.code === 'exceeds_mastercard_page_limit'));
});

test('validateStripeEvidence throws TypeError on malformed inputs', () => {
  assert.throws(() => L.validateStripeEvidence('', {}, []), TypeError);
  assert.throws(() => L.validateStripeEvidence('general', null, []), TypeError);
  assert.throws(() => L.validateStripeEvidence('general', [], []), TypeError);
  assert.throws(() => L.validateStripeEvidence('general', {}, 'files'), TypeError);
});

/* ---------------------------------------------------------------------------
 * validatePayPalEvidence
 * ------------------------------------------------------------------------- */

test('validatePayPalEvidence accepts requested types within all caps', () => {
  const result = L.validatePayPalEvidence(
    ['PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED'],
    null,
    [{
      evidenceType: 'PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED',
      notes: 'Access log attached.',
      files: [{ name: 'log.pdf', fileType: 'pdf', bytes: 1024 }]
    }]
  );
  assert.deepEqual(result, { ok: true, violations: [] });
});

test('validatePayPalEvidence refuses types that were not requested', () => {
  const result = L.validatePayPalEvidence(['PROOF_OF_REFUND'], null,
    [{ evidenceType: 'PROOF_OF_FULFILLMENT' }]);
  assert.ok(result.violations.some((v) => v.code === 'evidence_type_not_requested'));
});

test('validatePayPalEvidence refuses evidence types outside the supported subset', () => {
  const result = L.validatePayPalEvidence(null, null, [{ evidenceType: 'POLICE_REPORT' }]);
  assert.ok(result.violations.some((v) => v.code === 'evidence_type_not_supported'));
});

test('validatePayPalEvidence falls back to allowedOptions when nothing was requested', () => {
  const result = L.validatePayPalEvidence([], [{ evidence_type: 'OTHER' }],
    [{ evidenceType: 'PROOF_OF_REFUND' }]);
  assert.ok(result.violations.some((v) => v.code === 'evidence_type_not_requested'));
  const ok = L.validatePayPalEvidence([], [{ evidence_type: 'OTHER' }],
    [{ evidenceType: 'OTHER' }]);
  assert.equal(ok.ok, true);
});

test('validatePayPalEvidence enforces notes cap, per-file <10MB, and 50MB per request', () => {
  const result = L.validatePayPalEvidence(null, null, [
    { evidenceType: 'OTHER', notes: 'a'.repeat(2001) },
    { evidenceType: 'PROOF_OF_REFUND', files: [{ name: 'big.pdf', fileType: 'pdf', bytes: 10 * 1024 * 1024 }] },
    {
      evidenceType: 'PROOF_OF_FULFILLMENT',
      files: [
        { name: 'a.pdf', fileType: 'pdf', bytes: 9 * 1024 * 1024 },
        { name: 'b.pdf', fileType: 'exe', bytes: 9 * 1024 * 1024 },
        { name: 'c.pdf', fileType: 'pdf', bytes: 9 * 1024 * 1024 },
        { name: 'd.pdf', fileType: 'pdf', bytes: 9 * 1024 * 1024 },
        { name: 'e.pdf', fileType: 'pdf', bytes: 9 * 1024 * 1024 }
      ]
    }
  ]);
  const codes = result.violations.map((v) => v.code);
  assert.ok(codes.includes('notes_over_cap'));
  assert.ok(codes.includes('file_over_per_file_cap'));
  assert.ok(codes.includes('file_type_not_allowed'));
  assert.ok(codes.includes('request_over_total_file_cap'));
});

test('validatePayPalEvidence throws TypeError on malformed inputs', () => {
  assert.throws(() => L.validatePayPalEvidence(null, null, null), TypeError);
  assert.throws(() => L.validatePayPalEvidence('PROOF_OF_REFUND', null, []), TypeError);
  assert.throws(() => L.validatePayPalEvidence([{ bogus: true }], null, []), TypeError);
});
