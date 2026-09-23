-- Where a student left off inside the Activity: the lesson being narrated,
-- the slide and playback position, and the chart symbol/timeframe. One row
-- per student (and so per guild + Discord member); nothing else is stored.

BEGIN;

CREATE TABLE academy_activity_resume (
  student_id BIGINT PRIMARY KEY REFERENCES academy_students(id) ON DELETE CASCADE,
  module_id INT NOT NULL CHECK (module_id >= 0),
  lesson_id INT NOT NULL CHECK (lesson_id > 0),
  narration_part INT NOT NULL DEFAULT 0 CHECK (narration_part BETWEEN 0 AND 50),
  narration_ms INT NOT NULL DEFAULT 0 CHECK (narration_ms BETWEEN 0 AND 3600000),
  symbol TEXT CHECK (symbol IS NULL OR symbol ~ '^[A-Z0-9.:-]{1,10}$'),
  timeframe TEXT CHECK (timeframe IS NULL OR timeframe IN ('1m','3m','5m','15m','1h','1D')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
