'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createArticleGenerator, validateAndSanitize } = require('./article-generator');

function article(overrides = {}) {
  const paragraphs = Array.from({ length: 70 }, (_, i) => `<p>Markets paragraph ${i} explains verified developments and relevant context for readers following this unfolding business report today.</p>`).join('');
  return {
    title: 'Markets React as Companies Assess a Major Policy Development',
    subtitle: 'Investors are weighing the verified details and watching for the next official update.',
    excerpt: 'The latest report outlines a consequential development and the questions market participants are monitoring next.',
    slug: 'markets-major-policy-development',
    body_html: `<script>alert(1)</script><h2>What happened</h2>${paragraphs}`,
    focus_keyword: 'market policy development',
    meta_description: 'Market policy development details are drawing attention as investors assess verified facts, immediate implications, and what could happen next today.',
    category: 'Markets',
    tags: ['Markets', 'Investing', 'Breaking News'],
    tickers: [],
    image_alt: 'Market policy development news image',
    image_title: 'Market policy development',
    image_caption: 'Investors monitor the latest verified policy development.',
    image_description: 'News image illustrating investor attention around the latest verified market policy development.',
    ...overrides
  };
}

test('sanitizes generated HTML and appends attribution and disclaimer', () => {
  const output = validateAndSanitize(article(), 'https://example.com/source');
  assert.doesNotMatch(output.body_html, /<script/i);
  assert.match(output.body_html, /Read the original report/);
  assert.match(output.body_html, /not financial advice/);
  assert.ok(output.word_count >= 600);
});

test('rejects short generated articles', () => {
  assert.throws(() => validateAndSanitize(article({ body_html: '<p>Too short.</p>' }), 'https://example.com/source'), /word count/);
});

test('prefixes genuine tickers without changing ordinary acronyms', () => {
  const output = validateAndSanitize(article({
    title: 'NVDA Climbs While the SEC Reviews a Major AI Market Development',
    subtitle: 'NVDA investors are watching the SEC response and the next verified company update.',
    excerpt: 'NVDA shares moved as the SEC reviewed new information affecting AI market participants.',
    body_html: article().body_html.replaceAll('Markets', 'NVDA markets').replace('What happened', 'What NVDA investors are watching'),
    meta_description: 'NVDA market developments are drawing attention as investors assess verified facts, the SEC response, and what the company could report next today.',
    tags: ['NVDA', 'SEC', 'AI'],
    tickers: ['$NVDA'],
    image_alt: 'NVDA market news image',
    image_title: 'NVDA market development',
    image_caption: 'NVDA investors monitor the latest verified development.',
    image_description: 'News image illustrating NVDA investor attention around the latest verified AI market development.'
  }), 'https://example.com/source');
  assert.match(output.title, /^\$NVDA/);
  assert.match(output.body_html, /\$NVDA markets/);
  assert.match(output.meta_description, /^\$NVDA/);
  assert.ok(output.tags.includes('$NVDA'));
  assert.match(output.title, /\bSEC\b/);
  assert.doesNotMatch(output.title, /\$SEC/);
  assert.match(output.title, /\bAI\b/);
  assert.doesNotMatch(output.title, /\$AI/);
});

test('uses Responses structured outputs and never stores source content', async () => {
  const requests = [];
  const generator = createArticleGenerator({
    apiKey: 'test-only',
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ output_text: JSON.stringify(article()) }) };
    }
  });
  await generator({ sourceUrl: 'https://example.com/source', title: 'Source', description: '', text: 'x'.repeat(1000) });
  assert.equal(requests[0].store, false);
  assert.equal(requests[0].text.format.type, 'json_schema');
  assert.equal(requests[0].text.format.strict, true);
});
