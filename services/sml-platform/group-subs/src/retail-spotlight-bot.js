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
    configurations = new Map();
    for (const row of body.groups || []) {
      const key = `${row.guild_id}:${row.channel_id}`;
      const rows = configurations.get(key) || [];
      rows.push(row);
      configurations.set(key, rows);
    }
    return [...configurations.values()].reduce((sum, rows) => sum + rows.length, 0);
  }

  async function onMessage(message) {
    if (!message || message.author?.bot) return { ignored: 'bot_or_empty' };
    const key = `${message.guildId || ''}:${message.channelId || ''}`;
    const configs = configurations.get(key);
    if (!configs) return { ignored: 'channel_not_monitored' };
    const eligibleConfigs = configs.filter((config) => (config.monitored_users || []).some((row) => String(row.id) === String(message.author.id)));
    if (!eligibleConfigs.length) return { ignored: 'user_not_monitored' };
    const ticker = tickerFromMessage(message.content);
    if (!ticker) return { ignored: 'requires_exactly_one_dollar_ticker' };
    const results = [];
    let newsroomQueued = false;
    for (const config of eligibleConfigs) {
      const accepted = await request(`${wordpressBase.replace(/\/$/, '')}/wp-json/sml-retail-spotlight/v1/bot/alerts`, {
        method: 'POST',
        headers: { authorization: wordpressAuthorization, 'content-type': 'application/json' },
        body: JSON.stringify({
          group_id: config.group_id, guild_id: message.guildId, channel_id: message.channelId, message_id: message.id,
          user_id: message.author.id, display_name: message.member?.displayName || message.author.globalName || message.author.username,
          ticker, alert_text: message.content, alerted_at: message.createdAt?.toISOString?.() || new Date().toISOString()
        })
      });
      if (accepted.duplicate || !accepted.source_url) {
        results.push({ accepted: true, duplicate: true, group_id: config.group_id });
        continue;
      }
      if (!newsroomQueued) {
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
        newsroomQueued = true;
      }
      results.push({ accepted: true, duplicate: false, event_uuid: accepted.event_uuid, group_id: config.group_id });
    }
    return results.length === 1 ? results[0] : { accepted: results.some((row) => row.accepted), results };
  }

  return { refresh, onMessage, tickerFromMessage };
}

module.exports = { createRetailSpotlightBot, tickerFromMessage };
