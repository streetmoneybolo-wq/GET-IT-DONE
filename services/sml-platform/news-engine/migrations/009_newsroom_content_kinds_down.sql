BEGIN;

DROP INDEX IF EXISTS news_article_jobs_subject_fingerprint_uniq;
ALTER TABLE news_article_jobs DROP COLUMN IF EXISTS content_kind;
ALTER TABLE news_article_jobs DROP COLUMN IF EXISTS subject_fingerprint;

COMMIT;
