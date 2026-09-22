BEGIN;

-- Private contact registry. Plain email addresses are never stored here:
-- email_enc is AES-GCM ciphertext and email_hash is a keyed HMAC used only
-- for deterministic matching and suppression.
CREATE TABLE member_email_contacts (
  id                    BIGSERIAL PRIMARY KEY,
  identity_id           BIGINT REFERENCES billing_identities(id) ON DELETE SET NULL,
  discord_user_id       TEXT,
  wordpress_user_id     BIGINT,
  source                TEXT NOT NULL CHECK (source IN ('upgrade_chat','stripe','discord_oauth','wordpress','sml')),
  source_customer_ref   TEXT NOT NULL,
  email_enc             BYTEA NOT NULL,
  email_hash            TEXT NOT NULL CHECK (email_hash ~ '^[a-f0-9]{64}$'),
  email_domain          TEXT NOT NULL,
  verification_status   TEXT NOT NULL DEFAULT 'provider_verified'
    CHECK (verification_status IN ('provider_verified','member_verified','unverified','invalid')),
  transactional_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  marketing_opt_in      BOOLEAN NOT NULL DEFAULT FALSE,
  marketing_consent_at  TIMESTAMPTZ,
  marketing_consent_source TEXT,
  unsubscribed_at       TIMESTAMPTZ,
  suppressed_at         TIMESTAMPTZ,
  suppression_reason    TEXT,
  renewal_at            TIMESTAMPTZ,
  last_synced_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_customer_ref)
);
CREATE INDEX member_email_contacts_hash_idx ON member_email_contacts (email_hash);
CREATE INDEX member_email_contacts_discord_idx ON member_email_contacts (discord_user_id) WHERE discord_user_id IS NOT NULL;
CREATE INDEX member_email_contacts_renewal_idx ON member_email_contacts (renewal_at)
  WHERE transactional_allowed AND suppressed_at IS NULL;
CREATE INDEX member_email_contacts_marketing_idx ON member_email_contacts (marketing_opt_in, updated_at)
  WHERE marketing_opt_in AND unsubscribed_at IS NULL AND suppressed_at IS NULL;

CREATE TABLE member_email_outbox (
  id                BIGSERIAL PRIMARY KEY,
  contact_id        BIGINT NOT NULL REFERENCES member_email_contacts(id) ON DELETE CASCADE,
  message_type      TEXT NOT NULL CHECK (message_type IN ('renewal','trial_ending','payment_failed','special_offer','verify_email')),
  template_ref      TEXT NOT NULL,
  subject           TEXT NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key   TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed','suppressed')),
  attempts          INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at         TIMESTAMPTZ,
  provider_message_id TEXT,
  last_error        TEXT,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX member_email_outbox_pending_idx ON member_email_outbox (available_at, id)
  WHERE status IN ('pending','failed');

CREATE TABLE member_email_events (
  id                  BIGSERIAL PRIMARY KEY,
  contact_id          BIGINT REFERENCES member_email_contacts(id) ON DELETE SET NULL,
  outbox_id           BIGINT REFERENCES member_email_outbox(id) ON DELETE SET NULL,
  event_type          TEXT NOT NULL CHECK (event_type IN
    ('imported','consent_granted','consent_withdrawn','queued','sent','failed','bounced','complained','suppressed')),
  source              TEXT NOT NULL,
  provider_event_id   TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, provider_event_id)
);
CREATE INDEX member_email_events_contact_idx ON member_email_events (contact_id, occurred_at DESC);

COMMENT ON TABLE member_email_contacts IS
  'Owner-only encrypted contact registry. Never expose through browser analytics, URLs, logs, or Discord.';
COMMENT ON COLUMN member_email_contacts.marketing_opt_in IS
  'Affirmative promotional-email consent. A billing relationship alone never sets this true.';

COMMIT;
