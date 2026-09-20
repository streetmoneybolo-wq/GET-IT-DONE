const BASE_URL = 'https://api.massive.com';
const sessionCache = new Map();

function requiredKey() {
  if (!process.env.MASSIVE_API_KEY) throw new Error('MASSIVE_API_KEY is not configured.');
  return process.env.MASSIVE_API_KEY;
}

async function massiveGet(pathname, query = {}) {
  const url = new URL(pathname, BASE_URL);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${requiredKey()}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.status === 'ERROR') {
    throw new Error(`Massive request failed (${response.status}): ${body.error || body.message || 'unknown error'}`);
  }
  return body;
}

export async function fetchTickerDetails(symbol) {
  const body = await massiveGet(`/v3/reference/tickers/${encodeURIComponent(symbol)}`);
  const row = body.results || {};
  return {
    symbol: String(row.ticker || symbol).toUpperCase(),
    name: String(row.name || symbol),
    exchange: String(row.primary_exchange || ''),
    market: String(row.market || ''),
    locale: String(row.locale || ''),
    currency: String(row.currency_name || 'usd'),
    marketCap: Number.isFinite(Number(row.market_cap)) ? Number(row.market_cap) : null,
    homepageUrl: row.homepage_url || '',
    description: row.description || '',
    sicCode: String(row.sic_code || ''),
    sicDescription: String(row.sic_description || ''),
    active: row.active !== false,
    requestId: body.request_id || '',
  };
}

export async function fetchRelatedTickers(symbol) {
  const body = await massiveGet(`/v1/related-companies/${encodeURIComponent(symbol)}`);
  return {
    symbol: String(symbol || '').toUpperCase(),
    requestId: body.request_id || '',
    tickers: [...new Set((body.results || [])
      .map((row) => String(row.ticker || '').toUpperCase().replace(/[^A-Z0-9.]/g, ''))
      .filter((ticker) => ticker && ticker !== String(symbol || '').toUpperCase()))],
  };
}

export async function fetchMinuteBars(symbol, fromTimestamp, toTimestamp = Date.now()) {
  const from = Math.max(0, Number(new Date(fromTimestamp)) || Number(fromTimestamp) || 0);
  const to = Math.max(from, Number(new Date(toTimestamp)) || Number(toTimestamp) || Date.now());
  const body = await massiveGet(
    `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/minute/${Math.floor(from)}/${Math.floor(to)}`,
    { adjusted: true, sort: 'asc', limit: 50_000 },
  );
  if (body.next_url) throw new Error('Minute-bar response is incomplete; publication requires the full tracking window.');
  if (body.ticker && String(body.ticker).toUpperCase() !== String(symbol).toUpperCase()) throw new Error('Market-data ticker mismatch.');
  return {
    symbol: String(body.ticker || symbol).toUpperCase(),
    requestId: body.request_id || '',
    adjusted: body.adjusted !== false,
    resultsCount: Number(body.resultsCount || body.results?.length || 0),
    bars: (body.results || []).map((row) => ({
      timestamp: Number(row.t),
      open: Number(row.o),
      high: Number(row.h),
      low: Number(row.l),
      close: Number(row.c),
      volume: Number(row.v || 0),
      vwap: row.vw == null ? null : Number(row.vw),
      transactions: row.n == null ? null : Number(row.n),
    })).filter((row) => Number.isFinite(row.timestamp) && row.timestamp >= from && row.timestamp <= to && Number.isFinite(row.high) && Number.isFinite(row.close)),
  };
}

export async function fetchTradingSessions(fromTimestamp, toTimestamp = Date.now()) {
  const format = (value) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const from = format(fromTimestamp), to = format(toTimestamp);
  const cacheKey = `${from}:${to}`;
  const cached = sessionCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 120_000) return cached.value;
  const body = await massiveGet(`/v2/aggs/ticker/SPY/range/1/day/${from}/${to}`, { adjusted: true, sort: 'asc', limit: 5000 });
  if (body.next_url || !body.request_id) throw new Error('Trading-session reference response is incomplete.');
  const dates = [...new Set((body.results || []).filter((bar) => Number(bar.v) > 0 && Number(bar.c) > 0).map((bar) => format(Number(bar.t))))].sort();
  const value = { dates, requestId: body.request_id, complete: true };
  sessionCache.set(cacheKey, { at: Date.now(), value });
  if (sessionCache.size > 300) sessionCache.delete(sessionCache.keys().next().value);
  return value;
}

export function highestBar(bars) {
  return (bars || []).reduce((best, row) => (!best || row.high > best.high ? row : best), null);
}
