import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { dashboardUrl, ownerDashboardComponents } from '../utils/onboarding.js';

export const data = new SlashCommandBuilder()
  .setName('connect-dashboard')
  .setDescription('Get the Connect dashboard link for this Discord server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'Run this inside the Discord server you want to manage.', ephemeral: true });
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: 'Only someone with Manage Server permission can open this server’s Connect dashboard.', ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setColor(0x38f58a)
    .setTitle(`${interaction.guild.name} Connect Dashboard`)
    .setDescription(
      'Use this page to manage migration, memberships, Discord roles, overdue notices, analytics, and billing tools for this server.'
    )
    .setURL(dashboardUrl(interaction.guild.name, interaction.guild.id));

  return interaction.reply({
    embeds: [embed],
    components: ownerDashboardComponents(interaction.guild),
    ephemeral: true
  });
}
