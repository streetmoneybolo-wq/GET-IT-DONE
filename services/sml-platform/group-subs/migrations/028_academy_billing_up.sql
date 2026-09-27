-- MEM Academy billing engine (platform/academy/billing/*).
--
-- Stripe (the Making Easy Money account) is the source of truth. These tables
-- hold only what Stripe cannot: the Discord-id binding, the auto-renewal
-- consent proof, manual comps, the webhook dedupe queue, the role outbox, the
-- append-only audit, reconcile summaries and the one-free-trial ledger.
-- Additive only: no existing table, type or constraint is touched.
--
-- Every row carries livemode, and every engine read filters on it, so a
-- test-mode rehearsal can never feed live access. `node scripts/academy-billing.js
-- purge-test --apply --actor <label>` removes livemode=false rows (the audit
-- stays; it is append-only).
--
-- No payload body and no personal data (email, name, address, card) is stored:
-- only Stripe/Discord ids, enums, amounts of the lifetime cache and hashes.

BEGIN;

-- Identity binding: Discord user -> the engine-created Stripe Customer. The
-- same pair is written to Customer.metadata {sml_kind, mem_academy_discord_user}
-- so it can be rebuilt from Stripe after a database rollback. The row is
-- created BEFORE the Customer ("pending customer"). rebound_to is a tombstone
-- left by the rebind CLI so a rebuild never restores the old id.
CREATE TABLE academy_billing_members (
  discord_user_id    TEXT        NOT NULL CHECK (discord_user_id ~ '^[0-9]{15,24}$'),
  livemode           BOOLEAN     NOT NULL,
  guild_id           TEXT        NOT NULL CHECK (guild_id ~ '^[0-9]{15,24}$'),
  stripe_customer_id TEXT        UNIQUE CHECK (stripe_customer_id IS NULL OR stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_account_id  TEXT        CHECK (stripe_account_id IS NULL OR stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  bound_via          TEXT        NOT NULL CHECK (bound_via IN ('web_oauth','activity','hub','admin','stripe_rebuild')),
  rebound_to         TEXT        CHECK (rebound_to IS NULL OR rebound_to ~ '^[0-9]{15,24}$'),
  next_check_at      TIMESTAMPTZ,
  last_synced_at     TIMESTAMPTZ,
  last_access        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (discord_user_id, livemode)
);
CREATE INDEX academy_billing_members_due_idx
  ON academy_billing_members (livemode, next_check_at) WHERE next_check_at IS NOT NULL;

-- One row per checkout attempt, with the proof of the auto-renewal consent
-- (California ARL: keep at least 3 years). Never deleted by code; purge-test
-- removes test-mode rows only. trial_days is the free trial this checkout
-- offered (NULL = none); consent_kind 'free_trial' is a trial that ends by
-- itself before any charge.
CREATE TABLE academy_billing_checkout_intents (
  id                          UUID        PRIMARY KEY,
  discord_user_id             TEXT        NOT NULL CHECK (discord_user_id ~ '^[0-9]{15,24}$'),
  guild_id                    TEXT        NOT NULL CHECK (guild_id ~ '^[0-9]{15,24}$'),
  livemode                    BOOLEAN     NOT NULL,
  package                     TEXT        NOT NULL CHECK (package IN ('daily','weekly','monthly','quarterly','semiannual','yearly','lifetime')),
  stripe_price_id             TEXT        NOT NULL CHECK (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  stripe_customer_id          TEXT        CHECK (stripe_customer_id IS NULL OR stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  bind_source                 TEXT        NOT NULL CHECK (bind_source IN ('web_oauth','activity','hub')),
  consent_kind                TEXT        NOT NULL CHECK (consent_kind IN ('auto_renewal','final_sale','free_trial')),
  consent_version             TEXT        NOT NULL CHECK (length(consent_version) BETWEEN 1 AND 64),
  consent_sha256              TEXT        NOT NULL CHECK (consent_sha256 ~ '^[a-f0-9]{64}$'),
  consented_at                TIMESTAMPTZ NOT NULL,
  stripe_checkout_session_id  TEXT        UNIQUE CHECK (stripe_checkout_session_id IS NULL OR stripe_checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  status                      TEXT        NOT NULL DEFAULT 'created' CHECK (status IN ('created','open','completed','expired','failed')),
  trial_days                  SMALLINT    CHECK (trial_days IS NULL OR trial_days BETWEEN 1 AND 30),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at                  TIMESTAMPTZ NOT NULL,
  CHECK (consent_kind <> 'free_trial' OR trial_days IS NOT NULL)
);
CREATE INDEX academy_billing_checkout_intents_user_idx
  ON academy_billing_checkout_intents (discord_user_id, created_at DESC);

-- Lifetime purchases: a CACHE of Stripe (covers Search lag). Rebuildable from
-- paymentIntents.search on metadata; the CLI rebuild-from-stripe does that.
CREATE TABLE academy_billing_lifetime (
  payment_intent_id   TEXT        PRIMARY KEY CHECK (payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
  livemode            BOOLEAN     NOT NULL,
  checkout_session_id TEXT        UNIQUE,
  discord_user_id     TEXT        NOT NULL,
  stripe_customer_id  TEXT        NOT NULL CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_price_id     TEXT,
  amount_cents        BIGINT      NOT NULL CHECK (amount_cents >= 0),
  currency            TEXT        NOT NULL,
  paid_at             TIMESTAMPTZ NOT NULL,
  latest_charge_id    TEXT,
  stripe_state        TEXT        NOT NULL CHECK (stripe_state IN ('paid','refunded','partially_refunded','disputed','dispute_won','dispute_lost')),
  state_checked_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (discord_user_id, livemode) REFERENCES academy_billing_members (discord_user_id, livemode)
);
CREATE INDEX academy_billing_lifetime_user_idx ON academy_billing_lifetime (discord_user_id, livemode);

-- TRUE when a text array has no NULL and no repeated element. A CHECK cannot
-- hold a subquery, so academy_billing_comps.external_role_ids uses this
-- (array_to_string() skips NULLs, so the snowflake pattern alone would let
-- ARRAY[NULL] through as a comp that grants nothing).
CREATE FUNCTION academy_billing_ids_distinct(ids TEXT[]) RETURNS BOOLEAN
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $FN$ SELECT array_position(ids, NULL) IS NULL AND count(*) = count(DISTINCT x) FROM unnest(ids) AS x $FN$;

-- Manual entitlements: the ONLY sanctioned way to hand out the engine roles
-- (CLI `comp grant`). Roles added by hand in Discord without a comp are removed
-- by the reconciler once revokes are on. A comp may also entitle EXTERNAL roles
-- (SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS, e.g. Monarch); those follow the
-- grant-only-unless-safe rules of academy_billing_external_grants.
CREATE TABLE academy_billing_comps (
  id                    BIGSERIAL   PRIMARY KEY,
  discord_user_id       TEXT        NOT NULL CHECK (discord_user_id ~ '^[0-9]{15,24}$'),
  livemode              BOOLEAN     NOT NULL,
  include_lifetime_role BOOLEAN     NOT NULL DEFAULT false,
  grants_academy        BOOLEAN     NOT NULL DEFAULT true,
  external_role_ids     TEXT[]      NOT NULL DEFAULT '{}'
                        CHECK (cardinality(external_role_ids) <= 10
                          AND academy_billing_ids_distinct(external_role_ids)
                          AND array_to_string(external_role_ids, ',') ~ '^([0-9]{15,24}(,[0-9]{15,24})*)?$'),
  reason                TEXT        NOT NULL CHECK (length(reason) BETWEEN 3 AND 200),
  granted_by            TEXT        NOT NULL CHECK (length(granted_by) BETWEEN 1 AND 80),
  expires_at            TIMESTAMPTZ,
  revoked_at            TIMESTAMPTZ,
  revoked_by            TEXT        CHECK (revoked_by IS NULL OR length(revoked_by) BETWEEN 1 AND 80),
  revoke_reason         TEXT        CHECK (revoke_reason IS NULL OR length(revoke_reason) BETWEEN 3 AND 200),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (grants_academy OR include_lifetime_role OR cardinality(external_role_ids) > 0)
);
CREATE INDEX academy_billing_comps_active_idx
  ON academy_billing_comps (discord_user_id) WHERE revoked_at IS NULL;

-- Webhook dedupe + trigger queue. Deliberately separate from stripe_events:
-- the same evt_ also reaches the platform endpoint and is stored there. No
-- payload body: only the related ids, our own metadata values and a hash.
CREATE TABLE academy_billing_events (
  event_id            TEXT        PRIMARY KEY CHECK (event_id ~ '^evt_[A-Za-z0-9]+$'),
  type                TEXT        NOT NULL CHECK (length(type) BETWEEN 1 AND 100),
  livemode            BOOLEAN     NOT NULL,
  account             TEXT,
  api_version         TEXT,
  stripe_created_at   TIMESTAMPTZ,
  object_id           TEXT,
  customer_id         TEXT,
  subscription_id     TEXT,
  payment_intent_id   TEXT,
  charge_id           TEXT,
  checkout_session_id TEXT,
  invoice_id          TEXT,
  meta_sml_kind       TEXT,
  meta_discord_user   TEXT        CHECK (meta_discord_user IS NULL OR meta_discord_user ~ '^[0-9]{15,24}$'),
  meta_intent         TEXT,
  payload_sha256      TEXT        NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  status              TEXT        NOT NULL CHECK (status IN ('pending','deferred','processed','ignored','failed','dead')),
  ignore_reason       TEXT,
  attempts            INT         NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at     TIMESTAMPTZ,
  last_error          TEXT        CHECK (last_error IS NULL OR length(last_error) <= 300),
  processed_at        TIMESTAMPTZ
);
CREATE INDEX academy_billing_events_due_idx ON academy_billing_events (status, next_attempt_at);
CREATE INDEX academy_billing_events_customer_idx ON academy_billing_events (customer_id) WHERE customer_id IS NOT NULL;

-- Role outbox: desired vs applied, per engine role. generation is bumped on
-- every desired change; the applier finishes with a compare-and-set on the
-- generation it claimed, so a newer desired state is never overwritten.
-- role_key 'external' rows carry an EXTERNAL role (Monarch / Elite / Premium);
-- who put that role on the member is recorded in
-- academy_billing_external_grants, and the applier refuses a DELETE of an
-- external role unless that ledger says the engine granted it.
CREATE TABLE academy_billing_role_state (
  livemode           BOOLEAN     NOT NULL,
  guild_id           TEXT        NOT NULL CHECK (guild_id ~ '^[0-9]{15,24}$'),
  discord_user_id    TEXT        NOT NULL CHECK (discord_user_id ~ '^[0-9]{15,24}$'),
  role_id            TEXT        NOT NULL CHECK (role_id ~ '^[0-9]{15,24}$'),
  role_key           TEXT        NOT NULL CHECK (role_key IN ('academy','mem_lifetime','external')),
  desired            BOOLEAN     NOT NULL,
  generation         BIGINT      NOT NULL DEFAULT 1 CHECK (generation > 0),
  state              TEXT        NOT NULL CHECK (state IN ('pending','synced','awaiting_member','blocked','failed','suppressed')),
  attempts           INT         NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at    TIMESTAMPTZ,
  awaiting_since     TIMESTAMPTZ,
  applied_generation BIGINT,
  applied_desired    BOOLEAN,
  last_http_status   INT,
  last_error         TEXT        CHECK (last_error IS NULL OR length(last_error) <= 300),
  last_applied_at    TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (livemode, guild_id, discord_user_id, role_id)
);
CREATE INDEX academy_billing_role_state_due_idx ON academy_billing_role_state (state, next_attempt_at);
CREATE INDEX academy_billing_role_state_user_idx ON academy_billing_role_state (discord_user_id);

-- Append-only, hash-chained audit. row_hash = sha256(prev_hash || canonical
-- JSON of the row); rows are chained under pg_advisory_xact_lock on a fixed
-- key. UPDATE, DELETE and TRUNCATE are refused by trigger. Details carry ids
-- and enums only.
CREATE TABLE academy_billing_audit (
  id              BIGSERIAL   PRIMARY KEY,
  at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  livemode        BOOLEAN,
  run_id          UUID,
  actor           TEXT        NOT NULL CHECK (actor ~ '^(webhook|settle|applier|reconciler|due_scan|resync|checkout|portal|boot|cli:[A-Za-z0-9_.@-]{1,64})$'),
  action          TEXT        NOT NULL CHECK (action ~ '^[a-z][a-z_]{2,63}$'),
  discord_user_id TEXT        CHECK (discord_user_id IS NULL OR discord_user_id ~ '^[0-9]{15,24}$'),
  role_key        TEXT        CHECK (role_key IS NULL OR role_key IN ('academy','mem_lifetime','external')),
  outcome         TEXT        CHECK (outcome IS NULL OR outcome IN ('applied','dry_run','noop','suppressed','waiting_member','failed_permanent','failed_retryable')),
  reason          TEXT        CHECK (reason IS NULL OR length(reason) <= 200),
  stripe_refs     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  event_id        TEXT,
  http_status     INT,
  details         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  prev_hash       TEXT        CHECK (prev_hash IS NULL OR prev_hash ~ '^[a-f0-9]{64}$'),
  row_hash        TEXT        NOT NULL UNIQUE CHECK (row_hash ~ '^[a-f0-9]{64}$')
);
-- One successor per row and a single genesis row: the chain cannot fork.
CREATE UNIQUE INDEX academy_billing_audit_prev_idx
  ON academy_billing_audit (prev_hash) WHERE prev_hash IS NOT NULL;
CREATE UNIQUE INDEX academy_billing_audit_genesis_idx
  ON academy_billing_audit ((prev_hash IS NULL)) WHERE prev_hash IS NULL;
CREATE INDEX academy_billing_audit_user_idx ON academy_billing_audit (discord_user_id, at DESC);

CREATE OR REPLACE FUNCTION academy_billing_audit_immutable()
RETURNS TRIGGER AS $BODY$
BEGIN
  RAISE EXCEPTION 'academy_billing_audit is append-only';
END;
$BODY$ LANGUAGE plpgsql;

CREATE TRIGGER academy_billing_audit_no_update
  BEFORE UPDATE OR DELETE ON academy_billing_audit
  FOR EACH ROW EXECUTE FUNCTION academy_billing_audit_immutable();
CREATE TRIGGER academy_billing_audit_no_truncate
  BEFORE TRUNCATE ON academy_billing_audit
  FOR EACH STATEMENT EXECUTE FUNCTION academy_billing_audit_immutable();

-- Reconcile run summaries: aggregates only. audit_log_cursor is the newest
-- Discord audit-log entry already scanned for manual engine-role adds.
CREATE TABLE academy_billing_reconcile_runs (
  run_id            UUID        PRIMARY KEY,
  livemode          BOOLEAN     NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  mode              TEXT        NOT NULL CHECK (mode IN ('dry_run','apply')),
  scope             TEXT        NOT NULL CHECK (scope IN ('known_ids','members')),
  stripe_complete   BOOLEAN,
  entitled_academy  INT,
  entitled_lifetime INT,
  holders_seen      INT,
  planned_grants    INT,
  planned_revokes   INT,
  applied_grants    INT,
  applied_revokes   INT,
  waiting_member    INT,
  orphans           INT,
  unmapped_prices   INT,
  audit_log_cursor  TEXT,
  brake             TEXT,
  error             TEXT        CHECK (error IS NULL OR length(error) <= 300)
);
CREATE INDEX academy_billing_reconcile_runs_started_idx ON academy_billing_reconcile_runs (livemode, started_at DESC);

-- One-time hand-off codes (Activity / hub -> web). Only the sha256 of the code
-- is stored; a code works once, for five minutes, and only to BUY (never to
-- open the billing portal). Identity only, so no livemode.
CREATE TABLE academy_billing_handoffs (
  code_sha256     TEXT        PRIMARY KEY CHECK (code_sha256 ~ '^[a-f0-9]{64}$'),
  discord_user_id TEXT        NOT NULL CHECK (discord_user_id ~ '^[0-9]{15,24}$'),
  guild_id        TEXT        NOT NULL CHECK (guild_id ~ '^[0-9]{15,24}$'),
  source          TEXT        NOT NULL CHECK (source IN ('activity','hub')),
  purpose         TEXT        NOT NULL DEFAULT 'buy' CHECK (purpose IN ('buy')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  CHECK (expires_at <= created_at + interval '5 minutes 1 second')
);
CREATE INDEX academy_billing_handoffs_expires_idx ON academy_billing_handoffs (expires_at);

-- EXTERNAL role ledger: roles the engine may grant but does not own
-- (SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS, default Monarch, Elite, Premium;
-- Upgrade.Chat also manages them). One row per member and role, written at the
-- engine's FIRST grant decision from a live read of the guild member (and
-- recorded again when a later purchase starts a new entitlement after the
-- previous one ended in revoked / kept_external / released):
--   had_role_before = true  -> state 'held': the engine never removes it
--   had_role_before = false -> state 'engine_granted': the engine PUT it
-- A revoke is decided only for engine_granted + had_role_before = false, when
-- no engine source (price, lifetime, comp) entitles the role any more AND the
-- Upgrade.Chat check says no active UC membership grants it:
--   UC none -> 'revoked' (DELETE queued); UC active -> 'kept_external';
--   UC unconfigured / error / inconclusive -> 'needs_review' (no revoke;
--   listed by `academy-billing.js external-review`).
-- 'released': the entitlement ended and a role the member held before the
-- engine's grant is gone anyway (removed by hand, or the grant was never
-- delivered); nothing is left for the engine to do.
-- generation is bumped on every change (compare-and-set). Ids and enums only.
CREATE TABLE academy_billing_external_grants (
  livemode         BOOLEAN     NOT NULL,
  guild_id         TEXT        NOT NULL CHECK (guild_id ~ '^[0-9]{15,24}$'),
  discord_user_id  TEXT        NOT NULL CHECK (discord_user_id ~ '^[0-9]{15,24}$'),
  role_id          TEXT        NOT NULL CHECK (role_id ~ '^[0-9]{15,24}$'),
  first_source_ref TEXT        CHECK (first_source_ref IS NULL OR length(first_source_ref) BETWEEN 1 AND 120),
  had_role_before  BOOLEAN     NOT NULL,
  state            TEXT        NOT NULL CHECK (state IN ('held','engine_granted','revoked','kept_external','needs_review','released')),
  generation       BIGINT      NOT NULL DEFAULT 1 CHECK (generation > 0),
  last_reason      TEXT        CHECK (last_reason IS NULL OR length(last_reason) <= 200),
  uc_result        TEXT        CHECK (uc_result IS NULL OR uc_result IN ('active','none','inconclusive')),
  uc_checked_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  state_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (livemode, guild_id, discord_user_id, role_id),
  -- 'held' is only ever a role the member had before the engine's first
  -- grant decision, and the engine never revokes such a role.
  CHECK (state <> 'held' OR had_role_before),
  CHECK (state <> 'revoked' OR NOT had_role_before)
);
CREATE INDEX academy_billing_external_grants_review_idx
  ON academy_billing_external_grants (livemode, state) WHERE state IN ('engine_granted','needs_review');

-- ONE FREE TRIAL PER DISCORD ACCOUNT, across every product and package (the
-- Academy line and every membership). A row is written the first time a
-- resync sees a subscription with a trial on the member's Customer (webhook,
-- success page, due-scan, reconciler), never at checkout, so an abandoned
-- checkout does not use up the trial. Checkout offers a price's trialDays
-- only when this table has no row for the member AND none of the member's
-- Stripe subscriptions ever had a trial; otherwise it sells the same price
-- without a trial. Kept for good (purge-test removes test-mode rows only), so
-- a trial is never offered twice even after the subscription is gone. Ids
-- and timestamps only.
CREATE TABLE academy_billing_trials (
  livemode               BOOLEAN     NOT NULL,
  discord_user_id        TEXT        NOT NULL CHECK (discord_user_id ~ '^[0-9]{15,24}$'),
  first_price_id         TEXT        CHECK (first_price_id IS NULL OR first_price_id ~ '^price_[A-Za-z0-9]+$'),
  stripe_subscription_id TEXT        NOT NULL CHECK (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  started_at             TIMESTAMPTZ NOT NULL,
  trial_end_at           TIMESTAMPTZ,
  recorded_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (livemode, discord_user_id),
  CHECK (trial_end_at IS NULL OR trial_end_at >= started_at)
);

COMMIT;
