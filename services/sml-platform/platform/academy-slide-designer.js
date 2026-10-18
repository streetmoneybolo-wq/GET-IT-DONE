'use strict';

const crypto = require('node:crypto');
const { lessonParts, lessonPartsInfo } = require('./academy/lesson-parts');

const DEFAULT_MODEL = 'claude-sonnet-5';
const FALLBACK_MODEL = 'claude-sonnet-5-5';
const FAILURE_MEMORY_MS = 600_000;
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

/* ---------- the built-in designer: no provider, no credits ----------
 * One slide per narration part, cut from the lesson's own verified text: the heading is the
 * step's first clause, the visual is the step itself, the callout is the sentence that carries
 * the rule (never / always / that is why ...), and the visual kind comes from the words used.
 * It is what every lesson gets when Claude is not configured, is out of credits, or fails. */
const KIND_RULES = [
  ['options', /\b(options?|strike|calls?|puts?|premium|expir\w*|theta|gamma|delta|vega|implied)\b/i],
  ['candles', /\b(candles?|candlestick|wicks?|doji|engulf\w*|open and close|closes? above|closes? below)\b/i],
  ['auction', /\b(bid|ask|spread|order book|auction|market makers?|limit orders?|fills?|liquidity)\b/i],
  ['tape', /\b(tape|prints?|volume|blocks?|sweeps?|time and sales|level 2|dark pool)\b/i],
  ['risk', /\b(risk|stops?|loss|losses|drawdown|position size|ruin|lose|protect|blow up)\b/i],
  ['formula', /\b(percent|percentage|formula|calculate|divide|multiply|ratio|average|math|add up)\b|%/i],
  ['comparison', /\b(versus|vs\.?|compare[sd]?|difference|instead of|rather than|mirror|bigger than|smaller than)\b/i],
  ['timeline', /\b(before|after|then|next session|days?|weeks?|months?|years?|history|over time)\b/i],
  ['checklist', /\b(checklist|steps?|rules?|plan|routine|habit|always|never)\b/i],
  ['flow', /\b(money|cash|flows?|funds?|dealers?|institutions?|hedg\w*|rotation)\b/i]
];
function kindFor(text, fallback) {
  for (const [kind, re] of KIND_RULES) if (re.test(text)) return kind;
  return fallback || 'chart';
}
function sentences(text) {
  return String(text || '').match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g)?.map((x) => x.trim()).filter(Boolean) || [];
}
function clip(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return cut.slice(0, Math.max(20, cut.lastIndexOf(' '))).replace(/[,;:\s]+$/, '') + '…';
}
function headingFrom(step, number) {
  const first = sentences(step)[0] || String(step || '');
  let head = first.replace(/[.!?]+["')\]]*$/, '');
  if (head.length > 60) head = head.split(/,|:|;| because | which | so that | and /i)[0];
  head = head.trim();
  const words = head.split(/\s+/).filter(Boolean);
  if (words.length > 9) head = words.slice(0, 9).join(' ');
  if (words.length < 3 || head.length > 100) return 'Core concept ' + number;
  return head.charAt(0).toUpperCase() + head.slice(1);
}
function calloutFrom(step) {
  const list = sentences(step);
  const strong = list.find((x) => /\b(never|always|that is why|this is why|the rule|remember|the point|which is why|only)\b/i.test(x));
  return clip(strong || list[list.length - 1] || step, 220);
}
function designLocally(lesson) {
  const { parts, exampleIndex, example } = lessonPartsInfo(lesson);
  const last = parts.length - 1;
  let step = 0;
  const slides = parts.map((part, index) => {
    if (index === 0) {
      return { heading: clip(lesson.title, 100), visual: clip(lesson.description || part, 700), callout: clip(lesson.level ? lesson.level + ' lesson · ' + (lesson.duration || 'a few minutes') : 'Lesson overview', 220), visualKind: kindFor(lesson.title + ' ' + (lesson.description || ''), 'chart') };
    }
    if (index === exampleIndex && example) {
      return { heading: clip(example.title || 'The simple version', 100), visual: clip((example.say || []).join(' ') || part, 700), callout: 'A worked example with made-up numbers, so the idea is clear before the real market is.', visualKind: kindFor((example.title || '') + ' ' + (example.say || []).join(' '), 'flow') };
    }
    if (index === last && lesson.question && lesson.question.prompt) {
      return { heading: 'Knowledge check', visual: clip(lesson.question.prompt, 700), callout: 'Pick the best answer. The explanation follows whichever you choose.', visualKind: 'question' };
    }
    step += 1;
    return { heading: headingFrom(part, step), visual: clip(part, 700), callout: calloutFrom(part), visualKind: kindFor(part, 'chart') };
  });
  return Object.freeze({ provider: 'academy', model: 'built-in', slides: validateDesign({ slides }, parts.length) });
}

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
  fetchImpl = globalThis.fetch, now = Date.now, localFallback = true, store = null } = {}) {
  const lessonMap = new Map(lessons.map((lesson) => [lesson.moduleId + ':' + lesson.lessonId, lesson]));
  const cache = new Map();
  const inflight = new Map();
  const failures = new Map();
  const rate = new Map();
  const configured = Boolean(apiKey && model && typeof fetchImpl === 'function');
  /* the durable media store (academy_media): a Claude design is paid for once per lesson text and then served from
   * here on every instance, after every deploy, and with no key configured at all */
  const stored = Boolean(store && store.durable);
  async function fromStore(digest, lesson) {
    if (!stored) return null;
    const hit = await store.get('design:' + digest);
    if (!hit || !hit.bytes) return null;
    try {
      const parsed = JSON.parse(hit.bytes.toString('utf8'));
      const design = Object.freeze({ provider: 'claude', model: String(parsed.model || ''), slides: validateDesign(parsed, lessonPartsInfo(lesson).parts.length) });
      put(digest, design);
      return design;
    } catch (_) { return null; }
  }
  async function remember(digest, lesson, design) {
    if (!stored) return false;
    const body = JSON.stringify({ key: lesson.moduleId + ':' + lesson.lessonId, model: design.model, slides: design.slides });
    return store.put('design:' + digest, Buffer.from(body, 'utf8'), { kind: 'design', contentType: 'application/json', meta: { moduleId: lesson.moduleId, lessonId: lesson.lessonId, model: design.model, slides: design.slides.length } });
  }

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
    const system = 'You are the visual lesson designer for Making Easy Money Academy. Convert only the supplied verified curriculum into a concise, professional 16:9 teaching deck. Return exactly one slide per narration part, in the same order. Use the simplest accurate explanation first. Describe an original hand-drawn cartoon or diagram that the Academy renderer can build; never imitate, trace, or reproduce another creator’s frames or branding. Use only concrete examples present in the source. Never invent prices, market events, performance claims, guarantees, or financial advice. Do not change the lesson facts or answer the knowledge check.';
    const jsonOnly = ' Reply with one JSON object and nothing else, shaped as {"slides":[{"heading":string,"visual":string,"callout":string,"visualKind":string}]} where visualKind is one of ' + JSON.stringify(VISUAL_KINDS) + '.';
    async function call(useModel, structured) {
      const body = {
        model: useModel,
        max_tokens: 4000,
        system: structured ? system : system + jsonOnly,
        messages: [{ role: 'user', content: JSON.stringify(source) }]
      };
      if (structured) body.output_config = { format: { type: 'json_schema', schema: DESIGN_SCHEMA } };
      const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000)
      });
      const data = await res.json().catch(() => ({}));
      return { res, data };
    }
    /* a 400 means this request shape is refused (not that the provider is down): retry
     * without structured output, then on the fallback model, and keep the reason */
    const attempts = [[model, true], [model, false]];
    if (model !== FALLBACK_MODEL) attempts.push([FALLBACK_MODEL, false]);
    let response; let payload; let usedModel = model; let lastBad = '';
    for (const [useModel, structured] of attempts) {
      ({ res: response, data: payload } = await call(useModel, structured));
      usedModel = useModel;
      if (response.status !== 400) break;
      lastBad = String((payload && payload.error && payload.error.message) || '').replace(/\s+/g, ' ').slice(0, 300);
    }
    if (!response.ok) {
      const error = new Error('Anthropic returned ' + response.status + (lastBad ? ': ' + lastBad : ''));
      error.code = response.status === 429 ? 'provider_rate_limited' : 'provider_unavailable';
      error.status = response.status;
      throw error;
    }
    const text = (payload.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('');
    let parsed;
    try { parsed = JSON.parse(String(text).replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')); } catch (_) {
      throw Object.assign(new Error('Claude returned invalid JSON'), { code: 'invalid_design' });
    }
    const result = Object.freeze({
      provider: 'claude',
      model: usedModel,
      slides: validateDesign(parsed, parts.length)
    });
    put(digest, result);
    await remember(digest, lesson, result);
    return result;
  }

  const localCache = new Map();
  function local(lesson, keyText) {
    if (!localCache.has(keyText)) { localCache.set(keyText, designLocally(lesson)); while (localCache.size > MAX_CACHE_ITEMS) localCache.delete(localCache.keys().next().value); }
    return localCache.get(keyText);
  }

  /* The design is keyed by the lesson's exact text (not the model): a deck made once stays valid until the lesson
   * changes, whichever Claude model is configured later. `internal` is the bake and skips the per-user rate limit. */
  async function getLessonDesign({ moduleId, lessonId, userId, internal = false }) {
    const lesson = lessonMap.get(Number(moduleId) + ':' + Number(lessonId));
    if (!lesson) throw new TypeError('invalid lesson');
    const keyText = lesson.moduleId + ':' + lesson.lessonId;
    const digest = crypto.createHash('sha256').update(JSON.stringify(lesson)).digest('hex');
    if (cache.has(digest)) return { design: cache.get(digest), cached: true };
    const baked = await fromStore(digest, lesson);
    if (baked) return { design: baked, cached: true };
    if (!configured) {
      if (localFallback) return { design: local(lesson, keyText), cached: true, fallback: true };
      throw Object.assign(new Error('Claude is not configured'), { code: 'integration_unconfigured' });
    }
    if (internal !== true) consume(String(userId || 'unknown'));
    const bad = failures.get(digest);
    if (bad && now() - bad.at < FAILURE_MEMORY_MS) {
      bad.error.cached = true;
      if (localFallback) return { design: local(lesson, keyText), cached: true, fallback: true };
      throw bad.error;
    }
    if (!inflight.has(digest)) {
      inflight.set(digest, generate(lesson, digest).catch((error) => {
        if (error && /^provider_/.test(error.code || '')) {
          failures.set(digest, { at: now(), error });
          if (failures.size > 100) failures.delete(failures.keys().next().value);
        }
        throw error;
      }).finally(() => inflight.delete(digest)));
    }
    try {
      return { design: await inflight.get(digest), cached: false };
    } catch (error) {
      /* the provider refused (out of credits, a 4xx, a bad design): the lesson still gets a deck, from its own text */
      if (!localFallback || error instanceof TypeError) throw error;
      return { design: local(lesson, keyText), cached: true, fallback: true, reason: error.code || 'provider_failed' };
    }
  }

  return { configured, stored, getLessonDesign, designLocally };
}

module.exports = { createAcademySlideDesigner, designLocally, partsFor, validateDesign, DESIGN_SCHEMA, MAX_CACHE_ITEMS };
