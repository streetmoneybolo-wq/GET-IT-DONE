import { cashtagText, effectiveTickers } from './tickers.js';

export const APPROVED_SUBREDDITS = new Set([
  'AMD_Stock', 'BB_Stock', 'binaryoptions', 'CanadianInvestor', 'CLOV', 'DeepFuckingValue',
  'dividends', 'etrade', 'FFIE', 'fidelityinvestments', 'FluentInFinance', 'GME',
  'investing_discussion', 'InvestingandTrading', 'investingforbeginners', 'MemeStockMarket',
  'nasdaq', 'NVDA_Stock', 'OKLOSTOCK', 'opendoor', 'Optionmillionaires', 'options',
  'options_trading', 'OptionsMillionaire', 'OrderFlow_Trading', 'Pennystock', 'pennystocks',
  'RealDayTrading', 'RobinHood', 'RobinHoodPennyStocks', 'Schwab', 'Shortsqueeze',
  'smallstreetbets', 'SNDL', 'sofistock', 'spy', 'StockInvest', 'StockMarket',
  'StockMarketMovers', 'stocks', 'StocksAndTrading', 'stockstobuytoday', 'StockTradingIdeas',
  'Superstonk', 'SwaggyStocks', 'swingtrading', 'tdameritrade', 'TheRaceTo10Million',
  'thetagang', 'Trading', 'trading212', 'TradingView', 'ValueInvesting', 'WalllStreetBets',
  'wallstreet', 'wallstreetbets', 'wallstreetbets2', 'WallStreetbetsELITE',
  'Wallstreetbetsnew', 'wallstreetbetsOGs', 'weedstocks',
]);

const TICKER_SUBREDDITS = {
  AMD: 'AMD_Stock', BB: 'BB_Stock', CLOV: 'CLOV', FFIE: 'FFIE', GME: 'GME',
  NVDA: 'NVDA_Stock', OKLO: 'OKLOSTOCK', OPEN: 'opendoor', SNDL: 'SNDL',
  SOFI: 'sofistock', SPY: 'spy',
};

function stableIndex(post, size) {
  const value = `${post.link || ''}|${post.title || ''}`;
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.codePointAt(0), 16777619) >>> 0;
  return size ? hash % size : 0;
}

function choose(post, pool) {
  const approved = pool.filter((name) => APPROVED_SUBREDDITS.has(name));
  return approved[stableIndex(post, approved.length)] || 'StockMarket';
}

function result(post, pool, reason, requirements) {
  const name = choose(post, pool);
  return { name, reason, requirements, rulesUrl: `https://www.reddit.com/r/${name}/about/rules/`, verification: 'manual_review_required' };
}

export function selectSubreddit(post = {}) {
  const tickers = effectiveTickers(post);
  for (const ticker of tickers) {
    const exact = TICKER_SUBREDDITS[ticker];
    if (exact) return result(post, [exact], `$${ticker} ticker match`, ['Article must be directly about this ticker.', 'No unsupported price or performance claims.']);
  }
  const corpus = `${post.title || ''} ${post.description || ''} ${(post.sectors || []).join(' ')}`;
  if (/\b(option|options|call|put|gamma|strike|expiration|theta|vega)\b/i.test(corpus)) return result(post, ['options', 'options_trading', 'OptionsMillionaire', 'Optionmillionaires', 'thetagang'], 'options topic', ['Describe the contract or strategy clearly.', 'Do not present model estimates as guaranteed outcomes.']);
  if (/\b(short squeeze|short interest|squeeze)\b/i.test(corpus)) return result(post, ['Shortsqueeze'], 'short-squeeze topic', ['Include evidence for short-interest or squeeze claims.', 'Avoid coordinated-promotion language.']);
  if (/\b(penny stock|pennystock|microcap|micro-cap)\b/i.test(corpus)) return result(post, ['pennystocks', 'Pennystock', 'RobinHoodPennyStocks'], 'penny-stock topic', ['Disclose risks and avoid guaranteed-return language.', 'Check self-promotion and minimum-content rules.']);
  if (/\b(explodes?|surges?|jumps?|rall(?:y|ies)|plunges?|drops?|momentum|market mover)\b/i.test(corpus)) return result(post, ['StockMarketMovers', 'StockTradingIdeas', 'SwaggyStocks'], 'market-mover topic', ['Use reported/attributed language for performance figures.', 'Remove Discord, referral, and membership promotion.']);
  if (/\b(day trad(?:e|ing)|intraday|scalp(?:ing)?)\b/i.test(corpus)) return result(post, ['RealDayTrading', 'Trading'], 'day-trading topic', ['Include a concrete setup or market observation.', 'Avoid low-effort promotional copy.']);
  if (/\b(order flow|order book|level 2|level ii)\b/i.test(corpus)) return result(post, ['OrderFlow_Trading'], 'order-flow topic', ['Explain the observed order-flow evidence.', 'Do not imply displayed liquidity guarantees execution.']);
  if (/\b(dividend|yield|income stock)\b/i.test(corpus)) return result(post, ['dividends'], 'dividend topic', ['Verify dividend figures and dates.', 'Distinguish yield from total return.']);
  if (/\b(value invest|undervalued|intrinsic value)\b/i.test(corpus)) return result(post, ['ValueInvesting'], 'value-investing topic', ['Include valuation reasoning, not only price movement.', 'State assumptions and material risks.']);
  if (/\b(cannabis|marijuana|weed stock)\b/i.test(corpus)) return result(post, ['weedstocks'], 'cannabis topic', ['Article must concern a publicly traded cannabis company.', 'Avoid non-investment promotion.']);
  return result(post, ['StockMarket', 'stocks', 'Trading', 'StocksAndTrading', 'investing_discussion', 'StockInvest'], 'general stock-market topic', ['Use a factual, non-promotional title.', 'Review link-post, flair, and self-promotion rules before submitting.']);
}

export function redditTitle(post = {}) {
  let title = String(post.title || '')
    .replace(/^\s*(?:📰|📊)?\s*(?:Fresh StockMarketLoop coverage|Market update):\s*/iu, '')
    .replace(/\s+-\s+Stock Market Loop\s*$/i, '')
    .replace(/\bguaranteed\b/gi, 'reported')
    .trim();
  if (/\b(surges?|explodes?|jumps?|rall(?:y|ies))\b/i.test(title) && !/^Reported:/i.test(title)) title = `Reported: ${title}`;
  return Array.from(cashtagText(title, effectiveTickers(post))).slice(0, 280).join('');
}
