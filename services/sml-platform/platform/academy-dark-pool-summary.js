'use strict';

/* Dark-pool summary from the live tape. "Dark pool" here means off-exchange prints (reported through a trade reporting facility or the OTC exchange code),
 * which covers dark pools, broker internalizers and wholesalers together. It is real print data, but it is NOT a feed of institutional orders: a high share
 * is normal for liquid stocks. The tool therefore reports the share against a typical baseline, the biggest prints, where off-exchange volume clusters by
 * price, and how those prints leaned against the quote, and it labels all of that plainly. */
const fin = Number.isFinite;
const r2 = (v) => Math.round(v * 100) / 100;

const TYPICAL_OFF_SHARE = 0.4; // US equities typically execute roughly 35-45% off-exchange; used only as a reference line

function levelStep(price) { return price >= 200 ? 1 : price >= 100 ? 0.5 : price >= 20 ? 0.25 : price >= 5 ? 0.1 : 0.05; }

function darkPoolSummary(stats, { price = null, minPrints = 10 } = {}) {
  if (!stats || !stats.count) return { available: false, reason: 'no_prints' };
  const off = Array.isArray(stats.offTape) ? stats.offTape : [];
  if (stats.count < minPrints) return { available: false, reason: 'too_few_prints', prints: stats.count };
  const offVol = Number(stats.offVol) || 0, vol = Number(stats.vol) || 0;
  const share = vol > 0 ? offVol / vol : null;
  const ref = fin(price) && price > 0 ? price : (stats.vwap || off[0]?.price || 0);
  const step = levelStep(ref || 50);
  const buckets = new Map();
  for (const p of off) { const k = (Math.round(p.price / step) * step).toFixed(step < 0.1 ? 2 : 2); const b = buckets.get(k) || { price: Number(k), vol: 0, n: 0, buy: 0, sell: 0 }; b.vol += p.size; b.n += 1; if (p.dir === 'B') b.buy += p.size; else if (p.dir === 'S') b.sell += p.size; buckets.set(k, b); }
  const levels = [...buckets.values()].sort((a, b) => b.vol - a.vol).slice(0, 4).map((b) => ({ price: r2(b.price), volume: Math.round(b.vol), prints: b.n, lean: b.buy > b.sell * 1.3 ? 'buy' : b.sell > b.buy * 1.3 ? 'sell' : 'mixed' }));
  const largest = off.slice().sort((a, b) => b.size * b.price - a.size * a.price).slice(0, 5).map((p) => ({ t: p.t, price: r2(p.price), size: Math.round(p.size), notional: Math.round(p.size * p.price), dir: p.dir }));
  let offBuy = 0, offSell = 0; for (const p of off) { if (p.dir === 'B') offBuy += p.size; else if (p.dir === 'S') offSell += p.size; }
  const tagged = offBuy + offSell;
  const lean = tagged > 0 ? (offBuy - offSell) / tagged : null;
  const litBuy = Number(stats.buy) - offBuy, litSell = Number(stats.sell) - offSell;
  const litTagged = litBuy + litSell;
  const litLean = litTagged > 0 ? (litBuy - litSell) / litTagged : null;
  let note;
  if (share == null) note = 'Not enough volume yet.';
  else if (share >= 0.6) note = 'More than half of the volume printed off-exchange, which is high even for liquid stocks. Heavy off-exchange share can mean institutions working size, but it also happens when retail flow is internalized.';
  else if (share <= 0.25) note = 'Unusually little volume printed off-exchange, so most trading is visible on lit exchanges.';
  else note = 'Off-exchange share is in the normal range.';
  return {
    available: true, prints: stats.count, offPrints: Number(stats.offN) || 0, since: stats.since,
    offVolume: Math.round(offVol), offSharePct: share == null ? null : Math.round(share * 1000) / 10, typicalSharePct: TYPICAL_OFF_SHARE * 100,
    levels, largest,
    lean: lean == null ? null : { offExchange: Math.round(lean * 100) / 100, lit: litLean == null ? null : Math.round(litLean * 100) / 100, label: lean > 0.25 ? 'off-exchange prints lean to the buy side' : lean < -0.25 ? 'off-exchange prints lean to the sell side' : 'off-exchange prints are balanced', rule: 'quote rule where a quote was current, otherwise tick rule' },
    note, caveat: 'Off-exchange prints include dark pools, broker internalizers and wholesalers. This is not a feed of institutional orders and it does not say who is buying or selling.'
  };
}

module.exports = { darkPoolSummary, TYPICAL_OFF_SHARE };
