/* =============================================================================
 * StockMarketLoop News Engine — Module 9: SEO Engine + JSON-LD
 *
 * Deliberately dependency-free and framework-neutral: pure functions in, plain
 * objects out. Nothing here imports Express, Next, pg or redis, so the same code
 * runs in a Node worker, a Next.js server component, a test, or (transpiled) a
 * WordPress-adjacent build. Persistence and caching belong to the caller.
 *
 * Everything is deterministic — same input, same output, no clock reads except
 * where a date is passed in. That is what makes Module 6's scores reproducible
 * and Module 7's training data trustworthy.
 * ========================================================================== */

'use strict';

/* -----------------------------------------------------------------------------
 * Constants
 * -------------------------------------------------------------------------- */

/* Google truncates the SERP title around 60 chars. Below 45 wastes the slot. */
const SEO_TITLE_MIN = 45;
const SEO_TITLE_MAX = 65;
const SEO_TITLE_IDEAL = [55, 62];

const SEO_DESC_MIN = 140;
const SEO_DESC_MAX = 160;

/* Google's own structured-data docs: headline over 110 characters can
 * invalidate the NewsArticle rich result outright. This is not a style rule. */
const JSONLD_HEADLINE_MAX = 110;

const SLUG_MAX_LENGTH = 72;

/* Removed from slugs only. Never stripped from titles or descriptions — a
 * headline needs its connective tissue to read like English. */
const SLUG_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from',
  'has', 'have', 'he', 'her', 'his', 'how', 'in', 'into', 'is', 'it', 'its',
  'of', 'on', 'or', 'that', 'the', 'their', 'then', 'there', 'these', 'they',
  'this', 'to', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'will',
  'with', 'would', 'you', 'your'
]);

/* Words that carry the CTR in a finance headline. Used for scoring only — the
 * engine never injects them, because a headline that promises urgency the
 * article does not deliver is the fastest way to train Google that you mislead. */
const URGENCY_TERMS = new Set([
  'surges', 'spikes', 'plunges', 'jumps', 'sinks', 'soars', 'crashes', 'rips',
  'breaks', 'explodes', 'collapses', 'reverses', 'halts', 'gaps', 'unusual',
  'record', 'alert', 'warning', 'shock', 'squeeze'
]);

/* -----------------------------------------------------------------------------
 * Text helpers
 * -------------------------------------------------------------------------- */

function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }

function collapse(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

/* Truncate on a word boundary, never mid-word, never leaving dangling
 * punctuation. Returns at most `max` characters including the ellipsis. */
function truncateWords(text, max, ellipsis = '') {
  const t = collapse(text);
  if (t.length <= max) return t;
  const room = max - ellipsis.length;
  if (room <= 0) return t.slice(0, max);
  const cut = t.slice(0, room + 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = (lastSpace > room * 0.5 ? cut.slice(0, lastSpace) : cut.slice(0, room));
  return base.replace(/[\s,;:.\-–—]+$/, '') + ellipsis;
}

function normaliseTicker(t) {
  return String(t == null ? '' : t).toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 8);
}

/* -----------------------------------------------------------------------------
 * Slug generation
 * -------------------------------------------------------------------------- */

/**
 * Build an SEO slug: lowercase, hyphenated, stop words dropped, ticker first.
 *
 * Ticker leads because it is the highest-intent token in the URL and survives
 * the truncation that eats the tail. Uniqueness is the caller's job — the
 * database holds the UNIQUE constraint, so pass `existingSlugs` or handle the
 * conflict on insert; this function is pure and cannot know what is taken.
 */
function generateSlug({ title, ticker, catalyst, maxLength = SLUG_MAX_LENGTH } = {}) {
  const parts = [];

  /* Prepend the ticker only when the title does not already open with it —
     otherwise "NVDA Options Flow…" becomes nvda-nvda-options-flow. Matched at
     the START, not anywhere: a title that merely mentions the symbol later
     still benefits from having it lead the URL. */
  const tick = normaliseTicker(ticker);
  const titleLeadsWithTicker = tick && new RegExp(`^\\s*\\$?${tick}\\b`, 'i').test(String(title || ''));
  if (tick && !titleLeadsWithTicker) parts.push(tick.toLowerCase());
  if (isNonEmptyString(catalyst)) parts.push(catalyst);
  if (isNonEmptyString(title)) parts.push(title);

  const slug = parts.join(' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')          // strip accents
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w, i) => w && (i === 0 || !SLUG_STOP_WORDS.has(w)))
    .reduce((acc, word) => {
      if (!acc.length) return [word];
      const candidate = acc.join('-') + '-' + word;
      return candidate.length <= maxLength ? acc.concat(word) : acc;
    }, [])
    .join('-')
    .replace(/^-+|-+$/g, '');

  return slug || 'untitled';
}

/** Append -2, -3 … until unused. The DB's UNIQUE index remains the real guard. */
function ensureUniqueSlug(slug, existingSlugs = new Set()) {
  if (!existingSlugs.has(slug)) return slug;
  let n = 2;
  while (existingSlugs.has(`${slug}-${n}`)) n += 1;
  return `${slug}-${n}`;
}

/* -----------------------------------------------------------------------------
 * Metadata generation
 * -------------------------------------------------------------------------- */

/**
 * SEO title. Ticker is prefixed only when the title does not already carry it,
 * so "NVDA Surges…" never becomes "NVDA: NVDA Surges…". The brand suffix is
 * added only if it fits inside the character budget — a truncated brand is
 * worse than no brand.
 */
function generateSeoTitle({ title, ticker, brand = 'StockMarketLoop' } = {}) {
  const base = collapse(title);
  if (!base) return '';

  const tick = normaliseTicker(ticker);
  const hasTicker = tick && new RegExp(`\\b${tick}\\b`, 'i').test(base);
  let out = (tick && !hasTicker) ? `${tick}: ${base}` : base;

  if (out.length > SEO_TITLE_MAX) return truncateWords(out, SEO_TITLE_MAX);

  const withBrand = `${out} | ${brand}`;
  if (withBrand.length <= SEO_TITLE_MAX) return withBrand;
  return out;
}

/**
 * SEO description. Built from the summary, then padded with real key-data
 * points if it falls short of the minimum — never with filler, because a
 * padded description that says nothing costs the click anyway.
 */
function generateSeoDescription({ summary, keyPoints = [], ticker } = {}) {
  let text = collapse(summary);

  for (const point of keyPoints) {
    if (text.length >= SEO_DESC_MIN) break;
    const p = collapse(point);
    if (!p) continue;
    const next = text ? `${text} ${p}` : p;
    if (next.length > SEO_DESC_MAX) break;
    text = next;
  }

  const tick = normaliseTicker(ticker);
  if (tick && text && !new RegExp(`\\b${tick}\\b`, 'i').test(text)) {
    const prefixed = `${tick}: ${text}`;
    if (prefixed.length <= SEO_DESC_MAX) text = prefixed;
  }

  return truncateWords(text, SEO_DESC_MAX, '…');
}

/* -----------------------------------------------------------------------------
 * JSON-LD
 * -------------------------------------------------------------------------- */

/**
 * Serialise for embedding in <script type="application/ld+json">.
 *
 * JSON.stringify alone is NOT safe here. A "</script>" inside any string field
 * — trivially reachable from a scraped headline — closes the tag early and
 * turns the rest of the document into markup. U+2028/U+2029 are also valid in
 * JSON but break older JS parsers. Escape all four.
 */
function serializeJsonLd(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function toIso(d) {
  if (!d) return null;
  const date = (d instanceof Date) ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildOrganization({ siteUrl, brand = 'StockMarketLoop', logoUrl } = {}) {
  const org = {
    '@type': 'Organization',
    '@id': `${siteUrl}/#organization`,
    name: brand,
    url: `${siteUrl}/`
  };
  if (logoUrl) org.logo = { '@type': 'ImageObject', url: logoUrl };
  return org;
}

/**
 * NewsArticle. `headline` is capped at 110 characters because Google treats a
 * longer one as invalid — this silently costs the rich result, so it is capped
 * here rather than left to the caller.
 */
function buildNewsArticle(article, opts = {}) {
  const siteUrl = (opts.siteUrl || '').replace(/\/+$/, '');
  const url = `${siteUrl}/news/${article.slug}/`;
  const published = toIso(article.published_at || article.created_at);

  const node = {
    '@type': 'NewsArticle',
    '@id': `${url}#article`,
    headline: truncateWords(article.seo_title || article.title, JSONLD_HEADLINE_MAX),
    description: article.seo_description || article.summary || undefined,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    author: { '@id': `${siteUrl}/#organization` },
    publisher: { '@id': `${siteUrl}/#organization` },
    isAccessibleForFree: true
  };

  if (published) node.datePublished = published;
  node.dateModified = toIso(article.updated_at) || published || undefined;

  const section = (article.topics && article.topics[0]) || 'Markets';
  if (section) node.articleSection = section;

  const keywords = Array.isArray(article.seo_keywords) ? article.seo_keywords.filter(isNonEmptyString) : [];
  if (keywords.length) node.keywords = keywords.join(', ');

  if (opts.imageUrl) node.image = [opts.imageUrl];

  /* Tickers as `about` Corporation nodes. This is the entity signal that makes
   * a finance article legible to Google as being *about a company* rather than
   * merely containing its name. */
  const tickers = (article.tickers || []).map(normaliseTicker).filter(Boolean);
  if (tickers.length) {
    node.about = tickers.map((t) => ({
      '@type': 'Corporation',
      name: t,
      tickerSymbol: t
    }));
  }

  return node;
}

function buildBreadcrumbList(article, opts = {}) {
  const siteUrl = (opts.siteUrl || '').replace(/\/+$/, '');
  const crumbs = [
    { name: 'Home', item: `${siteUrl}/` },
    { name: 'News', item: `${siteUrl}/news/` }
  ];

  const primary = (article.tickers || []).map(normaliseTicker).filter(Boolean)[0];
  if (primary) {
    crumbs.push({ name: primary, item: `${siteUrl}/news/ticker/${primary.toLowerCase()}/` });
  }

  /* The article itself is the final crumb and carries no `item`: Google's spec
   * says the current page should not link to itself in a breadcrumb trail. */
  crumbs.push({ name: truncateWords(article.title, 70) });

  return {
    '@type': 'BreadcrumbList',
    '@id': `${siteUrl}/news/${article.slug}/#breadcrumbs`,
    itemListElement: crumbs.map((c, i) => {
      const el = { '@type': 'ListItem', position: i + 1, name: c.name };
      if (c.item) el.item = c.item;
      return el;
    })
  };
}

function buildWebPage(article, opts = {}) {
  const siteUrl = (opts.siteUrl || '').replace(/\/+$/, '');
  const url = `${siteUrl}/news/${article.slug}/`;
  return {
    '@type': 'WebPage',
    '@id': url,
    url,
    name: article.seo_title || article.title,
    description: article.seo_description || article.summary || undefined,
    isPartOf: { '@id': `${siteUrl}/#website` },
    breadcrumb: { '@id': `${url}#breadcrumbs` },
    primaryImageOfPage: opts.imageUrl ? { '@type': 'ImageObject', url: opts.imageUrl } : undefined
  };
}

/**
 * One @graph, not four sibling <script> blocks. Cross-references by @id then
 * actually resolve, which is what lets Google connect article → publisher →
 * breadcrumb instead of parsing four unrelated islands.
 */
function buildJsonLdGraph(article, opts = {}) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      buildOrganization(opts),
      buildWebPage(article, opts),
      buildNewsArticle(article, opts),
      buildBreadcrumbList(article, opts)
    ]
  };
}

/* -----------------------------------------------------------------------------
 * SEO scoring — deterministic, additive, explainable.
 *
 * Every deduction names itself, so the score is never a bare number a human has
 * to reverse-engineer. Module 6 consumes the number; a human reads the reasons.
 * -------------------------------------------------------------------------- */

function scoreSeo(article) {
  const reasons = [];
  let score = 100;

  const deduct = (points, reason) => { score -= points; reasons.push({ points: -points, reason }); };

  const title = collapse(article.seo_title || '');
  if (!title) deduct(25, 'No SEO title');
  else if (title.length < SEO_TITLE_MIN) deduct(10, `SEO title short (${title.length} < ${SEO_TITLE_MIN})`);
  else if (title.length > SEO_TITLE_MAX) deduct(12, `SEO title long (${title.length} > ${SEO_TITLE_MAX}); Google will truncate`);
  else if (title.length < SEO_TITLE_IDEAL[0] || title.length > SEO_TITLE_IDEAL[1]) deduct(3, 'SEO title outside ideal 55–62');

  const desc = collapse(article.seo_description || '');
  if (!desc) deduct(20, 'No meta description');
  else if (desc.length < SEO_DESC_MIN) deduct(8, `Description short (${desc.length} < ${SEO_DESC_MIN})`);
  else if (desc.length > SEO_DESC_MAX) deduct(8, `Description long (${desc.length} > ${SEO_DESC_MAX})`);

  const slug = collapse(article.slug || '');
  if (!slug) deduct(15, 'No slug');
  else {
    if (slug.length > SLUG_MAX_LENGTH) deduct(5, `Slug over ${SLUG_MAX_LENGTH} chars`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) deduct(10, 'Slug is not lowercase-hyphenated');
    if (slug.split('-').length < 3) deduct(4, 'Slug too sparse to carry keywords');
  }

  const tickers = (article.tickers || []).map(normaliseTicker).filter(Boolean);
  if (!tickers.length) deduct(8, 'No ticker associated — loses the entity signal');
  else if (title && !new RegExp(`\\b${tickers[0]}\\b`, 'i').test(title)) {
    deduct(6, 'Primary ticker missing from SEO title');
  }

  const keywords = Array.isArray(article.seo_keywords) ? article.seo_keywords.filter(isNonEmptyString) : [];
  if (!keywords.length) deduct(8, 'No keywords');
  else if (keywords.length < 3) deduct(3, 'Fewer than 3 keywords');
  else if (keywords.length > 20) deduct(5, 'Over 20 keywords reads as stuffing');

  const body = collapse(article.body || '');
  const words = body ? body.split(' ').length : 0;
  if (words < 150) deduct(15, `Thin content (${words} words)`);
  else if (words < 300) deduct(6, `Short content (${words} words)`);

  /* Keyword stuffing: any single keyword over 3% of the body. */
  if (words > 50 && keywords.length) {
    for (const kw of keywords) {
      const hits = (body.toLowerCase().match(new RegExp(`\\b${kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) || []).length;
      if (hits / words > 0.03) { deduct(10, `Keyword "${kw}" density ${(hits / words * 100).toFixed(1)}% (>3%)`); break; }
    }
  }

  for (const [field, label] of [
    ['why_this_matters', 'Why This Matters'],
    ['market_reaction', 'Market Reaction'],
    ['what_happens_next', 'What Happens Next'],
    ['trader_takeaway', 'Trader Takeaway']
  ]) {
    if (!isNonEmptyString(article[field])) deduct(3, `Missing section: ${label}`);
  }

  if (!isNonEmptyString(article.og_title)) deduct(2, 'No og:title');
  if (!isNonEmptyString(article.og_description)) deduct(2, 'No og:description');

  return {
    seo_score: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
    recommended_improvements: reasons.map((r) => r.reason)
  };
}

/** Headline signals for Module 6. Measured, never auto-injected. */
function analyseHeadline(title) {
  const t = collapse(title);
  const words = t ? t.split(' ') : [];
  const lower = t.toLowerCase();
  return {
    length: t.length,
    word_count: words.length,
    has_ticker: /\b[A-Z]{1,5}\b/.test(t),
    has_number: /\d/.test(t),
    urgency_terms: words.filter((w) => URGENCY_TERMS.has(w.toLowerCase().replace(/[^a-z]/g, ''))).length,
    is_question: /\?$/.test(t),
    all_caps_words: words.filter((w) => w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w)).length,
    /* Clickbait markers are reported, not corrected — the fix belongs upstream. */
    clickbait_markers: ['you won\'t believe', 'shocking', 'this one', 'here\'s why you']
      .filter((p) => lower.includes(p)).length
  };
}

/* -----------------------------------------------------------------------------
 * Entry point
 * -------------------------------------------------------------------------- */

/**
 * Produce the full Module 9 payload for one article.
 *
 * NOTE ON SCOPE: keyword clustering and internal-link target selection are
 * intentionally absent. Both require live services this module has no access to
 * (a trends source and the article/ticker/topic graph). Returning invented
 * clusters would be worse than returning none — Module 6 would score against
 * fiction. Pass real values in via `opts.keywords` / `opts.internalLinks`, or
 * add them when those services exist.
 */
function generateSeo(article, opts = {}) {
  if (!article || typeof article !== 'object') throw new TypeError('generateSeo: article object required');
  if (!isNonEmptyString(article.title)) throw new TypeError('generateSeo: article.title required');

  const siteUrl = (opts.siteUrl || 'https://stockmarketloop.com').replace(/\/+$/, '');
  const tickers = (article.tickers || []).map(normaliseTicker).filter(Boolean);
  const primaryTicker = tickers[0] || null;

  const slug = article.slug
    || ensureUniqueSlug(
         generateSlug({ title: article.title, ticker: primaryTicker, catalyst: opts.catalyst }),
         opts.existingSlugs
       );

  const seo_title = article.seo_title
    || generateSeoTitle({ title: article.title, ticker: primaryTicker, brand: opts.brand });

  const seo_description = article.seo_description
    || generateSeoDescription({ summary: article.summary, keyPoints: article.key_points || [], ticker: primaryTicker });

  const seo_keywords = Array.isArray(opts.keywords) ? opts.keywords : (article.seo_keywords || []);
  const og_title = article.og_title || truncateWords(seo_title, 88);
  const og_description = article.og_description || seo_description;

  /* Score the FINAL shape, not the input. Scoring before the og_* and keyword
     fields are filled in produced advice the function had already acted on
     ("No og:title" on a response that carries one) — the recommendations have
     to describe what will actually be published. */
  const enriched = Object.assign({}, article, {
    slug, seo_title, seo_description, seo_keywords, og_title, og_description, tickers
  });
  const scored = scoreSeo(enriched);
  const canonical_url = `${siteUrl}/news/${slug}/`;

  return {
    slug,
    seo_title,
    seo_description,
    seo_keywords,
    og_title,
    og_description,
    canonical_url,
    internal_links: Array.isArray(opts.internalLinks) ? opts.internalLinks : [],
    jsonld_graph: buildJsonLdGraph(enriched, { siteUrl, brand: opts.brand, logoUrl: opts.logoUrl, imageUrl: opts.imageUrl }),
    jsonld_script: serializeJsonLd(buildJsonLdGraph(enriched, { siteUrl, brand: opts.brand, logoUrl: opts.logoUrl, imageUrl: opts.imageUrl })),
    headline_analysis: analyseHeadline(article.title),
    seo_score: scored.seo_score,
    recommended_improvements: scored.recommended_improvements
  };
}

module.exports = {
  generateSeo,
  generateSlug,
  ensureUniqueSlug,
  generateSeoTitle,
  generateSeoDescription,
  buildJsonLdGraph,
  buildNewsArticle,
  buildBreadcrumbList,
  buildOrganization,
  buildWebPage,
  serializeJsonLd,
  scoreSeo,
  analyseHeadline,
  constants: { SEO_TITLE_MIN, SEO_TITLE_MAX, SEO_DESC_MIN, SEO_DESC_MAX, JSONLD_HEADLINE_MAX, SLUG_MAX_LENGTH }
};
