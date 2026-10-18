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
        required: ['heading', 'visual', 'callout', 'visualKind', 'scene'],
        properties: {
          heading: { type: 'string' },
          visual: { type: 'string' },
          callout: { type: 'string' },
          visualKind: { type: 'string', enum: VISUAL_KINDS },
          /* what the Academy draws for the slide (academy-scene-visuals.js): short labels, the numbers behind them,
           * ordered steps and one note; each visualKind reads them its own way (see SCENE_GUIDE) */
          scene: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'labels', 'values', 'steps', 'note'],
            properties: {
              title: { type: 'string' },
              labels: { type: 'array', items: { type: 'string' } },
              values: { type: 'array', items: { type: 'number' } },
              steps: { type: 'array', items: { type: 'string' } },
              note: { type: 'string' }
            }
          }
        }
      }
    }
  }
});

/* How each visualKind reads its scene. Sent to Claude word for word and mirrored by the renderer. */
const SCENE_GUIDE = 'Each slide also carries a scene the Academy draws as an interactive diagram: title (short caption), labels (short strings, max 8, max 40 chars), values (numbers, max 8), steps (short sentences, max 6, max 90 chars), note (one line, max 120 chars; say "Example numbers" when the numbers are illustrative). Per visualKind: '
  + 'chart = values are a price path in order (4-8 points), labels annotate points by index (empty string for none); '
  + 'candles = values are closing prices in order (5-8), labels annotate candles by index; '
  + 'auction = values are prices in the book and labels say "Bid" or "Ask" (or a short tag) for each, include the spread; '
  + 'tape = steps are time and sales prints like "10:01 BUY 500 @ 20.02" (4-6), values are the sizes; '
  + 'risk = values are [entry, stop, target] (or [risk, reward] units), labels name them; '
  + 'formula = labels are the equation tokens in order (terms and operators like "=", "+", "-", "x", "/"), values are the worked numbers for each term in order; '
  + 'comparison = labels are the two column headers, steps alternate left item, right item, left, right (4-8); '
  + 'timeline = labels are the events in order (3-6), values optional positions; '
  + 'checklist = steps are the items to tick (3-6); '
  + 'flow = steps are the stages in order (3-6); '
  + 'options = values are [strike, premium], note says call or put; '
  + 'question = empty scene. Use the lesson\'s own numbers when it has them; otherwise small round illustrative numbers that teach the point, never presented as real market data.';

const SCENE_LIMITS = Object.freeze({ title: 60, labels: 8, label: 40, values: 8, steps: 6, step: 90, note: 120 });
/* A scene is cleaned, never refused: a slide with an odd scene still gets its deck, with the scene trimmed to what the renderer draws. */
function cleanScene(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const labels = (Array.isArray(raw.labels) ? raw.labels : []).map((v) => str(v, SCENE_LIMITS.label)).slice(0, SCENE_LIMITS.labels);
  const values = (Array.isArray(raw.values) ? raw.values : []).filter((v) => typeof v === 'number' && Number.isFinite(v)).slice(0, SCENE_LIMITS.values);
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).map((v) => str(v, SCENE_LIMITS.step)).filter(Boolean).slice(0, SCENE_LIMITS.steps);
  const title = str(raw.title, SCENE_LIMITS.title), note = str(raw.note, SCENE_LIMITS.note);
  if (!labels.some(Boolean) && !values.length && !steps.length) return null;
  return Object.freeze({ title, labels: Object.freeze(labels), values: Object.freeze(values), steps: Object.freeze(steps), note });
}

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
/* The numbers a step mentions ("$95", "9%", "1,000 shares"), as the renderer's labels and values. */
function numbersIn(text) {
  const found = [];
  for (const m of String(text || '').matchAll(/(\$?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(%?)/g)) {
    const value = Number((m[2] + (m[3] || '')).replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    found.push({ label: m[0], value });
    if (found.length === 8) break;
  }
  return found;
}
/* The scene a built-in slide draws: the step's own sentences as the ordered items, its numbers as the labelled values,
 * and for a chart or candles with no numbers an illustrative path that leans the way the words do. */
function sceneFor(kind, text, title) {
  const list = sentences(text).map((x) => clip(x, SCENE_LIMITS.step)).slice(0, SCENE_LIMITS.steps);
  const nums = numbersIn(text);
  const scene = { title: clip(title || '', SCENE_LIMITS.title), labels: nums.map((n) => n.label), values: nums.map((n) => n.value), steps: list, note: '' };
  if ((kind === 'chart' || kind === 'candles') && nums.length < 2) { scene.values = []; scene.labels = []; scene.note = 'Example path, not market data'; }
  if (kind === 'risk') {
    /* "entry 100, stop 98, target 106" names its levels; two bare numbers are risk and reward; anything else is the 1:3 example */
    const named = ['entry', 'stop', 'target'].map((w) => { const m = new RegExp(w + '[^\\d$]{0,16}\\$?(\\d[\\d,]*(?:\\.\\d+)?)', 'i').exec(text); return m ? Number(m[1].replace(/,/g, '')) : null; });
    if (named.every((v) => Number.isFinite(v))) { scene.values = named; scene.labels = ['Entry', 'Stop', 'Target']; }
    else if (nums.length === 2) { scene.labels = ['Entry', 'Stop', 'Target']; }
    else { scene.values = [1, 3]; scene.labels = ['Entry', 'Stop', 'Target']; scene.note = 'Example numbers'; }
  }
  if (kind === 'options' && nums.length < 2) { scene.values = [100, 5]; scene.labels = []; scene.note = 'Example call: strike 100, premium 5'; }
  if (kind === 'comparison') scene.labels = ['The idea', 'In practice'];
  if (kind === 'timeline') { scene.labels = list.map((x) => clip(x, SCENE_LIMITS.label)); scene.values = []; }
  if (kind === 'formula' && nums.length < 2) { scene.labels = list.slice(0, 1).map((x) => clip(x, SCENE_LIMITS.label)); }
  return scene;
}
function designLocally(lesson) {
  const { parts, exampleIndex, example } = lessonPartsInfo(lesson);
  const last = parts.length - 1;
  let step = 0;
  const slides = parts.map((part, index) => {
    if (index === 0) {
      const kind = kindFor(lesson.title + ' ' + (lesson.description || ''), 'chart');
      const outline = (lesson.steps || []).slice(0, SCENE_LIMITS.steps).map((x, i) => clip(headingFrom(x, i + 1), SCENE_LIMITS.step));
      return { heading: clip(lesson.title, 100), visual: clip(lesson.description || part, 700), callout: clip(lesson.level ? lesson.level + ' lesson · ' + (lesson.duration || 'a few minutes') : 'Lesson overview', 220), visualKind: 'flow', scene: { title: 'What this lesson covers', labels: [], values: [], steps: outline.length ? outline : [clip(lesson.title, SCENE_LIMITS.step)], note: kind === 'flow' ? '' : '' } };
    }
    if (index === exampleIndex && example) {
      return { heading: clip(example.title || 'The simple version', 100), visual: clip((example.say || []).join(' ') || part, 700), callout: 'A worked example with made-up numbers, so the idea is clear before the real market is.', visualKind: kindFor((example.title || '') + ' ' + (example.say || []).join(' '), 'flow') };
    }
    if (index === last && lesson.question && lesson.question.prompt) {
      return { heading: 'Knowledge check', visual: clip(lesson.question.prompt, 700), callout: 'Pick the best answer. The explanation follows whichever you choose.', visualKind: 'question' };
    }
    step += 1;
    const kind = kindFor(part, 'chart');
    return { heading: headingFrom(part, step), visual: clip(part, 700), callout: calloutFrom(part), visualKind: kind, scene: sceneFor(kind, part, headingFrom(part, step)) };
  });
  return Object.freeze({ provider: 'academy', model: 'built-in', slides: validateDesign({ slides }, parts.length) });
}

function repairSlides(value, expected, lesson) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.slides)) return value;
  const got = value.slides.length;
  if (got === expected || got === 0 || got < Math.ceil(expected / 2)) return value;
  const local = designLocally(lesson).slides;
  const slides = value.slides.slice(0, expected);
  while (slides.length < expected) slides.push(local[slides.length]);
  return { ...value, slides };
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
    const out = {
      heading: slide.heading.trim(),
      visual: slide.visual.trim(),
      callout: slide.callout.trim(),
      visualKind: slide.visualKind
    };
    const scene = slide.visualKind === 'question' ? null : cleanScene(slide.scene);
    if (scene) out.scene = scene;
    return Object.freeze(out);
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
      narrationPartCount: parts.length,
      narrationParts: parts,
      workedExample: example ? { partIndex: exampleIndex, title: example.title, say: example.say } : null,
      simulation: lesson.simulation
    };
    const system = 'You are the visual lesson designer for Making Easy Money Academy. Convert only the supplied verified curriculum into a concise, professional 16:9 teaching deck. Return exactly one slide per narration part, in the same order: narrationParts has ' + parts.length + ' entries, so the slides array must have exactly ' + parts.length + ' slides, the first for the lesson title, the last for the knowledge check. Use the simplest accurate explanation first. Every slide teaches with a picture: pick the visualKind that makes the sentence visible (a price path, candles, the order book, the tape, a risk bar, a worked formula, two columns, a timeline, a checklist, a flow, an option payoff) and fill its scene so a learner can see the idea without reading. Describe an original hand-drawn cartoon or diagram that the Academy renderer can build; never imitate, trace, or reproduce another creator’s frames or branding. Use only concrete examples present in the source. Never invent market events, performance claims, guarantees, or financial advice; illustrative numbers are allowed only inside a scene and must be marked in its note. Do not change the lesson facts or answer the knowledge check. ' + SCENE_GUIDE;
    const jsonOnly = ' Reply with one JSON object and nothing else, shaped as {"slides":[{"heading":string,"visual":string,"callout":string,"visualKind":string,"scene":{"title":string,"labels":string[],"values":number[],"steps":string[],"note":string}}]} where visualKind is one of ' + JSON.stringify(VISUAL_KINDS) + '.';
    async function call(useModel, structured) {
      const body = {
        model: useModel,
        max_tokens: 8000,
        system: structured ? system : system + jsonOnly,
        messages: [{ role: 'user', content: JSON.stringify(source) }]
      };
      if (structured) body.output_config = { format: { type: 'json_schema', schema: DESIGN_SCHEMA } };
      const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000) /* a deck with scenes is long; a minute was cutting lessons off */
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
      /* a deck cut off at the token limit is not "bad JSON": say so, it is the one failure a bigger limit fixes */
      throw Object.assign(new Error(payload.stop_reason === 'max_tokens' ? 'Claude ran out of room (max_tokens) at ' + String(text).length + ' chars' : 'Claude returned invalid JSON'), { code: 'invalid_design' });
    }
    /* a deck one or two slides off is repaired, not thrown away: extras are dropped, a missing slide comes from the
     * built-in deck for that part; a deck that is mostly missing is still refused */
    const repaired = repairSlides(parsed, parts.length, lesson);
    const result = Object.freeze({
      provider: 'claude',
      model: usedModel,
      slides: validateDesign(repaired, parts.length),
      repaired: repaired !== parsed
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
      if (localFallback) return { design: local(lesson, keyText), cached: true, fallback: true, reason: bad.error.code || 'provider_failed', detail: String(bad.error.message || '').slice(0, 200), status: bad.error.status || 0, remembered: true };
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
      return { design: local(lesson, keyText), cached: true, fallback: true, reason: error.code || 'provider_failed', detail: String(error.message || '').slice(0, 200), status: error.status || 0 };
    }
  }

  return { configured, stored, getLessonDesign, designLocally };
}

module.exports = { createAcademySlideDesigner, designLocally, partsFor, validateDesign, cleanScene, sceneFor, DESIGN_SCHEMA, SCENE_GUIDE, MAX_CACHE_ITEMS };
