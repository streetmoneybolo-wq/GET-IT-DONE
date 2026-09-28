'use strict';

/* Live S.I.R.E. feed for the Academy: the scanner's momentum rows, kept
 * moving between scanner refreshes by real-time trades from the shared
 * Massive connection, pushed to every open SIRE panel over Server-Sent Events.
 *
 * Every refresh (4 s) takes the scanner rows as the baseline: price, day %,
 * 1-minute % and 3-minute %. Each of those rates implies the price the symbol
 * had at the start of its window, so a live trade moves the rate the same way
 * the scanner would have: rate = (trade − start) / start. The strongest movers
 * (largest 3-minute swing) are the ones watched on Massive, a modest number
 * so chart viewers keep their symbol slots.
 *
 * Viewers get one `snapshot` (all rows) then `tick` events carrying only the
 * symbols whose displayed values changed, at most four times a second, so a
 * cell flashes exactly when its value moves. Gated viewers only see the free
 * symbols. Nothing runs while nobody is watching. */

const DEFAULT_TOP = 30;
const TICK_MS = 250;
const REFRESH_MS = 4_000;
const MAX_ROWS = 100;

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function round(v, digits) { return v == null ? null : Number(v.toFixed(digits)); }
function baseFrom(price, pct) { return price != null && pct != null && pct > -100 ? price / (1 + pct / 100) : null; }

function createSireFeed({ scanner, massive = null, now = Date.now, timers = { setInterval, clearInterval }, logger = () => {}, top = DEFAULT_TOP, tickMs = TICK_MS, refreshMs = REFRESH_MS } = {}) {
  if (typeof scanner !== 'function') throw new TypeError('scanner is required');
  const rows = new Map();     // SYM -> { s, n, p, c, r1, r3, rv, v, pc, b1, b3, t }
  const sent = new Map();     // SYM -> last compact row written to viewers
  const dirty = new Set();
  const watched = new Map();  // SYM -> unsubscribe from Massive
  const viewers = new Set();  // { write, filter }
  let refreshTimer = null, tickTimer = null, refreshing = false, asOf = 0, lastError = null, order = [];

  const compact = (r) => ({ s: r.s, n: r.n, p: round(r.p, 4), c: round(r.c, 3), r1: round(r.r1, 3), r3: round(r.r3, 3), rv: round(r.rv, 2), v: r.v, t: r.t });

  function applyScanner(list) {
    const seen = new Set();
    order = [];
    for (const src of (Array.isArray(list) ? list : []).slice(0, MAX_ROWS)) {
      const s = String(src && src.symbol || '').toUpperCase();
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)) continue;
      seen.add(s); order.push(s);
      const price = num(src.price), c = num(src.changePct), r1 = num(src.changeRate1min), r3 = num(src.changeRate3min);
      const pc = num(src.previousClose) > 0 ? num(src.previousClose) : baseFrom(price, c);
      const r = rows.get(s) || { s };
      /* A live trade newer than this scanner sample keeps its price; the baselines still move to the new window. */
      const keepLive = r.live && r.t > asOf && price != null && Math.abs(r.p - price) / price < 0.05;
      Object.assign(r, { n: String(src.name || '').slice(0, 60), rv: num(src.rvol) != null ? num(src.rvol) : num(src.volumeRatio), v: num(src.volume), pc, b1: baseFrom(price, r1), b3: baseFrom(price, r3) });
      if (!keepLive) { r.p = price; r.c = c; r.r1 = r1; r.r3 = r3; r.t = asOf; r.live = false; }
      else recompute(r);
      rows.set(s, r);
      dirty.add(s);
    }
    for (const s of rows.keys()) if (!seen.has(s)) { rows.delete(s); sent.delete(s); dirty.add(s); }
  }

  function recompute(r) {
    if (r.p == null) return;
    if (r.pc > 0) r.c = (r.p - r.pc) / r.pc * 100;
    if (r.b1 > 0) r.r1 = (r.p - r.b1) / r.b1 * 100;
    if (r.b3 > 0) r.r3 = (r.p - r.b3) / r.b3 * 100;
  }

  function onTrade(s, trade) {
    const r = rows.get(s); if (!r || !(trade && trade.price > 0)) return;
    r.p = trade.price; r.t = num(trade.t) || now(); r.live = true;
    recompute(r);
    dirty.add(s);
  }

  /* Watch the strongest movers on Massive; drop the ones that fell out of the top set. */
  function rewatch() {
    if (!massive || !massive.status || !massive.status().enabled) return;
    const want = [...rows.values()].filter((r) => r.p != null)
      .sort((a, b) => Math.abs(b.r3 || 0) - Math.abs(a.r3 || 0) || order.indexOf(a.s) - order.indexOf(b.s))
      .slice(0, top).map((r) => r.s);
    const wanted = new Set(want);
    for (const [s, off] of watched) if (!wanted.has(s)) { off(); watched.delete(s); }
    for (const s of want) if (!watched.has(s)) {
      const off = massive.on(s, (evt) => { if (evt && evt.type === 'trade') onTrade(s, evt.trade); });
      watched.set(s, off);
    }
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const payload = await scanner();
      asOf = num(payload && payload.asOf) || now();
      applyScanner(payload && payload.rows);
      lastError = null;
      rewatch();
    } catch (error) {
      lastError = String(error && error.message || error);
      logger('warn', 'sire_feed_refresh_failed', { error });
    } finally { refreshing = false; }
    flush();
  }

  function flush() {
    if (!dirty.size || !viewers.size) { dirty.clear(); return; }
    const changes = [];
    for (const s of dirty) {
      const r = rows.get(s);
      if (!r) { changes.push({ s, gone: true }); continue; }
      const next = compact(r), prev = sent.get(s);
      if (!prev) { changes.push(next); sent.set(s, next); continue; }
      const delta = { s };
      let changed = false;
      for (const k of ['p', 'c', 'r1', 'r3', 'rv', 'v', 'n']) if (next[k] !== prev[k]) { delta[k] = next[k]; changed = true; }
      if (changed) { delta.t = next.t; changes.push(delta); sent.set(s, next); }
    }
    dirty.clear();
    if (!changes.length) return;
    for (const viewer of viewers) {
      const mine = viewer.filter ? changes.filter((c) => viewer.filter(c.s)) : changes;
      if (mine.length) viewer.write('tick', { at: now(), rows: mine });
    }
  }

  function snapshot(filter) {
    const list = order.map((s) => rows.get(s)).filter(Boolean).map(compact).filter((r) => !filter || filter(r.s));
    return { rows: list, asOf, live: watched.size > 0, error: lastError };
  }

  function start() {
    if (refreshTimer) return;
    refreshTimer = timers.setInterval(() => { void refresh(); }, refreshMs); if (refreshTimer && refreshTimer.unref) refreshTimer.unref();
    tickTimer = timers.setInterval(flush, tickMs); if (tickTimer && tickTimer.unref) tickTimer.unref();
    void refresh();
  }
  function stop() {
    if (refreshTimer) timers.clearInterval(refreshTimer); refreshTimer = null;
    if (tickTimer) timers.clearInterval(tickTimer); tickTimer = null;
    for (const off of watched.values()) off();
    watched.clear(); sent.clear(); dirty.clear();
  }

  /** Streams to one viewer: `write(event, data)` gets a snapshot now and ticks as values move. Returns the unsubscribe. */
  function subscribe(write, { filter = null } = {}) {
    const viewer = { write, filter: typeof filter === 'function' ? filter : null };
    viewers.add(viewer);
    start();
    /* Everything the viewer will get later is diffed against what it has seen; the snapshot is that baseline. */
    for (const r of rows.values()) if (!sent.has(r.s)) sent.set(r.s, compact(r));
    write('snapshot', snapshot(viewer.filter));
    return () => { viewers.delete(viewer); if (!viewers.size) stop(); };
  }

  const status = () => ({ viewers: viewers.size, rows: rows.size, watched: watched.size, running: Boolean(refreshTimer), asOf, error: lastError });
  return { subscribe, snapshot, refresh, flush, status, stop };
}

module.exports = { createSireFeed };
