'use strict';

const crypto = require('node:crypto');
const { episodeFor, splitNarration } = require('./academy/discipline-content');
const { lessonParts } = require('./academy/lesson-parts');

const DEFAULT_MODEL = 'eleven_multilingual_v2';
const MAX_CACHE_ITEMS = 64;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const REQUESTS_PER_MINUTE = 12;

/* The exact text sent to ElevenLabs: the shared narration parts (title, the
 * whiteboard "simple version" example, steps, knowledge check) joined by
 * blank lines, so audio timing matches the slides part for part. */
function narrationFor(lesson) {
  return lessonParts(lesson).join('\n\n');
}

function createAcademyVoice({ apiKey = '', voiceId = '', modelId = DEFAULT_MODEL,
  lessons = [], fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const lessonMap = new Map(lessons.map((lesson) => [`${lesson.moduleId}:${lesson.lessonId}`, lesson]));
  const cache = new Map();
  const inflight = new Map();
  const rate = new Map();
  let cacheBytes = 0;
  const configured = Boolean(apiKey && voiceId && typeof fetchImpl === 'function');

  function consume(userId) {
    const time = now();
    const existing = rate.get(userId);
    const bucket = !existing || time - existing.startedAt >= 60_000
      ? { startedAt: time, count: 0 } : existing;
    bucket.count += 1;
    rate.set(userId, bucket);
    if (bucket.count > REQUESTS_PER_MINUTE) {
      const error = new Error('academy voice rate limit exceeded');
      error.code = 'rate_limited';
      throw error;
    }
  }

  function put(key, audio) {
    cache.set(key, audio);
    cacheBytes += audio.length;
    while (cache.size > MAX_CACHE_ITEMS || cacheBytes > MAX_CACHE_BYTES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cacheBytes -= cache.get(oldest).length;
      cache.delete(oldest);
    }
  }

  async function generateText(text, cacheKey) {
    const response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`, {
      method: 'POST',
      headers: {
        accept: 'audio/mpeg',
        'content-type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: 0.58,
          similarity_boost: 0.86,
          style: 0.12,
          use_speaker_boost: true
        }
      })
    });
    if (!response.ok) {
      const error = new Error(`ElevenLabs returned ${response.status}`);
      error.code = response.status === 429 ? 'provider_rate_limited' : 'provider_unavailable';
      error.status = response.status;
      throw error;
    }
    const audio = Buffer.from(await response.arrayBuffer());
    if (!audio.length || audio.length > 12 * 1024 * 1024) {
      const error = new Error('invalid ElevenLabs audio response');
      error.code = 'provider_unavailable';
      throw error;
    }
    put(cacheKey, audio);
    return audio;
  }

  async function getLessonAudio({ moduleId, lessonId, userId }) {
    if (!configured) {
      const error = new Error('academy voice is not configured');
      error.code = 'integration_unconfigured';
      throw error;
    }
    const lesson = lessonMap.get(`${Number(moduleId)}:${Number(lessonId)}`);
    if (!lesson) throw new TypeError('invalid lesson');
    consume(String(userId || 'unknown'));
    const text = narrationFor(lesson);
    const digest = crypto.createHash('sha256').update(`${voiceId}\0${modelId}\0${text}`).digest('hex');
    if (cache.has(digest)) return { audio: cache.get(digest), cached: true };
    if (!inflight.has(digest)) {
      inflight.set(digest, generateText(text, digest).finally(() => inflight.delete(digest)));
    }
    return { audio: await inflight.get(digest), cached: false };
  }

  async function getDisciplineAudio({ episodeId, partIndex, userId }) {
    if (!configured) {
      const error = new Error('academy voice is not configured');
      error.code = 'integration_unconfigured';
      throw error;
    }
    const episode = episodeFor(episodeId);
    const parts = episode ? splitNarration(episode.script) : [];
    const index = Number(partIndex);
    if (!episode || !Number.isInteger(index) || index < 0 || index >= parts.length) throw new TypeError('invalid discipline audio part');
    consume(String(userId || 'unknown'));
    const text = parts[index];
    const digest = crypto.createHash('sha256').update(`${voiceId}\0${modelId}\0discipline\0${episode.id}\0${index}\0${text}`).digest('hex');
    if (cache.has(digest)) return { audio: cache.get(digest), cached: true, partCount: parts.length };
    if (!inflight.has(digest)) inflight.set(digest, generateText(text, digest).finally(() => inflight.delete(digest)));
    return { audio: await inflight.get(digest), cached: false, partCount: parts.length };
  }

  async function getDisciplineEpisodeAudio({ episodeId, userId }) {
    const episode = episodeFor(episodeId);
    if (!episode) throw new TypeError('invalid discipline episode');
    const partCount = splitNarration(episode.script).length;
    const buffers = [];
    let allCached = true;
    for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
      const result = await getDisciplineAudio({ episodeId, partIndex, userId });
      buffers.push(result.audio);
      allCached = allCached && result.cached;
    }
    const audio = Buffer.concat(buffers);
    if (audio.length > 24 * 1024 * 1024) {
      const error = new Error('discipline episode exceeds Discord attachment limit');
      error.code = 'attachment_too_large';
      throw error;
    }
    return { audio, cached: allCached, partCount };
  }

  return { configured, getLessonAudio, getDisciplineAudio, getDisciplineEpisodeAudio };
}

module.exports = { createAcademyVoice, narrationFor };
