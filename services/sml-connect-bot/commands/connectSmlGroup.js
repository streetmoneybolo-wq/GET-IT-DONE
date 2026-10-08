import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { claimGroupDiscordServer, roleSyncEnabled } from '../utils/siteRoleSync.js';

export const data = new SlashCommandBuilder()
  .setName('connect-sml-group')
  .setDescription('Securely connect this Discord server to a StockMarketLoop group.')
  .addStringOption((option) => option
    .setName('code')
    .setDescription('One-time code from the group owner’s Discord Access panel')
    .setRequired(true));

export async function execute(interaction) {
  if (!interaction.guildId) {
    return interaction.reply({ content: 'Run this command inside the Discord server you want to connect.', ephemeral: true });
  }
  if (!roleSyncEnabled()) {
    return interaction.reply({ content: 'Website group access is temporarily unavailable. Please try again shortly.', ephemeral: true });
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: 'Only someone with Discord’s **Manage Server** permission can connect this server to a website group.', ephemeral: true });
  }
  try {
    await interaction.deferReply({ ephemeral: true });
    const result = await claimGroupDiscordServer({
      code: interaction.options.getString('code', true),
      guild: interaction.guild,
      user: interaction.user,
    });
    return interaction.editReply(`✅ This Discord server is now securely connected to StockMarketLoop group #${result.group_id}. Return to that group’s **Discord Access** panel and map the Discord roles that should receive website access.`);
  } catch (error) {
    return interaction.editReply(`Could not connect this Discord server: ${String(error?.message || error).slice(0, 400)}`);
  }
}
