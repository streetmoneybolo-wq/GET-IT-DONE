import { readSettings } from './storage.js';
import { consumeCooldown } from './cooldowns.js';

export async function notifyOptInRole(interaction, post) {
  const settings = await readSettings();
  const roleId = process.env.BOOST_ROLE_ID;
  if (!settings.boostNotificationsEnabled || !settings.allowRolePing || !roleId) return;
  if (consumeCooldown('notification', interaction.guildId || 'global', settings.cooldowns?.notification ?? 10)) return;
  const channel = settings.notificationChannelId
    ? await interaction.client.channels.fetch(settings.notificationChannelId).catch(() => null)
    : interaction.channel;
  if (!channel?.isTextBased()) return;
  await channel.send({
    content: `<@&${roleId}> New StockMarketLoop item available for review: **${post.title.slice(0, 180)}**\n${post.link}\nPost ID: \`${post.postID}\``,
    allowedMentions: { roles: [roleId] },
  });
}
