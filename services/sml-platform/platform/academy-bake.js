'use strict';

/* Bake the whole Academy once: every lesson's Claude slide deck and ElevenLabs narration, generated one time and kept in
 * the durable media store (academy_media), so no lesson ever pays a provider again. Resumable: a part or deck already in
 * the store is skipped, so a restart mid-way (a deploy, a provider outage) only finishes what is left.
 *
 *   npm run academy:bake            everything that is missing
 *   npm run academy:bake -- design  decks only (Claude)
 *   npm run academy:bake -- voice   narration only (ElevenLabs)
 *
 * or set SML_ACADEMY_BAKE=all (or voice / design) on the service and it runs in the background after start-up
 * (then set the flag back to 0). */

const MAX_CONSECUTIVE_FAILURES = 3;

function createAcademyBake({ lessons = [], designer = null, voice = null, store = null, logger = () => {} } = {}) {
  const ordered = lessons.slice().sort((a, b) => a.moduleId - b.moduleId || a.lessonId - b.lessonId);
  let running = null;
  let last = null;

  async function one(kind, lesson, call) {
    try {
      const result = await call();
      return { ok: true, cached: Boolean(result && result.cached), fallback: Boolean(result && result.fallback) };
    } catch (error) {
      return { ok: false, error: String((error && (error.code || error.message)) || error) };
    }
  }

  /** Run the bake. Returns { design: {done, skipped, failed, stopped}, voice: {...}, errors: [...] }. */
  async function run({ design = true, voice: doVoice = true } = {}) {
    if (running) return running;
    running = (async () => {
      const report = { startedAt: new Date().toISOString(), lessons: ordered.length, design: null, voice: null, errors: [] };
      const want = [];
      if (design && designer) want.push(['design', (lesson) => designer.getLessonDesign({ moduleId: lesson.moduleId, lessonId: lesson.lessonId, userId: 'bake', internal: true })]);
      if (doVoice && voice) want.push(['voice', (lesson) => voice.getLessonAudio({ moduleId: lesson.moduleId, lessonId: lesson.lessonId, userId: 'bake', internal: true })]);
      for (const [kind, call] of want) {
        const tally = { done: 0, skipped: 0, failed: 0, stopped: '' };
        const ready = kind === 'design' ? designer.configured : voice.configured;
        if (!store || !store.durable) { tally.stopped = 'no_store'; report[kind] = tally; continue; }
        if (!ready) { tally.stopped = 'provider_unconfigured'; report[kind] = tally; continue; }
        let streak = 0;
        for (const lesson of ordered) {
          const result = await one(kind, lesson, () => call(lesson));
          const id = lesson.moduleId + '.' + lesson.lessonId;
          if (result.ok && result.fallback) { result.ok = false; result.error = 'built_in_fallback'; }
          if (result.ok) { if (result.cached) tally.skipped += 1; else tally.done += 1; streak = 0; }
          else {
            tally.failed += 1; streak += 1;
            if (report.errors.length < 40) report.errors.push({ kind, lesson: id, error: result.error });
            logger('warn', 'academy_bake_lesson_failed', { kind, lesson: id, error: result.error });
            if (streak >= MAX_CONSECUTIVE_FAILURES) { tally.stopped = result.error; logger('error', 'academy_bake_stopped', { kind, after: id, error: result.error }); break; }
          }
          if ((tally.done + tally.skipped + tally.failed) % 10 === 0) logger('info', 'academy_bake_progress', { kind, ...tally, of: ordered.length });
        }
        report[kind] = tally;
      }
      report.finishedAt = new Date().toISOString();
      report.stored = store && store.durable && typeof store.stats === 'function' ? await store.stats() : {};
      logger('info', 'academy_bake_complete', report);
      last = report;
      return report;
    })().finally(() => { running = null; });
    return running;
  }

  return { run, status: () => ({ running: Boolean(running), last }) };
}

module.exports = { createAcademyBake, MAX_CONSECUTIVE_FAILURES };

if (require.main === module) {
  (async () => {
    const { getConfig } = require('./config');
    const { createDatabase } = require('./database');
    const { SEED_LESSONS } = require('./academy/curriculum');
    const { createAcademyMediaStore } = require('./academy-media-store');
    const { createAcademyVoice } = require('./academy-voice');
    const { createAcademySlideDesigner } = require('./academy-slide-designer');
    const config = getConfig(process.env);
    const logger = (level, event, data) => console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...(data || {}) }));
    const database = createDatabase(config);
    const store = createAcademyMediaStore({ pool: database.pool, logger });
    const voice = createAcademyVoice({ apiKey: config.elevenLabsApiKey, voiceId: config.academyVoiceId, modelId: config.academyVoiceModel, lessons: SEED_LESSONS, store });
    const designer = createAcademySlideDesigner({ apiKey: config.anthropicApiKey, model: config.academyClaudeModel, lessons: SEED_LESSONS, store });
    const only = String(process.argv[2] || '').toLowerCase();
    const bake = createAcademyBake({ lessons: SEED_LESSONS, designer, voice, store, logger });
    const report = await bake.run({ design: only !== 'voice', voice: only !== 'design' });
    await database.close();
    process.exit(report.errors.length ? 1 : 0);
  })().catch((error) => { console.error(error); process.exit(1); });
}
