/* Social ambassador applications, the PayPal info channel and the join welcome.
   Reviews are stored on the persistent disk, so a restart never strands an applicant: on startup every pending review is re-armed (or run at once if it is overdue). */
import { appendRecord, paths, readSettings } from '../../utils/storage.js';
import { receiverStoreStatus, saveReceiver } from '../../utils/payoutReceivers.js';
import { addPendingReview, listPendingReviews, removePendingReview, bumpReviewAttempt } from './pendingReviews.js';

const socialApplicationPlatforms = {
  reddit: { label: 'Reddit', hosts: ['reddit.com', 'www.reddit.com', 'old.reddit.com', 'redd.it'] },
  bluesky: { label: 'Bluesky', hosts: ['bsky.app', 'bsky.social'] },
  threads: { label: 'Threads', hosts: ['threads.net', 'www.threads.net', 'threads.com', 'www.threads.com'] },
  facebook: { label: 'Facebook', hosts: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.com'] },
  x: { label: 'X / Twitter', hosts: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'] },
  linkedin: { label: 'LinkedIn', hosts: ['linkedin.com', 'www.linkedin.com'] },
  stocktwits: { label: 'Stocktwits', hosts: ['stocktwits.com', 'www.stocktwits.com'] },
};

const ambassadorEligibilityRules = {
  reddit: {
    minAccountAgeDays: 90,
    minKarma: 1000,
  },
  bluesky: {
    minAccountAgeDays: 30,
    minPosts: 10,
  },
  facebook: {
    connectedOnly: true,
  },
};

function eligibilityRulesFromConfig(config = {}) {
  return {
    reddit: {
      ...ambassadorEligibilityRules.reddit,
      ...(config.eligibilityRequirements?.reddit || {}),
    },
    bluesky: {
      ...ambassadorEligibilityRules.bluesky,
      ...(config.eligibilityRequirements?.bluesky || {}),
    },
    facebook: {
      ...ambassadorEligibilityRules.facebook,
      ...(config.eligibilityRequirements?.facebook || {}),
    },
  };
}

function cleanSocialApplicationUrl(value) {
  return String(value || '').replace(/[),.;!?\]]+$/g, '');
}

function platformForSocialApplicationUrl(rawUrl) {
  try {
    const url = new URL(cleanSocialApplicationUrl(rawUrl));
    const host = url.hostname.toLowerCase();
    for (const [platform, info] of Object.entries(socialApplicationPlatforms)) {
      if (info.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) return platform;
    }
  } catch {
    return '';
  }
  return '';
}

export function extractSocialApplicationLinks(content) {
  const rawUrls = String(content || '').match(/https?:\/\/[^\s<>()]+/gi) || [];
  const seen = new Set();
  const links = [];
  for (const rawUrl of rawUrls) {
    const url = cleanSocialApplicationUrl(rawUrl);
    const platform = platformForSocialApplicationUrl(url);
    if (!platform) continue;
    const key = `${platform}:${url.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ platform, url });
  }
  return links;
}

function daysSince(date) {
  const timestamp = date instanceof Date ? date.getTime() : Number(date);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
}

function parseRedditUsername(rawUrl) {
  try {
    const url = new URL(cleanSocialApplicationUrl(rawUrl));
    const parts = url.pathname.split('/').filter(Boolean);
    const userIndex = parts.findIndex((part) => ['user', 'u'].includes(part.toLowerCase()));
    if (userIndex >= 0 && parts[userIndex + 1]) return decodeURIComponent(parts[userIndex + 1]).replace(/^@/, '');
  } catch {}
  return '';
}

function parseBlueskyActor(rawUrl) {
  try {
    const url = new URL(cleanSocialApplicationUrl(rawUrl));
    const parts = url.pathname.split('/').filter(Boolean);
    const profileIndex = parts.findIndex((part) => part.toLowerCase() === 'profile');
    if (profileIndex >= 0 && parts[profileIndex + 1]) return decodeURIComponent(parts[profileIndex + 1]).replace(/^@/, '');
    if (url.hostname.toLowerCase() === 'bsky.social' && parts[0]) return decodeURIComponent(parts[0]).replace(/^@/, '');
  } catch {}
  return '';
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'DailySocialPayoutsEligibilityBot/1.0',
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkRedditEligibility(link, rules = ambassadorEligibilityRules) {
  const username = parseRedditUsername(link.url);
  const rule = rules.reddit || ambassadorEligibilityRules.reddit;
  if (!username) {
    return {
      platform: 'reddit',
      label: 'Reddit',
      eligible: false,
      summary: 'Reddit link must be a profile link like https://www.reddit.com/user/username/',
    };
  }
  try {
    const result = await fetchJsonWithTimeout(`https://www.reddit.com/user/${encodeURIComponent(username)}/about.json?raw_json=1`);
    const data = result.data?.data || {};
    if (!result.ok || !data.created_utc) {
      return {
        platform: 'reddit',
        label: 'Reddit',
        eligible: false,
        summary: `Could not verify Reddit profile u/${username}. Make sure the profile is public and the link is correct.`,
      };
    }
    const ageDays = daysSince(Number(data.created_utc) * 1000);
    const karma = Number(data.total_karma ?? ((Number(data.link_karma) || 0) + (Number(data.comment_karma) || 0))) || 0;
    const eligible = ageDays >= rule.minAccountAgeDays && karma >= rule.minKarma;
    return {
      platform: 'reddit',
      label: 'Reddit',
      eligible,
      summary: eligible
        ? `Reddit u/${username} passed: ${ageDays} days old, ${karma.toLocaleString()} karma.`
        : `Reddit u/${username} needs ${rule.minAccountAgeDays}+ days and ${rule.minKarma.toLocaleString()}+ karma. Current check: ${ageDays} days old, ${karma.toLocaleString()} karma.`,
      details: { username, ageDays, karma },
    };
  } catch (error) {
    return {
      platform: 'reddit',
      label: 'Reddit',
      eligible: false,
      summary: `Reddit verification failed for u/${username}: ${error.message || error}`,
    };
  }
}

async function checkBlueskyEligibility(link, rules = ambassadorEligibilityRules) {
  const actor = parseBlueskyActor(link.url);
  const rule = rules.bluesky || ambassadorEligibilityRules.bluesky;
  if (!actor) {
    return {
      platform: 'bluesky',
      label: 'Bluesky',
      eligible: false,
      summary: 'Bluesky link must be a profile link like https://bsky.app/profile/handle.bsky.social',
    };
  }
  try {
    const result = await fetchJsonWithTimeout(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`);
    const profile = result.data || {};
    if (!result.ok || !profile.did) {
      return {
        platform: 'bluesky',
        label: 'Bluesky',
        eligible: false,
        summary: `Could not verify Bluesky profile ${actor}. Make sure the profile is public and the link is correct.`,
      };
    }
    const createdAt = profile.createdAt ? Date.parse(profile.createdAt) : NaN;
    const ageDays = Number.isFinite(createdAt) ? daysSince(createdAt) : 0;
    const posts = Number(profile.postsCount) || 0;
    const eligible = ageDays >= rule.minAccountAgeDays && posts >= rule.minPosts;
    const handle = profile.handle || actor;
    return {
      platform: 'bluesky',
      label: 'Bluesky',
      eligible,
      summary: eligible
        ? `Bluesky @${handle} passed: ${ageDays} days old, ${posts.toLocaleString()} posts.`
        : `Bluesky @${handle} needs ${rule.minAccountAgeDays}+ days and ${rule.minPosts}+ posts. Current check: ${ageDays} days old, ${posts.toLocaleString()} posts.`,
      details: { handle, ageDays, posts },
    };
  } catch (error) {
    return {
      platform: 'bluesky',
      label: 'Bluesky',
      eligible: false,
      summary: `Bluesky verification failed for ${actor}: ${error.message || error}`,
    };
  }
}

export async function evaluateAmbassadorEligibility(links, config = {}) {
  const rules = eligibilityRulesFromConfig(config);
  const checks = [];
  const seenPlatforms = new Set();
  for (const link of links) {
    if (seenPlatforms.has(link.platform)) continue;
    seenPlatforms.add(link.platform);
    if (link.platform === 'reddit') checks.push(await checkRedditEligibility(link, rules));
    else if (link.platform === 'bluesky') checks.push(await checkBlueskyEligibility(link, rules));
    else if (link.platform === 'facebook') checks.push({
      platform: 'facebook',
      label: 'Facebook',
      eligible: true,
      summary: 'Facebook passed: account link connected. No extra age or post requirement.',
    });
    else checks.push({
      platform: link.platform,
      label: socialApplicationPlatforms[link.platform]?.label || link.platform,
      eligible: true,
      summary: `${socialApplicationPlatforms[link.platform]?.label || link.platform} connected. Manual quality review may still apply.`,
    });
  }
  const eligibleChecks = checks.filter((check) => check.eligible);
  return {
    approved: eligibleChecks.length > 0,
    checks,
    eligiblePlatforms: eligibleChecks.map((check) => check.label),
  };
}

async function recordAmbassadorEligibilityAudit({ review, eligibility }) {
  const record = {
    at: new Date().toISOString(),
    guildId: review.guildId,
    channelId: review.channelId,
    messageId: review.messageId,
    userId: review.userId,
    username: review.username,
    approved: eligibility.approved,
    eligiblePlatforms: eligibility.eligiblePlatforms,
    checks: eligibility.checks,
  };
  await appendRecord(paths.ambassadorEligibility, record).catch((error) => {
    console.error('Ambassador eligibility audit write failed safely:', error.message || error);
  });
}

function applicationDisplayName(message) {
  return String(message.member?.displayName || message.author?.username || 'applicant')
    .replace(/[^\w .#-]/g, '')
    .trim()
    .slice(0, 64) || 'applicant';
}

async function sendTemporaryApplicationNotice(message, content) {
  const notice = await message.channel.send({
    content,
    allowedMentions: { users: [message.author.id] },
  }).catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => {}), 25000);
}

export function extractPaypalEmail(content) {
  return String(content || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || '';
}

async function recordPaypalSubmission({ message, email, settings }) {
  // The durable copy is the encrypted receiver store (the same one /paypal set uses): never a plaintext file on disk.
  if (receiverStoreStatus().enabled) {
    await saveReceiver({ userId: message.author.id, userName: message.author.username, email }).catch((error) => {
      console.error('PayPal info could not be saved to the encrypted receiver store:', error.message || error);
    });
  } else {
    console.error('PAYOUT_DETAILS_KEY is not set, so a PayPal email from the PayPal info channel was only shown to admins and NOT stored.');
  }

  const adminLogChannelId = settings.socialApplications?.paypalAdminLogChannelId || '';
  if (!adminLogChannelId) return;
  const adminLog = await message.client.channels.fetch(adminLogChannelId).catch(() => null);
  if (!adminLog?.isTextBased()) return;
  await adminLog.send({
    content: [
      '# 💸 PayPal payout info submitted',
      `User: <@${message.author.id}>`,
      `Discord ID: \`${message.author.id}\``,
      `Discord tag: \`${message.author.tag}\``,
      `Display name: \`${message.member?.displayName || 'unknown'}\``,
      `PayPal email: \`${email}\``,
      `Submitted: <t:${Math.floor(Date.now() / 1000)}:f>`,
    ].join('\n'),
    allowedMentions: { users: [message.author.id] },
  }).catch((error) => console.error('PayPal admin log failed safely:', error.message || error));
}

export async function handlePaypalInfoMessage(message, settings) {
  const config = settings.socialApplications || {};
  if (!config.enabled || !config.paypalInfoChannelId || message.channelId !== config.paypalInfoChannelId) return false;
  if (!message.guild || message.author?.bot || message.channel?.isThread?.()) return false;
  if (config.guildId && message.guildId !== config.guildId) return false;

  const email = extractPaypalEmail(message.content);
  await message.delete().catch(() => {});

  if (!email) {
    await message.author.send([
      `Your message in <#${config.paypalInfoChannelId}> was removed because that channel only accepts PayPal payout emails.`,
      '',
      'Please post the PayPal email address you want on file for Daily Social Payouts.',
      config.helpChannelId ? `If you need help, use <#${config.helpChannelId}>.` : '',
    ].filter(Boolean).join('\n')).catch(() => sendTemporaryApplicationNotice(
      message,
      `<@${message.author.id}> PayPal info must be a valid PayPal email address. Please repost only your PayPal email.`,
    ));
    return true;
  }

  await recordPaypalSubmission({ message, email, settings });
  const payoutReadyRoleId = config.payoutReadyRoleId || '';
  if (payoutReadyRoleId) {
    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    const grantResult = member
      ? await member.roles.add(payoutReadyRoleId, 'Daily Social Payouts PayPal info submitted').then(() => ({ ok: true })).catch((error) => ({ error }))
      : { error: new Error('Member not found') };
    if (grantResult?.error) console.error(`Daily Social payout-ready role grant failed safely for ${message.author.id}:`, grantResult.error.message || grantResult.error);
  }
  await message.author.send([
    '# ✅ PayPal info received',
    `Your PayPal payout email has been placed on file for Daily Social Payouts: \`${email}\``,
    '',
    'For privacy, your public message was removed immediately. Only admins can see the saved payout info.',
    '',
    'Your next channels should now unlock so you can continue through Start Here, rules/payout policy, and the Daily Work area.',
  ].join('\n')).catch(() => sendTemporaryApplicationNotice(
    message,
    `<@${message.author.id}> PayPal info received and removed from public view. Admins have it on file.`,
  ));
  return true;
}

const armedReviews = new Map();

/* Saves the review to disk, then arms the timer. The stored record is everything the review needs, so it can run after a restart. */
async function scheduleApplicationReview({ message, thread, config, links }) {
  const delayMinutes = Number(config.autoReviewMinutes || 10);
  const review = {
    id: `${message.id}`,
    threadId: thread.id,
    channelId: message.channelId,
    messageId: message.id,
    guildId: message.guildId,
    userId: message.author.id,
    username: message.author.tag || message.author.username || '',
    links,
    dueAt: Date.now() + Math.max(1, delayMinutes) * 60 * 1000,
    attempts: 0,
  };
  await addPendingReview(review).catch((error) => console.error('Could not save the pending application review; it will only run until the next restart:', error.message || error));
  armReview(message.client, review);
}

function armReview(client, review) {
  if (armedReviews.has(review.id)) return;
  const wait = Math.max(0, Number(review.dueAt) - Date.now());
  const timer = setTimeout(() => {
    armedReviews.delete(review.id);
    runApplicationReview(client, review).catch((error) => console.error('Application review failed safely:', error.message || error));
  }, wait);
  timer.unref?.();
  armedReviews.set(review.id, timer);
}

/* Called once the client is ready: re-arms every review that was waiting when the bot last stopped. */
export async function resumePendingApplicationReviews(client) {
  const pending = await listPendingReviews().catch(() => []);
  for (const review of pending) armReview(client, review);
  return pending.length;
}

export function cancelApplicationReviewTimers() {
  for (const timer of armedReviews.values()) clearTimeout(timer);
  armedReviews.clear();
}

async function runApplicationReview(client, review) {
  const settings = await readSettings().catch(() => ({}));
  const config = settings.socialApplications || {};
  const attempt = await bumpReviewAttempt(review.id).catch(() => review.attempts + 1);
  const links = review.links || [];
  const thread = await client.channels.fetch(review.threadId).catch(() => null);
  const user = await client.users.fetch(review.userId).catch(() => null);
  const guild = await client.guilds.fetch(review.guildId).catch(() => null);
  const paypalInfoText = config.paypalInfoChannelId ? `<#${config.paypalInfoChannelId}>` : 'the PayPal Info channel';
  const helpText = config.helpChannelId ? `<#${config.helpChannelId}>` : 'the help channel';
  const platformList = [...new Set(links.map((link) => socialApplicationPlatforms[link.platform]?.label || link.platform))].join(', ');
  const eligibility = await evaluateAmbassadorEligibility(links, config);
  await recordAmbassadorEligibilityAudit({ review, eligibility });
  const eligibilityLines = eligibility.checks.length
    ? eligibility.checks.map((check) => `${check.eligible ? '✅' : '❌'} **${check.label}:** ${check.summary}`)
    : ['❌ No supported social accounts were submitted.'];
  const say = (content) => thread?.send?.({ content, allowedMentions: { users: [review.userId] } }).catch((error) => console.error('Application review message failed safely:', error.message || error));
  const dm = (content) => user?.send?.(content.replace(`<@${review.userId}>`, 'Your')).catch((error) => console.error('Application review DM failed safely:', error.message || error));

  if (!eligibility.approved) {
    const notAcceptedNotice = [
      '# ❌ Application not accepted yet',
      `<@${review.userId}> your Daily Social Payouts application reached the **10-minute review mark**, but none of the submitted accounts currently meet the Ambassador requirements.`,
      '',
      `Platforms submitted: **${platformList || 'none'}**`,
      '',
      '## Eligibility check',
      ...eligibilityLines,
      '',
      '## Requirements',
      '• Reddit: **90+ days old** and **1,000+ karma**',
      '• Facebook: connected account, no extra requirement',
      '• Bluesky: **30+ days old** and **10+ posts**',
      '',
      `Next step: add another eligible social profile link in this thread, or use ${helpText} if you need help.`,
    ].join('\n');
    await say(notAcceptedNotice);
    await dm(notAcceptedNotice);
    await removePendingReview(review.id).catch(() => {});
    return;
  }

  let roleLine = '';
  const acceptedRoleId = config.acceptedRoleId || '';
  if (acceptedRoleId && guild) {
    const member = await guild.members.fetch(review.userId).catch(() => null);
    if (member) {
      const roleResult = await member.roles.add(acceptedRoleId, 'Daily Social Payouts application accepted').then(() => ({ ok: true })).catch((error) => ({ error }));
      roleLine = roleResult?.ok
        ? `\nRole granted: <@&${acceptedRoleId}>`
        : `\nRole grant needs admin check: I could not add <@&${acceptedRoleId}>.`;
      if (roleResult?.error) console.error(`Daily Social accepted role grant failed safely for ${review.userId}:`, roleResult.error.message || roleResult.error);
    }
  }
  const acceptedNotice = [
    '# ✅ Application accepted',
    `<@${review.userId}> your Daily Social Payouts application reached the **10-minute review mark** and is accepted for onboarding with the eligible platforms submitted so far.`,
    '',
    `Platforms on file: **${platformList || 'none'}**`,
    `Eligible platforms: **${eligibility.eligiblePlatforms.join(', ')}**`,
    '',
    '## Eligibility check',
    ...eligibilityLines,
    roleLine,
    '',
    `Next step: go to ${paypalInfoText} and submit your PayPal email so admins can put your payout account on file. You must have PayPal info on file before you can be paid and before the work channels unlock.`,
    '',
    `Need help? Use ${helpText}.`,
  ].join('\n');
  await say(acceptedNotice);
  await dm(acceptedNotice);
  await removePendingReview(review.id).catch(() => {});
  if (attempt > 3) console.warn(`Application review ${review.id} needed ${attempt} attempts.`);
}

export async function handleSocialApplicationMessage(message, settings) {
  const config = settings.socialApplications || {};
  if (!config.enabled || !config.channelId || message.channelId !== config.channelId) return false;
  if (!message.guild || message.author?.bot || message.channel?.isThread?.()) return false;
  if (config.guildId && message.guildId !== config.guildId) return false;

  const helpChannelId = config.helpChannelId || '';
  const helpText = helpChannelId ? `<#${helpChannelId}>` : 'the help channel';
  const links = extractSocialApplicationLinks(message.content);
  if (!links.length) {
    const dmText = [
      `Your message in <#${config.channelId}> was removed because that channel is for application links only.`,
      '',
      'Post your social accounts there as links only: Reddit, Bluesky, Threads, Facebook, X / Twitter, LinkedIn, and Stocktwits.',
      `If you have questions or need help, use ${helpText}.`,
    ].join('\n');
    await message.author.send(dmText).catch(() => sendTemporaryApplicationNotice(
      message,
      `<@${message.author.id}> this channel is for application links only. Please ask questions or get help in ${helpText}.`,
    ));
    await message.delete().catch(() => {});
    return true;
  }

  const platformCounts = links.reduce((counts, link) => {
    counts[link.platform] = (counts[link.platform] || 0) + 1;
    return counts;
  }, {});
  const detectedPlatforms = Object.keys(platformCounts)
    .map((platform) => socialApplicationPlatforms[platform]?.label || platform)
    .join(', ');
  const missingPlatforms = Object.entries(socialApplicationPlatforms)
    .filter(([platform]) => !platformCounts[platform])
    .map(([, info]) => info.label);

  const threadName = `Application - ${applicationDisplayName(message)}`.slice(0, 90);
  const autoArchiveDuration = Number(config.autoArchiveMinutes || 1440);
  const thread = await message.startThread({
    name: threadName,
    autoArchiveDuration,
    reason: 'Daily Social Payouts social application thread',
  }).catch(async (error) => {
    console.error('Could not create social application thread:', error.message || error);
    await message.reply(`I saved your application post, but I could not create the thread. A mod should check my thread permissions for this channel.`).catch(() => {});
    return null;
  });

  if (thread) {
    const linkLines = links.map((link) => `✅ **${socialApplicationPlatforms[link.platform]?.label || link.platform}:** ${link.url}`);
    const missingLine = missingPlatforms.length
      ? `\n\n**More platforms = more payout chances.** If you have them, add these next in this thread: ${missingPlatforms.join(', ')}.`
      : '\n\n✅ You submitted every supported platform type.';
    await thread.send({
      content: [
        `# Daily Social Payouts Application`,
        `<@${message.author.id}> this thread is your application file. Keep all of your social-account links here so the team can review everything in one place.`,
        '',
        `⏱️ **10-minute review clock started.** Your application will be reviewed at the 10-minute mark, so add every accepted platform link you have before time runs out.`,
        '',
        `## Ambassador eligibility requirements`,
        `✅ **Reddit:** account must be **90+ days old** and have **1,000+ karma**.`,
        `✅ **Facebook:** connected account only. No extra age or post requirement.`,
        `✅ **Bluesky:** account must be **30+ days old** and already have **10+ posts**.`,
        '',
        `The bot will check Reddit and Bluesky automatically at the review mark. Facebook counts as eligible once a valid Facebook profile/page link is submitted.`,
        '',
        `**Detected platforms:** ${detectedPlatforms}`,
        '',
        ...linkLines,
        missingLine,
        '',
        `Questions do **not** go in the application channel. If you need help, use ${helpText}.`,
      ].join('\n'),
      allowedMentions: { users: [message.author.id] },
    }).catch(() => {});
    await scheduleApplicationReview({ message, thread, config, links });
  }

  await message.react('✅').catch(() => {});
  return true;
}

function buildDailySocialWelcomeMessage(member, config) {
  const applicationChannelId = config.channelId || '';
  const helpChannelId = config.helpChannelId || '';
  const acceptedPlatforms = (config.requiredPlatforms || Object.keys(socialApplicationPlatforms))
    .map((platform) => socialApplicationPlatforms[platform]?.label || platform)
    .join(', ');
  const applicationText = applicationChannelId ? `<#${applicationChannelId}>` : 'the application channel';
  const helpText = helpChannelId ? `<#${helpChannelId}>` : 'the help channel';

  return [
    `# 💸 Welcome to Daily Social Payouts`,
    `<@${member.id}> welcome in. This server is where users can get paid to promote approved posts and campaigns across their social platforms.`,
    '',
    `## Start here`,
    `Submit your application in ${applicationText} by posting links to the social media accounts you have.`,
    '',
    `## Ambassador role requirements`,
    `• **Reddit:** 90+ days old and 1,000+ karma`,
    `• **Facebook:** connected account, no extra requirement`,
    `• **Bluesky:** 30+ days old and 10+ posts`,
    '',
    `**Accepted platforms only:** ${acceptedPlatforms}.`,
    '',
    `The more accepted platforms you submit, the better your chance of getting hired and the more payout opportunities you can qualify for.`,
    '',
    `Keep the application channel clean: **links only**. If you have questions, need help, or are not sure what to post, go to ${helpText}.`,
  ].join('\n');
}

export async function sendDailySocialWelcome(member, settings) {
  const config = settings.socialApplications || {};
  if (config.sendJoinWelcome === false) return;
  if (!config.enabled || !config.welcomeChannelId) return;
  if (config.guildId && member.guild.id !== config.guildId) return;
  const channel = await member.client.channels.fetch(config.welcomeChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.guildId !== member.guild.id) return;
  await channel.send({
    content: buildDailySocialWelcomeMessage(member, config),
    allowedMentions: { users: [member.id] },
  });
}
