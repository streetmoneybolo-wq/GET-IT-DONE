-- Ask Obi log: every question and answer, with the direction the answer called (up / down / flat), its subject and horizon,
-- and an outcome column a later scoring pass fills in, so Obi's calls can be backtested.
BEGIN;

CREATE TABLE IF NOT EXISTS academy_ask_log (
  id             BIGSERIAL PRIMARY KEY,
  user_id        TEXT NOT NULL,
  question       TEXT NOT NULL,
  answer         TEXT NOT NULL,
  model          TEXT NOT NULL DEFAULT '',
  asks_direction BOOLEAN NOT NULL DEFAULT false,
  direction      TEXT,
  subject        TEXT,
  horizon        TEXT,
  context        TEXT,
  outcome        TEXT,
  outcome_note   TEXT,
  scored_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS academy_ask_log_created_idx ON academy_ask_log (created_at DESC);

COMMIT;
