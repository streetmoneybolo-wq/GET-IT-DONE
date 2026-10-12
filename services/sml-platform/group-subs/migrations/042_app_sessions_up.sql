BEGIN;
-- Mobile app API v1: refresh-token sessions and native push device tokens.
-- One row per issued refresh token. Rotation inserts a new row in the same family and
-- marks the old one replaced; presenting a replaced token again revokes the whole family.
CREATE TABLE IF NOT EXISTS app_sessions (
  id             uuid PRIMARY KEY,
  family         uuid NOT NULL,
  user_id        bigint NOT NULL,
  refresh_hash   text NOT NULL UNIQUE,
  device_id      text NOT NULL DEFAULT '',
  device_name    text NOT NULL DEFAULT '',
  platform       text NOT NULL DEFAULT '',
  app_version    text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_reason text,
  replaced_by    uuid
);
CREATE INDEX IF NOT EXISTS app_sessions_user_idx ON app_sessions (user_id, revoked_at);
CREATE INDEX IF NOT EXISTS app_sessions_family_idx ON app_sessions (family);

-- Device tokens registered by the app for native push (APNs / FCM). Registration only:
-- the senders are a later step. A token belongs to one user at a time.
CREATE TABLE IF NOT EXISTS app_push_devices (
  id           bigserial PRIMARY KEY,
  user_id      bigint NOT NULL,
  platform     text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  token        text NOT NULL UNIQUE,
  device_id    text NOT NULL DEFAULT '',
  app_version  text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  disabled_at  timestamptz
);
CREATE INDEX IF NOT EXISTS app_push_devices_user_idx ON app_push_devices (user_id);
COMMIT;
