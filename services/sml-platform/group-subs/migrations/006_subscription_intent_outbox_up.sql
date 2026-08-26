BEGIN;

-- lifecycle.handleEvent uses this persisted watermark to reject a late Stripe
-- delivery. Migration 003 documented the rule but omitted the column.
ALTER TABLE subscriptions
  ADD COLUMN last_event_at TIMESTAMPTZ;

-- Side effects emitted by lifecycle.handleEvent must be committed atomically
-- with the Stripe event and subscription mutation. Workers deliver these rows;
-- a webhook request never calls Discord or notification providers directly.
CREATE TABLE subscription_intent_outbox (
  id            BIGSERIAL PRIMARY KEY,
  event_id      TEXT        NOT NULL REFERENCES stripe_events(event_id) ON DELETE CASCADE,
  intent_index  INTEGER     NOT NULL,
  intent_type   TEXT        NOT NULL,
  payload       JSONB       NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending',
  attempts      INTEGER     NOT NULL DEFAULT 0,
  available_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at    TIMESTAMPTZ,
  processed_at  TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subscription_intent_outbox_event_intent_uniq UNIQUE (event_id, intent_index),
  CONSTRAINT subscription_intent_outbox_status_check CHECK (status IN ('pending','processing','processed','failed')),
  CONSTRAINT subscription_intent_outbox_attempts_nonneg CHECK (attempts >= 0)
);

CREATE INDEX subscription_intent_outbox_pending_idx
  ON subscription_intent_outbox (available_at, id)
  WHERE status IN ('pending','failed');

COMMENT ON TABLE subscription_intent_outbox IS
  'Transactional outbox for lifecycle side effects such as role reconciliation and member notifications.';

COMMIT;
