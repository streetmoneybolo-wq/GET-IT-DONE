'use strict';

/* The alert record: every alert a member sends is kept and scored, and the score is public on their Academy profile.
 *
 * Sources. Click-to-Alert posts (academy_click_alerts: the member's Discord id, the entry at the click, the clicked target,
 * the stop, the horizon) and the owner's own alerts from the alert desk's channels (academy-alerts.js, backfilled from a
 * start date), each kept once by its Discord message id. A click alert that was posted into a desk channel is one alert,
 * not two: the desk copy is attributed to the member and skipped here.
 *
 * Scoring. The alert is judged from its entry to its FIRST price target, nothing else: a WIN the moment that target trades,
 * STOPPED when the stop trades first, MISSED when its horizon runs out without the target (a day trade gets 2 trading days,
 * a swing 10, a mid hold 130, a long hold 260). A bar that trades through both the target and the stop counts the stop
 * first. A win keeps being watched until its horizon ends so the peak (the best price the trade saw, the high for a long,
 * the low for a short) and the current gain or loss cover the whole run. The current gain or loss is the last price
 * against the entry, signed by the side.
 *
 * PT SMASHED updates are not alerts. A later post by the same member on the same ticker and side, within 21 days of an
 * alert, with a further target, after that alert's target traded (or sent from beyond it), is a follow-up of that alert:
 * it is kept, shown on the first alert's row, and never counted. A new target that is not reached is not a loss.
 * Take-profit posts and the Academy's automatic updates are never kept.
 *
 * The record. Win rate over the last 90 days = wins / (wins + stopped + missed) among alerts sent in that window; open
 * alerts are shown but not counted. Top ten = the member's ten best peaks of all time, each with the date and time of the
 * alert, the peak, how long the peak took, and where price is now. Research and education only. */

const SNOWFLAKE = /^\d{15,25}$/;
const fin = Number.isFinite;
const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return fin(n) ? n : d; };
const r2 = (v) => Math.round(v * 100) / 100;
const DAY = 86_400_000;
const HORIZON_TRADING_DAYS = { day: 2, swing: 10, mid: 130, long: 260 };
const WINDOW_MS = 90 * DAY;
const SMASH_WINDOW_MS = 21 * DAY; // the Click-to-Alert desk's own window for a PT SMASHED update (academy-click-alert.js)
const NOT_AN_ALERT = /PT SMASHED|NEW PT SET|TAKE PROFITS|PROFITS TAKEN|SOLD/i;

/* the signed move of `price` from `entry`, in percent */
function movePct(side, entry, price) { if (!(entry > 0) || !(price > 0)) return null; return r2((price - entry) / entry * 100 * (side === 'short' ? -1 : 1)); }
/* trading days as calendar days, roughly (weekends only) */
const calendarMs = (tradingDays) => Math.round(tradingDays * 7 / 5) * DAY;

/* settle one open alert against the bars since it was sent (any mix of daily and intraday bars; newest last).
   The result is decided once, from the entry to the first target; a win stays open (peak and last keep moving) until its horizon ends. */
function settleAlert(a, bars, nowMs) {
  const since = Number(a.alertedAt);
  const list = (bars || []).filter((b) => b && num(b.t) > since && num(b.h) != null && num(b.l) != null && num(b.c) != null).sort((x, y) => x.t - y.t);
  const short = a.side === 'short';
  const horizonMs = calendarMs(HORIZON_TRADING_DAYS[a.horizon] || 10);
  let peakPct = a.peakPct != null ? Number(a.peakPct) : null, peakAt = a.peakAt ? Number(a.peakAt) : null, last = null, lastT = null;
  const out = { ...a, status: 'open', result: a.result || null, closedAt: a.closedAt || null, closePct: a.closePct != null ? a.closePct : null };
  for (const b of list) {
    const best = short ? b.l : b.h;
    const bp = movePct(a.side, a.entry, best);
    if (bp != null && (peakPct == null || bp > peakPct)) { peakPct = bp; peakAt = b.t; }
    last = b.c; lastT = b.t;
    if (!out.result) {
      const stopped = a.stop != null && a.stop > 0 && (short ? b.h >= a.stop : b.l <= a.stop);
      const hit = a.target != null && a.target > 0 && (short ? b.l <= a.target : b.h >= a.target);
      if (stopped) return { ...out, status: 'closed', result: 'stopped', closedAt: b.t, closePct: movePct(a.side, a.entry, a.stop), peakPct, peakAt, lastPrice: b.c, lastPct: movePct(a.side, a.entry, b.c), lastAt: b.t };
      if (hit) { out.result = 'win'; out.closedAt = b.t; out.closePct = movePct(a.side, a.entry, a.target); }
    }
    if (b.t - since >= horizonMs) {
      if (!out.result) return { ...out, status: 'closed', result: 'missed', closedAt: b.t, closePct: movePct(a.side, a.entry, b.c), peakPct, peakAt, lastPrice: b.c, lastPct: movePct(a.side, a.entry, b.c), lastAt: b.t };
      return { ...out, status: 'closed', peakPct, peakAt, lastPrice: b.c, lastPct: movePct(a.side, a.entry, b.c), lastAt: b.t };
    }
  }
  if (last != null) Object.assign(out, { lastPrice: last, lastPct: movePct(a.side, a.entry, last), lastAt: lastT });
  /* an alert older than 400 days with nothing to score is abandoned */
  if (!list.length && !out.result && nowMs - since > 400 * DAY) return { ...out, status: 'closed', result: 'abandoned', closedAt: nowMs };
  return { ...out, peakPct, peakAt };
}

/* mark the PT SMASHED follow-ups among one member's rows: each gets `followUp: true` and the `rootRef` of the alert it rides */
function linkFollowUps(rows) {
  const asc = (rows || []).filter(Boolean).slice().sort((a, b) => a.alertedAt - b.alertedAt);
  const roots = new Map(); // `${symbol}:${side}` -> the open chain's root and its latest post
  for (const a of asc) {
    a.followUp = false; a.rootRef = null;
    const key = a.symbol + ':' + a.side;
    const chain = roots.get(key);
    if (chain && a.alertedAt - chain.lastAt <= SMASH_WINDOW_MS) {
      const prev = chain.last, root = chain.root, short = a.side === 'short';
      const further = prev.target > 0 && a.target > 0 && (short ? a.target < prev.target : a.target > prev.target);
      const targetPct = movePct(a.side, prev.entry, prev.target);
      const prevHit = root.result === 'win' || prev.result === 'win' || (prev.peakPct != null && targetPct != null && prev.peakPct >= targetPct) || (prev.target > 0 && (short ? a.entry <= prev.target : a.entry >= prev.target));
      if (further && prevHit) { a.followUp = true; a.rootRef = root.ref || root.id; roots.set(key, { root, last: a, lastAt: a.alertedAt }); continue; }
    }
    roots.set(key, { root: a, last: a, lastAt: a.alertedAt });
  }
  return rows;
}

/* the record from a member's rows */
function summarize(rows, nowMs) {
  const all = linkFollowUps((rows || []).filter(Boolean)).sort((a, b) => b.alertedAt - a.alertedAt);
  const counted = all.filter((a) => !a.followUp);
  const follow = new Map(); for (const a of all) if (a.followUp) follow.set(a.rootRef, (follow.get(a.rootRef) || 0) + 1);
  const scored = (list) => { const closed = list.filter((a) => a.result && a.result !== 'abandoned'); const wins = closed.filter((a) => a.result === 'win'); return { alerts: list.length, open: list.filter((a) => !a.result).length, closed: closed.length, wins: wins.length, stopped: closed.filter((a) => a.result === 'stopped').length, missed: closed.filter((a) => a.result === 'missed').length, winRatePct: closed.length ? Math.round(wins.length / closed.length * 100) : null, avgPeakPct: list.filter((a) => a.peakPct != null).length ? r2(list.filter((a) => a.peakPct != null).reduce((s, a) => s + a.peakPct, 0) / list.filter((a) => a.peakPct != null).length) : null }; };
  const window = counted.filter((a) => nowMs - a.alertedAt <= WINDOW_MS);
  const rowOf = (a) => row(a, follow.get(a.ref || a.id) || 0);
  const top = counted.filter((a) => a.peakPct != null).sort((a, b) => b.peakPct - a.peakPct || a.alertedAt - b.alertedAt).slice(0, 10).map(rowOf);
  return { ninetyDay: { ...scored(window), sinceMs: nowMs - WINDOW_MS }, allTime: scored(counted), followUps: all.length - counted.length, top, recent: counted.slice(0, 10).map(rowOf), firstAt: counted.length ? counted[counted.length - 1].alertedAt : null };
}
function row(a, followUps = 0) {
  return { id: a.id, source: a.source, symbol: a.symbol, side: a.side, horizon: a.horizon, entry: a.entry, target: a.target, stop: a.stop, alertedAt: a.alertedAt, status: a.status, result: a.result, followUps,
    peakPct: a.peakPct, peakAt: a.peakAt, timeToPeakMs: a.peakAt != null ? Math.max(0, a.peakAt - a.alertedAt) : null, lastPrice: a.lastPrice, lastPct: a.lastPct, lastAt: a.lastAt, closedAt: a.closedAt, closePct: a.closePct };
}

function createAlertRecord({ pool = null, candles = null, quote = null, clickAlerts = null, deskAlerts = null, backfill = null, ownerIds = [], since = '2026-10-05', now = Date.now, logger = () => {}, timers = { setTimeout, clearTimeout, setInterval, clearInterval }, settleMs = 10 * 60_000, perPass = 40 } = {}) {
  const db = pool && typeof pool.query === 'function' ? pool : null;
  const owners = new Set((ownerIds || []).map(String));
  const sinceMs = Date.parse(String(since).length === 10 ? since + 'T00:00:00-04:00' : since) || Date.parse('2026-10-05T00:00:00-04:00');
  const mem = new Map(); // `${source}:${ref}` -> row (when there is no database)
  const summaries = new Map();
  let schemaReady = null, timer = null, busy = false, backfilled = false;

  async function ensureSchema() {
    if (!db) return;
    if (schemaReady) return schemaReady;
    schemaReady = (async () => {
      try {
        await db.query(`CREATE TABLE IF NOT EXISTS academy_alert_record (id BIGSERIAL PRIMARY KEY, discord_id TEXT NOT NULL, source TEXT NOT NULL, ref TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, entry NUMERIC(18,6) NOT NULL, target NUMERIC(18,6), stop NUMERIC(18,6), horizon TEXT NOT NULL DEFAULT 'swing', alerted_at TIMESTAMPTZ NOT NULL, status TEXT NOT NULL DEFAULT 'open', result TEXT, peak_pct NUMERIC(10,4), peak_at TIMESTAMPTZ, last_price NUMERIC(18,6), last_pct NUMERIC(10,4), last_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, close_pct NUMERIC(10,4), checked_at TIMESTAMPTZ, UNIQUE (source, ref))`);
        await db.query('CREATE INDEX IF NOT EXISTS academy_alert_record_user_idx ON academy_alert_record (discord_id, alerted_at DESC)');
        await db.query("CREATE INDEX IF NOT EXISTS academy_alert_record_open_idx ON academy_alert_record (status, checked_at) WHERE status = 'open'");
        /* a win keeps being watched until its horizon ends: rows closed at the target by the first release are opened again until they have seen a later bar */
        await db.query("UPDATE academy_alert_record SET status = 'open' WHERE result = 'win' AND status = 'closed' AND alerted_at > now() - interval '45 days' AND (last_at IS NULL OR last_at <= closed_at)");
        /* take-profit posts were never alerts */
        await db.query("DELETE FROM academy_alert_record r USING academy_click_alerts c WHERE r.source = 'click' AND r.ref = c.message_id AND c.confidence = 'n/a'");
      } catch (error) { logger('warn', 'alert_record_schema_failed', { error: String(error && error.message || error) }); }
    })();
    return schemaReady;
  }
  const fromRow = (r) => ({ id: String(r.id), userId: String(r.discord_id), source: r.source, ref: String(r.ref), symbol: r.symbol, side: r.side, entry: num(r.entry), target: num(r.target), stop: num(r.stop), horizon: r.horizon || 'swing', alertedAt: Date.parse(r.alerted_at), status: r.status, result: r.result || null, peakPct: num(r.peak_pct), peakAt: r.peak_at ? Date.parse(r.peak_at) : null, lastPrice: num(r.last_price), lastPct: num(r.last_pct), lastAt: r.last_at ? Date.parse(r.last_at) : null, closedAt: r.closed_at ? Date.parse(r.closed_at) : null, closePct: num(r.close_pct), checkedAt: r.checked_at ? Date.parse(r.checked_at) : null });

  /* keep one alert; the (source, ref) pair makes it idempotent */
  async function keep(a) {
    const rec = { userId: String(a.userId), source: a.source, ref: String(a.ref), symbol: String(a.symbol || '').toUpperCase(), side: a.side === 'short' ? 'short' : 'long', entry: num(a.entry), target: num(a.target), stop: num(a.stop), horizon: HORIZON_TRADING_DAYS[a.horizon] ? a.horizon : 'swing', alertedAt: Number(a.alertedAt), status: 'open', result: null, peakPct: null, peakAt: null, lastPrice: null, lastPct: null, lastAt: null, closedAt: null, closePct: null, checkedAt: null };
    if (!SNOWFLAKE.test(rec.userId) || !rec.symbol || !(rec.entry > 0) || !fin(rec.alertedAt) || rec.alertedAt < sinceMs - 30 * DAY) return false;
    if (db) {
      await ensureSchema();
      const r = await db.query('INSERT INTO academy_alert_record (discord_id, source, ref, symbol, side, entry, target, stop, horizon, alerted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,to_timestamp($10 / 1000.0)) ON CONFLICT (source, ref) DO NOTHING RETURNING id', [rec.userId, rec.source, rec.ref, rec.symbol, rec.side, rec.entry, rec.target, rec.stop, rec.horizon, rec.alertedAt]);
      return r.rowCount > 0;
    }
    const key = rec.source + ':' + rec.ref; if (mem.has(key)) return false; mem.set(key, { ...rec, id: String(mem.size + 1) }); return true;
  }
  /* the click alerts since the start date (every member) */
  async function importClick() {
    let rows = [];
    if (typeof clickAlerts === 'function') rows = (await clickAlerts(sinceMs)) || [];
    else if (db) { const r = await db.query("SELECT discord_id, message_id, symbol, side, entry, target, stop, horizon, created_at FROM academy_click_alerts WHERE created_at >= to_timestamp($1 / 1000.0) AND discord_id <> 'auto' AND position(' ' in symbol) = 0 AND confidence <> 'n/a' ORDER BY created_at DESC LIMIT 5000", [sinceMs]); rows = r.rows.map((x) => ({ userId: x.discord_id, messageId: x.message_id, symbol: x.symbol, side: x.side, entry: x.entry, target: x.target, stop: x.stop, horizon: x.horizon, at: Date.parse(x.created_at) })); }
    let added = 0;
    for (const x of rows) { if (!x || x.confidence === 'n/a' || x.userId === 'auto' || /\s/.test(String(x.symbol || ''))) continue; try { if (await keep({ userId: x.userId, source: 'click', ref: x.messageId, symbol: x.symbol, side: x.side, entry: x.entry, target: x.target, stop: x.stop, horizon: x.horizon, alertedAt: num(x.at, Date.parse(x.createdAt)) })) added += 1; } catch (error) { logger('warn', 'alert_record_keep_failed', { source: 'click', error: String(error && error.message || error) }); } }
    return added;
  }
  /* the desk's alerts: the owner's own channels, each alert the owner's unless a member sent it through the Academy (then it is a click row) */
  async function importDesk() {
    if (typeof deskAlerts !== 'function' || !owners.size) return 0;
    const owner = [...owners][0];
    let list = []; try { list = (await deskAlerts()) || []; } catch (error) { logger('warn', 'alert_record_desk_failed', { error: String(error && error.message || error) }); return 0; }
    let added = 0;
    for (const a of list) {
      if (!a || !a.symbol || !(num(a.entry) > 0) || !fin(Number(a.at)) || Number(a.at) < sinceMs) continue;
      if (a.via === 'academy') continue;
      if (NOT_AN_ALERT.test(String(a.raw || ''))) continue; // a PT SMASHED or take-profit post is not a new alert
      const userId = owners.has(String(a.authorId)) ? String(a.authorId) : owner;
      try { if (await keep({ userId, source: 'desk', ref: a.id, symbol: a.symbol, side: a.side === 'short' ? 'short' : 'long', entry: a.entry, target: a.target, stop: a.stop, horizon: a.channel === 'longterm' ? 'long' : 'swing', alertedAt: Number(a.at) })) added += 1; } catch (error) { logger('warn', 'alert_record_keep_failed', { source: 'desk', error: String(error && error.message || error) }); }
    }
    return added;
  }
  /* the rows to score: open ones not checked in the last half hour, oldest check first */
  async function openRows(limit) {
    if (db) { await ensureSchema(); const r = await db.query("SELECT * FROM academy_alert_record WHERE status = 'open' AND (checked_at IS NULL OR checked_at < now() - interval '30 minutes') ORDER BY checked_at NULLS FIRST, alerted_at ASC LIMIT $1", [limit]); return r.rows.map(fromRow); }
    return [...mem.values()].filter((a) => a.status === 'open' && (!a.checkedAt || now() - a.checkedAt > 30 * 60_000)).slice(0, limit);
  }
  async function store(a) {
    if (db) { await db.query('UPDATE academy_alert_record SET status=$2, result=$3, peak_pct=$4, peak_at=CASE WHEN $5::double precision IS NULL THEN NULL ELSE to_timestamp($5 / 1000.0) END, last_price=$6, last_pct=$7, last_at=CASE WHEN $8::double precision IS NULL THEN NULL ELSE to_timestamp($8 / 1000.0) END, closed_at=CASE WHEN $9::double precision IS NULL THEN NULL ELSE to_timestamp($9 / 1000.0) END, close_pct=$10, checked_at=now() WHERE id=$1', [a.id, a.status, a.result, a.peakPct, a.peakAt, a.lastPrice, a.lastPct, a.lastAt, a.closedAt, a.closePct]); return; }
    const key = a.source + ':' + a.ref; if (mem.has(key)) mem.set(key, { ...mem.get(key), ...a, checkedAt: now() });
  }
  /* bars since the alert: the daily series, plus the intraday series for the exact time of the peak when it is recent */
  async function barsFor(symbol, sinceAt) {
    const out = [];
    const read = async (tf) => { try { const r = await candles(symbol, tf); return r && Array.isArray(r.bars) ? r.bars : Array.isArray(r) ? r : []; } catch (_) { return []; } };
    if (typeof candles !== 'function') return out;
    const daily = await read('1D');
    const intraday = now() - sinceAt < 12 * DAY ? await read('5m') : [];
    if (intraday.length) { const first = Number(intraday[0].t); for (const b of daily) if (Number(b.t) + DAY <= first) out.push(b); out.push(...intraday); } else out.push(...daily);
    return out;
  }
  async function settle() {
    if (busy) return { settled: 0 }; busy = true;
    const t0 = now(); let settled = 0, closed = 0;
    try {
      const rows = await openRows(perPass);
      for (const a of rows) {
        const bars = await barsFor(a.symbol, a.alertedAt);
        const s = settleAlert(a, bars, now());
        await store(s); settled += 1; if (s.status === 'closed') closed += 1;
      }
      summaries.clear();
    } catch (error) { logger('warn', 'alert_record_settle_failed', { error: String(error && error.message || error) }); }
    finally { busy = false; }
    return { settled, closed, ms: now() - t0 };
  }
  async function sweep() {
    const added = { click: 0, desk: 0 };
    try { added.click = await importClick(); } catch (error) { logger('warn', 'alert_record_import_failed', { source: 'click', error: String(error && error.message || error) }); }
    try { added.desk = await importDesk(); } catch (error) { logger('warn', 'alert_record_import_failed', { source: 'desk', error: String(error && error.message || error) }); }
    const s = await settle();
    if (added.click || added.desk || s.closed) logger('info', 'alert_record_sweep', { ...added, ...s });
    return { added, ...s };
  }
  /* the desk's history from the start date, once per process (the desk keeps a short window on its own) */
  async function backfillDesk() {
    if (backfilled || typeof backfill !== 'function') return 0;
    backfilled = true;
    try { const n = await backfill(sinceMs); logger('info', 'alert_record_backfill', { since, read: n }); return n; } catch (error) { logger('warn', 'alert_record_backfill_failed', { error: String(error && error.message || error) }); return 0; }
  }

  async function rowsOf(userId) {
    const id = String(userId);
    if (db) { await ensureSchema(); const r = await db.query('SELECT * FROM academy_alert_record WHERE discord_id = $1 ORDER BY alerted_at DESC LIMIT 1000', [id]); return r.rows.map(fromRow); }
    return [...mem.values()].filter((a) => a.userId === id);
  }
  /* the member's record, with the top ten's current prices refreshed from the live quote; remembered two minutes */
  async function summary(userId) {
    const id = String(userId); if (!SNOWFLAKE.test(id)) return null;
    const hit = summaries.get(id); if (hit && now() - hit.at < 120_000) return hit.v;
    const rows = await rowsOf(id);
    const v = summarize(rows, now());
    if (typeof quote === 'function') {
      for (const r of v.top) { try { const q = await quote(r.symbol); const last = q && num(q.last); if (last > 0) { r.lastPrice = last; r.lastPct = movePct(r.side, r.entry, last); r.lastAt = now(); r.live = true; } } catch (_) { /* the stored last stands */ } }
    }
    v.userId = id; v.asOf = now(); v.since = since;
    summaries.set(id, { at: now(), v }); if (summaries.size > 1000) summaries.delete(summaries.keys().next().value);
    return v;
  }
  function start() {
    if (timer) return;
    timer = timers.setInterval(() => { sweep().catch(() => {}); }, settleMs); if (timer.unref) timer.unref();
    const first = timers.setTimeout(() => { backfillDesk().then(() => sweep()).catch(() => {}); }, 90_000); if (first.unref) first.unref();
  }
  function stop() { if (timer) { timers.clearInterval(timer); timer = null; } }
  return { ensureSchema, keep, importClick, importDesk, backfillDesk, settle, sweep, summary, rowsOf, start, stop, sinceMs };
}

module.exports = { createAlertRecord, settleAlert, summarize, linkFollowUps, movePct, HORIZON_TRADING_DAYS, WINDOW_MS, SMASH_WINDOW_MS };
