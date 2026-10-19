-- Trading Wall: comments members leave on each other's Academy profile pages. Removed comments keep a deleted_at
-- mark (author, wall owner or an Academy owner removed them) and are never shown again.
BEGIN;

CREATE TABLE IF NOT EXISTS academy_profile_wall (
  id          BIGSERIAL PRIMARY KEY,
  profile_id  TEXT NOT NULL,
  author_id   TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  deleted_by  TEXT
);
CREATE INDEX IF NOT EXISTS academy_profile_wall_profile_idx ON academy_profile_wall (profile_id, id DESC);

COMMIT;
