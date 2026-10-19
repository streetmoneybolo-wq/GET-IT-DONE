BEGIN;
DELETE FROM academy_lb_passes WHERE amount = 0;
ALTER TABLE academy_lb_passes DROP CONSTRAINT IF EXISTS academy_lb_passes_amount_check;
ALTER TABLE academy_lb_passes ADD CONSTRAINT academy_lb_passes_amount_check CHECK (amount > 0);
COMMIT;
