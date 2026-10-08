import { cleanEditorialSummary, cleanEditorialTitle } from './editorialText.js';
import { cashtagText } from './tickers.js';

function cleanTitle(value) {
  return cleanEditorialTitle(value)
    .replace(/\b(?:here'?s why|and here is why|what traders need to know)\b/ig, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*[:|-]\s*$/g, '')
    .trim();
}

function catalystLabel(title, summary = '') {
  const text = `${title} ${summary}`.toLowerCase();
  if (/\bearnings?|guidance|revenue|eps|profit|margin\b/.test(text)) return 'earnings reaction';
  if (/\bsec|filing|8-k|10-q|10-k|form 4|nport|prospectus\b/.test(text)) return 'filing signal';
  if (/\binsider|sale|buying|selling|stake|institutional\b/.test(text)) return 'ownership signal';
  if (/\boption|calls?|puts?|sweep|gamma|volatility\b/.test(text)) return 'options flow';
  if (/\bai|chip|semiconductor|data center|gpu\b/.test(text)) return 'AI trade';
  if (/\bwar|tariff|oil|fed|inflation|rates?|jobs|cpi|ppi\b/.test(text)) return 'macro risk';
  return 'market catalyst';
}

export function generateShareCopy({ sourceTitle = '', summary = '', tickers = [], sectors = [] } = {}) {
  const cleanedTitle = cleanTitle(sourceTitle);
  const primary = tickers?.[0] ? `$${String(tickers[0]).replace(/^\$/, '').toUpperCase()}` : '';
  const catalyst = catalystLabel(cleanedTitle, summary);
  const sector = sectors?.[0] ? String(sectors[0]).replace(/[_-]+/g, ' ') : '';
  const cleanedHasPrimary = primary && new RegExp(`^\\$?${primary.slice(1)}\\b`, 'i').test(cleanedTitle);
  const titleBase = primary
    ? `${cleanedHasPrimary ? cleanedTitle : `${primary} ${cleanedTitle || 'Stock Update'}`}: ${catalyst} traders are watching`
    : `${cleanedTitle || 'Stock Market Update'}: ${sector || catalyst} angle traders are watching`;
  const title = cashtagText(titleBase, tickers) || 'Stock Market Update';
  const description = cashtagText(cleanEditorialSummary(summary), tickers) || 'Independent stock-market reporting with source context and verified data.';
  return { title: title.slice(0, 240), description: description.slice(0, 500) };
}

export function discussionAngles(article) {
  const subject = article.tickers.length ? article.tickers.map((t) => `$${t}`).join(', ') : article.title;
  return [
    `Bull-case question: what evidence could support ${subject}?`,
    `Risk question: what could invalidate the thesis around ${subject}?`,
    `Neutral check: which facts in the source are confirmed, and which are interpretation?`,
  ];
}

export function commentIdeas(article) {
  const subject = article.tickers?.length ? article.tickers.map((ticker) => `$${ticker}`).join(', ') : article.title;
  const title = cashtagText(String(article.title || 'this report'), article.tickers || []).replace(/\s+/g, ' ').trim().slice(0, 180);
  const summary = cleanEditorialSummary(article.summary || article.description || '').slice(0, 180);
  const catalyst = catalystLabel(title, summary);
  const tickerTag = String(article.tickers?.[0] || '').replace(/[^A-Za-z0-9]/g, '');
  const hashtags = [...new Set([tickerTag ? `#${tickerTag}` : '', '#StockMarket', '#MarketNews', '#Trading'])]
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');
  return [
    `Question I’d ask first on ${subject}: which data point confirms the ${catalyst}, and which part is still just market interpretation?`,
    `Contrarian take: if ${subject} does not react to this headline, that may say more about positioning than the headline itself. What would prove the market already priced it in?`,
    `The key for me is whether this shows up in volume, guidance, filings, or price action. Which signal around “${title}” matters most?`,
    `Beginner-friendly read: this matters only if it changes expectations for ${subject}. I’m watching whether traders treat it as a one-day headline or a real catalyst.`,
    `Risk check: what would invalidate the bullish read on ${subject}, and what level or event would make you change your mind?`,
  ].map((idea) => `${idea.replace(/@[A-Za-z0-9_]+/g, '').replace(/\s+/g, ' ').trim()}\n\n${hashtags}`.slice(0, 500));
}
