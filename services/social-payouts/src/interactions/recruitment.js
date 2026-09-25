/* Interaction handlers (buttons, modals). Each returns false when the interaction is not its own. */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { readSettings } from '../../utils/storage.js';
import { generateRecruitmentPost, recruitmentComposerTitleOnlyUrl } from '../../utils/recruitmentPosts.js';

export async function recruitRandom(interaction) {
  if (!(interaction.isButton() && interaction.customId === 'dsp-recruit-random')) return false;
  const settings = await readSettings();
  const subreddits = [...new Set((settings.recruitmentPosts?.approvedSubreddits || [])
    .map((name) => String(name || '').replace(/^r\//i, '').trim())
    .filter(Boolean))];
  if (!subreddits.length) {
    return interaction.reply({ content: 'No approved recruitment subreddits are configured yet.', ephemeral: true });
  }
  const index = Math.floor(Math.random() * subreddits.length);
  const subreddit = subreddits[index];
  const post = generateRecruitmentPost(subreddit, index);
  const redditUrl = recruitmentComposerTitleOnlyUrl(subreddit, index);
  const rulesUrl = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/about/rules/`;
  const content = [
    `# 🎯 Random recruitment post generated for r/${subreddit}`,
    '## COPY THIS BODY FIRST',
    `**Title already loaded in Reddit:** ${post.title}`,
    '',
    '```text',
    post.body,
    '```',
    '',
    'After copying the body above, click **Open Reddit Composer**. Reddit opens with the subreddit and title already filled. Paste the copied body over the placeholder text, review the subreddit rules, then post.',
  ].join('\n');
  return interaction.reply({
    content: content.length <= 2000 ? content : content.slice(0, 1990),
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel(`Open r/${subreddit} Composer`).setStyle(ButtonStyle.Link).setURL(redditUrl),
      new ButtonBuilder().setLabel(`Review r/${subreddit} Rules`).setStyle(ButtonStyle.Link).setURL(rulesUrl),
    )],
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
  return true;
}

export async function recruitPost(interaction) {
  if (!(interaction.isButton() && /^sml-recruit:[A-Za-z0-9_-]+:[0-9]+$/i.test(interaction.customId))) return false;
  const [, subreddit, indexText] = interaction.customId.split(':');
  const settings = await readSettings();
  const allowed = new Set((settings.recruitmentPosts?.approvedSubreddits || []).map((name) => String(name).toLowerCase()));
  if (!allowed.has(subreddit.toLowerCase())) {
    return interaction.reply({ content: 'That subreddit is not approved for Daily Social Payouts recruitment posts.', ephemeral: true });
  }
  const post = generateRecruitmentPost(subreddit, Number(indexText || 0));
  return interaction.reply({
    content: [
      `# Reddit recruitment post ready: r/${post.subreddit}`,
      '',
      `**Title prefilled:** ${post.title}`,
      '',
      '**Before you hit Post:**',
      `- Review r/${post.subreddit} rules first: ${post.rulesUrl}`,
      '- Do not post if the subreddit does not allow hiring, paid promotion work, external applications, or Discord/application links.',
      '- Do not promise guaranteed income.',
      '- If the subreddit requires flair or a special title format, fix that before posting.',
      '',
      '**Click the button below to open the filled-out Reddit composer.**',
    ].join('\n'),
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel(`Open r/${post.subreddit} Composer`).setStyle(ButtonStyle.Link).setURL(post.composerUrl),
      new ButtonBuilder().setLabel(`Review r/${post.subreddit} Rules`).setStyle(ButtonStyle.Link).setURL(post.rulesUrl),
    )],
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
  return true;
}
