'use strict';

/*
 * Video transcripts for stockmarketloop.com uploads (WordPress mu-plugin sml-video-extras).
 * Poll WordPress for a queued job, download the video from the site itself, pull the audio
 * out with ffmpeg in 20-minute mono pieces (each far under OpenAI's 25 MB upload cap),
 * transcribe each piece with timestamps, optionally suggest chapters, and post the result
 * back. WordPress owns the queue, retries (3 attempts) and what gets published; this worker
 * only claims and completes.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { basicAuth } = require('./wordpress-publisher');
const { extractOutputText } = require('./article-generator');

const POLL_MS = 2 * 60 * 1000;
const PIECE_SECONDS = 1200;
const FINE_SECONDS = 30; // piece length when the model returns no timestamps: each piece becomes one transcript line
const MODELS = ['whisper-1', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe'];
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 3 * 3600;
const JOB_KEY = /^[a-f0-9]{48}$/;
const ERROR_CODE = /^[a-z0-9_]{1,60}$/;

class JobError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/* ------------------------------------------------------------------ WordPress */

function createClient(config, fetchImpl = fetch) {
  const origin = new URL(config.wordpressUrl);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('invalid_wp_origin');
  const request = async function request(p, body) {
    const r = await fetchImpl(`${origin.origin}/wp-json/sml-video-extras/v1/${p}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000),
      headers: { authorization: basicAuth(config.wordpressUsername, config.wordpressAppPassword), 'content-type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    if (!r.ok) throw new Error(`video_extras_api_${r.status}`);
    return r.json();
  };
  request.origin = origin.origin;
  return request;
}

/* ------------------------------------------------------------------ media */

function createMedia({ ffmpegPath, fetchImpl = fetch } = {}) {
  const bin = ffmpegPath || require('ffmpeg-static');
  return {
    /* Stream the file to disk; never buffer a video in memory. */
    async download(url, dest, maxBytes = MAX_VIDEO_BYTES) {
      const r = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15 * 60 * 1000) });
      if (!r.ok || !r.body) throw new JobError('download_failed');
      const declared = Number(r.headers.get('content-length') || 0);
      if (declared > maxBytes) throw new JobError('file_too_large');
      let seen = 0;
      const cap = new Transform({ transform(chunk, _enc, cb) { seen += chunk.length; cb(seen > maxBytes ? new JobError('file_too_large') : null, chunk); } });
      try { await pipeline(Readable.fromWeb(r.body), cap, fs.createWriteStream(dest)); }
      catch (error) { throw error instanceof JobError ? error : new JobError('download_failed'); }
      return seen;
    },
    /* Mono 16 kHz 32 kbps MP3 in PIECE_SECONDS pieces: ~4.8 MB per 20 minutes. */
    async split(input, dir, seconds = PIECE_SECONDS, prefix = 'piece') {
      await run(bin, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k',
        '-f', 'segment', '-segment_time', String(seconds), '-reset_timestamps', '1', path.join(dir, `${prefix}-%04d.mp3`)]);
      const files = (await fsp.readdir(dir)).filter(f => new RegExp(`^${prefix}-\\d{4}\\.mp3$`).test(f)).sort();
      if (!files.length) throw new JobError('no_audio');
      return files.map(f => path.join(dir, f));
    }
  };
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => { if (err.length < 4000) err += d; });
    child.on('error', () => reject(new JobError('ffmpeg_failed')));
    child.on('close', code => (code === 0 ? resolve() : reject(Object.assign(new JobError(/does not contain any stream|Output file #0 does not contain/i.test(err) ? 'no_audio' : 'ffmpeg_failed'), { detail: err.slice(0, 300) }))));
  });
}

/* ------------------------------------------------------------------ speech to text */

/*
 * Tries whisper-1 first (sentence timestamps). An OpenAI project may not allow every model, so on
 * model_not_found it falls back along MODELS and remembers the one that works. Only whisper returns
 * timestamps; the others return plain text and the caller times it by cutting finer pieces.
 */
function createSpeech({ apiKey, models = MODELS, fetchImpl = fetch }) {
  const state = { index: 0 };
  async function once(model, file, prompt, language) {
    const form = new FormData();
    form.append('file', new Blob([await fsp.readFile(file)], { type: 'audio/mpeg' }), path.basename(file));
    form.append('model', model);
    const stamped = /^whisper/.test(model);
    form.append('response_format', stamped ? 'verbose_json' : 'json');
    if (stamped) form.append('timestamp_granularities[]', 'segment');
    if (prompt) form.append('prompt', prompt.slice(0, 800));
    if (/^[a-z]{2}$/.test(language)) form.append('language', language);
    const r = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10 * 60 * 1000),
      headers: { authorization: `Bearer ${apiKey}` }, body: form
    });
    if (!r.ok) {
      let detail = '';
      try { const e = await r.json(); detail = String((e && e.error && (e.error.code || e.error.message)) || '').slice(0, 200); } catch { /* not json */ }
      throw Object.assign(new JobError(r.status === 429 ? 'transcription_rate_limited' : `transcription_http_${r.status}`), { detail, status: r.status });
    }
    const j = await r.json();
    return {
      model, timestamps: stamped,
      language: String(j.language || ''),
      duration: Number(j.duration || 0),
      text: String(j.text || '').trim(),
      segments: stamped ? (Array.isArray(j.segments) ? j.segments : []).map(x => [Number(x.start) || 0, Number(x.end) || 0, String(x.text || '').trim()]).filter(x => x[2]) : []
    };
  }
  return {
    get model() { return models[state.index]; },
    async transcribe(file, { prompt = '', language = '' } = {}) {
      for (;;) {
        try { return await once(models[state.index], file, prompt, language); }
        catch (error) {
          const missing = error instanceof JobError && (error.detail === 'model_not_found' || error.status === 404);
          if (!missing || state.index >= models.length - 1) throw error;
          state.index += 1; // this project cannot use that model; try the next one and keep using it
        }
      }
    }
  };
}

const LANG = { english: 'en', spanish: 'es', french: 'fr', german: 'de', portuguese: 'pt', italian: 'it', chinese: 'zh', japanese: 'ja', korean: 'ko', hindi: 'hi', arabic: 'ar', russian: 'ru', dutch: 'nl' };
function langCode(name) { const n = String(name || '').toLowerCase(); return /^[a-z]{2}$/.test(n) ? n : (LANG[n] || 'en'); }

/* ------------------------------------------------------------------ chapters */

const fmt = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };

/* The same rules WordPress enforces: first at 0:00, three or more, each at least 10 s, inside the video. */
function cleanChapters(items, duration) {
  const byStart = new Map();
  for (const c of Array.isArray(items) ? items : []) {
    const start = Math.round(Number(c.start_seconds));
    const title = String(c.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!Number.isFinite(start) || start < 0 || !title || (duration && start >= duration)) continue;
    if (!byStart.has(start)) byStart.set(start, title);
  }
  const rows = [...byStart.entries()].sort((a, b) => a[0] - b[0]);
  if (!rows.length) return [];
  rows[0][0] = 0; // a suggested first chapter a few seconds in still means "from the start"
  const kept = [];
  for (const row of rows) {
    if (kept.length && row[0] - kept[kept.length - 1][0] < 30) continue;
    kept.push(row);
  }
  if (duration && kept.length && duration - kept[kept.length - 1][0] < 10) kept.pop();
  return kept.length >= 3 ? kept.map(([s, t]) => ({ time: fmt(s), label: t })) : [];
}

const CHAPTER_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['chapters'],
  properties: { chapters: { type: 'array', minItems: 0, maxItems: 12, items: {
    type: 'object', additionalProperties: false, required: ['start_seconds', 'title'],
    properties: { start_seconds: { type: 'integer', minimum: 0 }, title: { type: 'string', minLength: 2, maxLength: 70 } }
  } } }
};

function createChapterer({ apiKey, model, fetchImpl = fetch }) {
  return {
    async suggest(segments, { duration, title, ticker }) {
      if (!duration || duration < 90 || segments.length < 4) return [];
      const want = Math.max(3, Math.min(10, Math.round(duration / 150)));
      let lines = segments.map(s => `[${fmt(s[0])}] ${s[2]}`).join('\n');
      if (lines.length > 60000) lines = lines.slice(0, 60000);
      const r = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(100000),
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model, store: false, reasoning: { effort: 'low' }, max_output_tokens: 2000,
          instructions: [
            `Split this stock-market video transcript into about ${want} chapters, like YouTube chapters.`,
            'The first chapter starts at 0. Start each chapter where the speaker actually changes topic, using the timestamps given. Keep chapters at least 30 seconds apart.',
            'Titles: 2 to 7 words, specific and searchable, naming the ticker, setup, level or idea discussed (e.g. "NVDA support at $120", "Sizing with the 10% rule").',
            'No generic titles like "Part 2" or "Discussion", no clickbait, no emojis. Only use what the transcript says.'
          ].join(' '),
          input: `Video title: ${title || 'untitled'}${ticker ? `\nMain ticker: ${ticker}` : ''}\nLength: ${fmt(duration)}\n\nTranscript:\n${lines}`,
          text: { format: { type: 'json_schema', strict: true, name: 'chapters', schema: CHAPTER_SCHEMA } }
        })
      });
      if (!r.ok) return [];
      const payload = await r.json();
      if (payload.status && payload.status !== 'completed') return [];
      try { return cleanChapters(JSON.parse(extractOutputText(payload)).chapters, duration); } catch { return []; }
    }
  };
}

/* ------------------------------------------------------------------ job */

function validJob(job, origin) {
  if (!job || !JOB_KEY.test(job.key || '') || !/^[A-Za-z0-9_-]{6,32}$/.test(job.video_id || '')) throw new Error('invalid_job');
  let u;
  try { u = new URL(job.url); } catch { throw new JobError('bad_video_url'); }
  if (u.protocol !== 'https:' || u.origin !== origin || u.username || u.password) throw new JobError('bad_video_url');
  if (Number(job.duration) > MAX_VIDEO_SECONDS) throw new JobError('video_too_long');
  return job;
}

async function runOnce({ request, media, speech, chapterer, tmpRoot = os.tmpdir() }) {
  const { job } = await request('jobs/next');
  if (!job) return { status: 'idle' };
  if (!JOB_KEY.test(job.key || '')) throw new Error('invalid_job');
  const dir = await fsp.mkdtemp(path.join(tmpRoot, 'sml-vx-'));
  try {
    validJob(job, request.origin);
    const video = path.join(dir, 'video');
    await media.download(job.url, video);
    const prompt = [job.title, job.ticker && `$${job.ticker}`].filter(Boolean).join('. ');
    const opts = { prompt, language: job.language || '' };
    let segments = [], offset = 0, language = '';
    const pieces = await media.split(video, dir);
    const first = await speech.transcribe(pieces[0], opts);
    if (first.timestamps) {
      for (let i = 0; i < pieces.length; i++) {
        const out = i ? await speech.transcribe(pieces[i], opts) : first;
        language = language || out.language;
        for (const x of out.segments) segments.push([+(x[0] + offset).toFixed(1), +(x[1] + offset).toFixed(1), x[2]]);
        offset += out.duration || PIECE_SECONDS;
      }
    } else {
      /* No timestamps from this model: re-cut into FINE_SECONDS pieces and time each line by its piece. */
      for (const f of pieces) await fsp.rm(f, { force: true });
      const fine = await media.split(video, dir, FINE_SECONDS, 'fine');
      const total = Number(job.duration) || fine.length * FINE_SECONDS;
      for (let i = 0; i < fine.length; i++) {
        const out = await speech.transcribe(fine[i], opts);
        language = language || out.language;
        const start = i * FINE_SECONDS, end = Math.min(total, start + FINE_SECONDS);
        if (out.text) segments.push([start, end, out.text]);
      }
      offset = total;
    }
    await fsp.rm(video, { force: true });
    if (!segments.length) throw new JobError('no_speech');
    const duration = Math.round(Number(job.duration) || offset);
    let chapters = [];
    if (job.want_chapters) {
      try { chapters = await chapterer.suggest(segments, { duration, title: job.title, ticker: job.ticker }); } catch { chapters = []; }
    }
    await request('jobs/complete', { key: job.key, language: langCode(language), segments, chapters, duration: Math.round(offset) });
    return { status: 'ready', video_id: job.video_id, segments: segments.length, chapters: chapters.length, model: speech.model };
  } catch (error) {
    const code = error instanceof JobError && ERROR_CODE.test(error.code) ? error.code : 'transcription_failed';
    try { await request('jobs/complete', { key: job.key, error: code }); } catch { /* WordPress reclaims stale jobs after 45 minutes */ }
    const detail = String(error.detail || (error instanceof JobError ? '' : error.message) || '').replace(/sk-[A-Za-z0-9_-]+/g, '[key]').slice(0, 300);
    return { status: 'failed', video_id: job.video_id, error: code, detail };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

function createTranscriptFlow({ request, media, speech, chapterer, onResult, onError, delay = POLL_MS }) {
  let stopped = true, timer, running;
  async function poll() {
    if (stopped) return;
    running = runOnce({ request, media, speech, chapterer });
    let result;
    try { result = await running; onResult(result); } catch (_) { onError(); }
    /* straight on to the next job after a success; a failure waits a full cycle so retries are spread out */
    finally { running = null; if (!stopped) timer = setTimeout(poll, result && result.status === 'ready' ? 5000 : delay); }
  }
  return {
    start() { if (!stopped) return; stopped = false; void poll(); },
    async stop() { stopped = true; clearTimeout(timer); if (running) await running.catch(() => {}); }
  };
}

module.exports = { createClient, createMedia, createSpeech, createChapterer, createTranscriptFlow, runOnce, cleanChapters, validJob, langCode, JobError, PIECE_SECONDS };
