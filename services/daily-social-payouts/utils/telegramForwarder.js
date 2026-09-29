import { mutateJson, paths } from './storage.js';

const DEFAULT_CHANNEL_IDS = ['938944129348558848', '1509325055849529455'];
const MAX_TELEGRAM_TEXT = 3900;
// A send that failed (Telegram 429/5xx, network) or that never finished (the process died while
// the record was 'pending') is retried the next time the same message is seen — an edit, or a
// restart replaying it — up to MAX_ATTEMPTS, so one bad moment does not drop an alert for good
// while a permanently rejected message cannot be retried forever.
const MAX_ATTEMPTS = 3;
const STALE_PENDING_MS = 10 * 60_000;
const warnedNoTopic = new Set();

function clean(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/@everyone/g, 'Everyone')
    .replace(/@here/g, 'Here')
    .trim();
}

function configuredChannelIds(settings) {
  const configured = settings.telegramForward?.channelIds;
  const monitor = settings.alertMonitor?.channelIds;
  return new Set(
    (Array.isArray(configured) && configured.length ? configured : [...DEFAULT_CHANNEL_IDS, ...(Array.isArray(monitor) ? monitor : [])])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );
}

function telegramConfig(settings) {
  const cfg = settings.telegramForward || {};
  const channelIds = configuredChannelIds(settings);
  const topicByChannel = cfg.topicByChannel && typeof cfg.topicByChannel === 'object' ? cfg.topicByChannel : {};
  // The channel list and the topic map are kept by hand as separate lists: say so once when they
  // disagree, instead of silently routing that channel's alerts to the forum's General topic.
  if (Object.keys(topicByChannel).length) {
    for (const id of channelIds) {
      if (!(id in topicByChannel) && !warnedNoTopic.has(id)) { warnedNoTopic.add(id); console.warn(`Telegram forward: channel ${id} has no topicByChannel entry; its alerts will land in the forum's General topic.`); }
    }
  }
  return {
    enabled: cfg.enabled !== false,
    botToken: process.env.TELEGRAM_BOT_TOKEN || process.env.TG_BOT_TOKEN || cfg.botToken || '',
    chatId: process.env.TELEGRAM_CHAT_ID || process.env.TG_CHAT_ID || cfg.chatId || '',
    channelIds,
    allowBotChannelIds: new Set((cfg.allowBotChannelIds || []).map((id) => String(id || '').trim()).filter(Boolean)),
    topicByChannel,
  };
}

function messageUrl(message) {
  if (!message.guildId || !message.channelId || !message.id) return '';
  return `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
}

function buildTelegramText(message) {
  const channelName = message.channel?.name ? `#${message.channel.name}` : `channel ${message.channelId}`;
  const author = message.member?.displayName || message.author?.globalName || message.author?.username || 'Discord alert';
  const content = clean(message.content);
  const jump = messageUrl(message);
  const parts = [
    `🚨 Making Easy Money Alert`,
    `${channelName} · ${author}`,
    '',
    content || '(alert contained no text)',
  ];
  if (jump) parts.push('', `Source: ${jump}`);
  const text = parts.join('\n');
  return text.length > MAX_TELEGRAM_TEXT ? `${text.slice(0, MAX_TELEGRAM_TEXT - 1)}…` : text;
}

async function sendTelegramMessage({ botToken, chatId, text, messageThreadId }) {
  const payload = { chat_id: chatId, text, disable_web_page_preview: true };
  // Topic 1 is a forum's General topic, which the Bot API addresses by OMITTING message_thread_id
  // (passing 1 is rejected with "message thread not found"); a plain message lands there anyway.
  if (Number.isSafeInteger(messageThreadId) && messageThreadId > 1) payload.message_thread_id = messageThreadId;
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Telegram send failed ${response.status}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

export async function forwardAlertToTelegram(message, settings, eventType = 'created') {
  if (!message?.guildId) return false;
  const config = telegramConfig(settings);
  if (!config.enabled || !config.channelIds.has(message.channelId)) return false;
  if (message.author?.bot && !config.allowBotChannelIds.has(message.channelId)) return false;
  if (!message.content && !message.attachments?.size) return true;
  if (!config.botToken || !config.chatId) {
    console.warn('Telegram forward skipped: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required.');
    return true;
  }

  const key = `${message.guildId}:${message.channelId}:${message.id}`;
  let shouldSend = false;
  await mutateJson(paths.telegramForwardLog, { sent: {} }, (log) => {
    log.sent ||= {};
    const prior = log.sent[key];
    const attempts = prior?.attempts || (prior ? 1 : 0);
    const stalePending = prior?.status === 'pending' && Date.now() - (Date.parse(prior.observedAt || '') || 0) > STALE_PENDING_MS;
    const retryable = (prior?.status === 'failed' || stalePending) && attempts < MAX_ATTEMPTS;
    if (!prior || retryable) {
      shouldSend = true;
      log.sent[key] = {
        ...(prior || {}),
        status: 'pending',
        eventType,
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        observedAt: new Date().toISOString(),
        attempts: attempts + 1,
      };
    }
  });
  if (!shouldSend) return true;

  try {
    const result = await sendTelegramMessage({
      botToken: config.botToken,
      chatId: config.chatId,
      text: buildTelegramText(message),
      messageThreadId: Number.parseInt(config.topicByChannel[String(message.channelId)], 10),
    });
    await mutateJson(paths.telegramForwardLog, { sent: {} }, (log) => {
      log.sent ||= {};
      log.sent[key] = {
        ...(log.sent[key] || {}),
        status: 'sent',
        telegramMessageId: result?.result?.message_id || null,
        sentAt: new Date().toISOString(),
      };
    });
    console.log(`Forwarded Discord alert ${message.id} to Telegram.`);
  } catch (error) {
    await mutateJson(paths.telegramForwardLog, { sent: {} }, (log) => {
      log.sent ||= {};
      log.sent[key] = {
        ...(log.sent[key] || {}),
        status: 'failed',
        failedAt: new Date().toISOString(),
        error: String(error.message || error).slice(0, 500),
      };
    });
    console.error(`Telegram forward failed safely for Discord message ${message.id}:`, error.message || error);
  }
  return true;
}
