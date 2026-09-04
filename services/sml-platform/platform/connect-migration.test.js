'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  cleanSlug,
  cleanSettings,
  migrationRequiredBanner,
  publicHomepage,
  upsertCampaign
} = require('./connect-migration');
const { createServer } = require('./server');
const { hmac } = require('./wordpress-gateway');

function signedHeaders(secret, body, timestamp = '1700000000') {
  return {
    'content-type': 'application/json',
    'x-sml-timestamp': timestamp,
    'x-sml-signature': `sha256=${hmac(secret, timestamp, body)}`
  };
}

function makePool() {
  const calls = [];
  const campaign = {
    id: 9,
    campaign_id: 9,
    group_id: 7,
    owner_user_id: 42,
    guild_id: '938894329076940820',
    provider: 'upgrade_chat',
    status: 'live',
    public_slug: 'making-easy-money',
    discord_invite_url: 'https://discord.gg/example',
    discord_avatar_url: 'https://cdn.discordapp.com/icons/1/avatar.png',
    discord_banner_url: 'https://cdn.discordapp.com/banners/1/banner.png',
    headline: 'Making Easy Money on StockMarketLoop Connect',
    description: 'Click the link to join the underlying Discord group and unlock premium market alerts.',
    homepage_title: 'Making Easy Money Discord Group',
    homepage_description: 'A StockMarketLoop-powered trading community with alerts, memberships, and live market tools.',
    seo_title: 'Making Easy Money Discord Group | StockMarketLoop Connect',
    seo_description: 'Join the Making Easy Money Discord community through StockMarketLoop Connect.',
    migrated_perks_enabled: false,
    settings: { perks: ['dispute_evidence', 'retail_trader_spotlight'] },
    updated_at: '2026-09-04T00:00:00.000Z',
    plans: [
      { planId: 11, slug: 'vip', name: 'VIP Alerts', interval: 'monthly', priceCents: 4900, currency: 'usd', trialDays: 0, roleRefs: ['123456789012345678'] }
    ]
  };
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM connect_group_homepages_public')) return { rows: params[0] === 'missing' ? [] : [campaign], rowCount: params[0] === 'missing' ? 0 : 1 };
      if (sql.includes('FROM connect_message_snapshots')) return {
        rows: [{ author_label: 'Grandmaster OBI', content_preview: '$SPY alert posted', message_url: 'https://discord.com/channels/1/2/3', posted_at: '2026-09-04T01:00:00.000Z' }],
        rowCount: 1
      };
      if (sql.includes('INSERT INTO connect_migration_events')) return { rows: [{ id: 77 }], rowCount: 1 };
      if (sql.includes('INSERT INTO connect_migration_campaigns')) return { rows: [campaign], rowCount: 1 };
      throw new Error(`unexpected query: ${sql}`);
    }
  };
}

async function withServer(options, run) {
  const server = createServer({
    checkDatabase: async () => true,
    acceptWordPressEvent: async () => 'accepted',
    logger: () => {},
    now: () => 1_700_000_000_000,
    ...options
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('Connect migration cleans public slugs for indexed group pages', () => {
  assert.equal(cleanSlug('Making Easy Money!!'), 'making-easy-money');
  assert.throws(() => cleanSlug('__'), /public slug/);
});

test('Connect settings default to the full replacement perk bundle', () => {
  const settings = cleanSettings({});
  assert.equal(settings.requireMigrationForPerks, true);
  assert.ok(settings.perks.includes('dispute_evidence'));
  assert.ok(settings.perks.includes('retail_trader_spotlight'));
  assert.ok(settings.perks.includes('indexed_discord_homepage'));
});

test('perks stay locked until the group owner migrates billing to SML', () => {
  assert.equal(migrationRequiredBanner({ migratedPerksEnabled: true }), null);
  const locked = migrationRequiredBanner({ migratedPerksEnabled: false });
  assert.equal(locked.locked, true);
  assert.match(locked.message, /Connect migration is required/);
});

test('public homepage exposes SEO, Discord join card, prices, and live message previews', async () => {
  const pool = makePool();
  const page = await publicHomepage(pool, 'making-easy-money', { recordView: true });
  assert.equal(page.seo.robots, 'index,follow');
  assert.equal(page.joinCard.description, 'Click the link to join the underlying Discord group.');
  assert.equal(page.joinCard.cta, 'Join Discord Group');
  assert.equal(page.plans[0].name, 'VIP Alerts');
  assert.equal(page.liveMessages[0].preview, '$SPY alert posted');
  assert.equal(page.perkGate.locked, true);
  assert.ok(pool.calls.some((call) => call.sql.includes('INSERT INTO connect_migration_events')));
});

test('public homepage returns null for missing campaign', async () => {
  assert.equal(await publicHomepage(makePool(), 'missing'), null);
});

test('campaign upsert validates Discord and invite URLs before writing', async () => {
  await assert.rejects(() => upsertCampaign(makePool(), {
    groupId: 7,
    ownerUserId: 42,
    guildId: 'not-a-snowflake',
    publicSlug: 'making-easy-money'
  }), /guildId/);
  await assert.rejects(() => upsertCampaign(makePool(), {
    groupId: 7,
    ownerUserId: 42,
    guildId: '938894329076940820',
    publicSlug: 'making-easy-money',
    discordInviteUrl: 'https://evil.example/invite'
  }), /discordInviteUrl/);
});

test('signed Connect owner endpoint rejects bad signatures before database access', async () => {
  const pool = makePool();
  const body = JSON.stringify({ groupId: 7, ownerUserId: 42 });
  await withServer({ pool, billingApiSecret: 'connect-secret' }, async (base) => {
    const response = await fetch(`${base}/v1/connect/migration/dashboard`, {
      method: 'POST',
      body,
      headers: signedHeaders('wrong-secret', body)
    });
    assert.equal(response.status, 401);
    assert.equal(pool.calls.length, 0);
  });
});

test('public Connect route is available without owner signature', async () => {
  const pool = makePool();
  await withServer({ pool, billingApiSecret: 'connect-secret' }, async (base) => {
    const response = await fetch(`${base}/v1/connect/public/making-easy-money`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.joinCard.cta, 'Join Discord Group');
  });
});
