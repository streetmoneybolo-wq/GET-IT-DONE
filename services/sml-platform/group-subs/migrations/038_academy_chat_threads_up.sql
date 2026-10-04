-- Reddit-style chat: replies (parent_id), up/down votes (one per member per message) and soft-deleted parents that keep their replies.
BEGIN;

ALTER TABLE academy_chat_messages ADD COLUMN IF NOT EXISTS parent_id BIGINT;
ALTER TABLE academy_chat_messages ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS academy_chat_messages_parent_idx ON academy_chat_messages (parent_id) WHERE parent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS academy_chat_votes (
  message_id BIGINT NOT NULL,
  voter_id   TEXT NOT NULL,
  value      SMALLINT NOT NULL CHECK (value IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, voter_id)
);

COMMIT;
