'use strict';

/* Gamma pressure for one symbol: how many shares dealer hedging is forced to trade per 1% move, and whether that is big
 * enough, against the stock's own daily volume, to matter. Built on the chain the options panel already loads and the GEX
 * math the news engine already ships (news-engine/src/triggers/options.js).
 *
 * Dealer side is NOT observable: the public convention (calls positive, puts negative) is an assumption. Where a contract's
 * last print sits inside its own bid/ask we read it as a customer buy (dealer short) or sell (dealer long) and build an
 * INFERRED net alongside the standard one. Both are reported, both are labelled; neither is a measurement. Educational. */

const { flattenChain } = require('./academy-sentiment');
const { etParts } = require('./market-clock');

let optionsMath = null;
try { optionsMath = require('../news-engine/src/triggers/options'); } catch (_) { optionsMath = null; }

const CONTRACT = 100;
const num = (v, d = null) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const round = (v, p = 0) => (Number.isFinite(v) ? Math.round(v * 10 ** p) / 10 ** p : null);

/* +1 dealer long (customer sold near the bid), -1 dealer short (customer bought near the ask), 0 no read */
function inferDealerSide(c) {
  const bid = num(c.bid), ask = num(c.ask), last = num(c.last);
  if (bid == null || ask == null || last == null || !(ask > bid) || last <= 0) return 0;
  const pos = (last - bid) / (ask - bid);
  if (pos >= 0.65) return -1;
  if (pos <= 0.35) return 1;
  return 0;
}

function etDate(now) { const e = etParts(now); return `${e.y}-${String(e.m).padStart(2, '0')}-${String(e.d).padStart(2, '0')}`; }

function averageVolume(bars, n = 20) {
  const v = (Array.isArray(bars) ? bars : []).map((b) => num(b && b.v, 0)).filter((x) => x > 0).slice(-n);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function pressureBand(pct) {
  if (pct == null) return null;
  if (pct < 0.5) return 'low'; if (pct < 2) return 'moderate'; if (pct < 5) return 'high'; return 'extreme';
}

function analyzeGamma(rows, { underlying = null, bars = [], now = Date.now(), math = optionsMath } = {}) {
  const S = num(underlying);
  const contracts = flattenChain(rows, S);
  if (!math || typeof math.gammaExposure !== 'function') return { available: false, reason: 'options_math_missing' };
  if (contracts.length < 10) return { available: false, reason: 'no_chain', contracts: contracts.length };
  if (!(S > 0)) return { available: false, reason: 'no_price', contracts: contracts.length };

  const gex = math.gammaExposure(contracts, S);
  let pain = null; try { pain = math.maxPain(contracts); } catch (_) { pain = null; }

  // inferred dealer side from where each contract last printed in its spread; contracts with no read keep the standard sign
  let inferredNet = 0, readOi = 0, totalOi = 0, zeroDteOi = 0;
  const today = etDate(now);
  for (const c of contracts) {
    const g = num(c.gamma), oi = num(c.open_interest, 0);
    if (oi > 0) { totalOi += oi; if (String(c.expiration || '').slice(0, 10) === today) zeroDteOi += oi; }
    if (!g || !oi) continue;
    const magnitude = g * oi * CONTRACT * S * S * 0.01;
    const side = inferDealerSide(c);
    if (side !== 0) { readOi += oi; inferredNet += side * magnitude; }
    else inferredNet += (c.type === 'call' ? 1 : -1) * magnitude;
  }
  const inferredCoverage = totalOi > 0 ? readOi / totalOi : 0;
  const basis = inferredCoverage >= 0.5 ? 'inferred' : 'standard';
  const net = basis === 'inferred' ? inferredNet : gex.net_gex;

  const hedgeShares = net / S; // dollars of delta per 1% move, in shares of the underlying
  const adv = averageVolume(bars);
  const pressurePct = adv ? Math.abs(hedgeShares) / adv * 100 : null;

  const above = gex.by_strike.filter((r) => r.strike > S), below = gex.by_strike.filter((r) => r.strike < S);
  const callWall = above.length ? above.reduce((m, r) => (r.call_oi > m.call_oi ? r : m)) : null;
  const putWall = below.length ? below.reduce((m, r) => (r.put_oi > m.put_oi ? r : m)) : null;
  const flip = num(gex.flip_strike);

  return {
    available: true, asOf: now, price: S, contracts: contracts.length,
    regime: net > 0 ? 'positive' : 'negative',
    interpretation: net > 0 ? 'Dealer hedging tends to dampen moves' : 'Dealer hedging tends to amplify moves',
    netGex: Math.round(net), standardNetGex: Math.round(gex.net_gex), inferredNetGex: Math.round(inferredNet),
    basis, inferredCoverage: round(inferredCoverage, 2),
    hedgeShares: Math.round(hedgeShares), hedgeSharesAbs: Math.round(Math.abs(hedgeShares)),
    adv: adv ? Math.round(adv) : null, pressurePct: round(pressurePct, 2), pressure: pressureBand(pressurePct),
    flipStrike: flip, flipDistancePct: flip ? round((flip - S) / S * 100, 2) : null, flipIsApproximate: true,
    callWall: callWall ? { strike: callWall.strike, oi: callWall.call_oi, distancePct: round((callWall.strike - S) / S * 100, 2) } : null,
    putWall: putWall ? { strike: putWall.strike, oi: putWall.put_oi, distancePct: round((S - putWall.strike) / S * 100, 2) } : null,
    peakStrike: num(gex.peak_strike), maxPain: pain && pain.strike != null ? pain.strike : null,
    zeroDteShare: totalOi > 0 ? round(zeroDteOi / totalOi, 3) : null,
    byStrike: gex.by_strike.filter((r) => Math.abs(r.strike - S) / S <= 0.15).map((r) => ({ strike: r.strike, net: Math.round(r.net_gex), callOi: r.call_oi, putOi: r.put_oi })),
    note: 'Dealer positioning is inferred, not observed. Educational context, not a trade signal.'
  };
}

function createGammaService({ chain, candles, quote, now = Date.now, ttlMs = 60_000, logger = () => {}, math = optionsMath } = {}) {
  const cache = new Map(), inflight = new Map();
  const safe = async (name, fn) => { try { return await fn(); } catch (error) { logger('warn', 'gamma_input_failed', { input: name, error }); return null; } };
  async function compute(symbol) {
    const [rows, daily, q] = await Promise.all([safe('chain', () => chain(symbol)), safe('candles', () => candles(symbol, '1D')), safe('quote', () => (quote ? quote(symbol) : null))]);
    const bars = daily && Array.isArray(daily.bars) ? daily.bars : Array.isArray(daily) ? daily : [];
    const qp = q ? num(q.price ?? q.last) : null;
    const underlying = qp > 0 ? qp : (bars.length ? num(bars[bars.length - 1].c) : null);
    const out = rows && rows.available === false ? { available: false, reason: rows.reason || 'no_chain' } : analyzeGamma(rows, { underlying, bars, now: now(), math });
    return { ok: true, symbol, ...out };
  }
  async function get(symbol) {
    const key = String(symbol || '').toUpperCase();
    const hit = cache.get(key); if (hit && hit.until > now()) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
    const p = compute(key).then((v) => { cache.set(key, { until: now() + ttlMs, value: v }); if (cache.size > 300) cache.delete(cache.keys().next().value); return v; }).finally(() => inflight.delete(key));
    inflight.set(key, p); return p;
  }
  return { get };
}

module.exports = { analyzeGamma, createGammaService, inferDealerSide, averageVolume, pressureBand };
