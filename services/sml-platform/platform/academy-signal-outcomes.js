'use strict';

/*
 * Outcome measurement for the newer order-flow signals (academy_signal_outcomes).
 *
 * Once a minute, for every symbol the order-flow service tracks, the full-depth reading is sampled: when pressure is at least 25 either
 * way, when the microprice tilt is 0.3 ticks or more, when a CVD divergence appears, when the large prints lean 40% or more one way, and
 * when one side refills the touch 1.5x faster than the other, one row is stamped with the mid price at that moment (with a cooldown per
 * signal, side and band so a reading that stays on for ten minutes is one sample, not ten). The same minute loop fills in what price did
 * 1, 5 and 15 minutes later, signed by the signal's side, so a positive outcome means the signal was right.
 *
 * The week's read (academy-flow-read.js) is sampled once a trading day per symbol, in the first minutes of the regular session, when its
 * score is at least 25 either way; its outcomes are the daily flow ledger's last price 1, 3 and 5 trading days later.
 *
 * summary() turns the rows into hit rates and average moves per signal, side and band, plus the sweep-versus-wall outcomes the order-flow
 * store already records. Shown next to the signals so members lean on what has been measured. Research and education only.
 */

const { marketState, etParts } = require('./market-clock');

const SYMBOL = /^[A-Z0-9.:-]{1,10}$/;
const HORIZONS = [['outcome_1m_pct', 60_000], ['outcome_5m_pct', 300_000], ['outcome_15m_pct', 900_000]];
const SETTLE_AFTER_MS = 30 * 60_000;         // an intraday row is closed after half an hour with whatever it has
const WEEK_SETTLE_DAYS = 12;                 // a week row is closed after twelve calendar days with whatever it has
const COOLDOWN = { pressure: 5 * 60_000, microprice: 3 * 60_000, divergence: 5 * 60_000, large: 5 * 60_000, refill: 5 * 60_000 };
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (ms) => { const p = etParts(ms); return p.y + '-' + pad(p.m) + '-' + pad(p.d); };
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const fin = Number.isFinite;

/** The signals one depth reading fires, as rows to stamp: [{ signal, side, bucket, value, features }]. Pure. */
function depthSignals(ins) {
  if (!ins || !ins.ready) return [];
  const out = [];
  const sc = Number(ins.pressure && ins.pressure.score) || 0;
  if (Math.abs(sc) >= 25) out.push({ signal: 'pressure', side: sc > 0 ? 'bull' : 'bear', bucket: Math.abs(sc) >= 60 ? 'strong' : Math.abs(sc) >= 40 ? 'firm' : 'lean', value: sc, features: { label: ins.pressure.label } });
  const tilt = Number(ins.book && ins.book.microTilt) || 0;
  if (Math.abs(tilt) >= 0.3) out.push({ signal: 'microprice', side: tilt > 0 ? 'bull' : 'bear', bucket: Math.abs(tilt) >= 0.5 ? 'strong' : 'lean', value: tilt, features: { spreadTicks: ins.book.spreadTicks } });
  const div = ins.flow && ins.flow.divergence;
  if (div === 'bullish' || div === 'bearish') out.push({ signal: 'divergence', side: div === 'bullish' ? 'bull' : 'bear', bucket: '', value: Number(ins.flow.priceChangePct) || 0, features: { cvdChange: ins.flow.cvdChange, priceChangePct: ins.flow.priceChangePct } });
  const lg = ins.flow && ins.flow.large;
  if (lg && lg.n >= 3 && Math.abs(Number(lg.bias) || 0) >= 0.4) out.push({ signal: 'large', side: lg.bias > 0 ? 'bull' : 'bear', bucket: Math.abs(lg.bias) >= 0.7 ? 'strong' : 'lean', value: lg.bias, features: { n: lg.n, threshold: lg.threshold } });
  const rf = ins.flow && ins.flow.replenish;
  if (rf && fin(rf.bid) && fin(rf.ask) && Math.max(rf.bid, rf.ask) >= 1.5 && Math.abs(rf.bid - rf.ask) >= 0.75) out.push({ signal: 'refill', side: rf.bid > rf.ask ? 'bull' : 'bear', bucket: '', value: r4(rf.bid - rf.ask), features: { bid: rf.bid, ask: rf.ask } });
  return out;
}

/** The outcome of a sample: % move from price0 to price, signed so + is the signal's way. Pure. */
function outcomePct(side, price0, price) { if (!(price0 > 0) || !(price > 0)) return null; return r4(((price - price0) / price0) * 100 * (side === 'bull' ? 1 : -1)); }

function createSignalOutcomes({ pool = null, orderFlow = null, flowDaily = null, now = Date.now, logger = () => {}, timers = { setTimeout, clearTimeout }, everyMs = 60_000 } = {}) {
  const configured = Boolean(pool && typeof pool.query === 'function');
  const memo = new Map();  // symbol -> { last: Map('signal:side:bucket' -> t), divergence, weekDay }
  let running = false, timer = null, warnedAt = 0, lastWeekSettleAt = 0, summaryCache = null;
  const stats = { sampled: 0, settled: 0, weekSampled: 0, weekSettled: 0 };

  const warn = (event, data) => { if (now() - warnedAt > 300_000) { warnedAt = now(); logger('warn', event, data); } };
  const memoFor = (symbol) => { let m = memo.get(symbol); if (!m) { m = { last: new Map(), divergence: null, weekDay: '' }; memo.set(symbol, m); } return m; };
  const midOf = (symbol) => { try { const ins = orderFlow && typeof orderFlow.insights === 'function' ? orderFlow.insights(symbol) : null; return ins && ins.ready && ins.book && ins.book.mid > 0 ? ins.book.mid : null; } catch (_) { return null; } };

  /** Stamp the depth signals a reading fires right now (respecting cooldowns and the divergence transition). Returns the rows written. */
  async function sampleDepth(symbol, ins, t = now()) {
    if (!configured || !ins || !ins.ready || !(ins.book && ins.book.mid > 0)) return [];
    const m = memoFor(symbol), rows = [];
    const divNow = ins.flow && ins.flow.divergence ? ins.flow.divergence : null;
    for (const s of depthSignals(ins)) {
      if (s.signal === 'divergence' && m.divergence === divNow) continue; // only the moment a divergence appears (or flips)
      const key = s.signal + ':' + s.side + ':' + s.bucket;
      if (t - (m.last.get(key) || 0) < (COOLDOWN[s.signal] || 300_000)) continue;
      m.last.set(key, t);
      rows.push(s);
    }
    m.divergence = divNow;
    for (const s of rows) {
      await pool.query('INSERT INTO academy_signal_outcomes (symbol, ts, family, signal, side, bucket, value, price0, features) VALUES ($1, to_timestamp($2::double precision / 1000.0), $3, $4, $5, $6, $7, $8, $9::jsonb)',
        [symbol, t, 'depth', s.signal, s.side, s.bucket, s.value, ins.book.mid, JSON.stringify(s.features || {})]);
      stats.sampled += 1;
    }
    return rows;
  }

  /** The week's read, once per trading day per symbol in the first minutes of the regular session. */
  async function sampleWeek(symbol, t = now()) {
    if (!configured || !flowDaily || typeof flowDaily.summary !== 'function') return null;
    const st = marketState(t); if (st.session !== 'regular') return null;
    const p = etParts(t); const minutes = p.hh * 60 + p.mm; if (minutes < 9 * 60 + 33 || minutes > 9 * 60 + 50) return null;
    const m = memoFor(symbol), day = dayKey(t); if (m.weekDay === day) return null;
    m.weekDay = day;
    const sum = await flowDaily.summary(symbol, 10);
    const w = sum && sum.ok && sum.window; if (!w || !w.available || w.days < 2 || Math.abs(Number(w.score) || 0) < 25) return null;
    const mid = midOf(symbol); if (!mid) return null;
    const exists = await pool.query('SELECT 1 FROM academy_signal_outcomes WHERE symbol = $1 AND family = $2 AND ts >= to_timestamp($3::double precision / 1000.0) LIMIT 1', [symbol, 'week', t - 12 * 3600_000]);
    if (exists.rows.length) return null;
    const row = { signal: 'week', side: w.score > 0 ? 'bull' : 'bear', bucket: Math.abs(w.score) >= 50 ? 'strong' : 'lean', value: w.score, features: { label: w.label, days: w.days, divergence: w.divergence, instShare: w.instShare } };
    await pool.query('INSERT INTO academy_signal_outcomes (symbol, ts, family, signal, side, bucket, value, price0, features) VALUES ($1, to_timestamp($2::double precision / 1000.0), $3, $4, $5, $6, $7, $8, $9::jsonb)',
      [symbol, t, 'week', row.signal, row.side, row.bucket, row.value, mid, JSON.stringify(row.features)]);
    stats.weekSampled += 1;
    return row;
  }

  /** Fill in the intraday horizons that have come due, from the symbol's mid right now; close rows past half an hour. */
  async function settleDepth(t = now()) {
    if (!configured) return 0;
    const r = await pool.query('SELECT id, symbol, (extract(epoch FROM ts) * 1000)::bigint AS t, side, price0::float8 AS price0, outcome_1m_pct, outcome_5m_pct, outcome_15m_pct FROM academy_signal_outcomes WHERE family = $1 AND settled_at IS NULL AND ts <= to_timestamp($2::double precision / 1000.0) ORDER BY ts LIMIT 300', ['depth', t - 60_000]);
    let n = 0;
    for (const row of r.rows) {
      const age = t - Number(row.t);
      const mid = midOf(row.symbol);
      const sets = [], vals = [row.id];
      for (const [col, ms] of HORIZONS) { if (row[col] == null && age >= ms && age < ms + 2 * everyMs + 5_000 && mid) { vals.push(outcomePct(row.side, row.price0, mid)); sets.push(col + ' = $' + vals.length); } }
      const done = age >= SETTLE_AFTER_MS || (row.outcome_15m_pct != null || sets.some((s) => s.startsWith('outcome_15m_pct')));
      if (done) sets.push('settled_at = now()');
      if (!sets.length) continue;
      await pool.query('UPDATE academy_signal_outcomes SET ' + sets.join(', ') + ' WHERE id = $1', vals);
      n += 1; if (done) stats.settled += 1;
    }
    return n;
  }

  /** The week rows: outcomes from the daily flow ledger's last price 1, 3 and 5 trading days after the sample. */
  async function settleWeek(t = now()) {
    if (!configured) return 0;
    const r = await pool.query('SELECT id, symbol, (extract(epoch FROM ts) * 1000)::bigint AS t, side, price0::float8 AS price0, outcome_1d_pct, outcome_3d_pct, outcome_5d_pct FROM academy_signal_outcomes WHERE family = $1 AND settled_at IS NULL AND ts <= to_timestamp($2::double precision / 1000.0) ORDER BY ts LIMIT 100', ['week', t - 20 * 3600_000]);
    let n = 0;
    for (const row of r.rows) {
      const day = dayKey(Number(row.t));
      const later = await pool.query('SELECT day::text AS day, last_px::float8 AS last_px FROM academy_flow_days WHERE symbol = $1 AND day > $2::date AND last_px IS NOT NULL ORDER BY day LIMIT 5', [row.symbol, day]);
      const px = later.rows.map((x) => x.last_px);
      const sets = [], vals = [row.id];
      for (const [col, k] of [['outcome_1d_pct', 1], ['outcome_3d_pct', 3], ['outcome_5d_pct', 5]]) { if (row[col] == null && px.length >= k) { vals.push(outcomePct(row.side, row.price0, px[k - 1])); sets.push(col + ' = $' + vals.length); } }
      const done = px.length >= 5 || t - Number(row.t) > WEEK_SETTLE_DAYS * 86_400_000;
      if (done) sets.push('settled_at = now()');
      if (!sets.length) continue;
      await pool.query('UPDATE academy_signal_outcomes SET ' + sets.join(', ') + ' WHERE id = $1', vals);
      n += 1; if (done) stats.weekSettled += 1;
    }
    return n;
  }

  async function tick() {
    if (!configured) return { sampled: 0, settled: 0 };
    const t = now();
    const out = { sampled: 0, settled: 0 };
    if (marketState(t).session !== 'closed' && orderFlow && orderFlow.engines) {
      for (const symbol of orderFlow.engines.keys()) {
        if (!SYMBOL.test(symbol)) continue;
        try {
          const ins = orderFlow.insights(symbol);
          out.sampled += (await sampleDepth(symbol, ins, t)).length;
          if (await sampleWeek(symbol, t)) out.sampled += 1;
        } catch (error) { warn('signal_outcomes_sample_failed', { symbol, error: String(error && error.message || error).slice(0, 160) }); }
      }
      try { out.settled += await settleDepth(t); } catch (error) { warn('signal_outcomes_settle_failed', { error: String(error && error.message || error).slice(0, 160) }); }
    }
    if (t - lastWeekSettleAt >= 30 * 60_000) { lastWeekSettleAt = t; try { out.settled += await settleWeek(t); } catch (error) { warn('signal_outcomes_week_settle_failed', { error: String(error && error.message || error).slice(0, 160) }); } }
    return out;
  }

  function schedule() { if (!running) return; timer = timers.setTimeout(() => { tick().catch(() => {}).finally(schedule); }, everyMs); if (timer && typeof timer.unref === 'function') timer.unref(); }
  function start() { if (running || !configured) return false; running = true; schedule(); return true; }
  function stop() { running = false; if (timer) timers.clearTimeout(timer); timer = null; }

  /** Hit rates and average moves per signal, side and band over the last `days`, plus the sweep-versus-wall outcomes. Cached two minutes. */
  async function summary(days = 30) {
    if (!configured) return { ok: false, error: 'signal_outcomes_unconfigured' };
    const d = String(Math.max(1, Math.min(365, Math.round(Number(days) || 30))));
    if (summaryCache && summaryCache.days === d && now() - summaryCache.at < 120_000) return summaryCache.value;
    const col = (c) => 'count(' + c + ')::int AS ' + c.replace('_pct', '_n') + ', round(avg(' + c + ')::numeric, 4) AS ' + c.replace('_pct', '_avg') + ', round(avg((' + c + ' > 0)::int)::numeric, 3) AS ' + c.replace('_pct', '_hit');
    const depth = await pool.query('SELECT signal, side, bucket, count(*)::int AS n, ' + HORIZONS.map(([c]) => col(c)).join(', ') + " FROM academy_signal_outcomes WHERE family = 'depth' AND ts > now() - ($1 || ' days')::interval GROUP BY signal, side, bucket ORDER BY signal, side, bucket", [d]);
    const week = await pool.query('SELECT signal, side, bucket, count(*)::int AS n, ' + ['outcome_1d_pct', 'outcome_3d_pct', 'outcome_5d_pct'].map(col).join(', ') + " FROM academy_signal_outcomes WHERE family = 'week' AND ts > now() - ($1 || ' days')::interval GROUP BY signal, side, bucket ORDER BY side, bucket", [d]);
    const sweeps = await pool.query("SELECT features->>'outcome' AS outcome, side, count(*)::int AS events, count(outcome_5m_pct)::int AS measured, round(avg(outcome_5m_pct)::numeric, 4) AS avg_pct, round(avg((outcome_5m_pct > 0)::int)::numeric, 3) AS hit_rate FROM academy_orderflow_events WHERE kind = 'sweep' AND ts > now() - ($1 || ' days')::interval GROUP BY features->>'outcome', side ORDER BY outcome, side", [d]);
    const num = (v) => (v == null ? null : Number(v));
    const shape = (rows, hs) => rows.map((r) => ({ signal: r.signal, side: r.side, bucket: r.bucket || '', n: Number(r.n), horizons: Object.fromEntries(hs.map((h) => [h, { measured: Number(r[h + '_n']) || 0, hitRate: num(r[h + '_hit']), avgPct: num(r[h + '_avg']) }])) }));
    const value = {
      ok: true, days: Number(d), asOf: now(),
      depth: shape(depth.rows, ['outcome_1m', 'outcome_5m', 'outcome_15m']),
      week: shape(week.rows, ['outcome_1d', 'outcome_3d', 'outcome_5d']),
      sweeps: sweeps.rows.map((r) => ({ outcome: r.outcome || '', side: r.side, events: Number(r.events), measured: Number(r.measured), hitRate: num(r.hit_rate), avgPct: num(r.avg_pct) })),
      note: 'Outcomes are the % move from the price at the signal, signed its way: + means it was right. Nothing under 20 measured samples means much yet.'
    };
    summaryCache = { days: d, at: now(), value };
    return value;
  }

  return { configured, start, stop, tick, sampleDepth, sampleWeek, settleDepth, settleWeek, summary, status: () => ({ configured, running, ...stats, symbols: memo.size }) };
}

module.exports = { createSignalOutcomes, depthSignals, outcomePct, HORIZONS, COOLDOWN };
