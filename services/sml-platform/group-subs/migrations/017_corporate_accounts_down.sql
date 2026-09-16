-- =============================================================================
-- 017 DOWN — Corporate Accounts
--
-- READ BEFORE RUNNING.
--
-- corporate_ad_spend is the ledger of money taken from corporate advertisers. It
-- is append-only and hash-chained precisely so it can be produced in a billing
-- dispute. Dropping it destroys that record, and a suspended or unhappy
-- advertiser is exactly who asks for it.
--
-- Safe on a deployment where no corporate account was ever activated. On one
-- where any fee or ad purchase settled, EXPORT corporate_billing and
-- corporate_ad_spend first, and verify the chain before you do
-- (evidence-store verifyChain, scoped per billing_id) — an export taken after
-- the table is gone proves nothing about what it contained.
--
-- Drop order follows the foreign keys: children first, then accounts, then the
-- enums, which cannot be dropped while a column still uses them.
-- =============================================================================

BEGIN;

DROP TRIGGER IF EXISTS corporate_accounts_touch ON corporate_accounts;

DROP TABLE IF EXISTS corporate_feed_metrics;
DROP TABLE IF EXISTS corporate_ad_spend;
DROP TABLE IF EXISTS corporate_billing;
DROP TABLE IF EXISTS corporate_accounts;

DROP TYPE IF EXISTS corporate_category;
DROP TYPE IF EXISTS corporate_status;

COMMIT;
