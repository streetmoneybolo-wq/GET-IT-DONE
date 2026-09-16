-- =============================================================================
-- 017 — Corporate Accounts
--
-- Institutional publishers (news, finance, research) that pay a one-time fee for
-- a verified badge, weighted feed placement, and discounted in-site ads.
--
-- WHAT LIVES HERE AND WHAT DOES NOT
-- Money, entitlement and the audit trail live in Postgres. The badge, the feed
-- slot and the onboarding pool are WordPress concerns and read a PROJECTION of
-- `status` pushed over the existing gateway. WordPress never decides whether an
-- account is paid — it is told. A feed bug can then cost an impression; it can
-- never grant free placement.
--
-- MONEY IS INTEGER CENTS. group_plans already carries platform_fee_bps in basis
-- points for the same reason: float money reconciles badly, and this table is
-- the record you would produce in a billing dispute.
--
-- Additive. Two new enums, four new tables, no existing table touched.
-- =============================================================================

BEGIN;

CREATE TYPE corporate_status AS ENUM ('pending', 'active', 'suspended', 'closed');

CREATE TYPE corporate_category AS ENUM (
  'news', 'media', 'finance', 'research', 'brokerage', 'data', 'other'
);

-- -----------------------------------------------------------------------------
-- corporate_accounts
-- -----------------------------------------------------------------------------
CREATE TABLE corporate_accounts (
  id               BIGSERIAL PRIMARY KEY,
  -- The WordPress account this fronts. UNIQUE: one corporate identity per user,
  -- or two records could disagree about the same badge.
  wp_user_id       BIGINT      NOT NULL UNIQUE,
  company_name     TEXT        NOT NULL,
  brand_handle     TEXT        NOT NULL,
  website_url      TEXT        NOT NULL,
  logo_url         TEXT,
  description      TEXT,
  category         corporate_category NOT NULL DEFAULT 'other',
  status           corporate_status   NOT NULL DEFAULT 'pending',

  -- VERIFICATION IS DOMAIN-BASED, NOT FORM-BASED.
  -- Anyone can type "Bloomberg" into a signup form; only Bloomberg can publish a
  -- DNS TXT record at bloomberg.com. On a finance platform a convincing
  -- impersonation of a news brand is an existential event, so this is enforced
  -- by a CHECK below rather than left to an application code path.
  verified_domain  TEXT,
  verified_at      TIMESTAMPTZ,
  verified_method  TEXT CHECK (verified_method IN ('dns_txt', 'well_known', 'manual')),

  activated_at     TIMESTAMPTZ,
  suspended_at     TIMESTAMPTZ,
  suspended_reason TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- No badge without proof of identity. The database refuses the combination
  -- rather than trusting every future caller to remember.
  CONSTRAINT corporate_active_requires_verification
    CHECK (status <> 'active' OR verified_at IS NOT NULL),

  -- A verification timestamp with no domain or method behind it is unauditable.
  CONSTRAINT corporate_verification_complete
    CHECK (verified_at IS NULL OR (verified_domain IS NOT NULL AND verified_method IS NOT NULL)),

  CONSTRAINT corporate_suspension_has_reason
    CHECK (status <> 'suspended' OR suspended_reason IS NOT NULL)
);

COMMENT ON TABLE corporate_accounts IS
  'Institutional publisher accounts. WordPress reads a projection of `status`; it never decides entitlement.';
COMMENT ON COLUMN corporate_accounts.verified_domain IS
  'Proven by DNS TXT or /.well-known at the company''s own domain. A form field is not proof of identity.';

-- Case-insensitive, and only for rows that claim a domain: two accounts both
-- claiming cnn.com is the impersonation case this exists to prevent.
CREATE UNIQUE INDEX corporate_accounts_domain_uniq
  ON corporate_accounts (lower(verified_domain))
  WHERE verified_domain IS NOT NULL;

-- Handles collide case-insensitively on this platform (see the nicename
-- collision that mis-resolved /grandmasterobi/), so uniqueness is on lower().
CREATE UNIQUE INDEX corporate_accounts_handle_uniq
  ON corporate_accounts (lower(brand_handle));

-- The projection sync reads only active rows; it runs often and should not scan.
CREATE INDEX corporate_accounts_active_idx
  ON corporate_accounts (id) WHERE status = 'active';

-- -----------------------------------------------------------------------------
-- corporate_billing — one row per annual cycle
-- -----------------------------------------------------------------------------
CREATE TABLE corporate_billing (
  id                    BIGSERIAL PRIMARY KEY,
  corporate_id          BIGINT NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,

  onboarding_fee_cents  BIGINT NOT NULL DEFAULT 1000000,   -- $10,000.00
  onboarding_paid_at    TIMESTAMPTZ,
  -- UNIQUE so a retried Stripe webhook cannot bill the fee twice. stripe_events
  -- guards delivery; this guards the outcome.
  stripe_payment_intent TEXT UNIQUE,

  annual_cap_cents      BIGINT NOT NULL DEFAULT 10000000,  -- $100,000.00 ad spend ceiling
  discount_bps          INTEGER NOT NULL DEFAULT 2000,     -- 20.00% off each purchase
  discount_cap_cents    BIGINT NOT NULL DEFAULT 2000000,   -- $20,000.00 of discount per cycle

  cycle_start           DATE NOT NULL,
  cycle_end             DATE NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT corporate_billing_cycle_uniq UNIQUE (corporate_id, cycle_start),
  CONSTRAINT corporate_billing_cycle_sane CHECK (cycle_end > cycle_start),
  CONSTRAINT corporate_billing_nonneg CHECK (
    onboarding_fee_cents >= 0 AND annual_cap_cents >= 0 AND discount_cap_cents >= 0
  ),
  CONSTRAINT corporate_billing_discount_range CHECK (discount_bps BETWEEN 0 AND 10000),
  -- A discount cap above the spend cap is unreachable and signals a misconfigured
  -- deal rather than a generous one.
  CONSTRAINT corporate_billing_discount_cap_sane CHECK (discount_cap_cents <= annual_cap_cents)
);

COMMENT ON COLUMN corporate_billing.annual_cap_cents IS
  'Ceiling on ad spend for this cycle. Unused cap does not roll over; renewal opens a new row.';
COMMENT ON COLUMN corporate_billing.discount_cap_cents IS
  'Cumulative discount VALUE allowed this cycle, not a percentage. Once reached, purchases price at list.';

CREATE INDEX corporate_billing_account_idx ON corporate_billing (corporate_id, cycle_start DESC);

-- -----------------------------------------------------------------------------
-- corporate_ad_spend — append-only, hash-chained per billing cycle
--
-- Balances are DERIVED from this ledger and never stored as a mutable counter: a
-- counter and a ledger drift, and the ledger is the one you can defend. Same
-- reason platform_fee_ledger exists rather than a running total on the group.
--
-- Chained on billing_id, so evidence-store's appendChained takes a per-cycle
-- advisory lock before reading the chain head. That lock ALSO serialises the cap
-- check: two concurrent purchases cannot both read remaining cap before either
-- writes. The integrity chain and the spend cap are protected by one mechanism.
-- Register it in CHAINED_TABLES as { scopeColumn: 'billing_id' } or appendChained
-- will refuse the table and verifyChain cannot audit it.
-- -----------------------------------------------------------------------------
CREATE TABLE corporate_ad_spend (
  id               BIGSERIAL PRIMARY KEY,
  corporate_id     BIGINT NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
  billing_id       BIGINT NOT NULL REFERENCES corporate_billing(id) ON DELETE CASCADE,
  campaign_ref     TEXT,

  gross_cents      BIGINT NOT NULL,   -- list price before discount
  discount_cents   BIGINT NOT NULL,   -- granted on this purchase
  net_cents        BIGINT NOT NULL,   -- actually charged

  stripe_charge_id TEXT UNIQUE,
  occurred_at      TIMESTAMPTZ NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  provenance       JSONB NOT NULL DEFAULT '{}'::jsonb,

  integrity_hash   TEXT NOT NULL,
  prev_hash        TEXT,

  -- Corrections (refunds, chargebacks) are appended as NEGATIVE rows, never by
  -- editing or deleting an existing one — that is what prev_hash protects. So
  -- the sign is not constrained; only the arithmetic is.
  CONSTRAINT corporate_spend_math CHECK (net_cents = gross_cents - discount_cents),
  -- A discount cannot exceed the purchase it discounts, in either direction.
  CONSTRAINT corporate_spend_discount_sane CHECK (
    (gross_cents >= 0 AND discount_cents BETWEEN 0 AND gross_cents)
    OR (gross_cents < 0 AND discount_cents BETWEEN gross_cents AND 0)
  )
);

COMMENT ON TABLE corporate_ad_spend IS
  'Append-only ad spend ledger, hash-chained per billing cycle. Never UPDATE or DELETE: append a negative correction row instead.';

CREATE INDEX corporate_ad_spend_cycle_idx ON corporate_ad_spend (billing_id, id);
CREATE INDEX corporate_ad_spend_account_idx ON corporate_ad_spend (corporate_id, occurred_at DESC);

-- -----------------------------------------------------------------------------
-- corporate_feed_metrics — daily rollup
--
-- `hides` is the column that matters. Impressions and clicks say what was sold;
-- hides say whether the feed is being damaged by selling it, and the automatic
-- demotion rule reads this one.
-- -----------------------------------------------------------------------------
CREATE TABLE corporate_feed_metrics (
  corporate_id        BIGINT NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
  day                 DATE   NOT NULL,
  slot_impressions    BIGINT NOT NULL DEFAULT 0,
  organic_impressions BIGINT NOT NULL DEFAULT 0,
  clicks              BIGINT NOT NULL DEFAULT 0,
  follows_gained      BIGINT NOT NULL DEFAULT 0,
  hides               BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (corporate_id, day),
  CONSTRAINT corporate_feed_metrics_nonneg CHECK (
    slot_impressions >= 0 AND organic_impressions >= 0
    AND clicks >= 0 AND follows_gained >= 0 AND hides >= 0
  )
);

CREATE INDEX corporate_feed_metrics_day_idx ON corporate_feed_metrics (day DESC);

CREATE TRIGGER corporate_accounts_touch
  BEFORE UPDATE ON corporate_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_subs();

COMMIT;

-- =============================================================================
-- NOTES FOR THE SERVICE LAYER
--
-- SPEND AND CAP, in one transaction:
--   1. appendChained({ table: 'corporate_ad_spend', scopeKey: billingId, ... })
--      takes pg_advisory_xact_lock on ('corporate_ad_spend:' || billingId).
--   2. Inside that same transaction, SUM(net_cents) and SUM(discount_cents) for
--      the cycle, apply the caps, then append.
--   Doing the cap check in a separate transaction reintroduces the race the lock
--   was preventing.
--
-- DERIVED BALANCES:
--   spent_cents    = SELECT COALESCE(SUM(net_cents), 0)      WHERE billing_id = $1
--   discount_used  = SELECT COALESCE(SUM(discount_cents), 0) WHERE billing_id = $1
--   Never cache these on corporate_billing.
--
-- PRORATION: a mid-cycle activation scales annual_cap_cents and
-- discount_cap_cents by remaining days, rounded DOWN. Granting a full year's cap
-- for two months is the expensive rounding direction.
--
-- SUSPENSION: flip status to 'suspended' with a reason. Do not delete the
-- account or its ledger — the ledger is the record of what was sold, and a
-- suspended advertiser is exactly who asks for it.
-- =============================================================================
