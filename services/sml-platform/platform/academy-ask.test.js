'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcademyAsk, buildCorpus, rank, tokens, MAX_QUESTION } = require('./academy-ask');
const { SEED_LESSONS } = require('./academy/curriculum');
const { EPISODES } = require('./academy/discipline-content');

const PAGE_BANNED = /<iframe|location\.assign|CLAUDE DESIGNED|Playing Grandmaster-Obi|next lesson is preloading/i;

test('the corpus covers every lesson, its worked examples and checks, and the discipline episodes; retrieval finds the right lesson', () => {
  const corpus = buildCorpus({ lessons: SEED_LESSONS, episodes: EPISODES });
  assert.ok(corpus.docs.length > 900, 'passages: ' + corpus.docs.length);
  const sources = new Set(corpus.docs.map((d) => d.source));
  for (const l of SEED_LESSONS) assert.ok(sources.has(l.moduleId + '.' + l.lessonId), 'lesson ' + l.moduleId + '.' + l.lessonId + ' is in the corpus');
  assert.ok(corpus.docs.some((d) => d.kind === 'worked example'));
  assert.ok(corpus.docs.some((d) => d.kind === 'knowledge check'));
  assert.ok(corpus.docs.some((d) => d.kind === 'discipline episode'));
  const share = rank(corpus, 'What does it actually mean to own a share of a company?');
  assert.equal(share[0].source, '0.1', 'the share lesson leads for the share question');
  const nothing = rank(corpus, 'Why is sometimes the best trade no trade at all? patience');
  assert.ok(nothing.slice(0, 4).some((p) => p.kind === 'discipline episode'), 'the doing-nothing episode ranks for a patience question');
  // the thesaurus: desk slang reaches lesson words
  assert.ok(tokens('What is a good R:R and where do I put my SL vs PT?', true).includes('target'));
  assert.ok(tokens('what are the greeks', true).includes('delta'));
  assert.deepEqual(rank(corpus, '!!!'), []);
  const long = rank(corpus, 'risk reward stop target position size');
  assert.ok(long.reduce((n, p) => n + p.text.length, 0) <= 9000, 'context stays bounded');
});

test('Ask Obi sends the question with its passages and Obi\'s voice rules, returns the answer and sources, and is owner-rate-limited', async () => {
  const calls = [];
  const ask = createAcademyAsk({
    apiKey: 'k', lessons: SEED_LESSONS, episodes: EPISODES,
    fetchImpl: async (url, options) => { calls.push({ url, body: JSON.parse(options.body), headers: options.headers }); return { ok: true, status: 200, json: async () => ({ model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'A share is a slice of a real business. Own ten of a thousand and you own one percent of what it earns.' }] }) }; }
  });
  assert.equal(ask.configured, true);
  assert.ok(ask.corpusSize > 900);
  const r = await ask.ask({ question: 'What does it mean to own a share?', userId: 'owner' });
  assert.match(r.answer, /slice of a real business/);
  assert.ok(r.sources.slice(0, 3).some((x) => x.source === '0.1'), 'the share lesson is among the top sources: ' + r.sources.map((x) => x.source).join(','));
  assert.ok(r.passages >= 5);
  const body = calls[0].body;
  assert.equal(body.model, 'claude-sonnet-5-5');
  assert.equal(calls[0].headers['x-api-key'], 'k');
  assert.match(body.system, /You are Grandmaster-Obi/);
  assert.match(body.system, /Obi excerpt 1/);
  assert.match(body.system, /Never use headings, markdown, bullet lists/);
  assert.match(body.system, /Never mention being an AI/);
  assert.match(body.system, /Never invent performance numbers/);
  assert.match(body.messages[0].content, /QUESTION FROM A MEMBER:\nWhat does it mean to own a share\?/);
  assert.match(body.messages[0].content, /Lesson 0\.1 "What a Share Actually Is"/);
  assert.doesNotMatch(body.system + body.messages[0].content, PAGE_BANNED);
  // a question is trimmed to the limit; an empty one is refused before any call
  await assert.rejects(() => ask.ask({ question: '   ', userId: 'owner' }), TypeError);
  await ask.ask({ question: 'x'.repeat(MAX_QUESTION + 500), userId: 'owner' });
  assert.equal(calls[1].body.messages[0].content.indexOf('x'.repeat(MAX_QUESTION + 1)), -1);
  for (let i = 0; i < 18; i += 1) await ask.ask({ question: 'again ' + i, userId: 'owner' });
  await assert.rejects(() => ask.ask({ question: 'one more', userId: 'owner' }), /rate limit/);
});

test('Ask Obi reports the provider honestly and is off without a key', async () => {
  const off = createAcademyAsk({ lessons: SEED_LESSONS.slice(0, 3), episodes: [] });
  assert.equal(off.configured, false);
  await assert.rejects(() => off.ask({ question: 'hi', userId: 'o' }), /not configured/);
  const broke = createAcademyAsk({ apiKey: 'k', lessons: SEED_LESSONS.slice(0, 3), episodes: EPISODES.slice(0, 1), fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Your credit balance is too low' } }) }) });
  await assert.rejects(() => broke.ask({ question: 'what is a share', userId: 'o' }), (e) => e.code === 'provider_unavailable' && e.status === 400 && /credit balance/.test(e.message));
  const busy = createAcademyAsk({ apiKey: 'k', lessons: SEED_LESSONS.slice(0, 3), episodes: [], fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }) });
  await assert.rejects(() => busy.ask({ question: 'what is a share', userId: 'o' }), (e) => e.code === 'provider_rate_limited');
});

test('the Ask Obi page script is owner-gated on the client and copies the answer', () => {
  const src = require('node:fs').readFileSync(require.resolve('./academy-ask-ui.js'), 'utf8');
  assert.doesNotMatch(src, PAGE_BANNED);
  assert.doesNotMatch(src, /<\/script/i);
  assert.match(src, /fetch\('\/academy-activity\/ask', \{ headers/, 'asks the server whether this account is the owner');
  assert.match(src, /navigator\.clipboard\.writeText/);
  assert.match(src, /execCommand\('copy'\)/, 'a fallback copy for frames without the Clipboard API');
  assert.match(src, /btn\.classList\.toggle\('on', S\.owner\)/, 'the button shows only for the owner');
  assert.match(src, /Ctrl\+Enter/);
});
