'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRetailSpotlightBot, tickerFromMessage } = require('./retail-spotlight-bot');

test('requires exactly one explicit dollar ticker', () => {
  assert.equal(tickerFromMessage('Watching $NVDA above 220'), 'NVDA');
  assert.equal(tickerFromMessage('NVDA above 220'), null);
  assert.equal(tickerFromMessage('$NVDA versus $AMD'), null);
});

test('filters by paid guild, channel, and monitored user then enqueues once', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/configured-groups')) return new Response(JSON.stringify({ groups: [{ group_id: 7, guild_id: '111111111111111', channel_id: '222222222222222', monitored_users: [{ id: '333333333333333' }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/bot/alerts')) return new Response(JSON.stringify({ accepted: true, duplicate: false, event_uuid: 'uuid', source_url: 'https://stockmarketloop.com/wp-json/sml-retail-spotlight/v1/source/123e4567-e89b-12d3-a456-426614174000' }), { status: 201, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { 'content-type': 'application/json' } });
  };
  const adapter = createRetailSpotlightBot({ wordpressBase: 'https://stockmarketloop.com', wordpressAuthorization: 'Basic secret', newsroomBase: 'https://news.example', newsIngestToken: 'token', fetchImpl });
  await adapter.refresh();
  const result = await adapter.onMessage({ guildId: '111111111111111', channelId: '222222222222222', id: '444444444444444', content: '$NVDA calls above 220', createdAt: new Date('2026-09-01T14:00:00Z'), author: { id: '333333333333333', username: 'Obi', bot: false }, member: { displayName: 'Grandmaster-OBI' } });
  assert.equal(result.accepted, true);
  assert.equal(calls.length, 3);
  assert.match(calls[2].url, /v1\/news\/articles$/);
  assert.equal(JSON.parse(calls[1].options.body).group_id, 7);
  assert.equal(JSON.parse(calls[2].options.body).source_event_key, 'discord:111111111111111:444444444444444');
});

test('records a shared Discord alert for every eligible group but queues one article', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/configured-groups')) return new Response(JSON.stringify({ groups: [
      { group_id: 7, guild_id: '111111111111111', channel_id: '222222222222222', monitored_users: [{ id: '333333333333333' }] },
      { group_id: 8, guild_id: '111111111111111', channel_id: '222222222222222', monitored_users: [{ id: '333333333333333' }] }
    ] }), { status: 200 });
    if (url.endsWith('/bot/alerts')) return new Response(JSON.stringify({ accepted: true, duplicate: false, event_uuid: `uuid-${calls.length}`, source_url: `https://stockmarketloop.com/source/${calls.length}` }), { status: 201 });
    return new Response(JSON.stringify({ accepted: true }), { status: 202 });
  };
  const adapter = createRetailSpotlightBot({ wordpressBase: 'https://stockmarketloop.com', wordpressAuthorization: 'Basic secret', newsroomBase: 'https://news.example', newsIngestToken: 'token', fetchImpl });
  assert.equal(await adapter.refresh(), 2);
  const result = await adapter.onMessage({ guildId: '111111111111111', channelId: '222222222222222', id: '444444444444444', content: '$NVDA calls above 220', author: { id: '333333333333333', username: 'Obi', bot: false } });
  assert.equal(result.results.length, 2);
  assert.deepEqual(calls.filter((call) => call.url.endsWith('/bot/alerts')).map((call) => JSON.parse(call.options.body).group_id), [7, 8]);
  assert.equal(calls.filter((call) => call.url.endsWith('/v1/news/articles')).length, 1);
});
