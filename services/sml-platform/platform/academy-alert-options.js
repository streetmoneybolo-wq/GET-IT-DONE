'use strict';

/* "Should a contract even be considered?" for an alert whose stock has listed options.
 *
 * Uses the whole picture the desk already has: the alert's entry and target, the plan (hold / raise / partial / sell), MEM ALGO, order-book pressure, the stock's typical daily move,
 * and the live options chain (bid/ask, implied volatility, delta, open interest, volume). It answers with CALL, PUT, WAIT or NONE, the contracts that best fit the
 * alert's time horizon, and what they cost, where they break even, what they would return if the alert's target were reached, and the warnings that go with them.
 * Educational analysis only: options can lose their entire value, and nothing here places a trade. */

const calc = require('./academy-options-calc');

const RATE = 0.043;
const fin = Number.isFinite;
const n = (v) => { if (v === null || v === undefined || v === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const pick = (o, keys) => { for (const k of keys) { const v = o && o[k]; if (v !== undefined && v !== null && v !== '') return v; } return null; };

/* ---------- chain normalisation (the data arrives in several shapes; this walks any of them) ---------- */
function sideFrom(object, prefix = '') {
  const cap = prefix ? prefix[0].toUpperCase() + prefix.slice(1) : '';
  const nested = object && object[prefix] && typeof object[prefix] === 'object' ? object[prefix] : {};
  const value = (keys) => n(pick(nested, keys)) ?? n(pick(object, keys.flatMap((k) => (prefix ? [prefix + k[0].toUpperCase() + k.slice(1), prefix + '_' + k, k + cap, k] : [k]))));
  return {
    bid: value(['bid', 'bidPrice']), ask: value(['ask', 'askPrice']), last: value(['last', 'lastPrice', 'price']), volume: value(['volume', 'vol']), oi: value(['openInterest', 'open_interest', 'oi']),
    iv: value(['impliedVolatility', 'implied_volatility', 'iv']), delta: value(['delta']), gamma: value(['gamma']), theta: value(['theta']), vega: value(['vega'])
  };
}
function normalizeChain(data) {
  const rows = new Map(), seen = new Set();
  const add = (object, hint) => {
    if (!object || typeof object !== 'object') return;
    const strike = n(pick(object, ['strike', 'strikePrice', 'strike_price', 'exercisePrice']));
    if (strike == null) return;
    const expiry = String(pick(object, ['expiration', 'expirationDate', 'expiry', 'expiryDate', 'date', 'expDate']) || 'Unknown');
    const key = `${expiry}|${strike}`;
    const row = rows.get(key) || { expiry, strike, call: null, put: null };
    const kind = String(pick(object, ['contractType', 'optionType', 'right', 'side', 'type']) || '').toLowerCase() || hint;
    if (object.call || object.calls || kind.startsWith('c')) row.call = sideFrom(object.call || object.calls || object, object.call || object.calls ? '' : 'call');
    else if (['callBid', 'callAsk', 'callIv', 'callIV', 'callDelta'].some((k) => object[k] != null)) row.call = sideFrom(object, 'call');
    if (object.put || object.puts || kind.startsWith('p')) row.put = sideFrom(object.put || object.puts || object, object.put || object.puts ? '' : 'put');
    else if (['putBid', 'putAsk', 'putIv', 'putIV', 'putDelta'].some((k) => object[k] != null)) row.put = sideFrom(object, 'put');
    if (row.call || row.put) rows.set(key, row);
  };
  const walk = (node, hint = '') => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { node.forEach((item) => walk(item, hint)); return; }
    add(node, hint);
    for (const [key, value] of Object.entries(node)) { const lower = key.toLowerCase(); walk(value, lower.includes('call') ? 'call' : lower.includes('put') ? 'put' : hint); }
  };
  walk(data);
  return [...rows.values()].sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike);
}

const dteOf = (expiry, now) => { const end = Date.parse(`${expiry}T21:00:00Z`); return Number.isFinite(end) ? Math.max(0, Math.ceil((end - now) / 86_400_000)) : null; };
const mid = (s) => (s && s.bid > 0 && s.ask > 0 ? (s.bid + s.ask) / 2 : null);
const money = (v) => `$${Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2)}`;

const HORIZON = {
  swings: { dteMin: 7, dteMax: 45, dteIdeal: 21, delta: 0.55, deltaLo: 0.38, deltaHi: 0.72 },
  longterm: { dteMin: 90, dteMax: 300, dteIdeal: 160, delta: 0.70, deltaLo: 0.52, deltaHi: 0.86 }
};

/** input: { alert, price, atrPct, plan, algoView, flow, rows (normalized chain), now } */
function considerOptions(input) {
  const { alert, price, plan, algoView, flow, rows, now = Date.now() } = input;
  const channel = alert.channel === 'longterm' ? 'longterm' : 'swings';
  const H = HORIZON[channel];
  const out = (verdict, extra) => Object.assign({ verdict, available: true, channel, note: 'Educational analysis. Options can lose their entire value, and nothing here places a trade.' }, extra);
  if (!Array.isArray(rows) || !rows.length) return { verdict: 'NONE', available: false, reason: 'No listed options were found for this stock.', channel };
  if (!fin(price) || !(price > 0)) return out('WAIT', { reason: 'Waiting for a live price.' });

  const atrPct = fin(input.atrPct) && input.atrPct > 0 ? input.atrPct : 0.04;
  const bearish = (algoView && (algoView.bias === 'short' || algoView.bias === 'bounce')) || (flow && flow.bias === 'bearish');
  const strongBear = algoView && algoView.bias === 'short' && (!flow || flow.bias !== 'bullish') && price < alert.entry;
  let side = 'call';
  const why = [];
  if (plan && plan.action === 'SELL') {
    if (strongBear) { side = 'put'; why.push('The plan says sell and MEM ALGO is bearish, so if you want a position at all it would be a put, not a call'); }
    else return out('WAIT', { reason: 'The plan says take profits or exit. That is not the moment to open a new contract on this alert.', planAction: plan.action });
  } else if (bearish && algoView && algoView.bias === 'short') return out('WAIT', { reason: 'MEM ALGO is bearish on this stock, so a call fights the trend and there is no clear put case yet.' });
  else why.push(plan && plan.action === 'RAISE_TARGET' ? 'The plan is raising the target, so momentum favours the upside' : plan && plan.action === 'PARTIAL' ? 'The plan is taking partial profits, so any new call is a smaller, riskier add' : 'The alert is a long idea and the plan is still on');

  const target = side === 'call' ? Math.max(plan && plan.target ? plan.target : alert.target, alert.target) : price - 2 * atrPct * price;
  const cands = [];
  for (const r of rows) {
    const dte = dteOf(r.expiry, now);
    if (dte == null || dte < H.dteMin || dte > H.dteMax) continue;
    const s = side === 'call' ? r.call : r.put;
    if (!s) continue;
    const m = mid(s);
    if (m == null || m < 0.05) continue;
    const spread = (s.ask - s.bid) / m;
    if (m < 1 ? s.ask - s.bid > 0.1 : spread > 0.12) continue;
    if (!((s.oi || 0) >= 50 || (s.volume || 0) >= 25)) continue;
    const T = dte / 365, iv = s.iv != null ? (s.iv > 3 ? s.iv / 100 : s.iv) : null;
    let delta = s.delta != null ? Math.abs(s.delta) : null;
    if (delta == null && iv) { const p = calc.price(side, price, r.strike, T, RATE, 0, iv); delta = p ? Math.abs(p.delta) : null; }
    if (delta == null) continue;
    if (delta < H.deltaLo || delta > H.deltaHi) continue;
    const breakeven = side === 'call' ? r.strike + m : r.strike - m;
    const needPct = side === 'call' ? breakeven / price - 1 : 1 - breakeven / price;
    const atTarget = side === 'call' ? Math.max(0, target - r.strike) : Math.max(0, r.strike - target);
    const returnAtTarget = (atTarget - m) / m;
    let prob = null, theta = s.theta;
    if (iv) { const p = calc.price(side, price, r.strike, T, RATE, 0, iv); if (p) { prob = p.probITM; if (theta == null) theta = p.theta; } }
    const thetaPct = theta != null ? Math.abs(theta) / m : null;
    const targetMove = Math.abs(target / price - 1);
    let score = 100 - Math.abs(delta - H.delta) * 120 - spread * 220 - Math.abs(dte - H.dteIdeal) * (channel === 'longterm' ? 0.12 : 0.6) + Math.log10((s.oi || 0) + 1) * 4;
    if (needPct > targetMove) score -= 25; // it cannot pay unless price goes past the alert's own target
    if (thetaPct != null && thetaPct > 0.05) score -= 8;
    cands.push({ type: side.toUpperCase(), expiry: r.expiry, dte, strike: r.strike, bid: s.bid, ask: s.ask, mid: Math.round(m * 100) / 100, spreadPct: spread, iv, delta, oi: s.oi || 0, volume: s.volume || 0, breakeven: Math.round(breakeven * 100) / 100, needPct, returnAtTarget, probITM: prob, thetaPct, costPerContract: Math.round(m * 100), score });
  }
  if (!cands.length) return out('NONE', { reason: `No ${side} contract in the ${H.dteMin}-${H.dteMax} day window is liquid enough (tight spread, real open interest) at the right strike for this alert.`, side: side.toUpperCase() });
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  const flags = [];
  if (best.iv != null && best.iv > 1.2) flags.push(`Implied volatility is ${(best.iv * 100).toFixed(0)}%: the premium is expensive and can shrink even if price moves your way`);
  if (best.thetaPct != null && best.thetaPct > 0.04) flags.push(`Time decay is about ${(best.thetaPct * 100).toFixed(1)}% of the premium a day`);
  if (best.needPct > Math.abs(target / price - 1)) flags.push('It only pays if price goes beyond the alert\'s own target');
  if (best.spreadPct > 0.08) flags.push(`The bid-ask spread is ${(best.spreadPct * 100).toFixed(0)}% of the price: getting out costs real money`);
  if (price < 5) flags.push('Low-priced stock: options here are thin and can gap');
  if (best.dte < 14) flags.push(`Only ${best.dte} days left: a short fuse`);
  if (input.riskBand === 'HIGH' || input.riskBand === 'EXTREME') flags.push('The stock itself grades high risk');
  const worth = best.score >= 55 && flags.length <= 2 && best.returnAtTarget > 0.25;
  const label = `${new Date(`${best.expiry}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} ${money(best.strike)} ${side}`;
  const summary = `${label} (${best.dte} days) costs about ${money(best.costPerContract)} a contract. It breaks even at ${money(best.breakeven)} (${side === 'call' ? '+' : '-'}${(best.needPct * 100).toFixed(1)}%)`
    + (best.returnAtTarget > 0 ? ` and would be worth about ${Math.round(best.returnAtTarget * 100)}% more than you paid at ${money(target)}, ignoring time value.` : ` and would still lose money at ${money(target)}.`);
  return out(side.toUpperCase(), { side: side.toUpperCase(), strength: worth ? 'Worth a look' : 'Marginal', reason: why.join('. '), summary, contract: best, alternatives: cands.slice(1, 3), flags, target: Math.round(target * 100) / 100, considered: cands.length });
}

module.exports = { normalizeChain, considerOptions, dteOf, HORIZON };
