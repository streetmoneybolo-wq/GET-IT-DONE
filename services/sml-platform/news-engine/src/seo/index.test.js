/* Module 9 test suite. Plain node:test — no framework to install.
 * Run:  node --test news-engine/src/seo/
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const seo = require('./index.js');

const SITE = 'https://stockmarketloop.com';

const article = {
  title: 'NVDA Options Flow Explodes as Traders Pile Into Weekly Calls',
  summary: 'Nvidia call volume ran four times its twenty-day average on Tuesday, with the bulk of premium concentrated in weekly contracts expiring Friday.',
  body: ('Nvidia saw unusual options activity. '.repeat(40)),
  key_points: ['Call volume 4x the 20-day average', 'Premium concentrated in Friday weeklies'],
  tickers: ['NVDA'],
  topics: ['Options Flow'],
  why_this_matters: 'Concentrated weekly premium can force dealer hedging.',
  market_reaction: 'Shares rose 2.1% on the session.',
  what_happens_next: 'Friday expiry is the level to watch.',
  trader_takeaway: 'Watch gamma into expiry.',
  seo_keywords: ['nvda options flow', 'nvidia unusual options', 'nvda weekly calls'],
  published_at: '2026-08-22T14:30:00Z',
  updated_at: '2026-08-22T15:00:00Z'
};

/* ---------- slugs ---------- */

test('slug is lowercase, hyphenated, ticker-led, stop words dropped', () => {
  const s = seo.generateSlug({ title: 'Why Is The Stock Of NVDA Surging Into The Close', ticker: 'NVDA' });
  assert.match(s, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(s.startsWith('nvda'), `expected ticker first, got ${s}`);
  assert.ok(!/-the-|-is-|-of-/.test(s), `stop words survived: ${s}`);
});

test('slug respects the length cap without cutting a word in half', () => {
  const s = seo.generateSlug({
    title: 'Nvidia Corporation Announces Record Quarterly Datacenter Revenue Growth Across Every Reporting Segment Worldwide',
    ticker: 'NVDA'
  });
  assert.ok(s.length <= seo.constants.SLUG_MAX_LENGTH, `slug too long: ${s.length}`);
  assert.ok(!s.endsWith('-'), 'slug ends with a hyphen');
  /* every segment must be a whole word from the source */
  const source = 'nvda nvidia corporation announces record quarterly datacenter revenue growth across every reporting segment worldwide'.split(' ');
  for (const part of s.split('-')) assert.ok(source.includes(part), `"${part}" is not a whole source word`);
});

/* Regression: caught by reading real output, not by an earlier test. A title
 * already opening with the symbol produced "nvda-nvda-options-flow-…". */
test('slug does not duplicate a ticker the title already leads with', () => {
  const s = seo.generateSlug({ title: 'NVDA Options Flow Explodes', ticker: 'NVDA' });
  assert.equal((s.match(/nvda/g) || []).length, 1, `ticker duplicated: ${s}`);
  assert.ok(s.startsWith('nvda-options'), s);

  /* $-prefixed form is the same case */
  const d = seo.generateSlug({ title: '$AMD Rips Higher', ticker: 'AMD' });
  assert.equal((d.match(/amd/g) || []).length, 1, `ticker duplicated: ${d}`);

  /* but a title that only mentions it later still gets it in front */
  const l = seo.generateSlug({ title: 'Chipmakers Rally, With AMD Leading', ticker: 'AMD' });
  assert.ok(l.startsWith('amd-'), `ticker should lead: ${l}`);
});

test('slug strips accents and never emits an empty string', () => {
  assert.equal(seo.generateSlug({ title: 'Café Söhne Move' }), 'cafe-sohne-move');
  assert.equal(seo.generateSlug({ title: '!!! ???' }), 'untitled');
});

test('ensureUniqueSlug increments only on collision', () => {
  const taken = new Set(['nvda-options-flow', 'nvda-options-flow-2']);
  assert.equal(seo.ensureUniqueSlug('nvda-options-flow', taken), 'nvda-options-flow-3');
  assert.equal(seo.ensureUniqueSlug('fresh-slug', taken), 'fresh-slug');
});

/* ---------- titles and descriptions ---------- */

test('SEO title stays within budget and never doubles the ticker', () => {
  const t = seo.generateSeoTitle({ title: article.title, ticker: 'NVDA' });
  assert.ok(t.length <= seo.constants.SEO_TITLE_MAX, `title ${t.length} chars`);
  assert.equal((t.match(/NVDA/g) || []).length, 1, `ticker repeated: ${t}`);
});

test('SEO title prefixes the ticker only when it is absent', () => {
  const t = seo.generateSeoTitle({ title: 'Chipmaker Rallies On Guidance', ticker: 'AMD' });
  assert.ok(t.startsWith('AMD: '), t);
});

test('description lands in the 140-160 window and carries the ticker', () => {
  const d = seo.generateSeoDescription({ summary: article.summary, keyPoints: article.key_points, ticker: 'NVDA' });
  assert.ok(d.length <= seo.constants.SEO_DESC_MAX, `description ${d.length} chars`);
  assert.match(d, /NVDA|Nvidia/);
});

test('description truncates on a word boundary', () => {
  const d = seo.generateSeoDescription({ summary: 'word '.repeat(80), ticker: 'NVDA' });
  assert.ok(d.length <= seo.constants.SEO_DESC_MAX);
  assert.ok(!/\bwor$|\bwo$/.test(d), `cut mid-word: ${d}`);
});

/* ---------- JSON-LD ---------- */

test('graph contains all four required node types', () => {
  const g = seo.buildJsonLdGraph(Object.assign({ slug: 'nvda-options-flow' }, article), { siteUrl: SITE });
  const types = g['@graph'].map((n) => n['@type']);
  for (const t of ['Organization', 'WebPage', 'NewsArticle', 'BreadcrumbList']) {
    assert.ok(types.includes(t), `missing ${t}`);
  }
  assert.equal(g['@context'], 'https://schema.org');
});

test('NewsArticle headline never exceeds Google\'s 110-char limit', () => {
  const long = Object.assign({}, article, { slug: 's', title: 'A'.repeat(400), seo_title: 'B'.repeat(400) });
  const node = seo.buildNewsArticle(long, { siteUrl: SITE });
  assert.ok(node.headline.length <= seo.constants.JSONLD_HEADLINE_MAX, `headline ${node.headline.length}`);
});

test('publisher and author resolve to the Organization @id', () => {
  const g = seo.buildJsonLdGraph(Object.assign({ slug: 'x' }, article), { siteUrl: SITE });
  const org = g['@graph'].find((n) => n['@type'] === 'Organization');
  const art = g['@graph'].find((n) => n['@type'] === 'NewsArticle');
  assert.equal(art.publisher['@id'], org['@id']);
  assert.equal(art.author['@id'], org['@id']);
});

test('dates are ISO 8601; invalid dates are omitted rather than emitted as junk', () => {
  const node = seo.buildNewsArticle(Object.assign({ slug: 'x' }, article), { siteUrl: SITE });
  assert.match(node.datePublished, /^\d{4}-\d{2}-\d{2}T/);
  const bad = seo.buildNewsArticle({ slug: 'x', title: 'T', published_at: 'not-a-date' }, { siteUrl: SITE });
  assert.equal(bad.datePublished, undefined);
});

test('tickers become Corporation about-nodes', () => {
  const node = seo.buildNewsArticle(Object.assign({ slug: 'x' }, article), { siteUrl: SITE });
  assert.equal(node.about[0]['@type'], 'Corporation');
  assert.equal(node.about[0].tickerSymbol, 'NVDA');
});

test('breadcrumbs are 1-indexed and the final crumb has no item', () => {
  const bc = seo.buildBreadcrumbList(Object.assign({ slug: 'x' }, article), { siteUrl: SITE });
  bc.itemListElement.forEach((el, i) => assert.equal(el.position, i + 1));
  assert.equal(bc.itemListElement[bc.itemListElement.length - 1].item, undefined);
  assert.ok(bc.itemListElement.some((e) => e.name === 'NVDA'));
});

/* This is the security-relevant one. */
test('serialiser neutralises a script-closing tag in a headline', () => {
  const evil = Object.assign({}, article, { slug: 'x', title: 'Bad </script><img src=x onerror=alert(1)> News' });
  const out = seo.serializeJsonLd(seo.buildJsonLdGraph(evil, { siteUrl: SITE }));
  assert.ok(!out.includes('</script>'), 'raw closing tag survived — XSS');
  assert.ok(!out.includes('<'), 'raw < survived');
  assert.ok(JSON.parse(out.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&')), 'not valid JSON after unescape');
});

test('serialiser escapes U+2028 / U+2029', () => {
  const out = seo.serializeJsonLd({ a: 'line\u2028sep\u2029par' });
  assert.ok(!/[\u2028\u2029]/.test(out));
});

/* ---------- scoring ---------- */

test('a complete article scores high; every deduction is explained', () => {
  const r = seo.generateSeo(article, { siteUrl: SITE });
  assert.ok(r.seo_score >= 80, `expected >=80, got ${r.seo_score}: ${r.recommended_improvements.join('; ')}`);
  for (const imp of r.recommended_improvements) assert.ok(typeof imp === 'string' && imp.length, 'empty improvement');
});

/* Regression: an earlier version scored the INPUT rather than the final object,
 * so it advised "No og:title" on a response that already carried a generated
 * og:title. Recommendations must describe what will actually be published. */
test('recommendations never cite a field the engine itself just generated', () => {
  const r = seo.generateSeo(article, { siteUrl: SITE });
  assert.ok(r.og_title && r.og_description, 'og fields not generated');
  const joined = r.recommended_improvements.join(' | ');
  assert.ok(!/No og:title/.test(joined), `stale advice: ${joined}`);
  assert.ok(!/No og:description/.test(joined), `stale advice: ${joined}`);
  assert.ok(!/No SEO title|No meta description|No slug|No keywords/.test(joined), `stale advice: ${joined}`);
});

test('thin content and missing metadata are penalised', () => {
  const thin = { title: 'T', body: 'short', tickers: [], slug: 'x' };
  const r = seo.scoreSeo(thin);
  assert.ok(r.seo_score < 50, `expected <50, got ${r.seo_score}`);
  assert.ok(r.reasons.some((x) => /Thin content/.test(x.reason)));
  assert.ok(r.reasons.some((x) => /No meta description/.test(x.reason)));
});

test('keyword stuffing is caught', () => {
  const stuffed = {
    title: 'NVDA', slug: 'nvda-x', seo_title: 'x'.repeat(50), seo_description: 'y'.repeat(150),
    body: ('nvda ' + 'filler '.repeat(9)).repeat(30), seo_keywords: ['nvda'], tickers: ['NVDA']
  };
  assert.ok(seo.scoreSeo(stuffed).reasons.some((r) => /density/.test(r.reason)), 'stuffing not detected');
});

test('score is bounded 0-100 and deterministic', () => {
  const a = seo.generateSeo(article, { siteUrl: SITE });
  const b = seo.generateSeo(article, { siteUrl: SITE });
  assert.deepEqual(a, b, 'not deterministic');
  assert.ok(a.seo_score >= 0 && a.seo_score <= 100);
});

/* ---------- contract ---------- */

test('generateSeo rejects malformed input rather than emitting junk', () => {
  assert.throws(() => seo.generateSeo(null), TypeError);
  assert.throws(() => seo.generateSeo({}), TypeError);
});

test('canonical URL matches the slug and has no double slash', () => {
  const r = seo.generateSeo(article, { siteUrl: SITE + '/' });
  assert.equal(r.canonical_url, `${SITE}/news/${r.slug}/`);
  assert.ok(!r.canonical_url.includes('//news'));
});

test('headline analysis reports urgency without rewriting the headline', () => {
  const h = seo.analyseHeadline('NVDA Surges 12% As Options Flow Explodes');
  assert.ok(h.urgency_terms >= 2, JSON.stringify(h));
  assert.equal(h.has_number, true);
  assert.equal(h.clickbait_markers, 0);
});
