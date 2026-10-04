-- Alerts sent with the Academy's paid Click-to-Alert add-on: an audit trail and the basis for its rate limits.
-- One row per posted alert. Discord ids are text; prices are as sent (entry = the live price at the click, target = the clicked price).

BEGIN;

CREATE TABLE IF NOT EXISTS academy_click_alerts (
  id          BIGSERIAL PRIMARY KEY,
  discord_id  TEXT NOT NULL,
  guild_id    TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  message_id  TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  side        TEXT NOT NULL CHECK (side IN ('long', 'short')),
  entry       NUMERIC(18, 6) NOT NULL,
  target      NUMERIC(18, 6) NOT NULL,
  stop        NUMERIC(18, 6),
  horizon     TEXT NOT NULL CHECK (horizon IN ('day', 'swing', 'mid', 'long')),
  confidence  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS academy_click_alerts_user_idx ON academy_click_alerts (discord_id, created_at DESC);
CREATE INDEX IF NOT EXISTS academy_click_alerts_channel_idx ON academy_click_alerts (channel_id, created_at DESC);

COMMIT;
