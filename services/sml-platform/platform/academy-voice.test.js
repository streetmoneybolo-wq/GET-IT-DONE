'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcademyVoice, narrationFor } = require('./academy-voice');

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
