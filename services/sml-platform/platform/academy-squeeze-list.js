'use strict';

/* The owner's squeeze list: the names with the highest SQUEEZE RISK score (academy-short-insight.js) across the active market,
 * top 20, with the facts that make each one up. The universe is the wide scanner's ranking (the names moving on volume and
 * size right now, up to maxSymbols), each read through the short insight (the FINRA short feed, daily candles, the Level 3
 * book, the Massive tape, the flow ledger and the chain). A sweep runs in the background, a few symbols at a time, and the
 * list is served as it fills in; it is rebuilt when it is older than ttlMs. Educational only: a high score describes
 * positioning and flow (fuel and a spark), not a prediction. */

const SYMBOL = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };

function createSqueezeList({ insight, universe, now = Date.now, logger = () => {}, ttlMs = 10 * 60_000, concurrency = 3, maxSymbols = 80, limit = 20, perSymbolMs = 20_000 } = {}) {
  if (typeof insight !== 'function') throw new TypeError('insight_required');
  const state = { at: 0, startedAt: 0, rows: [], done: 0, total: 0, building: false, error: '' };
  let run = null;

  function rowOf(symbol, meta, r) {
    const sq = r.squeeze || {}, pr = r.pressing || {}, it = r.interest || {}, svp = r.shortVsPrice || {}, px = r.price || {}, v = r.verdict && r.verdict.long ? r.verdict.long : {};
    const top = (sq.components || []).filter((c) => c.pts > 0).sort((a, b) => b.pts - a.pts).slice(0, 3).map((c) => c.label + ': ' + c.detail);
    return {
      symbol, name: meta && meta.name ? String(meta.name).slice(0, 60) : '', squeeze: num(sq.score), pressing: num(pr.score),
      daysToCover: num(it.daysToCover), shortInterest: num(it.shortInterest), siChangePct: num(it.siChangePct), shortRatio: num(svp.avgRatio), shortRatioTrend: num(svp.trendPts), shortVsPrice: svp.tone || 'neutral',
      close: num(px.close), hi20: num(px.hi20), lo20: num(px.lo20), aboveHigh: num(px.close) != null && num(px.hi20) != null && px.close > px.hi20,
      changePct: meta ? num(meta.changePct ?? meta.change_pct ?? meta.change) : null, volume: meta ? num(meta.volume) : null, relVol: meta ? num(meta.relVol ?? meta.relativeVolume ?? meta.rvol) : null,
      call: v.call || '', tone: v.tone || 'neutral', why: top, sources: r.sources || null,
      fuel: r.model ? num(r.model.fuel && r.model.fuel.score) : null, spark: r.model ? num(r.model.spark && r.model.spark.score) : null, accelerant: r.model ? num(r.model.accelerant && r.model.accelerant.score) : null, trap: r.model ? num(r.model.trap && r.model.trap.score) : null,
      pctFloat: r.model && r.model.fuel ? num(r.model.fuel.pctFloat) : null, burn: r.model && r.model.fuel ? num(r.model.fuel.burn) : null, qstate: r.model && r.model.qstate ? { dominant: r.model.qstate.dominant, squeeze: num(r.model.qstate.probs && r.model.qstate.probs.squeeze), entropy: num(r.model.qstate.entropy) } : null, band: r.model ? r.model.band : '', coverage: r.model ? num(r.model.coverage) : null,
      modelWhy: r.model && r.model.why ? [...(r.model.why.fuel || []).slice(0, 2), ...(r.model.why.spark || []).slice(0, 2)] : []
    };
  }

  async function build() {
    const t = now();
    let list = [];
    try { list = (await universe()) || []; } catch (error) { logger('warn', 'squeeze_list_universe_failed', { error: String(error && error.message || error) }); }
    const metas = new Map();
    for (const row of list) { const s = String((row && (row.symbol || row.ticker)) || '').toUpperCase(); if (SYMBOL.test(s) && !metas.has(s)) metas.set(s, row); if (metas.size >= maxSymbols) break; }
    const symbols = [...metas.keys()];
    state.building = true; state.startedAt = t; state.total = symbols.length; state.done = 0; state.error = symbols.length ? '' : 'no_universe';
    const found = [];
    let i = 0;
    const worker = async () => {
      while (i < symbols.length) {
        const s = symbols[i++];
        try {
          const r = await Promise.race([insight(s), new Promise((res) => { const h = setTimeout(() => res(null), perSymbolMs); if (h.unref) h.unref(); })]);
          if (r && r.ok && r.available && r.squeeze && r.squeeze.score != null) found.push(rowOf(s, metas.get(s), r));
        } catch (error) { logger('warn', 'squeeze_list_symbol_failed', { symbol: s, error: String(error && error.message || error) }); }
        state.done += 1;
        state.rows = rank(found);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, symbols.length)) }, worker));
    state.rows = rank(found); state.at = now(); state.building = false;
    logger('info', 'squeeze_list_built', { symbols: symbols.length, scored: found.length, ms: now() - t });
  }
  function rank(found) { return found.slice().sort((a, b) => (b.squeeze - a.squeeze) || (((b.qstate && b.qstate.squeeze) || 0) - ((a.qstate && a.qstate.squeeze) || 0)) || ((b.daysToCover || 0) - (a.daysToCover || 0))).slice(0, limit).map((r, k) => ({ ...r, rank: k + 1 })); }

  /* the list as it stands; a stale or missing one starts a sweep in the background and says so */
  function list({ refresh = false } = {}) {
    const stale = !state.at || now() - state.at > ttlMs;
    if ((stale || refresh) && !run) { state.building = true; state.done = 0; state.error = ''; run = build().catch((error) => { logger('error', 'squeeze_list_failed', { error: String(error && error.message || error) }); state.building = false; state.error = 'build_failed'; }).finally(() => { run = null; }); }
    return { ok: true, rows: state.rows, building: state.building, done: state.done, total: state.total, asOf: state.at || null, startedAt: state.startedAt || null, error: state.error || '', limit,
      note: 'SQUEEZE RISK 0-100 = fuel (short % of float, days to cover, burn rate, short volume, short interest vs price, synthetic shorts) x spark (the 20-day high, the Massive tape, sweeps, the Level 3 book, dark pool DIX, worked orders, icebergs, pulled orders, VPIN, the flow ledger, relative volume, chatter, a dated catalyst) + accelerant (dealer gamma, the call wall, 0DTE) - trap (shorts winning). Q = the probabilistic state read. Fuel and a spark, not a prediction. Educational only.' };
  }
  return { list, build, state };
}

module.exports = { createSqueezeList };
