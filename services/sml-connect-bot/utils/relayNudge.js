import { wpRequest } from './wordpressClient.js';

// Instant Discord -> stockmarketloop.com group sync. The site polls linked channels once a minute;
// this bot already sees every message live, so it tells the site "channel X has something new" and
// the site pulls that one channel at once (same safety checks and duplicate guard as the minute poll).
// If this bot is offline, nothing is lost: the minute poll still picks everything up.

const watched = new Set();
const pending = new Map(); // channelId -> timer (one nudge per channel per burst)
let lastRefresh = 0;

export async function refreshRelayChannels() {
  try {
    const result = await wpRequest('/wp-json/sml-discord-site/v2/bot/relay-channels');
    watched.clear();
    for (const id of result.channels || []) if (/^\d{15,24}$/.test(String(id))) watched.add(String(id));
    lastRefresh = Date.now();
  } catch (error) {
    console.error('Relay channel list refresh failed safely:', error.message || error);
  }
  return watched.size;
}

export function startRelayNudges() {
  refreshRelayChannels().then((n) => console.log(`Instant group sync watching ${n} Discord channel(s).`));
  // owners change their links in Edit Group; pick that up every 2 minutes
  setInterval(() => { refreshRelayChannels(); }, 120_000).unref();
}

async function send(channelId, attempt = 1) {
  try {
    await wpRequest('/wp-json/sml-discord-site/v2/bot/relay-nudge', { method: 'POST', body: JSON.stringify({ channel_id: channelId }) });
  } catch (error) {
    if (attempt < 3) { setTimeout(() => send(channelId, attempt + 1), 1500 * attempt); return; }
    console.error(`Instant group sync nudge failed safely for ${channelId} (the minute sync will catch it):`, error.message || error);
  }
}

export function nudgeRelay(message) {
  if (!message?.guildId || !watched.has(String(message.channelId))) return;
  if (message.author?.bot || message.webhookId) return; // the site never imports these anyway
  if (Date.now() - lastRefresh > 600_000) refreshRelayChannels();
  const id = String(message.channelId);
  if (pending.has(id)) return; // a burst of messages = one pull
  pending.set(id, setTimeout(() => { pending.delete(id); send(id); }, 400));
}
