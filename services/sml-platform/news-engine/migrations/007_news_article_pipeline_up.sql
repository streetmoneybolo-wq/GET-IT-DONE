BEGIN;

CREATE TABLE news_article_jobs (
  id                    BIGSERIAL PRIMARY KEY,
  source_url            TEXT        NOT NULL,
  source_url_hash       CHAR(64)    NOT NULL,
  source_event_key      TEXT,
  status                TEXT        NOT NULL DEFAULT 'queued',
  attempts              INTEGER     NOT NULL DEFAULT 0,
  next_attempt_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at             TIMESTAMPTZ,
  worker_id             TEXT,
  source_title          TEXT,
  source_excerpt        TEXT,
  source_image_url      TEXT,
  generated_payload     JSONB,
  wordpress_media_id    BIGINT,
  wordpress_post_id     BIGINT,
  wordpress_post_url    TEXT,
  last_error_code       TEXT,
  last_error_detail     TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at          TIMESTAMPTZ,

  CONSTRAINT news_article_jobs_source_hash_uniq UNIQUE (source_url_hash),
  CONSTRAINT news_article_jobs_source_event_uniq UNIQUE (source_event_key),
  CONSTRAINT news_article_jobs_hash_format CHECK (source_url_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT news_article_jobs_attempts_nonnegative CHECK (attempts >= 0),
  CONSTRAINT news_article_jobs_status CHECK (
    status IN ('queued', 'processing', 'retry', 'published', 'rejected', 'failed')
  ),
  CONSTRAINT news_article_jobs_published_complete CHECK (
    status <> 'published' OR (
      wordpress_post_id IS NOT NULL AND
      wordpress_post_url IS NOT NULL AND
      published_at IS NOT NULL
    )
  )
);

COMMENT ON TABLE news_article_jobs IS
  'Idempotent source-to-WordPress pipeline replacing the Make.com article scenario. One source URL can publish at most one post.';
COMMENT ON COLUMN news_article_jobs.source_url_hash IS
  'SHA-256 of the normalized source URL. The unique constraint is the first duplicate guard.';
COMMENT ON COLUMN news_article_jobs.generated_payload IS
  'Schema-validated AI output retained for audit and deterministic retry; never contains credentials.';

CREATE INDEX news_article_jobs_queue_idx
  ON news_article_jobs (next_attempt_at, created_at)
  WHERE status IN ('queued', 'retry');

CREATE INDEX news_article_jobs_stale_lock_idx
  ON news_article_jobs (locked_at)
  WHERE status = 'processing';

CREATE INDEX news_article_jobs_published_idx
  ON news_article_jobs (published_at DESC)
  WHERE status = 'published';

COMMIT;
