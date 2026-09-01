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

test('routes verified market events to one specialist desk with a global fingerprint', () => {
  const parsed = parseNewsRequest(JSON.stringify({
    source_url: 'https://www.sec.gov/Archives/edgar/data/example',
    market_event: {
      ticker: 'NVDA', eventType: 'earnings', sourceEventId: 'nvda-q2-2026',
      occurredAt: '2026-08-31T20:00:00Z', sector: 'Semiconductors'
    },
    market_snapshot: { as_of: '2026-08-31T20:01:00Z', price: 214.72 },
    official_sources: [{ label: 'SEC filing', url: 'https://www.sec.gov/Archives/edgar/data/example' }]
  }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.job.editorialDesk, 'earnings');
  assert.equal(parsed.job.topicFingerprint, 'NVDA|earnings|nvda-q2-2026|2026-08-31');
  assert.equal(parsed.job.marketSnapshot.price, 214.72);
});
