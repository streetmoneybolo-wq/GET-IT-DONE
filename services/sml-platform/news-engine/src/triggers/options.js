/* =============================================================================
 * StockMarketLoop News Engine — options analytics
 *
 * Pure math over the moomoo option chain from
 *   GET /wp-json/sml-options-intelligence/v1/chain?symbol=X
 *
 * Verified live shape (NVDA, 2026-08-22): 21 expirations, 154 contracts each,
 * every contract carrying strike / type / volume / open_interest / iv and the
 * full greeks (delta, gamma, theta, vega, rho), with `underlying` on the root
 * and freshness:"live".
 *
 * WHY THIS FILE EXISTS
 * Categories 1 (unusual options activity) and 7 (gamma mechanics) do not need a
 * data vendor — they are DERIVED from open interest, volume, strikes and gamma,
 * all of which are already in the chain. The `options-flow` dataset that returns
 * 403 on the current plan would supply per-trade sweep/block tape, which is nice
 * to have but is not what these signals require.
 *
 * Everything here is deterministic. No network, no clock unless passed in.
 * ========================================================================== */

'use strict';

const CONTRACT_MULTIPLIER = 100;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function isCall(c) { return String(c.type || '').toLowerCase() === 'call'; }
function isPut(c) { return String(c.type || '').toLowerCase() === 'put'; }

/** Mid price, falling back to last when a side of the book is missing. */
function midPrice(c) {
  const bid = num(c.bid, NaN);
  const ask = num(c.ask, NaN);
  if (Number.isFinite(bid) && Number.isFinite(ask) && ask > 0) return (bid + ask) / 2;
  return num(c.last, 0);
}

/** Notional premium traded today, in dollars. */
function premiumTraded(c) {
  return num(c.volume) * midPrice(c) * CONTRACT_MULTIPLIER;
}

function groupByExpiration(contracts) {
  const out = new Map();
  for (const c of contracts || []) {
    const k = c.expiration || 'unknown';
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(c);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Unusual activity — Category 1                                               */
/* -------------------------------------------------------------------------- */

/**
 * A contract whose day volume exceeds its open interest is, by definition,
 * mostly NEW positioning rather than existing holders trading among themselves.
 * That ratio is the cleanest unusual-activity signal available without a
 * per-trade tape, and it needs no vendor beyond the chain.
 *
 * Contracts with zero OI are excluded from the ratio test — a new listing shows
 * an infinite ratio on a single lot, which is noise, not a whale. They can still
 * qualify on absolute premium.
 */
function unusualActivity(contracts, opts = {}) {
  const minVolume = opts.minVolume != null ? opts.minVolume : 250;
  const minRatio = opts.minRatio != null ? opts.minRatio : 2.0;
  const minPremium = opts.minPremium != null ? opts.minPremium : 250000;

  const hits = [];
  for (const c of contracts || []) {
    const volume = num(c.volume);
    const oi = num(c.open_interest);
    const premium = premiumTraded(c);
    if (volume < minVolume && premium < minPremium) continue;

    const ratio = oi > 0 ? volume / oi : null;
    const qualifies = (ratio !== null && ratio >= minRatio && volume >= minVolume)
                   || premium >= minPremium;
    if (!qualifies) continue;

    hits.push({
      ticker: c.ticker,
      type: isCall(c) ? 'call' : 'put',
      strike: num(c.strike),
      expiration: c.expiration,
      volume,
      open_interest: oi,
      vol_oi_ratio: ratio === null ? null : Math.round(ratio * 100) / 100,
      premium: Math.round(premium),
      iv: num(c.iv, null),
      /* Volume above OI means the position is being opened today rather than
         recycled — the distinction that separates a whale from churn. */
      likely_opening: ratio !== null && ratio > 1
    });
  }

  hits.sort((a, b) => b.premium - a.premium);
  return hits;
}

/** Put/call ratios by traded volume and by open interest. */
function putCallRatio(contracts) {
  let cv = 0, pv = 0, coi = 0, poi = 0;
  for (const c of contracts || []) {
    if (isCall(c)) { cv += num(c.volume); coi += num(c.open_interest); }
    else if (isPut(c)) { pv += num(c.volume); poi += num(c.open_interest); }
  }
  return {
    volume: cv > 0 ? Math.round((pv / cv) * 1000) / 1000 : null,
    open_interest: coi > 0 ? Math.round((poi / coi) * 1000) / 1000 : null,
    call_volume: cv, put_volume: pv, call_oi: coi, put_oi: poi
  };
}

/* -------------------------------------------------------------------------- */
/* Gamma exposure — Category 7                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Gamma exposure per strike, in dollars of delta per 1% move.
 *
 *   GEX = gamma × OI × 100 × S² × 0.01
 *
 * SIGN CONVENTION — this is an assumption, not a measurement. The standard
 * public formulation assumes dealers are net SHORT calls (sold to retail) and
 * net LONG puts, so call gamma is positive and put gamma negative. Nothing in
 * the chain reveals actual dealer inventory; if that assumption is wrong for a
 * given name the sign flips. Stated here rather than buried, because an article
 * asserting "dealers are short gamma" is making a claim this data cannot prove.
 */
function gammaExposure(contracts, underlying, opts = {}) {
  const S = num(underlying);
  if (!S) return { by_strike: [], net_gex: 0, flip_strike: null, note: 'no underlying price' };

  const dealerShortCalls = opts.dealerShortCalls !== false;
  const byStrike = new Map();

  for (const c of contracts || []) {
    const gamma = num(c.gamma);
    const oi = num(c.open_interest);
    if (!gamma || !oi) continue;

    const strike = num(c.strike);
    const magnitude = gamma * oi * CONTRACT_MULTIPLIER * S * S * 0.01;
    const signed = isCall(c)
      ? (dealerShortCalls ? magnitude : -magnitude)
      : (dealerShortCalls ? -magnitude : magnitude);

    const row = byStrike.get(strike) || { strike, call_gex: 0, put_gex: 0, net_gex: 0, call_oi: 0, put_oi: 0 };
    if (isCall(c)) { row.call_gex += signed; row.call_oi += oi; }
    else { row.put_gex += signed; row.put_oi += oi; }
    row.net_gex = row.call_gex + row.put_gex;
    byStrike.set(strike, row);
  }

  const rows = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  const netGex = rows.reduce((sum, r) => sum + r.net_gex, 0);

  /* Flip strike: where cumulative GEX from the low end crosses zero. This is an
     approximation of the true flip level, which would require repricing the
     chain at each candidate spot. Labelled as approximate in the output so an
     article never presents it as an exact level. */
  let cumulative = 0;
  let flip = null;
  for (let i = 0; i < rows.length; i++) {
    const prev = cumulative;
    cumulative += rows[i].net_gex;
    if (prev < 0 && cumulative >= 0) { flip = rows[i].strike; break; }
    if (prev > 0 && cumulative <= 0) { flip = rows[i].strike; break; }
  }

  const peak = rows.reduce((m, r) => (m && Math.abs(m.net_gex) >= Math.abs(r.net_gex) ? m : r), null);

  return {
    by_strike: rows,
    net_gex: Math.round(netGex),
    flip_strike: flip,
    flip_is_approximate: true,
    peak_strike: peak ? peak.strike : null,
    regime: netGex > 0 ? 'positive_gamma' : 'negative_gamma',
    dealer_assumption: dealerShortCalls ? 'dealers short calls, long puts' : 'inverted',
    /* Positive gamma implies dealers hedge against the move (dampening);
       negative implies they hedge with it (amplifying). */
    interpretation: netGex > 0
      ? 'Dealer hedging tends to dampen moves'
      : 'Dealer hedging tends to amplify moves'
  };
}

/**
 * Max pain — the strike at which the total intrinsic value owed to option
 * holders at expiry is lowest. Computed over open interest only; day volume is
 * irrelevant to what expires.
 */
function maxPain(contracts) {
  const strikes = [...new Set((contracts || []).map((c) => num(c.strike)).filter(Boolean))].sort((a, b) => a - b);
  if (!strikes.length) return { strike: null, pain: null };

  let best = null;
  for (const K of strikes) {
    let pain = 0;
    for (const c of contracts) {
      const oi = num(c.open_interest);
      if (!oi) continue;
      const strike = num(c.strike);
      if (isCall(c) && K > strike) pain += (K - strike) * oi * CONTRACT_MULTIPLIER;
      else if (isPut(c) && K < strike) pain += (strike - K) * oi * CONTRACT_MULTIPLIER;
    }
    if (!best || pain < best.pain) best = { strike: K, pain: Math.round(pain) };
  }
  return best;
}

/** Implied-vol skew: puts richer than calls is the usual state; the inverse is news. */
function ivSkew(contracts, underlying) {
  const S = num(underlying);
  if (!S) return null;

  const near = (contracts || []).filter((c) => {
    const k = num(c.strike);
    return k > 0 && Math.abs(k - S) / S <= 0.1 && num(c.iv) > 0;
  });
  if (near.length < 4) return null;

  const avg = (list) => list.reduce((a, c) => a + num(c.iv), 0) / (list.length || 1);
  const callIv = avg(near.filter(isCall));
  const putIv = avg(near.filter(isPut));
  if (!callIv || !putIv) return null;

  return {
    call_iv: Math.round(callIv * 10000) / 10000,
    put_iv: Math.round(putIv * 10000) / 10000,
    skew: Math.round((putIv - callIv) * 10000) / 10000,
    /* Calls bid over puts near the money is unusual and usually means a
       directional bet rather than hedging demand. */
    call_skew: callIv > putIv
  };
}

/** Contracts expiring today — the 0DTE bucket in Category 1. */
function zeroDTE(contracts, today) {
  const d = today || new Date().toISOString().slice(0, 10);
  const same = (contracts || []).filter((c) => c.expiration === d);
  if (!same.length) return null;
  const volume = same.reduce((a, c) => a + num(c.volume), 0);
  const premium = same.reduce((a, c) => a + premiumTraded(c), 0);
  return { expiration: d, contracts: same.length, volume, premium: Math.round(premium) };
}

/* -------------------------------------------------------------------------- */
/* Chain analysis -> triggers                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Turn one chain response into zero or more triggers.
 *
 * Stale chains produce NOTHING. A trigger derived from a stale snapshot would
 * generate an article claiming a move that may already be over, which is the
 * failure mode worth being strict about on a finance site.
 */
function analyzeChain(chain, opts = {}) {
  const triggers = [];
  if (!chain || typeof chain !== 'object') return { triggers, skipped: 'no chain' };
  if (chain.stale === true || chain.freshness === 'stale') {
    return { triggers, skipped: 'stale chain — refusing to derive signals' };
  }

  const contracts = Array.isArray(chain.contracts) ? chain.contracts : [];
  if (!contracts.length) return { triggers, skipped: 'no contracts' };

  const symbol = chain.symbol;
  const underlying = num(chain.underlying);

  const unusual = unusualActivity(contracts, opts);
  const pcr = putCallRatio(contracts);
  const gex = gammaExposure(contracts, underlying, opts);
  const pain = maxPain(contracts);
  const skew = ivSkew(contracts, underlying);
  const odte = zeroDTE(contracts, opts.today);

  const totalPremium = unusual.reduce((a, h) => a + h.premium, 0);

  if (unusual.length) {
    const top = unusual[0];
    triggers.push({
      type: 'unusual_options_activity',
      category: 1,
      symbol,
      strength: Math.min(100, Math.round(Math.log10(Math.max(totalPremium, 1)) * 12)),
      evidence: {
        contracts_flagged: unusual.length,
        total_premium: totalPremium,
        top_contract: top,
        put_call_volume_ratio: pcr.volume,
        underlying
      },
      headline_facts: [
        `${unusual.length} contract(s) with unusual activity`,
        `$${Math.round(totalPremium / 1000)}k premium traded`,
        `largest: ${top.type} $${top.strike} exp ${top.expiration}, ${top.volume} lots vs ${top.open_interest} OI`
      ]
    });
  }

  if (gex.by_strike.length) {
    triggers.push({
      type: 'gamma_positioning',
      category: 7,
      symbol,
      strength: gex.flip_strike && underlying
        ? Math.max(0, 100 - Math.round(Math.abs(underlying - gex.flip_strike) / underlying * 500))
        : 30,
      evidence: {
        net_gex: gex.net_gex,
        regime: gex.regime,
        flip_strike: gex.flip_strike,
        flip_is_approximate: true,
        peak_strike: gex.peak_strike,
        max_pain: pain.strike,
        underlying,
        dealer_assumption: gex.dealer_assumption
      },
      headline_facts: [
        `Net gamma exposure ${gex.net_gex >= 0 ? 'positive' : 'negative'}`,
        gex.flip_strike ? `approximate flip near $${gex.flip_strike}` : 'no flip level in this chain',
        pain.strike ? `max pain $${pain.strike}` : null
      ].filter(Boolean)
    });
  }

  if (odte && odte.premium > (opts.minZeroDtePremium || 1000000)) {
    triggers.push({
      type: 'zero_dte_spike', category: 1, symbol,
      strength: 70,
      evidence: odte,
      headline_facts: [`$${Math.round(odte.premium / 1000)}k traded in contracts expiring today`]
    });
  }

  if (skew && skew.call_skew) {
    triggers.push({
      type: 'call_skew', category: 7, symbol, strength: 45,
      evidence: skew,
      headline_facts: [`Near-the-money calls bid over puts (${skew.call_iv} vs ${skew.put_iv} IV)`]
    });
  }

  return { triggers, analytics: { unusual, pcr, gex, pain, skew, odte }, skipped: null };
}

module.exports = {
  analyzeChain,
  unusualActivity,
  putCallRatio,
  gammaExposure,
  maxPain,
  ivSkew,
  zeroDTE,
  groupByExpiration,
  premiumTraded,
  midPrice,
  CONTRACT_MULTIPLIER
};
