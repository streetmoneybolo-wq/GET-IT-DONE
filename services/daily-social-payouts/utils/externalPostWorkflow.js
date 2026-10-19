import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { postById, recordExternalPostLink } from './tracking.js';
import { readSettings } from './storage.js';
import { getOrCreateUserWorkThread, touchUserWorkThread } from './userWorkThreads.js';
import { returnedPostShareComponents } from './discordPresentation.js';
import { reportWorkEvent } from './workReport.js';
import { stocktwitsPackages } from './stocktwitsCopy.js';
import { recordPublishedLinkPayout } from './payoutLedger.js';

export const platformLabels = {
  reddit: 'Reddit',
  x: 'X',
  stocktwits: 'Stocktwits',
  bluesky: 'Bluesky',
  threads: 'Threads',
  facebook: 'Facebook',
};

export async function publishExternalPostSubmission({ client, user, fallbackChannelId, engagementChannelId = '', postID, platform, url }) {
  const post = await postById(postID);
  if (!post) throw new Error('This share package is unavailable.');
  const saved = await recordExternalPostLink({ postID, userId: user.id, userName: user.username, platform, url });
  if (!saved) throw new Error('This share package is unavailable.');
  const platformLabel = platformLabels[platform] || platform;
  if (!saved.changed) return { changed: false, platformLabel };
  const payout = await recordPublishedLinkPayout({ post, externalPost: saved.entry });

  const botSettings = await readSettings();
  const channelId = engagementChannelId || botSettings.linkWorkflow?.engagementChannelId || fallbackChannelId;
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error('The engagement channel is unavailable.');
  const workThread = await getOrCreateUserWorkThread({ client, parentChannel: channel, user });
  const stocktwits = platform === 'stocktwits' ? await stocktwitsPackages(post) : null;
  const workEntry = await workThread.send({
    content: `## ${platformLabel} work item\n${post.title}\n\nSubmitted: <t:${Math.floor(Date.now() / 1000)}:f>`,
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel(`Open ${platformLabel} Post`).setStyle(ButtonStyle.Link).setURL(url),
    )],
  });
  await touchUserWorkThread(user.id);
  const stocktwitsInstructions = stocktwits
    ? `\n\n## STOCKTWITS CHECKLIST\n1. Open and read the post.\n2. Like it only if it is useful.\n3. Leave a genuine comment in your own words.\n4. Choose **Share → Quote** (not a blind repost).\n5. Copy, personalize, and use this separate quote-share revision:\n\n\`\`\`text\n${stocktwits.quote}\n\`\`\``
    : '';
  const published = await channel.send({
    content: `${botSettings.engagementEveryonePing ? '@everyone\n' : ''}# 🔴 NEW POST · OPEN · DECIDE · ENGAGE 🔴\n\n## 📣 New ${platformLabel} work item\nSubmitted by <@${user.id}>\n\n${post.title}\n\n**1. ENGAGE:** Use **Engage on ${platformLabel}** to open the exact public post. Read it first.\n**2. REPLY:** Select **Get reply to copy**. Discord shows a suggestion in a copyable code block; personalize it before posting.\n**3. SHARE:** If the post is genuinely worth discussing, use **Share your take** to open that platform’s supported composer. Review and publish it yourself.\n**4. PROVE:** Use **Submit Public Proof Link** for a direct public comment/share URL. If the platform does not provide a public action URL, use **Submit Screenshot Proof** for manual review.\n\n## Important\nThe bot never likes, comments, or posts for members. Members decide whether to engage, use their own words, and follow each platform’s rules. Public URLs and screenshots enter review; **Self-Report Complete is not proof.**\n\nInternal Discord XP has no cash value.${stocktwitsInstructions}`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel(`Engage on ${platformLabel}`.slice(0, 80)).setStyle(ButtonStyle.Link).setURL(url),
        new ButtonBuilder().setLabel(`${user.username}'s Work Thread`.slice(0, 80)).setStyle(ButtonStyle.Link).setURL(workThread.url),
      ),
      ...returnedPostShareComponents(post.postID, saved.entry.id, platform),
    ],
    allowedMentions: { parse: botSettings.engagementEveryonePing ? ['everyone'] : [], users: [user.id] },
  });
  await reportWorkEvent(client, {
    type: 'external_link_returned', eventKey: `external-link:${saved.entry.id}`, userId: user.id,
    userName: user.username, platform: platformLabel, post, articleUrl: post.link, actionUrl: url, payout,
  });
  return { changed: true, platformLabel, published, workEntry, payout };
}

