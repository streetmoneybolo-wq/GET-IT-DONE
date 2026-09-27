-- Academy alerts desk: each member's own alert sources. A row follows one Discord channel, either every poster in it (author_id = '') or one
-- poster (author_id = their Discord user ID). The desk starts empty; members add servers' channels they can already read in Discord.

BEGIN;

CREATE TABLE IF NOT EXISTS academy_alert_sources (
  discord_id  TEXT NOT NULL,
  guild_id    TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  author_id   TEXT NOT NULL DEFAULT '',
  style       TEXT NOT NULL DEFAULT 'swings' CHECK (style IN ('swings', 'longterm')),
  label       TEXT NOT NULL DEFAULT '',
  guild_name  TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (discord_id, channel_id, author_id)
);

CREATE INDEX IF NOT EXISTS academy_alert_sources_channel_idx ON academy_alert_sources (channel_id);

COMMIT;
