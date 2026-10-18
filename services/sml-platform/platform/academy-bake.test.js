'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcademyBake, MAX_CONSECUTIVE_FAILURES } = require('./academy-bake');

const lessons = Array.from({ length: 6 }, (_, i) => ({ moduleId: 1, lessonId: i + 1, title: 'L' + (i + 1) }));
const store = { durable: true, stats: async () => ({ voice: { items: 9, bytes: 90 } }) };

test('the bake visits every lesson once for decks and narration, skipping what the store already holds, without the per-user rate limit', async () => {
  const seen = { design: [], voice: [] };
  const designer = { configured: true, getLessonDesign: async (q) => { seen.design.push(q); return { cached: q.lessonId <= 2, design: {} }; } };
  const voice = { configured: true, getLessonAudio: async (q) => { seen.voice.push(q); return { cached: false, audio: Buffer.alloc(1) }; } };
  const logs = [];
  const bake = createAcademyBake({ lessons, designer, voice, store, logger: (level, event, data) => logs.push({ level, event, data }) });
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
  const designer = { configured: true, getLessonDesign: async () => { calls += 1; return { cached: true, fallback: true, design: {} }; } };
  const voice = { configured: true, getLessonAudio: async () => { const e = new Error('ElevenLabs returned 401'); e.code = 'provider_unavailable'; throw e; } };
  const bake = createAcademyBake({ lessons, designer, voice, store });
  const report = await bake.run();
  assert.equal(calls, MAX_CONSECUTIVE_FAILURES);
  assert.equal(report.design.stopped, 'built_in_fallback'); assert.equal(report.design.failed, MAX_CONSECUTIVE_FAILURES);
  assert.equal(report.voice.stopped, 'provider_unavailable');
  assert.ok(report.errors.length >= 2 * MAX_CONSECUTIVE_FAILURES);
});

test('the bake refuses to spend without a durable store or a configured provider', async () => {
  const designer = { configured: false, getLessonDesign: async () => { throw new Error('must not be called'); } };
  const voice = { configured: true, getLessonAudio: async () => { throw new Error('must not be called'); } };
  const noStore = await createAcademyBake({ lessons, designer, voice, store: { durable: false } }).run();
  assert.equal(noStore.design.stopped, 'no_store'); assert.equal(noStore.voice.stopped, 'no_store');
  const unconfigured = await createAcademyBake({ lessons, designer, voice: { configured: false }, store }).run({ voice: false });
  assert.equal(unconfigured.design.stopped, 'provider_unconfigured'); assert.equal(unconfigured.voice, null);
});
