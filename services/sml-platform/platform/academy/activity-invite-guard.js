'use strict';

const DISCORD_API = 'https://discord.com/api/v10';
const DEFAULT_ALLOWED_CHANNEL_ID = '1551147441993285692';

function activityApplicationId(message) {
  return String(message?.application?.id || message?.application_id ||
    message?.interaction_metadata?.application_id || message?.interaction?.application_id || '');
}

function isAcademyActivityInvite(message, applicationId) {
  return Number(message?.type) === 23 && activityApplicationId(message) === String(applicationId || '');
}

function createDiscordClient(token, fetchImpl = fetch) {
  return async function discord(path, { method = 'GET' } = {}) {
    const response = await fetchImpl(`${DISCORD_API}${path}`, {
      method,
      headers: { Authorization: `Bot ${token}` }
    });
    const raw = await response.text();
    const payload = raw ? JSON.parse(raw) : null;
    if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${raw.slice(0, 500)}`);
    return payload;
  };
}

/**
 * Discord Activity entry points create public type-23 invitation messages.
 * Academy study state is private and keyed by Discord member ID, so the only
 * public invitation that should remain is one stable entry card in the Daily
 * Financial Briefing channel. New invitations elsewhere are removed on the
 * next guard pass; duplicate invitations in the allowed channel are collapsed
 * to the newest one.
 */
async function enforceAcademyActivityInvites({
  token,
  guildId,
  categoryId,
  applicationId,
  allowedChannelId = DEFAULT_ALLOWED_CHANNEL_ID,
  apply = true,
  fetchImpl
} = {}) {
  token = String(token || '').trim();
  guildId = String(guildId || '').trim();
  categoryId = String(categoryId || '').trim();
  applicationId = String(applicationId || '').trim();
  allowedChannelId = String(allowedChannelId || '').trim();
  if (!token || ![guildId, categoryId, applicationId, allowedChannelId].every((value) => /^\d{15,24}$/.test(value))) {
    throw new Error('Academy token, guild, category, application, and allowed channel IDs are required');
  }

  const discord = createDiscordClient(token, fetchImpl);
  const channels = await discord(`/guilds/${guildId}/channels`);
  const academyChannels = channels.filter((channel) => channel.parent_id === categoryId && Number(channel.type) === 0);
  const deletions = [];
  const kept = [];

  for (const channel of academyChannels) {
    const messages = await discord(`/channels/${channel.id}/messages?limit=100`);
    const invitations = messages
      .filter((message) => isAcademyActivityInvite(message, applicationId))
      .sort((left, right) => BigInt(right.id) > BigInt(left.id) ? 1 : -1);
    const removable = channel.id === allowedChannelId ? invitations.slice(1) : invitations;
    if (channel.id === allowedChannelId && invitations[0]) kept.push({ channelId: channel.id, messageId: invitations[0].id });
    for (const message of removable) {
      deletions.push({ channelId: channel.id, messageId: message.id });
      if (apply) await discord(`/channels/${channel.id}/messages/${message.id}`, { method: 'DELETE' });
    }
  }

  return { applied: apply, allowedChannelId, scannedChannels: academyChannels.length, kept, deletions };
}

function scheduleAcademyActivityInviteGuard(options, { intervalMs = 60_000, logger = () => {} } = {}) {
  let running = false;
  const run = async () => {
    if (running) return null;
    running = true;
    try {
      const result = await enforceAcademyActivityInvites(options);
      if (result.deletions.length) logger('info', 'academy_activity_invites_cleaned', { deleted: result.deletions.length });
      return result;
    } catch (error) {
      logger('error', 'academy_activity_invite_guard_failed', { error });
      return null;
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(run, Math.max(15_000, Number(intervalMs) || 60_000));
  timer.unref?.();
  return { run, stop: () => clearInterval(timer) };
}

module.exports = {
  DEFAULT_ALLOWED_CHANNEL_ID,
  activityApplicationId,
  isAcademyActivityInvite,
  enforceAcademyActivityInvites,
  scheduleAcademyActivityInviteGuard
};
