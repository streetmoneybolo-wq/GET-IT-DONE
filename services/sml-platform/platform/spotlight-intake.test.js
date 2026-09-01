'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSpotlightIntake } = require('./spotlight-intake');

test('claims verified WordPress events, enqueues Retail Trader Spotlight, then acknowledges', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/pending')) return new Response(JSON.stringify({ events: [{ event_uuid: 'u', ticker: 'NVDA', alerted_at: '2026-09-01 14:00:00', group_id: 7, discord_display_name: 'Obi', source_url: 'https://stockmarketloop.com/wp-json/sml-retail-spotlight/v1/source/123e4567-e89b-12d3-a456-426614174000', source_event_key: 'discord:111:222' }] }), { status: 200 });
    return new Response(JSON.stringify({ acknowledged: true }), { status: 200 });
  };
  let job;
  const intake = createSpotlightIntake({ config: { wordpressUrl: 'https://stockmarketloop.com', wordpressUsername: 'news', wordpressAppPassword: 'pass' }, database: { enqueueNewsArticle: async (value) => { job = value; return { status: 'accepted' }; } }, fetchImpl });
  assert.equal(await intake.run(), 1);
  assert.equal(job.editorialDesk, 'retail-trader-spotlight');
  assert.equal(job.contentKind, 'article');
  assert.equal(calls.length, 2);
});
