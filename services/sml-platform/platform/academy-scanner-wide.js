'use strict';

/* Wide live scanner: up to 500 US stocks ranked live, for the scanner pop-out window.
 *
 * The site scanner (WordPress sml-scanner/v1/live) carries ~100 rows with rich fields. This module widens that list with
 * the whole-market Massive (Polygon-format) snapshot, keeps the site rows where it has them, and ranks everything by a
 * live score built from relative volume, the size of today's move, money traded and short-term momentum.
 *
 * Cheap by design: the ~5 MB snapshot is fetched once per TTL (shared with the Market Direction engine through
 * createSharedSnapshot), parsed once per copy, and the ranking is recomputed only when the site rows or the snapshot
 * change. Educational market data only. */

const { marketState } = require('./market-clock');

const MAX_LIMIT = 500;
const MIN_PRICE = 1;
const MIN_VOLUME = 150_000;
const HISTORY_MS = 3_900_000;
const fin = Number.isFinite;
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return fin(n) ? n : null; };
const pos = (v) => { const n = num(v); return n !== null && n > 0 ? n : null; };
const round = (v, d = 4) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

function clampLimit(value, fallback = MAX_LIMIT) {
  const n = Math.floor(Number(value));
  if (!fin(n)) return fallback;
  return Math.max(1, Math.min(MAX_LIMIT, n));
}

/* Plain US common-stock style symbols only; 5-letter names ending in W / U / R are warrants, units and rights. */
function plainSymbol(symbol) {
  if (!/^[A-Z]{1,5}$/.test(symbol)) return false;
  return !(symbol.length === 5 && /[WUR]$/.test(symbol));
}

/* One snapshot ticker -> a scanner row with the same field names the site scanner rows use (null when unknown). */
function rowFromSnapshot(t) {
  if (!t || typeof t.ticker !== 'string') return null;
  const symbol = t.ticker.trim();
  if (!plainSymbol(symbol)) return null;
  const day = t.day || {}, prev = t.prevDay || {}, min = t.min || {}, trade = t.lastTrade || {}, quote = t.lastQuote || {};
  const price = pos(trade.p) || pos(min.c) || pos(day.c);
  if (!price) return null;
  const previousClose = pos(prev.c);
  const volume = Math.max(num(day.v) || 0, num(min.av) || 0);
  const previousVolume = pos(prev.v);
  const change = previousClose ? price - previousClose : num(t.todaysChange);
  const changePct = previousClose ? ((price - previousClose) / previousClose) * 100 : num(t.todaysChangePerc);
  const bidSize = num(quote.s), askSize = num(quote.S);
  const updated = num(t.updated);
  return {
    symbol, name: '', price,
    change: round(change, 4), changePct: round(changePct, 4),
    volume, previousVolume, previousClose,
    open: pos(day.o), high: pos(day.h), low: pos(day.l), close: pos(day.c),
    bid: pos(quote.p), ask: pos(quote.P),
    /* Massive sizes are shares; site rows carry round lots (the table shows size x 100) */
    bidSize: bidSize !== null && bidSize >= 0 ? bidSize / 100 : null,
    askSize: askSize !== null && askSize >= 0 ? askSize / 100 : null,
    turnover: price * volume,
    avgPrice: pos(day.vw),
    relVolume: previousVolume ? round(volume / previousVolume, 4) : null,
    updatedAt: updated ? (updated > 1e15 ? Math.round(updated / 1e6) : updated > 1e12 ? updated : updated * 1000) : null,
    source: 'massive'
  };
}

/* Liquid names only. Outside the regular session today's volume is thin, so yesterday's volume also qualifies. */
function liquid(row, regular) {
  if (!row || !(row.price >= MIN_PRICE)) return false;
  if (row.volume >= MIN_VOLUME) return true;
  return !regular && (row.previousVolume || 0) >= MIN_VOLUME;
}

function parseSnapshot(tickers, { regular = true } = {}) {
  const out = new Map();
  for (const t of Array.isArray(tickers) ? tickers : []) {
    const row = rowFromSnapshot(t);
    if (row && liquid(row, regular) && !out.has(row.symbol)) out.set(row.symbol, row);
  }
  return out;
}

/* Percentile rank 0..1 of each value (ties share their average rank); null stays null. */
function percentiles(values) {
  const idx = [];
  values.forEach((v, i) => { if (v !== null && fin(v)) idx.push(i); });
  const out = new Array(values.length).fill(null);
  if (!idx.length) return out;
  if (idx.length === 1) { out[idx[0]] = 1; return out; }
  idx.sort((a, b) => values[a] - values[b]);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && values[idx[j + 1]] === values[idx[i]]) j++;
    const p = ((i + j) / 2) / (idx.length - 1);
    for (let k = i; k <= j; k++) out[idx[k]] = p;
    i = j + 1;
  }
  return out;
}

const WEIGHTS = { relVolume: 0.35, move: 0.25, turnover: 0.25, momentum: 0.15 };

/* liveScore 0..100 per row from percentile ranks within the candidate set, so one outlier never dominates.
 * A component a row has no data for is left out of that row's average (needs at least two components). */
function scoreRows(rows) {
  const relV = rows.map((r) => (pos(r.previousVolume) && num(r.volume) !== null ? num(r.volume) / pos(r.previousVolume) : null));
  const move = rows.map((r) => (num(r.changePct) !== null ? Math.abs(num(r.changePct)) : null));
  const turn = rows.map((r) => { const t = num(r.turnover) !== null ? num(r.turnover) : (pos(r.price) && num(r.volume) !== null ? r.price * r.volume : null); return t !== null && t > 0 ? Math.log10(t) : null; });
  const mom = rows.map((r) => { const m = num(r.changeRate3min); const m5 = num(r.changeRate5min); const v = m !== null ? m : m5; return v !== null ? Math.abs(v) : null; });
  const P = { relVolume: percentiles(relV), move: percentiles(move), turnover: percentiles(turn), momentum: percentiles(mom) };
  return rows.map((_, i) => {
    let w = 0, s = 0, parts = 0;
    for (const key of Object.keys(WEIGHTS)) { const p = P[key][i]; if (p === null) continue; w += WEIGHTS[key]; s += WEIGHTS[key] * p; parts++; }
    return parts >= 2 && w > 0 ? Math.round((s / w) * 1000) / 10 : 0;
  });
}

/* Rank rows (already merged) and attach liveScore / liveRank / rankMove against the previous ranking. */
function rankRows(rows, previousRanks = new Map()) {
  const scores = scoreRows(rows);
  const order = rows.map((r, i) => ({ r, s: scores[i] }));
  order.sort((a, b) => (b.s - a.s) || ((num(b.r.turnover) || 0) - (num(a.r.turnover) || 0)) || (a.r.symbol < b.r.symbol ? -1 : a.r.symbol > b.r.symbol ? 1 : 0));
  const ranks = new Map();
  const ranked = order.map(({ r, s }, i) => {
    const liveRank = i + 1;
    ranks.set(r.symbol, liveRank);
    const before = previousRanks.get(r.symbol);
    return { ...r, liveScore: s, liveRank, rankMove: before ? before - liveRank : null };
  });
  return { rows: ranked, ranks };
}

/* Site rows win for the symbols they carry (richer fields); empty site fields are filled from the snapshot row. */
function mergeRows(baseRows, wideMap) {
  const out = [], seen = new Set();
  for (const b of Array.isArray(baseRows) ? baseRows : []) {
    if (!b || !b.symbol || seen.has(b.symbol)) continue;
    seen.add(b.symbol);
    const w = wideMap && wideMap.get(b.symbol);
    if (!w) { out.push(b); continue; }
    const merged = { ...b };
    for (const [k, v] of Object.entries(w)) if ((merged[k] === null || merged[k] === undefined || merged[k] === '') && v !== null && v !== undefined && k !== 'source') merged[k] = v;
    out.push(merged);
  }
  if (wideMap) for (const [symbol, w] of wideMap) if (!seen.has(symbol)) out.push(w);
  return out;
}

/* JSON stays small: drop empty fields (the table treats a missing field as "—"). */
function compactRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) if (v !== null && v !== undefined && v !== '') out[k] = v;
  return out;
}

/* One cached copy of the whole-market snapshot for every reader (Market Direction internals + the wide scanner).
 * TTL follows the session; one request in flight; a failure keeps serving the last good copy. An expired copy is
 * served at once while a refresh runs in the background (up to maxStaleMs old). */
function createSharedSnapshot({ snapshotAll, now = Date.now, logger = () => {}, session = () => marketState(now()).session, maxStaleMs = 1_800_000 } = {}) {
  if (typeof snapshotAll !== 'function') throw new TypeError('snapshotAll required');
  let copy = null; // { tickers, at }
  let inflight = null, retryAt = 0;
  const ttl = () => { const s = session(); return s === 'regular' || s === 'open' ? 20_000 : s === 'closed' ? 600_000 : 60_000; };
  const refresh = () => {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const tickers = await snapshotAll();
        if (!Array.isArray(tickers) || !tickers.length) throw new Error('snapshot_empty');
        copy = { tickers, at: now() };
        return copy;
      } catch (error) {
        retryAt = now() + 15_000;
        logger('warn', 'academy_snapshot_failed', { error: String(error && error.message || error) });
        if (copy) return copy;
        throw error;
      } finally { inflight = null; }
    })();
    return inflight;
  };
  async function latest() {
    const t = now();
    if (copy && t - copy.at < ttl()) return copy;
    if (copy && t - copy.at < maxStaleMs) { if (!inflight && t >= retryAt) refresh().catch(() => {}); return copy; }
    if (copy && t < retryAt) return copy;
    return refresh();
  }
  return {
    latest,
    snapshotAll: async () => (await latest()).tickers,
    peek: () => copy
  };
}

/* The wide scanner. base(): the site scanner payload; snapshots: createSharedSnapshot(); history + windowChange: the
 * server's price-history Map and calculateWindowChange so wide rows get the same 30 s .. 1 h change rates. */
function createWideScanner({ snapshots, base, now = Date.now, logger = () => {}, history = null, windowChange = null, state = () => marketState(now()), recomputeMs = 4_000 } = {}) {
  if (!snapshots || typeof snapshots.latest !== 'function') throw new TypeError('snapshots required');
  if (typeof base !== 'function') throw new TypeError('base required');
  let parsed = { at: 0, map: new Map() };
  let ranking = null; // { key, at, rows, asOf, version }
  let previousRanks = new Map();
  let version = 0;

  function parse(copy, regular) {
    if (!copy || copy.at === parsed.at) return parsed;
    const map = parseSnapshot(copy.tickers, { regular });
    parsed = { at: copy.at, map, momentumDone: false };
    return parsed;
  }

  /* feed wide-only symbols into the shared momentum history, once per snapshot copy */
  function addMomentum(p, baseSymbols) {
    if (p.momentumDone || !history || typeof windowChange !== 'function') return;
    p.momentumDone = true;
    const at = p.at;
    for (const [symbol, row] of p.map) {
      if (baseSymbols.has(symbol)) continue;
      const list = (history.get(symbol) || []).filter((s) => s.t >= at - HISTORY_MS);
      if (!list.length || at - list[list.length - 1].t >= 5_000) list.push({ t: at, price: row.price });
      history.set(symbol, list.slice(-400));
      const rate = (sec) => windowChange(row.price, list, at, sec * 1_000);
      const three = rate(180);
      row.changeRate30sec = rate(30).percent; row.changeRate1min = rate(60).percent; row.changeRate3min = three.percent;
      row.changeRate5min = rate(300).percent; row.changeRate15min = rate(900).percent; row.changeRate1hour = rate(3_600).percent;
      row.sireWindowSeconds = three.windowSeconds;
    }
  }

  async function get(limit) {
    const cap = clampLimit(limit);
    const st = state() || {};
    const regular = st.session === 'regular' || st.open === true;
    const [basePayload, copy] = await Promise.all([
      Promise.resolve().then(base).catch((error) => { logger('warn', 'academy_wide_base_failed', { error: String(error && error.message || error) }); return null; }),
      snapshots.latest().catch((error) => { logger('warn', 'academy_wide_snapshot_failed', { error: String(error && error.message || error) }); return null; })
    ]);
    const baseRows = basePayload && Array.isArray(basePayload.rows) ? basePayload.rows : [];
    if (!copy && !baseRows.length) {
      if (ranking) return payloadFrom(ranking, cap, st, true);
      throw new Error('wide_scanner_unavailable');
    }
    const p = copy ? parse(copy, regular) : null;
    const key = (basePayload && basePayload.asOf || 0) + '|' + (p ? p.at : 0) + '|' + baseRows.length;
    const t = now();
    /* re-rank only when the site rows or the snapshot changed (the site rows refresh every ~4 s), and never twice
       within recomputeMs / 4 so a burst of requests shares one ranking */
    if (!ranking || (ranking.key !== key && t - ranking.at >= recomputeMs / 4)) {
      const baseSymbols = new Set(baseRows.map((r) => r && r.symbol));
      if (p) addMomentum(p, baseSymbols);
      const merged = mergeRows(baseRows, p ? p.map : null);
      const { rows, ranks } = rankRows(merged, previousRanks);
      previousRanks = ranks;
      version += 1;
      ranking = {
        key, at: t, version, rows: rows.map(compactRow),
        asOf: Math.max(Number(basePayload && basePayload.asOf) || 0, p ? p.at : 0) || t,
        snapshotAt: p ? p.at : null, partial: !p, baseStale: !!(basePayload && basePayload.stale)
      };
    }
    return payloadFrom(ranking, cap, st, false);
  }

  function payloadFrom(r, cap, st, stale) {
    return {
      rows: r.rows.slice(0, cap), asOf: r.asOf, session: st.session || 'closed', marketOpen: st.open === true || st.session === 'regular',
      source: 'wide', universe: r.rows.length, limit: cap, version: r.version, snapshotAt: r.snapshotAt,
      ...(r.partial ? { partial: true } : {}), ...(stale || r.baseStale ? { stale: true } : {}),
      ranking: 'Ranked live by relative volume, size of move, money traded and 3-minute momentum. Educational use only.'
    };
  }

  return { get };
}

module.exports = { createWideScanner, createSharedSnapshot, rowFromSnapshot, parseSnapshot, plainSymbol, liquid, percentiles, scoreRows, rankRows, mergeRows, compactRow, clampLimit, MAX_LIMIT };
