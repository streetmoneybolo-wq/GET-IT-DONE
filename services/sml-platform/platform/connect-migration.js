'use strict';

const SNOWFLAKE_RE = /^[0-9]{15,24}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,80}$/;
const HTTPS_IMAGE_RE = /^https:\/\/[^\s"<>]+$/i;
const DEFAULT_PERKS = Object.freeze([
  'connect_security_management',
  'dispute_evidence',
  'retail_trader_spotlight',
  'indexed_discord_homepage',
  'subscription_storefront',
  'live_watch_page',
  'loop_letter_bundle',
  'discord_role_sync'
]);

function cleanText(value, field, { min = 1, max = 240 } = {}) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length < min) throw new TypeError(`${field} is required`);
  if (text.length > max) throw new TypeError(`${field} is too long`);
  return text;
}

function cleanOptionalText(value, field, max = 240) {
  if (value == null || String(value).trim() === '') return null;
  return cleanText(value, field, { min: 1, max });
}

function cleanSlug(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!SLUG_RE.test(slug)) throw new TypeError('public slug must be 3-80 lowercase letters, numbers, or dashes');
  return slug;
}

function cleanSnowflake(value, field) {
  const id = String(value || '').trim();
  if (!SNOWFLAKE_RE.test(id)) throw new TypeError(`${field} must be a Discord snowflake`);
  return id;
}

function cleanHttpsUrl(value, field, { required = false, hosts = null } = {}) {
  if (value == null || String(value).trim() === '') {
    if (required) throw new TypeError(`${field} is required`);
    return null;
  }
  let url;
  try { url = new URL(String(value).trim()); } catch (_) { throw new TypeError(`${field} must be a valid URL`); }
  if (url.protocol !== 'https:') throw new TypeError(`${field} must use https`);
  if (hosts && !hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new TypeError(`${field} must be hosted on ${hosts.join(', ')}`);
  }
  return url.toString();
}

function cleanImageUrl(value, field) {
  const url = cleanHttpsUrl(value, field);
  if (url && !HTTPS_IMAGE_RE.test(url)) throw new TypeError(`${field} contains invalid characters`);
  return url;
}

function cleanSettings(input = {}) {
  const settings = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    requireMigrationForPerks: settings.requireMigrationForPerks !== false,
    showLiveMessages: settings.showLiveMessages !== false,
    showStorefront: settings.showStorefront !== false,
    showLiveWatch: settings.showLiveWatch !== false,
    showLoopLetter: settings.showLoopLetter !== false,
    perks: Array.isArray(settings.perks) && settings.perks.length
      ? settings.perks.map((p) => cleanText(p, 'perk', { max: 80 })).slice(0, 20)
      : [...DEFAULT_PERKS]
  };
}

function rowToCampaign(row) {
  if (!row) return null;
  return {
    id: Number(row.id || row.campaign_id),
    groupId: Number(row.group_id),
    ownerUserId: row.owner_user_id == null ? null : Number(row.owner_user_id),
    guildId: row.guild_id,
    provider: row.provider,
    status: row.status,
    publicSlug: row.public_slug,
    discordInviteUrl: row.discord_invite_url,
    discordAvatarUrl: row.discord_avatar_url,
    discordBannerUrl: row.discord_banner_url,
    headline: row.headline,
    description: row.description,
    homepageTitle: row.homepage_title,
    homepageDescription: row.homepage_description,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    migratedPerksEnabled: !!row.migrated_perks_enabled,
    settings: row.settings || {},
    updatedAt: row.updated_at,
    plans: Array.isArray(row.plans) ? row.plans : []
  };
}

function assertOwner(input) {
  const groupId = Number(input.groupId);
  const ownerUserId = Number(input.ownerUserId);
  if (!Number.isSafeInteger(groupId) || groupId < 1) throw new TypeError('groupId is required');
  if (!Number.isSafeInteger(ownerUserId) || ownerUserId < 1) throw new TypeError('ownerUserId is required');
  return { groupId, ownerUserId };
}

function migrationRequiredBanner(campaign) {
  if (campaign.migratedPerksEnabled) return null;
  return {
    locked: true,
    message: 'Connect migration is required to unlock StockMarketLoop security management, dispute defense, Retail Trader Spotlight, indexed group homepage, storefront, live watch, and Loop Letter tools.'
  };
}

async function upsertCampaign(pool, input = {}) {
  const { groupId, ownerUserId } = assertOwner(input);
  const guildId = cleanSnowflake(input.guildId, 'guildId');
  const publicSlug = cleanSlug(input.publicSlug || input.groupSlug || input.groupName || `group-${groupId}`);
  const status = ['draft', 'live', 'paused', 'archived'].includes(String(input.status || 'draft'))
    ? String(input.status || 'draft') : 'draft';
  const provider = ['upgrade_chat', 'discord', 'telegram', 'manual'].includes(String(input.provider || 'upgrade_chat'))
    ? String(input.provider || 'upgrade_chat') : 'upgrade_chat';
  const headline = cleanText(input.headline || 'Join this StockMarketLoop-powered Discord community', 'headline', { max: 140 });
  const description = cleanText(
    input.description || 'Click the link to join the underlying Discord group, unlock premium alerts, and manage your membership through StockMarketLoop Connect.',
    'description',
    { max: 500 }
  );
  const homepageTitle = cleanText(input.homepageTitle || headline, 'homepageTitle', { max: 140 });
  const homepageDescription = cleanText(input.homepageDescription || description, 'homepageDescription', { max: 500 });
  const seoTitle = cleanText(input.seoTitle || `${homepageTitle} | StockMarketLoop Connect`, 'seoTitle', { max: 160 });
  const seoDescription = cleanText(input.seoDescription || homepageDescription, 'seoDescription', { max: 300 });
  const discordInviteUrl = cleanHttpsUrl(input.discordInviteUrl, 'discordInviteUrl', {
    hosts: ['discord.gg', 'discord.com']
  });
  const discordAvatarUrl = cleanImageUrl(input.discordAvatarUrl, 'discordAvatarUrl');
  const discordBannerUrl = cleanImageUrl(input.discordBannerUrl, 'discordBannerUrl');
  const migratedPerksEnabled = input.migratedPerksEnabled === true;
  const settings = cleanSettings(input.settings);

  const result = await pool.query(
    `INSERT INTO connect_migration_campaigns (
       group_id, owner_user_id, guild_id, provider, status, public_slug,
       discord_invite_url, discord_avatar_url, discord_banner_url,
       headline, description, homepage_title, homepage_description,
       seo_title, seo_description, migrated_perks_enabled, settings
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
     ON CONFLICT (group_id) DO UPDATE SET
       owner_user_id = EXCLUDED.owner_user_id,
       guild_id = EXCLUDED.guild_id,
       provider = EXCLUDED.provider,
       status = EXCLUDED.status,
       public_slug = EXCLUDED.public_slug,
       discord_invite_url = EXCLUDED.discord_invite_url,
       discord_avatar_url = EXCLUDED.discord_avatar_url,
       discord_banner_url = EXCLUDED.discord_banner_url,
       headline = EXCLUDED.headline,
       description = EXCLUDED.description,
       homepage_title = EXCLUDED.homepage_title,
       homepage_description = EXCLUDED.homepage_description,
       seo_title = EXCLUDED.seo_title,
       seo_description = EXCLUDED.seo_description,
       migrated_perks_enabled = EXCLUDED.migrated_perks_enabled,
       settings = EXCLUDED.settings,
       updated_at = now()
     RETURNING *`,
    [
      groupId, ownerUserId, guildId, provider, status, publicSlug,
      discordInviteUrl, discordAvatarUrl, discordBannerUrl,
      headline, description, homepageTitle, homepageDescription,
      seoTitle, seoDescription, migratedPerksEnabled, JSON.stringify(settings)
    ]
  );
  await recordEvent(pool, {
    campaignId: result.rows[0].id,
    groupId,
    ownerUserId,
    eventType: 'settings_updated',
    metadata: { status, provider, migratedPerksEnabled }
  });
  return { campaign: rowToCampaign(result.rows[0]), perkGate: migrationRequiredBanner(rowToCampaign(result.rows[0])) };
}

async function replacePlanMappings(pool, input = {}) {
  const { groupId, ownerUserId } = assertOwner(input);
  const mappings = Array.isArray(input.mappings) ? input.mappings : [];
  if (!mappings.length) throw new TypeError('at least one plan mapping is required');
  const campaign = await pool.query(
    `SELECT * FROM connect_migration_campaigns WHERE group_id = $1 AND owner_user_id = $2 AND status <> 'archived'`,
    [groupId, ownerUserId]
  );
  const campaignRow = campaign.rows[0];
  if (!campaignRow) throw new TypeError('connect campaign not found for this owner and group');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE connect_plan_mappings SET active = false WHERE campaign_id = $1', [campaignRow.id]);
    let order = 0;
    for (const mapping of mappings.slice(0, 50)) {
      const planId = Number(mapping.planId);
      if (!Number.isSafeInteger(planId) || planId < 1) throw new TypeError('planId is required');
      const externalProductRef = cleanOptionalText(mapping.externalProductRef, 'externalProductRef', 120);
      const roleRefs = Array.isArray(mapping.discordRoleRefs)
        ? mapping.discordRoleRefs.map((r) => cleanSnowflake(r, 'discordRoleRef')).slice(0, 20)
        : [];
      const cardTitle = cleanOptionalText(mapping.cardTitle, 'cardTitle', 140);
      const cardDescription = cleanOptionalText(mapping.cardDescription, 'cardDescription', 300);
      await client.query(
        `INSERT INTO connect_plan_mappings (
           campaign_id, group_plan_id, external_product_ref, discord_role_refs,
           card_title, card_description, display_order, active
         ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,true)
         ON CONFLICT (campaign_id, group_plan_id) DO UPDATE SET
           external_product_ref = EXCLUDED.external_product_ref,
           discord_role_refs = EXCLUDED.discord_role_refs,
           card_title = EXCLUDED.card_title,
           card_description = EXCLUDED.card_description,
           display_order = EXCLUDED.display_order,
           active = true,
           updated_at = now()`,
        [campaignRow.id, planId, externalProductRef, JSON.stringify(roleRefs), cardTitle, cardDescription, order++]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
    throw error;
  } finally {
    client.release();
  }
  await recordEvent(pool, {
    campaignId: campaignRow.id,
    groupId,
    ownerUserId,
    eventType: 'settings_updated',
    metadata: { mappings: mappings.length }
  });
  return dashboard(pool, { groupId, ownerUserId });
}

async function dashboard(pool, input = {}) {
  const { groupId, ownerUserId } = assertOwner(input);
  const campaign = await pool.query(
    `SELECT * FROM connect_migration_campaigns WHERE group_id = $1 AND owner_user_id = $2 AND status <> 'archived'`,
    [groupId, ownerUserId]
  );
  const campaignRow = campaign.rows[0] || null;
  const plans = await pool.query(
    `SELECT p.id, p.slug, p.name, p.interval_key, p.price_cents, p.currency, p.trial_days,
            p.platform_fee_bps, p.active,
            m.external_product_ref, m.discord_role_refs, m.card_title, m.card_description, m.display_order
       FROM group_plans p
       LEFT JOIN connect_plan_mappings m
         ON m.group_plan_id = p.id
        AND ($3::bigint IS NOT NULL AND m.campaign_id = $3)
        AND m.active = true
      WHERE p.group_id = $1
      ORDER BY COALESCE(m.display_order, 9999), p.price_cents, p.id`,
    [groupId, ownerUserId, campaignRow ? campaignRow.id : null]
  );
  const analytics = campaignRow ? await pool.query(
    `SELECT * FROM connect_group_migration_analytics WHERE campaign_id = $1`,
    [campaignRow.id]
  ) : { rows: [] };
  const subscriptions = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE origin = 'discord_imported' AND superseded_by IS NULL)::int AS imported_active,
       COUNT(*) FILTER (WHERE origin = 'migrated')::int AS migrated_native,
       COUNT(*) FILTER (WHERE origin = 'sml_checkout')::int AS native_checkout,
       COUNT(*) FILTER (WHERE status IN ('past_due','grace','unpaid'))::int AS at_risk
     FROM subscriptions WHERE group_id = $1`,
    [groupId]
  );
  const mappedPlans = plans.rows.filter((p) => p.external_product_ref || (Array.isArray(p.discord_role_refs) && p.discord_role_refs.length));
  const mappedPlanIds = new Set(mappedPlans.map((p) => Number(p.id)));
  return {
    campaign: rowToCampaign(campaignRow),
    perkGate: campaignRow ? migrationRequiredBanner(rowToCampaign(campaignRow)) : {
      locked: true,
      message: 'Create and publish the Connect migration campaign before perks can unlock.'
    },
    plans: plans.rows.map((p) => ({
      planId: Number(p.id),
      slug: p.slug,
      name: p.name,
      interval: p.interval_key,
      priceCents: Number(p.price_cents),
      currency: p.currency,
      trialDays: Number(p.trial_days || 0),
      platformFeeBps: Number(p.platform_fee_bps || 0),
      active: !!p.active,
      mapped: mappedPlanIds.has(Number(p.id)),
      externalProductRef: p.external_product_ref || null,
      discordRoleRefs: Array.isArray(p.discord_role_refs) ? p.discord_role_refs : [],
      cardTitle: p.card_title || null,
      cardDescription: p.card_description || null
    })),
    analytics: analytics.rows[0] || {
      homepage_views: 0,
      join_clicks: 0,
      checkout_starts: 0,
      migrations_verified: 0,
      migrations_completed: 0,
      dispute_cases: 0,
      migrated_revenue_cents: 0
    },
    subscriptionSummary: subscriptions.rows[0] || {
      imported_active: 0,
      migrated_native: 0,
      native_checkout: 0,
      at_risk: 0
    },
    requirements: {
      stripeSellerConnected: true,
      discordGuildLinked: !!campaignRow,
      userConsentRequired: true,
      nextPaymentDatePreservedBy: 'verified provider renewal date -> Stripe trial_end',
      perksUnlocked: !!(campaignRow && campaignRow.migrated_perks_enabled)
    }
  };
}

async function publicHomepage(pool, slug, { recordView = false } = {}) {
  const publicSlug = cleanSlug(slug);
  const result = await pool.query(
    `SELECT * FROM connect_group_homepages_public WHERE public_slug = $1 LIMIT 1`,
    [publicSlug]
  );
  const row = result.rows[0];
  if (!row) return null;
  const campaign = rowToCampaign(row);
  const messages = await pool.query(
    `SELECT author_label, content_preview, message_url, posted_at
       FROM connect_message_snapshots
      WHERE campaign_id = $1
      ORDER BY posted_at DESC
      LIMIT 20`,
    [campaign.id]
  );
  if (recordView) {
    await recordEvent(pool, {
      campaignId: campaign.id,
      groupId: campaign.groupId,
      eventType: 'homepage_view',
      metadata: { publicSlug }
    });
  }
  return {
    campaign,
    seo: {
      title: campaign.seoTitle,
      description: campaign.seoDescription,
      canonical: `https://stockmarketloop.com/connect/${campaign.publicSlug}/`,
      robots: 'index,follow'
    },
    joinCard: {
      title: campaign.headline,
      description: 'Click the link to join the underlying Discord group.',
      cta: 'Join Discord Group',
      url: campaign.discordInviteUrl,
      avatarUrl: campaign.discordAvatarUrl,
      bannerUrl: campaign.discordBannerUrl
    },
    perks: campaign.settings && Array.isArray(campaign.settings.perks) ? campaign.settings.perks : [...DEFAULT_PERKS],
    plans: campaign.plans,
    liveMessages: messages.rows.map((m) => ({
      author: m.author_label,
      preview: m.content_preview,
      url: m.message_url,
      postedAt: m.posted_at
    })),
    perkGate: migrationRequiredBanner(campaign)
  };
}

async function recordEvent(pool, input = {}) {
  const groupId = Number(input.groupId);
  if (!Number.isSafeInteger(groupId) || groupId < 1) throw new TypeError('groupId is required');
  const campaignId = input.campaignId == null ? null : Number(input.campaignId);
  const eventType = cleanText(input.eventType, 'eventType', { max: 80 });
  const allowed = new Set([
    'homepage_view', 'join_click', 'checkout_started', 'migration_verified',
    'migration_completed', 'role_granted', 'role_revoked', 'dispute_case_opened',
    'spotlight_enabled', 'settings_updated'
  ]);
  if (!allowed.has(eventType)) throw new TypeError('unsupported Connect event type');
  const result = await pool.query(
    `INSERT INTO connect_migration_events (
       campaign_id, group_id, owner_user_id, actor_user_id, discord_user_id,
       event_type, source, amount_cents, currency, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     RETURNING id`,
    [
      Number.isSafeInteger(campaignId) && campaignId > 0 ? campaignId : null,
      groupId,
      input.ownerUserId == null ? null : Number(input.ownerUserId),
      input.actorUserId == null ? null : Number(input.actorUserId),
      input.discordUserId == null ? null : String(input.discordUserId),
      eventType,
      input.source ? cleanText(input.source, 'source', { max: 80 }) : 'sml_connect',
      input.amountCents == null ? null : Number(input.amountCents),
      input.currency ? cleanText(input.currency, 'currency', { max: 8 }).toLowerCase() : 'usd',
      JSON.stringify(input.metadata && typeof input.metadata === 'object' ? input.metadata : {})
    ]
  );
  return { eventId: Number(result.rows[0].id) };
}

module.exports = {
  DEFAULT_PERKS,
  cleanSlug,
  cleanSettings,
  migrationRequiredBanner,
  publicHomepage,
  replacePlanMappings,
  dashboard,
  recordEvent,
  upsertCampaign
};
