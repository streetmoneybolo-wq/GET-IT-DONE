import { SlashCommandBuilder } from 'discord.js';
import { consumeCooldown, clearCooldown } from '../utils/cooldowns.js';
import { fetchNewsArticle } from '../utils/fetchNews.js';
import { discussionAngles, generateShareCopy } from '../utils/randomizer.js';
import { buildShareUrls } from '../utils/shareUrls.js';
import { bindDiscordMessage, createTrackedPost } from '../utils/tracking.js';
import { shareComponents, shareEmbed } from '../utils/discordPresentation.js';
import { notifyOptInRole } from '../utils/notifications.js';
import { readSettings } from '../utils/storage.js';

export const data = new SlashCommandBuilder()
  .setName('news')
  .setDescription('Inspect a public stock-market article and build attributed share links.')
  .addStringOption((option) => option.setName('url').setDescription('Public article URL').setRequired(true));

export async function execute(interaction) {
  const settings = await readSettings();
  const wait = consumeCooldown('news', interaction.user.id, settings.cooldowns?.news ?? 30);
  if (wait) return interaction.reply({ content: `Please wait ${wait}s before inspecting another article.`, ephemeral: true });
  await interaction.deferReply();
  try {
    const article = await fetchNewsArticle(interaction.options.getString('url', true));
    const copy = generateShareCopy({ sourceTitle: article.title, summary: article.summary, tickers: article.tickers, sectors: article.sectors });
    const platformUrls = buildShareUrls({ ...copy, link: article.url });
    const post = await createTrackedPost({
      kind: 'news', sharedBy: interaction.user.id, sharedByName: interaction.user.username,
      ...copy, link: article.url, platformUrls, tickers: article.tickers, sectors: article.sectors,
    });
    const angles = discussionAngles(article).map((value, index) => ({ name: ['Bull case to examine', 'Risk to examine', 'Neutral verification'][index], value }));
    await interaction.editReply({ embeds: [shareEmbed(post, angles)], components: shareComponents(post.postID, Object.keys(platformUrls)) });
    const message = await interaction.fetchReply();
    await bindDiscordMessage(post.postID, message);
    await notifyOptInRole(interaction, post).catch(console.error);
  } catch (error) {
    clearCooldown('news', interaction.user.id);
    await interaction.editReply(`Article inspection failed: ${error.message}`);
  }
}
