import { PermissionFlagsBits } from 'discord.js';
import { fetchNewsArticle } from './fetchNews.js';
import { commentIdeas, discussionAngles, generateShareCopy } from './randomizer.js';
import { buildShareUrls } from './shareUrls.js';
import { directShareComponents, engagementComponents, engagementEmbed, shareEmbed } from './discordPresentation.js';
import { bindDiscordMessage, bindEngagementMessage, createTrackedPost, failTrackedPost, recentPostByLink } from './tracking.js';
import { readSettings } from './storage.js';
import { reportWorkEvent } from './workReport.js';

const processing = new Set();

export function linkWorkflowsFromSettings(settings = {}) {
  const workflows = [];
  if (settings.linkWorkflow?.enabled) workflows.push({ id: 'default', ...(settings.linkWorkflow || {}) });
  for (const workflow of settings.linkWorkflows || []) {
    if (workflow?.enabled) workflows.push(workflow);
  }
  return workflows;
}

export function linkWorkflowForSource(settings = {}, message) {
  return linkWorkflowsFromSettings(settings).find((workflow) => (
    workflow.sourceChannelId
    && message?.channelId === workflow.sourceChannelId
    && (!workflow.guildId || workflow.guildId === message?.guildId)
  )) || null;
}

export function linkWorkflowForReturn(settings = {}, message) {
  return linkWorkflowsFromSettings(settings).find((workflow) => (
    workflow.returnLinksChannelId
    && message?.channelId === workflow.returnLinksChannelId
    && (!workflow.guildId || workflow.guildId === message?.guildId)
  )) || null;
}

export function linkWorkflowForShareChannel(settings = {}, channelId, guildId = '') {
  return linkWorkflowsFromSettings(settings).find((workflow) => (
    workflow.shareChannelId
    && channelId === workflow.shareChannelId
    && (!workflow.guildId || workflow.guildId === guildId)
  )) || null;
}

export function firstHttpUrl(content) {
  const match = String(content || '').match(/https?:\/\/[^\s<>]+/i);
  return match ? match[0].replace(/[),.;!?]+$/, '') : '';
}

async function textChannel(client, id) {
  const channel = id ? await client.channels.fetch(id).catch(() => null) : null;
  return channel?.isTextBased() ? channel : null;
}

export async function processLinkWorkflow(message) {
  const settings = await readSettings();
  const workflow = linkWorkflowForSource(settings, message);
  if (!workflow) return false;
  if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply('Only members with **Manage Server** can submit links to the article workflow.').catch(() => {});
    return true;
  }
  const rawUrl = firstHttpUrl(message.content);
  if (!rawUrl) return false;
  if (processing.has(rawUrl)) {
    await message.reply('That article is already being processed.').catch(() => {});
    return true;
  }
  processing.add(rawUrl);
  let post = null;
  let shareMessage = null;
  let engagementMessage = null;
  try {
    const [sharingChannel, engagementChannel] = await Promise.all([
      textChannel(message.client, workflow.shareChannelId),
      textChannel(message.client, workflow.engagementChannelId),
    ]);
    if (!sharingChannel || !engagementChannel) throw new Error('The configured sharing or engagement channel is unavailable to the bot.');
    const article = await fetchNewsArticle(rawUrl);
    const duplicate = await recentPostByLink(article.url, workflow.duplicateWindowHours || 24);
    if (duplicate) {
      await message.reply(`That article already has an active package (Post ID: \`${duplicate.postID}\`).`).catch(() => {});
      return true;
    }
    const copy = generateShareCopy({ sourceTitle: article.title, summary: article.summary, tickers: article.tickers, sectors: article.sectors });
    const platformUrls = buildShareUrls({ ...copy, link: article.url });
    post = await createTrackedPost({
      kind: 'channel-link',
      sharedBy: message.author.id,
      sharedByName: message.author.username,
      ...copy,
      link: article.url,
      image: article.image,
      platformUrls,
      tickers: article.tickers,
      sectors: article.sectors,
      sourceMessageId: message.id,
      commentIdeas: commentIdeas(article),
    });
    const angles = discussionAngles(article).map((value, index) => ({
      name: ['Bull case to examine', 'Risk to examine', 'Neutral verification'][index],
      value,
    }));
    shareMessage = await sharingChannel.send({
      content: `${settings.engagementEveryonePing ? '@everyone\n' : ''}## 📤 New article ready to post\nChoose a platform below. These buttons open the posting page directly, then submit your finished public-post link when done.`,
      embeds: [shareEmbed(post, angles)],
      components: directShareComponents(platformUrls),
      allowedMentions: { parse: settings.engagementEveryonePing ? ['everyone'] : [] },
    });
    await bindDiscordMessage(post.postID, shareMessage);
    engagementMessage = await engagementChannel.send({
      embeds: [engagementEmbed(post)],
      components: engagementComponents(post),
    });
    await bindEngagementMessage(post.postID, engagementMessage);
    await reportWorkEvent(message.client, {
      type: 'link_posted', eventKey: `link-posted:${message.id}`, userId: message.author.id,
      userName: message.author.username, post, articleUrl: article.url,
    });
    await message.react('✅').catch(() => {});
    await message.reply(`Published the article package in ${sharingChannel} and the manual discussion tools in ${engagementChannel}.`).catch(() => {});
    return true;
  } catch (error) {
    await Promise.allSettled([
      engagementMessage?.delete(),
      shareMessage?.delete(),
    ].filter(Boolean));
    if (post) await failTrackedPost(post.postID, error.message || error);
    console.error('Article workflow delivery failed:', error);
    await message.reply(`The article was not published: ${String(error.message || error).slice(0, 300)}`).catch(() => {});
    return true;
  } finally {
    processing.delete(rawUrl);
  }
}
