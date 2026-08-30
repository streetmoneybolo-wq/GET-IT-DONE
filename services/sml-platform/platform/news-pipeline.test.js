'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createNewsPipeline } = require('./news-pipeline');

function harness(overrides = {}) {
  const calls = [];
  const database = {
    saveNewsSource: async (...args) => calls.push(['saveSource', ...args]),
    saveGeneratedArticle: async (...args) => calls.push(['saveGenerated', ...args]),
    recentGeneratedArticles: async () => [],
    saveNewsMedia: async (...args) => calls.push(['saveMedia', ...args]),
    completeNewsJob: async (...args) => calls.push(['complete', ...args]),
    failNewsJob: async (...args) => calls.push(['fail', ...args]),
    claimNewsJob: async () => null,
    ...overrides.database
  };
  const source = { sourceUrl: 'https://publisher.example/story', title: 'Source', description: 'Description', text: 'Source text', imageUrl: 'https://publisher.example/image.jpg' };
  const article = { title: '$ACME Market Update', excerpt: 'Verified market update.', body_html: '<p>Verified market update with original reporting context.</p>', slug: 'acme-market-update' };
  const pipeline = createNewsPipeline({
    database,
    fetchSource: async () => source,
    generateArticle: async () => ({ ...article }),
    publisher: {
      uploadFeaturedImage: async () => ({ id: 77 }),
      publish: async () => ({ post: { id: 88, link: 'https://stockmarketloop.com/acme-market-update/' }, duplicate: false })
    },
    logger: () => {},
    workerId: 'test-worker',
    ...overrides
  });
  return { calls, pipeline };
}

test('persists each stage and publishes a source-hash-suffixed slug', async () => {
  const { calls, pipeline } = harness();
  await pipeline.processJob({ id: 5, source_url: 'https://publisher.example/story', source_url_hash: 'a'.repeat(64), attempts: 1 });
  const generated = calls.find(([name]) => name === 'saveGenerated')[2];
  assert.equal(generated.slug, 'acme-market-update-aaaaaaaa');
  assert.deepEqual(calls.find(([name]) => name === 'saveMedia').slice(1), [5, 77]);
  assert.deepEqual(calls.find(([name]) => name === 'complete').slice(1), [5, 88, 'https://stockmarketloop.com/acme-market-update/', false]);
  assert.equal(calls.some(([name]) => name === 'fail'), false);
});

test('fails closed and records a safe permanent failure', async () => {
  const error = Object.assign(new Error('source is not HTML Bearer secret-value'), { code: 'source_not_html' });
  const { calls, pipeline } = harness({ fetchSource: async () => { throw error; } });
  await pipeline.processJob({ id: 6, source_url: 'https://publisher.example/file', source_url_hash: 'b'.repeat(64), attempts: 1 });
  const failure = calls.find(([name]) => name === 'fail');
  assert.equal(failure[1], 6);
  assert.equal(failure[2].code, 'source_not_html');
  assert.doesNotMatch(failure[2].detail, /secret-value/);
  assert.equal(failure[3], true);
});
