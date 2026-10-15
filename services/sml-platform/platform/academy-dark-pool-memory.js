'use strict';

/* Memory of each symbol's off-exchange footprint per session, so the dark pool read can say "yesterday's biggest print
 * was X". One entry per symbol per ET date, the largest print and the block volume seen so far that day (the trade record
 * is capped, so later reads can only add), ten sessions kept per symbol, persisted through a state store with a short
 * write debounce. annotate() is the one call sites use: it remembers today and returns the summary with its read. */

const { readDarkPool, footprint } = require('./academy-dark-pool-read');

const KEEP = 10, SYMBOL_CAP = 600;

function createDarkPoolMemory({ store = null, logger = () => {}, now = Date.now, saveEveryMs = 60_000 } = {}) {
  let state = { symbols: {} }, loaded = false, dirty = false, lastSave = 0, saving = null;
  async function load() {
    if (loaded) return;
    loaded = true;
    if (!store) return;
    try { const s = await store.read(); if (s && s.symbols && typeof s.symbols === 'object') state = s; } catch (error) { logger('warn', 'dark_pool_memory_read_failed', { error: String(error && error.message || error) }); }
  }
  async function save(force = false) {
    if (!store || !dirty || saving) return;
    if (!force && now() - lastSave < saveEveryMs) return;
    saving = (async () => { try { await store.write(state); dirty = false; lastSave = now(); } catch (error) { logger('warn', 'dark_pool_memory_write_failed', { error: String(error && error.message || error) }); } finally { saving = null; } })();
    await saving;
  }
  function merge(prev, next) {
    if (!prev) return next;
    const out = { ...prev, ...next };
    if (prev.largest && (!next.largest || prev.largest.notional > next.largest.notional)) out.largest = prev.largest;
    out.blockVolume = Math.max(prev.blockVolume || 0, next.blockVolume || 0);
    out.blockCount = Math.max(prev.blockCount || 0, next.blockCount || 0);
    out.blockNotional = Math.max(prev.blockNotional || 0, next.blockNotional || 0);
    out.offVolume = Math.max(prev.offVolume || 0, next.offVolume || 0);
    return out;
  }
  function remember(symbol, date, fp) {
    if (!fp || !symbol || !date) return;
    const list = state.symbols[symbol] || [];
    const i = list.findIndex((h) => h.date === date);
    if (i >= 0) list[i] = merge(list[i], fp); else { list.push(fp); list.sort((a, b) => a.date.localeCompare(b.date)); }
    state.symbols[symbol] = list.slice(-KEEP);
    const keys = Object.keys(state.symbols);
    if (keys.length > SYMBOL_CAP) for (const k of keys.slice(0, keys.length - SYMBOL_CAP)) delete state.symbols[k];
    dirty = true;
  }
  const history = (symbol, beforeDate) => (state.symbols[symbol] || []).filter((h) => !beforeDate || h.date < beforeDate);
  /* Prints before sinceMs (4:00 AM ET: yesterday's after-hours reports sit in the same capped trade record during the
     pre-market) are left out of today's blocks and largest prints, so "today's biggest" is today's. */
  function sessionView(summary, sinceMs) {
    if (!Number.isFinite(sinceMs) || !summary) return summary;
    const keep = (b) => !Number.isFinite(b.t) || b.t >= sinceMs;
    const list = ((summary.blocks && summary.blocks.list) || []).filter(keep);
    const largest = (summary.largest || []).filter(keep);
    const dropped = ((summary.blocks && summary.blocks.list) || []).filter((b) => !keep(b)).concat((summary.largest || []).filter((b) => !keep(b) && !((summary.blocks && summary.blocks.list) || []).some((x) => x.t === b.t && x.size === b.size)));
    if (!dropped.length) return summary;
    dropped.sort((a, b) => (b.notional || 0) - (a.notional || 0));
    const volume = list.reduce((n, b) => n + (b.size || 0), 0);
    const afterHours = { count: dropped.length, volume: dropped.reduce((n, b) => n + (b.size || 0), 0), notional: dropped.reduce((n, b) => n + (b.notional || 0), 0), largest: dropped.slice(0, 3), note: "Reported after yesterday's close, before 4:00 AM ET: counted as yesterday's session. Large end-of-day crosses on an ETF are usually benchmark (closing-price) trades, not a bet on direction." };
    return { ...summary, largest, afterHours, blocks: { ...(summary.blocks || {}), list, count: list.length, volume, sharePct: summary.offVolume > 0 ? Math.round(volume / summary.offVolume * 1000) / 10 : null, note: "Prints reported before 4:00 AM ET today (yesterday's after-hours) are left out of today's blocks." } };
  }
  /* the previous weekday as YYYY-MM-DD (after-hours prints seen in the pre-market belong to it) */
  function prevTradingDate(date) {
    const t = Date.parse(String(date) + 'T12:00:00Z'); if (!Number.isFinite(t)) return null;
    let d = new Date(t - 86_400_000); while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() - 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  /* remember today's footprint, then return the summary with its plain-English read against earlier sessions */
  async function annotate(symbol, summary, { date, price = null, sinceMs = null } = {}) {
    await load();
    if (!summary || !summary.available) return summary;
    const view = sessionView(summary, sinceMs);
    const fp = footprint(view, { date, price });
    if (fp) remember(symbol, date, fp);
    if (view.afterHours && view.afterHours.largest[0]) { const y = prevTradingDate(date); const b = view.afterHours.largest[0]; if (y) remember(symbol, y, { date: y, offSharePct: null, offVolume: null, blockCount: view.afterHours.count, blockVolume: view.afterHours.volume, blockNotional: view.afterHours.notional, largest: { price: b.price, size: b.size, notional: b.notional, dir: b.dir }, lean: null, price: null, full: null, afterHours: true }); }
    const read = readDarkPool(view, { history: history(symbol, date), price });
    void save();
    return { ...view, read, vsYesterday: read ? read.vsYesterday : null };
  }
  return { load, save, remember, history, annotate, prevTradingDate, snapshot: () => state };
}

module.exports = { createDarkPoolMemory };
