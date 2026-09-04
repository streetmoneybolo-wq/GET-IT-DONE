BEGIN;

DROP VIEW IF EXISTS connect_group_migration_analytics;
DROP VIEW IF EXISTS connect_group_homepages_public;
DROP TABLE IF EXISTS connect_message_snapshots;
DROP TABLE IF EXISTS connect_migration_events;
DROP TABLE IF EXISTS connect_plan_mappings;
DROP TABLE IF EXISTS connect_migration_campaigns;
DROP FUNCTION IF EXISTS set_updated_at_connect_migration();

COMMIT;
