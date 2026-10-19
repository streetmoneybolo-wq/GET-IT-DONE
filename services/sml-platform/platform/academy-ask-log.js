'use strict';

/*
 * Ask Obi log: every question and answer is kept so the calls can be backtested later.
 *
 * A row stores the question, the answer, the model, and what the answer called: the direction (up / down / flat) when the
 * question asked for one, the subject (a ticker or "market") and the horizon ("tomorrow", "this week"...). An outcome column
 * stays empty until a later job (or the owner) scores the call against what price actually did. Postgres when a pool is
 * given, memory otherwise (the last 500 rows), so the desk works the same in tests and on a laptop.
 */

const MAX_TEXT = 12_000;
const TICKER = /\$([A-Z]{1,5})\b|\b(SPY|QQQ|IWM|DIA|VIX|NVDA|TSLA|AAPL|AMZN|MSFT|META|GOOGL|AMD)\b/;
const HORIZONS = [[/\btomorrow\b|\bnext session\b|\bmonday\b|\bopen\b/i, 'tomorrow'], [/\btoday\b|\bthis session\b|\brest of the day\b|\binto the close\b/i, 'today'], [/\bthis week\b|\bnext week\b|\bweek\b/i, 'week'], [/\bthis month\b|\bnext month\b|\bmonth\b/i, 'month'], [/\byear\b|\blong term\b|\bq[1-4]\b/i, 'longer']];

/* what the answer called, read from its own words */
function readCall(question, answer) {
  const q = String(question || ''), a = String(answer || '');
  const asksDirection = /\b(direction|which way|up or down|higher or lower|bull|bear|rally|sell ?off|tomorrow|next week|where (is|do you think|will)|going to|gonna|prediction|predict|forecast|expect|call it|your (take|read|opinion))\b/i.test(q);
  if (!asksDirection) return { direction: null, subject: null, horizon: null, asksDirection: false };
  const head = a.slice(0, 360);
  const up = /\b(up|higher|green|rally|rallies|bullish|bounce|climb|grind up|push higher|new highs?|buy(ers)? (win|take))\b/i, down = /\b(down|lower|red|sell ?off|bearish|fade|drop|roll over|pull ?back|lower lows?|sell(ers)? (win|take))\b/i, flat = /\b(flat|sideways|chop|choppy|range|nowhere|unchanged)\b/i;
  const iU = head.search(up), iD = head.search(down), iF = head.search(flat);
  const first = [['up', iU], ['down', iD], ['flat', iF]].filter((x) => x[1] >= 0).sort((x, y) => x[1] - y[1])[0];
  const m = TICKER.exec(q.toUpperCase().replace(/\$([a-z]+)/g, (s2) => s2.toUpperCase()));
  const subject = m ? (m[1] || m[2]) : (/\b(market|markets|spx|s&p|indexes|indices|stocks)\b/i.test(q) ? 'market' : null);
  const horizon = (HORIZONS.find(([re]) => re.test(q)) || [null, null])[1];
  return { direction: first ? first[0] : null, subject, horizon, asksDirection: true };
}

function createAskLog({ pool = null, now = Date.now, logger = () => {}, keep = 500 } = {}) {
  const db = pool && typeof pool.query === 'function' ? pool : null;
  const mem = [];
  let seq = 0;

  async function ensureSchema() {
    if (!db) return;
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS academy_ask_log (
        id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, model TEXT NOT NULL DEFAULT '',
        asks_direction BOOLEAN NOT NULL DEFAULT false, direction TEXT, subject TEXT, horizon TEXT, context TEXT,
        outcome TEXT, outcome_note TEXT, scored_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await db.query('CREATE INDEX IF NOT EXISTS academy_ask_log_created_idx ON academy_ask_log (created_at DESC)');
    } catch (error) { logger('warn', 'academy_ask_log_schema_failed', { error: String(error && error.message || error) }); }
  }

  const iso = (v) => (v instanceof Date ? v.toISOString() : typeof v === 'number' ? new Date(v).toISOString() : String(v));
  const out = (r) => ({ id: String(r.id), userId: String(r.user_id), question: r.question, answer: r.answer, model: r.model || '', asksDirection: !!r.asks_direction, direction: r.direction || null, subject: r.subject || null, horizon: r.horizon || null, context: r.context || null, outcome: r.outcome || null, outcomeNote: r.outcome_note || null, scoredAt: r.scored_at ? iso(r.scored_at) : null, createdAt: iso(r.created_at) });

  async function record({ userId, question, answer, model = '', context = '' } = {}) {
    const call = readCall(question, answer);
    const row = { user_id: String(userId || 'unknown'), question: String(question || '').slice(0, MAX_TEXT), answer: String(answer || '').slice(0, MAX_TEXT), model: String(model || '').slice(0, 80),
      asks_direction: call.asksDirection, direction: call.direction, subject: call.subject, horizon: call.horizon, context: context ? String(context).slice(0, MAX_TEXT) : null };
    if (db) {
      try {
        const r = await db.query('INSERT INTO academy_ask_log (user_id, question, answer, model, asks_direction, direction, subject, horizon, context) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
          [row.user_id, row.question, row.answer, row.model, row.asks_direction, row.direction, row.subject, row.horizon, row.context]);
        return out(r.rows[0]);
      } catch (error) { logger('warn', 'academy_ask_log_write_failed', { error: String(error && error.message || error) }); }
    }
    const m = Object.assign({ id: ++seq, created_at: now(), outcome: null, outcome_note: null, scored_at: null }, row);
    mem.push(m); if (mem.length > keep) mem.splice(0, mem.length - keep);
    return out(m);
  }

  async function list({ limit = 100, directionOnly = false, unscored = false } = {}) {
    const n = Math.max(1, Math.min(1000, Number(limit) || 100));
    if (db) {
      try {
        const where = [directionOnly ? 'asks_direction = true' : null, unscored ? 'outcome IS NULL' : null].filter(Boolean);
        const r = await db.query('SELECT * FROM academy_ask_log' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY id DESC LIMIT $1', [n]);
        return r.rows.map(out);
      } catch (error) { logger('warn', 'academy_ask_log_read_failed', { error: String(error && error.message || error) }); return []; }
    }
    return mem.filter((m) => (!directionOnly || m.asks_direction) && (!unscored || m.outcome == null)).slice(-n).reverse().map(out);
  }

  /* the owner (or a scoring job) marks how the call went: right, wrong or flat */
  async function score(id, { outcome, note = '' } = {}) {
    const o = String(outcome || '').toLowerCase();
    if (!['right', 'wrong', 'flat', 'void'].includes(o)) return { ok: false, error: 'invalid_outcome' };
    if (db) {
      try {
        const r = await db.query('UPDATE academy_ask_log SET outcome = $2, outcome_note = $3, scored_at = now() WHERE id = $1 RETURNING *', [String(id), o, String(note || '').slice(0, 500)]);
        return r.rows[0] ? { ok: true, row: out(r.rows[0]) } : { ok: false, error: 'not_found' };
      } catch (error) { logger('warn', 'academy_ask_log_score_failed', { error: String(error && error.message || error) }); return { ok: false, error: 'storage_unavailable' }; }
    }
    const m = mem.find((x) => String(x.id) === String(id)); if (!m) return { ok: false, error: 'not_found' };
    m.outcome = o; m.outcome_note = String(note || '').slice(0, 500); m.scored_at = now();
    return { ok: true, row: out(m) };
  }

  /* the track record so far: how many direction calls were right, by horizon */
  async function stats() {
    const rows = await list({ limit: 1000, directionOnly: true });
    const by = {};
    for (const r of rows) { const k = r.horizon || 'other'; const b = by[k] || (by[k] = { calls: 0, scored: 0, right: 0, wrong: 0, flat: 0 }); b.calls++; if (r.outcome && r.outcome !== 'void') { b.scored++; b[r.outcome] = (b[r.outcome] || 0) + 1; } }
    const total = Object.values(by).reduce((a, b) => ({ calls: a.calls + b.calls, scored: a.scored + b.scored, right: a.right + b.right, wrong: a.wrong + b.wrong, flat: a.flat + b.flat }), { calls: 0, scored: 0, right: 0, wrong: 0, flat: 0 });
    return { total, byHorizon: by, hitRate: total.scored ? Math.round(total.right / total.scored * 100) : null };
  }

  return { configured: !!db, ensureSchema, record, list, score, stats, readCall };
}

module.exports = { createAskLog, readCall, MAX_TEXT };
