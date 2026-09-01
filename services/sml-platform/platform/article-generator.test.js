'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyArticleTemplate, createArticleGenerator, validateAndSanitize, validateShortPost } = require('./article-generator');

function article(overrides = {}) {
  const paragraphs = Array.from({ length: 100 }, (_, i) => `<p>Markets paragraph ${i} explains verified developments and relevant context for readers following this unfolding business report today.</p>`).join('');
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

test('extends the newsroom rules without weakening factuality safeguards', () => {
  const { SYSTEM_INSTRUCTIONS } = require('./article-generator');
  assert.match(SYSTEM_INSTRUCTIONS, /completely new, standalone news article/i);
  assert.match(SYSTEM_INSTRUCTIONS, /fresh, high-intent keyword universe/i);
  assert.match(SYSTEM_INSTRUCTIONS, /Discover-friendly narrative flow/i);
  assert.match(SYSTEM_INSTRUCTIONS, /OpenGraph, Twitter, and NewsArticle JSON-LD/i);
  assert.match(SYSTEM_INSTRUCTIONS, /never invent a fact, number, statistic, quote/i);
  assert.match(SYSTEM_INSTRUCTIONS, /non-defamatory/i);
});

test('uses the standard SML News template unless the source verifies a Grandmaster-OBI alert', () => {
  assert.equal(classifyArticleTemplate({ title: 'NVDA earnings update', text: 'The company reported results.' }), 'news');
  assert.equal(classifyArticleTemplate({ title: 'Grandmaster-OBI alert review', text: 'The reported entry and alert-to-high move were verified.' }), 'grandmaster_obi_alert');
  assert.equal(classifyArticleTemplate({ title: 'Grandmaster-OBI profile', text: 'A profile covering his public market commentary.' }), 'news');
});

test('renders ordinary reporting with the news template and transparency box', () => {
  const output = validateAndSanitize(article(), 'https://example.com/source', 'news');
  assert.match(output.body_html, /<article class="sml-news-article sml-newsroom-story"/);
  assert.doesNotMatch(output.body_html, /sml-alert-report/);
  assert.match(output.body_html, /class="sml-trust-box"/);
  assert.match(output.body_html, /SML News/);
});

test('specialist stories get a live chart, an honest desk byline, and verified official links', () => {
  const { deskForKey } = require('./editorial-desks');
  const output = validateAndSanitize(article({
    title: 'NVDA Earnings Data Changes the Market Debate',
    tickers: ['$NVDA']
  }), 'https://example.com/source', 'news', deskForKey('earnings'), [
    { label: 'SEC filing', url: 'https://www.sec.gov/Archives/example', verified: false },
    { label: 'Company investor relations release', url: 'https://investor.example.com/results', verified: true },
    { label: 'Unverified blog', url: 'https://blog.example.net/post', verified: false }
  ]);
  assert.match(output.body_html, /data-editorial-desk="earnings"/);
  assert.match(output.body_html, /class="sml-live-chart"/);
  assert.match(output.body_html, /SML Earnings Desk/);
  assert.match(output.body_html, /www\.sec\.gov/);
  assert.match(output.body_html, /investor\.example\.com/);
  assert.doesNotMatch(output.body_html, /blog\.example\.net/);
  assert.equal(output.editorial_author_slug, 'sml-earnings-desk');
});

test('renders verified Grandmaster-OBI coverage with the alert template, TOC, chart, and ticker links', () => {
  const output = validateAndSanitize(article({
    title: 'CRE Alert Record Shows a Major Intraday Move',
    subtitle: 'The verified CRE alert record is compared with the session high and documented market data.',
    excerpt: 'A verified CRE alert record and market data show the timing, scale, and risks surrounding the intraday move.',
    body_html: article().body_html.replace('<h2>What happened</h2>', '<h2>Verified performance</h2><table><tbody><tr><th scope="row">Reported entry</th><td>$2.47</td></tr></tbody></table><h2>Risk considerations</h2>'),
    meta_description: 'CRE alert data documents the reported entry, intraday high, timing, and significant trading risks surrounding the verified market move today.',
    tags: ['CRE', 'Market Alerts', 'Trading Risk'],
    tickers: ['$CRE']
  }), 'https://example.com/source', 'grandmaster_obi_alert');
  assert.match(output.body_html, /<article class="sml-alert-report">/);
  assert.match(output.body_html, /class="sml-article-toc"/);
  assert.match(output.body_html, /href="#verified-performance"/);
  assert.match(output.body_html, /class="sml-live-chart"/);
  assert.match(output.body_html, /stock-chart\/\?symbol=CRE/);
  assert.doesNotMatch(output.body_html, /symbol=\$CRE/);
  assert.match(output.body_html, /class="sml-market-links"/);
});

test('short posts keep the desk identity and remain compact', () => {
  const { deskForKey } = require('./editorial-desks');
  const output = validateShortPost({
    title: 'NVDA Earnings Guidance Resets the Immediate Debate',
    text: 'NVDA reported updated guidance after the close. The verified release changed the near-term comparison investors are watching, while the market snapshot remains time-sensitive and does not guarantee the next move.',
    slug: 'nvda-earnings-guidance-update',
    focus_keyword: 'NVDA earnings guidance',
    meta_description: 'NVDA earnings guidance changed the immediate market debate as investors reviewed the verified release, timing, and remaining uncertainty.',
    tags: ['NVDA', 'Earnings'],
    tickers: ['$NVDA']
  }, 'https://investor.example.com/results', deskForKey('earnings'));
  assert.equal(output.content_kind, 'short_post');
  assert.match(output.body_html, /class="sml-newsroom-short"/);
  assert.match(output.body_html, /data-editorial-desk="earnings"/);
  assert.ok(output.word_count <= 140);
});
