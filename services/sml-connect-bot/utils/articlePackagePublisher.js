import { fetchNewsArticle } from './fetchNews.js';
import { commentIdeas, discussionAngles, generateShareCopy } from './randomizer.js';
import { buildShareUrls } from './shareUrls.js';
import { directShareComponents, engagementComponents, engagementEmbed, shareEmbed } from './discordPresentation.js';
import { bindDiscordMessage, bindEngagementMessage, createTrackedPost, failTrackedPost, recentPostByLink } from './tracking.js';

async function textChannel(client, id) {
  const channel = id ? await client.channels.fetch(id).catch(() => null) : null;
  return channel?.isTextBased() ? channel : null;
}

export async function publishArticlePackage(client, rawUrl, settings) {
  const workflow = settings.linkWorkflow || {};
  const [sharingChannel, engagementChannel] = await Promise.all([
    textChannel(client, workflow.shareChannelId),
    textChannel(client, workflow.engagementChannelId),
  ]);
  if (!sharingChannel || !engagementChannel) throw new Error('Configured sharing or engagement channel is unavailable.');
  const article = await fetchNewsArticle(rawUrl);
  const duplicate = await recentPostByLink(article.url, workflow.duplicateWindowHours || 24);
  if (duplicate) return { skipped: 'duplicate', url: article.url, postID: duplicate.postID, shareMessageId: duplicate.discordMessageId };

  const copy = generateShareCopy({ sourceTitle: article.title, summary: article.summary, tickers: article.tickers, sectors: article.sectors });
  const platformUrls = buildShareUrls({ ...copy, link: article.url });
  const post = await createTrackedPost({
    kind: 'automated-article', automated: true, skipOwnerCredit: true,
    sharedBy: client.user.id, sharedByName: client.user.username,
    ...copy, link: article.url, image: article.image, platformUrls,
    tickers: article.tickers, sectors: article.sectors, sourceMessageId: '', commentIdeas: commentIdeas(article),
  });
  let shareMessage;
  let engagementMessage;
  try {
    const angles = discussionAngles(article).map((value, index) => ({
      name: ['Bull case to examine', 'Risk to examine', 'Neutral verification'][index], value,
    }));
    shareMessage = await sharingChannel.send({
      content: `${settings.engagementEveryonePing ? '@everyone\n' : ''}## 📤 New article ready to post\nChoose a platform below. These buttons open the posting page directly, then submit your finished public-post link when done.`,
      embeds: [shareEmbed(post, angles)], components: directShareComponents(platformUrls),
      allowedMentions: { parse: settings.engagementEveryonePing ? ['everyone'] : [] },
    });
    await bindDiscordMessage(post.postID, shareMessage);
    engagementMessage = await engagementChannel.send({
      content: settings.engagementEveryonePing ? '@everyone\nNew article engagement task is ready.' : '',
      embeds: [engagementEmbed(post)], components: engagementComponents(post),
      allowedMentions: { parse: settings.engagementEveryonePing ? ['everyone'] : [] },
    });
    await bindEngagementMessage(post.postID, engagementMessage);
    return {
      delivered: true, url: article.url, postID: post.postID,
      shareChannelId: shareMessage.channelId, shareMessageId: shareMessage.id,
      engagementChannelId: engagementMessage.channelId, engagementMessageId: engagementMessage.id,
    };
  } catch (error) {
    await Promise.allSettled([shareMessage?.delete(), engagementMessage?.delete()].filter(Boolean));
    await failTrackedPost(post.postID, error.message || error);
    throw error;
  }
}
