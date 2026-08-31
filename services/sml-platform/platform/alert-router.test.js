'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { cleanRoute, cleanAlert, formatAlert, createDiscordClient, createTelegramClient } = require('./alert-router');

test('route validation supports every direction and rejects duplicate destinations', () => {
  const route = cleanRoute({ groupId: 7, ownerUserId: 42, sourceProvider: 'discord', sourceTargetId: '123456789012345678',
    destinations: [{ provider: 'telegram', targetId: '-1001234567890' }, { provider: 'sml', targetId: '7' }] });
  assert.equal(route.destinations.length, 2);
  assert.throws(() => cleanRoute({ groupId: 7, ownerUserId: 42, sourceProvider: 'sml', sourceTargetId: '7',
    destinations: [{ provider: 'telegram', targetId: '@alerts' }, { provider: 'telegram', targetId: '@alerts' }] }), /duplicate/);
});

test('canonical alerts have stable source idempotency keys and bounded content', () => {
  const one = cleanAlert({ groupId: 7, sourceProvider: 'telegram', sourceTargetId: '-1001', sourceMessageId: '99', body: ' $SPY breakout ' });
  const two = cleanAlert({ groupId: 7, sourceProvider: 'telegram', sourceTargetId: '-1001', sourceMessageId: '99', body: 'changed' });
  assert.equal(one.eventKey, two.eventKey);
  assert.equal(one.body, '$SPY breakout');
  assert.throws(() => cleanAlert({ groupId: 7, sourceProvider: 'sml', sourceTargetId: '7', sourceMessageId: '1', body: '' }), /body/);
});

test('outbound formatting carries the real author and attachments without a hidden loop payload', () => {
  const text = formatAlert({ body: '$NVDA alert', author_name: 'Grandmaster-OBI', attachments: ['https://example.com/chart.png'] });
  assert.match(text, /Grandmaster-OBI/);
  assert.match(text, /chart\.png/);
  assert.doesNotMatch(text, /SML-AID|event_key/);
});

test('Discord sender disables mentions and returns the provider message id', async () => {
  let call;
  const client = createDiscordClient('token', async (url, options) => {
    call = { url, options };
    return { ok: true, status: 200, json: async () => ({ id: '555' }) };
  });
  assert.equal(await client.send('123', { body: '@everyone test', attachments: [] }), '555');
  assert.match(call.url, /channels\/123\/messages/);
  assert.deepEqual(JSON.parse(call.options.body).allowed_mentions, { parse: [] });
});

test('Telegram sender returns the provider message id', async () => {
  const client = createTelegramClient('token', async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 77 } }) }));
  assert.equal(await client.send('-1001', { body: 'alert', attachments: [] }), '77');
});

function pollingPool({ routes = [], cursor = null } = {}) {
  const ingested = [];
  const cursors = [];
  return {
    ingested,
    cursors,
    async query(sql, params) {
      if (sql.includes('FROM alert_routes r LEFT JOIN alert_route_cursors')) return { rows: routes };
      if (sql.includes('INSERT INTO alert_route_cursors')) { cursors.push(params); return { rowCount: 1, rows: [] }; }
      throw new Error(`unexpected query: ${sql}`);
    },
    connect: async () => ({
      async query(sql, params) {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (sql.includes('INSERT INTO alert_events')) {
          ingested.push(params);
          return { rowCount: 1, rows: [{ id: ingested.length }] };
        }
        if (sql.includes('INSERT INTO alert_deliveries')) return { rowCount: 1, rows: [] };
        throw new Error(`unexpected transaction query: ${sql}`);
      },
      release() {}
    })
  };
}

test('Discord polling ignores bot copies and advances the durable cursor', async () => {
  const pool = pollingPool({ routes: [{ id: 1, group_id: 7, source_target_id: '123', last_external_id: '9' }] });
  const discord = { listMessages: async () => [
    { id: '11', content: 'router echo', author: { id: '1', bot: true }, timestamp: new Date().toISOString() },
    { id: '10', content: '$SPY breaks out', author: { id: '2', username: 'OBI' }, timestamp: new Date().toISOString() }
  ] };
  const router = require('./alert-router').createAlertRouter(pool, { discord });
  const result = await router.pollDiscordOnce();
  assert.equal(result.ingested, 1);
  assert.equal(pool.ingested.length, 1);
  assert.deepEqual(pool.cursors.map((row) => row[1]), ['10', '11']);
});

test('Telegram polling routes only matching chats and advances all route offsets', async () => {
  const pool = pollingPool({ routes: [
    { id: 1, group_id: 7, source_target_id: '-1001', last_external_id: '20' },
    { id: 2, group_id: 8, source_target_id: '-1002', last_external_id: '20' }
  ] });
  const telegram = { getUpdates: async (offset) => {
    assert.equal(offset, 21);
    return [{ update_id: 21, message: { message_id: 5, date: 1780000000, text: '$NVDA alert', chat: { id: -1001 }, from: { id: 9, first_name: 'Grandmaster' } } }];
  } };
  const router = require('./alert-router').createAlertRouter(pool, { telegram });
  const result = await router.pollTelegramOnce();
  assert.equal(result.ingested, 1);
  assert.equal(pool.ingested.length, 1);
  assert.deepEqual(pool.cursors.map((row) => row[1]), ['21', '21']);
});
