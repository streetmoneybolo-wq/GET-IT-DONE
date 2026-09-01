BEGIN;

ALTER TABLE news_article_jobs
  ADD COLUMN editorial_desk TEXT,
  ADD COLUMN topic_fingerprint TEXT,
  ADD COLUMN market_snapshot JSONB,
  ADD COLUMN official_sources JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX news_article_jobs_topic_fingerprint_uniq
  ON news_article_jobs (topic_fingerprint)
  WHERE topic_fingerprint IS NOT NULL;

CREATE INDEX news_article_jobs_editorial_desk_idx
  ON news_article_jobs (editorial_desk, published_at DESC)
  WHERE editorial_desk IS NOT NULL;

COMMENT ON COLUMN news_article_jobs.topic_fingerprint IS
  'Global event identity claimed before generation so two editorial desks cannot publish the same verified market event.';
COMMENT ON COLUMN news_article_jobs.market_snapshot IS
  'Timestamped publication-time market facts; live embeds remain live but never rewrite this snapshot.';
COMMENT ON COLUMN news_article_jobs.official_sources IS
  'Verified regulator, exchange, or issuer announcement links; the generator may not invent sources.';

COMMIT;
