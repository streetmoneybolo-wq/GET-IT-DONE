import { mutateJson, paths } from './storage.js';

const DEFAULT_CHANNEL_IDS = ['938944129348558848', '1509325055849529455'];
const MAX_TELEGRAM_TEXT = 3900;

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
  return {
    enabled: cfg.enabled !== false,
    botToken: process.env.TELEGRAM_BOT_TOKEN || process.env.TG_BOT_TOKEN || cfg.botToken || '',
    chatId: process.env.TELEGRAM_CHAT_ID || process.env.TG_CHAT_ID || cfg.chatId || '',
    channelIds: configuredChannelIds(settings),
    allowBotChannelIds: new Set((cfg.allowBotChannelIds || []).map((id) => String(id || '').trim()).filter(Boolean)),
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

async function sendTelegramMessage({ botToken, chatId, text }) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
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
    if (!log.sent[key]) {
      shouldSend = true;
      log.sent[key] = {
        status: 'pending',
        eventType,
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        observedAt: new Date().toISOString(),
      };
    }
  });
  if (!shouldSend) return true;

  try {
    const result = await sendTelegramMessage({
      botToken: config.botToken,
      chatId: config.chatId,
      text: buildTelegramText(message),
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
