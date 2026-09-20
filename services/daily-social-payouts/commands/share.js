import { SlashCommandBuilder } from 'discord.js';
import { consumeCooldown } from '../utils/cooldowns.js';
import { generateShareCopy } from '../utils/randomizer.js';
import { buildShareUrls } from '../utils/shareUrls.js';
import { bindDiscordMessage, createTrackedPost } from '../utils/tracking.js';
import { shareComponents, shareEmbed } from '../utils/discordPresentation.js';
import { notifyOptInRole } from '../utils/notifications.js';
import { readSettings } from '../utils/storage.js';

export const data = new SlashCommandBuilder()
  .setName('share')
  .setDescription('Create responsible platform share links for a public page.')
  .addStringOption((option) => option.setName('url').setDescription('Page to share; defaults to BASE_SHARE_LINK.'));

export async function execute(interaction) {
  const settings = await readSettings();
  const wait = consumeCooldown('share', interaction.user.id, settings.cooldowns?.share ?? 30);
  if (wait) return interaction.reply({ content: `Please wait ${wait}s before creating another share package.`, ephemeral: true });
  const link = interaction.options.getString('url') || process.env.BASE_SHARE_LINK;
  if (!link || !/^https?:\/\//i.test(link)) return interaction.reply({ content: 'Configure BASE_SHARE_LINK or provide a valid HTTP(S) URL.', ephemeral: true });
  const copy = generateShareCopy();
  const platformUrls = buildShareUrls({ ...copy, link });
  const post = await createTrackedPost({
    kind: 'share', sharedBy: interaction.user.id, sharedByName: interaction.user.username,
    ...copy, link, platformUrls,
  });
  await interaction.reply({ embeds: [shareEmbed(post)], components: shareComponents(post.postID, Object.keys(platformUrls)) });
  const message = await interaction.fetchReply();
  await bindDiscordMessage(post.postID, message);
  await notifyOptInRole(interaction, post).catch(console.error);
}
