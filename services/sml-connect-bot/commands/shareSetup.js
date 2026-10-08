import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { mutateJson, paths, readSettings } from '../utils/storage.js';

export const data = new SlashCommandBuilder()
  .setName('share-setup')
  .setDescription('Configure the three-channel article sharing workflow.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) => option
    .setName('source')
    .setDescription('Private/admin channel where article links are posted')
    .addChannelTypes(ChannelType.GuildText)
    .setRequired(true))
  .addChannelOption((option) => option
    .setName('sharing')
    .setDescription('Public channel containing the platform share buttons')
    .addChannelTypes(ChannelType.GuildText)
    .setRequired(true))
  .addChannelOption((option) => option
    .setName('engagement')
    .setDescription('Channel containing comment-idea and article buttons')
    .addChannelTypes(ChannelType.GuildText)
    .setRequired(true));

export async function execute(interaction) {
  if (!interaction.guildId) return interaction.reply({ content: 'This command must be used inside a server.', ephemeral: true });
  const source = interaction.options.getChannel('source', true);
  const sharing = interaction.options.getChannel('sharing', true);
  const engagement = interaction.options.getChannel('engagement', true);
  if (new Set([source.id, sharing.id, engagement.id]).size !== 3) {
    return interaction.reply({ content: 'Choose three different text channels so intake, sharing, and discussion do not duplicate each other.', ephemeral: true });
  }
  const settings = await readSettings();
  await mutateJson(paths.settings, settings, (value) => {
    value.linkWorkflow = {
      enabled: true,
      sourceChannelId: source.id,
      shareChannelId: sharing.id,
      engagementChannelId: engagement.id,
      duplicateWindowHours: value.linkWorkflow?.duplicateWindowHours || 24,
    };
  });
  return interaction.reply({
    content: `Article workflow enabled.\nIntake: ${source}\nPlatform sharing: ${sharing}\nComment ideas: ${engagement}\n\nOnly members with **Manage Server** can trigger intake. Comments and votes remain manual.`,
    ephemeral: true,
  });
}
