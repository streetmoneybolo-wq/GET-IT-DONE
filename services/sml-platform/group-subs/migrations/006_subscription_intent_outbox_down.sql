BEGIN;

DROP TABLE IF EXISTS subscription_intent_outbox CASCADE;

ALTER TABLE subscriptions
  DROP COLUMN IF EXISTS last_event_at;

COMMIT;
