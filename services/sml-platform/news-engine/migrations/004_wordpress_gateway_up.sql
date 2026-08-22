-- =============================================================================
-- StockMarketLoop platform — WordPress gateway event ledger
--
-- This table is intentionally an intake ledger, not a command bus. The gateway
-- authenticates a small explicit event allowlist and records each event ID once.
-- No accepted event publishes content, changes a subscription, or modifies a
-- user. Downstream consumers are added only as separately reviewed work.
-- =============================================================================

BEGIN;

CREATE TYPE wordpress_gateway_event_status AS ENUM ('accepted', 'processed', 'failed');

CREATE TABLE wordpress_gateway_events (
  id            BIGSERIAL PRIMARY KEY,
  event_id      UUID NOT NULL UNIQUE,
  event_type    TEXT NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  actor_user_id BIGINT,
  subject_type  TEXT,
  subject_id    TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_hash  CHAR(64) NOT NULL,
  status        wordpress_gateway_event_status NOT NULL DEFAULT 'accepted',
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ,
  failure_reason TEXT,
  CONSTRAINT wordpress_gateway_event_type_known CHECK (event_type IN (
    'system.integration.ping',
    'creator.channel.updated',
    'creator.letter.published',
    'group.member.changed',
    'news.article.published'
  )),
  CONSTRAINT wordpress_gateway_actor_positive CHECK (actor_user_id IS NULL OR actor_user_id > 0),
  CONSTRAINT wordpress_gateway_subject_pair CHECK (
    (subject_type IS NULL AND subject_id IS NULL) OR
    (subject_type IS NOT NULL AND subject_id IS NOT NULL)
  ),
  CONSTRAINT wordpress_gateway_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT wordpress_gateway_hash_format CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT wordpress_gateway_processed_pair CHECK (
    (status = 'processed' AND processed_at IS NOT NULL) OR
    (status <> 'processed' AND processed_at IS NULL)
  )
);

COMMENT ON TABLE wordpress_gateway_events IS
  'Replay-safe intake ledger for HMAC-authenticated events sent by WordPress. No handler acts on an event until a separately reviewed consumer is added.';

CREATE INDEX wordpress_gateway_events_pending_idx
  ON wordpress_gateway_events (received_at)
  WHERE status = 'accepted';
CREATE INDEX wordpress_gateway_events_type_idx
  ON wordpress_gateway_events (event_type, received_at DESC);
CREATE INDEX wordpress_gateway_events_subject_idx
  ON wordpress_gateway_events (subject_type, subject_id, received_at DESC)
  WHERE subject_type IS NOT NULL;

COMMIT;
