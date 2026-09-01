'use strict';

/* Adapter for the existing Discord bot. It never stores credentials and never
 * reads arbitrary servers: WordPress returns only paid, verified configurations. */
function tickerFromMessage(content) {
  const matches = [...String(content || '').toUpperCase().matchAll(/\$([A-Z][A-Z0-9.-]{0,9})\b/g)].map((match) => match[1]);
  return [...new Set(matches)].length === 1 ? [...new Set(matches)][0] : null;
}

function createRetailSpotlightBot({ wordpressBase, wordpressAuthorization, newsroomBase, newsIngestToken, fetchImpl = fetch }) {
  if (!wordpressBase || !wordpressAuthorization || !newsroomBase || !newsIngestToken) throw new Error('Retail Spotlight bot credentials are required');
  let configurations = new Map();

  async function request(url, options = {}) {
    const response = await fetchImpl(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.message || body.error || `HTTP ${response.status}`), { status: response.status, body });
    return body;
  }

  async function refresh() {
    const body = await request(`${wordpressBase.replace(/\/$/, '')}/wp-json/sml-retail-spotlight/v1/bot/configured-groups`, {
      headers: { authorization: wordpressAuthorization }
    });
    configurations = new Map((body.groups || []).map((row) => [`${row.guild_id}:${row.channel_id}`, row]));
    return configurations.size;
  }

  async function onMessage(message) {
    if (!message || message.author?.bot) return { ignored: 'bot_or_empty' };
    const key = `${message.guildId || ''}:${message.channelId || ''}`;
    const config = configurations.get(key);
    if (!config) return { ignored: 'channel_not_monitored' };
    if (!(config.monitored_users || []).some((row) => String(row.id) === String(message.author.id))) return { ignored: 'user_not_monitored' };
    const ticker = tickerFromMessage(message.content);
    if (!ticker) return { ignored: 'requires_exactly_one_dollar_ticker' };
    const accepted = await request(`${wordpressBase.replace(/\/$/, '')}/wp-json/sml-retail-spotlight/v1/bot/alerts`, {
      method: 'POST',
      headers: { authorization: wordpressAuthorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        guild_id: message.guildId, channel_id: message.channelId, message_id: message.id,
        user_id: message.author.id, display_name: message.member?.displayName || message.author.globalName || message.author.username,
        ticker, alert_text: message.content, alerted_at: message.createdAt?.toISOString?.() || new Date().toISOString()
      })
    });
    if (accepted.duplicate || !accepted.source_url) return { accepted: true, duplicate: true };
    const eventKey = `discord:${message.guildId}:${message.id}`;
    await request(`${newsroomBase.replace(/\/$/, '')}/v1/news/articles`, {
      method: 'POST',
      headers: { authorization: `Bearer ${newsIngestToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        source_url: accepted.source_url,
        source_event_key: eventKey,
        market_event: {
          ticker: `$${ticker}`, eventType: 'retail_trader_alert', sourceEventId: eventKey,
          occurredAt: message.createdAt?.toISOString?.() || new Date().toISOString(), importanceScore: 80
        }
      })
    });
    return { accepted: true, duplicate: false, event_uuid: accepted.event_uuid };
  }

  return { refresh, onMessage, tickerFromMessage };
}

module.exports = { createRetailSpotlightBot, tickerFromMessage };
