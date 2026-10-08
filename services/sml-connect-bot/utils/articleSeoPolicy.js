export const ARTICLE_CATEGORIES = [
  'Retail Trader Spotlight',
  'Breaking News', 'Stock Market News', 'Momentum Stocks', 'Retail Trading', 'Small-Cap Stocks',
  'Crypto', 'Earnings', 'Analyst Ratings', 'Premarket Alerts', 'AI Stocks', 'Commodities',
  'Energy Stocks', 'ETFs', 'IPOs', 'Magnificent 7', 'Mergers & Acquisitions',
  'Fed / Interest Rates', 'Markets',
];

const POWER_WORDS = [
  'breaking', 'explosive', 'powerful', 'stunning', 'surprising', 'urgent', 'major', 'massive',
  'remarkable', 'dramatic', 'critical', 'extraordinary', 'strong', 'sharp', 'record', 'verified',
];

export function canonicalFocusKeyword(symbol) {
  return `$${String(symbol || '').replace(/[^A-Za-z0-9.]/g, '').toUpperCase()} stock`;
}

export function cleanSlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 59).replace(/-+$/g, '');
}

export function countWords(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z0-9#]+;/gi, ' ')
    .trim().split(/\s+/).filter(Boolean).length;
}

export function keywordDensity(value, keyword) {
  const text = String(value || '').replace(/<[^>]*>/g, ' ').toLowerCase();
  const phrase = String(keyword || '').trim().toLowerCase();
  if (!phrase) return 0;
  const occurrences = text.split(phrase).length - 1;
  return countWords(text) ? (occurrences / countWords(text)) * 100 : 0;
}

function hashtagCount(value) {
  return (String(value || '').match(/#[A-Za-z0-9_]+/g) || []).length;
}

function containsKeywordTerms(value, keyword) {
  const text = String(value || '').toLowerCase();
  return String(keyword || '').toLowerCase().split(/\s+/).filter(Boolean).every((term) => text.includes(term));
}

export function validateSeoPackage(article, { requireLongForm = true } = {}) {
  const errors = [];
  const keyword = String(article.focusKeyword || '').trim();
  const seoTitle = String(article.seoTitle || '').trim();
  const meta = String(article.metaDescription || '').trim();
  const slug = String(article.slug || '').trim();
  const lowerTitle = seoTitle.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  if (!keyword) errors.push('focus keyword is missing');
  if (!seoTitle || seoTitle.length > 160) errors.push('SEO title is missing or excessively long');
  if (meta.length < 140 || meta.length > 160) errors.push(`meta description must be 140-160 characters (received ${meta.length})`);
  if (!containsKeywordTerms(meta, keyword)) errors.push('meta description lacks the focus keyword terms');
  if (slug.length > 59 || !slug.includes(cleanSlug(keyword))) errors.push('slug must include the focus keyword and stay under 60 characters');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) errors.push('slug is not URL safe');
  if (!Array.isArray(article.categories) || !article.categories.length || article.categories.some((row) => !ARTICLE_CATEGORIES.includes(row))) errors.push('article category is missing or not approved');
  if (!Array.isArray(article.tags) || !article.tags.some((row) => String(row).toLowerCase() === lowerKeyword)) errors.push('tags must include the focus keyword');
  if (!containsKeywordTerms(article.imageAltText, keyword)) errors.push('image alt text lacks the focus keyword terms');
  if (requireLongForm && countWords(article.html) < 600) errors.push(`article must contain at least 600 words (received ${countWords(article.html)})`);
  if (!/<a\s[^>]*href="https:\/\/stockmarketloop\.com\//i.test(article.html || '')) errors.push('article lacks an internal StockMarketLoop link');
  if (!/<a\s[^>]*href="https:\/\/(?!stockmarketloop\.com)/i.test(article.html || '')) errors.push('article lacks an external link');
  for (const platform of ['x', 'facebook', 'linkedin', 'tumblr']) {
    const post = article.socialPosts?.[platform];
    if (!post?.text || !post?.cta || !post?.hashtags) errors.push(`${platform} social package is incomplete`);
    else {
      const count = hashtagCount(post.hashtags);
      if (count < 6 || count > 12) errors.push(`${platform} must have 6-12 hashtags (received ${count})`);
    }
  }
  const hooks = Object.values(article.socialPosts || {}).map((post) => String(post?.text || '').trim().toLowerCase());
  if (new Set(hooks).size !== hooks.length) errors.push('social platform hooks are not unique');
  if (errors.length) throw new Error(`Article SEO policy failed: ${errors.join('; ')}`);
  return true;
}

export function buildNewsArticleSchema({ article, post, imageUrl = '' }) {
  const published = post?.date_gmt ? `${post.date_gmt}Z` : new Date().toISOString();
  const modified = post?.modified_gmt ? `${post.modified_gmt}Z` : published;
  return {
    '@context': 'https://schema.org', '@type': 'NewsArticle',
    headline: article.title || article.newsTitle || article.seoTitle, description: article.metaDescription,
    datePublished: published, dateModified: modified,
    author: { '@type': 'Organization', name: 'Retail Trader Spotlight', url: 'https://stockmarketloop.com/' },
    publisher: { '@type': 'Organization', name: 'StockMarketLoop', url: 'https://stockmarketloop.com/' },
    image: imageUrl ? [imageUrl] : [],
    mainEntityOfPage: { '@type': 'WebPage', '@id': post?.link || '' },
    keywords: [article.focusKeyword, ...(article.secondaryKeywords || [])].join(', '),
  };
}
