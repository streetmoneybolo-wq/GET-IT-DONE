'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeSourceUrl, parseNewsRequest, verifyBearer } = require('./news-webhook');

test('normalizes tracking parameters and hashes one canonical source URL', () => {
  const a = parseNewsRequest(JSON.stringify({ source_url: 'https://Example.com/story?utm_source=x&b=2&a=1#top' }));
  const b = parseNewsRequest(JSON.stringify({ source_url: 'https://example.com/story?a=1&b=2' }));
  assert.equal(a.ok, true);
  assert.equal(a.job.sourceUrl, 'https://example.com/story?a=1&b=2');
  assert.equal(a.job.sourceUrlHash, b.job.sourceUrlHash);
});

test('rejects non-HTTPS and credential-bearing source URLs', () => {
  assert.equal(normalizeSourceUrl('http://example.com/story'), null);
  assert.equal(normalizeSourceUrl('https://user:pass@example.com/story'), null);
  assert.equal(parseNewsRequest('{}').error, 'invalid_source_url');
});

test('bearer authentication fails closed and uses exact tokens', () => {
  assert.equal(verifyBearer('', 'Bearer x').status, 503);
  assert.equal(verifyBearer('secret', 'Bearer wrong').status, 401);
  assert.equal(verifyBearer('secret', 'Bearer secret').ok, true);
});
