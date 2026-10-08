'use strict';

/*
 * HEDGE & INCOME for the Academy Live Chart Lab.
 *
 * Given a stock position (long or short), the alert's entry / target / stop and MEM ALGO's read, it looks through the live options chain and
 * ranks a handful of ideas: protect the position (protective put, put debit spread, collar), earn on it (covered call, cash-secured put) or
 * express the view with a single contract. Every idea carries its legs, what it costs or pays, what it protects or yields, its greeks, how
 * liquid it is, a 0-100 score and a short plain-English reason.
 *
 * planHedges() is pure (no I/O) so it can be tested; createHedgeService() wraps it with the chain / candle / alert-desk lookups and a short cache.
 * Educational analysis only: nothing here places a trade.
 */

const calc = require('./academy-options-calc');
const chainLib = require('./academy-options-chain');

const RATE = 0.043;
const MULT = 100;
const CANDLE_WAIT_MS = 6_000;
const EXTRA_EXP_WAIT_MS = 7_000;
const DISCLAIMER = 'Educational analysis, not financial advice. Options can lose 100% of what you pay for them, selling options carries obligations (you can be assigned), and nothing here places a trade. Prices are mid-market estimates; real fills can be worse.';

/* expiry windows (days to expiry) per MEM ALGO mode: protect = hedges, income = premium selling, dir = the single directional contract */
const WINDOWS = {
  day: { protect: [14, 45, 30], income: [7, 30, 21], dir: [14, 45, 30] },
  short: { protect: [14, 45, 30], income: [7, 30, 21], dir: [14, 45, 30] },
  swing: { protect: [21, 60, 40], income: [14, 45, 30], dir: [21, 60, 40] },
  mid: { protect: [30, 90, 60], income: [21, 45, 35], dir: [45, 120, 75] },
  long: { protect: [45, 180, 90], income: [21, 60, 40], dir: [90, 365, 180] }
};
const ATR_K = { day: [1.2, 2.4], short: [1.6, 3.2], swing: [2, 4], mid: [3, 6], long: [4, 8] }; // stop, target in daily ATRs (MEM ALGO's own multiples)

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => { if (v === null || v === undefined || v === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const r2 = (v) => (fin(v) ? Math.round(v * 100) / 100 : null);
const r4 = (v) => (fin(v) ? Math.round(v * 10000) / 10000 : null);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const money = (v) => (fin(v) ? '$' + (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2)) : '–');
const cash = (v) => (fin(v) ? '$' + (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2)) : '–'); // dollar amounts (strikes and prices keep their cents)
const pctTxt = (v, d = 1) => (fin(v) ? (v * 100).toFixed(d) + '%' : '–');
const dateTxt = (e) => { const t = Date.parse(e + 'T12:00:00Z'); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : e; };
const dteOf = (expiry, now) => { const end = Date.parse(`${expiry}T20:00:00Z`); return Number.isFinite(end) ? Math.max(0, Math.ceil((end - now) / 86_400_000)) : null; };

/** Paired chain rows ({ expiry, strike, call, put }) from academy-options-chain.normalize -> flat rows, one per contract. */
function flattenChain(paired) {
  const out = [];
  for (const r of paired || []) {
    for (const type of ['call', 'put']) {
      const s = r && r[type]; if (!s) continue;
      out.push({ expiry: r.expiry, type, strike: r.strike, bid: s.bid, ask: s.ask, mid: null, delta: s.delta, gamma: s.gamma, theta: s.theta, vega: s.vega, iv: s.iv, oi: s.oi, volume: s.volume });
    }
  }
  return out;
}

/** Cleans one contract and fills missing greeks from Black-Scholes when implied volatility (or a usable price) is known. Never invents a quote. */
function prepare(row, price, now) {
  const type = String(row.type || '').toLowerCase().startsWith('p') ? 'put' : 'call';
  const strike = num(row.strike), bid = num(row.bid), ask = num(row.ask);
  const dte = dteOf(String(row.expiry || ''), now);
  if (!fin(strike) || strike <= 0 || dte == null) return null;
  let mid = num(row.mid);
  if (!fin(mid) && fin(bid) && fin(ask) && bid > 0 && ask >= bid) mid = (bid + ask) / 2;
  if (fin(mid)) mid = Math.round(mid * 100) / 100; // whole cents, so every cost shown adds up to what the legs say
  let iv = num(row.iv); if (fin(iv) && iv > 3) iv /= 100;
  const T = Math.max(dte, 0.5) / 365;
  if (!(iv > 0) && fin(mid) && mid > 0 && fin(price)) iv = calc.impliedVol(type, price, strike, T, RATE, 0, mid);
  const bs = iv > 0 && fin(price) ? calc.price(type, price, strike, T, RATE, 0, iv) : null;
  const pickG = (v, k) => (fin(num(v)) ? num(v) : bs ? bs[k] : null);
  let delta = pickG(row.delta, 'delta');
  if (fin(delta) && type === 'put' && delta > 0) delta = -delta; // some feeds publish put deltas as positive numbers
  const spreadPct = fin(bid) && fin(ask) && fin(mid) && mid > 0 ? (ask - bid) / mid : null;
  return {
    expiry: String(row.expiry), type, strike, dte, bid, ask, mid, iv: fin(iv) ? iv : null, delta, gamma: pickG(row.gamma, 'gamma'), theta: pickG(row.theta, 'theta'), vega: pickG(row.vega, 'vega'),
    oi: Math.max(0, num(row.oi) || 0), volume: Math.max(0, num(row.volume) || 0), spreadPct
  };
}

/* Tradeable at all? No bid, a spread wider than 15% of the mid, or almost no open interest and no volume = skipped. */
function liquidityProblem(c) {
  if (!(c.bid > 0) || !(c.ask > 0) || !fin(c.mid) || c.mid < 0.05) return 'no_bid';
  if (!fin(c.spreadPct) || c.spreadPct > 0.15) return 'wide_spread';
  if (c.oi < 25 && c.volume < 25) return 'thin';
  return null;
}
function liquidityOf(legs) {
  const worst = Math.max(...legs.map((l) => l.spreadPct || 0)), minOi = Math.min(...legs.map((l) => l.oi || 0));
  const grade = worst <= 0.05 && minOi >= 500 ? 'A' : worst <= 0.1 && minOi >= 100 ? 'B' : 'C';
  return { grade, worstSpreadPct: r4(worst), minOi, label: grade === 'A' ? 'Very liquid' : grade === 'B' ? 'Liquid' : 'Tradeable, check the fill' };
}
const liqPenalty = (c) => (c.spreadPct || 0) * 100 - Math.min(6, Math.log10((c.oi || 0) + 1) * 2);
const fitPenalty = (x, lo, hi, k) => (x >= lo && x <= hi ? 0 : Math.min(35, (x < lo ? lo - x : x - hi) * k));
const inWin = (c, w) => c.dte >= w[0] && c.dte <= w[1];

function leg(action, c, contracts) {
  return {
    action, type: c.type, strike: c.strike, expiry: c.expiry, dte: c.dte, bid: r2(c.bid), ask: r2(c.ask), mid: r2(c.mid), spreadPct: r4(c.spreadPct),
    delta: r4(c.delta), gamma: r4(c.gamma), theta: r4(c.theta), vega: r4(c.vega), iv: r4(c.iv), oi: c.oi, volume: c.volume, contracts,
    label: `${action === 'buy' ? 'Buy' : 'Sell'} ${contracts} × ${dateTxt(c.expiry)} ${money(c.strike)} ${c.type}`
  };
}
/** Greeks for the whole option position (per share deltas × 100 × contracts; theta positive = the position earns time decay). */
function positionGreeks(legs) {
  const g = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const l of legs) { const s = (l.action === 'buy' ? 1 : -1) * MULT * l.contracts; for (const k of Object.keys(g)) g[k] += s * (l[k] || 0); }
  return { delta: r2(g.delta), gamma: r4(g.gamma), theta: r2(g.theta), vega: r2(g.vega) };
}
/** Profit or loss at expiry for an idea at stock price S (stock leg included when the idea is built on the stock). */
function payoffAt(idea, S) {
  let pl = 0;
  if (idea.withStock) pl += (idea.side === 'short' ? -1 : 1) * (S - idea.entry) * idea.shares;
  for (const l of idea.legs) {
    const intrinsic = l.type === 'call' ? Math.max(0, S - l.strike) : Math.max(0, l.strike - S);
    pl += (l.action === 'buy' ? intrinsic - l.mid : l.mid - intrinsic) * MULT * l.contracts;
  }
  return pl;
}
/** Expiry break-even prices found numerically (works for every structure, including the stock leg). */
function breakevensOf(idea, lo, hi) {
  const out = [], steps = 400; let prevS = lo, prev = payoffAt(idea, lo);
  for (let i = 1; i <= steps; i++) {
    const S = lo + ((hi - lo) * i) / steps, v = payoffAt(idea, S);
    if ((prev < 0 && v >= 0) || (prev > 0 && v <= 0)) { const x = prevS + ((S - prevS) * (0 - prev)) / (v - prev); if (!out.some((b) => Math.abs(b - x) < (hi - lo) / 200)) out.push(r2(x)); }
    prev = v; prevS = S;
  }
  return out;
}

/**
 * input: { symbol, price, side:'long'|'short', shares=100, entry, target, stop, horizon, memRead:{dir:'bull'|'bear'|'neutral', strength 0-100}, chain: rows, now }
 * chain rows: { expiry 'YYYY-MM-DD', type 'call'|'put', strike, bid, ask, mid?, delta?, gamma?, theta?, vega?, iv?, oi?, volume? }
 */
function planHedges(input = {}) {
  const now = fin(input.now) ? input.now : Date.now();
  const symbol = String(input.symbol || '').toUpperCase();
  const price = num(input.price);
  const side = input.side === 'short' ? 'short' : 'long', sgn = side === 'short' ? -1 : 1;
  const shares = Math.max(1, Math.round(num(input.shares) || 100));
  const contracts = Math.max(1, Math.floor(shares / MULT));
  const horizon = WINDOWS[input.horizon] ? input.horizon : 'swing';
  const W = WINDOWS[horizon];
  const base = { ok: true, symbol, side, shares, contracts, horizon, disclaimer: DISCLAIMER, ideas: [], notes: [] };
  if (!fin(price) || price <= 0) return Object.assign(base, { ok: false, error: 'no_price', message: 'Waiting for a live price.' });
  const entry = num(input.entry) > 0 ? num(input.entry) : price;
  let stop = num(input.stop) > 0 ? num(input.stop) : null, target = num(input.target) > 0 ? num(input.target) : null;
  // a stop or target on the wrong side of the position is ignored rather than trusted
  if (stop != null && (side === 'long' ? stop >= Math.max(entry, price) : stop <= Math.min(entry, price))) stop = null;
  if (target != null && (side === 'long' ? target <= Math.min(entry, price) : target >= Math.max(entry, price))) target = null;
  if (stop == null) stop = price * (1 - sgn * 0.08);
  if (target == null) target = price * (1 + sgn * 0.12);
  const levels = { entry: r2(entry), target: r2(target), stop: r2(stop) };
  const posValue = price * shares;

  // MEM ALGO context decides what comes first
  const mr = input.memRead || {};
  const dirSign = mr.dir === 'bull' ? 1 : mr.dir === 'bear' ? -1 : 0;
  const strength = fin(num(mr.strength)) ? clamp(num(mr.strength), 0, 100) : 50;
  let lean, leanReason;
  if (dirSign === 0 || strength < 40) { lean = 'hedge-first'; leanReason = 'MEM ALGO has no clear direction right now, so protecting what you have comes before squeezing income out of it.'; }
  else if (dirSign !== sgn) { lean = 'hedge-first'; leanReason = `MEM ALGO leans ${dirSign > 0 ? 'bullish' : 'bearish'}, against your ${side} position, so hedges are ranked first.`; }
  else { lean = 'income-first'; leanReason = `MEM ALGO leans ${dirSign > 0 ? 'bullish' : 'bearish'} with your ${side} position, so collecting premium on it is ranked first and hedges come after.`; }

  // contracts
  const skipped = { illiquid: 0, reasons: { no_bid: 0, wide_spread: 0, thin: 0 } };
  const all = [];
  for (const raw of input.chain || []) {
    const c = prepare(raw, price, now); if (!c || c.dte < 1) continue;
    const bad = liquidityProblem(c); if (bad) { skipped.illiquid++; skipped.reasons[bad]++; continue; }
    if (!fin(c.delta)) continue;
    all.push(c);
  }
  const ivs = all.map((c) => c.iv).filter((v) => v > 0).sort((a, b) => a - b);
  const ivMedian = ivs.length ? ivs[Math.floor(ivs.length / 2)] : null;
  const puts = all.filter((c) => c.type === 'put'), calls = all.filter((c) => c.type === 'call');
  const protType = side === 'long' ? puts : calls, incomeType = side === 'long' ? calls : puts;
  const ideas = [];
  const pushIdea = (o) => {
    const idea = Object.assign({ side, shares, entry: levels.entry, contracts }, o);
    idea.greeks = positionGreeks(idea.legs);
    idea.thetaPerDay = idea.greeks.theta;
    idea.liquidity = liquidityOf(idea.legs);
    const span = Math.max(price * 0.5, Math.abs(price - stop) * 4, Math.abs(target - price) * 3);
    idea.breakevens = breakevensOf(idea, Math.max(0.01, price - span), price + span);
    ideas.push(idea);
  };
  const netOf = (legs) => legs.reduce((s, l) => s + (l.action === 'buy' ? l.mid : -l.mid), 0); // + = debit per share
  const netBlock = (perShare) => ({ type: perShare >= 0 ? 'debit' : 'credit', perShare: r2(Math.abs(perShare)), perContract: r2(Math.abs(perShare) * MULT), total: r2(Math.abs(perShare) * MULT * contracts) });

  /* 1. protective put (call for a short): strike near the stop, |delta| 0.25-0.45, cheapest protection per day */
  const protScore = (c) => {
    const d = Math.abs(c.delta), costDayPct = (c.mid / Math.max(1, c.dte)) / price * 100;
    return 100 - fitPenalty(d, 0.25, 0.45, 150) - Math.min(25, Math.abs(c.strike - stop) / price * 100 * 4) - Math.min(25, costDayPct * 150) - liqPenalty(c) - Math.abs(c.dte - W.protect[2]) * 0.15;
  };
  const protCands = protType.filter((c) => inWin(c, W.protect) && (side === 'long' ? c.strike <= price * 1.005 && c.strike >= stop - Math.abs(price - stop) : c.strike >= price * 0.995 && c.strike <= stop + Math.abs(stop - price)));
  const bestProt = protCands.map((c) => ({ c, s: protScore(c) })).sort((a, b) => b.s - a.s)[0];
  if (bestProt) {
    const c = bestProt.c, legs = [leg('buy', c, contracts)], net = c.mid;
    const maxLossPS = side === 'long' ? entry - c.strike + net : c.strike - entry + net;
    const name = side === 'long' ? 'Protective put' : 'Protective call';
    pushIdea({
      kind: side === 'long' ? 'protective_put' : 'protective_call', group: 'hedge', name, withStock: true, legs, net: netBlock(net), rawScore: bestProt.s,
      costPctOfPosition: r4((net * MULT * contracts) / posValue), costPerDay: r2((net * MULT * contracts) / c.dte),
      protectedBelow: side === 'long' ? c.strike : null, protectedAbove: side === 'short' ? c.strike : null,
      maxLoss: { perShare: r2(Math.max(0, maxLossPS)), total: r2(Math.max(0, maxLossPS) * MULT * contracts) },
      why: `${dateTxt(c.expiry)} ${money(c.strike)} ${c.type} costs about ${cash(net * MULT)} a contract, ${pctTxt((net * MULT * contracts) / posValue)} of the position, and it covers you for ${c.dte} days. Below ${money(c.strike)} every dollar the stock loses the ${c.type} gains back, so the worst case is about ${cash(Math.max(0, maxLossPS) * MULT * contracts)} no matter how far it ${side === 'long' ? 'falls' : 'rises'}. You keep all the upside, minus what the ${c.type} cost.`,
      whenToUse: `You want to hold through earnings, a shaky market or a break of ${money(stop)} without selling the shares, and you accept paying a known amount for it.`
    });

    /* 2. debit spread: buy the protective strike, sell a further-out strike so the hedge costs less (protection stops at the short strike) */
    const width = Math.max(Math.abs(price - stop), price * 0.03);
    const shortCands = protType.filter((x) => x.expiry === c.expiry && (side === 'long' ? x.strike < c.strike && x.strike >= c.strike - width * 2.2 : x.strike > c.strike && x.strike <= c.strike + width * 2.2) && x.mid < c.mid);
    const bestShort = shortCands.map((x) => ({ x, s: 100 - Math.abs(Math.abs(c.strike - x.strike) - width) / price * 100 * 5 - liqPenalty(x) - fitPenalty(Math.abs(x.delta), 0.08, 0.25, 120) })).sort((a, b) => b.s - a.s)[0];
    if (bestShort) {
      const x = bestShort.x, sLegs = [leg('buy', c, contracts), leg('sell', x, contracts)], debit = c.mid - x.mid, w = Math.abs(c.strike - x.strike);
      const saved = 1 - debit / c.mid;
      pushIdea({
        kind: side === 'long' ? 'put_debit_spread' : 'call_debit_spread', group: 'hedge', name: side === 'long' ? 'Put debit spread' : 'Call debit spread', withStock: true, legs: sLegs, net: netBlock(debit),
        rawScore: (bestProt.s + bestShort.s) / 2 + Math.min(8, saved * 12),
        costPctOfPosition: r4((debit * MULT * contracts) / posValue), costPerDay: r2((debit * MULT * contracts) / c.dte),
        protectedBelow: side === 'long' ? c.strike : null, protectedAbove: side === 'short' ? c.strike : null, protectionEnds: x.strike,
        maxPayout: { perShare: r2(w - debit), total: r2((w - debit) * MULT * contracts) },
        why: `Buying the ${money(c.strike)} ${c.type} and selling the ${money(x.strike)} ${c.type} brings the cost down to about ${cash(debit * MULT)} a contract, ${Math.round(saved * 100)}% cheaper than the ${c.type} alone. The trade-off: the cover only works between ${money(Math.min(c.strike, x.strike))} and ${money(Math.max(c.strike, x.strike))}, and it pays at most ${cash((w - debit) * MULT)} a contract.`,
        whenToUse: `You expect a pullback toward ${money(x.strike)}, not a crash, and you want cheaper insurance for that move.`
      });
    }

    /* 3. collar: the protective option plus an option sold at or beyond the target to pay for it (caps the upside at the target) */
    const capCands = incomeType.filter((x) => x.expiry === c.expiry && (side === 'long' ? x.strike >= target - 1e-9 : x.strike <= target + 1e-9));
    const bestCap = capCands.map((x) => ({ x, s: 100 - Math.min(40, Math.abs(c.mid - x.mid) / price * 100 * 25) - liqPenalty(x) - Math.abs(x.strike - target) / price * 100 * 0.5 })).sort((a, b) => b.s - a.s)[0];
    if (bestCap) {
      const x = bestCap.x, cLegs = [leg('buy', c, contracts), leg('sell', x, contracts)], net = c.mid - x.mid;
      const netTxt = Math.abs(net) * MULT < 5 ? 'close to nothing' : net > 0 ? `about ${cash(net * MULT)} a contract` : `a credit of about ${cash(-net * MULT)} a contract`;
      pushIdea({
        kind: 'collar', group: 'hedge', name: 'Collar', withStock: true, legs: cLegs, net: netBlock(net), rawScore: (bestProt.s * 0.6 + bestCap.s * 0.4) + (Math.abs(net) / price < 0.003 ? 6 : 0),
        costPctOfPosition: r4((net * MULT * contracts) / posValue),
        protectedBelow: side === 'long' ? c.strike : null, protectedAbove: side === 'short' ? c.strike : null, cappedAt: x.strike,
        maxLoss: { perShare: r2(Math.max(0, side === 'long' ? entry - c.strike + net : c.strike - entry + net)), total: r2(Math.max(0, side === 'long' ? entry - c.strike + net : c.strike - entry + net) * MULT * contracts) },
        maxGain: { perShare: r2(side === 'long' ? x.strike - entry - net : entry - x.strike - net), total: r2((side === 'long' ? x.strike - entry - net : entry - x.strike - net) * MULT * contracts) },
        why: `The ${money(c.strike)} ${c.type} is paid for by selling the ${money(x.strike)} ${x.type}, so the hedge costs ${netTxt}. You are covered ${side === 'long' ? 'below' : 'above'} ${money(c.strike)} until ${dateTxt(c.expiry)}, but your gains stop at ${money(x.strike)}, which is the alert's target area.`,
        whenToUse: 'You would be happy to exit at the target anyway and want the downside covered without paying for it.'
      });
    }
  }

  /* 4. covered call (covered put for a short): sell premium at or beyond the target, delta 0.15-0.30 */
  const ccPool = incomeType.filter((c) => inWin(c, W.income) && (side === 'long' ? c.strike > price : c.strike < price));
  let ccCands = ccPool.filter((c) => (side === 'long' ? c.strike >= target - 1e-9 : c.strike <= target + 1e-9));
  let ccBelowTarget = false;
  if (!ccCands.length) { ccCands = ccPool.filter((c) => Math.abs(c.delta) <= 0.3); ccBelowTarget = ccCands.length > 0; }
  const bestCc = ccCands.map((c) => {
    const ann = (c.mid / price) * (365 / c.dte);
    return { c, ann, s: 100 - fitPenalty(Math.abs(c.delta), 0.15, 0.3, 150) - Math.abs(Math.abs(c.delta) - 0.22) * 40 + Math.min(12, ann * 40) - liqPenalty(c) - Math.abs(c.dte - W.income[2]) * 0.2 };
  }).sort((a, b) => b.s - a.s)[0];
  if (bestCc) {
    const c = bestCc.c, legs = [leg('sell', c, contracts)], prem = c.mid, period = prem / price;
    const assigned = side === 'long' ? c.strike - entry + prem : entry - c.strike + prem;
    pushIdea({
      kind: side === 'long' ? 'covered_call' : 'covered_put', group: 'income', name: side === 'long' ? 'Covered call' : 'Covered put', withStock: true, legs, net: netBlock(-prem), rawScore: bestCc.s,
      yield: { period: r4(period), annualized: r4(bestCc.ann), days: c.dte }, probWorthless: r4(1 - Math.abs(c.delta)),
      cappedAt: c.strike, ifAssigned: { perShare: r2(assigned), total: r2(assigned * MULT * contracts) },
      why: `Selling the ${dateTxt(c.expiry)} ${money(c.strike)} ${c.type} pays about ${cash(prem * MULT)} a contract now, ${pctTxt(period)} in ${c.dte} days (${pctTxt(bestCc.ann, 0)} a year if you could repeat it). ` + (side === 'long' ? `If ${symbol || 'the stock'} is above ${money(c.strike)} at expiry your shares are sold there, ${assigned >= 0 ? 'locking in about ' + cash(assigned * MULT * contracts) : 'for a loss of about ' + cash(-assigned * MULT * contracts)} including the premium.` : `If it is below ${money(c.strike)} at expiry you buy back the shares there and keep the premium.`) + (ccBelowTarget ? ' No liquid strike sits at the target, so this one is closer in and would cap you before it.' : ''),
      whenToUse: `The trend is with you but you expect it to grind rather than rip past ${money(c.strike)}, and you want the position to pay you while you wait.` + (shares < MULT ? ' Needs 100 shares per contract.' : '')
    });
  }

  /* 5. cash-secured put (long side only): get paid to wait for a lower entry inside the alert's buy range or under the stop */
  if (side === 'long') {
    const zoneHi = Math.min(entry, price), zoneLo = stop * 0.97;
    const cspCands = puts.filter((c) => inWin(c, W.income) && c.strike < price);
    const bestCsp = cspCands.map((c) => {
      const ann = (c.mid / c.strike) * (365 / c.dte), out = c.strike > zoneHi ? (c.strike - zoneHi) / price : c.strike < zoneLo ? (zoneLo - c.strike) / price : 0;
      return { c, ann, s: 100 - fitPenalty(Math.abs(c.delta), 0.15, 0.3, 150) - Math.abs(Math.abs(c.delta) - 0.22) * 40 - Math.min(30, out * 100 * 3) + Math.min(12, ann * 40) - liqPenalty(c) - Math.abs(c.dte - W.income[2]) * 0.2 };
    }).sort((a, b) => b.s - a.s)[0];
    if (bestCsp) {
      const c = bestCsp.c, prem = c.mid, cashNeed = c.strike * MULT * contracts, eff = c.strike - prem;
      pushIdea({
        kind: 'cash_secured_put', group: 'income', name: 'Cash-secured put', withStock: false, legs: [leg('sell', c, contracts)], net: netBlock(-prem), rawScore: bestCsp.s,
        yield: { period: r4(prem / c.strike), annualized: r4(bestCsp.ann), days: c.dte }, cashSecured: r2(cashNeed), probWorthless: r4(1 - Math.abs(c.delta)), effectivePrice: r2(eff),
        maxLoss: { perShare: r2(eff), total: r2(eff * MULT * contracts) },
        why: `Selling the ${dateTxt(c.expiry)} ${money(c.strike)} put pays about ${cash(prem * MULT)} a contract on ${cash(c.strike * MULT)} of cash set aside, ${pctTxt(prem / c.strike)} in ${c.dte} days or about ${pctTxt(bestCsp.ann, 0)} a year. Roughly ${Math.round((1 - Math.abs(c.delta)) * 100)}% of the time a put like this expires worthless and you just keep the money. If it does not, you own ${symbol || 'the stock'} at ${money(eff)} effective, ${eff < entry ? 'below' : 'above'} the alert entry of ${money(entry)}.`,
        whenToUse: `You like ${symbol || 'the stock'} and would buy more at ${money(c.strike)}, and you have the cash to cover assignment. Passive income while you wait for a dip into the buy range.`
      });
    }
  } else base.notes.push('Cash-secured puts are left out for a short position: they add long exposure on top of the short.');

  /* 6. one directional contract with the best greeks: a call when the read is bullish, a put when it is bearish or unclear */
  const dirType = dirSign > 0 && strength >= 40 ? 'call' : dirSign < 0 && strength >= 40 ? 'put' : (side === 'long' ? 'put' : 'call');
  const dCands = (dirType === 'call' ? calls : puts).filter((c) => inWin(c, W.dir));
  const bestDir = dCands.map((c) => {
    const d = Math.abs(c.delta), thetaPct = fin(c.theta) && c.mid > 0 ? Math.abs(c.theta) / c.mid : 0, ivHigh = c.iv && ivMedian ? c.iv / ivMedian : 1;
    return { c, thetaPct, s: 100 - fitPenalty(d, 0.4, 0.65, 150) - Math.abs(d - 0.52) * 30 - Math.min(20, Math.max(0, thetaPct - 0.012) * 900) - (ivHigh > 1.35 ? Math.min(20, (ivHigh - 1.35) * 40) : 0) - (c.iv > 1.2 ? 10 : 0) - liqPenalty(c) - Math.abs(c.dte - W.dir[2]) * 0.12 };
  }).sort((a, b) => b.s - a.s)[0];
  if (bestDir) {
    const c = bestDir.c, be = dirType === 'call' ? c.strike + c.mid : c.strike - c.mid, move = Math.abs(be / price - 1);
    pushIdea({
      kind: dirType === 'call' ? 'directional_call' : 'directional_put', group: 'directional', name: dirType === 'call' ? 'Best call' : 'Best put', withStock: false, legs: [leg('buy', c, contracts)], net: netBlock(c.mid), rawScore: bestDir.s,
      maxLoss: { perShare: r2(c.mid), total: r2(c.mid * MULT * contracts) }, ivVsChain: c.iv && ivMedian ? r2(c.iv / ivMedian) : null,
      why: `The ${dateTxt(c.expiry)} ${money(c.strike)} ${c.type} has a delta of ${Math.abs(c.delta).toFixed(2)}, so it moves about ${Math.round(Math.abs(c.delta) * 100)} cents for each dollar in the stock, and loses about ${cash(Math.abs(c.theta || 0) * MULT)} a day to time. It costs ${cash(c.mid * MULT)} a contract and needs ${symbol || 'the stock'} ${dirType === 'call' ? 'above' : 'below'} ${money(be)} (${pctTxt(move)} away) by ${dateTxt(c.expiry)} to break even.` + (dirType === 'put' && side === 'long' ? ' Held next to the shares it softens a drop; on its own it is a bet that the stock falls.' : ''),
      whenToUse: dirType === 'call' ? 'MEM ALGO and the alert both point up and you want upside with a fixed, smaller amount at risk than buying more shares.' : 'You expect weakness, or want a hedge that can also pay on a sharp drop, and accept that the whole premium can be lost.'
    });
  }

  // rank by context
  // The context decides the order of the groups (a 25-point step between tiers, so a clearly better idea from a lower tier can still
  // climb one place); the score shown is the idea's own quality nudged by how well it fits the context.
  const tierOf = (g) => (lean === 'hedge-first' ? { hedge: 0, directional: 1, income: 2 } : { income: 0, directional: 1, hedge: 2 })[g];
  for (const i of ideas) {
    const tier = tierOf(i.group);
    i.score = Math.round(clamp(i.rawScore + (tier === 0 ? 8 : tier === 2 ? -8 : 0), 0, 100));
    i.rank = i.rawScore - tier * 25;
    delete i.rawScore;
  }
  ideas.sort((a, b) => b.rank - a.rank);
  ideas.forEach((i) => { delete i.rank; });
  if (!all.length) base.notes.push(skipped.illiquid ? 'Every contract in the loaded chain was too thin or too wide to trade sensibly.' : 'No options data with prices was found for this stock.');
  if (shares % MULT) base.notes.push(`Options cover 100 shares each, so ${contracts} contract${contracts > 1 ? 's' : ''} cover${contracts > 1 ? '' : 's'} ${contracts * MULT} of your ${shares} shares.`);
  return Object.assign(base, { price: r2(price), levels, lean: { mode: lean, reason: leanReason, dir: dirSign > 0 ? 'bull' : dirSign < 0 ? 'bear' : 'neutral', strength }, ideas, skipped, ivMedian: r4(ivMedian), contractsConsidered: all.length, asOf: now });
}

/* ---------- service: chain + price + alert levels, cached ---------- */
function atrOf(bars, len = 14) {
  if (!Array.isArray(bars) || bars.length < len + 1) return null;
  let sum = 0, prev = null;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], pc = bars[i - 1].c, tr = Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
    if (i <= len) { sum += tr; if (i === len) prev = sum / len; } else prev = (prev * (len - 1) + tr) / len;
  }
  return fin(prev) ? prev : null;
}
/** Up to `max` expirations nearest the ideal DTE of each window for this horizon (distinct, at least a week out). */
function pickExpirations(list, horizon, now, max = 3) {
  const W = WINDOWS[horizon] || WINDOWS.swing;
  const ex = [...new Set((list || []).map(String))].map((e) => ({ e, d: dteOf(e, now) })).filter((x) => x.d != null && x.d >= 5);
  const out = [];
  for (const ideal of [W.income[2], W.protect[2], W.dir[2]]) {
    const best = ex.filter((x) => !out.includes(x.e)).sort((a, b) => Math.abs(a.d - ideal) - Math.abs(b.d - ideal))[0];
    if (best && out.length < max) out.push(best.e);
  }
  return out.sort();
}

function createHedgeService({ chain = null, candles = null, alertsFor = null, ptLadder = null, now = Date.now, cacheMs = 60_000, logger = () => {} } = {}) {
  const chainCache = new Map(), expCache = new Map(), inflight = new Map();
  async function loadChain(symbol, horizon) {
    const key = symbol + ':' + horizon, hit = chainCache.get(key);
    if (hit && hit.until > now()) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      const first = await chain(symbol, '');
      if (!first || !first.ok) return { ok: false, code: (first && first.code) || 'options_unavailable' };
      const paired = chainLib.normalize(first.data);
      let exps = chainLib.expirations(first.data, paired);
      const ec = expCache.get(symbol);
      if (exps.length) expCache.set(symbol, { list: exps, until: now() + 6 * 3600_000 }); else if (ec && ec.until > now()) exps = ec.list;
      const want = pickExpirations(exps, horizon, now());
      const have = new Map(); for (const r of paired) have.set(r.expiry, (have.get(r.expiry) || 0) + 1);
      const rows = paired.filter((r) => want.includes(r.expiry) || !want.length);
      // cold options calls are rate-limited (one every ~12 s), so extra expirations get a short deadline: the answer comes from whatever is in by then
      const late = (ms) => new Promise((r) => { const t = setTimeout(() => r([]), ms); if (t.unref) t.unref(); });
      const fetched = await Promise.all(want.filter((e) => (have.get(e) || 0) < 6).slice(0, 2).map((e) => Promise.race([chain(symbol, e).then((r) => (r && r.ok ? chainLib.normalize(r.data) : []), () => []), late(EXTRA_EXP_WAIT_MS)])));
      const seen = new Set(rows.map((r) => r.expiry + '|' + r.strike));
      for (const list of fetched) for (const r of list) { const k = r.expiry + '|' + r.strike; if (!seen.has(k)) { seen.add(k); rows.push(r); } }
      return { ok: true, rows: flattenChain(rows), spot: chainLib.findSpot(first.data), expirations: want, source: first.source || (first.data && first.data.provider) || null };
    })();
    inflight.set(key, p);
    try { const value = await p; if (value.ok) chainCache.set(key, { value, until: now() + cacheMs }); if (chainCache.size > 200) chainCache.delete(chainCache.keys().next().value); return value; }
    finally { inflight.delete(key); }
  }

  /* a chain the caller already has (the stockmarketloop.com dashboard sends the moomoo chain it shows): no feed calls at all */
  function fromPayload(data, horizon) {
    try {
      const paired = chainLib.normalize(data);
      if (!paired.length) return { ok: false };
      const want = pickExpirations(chainLib.expirations(data, paired), horizon, now());
      const rows = paired.filter((r) => !want.length || want.includes(r.expiry));
      return { ok: true, rows: flattenChain(rows.length ? rows : paired), spot: chainLib.findSpot(data), expirations: want, source: 'site' };
    } catch (_) { return { ok: false }; }
  }

  /** The newest open equity alert for this symbol on the member's own desk, with the auto-PT ladder's raised stop applied. */
  async function alertLevels(symbol, userId, view) {
    if (!alertsFor || view !== 'live') return null;
    let list = [];
    try { list = (await alertsFor(userId, view)) || []; } catch (error) { logger('warn', 'hedge_alert_lookup_failed', { error }); return null; }
    const a = list.filter((x) => x && String(x.symbol).toUpperCase() === symbol && !x.closed && Number(x.entry) > 0).sort((x, y) => (y.at || 0) - (x.at || 0))[0];
    if (!a) return null;
    let stop = Number(a.plan && a.plan.stop) > 0 ? Number(a.plan.stop) : null;
    const target = Number(a.plan && a.plan.target) > 0 ? Number(a.plan.target) : (Number(a.target0) > 0 ? Number(a.target0) : null);
    const ladder = ptLadder ? ptLadder('d:' + a.id) : null;
    if (ladder && Number(ladder.stop) > 0 && (stop == null || Number(ladder.stop) > stop)) stop = Number(ladder.stop);
    return { id: String(a.id), entry: Number(a.entry), target, stop, side: 'long', at: a.at || null };
  }

  async function plan(q) {
    const symbol = String(q.symbol || '').toUpperCase();
    const horizon = WINDOWS[q.horizon] ? q.horizon : 'swing';
    if (!chain) return { ok: false, status: 503, error: 'options_unconfigured', message: 'The live options feed is not connected right now.' };
    const [ch, daily, alert] = await Promise.all([
      q.chainData ? Promise.resolve(fromPayload(q.chainData, horizon)) : loadChain(symbol, horizon).catch((error) => { logger('warn', 'hedge_chain_failed', { symbol, error }); return { ok: false }; }),
      // daily candles only refine the levels: never let a slow or rate-limited candle source hold the answer back
      candles ? Promise.race([Promise.resolve(candles(symbol, '1D')).catch(() => null), new Promise((r) => { const t = setTimeout(() => r(null), CANDLE_WAIT_MS); if (t.unref) t.unref(); })]) : null,
      // noAlerts: the stockmarketloop.com dashboard (signed /v1/group-tools/hedge) brings its own levels and never reads Academy desks
      (q.noAlerts || (q.entry > 0 && q.target > 0 && q.stop > 0)) ? null : alertLevels(symbol, q.userId, q.view)
    ]);
    if (!ch || !ch.ok) return { ok: false, status: 503, error: 'options_unavailable', message: `Options data for ${symbol} is not available right now. Try again in a minute.` };
    const bars = daily && Array.isArray(daily.bars) ? daily.bars : [];
    const last = bars.length ? Number(bars[bars.length - 1].c) : null;
    const price = last > 0 ? last : ch.spot;
    const atr = atrOf(bars);
    const side = q.side === 'short' ? 'short' : (alert && alert.side) || 'long', sgn = side === 'short' ? -1 : 1;
    const k = ATR_K[horizon];
    // each level comes from the request, else the member's alert, else MEM ALGO-style ATR multiples on daily candles
    const from = {}, val = {};
    for (const name of ['entry', 'target', 'stop']) {
      if (q[name] > 0) { val[name] = q[name]; from[name] = 'query'; }
      else if (alert && alert[name] > 0) { val[name] = alert[name]; from[name] = 'alert'; }
    }
    if (!(val.entry > 0)) { val.entry = price; from.entry = 'price'; }
    // no candles in time: a typical 2.5% daily range stands in for the ATR so the ideas still come back
    const rng = atr > 0 ? atr : (fin(price) && price > 0 ? price * 0.025 : null), how = atr > 0 ? 'atr' : 'estimate';
    if (rng > 0 && fin(price)) {
      if (!(val.stop > 0)) { val.stop = price - sgn * k[0] * rng; from.stop = how; }
      if (!(val.target > 0)) { val.target = price + sgn * k[1] * rng; from.target = how; }
    }
    const { entry, target, stop } = val;
    const source = Object.values(from).includes('alert') ? 'alert' : (Object.values(from).includes('atr') || Object.values(from).includes('estimate')) ? 'atr' : 'query';
    const out = planHedges({ symbol, price, side, shares: q.shares, entry, target, stop, horizon, memRead: { dir: q.dir, strength: q.strength }, chain: ch.rows, now: now() });
    out.levels = Object.assign({}, out.levels, { source, from, alertId: alert ? alert.id : null, atr: atr ? Math.round(atr * 100) / 100 : null });
    out.expirations = ch.expirations;
    out.optionsSource = ch.source;
    if (!out.ok) out.status = 503;
    return out;
  }
  return { plan, loadChain, alertLevels };
}

module.exports = { planHedges, createHedgeService, flattenChain, payoffAt, pickExpirations, prepare, liquidityProblem, atrOf, WINDOWS, DISCLAIMER };
