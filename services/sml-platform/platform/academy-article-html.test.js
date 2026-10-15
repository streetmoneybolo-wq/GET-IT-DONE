'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./academy-story-engine');
const H = require('./academy-article-html');
const { seoFor, fit } = require('./academy-article-seo');
const V = require('./academy-article-voice');

const base = { symbol: 'ABCD', name: 'Abcd Robotics', price: 12.4, changePct: 6.2, relVol: 2.8, adv: 4_000_000, direction: { label: 'Lean bullish', bias: 28 }, gamma: { available: true, regime: 'negative', pressurePct: 31, pressure: 'high', flipStrike: 11.8, flipDistancePct: -4.8, callWall: { strike: 13, distancePct: 4.8 }, zeroDteShare: 0.35 }, short: { ratio: 0.52 } };
const story = () => E.rankStories([base])[0];

test('every angle has a standfirst, a two-paragraph mechanism, a counter-argument and a joke, none with an em dash or a digit in the joke', () => {
  for (const angle of ['gamma', 'short', 'earnings', 'tape', 'structure']) {
    const st = { angle, lean: 'bullish', pt: 13, ptPct: 4.8 };
    const c = { ...base, earnings: { impliedPct: 9.5, histAvgMovePct: 14 }, tape: { offSharePct: 58, typicalSharePct: 42, sweepBuy: 5, sweepSell: 1, absorption: true }, smc: { structure: [{ type: 'BOS', dir: 1, level: 12.1 }], sweeps: [{ kind: 'EQL', level: 10.9 }] } };
    const all = [V.dek(st, c, 1), ...V.mechanism(st, c, 1), V.counter(st, c, 1), V.humor(st, c, 1)].join(' ');
    assert.equal(V.mechanism(st, c, 1).length, 2, angle); assert.ok(!/—/.test(all), angle + ' em dash'); assert.ok(!/\d/.test(V.humor(st, c, 1)), angle + ' joke carries no number');
    assert.ok(V.counter(st, c, 1).length > 120, angle + ' counter-argument');
  }
});

test('the card is styled, escaped and carries the takeaways, the stat tiles and the path ladder', () => {
  const d = E.draftArticle(story(), base, { asOf: Date.UTC(2026, 9, 15, 14, 30) });
  const card = H.card({ ...d.parts, symbolLine: d.parts.symbolLine + ' <script>x</script>' });
  assert.match(card.html, /class="ad-t"/); assert.match(card.html, /class="ad-p"/); assert.match(card.html, /CALL WALL/); assert.match(card.html, /Not financial advice/);
  assert.ok(!/<script>/.test(card.html), 'escaped'); assert.ok(card.css.includes('.ad-s') && !/url\(/.test(card.css) && !/@import/.test(card.css), 'css the letters sanitizer keeps');
  assert.ok(card.height >= 420 && card.height <= 1600);
});

test('the standalone document is semantic, carries its CSS, meta tags and NewsArticle JSON-LD, and nothing executable', () => {
  const st = story(), d = E.draftArticle(st, base, { asOf: Date.UTC(2026, 9, 15, 14, 30) });
  const seo = seoFor({ story: st, c: base, headline: d.title, tags: d.tags, posterUrl: 'https://stockmarketloop.com/wp-content/uploads/p.png', asOf: Date.UTC(2026, 9, 15, 14, 30) });
  const doc = H.document({ headline: d.title, metaTitle: seo.meta_title, dek: d.dek, kicker: d.parts.kicker, bodyHtml: d.html, parts: d.parts, byline: 'Vaughn McNair', publication: 'Making Easy Money', url: 'https://stockmarketloop.com/n/grandmasterobi/x/', imageUrl: seo.social_image, gifUrl: 'https://stockmarketloop.com/wp-content/uploads/g.gif', datePublished: d.asOfIso, tags: d.tags, description: seo.meta_desc, siteUrl: 'https://stockmarketloop.com', authorUrl: 'https://stockmarketloop.com/grandmasterobi/' });
  assert.match(doc, /^<!doctype html>\n<html lang="en">/); assert.match(doc, /<h1 itemprop="headline">/); assert.match(doc, /<time itemprop="datePublished" datetime="2026-10-15T14:30:00\.000Z">/);
  assert.match(doc, /<link rel="canonical" href="https:\/\/stockmarketloop\.com\/n\/grandmasterobi\/x\/">/); assert.match(doc, /property="og:image" content="https:\/\/stockmarketloop\.com\/wp-content\/uploads\/p\.png"/); assert.match(doc, /name="twitter:card" content="summary_large_image"/);
  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(doc)[1]);
  assert.equal(ld['@type'], 'NewsArticle'); assert.ok(ld.headline.length <= 110); assert.equal(ld.author.name, 'Vaughn McNair'); assert.equal(ld.isAccessibleForFree, true); assert.deepEqual(ld.image, ['https://stockmarketloop.com/wp-content/uploads/p.png']);
  assert.ok(doc.includes('prefers-color-scheme:dark') && doc.includes('@media print'));
  assert.equal((doc.match(/<script/g) || []).length, 1, 'only the JSON-LD script');
});

test('SEO fields fit what the engines show: title tag at most 60, description 110 to 155, keyword first, tags capped', () => {
  const st = story(); const seo = seoFor({ story: st, c: base, headline: E.draftArticle(st, base).title, tags: ['ABCD', '$ABCD', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], posterUrl: 'https://x/p.png' });
  assert.ok(seo.meta_title.length <= 60 && seo.meta_title.startsWith('$ABCD Gamma Squeeze'), seo.meta_title);
  assert.ok(seo.meta_desc.length >= 110 && seo.meta_desc.length <= 155 && /Updated [A-Z][a-z]{2} \d+\.$/.test(seo.meta_desc), seo.meta_desc);
  assert.equal(seo.keyword, 'ABCD gamma squeeze'); assert.equal(seo.tags.split(', ').length, 8); assert.equal(seo.social_image, 'https://x/p.png'); assert.equal(seo.schema, 'NewsArticle');
  assert.equal(fit('A very long headline that keeps going past the limit for sure', 30), 'A very long headline that');
});
