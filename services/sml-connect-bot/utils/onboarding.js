/* =============================================================================
 * StockMarketLoop Connect — first-run onboarding (owner call 2026-09-07)
 *
 * The moment the bot is added to a server it introduces itself and asks the
 * owner to create (or connect) the server's Stock Market Loop group and to
 * migrate paid members. Posted in the server's system channel (or the first
 * text channel the bot can write in) AND sent privately to the server owner,
 * so the ask is seen even when the server has no general channel yet.
 * ========================================================================== */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } from 'discord.js';

const SITE = 'https://stockmarketloop.com';
const APP_ID = '1537698927401377894';
const INVITE = `https://discord.com/oauth2/authorize?client_id=${APP_ID}&scope=bot%20applications.commands&permissions=268520514`;

export function createGroupUrl(guildName, guildId) {
  const u = new URL(`${SITE}/groups/`);
  u.searchParams.set('create', '1');
  u.searchParams.set('sml_connect', '1');
  if (guildName) u.searchParams.set('default_name', String(guildName).slice(0, 80));
  if (guildId) u.searchParams.set('guild', String(guildId));
  return u.toString();
}

export function migrateUrl(guildId) {
  const u = new URL(`${SITE}/connect-migrate/`);
  if (guildId) u.searchParams.set('guildId', String(guildId));
  return u.toString();
}

export function dashboardUrl(guildName, guildId) {
  const u = new URL(`${SITE}/connect-dashboard/`);
  if (guildId) {
    u.searchParams.set('guild_id', String(guildId));
    u.searchParams.set('guildId', String(guildId));
  }
  if (guildName) u.searchParams.set('default_name', String(guildName).slice(0, 80));
  u.searchParams.set('source', 'discord_bot');
  return u.toString();
}

export function ownerDashboardComponents(guild) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Migrate').setURL(migrateUrl(guild.id)),
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Dashboard').setURL(dashboardUrl(guild.name, guild.id))
    )
  ];
}

export function onboardingMessage(guild) {
  const embed = new EmbedBuilder()
    .setColor(0x38f58a)
    .setTitle(`StockMarketLoop Connect is now in ${guild.name}`)
    .setDescription(
      'Thanks for adding the bot. Three steps and your community is on Stock Market Loop:\n\n' +
      '**1. Create your Stock Market Loop group** — the button below opens the site with this server\'s name already filled in. ' +
      'Your group gets a public page, a Portal chat, a live chart, a market scanner, the analyst dashboard and per-ticker voice rooms.\n\n' +
      '**2. Connect this server to that group** — in the group\'s **Edit Group → Discord Access** panel generate a one-time code, then run ' +
      '`/connect-sml-group code:…` here. Your channels, roles and permissions mirror to the site; run `/sync-sml-channels` after changes.\n\n' +
      '**3. Move your members** — each paid member confirms their move on the migration page (their Upgrade.Chat renewal date is kept, no double charge). ' +
      'Every member links their account with `/link-sml` using the code from ' + SITE + '/connect-discord/.\n\n' +
      'Already have a group? Skip to step 2.\n\n' +
      'Commands available right now: `/share` `/news` `/share-setup` `/leaderboard` `/boost` `/tracking` `/link-sml` `/refresh-sml-access` `/connect-sml-group` `/sync-sml-channels`'
    )
    .setFooter({ text: '— Stock Market Loop Connect · not financial advice' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Create my Stock Market Loop group').setURL(createGroupUrl(guild.name, guild.id)),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Migrate my members').setURL(migrateUrl(guild.id)),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Owner dashboard').setURL(dashboardUrl(guild.name, guild.id))
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Guides & support').setURL(`${SITE}/connect/`),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Add to another server').setURL(INVITE)
  );
  return { embeds: [embed], components: [row, row2] };
}

function canPost(channel, me) {
  if (!channel || channel.type !== 0 || !me) return false;
  const perms = channel.permissionsFor(me);
  return !!perms && perms.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.SendMessages) && perms.has(PermissionFlagsBits.EmbedLinks);
}

/** Post the onboarding card in the server and DM the owner. Never throws. */
export async function sendOnboarding(guild) {
  const payload = onboardingMessage(guild);
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  let target = guild.systemChannel && canPost(guild.systemChannel, me) ? guild.systemChannel : null;
  if (!target) {
    const channels = await guild.channels.fetch().catch(() => null);
    if (channels) {
      target = [...channels.values()]
        .filter((c) => canPost(c, me))
        .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
        .find((c) => /general|welcome|start|lobby|chat/i.test(c.name)) || [...channels.values()].filter((c) => canPost(c, me)).sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))[0] || null;
    }
  }
  let posted = false;
  if (target) {
    await target.send(payload).then(() => { posted = true; }).catch((error) => console.error(`Onboarding post failed safely in ${guild.id}:`, error.message || error));
  }
  const owner = await guild.fetchOwner().catch(() => null);
  if (owner) {
    await owner.send({ content: `You just added StockMarketLoop Connect to **${guild.name}**. Here is how to create your Stock Market Loop group and move your members:`, ...payload })
      .catch((error) => console.error(`Onboarding DM to the owner of ${guild.id} failed safely:`, error.message || error));
  }
  console.log(`Onboarding for ${guild.name} (${guild.id}): channel ${posted ? '#' + target.name : 'none'}, owner DM ${owner ? 'attempted' : 'skipped'}.`);
}
