-- =============================================================================
-- 018 — Corporate promotions (the paid boost)
--
-- 017 records money taken. It does not record what that money BOUGHT, which
-- means there is currently no way to answer "what did we actually run for
-- Bloomberg in March?" — the first question asked in any advertiser dispute,
-- and the one question the ad ledger alone cannot answer.
--
-- A PROMOTION CANNOT EXIST WITHOUT A PAID PURCHASE BEHIND IT.
-- spend_id is NOT NULL and references corporate_ad_spend, so the database
-- refuses a free boost rather than trusting every future code path to remember
-- to charge for one. This is the same reasoning as
-- corporate_active_requires_verification in 017: the expensive mistake is made
-- impossible rather than merely discouraged.
--
-- THE BOOST IS A RANKING MULTIPLIER, NEVER A PRICE INPUT.
-- No amount column lives on this table, deliberately. Money lives in
-- corporate_ad_spend and nothing here may be joined into a charge. Multiplying
-- where a partner ranks is the benefit they bought; multiplying what they are
-- charged is fraud.
--
-- Additive. One new enum, one new table, no existing table touched.
-- =============================================================================

BEGIN;

CREATE TYPE corporate_promotion_status AS ENUM ('scheduled', 'running', 'finished', 'cancelled');

CREATE TABLE corporate_promotions (
  id             BIGSERIAL PRIMARY KEY,
  corporate_id   BIGINT NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,

  -- The purchase that paid for this placement. No spend row, no promotion.
  spend_id       BIGINT NOT NULL REFERENCES corporate_ad_spend(id) ON DELETE RESTRICT,

  -- The item being promoted, as the feed identifies it. TEXT because the feed
  -- aggregates posts, letters and uploads under mixed id shapes (chart-*,
  -- stream-*) and coercing those to BIGINT has broken this feed before.
  item_ref       TEXT        NOT NULL,

  starts_at      TIMESTAMPTZ NOT NULL,
  ends_at        TIMESTAMPTZ NOT NULL,
  status         corporate_promotion_status NOT NULL DEFAULT 'scheduled',

  cancelled_at   TIMESTAMPTZ,
  cancel_reason  TEXT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT corporate_promotion_window CHECK (ends_at > starts_at),

  -- A cancellation with no reason is unauditable, and "why did our campaign
  -- stop?" is the second question in the same dispute.
  CONSTRAINT corporate_promotion_cancel_reason
    CHECK (status <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL))
);

-- One live promotion per item. Two overlapping promotions on the same post
-- would bill twice for one placement and, because boosts take the maximum
-- rather than the product, deliver exactly nothing extra for the second.
CREATE UNIQUE INDEX corporate_promotions_one_live_per_item
  ON corporate_promotions (item_ref)
  WHERE status IN ('scheduled', 'running');

-- The feed's hot path: "which promotions are live right now?"
CREATE INDEX corporate_promotions_window_idx
  ON corporate_promotions (starts_at, ends_at)
  WHERE status IN ('scheduled', 'running');

CREATE INDEX corporate_promotions_corporate_idx
  ON corporate_promotions (corporate_id, starts_at DESC);

-- Answering "what did this purchase buy?" without a sequential scan.
CREATE INDEX corporate_promotions_spend_idx ON corporate_promotions (spend_id);

CREATE TRIGGER corporate_promotions_touch
  BEFORE UPDATE ON corporate_promotions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_subs();

COMMIT;
