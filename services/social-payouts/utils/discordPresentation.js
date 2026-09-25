import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

const labels = {
  reddit: ['Reddit', '🔴'],
  x: ['X', '❌'],
  stocktwits: ['Stocktwits', '📈'],
  bluesky: ['Bluesky', '🦋'],
  threads: ['Threads', '🧵'],
  facebook: ['Facebook', '🔵'],
  linkedin: ['LinkedIn', '🔗'],
};

export function returnedPostShareComponents(postID, externalPostId, platform) {
  if (!labels[platform]) throw new Error('That returned-post platform is unavailable.');
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Get 3-Hashtag Reply')
      .setEmoji('💬')
      .setStyle(ButtonStyle.Secondary)
      .setCustomId(`sml-engagement-reply:${postID}:${externalPostId}`),
    new ButtonBuilder()
      .setLabel(`Share Again on ${labels[platform][0]}`)
      .setEmoji(labels[platform][1])
      .setStyle(ButtonStyle.Primary)
      .setCustomId(`sml-reshare:${postID}:${externalPostId}:${platform}`),
  ), new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Submit Public Proof Link').setEmoji('🔗').setStyle(ButtonStyle.Success).setCustomId(`sml-proof-link:${postID}:${externalPostId}`),
    new ButtonBuilder().setLabel('Submit Screenshot Proof').setEmoji('📸').setStyle(ButtonStyle.Secondary).setCustomId(`sml-proof-shot:${postID}:${externalPostId}`),
    new ButtonBuilder().setLabel('Self-Report Complete').setEmoji('✅').setStyle(ButtonStyle.Secondary).setCustomId(`sml-engagement-done:${postID}:${externalPostId}`),
  )];
}

export function shareComponents(postID, platforms = Object.keys(labels)) {
  const buttons = platforms.map((platform) => new ButtonBuilder()
    .setLabel(labels[platform][0])
    .setEmoji(labels[platform][1])
    .setStyle(ButtonStyle.Secondary)
    .setCustomId(`sml-share:${postID}:${platform}`));
  return [new ActionRowBuilder().addComponents(buttons.slice(0, 5)), new ActionRowBuilder().addComponents(buttons.slice(5))];
}

export function directShareComponents(platformUrls = {}) {
  const buttons = Object.entries(platformUrls)
    .filter(([platform, url]) => labels[platform] && typeof url === 'string' && /^https?:\/\//i.test(url) && url.length <= 512)
    .map(([platform, url]) => new ButtonBuilder()
      .setLabel(platform === 'reddit' ? 'Open Reddit Composer' : platform === 'x' ? 'Open X Composer' : labels[platform][0])
      .setEmoji(labels[platform][1])
      .setStyle(ButtonStyle.Link)
      .setURL(url));
  const rows = [];
  for (let index = 0; index < buttons.length; index += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + 5)));
  }
  return rows;
}

export function outboundLinkComponent(platform, url, postID = '', subreddit = '') {
  const label = labels[platform]?.[0] || platform;
  const buttons = [];
  if (platform === 'reddit' && subreddit) {
    buttons.push(
      new ButtonBuilder().setLabel(`Review r/${subreddit} Rules`).setStyle(ButtonStyle.Link).setURL(`https://www.reddit.com/r/${subreddit}/about/rules/`),
      new ButtonBuilder().setLabel(`Open r/${subreddit} Composer`).setStyle(ButtonStyle.Link).setURL(url),
    );
  } else {
    buttons.push(new ButtonBuilder()
      .setLabel(platform === 'facebook' ? 'Go to Facebook' : platform === 'stocktwits' ? 'Go to Stocktwits' : platform === 'threads' ? 'Continue to Threads (Paste)' : `Continue to ${label}`)
      .setStyle(ButtonStyle.Link)
      .setURL(url));
  }
  if (postID) {
    buttons.push(new ButtonBuilder()
      .setCustomId(`sml-submit-link:${postID}:${platform}`)
      .setLabel(`Submit ${label} Post Link`)
      .setStyle(ButtonStyle.Success));
  }
  return [new ActionRowBuilder().addComponents(buttons)];
}

export function shareEmbed(post, extra = []) {
  const embed = new EmbedBuilder()
    .setColor(0x22d97a)
    .setTitle(post.title.slice(0, 256))
    .setDescription(post.description.slice(0, 4096))
    .addFields(
      { name: 'Source', value: `[Open original](${post.link})`, inline: true },
      { name: 'Post ID', value: `\`${post.postID}\``, inline: true },
      ...extra,
    )
    .setFooter({ text: 'Platform choices and outbound clicks are tracked separately. A click is not a verified post.' })
    .setTimestamp();
  if (post.image) embed.setImage(post.image);
  return embed;
}

export function engagementEmbed(post) {
  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle(`Discuss: ${post.title}`.slice(0, 256))
    .setDescription(`${post.description}\n\nGenerate a discussion idea, edit it in your own voice, and reply to this Discord message. Use the buttons in #links-to-post when you want to open Reddit, X, Stocktwits, Bluesky, Threads, or Facebook. The bot never posts comments or votes for you.`.slice(0, 4096))
    .setFooter({ text: 'Discussion stays in Discord. External comments and votes must be submitted manually on the chosen platform.' })
    .setTimestamp();
  if (post.image) embed.setThumbnail(post.image);
  return embed;
}

export function engagementComponents(post) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`sml-comment:${post.postID}`)
      .setLabel('Get smart reply idea')
      .setEmoji('💬')
      .setStyle(ButtonStyle.Primary),
  )];
}

export function commentIdeaComponents(post) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`sml-comment:${post.postID}`)
      .setLabel('Generate another idea')
      .setStyle(ButtonStyle.Secondary),
  )];
}

