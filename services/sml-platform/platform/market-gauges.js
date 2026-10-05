'use strict';

/* Market-wide gauges for the sentiment panel: SPY and QQQ day change (from daily candles, previous close vs latest) and the VIX level.
 * VIX comes from the vendor's index feed, which not every plan includes: when it is refused the gauge is simply absent
 * (negatively cached for 10 minutes so a missing entitlement is not hammered) and the sentiment reading says so. */
function changeFromDaily(bars) {
  const list = Array.isArray(bars) ? bars.filter((b) => Number.isFinite(Number(b && b.c))) : [];
  if (list.length < 2) return null;
  const last = Number(list[list.length - 1].c), prev = Number(list[list.length - 2].c);
  if (!(prev > 0) || !(last > 0)) return null;
  return { price: last, changePct: Math.round(((last / prev) - 1) * 10_000) / 100 };
}

function createVixFetcher({ apiKey = '', fetchImpl = fetch, baseUrl = 'https://api.massive.com' } = {}) {
  return async function vix() {
    if (!String(apiKey).trim()) return null;
    const response = await fetchImpl(`${String(baseUrl).replace(/\/$/, '')}/v2/aggs/ticker/I:VIX/prev?adjusted=true`, {
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(6_000)
    });
    if (!response.ok) return null;
    const body = await response.json();
    const level = Number(body && body.results && body.results[0] && body.results[0].c);
    return Number.isFinite(level) && level > 0 ? { level } : null;
  };
}

function createMarketGauges({ candles, vix = null, now = Date.now, ttlMs = 60_000, vixTtlMs = 5 * 60_000, vixMissTtlMs = 10 * 60_000 } = {}) {
  let cache = null, vixCache = null;
  async function readVix() {
    if (typeof vix !== 'function') return null;
    if (vixCache && vixCache.until > now()) return vixCache.value;
    let value = null;
    try { value = await vix(); } catch (_) { value = null; }
    vixCache = { until: now() + (value ? vixTtlMs : vixMissTtlMs), value };
    return value;
  }
  async function one(symbol) {
    try { const r = await candles(symbol, '1D'); return changeFromDaily(r && r.bars); } catch (_) { return null; }
  }
  async function get() {
    if (cache && cache.until > now()) return cache.value;
    const [spy, qqq, v] = await Promise.all([one('SPY'), one('QQQ'), readVix()]);
    const value = { spy, qqq, vix: v, asOf: now() };
    cache = { until: now() + ttlMs, value };
    return value;
  }
  return { get };
}

module.exports = { createMarketGauges, createVixFetcher, changeFromDaily };
