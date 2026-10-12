'use strict';

/* Session-wide dark-pool read from the Massive trade record (REST /v3/trades), as opposed to the live tape, which only
 * knows the prints that arrived since this server started watching the symbol. Rows are [t, price, size, off]
 * (market-data-service.trades). Direction is the tick rule against the previous print, since the trade record carries
 * no quote. The record is capped at the most recent 50,000 prints, so a liquid stock covers its last stretch of the
 * session and a quieter one the whole day; `window` says which, plainly.
 *
 * Output extends darkPoolSummary with: window { from, to, minutes, prints, full }, blocks (off-exchange prints of at
 * least BLOCK_SHARES shares or BLOCK_NOTIONAL dollars, largest first, with the running total), byHour (off-exchange
 * share per clock hour) and the top off-exchange price levels over the whole window. */

const { darkPoolSummary } = require('./academy-dark-pool-summary');

const BLOCK_SHARES = 10_000, BLOCK_NOTIONAL = 1_000_000;
const fin = Number.isFinite;
const r2 = (v) => Math.round(v * 100) / 100;
const hourKey = (t) => { const d = new Date(t); return d.toLocaleTimeString('en-US', { hour: '2-digit', hour12: false, timeZone: 'America/New_York' }).slice(0, 2); };

function sessionDarkPool(rows, { price = null, now = Date.now(), sessionOpenMs = null } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => Array.isArray(r) && fin(r[0]) && r[1] > 0 && r[2] >= 0);
  if (!list.length) return { available: false, reason: 'no_prints' };
  const stats = { since: list[0][0], count: 0, vol: 0, offVol: 0, offN: 0, buy: 0, sell: 0, offBuy: 0, offSell: 0, offTape: [], vwap: null };
  const blocks = [], byHour = new Map();
  let lastPrice = 0, lastDir = 'N', notional = 0;
  for (const [t, p, size, off] of list) {
    const dir = lastPrice > 0 ? (p > lastPrice ? 'B' : p < lastPrice ? 'S' : lastDir) : 'N';
    lastPrice = p; lastDir = dir;
    stats.count += 1; stats.vol += size; notional += size * p;
    if (dir === 'B') stats.buy += size; else if (dir === 'S') stats.sell += size;
    const h = hourKey(t), hb = byHour.get(h) || { hour: h, vol: 0, off: 0 }; hb.vol += size; byHour.set(h, hb);
    if (off) {
      stats.offVol += size; stats.offN += 1; hb.off += size;
      if (dir === 'B') stats.offBuy += size; else if (dir === 'S') stats.offSell += size;
      stats.offTape.push({ t, price: p, size, dir });
      if (size >= BLOCK_SHARES || size * p >= BLOCK_NOTIONAL) blocks.push({ t, price: r2(p), size: Math.round(size), notional: Math.round(size * p), dir });
    }
  }
  stats.vwap = stats.vol > 0 ? notional / stats.vol : null;
  const base = darkPoolSummary(stats, { price: fin(price) && price > 0 ? price : stats.vwap, minPrints: 20 });
  const from = list[0][0], to = list[list.length - 1][0], minutes = Math.max(1, Math.round((to - from) / 60_000));
  const full = sessionOpenMs != null ? from <= sessionOpenMs + 60_000 : null;
  blocks.sort((a, b) => b.notional - a.notional);
  const blockVol = blocks.reduce((n, b) => n + b.size, 0);
  return {
    ...base,
    source: 'trade-record',
    window: { from, to, minutes, prints: list.length, full, label: full ? 'the whole session so far' : 'the last ' + minutes + ' minute' + (minutes === 1 ? '' : 's') + ' of prints (' + list.length.toLocaleString('en-US') + ' trades)' },
    levelsNote: base.available ? 'Levels and largest prints cover every off-exchange print in this window.' : undefined,
    blocks: { count: blocks.length, volume: blockVol, sharePct: stats.offVol > 0 ? Math.round(blockVol / stats.offVol * 1000) / 10 : null, list: blocks.slice(0, 8), rule: BLOCK_SHARES.toLocaleString('en-US') + '+ shares or $' + (BLOCK_NOTIONAL / 1e6) + 'M+' },
    byHour: [...byHour.values()].sort((a, b) => a.hour.localeCompare(b.hour)).map((h) => ({ hour: h.hour + ':00 ET', volume: Math.round(h.vol), offSharePct: h.vol > 0 ? Math.round(h.off / h.vol * 1000) / 10 : null })),
    asOf: now
  };
}

module.exports = { sessionDarkPool, BLOCK_SHARES, BLOCK_NOTIONAL };
