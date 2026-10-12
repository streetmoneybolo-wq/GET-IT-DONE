-- @mentions in the Academy live chat: members are tagged by display name, so academy_students keeps
-- the name the member signed in with and when they were last in the app (the picker only offers
-- members who have used the Academy); each message records who it tagged.
BEGIN;

ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS academy_students_seen_idx ON academy_students (guild_id, last_seen_at DESC);

ALTER TABLE academy_chat_messages ADD COLUMN IF NOT EXISTS mentions JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
