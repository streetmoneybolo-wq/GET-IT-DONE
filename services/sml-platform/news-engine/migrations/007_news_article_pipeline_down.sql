BEGIN;

-- DESTRUCTIVE: removes the job, retry, and idempotency ledger. Published
-- WordPress posts are not deleted, so restoring this table before re-enabling
-- ingestion is required to avoid duplicate articles.
DROP TABLE IF EXISTS news_article_jobs CASCADE;

COMMIT;
