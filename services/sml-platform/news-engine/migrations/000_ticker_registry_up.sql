-- =============================================================================
-- StockMarketLoop Platform — canonical ticker registry
-- Target: PostgreSQL 14+
--
-- The platform runs in its own database, separate from WordPress.  It needs a
-- small authoritative symbol registry before articles can reference a ticker.
-- Market-data ingestion owns populating and refreshing these rows; this
-- migration deliberately seeds no symbols and makes no external API calls.
-- =============================================================================

BEGIN;

CREATE TABLE tickers (
  ticker       TEXT        PRIMARY KEY,
  company_name TEXT,
  exchange     TEXT,
  asset_type   TEXT        NOT NULL DEFAULT 'equity',
  active       BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tickers_symbol_format CHECK (ticker ~ '^[A-Z0-9.:-]{1,24}$'),
  CONSTRAINT tickers_asset_type_not_blank CHECK (length(btrim(asset_type)) > 0)
);

COMMENT ON TABLE tickers IS
  'Platform-local canonical symbol registry. Populated by verified market-data ingestion.';
COMMENT ON COLUMN tickers.active IS
  'False retains historical article references while preventing a symbol from new active coverage.';

CREATE INDEX tickers_active_idx ON tickers (ticker) WHERE active;

COMMIT;
