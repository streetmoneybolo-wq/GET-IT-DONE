BEGIN;
-- Sweep-versus-wall events join the measured order-flow signals: a sweep that ate a wall and held (side = the breakout's
-- direction), a sweep absorbed by a wall (side = the rejection's direction), or a false break. features.outcome names which.
ALTER TABLE academy_orderflow_events DROP CONSTRAINT IF EXISTS academy_orderflow_events_kind_check;
ALTER TABLE academy_orderflow_events ADD CONSTRAINT academy_orderflow_events_kind_check CHECK (kind IN ('stack','pull','absorb','iceberg','flip','sweep'));
COMMIT;
