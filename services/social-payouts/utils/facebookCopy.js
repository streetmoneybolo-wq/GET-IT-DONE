import { cashtagText, effectiveTickers } from './tickers.js';
import { cleanEditorialSummary, cleanEditorialTitle } from './editorialText.js';

export function facebookHashtags(post, limit = 5) {
  const tickerTags = effectiveTickers(post)
    .map((ticker) => `#${String(ticker).replace(/[^a-z0-9]/gi, '').toUpperCase()}`)
    .filter((tag) => tag.length > 1);
  return [...new Set([...tickerTags.slice(0, 2), '#StockMarket', '#StockNews', '#TradingCommunity', '#Stocks', '#Investing', '#MarketUpdate'])]
    .slice(0, Math.max(1, Number(limit) || 5))
    .join(' ');
}

export function packagedFacebookCaption(post, limit = 1450) {
  const tickers = effectiveTickers(post);
  const sourceTitle = cashtagText(cleanEditorialTitle(post.title), tickers);
  const description = cashtagText(cleanEditorialSummary(post.description), tickers);
  const ticker = effectiveTickers({ ...post, title: sourceTitle, description })[0] || '';
  const titleLower = sourceTitle.toLowerCase();
  let seoTitle = sourceTitle;
  if (ticker && /alert/.test(titleLower)) seoTitle = `$${ticker} Stock Alert Update: Reported Price Move and Timeline`;
  else if (ticker && /(surge|jump|rally|gain|rise)/.test(titleLower)) seoTitle = `$${ticker} Stock Surge: Reported Move and Market Context`;
  else if (ticker && /earnings?/.test(titleLower)) seoTitle = `$${ticker} Earnings Update: Results and Market Reaction`;
  else if (ticker) seoTitle = `$${ticker} Stock News: Latest Market Update`;
  const suffix = `\n\nFull report attached.\n\n${facebookHashtags({ ...post, title: sourceTitle, description })}`;
  const body = [seoTitle, description].filter(Boolean).join('\n\n').replaceAll('```', "'''");
  const available = Math.max(0, limit - Array.from(suffix).length);
  const bodyCharacters = Array.from(body);
  const fittedBody = bodyCharacters.length <= available
    ? body
    : `${bodyCharacters.slice(0, Math.max(0, available - 1)).join('')}…`;
  return `${fittedBody}${suffix}`;
}
