'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcademySlideDesigner, partsFor } = require('./academy-slide-designer');

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
