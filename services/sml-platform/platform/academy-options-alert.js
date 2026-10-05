'use strict';

/* Options contract alerts for Click-to-Alert. A member sets a target on the chart (the stock alert), then picks a contract in the options chain: this turns
 * that stock thesis into the contract's terms using the LIVE chain quote (never a price sent by the browser).
 *
 * What is estimated, and how: the contract is repriced with Black-Scholes at the stock's target and stop, with the volatility the chain shows for that contract
 * and the time left after the alert's own horizon estimate (fast, base and slow cases). That is a model estimate, not a quote: real contracts trade on their own
 * bid/ask and volatility moves with the stock. Every figure is labelled as an estimate and the alert says so. Educational only; nothing is traded. */
const calc = require('./academy-options-calc');
const OC = require('./academy-option-contract');

const fin = Number.isFinite;
const r2 = (v) => Math.round(v * 100) / 100;
const pct = (v) => Math.round(v * 1000) / 10;
const RATE = 0.043;

class OptionsAlertError extends Error { constructor(code, detail = '') { super(code); this.code = code; this.detail = detail; } }

const mid = (leg) => {
  if (!leg) return null;
  const b = Number(leg.bid), a = Number(leg.ask), l = Number(leg.last);
  if (b > 0 && a >= b) return (a + b) / 2;
  if (fin(l) && l > 0) return l;
  return null;
};

function daysTo(expiry, now) {
  const t = Date.parse(String(expiry).slice(0, 10) + 'T20:00:00Z'); // 4 pm Eastern is 20:00 or 21:00 UTC; the later bound is not needed for day counts
  return fin(t) ? (t - now) / 86_400_000 : null;
}

/* the alert's horizon estimate is in TRADING days; options decay in calendar days */
const calendarDays = (tradingDays) => tradingDays * (7 / 5);

function findContract(rows, { type, strike, expiry }) {
  const k = Number(strike);
  for (const r of rows || []) {
    if (r && r.expiry === expiry && Math.abs(Number(r.strike) - k) < 1e-6 && r[type]) return { row: r, leg: r[type] };
  }
  return null;
}

function liquidity(leg) {
  const oi = fin(Number(leg.oi ?? leg.open_interest)) ? Number(leg.oi ?? leg.open_interest) : null;
  const vol = fin(Number(leg.volume)) ? Number(leg.volume) : null;
  const b = Number(leg.bid), a = Number(leg.ask);
  const spreadPct = b > 0 && a >= b ? (a - b) / ((a + b) / 2) : null;
  let grade = 'good'; const why = [];
  if (spreadPct == null) { grade = 'unknown'; why.push('no two-sided quote'); }
  else if (spreadPct > 0.2) { grade = 'poor'; why.push(`bid/ask is ${Math.round(spreadPct * 100)}% wide`); }
  else if (spreadPct > 0.1) { grade = 'fair'; why.push(`bid/ask is ${Math.round(spreadPct * 100)}% wide`); }
  if (oi != null && oi < 100) { grade = grade === 'good' ? 'fair' : 'poor'; why.push(`open interest only ${oi}`); }
  if (vol != null && vol === 0) { if (grade === 'good') grade = 'fair'; why.push('no trades today'); }
  return { grade, oi, volume: vol, spreadPct, why };
}

/* analysis: the Click-to-Alert stock analysis (side, entry, target, stop, horizon, expectedDays, ...). contract: { type, strike, expiry }. */
function buildOptionsAlert({ analysis, rows, contract, now = Date.now(), rate = RATE, divYield = 0 }) {
  const type = String(contract && contract.type || '').toLowerCase().startsWith('p') ? 'put' : String(contract && contract.type || '').toLowerCase().startsWith('c') ? 'call' : '';
  const strike = Number(contract && contract.strike), expiry = String(contract && contract.expiry || '').slice(0, 10);
  if (!type || !(strike > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw new OptionsAlertError('invalid_contract', 'Pick a call or put from the options chain.');
  const long = analysis.side === 'long';
  if ((long && type === 'put') || (!long && type === 'call')) throw new OptionsAlertError('contract_conflicts_with_target', long ? 'Your target is above the live price, so a call fits the idea. A put would profit if the stock falls.' : 'Your target is below the live price, so a put fits the idea. A call would profit if the stock rises.');
  const found = findContract(rows, { type, strike, expiry });
  if (!found) throw new OptionsAlertError('contract_not_found', 'That contract is not in the live options chain right now. Reload the chain and pick it again.');
  const entryPx = mid(found.leg);
  if (!(entryPx > 0)) throw new OptionsAlertError('contract_not_priced', 'That contract has no current quote.');
  const dte = daysTo(expiry, now);
  if (dte == null || dte < 0.5) throw new OptionsAlertError('contract_expired', 'That contract expires today or has expired.');

  const S0 = Number(analysis.entry), tgt = Number(analysis.target), stp = Number(analysis.stop);
  let iv = Number(found.leg.iv);
  if (fin(iv) && iv > 3) iv /= 100; // some feeds give percent
  if (!(iv > 0 && iv < 6)) iv = calc.impliedVol(type, S0, strike, dte / 365, rate, divYield, entryPx);
  if (!(iv > 0)) throw new OptionsAlertError('contract_not_priced', 'The volatility for that contract could not be read.');
  const T0 = dte / 365;
  const now0 = calc.price(type, S0, strike, T0, rate, divYield, iv);
  const ed = analysis.expectedDays || { low: 1, mid: 3, high: 8 };
  const valueAt = (S, daysLater) => {
    const T = Math.max(0.0001, (dte - daysLater) / 365);
    const p = calc.price(type, S, strike, T, rate, divYield, iv);
    return p ? Math.max(0, p.price) : null;
  };
  const dLow = calendarDays(ed.low), dMid = calendarDays(ed.mid), dHigh = calendarDays(ed.high);
  const atTarget = { fast: valueAt(tgt, dLow), base: valueAt(tgt, dMid), slow: valueAt(tgt, dHigh) };
  const atStop = valueAt(stp, Math.min(dMid, dte * 0.8));
  const expiryIntrinsic = type === 'call' ? Math.max(0, tgt - strike) : Math.max(0, strike - tgt);
  const ret = (v) => (v == null ? null : pct(v / entryPx - 1));
  const breakeven = type === 'call' ? strike + entryPx : strike - entryPx;
  const beMovePct = pct((breakeven - S0) / S0);
  const targetMovePct = pct((tgt - S0) / S0);
  const contractCost = Math.round(entryPx * 100);
  const liq = liquidity(found.leg);
  const warnings = [];
  if (dte < calendarDays(ed.high) + 2) warnings.push(`Expires in ${Math.round(dte)} days, which is about as long as the slow-case estimate (${Math.round(calendarDays(ed.high))} days): time decay can eat the gain even if the stock gets there.`);
  else if (dte < calendarDays(ed.mid) * 1.5) warnings.push(`Expires in ${Math.round(dte)} days, close to the ${Math.round(calendarDays(ed.mid))}-day base case. A later expiry gives the idea more room.`);
  if (liq.grade === 'poor') warnings.push(`Liquidity is poor (${liq.why.join(', ')}): expect to give up a lot to get in and out. Use a limit order near the mid.`);
  else if (liq.grade === 'fair' || liq.grade === 'unknown') warnings.push(`Liquidity is only fair (${liq.why.join(', ')}). Use a limit order near the mid.`);
  const target_in_money = type === 'call' ? tgt > strike : tgt < strike;
  if (!target_in_money) warnings.push('At your target the contract would still be out of the money, so its value there is mostly time value and is very sensitive to volatility and timing.');
  if (breakeven && ((type === 'call' && breakeven >= tgt) || (type === 'put' && breakeven <= tgt))) warnings.push('The breakeven is beyond your target: even if the stock reaches the target by expiry, this contract would not be profitable at expiry.');
  warnings.push('Options can lose their whole premium. Estimates assume the volatility stays where it is now; if it falls, the contract is worth less than shown.');

  const risk = dte <= 2 ? 'extreme' : dte <= 8 || liq.grade === 'poor' ? 'high' : dte <= 35 ? 'mid-high' : 'mid';
  const occ = OC.contract({ symbol: analysis.symbol, expiry, strike, side: type });
  return {
    ok: true,
    contract: {
      symbol: analysis.symbol, type, strike, expiry, dte: Math.round(dte * 10) / 10,
      occ: occ ? OC.occSymbol(occ) : null, name: occ ? OC.describe(occ) : `${analysis.symbol} ${expiry} ${strike} ${type}`,
      bid: fin(Number(found.leg.bid)) ? Number(found.leg.bid) : null, ask: fin(Number(found.leg.ask)) ? Number(found.leg.ask) : null,
      mid: r2(entryPx), last: fin(Number(found.leg.last)) ? Number(found.leg.last) : null, perContract: contractCost,
      iv: Math.round(iv * 1000) / 10, delta: now0 ? Math.round(now0.delta * 1000) / 1000 : null, gamma: now0 ? Math.round(now0.gamma * 10000) / 10000 : null,
      thetaPerDay: now0 ? r2(now0.theta) : null, vegaPer1pct: now0 ? r2(now0.vega) : null, probITMPct: now0 ? Math.round(now0.probITM * 100) : null,
      oi: liq.oi, volume: liq.volume, spreadPct: liq.spreadPct == null ? null : Math.round(liq.spreadPct * 1000) / 10, liquidity: liq.grade
    },
    estimates: {
      basis: 'Black-Scholes at the contract\'s current implied volatility, repriced at the stock\'s target and stop',
      atTarget: { fast: atTarget.fast == null ? null : r2(atTarget.fast), base: atTarget.base == null ? null : r2(atTarget.base), slow: atTarget.slow == null ? null : r2(atTarget.slow), basePct: ret(atTarget.base), fastPct: ret(atTarget.fast), slowPct: ret(atTarget.slow), days: { fast: Math.round(dLow * 10) / 10, base: Math.round(dMid * 10) / 10, slow: Math.round(dHigh * 10) / 10 } },
      atStop: { value: atStop == null ? null : r2(atStop), pct: ret(atStop) },
      atExpiryIfTarget: { value: r2(expiryIntrinsic), pct: pct(expiryIntrinsic / entryPx - 1) },
      breakeven: r2(breakeven), breakevenMovePct: beMovePct, targetMovePct, maxLoss: contractCost
    },
    risk, warnings
  };
}

module.exports = { buildOptionsAlert, findContract, liquidity, OptionsAlertError, calendarDays, mid };
