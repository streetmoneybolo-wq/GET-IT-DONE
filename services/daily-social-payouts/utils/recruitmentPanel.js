/* The recruitment panel: one message with a "Generate Recruitment Post" button in the recruitment channel, kept up to date on every start.
 * A click answers privately (ephemeral) with a fresh hiring post, the subreddit it is for, a button that opens Reddit's composer on that
 * subreddit with the title filled in, and the subreddit's rules. Nothing is posted to Reddit by the bot and no member is messaged. */
import path from 'node:path';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { mutateJson, paths, readSettings } from './storage.js';
import { approvedRecruitmentSubreddits, cleanSubreddit, DEFAULT_APPLY_URL, generateRecruitmentPost, nextOpenAt, pickSubreddit, postFingerprint, REPOST_DAYS } from './recruitmentPosts.js';

export const RECRUIT_BUTTON_ID = 'dsp-recruit-random';
export const COPY_BUTTON_PREFIX = 'dsp-recruit-copy:';
const SEEN_MAX = 5000;
export const DEFAULT_RECRUITMENT_CHANNEL_ID = '1551968149132279908';
const rotationFile = path.join(path.dirname(paths.settingsOverrides), 'recruitment-rotation.json');

export function recruitmentConfig(settings = {}) {
  const cfg = settings.recruitmentPosts || {};
  const list = (Array.isArray(cfg.approvedSubreddits) && cfg.approvedSubreddits.length ? cfg.approvedSubreddits : approvedRecruitmentSubreddits).map(cleanSubreddit).filter(Boolean);
  const seen = new Set();
  return {
    enabled: cfg.enabled !== false,
    channelId: String(process.env.RECRUITMENT_CHANNEL_ID || cfg.channelId || DEFAULT_RECRUITMENT_CHANNEL_ID).trim(),
    subreddits: list.filter((s) => (seen.has(s.toLowerCase()) ? false : seen.add(s.toLowerCase()))),
    applyUrl: /^https:\/\//.test(String(cfg.applyUrl || '')) ? String(cfg.applyUrl) : DEFAULT_APPLY_URL,
  };
}

export function panelMessage(cfg) {
  const embed = new EmbedBuilder()
    .setColor(0x00c47d)
    .setTitle('📣 Recruitment — Generate a Hiring Post')
    .setDescription([
      'Help the team grow and get the post written for you.',
      '',
      '**1.** Tap **Generate Recruitment Post**. You get your own hiring post and a random subreddit from the list.',
      '**2.** Tap the **Open r/… on Reddit** link. The subreddit, title and body are already filled in.',
      '**3.** Check the subreddit rules and any required flair, then post.',
      '',
      'If Reddit opens without the text (some phone apps drop it), tap **Copy Text** and paste it in.',
      '',
      `Each post is worded differently, and you get a different subreddit each time. You can post to each subreddit once every ${REPOST_DAYS} days.`,
      '',
      '*Only post where hiring posts are allowed. Never promise guaranteed income, and do not repost the same text.*',
    ].join('\n'))
    .setFooter({ text: `${cfg.subreddits.length} approved subreddits` });
  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(RECRUIT_BUTTON_ID).setLabel('Generate Recruitment Post').setEmoji('📝').setStyle(ButtonStyle.Success))],
    allowedMentions: { parse: [] },
  };
}

const hasPanelButton = (m) => (m.components || []).some((row) => (row.components || []).some((c) => (c.customId || c.data?.custom_id) === RECRUIT_BUTTON_ID));

/* Posts the panel once, or refreshes the bot's existing panel in place. Safe to run on every start. */
export async function ensureRecruitmentPanel(client) {
  const cfg = recruitmentConfig(await readSettings());
  if (!cfg.enabled || !/^\d{15,25}$/.test(cfg.channelId)) return { ok: false, reason: 'disabled' };
  const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel || !channel.isTextBased?.() || typeof channel.send !== 'function') {
    console.warn(`Recruitment panel: channel ${cfg.channelId} is not reachable by this bot (is the bot in that server with View + Send permission?).`);
    return { ok: false, reason: 'channel_unreachable' };
  }
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const existing = recent ? [...recent.values()].find((m) => m.author?.id === client.user.id && hasPanelButton(m)) : null;
  const message = panelMessage(cfg);
  if (existing) { await existing.edit(message); console.log(`Recruitment panel refreshed in #${channel.name} (${channel.id}).`); return { ok: true, action: 'refreshed', messageId: existing.id }; }
  const sent = await channel.send(message);
  console.log(`Recruitment panel posted in #${channel.name} (${channel.id}).`);
  return { ok: true, action: 'posted', messageId: sent.id };
}

/* Picks the subreddit and records the choice in one locked write, so two quick clicks never get the same subreddit. */
export async function claimSubreddit(cfg, userId, now = Date.now()) {
  let result = null;
  await mutateJson(rotationFile, { lastBySub: {}, byUser: {}, count: 0, seen: [] }, (state) => {
    state.lastBySub = state.lastBySub || {}; state.byUser = state.byUser || {}; state.count = Number(state.count) || 0; state.seen = Array.isArray(state.seen) ? state.seen : [];
    const sub = pickSubreddit(cfg.subreddits, state, userId, now);
    if (!sub) { result = { sub: null, retryAt: nextOpenAt(state, userId) }; return state; }
    const key = sub.toLowerCase();
    state.count += 1;
    state.lastBySub[key] = now;
    state.byUser[userId] = state.byUser[userId] || {};
    state.byUser[userId][key] = now;
    // forget week-old entries so the file stays small
    for (const [u, subs] of Object.entries(state.byUser)) { for (const [k, t] of Object.entries(subs)) if (now - Number(t) > REPOST_DAYS * 86_400_000) delete subs[k]; if (!Object.keys(subs).length) delete state.byUser[u]; }
    // every post handed out is different: skip any wording already given to someone
    const seen = new Set(state.seen);
    let variant = state.count, post = generateRecruitmentPost(sub, variant, cfg);
    for (let tries = 0; seen.has(postFingerprint(post)) && tries < 50; tries++) { variant += 7919; post = generateRecruitmentPost(sub, variant, cfg); }
    state.seen.push(postFingerprint(post)); if (state.seen.length > SEEN_MAX) state.seen.splice(0, state.seen.length - SEEN_MAX);
    result = { sub, variant, post };
    return state;
  });
  return result;
}

/* The private reply: a link that opens Reddit with the subreddit, title and body filled in, the post itself as a preview, and buttons for the
   subreddit rules and a copy-ready version. The link sits in the message text because Discord buttons only hold 512-character links. */
export function postReply(post, variant = 0) {
  const link = `## 👉 [Open r/${post.subreddit} on Reddit — title and body filled in](${post.composerUrl})`;
  const content = [`# 📝 Your recruitment post is ready: r/${post.subreddit}`, link, 'Check the subreddit rules and flair before you post.'].join('\n');
  const embed = new EmbedBuilder().setColor(0x00c47d).setTitle(post.title.slice(0, 256)).setDescription(post.body.slice(0, 4000)).setFooter({ text: `Preview · r/${post.subreddit}` });
  return {
    content: content.length <= 2000 ? content : `# 📝 Your recruitment post is ready: r/${post.subreddit}\nTap **Copy Text**, then open Reddit and paste it in.`,
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${COPY_BUTTON_PREFIX}${post.subreddit}:${variant}`).setLabel('Copy Text').setEmoji('📋').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setLabel(`r/${post.subreddit} Rules`).setStyle(ButtonStyle.Link).setURL(post.rulesUrl),
    )],
    ephemeral: true,
    allowedMentions: { parse: [] },
  };
}

/* Copy-ready title and body, for when a phone's Reddit app opens without the filled-in text. */
export function copyReply(post) {
  const content = ['**Title:**', '```text', post.title, '```', '**Body:**', '```text', post.body, '```'].join('\n');
  return { content: content.slice(0, 2000), ephemeral: true, allowedMentions: { parse: [] } };
}

/* The button handler. Returns false when the interaction is not the recruitment button. */
export async function handleRecruitmentButton(interaction) {
  if (!interaction.isButton()) return false;
  if (interaction.customId.startsWith(COPY_BUTTON_PREFIX)) {
    const [sub, variant] = interaction.customId.slice(COPY_BUTTON_PREFIX.length).split(':');
    const cfg = recruitmentConfig(await readSettings());
    await interaction.reply(copyReply(generateRecruitmentPost(sub, Number(variant) || 0, cfg)));
    return true;
  }
  if (interaction.customId !== RECRUIT_BUTTON_ID) return false;
  const cfg = recruitmentConfig(await readSettings());
  if (!cfg.enabled || !cfg.subreddits.length) { await interaction.reply({ content: 'Recruitment posts are switched off right now.', ephemeral: true }); return true; }
  const claim = await claimSubreddit(cfg, interaction.user.id);
  if (!claim.sub) {
    const when = claim.retryAt ? `<t:${Math.ceil(claim.retryAt / 1000)}:R>` : 'in a few days';
    await interaction.reply({ content: `You have posted to all ${cfg.subreddits.length} subreddits in the last ${REPOST_DAYS} days — nice work. Your next one opens ${when}.`, ephemeral: true });
    return true;
  }
  await interaction.reply(postReply(claim.post, claim.variant));
  return true;
}
