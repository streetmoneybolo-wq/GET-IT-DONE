'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClassifier, parseArray } = require('./academy-classifier');

const NOW = 1_700_000_000_000;
const reply = (rows) => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'Here you go:\n' + JSON.stringify(rows) }] }) });

test('parses a JSON array even when the model wraps it in prose', () => {
  assert.deepEqual(parseArray('Sure! [{"id":"a","score":0.5}] done'), [{ id: 'a', score: 0.5 }]);
  assert.equal(parseArray('no json here'), null);
});

test('off without a key; batches, caches by text, clamps scores', async () => {
  assert.equal(await createClassifier({}).classify([{ id: 'x', text: 'hi' }]), null);
  const bodies = [];
  const fetchImpl = async (url, opts) => { const b = JSON.parse(opts.body); bodies.push(b); const items = JSON.parse(b.messages[0].content); return reply(items.map((it) => ({ id: it.id, score: it.text.includes('beat') ? 2 : -0.4, event: 'earnings', confidence: 0.9 }))); };
  const c = createClassifier({ apiKey: 'k', fetchImpl, now: () => NOW, maxBatch: 2 });
  const r = await c.classify([{ id: '1', symbol: 'ABC', text: 'ABC beat' }, { id: '2', symbol: 'ABC', text: 'ABC miss' }, { id: '3', symbol: 'ABC', text: 'ABC guide' }]);
  assert.equal(r.get('1').score, 1, 'clamped to +1'); assert.equal(r.get('2').score, -0.4); assert.equal(r.get('3').event, 'earnings');
  assert.equal(bodies.length, 2, 'three items, batch size two => two calls'); assert.equal(bodies[0].temperature, 0); assert.ok(bodies[0].system.includes('ONLY a JSON array'));
  const again = await c.classify([{ id: '9', symbol: 'ABC', text: 'ABC beat' }]);
  assert.equal(again.get('9').score, 1); assert.equal(bodies.length, 2, 'cached by symbol+text, no new call');
});

test('a failing API returns null and backs off two minutes, then recovers', async () => {
  let t = NOW, calls = 0;
  const fetchImpl = async () => { calls++; if (calls === 1) return { ok: false, status: 529, json: async () => ({}) }; return reply([{ id: 'a', score: 0.3, event: 'other', confidence: 0.4 }]); };
  const c = createClassifier({ apiKey: 'k', fetchImpl, now: () => t });
  assert.equal(await c.classify([{ id: 'a', text: 'ABC news' }]), null);
  assert.equal(await c.classify([{ id: 'a', text: 'ABC news' }]), null, 'in backoff: no call'); assert.equal(calls, 1);
  t += 3 * 60_000;
  const r = await c.classify([{ id: 'a', text: 'ABC news' }]); assert.equal(r.get('a').score, 0.3); assert.equal(calls, 2);
});
