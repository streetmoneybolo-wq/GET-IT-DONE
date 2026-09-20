import { SlashCommandBuilder } from 'discord.js';
import { isRoleSyncGuild, linkSmlAccount, roleSyncEnabled } from '../utils/siteRoleSync.js';

export const data = new SlashCommandBuilder()
  .setName('link-sml')
  .setDescription('Connect your Discord account to your StockMarketLoop account.')
  .addStringOption((option) => option
    .setName('code')
    .setDescription('Your one-time code from stockmarketloop.com/connect-discord/')
    .setRequired(true));

export async function execute(interaction) {
  if (!interaction.guildId || !isRoleSyncGuild(interaction.guildId)) {
    return interaction.reply({ content: 'Run this command in the Discord server connected to your StockMarketLoop group, after choosing **Connect Discord** on that group’s website page.', ephemeral: true });
  }
  if (!roleSyncEnabled()) {
    return interaction.reply({ content: 'Website role sync is temporarily unavailable. Please try again shortly.', ephemeral: true });
  }
  try {
    await interaction.deferReply({ ephemeral: true });
    const result = await linkSmlAccount({
      code: interaction.options.getString('code', true),
      user: interaction.user,
      guild: interaction.guild,
      member: interaction.member,
    });
    const changed = result.sync?.results?.filter((row) => ['granted', 'updated'].includes(row.action)) || [];
    const protectedMembership = result.sync?.results?.some((row) => String(row.action || '').startsWith('protected_'));
    const access = changed.length
      ? `Website group access updated: **${changed.map((row) => row.role).join(', ')}**.`
      : protectedMembership
        ? 'Your existing website membership was left unchanged and remains protected.'
        : 'Your Discord account is connected. No mapped role access was added at this time.';
    return interaction.editReply(`✅ **StockMarketLoop connected.**\n${access}\n\nReturn to the group page to see your updated access.`);
  } catch (error) {
    return interaction.editReply(`Could not connect your account: ${String(error?.message || error).slice(0, 400)}`);
  }
}
