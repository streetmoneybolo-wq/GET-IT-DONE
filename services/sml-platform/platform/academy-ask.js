'use strict';

/* Ask Obi: the owner pastes any question into the Academy and gets back an answer written the way Grandmaster-Obi talks,
 * built from the Academy's own material. Every lesson (steps, worked examples, knowledge checks), the Street Smarts track
 * and the discipline episodes are cut into passages once and ranked for each question (BM25 over stemmed words, with a
 * small trading thesaurus so "PT" finds "target"). The best passages go to Claude with Obi's voice rules and two real
 * excerpts of his writing, and the answer comes back as plain speech: no headings, no bullet dumps, no AI tells.
 * Owner only: the server checks the signed-in Discord id against the owner list; nobody else sees the button or the route. */

const crypto = require('node:crypto');
const { lessonPartsInfo } = require('./academy/lesson-parts');

const DEFAULT_MODEL = 'claude-sonnet-5-5';
const REQUESTS_PER_MINUTE = 20;
const MAX_QUESTION = 2000;
const TOP_PASSAGES = 12;
const MAX_CONTEXT_CHARS = 9000;

const STOP = new Set(('a an and are as at be but by for from has have how i if in into is it its of on or that the this to was what when where which who why will with you your can do does did not no so than then there these those about after before over under up down out more most very just also like get got make made one two'
  + ' me my we our they them he she his her it\'s i\'m don\'t doesn\'t isn\'t should would could').split(/\s+/));
/* words that mean the same thing on a trading desk */
const SYNONYMS = {
  pt: ['target'], tgt: ['target'], sl: ['stop'], stoploss: ['stop'], 'stop-loss': ['stop'], tp: ['target'],
  calls: ['call', 'option'], puts: ['put', 'option'], premium: ['option'], expiry: ['expiration'], exp: ['expiration'],
  dte: ['expiration', 'days'], iv: ['implied', 'volatility'], theta: ['decay', 'time'], greeks: ['delta', 'gamma', 'theta', 'vega'],
  l2: ['level', 'depth', 'book'], dom: ['depth', 'book'], tape: ['time', 'sales', 'prints'], spread: ['bid', 'ask'],
  rr: ['risk', 'reward'], 'r:r': ['risk', 'reward'], size: ['position', 'sizing'], sizing: ['position', 'size'],
  drawdown: ['loss', 'peak', 'trough'], fomo: ['chasing', 'discipline', 'patience'], revenge: ['discipline', 'tilt'],
  scalp: ['day', 'trade', 'quick'], swing: ['swing', 'days', 'weeks'], shorting: ['short', 'sale', 'borrow'],
  squeeze: ['short', 'cover'], gap: ['gap', 'open', 'premarket'], pre: ['premarket'], ah: ['after', 'hours'],
  vwap: ['average', 'volume', 'price'], ema: ['moving', 'average'], sma: ['moving', 'average'], macd: ['momentum'], rsi: ['momentum', 'overbought', 'oversold'],
  candle: ['candlestick'], wick: ['candlestick', 'shadow'], doji: ['candlestick', 'indecision'],
  float: ['shares', 'outstanding'], mcap: ['market', 'cap'], er: ['earnings'], eps: ['earnings'], guidance: ['earnings', 'outlook'],
  fed: ['rates', 'interest'], fomc: ['rates', 'interest', 'fed'], cpi: ['inflation'], yield: ['bond', 'rates'],
  diversify: ['diversification'], hedge: ['hedging', 'protection'], leverage: ['margin', 'borrow'], margin: ['leverage', 'borrow'],
  bagholding: ['loss', 'hold', 'discipline'], averaging: ['average', 'down', 'add']
};

const stem = (w) => {
  let s = w;
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('es')) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  return s;
};
function tokens(text, expand = false) {
  const raw = String(text || '').toLowerCase().replace(/[’']/g, "'").match(/[a-z0-9][a-z0-9:'-]*/g) || [];
  const out = [];
  for (const w0 of raw) {
    const w = w0.replace(/^'+|'+$/g, '');
    if (!w || STOP.has(w)) continue;
    out.push(stem(w));
    if (expand && SYNONYMS[w]) for (const alt of SYNONYMS[w]) out.push(stem(alt));
  }
  return out;
}

/* ---------- the corpus: passages with where they came from ---------- */
function buildCorpus({ lessons = [], episodes = [] } = {}) {
  const docs = [];
  const add = (source, title, text, kind) => {
    const body = String(text || '').replace(/\s+/g, ' ').trim();
    if (body.length < 20) return;
    docs.push({ source, title, kind, text: body, terms: tokens(body), titleTerms: new Set(tokens(title)) });
  };
  for (const lesson of lessons) {
    const id = lesson.moduleId + '.' + lesson.lessonId, title = String(lesson.title || '');
    add(id, title, title + '. ' + (lesson.description || ''), 'lesson');
    (lesson.steps || []).forEach((step, i) => add(id, title, step, 'step ' + (i + 1)));
    const { example } = lessonPartsInfo(lesson);
    if (example && Array.isArray(example.say)) add(id, title, (example.title ? example.title + '. ' : '') + example.say.join(' '), 'worked example');
    const q = lesson.question;
    if (q && q.prompt) {
      const options = Object.entries(q.options || {}).map(([k, v]) => k + ') ' + v).join(' ');
      add(id, title, 'Knowledge check: ' + q.prompt + ' ' + options + (q.correct ? ' Correct answer: ' + q.correct + '.' : '') + (q.explanation ? ' ' + q.explanation : ''), 'knowledge check');
    }
  }
  for (const ep of episodes) {
    const paragraphs = String(ep.script || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    let buf = '';
    for (const p of paragraphs) {
      buf = buf ? buf + ' ' + p : p;
      if (buf.length > 420) { add('discipline ' + ep.id, ep.title, buf, 'discipline episode'); buf = ''; }
    }
    if (buf) add('discipline ' + ep.id, ep.title, buf, 'discipline episode');
  }
  /* BM25 statistics */
  const df = new Map();
  let total = 0;
  for (const d of docs) { total += d.terms.length; for (const t of new Set(d.terms)) df.set(t, (df.get(t) || 0) + 1); }
  const avg = docs.length ? total / docs.length : 1;
  return { docs, df, avg };
}

function rank(corpus, question, top = TOP_PASSAGES) {
  const q = tokens(question, true);
  if (!q.length) return [];
  const want = new Map();
  for (const t of q) want.set(t, (want.get(t) || 0) + 1);
  const N = corpus.docs.length, k1 = 1.4, b = 0.75;
  const scored = [];
  for (const d of corpus.docs) {
    const tf = new Map();
    for (const t of d.terms) if (want.has(t)) tf.set(t, (tf.get(t) || 0) + 1);
    if (!tf.size) continue;
    let score = 0;
    for (const [t, f] of tf) {
      const n = corpus.df.get(t) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (d.terms.length / corpus.avg)))) * Math.min(2, want.get(t));
    }
    /* a passage that holds most of the question's distinct words beats one that repeats a single word */
    score *= 0.6 + 0.4 * (tf.size / want.size);
    /* and the lesson whose title names the thing asked about comes first */
    for (const t of want.keys()) if (d.titleTerms.has(t)) { const n = corpus.df.get(t) || 0; score += 1.5 * Math.log(1 + (N - n + 0.5) / (n + 0.5)); }
    scored.push({ d, score });
  }
  scored.sort((x, y) => y.score - x.score);
  const out = [];
  let chars = 0;
  for (const { d, score } of scored) {
    if (out.length >= top || chars + d.text.length > MAX_CONTEXT_CHARS) break;
    out.push({ ...d, score: Math.round(score * 100) / 100 }); chars += d.text.length;
  }
  return out;
}

/* ---------- Obi's voice ---------- */
function voiceSamples(episodes) {
  const picks = [];
  for (const ep of episodes.slice(0, 3)) {
    const paragraphs = String(ep.script || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const sample = paragraphs.slice(0, 4).join('\n').slice(0, 700);
    if (sample) picks.push(sample);
  }
  return picks;
}

function systemPrompt(samples) {
  return [
    'You are Grandmaster-Obi, the founder and head teacher of Making Easy Money Academy (Stockmarketloop). You are answering a question in your own words, the way you talk to your members: a real person who has traded for years, made the mistakes, and teaches straight.',
    'Write exactly how Obi writes. Study these excerpts of his and match the rhythm, warmth and bluntness:',
    ...samples.map((s, i) => '--- Obi excerpt ' + (i + 1) + ' ---\n' + s),
    '--- end excerpts ---',
    'Voice rules: first person, plain words, contractions. Talk to one person like you are answering them in the chat, not writing an article. Answer in the first sentence; the rest only backs it up. Be certain: say what you do and what you would do, no "it depends", no "generally", no "may want to consider", no list of caveats, no "there are a few things". One concrete example with simple round numbers at most, and only when it makes the point land. Humor is dry and brief. Open with the point itself or a hard truth; never with "Great question", never with a restatement of the question.',
    'Never use headings, markdown, bullet lists, numbered lists, emojis, or em dashes. If steps are needed, write them as sentences ("First... Then... Last..."). No sign-off lines like "Stay disciplined!" unless it reads natural. Never mention being an AI, a model, a system, a prompt, or "the material provided". Never say "as an educator" or "it\'s important to note".',
    'Ground the answer in the Academy passages supplied with the question; they are your own lessons, so speak from them as your own knowledge (never cite them by number, never quote them verbatim as a block). If the passages do not cover the question, say plainly that the Academy does not have a lesson on that exact thing yet, then still answer from sound trading knowledge in the same voice, keeping it consistent with how the Academy teaches: risk first, position size before conviction, no guarantees, no hype.',
    'Never invent performance numbers, win rates, or promises of returns. Do not tell the reader to buy or sell a specific stock now; teach the decision instead.',
    'Length: short. Two to five sentences, 30 to 90 words, one paragraph. A yes/no question gets the yes or no first and one reason. Only a question with several distinct parts may run to two short paragraphs, never more than 140 words. Stop as soon as the point is made; do not summarise, do not add a closing line, do not repeat yourself.',
    'Opinions and predictions: when someone asks which way a market or a stock is going (tomorrow, this week, into earnings, whatever the horizon), give a real call. Say UP, DOWN or FLAT in the first sentence, name the level or the thing that would prove you wrong, and give the one reason you lean that way. Use the MARKET READ block when one is supplied; it is your own desk\'s read. You are allowed to be wrong and you say so once at most ("if I\'m wrong, it\'s because..."), but you never dodge: no "nobody knows", no "I can\'t predict", no "it could go either way", no "do your own research", no list of both cases without picking one. Every call you make is logged and scored later, so make it a call.',
    'Output the answer text only.'
  ].join('\n\n');
}

const { readCall } = require('./academy-ask-log');

function createAcademyAsk({ apiKey = '', model = DEFAULT_MODEL, lessons = [], episodes = [], fetchImpl = globalThis.fetch, now = Date.now, logger = () => {}, context = null, log = null } = {}) {
  const configured = Boolean(apiKey && typeof fetchImpl === 'function');
  const corpus = buildCorpus({ lessons, episodes });
  const samples = voiceSamples(episodes);
  const system = systemPrompt(samples);
  const rate = new Map();

  function consume(userId) {
    const t = now();
    const cur = rate.get(userId);
    const bucket = !cur || t - cur.startedAt >= 60_000 ? { startedAt: t, count: 0 } : cur;
    bucket.count += 1; rate.set(userId, bucket);
    if (bucket.count > REQUESTS_PER_MINUTE) throw Object.assign(new Error('Ask rate limit exceeded'), { code: 'rate_limited' });
  }

  function clean(question) {
    const q = String(question || '').replace(/\r/g, '').trim();
    if (!q) throw new TypeError('empty question');
    return q.slice(0, MAX_QUESTION);
  }

  async function ask({ question, userId }) {
    const q = clean(question);
    if (!configured) throw Object.assign(new Error('Ask is not configured'), { code: 'integration_unconfigured' });
    consume(String(userId || 'unknown'));
    const passages = rank(corpus, q);
    const lessonsText = passages.length
      ? passages.map((p, i) => '[' + (i + 1) + '] Lesson ' + p.source + ' "' + p.title + '" (' + p.kind + '): ' + p.text).join('\n\n')
      : '(no Academy passage matched this question)';
    /* a direction question gets the desk's live market read, so the call is Obi's read of today and not a guess from a lesson */
    const call = readCall(q, '');
    let read = '';
    if (call.asksDirection && typeof context === 'function') {
      try { read = String(await context({ question: q, subject: call.subject, horizon: call.horizon }) || '').trim().slice(0, 4000); } catch (error) { logger('warn', 'academy_ask_context_failed', { error: String(error && error.message || error) }); read = ''; }
    }
    const user = 'QUESTION FROM A MEMBER:\n' + q + '\n\n' + (read ? 'MARKET READ RIGHT NOW (your own desk\'s data; use it, do not quote it as a source):\n' + read + '\n\n' : '')
      + (call.asksDirection ? 'This question asks for a direction. Answer with a call: UP, DOWN or FLAT first, then the reason and what proves you wrong.\n\n' : '')
      + 'ACADEMY PASSAGES (your own lessons, most relevant first):\n' + lessonsText;
    const started = now();
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 400, system, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(75_000)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = String((data && data.error && data.error.message) || '').replace(/\s+/g, ' ').slice(0, 300);
      const error = new Error('Anthropic returned ' + res.status + (detail ? ': ' + detail : ''));
      error.code = res.status === 429 ? 'provider_rate_limited' : 'provider_unavailable'; error.status = res.status;
      throw error;
    }
    const answer = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
    if (!answer) throw Object.assign(new Error('Claude returned no text'), { code: 'provider_unavailable' });
    const sources = [];
    for (const p of passages) if (!sources.some((s) => s.source === p.source)) sources.push({ source: p.source, title: p.title });
    logger('info', 'academy_ask_answered', { userId, chars: q.length, passages: passages.length, model: data.model || model, ms: now() - started, id: crypto.createHash('sha1').update(q).digest('hex').slice(0, 10), direction: call.asksDirection ? readCall(q, answer).direction : null });
    let logged = null;
    if (log && typeof log.record === 'function') {
      try { logged = await log.record({ userId, question: q, answer, model: data.model || model, context: read }); } catch (error) { logger('warn', 'academy_ask_log_failed', { error: String(error && error.message || error) }); }
    }
    const made = readCall(q, answer);
    return { answer, sources: sources.slice(0, 8), model: data.model || model, passages: passages.length, call: made.asksDirection ? { direction: made.direction, subject: made.subject, horizon: made.horizon } : null, logId: logged ? logged.id : null };
  }

  return { configured, model, ask, rank: (q, top) => rank(corpus, q, top), corpusSize: corpus.docs.length, system };
}

module.exports = { createAcademyAsk, buildCorpus, rank, tokens, systemPrompt, MAX_QUESTION, REQUESTS_PER_MINUTE };
