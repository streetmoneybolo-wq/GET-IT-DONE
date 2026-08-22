-- Rollback only the D5 retry-deduplication addition. Do not use while queued
-- WordPress gateway deliveries are still active.

BEGIN;

DROP INDEX wordpress_gateway_events_source_key_unique;
ALTER TABLE wordpress_gateway_events DROP COLUMN source_event_key;

COMMIT;
