-- Academy member profiles: the page a member customizes (layout, theme, song, social links, what to show),
-- who follows whom inside the Academy, and how many minutes a member has spent in the Activity per Discord
-- server (their "main server"). Posts come from academy_chat_messages; paper accounts from academy_state_kv.
BEGIN;

CREATE TABLE IF NOT EXISTS academy_profiles (
  discord_id   TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  tagline      TEXT NOT NULL DEFAULT '',
  bio          TEXT NOT NULL DEFAULT '',
  layout       TEXT NOT NULL DEFAULT 'classic',
  theme        JSONB NOT NULL DEFAULT '{}'::jsonb,
  song         JSONB,
  socials      JSONB NOT NULL DEFAULT '[]'::jsonb,
  flags        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS academy_follows (
  follower_id TEXT NOT NULL,
  followed_id TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followed_id)
);
CREATE INDEX IF NOT EXISTS academy_follows_followed_idx ON academy_follows (followed_id);

CREATE TABLE IF NOT EXISTS academy_presence (
  discord_id TEXT NOT NULL,
  guild_id   TEXT NOT NULL,
  minutes    INTEGER NOT NULL DEFAULT 0,
  last_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (discord_id, guild_id)
);

COMMIT;
