-- Full-depth order-book recordings for the Academy research desk. One row per book change, per recorded symbol
-- (SPY and QQQ by default), with every level the bridge returns (moomoo's US package: up to 60 a side, each with
-- its size and order count) stored as compact arrays [[price, size, orders], ...]. Level 2 has no history, so this
-- is what lets the Academy's order-flow signals (stack / pull / absorb / iceberg / flip) be replayed and measured
-- at ten levels against the full book. Research data only; no member data is stored.

BEGIN;

CREATE TABLE IF NOT EXISTS academy_depth_snapshots (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL CHECK (symbol ~ '^[A-Z0-9.:-]{1,10}$'),
  ts TIMESTAMPTZ NOT NULL,                 -- the bridge's "as of" time for the book
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  depth SMALLINT NOT NULL CHECK (depth > 0),      -- levels actually returned on the shallower side
  bid1 NUMERIC(14,4) NOT NULL CHECK (bid1 > 0),
  ask1 NUMERIC(14,4) NOT NULL CHECK (ask1 > 0),
  bid_size_10 INTEGER NOT NULL DEFAULT 0,  -- shares resting on the first ten levels (what the live reader sees)
  ask_size_10 INTEGER NOT NULL DEFAULT 0,
  bid_size_all INTEGER NOT NULL DEFAULT 0, -- shares resting on every recorded level
  ask_size_all INTEGER NOT NULL DEFAULT 0,
  bids JSONB NOT NULL,                     -- [[price, size, orders], ...] best first
  asks JSONB NOT NULL,
  prints JSONB NOT NULL DEFAULT '[]'::jsonb -- new trade prints since the previous row: [[ts, price, size, "B"|"S"|"N"], ...]
);

CREATE INDEX IF NOT EXISTS academy_depth_snapshots_symbol_ts ON academy_depth_snapshots (symbol, ts);

COMMIT;
