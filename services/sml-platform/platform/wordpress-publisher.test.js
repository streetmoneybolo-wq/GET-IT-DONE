'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createWordPressPublisher } = require('./wordpress-publisher');

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('fails closed unless credentials resolve to SML NEWS /stockmarketloop/', async () => {
  const publisher = createWordPressPublisher({
    wordpressUrl: 'https://stockmarketloop.com',
    wordpressUsername: 'wrong',
    wordpressAppPassword: 'test',
    wordpressAuthorSlug: 'stockmarketloop',
    wordpressAuthorName: 'SML NEWS'
  }, { fetchImpl: async () => response(200, { id: 10, slug: 'square-biz', name: 'Square Biz' }) });
  await assert.rejects(publisher.verifyIdentity(), { code: 'wordpress_author_mismatch' });
});

test('publishes with the verified author, SEO metadata, and source hash', async () => {
  const calls = [];
  const publisher = createWordPressPublisher({
    wordpressUrl: 'https://stockmarketloop.com',
    wordpressUsername: 'stockmarketloop',
    wordpressAppPassword: 'test',
    wordpressAuthorSlug: 'stockmarketloop',
    wordpressAuthorName: 'SML NEWS'
  }, {
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.includes('/users/me')) return response(200, { id: 55, slug: 'stockmarketloop', name: 'SML NEWS' });
      if (url.includes('/posts?')) return response(200, []);
      return response(201, { id: 99, link: 'https://stockmarketloop.com/test/' });
    }
  });
  const result = await publisher.publish({
    article: { title: 'Test', excerpt: 'Excerpt', slug: 'test', body_html: '<p>Body</p>', subtitle: 'Subtitle', meta_description: 'Meta', focus_keyword: 'keyword' },
    sourceUrl: 'https://example.com/source',
    sourceUrlHash: 'a'.repeat(64)
  });
  assert.equal(result.post.id, 99);
  const body = JSON.parse(calls.at(-1).init.body);
  assert.equal(body.author, 55);
  assert.equal(body.status, 'publish');
  assert.equal(body.meta._sml_source_url_hash, 'a'.repeat(64));
  assert.equal(body.meta.rank_math_focus_keyword, 'keyword');
});

test('publishes specialist stories under the configured desk author and fails closed without it', async () => {
  const calls = [];
  const publisher = createWordPressPublisher({
    wordpressUrl: 'https://stockmarketloop.com',
    wordpressUsername: 'stockmarketloop',
    wordpressAppPassword: 'test',
    wordpressAuthorSlug: 'stockmarketloop',
    wordpressAuthorName: 'SML NEWS',
    wordpressEditorialAuthors: { earnings: 144 }
  }, {
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.includes('/users/me')) return response(200, { id: 55, slug: 'stockmarketloop', name: 'SML NEWS' });
      if (url.includes('/posts?')) return response(200, []);
      return response(201, { id: 101, link: 'https://stockmarketloop.com/earnings-test/' });
    }
  });
  await publisher.publish({
    article: { editorial_desk: 'earnings', title: 'Test', excerpt: 'Excerpt', slug: 'earnings-test', body_html: '<p>Body</p>', subtitle: 'Subtitle', meta_description: 'Meta', focus_keyword: 'keyword' },
    sourceUrl: 'https://example.com/source', sourceUrlHash: 'b'.repeat(64)
  });
  assert.match(calls.at(-1).url, /sml-newsroom\/v1\/publish$/);
  assert.equal(JSON.parse(calls.at(-1).init.body).editorial_desk, 'earnings');
  await assert.rejects(publisher.authorFor({ editorial_desk: 'options-flow' }), { code: 'wordpress_author_not_configured' });
});
