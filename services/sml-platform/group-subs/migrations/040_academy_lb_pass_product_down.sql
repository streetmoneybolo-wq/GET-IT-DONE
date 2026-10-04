BEGIN;

DROP INDEX IF EXISTS academy_lb_passes_product_idx;
ALTER TABLE academy_lb_passes DROP COLUMN IF EXISTS product;

COMMIT;
