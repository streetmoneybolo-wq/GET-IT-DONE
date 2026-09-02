-- =============================================================================
-- StockMarketLoop platform — dispute & evidence ledgers (migration 012)
--
-- Append-only evidence system for payment disputes. Rows are never updated in
-- place; a correction is a new row plus `superseded_by`. Every evidence-bearing
-- table carries the provenance block (source, source_event_id, provider_account,
-- occurred_at, received_at, provenance, integrity_hash, prev_hash). received_at
-- is writer-supplied (no DEFAULT) so it participates in the integrity hash.
--
-- Hash chains: billing_events (scope = provider), service_usage_events
-- (scope = identity_id), dispute_evidence_items (scope = case_id) and
-- dispute_audit_log (scope = COALESCE(case_id, 0); 0 is the system chain).
-- A partial UNIQUE (scope, prev_hash) WHERE prev_hash IS NOT NULL turns any
-- chain fork into a constraint violation. Other provenance tables are
-- hash-stamped per row but not chained (prev_hash stays NULL).
-- =============================================================================

BEGIN;

CREATE TABLE billing_identities (
  id                BIGSERIAL PRIMARY KEY,
  sml_user_id       BIGINT,
  wordpress_user_id BIGINT,
  discord_user_id   TEXT,
  email_candidate   TEXT,
  verification      TEXT NOT NULL CHECK (verification IN ('verified','candidate')),
  verified_via      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX billing_identities_sml_user_uniq
  ON billing_identities (sml_user_id) WHERE sml_user_id IS NOT NULL;
CREATE UNIQUE INDEX billing_identities_wordpress_user_uniq
  ON billing_identities (wordpress_user_id) WHERE wordpress_user_id IS NOT NULL;
CREATE UNIQUE INDEX billing_identities_discord_user_uniq
  ON billing_identities (discord_user_id) WHERE discord_user_id IS NOT NULL;
-- Non-unique on purpose: two candidate identities may share an email.
CREATE INDEX billing_identities_email_candidate_idx
  ON billing_identities (email_candidate);

CREATE TABLE billing_identity_refs (
  id               BIGSERIAL PRIMARY KEY,
  identity_id      BIGINT NOT NULL REFERENCES billing_identities(id),
  provider         TEXT NOT NULL CHECK (provider IN ('stripe','paypal','upgrade_chat','discord','wordpress','sml')),
  ref_type         TEXT NOT NULL,
  ref_value_enc    BYTEA NOT NULL,
  ref_lookup_hash  TEXT NOT NULL,
  key_version      SMALLINT NOT NULL,
  verification     TEXT NOT NULL CHECK (verification IN ('verified','candidate')),
  source           TEXT NOT NULL CHECK (source IN ('stripe','paypal','upgrade_chat','wordpress','discord','sml_platform')),
  source_event_id  TEXT,
  provider_account TEXT,
  occurred_at      TIMESTAMPTZ NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL,
  provenance       JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash   TEXT NOT NULL,
  prev_hash        TEXT
);

-- Person-scoped identifiers are globally unique per provider/type.
CREATE UNIQUE INDEX billing_identity_refs_person_uniq
  ON billing_identity_refs (provider, ref_type, ref_lookup_hash)
  WHERE ref_type NOT IN ('merchant','connected_account');
-- Merchant-scoped identifiers may be held by each co-owner.
CREATE UNIQUE INDEX billing_identity_refs_merchant_uniq
  ON billing_identity_refs (provider, ref_type, ref_lookup_hash, identity_id)
  WHERE ref_type IN ('merchant','connected_account');
CREATE INDEX billing_identity_refs_identity_idx
  ON billing_identity_refs (identity_id);

CREATE TABLE billing_subscriptions (
  id                       BIGSERIAL PRIMARY KEY,
  provider                 TEXT NOT NULL,
  provider_subscription_id TEXT NOT NULL,
  identity_id              BIGINT REFERENCES billing_identities(id),
  plan_name                TEXT,
  plan_description         TEXT,
  plan_features            JSONB,
  price_cents              INT,
  currency                 TEXT,
  billing_interval         TEXT,
  merchant_account         TEXT,
  origin                   TEXT NOT NULL CHECK (origin IN ('explicit_purchase','trial_auto_convert','admin_created','upgrade_chat_import','unknown')),
  trial_start              TIMESTAMPTZ,
  trial_end                TIMESTAMPTZ,
  engine_subscription_id   BIGINT,
  source                   TEXT NOT NULL CHECK (source IN ('stripe','paypal','upgrade_chat','wordpress','discord','sml_platform')),
  source_event_id          TEXT,
  provider_account         TEXT,
  occurred_at              TIMESTAMPTZ NOT NULL,
  received_at              TIMESTAMPTZ NOT NULL,
  provenance               JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash           TEXT NOT NULL,
  prev_hash                TEXT,
  UNIQUE (provider, provider_subscription_id)
);

CREATE TABLE billing_transactions (
  id                      BIGSERIAL PRIMARY KEY,
  provider                TEXT NOT NULL,
  provider_transaction_id TEXT NOT NULL,
  kind                    TEXT NOT NULL CHECK (kind IN ('charge','capture','refund','payout_reversal')),
  amount_cents            INT NOT NULL,
  currency                TEXT NOT NULL,
  status                  TEXT,
  identity_id             BIGINT,
  subscription_id         BIGINT,
  source                  TEXT NOT NULL CHECK (source IN ('stripe','paypal','upgrade_chat','wordpress','discord','sml_platform')),
  source_event_id         TEXT,
  provider_account        TEXT,
  occurred_at             TIMESTAMPTZ NOT NULL,
  received_at             TIMESTAMPTZ NOT NULL,
  provenance              JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash          TEXT NOT NULL,
  prev_hash               TEXT,
  UNIQUE (provider, provider_transaction_id, kind)
);

CREATE TABLE billing_events (
  id                BIGSERIAL PRIMARY KEY,
  provider          TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  identity_id       BIGINT,
  subscription_id   BIGINT,
  transaction_id    BIGINT,
  payload_hash      TEXT,
  raw_ref           TEXT,
  status            TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','stale','ignored')),
  source            TEXT NOT NULL CHECK (source IN ('stripe','paypal','upgrade_chat','wordpress','discord','sml_platform')),
  source_event_id   TEXT,
  provider_account  TEXT,
  occurred_at       TIMESTAMPTZ NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL,
  provenance        JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash    TEXT NOT NULL,
  prev_hash         TEXT,
  UNIQUE (provider, provider_event_id)
);

-- Chain-fork guard: scope = provider.
CREATE UNIQUE INDEX billing_events_chain_guard
  ON billing_events (provider, prev_hash) WHERE prev_hash IS NOT NULL;

CREATE TABLE terms_versions (
  id                BIGSERIAL PRIMARY KEY,
  version_label     TEXT NOT NULL,
  url               TEXT,
  content_sha256    TEXT NOT NULL UNIQUE,
  content           TEXT NOT NULL,
  rendered_artifact BYTEA,
  doc_kind          TEXT NOT NULL DEFAULT 'terms' CHECK (doc_kind IN ('terms','refund_policy','cancellation_policy','privacy_policy')),
  effective_from    TIMESTAMPTZ NOT NULL,
  captured_at       TIMESTAMPTZ NOT NULL
);

CREATE TABLE customer_consents (
  id                    BIGSERIAL PRIMARY KEY,
  identity_id           BIGINT NOT NULL,
  terms_version_id      BIGINT NOT NULL REFERENCES terms_versions(id),
  control_label         TEXT NOT NULL,
  displayed_price_cents INT,
  displayed_currency    TEXT,
  displayed_interval    TEXT,
  trial_disclosure      TEXT,
  accepted_at           TIMESTAMPTZ NOT NULL,
  checkout_session_ref  TEXT,
  purchase_ip_enc       BYTEA,
  key_version           SMALLINT,
  source                TEXT NOT NULL CHECK (source IN ('stripe','paypal','upgrade_chat','wordpress','discord','sml_platform')),
  source_event_id       TEXT,
  provider_account      TEXT,
  occurred_at           TIMESTAMPTZ NOT NULL,
  received_at           TIMESTAMPTZ NOT NULL,
  provenance            JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash        TEXT NOT NULL,
  prev_hash             TEXT
);

CREATE TABLE entitlement_events (
  id               BIGSERIAL PRIMARY KEY,
  identity_id      BIGINT,
  group_id         BIGINT,
  plan_ref         TEXT,
  action           TEXT NOT NULL CHECK (action IN ('granted','present','revoked')),
  cause            TEXT,
  source           TEXT NOT NULL CHECK (source IN ('stripe','paypal','upgrade_chat','wordpress','discord','sml_platform')),
  source_event_id  TEXT,
  provider_account TEXT,
  occurred_at      TIMESTAMPTZ NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL,
  provenance       JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash   TEXT NOT NULL,
  prev_hash        TEXT
);

CREATE TABLE service_usage_events (
  id               BIGSERIAL PRIMARY KEY,
  identity_id      BIGINT NOT NULL,
  usage_type       TEXT NOT NULL CHECK (usage_type IN
    ('login','group_access','content_access','stream_access','alert_delivered','bot_notification','api_action','guild_member','role_present')),
  entitlement_ref  TEXT,
  source           TEXT NOT NULL CHECK (source IN ('stripe','paypal','upgrade_chat','wordpress','discord','sml_platform')),
  source_event_id  TEXT,
  provider_account TEXT,
  occurred_at      TIMESTAMPTZ NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL,
  provenance       JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash   TEXT NOT NULL,
  prev_hash        TEXT,
  UNIQUE (source, source_event_id)
);

-- Chain-fork guard: scope = identity_id.
CREATE UNIQUE INDEX service_usage_events_chain_guard
  ON service_usage_events (identity_id, prev_hash) WHERE prev_hash IS NOT NULL;

CREATE TABLE notification_delivery_events (
  id                  BIGSERIAL PRIMARY KEY,
  identity_id         BIGINT,
  notice_type         TEXT NOT NULL CHECK (notice_type IN
    ('renewal','trial_ending','payment_failed','dispute_alert','deadline_warning','submission_result','final_outcome')),
  channel             TEXT NOT NULL,
  template_ref        TEXT,
  delivery_status     TEXT NOT NULL,
  provider_message_id TEXT,
  source              TEXT NOT NULL CHECK (source IN ('stripe','paypal','upgrade_chat','wordpress','discord','sml_platform')),
  source_event_id     TEXT,
  provider_account    TEXT,
  occurred_at         TIMESTAMPTZ NOT NULL,
  received_at         TIMESTAMPTZ NOT NULL,
  provenance          JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash      TEXT NOT NULL,
  prev_hash           TEXT
);

CREATE TABLE cancellation_requests (
  id               BIGSERIAL PRIMARY KEY,
  identity_id      BIGINT,
  subscription_id  BIGINT,
  requested_at     TIMESTAMPTZ NOT NULL,
  effective_at     TIMESTAMPTZ,
  channel          TEXT,
  actor            TEXT,
  source           TEXT NOT NULL CHECK (source IN ('stripe','paypal','upgrade_chat','wordpress','discord','sml_platform')),
  source_event_id  TEXT,
  provider_account TEXT,
  occurred_at      TIMESTAMPTZ NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL,
  provenance       JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash   TEXT NOT NULL,
  prev_hash        TEXT
);

CREATE TABLE refund_events (
  id                 BIGSERIAL PRIMARY KEY,
  provider           TEXT NOT NULL,
  provider_refund_id TEXT NOT NULL,
  transaction_id     BIGINT,
  amount_cents       INT NOT NULL,
  currency           TEXT NOT NULL,
  reason             TEXT,
  status             TEXT,
  source             TEXT NOT NULL CHECK (source IN ('stripe','paypal','upgrade_chat','wordpress','discord','sml_platform')),
  source_event_id    TEXT,
  provider_account   TEXT,
  occurred_at        TIMESTAMPTZ NOT NULL,
  received_at        TIMESTAMPTZ NOT NULL,
  provenance         JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash     TEXT NOT NULL,
  prev_hash          TEXT,
  UNIQUE (provider, provider_refund_id)
);

CREATE TABLE dispute_cases (
  id                  BIGSERIAL PRIMARY KEY,
  provider            TEXT NOT NULL,
  provider_dispute_id TEXT NOT NULL,
  reason              TEXT,
  provider_status     TEXT,
  lifecycle_stage     TEXT,
  amount_cents        INT,
  currency            TEXT,
  due_by              TIMESTAMPTZ,
  allowed_actions     JSONB NOT NULL DEFAULT '[]'::jsonb,
  requested_evidence  JSONB NOT NULL DEFAULT '[]'::jsonb,
  transaction_id      BIGINT,
  subscription_id     BIGINT,
  identity_id         BIGINT,
  merchant_account    TEXT,
  stripe_dispute_ref  TEXT,
  case_state          TEXT NOT NULL DEFAULT 'open' CHECK (case_state IN
    ('open','evidence_building','ready_for_review','approved','submitting','submitted','provider_review','won','lost','warning_closed','accepted','expired')),
  response_cycle      INT NOT NULL DEFAULT 1,
  last_event_at       TIMESTAMPTZ,
  source              TEXT NOT NULL CHECK (source IN ('stripe','paypal','upgrade_chat','wordpress','discord','sml_platform')),
  source_event_id     TEXT,
  provider_account    TEXT,
  occurred_at         TIMESTAMPTZ NOT NULL,
  received_at         TIMESTAMPTZ NOT NULL,
  provenance          JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash      TEXT NOT NULL,
  prev_hash           TEXT,
  UNIQUE (provider, provider_dispute_id)
);

CREATE INDEX dispute_cases_due_by_idx
  ON dispute_cases (due_by) WHERE due_by IS NOT NULL;

CREATE TABLE dispute_evidence_items (
  id               BIGSERIAL PRIMARY KEY,
  case_id          BIGINT NOT NULL REFERENCES dispute_cases(id),
  kind             TEXT NOT NULL,
  body_text        TEXT,
  body_json        JSONB,
  file_name        TEXT,
  file_sha256      TEXT,
  file_bytes       BYTEA,
  cited_records    JSONB NOT NULL DEFAULT '[]'::jsonb,
  superseded_by    BIGINT,
  source           TEXT NOT NULL CHECK (source IN ('stripe','paypal','upgrade_chat','wordpress','discord','sml_platform')),
  source_event_id  TEXT,
  provider_account TEXT,
  occurred_at      TIMESTAMPTZ NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL,
  provenance       JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash   TEXT NOT NULL,
  prev_hash        TEXT
);

-- Chain-fork guard: scope = case_id.
CREATE UNIQUE INDEX dispute_evidence_items_chain_guard
  ON dispute_evidence_items (case_id, prev_hash) WHERE prev_hash IS NOT NULL;
CREATE INDEX dispute_evidence_items_case_idx
  ON dispute_evidence_items (case_id);

CREATE TABLE dispute_packets (
  id                BIGSERIAL PRIMARY KEY,
  case_id           BIGINT NOT NULL,
  version           INT NOT NULL,
  response_cycle    INT NOT NULL,
  manifest          JSONB NOT NULL,
  warnings          JSONB NOT NULL DEFAULT '[]'::jsonb,
  pdf_sha256        TEXT NOT NULL,
  pdf_bytes         BYTEA NOT NULL,
  packet_sha256     TEXT NOT NULL,
  generator_version TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL,
  UNIQUE (case_id, version)
);

CREATE TABLE dispute_submissions (
  id                  BIGSERIAL PRIMARY KEY,
  case_id             BIGINT NOT NULL,
  packet_id           BIGINT NOT NULL,
  response_cycle      INT NOT NULL,
  approved_by_wp_user BIGINT NOT NULL,
  approved_at         TIMESTAMPTZ NOT NULL,
  confirmation        JSONB NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('pending','submitting','submitted','failed','rejected')),
  provider_request_id TEXT,
  provider_response   JSONB,
  submitted_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL
);

-- Double-submit guard: at most one live submission per case per response cycle.
CREATE UNIQUE INDEX dispute_submissions_cycle_guard
  ON dispute_submissions (case_id, response_cycle)
  WHERE status IN ('submitting','submitted');

CREATE TABLE dispute_audit_log (
  id               BIGSERIAL PRIMARY KEY,
  case_id          BIGINT,
  actor_kind       TEXT NOT NULL CHECK (actor_kind IN ('system','wp_admin','discord_user')),
  actor_ref        TEXT,
  action           TEXT NOT NULL,
  detail           JSONB NOT NULL DEFAULT '{}'::jsonb,
  source           TEXT NOT NULL CHECK (source IN ('stripe','paypal','upgrade_chat','wordpress','discord','sml_platform')),
  source_event_id  TEXT,
  provider_account TEXT,
  occurred_at      TIMESTAMPTZ NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL,
  provenance       JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash   TEXT NOT NULL,
  prev_hash        TEXT
);

-- Chain-fork guard: scope = COALESCE(case_id, 0); 0 is the system chain.
CREATE UNIQUE INDEX dispute_audit_log_chain_guard
  ON dispute_audit_log ((COALESCE(case_id, 0)), prev_hash) WHERE prev_hash IS NOT NULL;

CREATE TABLE paypal_events (
  event_id            TEXT PRIMARY KEY,
  event_type          TEXT NOT NULL,
  resource_type       TEXT,
  payload             JSONB NOT NULL,
  verification_status TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'received',
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at        TIMESTAMPTZ
);

CREATE TABLE upgrade_chat_records (
  id                          BIGSERIAL PRIMARY KEY,
  webhook_event_id            TEXT UNIQUE,
  uc_order_uuid               TEXT,
  record_type                 TEXT NOT NULL,
  payload                     JSONB NOT NULL,
  payment_processor           TEXT,
  payment_processor_record_id TEXT,
  discord_user_id             TEXT,
  supplemental                BOOLEAN NOT NULL DEFAULT true CHECK (supplemental = true),
  source                      TEXT NOT NULL CHECK (source IN ('stripe','paypal','upgrade_chat','wordpress','discord','sml_platform')),
  source_event_id             TEXT,
  provider_account            TEXT,
  occurred_at                 TIMESTAMPTZ NOT NULL,
  received_at                 TIMESTAMPTZ NOT NULL,
  provenance                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_hash              TEXT NOT NULL,
  prev_hash                   TEXT
);

CREATE TABLE dispute_review_tokens (
  id                     BIGSERIAL PRIMARY KEY,
  token_hash             TEXT NOT NULL UNIQUE,
  case_id                BIGINT NOT NULL,
  issued_to_discord_user TEXT NOT NULL,
  issued_to_identity     BIGINT,
  issued_at              TIMESTAMPTZ NOT NULL,
  expires_at             TIMESTAMPTZ NOT NULL,
  used_at                TIMESTAMPTZ,
  used_by_wp_user        BIGINT
);

CREATE TABLE dispute_access_policies (
  id                      BIGSERIAL PRIMARY KEY,
  merchant_scope          TEXT NOT NULL UNIQUE,
  on_dispute              TEXT NOT NULL DEFAULT 'keep_access' CHECK (on_dispute IN ('keep_access','suspend_access')),
  disclosed_at            TIMESTAMPTZ,
  policy_terms_version_id BIGINT,
  updated_at              TIMESTAMPTZ NOT NULL
);

-- WordPress gateway learns the authenticated usage.* event family so accepted
-- usage events can be copied into service_usage_events by a reviewed consumer.
ALTER TABLE wordpress_gateway_events
  DROP CONSTRAINT wordpress_gateway_event_type_known;
ALTER TABLE wordpress_gateway_events
  ADD CONSTRAINT wordpress_gateway_event_type_known CHECK (event_type IN (
    'system.integration.ping',
    'creator.channel.updated',
    'creator.letter.published',
    'group.member.changed',
    'news.article.published',
    'usage.login',
    'usage.group_access',
    'usage.content_access',
    'usage.stream_access'
  ));

COMMENT ON TABLE billing_identities IS
  'One row per canonical person across SML/WordPress/Discord. Person identifiers are partially unique; email is a candidate signal only.';
COMMENT ON TABLE billing_events IS
  'Normalized append-only billing event stream; hash-chained per provider with raw-store pointers.';
COMMENT ON TABLE dispute_audit_log IS
  'Append-only hash-chained audit trail for dispute cases; case_id NULL rows belong to the system chain (scope 0).';
COMMENT ON TABLE upgrade_chat_records IS
  'Supplemental-only Upgrade.Chat ledger. CHECK (supplemental = true) makes these rows structurally never authoritative.';

COMMIT;
