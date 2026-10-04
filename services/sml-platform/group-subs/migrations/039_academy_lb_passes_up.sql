-- Academy access bought with Loop Bucks. One row per purchase; ref is the unique wallet charge key (a retry never double-charges).
-- expires_at NULL = lifetime. status 'refunded' passes no longer grant access.
BEGIN;

CREATE TABLE IF NOT EXISTS academy_lb_passes (
  id          BIGSERIAL PRIMARY KEY,
  discord_id  TEXT NOT NULL,
  wp_user_id  BIGINT,
  plan        TEXT NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  ref         TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'refunded')),
  starts_at   TIMESTAMPTZ NOT NULL,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS academy_lb_passes_discord_idx ON academy_lb_passes (discord_id, status, expires_at);

COMMIT;
