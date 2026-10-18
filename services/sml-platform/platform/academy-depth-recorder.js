'use strict';

/*
 * Full-depth order-book recorder for the Academy research desk.
 *
 * Asks the site's moomoo bridge for the whole book (depth=60, moomoo's ceiling for US stocks) for a few symbols, SPY and QQQ by default,
 * and keeps every change in Postgres (academy_depth_snapshots). The live Level 2 reader keeps its own ten-level poll untouched; this runs
 * beside it, one symbol at a time, during market hours only, and skips a snapshot when the book has not changed.
 *
 * Why: Level 2 has no history, so the reader's signals (stack / pull / absorb / iceberg / flip) have never been measured on more than the
 * live five-minute outcome log. With a recording, academy-depth-replay.js can run the same reader over past sessions at ten levels and at
 * the full book and score both. Research only: nothing here is shown to members or places a trade.
 *
 * Settings: ACADEMY_DEPTH_RECORDER=off disables it; ACADEMY_DEPTH_RECORD_SYMBOLS="SPY,QQQ"; ACADEMY_DEPTH_RECORD_POLL_MS (default 2500);
 * ACADEMY_DEPTH_RECORD_LEVELS (default 60); ACADEMY_DEPTH_RETENTION_DAYS (default 30). Rough footprint: a 60-level book changes most
 * polls, so expect about 2 KB a row and 9,000 rows a symbol a day, around 20 MB a symbol a day before Postgres compression.
 */

const SYMBOL = /^[A-Z0-9.:-]{1,10}$/;

function parseSymbols(value, fallback = ['SPY', 'QQQ']) {
  const list = String(value || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => SYMBOL.test(s));
  return [...new Set(list.length ? list : fallback)].slice(0, 6);
}

function cleanSide(levels, desc) {
  const out = (Array.isArray(levels) ? levels : [])
    .map((l) => [Number(l && l.price), Number(l && l.size), Number(l && l.orders) || 0])
    .filter(([p, s]) => Number.isFinite(p) && p > 0 && Number.isFinite(s) && s >= 0);
  out.sort((a, b) => (desc ? b[0] - a[0] : a[0] - b[0]));
  return out;
}

const sizeOf = (side, n) => side.slice(0, n).reduce((s, l) => s + l[1], 0);
const bookKey = (bids, asks) => JSON.stringify([bids, asks]);

function createDepthRecorder({
  origin, store, fetchImpl = fetch, logger = () => {}, now = Date.now, isMarketOpen = () => true,
  symbols = ['SPY', 'QQQ'], pollMs = 2500, closedPollMs = 60000, levels = 60, retentionDays = 30, pruneEveryMs = 6 * 3600_000,
  timeoutMs = 15000, timers = { setTimeout, clearTimeout }
} = {}) {
  const list = parseSymbols(symbols.join ? symbols.join(',') : symbols);
  const state = new Map(list.map((s) => [s, { lastKey: '', lastT: 0, seen: new Set(), rows: 0, failures: 0, lastError: '', lastOk: 0, lastSkipped: 0 }]));
  let running = false, timer = null, inFlight = false, lastPrune = 0, pruned = 0;

  async function fetchBook(symbol) {
    const url = `${origin}/wp-json/sml-scanner/v1/market-v2?symbol=${encodeURIComponent(symbol)}&depth=${levels}&ticks=40`;
    const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'StockMarketLoop-Academy-DepthRecorder/1.0' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`depth_${res.status}`);
    const j = await res.json();
    const bids = cleanSide(j && j.book && j.book.bids, true), asks = cleanSide(j && j.book && j.book.asks, false);
    if (!j || j.available === false || !bids.length || !asks.length) return null;
    const asof = Number(j.asof);
    return { t: Number.isFinite(asof) && asof > 1e11 ? asof : now(), bids, asks, ticks: Array.isArray(j.ticks) ? j.ticks : [] };
  }

  /* Prints the live reader has not seen on earlier polls: the bridge sends the last 40 every time. */
  function newPrints(e, ticks) {
    const out = [];
    for (const k of ticks) {
      const id = k && (k.id != null ? String(k.id) : [k.timestamp_ms, k.price, k.size].join(':'));
      if (!id || e.seen.has(id)) continue;
      const price = Number(k.price), size = Number(k.size), t = Number(k.timestamp_ms);
      if (!Number.isFinite(price) || !Number.isFinite(size) || !Number.isFinite(t)) continue;
      e.seen.add(id);
      const dir = String(k.direction || '').toUpperCase();
      out.push([t, price, size, dir === 'BUY' ? 'B' : dir === 'SELL' ? 'S' : 'N']);
    }
    if (e.seen.size > 600) e.seen = new Set([...e.seen].slice(-300));
    out.sort((a, b) => a[0] - b[0]);
    return out;
  }

  /** One poll of one symbol. Returns what happened so tests and the status view can see it. */
  async function record(symbol) {
    const e = state.get(symbol);
    if (!e) throw new TypeError('invalid_symbol');
    let book;
    try { book = await fetchBook(symbol); }
    catch (error) { e.failures += 1; e.lastError = String(error.message || error).slice(0, 200); return { symbol, stored: false, reason: 'fetch_failed' }; }
    if (!book) return { symbol, stored: false, reason: 'closed' };
    if (book.bids[0][0] > book.asks[0][0]) return { symbol, stored: false, reason: 'crossed' };
    const prints = newPrints(e, book.ticks);
    const key = bookKey(book.bids, book.asks);
    if (key === e.lastKey && !prints.length) { e.lastSkipped = now(); return { symbol, stored: false, reason: 'unchanged' }; }
    const t = book.t <= e.lastT ? e.lastT + 1 : book.t; // the bridge's "as of" can repeat; rows must stay strictly ordered
    const row = {
      symbol, t, depth: Math.min(book.bids.length, book.asks.length), bid1: book.bids[0][0], ask1: book.asks[0][0],
      bidSize10: sizeOf(book.bids, 10), askSize10: sizeOf(book.asks, 10), bidSizeAll: sizeOf(book.bids, book.bids.length), askSizeAll: sizeOf(book.asks, book.asks.length),
      bids: book.bids, asks: book.asks, prints
    };
    try {
      await store.append(row);
      e.lastKey = key; e.lastT = t; e.rows += 1; e.failures = 0; e.lastError = ''; e.lastOk = now();
      return { symbol, stored: true, depth: row.depth, prints: prints.length };
    } catch (error) {
      e.failures += 1; e.lastError = String(error.message || error).slice(0, 200);
      return { symbol, stored: false, reason: 'store_failed' };
    }
  }

  async function tick() {
    if (inFlight) return [];
    inFlight = true;
    const results = [];
    try {
      if (isMarketOpen(now())) { for (const symbol of list) results.push(await record(symbol)); }
      if (now() - lastPrune > pruneEveryMs) {
        lastPrune = now();
        try { pruned = await store.prune(retentionDays); if (pruned) logger('info', 'academy_depth_pruned', { rows: pruned, retentionDays }); }
        catch (error) { logger('warn', 'academy_depth_prune_failed', { error: String(error.message || error) }); }
      }
    } finally { inFlight = false; }
    return results;
  }

  function schedule() {
    if (!running) return;
    const delay = isMarketOpen(now()) ? pollMs : closedPollMs;
    timer = timers.setTimeout(() => { tick().catch((error) => logger('warn', 'academy_depth_tick_failed', { error: String(error.message || error) })).finally(schedule); }, delay);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function start() { if (running || !store || !store.configured) return false; running = true; logger('info', 'academy_depth_recorder_started', { symbols: list, levels, pollMs, retentionDays }); schedule(); return true; }
  function stop() { running = false; if (timer) timers.clearTimeout(timer); timer = null; }

  function status() {
    return {
      running, symbols: list, levels, pollMs, retentionDays, marketOpen: isMarketOpen(now()), lastPruned: pruned,
      perSymbol: Object.fromEntries([...state].map(([s, e]) => [s, { rows: e.rows, failures: e.failures, lastError: e.lastError, lastOk: e.lastOk, lastSkipped: e.lastSkipped }]))
    };
  }

  return { start, stop, tick, record, status, symbols: list };
}

module.exports = { createDepthRecorder, parseSymbols, cleanSide };
