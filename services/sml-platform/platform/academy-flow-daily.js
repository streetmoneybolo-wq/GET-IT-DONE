'use strict';

/*
 * The daily flow ledger (academy_flow_days): one row per symbol per New York trading day, folded once a minute while the market
 * is in any session, so the swing, mid-term and long-term MEM ALGO models can read the week instead of the last five minutes.
 *
 * What goes in, per fold:
 *   - the tape: the Massive print stream when the symbol is watched there (every print, with sweeps, blocks and off-exchange
 *     volume), otherwise the moomoo prints the order-flow poll saw since the last fold. Buy = lifted the offer, sell = hit the bid.
 *     Large prints (1,000+ shares or $50,000+) are always counted from the moomoo prints, which carry the aggressor side.
 *   - the full-depth pressure reading (academy-depth-insights.js), sampled once a minute: the day's average and its strong minutes
 *   - the Level 2 reader's events (stack / pull / absorb / iceberg / flip) by side
 *   - moomoo's capital distribution (institutional vs retail net inflow), refreshed every half hour; a running daily total, replaced not added
 * Symbols: whatever the order-flow service is tracking (SPY, QQQ and what members have on the chart). SPY and QQQ can be backfilled
 * from the recorded full book's prints (academy_depth_snapshots) for the days before the ledger existed.
 *
 * Reading it is academy-flow-read.js (pure, shared with the page). Nothing here blocks a request: every database error is logged
 * and swallowed.
 */

const { etParts, marketState } = require('./market-clock');
const { readWindow } = require('./academy-flow-read');

const SYMBOL = /^[A-Z0-9.:-]{1,10}$/;
const LARGE_SHARES = 1000, LARGE_NOTIONAL = 50_000;
const INST_EVERY_MS = 30 * 60_000;
const pad = (n) => String(n).padStart(2, '0');
function dayKey(ms) { const p = etParts(ms); return p.y + '-' + pad(p.m) + '-' + pad(p.d); }
function dayStartMs(ms) { const p = etParts(ms); return ms - ((p.hh * 3600 + p.mm * 60 + p.ss) * 1000); }

const ADD_COLS = ['buy_vol', 'sell_vol', 'neu_vol', 'prints', 'notional', 'large_buy', 'large_sell', 'large_n', 'sweep_buy', 'sweep_sell', 'block_buy', 'block_sell', 'off_vol', 'pressure_sum', 'pressure_n', 'bull_minutes', 'bear_minutes', 'ev_bull', 'ev_bear'];
const UPSERT = 'INSERT INTO academy_flow_days (symbol, day, tape_source, ' + ADD_COLS.join(', ') + ', hi, lo, last_px, updated_at) VALUES ($1, $2::date, $3, '
  + ADD_COLS.map((_, i) => '$' + (i + 4)).join(', ') + ', $' + (ADD_COLS.length + 4) + ', $' + (ADD_COLS.length + 5) + ', $' + (ADD_COLS.length + 6) + ', now()) '
  + 'ON CONFLICT (symbol, day) DO UPDATE SET tape_source = EXCLUDED.tape_source, ' + ADD_COLS.map((c) => c + ' = academy_flow_days.' + c + ' + EXCLUDED.' + c).join(', ')
  + ', hi = GREATEST(academy_flow_days.hi, EXCLUDED.hi), lo = LEAST(academy_flow_days.lo, EXCLUDED.lo), last_px = COALESCE(EXCLUDED.last_px, academy_flow_days.last_px), updated_at = now()';
const UPSERT_INST = 'INSERT INTO academy_flow_days (symbol, day, inst_net, retail_net, updated_at) VALUES ($1, $2::date, $3, $4, now()) ON CONFLICT (symbol, day) DO UPDATE SET inst_net = EXCLUDED.inst_net, retail_net = EXCLUDED.retail_net, updated_at = now()';
const BACKFILL = `INSERT INTO academy_flow_days (symbol, day, tape_source, buy_vol, sell_vol, neu_vol, prints, notional, large_buy, large_sell, large_n, hi, lo, last_px)
SELECT $1, day, 'depth',
  COALESCE(sum(size) FILTER (WHERE dir = 'B'), 0)::bigint, COALESCE(sum(size) FILTER (WHERE dir = 'S'), 0)::bigint, COALESCE(sum(size) FILTER (WHERE dir NOT IN ('B', 'S')), 0)::bigint,
  count(*)::int, COALESCE(sum(price * size), 0),
  COALESCE(sum(size) FILTER (WHERE dir = 'B' AND (size >= ${LARGE_SHARES} OR price * size >= ${LARGE_NOTIONAL})), 0)::bigint,
  COALESCE(sum(size) FILTER (WHERE dir = 'S' AND (size >= ${LARGE_SHARES} OR price * size >= ${LARGE_NOTIONAL})), 0)::bigint,
  (count(*) FILTER (WHERE size >= ${LARGE_SHARES} OR price * size >= ${LARGE_NOTIONAL}))::int,
  max(price), min(price), (array_agg(price ORDER BY t DESC))[1]
FROM (
  SELECT (s.ts AT TIME ZONE 'America/New_York')::date AS day, (e->>0)::bigint AS t, (e->>1)::numeric AS price, (e->>2)::numeric AS size, e->>3 AS dir
    FROM academy_depth_snapshots s, jsonb_array_elements(s.prints) e
   WHERE s.symbol = $1 AND s.ts >= now() - ($2 || ' days')::interval
) p
WHERE day < (now() AT TIME ZONE 'America/New_York')::date AND price > 0 AND size > 0
GROUP BY day
ON CONFLICT (symbol, day) DO NOTHING`;

function createFlowDaily({ pool = null, now = Date.now, orderFlow = null, massive = null, institutional = null, logger = () => {}, timers = { setTimeout, clearTimeout }, foldMs = 60_000, extraSymbols = [] } = {}) {
  const configured = Boolean(pool && typeof pool.query === 'function');
  const marks = new Map(); // symbol -> { day, lastPrintT, lastEventT, massive, instAt }
  let running = false, timer = null, warnedAt = 0, folds = 0, lastFoldAt = 0;

  function markFor(symbol, day) {
    let m = marks.get(symbol);
    if (!m || m.day !== day) { m = { day, lastPrintT: 0, lastEventT: 0, massive: null, instAt: 0 }; marks.set(symbol, m); }
    return m;
  }

  /* the moomoo prints the order-flow poll saw since the last fold, for this day only */
  function foldPrints(e, m, day) {
    const out = { buy: 0, sell: 0, neu: 0, prints: 0, notional: 0, largeBuy: 0, largeSell: 0, largeN: 0, hi: null, lo: null, last: null, lastT: m.lastPrintT };
    for (const p of (e && Array.isArray(e.prints) ? e.prints : [])) {
      if (!(p.t > m.lastPrintT) || dayKey(p.t) !== day || !(p.size > 0) || !(p.price > 0)) continue;
      out.prints += 1; out.notional += p.price * p.size;
      if (p.dir === 'B') out.buy += p.size; else if (p.dir === 'S') out.sell += p.size; else out.neu += p.size;
      if (p.size >= LARGE_SHARES || p.price * p.size >= LARGE_NOTIONAL) { out.largeN += 1; if (p.dir === 'B') out.largeBuy += p.size; else if (p.dir === 'S') out.largeSell += p.size; }
      if (out.hi == null || p.price > out.hi) out.hi = p.price;
      if (out.lo == null || p.price < out.lo) out.lo = p.price;
      if (p.t >= out.lastT) { out.lastT = p.t; out.last = p.price; }
    }
    m.lastPrintT = out.lastT;
    return out;
  }

  /* the Massive stream's session totals, turned into what was added since the last fold; a reset (deploy, re-watch) shows as a drop and the new totals count whole */
  function foldMassive(symbol, m, ms) {
    if (!massive || typeof massive.peek !== 'function') return null;
    let p = null; try { p = massive.peek(symbol); } catch (_) { p = null; }
    const st = p && p.stats; if (!st || !(st.count > 0)) return null;
    const cur = { buy: Number(st.buy) || 0, sell: Number(st.sell) || 0, neu: Number(st.neu) || 0, count: Number(st.count) || 0, notional: (Number(st.vwap) || 0) * (Number(st.vol) || 0), offVol: Number(st.offVol) || 0, sweepBuy: Number(st.sweepBuy) || 0, sweepSell: Number(st.sweepSell) || 0, blockBuy: Number(st.blockBuy) || 0, blockSell: Number(st.blockSell) || 0 };
    const prev = m.massive; m.massive = cur;
    if (!prev) {
      /* first look: the totals count only if the stream opened today (otherwise they hold older sessions and the next fold starts the deltas) */
      return Number(st.since) >= dayStartMs(ms) ? cur : null;
    }
    const grew = Object.keys(cur).every((k) => cur[k] >= prev[k] - 1e-6);
    if (!grew) return cur; // the stream reset: everything in it is new
    const d = {}; for (const k of Object.keys(cur)) d[k] = cur[k] - prev[k];
    return d.count > 0 ? d : null;
  }

  async function fold(symbol, ms) {
    const day = dayKey(ms), m = markFor(symbol, day);
    const e = orderFlow && orderFlow.engines ? orderFlow.engines.get(symbol) : null;
    const pr = foldPrints(e, m, day);
    const mv = foldMassive(symbol, m, ms);
    const useMassive = Boolean(mv && mv.buy + mv.sell + mv.neu > 0);
    const vol = useMassive ? mv : pr;
    let pressure = null;
    if (orderFlow && typeof orderFlow.insights === 'function') { try { const ins = orderFlow.insights(symbol); if (ins && ins.ready && ins.pressure) pressure = Number(ins.pressure.score) || 0; } catch (_) { pressure = null; } }
    let evBull = 0, evBear = 0;
    if (e && e.flow && typeof e.flow.events === 'function') {
      let maxT = m.lastEventT;
      for (const ev of e.flow.events()) { if (!(ev.t > m.lastEventT)) continue; if (ev.side === 'bull') evBull += 1; else if (ev.side === 'bear') evBear += 1; if (ev.t > maxT) maxT = ev.t; }
      m.lastEventT = maxT;
    }
    const nothing = !(vol.buy + vol.sell + vol.neu > 0) && pressure == null && !evBull && !evBear && !pr.prints;
    if (!nothing) {
      const values = [symbol, day, useMassive ? 'massive' : 'moomoo',
        Math.round(vol.buy), Math.round(vol.sell), Math.round(vol.neu), useMassive ? Math.round(mv.count) : pr.prints, Math.round(useMassive ? mv.notional : pr.notional),
        Math.round(pr.largeBuy), Math.round(pr.largeSell), pr.largeN,
        useMassive ? Math.round(mv.sweepBuy) : 0, useMassive ? Math.round(mv.sweepSell) : 0, useMassive ? Math.round(mv.blockBuy) : 0, useMassive ? Math.round(mv.blockSell) : 0, useMassive ? Math.round(mv.offVol) : 0,
        pressure == null ? 0 : pressure, pressure == null ? 0 : 1, pressure != null && pressure >= 40 ? 1 : 0, pressure != null && pressure <= -40 ? 1 : 0, evBull, evBear,
        pr.hi, pr.lo, pr.last];
      await pool.query(UPSERT, values);
      folds += 1;
    }
    if (institutional && typeof institutional.get === 'function' && ms - m.instAt >= INST_EVERY_MS) {
      m.instAt = ms;
      try {
        const r = await institutional.get(symbol);
        const cap = r && r.capital;
        if (cap && Number.isFinite(Number(cap.institutionalNet))) await pool.query(UPSERT_INST, [symbol, day, Number(cap.institutionalNet), Number.isFinite(Number(cap.retailNet)) ? Number(cap.retailNet) : null]);
      } catch (error) { warn('flow_daily_institutional_failed', { symbol, error: String(error && error.message || error).slice(0, 120) }); }
    }
    return !nothing;
  }

  function warn(event, data) { if (now() - warnedAt > 300_000) { warnedAt = now(); logger('warn', event, data); } }

  function symbols() {
    const set = new Set((extraSymbols || []).map((s) => String(s).toUpperCase()).filter((s) => SYMBOL.test(s)));
    if (orderFlow && orderFlow.engines) for (const s of orderFlow.engines.keys()) if (SYMBOL.test(s)) set.add(s);
    return [...set];
  }

  /** One fold of every tracked symbol; nothing outside the pre, regular and post sessions. */
  async function tick() {
    if (!configured) return [];
    const ms = now();
    if (marketState(ms).session === 'closed') return [];
    const done = [];
    for (const symbol of symbols()) {
      try { if (await fold(symbol, ms)) done.push(symbol); }
      catch (error) { warn('flow_daily_fold_failed', { symbol, error: String(error && error.message || error).slice(0, 160) }); }
    }
    lastFoldAt = ms;
    return done;
  }

  function schedule() {
    if (!running) return;
    timer = timers.setTimeout(() => { tick().catch(() => {}).finally(schedule); }, foldMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }
  function start() { if (running || !configured) return false; running = true; schedule(); return true; }
  function stop() { running = false; if (timer) timers.clearTimeout(timer); timer = null; }

  /** The last `days` trading days for a symbol, read as a window (academy-flow-read.js). Today's row is marked partial while a session is on. */
  async function summary(symbolRaw, days = 10) {
    const symbol = String(symbolRaw || '').toUpperCase();
    if (!SYMBOL.test(symbol)) throw new TypeError('invalid_symbol');
    if (!configured) return { ok: false, error: 'flow_days_unconfigured', symbol };
    const n = Math.max(1, Math.min(60, Math.round(Number(days) || 10)));
    const r = await pool.query('SELECT * FROM academy_flow_days WHERE symbol = $1 ORDER BY day DESC LIMIT $2', [symbol, n]);
    const today = dayKey(now()), open = marketState(now()).session !== 'closed';
    const rows = r.rows.slice().reverse().map((row) => {
      const key = row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10);
      return { ...row, day: key, partial: key === today && open };
    });
    return { ...readWindow(rows, { symbol }), asOf: now(), days: rows.length ? readWindow(rows, { symbol }).days : [] };
  }

  /** Days before today from the recorded full book's prints (SPY and QQQ by default); existing rows are left alone. */
  async function backfill(symbolRaw, days = 30) {
    const symbol = String(symbolRaw || '').toUpperCase();
    if (!SYMBOL.test(symbol)) throw new TypeError('invalid_symbol');
    if (!configured) return 0;
    const r = await pool.query(BACKFILL, [symbol, String(Math.max(1, Math.min(90, Math.round(Number(days) || 30))))]);
    return r.rowCount || 0;
  }

  function status() { return { configured, running, folds, lastFoldAt, symbols: symbols(), marks: marks.size }; }

  return { configured, start, stop, tick, fold, summary, backfill, status, symbols, dayKey };
}

module.exports = { createFlowDaily, dayKey, dayStartMs, LARGE_SHARES, LARGE_NOTIONAL };
