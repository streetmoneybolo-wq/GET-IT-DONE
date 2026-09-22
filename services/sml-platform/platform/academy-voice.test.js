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

test('Academy voice sends only canonical lesson narration and caches the MP3', async () => {
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
  assert.equal(first.audio.toString(), 'mp3-audio');
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /voice-123\/stream$/);
  assert.equal(calls[0].options.headers['xi-api-key'], 'private-key');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.text, narrationFor(lesson));
  // A lesson without a whiteboard example keeps the legacy narration.
  assert.equal(body.text, ['Market Structure', 'Step one.', 'Step two.', 'Knowledge check. What is the ask?'].join(SEP));
  assert.doesNotMatch(body.text, /ignored arbitrary text/);
  assert.equal(body.model_id, 'eleven_multilingual_v2');
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
  assert.equal(texts[0], put.parts.join(SEP));
  assert.deepEqual(texts[0].split(SEP), lessonParts(put));
  assert.equal(texts[0].split(SEP)[1], 'Here is the simple version. ' + put.example.say.join(' '));
  assert.ok(texts[0].startsWith('Put Options: The Right to Sell, Protection, and Premium' + SEP + 'Here is the simple version. Pebblestone Phones stock is at $50'));
  assert.ok(texts[0].endsWith(SEP + 'Knowledge check. ' + put.question.prompt), 'the knowledge check is spoken last');
  assert.equal((await service.getLessonAudio({ moduleId: 9, lessonId: 1, userId: 'member' })).cached, true);

  // The cache is keyed by the spoken text: a different example is new audio.
  const edited = { ...put, example: { ...put.example, say: [...put.example.say.slice(0, -1), 'The strike is not a floor unless you also own the shares.'] } };
  const second = createAcademyVoice({
    apiKey: 'key', voiceId: 'owner-clone', lessons: [edited],
    fetchImpl: async (_url, options) => { texts.push(JSON.parse(options.body).text); return new Response(Buffer.from('edited-mp3'), { status: 200 }); }
  });
  await second.getLessonAudio({ moduleId: 9, lessonId: 1, userId: 'member' });
  assert.notEqual(texts[1], texts[0]);
  assert.ok(texts[1].includes('The strike is not a floor unless you also own the shares.' + SEP));
});

test('every curriculum lesson narrates title, example, three steps and the check within one ElevenLabs request', () => {
  assert.equal(SEED_LESSONS.length, 101);
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
