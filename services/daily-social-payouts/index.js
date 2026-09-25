import 'dotenv/config';
import { appendFile } from 'node:fs/promises';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, Collection, EmbedBuilder, GatewayIntentBits, MessageType, ModalBuilder, Partials, PermissionFlagsBits, TextInputBuilder, TextInputStyle } from 'discord.js';
import * as share from './commands/share.js';
import * as news from './commands/news.js';
import * as leaderboard from './commands/leaderboard.js';
import * as boost from './commands/boost.js';
import * as tracking from './commands/tracking.js';
import * as shareSetup from './commands/shareSetup.js';
import { commentIdeaComponents, outboundLinkComponent } from './utils/discordPresentation.js';
import { linkWorkflowForReturn, linkWorkflowForShareChannel, linkWorkflowsFromSettings, processLinkWorkflow } from './utils/linkWorkflow.js';
import { buildShareUrls } from './utils/shareUrls.js';
import { packagedFacebookCaption } from './utils/facebookCopy.js';
import { stocktwitsPackages } from './utils/stocktwitsCopy.js';
import { blueskyIntentUrl, blueskyPackage, blueskyResharePackage } from './utils/blueskyCopy.js';
import { postById, postByMessage, recentUnreturnedOutboundIntent, recordEngagement, recordOutboundIntent } from './utils/tracking.js';
import { isShareButton, parseShareButton } from './utils/trackedRedirect.js';
import { detectExternalPostPlatform, validateExternalPostUrl } from './utils/externalPosts.js';
import { readSettings } from './utils/storage.js';
import { selectSubreddit } from './utils/redditRouting.js';
import { platformLabels, publishExternalPostSubmission } from './utils/externalPostWorkflow.js';
import { generateSocialCopy, socialShareUrl } from './utils/socialCopy.js';
import { backfillAlertHistory, processAlertMessage } from './utils/alertMonitor.js';
import { startArticleAutomation } from './utils/articleAutomation.js';
import { reportWorkEvent } from './utils/workReport.js';
import { XP } from './utils/xp.js';
import { createProof, proofContextFromMessage, reviewProof, sendProofForReview, validateProofUrl } from './utils/engagementProofs.js';
import { enforceConfiguredUserBlocks, enforceDiscordSafetyMemberBan, enforceDiscordSafetyMessageBan, enforceMemberSecurity, ensureMemberSecurityGrandfatherSnapshot, memberSecurityReadiness, moderateBlockedInviteMessage, sendNewMemberWarning } from './utils/memberSecurity.js';
import * as linkSml from './commands/linkSml.js';
import * as syncSml from './commands/syncSml.js';
import * as connectSmlGroup from './commands/connectSmlGroup.js';
import * as connectDashboard from './commands/connectDashboard.js';
import * as syncSmlChannels from './commands/syncSmlChannels.js';
import { sendOnboarding } from './utils/onboarding.js';
import { dynamicRoleSyncGuildIds, isRoleSyncGuild, memberRoleIdsChanged, pushGuildCatalog, refreshDynamicRoleSyncGuilds, revokeMemberRoles, roleSyncEnabled, roleSyncGuildIds, syncMemberRoles } from './utils/siteRoleSync.js';
import { recordPremiumVerificationDm } from './utils/premiumVerification.js';
import { mirrorAlertToDiscord } from './utils/discordAlertMirror.js';
import { forwardAlertToTelegram } from './utils/telegramForwarder.js';
import { startSmlNewsTelegramForwarder } from './utils/smlNewsTelegramForwarder.js';
import { logMemberLeft, logMembershipRoleChanges, logNewMember } from './utils/membershipLifecycle.js';
import { startMembershipAuditPoller } from './utils/membershipAuditPoller.js';
import { autoGrantMakingEasyMoneyAccess } from './utils/makingEasyMoneyRoleAutoGrant.js';
import { startMakingEasyMoneyRoleRepairPoller } from './utils/makingEasyMoneyRoleRepairPoller.js';
import { restoreProtectedBotMessageDelete, trackProtectedBotMessage } from './utils/botMessageDeleteGuard.js';
import { archiveProtectedChannelMessage, restoreChannelDeletedByTk, snapshotProtectedChannels } from './utils/channelDeleteGuard.js';
import { reportTkKick, reverseTkBan } from './utils/tkModerationLock.js';
import { recordApprovedProofPayout } from './utils/payoutLedger.js';
import { startDailyPayoutScheduler } from './utils/dailyPayoutCycle.js';
import { startArticleFeed } from './utils/articleFeed.js';
import { runAutoShareSetup } from './utils/autoShareSetup.js';
import { generateRecruitmentPost, recruitmentComposerTitleOnlyUrl } from './utils/recruitmentPosts.js';
import * as earnings from './commands/earnings.js';
import * as connectPayPal from './commands/connectPayPal.js';
import * as paypal from './commands/paypal.js';
import * as payoutAdmin from './commands/payoutAdmin.js';

const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
const dailySocialMode = process.env.BOT_RUNTIME_MODE === 'daily-social';

const clientIntents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
];
// Guild Members Intent is optional for website access. Linking a member through
// a slash command includes that member's current role IDs without requesting
// the privileged gateway intent. Set this only after Discord approves/enables it
// to also mirror future role changes and departures automatically.
if (process.env.SECURITY_GATE_MEMBERS_INTENT === '1' || process.env.SML_GUILD_MEMBERS_INTENT === '1') clientIntents.push(GatewayIntentBits.GuildMembers);

const client = new Client({
  intents: clientIntents,
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.commands = new Collection();
const dailySocialCommands = [share, news, leaderboard, boost, tracking, earnings, connectPayPal, paypal, payoutAdmin, shareSetup];
const legacyCommands = [...dailySocialCommands, linkSml, syncSml, connectSmlGroup, connectDashboard, syncSmlChannels];
for (const command of dailySocialMode ? dailySocialCommands : legacyCommands) client.commands.set(command.data.name, command);

const platformInfo = {
  reddit: { label: 'Reddit', placeholder: 'https://www.reddit.com/r/.../comments/...' },
  x: { label: 'X', placeholder: 'https://x.com/username/status/...' },
  stocktwits: { label: 'Stocktwits', placeholder: 'https://stocktwits.com/.../message/...' },
  bluesky: { label: 'Bluesky', placeholder: 'https://bsky.app/profile/.../post/...' },
  threads: { label: 'Threads', placeholder: 'https://www.threads.net/@user/post/...' },
  facebook: { label: 'Facebook', placeholder: 'https://www.facebook.com/...' },
  linkedin: { label: 'LinkedIn', placeholder: 'https://www.linkedin.com/in/username/' },
};

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

function extractSocialApplicationLinks(content) {
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

async function evaluateAmbassadorEligibility(links, config = {}) {
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

async function recordAmbassadorEligibilityAudit({ message, eligibility }) {
  const record = {
    at: new Date().toISOString(),
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    userId: message.author.id,
    username: message.author.tag,
    approved: eligibility.approved,
    eligiblePlatforms: eligibility.eligiblePlatforms,
    checks: eligibility.checks,
  };
  await appendFile('data/social-ambassador-eligibility.ndjson', `${JSON.stringify(record)}\n`).catch((error) => {
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

function extractPaypalEmail(content) {
  return String(content || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || '';
}

async function recordPaypalSubmission({ message, email, settings }) {
  const record = {
    at: new Date().toISOString(),
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    userId: message.author.id,
    username: message.author.tag,
    displayName: message.member?.displayName || '',
    paypalEmail: email,
  };
  await appendFile('data/paypal-info-submissions.ndjson', `${JSON.stringify(record)}\n`).catch((error) => {
    console.error('PayPal info local audit write failed safely:', error.message || error);
  });

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

async function handlePaypalInfoMessage(message, settings) {
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

function scheduleApplicationAutoReview(thread, message, config, links) {
  const delayMinutes = Number(config.autoReviewMinutes || 10);
  const delayMs = Math.max(1, delayMinutes) * 60 * 1000;
  setTimeout(async () => {
    const paypalInfoText = config.paypalInfoChannelId ? `<#${config.paypalInfoChannelId}>` : 'the PayPal Info channel';
    const helpText = config.helpChannelId ? `<#${config.helpChannelId}>` : 'the help channel';
    const platformList = [...new Set(links.map((link) => socialApplicationPlatforms[link.platform]?.label || link.platform))].join(', ');
    const eligibility = await evaluateAmbassadorEligibility(links, config);
    await recordAmbassadorEligibilityAudit({ message, eligibility });
    const eligibilityLines = eligibility.checks.length
      ? eligibility.checks.map((check) => `${check.eligible ? '✅' : '❌'} **${check.label}:** ${check.summary}`)
      : ['❌ No supported social accounts were submitted.'];

    if (!eligibility.approved) {
      const notAcceptedNotice = [
        '# ❌ Application not accepted yet',
        `<@${message.author.id}> your Daily Social Payouts application reached the **10-minute review mark**, but none of the submitted accounts currently meet the Ambassador requirements.`,
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
      await thread.send({
        content: notAcceptedNotice,
        allowedMentions: { users: [message.author.id] },
      }).catch((error) => console.error('Application not-accepted message failed safely:', error.message || error));
      await message.author.send(notAcceptedNotice.replace(`<@${message.author.id}>`, 'Your')).catch((error) => {
        console.error('Application not-accepted DM failed safely:', error.message || error);
      });
      return;
    }

    let roleLine = '';
    const acceptedRoleId = config.acceptedRoleId || '';
    if (acceptedRoleId && message.guild) {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (member) {
        const roleResult = await member.roles.add(acceptedRoleId, 'Daily Social Payouts application accepted').then(() => ({ ok: true })).catch((error) => ({ error }));
        roleLine = roleResult?.ok
          ? `\nRole granted: <@&${acceptedRoleId}>`
          : `\nRole grant needs admin check: I could not add <@&${acceptedRoleId}>.`;
        if (roleResult?.error) console.error(`Daily Social accepted role grant failed safely for ${message.author.id}:`, roleResult.error.message || roleResult.error);
      }
    }
    const acceptedNotice = [
      '# ✅ Application accepted',
      `<@${message.author.id}> your Daily Social Payouts application reached the **10-minute review mark** and is accepted for onboarding with the eligible platforms submitted so far.`,
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
    await thread.send({
      content: acceptedNotice,
      allowedMentions: { users: [message.author.id] },
    }).catch((error) => console.error('Application auto-review message failed safely:', error.message || error));
    await message.author.send(acceptedNotice.replace(`<@${message.author.id}>`, 'Your')).catch((error) => {
      console.error('Application accepted DM failed safely:', error.message || error);
    });
  }, delayMs);
}

async function handleSocialApplicationMessage(message, settings) {
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
    scheduleApplicationAutoReview(thread, message, config, links);
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

async function sendDailySocialWelcome(member, settings) {
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

const instantDeleteAuthorRules = [
  {
    guildId: '938894329076940820',
    userId: '892826929869254727',
    label: 'TK old Making Easy Money message block',
  },
];

const makingEasyMoneyRaidSpamGuard = {
  guildId: '938894329076940820',
  trustedLinkRoleId: '939031140679970867',
  genericLinkPattern: /(?:https?:\/\/|www\.|discord\.gg\/|t\.me\/|telegram\.me\/|tg:\/\/|bit\.ly\/)\S+/i,
  discordInvitePattern: /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[A-Za-z0-9-]+/i,
  telegramPattern: /\btelegram\b|(?:https?:\/\/)?(?:t\.me|telegram\.me)\/\S+|tg:\/\//i,
  alphaSignalsPattern: /(?:https?:\/\/)?(?:www\.)?(?:bit\.ly\/alphasignals|alphasignals)\b/i,
  massMentionLinkPattern: /@(?:everyone|here)[\s\S]{0,220}(?:https?:\/\/|discord\.gg|bit\.ly)\S*/i,
  promoPatterns: [
    /paid\s+over\s+\$?\s*3(?:\.|,)?1\s*m/i,
    /best\s+traders\s+in\s+the\s+world/i,
    /14\s*day\s+free\s+trial/i,
    /free\s+join\b[\s\S]{0,120}\bstart\s+winning/i,
    /give\s+us\s+a\s+try/i,
  ],
};

function hasMakingEasyMoneyTrustedLinkRole(message) {
  if (!message.guild || !message.member) return false;
  const thresholdRole = message.guild.roles.cache.get(makingEasyMoneyRaidSpamGuard.trustedLinkRoleId);
  if (!thresholdRole) return message.member.roles.cache.has(makingEasyMoneyRaidSpamGuard.trustedLinkRoleId);
  return message.member.roles.highest?.position >= thresholdRole.position;
}

function makingEasyMoneyRaidSpamReason(content, { trustedLinkPoster = false } = {}) {
  const text = String(content || '');
  if (makingEasyMoneyRaidSpamGuard.discordInvitePattern.test(text)) return 'discord invite link';
  if (makingEasyMoneyRaidSpamGuard.alphaSignalsPattern.test(text)) return 'AlphaSignals/bit.ly spam link';
  if (makingEasyMoneyRaidSpamGuard.massMentionLinkPattern.test(text)) return 'mass mention with external promo link';
  const promoMatches = makingEasyMoneyRaidSpamGuard.promoPatterns.filter((pattern) => pattern.test(text)).length;
  if (promoMatches >= 2) return 'matched raid promo text';
  if (!trustedLinkPoster && makingEasyMoneyRaidSpamGuard.telegramPattern.test(text)) return 'Telegram promo/link from untrusted member';
  if (!trustedLinkPoster && makingEasyMoneyRaidSpamGuard.genericLinkPattern.test(text)) return 'link from member below trusted role';
  return '';
}

function hasProtectedServerPrivilege(message) {
  if (!message.guild || !message.author) return false;
  if (message.guild.ownerId === message.author.id) return true;
  const permissions = message.member?.permissions;
  return Boolean(
    permissions?.has(PermissionFlagsBits.Administrator)
      || permissions?.has(PermissionFlagsBits.ManageGuild)
      || permissions?.has(PermissionFlagsBits.BanMembers)
  );
}

async function enforceMakingEasyMoneyRaidSpam(message) {
  if (message.guildId !== makingEasyMoneyRaidSpamGuard.guildId || !message.guild || message.author?.bot) return false;
  if (hasProtectedServerPrivilege(message)) return false;
  const trustedLinkPoster = hasMakingEasyMoneyTrustedLinkRole(message);
  const reason = makingEasyMoneyRaidSpamReason(message.content, { trustedLinkPoster });
  if (!reason) return false;
  await message.delete().catch((error) => console.error(`Making Easy Money raid-spam delete failed safely for ${message.id}:`, error.message || error));
  await message.guild.members.ban(message.author.id, {
    reason: `Making Easy Money instant raid-spam guard: ${reason}`,
  }).catch((error) => console.error(`Making Easy Money raid-spam ban failed safely for ${message.author.id}:`, error.message || error));
  console.log(`Making Easy Money raid-spam guard removed ${message.author.tag || message.author.id} (${message.author.id}) for ${reason}.`);
  return true;
}

client.once('clientReady', async () => {
  if (dailySocialMode) {
    await runAutoShareSetup(client).catch((error) => console.warn(`Share auto-setup failed safely: ${error.message || error}`));
    startDailyPayoutScheduler(client);
    console.log('Daily payout scheduler started (holds, payable notifications, and the gated payment step).');
    startArticleFeed(client);
    console.log('Article feed watcher started (new site articles become share packages automatically).');
  }
  const dynamicGuilds = !dailySocialMode && roleSyncEnabled()
    ? await refreshDynamicRoleSyncGuilds().catch((error) => {
      console.warn(`Could not load connected group Discord servers: ${error.message || error}`);
      return [];
    })
    : [];
  /* The bot gets moved between servers; commands must exist wherever it
     lives, or admin tools like /share-setup cannot be run in a new group. */
  const joinedGuildIds = dailySocialMode ? [...client.guilds.cache.keys()] : [];
  const commandGuildIds = [...new Set([process.env.GUILD_ID, ...joinedGuildIds, ...(!dailySocialMode && roleSyncEnabled() ? roleSyncGuildIds() : []), ...dynamicGuilds].filter(Boolean))];
  for (const guildId of commandGuildIds) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      console.warn(`Could not register commands: bot is not available in guild ${guildId}.`);
      continue;
    }
    await guild.commands.set(client.commands.map((command) => command.data.toJSON()));
    console.log(`Commands registered in ${guild.name} (${guild.id}).`);
	if (!dailySocialMode && isRoleSyncGuild(guild.id)) await pushGuildCatalog(guild).catch((error) => console.warn(`Could not refresh Discord channel catalog for ${guild.id}: ${error.message || error}`));
  }
  const botSettings = await readSettings();
  for (const workflow of linkWorkflowsFromSettings(botSettings)) {
    const returnChannelId = workflow.returnLinksChannelId;
    if (!returnChannelId) continue;
    const returnChannel = await client.channels.fetch(returnChannelId).catch(() => null);
    if (!returnChannel?.isTextBased()) {
      console.warn(`Return-links channel ${returnChannelId} (${workflow.id || 'workflow'}) is unavailable or is not text-based.`);
    } else {
      const permissions = returnChannel.permissionsFor(client.user);
      const requiredPermissions = [
        ['ViewChannel', PermissionFlagsBits.ViewChannel],
        ['SendMessages', PermissionFlagsBits.SendMessages],
        ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory],
        ['ManageMessages', PermissionFlagsBits.ManageMessages],
      ];
      const missingPermissions = requiredPermissions.filter(([, flag]) => !permissions?.has(flag)).map(([name]) => name);
      if (missingPermissions.length) console.warn(`Return-links channel ${returnChannelId} (${workflow.id || 'workflow'}) is missing bot permissions: ${missingPermissions.join(', ')}`);
      else console.log(`Return-links channel ready: #${returnChannel.name} (${returnChannel.id}) for ${workflow.id || 'workflow'}.`);
    }
  }
  if (botSettings.engagementEveryonePing) {
    const pingChannels = [...new Set(linkWorkflowsFromSettings(botSettings)
      .flatMap((workflow) => [workflow.shareChannelId, workflow.engagementChannelId])
      .filter(Boolean))];
    for (const channelId of pingChannels) {
      const pingChannel = await client.channels.fetch(channelId).catch(() => null);
      const canMentionEveryone = pingChannel?.permissionsFor(client.user)?.has(PermissionFlagsBits.MentionEveryone);
      if (!canMentionEveryone) console.warn(`Work channel ${channelId} does not grant MentionEveryone; @everyone alerts will not notify members there.`);
      else console.log(`@everyone work alerts enabled in #${pingChannel.name}.`);
    }
  }
  if (botSettings.workReport?.enabled) {
    const reportTargets = botSettings.workReport.channels?.length
      ? botSettings.workReport.channels
      : botSettings.workReport.channelId ? [{ channelId: botSettings.workReport.channelId }] : [];
    for (const target of reportTargets) {
      const reportChannel = await client.channels.fetch(target.channelId).catch(() => null);
      if (!reportChannel?.isTextBased()) {
        console.warn(`Work-report channel ${target.channelId} is unavailable.`);
        continue;
      }
      const permissions = reportChannel.permissionsFor(client.user);
      const requiredPermissions = [
        ['ViewChannel', PermissionFlagsBits.ViewChannel],
        ['SendMessages', PermissionFlagsBits.SendMessages],
        ['EmbedLinks', PermissionFlagsBits.EmbedLinks],
        ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory],
      ];
      const missingPermissions = requiredPermissions.filter(([, flag]) => !permissions?.has(flag)).map(([name]) => name);
      if (missingPermissions.length) console.warn(`Work-report channel ${reportChannel.id} is missing bot permissions: ${missingPermissions.join(', ')}`);
      else console.log(`Work reports ready in ${reportChannel.guild?.name || target.label || 'Discord'}: #${reportChannel.name} (${reportChannel.id}).`);
    }
  }
  if (!dailySocialMode && botSettings.alertMonitor?.enabled) {
    for (const channelId of botSettings.alertMonitor.channelIds || []) {
      const alertChannel = await client.channels.fetch(channelId).catch(() => null);
      if (!alertChannel?.isTextBased() || alertChannel.guildId !== botSettings.alertMonitor.guildId) {
        console.warn(`Monitored alert channel ${channelId} is unavailable to this bot or does not belong to guild ${botSettings.alertMonitor.guildId}.`);
        continue;
      }
      const permissions = alertChannel.permissionsFor(client.user);
      const requiredPermissions = [
        ['ViewChannel', PermissionFlagsBits.ViewChannel],
        ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory],
      ];
      const missingPermissions = requiredPermissions.filter(([, flag]) => !permissions?.has(flag)).map(([name]) => name);
      if (missingPermissions.length) console.warn(`Monitored alert channel ${channelId} is missing bot permissions: ${missingPermissions.join(', ')}`);
      else console.log(`Alert monitor ready: #${alertChannel.name} (${channelId}) in ${alertChannel.guild.name}.`);
    }
    await backfillAlertHistory(client).catch((error) => console.error('Alert startup backfill failed safely:', error.message || error));
  }
  if (!dailySocialMode && botSettings.articleAutomation?.enabled) {
    startArticleAutomation(client, botSettings.articleAutomation.pollIntervalSeconds);
    const publishing = botSettings.articleAutomation.draftOnly === false;
    console.log(`${publishing ? 'Verified auto-publish' : 'Draft-only'} alert article automation enabled.`);
    if (!publishing && !botSettings.articleAutomation.reviewChannelId) console.warn('No private article review channel is configured; draft results will remain in the local audit log only.');
  } else {
    console.log('Alert article automation is configured but disabled pending verification.');
  }
  if (!dailySocialMode && botSettings.telegramNewsForward?.enabled) {
    startSmlNewsTelegramForwarder(botSettings.telegramNewsForward.pollIntervalSeconds);
    console.log('SML News Telegram topic forwarder enabled.');
  }
  if (!dailySocialMode && botSettings.membershipLifecycle?.enabled) {
    startMembershipAuditPoller(client, botSettings.membershipLifecycle.pollIntervalSeconds || 45);
    console.log('Membership lifecycle audit watcher enabled.');
  }
  if (!dailySocialMode) startMakingEasyMoneyRoleRepairPoller(client, botSettings);
  if (!dailySocialMode) console.log('Community role repair watcher enabled.');
  const security = dailySocialMode ? { ready: false, reason: 'not part of Daily Social Payouts' } : await memberSecurityReadiness(client, botSettings);
  if (security.ready) {
    const baseline = await ensureMemberSecurityGrandfatherSnapshot(client, botSettings);
    console.log(`Member security gate is ready; ${baseline.count} pre-existing members are permanently grandfathered.`);
  }
  else console.log(`Member security gate inactive: ${security.reason}.`);
  const exactBlocks = dailySocialMode ? { skipped: true } : await enforceConfiguredUserBlocks(client, botSettings).catch((error) => ({ error }));
  if (exactBlocks?.error) console.error('Exact user block enforcement failed safely:', exactBlocks.error.message || exactBlocks.error);
  else if (!exactBlocks?.skipped) console.log(`Exact user block enforcement complete: ${exactBlocks.blocked} blocked, ${exactBlocks.failed} failed.`);
  if (!dailySocialMode && roleSyncEnabled()) {
    console.log(`Website role sync enabled for Discord guilds: ${[...new Set([...roleSyncGuildIds(), ...dynamicRoleSyncGuildIds()])].join(', ')}.`);
  }
  const protectedSnapshot = dailySocialMode ? { channelSnapshots: 0 } : await snapshotProtectedChannels(client).catch((error) => ({ error }));
  if (protectedSnapshot?.error) console.error('Protected channel snapshot failed safely:', protectedSnapshot.error.message || protectedSnapshot.error);
  else console.log(`Protected channel snapshot ready: ${protectedSnapshot.channelSnapshots} channels archived.`);
  console.log(`Ready as ${client.user.tag}; registered ${client.commands.size} guild commands.`);
});

// A new group owner adds the bot through the secure pairing panel. Register
// commands immediately in that server so /connect-sml-group is available
// without waiting for a global Discord command propagation cycle.
client.on('guildCreate', async (guild) => {
  await guild.commands.set(client.commands.map((command) => command.data.toJSON()))
    .then(() => console.log(`Commands registered in newly added guild ${guild.name} (${guild.id}).`))
    .catch((error) => console.error(`Could not register commands in newly added guild ${guild.id}:`, error.message || error));
	if (!dailySocialMode && isRoleSyncGuild(guild.id)) await pushGuildCatalog(guild).catch((error) => console.error(`Could not publish channel catalog for ${guild.id}:`, error.message || error));
  // Owner call 2026-09-07: introduce the bot and ask the owner to create / connect their Stock Market Loop group and migrate members.
  if (!dailySocialMode) await sendOnboarding(guild).catch((error) => console.error(`Onboarding failed safely for ${guild.id}:`, error.message || error));
});

const catalogRefreshTimers = new Map();
function queueGuildCatalogRefresh(guild) {
  if (!guild || !isRoleSyncGuild(guild.id)) return;
  clearTimeout(catalogRefreshTimers.get(guild.id));
  catalogRefreshTimers.set(guild.id, setTimeout(() => {
    catalogRefreshTimers.delete(guild.id);
    pushGuildCatalog(guild).catch((error) => console.error(`Discord channel catalog refresh failed safely for ${guild.id}:`, error.message || error));
  }, 3000));
}
for (const event of ['channelCreate', 'channelUpdate', 'channelDelete', 'roleCreate', 'roleUpdate', 'roleDelete']) {
  client.on(event, (...args) => queueGuildCatalogRefresh(args.find((item) => item?.guild)?.guild));
}

client.on('guildMemberAdd', async (member) => {
  const botSettings = await readSettings();
  await logNewMember(member, botSettings).catch((error) => console.error('New member log failed safely:', error.message || error));
  await sendDailySocialWelcome(member, botSettings).catch((error) => console.error('Daily Social Payouts welcome failed safely:', error.message || error));
  const safety = await enforceDiscordSafetyMemberBan(member, botSettings, 'member_join').catch((error) => ({ error }));
  if (safety?.error) console.error('Discord safety auto-ban failed safely:', safety.error.message || safety.error);
  else if (safety?.actionTaken) {
    console.log(`Discord safety auto-ban removed user ${member.id}.`);
    return;
  }
  await sendNewMemberWarning(member.user, member.guild, botSettings).catch((error) => console.error('New-member warning failed safely:', error.message || error));
  const result = await enforceMemberSecurity(member, botSettings).catch((error) => ({ error }));
  if (result?.error) console.error('Member security gate failed safely:', result.error.message || result.error);
  else if (result?.actionTaken) console.log(`Member security gate removed user ${member.id}.`);
  const autoGrant = await autoGrantMakingEasyMoneyAccess(member, 'member_join').catch((error) => ({ error }));
  if (autoGrant?.error) console.error(`Making Easy Money auto-grant failed safely for ${member.id}:`, autoGrant.error.message || autoGrant.error);
  else if (autoGrant?.applied?.length) console.log(`Making Easy Money auto-granted roles to ${member.id}: ${autoGrant.applied.join(', ')}.`);
  if (isRoleSyncGuild(member.guild.id)) {
    const synced = await syncMemberRoles(member, 'member_join').catch((error) => ({ error }));
    if (synced?.error) console.error(`Website role sync failed safely for joining member ${member.id}:`, synced.error.message || synced.error);
  }
});

client.on('guildMemberUpdate', async (previousMember, currentMember) => {
  const botSettings = await readSettings();
  const safety = await enforceDiscordSafetyMemberBan(currentMember, botSettings, 'member_update').catch((error) => ({ error }));
  if (safety?.error) console.error('Discord safety auto-ban failed safely:', safety.error.message || safety.error);
  else if (safety?.actionTaken) {
    console.log(`Discord safety auto-ban removed user ${currentMember.id}.`);
    return;
  }
  if (!memberRoleIdsChanged(previousMember, currentMember)) return;
  await logMembershipRoleChanges(previousMember, currentMember, botSettings).catch((error) => console.error('Membership lifecycle role log failed safely:', error.message || error));
  if (!isRoleSyncGuild(currentMember.guild.id)) return;
  const synced = await syncMemberRoles(currentMember, 'role_update').catch((error) => ({ error }));
  if (synced?.error) console.error(`Website role sync failed safely for member ${currentMember.id}:`, synced.error.message || synced.error);
  else if (synced?.changed) console.log(`Website role sync updated group access for Discord member ${currentMember.id}.`);
});

client.on('guildMemberRemove', async (member) => {
  const botSettings = await readSettings();
  const tkKick = await reportTkKick(member).catch((error) => ({ error }));
  if (tkKick?.error) console.error('TK kick lock failed safely:', tkKick.error.message || tkKick.error);
  else if (tkKick?.detected) console.log(`TK kick detected for ${member.id}; owner alerted.`);
  await logMemberLeft(member, botSettings).catch((error) => console.error('Member-left lifecycle log failed safely:', error.message || error));
  if (!isRoleSyncGuild(member.guild.id)) return;
  const synced = await revokeMemberRoles(member, 'member_left').catch((error) => ({ error }));
  if (synced?.error) console.error(`Website role revocation failed safely for departed member ${member.id}:`, synced.error.message || synced.error);
  else if (synced?.changed) console.log(`Website role sync removed bot-managed access for departed member ${member.id}.`);
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton() && interaction.customId === 'dsp-recruit-random') {
    const settings = await readSettings();
    const subreddits = [...new Set((settings.recruitmentPosts?.approvedSubreddits || [])
      .map((name) => String(name || '').replace(/^r\//i, '').trim())
      .filter(Boolean))];
    if (!subreddits.length) {
      return interaction.reply({ content: 'No approved recruitment subreddits are configured yet.', ephemeral: true });
    }
    const index = Math.floor(Math.random() * subreddits.length);
    const subreddit = subreddits[index];
    const post = generateRecruitmentPost(subreddit, index);
    const redditUrl = recruitmentComposerTitleOnlyUrl(subreddit, index);
    const rulesUrl = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/about/rules/`;
    const content = [
      `# 🎯 Random recruitment post generated for r/${subreddit}`,
      '## COPY THIS BODY FIRST',
      `**Title already loaded in Reddit:** ${post.title}`,
      '',
      '```text',
      post.body,
      '```',
      '',
      'After copying the body above, click **Open Reddit Composer**. Reddit opens with the subreddit and title already filled. Paste the copied body over the placeholder text, review the subreddit rules, then post.',
    ].join('\n');
    return interaction.reply({
      content: content.length <= 2000 ? content : content.slice(0, 1990),
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel(`Open r/${subreddit} Composer`).setStyle(ButtonStyle.Link).setURL(redditUrl),
        new ButtonBuilder().setLabel(`Review r/${subreddit} Rules`).setStyle(ButtonStyle.Link).setURL(rulesUrl),
      )],
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }
  if (interaction.isButton() && /^sml-recruit:[A-Za-z0-9_-]+:[0-9]+$/i.test(interaction.customId)) {
    const [, subreddit, indexText] = interaction.customId.split(':');
    const settings = await readSettings();
    const allowed = new Set((settings.recruitmentPosts?.approvedSubreddits || []).map((name) => String(name).toLowerCase()));
    if (!allowed.has(subreddit.toLowerCase())) {
      return interaction.reply({ content: 'That subreddit is not approved for Daily Social Payouts recruitment posts.', ephemeral: true });
    }
    const post = generateRecruitmentPost(subreddit, Number(indexText || 0));
    return interaction.reply({
      content: [
        `# Reddit recruitment post ready: r/${post.subreddit}`,
        '',
        `**Title prefilled:** ${post.title}`,
        '',
        '**Before you hit Post:**',
        `- Review r/${post.subreddit} rules first: ${post.rulesUrl}`,
        '- Do not post if the subreddit does not allow hiring, paid promotion work, external applications, or Discord/application links.',
        '- Do not promise guaranteed income.',
        '- If the subreddit requires flair or a special title format, fix that before posting.',
        '',
        '**Click the button below to open the filled-out Reddit composer.**',
      ].join('\n'),
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel(`Open r/${post.subreddit} Composer`).setStyle(ButtonStyle.Link).setURL(post.composerUrl),
        new ButtonBuilder().setLabel(`Review r/${post.subreddit} Rules`).setStyle(ButtonStyle.Link).setURL(post.rulesUrl),
      )],
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }
  if (interaction.isButton() && /^sml-proof-review:[0-9a-f-]{36}:(approve|reject)$/i.test(interaction.customId)) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: 'Only a server manager can review engagement evidence.', ephemeral: true });
    }
    const [, proofId, decision] = interaction.customId.split(':');
    const result = await reviewProof(proofId, interaction.user, decision);
    if (!result) return interaction.reply({ content: 'That proof record no longer exists.', ephemeral: true });
    if (!result.changed) return interaction.reply({ content: `This proof is already ${result.proof.status}.`, ephemeral: true });
    const status = result.proof.status === 'approved' ? '✅ APPROVED' : '❌ REJECTED';
    const embeds = interaction.message.embeds.map((embed, index) => index === 0
      ? EmbedBuilder.from(embed).setColor(result.proof.status === 'approved' ? 0x22c55e : 0xef4444)
        .addFields({ name: 'Final review status', value: `${status}\nReviewed by <@${interaction.user.id}>`, inline: false })
      : EmbedBuilder.from(embed));
    await interaction.update({ embeds, components: [] });
    let payout = null;
    if (result.proof.status === 'approved') {
      const post = await postById(result.proof.postID).catch(() => null);
      payout = await recordApprovedProofPayout({ proof: result.proof, post }).catch((error) => {
        console.error('Proof payout ledger update failed safely:', error.message || error);
        return null;
      });
    }
    const member = await interaction.client.users.fetch(result.proof.userId).catch(() => null);
    const payoutLine = payout?.amountUsd
      ? `\n\nPayout ledger: **${payout.amountUsd}** · ${payout.rateRule}\nStatus: **pending hold** until <t:${Math.floor(Date.parse(payout.payableAt) / 1000)}:f> if the proof stays valid.`
      : '';
    await member?.send(`# ${status}\nYour **${result.proof.platform} ${result.proof.action}** evidence was ${result.proof.status}.\n\nEvidence type: **${result.proof.method === 'screenshot' ? 'Screenshot — manually reviewed' : 'Public URL — manually reviewed'}**\nProof ID: \`${result.proof.id}\`${payoutLine}\n\nNo password, cookie, or session access was used.`).catch(() => {});
    return;
  }
  if (interaction.isModalSubmit() && /^sml-proof-link:[0-9a-f-]{36}:[0-9a-f-]{36}$/i.test(interaction.customId)) {
    try {
      await interaction.deferReply({ ephemeral: true });
      const [, postID, externalPostId] = interaction.customId.split(':');
      const post = await postById(postID);
      const externalPost = post?.externalPosts?.find((entry) => entry.id === externalPostId);
      if (!post || !externalPost) throw new Error('This engagement task is unavailable.');
      const checked = validateProofUrl(interaction.fields.getTextInputValue('proof_url'), externalPost.platform, interaction.fields.getTextInputValue('proof_action'));
      const result = await createProof({ user: interaction.user, post, externalPost, action: checked.action, method: 'public_url', evidenceUrl: checked.url });
      if (!result.changed) return interaction.editReply(result.duplicateEvidence
        ? `Proof rejected: ${result.reason}`
        : `You already submitted ${result.proof.action} evidence for this post. Current status: **${result.proof.status}**.`);
      const review = await sendProofForReview(interaction.client, result.proof, post);
      return interaction.editReply(`# ✅ PROOF RECEIVED\nYour **${externalPost.platform} ${checked.action}** public URL was submitted for review.\n\nStatus: **Public URL submitted — not verified yet**\nReview card: ${review.url}\nProof ID: \`${result.proof.id}\``);
    } catch (error) {
      const message = String(error?.message || 'The proof could not be submitted.').slice(0, 500);
      if (interaction.deferred || interaction.replied) return interaction.editReply(message).catch(() => {});
      return interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
  if (interaction.isButton() && /^sml-proof-(link|shot):[0-9a-f-]{36}:[0-9a-f-]{36}$/i.test(interaction.customId)) {
    const [proofCommand, postID, externalPostId] = interaction.customId.split(':');
    const method = proofCommand.endsWith('-shot') ? 'shot' : 'link';
    const post = await postById(postID);
    const externalPost = post?.externalPosts?.find((entry) => entry.id === externalPostId);
    if (!post || !externalPost) return interaction.reply({ content: 'This engagement task is unavailable.', ephemeral: true });
    if (method === 'shot') {
      return interaction.reply({
        content: `# 📸 SCREENSHOT PROOF INSTRUCTIONS\nReply directly to the **engagement task message** with one image attached. Put exactly one of these on the first line:\n\n\`PROOF: LIKE\`\n\`PROOF: UPVOTE\`\n\`PROOF: COMMENT\`\n\`PROOF: SHARE\`\n\nShow the platform, your account identity, the completed action, and the related post. Crop out private messages, balances, email addresses, and unrelated personal data. Screenshots always go to **manual review** and are never labeled API verified.`,
        ephemeral: true,
      });
    }
    const modal = new ModalBuilder().setCustomId(`sml-proof-link:${postID}:${externalPostId}`).setTitle('Submit Public Engagement Proof')
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('proof_action').setLabel('Action: COMMENT or SHARE').setPlaceholder('COMMENT').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('proof_url').setLabel('Direct public comment/share URL').setPlaceholder('https://...').setStyle(TextInputStyle.Short).setRequired(true)),
      );
    return interaction.showModal(modal);
  }
  if (interaction.isButton() && /^sml-engagement-(reply|done):[0-9a-f-]{36}:[0-9a-f-]{36}$/i.test(interaction.customId)) {
    const [, action, postID, externalPostId] = interaction.customId.split(':');
    const post = await postById(postID);
    const externalPost = post?.externalPosts?.find((entry) => entry.id === externalPostId);
    if (!post || !externalPost) return interaction.reply({ content: 'This engagement checklist is unavailable.', ephemeral: true });
    if (action === 'reply') {
      const idea = post.commentIdeas?.[Math.floor(Math.random() * post.commentIdeas.length)];
      if (!idea) return interaction.reply({ content: 'No generated reply is available for this article.', ephemeral: true });
      return interaction.reply({
        content: `# 🔴 COPY THIS REPLY, PERSONALIZE IT, POST IT, AND COME BACK 🔴\n\n**Exactly 3 hashtags · no @handles**\n\n\`\`\`text\n${idea}\n\`\`\`\nOpen the original post, make the reply your own, submit it manually, then return to the engagement checklist.`,
        ephemeral: true,
      });
    }
    return interaction.reply({
      content: `# ✅ ENGAGEMENT CHECKLIST RECEIVED\nYou marked the **${platformInfo[externalPost.platform]?.label || externalPost.platform}** checklist complete.\n\n✅ Opened the submitted post\n✅ Reviewed the like/comment/share steps\n✅ Returned to Discord\n\nThis is a **self-reported completion receipt**. Discord cannot independently verify external likes, comments, or shares, and no cash payment is attached to this receipt.`,
      ephemeral: true,
    });
  }
  if (interaction.isButton() && /^sml-reshare:[0-9a-f-]{36}:[0-9a-f-]{36}:(x|facebook|reddit|linkedin|bluesky|threads)$/i.test(interaction.customId)) {
    try {
      await interaction.deferReply({ ephemeral: true });
      const [, postID, externalPostId, platform] = interaction.customId.split(':');
      const post = await postById(postID);
      const externalPost = post?.externalPosts?.find((entry) => entry.id === externalPostId);
      if (!post || !externalPost) return interaction.editReply('This returned-post share package is unavailable.');
      if (platform === 'bluesky') {
        const bluesky = await blueskyResharePackage(post, externalPost.url);
        return interaction.editReply({
          content: `# 🦋 BLUESKY REPOST READY\n**${bluesky.length}/300 characters · ${bluesky.peers.length} non-duplicate related $tickers · ${bluesky.hashtags.length} hashtags**\n\nThe related tickers below exclude every ticker from the original post. Click **Open Bluesky Repost** and this complete suggestion will already be in the composer. Review it and press **Post** yourself.\n\n\`\`\`text\n${bluesky.text}\n\`\`\``,
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel('Open Bluesky Repost').setStyle(ButtonStyle.Link).setURL(blueskyIntentUrl(bluesky.text)),
          )],
        });
      }
      const copy = await generateSocialCopy(post, platform, { reply: true });
      const url = socialShareUrl({ platform, copy, url: externalPost.url, post });
      const label = platform === 'x' ? 'X' : platform.charAt(0).toUpperCase() + platform.slice(1);
      return interaction.editReply({
        content: `# 🔴 COPY THIS LINK, PASTE IT, AND COME BACK WITH YOUR FINISHED POST LINK 🔴\n\n**Generated reply/reshare copy: ${Array.from(copy.body).length}/120 main-text characters · exactly 3 hashtags · no @handles:**\n\n\`\`\`text\n${copy.text}\n\`\`\`\nThen open ${label}, paste if its composer did not prefill, review it, and publish manually. The bot never posts for you.`,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel(`Open ${label}`).setStyle(ButtonStyle.Link).setURL(url),
        )],
      });
    } catch (error) {
      console.error(error);
      const message = String(error?.message || 'The social share package could not be generated.').slice(0, 500);
      if (interaction.deferred || interaction.replied) return interaction.editReply(message).catch(() => {});
      return interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
  if (interaction.isModalSubmit() && /^sml-external-link:[0-9a-f-]{36}:(reddit|x|stocktwits|bluesky|threads|facebook)$/i.test(interaction.customId)) {
    try {
      await interaction.deferReply({ ephemeral: true });
      const [, postID, platform] = interaction.customId.split(':');
      const url = validateExternalPostUrl(interaction.fields.getTextInputValue('post_url'), platform);
      const result = await publishExternalPostSubmission({
        client: interaction.client,
        user: interaction.user,
        fallbackChannelId: interaction.channelId,
        postID,
        platform,
        url,
      });
      if (!result.changed) return await interaction.editReply(`That ${result.platformLabel} post link was already submitted.`);
      const payoutLine = result.payout?.amountUsd
        ? `\n💵 Payout ledger: **${result.payout.amountUsd}** · ${result.payout.rateRule}\nPayable after <t:${Math.floor(Date.parse(result.payout.payableAt) / 1000)}:f> if the link stays public.`
        : '';
      return await interaction.editReply(`# ✅ POSTING TASK COMPLETE\n**${result.platformLabel} public-post link accepted.**\n\n✅ Link format checked\n✅ Saved to your work history\n✅ Sent to #return-your-post-link${payoutLine}\n\nEngagement alert: ${result.published.url}\nYour work thread: ${result.workEntry.url}\n\n*This verifies the returned public-post URL. External likes, comments, and shares require proof/review before they count.*`);
    } catch (error) {
      console.error(error);
      const message = String(error?.message || 'The submitted post link could not be saved.').slice(0, 500);
      if (interaction.deferred || interaction.replied) return interaction.editReply(message).catch(() => {});
      return interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
  if (interaction.isButton() && /^sml-submit-link:[0-9a-f-]{36}:(reddit|x|stocktwits|bluesky|threads|facebook)$/i.test(interaction.customId)) {
    const [, postID, platform] = interaction.customId.split(':');
    const info = platformInfo[platform];
    const modal = new ModalBuilder()
      .setCustomId(`sml-external-link:${postID}:${platform}`)
      .setTitle(`Return Your ${info.label} Post Link`.slice(0, 45))
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('post_url')
          .setLabel(`Paste the finished ${info.label} post URL`.slice(0, 45))
          .setPlaceholder(info.placeholder)
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ));
    return interaction.showModal(modal);
  }
  if (interaction.isButton() && /^sml-comment:[0-9a-f-]{36}$/i.test(interaction.customId)) {
    const postID = interaction.customId.split(':')[1];
    const post = await postById(postID);
    if (!post || post.engagementMessageId !== interaction.message.id || !post.commentIdeas?.length) {
      return interaction.reply({ content: 'This discussion package is unavailable.', ephemeral: true });
    }
    const idea = post.commentIdeas[Math.floor(Math.random() * post.commentIdeas.length)];
      return await interaction.reply({
      content: `**Suggested starting point — edit this in your own voice before posting:**\n\n${idea}\n\nReply to the discussion message in Discord, or manually use it on the external platform you opened from #links-to-post. The bot does not submit comments or votes.`,
      components: commentIdeaComponents(post),
      ephemeral: true,
    });
  }
  if (interaction.isButton() && isShareButton(interaction.customId)) {
    try {
      const parsed = parseShareButton(interaction.customId);
      const post = parsed ? await postById(parsed.postID) : null;
      if (!post || post.discordMessageId !== interaction.message.id) {
        return await interaction.reply({ content: 'This share package is unavailable or no longer matches this message.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      const platformUrls = buildShareUrls(post);
      if (parsed.platform === 'x') {
        const socialCopy = await generateSocialCopy(post, 'x');
        if (socialCopy.hashtags.length !== 5) throw new Error('The X package could not produce five unique hashtags.');
        platformUrls.x = socialShareUrl({ platform: 'x', copy: socialCopy, url: post.link, post });
      }
      const selectedPlatformLabel = platformInfo[parsed.platform]?.label || parsed.platform;
      const outboundRecorded = await recordOutboundIntent({
        postID: post.postID,
        userId: interaction.user.id,
        userName: interaction.user.username,
        platform: parsed.platform,
        eventId: interaction.id,
      });
      if (outboundRecorded) await reportWorkEvent(interaction.client, {
        type: 'share_opened', eventKey: `share-opened:${interaction.id}`, userId: interaction.user.id,
        userName: interaction.user.username, platform: selectedPlatformLabel, post, articleUrl: post.link,
      });
      let responseContent = `Continue directly to ${selectedPlatformLabel}. The prepared post should appear in its composer. Review and publish it yourself.\n\n## AFTER POSTING\nReturn here, click **Submit ${selectedPlatformLabel} Post Link**, and paste the finished public URL. The bot will alert #return-your-post-link.`;
      let redditRoute = null;
      if (parsed.platform === 'facebook') {
        responseContent = `# 🚨 COPY FIRST 🚨\n**Click the Copy icon on the post below before leaving Discord.**\n\n\`\`\`text\n${packagedFacebookCaption(post)}\n\`\`\`\n## THEN CLICK “GO TO FACEBOOK”\nThe article link is already attached. Paste the copied caption into Facebook and review it before posting.\n\n## AFTER POSTING\nReturn here, click **Submit Facebook Post Link**, and paste the finished Facebook URL. The bot will return it in #return-your-post-link for members to open.`;
      } else if (parsed.platform === 'stocktwits') {
        const stocktwits = await stocktwitsPackages(post);
        responseContent = `# 🚨 COPY FIRST 🚨\n**SEO-ready Stocktwits post with two non-duplicate related tickers:**\n\n\`\`\`text\n${stocktwits.original}\n\`\`\`\n## THEN CLICK “GO TO STOCKTWITS”\nThe $${stocktwits.primary || 'primary'} ticker stream will open. Start a new Stocktwits post, paste the message, review it, and publish.\n\n## AFTER POSTING\nReturn here, click **Submit Stocktwits Post Link**, and paste the finished URL. The engagement channel will receive separate Like, Comment, and Quote Share instructions with a different three-ticker package.`;
      } else if (parsed.platform === 'bluesky') {
        const bluesky = await blueskyPackage(post);
        platformUrls.bluesky = blueskyIntentUrl(bluesky.text);
        responseContent = `# 🦋 BLUESKY POST READY\n**${bluesky.length}/300 characters · six related tickers · seven Facebook-pool hashtags**\n\nClick **Continue to Bluesky**. The complete generated post below will already be inside the Bluesky composer. Review it, make any changes you want, and press **Post** yourself.\n\n\`\`\`text\n${bluesky.text}\n\`\`\`\n## AFTER POSTING\nReturn here, click **Submit Bluesky Post Link**, and paste the finished public URL.`;
      } else if (parsed.platform === 'threads') {
        const threadsCopy = await generateSocialCopy(post, 'threads');
        platformUrls.threads = 'https://www.threads.com/';
        responseContent = `# 🚨 COPY FIRST 🚨\n**Threads does not provide a reliable public link that inserts third-party text into its composer.**\n\n\`\`\`text\n${threadsCopy.text}\n\n${post.link}\n\`\`\`\n## THEN CLICK “CONTINUE TO THREADS”\nStart a post, paste the package, review it, and publish manually.\n\n## AFTER POSTING\nReturn here, click **Submit Threads Post Link**, and paste the finished public URL.`;
      } else if (parsed.platform === 'reddit') {
        redditRoute = selectSubreddit(post);
        const checklist = redditRoute.requirements.map((item) => `- ${item}`).join('\n');
        responseContent = `**Approved Reddit destination:** r/${redditRoute.name}\n**Compatibility reason:** ${redditRoute.reason}\n\n**Required checks before submitting:**\n${checklist}\n- Open **Review r/${redditRoute.name} Rules** and confirm the current moderator rules and required flair.\n\nThe title was cleaned to remove site branding and promotional language. Submission remains manual.\n\n## AFTER POSTING\nReturn here, click **Submit Reddit Post Link**, and paste the finished Reddit URL. The bot will alert #return-your-post-link.`;
      }
      responseContent = `# 🔴 COPY THIS LINK, PASTE IT, AND COME BACK WITH YOUR FINISHED POST LINK 🔴\n\n${responseContent}`;
      return await interaction.editReply({
        content: responseContent,
        components: outboundLinkComponent(parsed.platform, platformUrls[parsed.platform], post.postID, redditRoute?.name || ''),
      });
    } catch (error) {
      console.error(error);
      const payload = { content: 'The tracked share link could not be created safely. Please try again later.', components: [] };
      if (interaction.deferred || interaction.replied) return interaction.editReply(payload).catch(() => {});
      return interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
    }
  }
  if (interaction.isButton()) {
    const settings = await readSettings().catch(() => ({}));
    const linksToPostChannelId = settings.workerChannels?.linksToPostChannelId || settings.linkWorkflow?.shareChannelId;
    if ((linksToPostChannelId && interaction.channelId === linksToPostChannelId) || linkWorkflowForShareChannel(settings, interaction.channelId, interaction.guildId)) {
      return interaction.reply({
        content: [
          'That old StockMarketLoop Connect button is no longer active.',
          '',
          'Use the newest article card at the bottom of this channel. The working buttons are labeled:',
          '**Reddit · X · Stocktwits · Bluesky · Threads · Facebook**',
          '',
          'If you still see the error, ask an admin to repost the article link in the intake channel so the bot creates a fresh card.',
        ].join('\n'),
        ephemeral: true,
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    const payload = { content: 'The command failed safely. Nothing was posted externally.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

client.on('messageCreate', async (message) => {
  if (!dailySocialMode) trackProtectedBotMessage(message);
  if (!dailySocialMode) archiveProtectedChannelMessage(message).catch((error) => console.error('Protected message archive failed safely:', error.message || error));
  const safetySettings = await readSettings();
  const instantDeleteRule = dailySocialMode ? null : instantDeleteAuthorRules.find((rule) => message.guildId === rule.guildId && message.author?.id === rule.userId);
  if (instantDeleteRule) {
    await message.delete().catch((error) => console.error(`${instantDeleteRule.label} failed safely for message ${message.id}:`, error.message || error));
    return;
  }
  if (!message.guild) {
    if (await recordPremiumVerificationDm(message, safetySettings)) return;
    if (message.author?.bot) return;
  }
  if (!dailySocialMode) await enforceDiscordSafetyMessageBan(message, safetySettings).catch((error) => console.error('Discord safety-alert message enforcement failed safely:', error.message || error));
  if (!dailySocialMode && await enforceMakingEasyMoneyRaidSpam(message)) return;
  if (message.type === MessageType.UserJoin && message.guild) {
    await sendNewMemberWarning(message.author, message.guild, safetySettings).catch((error) => console.error('System-message welcome fallback failed safely:', error.message || error));
  }
  const botSettings = safetySettings;
  if (message.author.bot) {
    if (!dailySocialMode) await forwardAlertToTelegram(message, botSettings).catch((error) => console.error('Telegram bridged alert forward failed safely:', error.message || error));
    return;
  }
  if (await handlePaypalInfoMessage(message, botSettings)) return;
  if (await handleSocialApplicationMessage(message, botSettings)) return;
  if (!dailySocialMode && await moderateBlockedInviteMessage(message, botSettings)) return;
  if (!dailySocialMode) await mirrorAlertToDiscord(message, botSettings).catch((error) => console.error('Discord alert mirror failed safely:', error.message || error));
  if (!dailySocialMode) await forwardAlertToTelegram(message, botSettings).catch((error) => console.error('Telegram alert forward failed safely:', error.message || error));
  if (!dailySocialMode && await processAlertMessage(message)) return;
  const returnWorkflow = linkWorkflowForReturn(botSettings, message);
  if (returnWorkflow) {
    const rawUrl = message.content.match(/https:\/\/[^\s<>]+/i)?.[0]?.replace(/[),.;!?]+$/, '') || '';
    const platform = detectExternalPostPlatform(rawUrl);
    if (!platform) {
      await message.reply('Paste the full public URL of your finished Facebook, Stocktwits, Reddit, X, Bluesky, or Threads post.').catch(() => {});
      return;
    }
    try {
      const url = validateExternalPostUrl(rawUrl, platform);
      const intent = await recentUnreturnedOutboundIntent({ userId: message.author.id, platform, withinHours: 6 });
      if (!intent) {
        await message.reply(`I could not safely match this ${platformLabels[platform] || platform} link to one of your share actions from the last 6 hours. Open the article's platform button first, then return the finished post link here—or use its **Submit Post Link** button.`).catch(() => {});
        return;
      }
      const result = await publishExternalPostSubmission({
        client: message.client,
        user: message.author,
        fallbackChannelId: message.channelId,
        engagementChannelId: returnWorkflow.engagementChannelId,
        postID: intent.postID,
        platform,
        url,
      });
      if (!result.changed) {
        await message.reply(`That ${result.platformLabel} post link was already submitted.`).catch(() => {});
        return;
      }
      const payoutLine = result.payout?.amountUsd
        ? `\n💵 Payout ledger: **${result.payout.amountUsd}** · ${result.payout.rateRule}\nPayable after <t:${Math.floor(Date.parse(result.payout.payableAt) / 1000)}:f> if the link stays public.`
        : '';
      const receipt = await message.channel.send({
        content: `# ✅ POSTING TASK COMPLETE\n<@${message.author.id}> your **${result.platformLabel}** public-post link was accepted.\n\n✅ Link format checked\n✅ Saved to your work history\n✅ Sent to #return-your-post-link${payoutLine}\n\nEngagement alert: ${result.published.url}\nWork history: ${result.workEntry.url}\n\n*This verifies the returned public-post URL. External likes, comments, and shares require proof/review before they count.*`,
        allowedMentions: { users: [message.author.id] },
      });
      await message.delete().catch(() => null);
      console.log(`Returned post ${url} accepted from ${message.author.id}; receipt ${receipt.id}.`);
    } catch (error) {
      await message.reply(String(error?.message || 'That returned post link could not be processed.').slice(0, 500)).catch(() => {});
    }
    return;
  }
  if (await processLinkWorkflow(message)) return;
  if (!message.reference?.messageId) return;
  const referenced = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
  const proofContext = proofContextFromMessage(referenced);
  if (proofContext && message.attachments.size) {
    try {
      const actionMatch = message.content.match(/^\s*PROOF\s*:\s*(LIKE|UPVOTE|COMMENT|SHARE)\b/i);
      if (!actionMatch) throw new Error('Add `PROOF: LIKE`, `PROOF: UPVOTE`, `PROOF: COMMENT`, or `PROOF: SHARE` as the first line.');
      const attachment = message.attachments.first();
      if (!/^image\//i.test(attachment.contentType || '') && !/\.(png|jpe?g|webp|gif)$/i.test(attachment.name || '')) {
        throw new Error('Screenshot proof must be a PNG, JPG, WEBP, or GIF image.');
      }
      const post = await postById(proofContext.postID);
      const externalPost = post?.externalPosts?.find((entry) => entry.id === proofContext.externalPostId);
      if (!post || !externalPost) throw new Error('This engagement task is unavailable.');
      const result = await createProof({
        user: message.author, post, externalPost, action: actionMatch[1], method: 'screenshot',
        attachment: { id: attachment.id, url: attachment.url, name: attachment.name, contentType: attachment.contentType, size: attachment.size },
      });
      if (!result.changed) return message.reply(result.duplicateEvidence
        ? `Proof rejected: ${result.reason}`
        : `You already submitted ${result.proof.action} evidence for this post. Current status: **${result.proof.status}**.`);
      const review = await sendProofForReview(message.client, result.proof, post);
      await message.reply(`# ✅ SCREENSHOT RECEIVED\nStatus: **Manual review required — not verified yet**\nReview card: ${review.url}\nProof ID: \`${result.proof.id}\``);
    } catch (error) {
      await message.reply(String(error?.message || 'The screenshot proof could not be submitted.').slice(0, 500)).catch(() => {});
    }
    return;
  }
  const post = await postByMessage(message.reference.messageId);
  if (!post) return;
  const commentRecorded = await recordEngagement({
    postID: post.postID,
    userId: message.author.id,
    userName: message.author.username,
    type: 'comment',
    eventId: message.id,
    content: message.content,
  });
  if (commentRecorded) await reportWorkEvent(message.client, {
    type: 'comment', eventKey: `comment:${message.id}`, userId: message.author.id,
    userName: message.author.username, post, articleUrl: post.link, content: message.content,
  });
  if (commentRecorded) await message.author.send(`# ✅ COMMENT ACTIVITY COMPLETE\nYour Discord reply was recorded and **+${XP.comment} internal XP** was applied.\n\nInternal XP has no cash value. This confirms the Discord reply only; it does not independently verify an external-platform comment.`).catch(() => {});
});

client.on('messageUpdate', async (_oldMessage, newMessage) => {
  try {
    if (dailySocialMode) return;
    if (newMessage.partial) await newMessage.fetch();
    const settings = await readSettings();
    if (newMessage.author?.bot) {
      await forwardAlertToTelegram(newMessage, settings, 'updated').catch((error) => console.error('Telegram bridged alert update forward failed safely:', error.message || error));
      return;
    }
    await mirrorAlertToDiscord(newMessage, settings, 'updated').catch((error) => console.error('Discord alert mirror update failed safely:', error.message || error));
    await forwardAlertToTelegram(newMessage, settings, 'updated').catch((error) => console.error('Telegram alert update forward failed safely:', error.message || error));
    await processAlertMessage(newMessage, 'updated');
  } catch (error) {
    console.error('Alert update processing failed:', error);
  }
});

const reactionTypes = new Map([['🚀', 'boost'], ['⬆️', 'upvote'], ['👍', 'upvote'], ['🔁', 'repost']]);

async function onReaction(reaction, user, remove) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  const type = reactionTypes.get(reaction.emoji.name);
  if (!type) return;
  const post = await postByMessage(reaction.message.id);
  if (!post) return;
  const changed = await recordEngagement({
    postID: post.postID,
    userId: user.id,
    userName: user.username,
    type,
    eventId: `${reaction.message.id}:${reaction.emoji.name}:${user.id}`,
    remove,
  });
  if (changed) {
    const displayType = reaction.emoji.name === '👍' ? 'like' : type;
    await reportWorkEvent(reaction.message.client, {
      type: remove ? `${displayType}_removed` : displayType,
      eventKey: `reaction:${remove ? 'remove' : 'add'}:${reaction.message.id}:${reaction.emoji.name}:${user.id}`,
      userId: user.id, userName: user.username, post, articleUrl: post.link,
    });
    const amount = XP[type] || 0;
    await user.send(`# ${remove ? '↩️ ACTIVITY REMOVED' : '✅ ACTIVITY COMPLETE'}\nYour Discord ${displayType} reaction was recorded and **${remove ? '-' : '+'}${amount} internal XP** was ${remove ? 'removed' : 'applied'}.\n\nInternal XP has no cash value. This confirms the Discord reaction only; it does not independently verify an external-platform action.`).catch(() => {});
  }
}

client.on('messageReactionAdd', (reaction, user) => onReaction(reaction, user, false).catch(console.error));
client.on('messageReactionRemove', (reaction, user) => onReaction(reaction, user, true).catch(console.error));
client.on('messageDelete', async (message) => {
  const restored = await restoreProtectedBotMessageDelete(message).catch((error) => ({ error }));
  if (restored?.error) console.error('Protected bot message restore failed safely:', restored.error.message || restored.error);
  else if (restored?.restoredMessageId) console.log(`Restored protected bot message ${message.id} after delete; new message ${restored.restoredMessageId}.`);
});
client.on('channelDelete', async (channel) => {
  const restored = await restoreChannelDeletedByTk(channel).catch((error) => ({ error }));
  if (restored?.error) console.error('Protected channel restore failed safely:', restored.error.message || restored.error);
  else if (restored?.restoredChannelId) console.log(`Restored channel ${channel.id} after TK delete; new channel ${restored.restoredChannelId}, restored messages ${restored.restoredMessages}.`);
});
client.on('guildBanAdd', async (ban) => {
  const reversed = await reverseTkBan(ban).catch((error) => ({ error }));
  if (reversed?.error) console.error('TK ban lock failed safely:', reversed.error.message || reversed.error);
  else if (reversed?.reversed) console.log(`TK ban reversed for ${ban.user.id}.`);
});
client.on('error', (error) => console.error('Discord client error:', error));

client.login(process.env.DISCORD_TOKEN);

