'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { getAcademyCandles } = require('./server');

function withMockedFetch(handler, run) {
  const original = global.fetch;
  global.fetch = handler;
  return run().finally(() => { global.fetch = original; });
}

test('getAcademyCandles calls Massive directly, authorized with the given key', async () => {
  let requestedUrl;
  await withMockedFetch(async (url, options) => {
    requestedUrl = new URL(url);
    assert.equal(options.headers.Authorization, 'Bearer test-massive-key');
    return {
      ok: true,
      json: async () => ({ results: [{ t: 1, o: 1, h: 2, l: 0.5, c: 1.5, v: 100 }] })
    };
  }, async () => {
    const payload = await getAcademyCandles('SPY', '5m', 'test-massive-key');
    assert.equal(requestedUrl.origin, 'https://api.massive.com');
    assert.match(requestedUrl.pathname, /^\/v2\/aggs\/ticker\/SPY\/range\/5\/minute\//);
    assert.equal(requestedUrl.searchParams.get('adjusted'), 'true');
    assert.deepEqual(payload.bars, [{ t: 1, o: 1, h: 2, l: 0.5, c: 1.5, v: 100 }]);
    assert.equal(payload.symbol, 'SPY');
    assert.equal(payload.tf, '5m');
  });
});

test('getAcademyCandles fails closed without a Massive API key', async () => {
  await assert.rejects(() => getAcademyCandles('QQQ', '1D', ''), /academy_market_no_api_key/);
});

test('getAcademyCandles rejects a timeframe outside the supported set', async () => {
  await assert.rejects(() => getAcademyCandles('QQQ', '2m', 'test-massive-key'), TypeError);
});
