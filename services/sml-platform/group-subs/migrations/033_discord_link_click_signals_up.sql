-- Tracked-link taps go through a one-time /l/<token> page on the platform
-- before the member is sent on. The page notes the connection and device
-- behind the tap the same way the verification page does: keyed hashes only
-- (never the address itself), the edge-reported country, and the browser's
-- user agent, time zone, languages and screen. Flags mark a device, address
-- or network already seen on another account (link taps or verifications).
-- Signals are cleared after 180 days; the tap itself stays.

BEGIN;

ALTER TABLE discord_link_clicks
  ADD COLUMN IF NOT EXISTS token_hash     TEXT,
  ADD COLUMN IF NOT EXISTS opened_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ip_hash        TEXT,
  ADD COLUMN IF NOT EXISTS net_hash       TEXT,
  ADD COLUMN IF NOT EXISTS country        TEXT,
  ADD COLUMN IF NOT EXISTS device_id_hash TEXT,
  ADD COLUMN IF NOT EXISTS user_agent     TEXT,
  ADD COLUMN IF NOT EXISTS timezone       TEXT,
  ADD COLUMN IF NOT EXISTS languages      TEXT,
  ADD COLUMN IF NOT EXISTS screen         TEXT,
  ADD COLUMN IF NOT EXISTS flags          JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS discord_link_clicks_token_idx  ON discord_link_clicks (token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS discord_link_clicks_device_idx ON discord_link_clicks (guild_id, device_id_hash) WHERE device_id_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS discord_link_clicks_ip_idx     ON discord_link_clicks (guild_id, ip_hash) WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS discord_link_clicks_opened_idx ON discord_link_clicks (opened_at) WHERE opened_at IS NOT NULL;

COMMIT;
