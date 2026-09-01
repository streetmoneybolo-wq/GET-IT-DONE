'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fetchSourceArticle } = require('./source-article');

test('extracts canonical article fields and resolves a relative social image', async () => {
  const paragraphs = Array.from({ length: 8 }, (_, i) => `<p>Verified article paragraph ${i} contains enough factual source material for the newsroom pipeline to process safely.</p>`).join('');
  const html = `<html><head><title>Fallback title</title><meta property="og:title" content="Verified Market Story"><meta name="description" content="A concise source description."><meta property="og:image" content="/images/story.jpg"></head><body><nav>Navigation text</nav><article>${paragraphs}</article></body></html>`;
  const output = await fetchSourceArticle('https://publisher.example/story', async () => ({
    body: Buffer.from(html),
    contentType: 'text/html',
    finalUrl: 'https://publisher.example/news/story'
  }));
  assert.equal(output.title, 'Verified Market Story');
  assert.equal(output.description, 'A concise source description.');
  assert.equal(output.imageUrl, 'https://publisher.example/images/story.jpg');
  assert.doesNotMatch(output.text, /Navigation text/);
  assert.ok(output.text.length >= 300);
});

test('rejects non-HTML and thin source responses', async () => {
  await assert.rejects(
    fetchSourceArticle('https://publisher.example/file', async () => ({ body: Buffer.from('{}'), contentType: 'application/json', finalUrl: 'https://publisher.example/file' })),
    (error) => error.code === 'source_json_untrusted'
  );
  await assert.rejects(
    fetchSourceArticle('https://publisher.example/thin', async () => ({ body: Buffer.from('<title>Thin</title><p>Short.</p>'), contentType: 'text/html', finalUrl: 'https://publisher.example/thin' })),
    (error) => error.code === 'source_content_too_thin'
  );
});

test('accepts only the verified StockMarketLoop Retail Trader Spotlight JSON source shape', async () => {
  const output = await fetchSourceArticle('https://stockmarketloop.com/wp-json/sml-retail-spotlight/v1/source/123e4567-e89b-12d3-a456-426614174000', async () => ({
    body: Buffer.from(JSON.stringify({ schema: 'sml.retail_trader_alert.v1', title: '$NVDA alert', description: 'Verified alert', text: '$NVDA calls watched above 220', ticker: '$NVDA', trader_display_name: 'Grandmaster-OBI', alerted_at: '2026-09-01T14:30:00Z', event_uuid: '123e4567-e89b-12d3-a456-426614174000', group_id: 9 })),
    contentType: 'application/json',
    finalUrl: 'https://stockmarketloop.com/wp-json/sml-retail-spotlight/v1/source/123e4567-e89b-12d3-a456-426614174000'
  }));
  assert.equal(output.editorialDesk, 'retail-trader-spotlight');
  assert.match(output.text, /Grandmaster-OBI/);
});
