'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runOnce, cleanChapters, validJob, langCode, createSpeech, createChapterer, createClient, JobError } = require('./video-transcripts');

const ORIGIN = 'https://stockmarketloop.com';
const KEY = 'a'.repeat(48);
const job = (over = {}) => ({ key: KEY, video_id: '88kbaonkfnj1', url: `${ORIGIN}/wp-content/uploads/2026/07/v.mp4`, duration: 1500, title: '10% rule', ticker: 'SPY', want_chapters: true, ...over });

function fakeRequest(next) {
  const calls = [];
  const request = async (p, body) => { calls.push({ p, body }); return p === 'jobs/next' ? { job: next } : { ok: true }; };
  request.origin = ORIGIN;
  request.calls = calls;
  return request;
}
const media = (pieces = 2) => ({
  downloads: [],
  async download(url, dest) { this.downloads.push(url); fs.writeFileSync(dest, 'x'); return 1; },
  async split(_input, dir) { return Array.from({ length: pieces }, (_, i) => { const f = path.join(dir, `piece-00${i}.mp3`); fs.writeFileSync(f, 'a'); return f; }); }
});
const speech = {
  async transcribe(file) {
    const i = Number(path.basename(file).match(/(\d+)\.mp3$/)[1]);
    return { language: 'english', duration: 1200, segments: [[0, 4, `piece ${i} start`], [30, 36, `piece ${i} later`]] };
  }
};
const chapterer = { async suggest() { return [{ time: '0:00', label: 'Intro' }, { time: '5:00', label: 'The rule' }, { time: '20:10', label: 'Risk' }]; } };

test('idle when WordPress has no job', async () => {
  const request = fakeRequest(null);
  assert.deepEqual(await runOnce({ request, media: media(), speech, chapterer }), { status: 'idle' });
  assert.equal(request.calls.length, 1);
});

test('transcribes every piece, offsets timestamps and posts the result', async () => {
  const request = fakeRequest(job());
  const m = media(2);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vxt-'));
  const out = await runOnce({ request, media: m, speech, chapterer, tmpRoot });
  assert.equal(out.status, 'ready');
  const done = request.calls.find(c => c.p === 'jobs/complete').body;
  assert.equal(done.key, KEY);
  assert.equal(done.language, 'en');
  assert.deepEqual(done.segments.map(s => s[0]), [0, 30, 1200, 1230]);
  assert.equal(done.segments[2][2], 'piece 1 start');
  assert.equal(done.chapters.length, 3);
  assert.equal(done.duration, 2400);
  assert.deepEqual(m.downloads, [job().url]);
  assert.deepEqual(fs.readdirSync(tmpRoot), [], 'temp files are removed');
});

test('skips chapters when the creator already has them', async () => {
  const request = fakeRequest(job({ want_chapters: false }));
  let asked = false;
  await runOnce({ request, media: media(1), speech, chapterer: { async suggest() { asked = true; return []; } } });
  assert.equal(asked, false);
  assert.deepEqual(request.calls.find(c => c.p === 'jobs/complete').body.chapters, []);
});

test('never downloads from another host', async () => {
  const request = fakeRequest(job({ url: 'https://evil.example/v.mp4' }));
  const m = media();
  const out = await runOnce({ request, media: m, speech, chapterer });
  assert.equal(out.error, 'bad_video_url');
  assert.equal(m.downloads.length, 0);
  assert.deepEqual(request.calls.find(c => c.p === 'jobs/complete').body, { key: KEY, error: 'bad_video_url' });
});

test('reports failures back to WordPress with a code', async () => {
  const request = fakeRequest(job());
  const failing = { async transcribe() { throw new JobError('transcription_rate_limited'); } };
  const out = await runOnce({ request, media: media(), speech: failing, chapterer });
  assert.equal(out.status, 'failed');
  assert.equal(request.calls.find(c => c.p === 'jobs/complete').body.error, 'transcription_rate_limited');
});

test('unexpected errors become a generic code and chapter failures do not fail the job', async () => {
  const request = fakeRequest(job());
  const out = await runOnce({ request, media: media(1), speech, chapterer: { async suggest() { throw new Error('boom'); } } });
  assert.equal(out.status, 'ready');
  const r2 = fakeRequest(job());
  const out2 = await runOnce({ request: r2, media: { async download() { throw new Error('socket'); }, async split() { return []; } }, speech, chapterer });
  assert.equal(out2.error, 'transcription_failed');
});

test('no speech is reported, not published', async () => {
  const request = fakeRequest(job());
  const silent = { async transcribe() { return { language: 'en', duration: 1200, segments: [] }; } };
  const out = await runOnce({ request, media: media(1), speech: silent, chapterer });
  assert.equal(out.error, 'no_speech');
});

test('rejects malformed jobs before touching anything', async () => {
  const request = fakeRequest({ key: 'nope', video_id: 'x', url: '' });
  await assert.rejects(runOnce({ request, media: media(), speech, chapterer }), /invalid_job/);
  assert.throws(() => validJob(job({ duration: 4 * 3600 }), ORIGIN), e => e.code === 'video_too_long');
});

test('cleanChapters applies the same rules as WordPress', () => {
  assert.deepEqual(cleanChapters([{ start_seconds: 4, title: 'Intro' }, { start_seconds: 70, title: 'Rule' }, { start_seconds: 250, title: 'Risk' }], 600),
    [{ time: '0:00', label: 'Intro' }, { time: '1:10', label: 'Rule' }, { time: '4:10', label: 'Risk' }]);
  assert.deepEqual(cleanChapters([{ start_seconds: 0, title: 'A' }, { start_seconds: 10, title: 'B' }, { start_seconds: 200, title: 'C' }], 600), [], 'too close together leaves fewer than three');
  assert.deepEqual(cleanChapters([{ start_seconds: 0, title: 'A' }, { start_seconds: 100, title: 'B' }, { start_seconds: 700, title: 'C' }], 600), [], 'past the end is dropped');
  assert.equal(cleanChapters([{ start_seconds: 0, title: 'A' }, { start_seconds: 100, title: 'B' }, { start_seconds: 300, title: 'C' }, { start_seconds: 595, title: 'D' }], 600).length, 3, 'a last chapter under 10 s is dropped');
});

test('language names map to codes', () => {
  assert.equal(langCode('english'), 'en');
  assert.equal(langCode('es'), 'es');
  assert.equal(langCode(''), 'en');
});

test('speech client sends a timestamped transcription request', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vxs-'));
  const f = path.join(dir, 'piece-000.mp3'); fs.writeFileSync(f, 'mp3');
  let seen;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ language: 'english', duration: 12.5, segments: [{ start: 0, end: 3.2, text: ' Hello ' }, { start: 3.2, end: 5, text: '' }] }) }; };
  const out = await createSpeech({ apiKey: 'k', fetchImpl }).transcribe(f, { prompt: 'SPY levels', language: 'en' });
  assert.equal(seen.url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(seen.opts.headers.authorization, 'Bearer k');
  assert.equal(seen.opts.body.get('model'), 'whisper-1');
  assert.equal(seen.opts.body.get('response_format'), 'verbose_json');
  assert.equal(seen.opts.body.get('timestamp_granularities[]'), 'segment');
  assert.equal(seen.opts.body.get('language'), 'en');
  assert.deepEqual(out, { language: 'english', duration: 12.5, segments: [[0, 3.2, 'Hello']] });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('speech client maps rate limits to a retryable code', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vxs-'));
  const f = path.join(dir, 'p.mp3'); fs.writeFileSync(f, 'mp3');
  await assert.rejects(createSpeech({ apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 429 }) }).transcribe(f), e => e.code === 'transcription_rate_limited');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('chapterer asks for structured chapters and validates them', async () => {
  let body;
  const fetchImpl = async (_url, opts) => { body = JSON.parse(opts.body); return { ok: true, json: async () => ({ status: 'completed', output_text: JSON.stringify({ chapters: [{ start_seconds: 0, title: 'Intro' }, { start_seconds: 90, title: 'SPY support at $540' }, { start_seconds: 300, title: 'Position sizing' }] }) }) }; };
  const segs = Array.from({ length: 10 }, (_, i) => [i * 40, i * 40 + 5, `line ${i}`]);
  const out = await createChapterer({ apiKey: 'k', model: 'm', fetchImpl }).suggest(segs, { duration: 600, title: 'T', ticker: 'SPY' });
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.store, false);
  assert.match(body.input, /\[1:20\] line 2/);
  assert.equal(out.length, 3);
  assert.equal(out[1].label, 'SPY support at $540');
  assert.deepEqual(await createChapterer({ apiKey: 'k', model: 'm', fetchImpl }).suggest(segs.slice(0, 2), { duration: 60 }), [], 'short videos get none');
});

test('client only talks to an https WordPress origin with basic auth', async () => {
  assert.throws(() => createClient({ wordpressUrl: 'http://stockmarketloop.com' }), /invalid_wp_origin/);
  let seen;
  const request = createClient({ wordpressUrl: ORIGIN, wordpressUsername: 'u', wordpressAppPassword: 'p' }, async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ job: null }) }; });
  await request('jobs/next');
  assert.equal(seen.url, `${ORIGIN}/wp-json/sml-video-extras/v1/jobs/next`);
  assert.equal(seen.opts.method, 'POST');
  assert.match(seen.opts.headers.authorization, /^Basic /);
  assert.equal(request.origin, ORIGIN);
});
