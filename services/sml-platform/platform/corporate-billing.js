/* =============================================================================
 * platform/corporate-billing.js — the onboarding fee, the cycle, the ad ledger
 *
 * Balances are DERIVED from corporate_ad_spend on every read, never stored as a
 * running counter. A counter and a ledger drift, and the ledger is the one you
 * produce in a billing dispute. Same reason platform_fee_ledger exists rather
 * than a total on the group.
 *
 * THE LOCK IS THE CAP CHECK.
 * appendChained takes a pg_advisory_xact_lock on ('corporate_ad_spend:' ||
 * billing_id) before reading the chain head. Scoping the chain per BILLING
 * CYCLE therefore serialises the cap arithmetic for free: two concurrent
 * purchases cannot both read remaining cap before either writes. Do the sums
 * inside that same transaction or the race comes straight back.
 *
 * DEVIATION FROM THE DESIGN DOC, deliberate: a purchase that would exceed the
 * cap is REJECTED with the remaining amount, not silently clamped. Clamping
 * charges an advertiser a different number than they asked for, and working out
 * the largest gross whose post-discount net still fits under the cap is a
 * fiddly inverse that would be wrong in some rounding corner. Rejecting is
 * exact, and "only $10,000 remains this cycle" is something they can act on.
 * ========================================================================== */

'use strict';

function invalid(message) { return new TypeError(message); }

function capExceeded(remainingCents) {
  const error = new Error(`purchase exceeds the remaining annual cap (${remainingCents} cents left)`);
  error.code = 'cap_exceeded';
  error.remainingCents = remainingCents;
  return error;
}

function requireId(value, name) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw invalid(`${name} must be a positive integer`);
  return id;
}

function requireCents(value, name, { allowNegative = false } = {}) {
  /* Strict about the TYPE, unlike requireId elsewhere in this codebase. These
   * are amounts of money: Number('1e5') is 100000 and Number('0x10') is 16, so
   * coercing a string here turns unvalidated form data into a real charge. */
  if (typeof value !== 'number') throw invalid(`${name} must be a number, not a ${typeof value}`);
  const cents = value;
  if (!Number.isSafeInteger(cents)) throw invalid(`${name} must be an integer number of cents`);
  if (!allowNegative && cents <= 0) throw invalid(`${name} must be positive`);
  return cents;
}

const DAY_MS = 24 * 3600 * 1000;

/**
 * Price one purchase against the cycle's caps.
 *
 * Pure, so every rounding corner is testable without a database. All inputs are
 * integer cents; the discount rate is basis points.
 */
function priceAdPurchase({ grossCents, spentNetCents, discountUsedCents, billing }) {
  const gross = requireCents(grossCents, 'grossCents');
  const spent = requireCents(spentNetCents, 'spentNetCents', { allowNegative: true });
  const used = requireCents(discountUsedCents, 'discountUsedCents', { allowNegative: true });
  if (!billing) throw invalid('billing cycle is required');

  const annualCap = Number(billing.annual_cap_cents);
  const discountCap = Number(billing.discount_cap_cents);
  const bps = Number(billing.discount_bps);
  if (!Number.isSafeInteger(annualCap) || !Number.isSafeInteger(discountCap) || !Number.isSafeInteger(bps)) {
    throw invalid('billing cycle carries non-integer caps');
  }

  /* Corrections can push these negative; clamp so a refunded cycle cannot
   * hand out more headroom than the cap ever allowed. */
  const remaining = Math.max(0, annualCap - Math.max(0, spent));
  if (remaining <= 0) throw capExceeded(0);

  const headroom = Math.max(0, discountCap - Math.max(0, used));
  /* floor: round the discount DOWN, so rounding never costs revenue. */
  const rateDiscount = Math.floor((gross * bps) / 10000);
  const discount = Math.min(rateDiscount, headroom, gross);
  const net = gross - discount;

  /* The cap is on what they are CHARGED. A 20% discount means a $100,000 cap
   * buys $125,000 of list-price inventory, which is the point of the discount. */
  if (net > remaining) throw capExceeded(remaining);

  return { grossCents: gross, discountCents: discount, netCents: net };
}

/**
 * Scale caps for a cycle that starts mid-year.
 *
 * Rounds DOWN. Granting a full year's cap for two months is the expensive
 * direction to be wrong in, and it is the direction a naive implementation
 * defaults to.
 */
function prorateCaps({ annualCapCents, discountCapCents, cycleStart, cycleEnd, activeFrom }) {
  const start = Date.parse(cycleStart);
  const end = Date.parse(cycleEnd);
  const from = activeFrom == null ? start : Date.parse(activeFrom);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(from)) {
    throw invalid('cycle dates must be parseable');
  }
  if (end <= start) throw invalid('cycleEnd must be after cycleStart');

  const totalDays = Math.round((end - start) / DAY_MS);
  const remainingDays = Math.max(0, Math.round((end - Math.max(from, start)) / DAY_MS));
  const ratio = Math.min(1, remainingDays / totalDays);

  return {
    annualCapCents: Math.floor(Number(annualCapCents) * ratio),
    discountCapCents: Math.floor(Number(discountCapCents) * ratio),
    proratedDays: remainingDays,
    totalDays
  };
}

/* --------------------------------------------------------------- service */

function createCorporateBillingService({ pool, store, now = Date.now, logger = () => {} } = {}) {
  if (!pool) throw new Error('corporate billing requires a database pool');
  if (!store || typeof store.appendChained !== 'function') {
    throw new Error('corporate billing requires an evidence store with appendChained');
  }

  async function withTransaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
      throw error;
    } finally {
      client.release();
    }
  }

  /** Sums for a cycle. Read INSIDE the spend transaction, never before it. */
  async function cycleTotals(client, billingId) {
    const found = await client.query(
      `SELECT COALESCE(SUM(net_cents), 0)      AS net,
              COALESCE(SUM(discount_cents), 0) AS discount
         FROM corporate_ad_spend WHERE billing_id = $1`,
      [billingId]
    );
    const row = found.rows[0] || {};
    return { spentNetCents: Number(row.net || 0), discountUsedCents: Number(row.discount || 0) };
  }

  /** Open an annual cycle, prorating when it starts mid-year. */
  async function openCycle(input = {}) {
    const corporateId = requireId(input.corporateId, 'corporateId');
    const startMs = input.cycleStart == null ? now() : Date.parse(input.cycleStart);
    if (!Number.isFinite(startMs)) throw invalid('cycleStart must be parseable');
    const start = new Date(startMs);
    const end = new Date(Date.UTC(
      start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate()
    ));

    const annual = input.annualCapCents == null ? 10000000 : requireCents(input.annualCapCents, 'annualCapCents');
    const discountCap = input.discountCapCents == null ? 2000000 : requireCents(input.discountCapCents, 'discountCapCents');
    const bps = input.discountBps == null ? 2000 : Number(input.discountBps);
    if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10000) throw invalid('discountBps must be 0-10000');

    const caps = input.activeFrom
      ? prorateCaps({
          annualCapCents: annual, discountCapCents: discountCap,
          cycleStart: start.toISOString(), cycleEnd: end.toISOString(), activeFrom: input.activeFrom
        })
      : { annualCapCents: annual, discountCapCents: discountCap };

    const inserted = await pool.query(
      `INSERT INTO corporate_billing
         (corporate_id, annual_cap_cents, discount_bps, discount_cap_cents, cycle_start, cycle_end)
       VALUES ($1, $2, $3, $4, $5::date, $6::date)
       RETURNING id`,
      [corporateId, caps.annualCapCents, bps, caps.discountCapCents,
       start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]
    );
    const billingId = Number(inserted.rows[0].id);
    logger('info', 'corporate_cycle_opened', { corporateId, billingId, annualCap: caps.annualCapCents });
    return { billingId, ...caps };
  }

  /**
   * Record the one-time fee.
   *
   * The PaymentIntent id is UNIQUE in the schema, so a retried Stripe webhook
   * cannot mark the fee paid twice — and the WHERE clause means a second call
   * is a no-op rather than an overwrite that moves the timestamp.
   */
  async function markOnboardingFeePaid(input = {}) {
    const billingId = requireId(input.billingId, 'billingId');
    const intent = String(input.stripePaymentIntent || '').trim();
    if (!intent) throw invalid('stripePaymentIntent is required');

    const updated = await pool.query(
      `UPDATE corporate_billing
          SET onboarding_paid_at = to_timestamp($2 / 1000.0), stripe_payment_intent = $3
        WHERE id = $1 AND onboarding_paid_at IS NULL
        RETURNING id`,
      [billingId, now(), intent]
    );
    const applied = updated.rows.length > 0;
    logger('info', 'corporate_fee_recorded', { billingId, applied });
    return { applied };
  }

  /**
   * Buy ad inventory.
   *
   * Everything — lock, sums, cap check, ledger append — happens in ONE
   * transaction. Pricing in a separate transaction and appending in another
   * reintroduces exactly the race the advisory lock exists to prevent.
   */
  async function purchaseAd(input = {}) {
    const corporateId = requireId(input.corporateId, 'corporateId');
    const billingId = requireId(input.billingId, 'billingId');
    const grossCents = requireCents(input.grossCents, 'grossCents');

    return withTransaction(async (client) => {
      const cycle = await client.query(
        `SELECT id, annual_cap_cents, discount_bps, discount_cap_cents, cycle_end
           FROM corporate_billing WHERE id = $1 AND corporate_id = $2`,
        [billingId, corporateId]
      );
      const billing = cycle.rows[0];
      if (!billing) throw invalid('unknown billing cycle for this account');
      if (Date.parse(billing.cycle_end) <= now()) throw invalid('billing cycle has ended');

      /* The append below takes the advisory lock, but the sums are read first —
       * so take the same lock explicitly here, before reading, or the read is
       * unprotected and the cap can be overshot by a concurrent purchase. */
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',
        [`corporate_ad_spend:${billingId}`]);

      const totals = await cycleTotals(client, billingId);
      const priced = priceAdPurchase({ grossCents, ...totals, billing });

      const appended = await store.appendChained(client, {
        table: 'corporate_ad_spend',
        scopeKey: billingId,
        fields: {
          corporate_id: corporateId,
          billing_id: billingId,
          campaign_ref: input.campaignRef == null ? null : String(input.campaignRef).slice(0, 191),
          gross_cents: priced.grossCents,
          discount_cents: priced.discountCents,
          net_cents: priced.netCents,
          stripe_charge_id: input.stripeChargeId == null ? null : String(input.stripeChargeId),
          occurred_at: new Date(now()).toISOString(),
          provenance: { source: 'corporate_ad_purchase' }
        }
      });

      logger('info', 'corporate_ad_purchased', {
        corporateId, billingId, net: priced.netCents, discount: priced.discountCents
      });
      return { spendId: appended.id, ...priced };
    });
  }

  /**
   * Refunds and chargebacks.
   *
   * Appended as a NEGATIVE row. Never UPDATE or DELETE a ledger row — that is
   * what prev_hash protects, and a corrected row is indistinguishable from a
   * tampered one afterwards. A correction restores cap and discount headroom
   * naturally, because both are derived sums.
   */
  async function recordCorrection(input = {}) {
    const corporateId = requireId(input.corporateId, 'corporateId');
    const billingId = requireId(input.billingId, 'billingId');
    const gross = requireCents(input.grossCents, 'grossCents', { allowNegative: true });
    const discount = requireCents(input.discountCents == null ? 0 : input.discountCents,
      'discountCents', { allowNegative: true });
    if (gross >= 0) throw invalid('a correction must be negative');
    const reason = String(input.reason || '').trim();
    if (!reason) throw invalid('a correction must state a reason');

    return withTransaction(async (client) => {
      const appended = await store.appendChained(client, {
        table: 'corporate_ad_spend',
        scopeKey: billingId,
        fields: {
          corporate_id: corporateId,
          billing_id: billingId,
          gross_cents: gross,
          discount_cents: discount,
          net_cents: gross - discount,
          stripe_charge_id: input.stripeChargeId == null ? null : String(input.stripeChargeId),
          occurred_at: new Date(now()).toISOString(),
          provenance: { source: 'corporate_ad_correction', reason }
        }
      });
      logger('warn', 'corporate_ad_corrected', { corporateId, billingId, gross, reason });
      return { spendId: appended.id };
    });
  }

  /** What an advertiser sees: derived, never cached. */
  async function cycleSummary(billingId) {
    const id = requireId(billingId, 'billingId');
    const cycle = await pool.query(
      `SELECT annual_cap_cents, discount_cap_cents, discount_bps, cycle_start, cycle_end,
              onboarding_paid_at
         FROM corporate_billing WHERE id = $1`,
      [id]
    );
    const billing = cycle.rows[0];
    if (!billing) throw invalid('unknown billing cycle');

    const totals = await cycleTotals(pool, id);
    return {
      annualCapCents: Number(billing.annual_cap_cents),
      spentNetCents: totals.spentNetCents,
      remainingCents: Math.max(0, Number(billing.annual_cap_cents) - Math.max(0, totals.spentNetCents)),
      discountCapCents: Number(billing.discount_cap_cents),
      discountUsedCents: totals.discountUsedCents,
      discountRemainingCents: Math.max(0, Number(billing.discount_cap_cents) - Math.max(0, totals.discountUsedCents)),
      discountBps: Number(billing.discount_bps),
      onboardingPaid: Boolean(billing.onboarding_paid_at),
      cycleStart: billing.cycle_start,
      cycleEnd: billing.cycle_end
    };
  }

  return { openCycle, markOnboardingFeePaid, purchaseAd, recordCorrection, cycleSummary };
}

module.exports = {
  createCorporateBillingService,
  priceAdPurchase,
  prorateCaps,
  DAY_MS
};
