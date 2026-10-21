'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createServer } = require('./server');
const { createAcademyVoice } = require('./academy-voice');
const { OWNER_IDS } = require('./academy-free-users');
const A = require('./academy/article-audio');

const article = () => A.audioScript({ title: '$NVDA Is Quiet. Is the Market Deciding Something?', dek: 'A quiet range is a question worth a closer look.', lede: ['NVIDIA trades at $191.77, up 4.0% on 2.4x volume, and the range has tightened for three weeks.', 'The average true range is narrow, which is where breakouts tend to begin, though not always.'], sections: [{ heading: 'What the data shows', paragraphs: ['Price sits in the middle of its range, above the 20-day average. ' + 'More context follows in this paragraph. '.repeat(6)] }, { heading: 'The scenario', paragraphs: ['A move through $195.00 on volume would matter. ' + 'The scenario fails below $187.94. '.repeat(6)] }], bottom: 'Watch $199.44 and the volume behind any break.' });

function fixture() {
  const sc = article(); const store = { audio: { 'nvda-quiet': { parts: sc.parts, hash: sc.hash, intro: sc.intro, introHash: sc.introHash, rest: sc.rest, full: false, at: 1 } } };
  const spoken = [];
  const voice = createAcademyVoice({ apiKey: 'k', voiceId: 'v', fetchImpl: async (u, o) => { spoken.push(JSON.parse(o.body).text); return new Response(Buffer.from('ID3'.padEnd(2000, 'x')), { status: 200 }); } });
  const desk = {
    audioFor: async (slug, hash = '') => { const e = Object.prototype.hasOwnProperty.call(store.audio, slug) ? store.audio[slug] : null; return e && (!hash || e.hash === hash || e.introHash === hash) ? e : null; },
    setFullVoice: async (slug, on) => { const e = store.audio[slug]; if (!e) return null; e.full = !!on; return { slug, full: e.full, chars: e.parts.join('').length, introChars: e.intro.join('').length }; }
  };
  const owner = String(OWNER_IDS[0] || '1');
  const server = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted', logger: () => {}, getStoryDesk: () => desk, academyVoice: voice, academyOAuth: { verifySession: (h) => (/owner/.test(String(h)) ? { ok: true, userId: owner } : /member/.test(String(h)) ? { ok: true, userId: 'someone-else' } : { ok: false, status: 401, code: 'authorization_required' }) } });
  return { server, sc, store, spoken };
}
const call = (base, path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const u = new URL(base + path); const req = http.request(u, { method, headers }, (res) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })); });
  req.on('error', reject); if (body) req.write(body); req.end();
});

test('the article audio route: the opening only by default, the whole piece only when the owner turned it on, ranges, caching, and nothing it did not write', async () => {
  const { server, sc, spoken } = fixture();
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const intro = await call(base, `/academy-activity/article-audio?slug=nvda-quiet&v=${sc.introHash}&mode=intro`);
    assert.equal(intro.status, 200); assert.equal(intro.headers['content-type'], 'audio/mpeg'); assert.match(intro.headers['cache-control'], /immutable/);
    assert.equal(spoken.length, sc.intro.length, 'only the intro parts were voiced'); assert.equal(spoken.join(' '), sc.intro.join(' '));
    assert.ok(spoken.join('').length <= A.INTRO_CHARS + 200);
    const range = await call(base, `/academy-activity/article-audio?slug=nvda-quiet&v=${sc.introHash}&mode=intro`, { headers: { range: 'bytes=0-9' } });
    assert.equal(range.status, 206); assert.equal(range.body.length, 10); assert.match(range.headers['content-range'], /^bytes 0-9\//);
    const before = spoken.length; await call(base, `/academy-activity/article-audio?slug=nvda-quiet&v=${sc.introHash}&mode=intro`); assert.equal(spoken.length, before, 'a second listener costs nothing');
    assert.equal((await call(base, `/academy-activity/article-audio?slug=nvda-quiet&v=${sc.hash}&mode=full`)).status, 403, 'the full voice is off until the owner turns it on');
    assert.equal((await call(base, '/academy-activity/article-audio?slug=other&v=x')).status, 404);
    assert.equal((await call(base, '/academy-activity/article-audio?slug=__proto__&v=x')).status, 404);
    assert.equal((await call(base, `/academy-activity/article-audio?slug=nvda-quiet&v=wrong&mode=intro`)).status, 404);
  } finally { await new Promise((r) => server.close(r)); }
});

test('the owner picks the articles that get the full voice: not a member, not signed out; then the full piece is voiced once', async () => {
  const { server, sc, store, spoken } = fixture();
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
  const post = (auth, body) => call(base, '/academy-activity/articles/voice', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('', { slug: 'nvda-quiet' })).status, 401);
    assert.equal((await post('Bearer member', { slug: 'nvda-quiet' })).status, 403);
    assert.equal((await post('Bearer owner', { slug: 'not-written' })).status, 404);
    const ok = await post('Bearer owner', { slug: 'nvda-quiet', on: true }); const j = JSON.parse(ok.body);
    assert.equal(ok.status, 200); assert.equal(j.full, true); assert.ok(j.chars > j.introChars);
    assert.equal(store.audio['nvda-quiet'].full, true);
    const full = await call(base, `/academy-activity/article-audio?slug=nvda-quiet&v=${sc.hash}&mode=full`);
    assert.equal(full.status, 200); assert.ok(spoken.join(' ').includes('Watch $199.44') || spoken.join(' ').includes('199.44'));
    const n = spoken.length; await call(base, `/academy-activity/article-audio?slug=nvda-quiet&v=${sc.hash}&mode=full`); assert.equal(spoken.length, n, 'recorded once');
    const off = await post('Bearer owner', { slug: 'nvda-quiet', on: false }); assert.equal(JSON.parse(off.body).full, false);
  } finally { await new Promise((r) => server.close(r)); }
});

test('the listen page plays the opening in the owner voice, then the browser voice reads the rest; with the full voice on it plays the one recording', async (t) => {
  let playwright = null;
  for (const id of ['playwright', process.env.SML_PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright']) { try { playwright = require(id); break; } catch (_) { /* next */ } }
  if (!playwright) { t.skip('Playwright is not installed here'); return; }
  let browser; try { browser = await playwright.chromium.launch(); } catch (_) { t.skip('no browser to launch'); return; }
  const { server, sc, store } = fixture();
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const page = await (await browser.newContext()).newPage();
    await page.addInitScript(() => {
      window.__said = []; window.__played = [];
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [{ lang: 'en-US' }], speak: (u) => { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 5); }, cancel() {} } });
      window.SpeechSynthesisUtterance = function (t) { this.text = t; };
      window.Audio = function (src) { window.__played.push(src); const a = { src, onended: null, onerror: null, pause() {}, play() { setTimeout(() => a.onended && a.onended(), 20); return Promise.resolve(); } }; return a; };
    });
    assert.equal((await call(base, '/academy-activity/article-listen?slug=nope')).status, 404);
    await page.goto(base + '/academy-activity/article-listen?slug=nvda-quiet');
    assert.ok((await page.locator('#t').innerText()).length > 5);
    assert.match(await page.locator('small').innerText(), /own voice/);
    await page.click('#go'); await page.waitForFunction(() => window.__said.length > 0 && document.getElementById('go').textContent === 'Play again');
    const r1 = await page.evaluate(() => ({ played: window.__played, said: window.__said.join(' ') }));
    assert.match(r1.played[0], /mode=intro/); assert.equal(r1.played.length, 1);
    assert.ok(r1.said.includes('This is an educational analysis') && r1.said.includes('the scenario fails below') || r1.said.includes('The scenario'), 'the rest is read by the browser voice');
    store.audio['nvda-quiet'].full = true;
    await page.goto(base + '/academy-activity/article-listen?slug=nvda-quiet');
    assert.doesNotMatch(await page.locator('small').innerText(), /your device/);
    await page.click('#go'); await page.waitForFunction(() => document.getElementById('go').textContent === 'Play again');
    const r2 = await page.evaluate(() => ({ played: window.__played, said: window.__said.length }));
    assert.match(r2.played[0], /mode=full/); assert.equal(r2.said, 0, 'no browser voice when the whole piece is in the owner voice');
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
});
