BEGIN;
-- Generated Academy lesson media that is paid for once and kept for good: Claude slide designs (JSON) and
-- ElevenLabs narration parts (MP3), keyed by a digest of the exact text they were made from, so an edited
-- lesson regenerates only what changed and an unchanged one never calls a provider again.
CREATE TABLE IF NOT EXISTS academy_media (
  key          text PRIMARY KEY,
  kind         text NOT NULL,
  content_type text NOT NULL,
  bytes        bytea NOT NULL,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS academy_media_kind_idx ON academy_media (kind);
COMMIT;
