-- Making Easy Money Academy — Discord-native learning foundation.
-- Original curriculum only. No Discord message content, billing data, or DMs
-- are stored in these tables.

BEGIN;

CREATE TABLE academy_students (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_module INT NOT NULL DEFAULT 1 CHECK (current_module > 0),
  current_lesson INT NOT NULL DEFAULT 1 CHECK (current_lesson > 0),
  streak_days INT NOT NULL DEFAULT 0 CHECK (streak_days >= 0),
  streak_last DATE,
  xp INT NOT NULL DEFAULT 0 CHECK (xp >= 0),
  UNIQUE (guild_id, discord_id)
);

CREATE TABLE academy_content (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  module_id INT NOT NULL CHECK (module_id > 0),
  lesson_id INT NOT NULL CHECK (lesson_id > 0),
  content_type TEXT NOT NULL CHECK (content_type IN ('lesson','quiz','challenge','discipline')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 180),
  description TEXT,
  embed_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  quiz_data JSONB,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','published','disabled')),
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (approved_by IS NULL OR created_by IS NULL OR approved_by <> created_by),
  UNIQUE (guild_id, module_id, lesson_id, content_type, version)
);
CREATE INDEX academy_content_published_idx ON academy_content (guild_id, status, module_id, lesson_id);

CREATE TABLE academy_progress (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES academy_students(id) ON DELETE CASCADE,
  module_id INT NOT NULL CHECK (module_id > 0),
  lesson_id INT NOT NULL CHECK (lesson_id > 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  score INT CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  UNIQUE (student_id, module_id, lesson_id)
);

CREATE TABLE academy_quizzes (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES academy_students(id) ON DELETE CASCADE,
  module_id INT NOT NULL CHECK (module_id > 0),
  score INT NOT NULL CHECK (score >= 0),
  total INT NOT NULL CHECK (total > 0 AND score <= total),
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  attempt INT NOT NULL DEFAULT 1 CHECK (attempt > 0),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE academy_badges (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES academy_students(id) ON DELETE CASCADE,
  badge_key TEXT NOT NULL CHECK (badge_key ~ '^[a-z0-9_]{1,64}$'),
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, badge_key)
);

CREATE TABLE academy_flashcard_reviews (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES academy_students(id) ON DELETE CASCADE,
  card_key TEXT NOT NULL CHECK (card_key ~ '^[a-z0-9_.-]{1,100}$'),
  review_count INT NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  ease NUMERIC(4,2) NOT NULL DEFAULT 2.50 CHECK (ease BETWEEN 1.30 AND 3.50),
  due_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reviewed_at TIMESTAMPTZ,
  UNIQUE (student_id, card_key)
);
CREATE INDEX academy_flashcard_due_idx ON academy_flashcard_reviews (student_id, due_at);

CREATE TABLE academy_challenges (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  challenge_date DATE NOT NULL,
  title TEXT NOT NULL,
  chart_data JSONB NOT NULL,
  options JSONB NOT NULL,
  correct_key TEXT NOT NULL CHECK (correct_key ~ '^[A-D]$'),
  explanation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','published','disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, challenge_date)
);

CREATE TABLE academy_challenge_submissions (
  id BIGSERIAL PRIMARY KEY,
  challenge_id BIGINT NOT NULL REFERENCES academy_challenges(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES academy_students(id) ON DELETE CASCADE,
  answer_key TEXT NOT NULL CHECK (answer_key ~ '^[A-D]$'),
  correct BOOLEAN NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, student_id)
);

CREATE TABLE academy_audit_log (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  manager_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','edit','publish','approve','reject','disable','setup')),
  target_type TEXT NOT NULL CHECK (target_type IN ('lesson','quiz','challenge','channel','role')),
  target_id BIGINT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
