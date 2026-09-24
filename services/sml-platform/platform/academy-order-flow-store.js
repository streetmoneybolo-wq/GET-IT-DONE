'use strict';

const KINDS = new Set(['stack', 'pull', 'absorb', 'iceberg', 'flip']);
const SIDES = new Set(['bull', 'bear']);
const SYMBOL = /^[A-Z0-9.:-]{1,10}$/;

/* Research log of detected order-flow events and what price did next. Never blocks the live reading: callers swallow its errors. */
function createOrderFlowStore({ pool } = {}) {
  const configured = !!(pool && typeof pool.query === 'function');

  async function recordEvent({ symbol, ts, kind, side, price, strength, score, features }) {
    if (!configured) return null;
    if (!SYMBOL.test(String(symbol)) || !KINDS.has(kind) || !SIDES.has(side)) throw new TypeError('invalid_event');
    const p = Number(price);
    const result = await pool.query(
      `INSERT INTO academy_orderflow_events (symbol, ts, kind, side, price, strength, score, features)
       VALUES ($1, to_timestamp($2::double precision / 1000.0), $3, $4, $5, $6, $7, $8::jsonb) RETURNING id`,
      [symbol, Number(ts) || Date.now(), kind, side, Number.isFinite(p) && p > 0 ? p : null, Math.min(1, Math.max(0, Number(strength) || 0)), Number(score) || 0, JSON.stringify(features || {})]
    );
    return result.rows[0] && result.rows[0].id;
  }

  async function recordOutcome(id, pct) {
    if (!configured || !Number.isFinite(Number(pct))) return;
    await pool.query('UPDATE academy_orderflow_events SET outcome_5m_pct = $2, outcome_at = now() WHERE id = $1 AND outcome_5m_pct IS NULL', [id, Number(pct)]);
  }

  /** Housekeeping: keep 90 days. */
  async function prune(days = 90) {
    if (!configured) return 0;
    const r = await pool.query("DELETE FROM academy_orderflow_events WHERE ts < now() - ($1 || ' days')::interval", [String(Math.max(7, Math.min(365, Number(days) || 90)))]);
    return r.rowCount || 0;
  }

  /** How often each signal was right (price moved its way over 5 minutes) — the number that decides whether a signal deserves trust. */
  async function summary(days = 30) {
    if (!configured) return [];
    const r = await pool.query(
      `SELECT kind, side, count(*)::int AS events, count(outcome_5m_pct)::int AS measured,
              round(avg(outcome_5m_pct)::numeric, 4) AS avg_pct, round((avg((outcome_5m_pct > 0)::int))::numeric, 3) AS hit_rate
         FROM academy_orderflow_events WHERE ts > now() - ($1 || ' days')::interval GROUP BY kind, side ORDER BY kind, side`,
      [String(Math.max(1, Math.min(365, Number(days) || 30)))]
    );
    return r.rows;
  }

  return { configured, recordEvent, recordOutcome, prune, summary };
}

module.exports = { createOrderFlowStore };
