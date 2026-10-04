'use strict';

/* Tick bars: a new candle every N trades instead of every N minutes. Built from the trades the Academy's Massive stream saw
 * (plus recent history when the plan allows it), so a symbol's tick chart only reaches back as far as that trade record. */

const TICK_SIZES = Object.freeze([10, 25, 50, 100, 250, 500, 1000]);

/* '100T' -> 100 when it is one of the offered sizes, else 0 */
function parseTick(tf) {
  const m = /^([0-9]{1,4})T$/.exec(String(tf || ''));
  const n = m ? Number(m[1]) : 0;
  return TICK_SIZES.includes(n) ? n : 0;
}

/* trades: [[t, price, size], ...] in any order. Returns bars { t, o, h, l, c, v, n } where n is the trades in the bar.
   The last bar may hold fewer than `size` trades: it is the one still forming. Bar times strictly increase. */
function buildTickBars(trades, size) {
  const n = TICK_SIZES.includes(size) ? size : 0;
  if (!n || !Array.isArray(trades)) return [];
  const clean = trades.filter((r) => Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > 0)
    .sort((a, b) => a[0] - b[0]);
  const bars = [];
  let cur = null, prevT = -Infinity;
  for (const [t, price, sz] of clean) {
    if (!cur) {
      const bt = t > prevT ? t : prevT + 1;
      cur = { t: bt, o: price, h: price, l: price, c: price, v: 0, n: 0 };
      prevT = bt;
    }
    cur.h = Math.max(cur.h, price); cur.l = Math.min(cur.l, price); cur.c = price;
    cur.v += Number(sz) > 0 ? Number(sz) : 0; cur.n += 1;
    if (cur.n >= n) { bars.push(cur); cur = null; }
  }
  if (cur) bars.push(cur);
  return bars;
}

/* Joins two trade lists (history first, live second) without counting the same print twice. */
function mergeTrades(a, b) {
  const seen = new Set(), out = [];
  for (const r of [...(a || []), ...(b || [])]) {
    const key = r[0] + ':' + r[1] + ':' + r[2];
    if (seen.has(key)) continue;
    seen.add(key); out.push(r);
  }
  return out;
}

module.exports = { TICK_SIZES, parseTick, buildTickBars, mergeTrades };
