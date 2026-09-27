-- Rules quiz on the verification page: count wrong attempts so a member who
-- fails three times is held for a moderator instead of retrying forever.

BEGIN;

ALTER TABLE discord_verifications ADD COLUMN IF NOT EXISTS quiz_attempts INTEGER NOT NULL DEFAULT 0;

COMMIT;
