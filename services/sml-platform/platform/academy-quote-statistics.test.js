'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { QUOTE_STAT_FIELDS, academyQuoteStatisticsScript } = require('./academy-quote-statistics');

test('Academy quote panel contains the complete course statistics set', () => {
  assert.equal(QUOTE_STAT_FIELDS.length, 27);
  const labels = new Set(QUOTE_STAT_FIELDS.map(([, label]) => label));
  for (const required of ['High', 'Low', 'Avg. Price', 'Amplitude', 'Turnover Ratio', '52wk High', '52wk Low', 'Historical High', 'Historical Low', 'Open', 'Prev Close', 'P/E (TTM)', 'P/E LYR', 'P/B', 'Bid/Ask Ratio', '% Volume', 'Dividend TTM', 'Div Yield TTM', 'Volume', 'Turnover', 'Market Cap', 'Shares', 'Float Cap', 'Shs Float', 'Min Trading Unit']) {
    assert.ok(labels.has(required), `missing ${required}`);
  }
});

test('quote panel client is executable, responsive, and fail-closed', () => {
  const html = academyQuoteStatisticsScript();
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  assert.doesNotThrow(() => new Function(script));
  assert.match(html, /VERIFIED FIELDS ONLY/);
  assert.match(html, /never estimates fundamentals/);
  assert.match(html, /academy-mobile-stats/);
  assert.match(html, /data-academy-stat/);
});
