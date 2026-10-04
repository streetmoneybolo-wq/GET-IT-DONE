import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('reregister-sml-commands')
  .setDescription('Restore this bot’s slash commands in this server.');

export async function execute(interaction) {
  if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: 'Only a member with **Manage Server** can restore this server’s commands.', ephemeral: true });
  }
  try {
    await interaction.deferReply({ ephemeral: true });
    const commands = [...interaction.client.commands.values()].map((command) => command.data.toJSON());
    await interaction.guild.commands.set(commands);
    return interaction.editReply(`✅ Restored **${commands.length}** StockMarketLoop command${commands.length === 1 ? '' : 's'} for this server. Type \`/\` and choose the command from Discord’s menu.`);
  } catch (error) {
    console.error(`Could not re-register commands in guild ${interaction.guildId}:`, error?.message || error);
    return interaction.editReply('I could not restore the commands. Confirm that this bot was invited with the **applications.commands** scope and that this channel allows **Use Application Commands**.');
  }
}
