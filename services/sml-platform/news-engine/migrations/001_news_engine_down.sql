-- =============================================================================
-- StockMarketLoop News Engine — Module 1 ROLLBACK
-- Apply with:  psql -1 -f 001_news_engine_down.sql
--
-- DESTRUCTIVE. Drops every article and all performance history. Take a dump of
-- the news-engine tables first if the data matters:
--   pg_dump -t 'article*' -t topics -Fc yourdb > news_engine_backup.dump
--
-- Order matters: children before parents, types after the tables that use them.
-- Every DROP is IF EXISTS so a partial forward migration can still be undone.
-- =============================================================================

BEGIN;

-- Triggers (dropped explicitly; DROP TABLE would take them, but being explicit
-- means this script also cleans up after a partially-applied forward migration).
DROP TRIGGER IF EXISTS articles_set_updated_at           ON articles;
DROP TRIGGER IF EXISTS article_engagement_set_updated_at ON article_engagement;

-- Leaf tables (all reference articles).
DROP TABLE IF EXISTS article_scores      CASCADE;
DROP TABLE IF EXISTS article_engagement  CASCADE;
DROP TABLE IF EXISTS article_relations   CASCADE;
DROP TABLE IF EXISTS article_keywords    CASCADE;
DROP TABLE IF EXISTS article_topics      CASCADE;
DROP TABLE IF EXISTS article_tickers     CASCADE;
DROP TABLE IF EXISTS article_sources     CASCADE;
DROP TABLE IF EXISTS article_metrics     CASCADE;

-- Partitioned parent: dropping it removes every attached partition, including
-- the monthly ones created by ensure_metrics_partition() and the DEFAULT.
DROP TABLE IF EXISTS article_metrics_daily CASCADE;

-- Parents.
DROP TABLE IF EXISTS articles CASCADE;
DROP TABLE IF EXISTS topics   CASCADE;

-- Functions.
DROP FUNCTION IF EXISTS ensure_metrics_partition(DATE);
-- set_updated_at() is generic and may predate this migration or be shared with
-- other schemas. Only drop it if nothing else depends on it:
--   SELECT c.relname FROM pg_trigger t
--     JOIN pg_class c ON c.oid = t.tgrelid
--     JOIN pg_proc p  ON p.oid = t.tgfoid
--    WHERE p.proname = 'set_updated_at' AND NOT t.tgisinternal;
-- If that returns no rows, uncomment:
-- DROP FUNCTION IF EXISTS set_updated_at();

-- Types last — a type cannot be dropped while a column still uses it.
DROP TYPE IF EXISTS article_status;
DROP TYPE IF EXISTS article_source_type;

-- pg_trgm is intentionally NOT dropped: other parts of the site may use it and
-- removing an extension takes its operator classes with it. To remove manually:
-- DROP EXTENSION IF EXISTS pg_trgm;

COMMIT;
