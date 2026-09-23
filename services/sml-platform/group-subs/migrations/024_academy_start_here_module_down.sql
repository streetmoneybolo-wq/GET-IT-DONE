-- Restores the 019 "> 0" checks. Module 0 rows must be removed first or the
-- re-added checks fail; this is intentional so a rollback cannot silently
-- discard Start Here progress.

BEGIN;

ALTER TABLE academy_students ALTER COLUMN current_module SET DEFAULT 1;

ALTER TABLE academy_students DROP CONSTRAINT IF EXISTS academy_students_current_module_nonnegative;
ALTER TABLE academy_students ADD CONSTRAINT academy_students_current_module_check CHECK (current_module > 0);

ALTER TABLE academy_progress DROP CONSTRAINT IF EXISTS academy_progress_module_id_nonnegative;
ALTER TABLE academy_progress ADD CONSTRAINT academy_progress_module_id_check CHECK (module_id > 0);

ALTER TABLE academy_content DROP CONSTRAINT IF EXISTS academy_content_module_id_nonnegative;
ALTER TABLE academy_content ADD CONSTRAINT academy_content_module_id_check CHECK (module_id > 0);

ALTER TABLE academy_quizzes DROP CONSTRAINT IF EXISTS academy_quizzes_module_id_nonnegative;
ALTER TABLE academy_quizzes ADD CONSTRAINT academy_quizzes_module_id_check CHECK (module_id > 0);

COMMIT;
