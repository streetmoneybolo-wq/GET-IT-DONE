BEGIN;
-- The free trial is a pass that cost nothing: the amount check allows zero. plan 'trial', ref 'acad-trial:<discord id>' (one per account).
ALTER TABLE academy_lb_passes DROP CONSTRAINT IF EXISTS academy_lb_passes_amount_check;
ALTER TABLE academy_lb_passes ADD CONSTRAINT academy_lb_passes_amount_check CHECK (amount >= 0);
COMMIT;
