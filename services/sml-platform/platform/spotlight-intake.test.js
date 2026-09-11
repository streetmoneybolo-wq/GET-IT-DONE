'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSpotlightIntake, isSpotlightSource } = require('./spotlight-intake');
const uuid = 'b6b922ed-0e5c-4f26-af5e-cb6d3eac15a4';
const source = `https://stockmarketloop.com/wp-json/sml-retail-spotlight/v1/source/${uuid}`;
const config = { wordpressUrl: 'https://stockmarketloop.com', wordpressUsername: 'test', wordpressAppPassword: 'test' };
const event = { event_uuid: uuid, source_url: source, source_event_key: 'discord:test' };

test('durably queues before ACK and reuses source hash on retry', async () => {
  const calls = [];
  const intake = createSpotlightIntake({ config,
    database: { enqueueNewsArticle: async job => { calls.push(job); return { id: 42, status: 'duplicate' }; } },
    fetchImpl: async (url, init) => ({ ok: true, json: async () => {
      if (url.endsWith('/pending')) return { events: [event] };
      assert.equal(calls.length, 1); assert.equal(JSON.parse(init.body).event_uuid, uuid);
      calls.push('ack'); return { acknowledged: true };
    } }) });
  assert.equal(await intake.run(), 1);
  assert.equal(calls[0].sourceUrlHash.length, 64);
  assert.equal(calls[1], 'ack');
});

test('never ACKs a failed enqueue or untrusted event URL', async () => {
  let ack = 0;
  const intake = createSpotlightIntake({ config,
    database: { enqueueNewsArticle: async () => { throw new Error('database down'); } },
    fetchImpl: async url => ({ ok: true, json: async () => {
      if (url.endsWith('/pending')) return { events: [event, { ...event, source_url: 'https://evil.example/' }] };
      ack++; return {};
    } }) });
  assert.equal(await intake.run(), 0); assert.equal(ack, 0);
  assert.equal(isSpotlightSource(source), true);
  assert.equal(isSpotlightSource(source + '?redirect=evil'), false);
  assert.equal(isSpotlightSource(source.replace('https:', 'http:')), false);
});

test('failed pending request releases the overlap guard for retry', async () => {
  let calls = 0;
  const intake = createSpotlightIntake({ config, database: {},
    fetchImpl: async () => { calls++; return { ok: false, status: 503 }; } });
  await assert.rejects(intake.run(), /503/);
  await assert.rejects(intake.run(), /503/);
  assert.equal(calls, 2);
});
