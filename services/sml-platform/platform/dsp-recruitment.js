'use strict';

/* Recruitment-panel component replies for the Discord HTTP interaction endpoint.
 * The worker owns the panel, but Discord sends its button taps to this endpoint.
 * Nothing here posts to Reddit: it returns an ephemeral draft the member reviews. */
const crypto = require('node:crypto');

const RECRUITMENT_CHANNEL_ID = '1551968149132279908';
const RETURN_LINKS_CHANNEL_ID = '1553180056338301020';
const RECRUIT_BUTTON_ID = 'dsp-recruit-random';
const COPY_BUTTON_PREFIX = 'dsp-recruit-copy:';
const APPLY_URL = 'https://stockmarketloop.com/go/dsp-jmuy/';
const SUBREDDITS = Object.freeze(['sidehustle', 'thesidehustle', 'SideJobs', 'hiring', 'forhire', 'freelance_forhire', 'HiringPH', 'JobsPhilippines', 'BusinessPH', 'JapanJobs', 'RemoteJobseekers', 'YoungJobs', 'ForHireFreelance', 'chatterjobs', 'VAjobsPH', 'hiring_recruiting', 'B2BForHire', 'hiringPhilippinesPH', 'RemoteJobs', 'RecruitmentHub', 'RedditJobBoard', 'remotejobsfinders', 'HireaWriter', 'onlinejobsforall', 'HiringAustralia', 'HiringPAK', 'torontoJobs']);
const TAGGED = /^(hiring|forhire|freelance_forhire|ForHireFreelance|HireaWriter|B2BForHire|hiring_recruiting|RedditJobBoard|RecruitmentHub|HiringPH|hiringPhilippinesPH|HiringAustralia|HiringPAK|VAjobsPH|chatterjobs|RemoteJobs|torontoJobs)$/i;
const TITLES = Object.freeze(['Hiring Remote Social Media Assistants — Part-Time, Flexible, Paid Per Task', 'Now Hiring: Social Media Assistants & Content Clippers — Remote, Paid Per Task', 'Remote Social Media Assistant Needed — Flexible Hours, Per-Task PayPal Pay', 'Hiring Content Clippers & Post Sharers — Work From Your Phone, Paid Per Task']);
const OPENERS = Object.freeze(['We are looking for people who can help share posts and clip short content across social platforms.', 'Our remote team is adding reliable social-media assistants and content clippers.', 'We are adding flexible remote helpers for short-form content and approved social distribution.']);
const REGIONS = Object.freeze([[/PH|Philippines|BusinessPH/i, 'Open to applicants in the Philippines — fully remote.'], [/Japan/i, 'Remote; applicants in Japan welcome (tasks in English).'], [/PAK/i, 'Open to applicants in Pakistan — fully remote.'], [/Australia/i, 'Open to applicants in Australia — fully remote.'], [/toronto/i, 'Remote — Toronto and Canada applicants welcome.']]);

function pick(list, seed) { return list[seed % list.length]; }
function cleanSubreddit(value) { return String(value || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 64); }
function validUser(interaction) { const user = (interaction && interaction.member && interaction.member.user) || (interaction && interaction.user) || {}; return /^[0-9]{5,24}$/.test(String(user.id || '')) ? String(user.id) : ''; }
function variantFor(interaction) { return crypto.createHash('sha256').update(`${validUser(interaction)}:${interaction && interaction.id || ''}:${Date.now()}`).digest().readUInt32BE(0); }
function postFor(subreddit, variant) {
  const sub = cleanSubreddit(subreddit);
  const titleText = pick(TITLES, variant);
  const title = (TAGGED.test(sub) ? `[HIRING] ${titleText}` : `Remote opportunity: ${titleText}`).slice(0, 300);
  const region = REGIONS.find(([pattern]) => pattern.test(sub));
  const body = [pick(OPENERS, Math.floor(variant / 7)), '', 'If you already use social media, this is flexible work that can fit around your day.', ...(region ? ['', region[1]] : []), '', '**What you will do**', '* Share approved posts where platform and community rules allow it', '* Clip short content from approved source material', '* Return public links so work can be reviewed', '', '**What you get**', '* Per-task PayPal payouts after verification', '* Flexible schedule and beginner-friendly onboarding', '* Clear task instructions in the community', '', `Full details and onboarding: ${APPLY_URL}`].join('\n');
  return { subreddit: sub, title, body, rulesUrl: `https://www.reddit.com/r/${encodeURIComponent(sub)}/about/rules/`, composerUrl: `https://www.reddit.com/r/${encodeURIComponent(sub)}/submit?selftext=true&title=${encodeURIComponent(title)}&text=${encodeURIComponent(body)}` };
}
function response(content, extras = {}) { return { response: { type: 4, data: { content: String(content).slice(0, 2000), flags: 64, allowed_mentions: { parse: [] }, ...extras } } }; }
function readyReply(post, variant) {
  const content = [`# Your recruitment post is ready: r/${post.subreddit}`, `[Open r/${post.subreddit} on Reddit — title and body filled in](${post.composerUrl})`, 'Check the subreddit rules and required flair before posting.', '', `After posting, return to <#${RETURN_LINKS_CHANNEL_ID}> and paste the public Reddit link for verification.`].join('\n');
  return response(content, { embeds: [{ title: post.title, description: post.body.slice(0, 4000), color: 0x00c47d, footer: { text: `Preview · r/${post.subreddit}` } }], components: [{ type: 1, components: [{ type: 2, style: 2, custom_id: `${COPY_BUTTON_PREFIX}${post.subreddit}:${variant}`, label: 'Copy Text', emoji: { name: '📋' } }, { type: 2, style: 5, url: post.rulesUrl, label: `r/${post.subreddit} Rules` }] }] });
}
function handleRecruitmentComponent(interaction) {
  const customId = String(interaction && interaction.data && interaction.data.custom_id || '');
  if (customId !== RECRUIT_BUTTON_ID && !customId.startsWith(COPY_BUTTON_PREFIX)) return null;
  if (String(interaction && interaction.channel_id || '') !== RECRUITMENT_CHANNEL_ID) return response('Use the recruitment panel in its assigned Daily Recruitment channel.');
  if (!validUser(interaction)) return response('Discord could not identify your account. Please try again.');
  if (customId.startsWith(COPY_BUTTON_PREFIX)) {
    const [subreddit, rawVariant] = customId.slice(COPY_BUTTON_PREFIX.length).split(':');
    if (!SUBREDDITS.some((item) => item.toLowerCase() === String(subreddit).toLowerCase())) return response('That recruitment post has expired. Generate a fresh one from the panel.');
    const post = postFor(subreddit, Number(rawVariant) || 0);
    return response(['**Title:**', '```text', post.title, '```', '**Body:**', '```text', post.body, '```'].join('\n'));
  }
  const variant = variantFor(interaction);
  return readyReply(postFor(pick(SUBREDDITS, variant), variant), variant);
}
module.exports = { RECRUITMENT_CHANNEL_ID, RECRUIT_BUTTON_ID, COPY_BUTTON_PREFIX, handleRecruitmentComponent, postFor };
