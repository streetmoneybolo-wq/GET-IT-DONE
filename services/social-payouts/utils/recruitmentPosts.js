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

export const DEFAULT_APPLY_URL = 'https://discord.gg/cxMvYdm4a2';
export const DEFAULT_MAX_DAILY_USD = 50;
export const REPOST_DAYS = 7;

export const cleanSubreddit = (name) => String(name || '').replace(/^\s*(https?:\/\/)?(www\.)?(reddit\.com\/)?r\//i, '').replace(/[/\s].*$/, '').replace(/[^A-Za-z0-9_]/g, '');

const TITLES = [
  (pay) => `[HIRING] Remote Social Media Assistant / Content Clipper — up to $${pay}/day (PayPal)`,
  (pay) => `[HIRING] Content Clippers & Social Media Assistants — Remote, Flexible Hours, up to $${pay}/day`,
  (pay) => `[HIRING] Part-Time Remote Content Clipper — Paid per Approved Task, up to $${pay}/day via PayPal`,
  (pay) => `[HIRING] Social Media Assistant (Remote, Phone-Friendly) — up to $${pay}/day`,
  (pay) => `[HIRING] Short-Form Video Clippers Wanted — Remote, Paid Daily Tasks, up to $${pay}/day`,
  (pay) => `[HIRING] Remote Social Media Assistants — Clip, Post & Report, up to $${pay}/day (PayPal)`,
];

const OPENERS = [
  'Daily Social Payouts is hiring remote social media assistants and content clippers to help approved creators and brands reach more people.',
  'We are growing our remote team and looking for reliable people who are already comfortable on social media.',
  'Looking for flexible side work you can do from your phone? We are hiring social media assistants and short-form content clippers.',
  'Daily Social Payouts runs structured, paid social media tasks, and we are adding new assistants and clippers to the team.',
  'If you know your way around TikTok, Reels, Shorts or X, this is paid remote work that fits around your schedule.',
];

const DUTIES = [
  'Clip short videos (15–60s) from approved long-form content',
  'Post approved clips and posts on your own accounts (TikTok, YouTube Shorts, Instagram Reels, X, Threads, Facebook and more)',
  'Write short captions and hooks for approved clips',
  'Follow each platform’s rules and label paid posts (e.g. #ad) where required',
  'Send the public link back so your task can be reviewed and credited',
  'Pick up new tasks each day from the team channel',
];

const PAY = [
  (pay) => `Up to **$${pay}/day**, based on approved, completed tasks. Paid through **PayPal**.`,
  (pay) => `Paid per approved task, **up to $${pay}/day**. Payouts go out through **PayPal**.`,
  (pay) => `Earn **up to $${pay}/day** for approved work, paid via **PayPal**. More platforms you cover = more tasks available.`,
];

const PAY_NOTES = [
  'Income is not guaranteed: it depends on the tasks available and on each task being approved.',
  'No guaranteed income. Pay depends on task availability and approved proof of each task.',
];

const REQUIREMENTS = [
  'A phone or computer',
  'A PayPal account',
  'At least one active social media account (more platforms = more tasks)',
  'About 30–60 minutes a day, on your own schedule',
  'Basic English and the ability to follow simple instructions',
];

const CTAS = [
  (url) => `**How to apply:** join our onboarding server and submit the social accounts you can work on: ${url}`,
  (url) => `**Apply here:** ${url} — join, open the application channel, and send your platform links for review.`,
  (url) => `**Interested?** Apply through our onboarding server: ${url} (applications are reviewed by the team).`,
];

function regionLine(sub) {
  if (/PH|Philippines|BusinessPH/i.test(sub)) return 'Open to applicants in the Philippines — fully remote, PayPal payouts.';
  if (/Japan/i.test(sub)) return 'Fully remote; applicants in Japan are welcome (tasks and communication in English).';
  if (/PAK/i.test(sub)) return 'Open to applicants in Pakistan — fully remote, PayPal payouts where PayPal is available to you.';
  if (/Australia/i.test(sub)) return 'Open to applicants in Australia — fully remote, flexible hours.';
  if (/toronto/i.test(sub)) return 'Remote role; Toronto and Canada-based applicants are welcome.';
  if (/Writer/i.test(sub)) return 'Good fit for writers: a big part of the role is short captions and hooks.';
  if (/forhire|freelance|B2B/i.test(sub)) return 'Independent contractor role — freelancers welcome.';
  if (/Young/i.test(sub)) return 'Open to applicants 18+ only.';
  if (/side/i.test(sub)) return 'Flexible side work, not a full-time job.';
  return 'Fully remote, flexible hours.';
}

/* A small seeded generator, so the same variant number always gives the same post (tests, re-generation). */
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const pickOne = (list, r) => list[Math.floor(r() * list.length)];
function pickSome(list, n, r) { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); }

export function generateRecruitmentPost(subreddit, variant = 0, { applyUrl = DEFAULT_APPLY_URL, maxDailyUsd = DEFAULT_MAX_DAILY_USD } = {}) {
  const sub = cleanSubreddit(subreddit);
  const r = rng(Number(variant) * 2654435761 + sub.length * 97 + 17);
  const pay = Number(maxDailyUsd) > 0 ? Math.round(Number(maxDailyUsd)) : DEFAULT_MAX_DAILY_USD;
  const title = pickOne(TITLES, r)(pay).slice(0, 300);
  // the "label paid posts" and "send the link back" duties are always in; one of the optional ones rotates
  const duties = [DUTIES[0], DUTIES[1], ...pickSome([DUTIES[2], DUTIES[5]], 1, r), DUTIES[3], DUTIES[4]];
  const body = [
    pickOne(OPENERS, r),
    '',
    '**Role:** Social Media Assistant / Content Clipper · Remote · Part-time',
    `**Where:** ${regionLine(sub)}`,
    '',
    '**What you will do**',
    ...duties.map((d) => `- ${d}`),
    '',
    '**Pay**',
    pickOne(PAY, r)(pay),
    pickOne(PAY_NOTES, r),
    '',
    '**You will need**',
    ...pickSome(REQUIREMENTS, 4, r).map((d) => `- ${d}`),
    '',
    pickOne(CTAS, r)(applyUrl),
  ].join('\n');
  return {
    subreddit: sub,
    title,
    body,
    rulesUrl: `https://www.reddit.com/r/${encodeURIComponent(sub)}/about/rules/`,
    composerUrl: recruitmentComposerTitleOnlyUrl(sub, title),
  };
}

/* Discord link buttons take at most 512 characters, so the composer opens with the subreddit and title filled and a paste reminder as the body. */
export function recruitmentComposerTitleOnlyUrl(subreddit, title) {
  const sub = cleanSubreddit(subreddit);
  const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/submit?type=TEXT&title=${encodeURIComponent(title)}&text=${encodeURIComponent('PASTE THE POST BODY YOU COPIED FROM DISCORD HERE')}`;
  return url.length <= 512 ? url : `https://www.reddit.com/r/${encodeURIComponent(sub)}/submit?type=TEXT`;
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
