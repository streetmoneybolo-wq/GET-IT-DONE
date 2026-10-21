'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const A = require('./academy/article-audio');
const { createAcademyVoice } = require('./academy-voice');

const piece = () => ({ title: '$NVDA Is Quiet. Is the Market Deciding Something?', dek: 'A quiet range is a question.', lede: ['NVIDIA trades at $191.77, up 4.0% on 2.4x volume.', 'The ATR is tight.'], sections: [{ heading: 'What the data shows', paragraphs: ['Price sits mid range. More detail follows here.', 'Never read second paragraph.'] }, { heading: 'The scenario', paragraphs: ['A move through $195.00 would matter.'] }], bottom: 'Watch $199.44.' });

test('the listen script is the part a listener wants, spoken cleanly, capped, with one standard closing line', () => {
  const r = A.audioScript(piece());
  const text = r.parts.join(' ');
  assert.ok(text.startsWith('N V D A Is Quiet.'), 'tickers are spelled out');
  assert.ok(text.includes('$191.77') && text.includes('4.0 percent') && text.includes('2.4 times volume'));
  assert.ok(text.includes('What the data shows. Price sits mid range.') && !text.includes('Never read second paragraph'));
  assert.equal(r.parts[r.parts.length - 1], A.CLOSER);
  assert.ok(r.parts.every((p) => p.length <= A.PART_CHARS * 1.5));
  assert.equal(r.hash, A.audioScript(piece()).hash, 'the same piece has the same hash');
  assert.notEqual(r.hash, A.audioScript({ ...piece(), bottom: 'Watch $200.00.' }).hash);
  const long = { ...piece(), sections: Array.from({ length: 6 }, (_, i) => ({ heading: 'Section ' + i, paragraphs: ['A long paragraph sentence repeats here. '.repeat(40)] })) };
  assert.ok(A.audioScript(long).chars <= A.MAX_CHARS + A.CLOSER.length + 10, 'a long piece is capped, so cost is capped');
  assert.deepEqual(A.audioScript(null).parts, []);
});

test('voice parts are stored by their text: a part spoken before is reused, only new text is paid for, a bad list is refused', async () => {
  const calls = [];
  const svc = createAcademyVoice({ apiKey: 'k', voiceId: 'v1', fetchImpl: async (u, o) => { calls.push(JSON.parse(o.body).text); return new Response(Buffer.from('mp3-bytes'), { status: 200 }); } });
  const first = await svc.getPartsAudio({ parts: ['One part of text.', A.CLOSER], userId: 'a' });
  assert.equal(first.reused, 0); assert.equal(calls.length, 2);
  const second = await svc.getPartsAudio({ parts: ['A different article part.', A.CLOSER], userId: 'b' });
  assert.equal(second.reused, 1, 'the standard closing line is not paid for twice'); assert.equal(calls.length, 3);
  const again = await svc.getPartsAudio({ parts: ['One part of text.', A.CLOSER], userId: 'c' });
  assert.equal(again.cached, true); assert.equal(calls.length, 3);
  for (const bad of [[], 'text', [''], [123], Array(13).fill('x'), ['x'.repeat(701)]]) await assert.rejects(svc.getPartsAudio({ parts: bad, userId: 'a' }), TypeError);
  let limited = null; for (let i = 0; i < 14 && !limited; i++) { try { await svc.getPartsAudio({ parts: [A.CLOSER], userId: 'busy' }); } catch (e) { limited = e; } }
  assert.equal(limited && limited.code, 'rate_limited');
});

test('a piece the desk wrote carries a listen player (the letter frame and the full page), a script the route can find, and a hash in the URL', async () => {
  const desk = require('./academy-article-desk');
  const E = require('./academy-story-engine');
  const bars = []; let p0 = 20; for (let i = 0; i < 80; i++) { const o = p0, c = p0 * (1 + Math.sin(i / 5) * 0.004); bars.push({ t: Date.UTC(2026, 6, 1) + i * 86_400_000, o, h: Math.max(o, c) * 1.004, l: Math.min(o, c) * 0.996, c, v: 900_000 }); p0 = c; }
  const c = { symbol: 'QUIE', name: 'Quiet Corp', price: bars[bars.length - 1].c, changePct: 0.2, relVol: 0.9, adv: 900_000, daily: bars };
  const st = E.rankStories([c], { force: true })[0];
  const out = desk.composeArticle({ story: st, c, dossier: {}, audioEndpoint: 'https://api.example/academy-activity/article-audio' });
  assert.match(out.audio.url, /^https:\/\/api\.example\/academy-activity\/article-audio\?slug=[a-z0-9-]+&v=[0-9a-f]{12}$/);
  assert.equal(out.audio.url.includes(out.slug), true);
  assert.ok(out.audio.parts.length >= 2 && out.audio.parts[out.audio.parts.length - 1] === A.CLOSER);
  assert.match(out.bodyHtml, /<audio controls preload="none" src="https:\/\/api\.example/);
  const glance = out.blocks.find((b) => b.id === 'mod-glance');
  assert.match(glance.html, /<audio controls/); assert.ok(glance.height >= 320 || glance.height > 0);
  assert.match(out.document, /mem-listen/);
  const off = desk.composeArticle({ story: st, c, dossier: {} });
  assert.equal(off.audio.url, ''); assert.doesNotMatch(off.bodyHtml, /<audio/); assert.doesNotMatch(off.blocks.find((b) => b.id === 'mod-glance').html, /<audio/);
});

test('the public audio route is wired: it looks the piece up by slug and hash, refuses anything else, rate limits, answers ranges and caches for good', () => {
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  for (const piece of ["path === '/academy-activity/article-audio'", 'desk.audioFor(', 'no_such_article_audio', 'getPartsAudio', "'accept-ranges': 'bytes'", 'immutable', '206', '416', 'audioEndpoint:']) assert.ok(server.includes(piece), piece);
});
