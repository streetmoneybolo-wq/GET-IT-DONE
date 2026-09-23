'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { synthesizeNarration, chunkNarrationText, ELEVENLABS_MAX_CHARS } = require('./narration');

const CONFIG = { apiKey: 'test-key', voiceId: 'voice-123', model: 'eleven_multilingual_v2' };

function fakeFetch({ status = 200, body = Buffer.from('fake-mp3-bytes'), contentType = 'audio/mpeg', errorText = '' } = {}) {
  const calls = [];
  return {
    calls,
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        text: async () => errorText
      };
    }
  };
}

test('synthesizeNarration calls the correct ElevenLabs endpoint with the cloned voice id and model', async () => {
  const fake = fakeFetch();
  const result = await synthesizeNarration({ text: 'Stay disciplined.', ...CONFIG, fetchImpl: fake.fetchImpl });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].url, 'https://api.elevenlabs.io/v1/text-to-speech/voice-123');
  assert.equal(fake.calls[0].options.headers['xi-api-key'], 'test-key');
  const body = JSON.parse(fake.calls[0].options.body);
  assert.equal(body.text, 'Stay disciplined.');
  assert.equal(body.model_id, 'eleven_multilingual_v2');
  assert.ok(result.audio instanceof Buffer);
  assert.equal(result.contentType, 'audio/mpeg');
});

test('synthesizeNarration refuses to call ElevenLabs when configuration is missing', async () => {
  await assert.rejects(
    () => synthesizeNarration({ text: 'hi', apiKey: '', voiceId: 'v', model: 'm' }),
    /elevenlabs_not_configured:ELEVENLABS_API_KEY/
  );
  await assert.rejects(
    () => synthesizeNarration({ text: 'hi', apiKey: 'k', voiceId: '', model: 'm' }),
    /elevenlabs_not_configured:SML_ACADEMY_ELEVENLABS_VOICE_ID/
  );
});

test('synthesizeNarration rejects empty text without calling the API', async () => {
  const fake = fakeFetch();
  await assert.rejects(() => synthesizeNarration({ text: '   ', ...CONFIG, fetchImpl: fake.fetchImpl }), /narration_text_required/);
  assert.equal(fake.calls.length, 0);
});

test('synthesizeNarration rejects text over the ElevenLabs per-request limit without calling the API', async () => {
  const fake = fakeFetch();
  const tooLong = 'a'.repeat(ELEVENLABS_MAX_CHARS + 1);
  await assert.rejects(() => synthesizeNarration({ text: tooLong, ...CONFIG, fetchImpl: fake.fetchImpl }), /narration_text_too_long/);
  assert.equal(fake.calls.length, 0);
});

test('synthesizeNarration surfaces ElevenLabs error responses with status and detail', async () => {
  const fake = fakeFetch({ status: 401, errorText: 'invalid_api_key' });
  await assert.rejects(
    () => synthesizeNarration({ text: 'hi', ...CONFIG, fetchImpl: fake.fetchImpl }),
    /elevenlabs_synthesis_failed:401:invalid_api_key/
  );
});

test('chunkNarrationText keeps short scripts as a single chunk', () => {
  const chunks = chunkNarrationText('One paragraph.\n\nAnother paragraph.');
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], 'One paragraph.\n\nAnother paragraph.');
});

test('chunkNarrationText splits a long script on paragraph boundaries under the limit', () => {
  const paragraph = 'x'.repeat(2000);
  const script = Array.from({ length: 5 }, () => paragraph).join('\n\n');
  const chunks = chunkNarrationText(script, 4500);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 4500);
  assert.equal(chunks.join('\n\n'), script);
});
