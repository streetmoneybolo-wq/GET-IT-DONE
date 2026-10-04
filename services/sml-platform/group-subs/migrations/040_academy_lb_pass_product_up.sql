-- Loop Bucks passes now cover more than one product: 'academy' (default, every existing row) and 'click_alert' (the Click-to-Alert add-on).
BEGIN;

ALTER TABLE academy_lb_passes ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'academy';
CREATE INDEX IF NOT EXISTS academy_lb_passes_product_idx ON academy_lb_passes (discord_id, product, status, expires_at);

COMMIT;
