-- DESTRUCTIVE: only use to roll back a brand-new platform before data exists.
BEGIN;
DROP TABLE IF EXISTS tickers;
COMMIT;
