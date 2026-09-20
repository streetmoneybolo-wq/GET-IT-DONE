export function effectiveTickers({ tickers = [], title = '', description = '' } = {}) {
  const explicit = (tickers || []).map((ticker) => String(ticker).toUpperCase());
  const corpus = `${title} ${description}`;
  const cashTags = [...corpus.matchAll(/\$([A-Z]{1,5})\b/g)].map((match) => match[1]);
  const headline = corpus.match(/\b([A-Z]{1,5})\s+(?:Stock|Shares|Surges|Explodes|Jumps|Rallies|Falls|Drops|Plunges)\b/i);
  return [...new Set([...explicit, ...cashTags, ...(headline ? [headline[1]] : [])])]
    .map((ticker) => ticker.replace(/[^A-Z0-9.]/g, ''))
    .filter(Boolean)
    .slice(0, 8);
}

function normalizedTickerList(tickers = []) {
  return [...new Set((tickers || [])
    .map((ticker) => String(ticker || '').toUpperCase().replace(/[^A-Z0-9.]/g, ''))
    .filter(Boolean))]
    .sort((a, b) => b.length - a.length);
}

function tickerExpression(tickers = []) {
  const escaped = normalizedTickerList(tickers).map((ticker) => ticker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return escaped.length ? new RegExp(`(?<![$#@A-Z0-9.])(${escaped.join('|')})(?![A-Z0-9.])`, 'gi') : null;
}

/** Add a finance cashtag to every known ticker without touching URLs, hashtags,
 * handles, existing cashtags, or unrelated capitalized words. */
export function cashtagText(value, tickers = []) {
  const expression = tickerExpression(tickers);
  if (!expression) return String(value || '');
  return String(value || '').replace(expression, (_match, ticker) => `$${String(ticker).toUpperCase()}`);
}

/** Apply cashtags only to visible HTML text, never to tag names or attributes. */
export function cashtagHtmlText(value, tickers = []) {
  return String(value || '').split(/(<(?:script|style)\b[\s\S]*?<\/(?:script|style)>|<[^>]+>)/gi)
    .map((part) => part.startsWith('<') ? part : cashtagText(part, tickers))
    .join('');
}

export function assertCashtaggedText(value, tickers = [], label = 'generated copy') {
  const expression = tickerExpression(tickers);
  if (!expression) return true;
  const visibleCopy = String(value || '').replace(/https?:\/\/\S+/gi, ' ');
  const match = visibleCopy.match(expression);
  if (match) throw new Error(`${label} contains a ticker without a $ cashtag: ${match[0]}`);
  return true;
}
