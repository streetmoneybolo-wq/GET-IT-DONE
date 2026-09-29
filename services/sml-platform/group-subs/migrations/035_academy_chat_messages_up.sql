-- The Academy in-app chat: switchable topic channels (day trade, swing trade, short sale, options
-- trading — the fixed set lives in code, in academy-chat.js), not one per Discord server. A row is
-- one posted message; a member can delete their own. No moderation table yet (report/mute is a
-- fast-follow) — this only needs enough to post, broadcast and show history per channel.

BEGIN;

CREATE TABLE IF NOT EXISTS academy_chat_messages (
  id          BIGSERIAL PRIMARY KEY,
  channel     TEXT NOT NULL,
  discord_id  TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS academy_chat_messages_channel_idx ON academy_chat_messages (channel, id DESC);
CREATE INDEX IF NOT EXISTS academy_chat_messages_discord_id_idx ON academy_chat_messages (discord_id);

COMMIT;
