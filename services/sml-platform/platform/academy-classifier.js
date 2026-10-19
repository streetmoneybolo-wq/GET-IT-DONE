'use strict';

/* Claude as the sentiment reader for headlines, social posts and filing text, replacing the word list where it is weakest:
 * sarcasm, negation across a sentence, "beat but guided down", a post that names three tickers and is bullish on one.
 * One request per batch of up to 40 short texts, strict JSON back, results cached a day by text hash. Any failure returns
 * null and the caller keeps the lexicon score, so the composite never waits on or breaks because of the model. */

const crypto = require('node:crypto');

const SYSTEM = `You classify short finance texts (news headlines, social posts, SEC filing snippets) about ONE stock each.
Return ONLY a JSON array, one object per input in the same order: {"id":string,"score":number,"event":string,"confidence":number}.
score: -1 (clearly bearish for that stock) .. +1 (clearly bullish); 0 when neutral, off-topic, a question, or a joke with no view.
event: one of earnings, guidance, analyst, product, legal, macro, insider, mna, financing, other.
confidence: 0..1, low when the text is ambiguous, sarcastic, or mostly about another ticker.
Never add commentary. Never give advice.`;

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');

function parseArray(text) {
  const s = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const tryParse = (chunk) => { try { return JSON.parse(chunk); } catch (_) { return undefined; } };
  const whole = tryParse(s);
  if (Array.isArray(whole)) return whole;
  if (whole && typeof whole === 'object') { const arr = Object.values(whole).find(Array.isArray); if (arr) return arr; }
  const start = s.indexOf('['), end = s.lastIndexOf(']');
  if (start < 0) return null;
  const inner = end > start ? tryParse(s.slice(start, end + 1)) : undefined;
  if (Array.isArray(inner)) return inner;
  /* a truncated answer: keep the complete rows before the cut */
  const rows = [];
  for (const m of s.slice(start + 1).matchAll(/\{[^{}]*\}/g)) { const r = tryParse(m[0]); if (r && typeof r === 'object') rows.push(r); }
  return rows.length ? rows : null;
}

function createClassifier({ apiKey = '', model = 'claude-haiku-5-5', fetchImpl = fetch, now = Date.now, ttlMs = 24 * 3_600_000, maxBatch = 40, timeoutMs = 12_000, logger = () => {} } = {}) {
  const enabled = Boolean(apiKey);
  const cache = new Map();
  let failUntil = 0;
  async function call(batch) {
    const lines = batch.map((b) => ({ id: b.id, symbol: b.symbol, text: b.text }));
    const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 60 * batch.length + 100, system: SYSTEM, messages: [{ role: 'user', content: JSON.stringify(lines) }] }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error(`anthropic_${response.status}`);
    const j = await response.json();
    const text = Array.isArray(j && j.content) ? j.content.filter((c) => c && c.type === 'text').map((c) => c.text).join('') : '';
    const rows = parseArray(text); if (!rows) throw new Error('anthropic_bad_json');
    const out = new Map();
    for (const r of rows) if (r && r.id != null) out.set(String(r.id), { score: clamp(num(r.score)), event: String(r.event || 'other').slice(0, 20), confidence: Math.max(0, Math.min(1, num(r.confidence, 0.5))) });
    return out;
  }
  /* items: [{ id, symbol, text }] -> Map id -> { score, event, confidence, model }; null when the model is off or failed */
  async function classify(items) {
    if (!enabled) return null;
    const list = (Array.isArray(items) ? items : []).map((it) => ({ id: String(it.id), symbol: String(it.symbol || ''), text: String(it.text || '').replace(/\s+/g, ' ').trim().slice(0, 600) })).filter((it) => it.text);
    if (!list.length) return new Map();
    const result = new Map(), pending = [];
    const t = now();
    for (const it of list) { const k = hash(it.symbol + '|' + it.text); const hit = cache.get(k); if (hit && hit.until > t) result.set(it.id, hit.value); else pending.push({ ...it, k }); }
    if (pending.length && failUntil <= t) {
      try {
        for (let i = 0; i < pending.length; i += maxBatch) {
          const batch = pending.slice(i, i + maxBatch);
          const got = await call(batch);
          for (const b of batch) { const v = got.get(b.id); if (v) { const value = { ...v, model }; cache.set(b.k, { until: t + ttlMs, value }); result.set(b.id, value); } }
        }
        if (cache.size > 5000) for (const k of [...cache.keys()].slice(0, 1000)) cache.delete(k);
      } catch (error) {
        failUntil = t + 2 * 60_000;
        logger('warn', 'classifier_failed', { error: String(error && error.message || error), pending: pending.length });
        if (!result.size) return null;
      }
    }
    return result.size || !pending.length ? result : null; // in back-off with nothing cached: null, so callers keep the lexicon
  }
  return { classify, enabled, model };
}

module.exports = { createClassifier, parseArray, SYSTEM };
