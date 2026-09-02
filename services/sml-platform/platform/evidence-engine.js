/* =============================================================================
 * StockMarketLoop — dispute evidence engine (PURE)
 *
 * buildPacketModel() turns the case row plus its registry/evidence rows into a
 * packet model: a chronological cited timeline, checklist, contradictions,
 * warnings, supported assertions, and provider-specific evidence drafts.
 *
 * PURE: no database, no network, no clock — `now` is always a parameter, and
 * the provider limits module is INJECTED (input key `limits`), never required.
 *
 * Truthfulness rules (DESIGN.md §3 and §4b(11)(12)) are implemented here, not
 * in prose:
 *   - origin wording is fixed by billing_subscriptions.origin, including the
 *     neutral 'unknown' wording; origins are never upgraded;
 *   - "disclosed" is only ever said when a customer_consents row proves it;
 *   - availability and usage are separate assertion kinds — "actively used"
 *     comes only from authenticated service_usage_events kinds;
 *   - policy claims require terms effective_from <= transaction time AND a
 *     consent row for this identity referencing that terms version;
 *   - prior payments are stated as historical count + dates only;
 *   - Upgrade.Chat rows are always supplemental: labeled, never the basis of
 *     an assertion, and conflicts become contradictions;
 *   - every assertion must carry >= 1 supporting evidence item id or it is
 *     dropped with an 'unsupported_assertion_omitted' warning;
 *   - no template characterizes the customer.
 * ========================================================================== */

'use strict';

/* "Actively used" may only come from these authenticated usage kinds
 * (DESIGN §3: login / content / api). */
const USAGE_ASSERTION_KINDS = new Set(['login', 'content_access', 'api_action']);

/* Non-authenticated usage kinds evidence availability/delivery, never usage. */
const AVAILABILITY_EVENT_KINDS = new Set([
  'group_access', 'stream_access', 'alert_delivered', 'bot_notification',
  'guild_member', 'role_present'
]);

/* Defensive neutrality guard: no generated text may characterize the
 * customer. Templates below never produce these; this is a tripwire. */
const NON_NEUTRAL = /\b(?:lying|liar|lied|dishonest|scam|scammer|thief|cheat(?:er|ing)?|fraudulent customer|fraudster)\b/i;

const SUPPLEMENTAL_LABEL = 'supplemental (externally billed)';

/* -------------------------------------------------------------------------- */
/* Small pure helpers                                                          */
/* -------------------------------------------------------------------------- */

function toMs(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function isoFull(ms) { return new Date(ms).toISOString(); }
function isoDay(ms) { return new Date(ms).toISOString().slice(0, 10); }

function money(cents, currency) {
  const amount = (Number(cents) / 100).toFixed(2);
  const code = String(currency || '').toUpperCase();
  return code ? `${amount} ${code}` : amount;
}

function cite(table, id) { return { table, id }; }

function sameRecord(a, b) {
  return a && b && a.table === b.table && String(a.id) === String(b.id);
}

function arrayOr(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

/* -------------------------------------------------------------------------- */
/* buildPacketModel                                                            */
/* -------------------------------------------------------------------------- */

function buildPacketModel(input) {
  if (input == null || typeof input !== 'object') {
    throw new TypeError('buildPacketModel requires an input object');
  }
  const { now, caseRow, limits } = input;
  if (!Number.isFinite(now)) throw new TypeError('now must be epoch milliseconds');
  if (caseRow == null || typeof caseRow !== 'object') {
    throw new TypeError('caseRow is required');
  }
  if (typeof caseRow.provider !== 'string' || !caseRow.provider) {
    throw new TypeError('caseRow.provider is required');
  }
  if (limits == null || typeof limits !== 'object') {
    throw new TypeError('limits (injected provider-limits module) is required');
  }

  const evidenceItems = arrayOr(input.evidenceItems, 'evidenceItems')
    .filter((item) => item && item.superseded_by == null);
  const subscriptionRow = input.subscriptionRow || null;
  const transactionRows = arrayOr(input.transactionRows, 'transactionRows');
  const refundRows = arrayOr(input.refundRows, 'refundRows');
  const cancellationRows = arrayOr(input.cancellationRows, 'cancellationRows');
  const consentRows = arrayOr(input.consentRows, 'consentRows');
  const termsRows = arrayOr(input.termsRows, 'termsRows');
  const usageRows = arrayOr(input.usageRows, 'usageRows');
  const entitlementRows = arrayOr(input.entitlementRows, 'entitlementRows');
  const notificationRows = arrayOr(input.notificationRows, 'notificationRows');
  const upgradeChatRows = arrayOr(input.upgradeChatRows, 'upgradeChatRows');

  const warnings = [];
  const contradictions = [];
  const gatedFields = new Set(); // fields with data present but a failed proof gate -> 'weak'

  const disputedTx = transactionRows.find(
    (tx) => String(tx.id) === String(caseRow.transaction_id)
  ) || null;
  const disputedChargeMs = disputedTx ? toMs(disputedTx.occurred_at) : null;

  /* Consents that count for THIS identity (DESIGN §3: a consent row for this
   * identity; rows with a different identity_id never prove anything here). */
  const identityConsents = consentRows.filter((row) =>
    row.identity_id == null || caseRow.identity_id == null ||
    String(row.identity_id) === String(caseRow.identity_id));

  /* ---- deadline comparisons (charge vs policy deadline) ------------------ */
  const dueByMs = toMs(caseRow.due_by);
  if (dueByMs != null && now > dueByMs) {
    warnings.push({
      code: 'past_due',
      detail: `provider response deadline ${isoFull(dueByMs)} has passed`
    });
  }

  /* ---- timeline ---------------------------------------------------------- */
  const timeline = buildTimeline({
    caseRow, subscriptionRow, transactionRows, refundRows, cancellationRows,
    consentRows, entitlementRows, usageRows, notificationRows, upgradeChatRows
  });

  /* ---- policy gates (terms + consent) ------------------------------------ */
  const policy = evaluatePolicies({
    termsRows, identityConsents, disputedChargeMs, warnings
  });

  /* ---- candidate assertions ---------------------------------------------- */
  const candidates = [];
  const originResult = originAssertion({
    subscriptionRow, identityConsents, warnings
  });
  if (originResult) candidates.push(originResult);

  const prior = priorPaymentsAssertion({ transactionRows, disputedTx, disputedChargeMs });
  if (prior) candidates.push(prior);

  const cancelTiming = cancellationTiming({
    cancellationRows, disputedTx, disputedChargeMs, contradictions
  });
  if (cancelTiming) candidates.push(cancelTiming);

  for (const provable of policy.provable) candidates.push(provable.assertion);

  for (const row of entitlementRows) {
    if (row.action !== 'granted' && row.action !== 'present') continue;
    const ms = toMs(row.occurred_at);
    const verb = row.action === 'granted' ? 'was granted' : 'was present';
    candidates.push({
      id: `availability:entitlement:${row.id}`,
      kind: 'availability',
      text: `Service access${row.plan_ref ? ` (${row.plan_ref})` : ''} ${verb} on ${ms != null ? isoDay(ms) : 'an unrecorded date'}.`,
      citedRecords: [cite('entitlement_events', row.id)]
    });
  }

  const availabilityEvents = usageRows.filter((row) => AVAILABILITY_EVENT_KINDS.has(row.usage_type));
  if (availabilityEvents.length > 0) {
    candidates.push(aggregateEventsAssertion(
      'availability:events', 'availability',
      'service availability/delivery events', availabilityEvents
    ));
  }

  const usageEvents = usageRows.filter((row) => USAGE_ASSERTION_KINDS.has(row.usage_type));
  if (usageEvents.length > 0) {
    candidates.push(aggregateEventsAssertion(
      'usage:events', 'usage',
      'authenticated service usage events', usageEvents
    ));
  }

  for (const row of notificationRows) {
    if (row.delivery_status !== 'delivered' && row.delivery_status !== 'sent') continue;
    const ms = toMs(row.occurred_at);
    candidates.push({
      id: `communication:${row.id}`,
      kind: 'communication',
      text: `A ${String(row.notice_type).replace(/_/g, ' ')} notification was ${row.delivery_status} via ${row.channel} on ${ms != null ? isoDay(ms) : 'an unrecorded date'}.`,
      citedRecords: [cite('notification_delivery_events', row.id)]
    });
  }

  /* NOTE: upgradeChatRows deliberately produce NO candidates — Upgrade.Chat
   * records are supplemental and may only appear in the timeline (labeled)
   * and in contradictions (below). */
  detectUpgradeChatConflicts({
    upgradeChatRows, cancellationRows, subscriptionRow, caseRow, contradictions
  });

  /* ---- refusal rule: drop any assertion without a supporting item -------- */
  const assertions = [];
  for (const candidate of candidates) {
    const supportIds = evidenceItems
      .filter((item) => Array.isArray(item.cited_records) &&
        item.cited_records.some((rec) => candidate.citedRecords.some((c) => sameRecord(rec, c))))
      .map((item) => item.id);
    if (supportIds.length === 0) {
      warnings.push({
        code: 'unsupported_assertion_omitted',
        detail: `assertion '${candidate.id}' omitted: no evidence item cites its records`
      });
      continue;
    }
    if (NON_NEUTRAL.test(candidate.text)) {
      warnings.push({
        code: 'non_neutral_text_blocked',
        detail: `assertion '${candidate.id}' omitted: text failed the neutrality check`
      });
      continue;
    }
    assertions.push({
      id: candidate.id,
      text: candidate.text,
      kind: candidate.kind,
      evidenceItemIds: supportIds,
      citedRecords: candidate.citedRecords
    });
  }

  /* ---- provider evidence drafts ------------------------------------------ */
  let stripeEvidence = null;
  let paypalEvidence = null;
  if (caseRow.provider === 'stripe') {
    stripeEvidence = buildStripeEvidence({
      limits, caseRow, subscriptionRow, transactionRows, refundRows,
      cancellationRows, identityConsents, termsRows, policy,
      usageEvents, evidenceItems, disputedTx, disputedChargeMs,
      warnings, gatedFields
    });
  } else if (caseRow.provider === 'paypal') {
    paypalEvidence = buildPayPalEvidence({
      limits, caseRow, evidenceItems, warnings
    });
  }

  /* ---- checklist --------------------------------------------------------- */
  const checklist = buildChecklist({
    limits, caseRow, stripeEvidence, paypalEvidence, gatedFields
  });

  return {
    timeline, checklist, contradictions, warnings, assertions,
    stripeEvidence, paypalEvidence
  };
}

/* -------------------------------------------------------------------------- */
/* Timeline                                                                    */
/* -------------------------------------------------------------------------- */

function buildTimeline(rows) {
  const entries = [];
  const push = (atMs, label, citedIds) => {
    if (atMs == null) return;
    entries.push({ at: isoFull(atMs), label, citedIds });
  };

  const {
    caseRow, subscriptionRow, transactionRows, refundRows, cancellationRows,
    consentRows, entitlementRows, usageRows, notificationRows, upgradeChatRows
  } = rows;

  if (subscriptionRow) {
    push(toMs(subscriptionRow.occurred_at),
      `Subscription record (${subscriptionRow.provider || caseRow.provider} ${subscriptionRow.provider_subscription_id || ''})`.trim(),
      [cite('billing_subscriptions', subscriptionRow.id)]);
    push(toMs(subscriptionRow.trial_start), 'Trial start',
      [cite('billing_subscriptions', subscriptionRow.id)]);
    push(toMs(subscriptionRow.trial_end), 'Trial end',
      [cite('billing_subscriptions', subscriptionRow.id)]);
  }
  for (const tx of transactionRows) {
    push(toMs(tx.occurred_at),
      `Transaction ${tx.kind} of ${money(tx.amount_cents, tx.currency)} (${tx.provider_transaction_id || 'id unrecorded'})`,
      [cite('billing_transactions', tx.id)]);
  }
  for (const refund of refundRows) {
    push(toMs(refund.occurred_at),
      `Refund of ${money(refund.amount_cents, refund.currency)} (${refund.provider_refund_id || 'id unrecorded'})`,
      [cite('refund_events', refund.id)]);
  }
  for (const row of cancellationRows) {
    push(toMs(row.requested_at),
      `Cancellation requested via ${row.channel || 'unrecorded channel'}`,
      [cite('cancellation_requests', row.id)]);
    push(toMs(row.effective_at), 'Cancellation effective',
      [cite('cancellation_requests', row.id)]);
  }
  for (const row of consentRows) {
    push(toMs(row.accepted_at),
      `Checkout consent recorded (control: "${row.control_label || ''}")`,
      [cite('customer_consents', row.id)]);
  }
  for (const row of entitlementRows) {
    push(toMs(row.occurred_at),
      `Entitlement ${row.action}${row.plan_ref ? ` (${row.plan_ref})` : ''}`,
      [cite('entitlement_events', row.id)]);
  }
  for (const row of usageRows) {
    push(toMs(row.occurred_at), `Service event: ${row.usage_type}`,
      [cite('service_usage_events', row.id)]);
  }
  for (const row of notificationRows) {
    push(toMs(row.occurred_at),
      `Notification ${row.notice_type} ${row.delivery_status} via ${row.channel}`,
      [cite('notification_delivery_events', row.id)]);
  }
  for (const row of upgradeChatRows) {
    push(toMs(row.occurred_at),
      `Upgrade.Chat ${row.record_type || 'record'} — ${SUPPLEMENTAL_LABEL}`,
      [cite('upgrade_chat_records', row.id)]);
  }
  push(toMs(caseRow.occurred_at),
    `Dispute opened (${caseRow.provider} ${caseRow.provider_dispute_id}, reason: ${caseRow.reason || 'unrecorded'})`,
    [cite('dispute_cases', caseRow.id)]);

  entries.sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    const ka = `${a.citedIds[0].table}:${a.citedIds[0].id}`;
    const kb = `${b.citedIds[0].table}:${b.citedIds[0].id}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return entries;
}

/* -------------------------------------------------------------------------- */
/* Origin wording matrix (DESIGN §3, §4b(12))                                  */
/* -------------------------------------------------------------------------- */

function originAssertion({ subscriptionRow, identityConsents, warnings }) {
  if (!subscriptionRow) return null;
  const cited = [cite('billing_subscriptions', subscriptionRow.id)];
  const recordMs = toMs(subscriptionRow.occurred_at);
  const trialStartMs = toMs(subscriptionRow.trial_start);
  const trialEndMs = toMs(subscriptionRow.trial_end);

  switch (subscriptionRow.origin) {
    case 'explicit_purchase':
      return {
        id: 'origin', kind: 'billing', citedRecords: cited,
        text: `The subscription was purchased on ${isoDay(recordMs != null ? recordMs : 0)}.`
      };

    case 'trial_auto_convert': {
      const beganDay = trialStartMs != null ? isoDay(trialStartMs)
        : recordMs != null ? isoDay(recordMs) : 'an unrecorded date';
      const convertedDay = trialEndMs != null ? isoDay(trialEndMs) : null;
      /* "disclosed automatic conversion" requires a consent row for this
       * identity carrying trial_disclosure + displayed price/interval. */
      const disclosure = identityConsents.find((row) =>
        typeof row.trial_disclosure === 'string' && row.trial_disclosure.length > 0 &&
        row.displayed_price_cents != null &&
        typeof row.displayed_interval === 'string' && row.displayed_interval.length > 0);
      if (disclosure) {
        return {
          id: 'origin', kind: 'billing',
          citedRecords: [...cited, cite('customer_consents', disclosure.id)],
          text: `The trial began on ${beganDay} with disclosed automatic conversion` +
            `${convertedDay ? ` on ${convertedDay}` : ''}; the subscription converted automatically.`
        };
      }
      warnings.push({
        code: 'trial_disclosure_not_provable',
        detail: 'no consent row carries trial_disclosure with displayed price and interval; "disclosed" wording omitted'
      });
      return {
        id: 'origin', kind: 'billing', citedRecords: cited,
        text: `The trial began on ${beganDay}` +
          `${convertedDay ? `; the subscription converted to a paid subscription on ${convertedDay}` : ''}.`
      };
    }

    case 'admin_created':
      return {
        id: 'origin', kind: 'billing', citedRecords: cited,
        text: `The subscription record was created by site administration on ${recordMs != null ? isoDay(recordMs) : 'an unrecorded date'}.`
      };

    case 'upgrade_chat_import':
      return {
        id: 'origin', kind: 'billing', citedRecords: cited,
        text: `The subscription record was imported; it is billed externally via Upgrade.Chat.`
      };

    default:
      /* 'unknown' (or anything unexpected): neutral minimal wording, never
       * upgraded to a stronger claim. */
      warnings.push({
        code: 'origin_not_provable',
        detail: `subscription origin '${subscriptionRow.origin}' cannot support a purchase or trial claim`
      });
      return {
        id: 'origin', kind: 'billing', citedRecords: cited,
        text: `A subscription record exists since ${recordMs != null ? isoDay(recordMs) : 'an unrecorded date'}.`
      };
  }
}

/* -------------------------------------------------------------------------- */
/* Prior payments — historical fact, count + dates only                        */
/* -------------------------------------------------------------------------- */

function priorPaymentsAssertion({ transactionRows, disputedTx, disputedChargeMs }) {
  const prior = transactionRows.filter((tx) => {
    if (disputedTx && String(tx.id) === String(disputedTx.id)) return false;
    if (tx.kind !== 'charge' && tx.kind !== 'capture') return false;
    if (tx.status === 'failed') return false;
    const ms = toMs(tx.occurred_at);
    if (ms == null) return false;
    return disputedChargeMs == null || ms < disputedChargeMs;
  });
  if (prior.length === 0) return null;
  prior.sort((a, b) => toMs(a.occurred_at) - toMs(b.occurred_at));
  const dates = prior.map((tx) => isoDay(toMs(tx.occurred_at))).join(', ');
  return {
    id: 'prior_payments', kind: 'billing',
    citedRecords: prior.map((tx) => cite('billing_transactions', tx.id)),
    /* Historical statement only — the wording implies nothing about
     * authorization of future charges. */
    text: `${prior.length} prior payment${prior.length === 1 ? ' was' : 's were'} completed on ${dates}.`
  };
}

/* -------------------------------------------------------------------------- */
/* Charge vs cancellation date comparisons                                     */
/* -------------------------------------------------------------------------- */

function cancellationTiming({ cancellationRows, disputedTx, disputedChargeMs, contradictions }) {
  if (cancellationRows.length === 0 || !disputedTx || disputedChargeMs == null) return null;
  const sorted = [...cancellationRows]
    .filter((row) => toMs(row.requested_at) != null)
    .sort((a, b) => toMs(a.requested_at) - toMs(b.requested_at));
  if (sorted.length === 0) return null;
  const first = sorted[0];
  const requestedMs = toMs(first.requested_at);
  const effectiveMs = toMs(first.effective_at);
  const cited = [
    cite('billing_transactions', disputedTx.id),
    cite('cancellation_requests', first.id)
  ];

  if (effectiveMs != null && disputedChargeMs >= effectiveMs) {
    /* A charge dated after the cancellation became effective undermines the
     * case; it is surfaced as a contradiction, never asserted around. */
    contradictions.push({
      code: 'charge_after_cancellation_effective',
      detail: `the disputed charge (${isoDay(disputedChargeMs)}) is dated on or after the cancellation effective date (${isoDay(effectiveMs)})`,
      citedIds: cited
    });
    return null;
  }
  if (disputedChargeMs < requestedMs) {
    return {
      id: 'cancellation_timing', kind: 'billing', citedRecords: cited,
      text: `The disputed charge (${isoDay(disputedChargeMs)}) preceded the cancellation request (${isoDay(requestedMs)}).`
    };
  }
  return {
    id: 'cancellation_timing', kind: 'billing', citedRecords: cited,
    text: `A cancellation was requested on ${isoDay(requestedMs)}` +
      `${effectiveMs != null ? ` with effective date ${isoDay(effectiveMs)}` : ''}; ` +
      `the disputed charge occurred on ${isoDay(disputedChargeMs)}` +
      `${effectiveMs != null ? ', before the effective date' : ''}.`
  };
}

/* -------------------------------------------------------------------------- */
/* Policy gates: effective_from <= transaction AND consent references version  */
/* -------------------------------------------------------------------------- */

function evaluatePolicies({ termsRows, identityConsents, disputedChargeMs, warnings }) {
  const provable = [];
  const failed = [];
  for (const terms of termsRows) {
    if (terms.doc_kind === 'privacy_policy') continue; // used only for IP gating
    const effectiveMs = toMs(terms.effective_from);
    const consent = identityConsents.find((row) =>
      String(row.terms_version_id) === String(terms.id));
    const predates = effectiveMs != null && disputedChargeMs != null &&
      effectiveMs <= disputedChargeMs;
    if (predates && consent) {
      const kindLabel = String(terms.doc_kind || 'terms').replace(/_/g, ' ');
      provable.push({
        terms, consent,
        assertion: {
          id: `policy:${terms.id}`, kind: 'policy',
          citedRecords: [cite('terms_versions', terms.id), cite('customer_consents', consent.id)],
          text: `The ${kindLabel} (version ${terms.version_label}), effective from ${isoDay(effectiveMs)}, ` +
            `was accepted on ${isoDay(toMs(consent.accepted_at))} ` +
            `(control shown: "${consent.control_label || ''}").`
        }
      });
    } else {
      failed.push(terms);
      warnings.push({
        code: 'policy_not_provable',
        detail: `terms version '${terms.version_label}' (${terms.doc_kind || 'terms'}): ` +
          (predates ? 'no consent row for this identity references this version'
            : 'effective_from does not predate the disputed transaction'),
      });
    }
  }
  return { provable, failed };
}

/* -------------------------------------------------------------------------- */
/* Aggregated event assertions                                                 */
/* -------------------------------------------------------------------------- */

function aggregateEventsAssertion(id, kind, noun, rows) {
  const sorted = [...rows]
    .filter((row) => toMs(row.occurred_at) != null)
    .sort((a, b) => toMs(a.occurred_at) - toMs(b.occurred_at));
  const types = [...new Set(sorted.map((row) => row.usage_type))].sort().join(', ');
  const first = sorted.length ? isoDay(toMs(sorted[0].occurred_at)) : null;
  const last = sorted.length ? isoDay(toMs(sorted[sorted.length - 1].occurred_at)) : null;
  const span = sorted.length === 0 ? ''
    : first === last ? ` on ${first}` : ` between ${first} and ${last}`;
  return {
    id, kind,
    citedRecords: rows.map((row) => cite('service_usage_events', row.id)),
    text: `${rows.length} ${noun} (${types}) were recorded${span}.`
  };
}

/* -------------------------------------------------------------------------- */
/* Upgrade.Chat conflicts — contradictions, never assertions                   */
/* -------------------------------------------------------------------------- */

function detectUpgradeChatConflicts({ upgradeChatRows, cancellationRows, subscriptionRow, caseRow, contradictions }) {
  for (const row of upgradeChatRows) {
    const payload = row.payload || {};
    if (payload.cancelled_at && cancellationRows.length === 0) {
      contradictions.push({
        code: 'upgrade_chat_cancellation_conflict',
        detail: `${SUPPLEMENTAL_LABEL} Upgrade.Chat record reports cancelled_at ${payload.cancelled_at}, ` +
          'but no processor cancellation request row exists; processor rows remain authoritative',
        citedIds: [cite('upgrade_chat_records', row.id)]
      });
    }
    if (row.payment_processor && caseRow.provider &&
        String(row.payment_processor).toLowerCase() !== String(caseRow.provider).toLowerCase() &&
        subscriptionRow && row.payment_processor_record_id &&
        String(row.payment_processor_record_id) === String(subscriptionRow.provider_subscription_id)) {
      contradictions.push({
        code: 'upgrade_chat_processor_conflict',
        detail: `${SUPPLEMENTAL_LABEL} Upgrade.Chat record names processor ${row.payment_processor} ` +
          `for a record matched to a ${caseRow.provider} subscription; processor rows remain authoritative`,
        citedIds: [cite('upgrade_chat_records', row.id), cite('billing_subscriptions', subscriptionRow.id)]
      });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Stripe evidence draft — only fields allowed for the reason                  */
/* -------------------------------------------------------------------------- */

function buildStripeEvidence(ctx) {
  const {
    limits, caseRow, subscriptionRow, refundRows, transactionRows,
    identityConsents, termsRows, policy, usageEvents, evidenceItems,
    disputedTx, disputedChargeMs, warnings, gatedFields
  } = ctx;

  const allowed = limits.stripeAllowedFields(caseRow.reason || 'general');
  const fieldsObj = {};
  const put = (field, value) => {
    /* Restriction is enforced HERE: a field outside the reason's allowed set
     * is refused regardless of what the registries could support. */
    if (!allowed.has(field)) return false;
    if (typeof value !== 'string' || value.length === 0) return false;
    fieldsObj[field] = value;
    return true;
  };

  if (subscriptionRow) {
    const parts = [subscriptionRow.plan_name, subscriptionRow.plan_description].filter(Boolean);
    const price = subscriptionRow.price_cents != null
      ? ` (${money(subscriptionRow.price_cents, subscriptionRow.currency)}${subscriptionRow.billing_interval ? ` per ${subscriptionRow.billing_interval}` : ''})`
      : '';
    if (parts.length) put('product_description', `Subscription: ${parts.join(' — ')}${price}`);
  }

  if (disputedChargeMs != null) put('service_date', isoDay(disputedChargeMs));

  if (usageEvents.length > 0) {
    const lines = [...usageEvents]
      .filter((row) => toMs(row.occurred_at) != null)
      .sort((a, b) => toMs(a.occurred_at) - toMs(b.occurred_at))
      .map((row) => `${isoFull(toMs(row.occurred_at))} ${row.usage_type}${row.entitlement_ref ? ` ${row.entitlement_ref}` : ''}`);
    put('access_activity_log', lines.join('\n'));
  }

  /* §4b(11): customer_purchase_ip only from the consent row belonging to the
   * disputed transaction's checkout, and only when a privacy_policy terms
   * version predates its collection. */
  const checkoutRef = disputedTx ? (disputedTx.checkout_session_ref || null) : null;
  const ipConsent = identityConsents.find((row) =>
    typeof row.purchase_ip === 'string' && row.purchase_ip.length > 0 &&
    checkoutRef != null && row.checkout_session_ref != null &&
    String(row.checkout_session_ref) === String(checkoutRef));
  const anyIpConsent = identityConsents.find((row) =>
    typeof row.purchase_ip === 'string' && row.purchase_ip.length > 0);
  if (ipConsent) {
    const privacy = termsRows.find((terms) => terms.doc_kind === 'privacy_policy' &&
      toMs(terms.effective_from) != null &&
      toMs(ipConsent.accepted_at) != null &&
      toMs(terms.effective_from) <= toMs(ipConsent.accepted_at));
    if (privacy) {
      put('customer_purchase_ip', ipConsent.purchase_ip);
    } else {
      gatedFields.add('customer_purchase_ip');
      warnings.push({
        code: 'disclosure_not_provable',
        detail: 'customer_purchase_ip omitted: no privacy_policy terms version predates its collection'
      });
    }
  } else if (anyIpConsent) {
    gatedFields.add('customer_purchase_ip');
    warnings.push({
      code: 'disclosure_not_provable',
      detail: "customer_purchase_ip omitted: the recorded IP does not belong to the disputed transaction's checkout"
    });
  }

  /* Cancellation-policy disclosure only when the policy gate proved it. */
  const cancellationPolicy = policy.provable.find((p) => p.terms.doc_kind === 'cancellation_policy');
  if (cancellationPolicy) {
    put('cancellation_policy_disclosure',
      `The cancellation policy (version ${cancellationPolicy.terms.version_label}, effective ` +
      `${isoDay(toMs(cancellationPolicy.terms.effective_from))}) was displayed at checkout and accepted on ` +
      `${isoDay(toMs(cancellationPolicy.consent.accepted_at))} (control shown: "${cancellationPolicy.consent.control_label || ''}").`);
  } else if (termsRows.some((terms) => terms.doc_kind === 'cancellation_policy')) {
    gatedFields.add('cancellation_policy_disclosure');
  }
  const refundPolicy = policy.provable.find((p) => p.terms.doc_kind === 'refund_policy');
  if (refundPolicy) {
    put('refund_policy_disclosure',
      `The refund policy (version ${refundPolicy.terms.version_label}, effective ` +
      `${isoDay(toMs(refundPolicy.terms.effective_from))}) was displayed at checkout and accepted on ` +
      `${isoDay(toMs(refundPolicy.consent.accepted_at))} (control shown: "${refundPolicy.consent.control_label || ''}").`);
  } else if (termsRows.some((terms) => terms.doc_kind === 'refund_policy')) {
    gatedFields.add('refund_policy_disclosure');
  }

  /* Cancellation rebuttal: dates only, scoped to what the records contain. */
  if (disputedChargeMs != null) {
    const requests = ctx.cancellationRows
      .filter((row) => toMs(row.requested_at) != null)
      .sort((a, b) => toMs(a.requested_at) - toMs(b.requested_at));
    if (requests.length === 0) {
      put('cancellation_rebuttal',
        `The records available contain no cancellation request dated before the disputed charge on ${isoDay(disputedChargeMs)}.`);
    } else if (disputedChargeMs < toMs(requests[0].requested_at)) {
      put('cancellation_rebuttal',
        `The disputed charge (${isoDay(disputedChargeMs)}) preceded the cancellation request (${isoDay(toMs(requests[0].requested_at))}).`);
    }
  }

  /* Refund already issued (credit_not_processed): factual note. */
  if (refundRows.length > 0) {
    const refund = refundRows[0];
    const ms = toMs(refund.occurred_at);
    put('uncategorized_text',
      `A refund of ${money(refund.amount_cents, refund.currency)} was issued` +
      `${ms != null ? ` on ${isoDay(ms)}` : ''} (provider refund ${refund.provider_refund_id || 'id unrecorded'}).`);
  }

  /* Duplicate reason: identify the other charge by id and dates. */
  if (caseRow.reason === 'duplicate' && disputedTx) {
    const other = transactionRows.find((tx) =>
      String(tx.id) !== String(disputedTx.id) &&
      (tx.kind === 'charge' || tx.kind === 'capture') && tx.provider_transaction_id);
    if (other) {
      put('duplicate_charge_id', String(other.provider_transaction_id));
      const otherMs = toMs(other.occurred_at);
      put('duplicate_charge_explanation',
        `Two separate charges are recorded: ${other.provider_transaction_id} ` +
        `${otherMs != null ? `on ${isoDay(otherMs)} ` : ''}for ${money(other.amount_cents, other.currency)}, and the disputed charge ` +
        `${disputedChargeMs != null ? `on ${isoDay(disputedChargeMs)} ` : ''}for ${money(disputedTx.amount_cents, disputedTx.currency)}.`);
    }
  }

  /* File plan: evidence items whose kind names an allowed Stripe file field.
   * One file per evidence field (STRIPE_FILE_RULES.oneFilePerField). */
  const filesPlan = [];
  const usedFields = new Set();
  const fileItems = evidenceItems
    .filter((item) => item.file_sha256 && limits.STRIPE_EVIDENCE_FILE_FIELDS.includes(item.kind))
    .sort((a, b) => Number(a.id) - Number(b.id));
  for (const item of fileItems) {
    if (!allowed.has(item.kind)) {
      warnings.push({
        code: 'file_field_not_allowed_for_reason',
        detail: `evidence item ${item.id} (${item.kind}) omitted from the Stripe file plan for reason '${caseRow.reason}'`
      });
      continue;
    }
    if (usedFields.has(item.kind)) {
      warnings.push({
        code: 'extra_file_for_field_omitted',
        detail: `evidence item ${item.id} omitted: field '${item.kind}' already has a file (one file per evidence type)`
      });
      continue;
    }
    usedFields.add(item.kind);
    filesPlan.push({
      field: item.kind,
      evidenceItemId: item.id,
      fileName: item.file_name || null,
      fileSha256: item.file_sha256
    });
  }

  return { fieldsObj, filesPlan };
}

/* -------------------------------------------------------------------------- */
/* PayPal evidence draft — only requested/allowed types                        */
/* -------------------------------------------------------------------------- */

function paypalTypeOf(item) {
  if (item.body_json && typeof item.body_json.paypal_evidence_type === 'string') {
    return item.body_json.paypal_evidence_type;
  }
  return String(item.kind || '').toUpperCase();
}

function buildPayPalEvidence({ limits, caseRow, evidenceItems, warnings }) {
  const requested = (Array.isArray(caseRow.requested_evidence) ? caseRow.requested_evidence : [])
    .map((entry) => (typeof entry === 'string' ? entry : entry && entry.evidence_type))
    .filter(Boolean);
  const permitted = requested.length > 0
    ? new Set(requested)
    : new Set(limits.PAYPAL_EVIDENCE_TYPES);

  const byType = new Map();
  for (const item of evidenceItems) {
    const type = paypalTypeOf(item);
    if (!limits.PAYPAL_EVIDENCE_TYPES.includes(type)) continue;
    if (!permitted.has(type)) {
      warnings.push({
        code: 'evidence_type_not_requested_omitted',
        detail: `evidence item ${item.id} (${type}) omitted: not among the types requested/allowed on this dispute`
      });
      continue;
    }
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(item);
  }

  const evidences = [...byType.keys()].sort().map((type) => {
    const items = byType.get(type).sort((a, b) => Number(a.id) - Number(b.id));
    const notesSource = items.find((item) => typeof item.body_text === 'string' && item.body_text.length > 0);
    const notes = notesSource
      ? notesSource.body_text.slice(0, limits.PAYPAL_FILE_RULES.notesMax)
      : undefined;
    const entry = {
      evidence_type: type,
      evidenceItemIds: items.map((item) => item.id),
      documents: items
        .filter((item) => item.file_sha256)
        .map((item) => ({ name: item.file_name || `evidence-${item.id}`, fileSha256: item.file_sha256 }))
    };
    if (notes) entry.notes = notes;
    return entry;
  });

  return { evidences };
}

/* -------------------------------------------------------------------------- */
/* Checklist                                                                   */
/* -------------------------------------------------------------------------- */

function buildChecklist({ limits, caseRow, stripeEvidence, paypalEvidence, gatedFields }) {
  const checklist = [];
  if (caseRow.provider === 'stripe' && stripeEvidence) {
    const kinds = [...new Set([
      ...limits.stripeRecommendedFields(caseRow.reason || 'general', 'digital'),
      ...limits.STRIPE_BACKGROUND_FIELDS
    ])];
    const fileFields = new Set(stripeEvidence.filesPlan.map((f) => f.field));
    for (const kind of kinds) {
      const state = Object.prototype.hasOwnProperty.call(stripeEvidence.fieldsObj, kind) || fileFields.has(kind)
        ? 'present'
        : gatedFields.has(kind) ? 'weak' : 'missing';
      checklist.push({ kind, state });
    }
  } else if (caseRow.provider === 'paypal' && paypalEvidence) {
    const requested = (Array.isArray(caseRow.requested_evidence) ? caseRow.requested_evidence : [])
      .map((entry) => (typeof entry === 'string' ? entry : entry && entry.evidence_type))
      .filter(Boolean);
    const kinds = requested.length > 0 ? requested : [...limits.PAYPAL_EVIDENCE_TYPES];
    const present = new Set(paypalEvidence.evidences.map((entry) => entry.evidence_type));
    for (const kind of kinds) {
      checklist.push({ kind, state: present.has(kind) ? 'present' : 'missing' });
    }
  }
  return checklist;
}

module.exports = {
  buildPacketModel,
  USAGE_ASSERTION_KINDS,
  AVAILABILITY_EVENT_KINDS,
  SUPPLEMENTAL_LABEL
};
