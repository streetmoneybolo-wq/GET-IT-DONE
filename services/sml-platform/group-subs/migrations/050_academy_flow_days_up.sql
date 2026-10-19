-- The Academy's daily flow ledger: one row per symbol per New York trading day, folded every minute from the live tape
-- (the Massive print stream when the symbol is watched there, otherwise the moomoo prints the order-flow poll sees), the
-- full-depth pressure reading, the Level 2 events, and moomoo's order-size capital distribution. It is what lets the swing,
-- mid-term and long-term MEM ALGO models read the week (net aggressor delta, large prints, sweeps and blocks, institutional
-- net, book pressure) instead of the last five minutes. Research and education data only; no member data is stored.

BEGIN;

CREATE TABLE IF NOT EXISTS academy_flow_days (
  symbol TEXT NOT NULL CHECK (symbol ~ '^[A-Z0-9.:-]{1,10}$'),
  day DATE NOT NULL,                              -- New York trading day
  tape_source TEXT NOT NULL DEFAULT 'moomoo',     -- massive | moomoo | depth (backfilled from the recorded book's prints)
  buy_vol BIGINT NOT NULL DEFAULT 0,              -- shares that lifted the offer (aggressive buying)
  sell_vol BIGINT NOT NULL DEFAULT 0,             -- shares that hit the bid (aggressive selling)
  neu_vol BIGINT NOT NULL DEFAULT 0,              -- prints between the quotes
  prints INTEGER NOT NULL DEFAULT 0,
  notional NUMERIC(20,2) NOT NULL DEFAULT 0,      -- sum of price x size, for the day's VWAP
  large_buy BIGINT NOT NULL DEFAULT 0,            -- prints of 1,000+ shares or $50,000+
  large_sell BIGINT NOT NULL DEFAULT 0,
  large_n INTEGER NOT NULL DEFAULT 0,
  sweep_buy BIGINT NOT NULL DEFAULT 0,            -- intermarket sweeps (Massive tape only)
  sweep_sell BIGINT NOT NULL DEFAULT 0,
  block_buy BIGINT NOT NULL DEFAULT 0,            -- 10,000+ share or $1M+ prints (Massive tape only)
  block_sell BIGINT NOT NULL DEFAULT 0,
  off_vol BIGINT NOT NULL DEFAULT 0,              -- off-exchange (dark pool) volume (Massive tape only)
  hi NUMERIC(14,4),
  lo NUMERIC(14,4),
  last_px NUMERIC(14,4),
  pressure_sum NUMERIC(14,2) NOT NULL DEFAULT 0,  -- full-depth pressure sampled once a minute: sum and count give the day's average
  pressure_n INTEGER NOT NULL DEFAULT 0,
  bull_minutes INTEGER NOT NULL DEFAULT 0,        -- minutes with pressure >= +40
  bear_minutes INTEGER NOT NULL DEFAULT 0,        -- minutes with pressure <= -40
  ev_bull INTEGER NOT NULL DEFAULT 0,             -- Level 2 events (stack / pull / absorb / iceberg / flip) by side
  ev_bear INTEGER NOT NULL DEFAULT 0,
  inst_net NUMERIC(20,2),                         -- moomoo capital distribution: super-large + large net inflow for the day
  retail_net NUMERIC(20,2),                       -- medium + small net inflow
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, day)
);

CREATE INDEX IF NOT EXISTS academy_flow_days_day ON academy_flow_days (day);

COMMIT;
