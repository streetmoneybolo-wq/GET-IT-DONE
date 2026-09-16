'use strict';

/* =============================================================================
 * corporate-runtime — wires the corporate-accounts modules into the API and
 * worker.
 *
 * DISABLED UNLESS EXPLICITLY ENABLED. Like the dispute runtime, every surface
 * is absent until SML_CORPORATE_ENABLED=1, a verification secret, and the
 * evidence encryption key (the ad ledger is a chained evidence table) are all
 * configured. The API answers 503 integration_unconfigured until then.
 *
 * MONEY IS VERIFIED AGAINST STRIPE, NEVER TAKEN FROM THE REQUEST. These routes
 * are HMAC-gated admin calls, but a signed request is still only a claim that a
 * payment happened. Every fee, ad purchase and refund is re-read from Stripe:
 * status, currency and amount must match before a row is written. A
 * PaymentIntent can back exactly one record — a fee cannot also be booked as ad
 * spend, and an ad charge cannot also count as a fee.
 *
 * Payment COLLECTION (invoices, payment links, checkout) is deliberately not
 * here: at $10,000+ these are B2B invoiced deals. The operator collects in
 * Stripe, then records the PaymentIntent through these routes.
 * ========================================================================== */

const { createEvidenceStore } = require('./evidence-store');
const { createCorporateAccountService, WELL_KNOWN_PATH } = require('./corporate-accounts');
const { createCorporateBillingService } = require('./corporate-billing');
const { createCorporatePromoService } = require('./corporate-promo');
const { buildProjection, createProjectionPublisher } = require('./corporate-projection');
const onboarding = require('./corporate-onboarding');

/** Errors that are a legitimate refusal (409), not a malfunction (503). */
const CONFLICT_CODES = Object.freeze(new Set([
  'cap_exceeded', 'price_changed', 'payment_not_succeeded', 'payment_currency_mismatch',
  'payment_amount_mismatch', 'payment_already_recorded', 'refund_not_succeeded',
  'refund_exceeds_charge', 'refund_already_recorded', 'charge_not_recorded',
  'not_found', 'not_active', 'spend_not_found', 'spend_mismatch', 'spend_not_a_purchase',
  'already_promoted', 'not_cancellable'
]));

function invalid(message) { return new TypeError(message); }

function conflict(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function requireId(value, name) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw invalid(`${name} must be a positive integer`);
  return id;
}

function requireStripeId(value, prefix, name) {
  const id = String(value == null ? '' : value).trim();
  if (!new RegExp(`^${prefix}_[A-Za-z0-9]{8,}$`).test(id)) throw invalid(`${name} must be a Stripe ${prefix}_ id`);
  return id;
}

/**
 * Proportional split of a partial refund across list price and discount.
 *
 * A purchase of gross g with discount d charged net n = g - d. Refunding r of
 * that n refunds r/n of the discount too, rounded DOWN so a refund never
 * returns more discount headroom than it consumed. The ledger's CHECK
 * (net = gross - discount, discount between gross and 0) holds by construction,
 * and a full refund (r = n) reverses the original row exactly.
 */
function refundSplit({ refundCents, grossCents, discountCents, netCents }) {
  const r = Number(refundCents);
  const g = Number(grossCents);
  const d = Number(discountCents);
  const n = Number(netCents);
  if (![r, g, d, n].every(Number.isSafeInteger) || r <= 0 || n <= 0) throw invalid('refund split needs positive integer cents');
  if (r > n) throw conflict('refund_exceeds_charge', 'refund is larger than the charge it refunds');
  const discountBack = r === n ? d : Math.floor((r * d) / n);
  return { grossCents: -(r + discountBack), discountCents: -discountBack, netCents: -r };
}

function createCorporateRuntime({ config, pool, stripe = null, fetchImpl = globalThis.fetch,
  resolveTxt, lookup, logger = () => {}, now = Date.now } = {}) {
  const disabled = (reason) => ({ enabled: false, reason, actions: null, publishProjection: async () => null });
  if (!config || !config.corporateEnabled) return disabled('flag_off');
  if (!pool) return disabled('missing_database');
  if (String(config.corporateVerificationSecret || '').length < 16) {
    logger('warn', 'corporate_disabled_missing_secret', { env: 'SML_CORPORATE_VERIFICATION_SECRET' });
    return disabled('missing_verification_secret');
  }
  if (!Array.isArray(config.evidenceEncryptionKeys) || !config.evidenceEncryptionKeys.length) {
    logger('warn', 'corporate_disabled_missing_key', { env: 'SML_EVIDENCE_ENCRYPTION_KEY' });
    return disabled('missing_encryption_key');
  }

  const store = createEvidenceStore({ pool, keyList: config.evidenceEncryptionKeys, logger });
  const accounts = createCorporateAccountService({
    /* resolveTxt/lookup are injectable for tests; undefined means the real
       DNS resolvers inside the account service. */
    pool, verificationSecret: config.corporateVerificationSecret, fetchImpl, resolveTxt, lookup, now, logger
  });
  const billing = createCorporateBillingService({ pool, store, now, logger });
  const promos = createCorporatePromoService({ pool, now, logger });

  /* ------------------------------------------------------------ projection */

  const publisher = createProjectionPublisher({
    url: config.wordpressUrl ? `${config.wordpressUrl}/wp-json/sml-corporate/v1/projection` : '',
    secret: config.wordpressBillingBridgeSecret,
    fetchImpl, now, logger
  });
  let lastDigest = null;
  let lastFailure = null;

  /**
   * Push the active-account list to WordPress. Skips when unchanged unless
   * forced. A failure is logged once per distinct message rather than every
   * tick, so an uninstalled plugin does not flood the log every minute.
   */
  async function publishProjection({ force = false } = {}) {
    if (!publisher) return { published: false, skipped: 'publisher_unconfigured' };
    try {
      const projection = buildProjection(await accounts.projection(), { now });
      const result = await publisher.publish(projection, { lastDigest: force ? null : lastDigest });
      lastDigest = result.digest;
      if (lastFailure) logger('info', 'corporate_projection_recovered', {});
      lastFailure = null;
      if (result.published) logger('info', 'corporate_projection_published', { count: projection.count });
      return result;
    } catch (error) {
      const message = String(error && error.message);
      if (message !== lastFailure) logger('warn', 'corporate_projection_failed', { error });
      lastFailure = message;
      return { published: false, error: 'publish_failed' };
    }
  }

  /* ----------------------------------------------------------------- stripe */

  function requireStripe() {
    if (!stripe) throw conflict('stripe_unconfigured', 'Stripe is not configured');
    return stripe;
  }

  async function succeededPayment(paymentIntentId) {
    const intent = await requireStripe().paymentIntents.retrieve(paymentIntentId);
    if (!intent || intent.status !== 'succeeded') {
      throw conflict('payment_not_succeeded', `payment ${paymentIntentId} has status ${intent && intent.status}`);
    }
    if (String(intent.currency).toLowerCase() !== 'usd') {
      throw conflict('payment_currency_mismatch', `payment is in ${intent.currency}, corporate billing is USD`);
    }
    const chargeId = typeof intent.latest_charge === 'string'
      ? intent.latest_charge : intent.latest_charge && intent.latest_charge.id;
    if (!chargeId) throw conflict('payment_not_succeeded', 'payment has no charge');
    return { intent, chargeId, amount: Number(intent.amount_received) };
  }

  /** One PaymentIntent backs one record, across fees AND ad spend. */
  async function assertPaymentUnused(paymentIntentId, chargeId) {
    const used = await pool.query(
      `SELECT 'fee' AS kind FROM corporate_billing WHERE stripe_payment_intent = $1
       UNION ALL
       SELECT 'ad' FROM corporate_ad_spend WHERE stripe_charge_id = $2 OR source_event_id = $2`,
      [paymentIntentId, chargeId]
    );
    if (used.rows.length) {
      throw conflict('payment_already_recorded', `this payment is already recorded as ${used.rows[0].kind}`);
    }
  }

  /* ---------------------------------------------------------------- actions */

  async function challenge(input) {
    const corporateId = requireId(input.corporateId, 'corporateId');
    const found = await pool.query('SELECT id, verified_domain, verified_at FROM corporate_accounts WHERE id = $1', [corporateId]);
    const row = found.rows[0];
    if (!row) throw conflict('not_found', 'corporate account not found');
    return {
      domain: row.verified_domain,
      verified: Boolean(row.verified_at),
      token: accounts.verificationToken(corporateId, row.verified_domain),
      instructions: {
        dnsTxt: `TXT record on ${row.verified_domain}`,
        wellKnown: `https://${row.verified_domain}${WELL_KNOWN_PATH}`
      }
    };
  }

  async function recordFee(input) {
    const billingId = requireId(input.billingId, 'billingId');
    const paymentIntentId = requireStripeId(input.paymentIntentId, 'pi', 'paymentIntentId');
    const cycle = await pool.query('SELECT onboarding_fee_cents, onboarding_paid_at FROM corporate_billing WHERE id = $1', [billingId]);
    const row = cycle.rows[0];
    if (!row) throw conflict('not_found', 'billing cycle not found');
    if (row.onboarding_paid_at) return { applied: false, alreadyPaid: true };

    const payment = await succeededPayment(paymentIntentId);
    const fee = Number(row.onboarding_fee_cents);
    if (payment.amount < fee) {
      throw conflict('payment_amount_mismatch', `payment collected ${payment.amount} cents; the fee is ${fee}`);
    }
    await assertPaymentUnused(paymentIntentId, payment.chargeId);
    try {
      return await billing.markOnboardingFeePaid({ billingId, stripePaymentIntent: paymentIntentId });
    } catch (error) {
      if (error && error.code === '23505') throw conflict('payment_already_recorded', 'this payment is already recorded');
      throw error;
    }
  }

  async function recordAd(input) {
    const paymentIntentId = requireStripeId(input.paymentIntentId, 'pi', 'paymentIntentId');
    const payment = await succeededPayment(paymentIntentId);
    await assertPaymentUnused(paymentIntentId, payment.chargeId);
    try {
      return await billing.purchaseAd({
        corporateId: input.corporateId,
        billingId: input.billingId,
        grossCents: input.grossCents,
        campaignRef: input.campaignRef,
        stripeChargeId: payment.chargeId,
        expectedNetCents: payment.amount
      });
    } catch (error) {
      if (error && error.code === '23505') throw conflict('payment_already_recorded', 'this charge is already recorded');
      if (error && error.code === 'price_changed') {
        error.message += '. Nothing was recorded — refund the payment and re-quote.';
      }
      throw error;
    }
  }

  async function recordRefund(input) {
    const corporateId = requireId(input.corporateId, 'corporateId');
    const billingId = requireId(input.billingId, 'billingId');
    const refundId = requireStripeId(input.refundId, 're', 'refundId');
    const reason = String(input.reason || '').trim();
    if (!reason) throw invalid('a refund must state a reason');

    const refund = await requireStripe().refunds.retrieve(refundId);
    if (!refund || refund.status !== 'succeeded') {
      throw conflict('refund_not_succeeded', `refund ${refundId} has status ${refund && refund.status}`);
    }
    const chargeId = typeof refund.charge === 'string' ? refund.charge : refund.charge && refund.charge.id;

    const original = await pool.query(
      `SELECT gross_cents, discount_cents, net_cents FROM corporate_ad_spend
        WHERE stripe_charge_id = $1 AND billing_id = $2 AND corporate_id = $3`,
      [chargeId, billingId, corporateId]
    );
    const purchase = original.rows[0];
    if (!purchase) throw conflict('charge_not_recorded', 'that refund is not for an ad purchase recorded on this cycle');

    const prior = await pool.query(
      `SELECT COALESCE(SUM(-net_cents), 0) AS refunded,
              COUNT(*) FILTER (WHERE source_event_id = $2) AS same
         FROM corporate_ad_spend WHERE provenance->>'reverses_charge' = $1`,
      [chargeId, refundId]
    );
    if (Number(prior.rows[0].same) > 0) throw conflict('refund_already_recorded', 'this refund is already recorded');
    const alreadyRefunded = Number(prior.rows[0].refunded);
    const amount = Number(refund.amount);
    if (alreadyRefunded + amount > Number(purchase.net_cents)) {
      throw conflict('refund_exceeds_charge', 'refunds would exceed what was charged', { alreadyRefunded });
    }

    const split = refundSplit({
      refundCents: amount,
      grossCents: purchase.gross_cents,
      discountCents: purchase.discount_cents,
      netCents: purchase.net_cents
    });
    const recorded = await billing.recordCorrection({
      corporateId, billingId, reason,
      grossCents: split.grossCents, discountCents: split.discountCents,
      stripeChargeId: chargeId, stripeRefundId: refundId
    });
    return { ...recorded, ...split };
  }

  async function activate(input) {
    const result = await accounts.activate(requireId(input.corporateId, 'corporateId'));
    const projection = await publishProjection({ force: true });
    return { ...result, projectionPublished: Boolean(projection && projection.published) };
  }

  async function suspend(input) {
    const result = await accounts.suspend(requireId(input.corporateId, 'corporateId'), input.reason);
    /* Suspension takes effect on WordPress by absence, so push immediately
     * rather than waiting for the next worker tick. */
    const projection = await publishProjection({ force: true });
    return { ...result, projectionPublished: Boolean(projection && projection.published) };
  }

  async function onboardingPool(input) {
    const found = await pool.query(
      `SELECT wp_user_id AS "wpUserId", company_name AS name, brand_handle AS handle, category
         FROM corporate_accounts WHERE status = 'active'`
    );
    const answers = onboarding.validateAnswers(input.answers || {}).answers;
    const profile = onboarding.buildProfile(answers);
    return {
      profile,
      ...onboarding.buildCardPool({
        corporate: found.rows,
        news: Array.isArray(input.news) ? input.news : [],
        creators: Array.isArray(input.creators) ? input.creators : [],
        profile
      })
    };
  }

  const actions = Object.freeze({
    register: (input) => accounts.register(input),
    challenge,
    verify: (input) => accounts.verifyDomain(requireId(input.corporateId, 'corporateId')),
    'open-cycle': (input) => billing.openCycle(input),
    'record-fee': recordFee,
    activate,
    suspend,
    summary: (input) => billing.cycleSummary(input.billingId),
    'ad-quote': (input) => billing.quoteAd(input),
    'ad-record': recordAd,
    'ad-refund': recordRefund,
    'promo-schedule': (input) => promos.schedule(input),
    'promo-cancel': (input) => promos.cancel(input),
    'promo-live': async (input) => {
      const live = await promos.livePromotions({ corporateId: input.corporateId == null ? null : requireId(input.corporateId, 'corporateId') });
      return { items: [...live.items], corporateIds: [...live.corporateIds], promotions: live.promotions };
    },
    'promo-history': (input) => promos.purchaseHistory(input.corporateId).then((history) => ({ history })),
    'onboarding-questions': async () => ({ questions: onboarding.QUESTIONS, requiredSelections: onboarding.REQUIRED_SELECTIONS }),
    'onboarding-pool': onboardingPool,
    'projection-publish': () => publishProjection({ force: true })
  });

  return { enabled: true, reason: null, actions, publishProjection };
}

module.exports = { createCorporateRuntime, refundSplit, CONFLICT_CODES };
