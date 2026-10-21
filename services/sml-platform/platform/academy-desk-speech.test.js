'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createServer } = require('./server');
const { createAcademyVoice } = require('./academy-voice');
const { OWNER_IDS } = require('./academy-free-users');

const post = (base, body, auth) => new Promise((resolve, reject) => {
  const u = new URL(base + '/academy-activity/desk-speech'); const data = Buffer.from(JSON.stringify(body));
  const req = http.request(u, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': data.length, ...(auth ? { authorization: auth } : {}) } }, (res) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) })); });
  req.on('error', reject); req.write(data); req.end();
});

test('the live desk voice line: owner only, one line at a time, spoken once and then reused', async () => {
  const spoken = [];
  const voice = createAcademyVoice({ apiKey: 'k', voiceId: 'v', fetchImpl: async (u, o) => { spoken.push(JSON.parse(o.body).text); return new Response(Buffer.from('ID3'.padEnd(2000, 'x')), { status: 200, headers: { 'content-type': 'audio/mpeg' } }); } });
  const owner = String(OWNER_IDS[0] || '1');
  const server = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted', logger: () => {}, academyVoice: voice, academyOAuth: { verifySession: (h) => (/owner/.test(String(h)) ? { ok: true, userId: owner } : /member/.test(String(h)) ? { ok: true, userId: 'someone-else' } : { ok: false, status: 401, code: 'authorization_required' }) } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await post(base, { text: 'NVDA is on screen.' })).status, 401);
    assert.equal((await post(base, { text: 'NVDA is on screen.' }, 'member')).status, 403);
    assert.equal((await post(base, { text: '' }, 'owner')).status, 400);
    assert.equal((await post(base, { text: 'x'.repeat(601) }, 'owner')).status, 400);
    const a = await post(base, { text: 'NVDA is on screen.' }, 'owner');
    assert.equal(a.status, 200); assert.equal(a.headers['content-type'], 'audio/mpeg'); assert.ok(a.body.length > 100);
    const b = await post(base, { text: 'NVDA is on screen.' }, 'owner');
    assert.equal(b.status, 200); assert.equal(b.headers['x-academy-voice-cache'], 'hit');
    assert.deepEqual(spoken, ['NVDA is on screen.'], 'the provider was asked once for the same line');
  } finally { await new Promise((r) => server.close(r)); }
});
