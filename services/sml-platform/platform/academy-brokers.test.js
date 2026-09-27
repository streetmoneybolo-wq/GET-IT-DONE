'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrokerLinks, cleanSymbol } = require('./academy-brokers');

const referenceFetch = (mic) => async (url) => ({ ok: true, json: async () => ({ results: { ticker: url.split('/').pop(), primary_exchange: mic } }) });

test('Robinhood links go straight to the stock page', async () => {
  const links = createBrokerLinks();
  assert.equal(await links.urlFor('robinhood', 'nvda'), 'https://robinhood.com/stocks/NVDA');
});

test('Webull links use the listing exchange from Massive and cache it', async () => {
  let calls = 0;
  const links = createBrokerLinks({ apiKey: 'k', fetchImpl: async (url, init) => { calls++; assert.match(init.headers.authorization, /^Bearer k$/); return referenceFetch('ARCX')(url); } });
  assert.equal(await links.urlFor('webull', 'SPY'), 'https://www.webull.com/quote/nysearca-spy');
  assert.equal(await links.urlFor('webull', 'SPY'), 'https://www.webull.com/quote/nysearca-spy');
  assert.equal(calls, 1, 'the exchange is looked up once');
  const nyse = createBrokerLinks({ apiKey: 'k', fetchImpl: referenceFetch('XNYS') });
  assert.equal(await nyse.urlFor('webull', 'BRK.B'), 'https://www.webull.com/quote/nyse-brkb');
});

test('Webull still gets a link when the exchange lookup is unavailable', async () => {
  const links = createBrokerLinks({ apiKey: 'k', fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(await links.urlFor('webull', 'AAPL'), 'https://www.webull.com/quote/nasdaq-aapl');
});

test('unknown brokers and bad symbols are refused', async () => {
  const links = createBrokerLinks();
  await assert.rejects(() => links.urlFor('etrade', 'AAPL'), /invalid_broker/);
  await assert.rejects(() => links.urlFor('robinhood', '<>"'), /invalid_symbol/);
  assert.equal(cleanSymbol('  tsla '), 'TSLA');
});
