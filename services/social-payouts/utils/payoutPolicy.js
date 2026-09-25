export const payoutPolicy = {
  publicLinkMinimumHours: 24,
  verificationHoldHours: 72,
  platforms: {
    reddit: {
      label: 'Reddit',
      publishedLinkCents: 25,
      fastPublishedLinkCents: 50,
      fastPublishedWindowMinutes: 10,
      engagementCents: { like: 25, upvote: 25, comment: 25, share: 25 },
      fastEngagementCents: { like: 50, upvote: 50, comment: 50, share: 50 },
      fastEngagementWindowMinutes: 10,
    },
    x: {
      label: 'X / Twitter',
      publishedLinkCents: 15,
      fastPublishedLinkCents: 30,
      fastPublishedWindowMinutes: 10,
      engagementCents: { like: 25, upvote: 25, comment: 25, share: 25 },
      fastEngagementCents: { like: 50, upvote: 50, comment: 50, share: 50 },
      fastEngagementWindowMinutes: 10,
    },
    stocktwits: {
      label: 'Stocktwits',
      publishedLinkCents: 25,
      fastPublishedLinkCents: 50,
      fastPublishedWindowMinutes: 10,
      engagementCents: { like: 50, upvote: 50, comment: 50, share: 50 },
      fastEngagementCents: { like: 100, upvote: 100, comment: 100, share: 100 },
      fastEngagementWindowMinutes: 5,
    },
    bluesky: {
      label: 'Bluesky',
      publishedLinkCents: 15,
      fastPublishedLinkCents: 25,
      fastPublishedWindowMinutes: 10,
      engagementCents: { like: 20, upvote: 20, comment: 20, share: 20 },
      fastEngagementCents: { like: 40, upvote: 40, comment: 40, share: 40 },
      fastEngagementWindowMinutes: 10,
    },
    threads: {
      label: 'Threads',
      publishedLinkCents: 20,
      fastPublishedLinkCents: 40,
      fastPublishedWindowMinutes: 10,
      engagementCents: { like: 25, upvote: 25, comment: 25, share: 25 },
      fastEngagementCents: { like: 50, upvote: 50, comment: 50, share: 50 },
      fastEngagementWindowMinutes: 10,
    },
    facebook: {
      label: 'Facebook',
      publishedLinkCents: 20,
      fastPublishedLinkCents: 40,
      fastPublishedWindowMinutes: 10,
      engagementCents: { like: 25, upvote: 25, comment: 25, share: 25 },
      fastEngagementCents: { like: 50, upvote: 50, comment: 50, share: 50 },
      fastEngagementWindowMinutes: 10,
    },
  },
};

function minutesBetween(start, end) {
  const started = Date.parse(start || '');
  const ended = Date.parse(end || '');
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return Infinity;
  return Math.max(0, (ended - started) / 60_000);
}

export function centsToUsd(cents = 0) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

export function getPayoutPlatform(platform) {
  return payoutPolicy.platforms[String(platform || '').toLowerCase()] || null;
}

export function publishedLinkRate({ platform, assignedAt, submittedAt }) {
  const rule = getPayoutPlatform(platform);
  if (!rule) return null;
  const fast = minutesBetween(assignedAt, submittedAt) <= rule.fastPublishedWindowMinutes;
  return {
    cents: fast ? rule.fastPublishedLinkCents : rule.publishedLinkCents,
    fast,
    label: rule.label,
    rule: fast
      ? `published link within ${rule.fastPublishedWindowMinutes} minutes`
      : 'published link',
  };
}

export function engagementRate({ platform, action, assignedAt, submittedAt }) {
  const rule = getPayoutPlatform(platform);
  const normalizedAction = String(action || '').toLowerCase().replace('repost', 'share');
  if (!rule || !Object.hasOwn(rule.engagementCents, normalizedAction)) return null;
  const fast = minutesBetween(assignedAt, submittedAt) <= rule.fastEngagementWindowMinutes;
  return {
    cents: fast ? rule.fastEngagementCents[normalizedAction] : rule.engagementCents[normalizedAction],
    fast,
    label: rule.label,
    rule: fast
      ? `${normalizedAction} proof within ${rule.fastEngagementWindowMinutes} minutes`
      : `${normalizedAction} proof`,
  };
}
