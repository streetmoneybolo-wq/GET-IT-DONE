'use strict';

const crypto = require('node:crypto');
const { episodeFor, splitNarration } = require('./academy/discipline-content');
const { lessonParts } = require('./academy/lesson-parts');

const DEFAULT_MODEL = 'eleven_multilingual_v2';
const MAX_CACHE_ITEMS = 1024;
const MAX_CACHE_BYTES = 96 * 1024 * 1024;
const PART_CONCURRENCY = 3;
const REQUESTS_PER_MINUTE = 12;

/* The exact text sent to ElevenLabs: the shared narration parts (title, the
 * whiteboard "simple version" example, steps, knowledge check) joined by
 * blank lines, so audio timing matches the slides part for part. */
function narrationFor(lesson) {
  return lessonParts(lesson).join('\n\n');
}

/* ---------- MP3 helpers ----------
 * Each narration part is synthesised on its own, so the true length of every part is known. The slides then change when the voice actually reaches the next part,
 * instead of guessing from word counts across one long recording. */
const MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Drop a leading ID3v2 tag: joined recordings must be bare frames or players hiccup at each seam. */
function stripId3(buf) {
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    const end = 10 + size;
    if (end < buf.length) return buf.subarray(end);
  }
  return buf;
}

/** Duration in ms by walking MPEG audio frames (Layer III). Falls back to a 128 kbps estimate when the data does not parse. */
function mp3DurationMs(input) {
  const buf = stripId3(input);
  let pos = 0, ms = 0, frames = 0;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff || (buf[pos + 1] & 0xe0) !== 0xe0) { pos += 1; continue; }
    const ver = (buf[pos + 1] >> 3) & 3, layer = (buf[pos + 1] >> 1) & 3, br = (buf[pos + 2] >> 4) & 15, sr = (buf[pos + 2] >> 2) & 3, pad = (buf[pos + 2] >> 1) & 1;
    if (ver === 1 || layer !== 1 || br === 0 || br === 15 || sr === 3) { pos += 1; continue; }
    const bitrate = (ver === 3 ? MPEG1_L3[br] : MPEG2_L3[br]) * 1000, rate = RATES[ver][sr];
    const length = Math.floor(((ver === 3 ? 144 : 72) * bitrate) / rate) + pad;
    if (!length) { pos += 1; continue; }
    ms += ((ver === 3 ? 1152 : 576) / rate) * 1000; frames += 1; pos += length;
  }
  if (frames < 3) return Math.round((buf.length * 8) / 128); // 128 kbps estimate
  return Math.round(ms);
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

  async function generateText(text, cacheKey, context = {}) {
    const settings = { stability: 0.58, similarity_boost: 0.86, style: 0.12, use_speaker_boost: true };
    const payload = { text, model_id: modelId, voice_settings: settings };
    // neighbouring text keeps the intonation continuous across separately generated parts (not supported by v3 models)
    if (!/v3/i.test(modelId)) { if (context.previous) payload.previous_text = String(context.previous).slice(-400); if (context.next) payload.next_text = String(context.next).slice(0, 400); }
    let response = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`, {
        method: 'POST',
        headers: { accept: 'audio/mpeg', 'content-type': 'application/json', 'xi-api-key': apiKey },
        body: JSON.stringify(payload)
      });
      if (response.ok || (response.status !== 429 && response.status < 500)) break;
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
    }
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

  /** One narration part, cached by its own text, so an edit to one part regenerates only that part. */
  async function partAudio(text, context) {
    const digest = crypto.createHash('sha256').update(`${voiceId}\0${modelId}\0part\0${text}`).digest('hex');
    if (cache.has(digest)) return { audio: cache.get(digest), cached: true };
    if (!inflight.has(digest)) inflight.set(digest, generateText(text, digest, context).finally(() => inflight.delete(digest)));
    return { audio: await inflight.get(digest), cached: false };
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
    const parts = lessonParts(lesson);
    const results = new Array(parts.length);
    let next = 0;
    // a few parts at a time: much faster than one long recording, and inside the provider's concurrency limits
    const worker = async () => {
      while (next < parts.length) {
        const index = next; next += 1;
        results[index] = await partAudio(parts[index], { previous: parts[index - 1] || '', next: parts[index + 1] || '' });
      }
    };
    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, parts.length) }, worker));
    const buffers = results.map((r) => stripId3(r.audio));
    const partMs = buffers.map((b) => Math.max(1, mp3DurationMs(b)));
    return { audio: Buffer.concat(buffers), cached: results.every((r) => r.cached), partMs };
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

module.exports = { createAcademyVoice, narrationFor, mp3DurationMs, stripId3 };
