BEGIN;
ALTER TABLE app_push_devices DROP COLUMN IF EXISTS disabled_reason;
ALTER TABLE app_push_devices DROP COLUMN IF EXISTS keys;
COMMIT;
