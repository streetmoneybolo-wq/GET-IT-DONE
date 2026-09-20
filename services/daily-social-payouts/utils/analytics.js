export function rankedUsers(users, field) {
  return Object.values(users).sort((a, b) => (b[field] || 0) - (a[field] || 0) || (b.xp || 0) - (a.xp || 0));
}

export function rankedPosts(posts) {
  return [...posts].sort((a, b) => b.engagementScore - a.engagementScore || Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

export function engagementBy(posts, field) {
  const result = {};
  for (const post of posts) {
    for (const value of post[field] || []) result[value] = (result[value] || 0) + post.engagementScore;
  }
  return Object.entries(result).sort((a, b) => b[1] - a[1]);
}

export function activityByPeriod(posts, days) {
  const after = Date.now() - days * 86_400_000;
  return posts.filter((post) => Date.parse(post.timestamp) >= after).reduce((sum, post) => sum + post.engagementScore, 0);
}

export function analyticsSummary(users, posts) {
  return {
    mostEngagedPost: rankedPosts(posts)[0] || null,
    topBooster: rankedUsers(users, 'boosts')[0] || null,
    topSharer: rankedUsers(users, 'shares')[0] || null,
    sectors: engagementBy(posts, 'sectors'),
    tickers: engagementBy(posts, 'tickers'),
    dailyEngagement: activityByPeriod(posts, 1),
    weeklyEngagement: activityByPeriod(posts, 7),
    monthlyEngagement: activityByPeriod(posts, 30),
  };
}
