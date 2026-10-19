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

/* how many symbol:timeframe histories stay in memory: each one is up to 5,000 bars (hundreds of kilobytes as objects), and the
   service runs in 512 MB; a copy past its stale window goes first, then the least recently stored */
const HISTORY_CACHE_MAX = 120;

function createMassiveHistory({ apiKey = '', fetchImpl = fetch, now = Date.now, baseUrl = 'https://api.massive.com', sanitize = null, maxEntries = HISTORY_CACHE_MAX } = {}) {
  const cache = new Map();
  const inflight = new Map();
  const enabled = Boolean(String(apiKey).trim());
  function keep(key, entry, current) {
    cache.delete(key); // re-inserted last, so the oldest key is the least recently refreshed
    for (const [k, v] of cache) if (v.staleUntil <= current) cache.delete(k);
    while (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
    cache.set(key, entry);
  }

  async function get(symbolRaw, timeframeRaw = '5m') {
    if (!enabled) return { ok: false, status: 503, code: 'massive_unconfigured' };
    const symbol = cleanSymbol(symbolRaw);
    const timeframe = cleanTimeframe(timeframeRaw);
    const config = TIMEFRAMES[timeframe];
    const key = `${symbol}:${timeframe}`;
    const current = now();
    const cached = cache.get(key);
    if (cached && cached.freshUntil > current) return { ok: true, status: 200, data: cached.data, cached: true };
    /* a copy that is past fresh but still recent is served at once (marked stale) while one refresh runs behind it:
       a timeframe switch never waits on the provider when the bars are already here */
    const serveStale = cached && cached.staleUntil > current && current - (cached.data.asOf || 0) < 10 * 60_000;
    if (inflight.has(key)) return serveStale ? { ok: true, status: 200, data: { ...cached.data, stale: true }, cached: true } : inflight.get(key);

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
        keep(key, { freshUntil: current + config.ttlMs, staleUntil: current + 6 * 3600_000, data }, current);
        return { ok: true, status: 200, data, cached: false };
      } catch (_) {
        if (cached && cached.staleUntil > current) return { ok: true, status: 200, data: { ...cached.data, stale: true }, cached: true };
        return { ok: false, status: 503, code: 'massive_history_unavailable' };
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, pending);
    if (serveStale) { pending.catch(() => {}); return { ok: true, status: 200, data: { ...cached.data, stale: true }, cached: true }; }
    return pending;
  }

  /* Recent individual trades as [t, price, size] oldest first, for tick charts. Best effort: a plan without trade history just returns nothing and the live record is used alone. */
  const tradeCache = new Map(); // symbol -> { until, rows }, at most TRADE_CACHE_MAX symbols
  const TRADE_CACHE_MAX = 4;
  async function trades(symbolRaw, limit = 20_000) {
    if (!enabled) return [];
    const symbol = cleanSymbol(symbolRaw), current = now(), hit = tradeCache.get(symbol);
    if (hit && hit.until > current) return hit.rows;
    // 50,000 prints are several megabytes a symbol: expired symbols go, and only the last few stay in memory
    for (const [k, v] of tradeCache) if (v.until <= current) tradeCache.delete(k);
    while (tradeCache.size >= TRADE_CACHE_MAX) tradeCache.delete(tradeCache.keys().next().value);
    try {
      const url = `${String(baseUrl).replace(/\/$/, '')}/v3/trades/${encodeURIComponent(symbol)}?order=desc&sort=timestamp&limit=${Math.min(50_000, limit)}`;
      const response = await fetchImpl(url, { headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(`massive_trades_${response.status}`);
      const body = await response.json();
      /* [t ms, price, size, off]: off = printed off-exchange (SIP exchange 4, the FINRA trade reporting facility, or a TRF id),
         which is what the dark-pool tool counts. Real trade-record data, not an estimate. */
      const rows = (Array.isArray(body?.results) ? body.results : []).map((r) => {
        const ns = Number(r.participant_timestamp ?? r.sip_timestamp), price = Number(r.price), size = Number(r.size);
        return [Math.floor(ns / 1e6), price, Number.isFinite(size) ? size : 0, Number(r.exchange) === 4 || (r.trf_id != null && r.trf_id !== '') ? 1 : 0];
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

/* how many answers (options chains are the big ones, up to a megabyte each) the queued source keeps: expired copies go first */
const QUEUED_CACHE_MAX = 160;

function createQueuedDataSource({ source, now = Date.now, setTimer = setTimeout, minimumIntervalMs = 12_100,
  optionsTtlMs = 10 * 60_000, closedOptionsTtlMs = 60 * 60_000, staleTtlMs = 2 * 60 * 60_000, backgroundRetryMs = 30 * 60_000, marketOpen = () => false,
  maxEntries = QUEUED_CACHE_MAX } = {}) {
  if (!source || typeof source.get !== 'function') throw new TypeError('source_required');
  const cache = new Map();
  const inflight = new Map();
  /* the last good answer per key, kept past its freshness so a provider hiccup serves a marked-stale chain instead of nothing */
  const lastGood = new Map();
  /* neither map grows without end: the alert desk sweeps hundreds of tickers, and every chain it ever read used to stay in memory */
  function prune(current) {
    for (const [k, v] of cache) if (v.expiresAt <= current) cache.delete(k);
    for (const [k, v] of lastGood) if (current - v.at > staleTtlMs) lastGood.delete(k);
    while (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
    while (lastGood.size >= maxEntries) lastGood.delete(lastGood.keys().next().value);
  }
  /* the last failure per key, so the route that asks next can say what actually went wrong */
  const failures = new Map();
  /* One cold options call at a time, spaced minimumIntervalMs apart. A member waiting on a click goes to the front of the
     line; the background sweeps (alert desk, VIX index, market direction) take the slots nobody is waiting on. */
  const pending = [];
  let pumping = false;
  let lastStartedAt = 0;

  function keyOf(kind, symbol, params) {
    return `${kind}:${String(symbol || '').toUpperCase()}:${String(params?.expiration || '')}`;
  }

  function enqueue(work, priority) {
    return new Promise((resolve, reject) => {
      const item = { work, resolve, reject, priority };
      if (priority === 'interactive') {
        const at = pending.findIndex((p) => p.priority !== 'interactive');
        if (at < 0) pending.push(item); else pending.splice(at, 0, item);
      } else pending.push(item);
      void pump();
    });
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (pending.length) {
        const wait = Math.max(0, lastStartedAt + minimumIntervalMs - now());
        if (wait) await new Promise((resolve) => setTimer(resolve, wait));
        const item = pending.shift(); // taken after the wait, so a click that arrived meanwhile goes first
        lastStartedAt = now();
        try { item.resolve(await item.work()); } catch (error) { item.reject(error); }
      }
    } finally { pumping = false; }
  }

  function staleOf(good, failure) {
    const data = good.result.data && typeof good.result.data === 'object' ? { ...good.result.data, stale: true, asOf: good.at } : good.result.data;
    return { ...good.result, data, stale: true, cached: true, failure };
  }

  async function get(kind, symbol, params = {}, { priority = 'background' } = {}) {
    const key = keyOf(kind, symbol, params);
    const current = now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > current) return { ...cached.result, cached: true };
    if (inflight.has(key)) return inflight.get(key);
    /* a background sweep does not retry a symbol the site just refused; that call would only spend the feed's quota again */
    const failed = failures.get(key);
    if (priority !== 'interactive' && failed && current - failed.at < backgroundRetryMs) {
      const good = lastGood.get(key);
      return good && current - good.at <= staleTtlMs ? staleOf(good, failed.result) : { ...failed.result, skipped: true };
    }
    const work = async () => {
      const result = await source.get(kind, symbol, params);
      if (result?.ok) {
        const ttl = kind === 'options' ? (marketOpen(current) ? optionsTtlMs : closedOptionsTtlMs) : optionsTtlMs;
        const at = now();
        cache.delete(key); lastGood.delete(key); // re-inserted last: the oldest entry is the least recently refreshed
        prune(at);
        cache.set(key, { expiresAt: at + ttl, result });
        lastGood.set(key, { at, result });
        failures.delete(key);
        return result;
      }
      failures.set(key, { at: now(), result });
      if (failures.size > 500) failures.delete(failures.keys().next().value);
      const good = lastGood.get(key);
      if (good && now() - good.at <= staleTtlMs) return staleOf(good, result);
      return result;
    };
    const run = (kind === 'options' ? enqueue(work, priority) : work()).finally(() => inflight.delete(key));
    inflight.set(key, run);
    return run;
  }

  function lastFailure(kind, symbol, params = {}) {
    return failures.get(keyOf(kind, symbol, params)) || null;
  }

  return { configured: source.configured, get, lastFailure, cache, inflight, pending };
}

function allowedPublicOrigin(origin) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && (url.hostname === 'stockmarketloop.com' || url.hostname === 'www.stockmarketloop.com' || url.hostname.endsWith('.stockmarketloop.com'));
  } catch (_) { return false; }
}

/* Intervals Massive does not serve directly, built from one it does. The WordPress history feed is the normal source for
 * these; when that feed is throttled or down, the chart would otherwise show nothing for them. Intraday buckets of an hour
 * or more are phased to the half hour so they line up with the 9:30 open; shorter ones already divide 9:30 evenly. */
const DERIVED_TIMEFRAMES = Object.freeze({
  '3m': { base: '1m', ms: 3 * 60_000 }, '10m': { base: '5m', ms: 10 * 60_000 }, '15m': { base: '5m', ms: 15 * 60_000 }, '30m': { base: '5m', ms: 30 * 60_000 },
  '1h': { base: '5m', ms: 3_600_000, phaseMs: 1_800_000 }, '2h': { base: '5m', ms: 2 * 3_600_000, phaseMs: 1_800_000 }, '4h': { base: '5m', ms: 4 * 3_600_000, phaseMs: 1_800_000 },
  '1Q': { base: '1M', months: 3 }, '1Y': { base: '1M', months: 12 }
});

function resampleBars(bars, timeframe) {
  const cfg = DERIVED_TIMEFRAMES[timeframe];
  if (!cfg) return [];
  const bucketOf = (t) => {
    if (cfg.ms) { const phase = cfg.phaseMs || 0; return Math.floor((t - phase) / cfg.ms) * cfg.ms + phase; }
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / cfg.months) * cfg.months, 1);
  };
  const out = [];
  let cur = null;
  for (const b of Array.isArray(bars) ? bars : []) {
    const t = Number(b && b.t), o = Number(b && b.o), h = Number(b && b.h), l = Number(b && b.l), c = Number(b && b.c), v = Number(b && b.v) || 0;
    if (![t, o, h, l, c].every(Number.isFinite)) continue;
    const key = bucketOf(t);
    if (!cur || cur.t !== key) { if (cur) out.push(cur); cur = { t: key, o, h, l, c, v }; }
    else { cur.h = Math.max(cur.h, h); cur.l = Math.min(cur.l, l); cur.c = c; cur.v += v; }
  }
  if (cur) out.push(cur);
  return out;
}

module.exports = { createMassiveHistory, createMassiveOptions, createQueuedDataSource, cleanSymbol, cleanTimeframe, normalizeBars, allowedPublicOrigin, resampleBars, TIMEFRAMES, DERIVED_TIMEFRAMES, HISTORY_CACHE_MAX, QUEUED_CACHE_MAX };
