'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStoryDesk, createLettersPublisher, createPolisher } = require('./academy-story-desk');

const DAY = 86_400_000;
function daily(n, { start = 10, t0 = Date.UTC(2026, 7, 3, 20) } = {}) { const out = []; let px = start, t = t0; for (let i = 0; i < n;) { const wd = new Date(t).getUTCDay(); if (wd !== 0 && wd !== 6) { const o = px, c = px * (1 + 0.004 + Math.sin(i / 5) * 0.01); out.push({ t, o, h: Math.max(o, c) * 1.01, l: Math.min(o, c) * 0.99, c, v: 3_000_000 }); px = c; i += 1; } t += DAY; } return out; }

function harness(over = {}) {
  const bars = daily(80), last = bars[bars.length - 1];
  const nowMs = last.t + 15 * 3_600_000; // the next morning, 11:00 ET-ish
  const posts = [], media = [], dms = [];
  let saved = null;
  const publisher = {
    configured: () => true, authorId: 258456581,
    identity: async () => ({ id: over.meId || 258456581, name: 'Vaughn McNair' }),
    uploadMedia: async (m) => { media.push(m); return { id: 77, url: 'https://stockmarketloop.com/wp-content/uploads/x.gif' }; },
    createLetter: async (l) => { posts.push({ kind: 'create', l }); return { id: 123, slug: l.slug, raw: { ok: true, letter_id: 123, slug: l.slug } }; },
    getLetter: async (id) => ({ id, url: 'https://stockmarketloop.com/n/vaughn-mcnair-grandmaster-obi/x/', slug: 'x', status: 'draft' }),
    publishLetter: async (id) => { posts.push({ kind: 'publish', id }); return { ok: true, status: 'published', url: 'https://stockmarketloop.com/n/vaughn-mcnair-grandmaster-obi/x/' }; },
    saveSeo: async (id, seo) => { posts.push({ kind: 'seo', id, seo }); return { ok: true }; }
  };
  const desk = createStoryDesk({
    universe: async () => [{ symbol: 'ABCD', price: last.c, changePct: 5.1, volume: 9_000_000 }, { symbol: 'QUIET', price: 20, changePct: 0.1, volume: 100_000 }],
    candles: async (s) => ({ bars: s === 'QUIET' ? daily(80, { start: 20 }) : bars }),
    gamma: { get: async (s) => (s === 'ABCD' ? { available: true, regime: 'negative', pressurePct: 33, pressure: 'high', flipStrike: last.c * 0.97, flipDistancePct: -3, callWall: { strike: last.c * 1.05, distancePct: 5 }, zeroDteShare: 0.4 } : { available: false }) },
    shortData: async (s) => (s !== 'ABCD' ? null : { volume: [{ date: '2026-10-13', short: 500, total: 1000 }, { date: '2026-10-14', short: 560, total: 1000 }], interest: [{ days_to_cover: 4.2, short_percent_float: 18 }] }),
    finra: { forSymbol: async (s) => (s !== 'ABCD' ? [] : [{ date: '2026-10-14', short: 5600, exempt: 0, offExchange: 10000, shortRatio: 0.56 }]) },
    institutional: { get: async (s) => (s !== 'ABCD' ? { available: false } : { available: true, bias: 35, label: 'institutional buy', tape: { sweeps: { buy: 4, sell: 1 }, blocks: { buy: 2, sell: 0 } }, notes: [] }) },
    darkPool: async (s) => (s !== 'ABCD' ? null : { offSharePct: 55, typicalSharePct: 42, blocks: { list: [{ dir: 1 }, { dir: 1 }, { dir: -1 }] } }),
    smc: require('./academy-smart-money'), sentiment: { get: async () => ({ ok: true, score: 0.3, label: 'lean bullish', components: {} }) },
    earnings: async () => ({ daysAway: 12 }), playbook: null, direction: async () => ({ ok: true, bias: 25, label: 'Lean bullish' }), runner: require('./academy-runner'), company: async () => ({ name: 'Abcd Robotics', market_cap: 2e9 }),
    heat: { heatFor: async (s) => (s === 'ABCD' ? { google24h: 12, bing24h: 6, coverage: { gamma: 0, short: 1, earnings: 0, tape: 0, structure: 0 } } : { google24h: 0, bing24h: 0, coverage: {} }) },
    publisher, polisher: over.polisher || null, dm: async (id, text) => { dms.push({ id, text }); }, ownerIds: ['1'],
    store: { read: async () => saved, write: async (v) => { saved = JSON.parse(JSON.stringify(v)); } },
    marketState: () => ({ tradingDay: true }), now: () => nowMs, autopublish: over.autopublish || false, windowFrom: 0, windowTo: 1440, ...over.deps
  });
  return { desk, posts, media, dms, saved: () => saved, bars };
}

test('a tick scans the universe, writes the strongest uncovered angle as a draft letter with the GIF cover, and DMs the owner', async () => {
  const h = harness();
  const r = await h.desk.tick();
  assert.ok(r && r.filed === 1, JSON.stringify(r && { scanned: r.scanned, candidates: r.candidates, ranked: r.ranked, filed: r.filed }));
  const created = h.posts.find((p) => p.kind === 'create');
  assert.equal(created.l.visibility, 'public'); assert.match(created.l.title, /\$ABCD/); assert.ok(!('author_id' in created.l), 'the signed-in account is the author');
  assert.ok(created.l.tags.includes('ABCD')); assert.match(created.l.html, /What the data says/);
  assert.ok(created.l.blocks.some((b) => b.type === 'heading' && b.text === 'What the data says') && created.l.blocks.some((b) => b.type === 'paragraph'), 'reader blocks');
  assert.equal(created.l.blocks[0].type, 'custom_code', 'the styled card leads'); assert.match(created.l.blocks[0].html, /Key takeaways/); assert.match(created.l.blocks[0].css, /\.ad-t/); assert.ok(created.l.blocks[0].height >= 420);
  assert.ok(created.l.blocks.some((b) => b.type === 'heading' && /Why it matters/.test(b.text)) && created.l.blocks.some((b) => b.type === 'heading' && /The case against/.test(b.text)));
  assert.ok(created.l.subtitle.length > 20 && created.l.subtitle.length <= 160);
  assert.equal(created.l.blocks[created.l.blocks.length - 1].type, 'disclosure');
  const seo = h.posts.find((p) => p.kind === 'seo'); assert.ok(seo, 'SEO store written'); assert.equal(seo.seo.schema, 'NewsArticle'); assert.ok(seo.seo.meta_title.length <= 60, seo.seo.meta_title); assert.equal(typeof seo.seo.tags, 'string');
  assert.ok(seo.seo.meta_desc.length >= 110 && seo.seo.meta_desc.length <= 155, 'description length ' + seo.seo.meta_desc.length); assert.match(seo.seo.keyword, /^ABCD /); assert.equal(seo.seo.twitter, 'summary_large_image'); assert.equal(seo.seo.category, 'Markets'); assert.equal(seo.seo.subject, '$ABCD');
  assert.equal(r.results[0].url, 'https://stockmarketloop.com/n/vaughn-mcnair-grandmaster-obi/x/');
  assert.ok(!h.posts.some((p) => p.kind === 'publish'), 'draft unless autopublish');
  const gifAvailable = require('./academy-scenario-gif').available();
  if (gifAvailable) { assert.ok(h.media.length >= 1 && h.media.length <= 2, 'the GIF, plus a still poster for social cards'); assert.equal(h.media[0].contentType, 'image/gif'); assert.ok(created.l.blocks.some((b) => b.type === 'image'), 'the animated path is in the body'); assert.ok(created.l.cover_url && created.l.cover_url.startsWith('https://')); }
  assert.equal(h.dms.length, 1); assert.match(h.dms[0].text, /Article Desk/); assert.match(h.dms[0].text, /draft/);
  assert.ok(h.saved().written['ABCD:' + r.results[0].angle]);
  const again = await h.desk.tick();
  assert.equal(again.filed, 0, 'the same symbol is not written twice in a day');
});

test('autopublish only when the signed-in account is the byline', async () => {
  const a = harness({ autopublish: true });
  await a.desk.tick();
  assert.ok(a.posts.some((p) => p.kind === 'publish'));
  const b = harness({ autopublish: true, meId: 258456543 });
  await b.desk.tick();
  assert.ok(!b.posts.some((p) => p.kind === 'publish'));
  assert.match(b.dms[0].text, /not the byline/);
});

test('write(symbol) drafts one piece on demand', async () => {
  const h = harness();
  const r = await h.desk.write('ABCD');
  assert.equal(r.ok, true); assert.ok(r.story.rank > 0); assert.match(r.draft.title, /\$ABCD/); assert.equal(r.filed.letterId, 123);
  assert.match(r.draft.document, /^<!doctype html>/); assert.match(r.draft.document, /<style>/); assert.match(r.draft.document, /"@type":"NewsArticle"/); assert.match(r.draft.document, /itemprop="articleBody"/); assert.equal((r.draft.document.match(/<script/g) || []).length, 1, 'only the JSON-LD script'); assert.ok(r.draft.seo.meta_title.length <= 60);
});

test('the polisher refuses output that invents a number or breaks the structure', async () => {
  const draft = '<h2>What the data says</h2><p>Price $12.40, volume 2.8x.</p><h2>The speculation</h2><p>x</p>';
  const mk = (text) => createPolisher({ apiKey: 'k', fetchImpl: async () => ({ ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text }] }] }) }) });
  assert.equal(await mk('<h2>What the data says</h2><p>Price $12.40 then $19.99, volume 2.8x.</p><h2>The speculation</h2><p>longer text here to pass the length check and more words</p>').polish(draft, []), null, 'new number');
  const ok = await mk('<h2>What the data says</h2><p>Price sits at $12.40 on 2.8x volume, a loud tape.</p><h2>The speculation</h2><p>longer text here to pass the length check</p>').polish(draft, []);
  assert.ok(ok && /loud tape/.test(ok));
  assert.equal(createPolisher({}).enabled, false);
});

test('the letters publisher builds the right calls', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, method: init.method, ct: init.headers['content-type'] || '', auth: init.headers.authorization.slice(0, 6), body: typeof init.body === 'string' ? JSON.parse(init.body) : null }); const body = url.endsWith('/users/me?context=edit') ? { id: 258456581, name: 'Vaughn McNair', slug: 'ben' } : url.endsWith('/media') ? { id: 5, source_url: 'https://x/y.gif' } : url.endsWith('/letters') ? { ok: true, letter_id: 9, slug: 's' } : url.endsWith('/letters/9') && init.method === 'GET' ? { id: 9, slug: 's', url: 'https://stockmarketloop.com/n/vaughn-mcnair-grandmaster-obi/s/', status: 'draft' } : url.endsWith('/publish') ? { ok: true, status: 'published', letter: { url: 'https://stockmarketloop.com/n/vaughn-mcnair-grandmaster-obi/s/' } } : { ok: true }; return { ok: true, text: async () => JSON.stringify(body) }; };
  const p = createLettersPublisher({ siteUrl: 'https://stockmarketloop.com/', username: 'ben', appPassword: 'pw', authorId: 258456581, fetchImpl });
  assert.equal(p.configured(), true);
  assert.deepEqual(await p.identity(), { id: 258456581, name: 'Vaughn McNair', slug: 'ben' });
  const m = await p.uploadMedia({ bytes: Buffer.from('GIF89a'), filename: 'a.gif', contentType: 'image/gif', title: 't', alt: 'a' });
  assert.equal(m.id, 5); assert.equal(calls[1].ct, 'image/gif');
  const c = await p.createLetter({ title: 'x', subtitle: 'sub', tags: ['A'], visibility: 'public', blocks: [{ id: 'p1', type: 'paragraph', spans: [{ text: 'hi' }] }], html: '<p>hi</p>', slug: 'ignored' }); assert.equal(c.id, 9); assert.equal(c.slug, 's');
  const create = calls.find((x) => x.url.endsWith('/sml-letters/v1/letters')); assert.deepEqual(create.body, { title: 'x' }, 'create takes the title only');
  const patch = calls.find((x) => x.url.endsWith('/sml-letters/v1/letters/9') && x.method === 'POST'); assert.deepEqual(Object.keys(patch.body).sort(), ['blocks', 'subtitle', 'tags', 'visibility']);
  assert.equal((await p.getLetter(9)).url, 'https://stockmarketloop.com/n/vaughn-mcnair-grandmaster-obi/s/');
  const pub = await p.publishLetter(9); assert.equal(pub.status, 'published'); assert.match(pub.url, /\/s\/$/);
  assert.ok(calls.some((x) => x.url.endsWith('/sml-letters/v1/letters/9/publish') && x.method === 'POST'));
  await p.saveSeo(9, { meta_title: 't' }); assert.deepEqual(calls[calls.length - 1].body, { seo: { meta_title: 't' } });
  assert.ok(calls.every((x) => x.auth === 'Basic '));
});
