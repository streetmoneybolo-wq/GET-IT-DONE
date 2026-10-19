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
/* an entry question: whether to get in, stay in or get out of a trade (answered with a price, academy-ask.js) */
const ENTRY = /\b(worth (it|an? (entry|buy|shot|look|swing|trade))|enter(ing)?|entry|get(ting)? in|jump(ing)? in|buy(ing|s)?|bought|chas(e|ing)|too late|add(ing)? (to|more|here)|hold(ing)?|sell(ing)?|exit(ing)?|take profits?|trim(ming)?|(the|a) dip|pull ?back|break ?out|go(ing)? long|long (it|here|this)|short (it|here|this)|still (in|good|worth|a (buy|go)))\b/i;
/* words of two to five letters that read like a ticker but are English (the question is lower-cased when it is checked) */
const COMMON = new Set(('a an and are as at be but by for from has have how i if in into is it its of on or that the this to was what when where which who why will with you your can do does did not no so than then there these those about after before over under up down out more most very just also like get got make made one two me my we our they them he she his her im dont isnt still worth enter entry buy sell hold add exit take trim dip long short good bad ok okay yes now here today week month year soon late early time price stock stocks share shares trade trades trading chart move moves going go gone come back high low open close call calls put puts risk stop loss gain play plays even again want think thinks feel feels know knows see seen look looks tell give keep let may might must need shall would could should says said say mean means much many some such own too way day days hit hits run runs rip rips pump dump pop drop fall fell rose rise rally swing scalp hype news fed cpi jobs data level levels zone base bear bull bulls bears tape flow book size sized big small cheap pricy safe safer best worst top bottom first last next last off end start enough deal only real fake true false sure maybe about above below near far away into onto wait hodl moon dead alive live love hate guys fellas bro man dude lol lmao omg wtf idk imo imho tbh fyi btw pls plz thx ty yeah yep nope nah hmm umm uh oh ah ha limit order fill trail entry exit bid ask spread candle wick body gap gaps float cash money funds broker app phone chart charts alert alerts lesson class video watch learn study read write post reply thanks thank help done doing does did').split(/\s+/));
const UPPER_SKIP = new Set(['I', 'A', 'OK', 'ETF', 'IPO', 'FOMC', 'CPI', 'PT', 'SL', 'TP', 'RR', 'ATH', 'ATL', 'EOD', 'AH', 'PM', 'AM', 'DD', 'FOMO', 'YOLO', 'VWAP', 'EMA', 'SMA', 'RSI', 'MACD', 'ATR', 'HOD', 'LOD', 'OTM', 'ITM', 'DTE', 'IV', 'OI', 'EPS', 'GDP', 'FED', 'SPX', 'NDX', 'RUT', 'VIX', 'MEM', 'SMC', 'AI', 'USA', 'US', 'UK', 'EU', 'CEO', 'CFO', 'SEC', 'FDA', 'NYSE', 'AND', 'OR', 'THE', 'IS', 'IT', 'TO', 'IN', 'ON', 'AT', 'BUY', 'SELL', 'HOLD', 'LONG', 'SHORT', 'STILL', 'WORTH', 'ENTER', 'YES', 'NO', 'LOL', 'IMO']);
/** the ticker a question is about: $X first, then an upper-case word, then a lower-case word that is not English (checked against
 *  isSymbol when one is given); 'market' for the indexes; the chart's own symbol (opts.symbol) when the question says "it" / "this" */
function subjectOf(q, opts = {}) {
  const raw = String(q || '');
  const dollar = /\$([A-Za-z]{1,5})\b/.exec(raw); if (dollar) return dollar[1].toUpperCase();
  const isSym = typeof opts.isSymbol === 'function' ? opts.isSymbol : null;
  const uppers = (raw.match(/\b[A-Z]{2,5}\b/g) || []).filter((w) => !UPPER_SKIP.has(w));
  for (const w of uppers) { if (!isSym || isSym(w)) return w; }
  if (/\b(market|markets|spx|s&p|indexes|indices|stocks|the tape)\b/i.test(raw) && !/\b(this|that) stock\b/i.test(raw)) return 'market';
  /* a lesson-shaped question (what is, how do, explain) names no stock in lower case: "what is a buy limit order" has no ticker in it */
  if (!isSym && /^\s*(what|whats|what's|how|why|when|where|which|explain|define|describe|teach|tell me)\b/i.test(raw)) return opts.symbol && /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(String(opts.symbol)) && /\b(it|this|that|here)\b/i.test(raw) ? String(opts.symbol).toUpperCase() : null;
  const lowers = (raw.toLowerCase().match(/\b[a-z][a-z0-9]{1,4}\b/g) || []).filter((w) => !COMMON.has(w) && !/^\d+$/.test(w));
  for (const w of lowers) { const W = w.toUpperCase(); if (UPPER_SKIP.has(W)) continue; if (isSym ? isSym(W) : /^[a-z]{3,5}$/.test(w)) return W; }
  if (opts.symbol && /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(String(opts.symbol))) return String(opts.symbol).toUpperCase();
  return null;
}
const HORIZONS = [[/\btomorrow\b|\bnext session\b|\bmonday\b|\bopen\b/i, 'tomorrow'], [/\btoday\b|\bthis session\b|\brest of the day\b|\binto the close\b/i, 'today'], [/\bthis week\b|\bnext week\b|\bweek\b/i, 'week'], [/\bthis month\b|\bnext month\b|\bmonth\b/i, 'month'], [/\byear\b|\blong term\b|\bq[1-4]\b/i, 'longer']];

/* what the answer called, read from its own words */
function readCall(question, answer, opts = {}) {
  const q = String(question || ''), a = String(answer || '');
  const direction = /\b(direction|which way|up or down|higher or lower|bull|bear|rally|sell ?off|tomorrow|next week|where (is|do you think|will)|going to|gonna|prediction|predict|forecast|expect|call it|your (take|read|opinion))\b/i.test(q);
  const entry = ENTRY.test(q);
  if (!direction && !entry) return { direction: null, subject: null, horizon: null, asksDirection: false };
  const subject = subjectOf(q, opts);
  /* an entry question with nothing to enter (a lesson question that happens to say "buy") is a lesson question */
  if (!direction && !subject) return { direction: null, subject: null, horizon: null, asksDirection: false };
  const kind = entry && subject && subject !== 'market' ? 'entry' : 'direction';
  const head = a.slice(0, 360);
  const up = /\b(up|higher|green|rally|rallies|bullish|bounce|climb|grind up|push higher|new highs?|buy(ers)? (win|take))\b/i, down = /\b(down|lower|red|sell ?off|bearish|fade|drop|roll over|pull ?back|lower lows?|sell(ers)? (win|take))\b/i, flat = /\b(flat|sideways|chop|choppy|range|nowhere|unchanged)\b/i;
  const iU = head.search(up), iD = head.search(down), iF = head.search(flat);
  let first = [['up', iU], ['down', iD], ['flat', iF]].filter((x) => x[1] >= 0).sort((x, y) => x[1] - y[1])[0];
  /* an entry answer that opens with yes is a call for up; one that opens with no, wait or pass is a call against it */
  if (kind === 'entry' && (!first || first[1] > 12)) { if (/^\s*(yes|yeah|yep|long it|take it|i would|i'd take)\b/i.test(head)) first = ['up', 0]; else if (/^\s*(no|nope|not (here|yet|now|at)|pass|wait|don't|do not|leave it)\b/i.test(head)) first = ['down', 0]; }
  const horizon = (HORIZONS.find(([re]) => re.test(q)) || [null, null])[1];
  return { direction: first ? first[0] : null, subject, horizon, asksDirection: true, kind };
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

  async function record({ userId, question, answer, model = '', context = '', symbol = '' } = {}) {
    const call = readCall(question, answer, { symbol });
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

module.exports = { createAskLog, readCall, subjectOf, MAX_TEXT };
