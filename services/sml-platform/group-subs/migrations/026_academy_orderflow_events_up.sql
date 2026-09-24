-- Level 2 order-flow events the Academy detects (stack / pull / absorb / iceberg / flip), with the price at the time and, five minutes later,
-- how far price moved in the signal's direction. Research data only: it lets the signals be measured before anyone relies on them.
-- No member data is stored.

BEGIN;

CREATE TABLE IF NOT EXISTS academy_orderflow_events (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL CHECK (symbol ~ '^[A-Z0-9.:-]{1,10}$'),
  ts TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('stack','pull','absorb','iceberg','flip')),
  side TEXT NOT NULL CHECK (side IN ('bull','bear')),
  price NUMERIC(14,4) CHECK (price IS NULL OR price > 0),
  strength REAL NOT NULL DEFAULT 0 CHECK (strength >= 0 AND strength <= 1),
  score REAL NOT NULL DEFAULT 0,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome_5m_pct REAL,
  outcome_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS academy_orderflow_events_symbol_ts ON academy_orderflow_events (symbol, ts DESC);
CREATE INDEX IF NOT EXISTS academy_orderflow_events_kind ON academy_orderflow_events (kind, side, ts DESC);

COMMIT;
