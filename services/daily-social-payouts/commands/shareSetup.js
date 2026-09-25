import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { readSettings, writeSettingsOverride } from '../utils/storage.js';

/**
 * Wires the article workflow to this server's channels and SAVES IT ON THE
 * PERSISTENT DISK (settings overlay), so a redeploy no longer silently wipes
 * what an admin configured in Discord. Also fixed here: the previous version
 * dropped the return-links channel entirely - the channel members use to
 * submit finished public posts, i.e. the input to getting paid.
 */

export const data = new SlashCommandBuilder()
  .setName('share-setup')
  .setDescription('Configure the article sharing workflow for this server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addChannelOption((option) => option
    .setName('source')
    .setDescription('Private/admin channel where article links are posted (the auto feed also lands here)')
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
    .setRequired(true))
  .addChannelOption((option) => option
    .setName('return_links')
    .setDescription('Channel where members return their finished public post links. Default: the engagement channel.')
    .addChannelTypes(ChannelType.GuildText))
  .addChannelOption((option) => option
    .setName('work_report')
    .setDescription('Optional: also add this channel to the work-report audit feed.')
    .addChannelTypes(ChannelType.GuildText));

export async function execute(interaction) {
  if (!interaction.guildId) return interaction.reply({ content: 'This command must be used inside a server.', ephemeral: true });
  const source = interaction.options.getChannel('source', true);
  const sharing = interaction.options.getChannel('sharing', true);
  const engagement = interaction.options.getChannel('engagement', true);
  const returnLinks = interaction.options.getChannel('return_links') || engagement;
  const workReportChannel = interaction.options.getChannel('work_report');
  if (new Set([source.id, sharing.id, engagement.id]).size !== 3) {
    return interaction.reply({ content: 'Choose three different text channels so intake, sharing, and discussion do not duplicate each other.', ephemeral: true });
  }
  const settings = await readSettings();
  await writeSettingsOverride('linkWorkflow', {
    enabled: true,
    guildId: interaction.guildId,
    sourceChannelId: source.id,
    shareChannelId: sharing.id,
    engagementChannelId: engagement.id,
    returnLinksChannelId: returnLinks.id,
    duplicateWindowHours: settings.linkWorkflow?.duplicateWindowHours || 24,
  });
  if (workReportChannel) {
    const existing = settings.workReport?.channels?.length
      ? settings.workReport.channels
      : settings.workReport?.channelId ? [{ channelId: settings.workReport.channelId }] : [];
    const channels = existing.filter((entry) => entry.channelId !== workReportChannel.id);
    channels.push({ guildId: interaction.guildId, channelId: workReportChannel.id, label: interaction.guild?.name || 'Work report' });
    await writeSettingsOverride('workReport', { ...(settings.workReport || {}), enabled: true, channels });
  }
  return interaction.reply({
    content: 'Article workflow connected to this server and saved durably.\n' +
      `Intake: ${source}\nPlatform sharing: ${sharing}\nComment ideas: ${engagement}\nReturned post links: ${returnLinks}` +
      (workReportChannel ? `\nWork reports: ${workReportChannel}` : '') +
      '\n\nThe automatic article feed delivers the next new site article here within ~10 minutes. Only members with **Manage Server** can post manual intake links. Comments and votes remain manual.',
    ephemeral: true,
  });
}
