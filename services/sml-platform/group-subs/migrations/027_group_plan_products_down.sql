BEGIN;

ALTER TABLE marketplace_sellers DROP COLUMN IF EXISTS card_payments_enabled;

ALTER TABLE group_plans DROP CONSTRAINT IF EXISTS group_plans_interval_count_sane;
ALTER TABLE group_plans
  DROP COLUMN IF EXISTS archived_at,
  DROP COLUMN IF EXISTS created_by_user_id,
  DROP COLUMN IF EXISTS interval_count,
  DROP COLUMN IF EXISTS stripe_product_id,
  DROP COLUMN IF EXISTS description;

COMMIT;
