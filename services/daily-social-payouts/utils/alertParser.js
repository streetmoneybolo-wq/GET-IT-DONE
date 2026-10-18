function marketDate(timestamp, timeZone = 'America/New_York') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function isoDate(year, month, day) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function resolveOptionExpiration(text, timestamp, timeZone = 'America/New_York') {
  const alertDate = marketDate(timestamp, timeZone);
  // "daily", "0DTE" / "0 dte" and "today" all mean the contract expires on the alert day.
  if (/\b(?:daily|0\s*dte|today)\b/i.test(text)) return { expiration: isoDate(alertDate.year, alertDate.month, alertDate.day), source: 'daily' };
  const match = String(text).match(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])(?:\/(\d{2}|\d{4}))?\b/);
  if (!match) return { expiration: null, source: 'missing' };
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year;
  if (match[3]) year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  else {
    year = alertDate.year;
    const candidate = isoDate(year, month, day);
    const alertIso = isoDate(alertDate.year, alertDate.month, alertDate.day);
    if (candidate && candidate < alertIso) year += 1;
  }
  const expiration = isoDate(year, month, day);
  return expiration ? { expiration, source: match[3] ? 'explicit-date' : 'inferred-year' } : { expiration: null, source: 'invalid-date' };
}

const PRICE = String.raw`\d+(?:\.\d+)?`;
const EXPIRY = String.raw`(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])(?:\/(?:\d{2}|\d{4}))?`;

/* Words that look like tickers in the wider patterns but never are. */
const NOT_TICKERS = new Set([
  'A', 'I', 'AT', 'ON', 'IN', 'TO', 'OF', 'OR', 'AND', 'THE', 'FOR', 'BUY', 'SELL', 'LONG', 'SHORT', 'BTO', 'STO', 'STC', 'BTC',
  'CALL', 'CALLS', 'PUT', 'PUTS', 'PT', 'TP', 'TARGET', 'ENTRY', 'DAILY', 'TODAY', 'DTE', 'ALERT', 'OUT', 'NOW', 'ADD', 'ADDING',
  'HOLD', 'RUN', 'RISK', 'STOP', 'SL', 'LOTTO', 'SWING', 'DAY', 'SCALP', 'PLAY', 'IDEA', 'WATCH', 'OPEN', 'CLOSE',
]);

/* Exit, trim and management posts reuse the alert words but are not new alerts. The wider patterns refuse them;
   the original two patterns keep their exact behaviour. */
const MANAGEMENT = /\b(?:stc|sold|selling|closed?|closing|exit(?:ed|ing)?|out\s+(?:at|of|for|here|now)|trim(?:med|ming)?|took\s+profits?|taking\s+profits?|stopped(?:\s+out)?|runners?|cut(?:ting)?\s+(?:it|loss|losses))\b/i;

/* The symbol must be typed as a ticker: upper case in the original message, or prefixed with "$". */
function tickerAt(original, index, length) {
  const token = original.slice(index, index + length);
  const prefixed = index > 0 && original[index - 1] === '$';
  if (!prefixed && token !== token.toUpperCase()) return '';
  const symbol = token.toUpperCase();
  return NOT_TICKERS.has(symbol) ? '' : symbol;
}

function premiumAfter(normalized, from) {
  const rest = normalized.slice(from);
  const m = rest.match(new RegExp(String.raw`^\s*(?:@|at)\s*\$?(${PRICE}|\.\d+)(?=\s|$)`, 'i'));
  return m ? Number(m[1]) : null;
}

export function parseAlertMessage(content, timestamp = new Date().toISOString(), timeZone = 'America/New_York') {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  // Discord alerts commonly express sub-dollar prices as "40CENTS" or
  // "40 cents". Normalize those tokens for parsing while retaining the
  // original message in `raw` for the audit trail.
  const normalized = text
    .replace(/\b(\d+(?:\.\d+)?)\s*cents?\b/gi, (_, cents) => String(Number(cents) / 100))
    .replace(/(\d),(\d{1,4})(?=\s|$)/g, '$1.$2');
  const pricePattern = PRICE;

  /* 1. Original formats, unchanged: "SPY CALLS 580" and "AAPL entry 230 pt 245". */
  const option = normalized.match(new RegExp(String.raw`(?:^|\s)\$?([A-Z]{1,6})\s+(CALLS?|PUTS?)\s+\$?(${pricePattern})(?=\s|$)`, 'i'));
  if (option) {
    const expiry = resolveOptionExpiration(text, timestamp, timeZone);
    return {
      kind: 'option',
      symbol: option[1].toUpperCase(),
      contractType: option[2].toUpperCase().startsWith('CALL') ? 'CALL' : 'PUT',
      strike: Number(option[3]),
      expiration: expiry.expiration,
      expirationSource: expiry.source,
      needsReview: !expiry.expiration,
      raw: text,
    };
  }
  const entryWordPattern = String.raw`(?:entry|entnry|entery|enrty|etry)`;
  const equity = normalized.match(new RegExp(String.raw`(?:^|\s)\$?([A-Z]{1,6})\s+${entryWordPattern}\s+\$?(${pricePattern})\s+(?:pt|target)\s+\$?(${pricePattern})(?:\s*(plus|\+))?`, 'i'));
  if (equity) {
    return {
      kind: 'equity',
      symbol: equity[1].toUpperCase(),
      entryPrice: Number(equity[2]),
      targetPrice: Number(equity[3]),
      targetIsMinimum: Boolean(equity[4]),
      needsReview: false,
      raw: text,
    };
  }

  /* 2. Wider formats. Management posts (exits, trims, stops) are never new alerts. */
  if (MANAGEMENT.test(normalized)) return null;

  /* Options with the strike before the type: "SPY 580C", "SPY 580 C", "$SPY $580 call", "BTO SPY 10/17 580C @ 1.20",
     "SPY 580 CALLS 10/17", "NVDA 120.5p 0DTE". */
  const optionWide = new RegExp(String.raw`(?:^|\s)\$?([A-Za-z]{1,6})\s+(?:(?:${EXPIRY})\s+)?\$?(${pricePattern})\s*(C|P|CALLS?|PUTS?)(?=[\s,.!]|$)`, 'gi');
  for (let m = optionWide.exec(normalized); m; m = optionWide.exec(normalized)) {
    const start = m.index + (m[0].length - m[0].trimStart().length) + (m[0].trimStart().startsWith('$') ? 1 : 0);
    const symbol = tickerAt(normalized, start, m[1].length);
    if (!symbol) continue;
    const expiry = resolveOptionExpiration(text, timestamp, timeZone);
    const premium = premiumAfter(normalized, m.index + m[0].length);
    return {
      kind: 'option',
      symbol,
      contractType: m[3].toUpperCase().startsWith('C') ? 'CALL' : 'PUT',
      strike: Number(m[2]),
      expiration: expiry.expiration,
      expirationSource: expiry.source,
      ...(premium != null ? { entryPrice: premium } : {}),
      needsReview: !expiry.expiration,
      raw: text,
    };
  }

  /* Stocks with other entry words, or none, and a target: "AAPL @ 230 pt 245", "AAPL 230 target 245", "long AAPL buy 230 tp 245 +". */
  const equityWide = new RegExp(String.raw`(?:^|\s)\$?([A-Za-z]{1,6})\s+(?:(?:${entryWordPattern}|buy|long|@|at)\s*)?\$?(${pricePattern})\s+(?:pt|target|tp)\s*:?\s*\$?(${pricePattern})(?:\s*(plus|\+))?(?=[\s,.!]|$)`, 'gi');
  for (let m = equityWide.exec(normalized); m; m = equityWide.exec(normalized)) {
    const start = m.index + (m[0].length - m[0].trimStart().length) + (m[0].trimStart().startsWith('$') ? 1 : 0);
    const symbol = tickerAt(normalized, start, m[1].length);
    if (!symbol) continue;
    return {
      kind: 'equity',
      symbol,
      entryPrice: Number(m[2]),
      targetPrice: Number(m[3]),
      targetIsMinimum: Boolean(m[4]),
      needsReview: false,
      raw: text,
    };
  }

  /* A stock entry with no target: "AAPL entry 230", "$AAPL @ 230". Captured, but held for review. */
  const equityEntryOnly = new RegExp(String.raw`(?:^|\s)\$?([A-Za-z]{1,6})\s+(?:${entryWordPattern}|buy|long|@|at)\s*\$?(${pricePattern})(?=[\s,.!]|$)`, 'gi');
  for (let m = equityEntryOnly.exec(normalized); m; m = equityEntryOnly.exec(normalized)) {
    const start = m.index + (m[0].length - m[0].trimStart().length) + (m[0].trimStart().startsWith('$') ? 1 : 0);
    const symbol = tickerAt(normalized, start, m[1].length);
    if (!symbol) continue;
    return {
      kind: 'equity',
      symbol,
      entryPrice: Number(m[2]),
      targetPrice: null,
      targetIsMinimum: false,
      needsReview: true,
      raw: text,
    };
  }
  return null;
}
