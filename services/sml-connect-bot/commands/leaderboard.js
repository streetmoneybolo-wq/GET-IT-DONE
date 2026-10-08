import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { rankedPosts, rankedUsers } from '../utils/analytics.js';
import { getTrackingData } from '../utils/tracking.js';

const choices = ['boosts', 'shares', 'comments', 'upvotes', 'xp', 'engagement', 'posts'];

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Show verified Discord-bot activity leaderboards.')
  .addStringOption((option) => option
    .setName('category')
    .setDescription('Ranking category')
    .setRequired(true)
    .addChoices(...choices.map((value) => ({
      name: value[0].toUpperCase() + value.slice(1),
      value,
    }))));

function rowsFor(users, posts, category) {
  if (category === 'posts') return rankedPosts(posts).map((post) => ({ name: post.title, value: post.engagementScore, detail: `by ${post.sharedByName || post.sharedBy}` }));
  const field = category === 'engagement' ? 'engagementScore' : category;
  return rankedUsers(users, field).map((user) => ({ name: user.name || user.id, value: user[field] || 0, detail: `Level ${user.level} · ${user.xp} XP` }));
}

function pageEmbed(rows, category, page, size = 10) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const start = page * size;
  const body = rows.slice(start, start + size).map((row, index) => `**${start + index + 1}. ${row.name}** — ${row.value}\n${row.detail}`).join('\n\n') || 'No tracked activity yet.';
  return new EmbedBuilder().setColor(0x2b6cff).setTitle(`${category.toUpperCase()} leaderboard`).setDescription(body).setFooter({ text: `Page ${page + 1} of ${pages} · Bot-observed Discord activity only` });
}

function controls(page, pages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('lb-prev').setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId('lb-next').setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1),
  );
}

export async function execute(interaction) {
  const category = interaction.options.getString('category', true);
  const { users, posts } = await getTrackingData();
  const rows = rowsFor(users, posts, category);
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  let page = 0;
  const message = await interaction.reply({ embeds: [pageEmbed(rows, category, page)], components: [controls(page, pages)], fetchReply: true });
  const collector = message.createMessageComponentCollector({ time: 120_000 });
  collector.on('collect', async (button) => {
    if (button.user.id !== interaction.user.id) return button.reply({ content: 'Run your own /leaderboard command to control this view.', ephemeral: true });
    page = button.customId === 'lb-next' ? Math.min(pages - 1, page + 1) : Math.max(0, page - 1);
    await button.update({ embeds: [pageEmbed(rows, category, page)], components: [controls(page, pages)] });
  });
  collector.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
}
