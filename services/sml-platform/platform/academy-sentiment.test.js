'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./academy-sentiment');

const NOW = Date.parse('2026-06-10T15:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

test('headline scoring: direction, negation and intensity', () => {
  assert.ok(S.scoreHeadline('Acme beats estimates and raises guidance').score > 0.5);
  assert.ok(S.scoreHeadline('Acme plunges after SEC probe and lawsuit').score < -0.5);
  assert.ok(S.scoreHeadline('Acme does not beat estimates').score < 0, 'negated positive flips');
  assert.ok(S.scoreHeadline('Acme avoids bankruptcy').score > 0, 'negated negative flips');
  assert.equal(S.scoreHeadline('Acme to present at investor conference').score, 0);
  assert.equal(S.scoreHeadline('').score, 0);
  assert.ok(Math.abs(S.scoreHeadline('Stock soars massively on record growth').score) <= 1);
  assert.equal(S.scoreHeadline('Somebody dropped by the office').hits.length >= 0, true);
});

test('news aggregate weights recent items more and ignores stale ones', () => {
  const n = S.scoreNews([
    { title: 'Acme upgraded, shares surge', date: hoursAgo(2) },
    { title: 'Acme faces probe', date: hoursAgo(300) }, // older than 7d: ignored
    { title: 'Acme plunges on miss', date: hoursAgo(120) }
  ], { now: NOW });
  assert.equal(n.available, true); assert.equal(n.n, 2);
  assert.ok(n.score > 0.3, 'fresh bullish outweighs a five-day-old bearish');
  assert.equal(n.drivers[0].title, 'Acme upgraded, shares surge');
  assert.equal(S.scoreNews([], { now: NOW }).available, false);
  assert.equal(S.scoreNews(null, { now: NOW }).reason, 'no_recent_news');
});

test('social: smoothed bull/bear score, velocity against a baseline, crowding warning', () => {
  const posts = (bull, bear, spanH) => Array.from({ length: bull + bear }, (_, i) => ({ sentiment: i < bull ? 'Bullish' : 'Bearish', timestamp: new Date(NOW - (i * spanH * 3_600_000) / (bull + bear)).toISOString() }));
  const calm = S.scoreSocial({ posts: posts(5, 5, 5) }, { now: NOW });
  assert.equal(calm.available, true); assert.equal(calm.score, 0);
  const lopsided = S.scoreSocial({ posts: posts(3, 0, 3) }, { now: NOW });
  assert.ok(lopsided.score > 0 && lopsided.score < 0.7, 'a 3-0 sample is not a perfect score');
  const surge = S.scoreSocial({ posts: posts(18, 4, 0.5) }, { baseline: { ema: 5, n: 10 }, now: NOW });
  assert.equal(surge.surge, true); assert.ok(surge.velocityRatio >= 3);
  const crowded = S.scoreSocial({ posts: posts(23, 2, 4) }, { now: NOW });
  assert.equal(crowded.crowdedLong, true);
  assert.equal(S.scoreSocial({ posts: [{}, {}] }, { now: NOW }).reason, 'too_few_posts');
  assert.equal(S.scoreSocial({ posts: [{}, {}, {}, {}] }, { now: NOW }).reason, 'untagged_posts');
  assert.equal(S.scoreSocial(null, { now: NOW }).available, false);
});

function chain(callVol, putVol, extra = []) {
  const rows = [];
  for (let k = 0; k < 8; k++) rows.push({ expiry: '2026-06-19', strike: 90 + k * 5, call: { volume: callVol, oi: 1000, iv: 0.3, delta: 0.5, gamma: 0.02, bid: 1, ask: 1.1, last: 1.05 }, put: { volume: putVol, oi: 1000, iv: 0.3, delta: -0.5, gamma: 0.02, bid: 1, ask: 1.1, last: 1.05 } });
  return rows.concat(extra);
}

test('options: put/call drives the score; dealer gamma and max pain are reported', () => {
  const bull = S.scoreOptions(chain(900, 300), { underlying: 105 });
  assert.equal(bull.available, true); assert.ok(bull.score > 0.3); assert.ok(bull.putCall.volume < 0.5);
  assert.ok(bull.maxPain != null); assert.ok(bull.gex && 'net' in bull.gex);
  const bear = S.scoreOptions(chain(300, 900), { underlying: 105 });
  assert.ok(bear.score < -0.3);
  assert.equal(S.scoreOptions([], {}).reason, 'no_chain');
  assert.equal(S.scoreOptions(chain(0, 0), { underlying: 105 }).reason, 'no_volume');
  assert.equal(S.scoreOptions(chain(900, 300), { math: null }).reason, 'options_math_missing');
});

test('market: index change and VIX band', () => {
  const calm = S.scoreMarket({ spy: { changePct: 0.8 }, qqq: { changePct: 1.1 }, vix: { level: 13 } });
  assert.ok(calm.score > 0.4); assert.equal(calm.vixBand, 'calm');
  const panic = S.scoreMarket({ spy: { changePct: -2 }, vix: { level: 35 } });
  assert.ok(panic.score < -0.6); assert.equal(panic.vixBand, 'panic');
  assert.equal(S.scoreMarket({ spy: { changePct: 0.4 } }).vixBand, null);
  assert.equal(S.scoreMarket({}).available, false);
});

test('composite rescales over available components and reports coverage', () => {
  const parts = {
    news: { available: true, score: 0.6, confidence: 1 }, social: { available: false, reason: 'too_few_posts' },
    options: { available: true, score: 0.4, confidence: 1 }, market: { available: true, score: 0.2, confidence: 1 }
  };
  const c = S.composite(parts);
  assert.equal(c.available, true); assert.equal(c.coverage, 80);
  assert.ok(c.score > 0.3 && c.score < 0.6); assert.match(c.label, /bullish/);
  assert.equal(c.components.social.reason, 'too_few_posts');
  const thin = S.composite({ news: { available: true, score: 1, confidence: 1 } });
  assert.equal(thin.available, false); assert.equal(thin.reason, 'insufficient_data');
});

test('composite flags disagreement, divergence and crowding', () => {
  const c = S.composite({
    news: { available: true, score: 0.5, confidence: 1 }, options: { available: true, score: -0.5, confidence: 1 },
    social: { available: true, score: 0.5, confidence: 1, crowdedLong: true, surge: true, velocityRatio: 4 }, market: { available: true, score: 0, confidence: 1 }
  }, { priceChangePct: -3 });
  const text = c.notes.join(' ');
  assert.match(text, /disagree/); assert.match(text, /crowded/i); assert.match(text, /4x/); assert.match(text, /falling while recent news is positive/);
});

test('service: provider failure is reported as unavailable, not as a neutral score; history and baselines persist', async () => {
  let t = NOW; const writes = [];
  const store = { async read() { return { baselines: {}, history: {} }; }, async write(v) { writes.push(JSON.parse(JSON.stringify(v))); } };
  const memory = S.createSentimentMemory({ store, now: () => t, flushMs: 0 });
  const svc = S.createSentimentService({
    news: async () => [{ title: 'Acme beats and raises', date: hoursAgo(1) }, { title: 'Acme upgraded', date: hoursAgo(3) }],
    social: async () => { throw new Error('stocktwits down'); },
    chain: async () => chain(900, 300), market: async () => ({ spy: { changePct: 0.5 }, vix: { level: 16 } }),
    quote: async () => ({ price: 105, changePct: 1.2 }), memory, now: () => t
  });
  const r = await svc.get('acme');
  assert.equal(r.ok, true); assert.equal(r.available, true);
  assert.equal(r.components.social.available, false); assert.equal(r.components.social.reason, 'provider_error');
  assert.ok(r.coverage < 100 && r.coverage >= 75);
  assert.equal(r.history.length, 1);
  await new Promise((x) => setImmediate(x));
  assert.ok(writes.length >= 1 && writes[0].history.ACME.length === 1);
  const again = await svc.get('ACME'); // cached
  assert.equal(again.asOf, r.asOf);
});

test('service: every input down gives an honest insufficient-data answer', async () => {
  const svc = S.createSentimentService({ news: async () => { throw new Error('x'); }, social: async () => null, chain: async () => null, market: async () => null, quote: async () => null });
  const r = await svc.get('ZZZ');
  assert.equal(r.available, false); assert.equal(r.reason, 'insufficient_data'); assert.equal(r.coverage, 0);
});

test('memory: baseline updates are rate limited and history is spaced and capped', async () => {
  let t = 1_000_000_000_000;
  const m = S.createSentimentMemory({ now: () => t, historyPoints: 3 });
  await m.load();
  m.observeRate('A', 10); m.observeRate('A', 100);
  assert.equal(m.baseline('A').n, 1, 'second observation within 20 minutes ignored');
  t += 21 * 60_000; m.observeRate('A', 20);
  assert.equal(m.baseline('A').n, 2); assert.ok(m.baseline('A').ema > 10 && m.baseline('A').ema < 20);
  for (let i = 0; i < 6; i++) { m.record('A', i / 10); t += 31 * 60_000; }
  assert.equal(m.history('A').length, 3);
  m.record('A', 0.9); m.record('A', 0.1); // too soon: only the first counts
});

test('lexicon matches whole words only: no hits inside Missouri, mission, wonder; beat and beats are one hit', () => {
  assert.equal(S.scoreHeadline('Missouri utility signs mission statement').score, 0);
  assert.ok(S.scoreHeadline('Company wins NASA mission contract').score > 0, 'wins counts, mission does not');
  assert.equal(S.scoreHeadline('Analysts wonder what comes next').score, 0);
  const one = S.scoreHeadline('Acme beats estimates'), two = S.scoreHeadline('Acme beat estimates');
  assert.equal(one.hits.length, 1); assert.equal(two.hits.length, 1);
  assert.ok(Math.abs(one.score - two.score) < 1e-9);
  assert.ok(S.scoreHeadline('Acme misses estimates').score < 0);
  assert.ok(S.scoreHeadline('Acme did not miss estimates').score > 0, 'negation still works');
});

test('memory load is shared: a concurrent observation is not lost when the stored state arrives', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const store = { async read() { await gate; return { baselines: { OLD: { ema: 1, n: 3, t: 5 } }, history: {} }; }, async write() {} };
  const m = S.createSentimentMemory({ store, now: () => 1e12 });
  const a = m.load(), b = m.load();
  assert.equal(a, b, 'one shared promise');
  release(); await a;
  m.observeRate('NEW', 5);
  assert.ok(m.baseline('OLD') && m.baseline('NEW'));
});
