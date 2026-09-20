import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { pushGuildCatalog } from '../utils/siteRoleSync.js';

export const data = new SlashCommandBuilder()
  .setName('sync-sml-channels')
  .setDescription('Refresh this server’s channels, roles, and permissions on StockMarketLoop.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: 'You need Manage Server permission to sync this server.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });
  const result = await pushGuildCatalog(interaction.guild);
  if (result?.skipped) {
    return interaction.editReply('Connect this Discord server from the StockMarketLoop group first.');
  }
  return interaction.editReply(`Synced **${interaction.guild.name}**. The group owner can now choose channels under **Edit Group → Discord Server Channel Sync**.`);
}
