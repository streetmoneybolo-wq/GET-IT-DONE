/* =============================================================================
 * StockMarketLoop — provider evidence limits (pure data + validators)
 *
 * Encodes the researched, officially documented evidence constraints for
 * Stripe and PayPal disputes. No I/O, no clock, no dependencies. Every
 * constant below carries the source URL it was verified against
 * (research date 2026-09-02, full citations in DOCS-RESEARCH.json).
 *
 * Validators return { ok, violations[] } (plus advisory warnings[]);
 * malformed *inputs* throw TypeError per the service convention
 * (TypeError -> HTTP 400 in the effectful shells).
 * ========================================================================== */

'use strict';

/* -------------------------------------------------------------------------- */
/* Stripe: the 27 evidence-hash fields, split text vs file                     */
/* Source: https://docs.stripe.com/api/disputes/object (field list)            */
/*         https://docs.stripe.com/disputes/api (text fields take strings,     */
/*         file fields take File IDs uploaded with purpose=dispute_evidence)   */
/* -------------------------------------------------------------------------- */

const STRIPE_EVIDENCE_TEXT_FIELDS = Object.freeze([
  'access_activity_log',
  'billing_address',
  'cancellation_policy_disclosure',
  'cancellation_rebuttal',
  'customer_email_address',
  'customer_name',
  'customer_purchase_ip',
  'duplicate_charge_explanation',
  'duplicate_charge_id',
  'product_description',
  'refund_policy_disclosure',
  'refund_refusal_explanation',
  'service_date',
  'shipping_address',
  'shipping_carrier',
  'shipping_date',
  'shipping_tracking_number',
  'uncategorized_text'
]);

const STRIPE_EVIDENCE_FILE_FIELDS = Object.freeze([
  'cancellation_policy',
  'customer_communication',
  'customer_signature',
  'duplicate_charge_documentation',
  'receipt',
  'refund_policy',
  'service_documentation',
  'shipping_documentation',
  'uncategorized_file'
]);

const STRIPE_TEXT_SET = new Set(STRIPE_EVIDENCE_TEXT_FIELDS);
const STRIPE_FILE_SET = new Set(STRIPE_EVIDENCE_FILE_FIELDS);
const STRIPE_ALL_SET = new Set([...STRIPE_EVIDENCE_TEXT_FIELDS, ...STRIPE_EVIDENCE_FILE_FIELDS]);

/* "The combined character count of all fields is limited to 150,000."
 * Source: https://docs.stripe.com/api/disputes/update */
const STRIPE_TEXT_COMBINED_CAP = 150000;

/* Evidence file rules:
 * "Only PDF, JPEG, or PNG file types are accepted; The combined file size
 *  can't be more than 4.5MB; The combined page count must be less than
 *  50 pages" and "4.5 MB for all networks, 19 pages for Mastercard";
 * "you can only submit one piece of evidence per type".
 * Source: https://docs.stripe.com/disputes/best-practices
 * Uploads: multipart POST https://files.stripe.com/v1/files with
 * purpose=dispute_evidence. Source: https://docs.stripe.com/file-upload */
const STRIPE_FILE_RULES = Object.freeze({
  types: Object.freeze(['pdf', 'jpeg', 'png']),
  combinedBytesMax: Math.floor(4.5 * 1024 * 1024), // 4.5MB combined
  combinedPagesMaxExclusive: 50,                   // "less than 50 pages"
  mastercardPagesMax: 19,                          // "19 pages for Mastercard"
  oneFilePerField: true
});

/* -------------------------------------------------------------------------- */
/* Stripe: per-reason recommended evidence fields                              */
/* Source: https://docs.stripe.com/disputes/categories                         */
/* (fraudulent and unrecognized are documented as "effectively                 */
/*  indistinguishable" and list the same field sets)                           */
/* -------------------------------------------------------------------------- */

const PNR_DIGITAL = Object.freeze([
  'customer_purchase_ip', 'customer_name', 'customer_email_address', 'access_activity_log'
]);
const PNR_PHYSICAL = Object.freeze([
  'customer_communication', 'customer_signature', 'shipping_address',
  'shipping_documentation', 'shipping_date', 'shipping_carrier', 'shipping_tracking_number'
]);
const PNR_OFFLINE = Object.freeze(['service_date', 'service_documentation', 'customer_signature']);

const STRIPE_REASON_FIELD_MAP = Object.freeze({
  subscription_canceled: Object.freeze({
    recommended: Object.freeze([
      'cancellation_policy', 'cancellation_policy_disclosure', 'cancellation_rebuttal',
      'customer_communication', 'service_date', 'service_documentation',
      'uncategorized_text', 'uncategorized_file'
    ])
  }),
  product_not_received: Object.freeze({
    digital: PNR_DIGITAL, physical: PNR_PHYSICAL, offline: PNR_OFFLINE
  }),
  fraudulent: Object.freeze({
    digital: PNR_DIGITAL, physical: PNR_PHYSICAL,
    offline: Object.freeze(['customer_communication', 'customer_signature', 'service_date', 'service_documentation'])
  }),
  unrecognized: Object.freeze({
    digital: PNR_DIGITAL, physical: PNR_PHYSICAL,
    offline: Object.freeze(['customer_communication', 'customer_signature', 'service_date', 'service_documentation'])
  }),
  credit_not_processed: Object.freeze({
    recommended: Object.freeze([
      'refund_policy', 'refund_policy_disclosure', 'refund_refusal_explanation',
      'cancellation_policy', 'cancellation_policy_disclosure', 'cancellation_rebuttal',
      'customer_communication', 'uncategorized_text', 'uncategorized_file'
    ])
  }),
  duplicate: Object.freeze({
    recommended: Object.freeze([
      'duplicate_charge_id', 'duplicate_charge_documentation', 'duplicate_charge_explanation',
      'customer_communication', 'receipt'
    ])
  }),
  general: Object.freeze({
    recommended: Object.freeze(['uncategorized_text', 'uncategorized_file'])
  })
});

/* Background evidence recommended for ALL dispute reasons.
 * Source: https://docs.stripe.com/disputes/best-practices */
const STRIPE_BACKGROUND_FIELDS = Object.freeze([
  'billing_address', 'customer_name', 'customer_email_address', 'customer_purchase_ip',
  'customer_signature', 'customer_communication', 'receipt', 'product_description'
]);

/**
 * Fields the packet is permitted to populate for a given reason: the
 * per-reason recommended set (union of all channel variants) plus the
 * universal background fields. Unknown reasons fall back to the 'general'
 * treatment (background + uncategorized_*).
 */
function stripeAllowedFields(reason) {
  if (typeof reason !== 'string' || !reason) {
    throw new TypeError('reason must be a non-empty string');
  }
  const entry = STRIPE_REASON_FIELD_MAP[reason] || STRIPE_REASON_FIELD_MAP.general;
  const allowed = new Set(STRIPE_BACKGROUND_FIELDS);
  for (const list of Object.values(entry)) {
    for (const field of list) allowed.add(field);
  }
  return allowed;
}

/**
 * The reason's recommended fields for a delivery channel (SML sells digital
 * services, so callers default to 'digital'); falls back to the reason's
 * flat `recommended` list, then to the 'general' treatment.
 */
function stripeRecommendedFields(reason, channel = 'digital') {
  if (typeof reason !== 'string' || !reason) {
    throw new TypeError('reason must be a non-empty string');
  }
  const entry = STRIPE_REASON_FIELD_MAP[reason] || STRIPE_REASON_FIELD_MAP.general;
  if (entry[channel]) return [...entry[channel]];
  if (entry.recommended) return [...entry.recommended];
  const first = Object.values(entry)[0];
  return first ? [...first] : [];
}

/* -------------------------------------------------------------------------- */
/* PayPal                                                                      */
/* -------------------------------------------------------------------------- */

/* The subset of the 76-value evidence_type enum this platform actually
 * submits. Every value below is verbatim from PayPal's official OpenAPI spec:
 * https://raw.githubusercontent.com/paypal/paypal-rest-api-specifications/main/openapi/customer_disputes_v1.json
 * (PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED is the documented digital-goods
 *  type; CANCELLATION_DETAILS and BILLING_AGREEMENT are the documented
 *  cancellation/billing types; PROOF_OF_REFUND_OUTSIDE_PAYPAL covers refunds
 *  issued off-platform.) */
const PAYPAL_EVIDENCE_TYPES = Object.freeze([
  'PROOF_OF_FULFILLMENT',
  'PROOF_OF_REFUND',
  'PROOF_OF_REFUND_OUTSIDE_PAYPAL',
  'PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED',
  'CANCELLATION_DETAILS',
  'BILLING_AGREEMENT',
  'OTHER'
]);

/* File/notes rules for provide-evidence:
 * "supported file types are JPG, JPEG, GIF, PNG, and PDF"; "Individual files
 *  must be smaller than 10 MB"; "The party can upload up to 50 MB of files
 *  per request". Source:
 * https://developer.paypal.com/limited-release/commerce-platform/manage-risks-liabilities/disputes-chargebacks/integration-guide/
 * notes: 1-2000 chars per the OpenAPI spec (customer_disputes_v1.json). */
const PAYPAL_FILE_RULES = Object.freeze({
  types: Object.freeze(['jpg', 'jpeg', 'gif', 'png', 'pdf']),
  perFileBytes: 10 * 1024 * 1024,
  perRequestBytes: 50 * 1024 * 1024,
  notesMax: 2000
});

/* -------------------------------------------------------------------------- */
/* Validators                                                                  */
/* -------------------------------------------------------------------------- */

function assertPlainObject(value, name) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

/**
 * Validate a Stripe evidence draft against the researched constraints.
 *
 * fieldsObj: { evidenceField: string } — text fields carry the text itself,
 *            file fields carry a File ID placeholder (upload is P5's job).
 * files:     [{ field, fileType, bytes, pages? }] — the planned uploads.
 *
 * Returns { ok, violations: [{code, field?, ...}], warnings: [...] }.
 * `warnings` carries advisories that are not hard failures (Mastercard's
 * tighter 19-page limit, which depends on the card network of the charge).
 */
function validateStripeEvidence(reason, fieldsObj, files = []) {
  if (typeof reason !== 'string' || !reason) {
    throw new TypeError('reason must be a non-empty string');
  }
  assertPlainObject(fieldsObj, 'fieldsObj');
  if (!Array.isArray(files)) throw new TypeError('files must be an array');

  const allowed = stripeAllowedFields(reason);
  const violations = [];
  const warnings = [];

  let textTotal = 0;
  for (const [field, value] of Object.entries(fieldsObj)) {
    if (!STRIPE_ALL_SET.has(field)) {
      violations.push({ code: 'unknown_field', field });
      continue;
    }
    if (!allowed.has(field)) {
      violations.push({ code: 'field_not_allowed_for_reason', field, reason });
    }
    if (typeof value !== 'string') {
      violations.push({ code: 'field_value_not_string', field });
      continue;
    }
    if (STRIPE_TEXT_SET.has(field)) textTotal += value.length;
  }
  if (textTotal > STRIPE_TEXT_COMBINED_CAP) {
    violations.push({
      code: 'combined_text_over_cap',
      limit: STRIPE_TEXT_COMBINED_CAP,
      actual: textTotal
    });
  }

  const seenFileFields = new Set();
  let combinedBytes = 0;
  let combinedPages = 0;
  for (const file of files) {
    assertPlainObject(file, 'files[] entry');
    const field = file.field;
    if (!STRIPE_FILE_SET.has(field)) {
      violations.push({ code: 'not_a_file_field', field });
    } else if (!allowed.has(field)) {
      violations.push({ code: 'field_not_allowed_for_reason', field, reason });
    }
    if (seenFileFields.has(field)) {
      violations.push({ code: 'one_file_per_evidence_field', field });
    }
    seenFileFields.add(field);
    const type = String(file.fileType || '').toLowerCase();
    if (!STRIPE_FILE_RULES.types.includes(type)) {
      violations.push({ code: 'file_type_not_allowed', field, fileType: type });
    }
    if (!Number.isFinite(file.bytes) || file.bytes < 0) {
      violations.push({ code: 'file_bytes_invalid', field });
    } else {
      combinedBytes += file.bytes;
    }
    if (file.pages != null) combinedPages += file.pages;
  }
  if (combinedBytes > STRIPE_FILE_RULES.combinedBytesMax) {
    violations.push({
      code: 'combined_file_size_over_cap',
      limit: STRIPE_FILE_RULES.combinedBytesMax,
      actual: combinedBytes
    });
  }
  if (combinedPages >= STRIPE_FILE_RULES.combinedPagesMaxExclusive) {
    violations.push({
      code: 'combined_page_count_over_cap',
      limitExclusive: STRIPE_FILE_RULES.combinedPagesMaxExclusive,
      actual: combinedPages
    });
  } else if (combinedPages > STRIPE_FILE_RULES.mastercardPagesMax) {
    warnings.push({
      code: 'exceeds_mastercard_page_limit',
      limit: STRIPE_FILE_RULES.mastercardPagesMax,
      actual: combinedPages
    });
  }

  return { ok: violations.length === 0, violations, warnings };
}

function normalizeTypeList(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new TypeError('evidence type list must be an array');
  return list.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object' && typeof entry.evidence_type === 'string') {
      return entry.evidence_type;
    }
    throw new TypeError('evidence type entries must be strings or {evidence_type}');
  });
}

/**
 * Validate a PayPal evidence draft.
 *
 * requestedTypes: evidence types PayPal marked source=REQUESTED_FROM_SELLER
 *                 on the live dispute (authoritative when non-empty).
 * allowedOptions: types permitted by the dispute's allowed response options /
 *                 HATEOAS discovery (used when nothing was explicitly
 *                 requested). Never assumed per lifecycle stage.
 * items:          [{ evidenceType|evidence_type, notes?, files?: [{name, fileType, bytes}] }]
 */
function validatePayPalEvidence(requestedTypes, allowedOptions, items) {
  const requested = normalizeTypeList(requestedTypes);
  const allowed = normalizeTypeList(allowedOptions);
  if (!Array.isArray(items)) throw new TypeError('items must be an array');

  const permitted = requested.length > 0 ? new Set(requested)
    : allowed.length > 0 ? new Set(allowed)
      : new Set(PAYPAL_EVIDENCE_TYPES);
  const violations = [];
  let totalBytes = 0;

  for (const item of items) {
    assertPlainObject(item, 'items[] entry');
    const type = item.evidenceType || item.evidence_type;
    if (typeof type !== 'string' || !PAYPAL_EVIDENCE_TYPES.includes(type)) {
      violations.push({ code: 'evidence_type_not_supported', evidenceType: type });
    } else if (!permitted.has(type)) {
      violations.push({ code: 'evidence_type_not_requested', evidenceType: type });
    }
    if (item.notes != null) {
      if (typeof item.notes !== 'string') {
        violations.push({ code: 'notes_not_string', evidenceType: type });
      } else if (item.notes.length < 1 || item.notes.length > PAYPAL_FILE_RULES.notesMax) {
        violations.push({
          code: 'notes_over_cap', evidenceType: type,
          limit: PAYPAL_FILE_RULES.notesMax, actual: item.notes.length
        });
      }
    }
    const itemFiles = item.files == null ? [] : item.files;
    if (!Array.isArray(itemFiles)) throw new TypeError('item files must be an array');
    for (const file of itemFiles) {
      assertPlainObject(file, 'item files[] entry');
      const fileType = String(file.fileType || '').toLowerCase();
      if (!PAYPAL_FILE_RULES.types.includes(fileType)) {
        violations.push({ code: 'file_type_not_allowed', evidenceType: type, fileType });
      }
      if (!Number.isFinite(file.bytes) || file.bytes < 0) {
        violations.push({ code: 'file_bytes_invalid', evidenceType: type });
      } else {
        /* "Individual files must be smaller than 10 MB" — strict. */
        if (file.bytes >= PAYPAL_FILE_RULES.perFileBytes) {
          violations.push({
            code: 'file_over_per_file_cap', evidenceType: type,
            limitExclusive: PAYPAL_FILE_RULES.perFileBytes, actual: file.bytes
          });
        }
        totalBytes += file.bytes;
      }
    }
  }
  if (totalBytes > PAYPAL_FILE_RULES.perRequestBytes) {
    violations.push({
      code: 'request_over_total_file_cap',
      limit: PAYPAL_FILE_RULES.perRequestBytes,
      actual: totalBytes
    });
  }

  return { ok: violations.length === 0, violations };
}

module.exports = {
  STRIPE_EVIDENCE_TEXT_FIELDS,
  STRIPE_EVIDENCE_FILE_FIELDS,
  STRIPE_TEXT_COMBINED_CAP,
  STRIPE_FILE_RULES,
  STRIPE_REASON_FIELD_MAP,
  STRIPE_BACKGROUND_FIELDS,
  stripeAllowedFields,
  stripeRecommendedFields,
  PAYPAL_EVIDENCE_TYPES,
  PAYPAL_FILE_RULES,
  validateStripeEvidence,
  validatePayPalEvidence
};
