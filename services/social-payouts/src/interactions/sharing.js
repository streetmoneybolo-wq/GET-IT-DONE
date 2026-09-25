/* Interaction handlers (buttons, modals). Each returns false when the interaction is not its own. */
import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { outboundLinkComponent } from '../../utils/discordPresentation.js';
import { buildShareUrls } from '../../utils/shareUrls.js';
import { packagedFacebookCaption } from '../../utils/facebookCopy.js';
import { stocktwitsPackages } from '../../utils/stocktwitsCopy.js';
import { blueskyIntentUrl, blueskyPackage } from '../../utils/blueskyCopy.js';
import { postById, recordOutboundIntent } from '../../utils/tracking.js';
import { isShareButton, parseShareButton } from '../../utils/trackedRedirect.js';
import { validateExternalPostUrl } from '../../utils/externalPosts.js';
import { selectSubreddit } from '../../utils/redditRouting.js';
import { publishExternalPostSubmission } from '../../utils/externalPostWorkflow.js';
import { generateSocialCopy, socialShareUrl } from '../../utils/socialCopy.js';
import { reportWorkEvent } from '../../utils/workReport.js';
import { platformInfo } from '../platforms.js';

export async function externalLinkModal(interaction) {
  if (!(interaction.isModalSubmit() && /^sml-external-link:[0-9a-f-]{36}:(reddit|x|stocktwits|bluesky|threads|facebook)$/i.test(interaction.customId))) return false;
  try {
    await interaction.deferReply({ ephemeral: true });
    const [, postID, platform] = interaction.customId.split(':');
    const url = validateExternalPostUrl(interaction.fields.getTextInputValue('post_url'), platform);
    const result = await publishExternalPostSubmission({
      client: interaction.client,
      user: interaction.user,
      fallbackChannelId: interaction.channelId,
      postID,
      platform,
      url,
    });
    if (!result.changed) return await interaction.editReply(`That ${result.platformLabel} post link was already submitted.`);
    const payoutLine = result.payout?.amountUsd
      ? `\n💵 Payout ledger: **${result.payout.amountUsd}** · ${result.payout.rateRule}\nPayable after <t:${Math.floor(Date.parse(result.payout.payableAt) / 1000)}:f> if the link stays public.`
      : '';
    return await interaction.editReply(`# ✅ POSTING TASK COMPLETE\n**${result.platformLabel} public-post link accepted.**\n\n✅ Link format checked\n✅ Saved to your work history\n✅ Sent to #return-your-post-link${payoutLine}\n\nEngagement alert: ${result.published.url}\nYour work thread: ${result.workEntry.url}\n\n*This verifies the returned public-post URL. External likes, comments, and shares require proof/review before they count.*`);
  } catch (error) {
    console.error(error);
    const message = String(error?.message || 'The submitted post link could not be saved.').slice(0, 500);
    if (interaction.deferred || interaction.replied) return interaction.editReply(message).catch(() => {});
    return interaction.reply({ content: message, ephemeral: true }).catch(() => {});
  }
  return true;
}

export async function submitLinkButton(interaction) {
  if (!(interaction.isButton() && /^sml-submit-link:[0-9a-f-]{36}:(reddit|x|stocktwits|bluesky|threads|facebook)$/i.test(interaction.customId))) return false;
  const [, postID, platform] = interaction.customId.split(':');
  const info = platformInfo[platform];
  const modal = new ModalBuilder()
    .setCustomId(`sml-external-link:${postID}:${platform}`)
    .setTitle(`Return Your ${info.label} Post Link`.slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('post_url')
        .setLabel(`Paste the finished ${info.label} post URL`.slice(0, 45))
        .setPlaceholder(info.placeholder)
        .setStyle(TextInputStyle.Short)
        .setRequired(true),
    ));
  return interaction.showModal(modal);
  return true;
}

export async function shareButton(interaction) {
  if (!(interaction.isButton() && isShareButton(interaction.customId))) return false;
  try {
    const parsed = parseShareButton(interaction.customId);
    const post = parsed ? await postById(parsed.postID) : null;
    if (!post || post.discordMessageId !== interaction.message.id) {
      return await interaction.reply({ content: 'This share package is unavailable or no longer matches this message.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const platformUrls = buildShareUrls(post);
    if (parsed.platform === 'x') {
      const socialCopy = await generateSocialCopy(post, 'x');
      if (socialCopy.hashtags.length !== 5) throw new Error('The X package could not produce five unique hashtags.');
      platformUrls.x = socialShareUrl({ platform: 'x', copy: socialCopy, url: post.link, post });
    }
    const selectedPlatformLabel = platformInfo[parsed.platform]?.label || parsed.platform;
    const outboundRecorded = await recordOutboundIntent({
      postID: post.postID,
      userId: interaction.user.id,
      userName: interaction.user.username,
      platform: parsed.platform,
      eventId: interaction.id,
    });
    if (outboundRecorded) await reportWorkEvent(interaction.client, {
      type: 'share_opened', eventKey: `share-opened:${interaction.id}`, userId: interaction.user.id,
      userName: interaction.user.username, platform: selectedPlatformLabel, post, articleUrl: post.link,
    });
    let responseContent = `Continue directly to ${selectedPlatformLabel}. The prepared post should appear in its composer. Review and publish it yourself.\n\n## AFTER POSTING\nReturn here, click **Submit ${selectedPlatformLabel} Post Link**, and paste the finished public URL. The bot will alert #return-your-post-link.`;
    let redditRoute = null;
    if (parsed.platform === 'facebook') {
      responseContent = `# 🚨 COPY FIRST 🚨\n**Click the Copy icon on the post below before leaving Discord.**\n\n\`\`\`text\n${packagedFacebookCaption(post)}\n\`\`\`\n## THEN CLICK “GO TO FACEBOOK”\nThe article link is already attached. Paste the copied caption into Facebook and review it before posting.\n\n## AFTER POSTING\nReturn here, click **Submit Facebook Post Link**, and paste the finished Facebook URL. The bot will return it in #return-your-post-link for members to open.`;
    } else if (parsed.platform === 'stocktwits') {
      const stocktwits = await stocktwitsPackages(post);
      responseContent = `# 🚨 COPY FIRST 🚨\n**SEO-ready Stocktwits post with two non-duplicate related tickers:**\n\n\`\`\`text\n${stocktwits.original}\n\`\`\`\n## THEN CLICK “GO TO STOCKTWITS”\nThe $${stocktwits.primary || 'primary'} ticker stream will open. Start a new Stocktwits post, paste the message, review it, and publish.\n\n## AFTER POSTING\nReturn here, click **Submit Stocktwits Post Link**, and paste the finished URL. The engagement channel will receive separate Like, Comment, and Quote Share instructions with a different three-ticker package.`;
    } else if (parsed.platform === 'bluesky') {
      const bluesky = await blueskyPackage(post);
      platformUrls.bluesky = blueskyIntentUrl(bluesky.text);
      responseContent = `# 🦋 BLUESKY POST READY\n**${bluesky.length}/300 characters · six related tickers · seven Facebook-pool hashtags**\n\nClick **Continue to Bluesky**. The complete generated post below will already be inside the Bluesky composer. Review it, make any changes you want, and press **Post** yourself.\n\n\`\`\`text\n${bluesky.text}\n\`\`\`\n## AFTER POSTING\nReturn here, click **Submit Bluesky Post Link**, and paste the finished public URL.`;
    } else if (parsed.platform === 'threads') {
      const threadsCopy = await generateSocialCopy(post, 'threads');
      platformUrls.threads = 'https://www.threads.com/';
      responseContent = `# 🚨 COPY FIRST 🚨\n**Threads does not provide a reliable public link that inserts third-party text into its composer.**\n\n\`\`\`text\n${threadsCopy.text}\n\n${post.link}\n\`\`\`\n## THEN CLICK “CONTINUE TO THREADS”\nStart a post, paste the package, review it, and publish manually.\n\n## AFTER POSTING\nReturn here, click **Submit Threads Post Link**, and paste the finished public URL.`;
    } else if (parsed.platform === 'reddit') {
      redditRoute = selectSubreddit(post);
      const checklist = redditRoute.requirements.map((item) => `- ${item}`).join('\n');
      responseContent = `**Approved Reddit destination:** r/${redditRoute.name}\n**Compatibility reason:** ${redditRoute.reason}\n\n**Required checks before submitting:**\n${checklist}\n- Open **Review r/${redditRoute.name} Rules** and confirm the current moderator rules and required flair.\n\nThe title was cleaned to remove site branding and promotional language. Submission remains manual.\n\n## AFTER POSTING\nReturn here, click **Submit Reddit Post Link**, and paste the finished Reddit URL. The bot will alert #return-your-post-link.`;
    }
    responseContent = `# 🔴 COPY THIS LINK, PASTE IT, AND COME BACK WITH YOUR FINISHED POST LINK 🔴\n\n${responseContent}`;
    return await interaction.editReply({
      content: responseContent,
      components: outboundLinkComponent(parsed.platform, platformUrls[parsed.platform], post.postID, redditRoute?.name || ''),
    });
  } catch (error) {
    console.error(error);
    const payload = { content: 'The tracked share link could not be created safely. Please try again later.', components: [] };
    if (interaction.deferred || interaction.replied) return interaction.editReply(payload).catch(() => {});
    return interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
  }
  return true;
}

