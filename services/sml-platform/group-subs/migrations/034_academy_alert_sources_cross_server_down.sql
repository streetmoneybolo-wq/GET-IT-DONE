BEGIN;

ALTER TABLE academy_alert_sources DROP COLUMN IF EXISTS cross_server;

COMMIT;
