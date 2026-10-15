BEGIN;

DROP TABLE IF EXISTS academy_presence;
DROP INDEX IF EXISTS academy_follows_followed_idx;
DROP TABLE IF EXISTS academy_follows;
DROP TABLE IF EXISTS academy_profiles;

COMMIT;
