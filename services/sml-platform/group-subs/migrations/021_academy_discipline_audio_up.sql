BEGIN;

CREATE TABLE academy_discipline_audio_progress (
  student_id BIGINT PRIMARY KEY REFERENCES academy_students(id) ON DELETE CASCADE,
  episode_index INT NOT NULL DEFAULT 1 CHECK (episode_index > 0),
  part_index INT NOT NULL DEFAULT 0 CHECK (part_index >= 0),
  playback_ms INT NOT NULL DEFAULT 0 CHECK (playback_ms >= 0),
  unlocked_on DATE NOT NULL DEFAULT CURRENT_DATE,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
