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
  /* remember today's footprint, then return the summary with its plain-English read against earlier sessions */
  async function annotate(symbol, summary, { date, price = null } = {}) {
    await load();
    if (!summary || !summary.available) return summary;
    const fp = footprint(summary, { date, price });
    if (fp) remember(symbol, date, fp);
    const read = readDarkPool(summary, { history: history(symbol, date), price });
    void save();
    return { ...summary, read, vsYesterday: read ? read.vsYesterday : null };
  }
  return { load, save, remember, history, annotate, snapshot: () => state };
}

module.exports = { createDarkPoolMemory };
