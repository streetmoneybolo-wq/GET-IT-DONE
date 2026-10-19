'use strict';

/* The Article Desk's record: every piece the desk writes names a scenario target and an invalidation, so every piece can
 * be scored. An entry is opened when the piece is written (symbol, lean, the price at the time, the target, the stop, the
 * horizon the piece claimed) and settled from the daily bars that follow: HIT when the target traded before the stop,
 * STOPPED when the stop traded first, EXPIRED when the horizon passed with neither (scored by the close), and the piece's
 * best and worst excursion either way. record() turns the ledger into the numbers the page shows (only once ten pieces have
 * resolved, so a lucky first week never reads as a track record). Pure functions over plain objects; the desk owns the
 * state and the clock. */

const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r2 = (v) => Math.round(v * 100) / 100;
const DAY = 86_400_000;

/* the horizon a piece claimed, in trading days (the timeframe strings the story engine writes) */
function horizonDays(timeframe, earningsDaysAway = null) {
  const t = String(timeframe || '').toLowerCase();
  if (/through the print/.test(t)) return Math.max(3, Math.min(15, (num(earningsDaysAway, 5) || 5) + 2));
  if (/1 to 3 weeks/.test(t)) return 15;
  if (/1 to 2 weeks/.test(t)) return 10;
  if (/weeks?/.test(t)) return 10;
  if (/days/.test(t)) return 5;
  return 7;
}

function openEntry({ id, symbol, angle, lean, price, pt, stop, timeframe, earningsDaysAway = null, at, filed = false, letterId = null, url = '' }) {
  const p = num(price), target = num(pt), s = num(stop);
  if (!(p > 0) || !(target > 0)) return null;
  return { id: String(id), symbol: String(symbol).toUpperCase(), angle: String(angle || ''), lean: lean === 'bearish' ? 'bearish' : 'bullish', price: r2(p), pt: r2(target), stop: s > 0 ? r2(s) : null, horizonDays: horizonDays(timeframe, earningsDaysAway), at: Number(at), filed: !!filed, letterId: letterId || null, url: url || '',
    status: 'open', result: null, resolvedAt: null, returnPct: null, maxFavPct: 0, maxAdvPct: 0, days: 0 };
}

/* settle one open entry against the daily bars (newest last); bars at or before the entry's day are ignored */
function settleEntry(entry, bars, nowMs) {
  if (!entry || entry.status !== 'open') return entry;
  const up = entry.lean === 'bullish', dir = up ? 1 : -1;
  const after = (bars || []).filter((b) => b && num(b.t) > entry.at && num(b.h) != null && num(b.l) != null && num(b.c) != null).sort((a, b) => a.t - b.t);
  let fav = entry.maxFavPct || 0, adv = entry.maxAdvPct || 0, days = 0;
  for (const b of after) {
    days += 1;
    const best = up ? b.h : b.l, worst = up ? b.l : b.h;
    fav = Math.max(fav, dir * (best / entry.price - 1) * 100); adv = Math.max(adv, -dir * (worst / entry.price - 1) * 100);
    const hit = up ? b.h >= entry.pt : b.l <= entry.pt;
    const stopped = entry.stop != null && (up ? b.l <= entry.stop : b.h >= entry.stop);
    /* both inside one candle: the stop is taken as first, which is the honest reading of a bar that traded through both */
    if (stopped) return { ...entry, status: 'resolved', result: 'stopped', resolvedAt: b.t, returnPct: r2(dir * (entry.stop / entry.price - 1) * 100), maxFavPct: r2(fav), maxAdvPct: r2(adv), days };
    if (hit) return { ...entry, status: 'resolved', result: 'hit', resolvedAt: b.t, returnPct: r2(dir * (entry.pt / entry.price - 1) * 100), maxFavPct: r2(fav), maxAdvPct: r2(adv), days };
    if (days >= entry.horizonDays) return { ...entry, status: 'resolved', result: 'expired', resolvedAt: b.t, returnPct: r2(dir * (b.c / entry.price - 1) * 100), maxFavPct: r2(fav), maxAdvPct: r2(adv), days };
  }
  /* no bar has closed since the piece, or the horizon is still running: an entry older than 45 calendar days with no bars is abandoned */
  if (!after.length && nowMs - entry.at > 45 * DAY) return { ...entry, status: 'resolved', result: 'abandoned', resolvedAt: nowMs, returnPct: null, days };
  return { ...entry, maxFavPct: r2(fav), maxAdvPct: r2(adv), days };
}

/* the numbers: counts, hit rate, average return, by angle and by lean; `minResolved` gates what the page may claim */
function record(entries, { minResolved = 10 } = {}) {
  const all = (entries || []).filter(Boolean);
  const resolved = all.filter((e) => e.status === 'resolved' && e.result !== 'abandoned');
  const count = (list, r) => list.filter((e) => e.result === r).length;
  const avg = (list) => { const v = list.map((e) => num(e.returnPct)).filter((x) => x != null); return v.length ? r2(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const slice = (list) => ({ total: list.length, hit: count(list, 'hit'), stopped: count(list, 'stopped'), expired: count(list, 'expired'), hitRate: list.length ? Math.round(count(list, 'hit') / list.length * 100) : null, avgReturnPct: avg(list) });
  const byAngle = {}, byLean = {};
  for (const e of resolved) { (byAngle[e.angle] = byAngle[e.angle] || []).push(e); (byLean[e.lean] = byLean[e.lean] || []).push(e); }
  return { ...slice(resolved), total: all.length, open: all.filter((e) => e.status === 'open').length, resolved: resolved.length, showable: resolved.length >= minResolved,
    byAngle: Object.fromEntries(Object.entries(byAngle).map(([k, v]) => [k, slice(v)])), byLean: Object.fromEntries(Object.entries(byLean).map(([k, v]) => [k, slice(v)])),
    recent: all.slice(-12).reverse().map((e) => ({ symbol: e.symbol, angle: e.angle, lean: e.lean, pt: e.pt, status: e.status, result: e.result, returnPct: e.returnPct, at: e.at, url: e.url })) };
}

/* one honest sentence for the piece, or '' until the record is showable */
function recordLine(rec) {
  if (!rec || !rec.showable) return '';
  return `Desk record: ${rec.hit} of ${rec.resolved} scenario targets traded before their invalidation (${rec.hitRate}%), ${rec.stopped} stopped out, ${rec.expired} ran out of time, average outcome ${rec.avgReturnPct >= 0 ? '+' : ''}${rec.avgReturnPct}% per piece. Past pieces say nothing about this one.`;
}

module.exports = { horizonDays, openEntry, settleEntry, record, recordLine };
