BEGIN;

ALTER TABLE news_article_jobs
  ADD COLUMN subject_fingerprint TEXT,
  ADD COLUMN content_kind TEXT NOT NULL DEFAULT 'article'
    CHECK (content_kind IN ('article', 'short_post'));

CREATE UNIQUE INDEX news_article_jobs_subject_fingerprint_uniq
  ON news_article_jobs (subject_fingerprint)
  WHERE subject_fingerprint IS NOT NULL;

COMMENT ON COLUMN news_article_jobs.subject_fingerprint IS
  'One ticker plus topic plus market date. Claimed before generation across articles and short posts.';
COMMENT ON COLUMN news_article_jobs.content_kind IS
  'The single chosen treatment for this subject: article or short_post.';

COMMIT;
