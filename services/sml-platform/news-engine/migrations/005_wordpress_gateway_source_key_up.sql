-- D5: deduplicate delivery retries emitted by trusted WordPress producers.
-- event_id remains the primary transport idempotency key. source_event_key is
-- optional and identifies the underlying WordPress change across retries.

BEGIN;

ALTER TABLE wordpress_gateway_events
  ADD COLUMN source_event_key UUID;

CREATE UNIQUE INDEX wordpress_gateway_events_source_key_unique
  ON wordpress_gateway_events (source_event_key)
  WHERE source_event_key IS NOT NULL;

COMMENT ON COLUMN wordpress_gateway_events.source_event_key IS
  'Optional stable UUID supplied by a trusted WordPress producer so retried deliveries are recorded once.';

COMMIT;
