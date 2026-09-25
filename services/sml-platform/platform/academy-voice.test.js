'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcademyVoice, narrationFor } = require('./academy-voice');
const { SEED_LESSONS } = require('./academy/curriculum');
const { lessonParts } = require('./academy/lesson-parts');

const SEP = String.fromCharCode(10, 10); // parts are joined by one blank line

const lesson = {
  moduleId: 1,
  lessonId: 1,
  title: 'Market Structure',
  steps: ['Step one.', 'Step two.'],
  question: { prompt: 'What is the ask?' }
};

test('Academy voice sends only canonical lesson narration, one request per part, and caches the MP3', async () => {
  const calls = [];
  const service = createAcademyVoice({
    apiKey: 'private-key', voiceId: 'voice-123', lessons: [lesson],
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(Buffer.from('mp3-audio'), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    }
  });
  const first = await service.getLessonAudio({ moduleId: 1, lessonId: 1, userId: 'member-1', text: 'ignored arbitrary text' });
  const second = await service.getLessonAudio({ moduleId: 1, lessonId: 1, userId: 'member-1' });
  const expected = ['Market Structure', 'Step one.', 'Step two.', 'Knowledge check. What is the ask?'];
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(calls.length, expected.length, 'one ElevenLabs request per narration part');
  assert.deepEqual(calls.map((c) => JSON.parse(c.options.body).text).sort(), expected.slice().sort());
  assert.ok(calls.every((c) => /voice-123\/stream$/.test(c.url) && c.options.headers['xi-api-key'] === 'private-key'));
  assert.doesNotMatch(calls.map((c) => c.options.body).join(' '), /ignored arbitrary text/);
  assert.equal(JSON.parse(calls[0].options.body).model_id, 'eleven_multilingual_v2');
  assert.equal(first.audio.length, 'mp3-audio'.length * expected.length);
  assert.equal(first.partMs.length, expected.length);
  assert.deepEqual(second.partMs, first.partMs);
  // neighbouring text is sent so intonation carries across parts
  const middle = calls.map((c) => JSON.parse(c.options.body)).find((body) => body.text === 'Step one.');
  assert.equal(middle.previous_text, 'Market Structure'); assert.equal(middle.next_text, 'Step two.');
});

test('Academy voice fails closed when unconfigured or asked for a non-canonical lesson', async () => {
  const unconfigured = createAcademyVoice({ lessons: [lesson] });
  await assert.rejects(() => unconfigured.getLessonAudio({ moduleId: 1, lessonId: 1, userId: 'member' }), /not configured/);
  const configured = createAcademyVoice({ apiKey: 'key', voiceId: 'voice', lessons: [lesson], fetchImpl: async () => new Response('x') });
  await assert.rejects(() => configured.getLessonAudio({ moduleId: 99, lessonId: 99, userId: 'member' }), TypeError);
});

test('Academy voice generates and caches bounded discipline audio parts', async () => {
  let calls = 0;
  const service = createAcademyVoice({
    apiKey: 'key', voiceId: 'obi-clone', lessons: [],
    fetchImpl: async (_url, options) => {
      calls += 1;
      const body = JSON.parse(options.body);
      assert.ok(body.text.length <= 3200);
      return new Response(Buffer.from('discipline-mp3'), { status: 200 });
    }
  });
  const first = await service.getDisciplineAudio({ episodeId: 1, partIndex: 0, userId: 'one' });
  const second = await service.getDisciplineAudio({ episodeId: 1, partIndex: 0, userId: 'two' });
  assert.equal(first.audio.toString(), 'discipline-mp3');
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
  await assert.rejects(() => service.getDisciplineAudio({ episodeId: 1, partIndex: 999, userId: 'one' }), TypeError);
});

test('Academy voice combines every discipline part into one Discord MP3', async () => {
  let calls = 0;
  const service = createAcademyVoice({
    apiKey: 'key', voiceId: 'obi-clone', lessons: [],
    fetchImpl: async () => {
      calls += 1;
      return new Response(Buffer.from(`part-${calls}|`), { status: 200 });
    }
  });
  const result = await service.getDisciplineEpisodeAudio({ episodeId: 1, userId: 'discord-user' });
  assert.equal(result.partCount, 3);
  assert.equal(result.audio.toString(), 'part-1|part-2|part-3|');
  assert.equal(calls, 3);
});

test('Academy voice speaks the shared lesson parts, including the whiteboard example, and re-generates when they change', async () => {
  const put = SEED_LESSONS.find((entry) => entry.moduleId === 9 && entry.lessonId === 1);
  const texts = [];
  const service = createAcademyVoice({
    apiKey: 'key', voiceId: 'owner-clone', lessons: [put],
    fetchImpl: async (_url, options) => {
      texts.push(JSON.parse(options.body).text);
      return new Response(Buffer.from('put-mp3'), { status: 200 });
    }
  });
  await service.getLessonAudio({ moduleId: 9, lessonId: 1, userId: 'member' });
  const spoken = put.parts.slice();
  assert.deepEqual(texts.slice().sort(), spoken.slice().sort(), 'each shared narration part is one request');
  assert.equal(spoken[1], 'Here is the simple version. ' + put.example.say.join(' '));
  assert.ok(spoken[0] === 'Put Options: The Right to Sell, Protection, and Premium' && spoken[1].startsWith('Here is the simple version. Pebblestone Phones stock is at $50'));
  assert.equal(spoken[spoken.length - 1], 'Knowledge check. ' + put.question.prompt, 'the knowledge check is spoken last');
  assert.equal((await service.getLessonAudio({ moduleId: 9, lessonId: 1, userId: 'member' })).cached, true);

  // The cache is keyed by the spoken text: a different example is new audio.
  const edited = { ...put, example: { ...put.example, say: [...put.example.say.slice(0, -1), 'The strike is not a floor unless you also own the shares.'] } };
  const second = createAcademyVoice({
    apiKey: 'key', voiceId: 'owner-clone', lessons: [edited],
    fetchImpl: async (_url, options) => { texts.push(JSON.parse(options.body).text); return new Response(Buffer.from('edited-mp3'), { status: 200 }); }
  });
  const before = texts.length;
  await second.getLessonAudio({ moduleId: 9, lessonId: 1, userId: 'member' });
  const regenerated = texts.slice(before);
  assert.ok(regenerated.some((t) => t.includes('The strike is not a floor unless you also own the shares.')), 'the edited part is new audio');
});

test('every curriculum lesson narrates title, example, three steps and the check within one ElevenLabs request', () => {
  assert.equal(SEED_LESSONS.length, 121);
  for (const entry of SEED_LESSONS) {
    const id = entry.moduleId + '.' + entry.lessonId;
    const text = narrationFor(entry);
    const parts = text.split(SEP);
    assert.deepEqual(parts, lessonParts(entry), id);
    assert.deepEqual(parts, entry.parts, id);
    assert.equal(parts.length, 6, id);
    assert.ok(parts[1].startsWith('Here is the simple version. '), id);
    assert.equal(parts[5], 'Knowledge check. ' + entry.question.prompt, id);
    assert.ok(text.length <= 5000, id + ' narration is ' + text.length + ' characters');
  }
});

/* ---- exact part timing ---- */
const { mp3DurationMs, stripId3 } = require('./academy-voice');
function fakeMp3(frames, { id3 = false } = {}) {
  const frame = Buffer.alloc(417); frame[0] = 0xff; frame[1] = 0xfb; frame[2] = 0x90; frame[3] = 0x64; // MPEG1 Layer III, 128 kbps, 44.1 kHz
  const body = Buffer.concat(Array.from({ length: frames }, () => frame));
  if (!id3) return body;
  const tag = Buffer.alloc(10 + 20); tag.write('ID3', 0, 'latin1'); tag[3] = 3; tag[9] = 20; // 20 bytes of tag payload
  return Buffer.concat([tag, body]);
}

test('MP3 duration is read from the frames: 38 frames of 128 kbps / 44.1 kHz is about a second', () => {
  const ms = mp3DurationMs(fakeMp3(38)); // 38 x 26.122 ms = 992.6 ms
  assert.ok(Math.abs(ms - 993) <= 2, String(ms));
  assert.ok(Math.abs(mp3DurationMs(fakeMp3(38, { id3: true })) - ms) <= 1, 'an ID3 tag does not add time');
  assert.equal(stripId3(fakeMp3(5, { id3: true })).length, 417 * 5);
  assert.equal(mp3DurationMs(Buffer.from('not an mp3 at all, just bytes')), Math.round((29 * 8) / 128), 'unparseable audio falls back to a 128 kbps estimate');
});

test('lesson audio reports each part\'s real length and the concatenated audio matches their sum', async () => {
  const lengths = { 'Market Structure': 20, 'Step one.': 40, 'Step two.': 60, 'Knowledge check. What is the ask?': 30 };
  const service = createAcademyVoice({
    apiKey: 'k', voiceId: 'v', lessons: [lesson],
    fetchImpl: async (_url, options) => new Response(fakeMp3(lengths[JSON.parse(options.body).text], { id3: true }), { status: 200 })
  });
  const result = await service.getLessonAudio({ moduleId: 1, lessonId: 1, userId: 'm' });
  const order = ['Market Structure', 'Step one.', 'Step two.', 'Knowledge check. What is the ask?'];
  assert.deepEqual(result.partMs, order.map((t) => Math.round(lengths[t] * 26.122)).map((v, i) => result.partMs[i] && v), 'per-part lengths follow the parts in narration order');
  order.forEach((t, i) => assert.ok(Math.abs(result.partMs[i] - lengths[t] * 26.122) <= 2, t));
  assert.equal(result.audio.length, order.reduce((n, t) => n + lengths[t] * 417, 0), 'ID3 tags are stripped at the seams');
  assert.ok(Math.abs(mp3DurationMs(result.audio) - result.partMs.reduce((a, b) => a + b, 0)) <= 4);
});

test('parts are generated a few at a time and a rate-limited part is retried once', async () => {
  let active = 0, peak = 0, throttled = false;
  const big = { ...lesson, steps: ['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.'] };
  const service = createAcademyVoice({
    apiKey: 'k', voiceId: 'v', lessons: [big],
    fetchImpl: async (_url, options) => {
      active += 1; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active -= 1;
      if (JSON.parse(options.body).text === 'Three.' && !throttled) { throttled = true; return new Response('slow down', { status: 429 }); }
      return new Response(fakeMp3(4), { status: 200 });
    }
  });
  const result = await service.getLessonAudio({ moduleId: 1, lessonId: 1, userId: 'm' });
  assert.equal(result.partMs.length, 8);
  assert.ok(peak >= 2 && peak <= 3, 'peak concurrency ' + peak);
  assert.equal(throttled, true);
});
