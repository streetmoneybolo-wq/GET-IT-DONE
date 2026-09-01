'use strict';
const crypto = require('node:crypto');
const { validateAssignment } = require('./editorial-desks');

function createSpotlightIntake({ config, database, fetchImpl = fetch, logger = () => {} }) {
  const base = config.wordpressUrl.replace(/\/$/, '');
  const authorization = `Basic ${Buffer.from(`${config.wordpressUsername}:${config.wordpressAppPassword}`).toString('base64')}`;
  async function request(path, options = {}) {
    const response = await fetchImpl(`${base}${path}`, { ...options, headers: { authorization, 'content-type': 'application/json', ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.message || `WordPress ${response.status}`), { status: response.status });
    return body;
  }
  async function run() {
    const pending = await request('/wp-json/sml-retail-spotlight/v1/newsroom/pending');
    let accepted = 0;
    for (const event of (pending.events || []).slice(0, 20)) {
      const occurredAt = new Date(`${event.alerted_at}Z`).toISOString();
      const assignment = validateAssignment({ ticker: `$${event.ticker}`, eventType: 'retail_trader_alert', sourceEventId: event.source_event_key, occurredAt, importanceScore: 80 });
      const result = await database.enqueueNewsArticle({
        sourceUrl: event.source_url,
        sourceUrlHash: crypto.createHash('sha256').update(event.source_url, 'utf8').digest('hex'),
        sourceEventKey: event.source_event_key,
        editorialDesk: assignment.desk.key,
        topicFingerprint: assignment.fingerprint,
        subjectFingerprint: assignment.subjectFingerprint,
        contentKind: assignment.contentKind,
        marketSnapshot: { ticker: `$${event.ticker}`, alerted_at: occurredAt, group_id: Number(event.group_id), trader_display_name: event.discord_display_name },
        officialSources: []
      });
      await request('/wp-json/sml-retail-spotlight/v1/newsroom/ack', { method: 'POST', body: JSON.stringify({ event_uuid: event.event_uuid }) });
      accepted += result.status === 'accepted' ? 1 : 0;
    }
    if (pending.events?.length) logger('info', 'spotlight_events_claimed', { found: pending.events.length, accepted });
    return accepted;
  }
  return { run };
}

module.exports = { createSpotlightIntake };
