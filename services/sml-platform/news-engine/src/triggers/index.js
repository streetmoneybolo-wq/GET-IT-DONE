/* =============================================================================
 * StockMarketLoop News Engine — trigger orchestrator
 *
 * ARCHITECTURE: FAN-IN, NOT FAN-OUT.
 *
 * The obvious design — walk every ticker and ask each endpoint whether anything
 * happened — is the one that cannot work here. Massive actively rate-limits
 * (the quote pre-warm cron had to be cut from 40 symbols to 12), so a per-ticker
 * sweep would exhaust the budget before finishing the alphabet.
 *
 * Instead: ONE call to sml-scanner/v1/live returns the entire moving universe.
 * That result decides where the expensive per-symbol calls get spent. A cycle
 * costs roughly 1 + (3 x shortlist) requests rather than thousands, and the
 * shortlist is capped by an explicit budget that is enforced, not advisory.
 *
 * It also gives the right editorial property for free: articles can only exist
 * for things that actually moved.
 *
 * Verified endpoints (tested live 2026-08-22):
 *   sml-scanner/v1/live                      universe of movers          Cat 2
 *   sml-options-intelligence/v1/chain        moomoo chain + greeks       Cat 1,7
 *   sml-short/v1/short                       FINRA short volume          Cat 15
 *   sml-massive/v1/market-data/filings       SEC filings                 Cat 4
 *   sml-terminal-guard/v1/earnings           earnings                    Cat 3
 *   sml-engines/v1/trending                  sentiment heat              Cat 6
 *
 * Deterministic: no network, no clock. Fetchers and `now` are injected.
 * ========================================================================== */

'use strict';

const optionsAnalytics = require('./options.js');

/* -------------------------------------------------------------------------- */
/* Budget — a hard ceiling, not a suggestion                                   */
/* -------------------------------------------------------------------------- */

/**
 * Per-provider request budget for one cycle. `spend` returns false when the
 * budget is gone; callers must stop rather than continue and hope. Exceeding a
 * provider's limit gets the whole site throttled, which costs far more than the
 * articles skipped.
 */
function createBudget(limits = {}) {
  const caps = Object.assign({ massive: 40, moomoo: 30, internal: 200 }, limits);
  const spent = {};
  for (const k of Object.keys(caps)) spent[k] = 0;

  return {
    caps,
    spend(provider, n = 1) {
      if (!(provider in spent)) spent[provider] = 0;
      const cap = caps[provider] != null ? caps[provider] : Infinity;
      if (spent[provider] + n > cap) return false;
      spent[provider] += n;
      return true;
    },
    remaining(provider) {
      const cap = caps[provider] != null ? caps[provider] : Infinity;
      return Math.max(0, cap - (spent[provider] || 0));
    },
    report() { return Object.assign({}, spent); }
  };
}

/* -------------------------------------------------------------------------- */
/* Universe selection                                                          */
/* -------------------------------------------------------------------------- */

function num(v, d = 0) { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : d; }

/**
 * Rank the scanner's rows and take the top N.
 *
 * Ranked by absolute percentage move, because that is the field the scanner
 * reliably provides (`chgPct`). Relative volume is used when present but is not
 * required — writing the selector to depend on a field that may be absent would
 * silently return an empty universe.
 */
function selectUniverse(scannerRows, opts = {}) {
  const minAbsPct = opts.minAbsPct != null ? opts.minAbsPct : 5;
  const minPrice = opts.minPrice != null ? opts.minPrice : 0.10;
  const limit = opts.limit != null ? opts.limit : 12;

  const scored = (scannerRows || [])
    .map((r) => {
      const symbol = String(r.sym || r.symbol || '').toUpperCase();
      const pct = num(r.chgPct != null ? r.chgPct : r.changePct);
      const price = num(r.last != null ? r.last : r.price);
      const relVol = num(r.relVol != null ? r.relVol : r.relative_volume, null);
      return { symbol, pct, price, relVol, abs: Math.abs(pct) };
    })
    .filter((r) => r.symbol && r.price >= minPrice && r.abs >= minAbsPct)
    /* relative volume, where the scanner supplies it, breaks ties toward the
       names that are genuinely busy rather than merely gapped */
    .sort((a, b) => (b.abs + (b.relVol || 0) * 2) - (a.abs + (a.relVol || 0) * 2))
    .slice(0, limit);

  return scored;
}

/* -------------------------------------------------------------------------- */
/* Detectors for the non-options sources                                       */
/* -------------------------------------------------------------------------- */

function trigger(type, category, symbol, strength, evidence, facts) {
  return { type, category, symbol, strength: Math.max(0, Math.min(100, Math.round(strength))), evidence, headline_facts: facts.filter(Boolean) };
}

/** Category 2 — unusual volume / price dislocation, straight from the scanner. */
function detectMoveTriggers(row, opts = {}) {
  const out = [];
  if (!row || !row.symbol) return out;
  const bigMove = opts.bigMovePct != null ? opts.bigMovePct : 10;

  if (row.abs >= bigMove) {
    out.push(trigger('price_dislocation', 2, row.symbol,
      Math.min(100, row.abs * 3),
      { percent_change: row.pct, price: row.price, relative_volume: row.relVol },
      [
        `${row.symbol} ${row.pct >= 0 ? 'up' : 'down'} ${Math.abs(row.pct).toFixed(1)}% at $${row.price}`,
        row.relVol ? `relative volume ${row.relVol.toFixed(1)}x` : null
      ]));
  }
  return out;
}

/** Category 15 — short interest. Shape verified: {volume:[{date,short,total,ratio}]} */
function detectShortTriggers(data, symbol, opts = {}) {
  const out = [];
  if (!data || data.available === false) return out;
  const rows = Array.isArray(data.volume) ? data.volume.slice() : [];
  if (!rows.length) return out;

  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const latest = rows[0];
  const ratio = num(latest.ratio);
  const highRatio = opts.highShortRatio != null ? opts.highShortRatio : 45;

  if (ratio >= highRatio) {
    out.push(trigger('high_short_volume', 15, symbol, Math.min(100, ratio),
      { date: latest.date, short_ratio: ratio, short: num(latest.short), total: num(latest.total) },
      [`${ratio.toFixed(1)}% of ${latest.date} volume was short`]));
  }

  /* A rising trend matters more than a single day's level — one heavy session
     is noise, three consecutive builds is positioning. */
  if (rows.length >= 3) {
    const r = rows.slice(0, 3).map((x) => num(x.ratio));
    if (r[0] > r[1] && r[1] > r[2] && (r[0] - r[2]) >= 5) {
      out.push(trigger('short_interest_rising', 15, symbol, 60,
        { series: r, from: rows[2].date, to: rows[0].date },
        [`Short share of volume rose from ${r[2].toFixed(1)}% to ${r[0].toFixed(1)}% over three sessions`]));
    }
  }
  return out;
}

/** Category 4 — SEC filings. Shape verified: {filings:[{form_type,filing_date,issuer_name}]} */
function detectFilingTriggers(data, symbol, opts = {}) {
  const out = [];
  const filings = data && Array.isArray(data.filings) ? data.filings : [];
  if (!filings.length) return out;

  const since = opts.since || null;      // ISO date; only filings after this fire
  const seen = opts.seenFilings || new Set();

  /* Weighting reflects what actually moves a stock, not filing size. An S-3
     shelf on a microcap is a dilution warning and matters more than a routine
     10-Q on a mega-cap. */
  const weights = {
    '8-K': 70, 'S-3': 85, 'S-1': 85, '10-Q': 45, '10-K': 45,
    '4': 55, 'SC 13D': 80, 'SC 13G': 60, '13F-HR': 40
  };

  for (const f of filings) {
    const form = String(f.form_type || '').toUpperCase();
    const date = String(f.filing_date || '');
    const key = `${symbol}:${form}:${date}`;
    if (seen.has(key)) continue;
    if (since && date <= since) continue;

    const base = weights[form] != null ? weights[form] : 35;
    const dilution = form === 'S-3' || form === 'S-1';

    out.push(trigger('sec_filing', 4, symbol, base,
      { form_type: form, filing_date: date, issuer: f.issuer_name, dedupe_key: key, dilution_risk: dilution },
      [
        `${symbol} filed a ${form} on ${date}`,
        dilution ? 'shelf/registration filing — potential dilution' : null
      ]));
  }
  return out;
}

/** Category 6 — sentiment. Shape verified: [{symbol,heat,sentiment_score,sentiment}] */
function detectSentimentTriggers(rows, previous = {}, opts = {}) {
  const out = [];
  const jump = opts.heatJump != null ? opts.heatJump : 20;

  for (const r of rows || []) {
    const symbol = String(r.symbol || '').toUpperCase();
    if (!symbol) continue;
    const heat = num(r.heat);
    const prev = previous[symbol];
    if (prev == null) continue;               // no baseline: not a spike, just a first read

    const delta = heat - num(prev);
    if (delta >= jump) {
      out.push(trigger('sentiment_spike', 6, symbol, Math.min(100, delta * 2),
        { heat, previous_heat: prev, delta, sentiment: r.sentiment, score: r.sentiment_score },
        [`Social heat rose ${delta} points to ${heat}`, r.sentiment ? `sentiment reads ${r.sentiment}` : null]));
    }
  }
  return out;
}

/** Category 3 — earnings. Shape not fully documented, so read defensively. */
function detectEarningsTriggers(data, symbol) {
  const out = [];
  if (!data || typeof data !== 'object') return out;

  const e = data.earnings || data.latest || data;
  const eps = e.eps_actual != null ? num(e.eps_actual, null) : null;
  const epsEst = e.eps_estimate != null ? num(e.eps_estimate, null) : null;
  const date = e.report_date || e.date || null;
  if (eps === null || epsEst === null) return out;

  const surprise = epsEst !== 0 ? ((eps - epsEst) / Math.abs(epsEst)) * 100 : null;
  if (surprise === null) return out;

  const beat = surprise > 0;
  out.push(trigger('earnings_result', 3, symbol, Math.min(100, Math.abs(surprise) * 4),
    { eps_actual: eps, eps_estimate: epsEst, surprise_pct: Math.round(surprise * 10) / 10, report_date: date, beat },
    [`EPS ${eps} vs ${epsEst} estimate`, `${beat ? 'beat' : 'miss'} of ${Math.abs(surprise).toFixed(1)}%`]));
  return out;
}

/* -------------------------------------------------------------------------- */
/* Cooldown — the thing that stops one event becoming fifty articles           */
/* -------------------------------------------------------------------------- */

/**
 * A stable identity for "this event". Keys are intentionally coarse: one
 * unusual-options article per symbol per day, one filing article per filing,
 * one gamma article per symbol per regime. Without this, a cycle running every
 * fifteen minutes republishes the same story ninety-six times a day, which is
 * exactly the scaled-content pattern that gets a site demoted.
 */
function cooldownKey(t, dayStamp) {
  const d = dayStamp || 'nodate';
  switch (t.type) {
    case 'sec_filing':            return `filing:${t.evidence.dedupe_key}`;
    case 'earnings_result':       return `earnings:${t.symbol}:${t.evidence.report_date || d}`;
    case 'high_short_volume':
    case 'short_interest_rising': return `short:${t.symbol}:${t.evidence.date || t.evidence.to || d}`;
    /* regime is part of the key so a genuine flip from positive to negative
       gamma is allowed to publish again the same day */
    case 'gamma_positioning':     return `gamma:${t.symbol}:${d}:${t.evidence.regime}`;
    default:                      return `${t.type}:${t.symbol}:${d}`;
  }
}

/** Drop triggers whose key is still inside its cooldown window. */
function filterCooled(triggers, seen = new Map(), now = 0, ttlMs = 20 * 3600 * 1000, dayStamp) {
  const kept = [];
  const suppressed = [];
  for (const t of triggers) {
    const key = cooldownKey(t, dayStamp);
    const last = seen.get(key);
    if (last != null && (now - last) < ttlMs) { suppressed.push({ key, type: t.type, symbol: t.symbol }); continue; }
    kept.push(Object.assign({ cooldown_key: key }, t));
  }
  return { kept, suppressed };
}

/* -------------------------------------------------------------------------- */
/* Cycle                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Run one detection cycle.
 *
 * `fetchers` is an object of async functions so this is testable without a
 * network and swappable per environment:
 *   scanner()            -> { rows: [...] }
 *   trending()           -> [ {symbol, heat, ...} ]
 *   chain(symbol)        -> chain response
 *   shortData(symbol)    -> short response
 *   filings(symbol)      -> filings response
 *   earnings(symbol)     -> earnings response
 *
 * Every per-symbol fetch is budgeted and every failure is contained: one bad
 * symbol must not abort the cycle, or a single delisted ticker takes down the
 * whole run.
 */
async function runCycle(fetchers, state = {}, opts = {}) {
  if (!fetchers || typeof fetchers.scanner !== 'function') {
    throw new TypeError('runCycle: fetchers.scanner is required');
  }

  const now = opts.now != null ? opts.now : 0;
  const dayStamp = opts.dayStamp || 'day';
  const budget = opts.budget || createBudget(opts.limits);
  const errors = [];
  const triggers = [];

  /* --- one call for the whole universe --- */
  let rows = [];
  try {
    budget.spend('internal', 1);
    const res = await fetchers.scanner();
    rows = (res && (res.rows || res.data)) || [];
  } catch (e) {
    errors.push({ stage: 'scanner', message: String(e && e.message).slice(0, 120) });
    return { triggers: [], suppressed: [], errors, budget: budget.report(), universe: [] };
  }

  const universe = selectUniverse(rows, opts);
  for (const row of universe) triggers.push(...detectMoveTriggers(row, opts));

  /* --- sentiment: also one call for everything --- */
  if (typeof fetchers.trending === 'function') {
    try {
      budget.spend('internal', 1);
      const t = await fetchers.trending();
      triggers.push(...detectSentimentTriggers(t, state.previousHeat || {}, opts));
    } catch (e) {
      errors.push({ stage: 'trending', message: String(e && e.message).slice(0, 120) });
    }
  }

  /* --- per-symbol detail, budgeted, only for what the scanner surfaced --- */
  for (const row of universe) {
    const sym = row.symbol;

    if (typeof fetchers.chain === 'function' && budget.spend('moomoo', 1)) {
      try {
        const chain = await fetchers.chain(sym);
        const res = optionsAnalytics.analyzeChain(chain, opts);
        triggers.push(...res.triggers);
      } catch (e) { errors.push({ stage: 'chain', symbol: sym, message: String(e && e.message).slice(0, 120) }); }
    }

    if (typeof fetchers.shortData === 'function' && budget.spend('massive', 1)) {
      try { triggers.push(...detectShortTriggers(await fetchers.shortData(sym), sym, opts)); }
      catch (e) { errors.push({ stage: 'short', symbol: sym, message: String(e && e.message).slice(0, 120) }); }
    }

    if (typeof fetchers.filings === 'function' && budget.spend('massive', 1)) {
      try {
        triggers.push(...detectFilingTriggers(await fetchers.filings(sym), sym,
          Object.assign({}, opts, { seenFilings: state.seenFilings })));
      } catch (e) { errors.push({ stage: 'filings', symbol: sym, message: String(e && e.message).slice(0, 120) }); }
    }

    if (typeof fetchers.earnings === 'function' && budget.spend('massive', 1)) {
      try { triggers.push(...detectEarningsTriggers(await fetchers.earnings(sym), sym)); }
      catch (e) { errors.push({ stage: 'earnings', symbol: sym, message: String(e && e.message).slice(0, 120) }); }
    }
  }

  const { kept, suppressed } = filterCooled(triggers, state.cooldowns, now, opts.cooldownMs, dayStamp);
  kept.sort((a, b) => b.strength - a.strength);

  return {
    triggers: kept,
    suppressed,
    errors,
    budget: budget.report(),
    universe: universe.map((u) => u.symbol),
    exhausted: Object.keys(budget.caps).filter((p) => budget.remaining(p) === 0)
  };
}

module.exports = {
  runCycle,
  createBudget,
  selectUniverse,
  detectMoveTriggers,
  detectShortTriggers,
  detectFilingTriggers,
  detectSentimentTriggers,
  detectEarningsTriggers,
  cooldownKey,
  filterCooled,
  options: optionsAnalytics
};
