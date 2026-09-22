BEGIN;

CREATE TABLE academy_discipline_player_tokens (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  student_id BIGINT NOT NULL REFERENCES academy_students(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX academy_discipline_player_tokens_student_idx ON academy_discipline_player_tokens (student_id, expires_at DESC);

COMMIT;
