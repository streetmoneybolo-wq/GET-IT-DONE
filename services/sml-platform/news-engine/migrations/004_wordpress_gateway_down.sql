-- Rollback destroys the WordPress gateway's idempotency/audit ledger. Do not
-- use it after WordPress begins delivery unless there is a confirmed recovery
-- plan, otherwise old retries could be received again as new events.

BEGIN;

DROP TABLE wordpress_gateway_events;
DROP TYPE wordpress_gateway_event_status;

COMMIT;
