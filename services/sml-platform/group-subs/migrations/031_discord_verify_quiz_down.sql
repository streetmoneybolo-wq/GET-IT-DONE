BEGIN;

ALTER TABLE discord_verifications DROP COLUMN IF EXISTS quiz_attempts;

COMMIT;
