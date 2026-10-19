-- Premium Academy Alert Charts sold through the stockmarketloop.com marketplace (platform/alert-chart-billing.js).
-- A trader's consents and seller link, every checkout/subscription (keyed for the Stripe webhook), the charges a
-- dispute can be matched to, and which product a marketplace dispute is about with the facts it is decided on.
-- The platform also creates these on start (CREATE IF NOT EXISTS), so this migration is idempotent.
BEGIN;

CREATE TABLE IF NOT EXISTS alert_chart_sellers (
  trader_discord_id         TEXT PRIMARY KEY,
  wp_user_id                BIGINT NOT NULL,
  seller_id                 BIGINT,
  terms_accepted_at         TIMESTAMPTZ,
  fee_bps_accepted          INTEGER NOT NULL DEFAULT 600,
  dispute_fee_bps_accepted  INTEGER NOT NULL DEFAULT 1500,
  activity_rule_accepted_at TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_chart_subscriptions (
  id                         BIGSERIAL PRIMARY KEY,
  checkout_key               TEXT NOT NULL UNIQUE,
  subscriber_discord_id      TEXT NOT NULL,
  subscriber_wp_user_id      BIGINT,
  trader_discord_id          TEXT NOT NULL,
  trader_wp_user_id          BIGINT NOT NULL,
  seller_id                  BIGINT NOT NULL,
  connected_account_id       TEXT NOT NULL,
  plan                       TEXT NOT NULL,
  price_cents                INTEGER NOT NULL,
  currency                   TEXT NOT NULL DEFAULT 'usd',
  platform_fee_bps           INTEGER NOT NULL DEFAULT 600,
  status                     TEXT NOT NULL DEFAULT 'checkout_open',
  stripe_checkout_session_id TEXT,
  stripe_subscription_id     TEXT,
  stripe_customer_id         TEXT,
  stripe_payment_intent_id   TEXT,
  access_until               TIMESTAMPTZ,
  paid_at                    TIMESTAMPTZ,
  canceled_at                TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alert_chart_subscriptions_stripe_sub_idx ON alert_chart_subscriptions (stripe_subscription_id);
CREATE INDEX IF NOT EXISTS alert_chart_subscriptions_pair_idx ON alert_chart_subscriptions (subscriber_discord_id, trader_discord_id);

CREATE TABLE IF NOT EXISTS alert_chart_charges (
  stripe_payment_intent_id TEXT PRIMARY KEY,
  stripe_charge_id         TEXT,
  subscription_id          BIGINT NOT NULL,
  amount_cents             INTEGER NOT NULL,
  currency                 TEXT NOT NULL DEFAULT 'usd',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alert_chart_charges_charge_idx ON alert_chart_charges (stripe_charge_id);

CREATE TABLE IF NOT EXISTS academy_alert_access (
  member_id  TEXT NOT NULL,
  trader_id  TEXT NOT NULL,
  plan       TEXT NOT NULL,
  until      TIMESTAMPTZ,
  source     TEXT NOT NULL DEFAULT '',
  reference  TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, trader_id)
);

ALTER TABLE marketplace_disputes ADD COLUMN IF NOT EXISTS kind    TEXT  NOT NULL DEFAULT 'membership';
ALTER TABLE marketplace_disputes ADD COLUMN IF NOT EXISTS context JSONB NOT NULL DEFAULT '{}';

COMMIT;
