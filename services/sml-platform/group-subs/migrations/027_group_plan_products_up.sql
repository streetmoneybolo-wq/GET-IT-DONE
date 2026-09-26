-- Owner-created membership products. A group owner names a product, gives it a
-- description, a price and a billing interval; the platform creates the Stripe
-- Product + recurring Price and stores both here. Sellers also track whether
-- Stripe has activated card_payments on their connected account, which is what
-- lets a subscription be charged on_behalf_of them (the sale then appears in
-- their own Stripe dashboard with the product name, description and price).

BEGIN;

ALTER TABLE group_plans
  ADD COLUMN IF NOT EXISTS description        TEXT,
  ADD COLUMN IF NOT EXISTS stripe_product_id  TEXT,
  ADD COLUMN IF NOT EXISTS interval_count     INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS archived_at        TIMESTAMPTZ;

ALTER TABLE group_plans
  ADD CONSTRAINT group_plans_interval_count_sane CHECK (interval_count BETWEEN 1 AND 12);

ALTER TABLE marketplace_sellers
  ADD COLUMN IF NOT EXISTS card_payments_enabled BOOLEAN NOT NULL DEFAULT false;

COMMIT;
