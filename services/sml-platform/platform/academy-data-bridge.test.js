'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createAcademyDataBridge, cleanSymbol } = require('./academy-data-bridge');

test('academy data bridge signs a bounded options request', async () => {
  const calls = [];
  const bridge = createAcademyDataBridge({
    baseUrl: 'https://stockmarketloop.com/', secret: 'a'.repeat(32), now: () => 1_700_000_000_000,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ ok: true, symbol: 'SPY' }), { status: 200 }); }
  });
  const result = await bridge.get('options', 'spy<script>');
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'https://stockmarketloop.com/wp-json/sml-academy-bridge/v1/options?symbol=SPYSCRIPT');
  const path = '/wp-json/sml-academy-bridge/v1/options?symbol=SPYSCRIPT';
  const expected = crypto.createHmac('sha256', 'a'.repeat(32)).update(`1700000000.${path}`).digest('hex');
  assert.equal(calls[0].options.headers['x-sml-academy-signature'], `sha256=${expected}`);
});

test('academy data bridge fails closed while unconfigured', async () => {
  const bridge = createAcademyDataBridge({ baseUrl: 'https://stockmarketloop.com', secret: '' });
  assert.deepEqual(await bridge.get('earnings', 'NVDA'), { ok: false, status: 503, code: 'academy_data_unconfigured' });
  assert.throws(() => cleanSymbol('<>'), /invalid_symbol/);
});
