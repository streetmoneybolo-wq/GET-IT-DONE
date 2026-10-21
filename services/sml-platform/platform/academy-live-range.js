'use strict';

/* LIVE RANGE: the high and low a stock has traded since a moment, read from the live trade feed instead of delayed candles.
 *
 * The alert watcher (academy-auto-pt.js) asked "has the target traded since the alert?" of five-minute candles from the REST feed, every five
 * minutes: a hit could be recorded a quarter of an hour or more after the print that made it (the AHT alert's was 17 minutes). This keeps the
 * extremes of every trade the stream sees for the stocks being watched, in one-minute buckets, and answers range(symbol, since) at once.
 *
 *   - One stray print must not call a target hit: the extreme of a bucket is its SECOND highest (or lowest) trade price, so a price counts
 *     only when two prints traded at or beyond it in the same minute. A thin stock still trades twice in a minute when it really moves.
 *   - A crossing (the confirmed extreme passes a watched target) calls onCross(symbol) so the watcher checks at once instead of waiting for
 *     its next five-minute turn; the watcher still decides, using the same range.
 *   - Bounded: at most 40 stocks, buckets older than six days dropped, a stock not asked about for a day forgotten. The stream's own cap
 *     is 60 stocks and a tracked stock holds a listener, so it is never evicted to make room for a viewer.
 * Pure of fetching: it only listens to the stream it is given. Educational software; nothing here trades. */

const BUCKET_MS = 60_000, KEEP_MS = 6 * 86_400_000, MAX_SYMBOLS = 40;

function createLiveRange({ stream = null, now = Date.now, onCross = null, logger = () => {} } = {}) {
  const tracked = new Map(); // symbol -> { buckets: Map(minute -> { h1, h2, l1, l2 }), off: fn, watches: Map(key -> { side, target, since }), lastAsked: ms, crossAt: ms }

  function addPrice(b, price) {
    if (!(b.h1 > price)) { b.h2 = b.h1; b.h1 = price; } else if (!(b.h2 > price)) b.h2 = price;
    if (!(b.l1 < price)) { b.l2 = b.l1; b.l1 = price; } else if (!(b.l2 < price)) b.l2 = price;
  }
  const fresh = () => ({ h1: -Infinity, h2: -Infinity, l1: Infinity, l2: Infinity });

  function record(sym, t, price) {
    const e = tracked.get(sym); if (!e || !(price > 0) || !Number.isFinite(t)) return;
    const key = Math.floor(t / BUCKET_MS);
    let b = e.buckets.get(key); if (!b) { b = fresh(); e.buckets.set(key, b); }
    addPrice(b, price);
    if (typeof onCross === 'function' && e.watches.size && now() - e.crossAt > 15_000) {
      for (const w of e.watches.values()) {
        if (t < w.since) continue;
        const crossed = w.side === 'short' ? b.l2 <= w.target : b.h2 >= w.target;
        if (crossed) { e.crossAt = now(); try { onCross(sym); } catch (error) { logger('warn', 'live_range_cross_failed', { symbol: sym, error: String(error && error.message || error) }); } break; }
      }
    }
  }

  /* start listening for a symbol (and read back what the stream already holds from `since`); `watch` registers a target to call onCross for */
  function track(symbolRaw, since, watch = null) {
    const sym = String(symbolRaw || '').toUpperCase();
    if (!stream || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) return false;
    let e = tracked.get(sym);
    if (!e) {
      if (tracked.size >= MAX_SYMBOLS) return false;
      e = { buckets: new Map(), off: null, watches: new Map(), lastAsked: now(), crossAt: 0 };
      tracked.set(sym, e);
      e.off = stream.on(sym, (evt) => { if (evt && evt.type === 'trade' && evt.trade) record(sym, Number(evt.trade.t), Number(evt.trade.price)); });
      try { for (const tk of stream.ticks(sym)) if (Array.isArray(tk) && tk[0] >= now() - KEEP_MS) record(sym, Number(tk[0]), Number(tk[1])); } catch (_) { /* the live trades fill it in */ }
    }
    if (watch && Number(watch.target) > 0) e.watches.set(String(watch.key || 'w'), { side: watch.side === 'short' ? 'short' : 'long', target: Number(watch.target), since: Number(since) || 0 });
    return true;
  }
  /* forget a watched target (the alert was updated or finished) */
  function unwatch(symbolRaw, key) { const e = tracked.get(String(symbolRaw || '').toUpperCase()); if (e) e.watches.delete(String(key)); }

  /* the confirmed high and low since `sinceMs`, or null when no trades were seen in that span */
  function range(symbolRaw, sinceMs) {
    const e = tracked.get(String(symbolRaw || '').toUpperCase()); if (!e) return null;
    e.lastAsked = now();
    const from = Math.floor(Number(sinceMs) / BUCKET_MS) + 1; // a bucket that began before `since` is skipped: a trade before the alert never counts
    let high = -Infinity, low = Infinity, buckets = 0;
    for (const [k, b] of e.buckets) {
      if (k < from) continue;
      if (b.h2 > -Infinity) high = Math.max(high, b.h2); if (b.l2 < Infinity) low = Math.min(low, b.l2);
      buckets++;
    }
    return buckets && Number.isFinite(high) && Number.isFinite(low) ? { high, low, buckets, source: 'live trades' } : null;
  }

  /* drop old buckets, and stocks nobody asked about for a day (their listener too) */
  function prune() {
    const t = now(), minKey = Math.floor((t - KEEP_MS) / BUCKET_MS);
    for (const [sym, e] of tracked) {
      for (const k of e.buckets.keys()) if (k < minKey) e.buckets.delete(k);
      if (t - e.lastAsked > 86_400_000) { try { if (e.off) e.off(); } catch (_) { /* gone */ } tracked.delete(sym); }
    }
  }
  const status = () => ({ symbols: tracked.size, buckets: [...tracked.values()].reduce((a, e) => a + e.buckets.size, 0) });
  /* who is being tracked and how many trades' worth of minutes each holds, for the log */
  const summary = () => [...tracked.entries()].map(([symbol, e]) => ({ symbol, minutes: e.buckets.size, watches: e.watches.size })).sort((a, b) => b.minutes - a.minutes);
  return { track, unwatch, range, prune, status, summary, _record: record };
}

/* the two ranges together: the candles' (which see the whole bar) and the live trades' (which see it first) */
function mergeRanges(a, b) {
  const ok = (r) => r && Number.isFinite(Number(r.high)) && Number.isFinite(Number(r.low));
  if (!ok(a) && !ok(b)) return null;
  if (!ok(a)) return { high: Number(b.high), low: Number(b.low) };
  if (!ok(b)) return { high: Number(a.high), low: Number(a.low) };
  return { high: Math.max(Number(a.high), Number(b.high)), low: Math.min(Number(a.low), Number(b.low)) };
}

module.exports = { createLiveRange, mergeRanges, BUCKET_MS };
