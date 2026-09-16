-- =============================================================================
-- 018 DOWN — Corporate promotions
--
-- READ BEFORE RUNNING.
--
-- corporate_promotions is the record of what each ad purchase actually bought.
-- The spend ledger in 017 survives this migration and still proves what was
-- charged — but on its own it cannot answer "what did you run for us?", which
-- is the first question in any advertiser dispute. Export this table before
-- dropping it if any promotion has ever run.
--
-- Dropping it does NOT refund anything and does not touch corporate_ad_spend.
-- It does release the ON DELETE RESTRICT that currently stops a paid spend row
-- from being deleted while a promotion points at it.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS corporate_promotions;

-- The enum cannot be dropped while the column above still uses it, so it goes
-- second — same ordering as 017.
DROP TYPE IF EXISTS corporate_promotion_status;

COMMIT;
