BEGIN;
DROP INDEX IF EXISTS subscriptions_one_migration_per_source;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS migration_from_subscription_id;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS external_renewal_verified_at;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS external_renewal_source;
COMMIT;
