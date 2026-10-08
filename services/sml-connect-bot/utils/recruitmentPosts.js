export const approvedRecruitmentSubreddits = [
  'sidehustle',
  'thesidehustle',
  'SideJobs',
  'hiring',
  'forhire',
  'freelance_forhire',
  'HiringPH',
  'JobsPhilippines',
  'BusinessPH',
  'JapanJobs',
  'RemoteJobseekers',
  'YoungJobs',
  'WFHJobs',
  'IndiaJobsOpenings',
  'Germany_Jobs',
  'onlinejobsforall',
  'freelancing',
  'hiringpakistan',
  'RecruitingHiringPH',
  'ForHireFreelance',
  'hiringPhilippinesPH',
  'LookingforJob',
];

const titleTemplates = [
  "WE'RE HIRING — Social Media Promo Ambassadors",
  'Hiring Social Media Promo Workers — PayPal Payouts',
  'We’re Hiring: Social Media Promotion & Engagement Specialists',
  'Remote Promo Work — Earn for Approved Social Engagement Tasks',
  'Hiring Multi-Platform Social Media Workers',
  'Daily Social Payouts Is Hiring Promo Ambassadors',
  'Paid Social Media Promo Tasks — Apply With Your Platforms',
  'Social Media Engagement Specialists Needed',
];

const openers = [
  'If you are active on social media, Daily Social Payouts is reviewing applicants for paid promo and engagement work.',
  'Daily Social Payouts is building a high-energy promo team for approved social media visibility tasks.',
  'Our team is expanding and we are looking for motivated people who can help creators, brands, and communities grow online.',
  'If you already spend time on social platforms, you can apply to complete approved promo tasks and submit proof for payout review.',
  'We are looking for reliable social media users who can follow instructions, stay active, and support structured promo campaigns.',
];

const fitLines = [
  'You may be a fit if you have active accounts on Facebook, Threads, Bluesky, Reddit, Twitter/X, LinkedIn, Stocktwits, or similar platforms.',
  'The more platforms you can work on, the more promo-task opportunities you may qualify for.',
  'Multi-platform applicants are preferred because more platform coverage can unlock more earning opportunities.',
  'This is best for people who can share approved posts, engage with content, and return proof links on time.',
];

const processLines = [
  'You will share approved promo posts, boost engagement with likes/comments/reposts, and help increase visibility across supported platforms.',
  'The workflow is simple: submit your platform links, get reviewed, complete approved daily promo tasks, then return public proof for payout tracking.',
  'Approved users receive structured tasks based on the platforms they submitted. Public proof is required before payout credit is counted.',
  'This is full promo work: sharing approved content, supporting engagement, and helping creators grow reach across multiple networks.',
];

const cautionLines = [
  'Pay structure: up to $75/day based on approved activity, with PayPal payouts only. Crypto options may come later.',
  'Consistent contributors may qualify for $150–$250/week depending on approved activity, completed proof, and available tasks.',
  'Referral option: earn $5 when someone you recruit reaches $50 in approved earnings, and it can repeat when they hit that milestone again.',
  'No guaranteed income is promised. Payouts depend on approved tasks, valid proof, platform availability, and following the rules.',
];

const ctas = [
  'Ready to join the team? Start your application here: https://discord.gg/cxMvYdm4a2',
  'Apply by joining the server and submitting your social platform links for review: https://discord.gg/cxMvYdm4a2',
  'Start by joining and submitting the platforms you can work on: https://discord.gg/cxMvYdm4a2',
  'Interested? Join the onboarding server and apply with your social links: https://discord.gg/cxMvYdm4a2',
];

function pick(pool, index, offset = 0) {
  return pool[(index + offset) % pool.length];
}

function subredditTone(subreddit) {
  if (/PH|Philippines/i.test(subreddit)) return 'Philippines-friendly remote applicants are welcome.';
  if (/Japan/i.test(subreddit)) return 'Applicants who understand Japan-focused remote-job posting expectations are welcome.';
  if (/Germany/i.test(subreddit)) return 'Germany/EU-friendly remote applicants are welcome.';
  if (/India/i.test(subreddit)) return 'India-friendly remote applicants are welcome.';
  if (/pakistan/i.test(subreddit)) return 'Pakistan-friendly remote applicants are welcome.';
  if (/forhire|freelance/i.test(subreddit)) return 'Freelancers and independent contractors are welcome.';
  if (/side|WFH|Remote/i.test(subreddit)) return 'This is flexible remote side-work, not a fixed full-time job.';
  return 'Remote applicants are welcome.';
}

export function longRecruitmentBody(index = 0) {
  const variants = [
    `🚨🔥 **WE’RE HIRING — SOCIAL MEDIA PROMO WORKERS** 🔥🚨

## 💰 **Earn Up To $75 DAILY Just By Boosting Content Online**

### 📲 Work From ANY Device • 💵 **PayPal Payouts Only** • ⚡ Start TODAY

If you’re already on social media… **STOP scrolling and start getting PAID for it.**

We’re building a **high-energy promo team** across:

**Facebook • Threads • Bluesky • Reddit • Twitter/X • LinkedIn • & MORE**

This is NOT just “posting links.” This is **full promo engagement** — boosting creators, pushing content, and driving visibility across multiple platforms.

## 💥 **WHAT YOU DO:**

✔️ Share approved promo posts  
✔️ Like + comment + repost  
✔️ Boost engagement  
✔️ Help creators grow  
✔️ Complete simple daily promo tasks

If you can copy/paste, stay active online, and follow instructions, you can earn.

## 💰 **PAY STRUCTURE**

**Up to $75/day**  
**$150–$250/week** for consistent contributors

**PayPal payouts only**  
Crypto payouts coming soon.

### ⚡ **BONUS:**

**The MORE platforms you work on… the MORE opportunities you can get.**  
Multi-platform workers get access to more tasks.

## 🔥 **UNLIMITED PASSIVE INCOME**

Earn **$5 every time someone you recruit hits $50** — and it repeats **every time they hit $50 again.**

No limits. No cap. No ceiling.

## 🚀 **READY TO RUN IT UP?**

Join the server & start earning TODAY: 👉 https://discord.gg/cxMvYdm4a2`,

    `🚨 **WE’RE HIRING — SOCIAL MEDIA PROMO AMBASSADORS**

## 💰 **Earn Up To $75 DAILY Promoting Content Across Major Platforms**

### 📲 Work From Any Device • 🔗 Simple Promo Tasks • 💵 **PAYPAL PAYOUTS ONLY**

If you’re active on social media, you can start earning by helping boost visibility for creators, brands, and communities across:

**Facebook • Threads • Bluesky • Reddit • Twitter/X • LinkedIn • Stocktwits • & MORE**

This is **full promo work**, not just dropping links. You’ll help push content, increase reach, and keep engagement moving across multiple platforms.

## **YOU’LL GET PAID TO:**

✔️ Share approved promo posts  
✔️ Boost engagement with likes, comments, and reposts  
✔️ Help creators grow visibility  
✔️ Participate in daily promo tasks  
✔️ Support community growth across multiple networks

If you can stay active online and follow simple instructions, you can earn.

## 💰 **PAY STRUCTURE**

**Part-Time:** Up to **$75/day**  
**Consistent Workers:** **$150–$250/week**

**Payouts:** PayPal only  
Crypto payout options are coming soon.

## ⭐ **BONUS**

The more platforms you choose to work on, the more opportunities you can qualify for. Multi-platform promo workers move the fastest.

## 🔥 **PASSIVE INCOME OPTION**

Earn **$5 every time someone you recruit reaches $50 earned** — and it repeats every time they hit $50 again.

## 🚀 **READY TO JOIN THE TEAM?**

Apply here: https://discord.gg/cxMvYdm4a2`,

    `📣 **WE’RE HIRING: SOCIAL MEDIA PROMOTION & ENGAGEMENT SPECIALISTS**

Our team is expanding, and we’re looking for motivated people who can support online visibility and engagement across major social platforms.

## 💰 **Earn Up To $75/Day With Approved Promo Tasks**

Work from your phone or computer and complete structured daily promo work across:

**Facebook • Threads • Bluesky • Reddit • Twitter/X • LinkedIn • Stocktwits • and more**

## **ROLE OVERVIEW**

As a Social Media Promotion & Engagement Specialist, you’ll help increase reach and activity for approved content and partnered communities.

Tasks may include:

- Sharing approved promotional content
- Liking, commenting, and reposting
- Supporting visibility campaigns
- Completing daily engagement tasks
- Working across multiple platforms for more opportunities

## **COMPENSATION**

- Up to **$75/day** based on approved activity
- **$150–$250/week** for consistent contributors
- PayPal payouts only
- Crypto options coming soon

## **REFERRAL BONUS**

Earn **$5 every time someone you recruit reaches $50 in approved earnings**. This can repeat each time they hit that milestone again.

## **REQUIREMENTS**

- Phone or computer
- PayPal account
- Basic social media activity
- Ability to begin quickly

## **APPLY**

Join the onboarding server here: https://discord.gg/cxMvYdm4a2`,
  ];
  return variants[index % variants.length];
}

export function generateRecruitmentPost(subreddit, index = 0) {
  const cleanSubreddit = String(subreddit || '').replace(/^r\//i, '').trim();
  const title = pick(titleTemplates, index);
  const body = `${longRecruitmentBody(index)}

---

Note: Please follow all subreddit rules. Only apply if you can provide real social profile links and complete approved tasks properly.`;

  return {
    subreddit: cleanSubreddit,
    title,
    body,
    rulesUrl: `https://www.reddit.com/r/${encodeURIComponent(cleanSubreddit)}/about/rules/`,
    composerUrl: `https://www.reddit.com/r/${encodeURIComponent(cleanSubreddit)}/submit?selftext=true&title=${encodeURIComponent(title)}&text=${encodeURIComponent(body)}`,
    complianceNotes: [
      'Review the subreddit rules before posting.',
      'Use only if hiring/freelance/side-gig posts are allowed in that subreddit.',
      'Do not promise guaranteed income.',
      'Keep Discord invite/link placement compliant with subreddit rules.',
      'Vary wording across posts; do not repost identical copy.',
    ],
  };
}

export function recruitmentComposerButtonUrl(subreddit, index = 0) {
  const cleanSubreddit = String(subreddit || '').replace(/^r\//i, '').trim();
  const shortTitles = [
    "We're Hiring: Social Promo Ambassadors",
    'Hiring Social Media Promo Workers',
    'Paid Social Promo Tasks: Apply Today',
    'Remote Social Engagement Work',
    'Social Media Promo Workers Needed',
  ];
  const body = [
    'Hiring social promo workers.',
    'Earn up to $75/day.',
    'PayPal only.',
    'FB, Threads, Bluesky, Reddit, X, LinkedIn & more.',
    'Share posts, like, comment, repost.',
    'More platforms = more chances.',
    'Referral: $5 at $50.',
    'Apply: https://discord.gg/cxMvYdm4a2',
  ].join(' ');
  return `https://www.reddit.com/r/${encodeURIComponent(cleanSubreddit)}/submit?selftext=true&title=${encodeURIComponent(pick(shortTitles, index))}&text=${encodeURIComponent(body)}`;
}

export function recruitmentComposerTitleOnlyUrl(subreddit, index = 0) {
  const cleanSubreddit = String(subreddit || '').replace(/^r\//i, '').trim();
  const post = generateRecruitmentPost(cleanSubreddit, index);
  const pastePrompt = 'PASTE THE BODY/DESCRIPTION YOU COPIED FROM DISCORD HERE BEFORE POSTING.';
  return `https://www.reddit.com/r/${encodeURIComponent(cleanSubreddit)}/submit?selftext=true&title=${encodeURIComponent(post.title)}&text=${encodeURIComponent(pastePrompt)}`;
}

export function generateRecruitmentPack(subreddits = approvedRecruitmentSubreddits) {
  const unique = [...new Set(subreddits.map((name) => String(name || '').replace(/^r\//i, '').trim()).filter(Boolean))];
  return unique.map((subreddit, index) => generateRecruitmentPost(subreddit, index));
}
