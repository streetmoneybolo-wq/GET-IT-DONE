BEGIN;

CREATE TABLE alert_routes (
  id                    BIGSERIAL PRIMARY KEY,
  group_id              BIGINT      NOT NULL CHECK (group_id > 0),
  owner_user_id         BIGINT      NOT NULL CHECK (owner_user_id > 0),
  name                   TEXT        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  source_provider        TEXT        NOT NULL CHECK (source_provider IN ('sml','discord','telegram')),
  source_target_id       TEXT        NOT NULL CHECK (length(source_target_id) BETWEEN 1 AND 120),
  enabled                BOOLEAN     NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, source_provider, source_target_id)
);

CREATE TABLE alert_route_destinations (
  id                    BIGSERIAL PRIMARY KEY,
  route_id              BIGINT      NOT NULL REFERENCES alert_routes(id) ON DELETE CASCADE,
  provider              TEXT        NOT NULL CHECK (provider IN ('sml','discord','telegram')),
  target_id             TEXT        NOT NULL CHECK (length(target_id) BETWEEN 1 AND 120),
  enabled               BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (route_id, provider, target_id)
);

CREATE TABLE alert_events (
  id                    BIGSERIAL PRIMARY KEY,
  event_key             TEXT        NOT NULL UNIQUE,
  group_id              BIGINT      NOT NULL CHECK (group_id > 0),
  source_provider       TEXT        NOT NULL CHECK (source_provider IN ('sml','discord','telegram')),
  source_target_id      TEXT        NOT NULL,
  source_message_id     TEXT        NOT NULL,
  author_external_id    TEXT,
  author_name           TEXT,
  body                  TEXT        NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  attachments           JSONB       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attachments) = 'array'),
  occurred_at           TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_provider, source_target_id, source_message_id)
);

CREATE TABLE alert_deliveries (
  id                    BIGSERIAL PRIMARY KEY,
  event_id              BIGINT      NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  destination_id        BIGINT      NOT NULL REFERENCES alert_route_destinations(id) ON DELETE CASCADE,
  status                TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','delivered','retry','failed')),
  attempts              INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at             TIMESTAMPTZ,
  destination_message_id TEXT,
  last_error            TEXT,
  delivered_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, destination_id)
);

CREATE TABLE alert_route_cursors (
  route_id              BIGINT PRIMARY KEY REFERENCES alert_routes(id) ON DELETE CASCADE,
  last_external_id      TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX alert_routes_source_active_idx
  ON alert_routes (source_provider, source_target_id) WHERE enabled;
CREATE INDEX alert_deliveries_ready_idx
  ON alert_deliveries (next_attempt_at, id) WHERE status IN ('pending','retry');

COMMENT ON TABLE alert_routes IS
  'Creator-owned alert inputs. A route is inert until it has at least one enabled destination.';
COMMENT ON TABLE alert_events IS
  'Canonical idempotency ledger for SML, Discord, and Telegram alerts.';
COMMENT ON TABLE alert_deliveries IS
  'Durable fan-out outbox. A unique event/destination pair prevents duplicate cross-posts.';

COMMIT;
