'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcademySlideDesigner, designLocally, partsFor } = require('./academy-slide-designer');
const { lessonParts } = require('./academy/lesson-parts');
const { builders } = require('./academy/examples');

const lesson = {
  moduleId: 1,
  lessonId: 1,
  title: 'Price Discovery',
  description: 'Understand the auction.',
  level: 'Foundation',
  steps: ['Buyers bid while sellers offer.', 'A completed trade records agreement.'],
  question: { prompt: 'What is the last price?', options: { A: 'A forecast', B: 'A completed trade' } },
  simulation: { type: 'auction', title: 'Auction Lab', rounds: [] }
};

function responseFor(slides) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: 'msg_test',
      content: [{ type: 'text', text: JSON.stringify({ slides }) }],
      usage: { input_tokens: 10, output_tokens: 20 }
    })
  };
}

test('Claude Academy designer uses structured output, validates every narration slide, and caches', async () => {
  // partsFor is the shared narration builder. A lesson without a whiteboard
  // example keeps the legacy four parts: title, two steps, knowledge check.
  assert.equal(partsFor, lessonParts);
  assert.deepEqual(partsFor(lesson), [
    'Price Discovery',
    'Buyers bid while sellers offer.',
    'A completed trade records agreement.',
    'Knowledge check. What is the last price?'
  ]);
  const calls = [];
  const slides = partsFor(lesson).map((text, index) => ({
    heading: index ? 'Core concept ' + index : 'Price Discovery',
    visual: 'Visual: ' + text,
    callout: 'Remember the verified lesson point.',
    visualKind: index === 3 ? 'question' : 'auction'
  }));
  const designer = createAcademySlideDesigner({
    apiKey: 'secret-key',
    model: 'claude-sonnet-5',
    lessons: [lesson],
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return responseFor(slides);
    }
  });
  assert.equal(designer.configured, true);
  const first = await designer.getLessonDesign({ moduleId: 1, lessonId: 1, userId: 'member-1' });
  const second = await designer.getLessonDesign({ moduleId: 1, lessonId: 1, userId: 'member-1' });
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(first.design.provider, 'claude');
  assert.equal(first.design.slides.length, 4);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].options.headers['x-api-key'], 'secret-key');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'claude-sonnet-5');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(body.max_tokens, 4000);
  const source = JSON.parse(body.messages[0].content);
  assert.deepEqual(source.narrationParts, partsFor(lesson));
  assert.equal(source.workedExample, null);
  assert.match(body.system, /Return exactly one slide per narration part, in the same order/);
  assert.match(body.system, /original hand-drawn cartoon/i);
  assert.match(body.system, /never imitate, trace, or reproduce/i);
  assert.equal(body.messages[0].content.includes('Price Discovery'), true);
  assert.equal(JSON.stringify(first).includes('secret-key'), false);
});

test('Claude Academy designer fails closed for missing credentials, invalid lessons, and malformed designs', async () => {
  const unconfigured = createAcademySlideDesigner({ lessons: [lesson], localFallback: false });
  await assert.rejects(() => unconfigured.getLessonDesign({ moduleId: 1, lessonId: 1, userId: '1' }), { code: 'integration_unconfigured' });
  const configured = createAcademySlideDesigner({
    apiKey: 'key',
    lessons: [lesson], localFallback: false,
    fetchImpl: async () => responseFor([{ heading: 'Too few', visual: 'x', callout: 'y', visualKind: 'chart' }])
  });
  await assert.rejects(() => configured.getLessonDesign({ moduleId: 9, lessonId: 9, userId: '1' }), TypeError);
  await assert.rejects(() => configured.getLessonDesign({ moduleId: 1, lessonId: 1, userId: '1' }), { code: 'invalid_design' });
});

test('Claude Academy designer adds one slide for the whiteboard example and sends its sentences', async () => {
  const example = builders.bidAsk({}, { id: '1.1' });
  const withExample = { ...lesson, example };
  const parts = partsFor(withExample);
  assert.deepEqual(parts, [
    'Price Discovery',
    'Here is the simple version. ' + example.say.join(' '),
    'Buyers bid while sellers offer.',
    'A completed trade records agreement.',
    'Knowledge check. What is the last price?'
  ]);
  const calls = [];
  const slides = parts.map((text, index) => ({
    heading: index === 1 ? example.title : 'Slide ' + (index + 1),
    visual: 'Visual: ' + text.slice(0, 80),
    callout: 'Remember the verified lesson point.',
    visualKind: index === parts.length - 1 ? 'question' : 'auction'
  }));
  const designer = createAcademySlideDesigner({
    apiKey: 'key',
    lessons: [withExample], localFallback: false,
    fetchImpl: async (url, options) => {
      calls.push(JSON.parse(options.body));
      return responseFor(calls.length === 1 ? slides.slice(0, 4) : slides);
    }
  });
  // Four slides no longer match the five narration parts.
  await assert.rejects(() => designer.getLessonDesign({ moduleId: 1, lessonId: 1, userId: 'member-1' }), { code: 'invalid_design' });
  const result = await designer.getLessonDesign({ moduleId: 1, lessonId: 1, userId: 'member-1' });
  assert.equal(result.design.slides.length, 5);
  assert.equal(result.design.slides[1].heading, example.title);
  const source = JSON.parse(calls[1].messages[0].content);
  assert.deepEqual(source.narrationParts, parts);
  assert.deepEqual(source.workedExample, { partIndex: 1, title: example.title, say: example.say });
  assert.equal(JSON.stringify(source).includes('"facts"'), false, 'only the spoken sentences are sent, not the renderer data');
});

test('Claude Academy designer retries a refused request without structured output, then on the fallback model, and remembers a provider failure', async () => {
  const calls = [];
  const seeds = [];
  const designer = createAcademySlideDesigner({
    apiKey: 'key',
    lessons: [lesson],
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      const parts = partsFor(lesson);
      const slides = parts.map((text, index) => ({ heading: 'S' + index, visual: 'V ' + text.slice(0, 40), callout: 'Remember.', visualKind: 'auction' }));
      if (body.output_config) return { ok: false, status: 400, json: async () => ({ error: { message: 'output_config not supported' } }) };
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '```json\n' + JSON.stringify({ slides }) + '\n```' }] }) };
    }
  });
  const result = await designer.getLessonDesign({ moduleId: 1, lessonId: 1, userId: 'member-2' });
  assert.equal(calls.length, 2);
  assert.equal(Boolean(calls[1].output_config), false);
  assert.match(calls[1].system, /one JSON object/);
  assert.equal(result.design.slides.length, partsFor(lesson).length);
  void seeds;

  let hits = 0;
  const down = createAcademySlideDesigner({
    apiKey: 'key', lessons: [lesson], localFallback: false,
    fetchImpl: async () => { hits += 1; return { ok: false, status: 503, json: async () => ({}) }; }
  });
  await assert.rejects(() => down.getLessonDesign({ moduleId: 1, lessonId: 1, userId: 'm' }), { code: 'provider_unavailable' });
  const first = hits;
  await assert.rejects(() => down.getLessonDesign({ moduleId: 1, lessonId: 1, userId: 'm' }), { code: 'provider_unavailable' });
  assert.equal(hits, first, 'a provider failure is not hammered on the next load');
});

test('without Claude (no key, no credits, a refused request) every lesson still gets a deck from its own text, for free', async () => {
  const { SEED_LESSONS } = require('./academy/curriculum');
  const { VISUAL } = { VISUAL: ['auction', 'candles', 'flow', 'comparison', 'timeline', 'formula', 'checklist', 'options', 'risk', 'tape', 'chart', 'question'] };
  for (const seed of SEED_LESSONS) {
    const d = designLocally(seed);
    assert.equal(d.provider, 'academy');
    assert.equal(d.slides.length, partsFor(seed).length, seed.moduleId + '.' + seed.lessonId);
    assert.ok(d.slides.every((x) => VISUAL.includes(x.visualKind) && x.heading && x.visual && x.callout));
    assert.equal(d.slides[d.slides.length - 1].visualKind, 'question');
  }
  const free = createAcademySlideDesigner({ lessons: [lesson] });
  assert.equal(free.configured, false);
  const got = await free.getLessonDesign({ moduleId: 1, lessonId: 1, userId: 'anyone' });
  assert.equal(got.design.provider, 'academy'); assert.equal(got.fallback, true);
  let calls = 0;
  const broke = createAcademySlideDesigner({ apiKey: 'k', lessons: [lesson], fetchImpl: async () => { calls += 1; return { ok: false, status: 400, json: async () => ({ error: { message: 'Your credit balance is too low' } }) }; } });
  const a = await broke.getLessonDesign({ moduleId: 1, lessonId: 1, userId: 'm' });
  assert.equal(a.design.provider, 'academy'); assert.equal(a.reason, 'provider_unavailable');
  const n = calls;
  const b = await broke.getLessonDesign({ moduleId: 1, lessonId: 1, userId: 'm' });
  assert.equal(b.design.provider, 'academy'); assert.equal(calls, n, 'the refusal is remembered; no second call');
});

test('a Claude deck is paid for once: stored by lesson text, then served with no key and preferred over the built-in deck', async () => {
  const rows = new Map();
  const store = { durable: true, get: async (k) => (rows.has(k) ? { bytes: rows.get(k) } : null), put: async (k, bytes) => { rows.set(k, bytes); return true; } };
  const slides = partsFor(lesson).map((text, index) => ({ heading: 'Claude ' + index, visual: 'V ' + text, callout: 'C', visualKind: index === 3 ? 'question' : 'auction' }));
  let calls = 0;
  const paying = createAcademySlideDesigner({ apiKey: 'k', lessons: [lesson], store, fetchImpl: async () => { calls += 1; return responseFor(slides); } });
  const first = await paying.getLessonDesign({ moduleId: 1, lessonId: 1, userId: 'bake', internal: true });
  assert.equal(first.cached, false); assert.equal(calls, 1); assert.equal(rows.size, 1);
  assert.ok([...rows.keys()][0].startsWith('design:'));
  // no key at all: the stored Claude deck wins over the built-in one
  const free = createAcademySlideDesigner({ lessons: [lesson], store, fetchImpl: async () => { throw new Error('must not fetch'); } });
  assert.equal(free.configured, false); assert.equal(free.stored, true);
  const baked = await free.getLessonDesign({ moduleId: 1, lessonId: 1, userId: 'member' });
  assert.equal(baked.cached, true); assert.equal(baked.fallback, undefined);
  assert.equal(baked.design.provider, 'claude'); assert.equal(baked.design.slides[0].heading, 'Claude 0');
  // a key configured for a different model does not pay again for an unchanged lesson
  const other = createAcademySlideDesigner({ apiKey: 'k', model: 'claude-opus-5-5', lessons: [lesson], store, fetchImpl: async () => { throw new Error('must not fetch'); } });
  assert.equal((await other.getLessonDesign({ moduleId: 1, lessonId: 1, userId: 'member' })).design.slides[1].heading, 'Claude 1');
  // an edited lesson is a different key: the stored deck is not reused for it
  const edited = { ...lesson, steps: ['Changed step.', lesson.steps[1]] };
  const fresh = createAcademySlideDesigner({ lessons: [edited], store });
  assert.equal((await fresh.getLessonDesign({ moduleId: 1, lessonId: 1, userId: 'member' })).design.provider, 'academy');
});
