'use strict';

/* The owner's squeeze list: the names with the highest SQUEEZE RISK score (academy-squeeze-model.js through
 * academy-short-insight.js) across the active market, top 100, with the facts that make each one up.
 *
 * Built for speed in two phases:
 *   QUICK   every name in the universe (the wide scanner's live ranking plus a low-float lane) gets the cheap fuel read
 *           (short feed + float, both long-cached), many at a time, in seconds; names with no short data drop out
 *   FULL    the top `maxSymbols` by quick fuel (and every low-float lane name with fuel) get the full read: the book, the
 *           tape, the chain, the gamma squeeze, intent, sentiment, a catalyst; the list fills in as rows land
 * The last built list is kept in the state store, so after a restart the button answers at once with the previous list
 * (marked as from the store) while the sweep rebuilds. While the list has been looked at recently it keeps itself warm:
 * a rebuild starts on its own when the list goes stale. Educational only: a high score describes positioning and flow
 * (fuel, a spark, the gamma ramp), not a prediction. */

const SYMBOL = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
/* a row's float when the scanner knows it (site rows carry the hub's float; Massive-only rows do not) */
const floatOf = (row) => (row ? (num(row.sharesFloat) > 0 ? num(row.sharesFloat) : num(row.sharesOutstanding) > 0 ? num(row.sharesOutstanding) : null) : null);

function createSqueezeList({ insight, quick = null, universe, store = null, quickStore = null, quickTtlMs = 6 * 3_600_000, now = Date.now, logger = () => {}, ttlMs = 10 * 60_000, concurrency = 3, quickConcurrency = 4, maxSymbols = 80, limit = 20, perSymbolMs = 20_000, quickMs = 8_000, lowFloatMax = 50e6, lowFloatExtra = 30, keepWarmMs = 60 * 60_000, memoryOk = null, pauseMs = 3_000 } = {}) {
  if (typeof insight !== 'function') throw new TypeError('insight_required');
  const state = { at: 0, startedAt: 0, rows: [], done: 0, total: 0, building: false, error: '', lowFloat: 0, phase: '', quickDone: 0, quickTotal: 0, quickCached: 0, fromStore: false, lastMs: 0, paused: false };
  let run = null, lastLookAt = 0, warmTimer = null, restored = null;
  /* the quick reads are kept (in memory, and in the quick store across restarts) for quickTtlMs: the short feed settles twice a
     month and the float barely moves, so a name screened an hour ago needs no new site call */
  let quickMemo = null;
  async function loadQuickMemo() {
    if (quickMemo) return quickMemo;
    quickMemo = new Map();
    if (quickStore && typeof quickStore.read === 'function') {
      try { const v = await quickStore.read(); const items = v && v.items && typeof v.items === 'object' ? v.items : {}; for (const [k, e] of Object.entries(items)) if (e && num(e.at) > 0 && now() - num(e.at) < quickTtlMs) quickMemo.set(k, { at: num(e.at), v: e.v }); }
      catch (error) { logger('warn', 'squeeze_quick_store_read_failed', { error: String(error && error.message || error) }); }
    }
    return quickMemo;
  }
  async function saveQuickMemo() {
    if (!quickStore || typeof quickStore.write !== 'function' || !quickMemo) return;
    const items = {}; const fresh = [...quickMemo.entries()].filter(([, e]) => now() - e.at < quickTtlMs).sort((a, b) => b[1].at - a[1].at).slice(0, 1500);
    for (const [k, e] of fresh) items[k] = { at: e.at, v: e.v };
    try { await quickStore.write({ items, at: now() }); } catch (error) { logger('warn', 'squeeze_quick_store_write_failed', { error: String(error && error.message || error) }); }
  }

  function rowOf(symbol, meta, r) {
    const sq = r.squeeze || {}, pr = r.pressing || {}, it = r.interest || {}, svp = r.shortVsPrice || {}, px = r.price || {}, v = r.verdict && r.verdict.long ? r.verdict.long : {};
    const top = (sq.components || []).filter((c) => c.pts > 0).sort((a, b) => b.pts - a.pts).slice(0, 3).map((c) => c.label + ': ' + c.detail);
    const fu = r.model && r.model.fuel ? r.model.fuel : {}, ga = r.model && (r.model.gamma || r.model.accelerant) ? (r.model.gamma || r.model.accelerant) : {};
    return {
      symbol, name: meta && meta.name ? String(meta.name).slice(0, 60) : '', squeeze: num(sq.score), pressing: num(pr.score),
      floatShares: num(fu.floatShares) ?? floatOf(meta), floatBand: fu.floatBand || null, floatKey: fu.floatKey || null, coverRatio: num(fu.coverRatio), floatTurn: num(fu.floatTurn), dollarFloat: num(fu.dollarFloat), lane: meta && meta.__lane ? meta.__lane : 'active',
      daysToCover: num(it.daysToCover), shortInterest: num(it.shortInterest), siChangePct: num(it.siChangePct), shortRatio: num(svp.avgRatio), shortRatioTrend: num(svp.trendPts), shortVsPrice: svp.tone || 'neutral',
      close: num(px.close), hi20: num(px.hi20), lo20: num(px.lo20), aboveHigh: num(px.close) != null && num(px.hi20) != null && px.close > px.hi20,
      changePct: meta ? num(meta.changePct ?? meta.change_pct ?? meta.change) : null, volume: meta ? num(meta.volume) : null, relVol: meta ? num(meta.relVol ?? meta.relativeVolume ?? meta.rvol) : null,
      call: v.call || '', tone: v.tone || 'neutral', why: top, sources: r.sources || null,
      fuel: r.model ? num(r.model.fuel && r.model.fuel.score) : null, spark: r.model ? num(r.model.spark && r.model.spark.score) : null, accelerant: num(ga.score), gamma: num(ga.score), gammaBand: ga.band || null, callWall: ga.callWall && ga.callWall.strike != null ? { strike: ga.callWall.strike, distancePct: num(ga.callWall.distancePct) } : null, putCallVol: num(ga.putCallVol), trap: r.model ? num(r.model.trap && r.model.trap.score) : null,
      pctFloat: num(fu.pctFloat), burn: num(fu.burn), qstate: r.model && r.model.qstate ? { dominant: r.model.qstate.dominant, squeeze: num(r.model.qstate.probs && r.model.qstate.probs.squeeze), entropy: num(r.model.qstate.entropy) } : null, band: r.model ? r.model.band : '', coverage: r.model ? num(r.model.coverage) : null,
      modelWhy: r.model && r.model.why ? [...(r.model.why.fuel || []).slice(0, 2), ...(r.model.why.spark || []).slice(0, 2), ...((r.model.why.gamma || r.model.why.accelerant) || []).slice(0, 1)] : []
    };
  }

  /* back-pressure: while the process is short of memory (memoryOk() false) the workers wait before the next name, so a sweep
     slows down rather than pushing the server over its limit */
  async function pool(items, n, fn) {
    let i = 0, waits = 0;
    const breathe = async () => { while (typeof memoryOk === 'function' && !memoryOk() && waits < 60) { waits += 1; state.paused = true; await new Promise((r) => { const h = setTimeout(r, pauseMs); if (h.unref) h.unref(); }); } state.paused = false; };
    const worker = async () => { while (i < items.length) { await breathe(); if (i >= items.length) break; const it = items[i++]; await fn(it); } };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  }
  const within = (p, ms) => Promise.race([p, new Promise((res) => { const h = setTimeout(() => res(null), ms); if (h.unref) h.unref(); })]);

  async function build() {
    const t = now();
    let list = [];
    try { list = (await universe()) || []; } catch (error) { logger('warn', 'squeeze_list_universe_failed', { error: String(error && error.message || error) }); }
    const metas = new Map();
    const symOf = (row) => String((row && (row.symbol || row.ticker)) || '').toUpperCase();
    /* with a quick read the whole universe is screened; without one, only the top of the live ranking is read in full */
    const activeCut = quick ? Infinity : maxSymbols;
    for (const row of list) { const s = symOf(row); if (SYMBOL.test(s) && !metas.has(s)) metas.set(s, row); if (metas.size >= activeCut) break; }
    /* the LOW-FLOAT lane: names further down the live ranking whose float is small enough that the supply math can squeeze them;
       the active lane alone is the market's biggest movers, which skews to large floats */
    let lowFloat = 0;
    for (const row of list) {
      if (lowFloat >= lowFloatExtra) break;
      const s = symOf(row); if (!SYMBOL.test(s)) continue;
      const fl = floatOf(row); if (!(fl > 0 && fl < lowFloatMax)) continue;
      if (metas.has(s)) { const m = metas.get(s); if (!m.__lane && quick) { metas.set(s, { ...m, __lane: 'low-float' }); lowFloat += 1; } continue; }
      metas.set(s, { ...row, __lane: 'low-float' }); lowFloat += 1;
    }
    let symbols = [...metas.keys()];
    state.building = true; state.startedAt = t; state.lowFloat = lowFloat; state.error = symbols.length ? '' : 'no_universe';
    state.phase = quick ? 'quick' : 'full'; state.quickTotal = quick ? symbols.length : 0; state.quickDone = 0; state.quickCached = 0; state.total = quick ? 0 : symbols.length; state.done = 0;
    if (quick && symbols.length) {
      const scored = [], memo = await loadQuickMemo();
      await pool(symbols, quickConcurrency, async (s) => {
        try {
          const had = memo.get(s);
          let q = had && now() - had.at < quickTtlMs ? had.v : null;
          if (q) state.quickCached += 1;
          else { q = await within(quick(s), quickMs); if (q && q.ok) memo.set(s, { at: now(), v: q }); }
          if (q && q.ok && q.available && q.fuel != null) scored.push({ s, fuel: q.fuel, cover: num(q.coverRatio, 0), lane: metas.get(s).__lane || 'active' });
        } catch (error) { logger('warn', 'squeeze_list_quick_failed', { symbol: s, error: String(error && error.message || error) }); }
        state.quickDone += 1;
      });
      void saveQuickMemo();
      scored.sort((a, b) => (b.fuel - a.fuel) || (b.cover - a.cover));
      const keep = new Set(scored.slice(0, maxSymbols).map((x) => x.s));
      for (const x of scored) if (x.lane === 'low-float' && x.fuel >= 35) keep.add(x.s); // a small float with real fuel is always worth the full read
      symbols = scored.filter((x) => keep.has(x.s)).map((x) => x.s);
      logger('info', 'squeeze_list_quick', { screened: state.quickTotal, cached: state.quickCached, withFuel: scored.length, fullReads: symbols.length, ms: now() - t });
    }
    state.phase = 'full'; state.total = symbols.length; state.done = 0;
    const found = [];
    await pool(symbols, concurrency, async (s) => {
      try {
        const r = await within(insight(s), perSymbolMs);
        if (r && r.ok && r.available && r.squeeze && r.squeeze.score != null) found.push(rowOf(s, metas.get(s), r));
      } catch (error) { logger('warn', 'squeeze_list_symbol_failed', { symbol: s, error: String(error && error.message || error) }); }
      state.done += 1;
      if (found.length) { state.rows = rank(found); state.fromStore = false; }
    });
    state.rows = rank(found); state.at = now(); state.building = false; state.phase = ''; state.fromStore = false; state.lastMs = now() - t;
    logger('info', 'squeeze_list_built', { symbols: symbols.length, scored: found.length, ms: state.lastMs });
    if (store && typeof store.write === 'function' && found.length) { try { await store.write({ rows: state.rows, at: state.at, total: state.total, lowFloat: state.lowFloat }); } catch (error) { logger('warn', 'squeeze_list_store_failed', { error: String(error && error.message || error) }); } }
  }
  function rank(found) { return found.slice().sort((a, b) => (b.squeeze - a.squeeze) || (((b.qstate && b.qstate.squeeze) || 0) - ((a.qstate && a.qstate.squeeze) || 0)) || ((b.coverRatio || 0) - (a.coverRatio || 0)) || ((b.daysToCover || 0) - (a.daysToCover || 0))).slice(0, limit).map((r, k) => ({ ...r, rank: k + 1 })); }

  /* the last list from the store, served at once after a restart while the sweep rebuilds */
  function restore() {
    if (restored || !store || typeof store.read !== 'function') return restored || Promise.resolve();
    restored = Promise.resolve().then(() => store.read()).then((v) => {
      /* only while nothing has been built yet; a sweep under way keeps its own counters and replaces these rows as it lands */
      if (state.at || state.rows.length || !v || !Array.isArray(v.rows) || !v.rows.length) return;
      state.rows = v.rows.slice(0, limit); state.at = num(v.at, 0); state.fromStore = true;
    }).catch((error) => { logger('warn', 'squeeze_list_restore_failed', { error: String(error && error.message || error) }); });
    return restored;
  }
  function start() {
    if (run) return run;
    state.building = true; state.done = 0; state.error = ''; state.phase = quick ? 'quick' : 'full'; state.quickDone = 0;
    run = build().catch((error) => { logger('error', 'squeeze_list_failed', { error: String(error && error.message || error) }); state.building = false; state.phase = ''; state.error = 'build_failed'; }).finally(() => { run = null; arm(); });
    return run;
  }
  /* keep warm: while someone looked at the list within keepWarmMs, the next rebuild starts by itself when it goes stale */
  function arm() {
    if (warmTimer) { clearTimeout(warmTimer); warmTimer = null; }
    if (!keepWarmMs || !lastLookAt || now() - lastLookAt > keepWarmMs) return;
    const wait = Math.max(1_000, (state.at || now()) + ttlMs - now());
    warmTimer = setTimeout(() => { warmTimer = null; if (lastLookAt && now() - lastLookAt <= keepWarmMs && !run) start(); }, wait);
    if (warmTimer.unref) warmTimer.unref();
  }

  /* the list as it stands; a stale or missing one starts a sweep in the background and says so */
  function list({ refresh = false, touch = true } = {}) {
    if (touch) lastLookAt = now();
    void restore();
    const stale = !state.at || now() - state.at > ttlMs || state.fromStore;
    if ((stale || refresh) && !run) start(); else if (touch) arm();
    return { ok: true, rows: state.rows, building: state.building, phase: state.phase, done: state.done, total: state.total, quickDone: state.quickDone, quickTotal: state.quickTotal, quickCached: state.quickCached, paused: state.paused, lowFloat: state.lowFloat, fromStore: state.fromStore, lastMs: state.lastMs, asOf: state.at || null, startedAt: state.startedAt || null, error: state.error || '', limit,
      note: 'SQUEEZE RISK 0-100 = fuel (short % of float, the float\'s size, the cover ratio = shares owed per free share, float turnover, dollar float, days to cover, burn rate, short volume, short interest vs price, synthetic shorts) x spark (the 20-day high, the Massive tape, sweeps, the Level 3 book, dark pool DIX, worked orders, icebergs, pulled orders, VPIN, the flow ledger, relative volume, chatter, a dated catalyst) + the GAMMA SQUEEZE (negative dealer gamma, calls stacked above spot, the call wall, call buyers today, the gamma flip, hedge pressure, 0DTE) - trap (shorts winning). The scan pre-screens the whole active market plus a low-float lane (floats under ' + Math.round(lowFloatMax / 1e6) + 'M) on fuel, then reads the top names in full. Q = the probabilistic state read. Fuel, a spark and the gamma ramp, not a prediction. Educational only.' };
  }
  return { list, build, start, restore, state };
}

module.exports = { createSqueezeList };
