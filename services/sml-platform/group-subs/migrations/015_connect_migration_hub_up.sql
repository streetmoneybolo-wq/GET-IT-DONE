BEGIN;

-- StockMarketLoop Connect migration hub
--
-- This is the owner-facing replacement layer for Upgrade.Chat-style Discord
-- memberships. It does not move money without subscriber consent. Instead, it:
--   1. lets a Discord owner publish an indexed SML group homepage/card;
--   2. maps SML plans to imported provider products/Discord roles;
--   3. records migration funnel + analytics events; and
--   4. gates the premium Connect bundle until the owner migrates billing to SML.

CREATE TABLE connect_migration_campaigns (
  id                       BIGSERIAL PRIMARY KEY,
  group_id                 BIGINT      NOT NULL UNIQUE,
  owner_user_id            BIGINT      NOT NULL,
  guild_id                 TEXT        NOT NULL,
  provider                 TEXT        NOT NULL DEFAULT 'upgrade_chat',
  status                   TEXT        NOT NULL DEFAULT 'draft',
  public_slug              TEXT        NOT NULL UNIQUE,
  discord_invite_url       TEXT,
  discord_avatar_url       TEXT,
  discord_banner_url       TEXT,
  headline                 TEXT        NOT NULL,
  description              TEXT        NOT NULL,
  homepage_title           TEXT        NOT NULL,
  homepage_description     TEXT        NOT NULL,
  seo_title                TEXT        NOT NULL,
  seo_description          TEXT        NOT NULL,
  migrated_perks_enabled   BOOLEAN     NOT NULL DEFAULT false,
  settings                 JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT connect_campaign_status_check CHECK (status IN ('draft','live','paused','archived')),
  CONSTRAINT connect_campaign_provider_check CHECK (provider IN ('upgrade_chat','discord','telegram','manual')),
  CONSTRAINT connect_campaign_slug_check CHECK (public_slug ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
  CONSTRAINT connect_campaign_guild_check CHECK (guild_id ~ '^[0-9]{15,24}$')
);

COMMENT ON TABLE connect_migration_campaigns IS
  'Public indexed Discord group homepage plus the owner migration switch for StockMarketLoop Connect.';
COMMENT ON COLUMN connect_migration_campaigns.migrated_perks_enabled IS
  'Only true after the owner has moved paid memberships to SML billing; controls Connect-only perks.';

CREATE INDEX connect_campaigns_owner_idx ON connect_migration_campaigns (owner_user_id, status);
CREATE INDEX connect_campaigns_guild_idx ON connect_migration_campaigns (guild_id) WHERE status <> 'archived';

CREATE TABLE connect_plan_mappings (
  id                   BIGSERIAL PRIMARY KEY,
  campaign_id          BIGINT      NOT NULL REFERENCES connect_migration_campaigns(id) ON DELETE CASCADE,
  group_plan_id         BIGINT      NOT NULL REFERENCES group_plans(id) ON DELETE CASCADE,
  external_product_ref  TEXT,
  discord_role_refs     JSONB      NOT NULL DEFAULT '[]'::jsonb,
  card_title            TEXT,
  card_description      TEXT,
  display_order         INTEGER    NOT NULL DEFAULT 0,
  active                BOOLEAN    NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT connect_plan_mapping_plan_uniq UNIQUE (campaign_id, group_plan_id),
  CONSTRAINT connect_plan_mapping_order_nonneg CHECK (display_order >= 0)
);

COMMENT ON TABLE connect_plan_mappings IS
  'Maps each SML group plan to an external Upgrade.Chat/Discord product and the Discord roles it should manage.';

CREATE INDEX connect_plan_mappings_campaign_idx ON connect_plan_mappings (campaign_id, active, display_order, id);

CREATE TABLE connect_migration_events (
  id                BIGSERIAL PRIMARY KEY,
  campaign_id       BIGINT REFERENCES connect_migration_campaigns(id) ON DELETE CASCADE,
  group_id          BIGINT      NOT NULL,
  owner_user_id     BIGINT,
  actor_user_id     BIGINT,
  discord_user_id   TEXT,
  event_type        TEXT        NOT NULL,
  source            TEXT        NOT NULL DEFAULT 'sml_connect',
  amount_cents      INTEGER,
  currency          TEXT        DEFAULT 'usd',
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT connect_migration_event_type_check CHECK (
    event_type IN (
      'homepage_view','join_click','checkout_started','migration_verified',
      'migration_completed','role_granted','role_revoked','dispute_case_opened',
      'spotlight_enabled','settings_updated'
    )
  ),
  CONSTRAINT connect_migration_event_amount_nonneg CHECK (amount_cents IS NULL OR amount_cents >= 0)
);

CREATE INDEX connect_events_campaign_idx ON connect_migration_events (campaign_id, occurred_at DESC);
CREATE INDEX connect_events_group_idx ON connect_migration_events (group_id, occurred_at DESC);
CREATE INDEX connect_events_type_idx ON connect_migration_events (event_type, occurred_at DESC);

CREATE TABLE connect_message_snapshots (
  id               BIGSERIAL PRIMARY KEY,
  campaign_id      BIGINT      NOT NULL REFERENCES connect_migration_campaigns(id) ON DELETE CASCADE,
  guild_id         TEXT        NOT NULL,
  channel_id       TEXT        NOT NULL,
  message_id       TEXT        NOT NULL,
  author_label     TEXT,
  content_preview  TEXT        NOT NULL,
  message_url      TEXT,
  posted_at        TIMESTAMPTZ NOT NULL,
  captured_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT connect_message_snapshots_uniq UNIQUE (guild_id, channel_id, message_id)
);

COMMENT ON TABLE connect_message_snapshots IS
  'Sanitized live Discord message previews for indexed group homepages. Store previews only, not private full history.';

CREATE INDEX connect_message_snapshots_campaign_idx
  ON connect_message_snapshots (campaign_id, posted_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at_connect_migration()
RETURNS TRIGGER AS $BODY$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$BODY$ LANGUAGE plpgsql;

CREATE TRIGGER connect_campaigns_touch BEFORE UPDATE ON connect_migration_campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_connect_migration();

CREATE TRIGGER connect_plan_mappings_touch BEFORE UPDATE ON connect_plan_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_connect_migration();

CREATE VIEW connect_group_homepages_public AS
SELECT
  c.id AS campaign_id,
  c.group_id,
  c.guild_id,
  c.public_slug,
  c.discord_invite_url,
  c.discord_avatar_url,
  c.discord_banner_url,
  c.headline,
  c.description,
  c.homepage_title,
  c.homepage_description,
  c.seo_title,
  c.seo_description,
  c.migrated_perks_enabled,
  c.updated_at,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'planId', p.id,
        'slug', p.slug,
        'name', COALESCE(m.card_title, p.name),
        'description', m.card_description,
        'interval', p.interval_key,
        'priceCents', p.price_cents,
        'currency', p.currency,
        'trialDays', p.trial_days,
        'roleRefs', m.discord_role_refs
      )
      ORDER BY m.display_order, p.price_cents, p.id
    ) FILTER (WHERE p.id IS NOT NULL),
    '[]'::jsonb
  ) AS plans
FROM connect_migration_campaigns c
LEFT JOIN connect_plan_mappings m ON m.campaign_id = c.id AND m.active = true
LEFT JOIN group_plans p ON p.id = m.group_plan_id AND p.active = true
WHERE c.status = 'live'
GROUP BY c.id;

CREATE VIEW connect_group_migration_analytics AS
SELECT
  c.id AS campaign_id,
  c.group_id,
  COUNT(*) FILTER (WHERE e.event_type = 'homepage_view')::int AS homepage_views,
  COUNT(*) FILTER (WHERE e.event_type = 'join_click')::int AS join_clicks,
  COUNT(*) FILTER (WHERE e.event_type = 'checkout_started')::int AS checkout_starts,
  COUNT(*) FILTER (WHERE e.event_type = 'migration_verified')::int AS migrations_verified,
  COUNT(*) FILTER (WHERE e.event_type = 'migration_completed')::int AS migrations_completed,
  COUNT(*) FILTER (WHERE e.event_type = 'dispute_case_opened')::int AS dispute_cases,
  COALESCE(SUM(e.amount_cents) FILTER (WHERE e.event_type = 'migration_completed'), 0)::bigint AS migrated_revenue_cents,
  MAX(e.occurred_at) AS last_event_at
FROM connect_migration_campaigns c
LEFT JOIN connect_migration_events e ON e.campaign_id = c.id
GROUP BY c.id, c.group_id;

COMMIT;
