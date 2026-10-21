'use strict';

/* STANDING ALERT LEVELS: the levels of a member's own open alerts, so the chart can keep them in front of the member every time
 * they come back, until the trade is over.
 *
 * Sources: the alert record (Click-to-Alert posts and the owner's desk alerts, academy-alert-record.js) and the member's Alert Chart
 * (academy-trader-alerts.js). For each trade the member has: entry, the CURRENT target and the stop.
 *
 * Which line shows, and when it goes:
 *   - a trade that is still open shows its current target as a live line, with its entry and stop;
 *   - a PT SMASHED follow-up (a further target posted after the first was reached) takes over: the line moves to the new target and
 *     the earlier ones are only remembered as hit;
 *   - the moment the current target trades it shows as HIT for a day (the win stays in view), then it is gone unless a new target is posted;
 *   - a trade that was stopped, ran out of time, or was closed shows nothing.
 * Pure helpers are exported for the tests; the service reads both sources and answers for one symbol. */

const DAY = 86_400_000;
const HIT_KEEP_MS = DAY;
const fin = Number.isFinite;
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return fin(n) ? n : null; };

/** Levels from the alert record's rows (already linked into chains by linkFollowUps): one item per trade chain. */
function fromRecord(rows, { symbol = '', now = Date.now() } = {}) {
  const sym = String(symbol || '').toUpperCase();
  const mine = (rows || []).filter((r) => r && r.symbol && (!sym || String(r.symbol).toUpperCase() === sym) && !String(r.symbol).includes(' '));
  const byChain = new Map();
  for (const r of mine) { const root = r.followUp ? r.rootRef : (r.ref || r.id); const k = String(root); (byChain.get(k) || byChain.set(k, []).get(k)).push(r); }
  const out = [];
  for (const posts of byChain.values()) {
    const asc = posts.slice().sort((a, b) => a.alertedAt - b.alertedAt), first = asc[0], cur = asc[asc.length - 1];
    if (!(num(cur.target) > 0) || !(num(first.entry) > 0)) continue;
    if (cur.result === 'stopped' || cur.result === 'missed' || cur.result === 'abandoned') continue;
    let state = 'live', hitAt = null;
    if (cur.result === 'win') { hitAt = num(cur.closedAt); if (hitAt == null || now - hitAt > HIT_KEEP_MS) continue; state = 'hit'; }
    else if (cur.status === 'closed') continue;
    out.push({ id: String(cur.id), source: 'record', symbol: String(cur.symbol).toUpperCase(), side: cur.side === 'short' ? 'short' : 'long', entry: num(first.entry), target: num(cur.target), stop: num(cur.stop) != null ? num(cur.stop) : num(first.stop), state, hitAt, alertedAt: first.alertedAt, horizon: cur.horizon || first.horizon || 'swing', smashed: asc.length - 1 });
  }
  return out;
}

/** Levels from the member's Alert Chart (alerts as decorated by academy-trader-alerts.js): the first target not yet hit, or HIT when all are. */
function fromChart(alerts, { symbol = '' } = {}) {
  const sym = String(symbol || '').toUpperCase(), out = [];
  for (const a of alerts || []) {
    if (!a || a.locked || a.status !== 'open' || !a.symbol || (sym && String(a.symbol).toUpperCase() !== sym)) continue;
    const ts = (a.targets || []).map((t) => ({ price: num(t.price), hit: !!t.hit })).filter((t) => t.price > 0);
    if (!ts.length || !(num(a.entry) > 0)) continue;
    const next = ts.find((t) => !t.hit);
    out.push({ id: 'c' + String(a.id), source: 'chart', symbol: String(a.symbol).toUpperCase(), side: a.side === 'short' ? 'short' : 'long', entry: num(a.entry), target: (next || ts[ts.length - 1]).price, stop: num(a.stop), state: next ? 'live' : 'hit', hitAt: null, alertedAt: Date.parse(a.createdAt) || null, horizon: '', smashed: ts.filter((t) => t.hit).length });
  }
  return out;
}

/** One list, newest first, with the same trade from both sources shown once. */
function merge(a, b) {
  const seen = new Set(), out = [];
  for (const x of [...a, ...b].sort((p, q) => (q.alertedAt || 0) - (p.alertedAt || 0))) {
    const k = x.symbol + '|' + x.side + '|' + (Math.round(x.target * 100) / 100);
    if (seen.has(k)) continue; seen.add(k); out.push(x);
  }
  return out.slice(0, 12);
}

function createAlertLevels({ record = null, traderAlerts = null, now = Date.now, logger = () => {} } = {}) {
  async function forMember(userId, symbol) {
    const id = String(userId || ''); if (!/^\d{15,25}$/.test(id)) return { ok: false, error: 'invalid_user' };
    let rec = [], chart = [];
    try { if (record && record.rowsOf) { const { linkFollowUps } = require('./academy-alert-record'); rec = fromRecord(linkFollowUps(await record.rowsOf(id)), { symbol, now: now() }); } } catch (error) { logger('warn', 'alert_levels_record_failed', { error: String((error && error.message) || error) }); }
    try { if (traderAlerts && traderAlerts.list) { const r = await traderAlerts.list(id, { viewerId: id, limit: 60, status: 'open' }); if (r && r.ok) chart = fromChart(r.alerts, { symbol }); } } catch (error) { logger('warn', 'alert_levels_chart_failed', { error: String((error && error.message) || error) }); }
    return { ok: true, symbol: String(symbol || '').toUpperCase(), levels: merge(rec, chart), asOf: now() };
  }
  return { forMember };
}

module.exports = { createAlertLevels, fromRecord, fromChart, merge, HIT_KEEP_MS };
