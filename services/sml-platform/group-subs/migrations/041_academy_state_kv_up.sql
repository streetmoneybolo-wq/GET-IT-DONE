BEGIN;
-- Small durable key/value store for Academy state that used to live in /tmp or process memory
-- (MEM LAB champion + runs, sentiment baselines). One JSON document per key.
CREATE TABLE IF NOT EXISTS academy_state_kv (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
