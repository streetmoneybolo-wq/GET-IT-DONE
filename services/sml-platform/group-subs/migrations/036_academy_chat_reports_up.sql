-- Reports on Academy chat messages: one row per (message, reporting member), for moderators to review.
-- The message is referenced by id only (no foreign key) so deleting a reported message does not erase the report.

BEGIN;

CREATE TABLE IF NOT EXISTS academy_chat_reports (
  id           BIGSERIAL PRIMARY KEY,
  message_id   BIGINT NOT NULL,
  channel      TEXT NOT NULL,
  reporter_id  TEXT NOT NULL,
  author_id    TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS academy_chat_reports_created_idx ON academy_chat_reports (created_at DESC);

COMMIT;
