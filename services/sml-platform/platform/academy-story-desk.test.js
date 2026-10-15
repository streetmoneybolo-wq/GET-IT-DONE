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
    createLetter: async (l) => { posts.push({ kind: 'create', l }); return { id: 123, raw: { id: 123, slug: l.slug, url: 'https://stockmarketloop.com/n/vaughn-mcnair-grandmaster-obi/' + l.slug + '/' } }; },
    publishLetter: async (id) => { posts.push({ kind: 'publish', id }); return { ok: true }; },
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
  assert.equal(created.l.author_id, 258456581); assert.equal(created.l.status, 'draft'); assert.match(created.l.title, /\$ABCD/);
  assert.ok(created.l.tags.includes('ABCD')); assert.match(created.l.html, /What the data says/);
  assert.ok(h.posts.some((p) => p.kind === 'seo'), 'SEO store written');
  assert.ok(!h.posts.some((p) => p.kind === 'publish'), 'draft unless autopublish');
  const gifAvailable = require('./academy-scenario-gif').available();
  if (gifAvailable) { assert.equal(h.media.length, 1); assert.equal(h.media[0].contentType, 'image/gif'); assert.match(created.l.html, /<figure class="sml-story-gif">/); }
  assert.equal(h.dms.length, 1); assert.match(h.dms[0].text, /Story desk/); assert.match(h.dms[0].text, /draft/);
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
  const fetchImpl = async (url, init) => { calls.push({ url, method: init.method, ct: init.headers['content-type'] || '', auth: init.headers.authorization.slice(0, 6) }); const body = url.endsWith('/users/me?context=edit') ? { id: 258456581, name: 'Vaughn McNair', slug: 'ben' } : url.endsWith('/media') ? { id: 5, source_url: 'https://x/y.gif' } : url.endsWith('/letters') ? { id: 9, slug: 's' } : { ok: true }; return { ok: true, text: async () => JSON.stringify(body) }; };
  const p = createLettersPublisher({ siteUrl: 'https://stockmarketloop.com/', username: 'ben', appPassword: 'pw', authorId: 258456581, fetchImpl });
  assert.equal(p.configured(), true);
  assert.deepEqual(await p.identity(), { id: 258456581, name: 'Vaughn McNair', slug: 'ben' });
  const m = await p.uploadMedia({ bytes: Buffer.from('GIF89a'), filename: 'a.gif', contentType: 'image/gif', title: 't', alt: 'a' });
  assert.equal(m.id, 5); assert.equal(calls[1].ct, 'image/gif');
  const c = await p.createLetter({ title: 'x' }); assert.equal(c.id, 9);
  await p.publishLetter(9);
  assert.ok(calls.some((x) => x.url.endsWith('/sml-letters/v1/letters/9/publish') && x.method === 'POST'));
  assert.ok(calls.every((x) => x.auth === 'Basic '));
});
