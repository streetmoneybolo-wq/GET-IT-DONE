BEGIN;
-- Put back the editions members had chosen before the reset, if the copy is still there.
UPDATE academy_state_kv AS live
   SET value = saved.value, updated_at = now()
  FROM academy_state_kv AS saved
 WHERE live.key = 'academy-editions'
   AND saved.key = 'academy-editions-before-reset-2026-10-21';
COMMIT;
