-- Ticker Talk: the comment section for every ticker in the Academy Live Chart Lab (comments, one-level replies, the
-- member's uploaded pictures). Removed comments keep a deleted_at mark and are never shown again.
BEGIN;

CREATE TABLE IF NOT EXISTS academy_ticker_talk (
  id          BIGSERIAL PRIMARY KEY,
  symbol      TEXT NOT NULL,
  author_id   TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL,
  parent_id   BIGINT,
  images      JSONB NOT NULL DEFAULT '[]',
  links       JSONB NOT NULL DEFAULT '[]',
  mentions    JSONB NOT NULL DEFAULT '[]',
  tickers     JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  deleted_by  TEXT
);
CREATE INDEX IF NOT EXISTS academy_ticker_talk_symbol_idx ON academy_ticker_talk (symbol, id DESC);
CREATE INDEX IF NOT EXISTS academy_ticker_talk_parent_idx ON academy_ticker_talk (parent_id);

CREATE TABLE IF NOT EXISTS academy_ticker_media (
  id           BIGSERIAL PRIMARY KEY,
  author_id    TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  bytes        BYTEA NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
