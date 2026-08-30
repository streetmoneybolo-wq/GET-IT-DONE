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
    (error) => error.code === 'source_not_html'
  );
  await assert.rejects(
    fetchSourceArticle('https://publisher.example/thin', async () => ({ body: Buffer.from('<title>Thin</title><p>Short.</p>'), contentType: 'text/html', finalUrl: 'https://publisher.example/thin' })),
    (error) => error.code === 'source_content_too_thin'
  );
});
