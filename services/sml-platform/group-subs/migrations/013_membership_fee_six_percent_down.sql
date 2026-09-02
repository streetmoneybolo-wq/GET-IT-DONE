BEGIN;

ALTER TABLE group_plans
  ALTER COLUMN platform_fee_bps SET DEFAULT 500;

ALTER TABLE marketplace_sellers
  DROP CONSTRAINT IF EXISTS marketplace_sellers_membership_fee_range,
  DROP COLUMN IF EXISTS membership_fee_accepted_at,
  DROP COLUMN IF EXISTS membership_fee_bps_accepted;

-- Existing plan and subscription rows are intentionally not rewritten. They are
-- financial records tied to the fee that was disclosed when Checkout opened.

COMMIT;
