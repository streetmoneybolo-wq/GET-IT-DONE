'use strict';

/* SML VIX: a VIX-style 30-day volatility index computed the way CBOE computes the VIX, from SPY options instead of
 * S&P 500 index options (the official index feed is not on the current data plan; SPY options price the same market).
 *
 * Method (CBOE VIX white paper): pick the two expirations that bracket 30 days; for each, find the forward price from
 * the strike where call and put prices are closest, take every out-of-the-money option (puts below, calls above, both
 * averaged at the at-the-money strike) out to two zero-bid strikes in a row, sum their strike-weighted mid prices into
 * a variance, then blend the two variances to exactly 30 days and annualise: index = 100 x sqrt(variance).
 * Quotes come from moomoo OpenD through the site bridge, so the index is live while that bridge is up. Educational only. */

const MIN_YEAR = 525_600, MIN_30 = 43_200;
const fin = Number.isFinite;
const num = (v) => { const x = Number(v); return fin(x) ? x : null; };

/* minutes from `nowMs` to 4:00 pm New York on `dateStr` (SPY options settle at the close) */
function minutesToExpiry(dateStr, nowMs) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return null;
  const probe = Date.UTC(y, m - 1, d, 16, 0);
  const etHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(new Date(probe))) % 24;
  const expiry = Date.UTC(y, m - 1, d, 16 + (16 - etHour), 0);
  return (expiry - nowMs) / 60_000;
}

/* the chain arrives as { contracts: [{type, strike, bid, ask}] } (site route) or { rows: [{k, c:{bid,ask}, p:{bid,ask}}] } (bridge) */
function strikesFrom(data) {
  const d = data && data.data && (data.data.contracts || data.data.rows) ? data.data : data;
  const map = new Map();
  const put = (k, side, q) => { if (!fin(k)) return; const row = map.get(k) || { k, call: null, put: null }; row[side] = q; map.set(k, row); };
  const quote = (o) => ({ bid: num(o && o.bid), ask: num(o && o.ask) });
  for (const c of (d && d.contracts) || []) { const t = String(c.type || c.contract_type || '').toLowerCase(); put(num(c.strike), t.startsWith('c') ? 'call' : 'put', quote(c)); }
  for (const r of (d && d.rows) || []) { if (r.c) put(num(r.k), 'call', quote(r.c)); if (r.p) put(num(r.k), 'put', quote(r.p)); }
  return [...map.values()].sort((a, b) => a.k - b.k);
}
const mid = (q) => (q && fin(q.bid) && fin(q.ask) && q.bid > 0 && q.ask >= q.bid ? (q.bid + q.ask) / 2 : null);

/* one expiration's variance (CBOE equation 1) */
function termVariance(strikes, minutes, rate = 0.043) {
  if (!(minutes > 0) || strikes.length < 6) return null;
  const T = minutes / MIN_YEAR, growth = Math.exp(rate * T);
  let best = null;
  for (const s of strikes) { const c = mid(s.call), p = mid(s.put); if (c === null || p === null) continue; const diff = Math.abs(c - p); if (!best || diff < best.diff) best = { k: s.k, c, p, diff }; }
  if (!best) return null;
  const F = best.k + growth * (best.c - best.p);
  const below = strikes.filter((s) => s.k <= F);
  if (!below.length) return null;
  const K0 = below[below.length - 1].k;
  const used = [];
  const i0 = strikes.findIndex((s) => s.k === K0);
  const atm = [mid(strikes[i0].call), mid(strikes[i0].put)].filter((x) => x !== null);
  if (!atm.length) return null;
  used.push({ k: K0, q: atm.reduce((a, b) => a + b, 0) / atm.length });
  for (const [dir, side] of [[-1, 'put'], [1, 'call']]) {
    let zeros = 0;
    for (let i = i0 + dir; i >= 0 && i < strikes.length; i += dir) {
      const q = strikes[i][side];
      if (!q || !(q.bid > 0)) { zeros += 1; if (zeros >= 2) break; continue; }
      zeros = 0;
      const m = mid(q); if (m !== null) used.push({ k: strikes[i].k, q: m });
    }
  }
  used.sort((a, b) => a.k - b.k);
  if (used.length < 5) return null;
  let sum = 0;
  for (let i = 0; i < used.length; i++) {
    const dK = i === 0 ? used[1].k - used[0].k : i === used.length - 1 ? used[i].k - used[i - 1].k : (used[i + 1].k - used[i - 1].k) / 2;
    sum += (dK / (used[i].k * used[i].k)) * growth * used[i].q;
  }
  const variance = (2 / T) * sum - (1 / T) * Math.pow(F / K0 - 1, 2);
  return variance > 0 ? { variance, T, minutes, F, K0, strikes: used.length } : null;
}

/* blend two terms to 30 days (CBOE equation 2) */
function thirtyDay(near, next) {
  if (!near && !next) return null;
  if (!next || !near) { const t = near || next; return 100 * Math.sqrt(t.variance); }
  const n1 = near.minutes, n2 = next.minutes;
  if (n2 === n1) return 100 * Math.sqrt(near.variance);
  const v = (near.T * near.variance * ((n2 - MIN_30) / (n2 - n1)) + next.T * next.variance * ((MIN_30 - n1) / (n2 - n1))) * (MIN_YEAR / MIN_30);
  return v > 0 ? 100 * Math.sqrt(v) : null;
}

/* the two expirations around 30 days: near = latest at or under 30 days (at least a week out), next = earliest beyond */
function pickTerms(expirations, nowMs) {
  const list = (expirations || []).map((e) => ({ e: String(e), m: minutesToExpiry(e, nowMs) })).filter((x) => fin(x.m) && x.m > 7 * 1440).sort((a, b) => a.m - b.m);
  const near = [...list].reverse().find((x) => x.m <= MIN_30) || null;
  const next = list.find((x) => x.m > MIN_30 && x.m <= 60 * 1440) || null;
  return { near: near && near.e, next: next && next.e };
}

function createVolIndex({ chain, now = Date.now, symbol = 'SPY', openTtlMs = 120_000, closedTtlMs = 900_000, isOpen = () => true, rate = 0.043, logger = () => {} } = {}) {
  let cache = null, pending = null, expCache = null;
  const history = []; // { t, level }
  async function expirations() {
    if (expCache && expCache.until > now()) return expCache.list;
    const r = await chain(symbol);
    const d = r && r.data && r.data.data ? r.data.data : r && r.data;
    const list = (d && d.expirations) || [];
    if (list.length) expCache = { list, until: now() + 6 * 3600_000 };
    return list;
  }
  async function compute() {
    const t = now();
    const { near, next } = pickTerms(await expirations(), t);
    if (!near && !next) return { ok: false, reason: 'no_expirations' };
    const [a, b] = await Promise.all([near ? chain(symbol, near) : null, next ? chain(symbol, next) : null]);
    const tn = near && a && a.ok !== false ? termVariance(strikesFrom(a.data || a), minutesToExpiry(near, t), rate) : null;
    const tx = next && b && b.ok !== false ? termVariance(strikesFrom(b.data || b), minutesToExpiry(next, t), rate) : null;
    const level = thirtyDay(tn, tx);
    if (!fin(level)) return { ok: false, reason: 'not_enough_quotes' };
    const rounded = Math.round(level * 100) / 100;
    history.push({ t, level: rounded });
    while (history.length > 500 || (history.length && t - history[0].t > 3 * 86_400_000)) history.shift();
    return {
      ok: true, level: rounded, asOf: t, source: 'SPY options (moomoo), CBOE VIX method',
      terms: [near && tn ? { expiry: near, days: Math.round(tn.minutes / 144) / 10, vol: Math.round(Math.sqrt(tn.variance) * 1000) / 10, strikes: tn.strikes } : null, next && tx ? { expiry: next, days: Math.round(tx.minutes / 144) / 10, vol: Math.round(Math.sqrt(tx.variance) * 1000) / 10, strikes: tx.strikes } : null].filter(Boolean)
    };
  }
  async function get() {
    if (cache && cache.until > now()) return cache.value;
    if (pending) return pending;
    pending = compute().then((value) => {
      cache = { value: value.ok ? value : (cache && cache.value && cache.value.ok ? { ...cache.value, stale: true } : value), until: now() + (isOpen(now()) ? openTtlMs : closedTtlMs) };
      return cache.value;
    }, (error) => {
      logger('warn', 'vol_index_failed', { error: String(error && error.message || error) });
      cache = { value: cache && cache.value && cache.value.ok ? { ...cache.value, stale: true } : { ok: false, reason: 'unavailable' }, until: now() + 60_000 };
      return cache.value;
    }).finally(() => { pending = null; });
    return pending;
  }
  /* change against the first reading at or after `sinceMs` (e.g. today's open), from what this server has seen */
  function changeSince(sinceMs) {
    const first = history.find((h) => h.t >= sinceMs);
    const lastH = history[history.length - 1];
    return first && lastH && first !== lastH ? { from: first.level, to: lastH.level, change: Math.round((lastH.level - first.level) * 100) / 100, pct: Math.round(((lastH.level / first.level) - 1) * 10_000) / 100 } : null;
  }
  return { get, changeSince, history: () => history.slice() };
}

module.exports = { createVolIndex, termVariance, thirtyDay, pickTerms, strikesFrom, minutesToExpiry };
