'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcademyBake, MAX_CONSECUTIVE_FAILURES, RATE_LIMIT_WAITS } = require('./academy-bake');

const lessons = Array.from({ length: 6 }, (_, i) => ({ moduleId: 1, lessonId: i + 1, title: 'L' + (i + 1) }));
const store = { durable: true, stats: async () => ({ voice: { items: 9, bytes: 90 } }) };

test('the bake visits every lesson once for decks and narration, skipping what the store already holds, without the per-user rate limit', async () => {
  const seen = { design: [], voice: [] };
  const designer = { configured: true, getLessonDesign: async (q) => { seen.design.push(q); return { cached: q.lessonId <= 2, design: {} }; } };
  const voice = { configured: true, getLessonAudio: async (q) => { seen.voice.push(q); return { cached: false, audio: Buffer.alloc(1) }; } };
  const logs = [];
  const bake = createAcademyBake({ lessons, designer, voice, store, logger: (level, event, data) => logs.push({ level, event, data }), wait: async () => {} });
  const report = await bake.run();
  assert.deepEqual(report.design, { done: 4, skipped: 2, failed: 0, stopped: '' });
  assert.deepEqual(report.voice, { done: 6, skipped: 0, failed: 0, stopped: '' });
  assert.equal(seen.design.length, 6); assert.equal(seen.voice.length, 6);
  assert.ok(seen.design.every((q) => q.internal === true && q.userId === 'bake'));
  assert.deepEqual(report.stored, { voice: { items: 9, bytes: 90 } });
  assert.equal(logs.filter((l) => l.event === 'academy_bake_complete').length, 1);
  assert.equal(bake.status().running, false); assert.equal(bake.status().last, report);
});

test('the bake stops a kind after repeated provider failures instead of paying for 151 refusals, and a built-in fallback deck is not counted as baked', async () => {
  let calls = 0;
  const designer = { configured: true, getLessonDesign: async () => { calls += 1; return { cached: true, fallback: true, design: {}, reason: 'provider_unavailable', status: 400, detail: 'Anthropic returned 400: Your credit balance is too low' }; } };
  const voice = { configured: true, getLessonAudio: async () => { const e = new Error('ElevenLabs returned 401'); e.code = 'provider_unavailable'; throw e; } };
  const bake = createAcademyBake({ lessons, designer, voice, store, wait: async () => {} });
  const report = await bake.run();
  assert.equal(calls, MAX_CONSECUTIVE_FAILURES);
  assert.equal(report.design.stopped, 'built_in_fallback'); assert.equal(report.design.failed, MAX_CONSECUTIVE_FAILURES);
  assert.equal(report.errors.find((e) => e.kind === 'voice').detail, 'ElevenLabs returned 401', 'the provider message travels with the failure');
  assert.equal(report.voice.stopped, 'provider_unavailable');
  assert.ok(report.errors.length >= 2 * MAX_CONSECUTIVE_FAILURES);
  assert.match(report.errors.find((e) => e.kind === 'design').detail, /provider_unavailable 400 Anthropic returned 400: Your credit balance/);
});

test('the bake refuses to spend without a durable store or a configured provider', async () => {
  const designer = { configured: false, getLessonDesign: async () => { throw new Error('must not be called'); } };
  const voice = { configured: true, getLessonAudio: async () => { throw new Error('must not be called'); } };
  const noStore = await createAcademyBake({ lessons, designer, voice, store: { durable: false } }).run();
  assert.equal(noStore.design.stopped, 'no_store'); assert.equal(noStore.voice.stopped, 'no_store');
  const unconfigured = await createAcademyBake({ lessons, designer, voice: { configured: false }, store }).run({ voice: false });
  assert.equal(unconfigured.design.stopped, 'provider_unconfigured'); assert.equal(unconfigured.voice, null);
});


test('a provider rate limit is waited out with backoff and the same lesson retried; it never counts toward the stop', async () => {
  const waits = [];
  let calls = 0;
  const voice = { configured: true, getLessonAudio: async () => { calls += 1; if (calls % 3 !== 0) { const e = new Error('ElevenLabs returned 429'); e.code = 'provider_rate_limited'; throw e; } return { cached: false, audio: Buffer.alloc(1) }; } };
  const bake = createAcademyBake({ lessons: lessons.slice(0, 3), designer: null, voice, store, wait: async (ms) => { waits.push(ms); } });
  const report = await bake.run({ design: false });
  assert.deepEqual({ done: report.voice.done, failed: report.voice.failed, stopped: report.voice.stopped }, { done: 3, failed: 0, stopped: '' });
  assert.equal(report.voice.waits, 6, 'two waits per lesson');
  assert.equal(waits.filter((ms) => ms === RATE_LIMIT_WAITS[0]).length, 3);
  assert.equal(waits.filter((ms) => ms === RATE_LIMIT_WAITS[1]).length, 3);
  // a lesson that stays rate limited past every wait is one failure, and the run moves on
  let n = 0;
  const stuck = { configured: true, getLessonAudio: async () => { n += 1; const e = new Error('429'); e.code = 'provider_rate_limited'; throw e; } };
  const r2 = await createAcademyBake({ lessons: lessons.slice(0, 1), voice: stuck, store, wait: async () => {} }).run({ design: false });
  assert.equal(n, 1 + RATE_LIMIT_WAITS.length); assert.equal(r2.voice.failed, 1);
});


test('a dropped connection is retried like a rate limit, not counted as a failure', async () => {
  let calls = 0;
  const voice = { configured: true, getLessonAudio: async () => { calls += 1; if (calls === 1) throw new TypeError('fetch failed'); return { cached: false, audio: Buffer.alloc(1) }; } };
  const report = await createAcademyBake({ lessons: lessons.slice(0, 1), voice, store, wait: async () => {} }).run({ design: false });
  assert.deepEqual([report.voice.done, report.voice.failed, report.voice.waits], [1, 0, 1]);
});


test('a request that timed out or an overloaded provider is retried like a rate limit', async () => {
  let calls = 0;
  const designer = { configured: true, getLessonDesign: async () => { calls += 1; if (calls === 1) return { cached: true, fallback: true, design: {}, reason: 'provider_failed', detail: '23 The operation was aborted due to timeout' }; if (calls === 2) { const e = new Error('Anthropic returned 529: overloaded'); e.code = 'provider_unavailable'; e.status = 529; throw e; } return { cached: false, design: {} }; } };
  const report = await createAcademyBake({ lessons: lessons.slice(0, 1), designer, store, wait: async () => {} }).run({ voice: false });
  assert.deepEqual([report.design.done, report.design.failed, report.design.waits], [1, 0, 2]);
});
