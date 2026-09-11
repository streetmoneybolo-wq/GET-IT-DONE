'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fetchSourceArticle } = require('./source-article');

test('accepts only the trusted Spotlight JSON identity and preserves attributed reporting context', async () => {
  const uuid = 'b6b922ed-0e5c-4f26-af5e-cb6d3eac15a4';
  const url = `https://stockmarketloop.com/wp-json/sml-retail-spotlight/v1/source/${uuid}`;
  const data = { schema: 'sml.retail_trader_alert.v1', event_uuid: uuid, title: 'TNON alert',
    text: 'TNON entry 2.40 pt 2.66 plus', trader_display_name: 'GrandMaster_OBI', ticker: '$TNON',
    reporting_context: { peak: 10.82, attribution: 'user reported, unverified' } };
  const fetcher = async () => ({ contentType: 'application/json', finalUrl: url, body: Buffer.from(JSON.stringify(data)) });
  const result = await fetchSourceArticle(url, fetcher);
  assert.equal(result.editorialDesk, 'retail-trader-spotlight');
  assert.match(result.text, /user reported, unverified/);
  data.event_uuid = 'wrong';
  await assert.rejects(fetchSourceArticle(url, fetcher), { code: 'source_content_too_thin' });
});

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
    (error) => error.code === 'source_not_html'
  );
  await assert.rejects(
    fetchSourceArticle('https://publisher.example/thin', async () => ({ body: Buffer.from('<title>Thin</title><p>Short.</p>'), contentType: 'text/html', finalUrl: 'https://publisher.example/thin' })),
    (error) => error.code === 'source_content_too_thin'
  );
});
