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
  assert.ok(created.l.blocks.some((b) => b.type === 'heading' && /Why it matters/.test(b.text)) && created.l.blocks.some((b) => b.type === 'heading' && /The bull case and the bear case/.test(b.text)));
  assert.ok(created.l.blocks.some((b) => b.id === 'mod-chart' && b.type === 'custom_code' && /<svg class="mem-chart"/.test(b.html)), 'the live chart module is a custom-code block');
  assert.match(created.l.html, /class="mem-article"/); assert.match(created.l.html, /sec\.gov/);
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
  assert.match(r.draft.document, /^<!doctype html>/); assert.match(r.draft.document, /<style>/); assert.match(r.draft.document, /"@type":"NewsArticle"/); assert.match(r.draft.document, /itemprop="articleBody"/); assert.equal((r.draft.document.match(/<script/g) || []).length, 2, 'the JSON-LD and the enhancement script'); assert.ok(r.draft.seo.meta_title.length <= 60);
  assert.equal(r.article.url, 'https://stockmarketloop.com/n/vaughn-mcnair-grandmaster-obi/x/'); assert.match(r.article.head, /<link rel="canonical" href="https:\/\/stockmarketloop\.com\/n\/vaughn-mcnair-grandmaster-obi\/x\/">/);
  assert.ok(r.article.html.startsWith('<article class="mem-article"') && r.article.css.includes('.mem-article{') && Array.isArray(r.article.blocks));
});

test('write(subject, { file: false }) composes the package without touching the site, and a topic maps to its proxy', async () => {
  const h = harness({ deps: { insights: { intent: async () => ({ ok: true, intent: { phase: 'markup', side: 'buyers', strength: 55, evidence: [{ w: 1, text: 'Structure: last BOS was up.' }], read: 'Markup: the positioned side is now paying up.' }, formulas: {}, map: { levels: [] }, glossary: {} }), shortInsight: async () => ({ ok: true, available: true, model: { score: 66 }, pressing: { score: 20 }, interest: { daysToCover: 4.2 }, verdict: { long: { call: 'squeeze candidate' } } }) }, chartEndpoint: 'https://api.example/academy-activity/article-chart' } });
  const r = await h.desk.write('abcd', { file: false });
  assert.equal(r.ok, true); assert.equal(r.filed, null); assert.equal(h.posts.length, 0, 'nothing filed'); assert.equal(h.media.length, 0, 'nothing uploaded'); assert.equal(h.dms.length, 0);
  assert.deepEqual(r.subject, { symbol: 'ABCD', topic: null, label: '$ABCD' }); assert.equal(r.dossier.intent, true); assert.equal(r.dossier.shortInsight, true); assert.equal(r.dossier.sentiment, false);
  assert.ok(r.draft.sections.includes('What the smart money is doing') && r.draft.sections.includes("The short seller's problem")); assert.ok(r.draft.modules.includes('meters'));
  assert.match(r.article.html, /data-live-endpoint="https:\/\/api\.example\/academy-activity\/article-chart"/); assert.match(r.article.html, /Markup: the positioned side/);
  assert.equal(r.article.url, ''); assert.ok(!/rel="canonical"/.test(r.article.head), 'no canonical before the piece has a URL');
  assert.ok(!Object.keys(h.saved() || {}).length || !(h.saved().written || {})['ABCD:' + r.story.angle], 'an unfiled piece is not marked written');
  const bad = await h.desk.write('???', { file: false }); assert.equal(bad.error, 'invalid_symbol');
  const topic = await h.desk.write('quiet', { file: false }); assert.equal(topic.error, 'no_angle');
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

test('the record: every written piece opens a ledger entry, open entries settle against the bars that follow, and the piece shows the record once ten resolved', async () => {
  const h = harness({ deps: { insights: {} } });
  await h.desk.tick();
  let st = await h.desk.status();
  assert.equal(st.record.total, 1); assert.equal(st.record.open, 1); assert.equal(st.record.showable, false); assert.equal(st.record.recent[0].symbol, 'ABCD');
  await h.desk.write('abcd', { file: false });
  st = await h.desk.status(); assert.equal(st.record.total, 2, 'an unfiled copy is on the record too'); assert.equal(h.saved().outcomes.length, 2);
  /* ten resolved entries already on the record make the next piece carry the line */
  const saved = h.saved();
  for (let i = 0; i < 10; i++) saved.outcomes.push({ id: 'old' + i, symbol: 'OLD', angle: 'short', lean: 'bullish', price: 10, pt: 11, stop: 9, horizonDays: 5, at: 1, status: 'resolved', result: i < 6 ? 'hit' : 'stopped', returnPct: i < 6 ? 10 : -10, maxFavPct: 0, maxAdvPct: 0, days: 2 });
  const h2 = harness({ deps: { insights: {} } }); h2.desk.load && (await h2.desk.load());
  const fresh = harness({ deps: { insights: {}, store: { read: async () => saved, write: async () => {} } } });
  const r = await fresh.desk.write('abcd', { file: false });
  assert.match(r.article.html, /class="mem-record"><strong>Desk record\.<\/strong> 6 of 10 scenario targets traded before their invalidation \(60%\), 4 stopped out/);
  assert.ok(r.article.html.includes('Past pieces say nothing about this one.'));
  /* settling: a future bar through the target resolves the open entry as a hit */
  const entry = fresh.desk.record().recent.find((e) => e.status === 'open'); assert.ok(entry);
  const lastBar = h.bars[h.bars.length - 1];
  const settled = require('./academy-article-outcomes').settleEntry({ ...saved.outcomes.find((e) => e.status === 'open') }, [{ t: lastBar.t + 2 * DAY, o: entry.pt, h: entry.pt * 1.05, l: entry.pt * 0.99, c: entry.pt * 1.02, v: 1 }], lastBar.t + 3 * DAY);
  assert.equal(settled.result, 'hit');
});

test('scheduled slots fire once per ET day in the hour after their time and file the subject through the desk', async () => {
  /* the harness clock is 15 hours after the last bar; the slots are placed around that ET minute */
  const bars = daily(80), nowMs = bars[bars.length - 1].t + 15 * 3_600_000;
  const parts = {}; for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(nowMs))) parts[x.type] = x.value;
  const m = Number(parts.hour === '24' ? 0 : parts.hour) * 60 + Number(parts.minute);
  const h = harness({ deps: { insights: {}, schedule: [{ at: m - 10, subjects: ['abcd'] }, { at: (m + 120) % 1440, subjects: ['abcd'] }] } });
  const r = await h.desk.tick();
  assert.ok(r && Array.isArray(r.scheduled), JSON.stringify(r && r.scheduled));
  const fired = r.scheduled.filter((s) => s.subject === 'abcd');
  assert.equal(fired.length, 1, 'only the slot whose hour this is: ' + JSON.stringify(r.scheduled));
  assert.equal(fired[0].ok, true); assert.ok(fired[0].url);
  const st = await h.desk.status(); assert.equal(st.schedule.length, 2); assert.equal(st.schedule.filter((s) => s.done).length, 1);
  const again = await h.desk.tick(); assert.equal((again.scheduled || []).length, 0, 'a slot fires once a day');
  assert.ok(h.posts.filter((p) => p.kind === 'create').length >= 1);
});

test('the letters publisher signs every request for the bridge plugin: clock, exact path (no query) and a hash of the exact body, as the byline', async () => {
  const crypto = require('node:crypto');
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, h: init.headers, body: init.body }); return { ok: true, text: async () => JSON.stringify(url.endsWith('/users/me?context=edit') ? { id: 258456581, name: 'V', slug: 'v' } : { ok: true, letter_id: 4, slug: 's' }) }; };
  const secret = 'x'.repeat(40);
  const p = createLettersPublisher({ siteUrl: 'https://stockmarketloop.com', secret, serviceUserId: 258456581, authorId: 258456581, fetchImpl, now: () => 1_760_000_000_000 });
  assert.equal(p.configured(), true); assert.equal(p.signed(), true);
  await p.identity();
  const me = calls[0]; assert.equal(me.h['x-sml-letters-user'], '258456581'); assert.equal(me.h['x-sml-letters-timestamp'], '1760000000'); assert.equal('authorization' in me.h, false, 'no Basic auth without a password');
  const expect = (path, body) => 'sha256=' + crypto.createHmac('sha256', secret).update('1760000000.' + path + '.' + crypto.createHash('sha256').update(body == null ? '' : body).digest('hex')).digest('hex');
  assert.equal(me.h['x-sml-letters-signature'], expect('/wp-json/wp/v2/users/me', null), 'the query string is not part of the signed path');
  await p.createLetter({ title: 'hello' });
  const create = calls.find((c) => c.url.endsWith('/sml-letters/v1/letters')); assert.equal(create.h['x-sml-letters-signature'], expect('/wp-json/sml-letters/v1/letters', JSON.stringify({ title: 'hello' })));
  const bytes = Buffer.from('GIF89a'); await p.uploadMedia({ bytes, filename: 'a.gif', contentType: 'image/gif' });
  const media = calls.find((c) => c.url.endsWith('/wp/v2/media')); assert.equal(media.h['x-sml-letters-signature'], expect('/wp-json/wp/v2/media', bytes));
  const both = createLettersPublisher({ username: 'u', appPassword: 'pw', secret, authorId: 1, fetchImpl }); await both.identity();
  const last = calls[calls.length - 1]; assert.ok(last.h.authorization.startsWith('Basic ') && last.h['x-sml-letters-signature'], 'both ways in when both are configured');
  assert.equal(createLettersPublisher({ secret: 'short', authorId: 1 }).configured(), false);
});
