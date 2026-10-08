import { ThreadAutoArchiveDuration } from 'discord.js';
import { mutateJson, paths, readJson } from './storage.js';

const inflight = new Map();

export function workThreadName(username) {
  const clean = String(username || 'member')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'member';
  return `work-${clean}`;
}

async function findThread(client, userId) {
  const map = await readJson(paths.workThreads, {});
  const id = map[userId]?.threadId;
  if (!id) return null;
  const thread = await client.channels.fetch(id).catch(() => null);
  if (!thread?.isThread?.()) return null;
  if (thread.archived) await thread.setArchived(false, 'New social work item').catch(() => null);
  return thread;
}

async function createOrFind({ client, parentChannel, user }) {
  const existing = await findThread(client, user.id);
  if (existing) return existing;
  const thread = await parentChannel.threads.create({
    name: workThreadName(user.username),
    autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    reason: `Persistent social-work history for Discord user ${user.id}`,
  });
  await thread.members.add(user.id).catch(() => null);
  await thread.send({
    content: `<@${user.id}> this is your personal social-work history. Every finished external post link you return to the bot will appear here. This is a public server thread; never paste passwords, tokens, or private account information.`,
    allowedMentions: { users: [user.id] },
  });
  await mutateJson(paths.workThreads, {}, (map) => {
    map[user.id] = {
      threadId: thread.id,
      parentChannelId: parentChannel.id,
      username: user.username,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    };
  });
  return thread;
}

export async function getOrCreateUserWorkThread(input) {
  const key = input.user.id;
  if (inflight.has(key)) return inflight.get(key);
  const promise = createOrFind(input).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

export async function touchUserWorkThread(userId) {
  await mutateJson(paths.workThreads, {}, (map) => {
    if (map[userId]) map[userId].lastUsedAt = new Date().toISOString();
  });
}
