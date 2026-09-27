-- Discord verification gate. New members tap "Verify" in the server, open a
-- one-time page, and the platform screens the visit before granting the role
-- that lets them post. Raw IP addresses are never stored: only keyed hashes
-- (for spotting the same network or device behind several accounts) and the
-- country the edge network reports. Rows are purged after 180 days.

BEGIN;

CREATE TABLE IF NOT EXISTS discord_verify_config (
  guild_id          TEXT PRIMARY KEY,
  verified_role_id  TEXT NOT NULL,
  log_channel_id    TEXT,
  min_account_days  INTEGER NOT NULL DEFAULT 7,
  mode              TEXT NOT NULL DEFAULT 'auto',
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by        TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT discord_verify_config_mode CHECK (mode IN ('auto', 'review')),
  CONSTRAINT discord_verify_config_days CHECK (min_account_days BETWEEN 0 AND 365)
);

CREATE TABLE IF NOT EXISTS discord_verifications (
  id                 BIGSERIAL PRIMARY KEY,
  guild_id           TEXT NOT NULL,
  discord_user_id    TEXT NOT NULL,
  username           TEXT,
  account_created_at TIMESTAMPTZ,
  token_hash         TEXT NOT NULL UNIQUE,
  token_expires_at   TIMESTAMPTZ NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending',
  ip_hash            TEXT,
  net_hash           TEXT,
  country            TEXT,
  device_id_hash     TEXT,
  user_agent         TEXT,
  timezone           TEXT,
  languages          TEXT,
  screen             TEXT,
  flags              JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at       TIMESTAMPTZ,
  decided_at         TIMESTAMPTZ,
  decided_by         TEXT,
  CONSTRAINT discord_verifications_status CHECK (status IN ('pending', 'passed', 'held', 'denied', 'expired'))
);
CREATE INDEX IF NOT EXISTS discord_verifications_member_idx ON discord_verifications (guild_id, discord_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS discord_verifications_ip_idx ON discord_verifications (guild_id, ip_hash) WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS discord_verifications_device_idx ON discord_verifications (guild_id, device_id_hash) WHERE device_id_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS discord_verifications_created_idx ON discord_verifications (created_at);

COMMIT;
