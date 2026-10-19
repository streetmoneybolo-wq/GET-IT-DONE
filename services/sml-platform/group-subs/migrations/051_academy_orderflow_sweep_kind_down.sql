BEGIN;
DELETE FROM academy_orderflow_events WHERE kind = 'sweep';
ALTER TABLE academy_orderflow_events DROP CONSTRAINT IF EXISTS academy_orderflow_events_kind_check;
ALTER TABLE academy_orderflow_events ADD CONSTRAINT academy_orderflow_events_kind_check CHECK (kind IN ('stack','pull','absorb','iceberg','flip'));
COMMIT;
