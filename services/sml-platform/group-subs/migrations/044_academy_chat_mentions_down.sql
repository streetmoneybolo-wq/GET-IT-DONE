BEGIN;

ALTER TABLE academy_chat_messages DROP COLUMN IF EXISTS mentions;
DROP INDEX IF EXISTS academy_students_seen_idx;
ALTER TABLE academy_students DROP COLUMN IF EXISTS last_seen_at;
ALTER TABLE academy_students DROP COLUMN IF EXISTS display_name;

COMMIT;
