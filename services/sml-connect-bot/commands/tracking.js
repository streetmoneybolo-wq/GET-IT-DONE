import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { fetchTrackingSummary } from '../utils/trackedRedirect.js';

export const data = new SlashCommandBuilder()
  .setName('tracking')
  .setDescription('Show measured outbound share clicks (not claimed external posts).')
  .addStringOption((option) => option
    .setName('post_id')
    .setDescription('Optional share-package Post ID.'));

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const postID = interaction.options.getString('post_id') || '';
  const summary = await fetchTrackingSummary(postID);
  const platforms = Object.entries(summary.platforms || {})
    .map(([platform, values]) => `**${platform}** — ${values.clicks || 0} clicks · ${values.links || 0} links issued`)
    .join('\n') || 'No outbound activity yet.';
  const embed = new EmbedBuilder()
    .setColor(0x2b6cff)
    .setTitle(postID ? 'Share tracking for this package' : 'Share tracking summary')
    .setDescription(platforms)
    .addFields(
      { name: 'Outbound clicks', value: String(summary.clicks || 0), inline: true },
      { name: 'Links issued', value: String(summary.links || 0), inline: true },
      { name: 'Verified external posts', value: '0 — OAuth publishing is not connected', inline: true },
    )
    .setFooter({ text: 'Clicks measure visits to a platform composer. They do not prove that a post was published.' });
  await interaction.editReply({ embeds: [embed] });
}
