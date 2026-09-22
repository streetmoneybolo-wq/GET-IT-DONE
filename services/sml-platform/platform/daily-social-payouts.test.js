'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureOriginalContent, taskDraft, paragraphCount, tickers } = require('./daily-social-payouts');

const ARTICLE = 'https://stockmarketloop.com/example-article/';

test('Reddit content needs three substantive paragraphs, disclosure, and the assigned article', () => {
  const good = [
    'The company update matters because it changes the catalyst traders are watching and puts the price action in context for readers who follow this sector closely.',
    'The chart discussion should explain what confirmed momentum, where the key level is, and why volatility can still change the setup quickly after publication.',
    `Readers should review the full source before forming an opinion: ${ARTICLE}. #ad Paid partnership with StockMarketLoop.`
  ].join('\n\n');
  assert.equal(paragraphCount(good), 3);
  assert.equal(ensureOriginalContent('reddit', good, ARTICLE), good);
  const onlyTwo = [
    'This is a detailed first paragraph about the catalyst, current price action, and why a trader should understand the context before reacting to a headline.',
    `This is a detailed second paragraph with the assigned source ${ARTICLE} and a clear #ad Paid partnership with StockMarketLoop disclosure.`
  ].join('\n\n');
  assert.throws(() => ensureOriginalContent('reddit', onlyTwo, ARTICLE), /three substantive paragraphs/);
});

test('Stocktwits allows no more than two ticker symbols', () => {
  const one = `New catalyst context for $AAPL. ${ARTICLE} #ad Paid partnership with StockMarketLoop.`;
  assert.deepEqual(tickers(one), ['AAPL']);
  assert.equal(ensureOriginalContent('stocktwits', one, ARTICLE), one);
  const three = `Review $AAPL $MSFT $NVDA and the catalyst context. ${ARTICLE} #ad Paid partnership with StockMarketLoop.`;
  assert.throws(() => ensureOriginalContent('stocktwits', three, ARTICLE), /one or two/);
});

test('X refuses repost and quote-post shaped content', () => {
  const repost = `RT @someone: $AAPL analysis ${ARTICLE} #ad Paid partnership with StockMarketLoop.`;
  assert.throws(() => ensureOriginalContent('x', repost, ARTICLE), /original posts/);
});

test('Stocktwits draft keeps the requested two tickers and disclosure', () => {
  const draft = taskDraft({ platform: 'stocktwits', title: 'Catalyst update for traders', articleUrl: ARTICLE,
    summary: 'A substantive review of the company catalyst, market reaction, key chart levels, and risks that traders should understand before acting.', tickers: ['AAPL', 'MSFT'] });
  assert.match(draft, /\$AAPL \$MSFT/);
  assert.match(draft, /#ad Paid partnership with StockMarketLoop/);
});

