BEGIN;

-- Marketplace sellers are Stripe Connect accounts. Negative seller balances
-- are tracked here and recovered from later earnings; the platform never
-- invents a second balance inside Stripe.
CREATE TABLE marketplace_sellers (
  id                         BIGSERIAL PRIMARY KEY,
  owner_user_id              BIGINT      NOT NULL,
  connected_account_id       TEXT        NOT NULL,
  charges_enabled            BOOLEAN     NOT NULL DEFAULT false,
  payouts_enabled            BOOLEAN     NOT NULL DEFAULT false,
  details_submitted          BOOLEAN     NOT NULL DEFAULT false,
  seller_terms_accepted_at   TIMESTAMPTZ,
  dispute_debit_consent_at   TIMESTAMPTZ,
  currency                   TEXT        NOT NULL DEFAULT 'usd',
  debt_cents                 BIGINT      NOT NULL DEFAULT 0,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_sellers_owner_uniq UNIQUE (owner_user_id),
  CONSTRAINT marketplace_sellers_account_uniq UNIQUE (connected_account_id),
  CONSTRAINT marketplace_sellers_debt_nonneg CHECK (debt_cents >= 0)
);

ALTER TABLE subscriptions
  ADD COLUMN membership_checkout_key TEXT,
  ADD COLUMN stripe_checkout_session_id TEXT;
CREATE UNIQUE INDEX subscriptions_checkout_key_uniq ON subscriptions (membership_checkout_key)
  WHERE membership_checkout_key IS NOT NULL;
CREATE UNIQUE INDEX subscriptions_checkout_session_uniq ON subscriptions (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

-- Prices are server-owned. A browser may select a package id but may never
-- submit the money or LB amount that will be charged/credited.
CREATE TABLE loop_buck_packages (
  id                  BIGSERIAL PRIMARY KEY,
  slug                TEXT        NOT NULL UNIQUE,
  loop_bucks          INTEGER     NOT NULL,
  price_cents         INTEGER     NOT NULL,
  currency            TEXT        NOT NULL DEFAULT 'usd',
  stripe_tax_code     TEXT,
  active              BOOLEAN     NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT loop_buck_packages_lb_positive CHECK (loop_bucks > 0),
  CONSTRAINT loop_buck_packages_price_positive CHECK (price_cents > 0)
);

INSERT INTO loop_buck_packages (slug, loop_bucks, price_cents) VALUES
  ('lb-500',    500,    500),
  ('lb-1200',   1200,  1000),
  ('lb-2000',   2000,  1500),
  ('lb-3000',   3000,  2000),
  ('lb-5000',   5000,  2500),
  ('lb-15000', 15000,  5000),
  ('lb-35000', 35000, 10000);

CREATE TYPE loop_buck_order_status AS ENUM (
  'created','checkout_open','paid','credited','expired','refunded','disputed','chargeback'
);

CREATE TABLE loop_buck_orders (
  id                         BIGSERIAL PRIMARY KEY,
  order_key                  TEXT        NOT NULL UNIQUE,
  user_id                    BIGINT      NOT NULL,
  package_id                 BIGINT      NOT NULL REFERENCES loop_buck_packages(id),
  loop_bucks                 INTEGER     NOT NULL,
  subtotal_cents             INTEGER     NOT NULL,
  service_fee_cents          INTEGER     NOT NULL,
  tax_cents                  INTEGER     NOT NULL DEFAULT 0,
  total_cents                INTEGER     NOT NULL,
  currency                   TEXT        NOT NULL DEFAULT 'usd',
  status                     loop_buck_order_status NOT NULL DEFAULT 'created',
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id   TEXT UNIQUE,
  stripe_charge_id           TEXT UNIQUE,
  paid_at                    TIMESTAMPTZ,
  credited_at                TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT loop_buck_orders_lb_positive CHECK (loop_bucks > 0),
  CONSTRAINT loop_buck_orders_money_nonneg CHECK (
    subtotal_cents > 0 AND service_fee_cents >= 0 AND tax_cents >= 0 AND total_cents > 0
  ),
  CONSTRAINT loop_buck_orders_total_matches CHECK (
    total_cents = subtotal_cents + service_fee_cents + tax_cents
  )
);

-- This outbox is the only bridge allowed to credit the existing WordPress
-- Loop Bucks engine. Unique source keys make webhook replay harmless on both
-- sides. A worker delivers it after the payment transaction commits.
CREATE TABLE billing_outbox (
  id             BIGSERIAL PRIMARY KEY,
  source_key     TEXT        NOT NULL UNIQUE,
  intent_type    TEXT        NOT NULL,
  payload        JSONB       NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'pending',
  attempts       INTEGER     NOT NULL DEFAULT 0,
  available_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at     TIMESTAMPTZ,
  processed_at   TIMESTAMPTZ,
  last_error     TEXT,
  debt_recorded_cents INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT billing_outbox_status_check CHECK (status IN ('pending','processing','processed','failed')),
  CONSTRAINT billing_outbox_attempts_nonneg CHECK (attempts >= 0),
  CONSTRAINT billing_outbox_debt_nonneg CHECK (debt_recorded_cents >= 0)
);
CREATE INDEX billing_outbox_pending_idx ON billing_outbox (available_at, id)
  WHERE status IN ('pending','failed');

CREATE TYPE seller_ledger_kind AS ENUM (
  'membership_fee','seller_earning','refund','dispute_hold','dispute_reversal',
  'dispute_fee','debt_recovery','manual_adjustment'
);

CREATE TABLE seller_ledger (
  id                    BIGSERIAL PRIMARY KEY,
  seller_id             BIGINT      NOT NULL REFERENCES marketplace_sellers(id),
  source_key            TEXT        NOT NULL UNIQUE,
  kind                  seller_ledger_kind NOT NULL,
  amount_cents          BIGINT      NOT NULL,
  currency              TEXT        NOT NULL DEFAULT 'usd',
  stripe_object_id      TEXT,
  related_dispute_id    TEXT,
  metadata              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT seller_ledger_amount_nonzero CHECK (amount_cents <> 0)
);
CREATE INDEX seller_ledger_seller_idx ON seller_ledger (seller_id, created_at DESC);

CREATE TYPE dispute_state AS ENUM ('needs_response','under_review','won','lost','warning_closed');

CREATE TABLE marketplace_disputes (
  stripe_dispute_id          TEXT PRIMARY KEY,
  seller_id                  BIGINT      NOT NULL REFERENCES marketplace_sellers(id),
  stripe_charge_id           TEXT        NOT NULL,
  disputed_principal_cents   INTEGER     NOT NULL,
  platform_dispute_fee_cents INTEGER     NOT NULL,
  currency                   TEXT        NOT NULL DEFAULT 'usd',
  state                      dispute_state NOT NULL,
  fee_finalized_at           TIMESTAMPTZ,
  resolved_at                TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_disputes_principal_positive CHECK (disputed_principal_cents > 0),
  CONSTRAINT marketplace_disputes_fee_nonneg CHECK (platform_dispute_fee_cents >= 0)
);

CREATE OR REPLACE FUNCTION set_updated_at_marketplace()
RETURNS TRIGGER AS $BODY$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$BODY$ LANGUAGE plpgsql;

CREATE TRIGGER marketplace_sellers_touch BEFORE UPDATE ON marketplace_sellers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_marketplace();
CREATE TRIGGER loop_buck_orders_touch BEFORE UPDATE ON loop_buck_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_marketplace();
CREATE TRIGGER marketplace_disputes_touch BEFORE UPDATE ON marketplace_disputes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_marketplace();

COMMIT;
