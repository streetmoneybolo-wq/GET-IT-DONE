/* Interaction handlers (buttons, modals). Each returns false when the interaction is not its own. */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { commentIdeaComponents } from '../../utils/discordPresentation.js';
import { blueskyIntentUrl, blueskyResharePackage } from '../../utils/blueskyCopy.js';
import { postById } from '../../utils/tracking.js';
import { generateSocialCopy, socialShareUrl } from '../../utils/socialCopy.js';
import { platformInfo } from '../platforms.js';

export async function engagementButtons(interaction) {
  if (!(interaction.isButton() && /^sml-engagement-(reply|done):[0-9a-f-]{36}:[0-9a-f-]{36}$/i.test(interaction.customId))) return false;
  const [, action, postID, externalPostId] = interaction.customId.split(':');
  const post = await postById(postID);
  const externalPost = post?.externalPosts?.find((entry) => entry.id === externalPostId);
  if (!post || !externalPost) return interaction.reply({ content: 'This engagement checklist is unavailable.', ephemeral: true });
  if (action === 'reply') {
    const idea = post.commentIdeas?.[Math.floor(Math.random() * post.commentIdeas.length)];
    if (!idea) return interaction.reply({ content: 'No generated reply is available for this article.', ephemeral: true });
    return interaction.reply({
      content: `# 🔴 COPY THIS REPLY, PERSONALIZE IT, POST IT, AND COME BACK 🔴\n\n**Exactly 3 hashtags · no @handles**\n\n\`\`\`text\n${idea}\n\`\`\`\nOpen the original post, make the reply your own, submit it manually, then return to the engagement checklist.`,
      ephemeral: true,
    });
  }
  return interaction.reply({
    content: `# ✅ ENGAGEMENT CHECKLIST RECEIVED\nYou marked the **${platformInfo[externalPost.platform]?.label || externalPost.platform}** checklist complete.\n\n✅ Opened the submitted post\n✅ Reviewed the like/comment/share steps\n✅ Returned to Discord\n\nThis is a **self-reported completion receipt**. Discord cannot independently verify external likes, comments, or shares, and no cash payment is attached to this receipt.`,
    ephemeral: true,
  });
  return true;
}

export async function reshareButtons(interaction) {
  if (!(interaction.isButton() && /^sml-reshare:[0-9a-f-]{36}:[0-9a-f-]{36}:(x|facebook|reddit|linkedin|bluesky|threads)$/i.test(interaction.customId))) return false;
  try {
    await interaction.deferReply({ ephemeral: true });
    const [, postID, externalPostId, platform] = interaction.customId.split(':');
    const post = await postById(postID);
    const externalPost = post?.externalPosts?.find((entry) => entry.id === externalPostId);
    if (!post || !externalPost) return interaction.editReply('This returned-post share package is unavailable.');
    if (platform === 'bluesky') {
      const bluesky = await blueskyResharePackage(post, externalPost.url);
      return interaction.editReply({
        content: `# 🦋 BLUESKY REPOST READY\n**${bluesky.length}/300 characters · ${bluesky.peers.length} non-duplicate related $tickers · ${bluesky.hashtags.length} hashtags**\n\nThe related tickers below exclude every ticker from the original post. Click **Open Bluesky Repost** and this complete suggestion will already be in the composer. Review it and press **Post** yourself.\n\n\`\`\`text\n${bluesky.text}\n\`\`\``,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('Open Bluesky Repost').setStyle(ButtonStyle.Link).setURL(blueskyIntentUrl(bluesky.text)),
        )],
      });
    }
    const copy = await generateSocialCopy(post, platform, { reply: true });
    const url = socialShareUrl({ platform, copy, url: externalPost.url, post });
    const label = platform === 'x' ? 'X' : platform.charAt(0).toUpperCase() + platform.slice(1);
    return interaction.editReply({
      content: `# 🔴 COPY THIS LINK, PASTE IT, AND COME BACK WITH YOUR FINISHED POST LINK 🔴\n\n**Generated reply/reshare copy: ${Array.from(copy.body).length}/120 main-text characters · exactly 3 hashtags · no @handles:**\n\n\`\`\`text\n${copy.text}\n\`\`\`\nThen open ${label}, paste if its composer did not prefill, review it, and publish manually. The bot never posts for you.`,
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel(`Open ${label}`).setStyle(ButtonStyle.Link).setURL(url),
      )],
    });
  } catch (error) {
    console.error(error);
    const message = String(error?.message || 'The social share package could not be generated.').slice(0, 500);
    if (interaction.deferred || interaction.replied) return interaction.editReply(message).catch(() => {});
    return interaction.reply({ content: message, ephemeral: true }).catch(() => {});
  }
  return true;
}

export async function commentIdeaButton(interaction) {
  if (!(interaction.isButton() && /^sml-comment:[0-9a-f-]{36}$/i.test(interaction.customId))) return false;
  const postID = interaction.customId.split(':')[1];
  const post = await postById(postID);
  if (!post || post.engagementMessageId !== interaction.message.id || !post.commentIdeas?.length) {
    return interaction.reply({ content: 'This discussion package is unavailable.', ephemeral: true });
  }
  const idea = post.commentIdeas[Math.floor(Math.random() * post.commentIdeas.length)];
    return await interaction.reply({
    content: `**Suggested starting point — edit this in your own voice before posting:**\n\n${idea}\n\nReply to the discussion message in Discord, or manually use it on the external platform you opened from #links-to-post. The bot does not submit comments or votes.`,
    components: commentIdeaComponents(post),
    ephemeral: true,
  });
  return true;
}
