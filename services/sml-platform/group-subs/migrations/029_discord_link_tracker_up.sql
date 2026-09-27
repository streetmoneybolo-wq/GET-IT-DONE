-- Discord tracked links. A server manager posts an external link through the
-- StockMarketLoop Connect bot as a button; every tap is a Discord interaction,
-- which carries the tapping member's Discord user id and username. Each tap is
-- recorded here before the member receives the real link. Only people who tap
-- the button are recorded, and the posted message tells them so.

BEGIN;

CREATE TABLE IF NOT EXISTS discord_tracked_links (
  id          BIGSERIAL PRIMARY KEY,
  guild_id    TEXT NOT NULL,
  channel_id  TEXT,
  url         TEXT NOT NULL,
  label       TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT discord_tracked_links_url_https CHECK (url ~ '^https?://')
);
CREATE INDEX IF NOT EXISTS discord_tracked_links_guild_idx ON discord_tracked_links (guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS discord_link_clicks (
  id              BIGSERIAL PRIMARY KEY,
  link_id         BIGINT NOT NULL REFERENCES discord_tracked_links (id) ON DELETE CASCADE,
  guild_id        TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  username        TEXT,
  clicked_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS discord_link_clicks_link_idx ON discord_link_clicks (link_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS discord_link_clicks_user_idx ON discord_link_clicks (link_id, discord_user_id);

COMMIT;
