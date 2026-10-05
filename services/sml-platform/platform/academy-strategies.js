'use strict';

/* Options strategy and hedge builder. Pure functions over a normalized chain (academy-options-chain.js rows: { expiry, strike, call, put }).
 * Builds the structures that fit a view (more exposure, a hedge on shares already held, or income against shares) and describes each with its legs,
 * cost, maximum profit and loss, breakevens, expiry payoff, net Greeks and plain-English warnings about fills and liquidity.
 * Prices are mids from the chain; nothing is invented. Educational only: it does not place or recommend any order. */
const calc = require('./academy-options-calc');

const fin = Number.isFinite;
const r2 = (v) => Math.round(v * 100) / 100;
const mid = (leg) => {
  if (!leg) return null;
  const b = Number(leg.bid), a = Number(leg.ask), l = Number(leg.last);
  if (b > 0 && a >= b) return (a + b) / 2;
  if (fin(l) && l > 0) return l;
  return null;
};
const spreadPct = (leg) => { const b = Number(leg && leg.bid), a = Number(leg && leg.ask); return b > 0 && a >= b ? (a - b) / ((a + b) / 2) : null; };

function daysTo(expiry, now) {
  const t = Date.parse(String(expiry).slice(0, 10) + 'T20:00:00Z');
  return fin(t) ? Math.max(0, (t - now) / 86_400_000) : null;
}

function expiries(rows, now) {
  const m = new Map();
  for (const r of rows || []) {
    if (!r || !r.expiry) continue;
    const d = daysTo(r.expiry, now); if (d == null || d < 1) continue;
    if (!m.has(r.expiry)) m.set(r.expiry, { expiry: r.expiry, days: d, n: 0 });
    m.get(r.expiry).n += 1;
  }
  return [...m.values()].filter((e) => e.n >= 4).sort((a, b) => a.days - b.days);
}

function pickExpiry(list, wantDays) {
  if (!list.length) return null;
  const later = list.filter((e) => e.days >= wantDays);
  return later.length ? later[0] : list[list.length - 1];
}

function legAt(rows, expiry, strike, type) {
  const r = (rows || []).find((x) => x.expiry === expiry && Math.abs(Number(x.strike) - strike) < 1e-9);
  return r ? r[type] : null;
}
function nearestStrike(rows, expiry, target, type) {
  let best = null;
  for (const r of rows || []) {
    if (r.expiry !== expiry || !r[type] || mid(r[type]) == null) continue;
    const d = Math.abs(Number(r.strike) - target);
    if (!best || d < best.d) best = { d, strike: Number(r.strike), leg: r[type] };
  }
  /* a strike far from what the structure needs would be a different trade: better to show nothing than a mislabelled hedge */
  return best && best.d <= Math.max(target * 0.06, 0.5) ? best : null;
}
function stepAbove(rows, expiry, from, type, steps) {
  const ks = [...new Set((rows || []).filter((r) => r.expiry === expiry && r[type] && mid(r[type]) != null).map((r) => Number(r.strike)))].sort((a, b) => a - b);
  const i = ks.findIndex((k) => k > from + 1e-9);
  if (i < 0) return null;
  return ks[Math.min(ks.length - 1, i + steps - 1)];
}
function stepBelow(rows, expiry, from, type, steps) {
  const ks = [...new Set((rows || []).filter((r) => r.expiry === expiry && r[type] && mid(r[type]) != null).map((r) => Number(r.strike)))].sort((a, b) => b - a);
  const i = ks.findIndex((k) => k < from - 1e-9);
  if (i < 0) return null;
  return ks[Math.min(ks.length - 1, i + steps - 1)];
}

function mkLeg(rows, expiry, strike, type, qty, spot, T, r, q) {
  const leg = legAt(rows, expiry, strike, type), m = mid(leg);
  if (m == null) return null;
  const iv = fin(Number(leg.iv)) && Number(leg.iv) > 0 ? Number(leg.iv) : calc.impliedVol(type, spot, strike, T, r, q, m);
  const g = iv ? calc.price(type, spot, strike, T, r, q, iv) : null;
  return {
    type, strike, qty, price: r2(m), bid: fin(Number(leg.bid)) ? Number(leg.bid) : null, ask: fin(Number(leg.ask)) ? Number(leg.ask) : null, iv: iv ? r2(iv * 100) / 100 : null,
    delta: fin(Number(leg.delta)) ? Number(leg.delta) : (g ? g.delta : null), gamma: g ? g.gamma : null, theta: g ? g.theta : null, vega: g ? g.vega : null,
    oi: fin(Number(leg.oi ?? leg.open_interest)) ? Number(leg.oi ?? leg.open_interest) : null, volume: fin(Number(leg.volume)) ? Number(leg.volume) : null, spreadPct: spreadPct(leg)
  };
}

/* value of the whole structure at expiry for a given spot; stock legs are { type:'stock', qty (shares) } */
function expiryValue(legs, S, stock) {
  let v = stock ? stock.shares * (S - stock.cost) : 0;
  for (const l of legs) {
    const intrinsic = l.type === 'call' ? Math.max(0, S - l.strike) : Math.max(0, l.strike - S);
    v += l.qty * 100 * (intrinsic - l.price);
  }
  return v;
}

function curve(legs, spot, stock, lo = 0.7, hi = 1.3, n = 41) {
  const pts = [];
  for (let i = 0; i < n; i++) { const S = spot * (lo + ((hi - lo) * i) / (n - 1)); pts.push({ s: r2(S), pl: Math.round(expiryValue(legs, S, stock)) }); }
  return pts;
}

function breakevens(legs, spot, stock) {
  const out = []; let prev = null;
  const lo = spot * 0.3, hi = spot * 2.2, n = 1200;
  for (let i = 0; i <= n; i++) {
    const S = lo + ((hi - lo) * i) / n, v = expiryValue(legs, S, stock);
    if (prev && (prev.v === 0 ? false : (prev.v < 0) !== (v < 0))) out.push(r2(prev.S + ((S - prev.S) * (0 - prev.v)) / (v - prev.v)));
    prev = { S, v };
  }
  return out;
}

function extremes(legs, spot, stock) {
  // payoff is piecewise linear: evaluate at every strike, at 0 and at a far upper bound, plus the slope beyond the last strike
  const ks = [...new Set(legs.map((l) => l.strike))].sort((a, b) => a - b);
  const pts = [0, ...ks, ks[ks.length - 1] * 3 + spot * 3];
  const vals = pts.map((S) => expiryValue(legs, S, stock));
  const up = expiryValue(legs, pts[pts.length - 1] * 2, stock) - vals[vals.length - 1];
  return {
    maxLoss: Math.round(Math.min(...vals)), maxProfit: Math.round(Math.max(...vals)),
    unlimitedUp: up > 1, unlimitedLoss: up < -1 // a payoff that keeps falling as the stock rises (uncovered short calls) has no floor
  };
}

function netGreeks(legs, stock) {
  const g = { delta: stock ? stock.shares : 0, gamma: 0, theta: 0, vega: 0 };
  for (const l of legs) for (const k of ['delta', 'gamma', 'theta', 'vega']) g[k] += (fin(l[k]) ? l[k] : 0) * l.qty * 100;
  return { delta: r2(g.delta), gamma: Math.round(g.gamma * 1000) / 1000, thetaPerDay: r2(g.theta), vegaPer1pct: r2(g.vega) };
}

function warningsFor(legs, name, unlimitedLoss) {
  const w = [];
  const worst = Math.max(0, ...legs.map((l) => (l.spreadPct == null ? 0 : l.spreadPct)));
  if (worst > 0.2) w.push(`Wide bid/ask (${Math.round(worst * 100)}% of the price on one leg): expect to give up a lot to get filled. Use limit orders at the mid.`);
  else if (worst > 0.1) w.push(`Bid/ask is ${Math.round(worst * 100)}% wide on one leg, so fills can cost noticeably more than the mid.`);
  const thin = legs.filter((l) => (l.oi != null && l.oi < 100) || (l.volume != null && l.volume === 0 && (l.oi == null || l.oi < 500)));
  if (thin.length) w.push('A leg has low open interest or no trades today, so it may be hard to exit.');
  if (unlimitedLoss) w.push('Loss is unlimited: this structure has short calls that nothing covers. Do not trade it without understanding assignment risk.');
  return w;
}

function probabilityOfProfit(legs, spot, stock, T, r, q, sigma) {
  if (!(T > 0) || !(sigma > 0)) return null;
  // sample the terminal price distribution (lognormal) and count positive payoff
  let up = 0, total = 0;
  for (let i = 1; i < 400; i++) {
    const u = i / 400, z = invNorm(u);
    const S = spot * Math.exp((r - q - 0.5 * sigma * sigma) * T + sigma * Math.sqrt(T) * z);
    total += 1; if (expiryValue(legs, S, stock) > 0) up += 1;
  }
  return Math.round((up / total) * 100);
}
function invNorm(p) { // Acklam approximation
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425, ph = 1 - pl;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > ph) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, rr = q * q;
  return (((((a[0] * rr + a[1]) * rr + a[2]) * rr + a[3]) * rr + a[4]) * rr + a[5]) * q / (((((b[0] * rr + b[1]) * rr + b[2]) * rr + b[3]) * rr + b[4]) * rr + 1);
}

function describe({ id, name, kind, why, legs, stock, spot, T, r, q, expiry, days }) {
  const net = legs.reduce((s, l) => s + l.qty * l.price * 100, 0);
  const ext = extremes(legs, spot, stock);
  const be = breakevens(legs, spot, stock);
  const greeks = netGreeks(legs, stock);
  const atm = legs.find((l) => l.iv) || {};
  const sigma = atm.iv ? atm.iv : null;
  const capital = stock ? stock.shares * spot + Math.max(0, net) : Math.max(0, net);
  const out = {
    id, name, kind, why, expiry, days: Math.round(days), legs: legs.map((l) => ({ ...l })),
    netCost: Math.round(net), costType: net >= 0 ? 'debit' : 'credit',
    maxProfit: ext.unlimitedUp ? null : ext.maxProfit, maxLoss: ext.unlimitedLoss ? null : ext.maxLoss, unlimitedProfit: !!ext.unlimitedUp, unlimitedLoss: !!ext.unlimitedLoss,
    breakevens: be, greeks, payoff: curve(legs, spot, stock),
    chanceOfProfit: sigma ? probabilityOfProfit(legs, spot, stock, T, r, q, sigma) : null,
    warnings: warningsFor(legs, name, ext.unlimitedLoss)
  };
  if (stock) {
    out.stock = { shares: stock.shares, cost: stock.cost };
    out.exposure = { sharesEquivalent: greeks.delta, vsOwnedShares: stock.shares ? r2(greeks.delta / stock.shares) : null };
  } else {
    const deltaNotional = Math.abs(greeks.delta) * spot;
    out.exposure = { sharesEquivalent: greeks.delta, leverage: capital > 0 ? r2(deltaNotional / capital) : null, capitalAtRisk: Math.abs(Math.min(0, ext.maxLoss)) };
  }
  return out;
}

/* opts: { symbol, spot, rows, view: 'bullish'|'bearish'|'neutral', horizonDays, shares (optional shares held), cost (basis), rate, divYield, now } */
function buildStrategies(opts = {}) {
  const now = opts.now || Date.now(), spot = Number(opts.spot), rows = opts.rows || [];
  if (!(spot > 0) || !rows.length) return { available: false, reason: 'no_chain', strategies: [] };
  const list = expiries(rows, now);
  const ex = pickExpiry(list, Math.max(7, Number(opts.horizonDays) || 30) * 1.15);
  if (!ex) return { available: false, reason: 'no_usable_expiry', strategies: [] };
  const r = fin(opts.rate) ? opts.rate : 0.043, q = fin(opts.divYield) ? opts.divYield : 0, T = ex.days / 365, view = opts.view || 'bullish';
  const held = Number(opts.shares) > 0 ? Math.floor(Number(opts.shares)) : 0;
  const lots = Math.floor(held / 100);
  const holds = lots >= 1; // an option contract covers 100 shares; fewer than that cannot be hedged or written against with listed options
  const coveredShares = lots * 100;
  const stock = holds ? { shares: coveredShares, cost: Number(opts.cost) > 0 ? Number(opts.cost) : spot } : null;
  const contracts = Math.max(1, lots);
  const notes = held > 0 && !holds ? ['You entered fewer than 100 shares. One option contract covers 100 shares, so hedges and covered calls are not shown.'] : [];
  const out = [];
  const L = (strike, type, qty) => mkLeg(rows, ex.expiry, strike, type, qty, spot, T, r, q);
  const add = (spec) => { if (spec.legs.every(Boolean)) out.push(describe({ ...spec, spot, T, r, q, expiry: ex.expiry, days: ex.days })); };
  const sizeLegs = (legs, n) => legs.map((l) => (l ? { ...l, qty: l.qty * n } : l));

  const atmC = nearestStrike(rows, ex.expiry, spot, 'call'), atmP = nearestStrike(rows, ex.expiry, spot, 'put');
  if (view === 'bullish' && atmC) {
    const k1 = atmC.strike, k2 = stepAbove(rows, ex.expiry, k1 * 1.04, 'call', 1);
    add({ id: 'long_call', name: 'Long call', kind: 'exposure', why: 'More upside exposure for a fixed, known cost. You can lose the whole premium.', legs: [L(k1, 'call', 1)] });
    if (k2) add({ id: 'bull_call_spread', name: 'Bull call spread', kind: 'exposure', why: 'Cheaper than a long call: selling the higher call pays part of the cost but caps the gain.', legs: [L(k1, 'call', 1), L(k2, 'call', -1)] });
    const kp = stepBelow(rows, ex.expiry, spot * 0.97, 'put', 1), kp2 = kp ? stepBelow(rows, ex.expiry, kp - 1e-6, 'put', 1) : null;
    if (kp && kp2) add({ id: 'bull_put_spread', name: 'Bull put spread (credit)', kind: 'income', why: 'Collects premium if the stock stays above the short put. Loss is capped at the spread width minus the credit.', legs: [L(kp, 'put', -1), L(kp2, 'put', 1)] });
  }
  if (view === 'bearish' && atmP) {
    const k1 = atmP.strike, k2 = stepBelow(rows, ex.expiry, k1 * 0.96, 'put', 1);
    add({ id: 'long_put', name: 'Long put', kind: 'exposure', why: 'More downside exposure for a fixed, known cost. You can lose the whole premium.', legs: [L(k1, 'put', 1)] });
    if (k2) add({ id: 'bear_put_spread', name: 'Bear put spread', kind: 'exposure', why: 'Cheaper than a long put: selling the lower put pays part of the cost but caps the gain.', legs: [L(k1, 'put', 1), L(k2, 'put', -1)] });
    const kc = stepAbove(rows, ex.expiry, spot * 1.03, 'call', 1), kc2 = kc ? stepAbove(rows, ex.expiry, kc + 1e-6, 'call', 1) : null;
    if (kc && kc2) add({ id: 'bear_call_spread', name: 'Bear call spread (credit)', kind: 'income', why: 'Collects premium if the stock stays below the short call. Loss is capped at the spread width minus the credit.', legs: [L(kc, 'call', -1), L(kc2, 'call', 1)] });
  }
  if (holds) {
    const kpHedge = nearestStrike(rows, ex.expiry, spot * 0.95, 'put'), kcOut = nearestStrike(rows, ex.expiry, spot * 1.06, 'call');
    if (kpHedge) add({ id: 'protective_put', name: 'Protective put', kind: 'hedge', why: `Insurance on ${stock.shares} shares: below the put strike, extra losses on the shares are offset.`, legs: sizeLegs([L(kpHedge.strike, 'put', 1)], contracts), stock });
    if (kcOut) add({ id: 'covered_call', name: 'Covered call', kind: 'income', why: 'Sells upside above the strike for premium now. Lowers cost and exposure, but caps the gain on the shares.', legs: sizeLegs([L(kcOut.strike, 'call', -1)], contracts), stock });
    if (kpHedge && kcOut) add({ id: 'collar', name: 'Collar', kind: 'hedge', why: 'Buys downside protection and pays for it by selling upside. Often near zero net cost; gain and loss are both bounded.', legs: sizeLegs([L(kpHedge.strike, 'put', 1), L(kcOut.strike, 'call', -1)], contracts), stock });
  } else if (held === 0 && view !== 'neutral' && atmP && atmC) {
    // no shares held: show what a hedge would look like per 100 shares so the idea is visible
    const kpHedge = nearestStrike(rows, ex.expiry, spot * 0.95, 'put');
    if (kpHedge) add({ id: 'protective_put_100', name: 'Protective put (per 100 shares)', kind: 'hedge', why: 'If you own 100 shares, this put insures them below the strike. Shown for a position of 100 shares bought at the current price.', legs: [L(kpHedge.strike, 'put', 1)], stock: { shares: 100, cost: spot } });
  }
  if (!out.length) return { available: false, reason: notes.length ? 'needs_100_shares' : 'no_priced_contracts', notes, holdsShares: holds, strategies: [] };
  return { available: true, symbol: opts.symbol || '', spot: r2(spot), expiry: ex.expiry, days: Math.round(ex.days), view, holdsShares: holds, ...(holds && held !== coveredShares ? { sharesCovered: coveredShares, sharesUncovered: held - coveredShares } : {}), notes, strategies: out, disclaimer: 'Educational illustration from live option mids. Not advice, and not an order. Fills differ from mids; options can expire worthless.' };
}

module.exports = { buildStrategies, expiryValue, breakevens, mid, daysTo, invNorm };
