'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrokerLinks, cleanSymbol, etoroUrl } = require('./academy-brokers');

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

test('the launcher tries the desktop app links in order and falls back to the web quote and the sign-up link', () => {
  const { brokerLaunchHtml, moomooQuoteUrl, DESKTOP_SCHEMES, SIGNUP } = require('./academy-brokers');
  const quote = moomooQuoteUrl('AAPL');
  const moomoo = brokerLaunchHtml('moomoo', 'AAPL', quote);
  assert.deepEqual(DESKTOP_SCHEMES.moomoo(quote, 'AAPL'), ['ftmm://url/' + encodeURIComponent(quote), 'moomoo://url/' + encodeURIComponent(quote), 'futunn://url/' + encodeURIComponent(quote)]);
  for (const scheme of ['ftmm://url/', 'moomoo://url/', 'futunn://url/']) assert.match(moomoo, new RegExp(scheme.replace(/[/]/g, '\\/')), scheme);
  assert.match(moomoo, /id="app" href="ftmm:\/\/url\//, 'the desktop button opens the first candidate');
  assert.match(moomoo, /id="web" href="https:\/\/www\.moomoo\.com\/stock\/AAPL-US"/, 'the web quote stays reachable');
  assert.match(moomoo, new RegExp(SIGNUP.moomoo.replace(/[./]/g, '\\$&')));
  assert.match(moomoo, /No '\+c\.name\+' desktop app answered/, 'the no-app fallback text is wired');
  assert.match(moomoo, /clipboard\.writeText\(c\.symbol\)/, 'a click copies the ticker for pasting into the app');
  const webull = brokerLaunchHtml('webull', 'AAPL', 'https://www.webull.com/quote/nasdaq-aapl');
  assert.deepEqual(DESKTOP_SCHEMES.webull('x', 'AAPL'), ['webull://quote?symbol=AAPL', 'webull://']);
  assert.match(webull, /webull:\/\/quote\?symbol=AAPL/);
  assert.doesNotMatch(webull, /ftmm:/, 'no moomoo scheme on the Webull page');
  /* only quote pages, never an order ticket */
  for (const url of (moomoo + webull).match(/(?:href="|'|")[a-z]+:\/\/[^"' ]+/g)) assert.doesNotMatch(url, /order|trade|buy/i, url);
  const odd = brokerLaunchHtml('moomoo', 'A"B<', 'https://x/<');
  assert.doesNotMatch(odd, /A"B</, 'symbols and urls are escaped');
  assert.match(odd, /\\u003c/, 'the JSON config never closes the script tag');
});

test('eToro links go to the lower-case market page', async () => {
  const links = createBrokerLinks();
  assert.equal(await links.urlFor('etoro', 'NVDA'), 'https://www.etoro.com/markets/nvda');
  assert.equal(etoroUrl('BRK.B'), 'https://www.etoro.com/markets/brk.b');
  await assert.rejects(() => links.urlFor('etoro', '<>"'), /invalid_symbol/);
});
