BEGIN;

DROP TABLE IF EXISTS academy_chat_votes;
DROP INDEX IF EXISTS academy_chat_messages_parent_idx;
ALTER TABLE academy_chat_messages DROP COLUMN IF EXISTS deleted;
ALTER TABLE academy_chat_messages DROP COLUMN IF EXISTS parent_id;

COMMIT;
