-- =============================================================================
-- StockMarketLoop — group subscriptions, Discord role sync, platform fees
-- PostgreSQL 14+.   Apply:  psql -1 -f 003_group_subscriptions_up.sql
--
-- Builds ON what already exists rather than beside it:
--   native group roles   GET /sml/v1/group/roles              (id,name,slug,position,permissions)
--   membership pricing   GET /sml/v1/group/membership/pricing (daily/weekly/monthly, cents)
--   Stripe Connect       GET /sml-live/v1/stripe/status       (configured + connected)
--
-- Nothing here re-implements those. It records the BINDING between a payment,
-- an entitlement, and the roles that entitlement grants in two systems at once.
--
-- -----------------------------------------------------------------------------
-- FEE MODEL (decided): fee only what this platform originates.
--
--   sml_checkout      subscription created by us  -> 5% application_fee_percent
--   discord_imported  lives on another platform   -> NO FEE, EVER. Structurally
--                                                    impossible, see the CHECK
--                                                    on subscriptions.
--   migrated          an imported subscriber who re-authorised through us
--                                                 -> a NEW row, feed normally
--
-- A charge belongs to exactly one Stripe platform. Subscriptions running through
-- Upgrade.chat or Patreon route their application fee to that platform; there is
-- no API that redirects a slice to us. Attaching a second fee to another
-- platform's subscription is both technically fraught and a fast route to having
-- our platform account terminated. So imported rows exist to grant roles and
-- nothing else — they are read-only revenue we do not touch.
-- =============================================================================

BEGIN;

-- Mirrors Stripe's status names exactly, so no translation layer exists to
-- drift, plus two states Stripe has no concept of.
CREATE TYPE sub_status AS ENUM (
  'trialing','active','past_due','unpaid','canceled','incomplete',
  'incomplete_expired','paused',
  'grace',      -- local: payment failed, access deliberately retained
  'superseded'  -- local: replaced by a migrated subscription
);

CREATE TYPE grant_state  AS ENUM ('pending','granted','revoking','revoked','failed');
CREATE TYPE grant_target AS ENUM ('sml_group_role','discord_guild_role');
CREATE TYPE sub_origin   AS ENUM ('sml_checkout','discord_imported','migrated','manual_comp');

-- -----------------------------------------------------------------------------
-- discord_guild_links — one SML group <-> one Discord server
-- -----------------------------------------------------------------------------
CREATE TABLE discord_guild_links (
  id                        BIGSERIAL PRIMARY KEY,
  group_id                  BIGINT      NOT NULL,
  guild_id                  TEXT        NOT NULL,
  guild_name                TEXT,
  -- The bot can only manage roles positioned BELOW its own highest role. This
  -- is a hard Discord constraint and the commonest cause of a sync that fails
  -- silently, so the position is stored and re-checked before every sweep.
  bot_highest_role_position INTEGER,
  bot_has_manage_roles      BOOLEAN     NOT NULL DEFAULT false,
  linked_by                 BIGINT      NOT NULL,
  linked_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified_at          TIMESTAMPTZ,
  last_error                TEXT,
  active                    BOOLEAN     NOT NULL DEFAULT true,
  CONSTRAINT discord_guild_links_group_uniq UNIQUE (group_id),
  CONSTRAINT discord_guild_links_guild_uniq UNIQUE (guild_id)
);
COMMENT ON TABLE discord_guild_links IS
  'Binds an SML group to a Discord server. One-to-one in both directions: two groups syncing into one guild would fight over the same member roles.';

-- -----------------------------------------------------------------------------
-- discord_identities — site account <-> Discord user
-- -----------------------------------------------------------------------------
CREATE TABLE discord_identities (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT      NOT NULL,
  discord_user_id  TEXT        NOT NULL,
  discord_username TEXT,
  refresh_token    TEXT,
  scopes           TEXT[],
  linked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ,
  CONSTRAINT discord_identities_user_uniq    UNIQUE (user_id),
  CONSTRAINT discord_identities_discord_uniq UNIQUE (discord_user_id)
);
COMMENT ON TABLE discord_identities IS
  'OAuth link between a site account and a Discord user. With no row here a paid subscriber CANNOT be granted a Discord role — surface that during checkout, never silently after payment.';
COMMENT ON COLUMN discord_identities.refresh_token IS
  'Encrypt at the application layer. Never log, never return over the API.';

-- -----------------------------------------------------------------------------
-- group_plans — a purchasable tier
-- -----------------------------------------------------------------------------
CREATE TABLE group_plans (
  id               BIGSERIAL PRIMARY KEY,
  group_id         BIGINT      NOT NULL,
  slug             TEXT        NOT NULL,
  name             TEXT        NOT NULL,
  interval_key     TEXT        NOT NULL,   -- daily | weekly | monthly | yearly | lifetime
  price_cents      INTEGER     NOT NULL,
  currency         TEXT        NOT NULL DEFAULT 'usd',
  stripe_price_id  TEXT,
  -- Basis points: 500 = 5.00%. Integer, because float money reconciles badly.
  platform_fee_bps INTEGER     NOT NULL DEFAULT 500,
  trial_days       INTEGER     NOT NULL DEFAULT 0,
  -- Days of retained access after a failed payment. 0 would revoke on the first
  -- failure, which fights Stripe's own retry schedule and ejects customers whose
  -- card succeeds on attempt two.
  grace_days       INTEGER     NOT NULL DEFAULT 3,
  active           BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT group_plans_slug_uniq    UNIQUE (group_id, slug),
  CONSTRAINT group_plans_price_nonneg CHECK (price_cents >= 0),
  CONSTRAINT group_plans_fee_range    CHECK (platform_fee_bps BETWEEN 0 AND 3000),
  CONSTRAINT group_plans_grace_sane   CHECK (grace_days BETWEEN 0 AND 30)
);
COMMENT ON COLUMN group_plans.platform_fee_bps IS
  'Basis points; 500 = 5%. Becomes application_fee_percent on subscriptions THIS platform creates. Imported subscriptions ignore it entirely.';

CREATE INDEX group_plans_group_idx ON group_plans (group_id) WHERE active;

-- -----------------------------------------------------------------------------
-- plan_role_grants — what a plan unlocks, in BOTH systems
-- -----------------------------------------------------------------------------
CREATE TABLE plan_role_grants (
  id         BIGSERIAL PRIMARY KEY,
  plan_id    BIGINT       NOT NULL REFERENCES group_plans(id) ON DELETE CASCADE,
  target     grant_target NOT NULL,
  -- A native role id, or a Discord snowflake. TEXT because a snowflake exceeds
  -- what a JavaScript Number can hold without losing precision.
  role_ref   TEXT         NOT NULL,
  role_label TEXT,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT plan_role_grants_uniq UNIQUE (plan_id, target, role_ref)
);
COMMENT ON TABLE plan_role_grants IS
  'A plan can grant a native role, a Discord role, or both. This is the mapping the reconciler works from.';

CREATE INDEX plan_role_grants_plan_idx ON plan_role_grants (plan_id);

-- -----------------------------------------------------------------------------
-- subscriptions
-- -----------------------------------------------------------------------------
CREATE TABLE subscriptions (
  id                     BIGSERIAL PRIMARY KEY,
  user_id                BIGINT      NOT NULL,
  group_id               BIGINT      NOT NULL,
  plan_id                BIGINT      REFERENCES group_plans(id) ON DELETE SET NULL,

  origin                 sub_origin  NOT NULL DEFAULT 'sml_checkout',
  status                 sub_status  NOT NULL,

  stripe_subscription_id TEXT,
  stripe_customer_id     TEXT,
  connected_account_id   TEXT,

  -- For imported rows: where the money actually runs. Recorded so support can
  -- answer "why is this member active when we have no charge for them".
  external_platform      TEXT,        -- 'upgrade_chat' | 'patreon' | 'other'
  external_reference     TEXT,

  -- Set on the imported row when a migrated row supersedes it.
  superseded_by          BIGINT REFERENCES subscriptions(id) ON DELETE SET NULL,

  current_period_end     TIMESTAMPTZ,
  cancel_at_period_end   BOOLEAN     NOT NULL DEFAULT false,

  -- first_failed_at starts the grace clock; access_until is the computed
  -- deadline. The revoke rule lives in data rather than being re-derived by
  -- three separate jobs that will eventually disagree.
  first_failed_at        TIMESTAMPTZ,
  failed_payment_count   INTEGER     NOT NULL DEFAULT 0,
  access_until           TIMESTAMPTZ,

  -- Consent recorded when a subscriber re-authorises during migration.
  fee_consent_at         TIMESTAMPTZ,
  platform_fee_bps       INTEGER,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  canceled_at            TIMESTAMPTZ,

  CONSTRAINT subscriptions_stripe_uniq UNIQUE (stripe_subscription_id),

  -- THE RULE, ENFORCED BY THE DATABASE.
  -- An imported subscription can never carry a fee. No code path, no admin
  -- screen, no migration script can make it happen: the row will not save.
  CONSTRAINT subscriptions_imported_never_feed CHECK (
    origin <> 'discord_imported'
    OR platform_fee_bps IS NULL
    OR platform_fee_bps = 0
  ),

  -- Any non-zero fee requires recorded consent.
  CONSTRAINT subscriptions_fee_needs_consent CHECK (
    platform_fee_bps IS NULL OR platform_fee_bps = 0 OR fee_consent_at IS NOT NULL
  ),

  CONSTRAINT subscriptions_fee_range CHECK (
    platform_fee_bps IS NULL OR platform_fee_bps BETWEEN 0 AND 3000
  ),

  -- An imported row has no Stripe subscription of ours but must say where it
  -- does live, or it is unauditable.
  CONSTRAINT subscriptions_imported_has_source CHECK (
    origin <> 'discord_imported' OR external_platform IS NOT NULL
  )
);
COMMENT ON CONSTRAINT subscriptions_imported_never_feed ON subscriptions IS
  'Imported subscriptions run on another Stripe platform. Charging a fee on them is impossible here by construction, not by convention.';

CREATE INDEX subscriptions_user_idx   ON subscriptions (user_id, group_id);
CREATE INDEX subscriptions_group_idx  ON subscriptions (group_id, status);
CREATE INDEX subscriptions_expiry_idx ON subscriptions (access_until)
  WHERE status IN ('past_due','grace','unpaid');
-- The migration funnel: imported members not yet moved across.
CREATE INDEX subscriptions_unmigrated_idx ON subscriptions (group_id, created_at)
  WHERE origin = 'discord_imported' AND superseded_by IS NULL;

-- -----------------------------------------------------------------------------
-- role_grants — desired vs actual, per target system
-- -----------------------------------------------------------------------------
CREATE TABLE role_grants (
  id              BIGSERIAL PRIMARY KEY,
  subscription_id BIGINT       NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  user_id         BIGINT       NOT NULL,
  target          grant_target NOT NULL,
  role_ref        TEXT         NOT NULL,
  state           grant_state  NOT NULL DEFAULT 'pending',
  attempts        INTEGER      NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  last_error      TEXT,
  granted_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT role_grants_uniq UNIQUE (subscription_id, target, role_ref)
);
COMMENT ON TABLE role_grants IS
  'Desired vs actual role state. Webhooks alone cannot guarantee it — Discord calls fail, members leave and rejoin, the bot loses permission. A periodic sweep repairs the drift.';

CREATE INDEX role_grants_pending_idx ON role_grants (state, last_attempt_at)
  WHERE state IN ('pending','revoking','failed');
CREATE INDEX role_grants_user_idx ON role_grants (user_id, target);

-- -----------------------------------------------------------------------------
-- stripe_events — webhook idempotency and ordering guard
-- -----------------------------------------------------------------------------
CREATE TABLE stripe_events (
  event_id         TEXT        PRIMARY KEY,
  event_type       TEXT        NOT NULL,
  api_version      TEXT,
  -- Stripe's own creation time. Used to discard a delivery older than the state
  -- already applied, which is how out-of-order webhooks are made harmless.
  event_created_at TIMESTAMPTZ NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at     TIMESTAMPTZ,
  status           TEXT        NOT NULL DEFAULT 'received',
  error            TEXT,
  payload          JSONB
);
COMMENT ON TABLE stripe_events IS
  'Stripe retries webhooks and does not guarantee ordering. Without this, a retried payment_failed re-runs the revoke path and a late delivery can revoke a subscription that already recovered.';

CREATE INDEX stripe_events_unprocessed_idx ON stripe_events (received_at) WHERE processed_at IS NULL;
CREATE INDEX stripe_events_type_idx ON stripe_events (event_type, event_created_at DESC);

-- -----------------------------------------------------------------------------
-- platform_fee_ledger — every fee taken, and what authorised it
-- -----------------------------------------------------------------------------
CREATE TABLE platform_fee_ledger (
  id                BIGSERIAL PRIMARY KEY,
  subscription_id   BIGINT REFERENCES subscriptions(id) ON DELETE SET NULL,
  group_id          BIGINT      NOT NULL,
  stripe_invoice_id TEXT,
  stripe_charge_id  TEXT,
  gross_cents       INTEGER     NOT NULL,
  fee_cents         INTEGER     NOT NULL,
  fee_bps           INTEGER     NOT NULL,
  currency          TEXT        NOT NULL DEFAULT 'usd',
  consent_ref       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_fee_ledger_invoice_uniq UNIQUE (stripe_invoice_id),
  CONSTRAINT platform_fee_ledger_nonneg   CHECK (gross_cents >= 0 AND fee_cents >= 0),
  CONSTRAINT platform_fee_ledger_not_over CHECK (fee_cents <= gross_cents)
);
COMMENT ON TABLE platform_fee_ledger IS
  'Audit trail for every platform fee. Unique on invoice so a webhook retry cannot double-count revenue.';

CREATE INDEX platform_fee_ledger_group_idx ON platform_fee_ledger (group_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at_subs()
RETURNS TRIGGER AS $BODY$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$BODY$ LANGUAGE plpgsql;

CREATE TRIGGER subscriptions_touch
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_subs();

COMMIT;

-- =============================================================================
-- ACCESS RULE — implement exactly once, nowhere else
--
--   has_access = status IN ('trialing','active')
--             OR (status IN ('past_due','grace','unpaid') AND now() < access_until)
--
--   invoice.payment_failed   -> first_failed_at = COALESCE(first_failed_at, now())
--                               access_until    = now() + plan.grace_days
--                               status          = 'grace'      -- do NOT revoke
--   invoice.paid             -> clear first_failed_at, failed_payment_count,
--                               access_until; status = 'active'
--   subscription.deleted     -> status='canceled', access_until=now(),
--                               queue revokes
--
-- Revoking on the first failure fights Stripe's retry schedule and ejects
-- customers whose card recovers on the second attempt. They chargeback.
--
-- MIGRATION FLOW (imported -> feed)
--   1. imported row exists: origin='discord_imported', external_platform set,
--      no fee possible, roles granted normally
--   2. subscriber re-authorises through SML checkout
--   3. a NEW row is created: origin='migrated', fee_consent_at=now(),
--      platform_fee_bps=500
--   4. old row: status='superseded', superseded_by = new id
--   5. role_grants follow the new row; the sweep reconciles
--   Never delete the imported row — it is the evidence for what the member had.
--
-- DISCORD CONSTRAINTS THAT BITE
--   * the bot's highest role must sit ABOVE any role it grants; verify against
--     discord_guild_links.bot_highest_role_position before each sync
--   * role edits are rate limited — batch and back off, never loop per member
--   * a member who leaves and rejoins loses roles silently; the reconciler sweep
--     restores them, the webhook will not
--   * no discord_identities row means the Discord half simply cannot happen;
--     the native role still applies, so partial success must be representable
--
-- WHAT IS DELIBERATELY ABSENT
--   Any mechanism for charging a fee on an Upgrade.chat or Patreon
--   subscription. A charge belongs to one Stripe platform and it is not us.
--   The imported rows exist to grant access, not to be monetised.
-- =============================================================================
