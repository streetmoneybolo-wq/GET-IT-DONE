BEGIN;
-- Web push devices (the PWA shell) carry their encryption keys (p256dh, auth) beside the endpoint
-- that app_push_devices.token already holds. Native devices leave it null.
ALTER TABLE app_push_devices ADD COLUMN IF NOT EXISTS keys jsonb;
ALTER TABLE app_push_devices ADD COLUMN IF NOT EXISTS disabled_reason text;
COMMIT;
