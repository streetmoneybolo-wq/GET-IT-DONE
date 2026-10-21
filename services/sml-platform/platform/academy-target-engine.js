'use strict';

/* TARGET ENGINE: a price-target suggestion for the direction a member picks, that gets better from its own results.
 *
 * suggestTargets({ symbol, direction, horizon, price, bars5, daily, learned, align })
 *   direction 'long' | 'short'. horizon 'day' (one session) | 'swing' (about a week) | 'position' (about a month).
 *   1. The stock's own history is the yardstick. Every start point in its recent candles is walked forward over the horizon, and
 *      the best move in the chosen direction (max favourable excursion) and the worst against it (max adverse excursion) are
 *      kept. The three targets are the distances that move reached 60%, 35% and 15% of the time (the quantile levels start there
 *      and are tuned per bucket by the learner below).
 *   2. The distances are scaled by the current volatility regime (the last week against the last quarter), nudged by how well the
 *      other tools agree with the direction (`align`, -1..1), and snapped to the nearest level in the way (swing highs and lows,
 *      yesterday's and today's extremes, VWAP, round numbers) so a target sits just in front of the level price has to clear.
 *   3. The stop sits beyond the nearest level against the position, wide enough for the stock's own noise.
 *   4. Each target carries a probability: how often the stock's history reached it before it reached the stop, blended with how
 *      often the engine's own past suggestions in the same bucket (horizon, session, price band) really did.
 *
 * createTargetLearner({ store, candles })
 *   Every suggestion served is kept, then judged once its horizon has run (which target traded, and whether the stop came first).
 *   For each bucket it moves the quantile levels by the gap between predicted and realized hit rates, so a bucket whose targets
 *   were too far gets nearer ones and the reverse; it also keeps the realized hit rates for the displayed probabilities. Desk
 *   alerts judged by the forensics module (academy-alert-forensics.js) feed the same buckets. Bounded memory, persisted in the
 *   state store. Educational analysis of what price has done: not advice, and nothing here places a trade. */

const F = require('./academy-alert-forensics');

const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (p) => (p >= 10 ? Math.round(p * 100) / 100 : p >= 1 ? Math.round(p * 1000) / 1000 : Math.round(p * 10_000) / 10_000);
const r1 = (v) => Math.round(v * 10) / 10;
const DAY = 86_400_000;

const HORIZONS = {
  day: { label: 'Day trade', bars: 78, spanMs: 23_400_000, series: '5m', windowMs: 30 * 3_600_000, base: [0.60, 0.35, 0.15] },
  swing: { label: 'Swing trade', bars: 5, series: '1D', windowMs: 8 * DAY, base: [0.60, 0.35, 0.15] },
  position: { label: 'Position', bars: 20, series: '1D', windowMs: 30 * DAY, base: [0.60, 0.35, 0.15] }
};
const Q_MIN = 0.08, Q_MAX = 0.9;

const sessionGroup = (session) => (session === 'regular' ? 'rth' : 'ext');
const priceBand = (p) => (p < 2 ? 'u2' : p < 10 ? 'u10' : p < 50 ? 'u50' : 'o50');
const bucketKey = (horizon, session, price) => horizon + '|' + sessionGroup(session) + '|' + priceBand(price);

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = clamp(q, 0, 1) * (sorted.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/* the walk: from every start in `series`, the best and worst excursion over the horizon (a time span for 5-minute candles, a
   candle count for daily ones), only from starts whose whole horizon is on record */
function walks(series, H, dir, step = 1) {
  const out = [], five = H.series === '5m';
  const lastT = series.length ? series[series.length - 1].t : 0;
  for (let i = 0; i + 2 < series.length; i += step) {
    const start = num(series[i].c); if (!(start > 0)) continue;
    let last;
    if (five) {
      if (F.sessionAt(series[i].t) !== 'regular') continue;
      const endT = series[i].t + H.spanMs; if (endT > lastT) break;
      last = i; while (last + 1 < series.length && series[last + 1].t <= endT) last++;
    } else { last = i + H.bars; if (last > series.length - 1) break; }
    if (last - i < 2) continue;
    out.push({ i, start, last });
  }
  return out;
}
function excursions(series, H, dir, step) {
  const mfe = [], mae = [];
  for (const w of walks(series, H, dir, step)) {
    let best = 0, worst = 0;
    for (let j = w.i + 1; j <= w.last; j++) {
      const hi = num(series[j].h, series[j].c), lo = num(series[j].l, series[j].c);
      const fav = dir > 0 ? (hi / w.start - 1) : (1 - lo / w.start), adv = dir > 0 ? (1 - lo / w.start) : (hi / w.start - 1);
      if (fav > best) best = fav;
      if (adv > worst) worst = adv;
    }
    mfe.push(best * 100); mae.push(worst * 100);
  }
  return { mfe, mae };
}
/* how often the move reached `targetPct` before `stopPct` (the stop wins a tie inside one candle) */
function hitRate(series, H, dir, step, targetPct, stopPct) {
  let n = 0, hit = 0, stopped = 0;
  for (const w of walks(series, H, dir, step)) {
    n++;
    let state = 0;
    for (let j = w.i + 1; j <= w.last && !state; j++) {
      const hi = num(series[j].h, series[j].c), lo = num(series[j].l, series[j].c);
      const fav = dir > 0 ? (hi / w.start - 1) * 100 : (1 - lo / w.start) * 100, adv = dir > 0 ? (1 - lo / w.start) * 100 : (hi / w.start - 1) * 100;
      if (stopPct > 0 && adv >= stopPct) state = -1; else if (fav >= targetPct) state = 1;
    }
    if (state === 1) hit++; else if (state === -1) stopped++;
  }
  return { n, p: n ? hit / n : null, stopRate: n ? stopped / n : null };
}

/* the levels in the way: pivots, yesterday's and today's extremes, VWAP, round numbers */
function levelsFrom({ price, bars5, daily }) {
  const out = [];
  const add = (p, name, w = 1) => { if (num(p) > 0) out.push({ price: Number(p), name, w }); };
  const d = Array.isArray(daily) ? daily.slice(-120) : [];
  for (let i = 2; i < d.length - 2; i++) {
    const h = d[i].h, l = d[i].l;
    if (h > d[i - 1].h && h > d[i - 2].h && h > d[i + 1].h && h > d[i + 2].h) add(h, 'a swing high', 1.2);
    if (l < d[i - 1].l && l < d[i - 2].l && l < d[i + 1].l && l < d[i + 2].l) add(l, 'a swing low', 1.2);
  }
  if (d.length >= 2) { const y = d[d.length - 2]; add(y.h, 'yesterday\'s high', 1.3); add(y.l, 'yesterday\'s low', 1.3); }
  const hi60 = d.length ? Math.max(...d.slice(-60).map((b) => b.h)) : null, lo60 = d.length ? Math.min(...d.slice(-60).map((b) => b.l)) : null;
  add(hi60, 'the 60-day high', 1.5); add(lo60, 'the 60-day low', 1.5);
  const b5 = Array.isArray(bars5) ? bars5 : [];
  if (b5.length) {
    const lastDay = F.etOf(b5[b5.length - 1].t).day, today = b5.filter((b) => F.etOf(b.t).day === lastDay);
    if (today.length) {
      add(Math.max(...today.map((b) => b.h)), 'today\'s high', 1.4); add(Math.min(...today.map((b) => b.l)), 'today\'s low', 1.4);
      let pv = 0, vv = 0; for (const b of today) { const v = num(b.v, 0), tp = (num(b.h) + num(b.l) + num(b.c)) / 3; pv += tp * v; vv += v; }
      if (vv > 0) add(pv / vv, 'VWAP', 1);
    }
  }
  const step = price < 1 ? 0.05 : price < 5 ? 0.25 : price < 20 ? 0.5 : price < 100 ? 1 : price < 500 ? 5 : 25;
  for (let k = 1; k <= 40; k++) { const up = Math.ceil(price / step) * step + (k - 1) * step; const dn = Math.floor(price / step) * step - (k - 1) * step; if (k < 40) { add(up, 'a round number', 0.5); if (dn > 0) add(dn, 'a round number', 0.5); } }
  return out;
}

/* the direction a member did not choose: weigh what the tools say. Returns the lean and the reasons (read-only inputs, all optional). */
function autoDirection({ alignLong = null, alignShort = null, intentSide = null, intentStrength = 0, sentiment = null, market = null, trend = null } = {}) {
  const parts = [], why = [];
  if (num(alignLong) != null && num(alignShort) != null) { const v = clamp((alignLong - alignShort) / 2, -1, 1); parts.push([0.4, v]); why.push('MEM ALGO horizons lean ' + (v > 0.05 ? 'long' : v < -0.05 ? 'short' : 'neither way')); }
  if (intentSide === 'long' || intentSide === 'short') { const v = (intentSide === 'long' ? 1 : -1) * clamp(num(intentStrength, 50) / 100, 0.2, 1); parts.push([0.25, v]); why.push('smart-money intent is ' + intentSide + ' positioned'); }
  if (num(sentiment) != null) { parts.push([0.15, clamp(sentiment, -1, 1)]); why.push('sentiment ' + (sentiment >= 0 ? 'positive' : 'negative')); }
  if (num(market) != null) { parts.push([0.1, clamp(market, -1, 1)]); }
  if (num(trend) != null) { parts.push([0.1, clamp(trend, -1, 1)]); why.push('price is ' + (trend >= 0 ? 'above' : 'below') + ' its 20-day average'); }
  let w = 0, s = 0; for (const [wt, v] of parts) { w += wt; s += wt * v; }
  const score = w ? s / w : 0;
  return { direction: score >= 0 ? 'long' : 'short', score: Math.round(score * 100) / 100, clear: Math.abs(score) >= 0.15, why };
}

function suggestTargets({ symbol = '', direction = 'long', horizon = 'swing', price, bars5 = [], daily = [], learned = null, align = null, session = null, now = Date.now() } = {}) {
  const H = HORIZONS[horizon] || HORIZONS.swing, hz = HORIZONS[horizon] ? horizon : 'swing';
  const dir = direction === 'short' ? -1 : 1;
  const p = num(price) > 0 ? Number(price) : num((bars5[bars5.length - 1] || daily[daily.length - 1] || {}).c);
  if (!(p > 0)) return { ok: false, reason: 'no_price', symbol };
  const d = (Array.isArray(daily) ? daily : []).filter((b) => b && num(b.c) > 0 && num(b.h) > 0 && num(b.l) > 0);
  const b5 = (Array.isArray(bars5) ? bars5 : []).filter((b) => b && num(b.c) > 0);
  const series = H.series === '5m' ? b5 : d;
  if (series.length < (H.series === '5m' ? 200 : 40)) return { ok: false, reason: 'not_enough_history', symbol, have: series.length };
  const step = H.series === '5m' ? 6 : 1;
  const { mfe, mae } = excursions(series, H, dir, step);
  if (mfe.length < 25) return { ok: false, reason: 'not_enough_history', symbol };
  const sortedMfe = mfe.slice().sort((a, b) => a - b), sortedMae = mae.slice().sort((a, b) => a - b);
  const sess = session || F.sessionAt(now);
  const bucket = bucketKey(hz, sess, p);
  const lrn = learned && learned.buckets && learned.buckets[bucket] ? learned.buckets[bucket] : null;
  const delta = lrn && Array.isArray(lrn.delta) ? lrn.delta : [0, 0, 0];
  const q = H.base.map((b, i) => clamp(b + (num(delta[i], 0)), Q_MIN, Q_MAX));
  q[1] = Math.min(q[1], q[0] - 0.05); q[2] = Math.min(q[2], q[1] - 0.05);

  /* regime: the last week of daily movement against the last quarter, and how thin the session is */
  const rng = (list) => list.length ? list.reduce((a, b) => a + (b.h - b.l) / b.c, 0) / list.length : null;
  const recent = rng(d.slice(-5)), base = rng(d.slice(-60));
  const regime = recent && base ? clamp(recent / base, 0.6, 1.8) : 1;
  const alignDir = num(align) != null ? clamp(align * dir, -1, 1) : 0;
  const scale = clamp(regime, 0.7, 1.6) * (1 + 0.12 * alignDir) * (sess !== 'regular' ? 0.9 : 1);

  const levels = levelsFrom({ price: p, bars5: b5, daily: d });
  const toward = (pr) => (pr - p) * dir > 0;
  const raw = q.map((qq) => quantile(sortedMfe, 1 - qq) * scale);
  const tickPct = 0.01 / p * 100 * 3; // never closer than three cents
  const minStep = Math.max(tickPct, quantile(sortedMfe, 0.5) * 0.2);
  const dists = []; let prev = 0;
  for (let i = 0; i < 3; i++) { const dp = Math.max(raw[i], prev + minStep, tickPct); dists.push(dp); prev = dp; }
  const targets = dists.map((dp, i) => {
    const target = p * (1 + dir * dp / 100);
    /* snap to the nearest level within 15% either way of the distance, and stop just in front of it */
    let best = null;
    for (const lv of levels) {
      if (!toward(lv.price)) continue;
      const dd = Math.abs(lv.price / p - 1) * 100;
      if (dd < dp * 0.85 || dd > dp * 1.15) continue;
      const gap = Math.abs(dd - dp) / dp;
      const score = gap - lv.w * 0.02;
      if (!best || score < best.score) best = { lv, score, dd };
    }
    let price2 = target, basis = 'the ' + (i === 0 ? '60' : i === 1 ? '35' : '15') + '% reach of this stock\'s own ' + H.label.toLowerCase() + ' moves';
    if (best) { price2 = best.lv.price * (1 - dir * Math.min(0.002, dp / 100 * 0.12)); basis = 'just ' + (dir > 0 ? 'under' : 'above') + ' ' + best.lv.name + ' at ' + round(best.lv.price); }
    return { n: i + 1, price: round(price2), pct: r1((price2 / p - 1) * dir * 100), basis };
  });
  for (let i = 0; i < targets.length; i++) { const floorP = i === 0 ? p : targets[i - 1].price; if ((targets[i].price - floorP) * dir < p * tickPct / 100) targets[i].price = round(floorP * (1 + dir * Math.max(tickPct, 0.15) / 100)); }
  targets.forEach((t, i) => { t.pct = r1((t.price / p - 1) * dir * 100); });

  /* the stop: beyond the nearest level against the position, wide enough for the stock's own noise */
  const noise = Math.max(quantile(sortedMae, 0.55), tickPct);
  let stopDist = Math.max(noise, targets[0].pct * 0.55), stopBasis = 'beyond this stock\'s typical ' + H.label.toLowerCase() + ' pull-back';
  for (const lv of levels.filter((l) => (l.price - p) * dir < 0).sort((a, b) => Math.abs(a.price - p) - Math.abs(b.price - p))) {
    const dd = Math.abs(lv.price / p - 1) * 100;
    if (dd >= noise * 0.8 && dd <= noise * 2.4) { stopDist = dd + 0.25; stopBasis = 'just ' + (dir > 0 ? 'under' : 'above') + ' ' + lv.name + ' at ' + round(lv.price); break; }
  }
  const stopPrice = round(p * (1 - dir * stopDist / 100));
  const stop = { price: stopPrice, pct: r1(stopDist), basis: stopBasis };

  /* probabilities: the stock's own history, then the engine's own track record in this bucket */
  const learnN = lrn ? num(lrn.n, 0) : 0, N0 = 20;
  targets.forEach((t, i) => {
    const h = hitRate(series, H, dir, step, t.pct, stop.pct);
    const emp = h.p == null ? 0.3 : h.p;
    const seen = lrn && lrn.hits ? num(lrn.hits[i], 0) / Math.max(1, learnN) : null;
    t.prob = Math.round(clamp(seen == null ? emp : (learnN * seen + N0 * emp) / (learnN + N0), 0.02, 0.95) * 100);
    t.sample = h.n;
  });
  const stopRisk = hitRate(series, H, dir, step, 1e9, stop.pct);
  stop.hitRate = stopRisk.stopRate == null ? null : Math.round(stopRisk.stopRate * 100);
  const rr = targets.map((t) => (stop.pct > 0 ? r1(t.pct / stop.pct) : null));

  const notes = [];
  if (alignDir <= -0.35) notes.push('The other tools lean against this direction, so the targets are held closer.');
  else if (alignDir >= 0.35) notes.push('The other tools agree with this direction, so the targets are stretched a little.');
  if (regime >= 1.3) notes.push('This stock is moving about ' + r1(regime) + 'x its normal range lately: the ladder is wider than usual.');
  if (regime <= 0.8) notes.push('This stock is quieter than usual lately: the ladder is tighter than usual.');
  if (sess !== 'regular') notes.push('Extended hours: spreads are wide and volume thin, so treat each level as a zone.');
  if (rr[0] != null && rr[0] < 0.9) notes.push('The first target pays less than the stop risks: size it small or wait for a better entry.');
  const confidence = learnN >= 30 && mfe.length >= 120 ? 'high' : mfe.length >= 60 ? 'medium' : 'low';
  return {
    ok: true, symbol: String(symbol).toUpperCase(), direction: dir > 0 ? 'long' : 'short', horizon: hz, horizonLabel: H.label, price: round(p), session: sess,
    targets, stop, rr, notes, confidence, bucket,
    sample: { windows: mfe.length, learned: learnN }, regime: r1(regime), quantiles: q.map((x) => Math.round(x * 100) / 100),
    disclaimer: 'Educational analysis of what this stock has done in the past. Not investment advice, not a prediction, and nothing here places a trade.'
  };
}

/* how often this stock's own history reached `targetPrice` before `stopPrice` over the horizon (null stop = no stop), for a target a member chose */
function oddsFor({ direction = 'long', horizon = 'swing', price, targetPrice, stopPrice = null, bars5 = [], daily = [] } = {}) {
  const H = HORIZONS[horizon] || HORIZONS.swing, dir = direction === 'short' ? -1 : 1;
  const p = num(price), t = num(targetPrice), st = num(stopPrice);
  if (!(p > 0) || !(t > 0)) return null;
  const series = H.series === '5m' ? (Array.isArray(bars5) ? bars5 : []) : (Array.isArray(daily) ? daily : []);
  if (series.length < (H.series === '5m' ? 200 : 40)) return null;
  const targetPct = (t / p - 1) * dir * 100; if (!(targetPct > 0)) return null;
  const stopPct = st > 0 ? (1 - st / p) * dir * 100 : 0;
  const h = hitRate(series, H, dir, H.series === '5m' ? 6 : 1, targetPct, stopPct > 0 ? stopPct : 0);
  return h.n >= 20 ? { p: h.p, stopRate: h.stopRate, n: h.n, targetPct: r1(targetPct), stopPct: r1(Math.max(0, stopPct)) } : null;
}

/* ---------------- the learner ---------------- */
function emptyState() { return { v: 1, open: [], buckets: {}, outcomes: [], alerts: { analyzed: {}, byBand: {} }, updatedAt: 0 }; }

function outcomeOf(s, bars5, daily, nowMs) {
  const dir = s.direction === 'short' ? -1 : 1;
  const H = HORIZONS[s.horizon] || HORIZONS.swing;
  const end = s.at + H.windowMs;
  const seq = [];
  for (const b of bars5 || []) if (b.t > s.at && b.t < end) seq.push(b);
  const lastT = seq.length ? seq[seq.length - 1].t : s.at;
  const dayStart = F.etOf(lastT).day;
  for (const b of daily || []) if (b.t > lastT + 3_600_000 && b.t < end && F.etOf(b.t).day > dayStart) seq.push(b);
  let best = 0, worst = 0, hit = [false, false, false], stop = false, resolved = false;
  for (const b of seq) {
    const hi = num(b.h), lo = num(b.l);
    const fav = dir > 0 ? (hi / s.price - 1) * 100 : (1 - lo / s.price) * 100, adv = dir > 0 ? (1 - lo / s.price) * 100 : (hi / s.price - 1) * 100;
    const stopNow = adv >= s.stop.pct;
    if (!stop && stopNow) { stop = true; }
    if (!stop) for (let i = 0; i < 3; i++) if (!hit[i] && fav >= s.targets[i].pct) hit[i] = true;
    if (fav > best) best = fav;
    if (adv > worst) worst = adv;
    if (stop || hit[2]) { resolved = true; break; }
  }
  const done = resolved || nowMs >= end;
  return { done, hit, stop, mfePct: r1(best), maePct: r1(worst), bars: seq.length };
}

function createTargetLearner({ store = null, candles = null, now = Date.now, logger = () => {} } = {}) {
  let state = emptyState(), loaded = false, saving = null;
  async function load() {
    if (loaded) return state; loaded = true;
    if (store && typeof store.read === 'function') { try { const s = await store.read(); if (s && typeof s === 'object' && s.v === 1) state = Object.assign(emptyState(), s); } catch (error) { logger('warn', 'target_learner_load_failed', { error }); } }
    return state;
  }
  const save = () => { if (!store || typeof store.write !== 'function') return Promise.resolve(); saving = Promise.resolve(store.write(state)).catch((error) => logger('warn', 'target_learner_save_failed', { error })); return saving; };
  const bucketOf = (key) => (state.buckets[key] || (state.buckets[key] = { n: 0, hits: [0, 0, 0], stops: 0, delta: [0, 0, 0], mfe: [] }));

  /* keep a suggestion that was served (one per symbol, direction and horizon in 30 minutes) */
  async function log(s) {
    await load();
    if (!s || !s.ok) return null;
    const dup = state.open.find((o) => o.symbol === s.symbol && o.direction === s.direction && o.horizon === s.horizon && now() - o.at < 30 * 60_000);
    if (dup) return dup.id;
    const id = s.symbol + ':' + s.direction[0] + ':' + s.horizon[0] + ':' + now().toString(36);
    state.open.push({ id, at: now(), symbol: s.symbol, direction: s.direction, horizon: s.horizon, price: s.price, session: s.session, bucket: s.bucket, targets: s.targets.map((t) => ({ price: t.price, pct: t.pct, prob: t.prob })), stop: { price: s.stop.price, pct: s.stop.pct } });
    if (state.open.length > 500) state.open.splice(0, state.open.length - 500);
    void save();
    return id;
  }
  function learn(o, out) {
    const b = bucketOf(o.bucket);
    b.n += 1;
    for (let i = 0; i < 3; i++) {
      if (out.hit[i]) b.hits[i] += 1;
      const predicted = (num(o.targets[i].prob, 50)) / 100, obs = out.hit[i] ? 1 : 0;
      b.delta[i] = clamp(num(b.delta[i], 0) + 0.04 * (predicted - obs), -0.25, 0.25);
    }
    if (out.stop) b.stops += 1;
    b.mfe.push(out.mfePct); if (b.mfe.length > 150) b.mfe.shift();
    state.outcomes.push({ id: o.id, at: o.at, settledAt: now(), symbol: o.symbol, direction: o.direction, horizon: o.horizon, bucket: o.bucket, hit: out.hit, stop: out.stop, mfePct: out.mfePct, maePct: out.maePct });
    if (state.outcomes.length > 300) state.outcomes.shift();
  }
  /* judge the suggestions whose horizon has run (or that already resolved), a few per call */
  async function settle(max = 6) {
    await load();
    if (!candles) return { settled: 0 };
    const t = now(); let settled = 0, checked = 0;
    for (const o of state.open.slice()) {
      if (checked >= max) break;
      if (t - o.at < 20 * 60_000) continue;
      checked++;
      let b5 = null, d1 = null;
      try { const [a, b] = await Promise.all([candles(o.symbol, '5m').catch(() => null), candles(o.symbol, '1D').catch(() => null)]); b5 = a && a.bars; d1 = b && b.bars; } catch (_) { continue; }
      if (!b5 && !d1) continue;
      const out = outcomeOf(o, b5, d1, t);
      if (!out.done) continue;
      learn(o, out); state.open.splice(state.open.indexOf(o), 1); settled++;
    }
    if (settled) await save();
    return { settled, checked, open: state.open.length };
  }
  /* a desk alert that forensics judged: it feeds the same learning, and the band summary the owner reads */
  async function ingestAlert(key, report) {
    await load();
    if (!report || !report.ok || state.alerts.analyzed[key]) return false;
    const f = report.features || {};
    state.alerts.analyzed[key] = { at: report.at, symbol: report.symbol, side: report.side, session: f.session, hit: f.hit, stopFirst: f.stopFirst, latencyMin: f.latencyMin, runBeforePct: f.runBeforePct, targetInAtr: f.targetInAtr, peakInAtr: f.peakInAtr, lessons: (report.lessons || []).map((l) => l.code) };
    const keys = Object.keys(state.alerts.analyzed);
    if (keys.length > 400) delete state.alerts.analyzed[keys[0]];
    if (f.session === 'unknown') { void save(); return true; } // no candles were on record: judged, but nothing to count
    const band = (name, value) => { const bb = state.alerts.byBand[name + ':' + value] || (state.alerts.byBand[name + ':' + value] = { n: 0, hit: 0, stop: 0 }); bb.n++; if (f.hit) bb.hit++; if (f.stopFirst) bb.stop++; };
    band('session', f.session || 'unknown');
    band('latency', f.latencyMin == null ? 'noburst' : f.latencyMin < 5 ? '<5m' : f.latencyMin < 15 ? '5-15m' : '15m+');
    band('target', f.targetInAtr == null ? 'unknown' : f.targetInAtr < 1 ? '<1atr' : f.targetInAtr < 2 ? '1-2atr' : f.targetInAtr < 3 ? '2-3atr' : '3atr+');
    band('run', f.runBeforePct == null ? 'unknown' : f.runBeforePct < 3 ? '<3%' : f.runBeforePct < 10 ? '3-10%' : f.runBeforePct < 25 ? '10-25%' : '25%+');
    void save();
    return true;
  }
  const learned = () => ({ buckets: state.buckets });
  function summary() {
    const rows = Object.entries(state.buckets).map(([key, b]) => ({ bucket: key, n: b.n, hitRates: b.hits.map((h) => (b.n ? Math.round(h / b.n * 100) : null)), stopRate: b.n ? Math.round(b.stops / b.n * 100) : null, quantileShift: b.delta.map((x) => Math.round(x * 100) / 100), medianMfePct: b.mfe.length ? quantile(b.mfe.slice().sort((a, c) => a - c), 0.5) : null }));
    const bands = Object.entries(state.alerts.byBand).map(([k, v]) => ({ band: k, n: v.n, hitRate: v.n ? Math.round(v.hit / v.n * 100) : null, stopRate: v.n ? Math.round(v.stop / v.n * 100) : null }));
    return { open: state.open.length, settled: state.outcomes.length, buckets: rows, alertBands: bands, alertsJudged: Object.keys(state.alerts.analyzed).length, recent: state.outcomes.slice(-12) };
  }
  return { load, log, settle, ingestAlert, learned, summary, save, _state: () => state };
}

module.exports = { suggestTargets, oddsFor, autoDirection, createTargetLearner, levelsFrom, excursions, hitRate, outcomeOf, bucketKey, quantile, HORIZONS };
