'use strict';

const { createHash } = require('node:crypto');
const { basicAuth } = require('./wordpress-publisher');

function isSpotlightSource(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://stockmarketloop.com' && !url.username && !url.password &&
      /^\/wp-json\/sml-retail-spotlight\/v1\/source\/[a-f0-9-]{36}$/.test(url.pathname) && !url.search && !url.hash;
  } catch { return false; }
}

function createSpotlightIntake({ config, database, fetchImpl = fetch, logger = () => {} }) {
  const base = `${config.wordpressUrl.replace(/\/$/, '')}/wp-json/sml-retail-spotlight/v1/newsroom`;
  let running = false;
  async function request(path, body) {
    const response = await fetchImpl(`${base}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { accept: 'application/json', 'content-type': 'application/json',
        authorization: basicAuth(config.wordpressUsername, config.wordpressAppPassword) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000), redirect: 'error'
    });
    if (!response.ok) throw new Error(`Spotlight ${path} HTTP ${response.status}`);
    return response.json();
  }
  async function run() {
    if (running) return 0;
    running = true;
    let count = 0;
    try {
      const pending = await request('pending');
      if (!Array.isArray(pending.events)) throw new Error('Invalid Spotlight pending response');
      for (const event of pending.events.slice(0, 20)) {
        try {
          if (!isSpotlightSource(event.source_url) || !event.event_uuid ||
              !event.source_url.endsWith(`/${event.event_uuid}`) || !event.source_event_key) {
            throw new Error('Invalid Spotlight event identity');
          }
          // A retry after an ACK/network failure reuses the unique source hash.
          const job = await database.enqueueNewsArticle({ sourceUrl: event.source_url,
            sourceUrlHash: createHash('sha256').update(event.source_url).digest('hex'),
            sourceEventKey: event.source_event_key });
          if (!job || !job.id) throw new Error('Spotlight job was not durably accepted');
          await request('ack', { event_uuid: event.event_uuid });
          count++;
          logger('info', 'spotlight_intake_enqueued', { eventUuid: event.event_uuid, jobId: job.id });
        } catch {
          logger('warn', 'spotlight_intake_event_failed', { eventUuid: event.event_uuid });
        }
      }
      return count;
    } finally { running = false; }
  }
  return { run };
}

module.exports = { createSpotlightIntake, isSpotlightSource };
