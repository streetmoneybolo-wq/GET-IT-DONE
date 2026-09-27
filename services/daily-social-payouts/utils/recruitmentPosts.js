/* Reddit hiring posts for Daily Social Payouts.
 *
 * Every click builds a fresh post from interchangeable parts (title, opener, duties, pay line, requirements, call to action), so no two members
 * paste identical copy, and the title follows the job-board convention ([HIRING] + role + pay) that hiring subreddits ask for. The copy stays
 * neutral-brand and honest: pay is "up to", tied to approved work, never guaranteed, and paid promotion has to be labelled on the platform.
 * The subreddit is chosen by pickSubreddit(): one this member has not posted to in the last week, and the one the whole team used longest ago. */

export const approvedRecruitmentSubreddits = [
  'sidehustle', 'thesidehustle', 'SideJobs', 'hiring', 'forhire', 'freelance_forhire', 'HiringPH', 'JobsPhilippines', 'BusinessPH', 'JapanJobs',
  'RemoteJobseekers', 'YoungJobs', 'ForHireFreelance', 'chatterjobs', 'VAjobsPH', 'hiring_recruiting', 'B2BForHire', 'hiringPhilippinesPH',
  'RemoteJobs', 'RecruitmentHub', 'RedditJobBoard', 'remotejobsfinders', 'HireaWriter', 'onlinejobsforall', 'HiringAustralia', 'HiringPAK',
  'torontoJobs',
];

export const DEFAULT_APPLY_URL = 'https://stockmarketloop.com/go/dsp-jmuy/';
export const REPOST_DAYS = 7;

export const cleanSubreddit = (name) => String(name || '').replace(/^\s*(https?:\/\/)?(www\.)?(reddit\.com\/)?r\//i, '').replace(/[/\s].*$/, '').replace(/[^A-Za-z0-9_]/g, '');

/* job boards that expect the [HIRING] tag at the start of the title */
const TAGGED = /^(hiring|forhire|freelance_forhire|ForHireFreelance|HireaWriter|B2BForHire|hiring_recruiting|RedditJobBoard|RecruitmentHub|HiringPH|hiringPhilippinesPH|HiringAustralia|HiringPAK|VAjobsPH|chatterjobs|RemoteJobs|torontoJobs)$/i;

const TITLES = [
  ['🚀', 'Hiring Remote Social Media Assistants — Part-Time, Flexible, Paid Per Task 💰'],
  ['💼', 'Now Hiring: Social Media Assistants & Content Clippers — Remote, Paid Per Task via PayPal'],
  ['📱', 'Remote Social Media Assistant Needed — Flexible Hours, Per-Task PayPal Pay'],
  ['✂️', 'Hiring Content Clippers & Post Sharers — Work From Your Phone, Paid Per Task'],
  ['🔥', 'Part-Time Remote Work: Share Posts & Clip Short Content — Paid Per Task'],
  ['💵', 'Hiring Social Media Helpers — Remote, No Experience Needed, PayPal Per Task'],
  ['⚡', 'Flexible Remote Gig: Social Media Assistant (Share, Clip, Distribute) — Paid Per Task'],
  ['🌎', 'Remote Social Media Assistants Wanted — Part-Time, Paid Per Task via PayPal'],
];

const OPENERS = [
  (p) => `We’re looking for people who can help share posts and clip short content across platforms like ${p}.`,
  (p) => `We need a few more helpers to share posts and clip short content on ${p}.`,
  (p) => `Our team is growing and we’re adding people who can share posts and clip short content across ${p}.`,
  (p) => `Looking for reliable people to help share posts and cut short clips for ${p}.`,
  (p) => `We’re hiring remote helpers to share posts and clip short content across ${p}.`,
];
const PLATFORMS = ['Reddit', 'X', 'Stocktwits', 'Threads', 'Facebook', 'Bluesky'];

const EASY = [
  'If you’re already active on social media, this is extremely simple work.',
  'If you already spend time on social media, you already know how to do this.',
  'If you use social media every day, this is easy work that fits around your day.',
  'No special skills needed. If you can post and copy a link, you can do this.',
];

const DO_HEADS = ['What you’ll do', 'The work', 'Your tasks', 'What the job looks like'];
const DUTIES = [
  ['📌 Share posts', '📌 Share ready-made posts', '📌 Post approved updates'],
  ['✂️ Clip short content', '✂️ Cut short clips from longer content', '✂️ Clip short videos and highlights'],
  ['🔄 Help distribute updates across multiple platforms', '🔄 Spread updates across several platforms', '🔄 Help get updates out on multiple platforms'],
];

const GET_HEADS = ['What you get', 'Why join', 'The perks', 'What’s in it for you'];
const BENEFITS = [
  ['💵 Per-task pay via PayPal', '💵 Paid per task through PayPal', '💵 PayPal payouts for every approved task'],
  ['⏱️ Verified within 72 hours', '⏱️ Tasks verified within 72 hours', '⏱️ Work checked and verified within 72 hours'],
  ['📱 No experience needed — just a phone and a few minutes a day', '📱 Just a phone and a few minutes a day, no experience needed', '📱 Beginner-friendly — all you need is a phone'],
  ['⚡ Active helpers can earn consistent daily payouts depending on task volume', '⚡ The more active you are, the more you can earn (depends on task volume)', '⚡ Steady daily payouts for active helpers, depending on how many tasks are available'],
  ['🕒 Work on your own schedule', '🕒 Flexible hours — pick up tasks when it suits you'],
];

const CTAS = [
  (u) => `If you want to check out the details or get onboarded, everything is explained in the server:\n👉 ${u} 👈`,
  (u) => `Full details and onboarding are in the server:\n👉 ${u} 👈`,
  (u) => `Want in? Everything you need to get started is in the server:\n👉 ${u} 👈`,
  (u) => `Check the details and get set up here:\n👉 ${u} 👈`,
];

function regionLine(sub) {
  if (/PH|Philippines|BusinessPH/i.test(sub)) return '🇵🇭 Open to applicants in the Philippines — fully remote.';
  if (/Japan/i.test(sub)) return '🇯🇵 Remote; applicants in Japan welcome (tasks in English).';
  if (/PAK/i.test(sub)) return '🇵🇰 Open to applicants in Pakistan — fully remote.';
  if (/Australia/i.test(sub)) return '🇦🇺 Open to applicants in Australia — fully remote.';
  if (/toronto/i.test(sub)) return '🇨🇦 Remote — Toronto and Canada applicants welcome.';
  if (/Young/i.test(sub)) return '18+ only.';
  return '';
}

/* A small seeded generator, so a variant number always gives the same post (tests, the duplicate check). */
function rng(seed) {
  // mix the seed first (murmur3 finaliser), so neighbouring variant numbers give unrelated posts
  let s = seed >>> 0; s ^= s >>> 16; s = Math.imul(s, 0x85ebca6b) >>> 0; s ^= s >>> 13; s = Math.imul(s, 0xc2b2ae35) >>> 0; s ^= s >>> 16; s = s || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const seedOf = (sub, variant) => { let h = 2166136261 ^ Number(variant); for (const ch of sub) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return Math.imul(h ^ (Number(variant) * 2654435761 >>> 0), 2246822519) >>> 0; };
const pickOne = (list, r) => list[Math.floor(r() * list.length)];
function shuffle(list, r) { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export function generateRecruitmentPost(subreddit, variant = 0, { applyUrl = DEFAULT_APPLY_URL } = {}) {
  const sub = cleanSubreddit(subreddit);
  const r = rng(seedOf(sub, variant));
  const [emoji, text] = pickOne(TITLES, r);
  const title = (TAGGED.test(sub) ? `[HIRING] ${text}` : `${emoji} ${text}`).slice(0, 300);
  const platforms = shuffle(PLATFORMS, r);
  const platformText = platforms.slice(0, -1).join(', ') + ', and ' + platforms[platforms.length - 1];
  const benefits = shuffle(BENEFITS.slice(0, 3), r).concat(shuffle(BENEFITS.slice(3), r).slice(0, 1 + Math.floor(r() * 2)));
  const region = regionLine(sub);
  const body = [
    pickOne(OPENERS, r)(platformText),
    '',
    pickOne(EASY, r),
    ...(region ? ['', region] : []),
    '',
    `**${pickOne(DO_HEADS, r)}**`,
    '',
    ...shuffle(DUTIES, r).map((d) => `* ${pickOne(d, r)}`),
    '',
    `**${pickOne(GET_HEADS, r)}**`,
    '',
    ...benefits.map((b) => `* ${pickOne(b, r)}`),
    '',
    pickOne(CTAS, r)(applyUrl),
  ].join('\n');
  return {
    subreddit: sub,
    title,
    body,
    rulesUrl: `https://www.reddit.com/r/${encodeURIComponent(sub)}/about/rules/`,
    composerUrl: redditComposerUrl(sub, title, body),
  };
}

/* Reddit's composer with the subreddit, title AND body filled in. */
export function redditComposerUrl(subreddit, title, body) {
  const sub = encodeURIComponent(cleanSubreddit(subreddit));
  return `https://www.reddit.com/r/${sub}/submit?selftext=true&title=${encodeURIComponent(title)}&text=${encodeURIComponent(body)}`;
}

/* A short fingerprint of a post, so the bot can make sure it never hands out the same text twice. */
export function postFingerprint(post) {
  let h = 2166136261;
  for (const ch of `${post.title}\n${post.body}`) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}

/* The subreddit for this click: never one this member used in the last REPOST_DAYS, and among the rest the one the team used longest ago.
   Returns null when the member has covered every subreddit this week. */
export function pickSubreddit(subreddits, state, userId, now = Date.now(), random = Math.random) {
  const weekAgo = now - REPOST_DAYS * 86_400_000;
  const mine = (state.byUser && state.byUser[userId]) || {};
  const open = subreddits.filter((s) => !(mine[s.toLowerCase()] > weekAgo));
  if (!open.length) return null;
  const last = (s) => Number((state.lastBySub || {})[s.toLowerCase()] || 0);
  const oldest = Math.min(...open.map(last));
  const ties = open.filter((s) => last(s) === oldest);
  return ties[Math.floor(random() * ties.length)];
}

/* When the member can generate again once every subreddit is used: the moment their oldest post of the week turns a week old. */
export function nextOpenAt(state, userId) {
  const mine = Object.values((state.byUser && state.byUser[userId]) || {}).map(Number).filter(Boolean);
  return mine.length ? Math.min(...mine) + REPOST_DAYS * 86_400_000 : 0;
}
