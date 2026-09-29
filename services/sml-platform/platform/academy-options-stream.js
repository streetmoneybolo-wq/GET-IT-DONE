'use strict';

/* Live push for one symbol's options chain, modelled on academy-sire-feed.js: one shared poll per
 * symbol regardless of how many Activity viewers are watching it, so ten open chains on the same
 * underlying still only hit the data bridge once. Options quotes do not move at trade speed, so
 * this polls far slower than a stock quote or scanner stream — REFRESH_MS is a real product knob,
 * not a limit worked around.
 *
 * A viewer gets one `snapshot` (every row currently known) then `update` events carrying only the
 * rows whose bid, ask, last, volume, open interest or greeks changed since the last thing it saw,
 * plus a fresh spot price whenever the underlying moves. Nothing runs while nobody is watching a
 * given symbol; its feed is torn down the moment its last viewer leaves. */

const { normalize, findSpot } = require('./academy-options-chain');

const REFRESH_MS = 20_000;
const MAX_SYMBOLS = 40;
const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const SIDE_KEYS = ['bid', 'ask', 'last', 'volume', 'oi', 'iv', 'delta', 'gamma', 'theta', 'vega'];

const rowKey = (r) => `${r.expiry}|${r.strike}`;
const sideOut = (s) => (s ? { bid: s.bid, ask: s.ask, last: s.last, volume: s.volume, oi: s.oi, iv: s.iv, delta: s.delta, gamma: s.gamma, theta: s.theta, vega: s.vega } : null);
const compact = (r) => ({ expiry: r.expiry, strike: r.strike, call: sideOut(r.call), put: sideOut(r.put) });
function sideChanged(a, b) {
  if (!a && !b) return false;
  if (!a || !b) return true;
  for (const key of SIDE_KEYS) if (a[key] !== b[key]) return true;
  return false;
}

/* One symbol's shared feed: fetchChain(symbol) is academyDataBridge.get('options', symbol). */
function createSymbolFeed(symbol, { fetchChain, now = Date.now, timers = { setInterval, clearInterval }, logger = () => {}, refreshMs = REFRESH_MS } = {}) {
  const rows = new Map(); // "expiry|strike" -> compact row
  const viewers = new Set();
  let spot = null, refreshTimer = null, refreshing = false, lastError = null;

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const result = await fetchChain(symbol);
      if (!result || !result.ok) { lastError = (result && result.code) || 'unavailable'; return; }
      const list = normalize(result.data).map(compact);
      const nextSpot = findSpot(result.data);
      lastError = null;
      const changed = [];
      const seen = new Set();
      for (const row of list) {
        const key = rowKey(row);
        seen.add(key);
        const prev = rows.get(key);
        if (!prev || sideChanged(prev.call, row.call) || sideChanged(prev.put, row.put)) { rows.set(key, row); changed.push(row); }
      }
      for (const key of rows.keys()) if (!seen.has(key)) rows.delete(key); // a contract that expired or dropped out
      const spotChanged = nextSpot != null && nextSpot !== spot;
      if (spotChanged) spot = nextSpot;
      if (changed.length || spotChanged) {
        const payload = { symbol, spot, rows: changed, at: now() };
        for (const viewer of viewers) viewer.write('update', payload);
      }
    } catch (error) {
      lastError = String((error && error.message) || error);
      logger('warn', 'academy_options_stream_refresh_failed', { symbol, error });
    } finally { refreshing = false; }
  }

  function start() {
    if (refreshTimer) return;
    refreshTimer = timers.setInterval(() => { void refresh(); }, refreshMs);
    if (refreshTimer && refreshTimer.unref) refreshTimer.unref();
    void refresh();
  }
  function stop() {
    if (refreshTimer) timers.clearInterval(refreshTimer);
    refreshTimer = null; rows.clear(); spot = null;
  }

  function subscribe(write) {
    const viewer = { write };
    viewers.add(viewer);
    start();
    write('snapshot', { symbol, spot, rows: [...rows.values()], error: lastError, at: now() });
    return () => { viewers.delete(viewer); if (!viewers.size) stop(); };
  }
  const status = () => ({ symbol, viewers: viewers.size, rows: rows.size, running: Boolean(refreshTimer), error: lastError });
  return { subscribe, status };
}

/* One createSymbolFeed per distinct subscribed symbol, torn down the moment its last viewer
   leaves. maxSymbols is a hard cap so an unbounded set of distinct symbols never accumulates one
   running poll each — past it, a new symbol is refused (fails closed) rather than evicting an
   existing viewer's feed out from under them. */
function createOptionsStream({ fetchChain, now = Date.now, timers = { setInterval, clearInterval }, logger = () => {}, refreshMs = REFRESH_MS, maxSymbols = MAX_SYMBOLS } = {}) {
  const feeds = new Map();
  function subscribe(symbol, write) {
    const key = String(symbol || '').toUpperCase();
    if (!SYMBOL_RE.test(key)) return null;
    let feed = feeds.get(key);
    if (!feed) {
      if (feeds.size >= maxSymbols) return null;
      feed = createSymbolFeed(key, { fetchChain, now, timers, logger, refreshMs });
      feeds.set(key, feed);
    }
    const off = feed.subscribe(write);
    return () => { off(); if (feed.status().viewers === 0) feeds.delete(key); };
  }
  const status = () => [...feeds.values()].map((f) => f.status());
  return { subscribe, status };
}

module.exports = { createOptionsStream };
