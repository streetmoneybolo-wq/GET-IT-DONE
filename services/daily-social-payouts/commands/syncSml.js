import { SlashCommandBuilder } from 'discord.js';
import { isRoleSyncGuild, roleSyncEnabled, syncMemberRoles } from '../utils/siteRoleSync.js';

export const data = new SlashCommandBuilder()
  .setName('refresh-sml-access')
  .setDescription('Refresh your linked website group access from your current Discord roles.');

export async function execute(interaction) {
  if (!interaction.guildId || !isRoleSyncGuild(interaction.guildId)) {
    return interaction.reply({ content: 'Run this in a Discord server that is connected to a linked website group.', ephemeral: true });
  }
  if (!roleSyncEnabled()) {
    return interaction.reply({ content: 'Website role sync is temporarily unavailable. Please try again shortly.', ephemeral: true });
  }
  try {
    await interaction.deferReply({ ephemeral: true });
    const result = await syncMemberRoles(interaction.member, 'manual_refresh');
    if (!result?.linked) {
      return interaction.editReply('Connect your account first at https://stockmarketloop.com/connect-discord/, then run `/link-sml` with the one-time code.');
    }
    const updated = result.results?.filter((row) => ['granted', 'updated'].includes(row.action)) || [];
    const protectedAccess = result.results?.some((row) => String(row.action || '').startsWith('protected_'));
    if (updated.length) return interaction.editReply(`✅ Website access refreshed: **${updated.map((row) => row.role).join(', ')}**.`);
    if (protectedAccess) return interaction.editReply('✅ Your existing paid or manually managed website membership remains protected.');
    return interaction.editReply('✅ Access was checked. Your current Discord roles do not map to a website group role here.');
  } catch (error) {
    return interaction.editReply(`Could not refresh access: ${String(error?.message || error).slice(0, 400)}`);
  }
}
