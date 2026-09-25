import { randomUUID } from 'node:crypto';
import { paths, mutateJson, readJson } from './storage.js';
import { levelFor, XP } from './xp.js';

function newUser(id, name = '') {
  return { id, name, shares: 0, boosts: 0, comments: 0, upvotes: 0, reposts: 0, xp: 0, level: 1, engagementScore: 0 };
}

function touchUser(users, id, name = '') {
  users[id] ||= newUser(id, name);
  if (name) users[id].name = name;
  return users[id];
}

function recalcPost(post) {
  post.engagementScore = post.boosts.length * 5 + post.comments.length * 8 + post.upvotes.length * 6 + post.reposts.length * 12;
}

export async function createTrackedPost(input) {
  const post = {
    postID: randomUUID(),
    kind: input.kind || 'share',
    workflowId: input.workflowId || '',
    sharedBy: input.sharedBy,
    sharedByName: input.sharedByName || '',
    title: input.title,
    description: input.description,
    link: input.link,
    image: input.image || '',
    timestamp: new Date().toISOString(),
    platformUrls: input.platformUrls,
    tickers: input.tickers || [],
    sectors: input.sectors || [],
    boosts: [], comments: [], upvotes: [], reposts: [],
    engagementScore: 0,
    discordMessageId: '',
    discordChannelId: '',
    engagementMessageId: '',
    engagementChannelId: '',
    sourceMessageId: input.sourceMessageId || '',
    commentIdeas: input.commentIdeas || [],
    externalPosts: [],
    deliveryStatus: 'pending',
    deliveryError: '',
    automated: Boolean(input.automated),
  };
  await mutateJson(paths.posts, [], (posts) => posts.push(post));
  if (!input.skipOwnerCredit) {
    await mutateJson(paths.users, {}, (users) => {
      const user = touchUser(users, input.sharedBy, input.sharedByName);
      user.shares += 1;
      user.xp += XP.share;
      user.level = levelFor(user.xp);
    });
  }
  return post;
}

export async function bindDiscordMessage(postID, message) {
  return mutateJson(paths.posts, [], (posts) => {
    const post = posts.find((row) => row.postID === postID);
    if (post) {
      post.discordMessageId = message.id;
      post.discordChannelId = message.channelId;
    }
  });
}

export async function bindEngagementMessage(postID, message) {
  return mutateJson(paths.posts, [], (posts) => {
    const post = posts.find((row) => row.postID === postID);
    if (post) {
      post.engagementMessageId = message.id;
      post.engagementChannelId = message.channelId;
      if (post.discordMessageId) post.deliveryStatus = 'delivered';
    }
  });
}

export async function postByMessage(messageId) {
  return (await readJson(paths.posts, [])).find((post) => post.discordMessageId === messageId || post.engagementMessageId === messageId) || null;
}

export async function postById(postID) {
  return (await readJson(paths.posts, [])).find((post) => post.postID === postID) || null;
}

export async function recentPostByLink(link, hours = 24, workflowId = '') {
  const after = Date.now() - Math.max(1, Number(hours) || 24) * 3_600_000;
  return (await readJson(paths.posts, [])).find((post) => (
    post.link === link &&
    /* Scoped per workflow when the caller says which one: each ambassador
       program packages an article in its own channels, but never twice in the
       same one. Legacy rows without a workflowId still match everywhere, so
       history keeps suppressing until it ages out of the window. */
    (!workflowId || !post.workflowId || post.workflowId === workflowId) &&
    Date.parse(post.timestamp) >= after &&
    (post.deliveryStatus === 'delivered' || (post.discordMessageId && post.engagementMessageId))
  )) || null;
}

export async function failTrackedPost(postID, error) {
  let owner = null;
  let shouldRollback = false;
  await mutateJson(paths.posts, [], (posts) => {
    const post = posts.find((row) => row.postID === postID);
    if (!post || post.deliveryStatus === 'failed') return;
    owner = post.sharedBy;
    shouldRollback = true;
    post.deliveryStatus = 'failed';
    post.deliveryError = String(error || 'Delivery failed').slice(0, 300);
  });
  if (!shouldRollback || !owner) return;
  await mutateJson(paths.users, {}, (users) => {
    const user = users[owner];
    if (!user) return;
    user.shares = Math.max(0, (user.shares || 0) - 1);
    user.xp = Math.max(0, (user.xp || 0) - XP.share);
    user.level = levelFor(user.xp);
  });
}

export async function recordOutboundIntent({ postID, userId, userName, platform, eventId }) {
  let changed = false;
  await mutateJson(paths.outboundEvents, [], (events) => {
    if (events.some((event) => event.eventId === eventId)) return;
    events.push({
      eventId,
      postID,
      userId,
      userName: String(userName || '').slice(0, 100),
      platform,
      type: 'platform_intent_opened',
      timestamp: new Date().toISOString(),
    });
    changed = true;
  });
  return changed;
}

export async function recentUnreturnedOutboundIntent({ userId, platform, withinHours = 6 }) {
  const cutoff = Date.now() - Math.max(1, Number(withinHours) || 6) * 3_600_000;
  const [events, posts] = await Promise.all([
    readJson(paths.outboundEvents, []),
    readJson(paths.posts, []),
  ]);
  const byId = new Map(posts.map((post) => [post.postID, post]));
  const latest = events
    .filter((event) => (
      event.userId === userId &&
      event.platform === platform &&
      Date.parse(event.timestamp) >= cutoff
    ))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
  if (!latest) return null;
  const post = byId.get(latest.postID);
  if (!post || (post.externalPosts || []).some((entry) => entry.userId === userId && entry.platform === platform)) return null;
  return latest;
}

export async function recordExternalPostLink({ postID, userId, userName, platform, url }) {
  let result = null;
  await mutateJson(paths.posts, [], (posts) => {
    const post = posts.find((row) => row.postID === postID);
    if (!post) return;
    post.externalPosts ||= [];
    const existing = posts.flatMap((row) => row.externalPosts || []).find((entry) => entry.platform === platform && entry.url === url);
    if (existing) {
      result = { changed: false, entry: existing };
      return;
    }
    const entry = {
      id: randomUUID(),
      userId,
      userName: String(userName || '').slice(0, 100),
      platform,
      url,
      timestamp: new Date().toISOString(),
      verification: 'user_submitted',
    };
    post.externalPosts.push(entry);
    result = { changed: true, entry };
  });
  return result;
}

export async function recordEngagement({ postID, userId, userName, type, eventId, content = '', remove = false }) {
  const field = `${type}s`;
  if (!['boosts', 'comments', 'upvotes', 'reposts'].includes(field)) return false;
  let changed = false;
  await mutateJson(paths.posts, [], (posts) => {
    const post = posts.find((row) => row.postID === postID);
    if (!post) return;
    const index = post[field].findIndex((entry) => entry.eventId === eventId);
    if (remove && index >= 0) {
      post[field].splice(index, 1);
      changed = true;
    } else if (!remove && index < 0) {
      post[field].push({ eventId, userId, userName, content: String(content).slice(0, 500), timestamp: new Date().toISOString() });
      changed = true;
    }
    recalcPost(post);
  });
  if (!changed) return false;
  await mutateJson(paths.users, {}, (users) => {
    const user = touchUser(users, userId, userName);
    const delta = remove ? -1 : 1;
    user[field] = Math.max(0, user[field] + delta);
    user.xp = Math.max(0, user.xp + delta * XP[type]);
    user.engagementScore = user.boosts * 5 + user.comments * 8 + user.upvotes * 6 + user.reposts * 12;
    user.level = levelFor(user.xp);
  });
  return true;
}

export async function getTrackingData() {
  return Promise.all([readJson(paths.users, {}), readJson(paths.posts, [])]).then(([users, posts]) => ({ users, posts }));
}
