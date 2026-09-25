'use strict';

const crypto = require('node:crypto');
const { lessonParts, lessonPartsInfo } = require('./academy/lesson-parts');

const DEFAULT_MODEL = 'claude-sonnet-5';
const REQUESTS_PER_MINUTE = 6;
/* One entry per lesson in the curriculum, so a full pass never evicts a design
 * the learner is about to come back to. Written out rather than read from
 * ./academy/curriculum, which would pull the whole example library into every
 * process that only wants the designer; academy-slide-designer.test.js pins
 * this number to SEED_LESSONS.length so it cannot drift. */
const MAX_CACHE_ITEMS = 151;
const VISUAL_KINDS = Object.freeze([
  'auction', 'candles', 'flow', 'comparison', 'timeline', 'formula',
  'checklist', 'options', 'risk', 'tape', 'chart', 'question'
]);

const DESIGN_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['slides'],
  properties: {
    slides: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'visual', 'callout', 'visualKind'],
        properties: {
          heading: { type: 'string' },
          visual: { type: 'string' },
          callout: { type: 'string' },
          visualKind: { type: 'string', enum: VISUAL_KINDS }
        }
      }
    }
  }
});

/* One slide per narration part. The parts come from the same shared builder
 * the voice and the Activity client use (academy/lesson-parts.js). */
const partsFor = lessonParts;

function validText(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function validateDesign(value, expectedSlides) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.slides) || value.slides.length !== expectedSlides) {
    throw Object.assign(new Error('Claude returned the wrong slide count'), { code: 'invalid_design' });
  }
  const slides = value.slides.map((slide) => {
    if (!slide || typeof slide !== 'object' ||
        !validText(slide.heading, 100) || !validText(slide.visual, 700) ||
        !validText(slide.callout, 220) || !VISUAL_KINDS.includes(slide.visualKind)) {
      throw Object.assign(new Error('Claude returned an invalid slide'), { code: 'invalid_design' });
    }
    return {
      heading: slide.heading.trim(),
      visual: slide.visual.trim(),
      callout: slide.callout.trim(),
      visualKind: slide.visualKind
    };
  });
  return Object.freeze(slides);
}

function createAcademySlideDesigner({ apiKey = '', model = DEFAULT_MODEL, lessons = [],
  fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const lessonMap = new Map(lessons.map((lesson) => [lesson.moduleId + ':' + lesson.lessonId, lesson]));
  const cache = new Map();
  const inflight = new Map();
  const rate = new Map();
  const configured = Boolean(apiKey && model && typeof fetchImpl === 'function');

  function consume(userId) {
    const time = now();
    const current = rate.get(userId);
    const bucket = !current || time - current.startedAt >= 60_000
      ? { startedAt: time, count: 0 } : current;
    bucket.count += 1;
    rate.set(userId, bucket);
    if (bucket.count > REQUESTS_PER_MINUTE) {
      throw Object.assign(new Error('Academy design rate limit exceeded'), { code: 'rate_limited' });
    }
  }

  function put(key, value) {
    cache.set(key, value);
    while (cache.size > MAX_CACHE_ITEMS) cache.delete(cache.keys().next().value);
  }

  async function generate(lesson, digest) {
    const { parts, exampleIndex, example } = lessonPartsInfo(lesson);
    const source = {
      moduleId: lesson.moduleId,
      lessonId: lesson.lessonId,
      title: lesson.title,
      description: lesson.description,
      level: lesson.level,
      narrationParts: parts,
      workedExample: example ? { partIndex: exampleIndex, title: example.title, say: example.say } : null,
      simulation: lesson.simulation
    };
    const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        system: 'You are the visual lesson designer for Making Easy Money Academy. Convert only the supplied verified curriculum into a concise, professional 16:9 teaching deck. Return exactly one slide per narration part, in the same order. Use the simplest accurate explanation first. Describe an original hand-drawn cartoon or diagram that the Academy renderer can build; never imitate, trace, or reproduce another creator’s frames or branding. Use only concrete examples present in the source. Never invent prices, market events, performance claims, guarantees, or financial advice. Do not change the lesson facts or answer the knowledge check.',
        messages: [{ role: 'user', content: JSON.stringify(source) }],
        output_config: { format: { type: 'json_schema', schema: DESIGN_SCHEMA } }
      }),
      signal: AbortSignal.timeout(60_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error('Anthropic returned ' + response.status);
      error.code = response.status === 429 ? 'provider_rate_limited' : 'provider_unavailable';
      error.status = response.status;
      throw error;
    }
    const text = (payload.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('');
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) {
      throw Object.assign(new Error('Claude returned invalid JSON'), { code: 'invalid_design' });
    }
    const result = Object.freeze({
      provider: 'claude',
      model,
      slides: validateDesign(parsed, parts.length)
    });
    put(digest, result);
    return result;
  }

  async function getLessonDesign({ moduleId, lessonId, userId }) {
    if (!configured) throw Object.assign(new Error('Claude is not configured'), { code: 'integration_unconfigured' });
    const lesson = lessonMap.get(Number(moduleId) + ':' + Number(lessonId));
    if (!lesson) throw new TypeError('invalid lesson');
    consume(String(userId || 'unknown'));
    const digest = crypto.createHash('sha256')
      .update(model + '\0' + JSON.stringify(lesson)).digest('hex');
    if (cache.has(digest)) return { design: cache.get(digest), cached: true };
    if (!inflight.has(digest)) inflight.set(digest, generate(lesson, digest).finally(() => inflight.delete(digest)));
    return { design: await inflight.get(digest), cached: false };
  }

  return { configured, getLessonDesign };
}

module.exports = { createAcademySlideDesigner, partsFor, validateDesign, DESIGN_SCHEMA, MAX_CACHE_ITEMS };
