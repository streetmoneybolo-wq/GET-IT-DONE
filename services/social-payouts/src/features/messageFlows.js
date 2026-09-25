/* Message-driven flows for the work channels: a returned public post link, a screenshot proof reply, and a Discord reply to a tracked package. Each returns true when it handled the message. */
import { linkWorkflowForReturn } from '../../utils/linkWorkflow.js';
import { postById, postByMessage, recentUnreturnedOutboundIntent, recordEngagement } from '../../utils/tracking.js';
import { detectExternalPostPlatform, validateExternalPostUrl } from '../../utils/externalPosts.js';
import { platformLabels, publishExternalPostSubmission } from '../../utils/externalPostWorkflow.js';
import { createProof, proofContextFromMessage, sendProofForReview } from '../../utils/engagementProofs.js';
import { reportWorkEvent } from '../../utils/workReport.js';
import { XP } from '../../utils/xp.js';

export async function handleReturnedLink(message, botSettings) {
  const returnWorkflow = linkWorkflowForReturn(botSettings, message);
  if (!returnWorkflow) return false;
  const rawUrl = message.content.match(/https:\/\/[^\s<>]+/i)?.[0]?.replace(/[),.;!?]+$/, '') || '';
  const platform = detectExternalPostPlatform(rawUrl);
  if (!platform) {
    await message.reply('Paste the full public URL of your finished Facebook, Stocktwits, Reddit, X, Bluesky, or Threads post.').catch(() => {});
    return true;
  }
  try {
    const url = validateExternalPostUrl(rawUrl, platform);
    const intent = await recentUnreturnedOutboundIntent({ userId: message.author.id, platform, withinHours: 6 });
    if (!intent) {
      await message.reply(`I could not safely match this ${platformLabels[platform] || platform} link to one of your share actions from the last 6 hours. Open the article's platform button first, then return the finished post link here—or use its **Submit Post Link** button.`).catch(() => {});
      return true;
    }
    const result = await publishExternalPostSubmission({
      client: message.client,
      user: message.author,
      fallbackChannelId: message.channelId,
      engagementChannelId: returnWorkflow.engagementChannelId,
      postID: intent.postID,
      platform,
      url,
    });
    if (!result.changed) {
      await message.reply(`That ${result.platformLabel} post link was already submitted.`).catch(() => {});
      return true;
    }
    const payoutLine = result.payout?.amountUsd
      ? `\n💵 Payout ledger: **${result.payout.amountUsd}** · ${result.payout.rateRule}\nPayable after <t:${Math.floor(Date.parse(result.payout.payableAt) / 1000)}:f> if the link stays public.`
      : '';
    const receipt = await message.channel.send({
      content: `# ✅ POSTING TASK COMPLETE\n<@${message.author.id}> your **${result.platformLabel}** public-post link was accepted.\n\n✅ Link format checked\n✅ Saved to your work history\n✅ Sent to #return-your-post-link${payoutLine}\n\nEngagement alert: ${result.published.url}\nWork history: ${result.workEntry.url}\n\n*This verifies the returned public-post URL. External likes, comments, and shares require proof/review before they count.*`,
      allowedMentions: { users: [message.author.id] },
    });
    await message.delete().catch(() => null);
    console.log(`Returned post ${url} accepted from ${message.author.id}; receipt ${receipt.id}.`);
  } catch (error) {
    await message.reply(String(error?.message || 'That returned post link could not be processed.').slice(0, 500)).catch(() => {});
  }
  return true;
}

/* A reply (with an image) to an engagement task message is a screenshot proof. */
export async function handleProofScreenshot(message, referenced) {
  const proofContext = proofContextFromMessage(referenced);
  if (!proofContext || !message.attachments.size) return false;
  try {
    const actionMatch = message.content.match(/^\s*PROOF\s*:\s*(LIKE|UPVOTE|COMMENT|SHARE)\b/i);
    if (!actionMatch) throw new Error('Add `PROOF: LIKE`, `PROOF: UPVOTE`, `PROOF: COMMENT`, or `PROOF: SHARE` as the first line.');
    const attachment = message.attachments.first();
    if (!/^image\//i.test(attachment.contentType || '') && !/\.(png|jpe?g|webp|gif)$/i.test(attachment.name || '')) {
      throw new Error('Screenshot proof must be a PNG, JPG, WEBP, or GIF image.');
    }
    const post = await postById(proofContext.postID);
    const externalPost = post?.externalPosts?.find((entry) => entry.id === proofContext.externalPostId);
    if (!post || !externalPost) throw new Error('This engagement task is unavailable.');
    const result = await createProof({
      user: message.author, post, externalPost, action: actionMatch[1], method: 'screenshot',
      attachment: { id: attachment.id, url: attachment.url, name: attachment.name, contentType: attachment.contentType, size: attachment.size },
    });
    if (!result.changed) {
      await message.reply(result.duplicateEvidence
        ? `Proof rejected: ${result.reason}`
        : `You already submitted ${result.proof.action} evidence for this post. Current status: **${result.proof.status}**.`);
      return true;
    }
    const review = await sendProofForReview(message.client, result.proof, post);
    await message.reply(`# ✅ SCREENSHOT RECEIVED\nStatus: **Manual review required — not verified yet**\nReview card: ${review.url}\nProof ID: \`${result.proof.id}\``);
  } catch (error) {
    await message.reply(String(error?.message || 'The screenshot proof could not be submitted.').slice(0, 500)).catch(() => {});
  }
  return true;
}

/* A plain Discord reply to a tracked share package counts as a comment. */
export async function handleDiscordComment(message) {
  const post = await postByMessage(message.reference.messageId);
  if (!post) return false;
  const commentRecorded = await recordEngagement({
    postID: post.postID,
    userId: message.author.id,
    userName: message.author.username,
    type: 'comment',
    eventId: message.id,
    content: message.content,
  });
  if (commentRecorded) {
    await reportWorkEvent(message.client, {
      type: 'comment', eventKey: `comment:${message.id}`, userId: message.author.id,
      userName: message.author.username, post, articleUrl: post.link, content: message.content,
    });
    await message.author.send(`# ✅ COMMENT ACTIVITY COMPLETE\nYour Discord reply was recorded and **+${XP.comment} internal XP** was applied.\n\nInternal XP has no cash value. This confirms the Discord reply only; it does not independently verify an external-platform comment.`).catch(() => {});
  }
  return true;
}
