BEGIN;
ALTER TABLE marketplace_disputes DROP COLUMN IF EXISTS context;
ALTER TABLE marketplace_disputes DROP COLUMN IF EXISTS kind;
DROP TABLE IF EXISTS alert_chart_charges;
DROP TABLE IF EXISTS alert_chart_subscriptions;
DROP TABLE IF EXISTS alert_chart_sellers;
-- academy_alert_access stays: the Academy's own Alert Chart module (academy-trader-alerts.js) owns it.
COMMIT;
