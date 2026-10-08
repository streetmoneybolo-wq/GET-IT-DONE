import { mutateJson, paths, readJson, readSettings } from './storage.js';

const DEFAULT_SITE = 'https://stockmarketloop.com';
const DEFAULT_POLL_SECONDS = 120;
const MAX_TELEGRAM_TEXT = 3900;

let timer = null;
let running = false;

function stripHtml(value) {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function cfg(settings) {
  const local = settings.telegramNewsForward || {};
  return {
    enabled: local.enabled !== false,
    botToken: process.env.TELEGRAM_BOT_TOKEN || process.env.TG_BOT_TOKEN || local.botToken || '',
    chatId: process.env.TELEGRAM_CHAT_ID || process.env.TG_CHAT_ID || local.chatId || settings.telegramForward?.chatId || '',
    messageThreadId: Number(process.env.TELEGRAM_SML_NEWS_THREAD_ID || local.messageThreadId || 0) || null,
    site: String(local.site || DEFAULT_SITE).replace(/\/+$/, ''),
    pollIntervalSeconds: Math.max(30, Number(local.pollIntervalSeconds || DEFAULT_POLL_SECONDS)),
    authors: new Set((local.authors || ['SML News']).map((name) => String(name || '').trim().toLowerCase()).filter(Boolean)),
    maxAgeHours: Math.max(1, Number(local.maxAgeHours || 72)),
  };
}

function postAuthorName(post) {
  const author = post?._embedded?.author?.[0];
  return String(author?.name || author?.slug || '').trim();
}

function isSmlNewsPost(post, config) {
  const name = postAuthorName(post).toLowerCase();
  return config.authors.has(name);
}

function postDateMs(post) {
  return Date.parse(post?.date_gmt ? `${post.date_gmt}Z` : post?.date || '') || 0;
}

function buildText(post) {
  const title = stripHtml(post?.title?.rendered);
  const excerpt = stripHtml(post?.excerpt?.rendered);
  const link = String(post?.link || '').trim();
  const parts = [
    '📰 SML News',
    title,
  ];
  if (excerpt) parts.push('', excerpt);
  if (link) parts.push('', link);
  const text = parts.join('\n');
  return text.length > MAX_TELEGRAM_TEXT ? `${text.slice(0, MAX_TELEGRAM_TEXT - 1)}…` : text;
}

async function fetchRecentPosts(config) {
  const url = new URL(`${config.site}/wp-json/wp/v2/posts`);
  url.searchParams.set('per_page', '20');
  url.searchParams.set('status', 'publish');
  url.searchParams.set('_embed', '1');
  url.searchParams.set('orderby', 'date');
  url.searchParams.set('order', 'desc');
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`WordPress posts feed failed ${response.status}`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

async function sendTelegram(config, post) {
  const body = {
    chat_id: config.chatId,
    text: buildText(post),
    disable_web_page_preview: false,
  };
  if (config.messageThreadId) body.message_thread_id = config.messageThreadId;
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(`Telegram news send failed ${response.status}`);
  return data.result;
}

export async function forwardLatestSmlNewsToTelegram({ force = false } = {}) {
  const settings = await readSettings();
  const config = cfg(settings);
  if (!config.enabled) return { skipped: 'disabled', sent: 0 };
  if (!config.botToken || !config.chatId) return { skipped: 'missing-telegram-env', sent: 0 };

  const log = await readJson(paths.telegramNewsForwardLog, { sent: {} });
  const newestAllowed = Date.now() - (config.maxAgeHours * 60 * 60 * 1000);
  const posts = (await fetchRecentPosts(config))
    .filter((post) => post?.id && isSmlNewsPost(post, config))
    .filter((post) => force || postDateMs(post) >= newestAllowed)
    .sort((a, b) => postDateMs(a) - postDateMs(b));

  let sent = 0;
  for (const post of posts) {
    const key = String(post.id);
    if (log.sent?.[key]?.status === 'sent') continue;
    let claimed = false;
    await mutateJson(paths.telegramNewsForwardLog, { sent: {} }, (state) => {
      state.sent ||= {};
      if (state.sent[key]?.status === 'sent' || state.sent[key]?.status === 'pending') return;
      claimed = true;
      state.sent[key] = {
        status: 'pending',
        postId: post.id,
        link: post.link || '',
        observedAt: new Date().toISOString(),
      };
    });
    if (!claimed) continue;
    try {
      const result = await sendTelegram(config, post);
      sent += 1;
      await mutateJson(paths.telegramNewsForwardLog, { sent: {} }, (state) => {
        state.sent ||= {};
        state.sent[key] = {
          ...(state.sent[key] || {}),
          status: 'sent',
          telegramMessageId: result?.message_id || null,
          messageThreadId: result?.message_thread_id || config.messageThreadId || null,
          sentAt: new Date().toISOString(),
        };
      });
      console.log(`Forwarded SML News post ${post.id} to Telegram topic.`);
    } catch (error) {
      await mutateJson(paths.telegramNewsForwardLog, { sent: {} }, (state) => {
        state.sent ||= {};
        state.sent[key] = {
          ...(state.sent[key] || {}),
          status: 'failed',
          failedAt: new Date().toISOString(),
          error: String(error.message || error).slice(0, 500),
        };
      });
      console.error(`SML News Telegram forward failed safely for post ${post.id}:`, error.message || error);
    }
  }
  return { sent, checked: posts.length };
}

export function startSmlNewsTelegramForwarder(pollSeconds = null) {
  if (timer) clearInterval(timer);
  const intervalMs = Math.max(30, Number(pollSeconds || DEFAULT_POLL_SECONDS)) * 1000;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await forwardLatestSmlNewsToTelegram();
    } catch (error) {
      console.error('SML News Telegram polling failed safely:', error.message || error);
    } finally {
      running = false;
    }
  };
  setTimeout(run, 5000);
  timer = setInterval(run, intervalMs);
  return timer;
}
