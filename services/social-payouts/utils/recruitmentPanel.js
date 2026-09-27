/* The recruitment panel: one message with a "Generate Recruitment Post" button in the recruitment channel, kept up to date on every start.
 * A click answers privately (ephemeral) with a fresh hiring post, the subreddit it is for, a button that opens Reddit's composer on that
 * subreddit with the title filled in, and the subreddit's rules. Nothing is posted to Reddit by the bot and no member is messaged. */
import path from 'node:path';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { mutateJson, paths, readSettings } from './storage.js';
import { approvedRecruitmentSubreddits, cleanSubreddit, DEFAULT_APPLY_URL, DEFAULT_MAX_DAILY_USD, generateRecruitmentPost, nextOpenAt, pickSubreddit, REPOST_DAYS } from './recruitmentPosts.js';

export const RECRUIT_BUTTON_ID = 'dsp-recruit-random';
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
    maxDailyUsd: Number(cfg.maxDailyUsd) > 0 ? Number(cfg.maxDailyUsd) : DEFAULT_MAX_DAILY_USD,
  };
}

export function panelMessage(cfg) {
  const embed = new EmbedBuilder()
    .setColor(0x00c47d)
    .setTitle('📣 Recruitment — Generate a Hiring Post')
    .setDescription([
      'Help the team grow and get the post written for you.',
      '',
      '**1.** Tap **Generate Recruitment Post**. You get a fresh hiring post and the subreddit it is for.',
      '**2.** Copy the post body (long-press the grey box on mobile).',
      '**3.** Tap **Open Reddit Composer**. The subreddit and title are already filled in.',
      '**4.** Paste the body over the placeholder, check the subreddit rules and flair, then post.',
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
  await mutateJson(rotationFile, { lastBySub: {}, byUser: {}, count: 0 }, (state) => {
    state.lastBySub = state.lastBySub || {}; state.byUser = state.byUser || {}; state.count = Number(state.count) || 0;
    const sub = pickSubreddit(cfg.subreddits, state, userId, now);
    if (!sub) { result = { sub: null, retryAt: nextOpenAt(state, userId) }; return state; }
    const key = sub.toLowerCase();
    state.count += 1;
    state.lastBySub[key] = now;
    state.byUser[userId] = state.byUser[userId] || {};
    state.byUser[userId][key] = now;
    // forget week-old entries so the file stays small
    for (const [u, subs] of Object.entries(state.byUser)) { for (const [k, t] of Object.entries(subs)) if (now - Number(t) > REPOST_DAYS * 86_400_000) delete subs[k]; if (!Object.keys(subs).length) delete state.byUser[u]; }
    result = { sub, variant: state.count };
    return state;
  });
  return result;
}

export function postReply(post) {
  const head = [`# 📝 Your hiring post for r/${post.subreddit}`, `**Title (already filled in on Reddit):** ${post.title}`, '', '**Copy this body:**'];
  const tail = ['', `Then tap **Open r/${post.subreddit} Composer**, paste the body, check the rules and any required flair, and post.`];
  const content = [...head, '```text', post.body, '```', ...tail].join('\n');
  return {
    content: content.length <= 2000 ? content : [...head, '```text', post.body.slice(0, 2000 - head.join('\n').length - 40), '```'].join('\n'),
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel(`Open r/${post.subreddit} Composer`).setStyle(ButtonStyle.Link).setURL(post.composerUrl),
      new ButtonBuilder().setLabel('Subreddit Rules').setStyle(ButtonStyle.Link).setURL(post.rulesUrl),
    )],
    ephemeral: true,
    allowedMentions: { parse: [] },
  };
}

/* The button handler. Returns false when the interaction is not the recruitment button. */
export async function handleRecruitmentButton(interaction) {
  if (!(interaction.isButton() && interaction.customId === RECRUIT_BUTTON_ID)) return false;
  const cfg = recruitmentConfig(await readSettings());
  if (!cfg.enabled || !cfg.subreddits.length) { await interaction.reply({ content: 'Recruitment posts are switched off right now.', ephemeral: true }); return true; }
  const claim = await claimSubreddit(cfg, interaction.user.id);
  if (!claim.sub) {
    const when = claim.retryAt ? `<t:${Math.ceil(claim.retryAt / 1000)}:R>` : 'in a few days';
    await interaction.reply({ content: `You have posted to all ${cfg.subreddits.length} subreddits in the last ${REPOST_DAYS} days — nice work. Your next one opens ${when}.`, ephemeral: true });
    return true;
  }
  await interaction.reply(postReply(generateRecruitmentPost(claim.sub, claim.variant, cfg)));
  return true;
}
