BEGIN;

DROP INDEX IF EXISTS news_article_jobs_editorial_desk_idx;
DROP INDEX IF EXISTS news_article_jobs_topic_fingerprint_uniq;
ALTER TABLE news_article_jobs
  DROP COLUMN IF EXISTS official_sources,
  DROP COLUMN IF EXISTS market_snapshot,
  DROP COLUMN IF EXISTS topic_fingerprint,
  DROP COLUMN IF EXISTS editorial_desk;

COMMIT;
