BEGIN;

ALTER TABLE group_plans
  ALTER COLUMN platform_fee_bps SET DEFAULT 600;

UPDATE group_plans
SET platform_fee_bps = 600
WHERE platform_fee_bps = 500;

COMMENT ON COLUMN group_plans.platform_fee_bps IS
  'Basis points; 600 = 6%. Becomes application_fee_percent only on subscriptions this platform creates. Imported subscriptions never feed platform revenue.';

ALTER TABLE marketplace_sellers
  ADD COLUMN membership_fee_bps_accepted INTEGER,
  ADD COLUMN membership_fee_accepted_at TIMESTAMPTZ;

ALTER TABLE marketplace_sellers
  ADD CONSTRAINT marketplace_sellers_membership_fee_range
  CHECK (membership_fee_bps_accepted IS NULL OR membership_fee_bps_accepted BETWEEN 0 AND 3000);

COMMENT ON COLUMN marketplace_sellers.membership_fee_bps_accepted IS
  'The membership platform fee the seller explicitly accepted, in basis points. New native checkouts fail closed unless this equals the current fee.';
COMMENT ON COLUMN marketplace_sellers.membership_fee_accepted_at IS
  'When the seller explicitly accepted membership_fee_bps_accepted. Existing seller consent is not silently carried across a fee change.';

COMMIT;
