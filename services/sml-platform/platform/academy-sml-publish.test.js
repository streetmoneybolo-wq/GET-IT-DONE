'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createSmlPublisher } = require('./academy-sml-publish.js');

test('the publisher signs the request the way the site checks it and maps the answers', async () => {
  const secret = 'k'.repeat(40), seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, json: async () => ({ ok: true, postId: 5, status: 'published', images: 2 }) }; };
  const p = createSmlPublisher({ baseUrl: 'https://site.test/', secret, groupId: '77', fetchImpl, now: () => 1_700_000_000_000 });
  const out = await p.publish({ discordUserId: '1087769175453339648', ref: 'ca-site:1:abcdef', body: 'hi', meta: { symbol: 'SPY' }, images: [{ name: 'a.png', alt: 'A', bytes: Buffer.from('x') }] });
  assert.deepEqual([out.ok, out.postId, out.images], [true, 5, 2]);
  const path = '/wp-json/sml-loop-kick/v1/alert-publish', { url, init } = seen[0];
  assert.equal(url, 'https://site.test' + path);
  const want = crypto.createHmac('sha256', secret).update('1700000000.' + path + '.' + crypto.createHash('sha256').update(init.body).digest('hex')).digest('hex');
  assert.equal(init.headers['x-sml-lk-signature'], 'sha256=' + want);
  const body = JSON.parse(init.body); assert.equal(body.group_id, 77); assert.equal(body.images[0].b64, Buffer.from('x').toString('base64'));
  const refused = createSmlPublisher({ baseUrl: 'https://site.test', secret, groupId: 77, fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ ok: false, error: 'not_group_manager' }) }) });
  assert.deepEqual(await refused.publish({ discordUserId: '1', ref: 'abcdefghijkl', body: 'x' }), { ok: false, status: 403, error: 'not_group_manager' });
  assert.equal((await createSmlPublisher({ baseUrl: 'https://site.test', secret, groupId: '' }).publish({})).error, 'publisher_unconfigured');
});
