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
  if (/\bdaily\b/i.test(text)) return { expiration: isoDate(alertDate.year, alertDate.month, alertDate.day), source: 'daily' };
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

export function parseAlertMessage(content, timestamp = new Date().toISOString(), timeZone = 'America/New_York') {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  // Discord alerts commonly express sub-dollar prices as "40CENTS" or
  // "40 cents". Normalize those tokens for parsing while retaining the
  // original message in `raw` for the audit trail.
  const normalized = text
    .replace(/\b(\d+(?:\.\d+)?)\s*cents?\b/gi, (_, cents) => String(Number(cents) / 100))
    .replace(/(\d),(\d{1,4})(?=\s|$)/g, '$1.$2');
  const pricePattern = String.raw`\d+(?:\.\d+)?`;
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
  return null;
}
