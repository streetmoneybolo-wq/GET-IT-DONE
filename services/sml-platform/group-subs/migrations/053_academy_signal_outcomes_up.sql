-- Outcome measurement for the Academy's newer order-flow signals. Every time the full-depth reading fires (pressure, microprice tilt,
-- CVD divergence, large-print bias, replenishment) or the week's daily-flow read is set at the open, one row is stamped with the price
-- at that moment; the sampler fills in what price did 1, 5 and 15 minutes later (1, 3 and 5 trading days later for the week read),
-- signed by the signal's side so a positive number means the signal was right. The hit rates and average moves this produces are
-- shown next to the signals, so members lean on what has been measured, not on what sounds right. Research data only.

BEGIN;

CREATE TABLE IF NOT EXISTS academy_signal_outcomes (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL CHECK (symbol ~ '^[A-Z0-9.:-]{1,10}$'),
  ts TIMESTAMPTZ NOT NULL,
  family TEXT NOT NULL CHECK (family IN ('depth', 'week')),
  signal TEXT NOT NULL,                      -- pressure | microprice | divergence | large | refill | week
  side TEXT NOT NULL CHECK (side IN ('bull', 'bear')),
  bucket TEXT NOT NULL DEFAULT '',           -- strength band: strong | firm | lean (empty when the signal has none)
  value NUMERIC(12,4),                       -- the signal's own number at the time (pressure score, tilt in ticks, bias, ratio, week score)
  price0 NUMERIC(14,4) NOT NULL CHECK (price0 > 0),
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome_1m_pct NUMERIC(10,4),              -- % move from price0, signed so + means the signal's way
  outcome_5m_pct NUMERIC(10,4),
  outcome_15m_pct NUMERIC(10,4),
  outcome_1d_pct NUMERIC(10,4),              -- week family: trading days later, from the daily flow ledger's last price
  outcome_3d_pct NUMERIC(10,4),
  outcome_5d_pct NUMERIC(10,4),
  settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS academy_signal_outcomes_symbol_ts ON academy_signal_outcomes (symbol, ts DESC);
CREATE INDEX IF NOT EXISTS academy_signal_outcomes_signal ON academy_signal_outcomes (family, signal, side, ts DESC);
CREATE INDEX IF NOT EXISTS academy_signal_outcomes_open ON academy_signal_outcomes (family, ts) WHERE settled_at IS NULL;

COMMIT;
