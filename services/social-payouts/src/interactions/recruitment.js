/* Interaction handlers (buttons, modals). Each returns false when the interaction is not its own. */
import { readSettings } from '../../utils/storage.js';
import { generateRecruitmentPost } from '../../utils/recruitmentPosts.js';
import { handleRecruitmentButton, postReply, recruitmentConfig } from '../../utils/recruitmentPanel.js';

export const recruitRandom = handleRecruitmentButton;

/* older panels carried per-subreddit buttons; they now open a fresh post for that subreddit when it is still approved */
export async function recruitPost(interaction) {
  if (!(interaction.isButton() && /^sml-recruit:[A-Za-z0-9_-]+:[0-9]+$/i.test(interaction.customId))) return false;
  const [, subreddit, indexText] = interaction.customId.split(':');
  const cfg = recruitmentConfig(await readSettings());
  if (!cfg.subreddits.some((s) => s.toLowerCase() === subreddit.toLowerCase())) {
    await interaction.reply({ content: 'That subreddit is not approved for recruitment posts any more. Use the Generate Recruitment Post button instead.', ephemeral: true });
    return true;
  }
  await interaction.reply(postReply(generateRecruitmentPost(subreddit, Number(indexText || 0), cfg)));
  return true;
}
