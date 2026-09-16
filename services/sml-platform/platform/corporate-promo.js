/* =============================================================================
 * platform/corporate-promo.js — the paid boost in the ad path
 *
 * A PROMOTION IS THE THING AN AD PURCHASE BUYS. The purchase is recorded in
 * corporate_ad_spend by corporate-billing.js; this module records the placement
 * that purchase paid for, and resolves which placements are live right now so
 * the feed can apply the boost.
 *
 * BOOST RANKING, NEVER BILLING. There is no amount anywhere in this file and it
 * does not import corporate-billing.js. It consumes a spend id that already
 * exists and was already charged. If you are about to add a price here, or to
 * multiply one by a boost, stop: multiplying where a partner ranks is the
 * benefit they bought, multiplying what they are charged is fraud.
 *
 * A PROMOTED ITEM IS NOT AN EXEMPT ITEM. Paid placements are subject to exactly
 * the same eligibility gate as organic corporate content — the frequency cap,
 * the 7-day hide suppression, the relevance floor, and the hide-rate demotion.
 * An advertiser who could buy past those could own every slot, and the
 * inventory being sold would be worth nothing within a week. corporate-feed.js
 * enforces that; this module deliberately provides no way around it.
 * ========================================================================== */

'use strict';

function invalid(message) { return new TypeError(message); }

function conflict(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const LIVE_STATUSES = Object.freeze(['scheduled', 'running']);

/** Longest a single placement may run. Beyond this it is a renewal decision. */
const MAX_DURATION_MS = 90 * 24 * 3600 * 1000;

function requireId(value, name) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw invalid(`${name} must be a positive integer`);
  return id;
}

/**
 * The feed identifies items by mixed id shapes — chart-*, stream-*, plain post
 * ids. Coercing those to a number has broken this feed before, so the reference
 * stays TEXT and is only normalized, never parsed.
 */
function normalizeItemRef(value) {
  const ref = String(value == null ? '' : value).trim();
  if (!ref || ref.length > 190) throw invalid('itemRef must be a non-empty reference under 190 chars');
  if (!/^[A-Za-z0-9:_\-.]+$/.test(ref)) throw invalid('itemRef carries characters the feed never emits');
  return ref;
}

function requireInstant(value, name) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw invalid(`${name} must be a parseable timestamp`);
  return ms;
}

/**
 * Validate a promotion window.
 *
 * Pure, so the rules are testable without a database. A window that has already
 * ended is refused rather than stored as instantly-finished: an advertiser
 * whose campaign is recorded as complete before it ran has been charged for
 * nothing, and a silent no-op is how that goes unnoticed for a month.
 */
function validateWindow({ startsAt, endsAt }, { now = Date.now, maxDurationMs = MAX_DURATION_MS } = {}) {
  const start = requireInstant(startsAt, 'startsAt');
  const end = requireInstant(endsAt, 'endsAt');
  if (end <= start) throw invalid('endsAt must be after startsAt');
  if (end <= now()) throw invalid('the promotion window has already ended');
  if (end - start > maxDurationMs) {
    throw invalid(`a promotion may not run longer than ${Math.round(maxDurationMs / 86400000)} days`);
  }
  return { startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() };
}

/**
 * What status a promotion should have at a given instant.
 *
 * Derived from the window rather than driven by a cron sweep. A sweep that
 * fails leaves promotions stuck 'running' after they were paid to stop, and a
 * boost nobody is paying for is the one failure mode an advertiser will never
 * report.
 */
function statusAt(promotion, at) {
  if (promotion.status === 'cancelled') return 'cancelled';
  const start = Date.parse(promotion.starts_at);
  const end = Date.parse(promotion.ends_at);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'finished';
  if (at < start) return 'scheduled';
  if (at >= end) return 'finished';
  return 'running';
}

/** Is this promotion delivering right now? */
function isLive(promotion, at) {
  return statusAt(promotion, at) === 'running';
}

/* ------------------------------------------------------------------ service */

function createCorporatePromoService({ pool, now = Date.now, logger = () => {} } = {}) {
  if (!pool) throw new Error('corporate promotions require a database pool');

  async function withTransaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* the original error wins */ }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Schedule a placement against an ad purchase that has already been charged.
   *
   * The spend row is re-read here rather than trusted from the caller: a
   * promotion whose spend_id points at another account's purchase would be a
   * free boost paid for by someone else, and the foreign key alone does not
   * check ownership.
   */
  async function schedule(input = {}) {
    const corporateId = requireId(input.corporateId, 'corporateId');
    const spendId = requireId(input.spendId, 'spendId');
    const itemRef = normalizeItemRef(input.itemRef);
    const window = validateWindow(input, { now });

    return withTransaction(async (client) => {
      const account = await client.query(
        'SELECT id, status FROM corporate_accounts WHERE id = $1 FOR UPDATE',
        [corporateId]
      );
      if (!account.rows.length) throw conflict('corporate account not found', 'not_found');
      if (account.rows[0].status !== 'active') {
        /* A suspended advertiser must not be able to queue placements that
         * start delivering the moment they are reinstated. */
        throw conflict('only an active corporate account may run promotions', 'not_active');
      }

      const spend = await client.query(
        'SELECT id, corporate_id, net_cents FROM corporate_ad_spend WHERE id = $1',
        [spendId]
      );
      if (!spend.rows.length) throw conflict('ad purchase not found', 'spend_not_found');
      if (Number(spend.rows[0].corporate_id) !== corporateId) {
        throw conflict('that purchase belongs to another account', 'spend_mismatch');
      }
      if (Number(spend.rows[0].net_cents) <= 0) {
        /* Corrections are appended as negative rows. Promoting against one
         * would be a placement paid for by a refund. */
        throw conflict('a promotion cannot be backed by a refund or a zero charge', 'spend_not_a_purchase');
      }

      try {
        const inserted = await client.query(
          `INSERT INTO corporate_promotions
             (corporate_id, spend_id, item_ref, starts_at, ends_at, status)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [corporateId, spendId, itemRef, window.startsAt, window.endsAt,
            Date.parse(window.startsAt) <= now() ? 'running' : 'scheduled']
        );
        logger({ event: 'corporate_promotion_scheduled', corporateId, spendId, itemRef });
        return inserted.rows[0];
      } catch (error) {
        /* The partial unique index is the authority on double-booking, not a
         * prior SELECT — two concurrent schedules would both pass that check. */
        if (error && error.code === '23505') {
          throw conflict('that item already has a live promotion', 'already_promoted');
        }
        throw error;
      }
    });
  }

  /**
   * Cancel a placement. Requires a reason — the database enforces it too,
   * because "why did our campaign stop?" is the second question in any dispute.
   *
   * Cancelling does NOT refund. Money moves only through corporate-billing's
   * recordCorrection, which appends a negative ledger row; doing it here would
   * put two systems in charge of the same number.
   */
  async function cancel({ promotionId, reason } = {}) {
    const id = requireId(promotionId, 'promotionId');
    const why = String(reason == null ? '' : reason).trim();
    if (!why) throw invalid('a cancellation reason is required');

    const at = new Date(now()).toISOString();
    const updated = await pool.query(
      `UPDATE corporate_promotions
          SET status = 'cancelled', cancelled_at = $2, cancel_reason = $3
        WHERE id = $1 AND status <> 'cancelled'
      RETURNING *`,
      [id, at, why]
    );
    if (!updated.rows.length) throw conflict('no cancellable promotion with that id', 'not_cancellable');
    logger({ event: 'corporate_promotion_cancelled', promotionId: id, reason: why });
    return updated.rows[0];
  }

  /**
   * The set of item refs that are boosted right now.
   *
   * Returns a Set for the feed's hot path. Status is checked in SQL AND the
   * window is re-checked in JS via isLive, so a row left stale by a failed
   * sweep still stops delivering on time — the clock is the authority, not the
   * status column.
   */
  async function livePromotions({ corporateId = null } = {}) {
    const at = now();
    const found = await pool.query(
      `SELECT p.id, p.corporate_id, p.spend_id, p.item_ref, p.starts_at, p.ends_at, p.status
         FROM corporate_promotions p
         JOIN corporate_accounts a ON a.id = p.corporate_id
        WHERE p.status = ANY($1)
          AND a.status = 'active'
          AND ($2::bigint IS NULL OR p.corporate_id = $2)`,
      [LIVE_STATUSES, corporateId]
    );

    const live = found.rows.filter((row) => isLive(row, at));
    return {
      items: new Set(live.map((row) => row.item_ref)),
      corporateIds: new Set(live.map((row) => Number(row.corporate_id))),
      promotions: live
    };
  }

  /** Everything a purchase bought — the first question in an advertiser dispute. */
  async function purchaseHistory(corporateId) {
    const id = requireId(corporateId, 'corporateId');
    const at = now();
    const found = await pool.query(
      `SELECT p.*, s.gross_cents, s.discount_cents, s.net_cents, s.occurred_at AS charged_at
         FROM corporate_promotions p
         JOIN corporate_ad_spend s ON s.id = p.spend_id
        WHERE p.corporate_id = $1
        ORDER BY p.starts_at DESC`,
      [id]
    );
    return found.rows.map((row) => ({ ...row, effectiveStatus: statusAt(row, at) }));
  }

  return { schedule, cancel, livePromotions, purchaseHistory };
}

module.exports = {
  LIVE_STATUSES,
  MAX_DURATION_MS,
  normalizeItemRef,
  validateWindow,
  statusAt,
  isLive,
  createCorporatePromoService
};
