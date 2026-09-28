-- 033 DOWN: remove the connection/device signals from tracked-link taps.

BEGIN;

DROP INDEX IF EXISTS discord_link_clicks_opened_idx;
DROP INDEX IF EXISTS discord_link_clicks_ip_idx;
DROP INDEX IF EXISTS discord_link_clicks_device_idx;
DROP INDEX IF EXISTS discord_link_clicks_token_idx;

ALTER TABLE discord_link_clicks
  DROP COLUMN IF EXISTS flags,
  DROP COLUMN IF EXISTS screen,
  DROP COLUMN IF EXISTS languages,
  DROP COLUMN IF EXISTS timezone,
  DROP COLUMN IF EXISTS user_agent,
  DROP COLUMN IF EXISTS device_id_hash,
  DROP COLUMN IF EXISTS country,
  DROP COLUMN IF EXISTS net_hash,
  DROP COLUMN IF EXISTS ip_hash,
  DROP COLUMN IF EXISTS opened_at,
  DROP COLUMN IF EXISTS token_hash;

COMMIT;
