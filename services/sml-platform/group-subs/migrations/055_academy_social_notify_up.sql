-- Academy social notifications (shown in a member's LOOP-KICK): new followers, Trading Wall comments, posts by the
-- members they follow, likes on their comments, replies. Likes on Ticker Talk and Trading Wall comments live here too.
BEGIN;

CREATE TABLE IF NOT EXISTS academy_notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  actor_id   TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  ref        JSONB NOT NULL DEFAULT '{}',
  body       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS academy_notifications_user_idx ON academy_notifications (user_id, id DESC);

CREATE TABLE IF NOT EXISTS academy_likes (
  kind       TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, item_id, user_id)
);

COMMIT;
