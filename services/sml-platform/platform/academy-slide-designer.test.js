'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcademySlideDesigner, partsFor } = require('./academy-slide-designer');
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
  const unconfigured = createAcademySlideDesigner({ lessons: [lesson] });
  await assert.rejects(() => unconfigured.getLessonDesign({ moduleId: 1, lessonId: 1, userId: '1' }), { code: 'integration_unconfigured' });
  const configured = createAcademySlideDesigner({
    apiKey: 'key',
    lessons: [lesson],
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
    lessons: [withExample],
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
