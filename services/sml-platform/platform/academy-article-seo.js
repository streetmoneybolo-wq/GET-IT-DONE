'use strict';

/* Search metadata for an Article Desk piece, shaped for what Google News and Bing read:
 *   - a title tag that fits a results page (60 characters or fewer, ticker and topic first, the publication name only if it fits)
 *   - a description of 120 to 155 characters that says what the page offers, with the freshness date
 *   - one primary keyword, a tag list, a section, the NewsArticle type, a sentiment lean
 *   - Open Graph and Twitter fields and a social image (a static 1200 pixel poster; the animated GIF stays in the body)
 * The Loop Letters SEO store (loop-letters-seo.php) turns these into the page's meta tags and NewsArticle JSON-LD. */

const engine = require('./academy-story-engine');

const px = (v) => (v >= 1 ? '$' + Number(v).toFixed(2) : '$' + Number(v).toFixed(4));
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
/* cut at a word boundary, no ellipsis in a title */
function fit(text, max) {
  const t = clean(text); if (t.length <= max) return t;
  const cut = t.slice(0, max + 1); const i = cut.lastIndexOf(' ');
  return (i > max * 0.6 ? cut.slice(0, i) : t.slice(0, max)).replace(/[\s,;:\-]+$/, '');
}
const titleCase = (s) => String(s).replace(/\b([a-z])/g, (m) => m.toUpperCase());

function seoFor({ story, c, headline, tags = [], publication = 'Making Easy Money', posterUrl = '', asOf = Date.now() } = {}) {
  const S = '$' + c.symbol, meta = engine.ANGLES[story.angle] || { label: 'Market read', keywords: ['stock analysis'] };
  const label = titleCase(meta.label);
  const dateShort = new Date(asOf).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
  const core = `${S} ${label}: Path to ${px(story.pt)}`;
  const metaTitle = (core + ' | ' + publication).length <= 60 ? core + ' | ' + publication : fit(core, 60);
  const factFull = clean((story.facts && story.facts[0]) || '').replace(/\.$/, '');
  const factShort = fit(factFull.split(/[:;]/)[0], 70);
  const name = c.name || c.symbol;
  const tail = ` The setup, the path to ${px(story.pt)} and what invalidates it. Updated ${dateShort}.`;
  const lower = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);
  const tries = [
    `${name} (${S}) ${label.toLowerCase()} read: ${lower(factShort)}.${tail}`,
    `${name} (${S}) ${label.toLowerCase()} read.${tail}`,
    `${S} ${label.toLowerCase()} read.${tail}`
  ];
  let metaDesc = tries.find((t) => t.length >= 110 && t.length <= 155) || fit(tries[1], 155);
  const keyword = `${c.symbol} ${(meta.keywords && meta.keywords[0]) || 'stock analysis'}`;
  return {
    meta_title: metaTitle, meta_desc: metaDesc, keyword, category: 'Markets', schema: 'NewsArticle',
    tags: [...new Set(tags)].slice(0, 8).join(', '), sentiment: story.lean, subject: S,
    og_title: fit(headline, 95), og_desc: metaDesc, twitter: 'summary_large_image', social_image: posterUrl || ''
  };
}

module.exports = { seoFor, fit };
