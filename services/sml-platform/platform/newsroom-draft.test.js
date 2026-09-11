'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertFresh, validateArticle, createDraftGenerator, createReviewClient, runOne } = require('./newsroom-draft');
const item = () => ({ id: 1, payload_hash: 'a'.repeat(64), author: { id: 22, name: 'Earnings Desk' },
  event: { event_key: 'b'.repeat(64), expires_at: new Date(Date.now() + 600000).toISOString(), evidence: { price: null }, symbols: ['SPY'] } });
const article = () => ({ title: 'A source-backed market update', subtitle: 'What the evidence says', excerpt: 'The evidence needs review.',
  focus_keyword: 'market update', meta_description: 'A draft description for editorial review.', body_html: `<p>${'Evidence requires editorial review. '.repeat(30)}</p>` });
const response = (payload, status = 200) => ({ ok: status === 200, status, json: async () => payload });

test('draft output removes scripts, links and CSS', () => {
  const a = article(); a.body_html += '<script>bad()</script><a href="https://bad.test">Link</a><style>body{}</style>';
  const clean = validateArticle(a);
  assert.doesNotMatch(clean.body_html, /script|bad\(|href|<style/);
});
test('rejects publication and author overrides in generated output', () => {
  for (const extra of [{ status: 'publish' }, { author: 1 }, { featured_media: 9 }]) assert.throws(() => validateArticle({ ...article(), ...extra }), { code: 'invalid_draft' });
});
test('requires substantive output and valid field types', () => {
  assert.throws(() => validateArticle({ ...article(), body_html: '<p>Short</p>' }), { code: 'invalid_draft' });
  assert.throws(() => validateArticle({ ...article(), title: [] }), { code: 'invalid_draft' });
});
test('blocks expired evidence before any AI call', async () => {
  const i = item(); i.event.expires_at = '2000-01-01T00:00:00Z';
  let called = false;
  await assert.rejects(runOne({ eventId: 1, client: { event: async () => i }, generate: async () => { called = true; } }), { code: 'event_expired' });
  assert.equal(called, false);
});
test('checks evidence bounds and hash identity', () => {
  assert.throws(() => assertFresh({ ...item(), payload_hash: 'wrong' }), { code: 'invalid_event' });
  const i = item(); i.event.evidence = { body: 'x'.repeat(50000) };
  assert.throws(() => assertFresh(i), { code: 'invalid_event' });
});
test('missing desk blocks generation, not silently assigned to another author', async () => {
  const i = item(); i.author = null;
  await assert.rejects(runOne({ client: { event: async () => i }, generate: () => assert.fail('No AI call') }), { code: 'unresolved_author' });
});
test('existing draft returns without regenerating or overwriting', async () => {
  const i = item(); i.draft = { post_id: 10, status: 'draft', author_id: 22 };
  const result = await runOne({ client: { event: async () => i }, generate: () => assert.fail('No AI call') });
  assert.equal(result.duplicate, true); assert.equal(result.post_id, 10);
  i.draft.status = 'publish';
  await assert.rejects(runOne({ client: { event: async () => i } }), { code: 'unexpected_post_status' });
});
test('expiration during generation prevents save', async () => {
  const i = item();
  await assert.rejects(runOne({ client: { event: async () => i, save: () => assert.fail('No save') },
    generate: async () => { i.event.expires_at = '2000-01-01T00:00:00Z'; return article(); } }), { code: 'event_expired' });
});
test('single bounded AI call preserves unknowns and has no retry or image fetch', async () => {
  const calls = [];
  const generate = createDraftGenerator({ apiKey: 'unit-test-placeholder', model: 'test-model', fetchImpl: async (url, init) => {
    calls.push({ url, init }); return response({ output_text: JSON.stringify(article()) });
  } });
  const result = await generate(item());
  assert.equal(calls.length, 1); assert.equal(result.title, article().title);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.store, false); assert.equal(body.max_output_tokens, 3000);
  assert.equal(JSON.parse(body.input[1].content[0].text).evidence.price, null);
  assert.equal(calls[0].init.redirect, 'error');
});
test('provider failure is not retried', async () => {
  let calls = 0;
  const generate = createDraftGenerator({ apiKey: 'unit-test-placeholder', model: 'test-model', fetchImpl: async () => { calls++; return response({}, 429); } });
  await assert.rejects(generate(item()), { code: 'generation_failed' }); assert.equal(calls, 1);
});
test('generator prefixes supported symbols and rejects invented cashtags', async () => {
  const a = article(); a.title = 'SPY evidence summary';
  const generate = createDraftGenerator({ apiKey: 'unit-test-placeholder', model: 'test-model', fetchImpl: async () => response({ output_text: JSON.stringify(a) }) });
  assert.equal((await generate(item())).title, '$SPY evidence summary');
  a.title = '$QQQ invented connection';
  await assert.rejects(generate(item()), { code: 'invalid_draft' });
});
test('client uses only protected review endpoint, never public publisher', async () => {
  const calls = [];
  const config = { wordpressUrl: 'https://stockmarketloop.com', wordpressUsername: 'test', wordpressAppPassword: 'unit-test-placeholder' };
  const client = createReviewClient(config, { fetchImpl: async (url, init) => {
    calls.push({ url, init }); return response(init.method === 'GET' ? { items: [item()] } : { status: 'draft', post_id: 5 });
  } });
  const result = await runOne({ client, eventId: 1, generate: async () => article() });
  assert.equal(result.status, 'draft'); assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c.url.includes('/sml-newsroom-review/v1/') && c.init.redirect === 'error'));
  assert.deepEqual(Object.keys(JSON.parse(calls[1].init.body)).sort(), ['article', 'payload_hash']);
  assert.throws(() => createReviewClient({ ...config, wordpressUrl: 'http://stockmarketloop.com' }), { code: 'invalid_site' });
});
