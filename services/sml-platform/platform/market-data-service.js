'use strict';

const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

const TIMEFRAMES = Object.freeze({
  '1m': { multiplier: 1, timespan: 'minute', lookbackMs: 3 * 86400_000, ttlMs: 20_000 },
  '5m': { multiplier: 5, timespan: 'minute', lookbackMs: 14 * 86400_000, ttlMs: 30_000 },
  '1D': { multiplier: 1, timespan: 'day', lookbackMs: 2 * 365 * 86400_000, ttlMs: 5 * 60_000 },
  '1W': { multiplier: 1, timespan: 'week', lookbackMs: 8 * 365 * 86400_000, ttlMs: 30 * 60_000 },
  '1M': { multiplier: 1, timespan: 'month', lookbackMs: 15 * 365 * 86400_000, ttlMs: 60 * 60_000 }
});

function cleanSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) throw new TypeError('invalid_symbol');
  return symbol;
}

function cleanTimeframe(value) {
  const timeframe = String(value || '5m');
  if (!TIMEFRAMES[timeframe]) throw new TypeError('invalid_timeframe');
  return timeframe;
}

function normalizeBars(results) {
  if (!Array.isArray(results)) return [];
  return results.map((bar) => ({
    t: Number(bar?.t), o: Number(bar?.o), h: Number(bar?.h),
    l: Number(bar?.l), c: Number(bar?.c), v: Number(bar?.v) || 0,
    vw: Number.isFinite(Number(bar?.vw)) ? Number(bar.vw) : null,
    n: Number.isFinite(Number(bar?.n)) ? Number(bar.n) : null
  })).filter((bar) => Number.isFinite(bar.t) && [bar.o, bar.h, bar.l, bar.c].every(Number.isFinite));
}

function createMassiveHistory({ apiKey = '', fetchImpl = fetch, now = Date.now, baseUrl = 'https://api.massive.com', sanitize = null } = {}) {
  const cache = new Map();
  const inflight = new Map();
  const enabled = Boolean(String(apiKey).trim());

  async function get(symbolRaw, timeframeRaw = '5m') {
    if (!enabled) return { ok: false, status: 503, code: 'massive_unconfigured' };
    const symbol = cleanSymbol(symbolRaw);
    const timeframe = cleanTimeframe(timeframeRaw);
    const config = TIMEFRAMES[timeframe];
    const key = `${symbol}:${timeframe}`;
    const current = now();
    const cached = cache.get(key);
    if (cached && cached.freshUntil > current) return { ok: true, status: 200, data: cached.data, cached: true };
    if (inflight.has(key)) return inflight.get(key);

    const pending = (async () => {
      const from = new Date(current - config.lookbackMs).toISOString().slice(0, 10);
      const to = new Date(current).toISOString().slice(0, 10);
      const url = `${String(baseUrl).replace(/\/$/, '')}/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/${config.multiplier}/${config.timespan}/${from}/${to}?adjusted=true&sort=asc&limit=50000`;
      try {
        const response = await fetchImpl(url, {
          headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8_000)
        });
        if (!response.ok) throw new Error(`massive_history_${response.status}`);
        const body = await response.json();
        let bars = normalizeBars(body?.results), repaired = 0;
        if (sanitize) { const r = sanitize(bars, timeframe); bars = r.bars; repaired = r.repaired; }
        if (!bars.length) throw new Error('massive_history_empty');
        const lastBarAt = bars[bars.length - 1].t;
        const data = { symbol, tf: timeframe, bars: bars.slice(-5000), asOf: current, lastBarAt, adjusted: true, source: 'massive-rest', quality: 'authoritative', ...(repaired ? { repairedBars: repaired } : {}) };
        cache.set(key, { freshUntil: current + config.ttlMs, staleUntil: current + 6 * 3600_000, data });
        return { ok: true, status: 200, data, cached: false };
      } catch (_) {
        if (cached && cached.staleUntil > current) return { ok: true, status: 200, data: { ...cached.data, stale: true }, cached: true };
        return { ok: false, status: 503, code: 'massive_history_unavailable' };
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, pending);
    return pending;
  }

  /* Recent individual trades as [t, price, size] oldest first, for tick charts. Best effort: a plan without trade history just returns nothing and the live record is used alone. */
  const tradeCache = new Map();
  async function trades(symbolRaw, limit = 20_000) {
    if (!enabled) return [];
    const symbol = cleanSymbol(symbolRaw), current = now(), hit = tradeCache.get(symbol);
    if (hit && hit.until > current) return hit.rows;
    try {
      const url = `${String(baseUrl).replace(/\/$/, '')}/v3/trades/${encodeURIComponent(symbol)}?order=desc&sort=timestamp&limit=${Math.min(50_000, limit)}`;
      const response = await fetchImpl(url, { headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(`massive_trades_${response.status}`);
      const body = await response.json();
      const rows = (Array.isArray(body?.results) ? body.results : []).map((r) => {
        const ns = Number(r.participant_timestamp ?? r.sip_timestamp), price = Number(r.price), size = Number(r.size);
        return [Math.floor(ns / 1e6), price, Number.isFinite(size) ? size : 0];
      }).filter((r) => Number.isFinite(r[0]) && r[1] > 0).reverse();
      tradeCache.set(symbol, { until: current + 20_000, rows });
      return rows;
    } catch (_) {
      tradeCache.set(symbol, { until: current + 60_000, rows: [] });
      return [];
    }
  }

  return { enabled, get, trades, cache };
}

/* Optional provider adapter. It remains disabled until both the feature flag
 * and an entitled Massive Options plan are present. The raw provider payload
 * is preserved; missing quotes/Greeks are never synthesized. */
function createMassiveOptions({ apiKey = '', enabled = false, fetchImpl = fetch, baseUrl = 'https://api.massive.com', maxPages = 4 } = {}) {
  const configured = Boolean(enabled && String(apiKey).trim());
  async function get(kind, symbolRaw, params = {}) {
    if (kind !== 'options') return { ok: false, status: 404, code: 'not_found' };
    if (!configured) return { ok: false, status: 503, code: 'massive_options_disabled' };
    const symbol = cleanSymbol(symbolRaw);
    const query = new URLSearchParams({ limit: '250' });
    if (params.expiration) query.set('expiration_date', String(params.expiration));
    const root = String(baseUrl).replace(/\/$/, '');
    const headers = { accept: 'application/json', authorization: `Bearer ${apiKey}` };
    try {
      /* The snapshot is paged (250 contracts per page). Follow next_url - only on the provider's own host - so chain-wide
         numbers (put/call, GEX, max pain) are computed from the whole chain, not the first page. */
      let url = `${root}/v3/snapshot/options/${encodeURIComponent(symbol)}?${query}`;
      const results = []; let first = null, pages = 0, truncated = false;
      while (url && pages < maxPages) {
        const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(8_000) });
        if (!response.ok) {
          if (!pages) return { ok: false, status: response.status, code: 'massive_options_unavailable' };
          truncated = true; break; // keep what we already have
        }
        const page = await response.json();
        if (!first) first = page;
        if (Array.isArray(page?.results)) results.push(...page.results);
        pages += 1;
        const next = typeof page?.next_url === 'string' ? page.next_url : '';
        let ok = false;
        try { const n = new URL(next), r = new URL(root); ok = Boolean(next) && n.protocol === r.protocol && n.host === r.host; } catch (_) { ok = false; }
        url = ok ? next : '';
        if (next && !ok) truncated = true;
      }
      if (url) truncated = true;
      if (!results.length) return { ok: false, status: 503, code: 'massive_options_empty' };
      const data = { ...first, results, next_url: undefined };
      return { ok: true, status: 200, data: { ok: true, symbol, provider: 'massive', pages, contracts: results.length, complete: !truncated, data } };
    } catch (_) { return { ok: false, status: 503, code: 'massive_options_unavailable' }; }
  }
  return { configured, get };
}

function createQueuedDataSource({ source, now = Date.now, setTimer = setTimeout, minimumIntervalMs = 12_100,
  optionsTtlMs = 10 * 60_000, closedOptionsTtlMs = 60 * 60_000, marketOpen = () => false } = {}) {
  if (!source || typeof source.get !== 'function') throw new TypeError('source_required');
  const cache = new Map();
  const inflight = new Map();
  let queue = Promise.resolve();
  let lastStartedAt = 0;

  function keyOf(kind, symbol, params) {
    return `${kind}:${String(symbol || '').toUpperCase()}:${String(params?.expiration || '')}`;
  }

  function enqueue(work) {
    const run = async () => {
      const wait = Math.max(0, lastStartedAt + minimumIntervalMs - now());
      if (wait) await new Promise((resolve) => setTimer(resolve, wait));
      lastStartedAt = now();
      return work();
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  }

  async function get(kind, symbol, params = {}) {
    const key = keyOf(kind, symbol, params);
    const current = now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > current) return { ...cached.result, cached: true };
    if (inflight.has(key)) return inflight.get(key);
    const work = async () => {
      const result = await source.get(kind, symbol, params);
      if (result?.ok) {
        const ttl = kind === 'options' ? (marketOpen(current) ? optionsTtlMs : closedOptionsTtlMs) : optionsTtlMs;
        cache.set(key, { expiresAt: now() + ttl, result });
      }
      return result;
    };
    const pending = (kind === 'options' ? enqueue(work) : work()).finally(() => inflight.delete(key));
    inflight.set(key, pending);
    return pending;
  }

  return { configured: source.configured, get, cache, inflight };
}

function allowedPublicOrigin(origin) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && (url.hostname === 'stockmarketloop.com' || url.hostname === 'www.stockmarketloop.com' || url.hostname.endsWith('.stockmarketloop.com'));
  } catch (_) { return false; }
}

module.exports = { createMassiveHistory, createMassiveOptions, createQueuedDataSource, cleanSymbol, cleanTimeframe, normalizeBars, allowedPublicOrigin, TIMEFRAMES };
