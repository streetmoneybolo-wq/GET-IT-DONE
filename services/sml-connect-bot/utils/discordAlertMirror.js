import { mutateJson, paths } from './storage.js';

function channelMirrors(settings) {
  const configured = settings.discordAlertMirror?.channels;
  const channels = Array.isArray(configured) && configured.length ? configured : [];
  return channels
    .map((entry) => ({
      sourceGuildId: String(entry.sourceGuildId || '').trim(),
      sourceChannelId: String(entry.sourceChannelId || '').trim(),
      targetGuildId: String(entry.targetGuildId || '').trim(),
      targetChannelId: String(entry.targetChannelId || '').trim(),
      label: String(entry.label || '').trim(),
      footer: String(entry.footer || '').trim(),
    }))
    .filter((entry) => entry.sourceChannelId && entry.targetChannelId);
}

function cleanContent(text) {
  return String(text || '')
    .replace(/@everyone/g, 'Everyone')
    .replace(/@here/g, 'Here')
    .trim();
}

function messageUrl(message) {
  if (!message.guildId || !message.channelId || !message.id) return '';
  return `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
}

function buildMirroredContent(message, mirror) {
  const content = cleanContent(message.content);
  const author = message.member?.displayName || message.author?.globalName || message.author?.username || 'Making Easy Money';
  const source = messageUrl(message);
  const header = mirror.label ? `**${mirror.label}**` : '**Making Easy Money Alert**';
  const parts = [header, `Posted by ${author}`];
  if (content) parts.push('', content);
  if (mirror.footer) parts.push('', cleanContent(mirror.footer));
  if (source) parts.push('', `Source: ${source}`);
  return parts.join('\n').slice(0, 1900);
}

function attachmentLinks(message) {
  return [...(message.attachments?.values?.() || [])]
    .map((attachment) => attachment.url)
    .filter(Boolean);
}

export async function mirrorAlertToDiscord(message, settings, eventType = 'created') {
  if (!message?.guildId || message.author?.bot) return false;
  const config = settings.discordAlertMirror || {};
  if (config.enabled === false) return false;
  const mirror = channelMirrors(settings).find((entry) => (
    entry.sourceChannelId === message.channelId
    && (!entry.sourceGuildId || entry.sourceGuildId === message.guildId)
  ));
  if (!mirror) return false;
  if (!message.content && !message.attachments?.size && !message.embeds?.length) return true;

  const key = `${message.guildId}:${message.channelId}:${message.id}`;
  let shouldSend = false;
  await mutateJson(paths.discordAlertMirrorLog, { sent: {} }, (log) => {
    log.sent ||= {};
    if (!log.sent[key]) {
      shouldSend = true;
      log.sent[key] = {
        status: 'pending',
        eventType,
        sourceGuildId: message.guildId,
        sourceChannelId: message.channelId,
        sourceMessageId: message.id,
        targetGuildId: mirror.targetGuildId || null,
        targetChannelId: mirror.targetChannelId,
        observedAt: new Date().toISOString(),
      };
    }
  });
  if (!shouldSend) return true;

  const target = await message.client.channels.fetch(mirror.targetChannelId).catch(() => null);
  if (!target?.isTextBased()) {
    await mutateJson(paths.discordAlertMirrorLog, { sent: {} }, (log) => {
      log.sent ||= {};
      log.sent[key] = {
        ...(log.sent[key] || {}),
        status: 'failed',
        failedAt: new Date().toISOString(),
        error: `Target channel unavailable: ${mirror.targetChannelId}`,
      };
    });
    console.warn(`Discord alert mirror skipped: target channel unavailable ${mirror.targetChannelId}.`);
    return true;
  }

  try {
    let content = buildMirroredContent(message, mirror);
    const links = attachmentLinks(message);
    if (links.length) content = `${content}\n\n${links.join('\n')}`.slice(0, 2000);
    const sent = await target.send({
      content,
      allowedMentions: { parse: [] },
    });
    await mutateJson(paths.discordAlertMirrorLog, { sent: {} }, (log) => {
      log.sent ||= {};
      log.sent[key] = {
        ...(log.sent[key] || {}),
        status: 'sent',
        mirroredMessageId: sent.id,
        sentAt: new Date().toISOString(),
      };
    });
    console.log(`Mirrored Discord alert ${message.id} to ${mirror.targetChannelId}.`);
  } catch (error) {
    await mutateJson(paths.discordAlertMirrorLog, { sent: {} }, (log) => {
      log.sent ||= {};
      log.sent[key] = {
        ...(log.sent[key] || {}),
        status: 'failed',
        failedAt: new Date().toISOString(),
        error: String(error.message || error).slice(0, 500),
      };
    });
    console.error(`Discord alert mirror failed safely for ${message.id}:`, error.message || error);
  }
  return true;
}
