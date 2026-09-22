'use strict';

const crypto = require('node:crypto');

const DEFAULT_MODEL = 'eleven_multilingual_v2';
const MAX_CACHE_ITEMS = 64;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const REQUESTS_PER_MINUTE = 12;

function narrationFor(lesson) {
  return [
    lesson.title,
    ...(Array.isArray(lesson.steps) ? lesson.steps : []),
    lesson.question && lesson.question.prompt ? `Knowledge check. ${lesson.question.prompt}` : ''
  ].filter(Boolean).join('\n\n');
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

  async function generate(lesson, cacheKey) {
    const response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`, {
      method: 'POST',
      headers: {
        accept: 'audio/mpeg',
        'content-type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        text: narrationFor(lesson),
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
      inflight.set(digest, generate(lesson, digest).finally(() => inflight.delete(digest)));
    }
    return { audio: await inflight.get(digest), cached: false };
  }

  return { configured, getLessonAudio };
}

module.exports = { createAcademyVoice, narrationFor };
