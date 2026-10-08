'use strict';

/* Auto price-target updates.
 *
 * Every alert is watched for five days after it was posted. When its price target is reached, the engine gathers what the Academy knows about the stock (MEM ALGO's
 * horizon reads, the levels in the way, how fast it moves), the stock's sentiment and the market outlook, and decides whether to post a PT SMASHED update with a new
 * target. A new target is always between 12% and 40% beyond the live price in the alert's direction, never outside that band: if the evidence is not good enough to
 * justify at least +12%, no update is posted at all. At most three updates per alert, and never twice for the same target.
 *
 * Modes (ACADEMY_AUTO_PT): desk (default: decide and record the new target + its write-up for the Academy alerts desk, post nothing),
 * dry (decide and log only), on (record AND post to the alert's own channel), off. Each alert can carry its own watch window (windowMs). */

const MIN_PCT = 12, MAX_PCT = 40;
const WINDOW_MS = 5 * 86_400_000;
const MAX_UPDATES = 3;
const HOLD_RECHECK_MS = 24 * 3_600_000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fin = (v) => Number.isFinite(Number(v));
const roundPrice = (p) => (p >= 1 ? Math.round(p * 100) / 100 : Math.round(p * 10_000) / 10_000);

/* market outlook from SPY / QQQ day change and the VIX level: -1 (risk-off) to +1 (risk-on); null when nothing is known */
function marketOutlook(g) {
  if (!g || (!g.spy && !g.qqq && !g.vix)) return null;
  let s = 0, w = 0;
  if (g.spy && fin(g.spy.changePct)) { s += 0.5 * Math.tanh(g.spy.changePct / 1.2); w += 0.5; }
  if (g.qqq && fin(g.qqq.changePct)) { s += 0.3 * Math.tanh(g.qqq.changePct / 1.5); w += 0.3; }
  if (g.vix && fin(g.vix.level)) { s += 0.2 * clamp(-(g.vix.level - 20) / 15, -1, 1); w += 0.2; }
  return w ? clamp(s / w, -1, 1) : null;
}

/* The decision. Inputs are plain numbers so it can be tested and re-run exactly.
 *   side        'long' | 'short'
 *   price       the live price now
 *   alignment   MEM ALGO's four horizon reads vs the alert's direction, -1..1
 *   sentiment   the stock's composite sentiment, -1..1 (null = unknown), already in the alert's favour for a long; flipped here for a short
 *   market      market outlook -1..1 (null = unknown)
 *   volPct      the stock's typical daily range as a percent of price
 *   levels      resistance (long) or support (short) levels in the way: [{ price }]
 *   updates     how many updates were already posted for this alert */
function proposeTarget({ side = 'long', price, alignment = 0, sentiment = null, market = null, volPct = 3, levels = [], updates = 0 } = {}) {
  const p = Number(price);
  if (!(p > 0)) return { post: false, reason: 'no_live_price' };
  const long = side !== 'short';
  const dir = long ? 1 : -1;
  const parts = [[0.45, clamp(Number(alignment) || 0, -1, 1)], [0.30, sentiment == null ? null : clamp(Number(sentiment) * dir, -1, 1)], [0.25, market == null ? null : clamp(Number(market) * dir, -1, 1)]];
  let w = 0, e = 0; for (const [wt, v] of parts) if (v != null) { w += wt; e += wt * v; }
  const evidence = w ? e / w : 0;
  const known = parts.filter(([, v]) => v != null).length;
  const detail = { evidence: Math.round(evidence * 100) / 100, alignment, sentiment, market, volPct, updates, known };
  if (known < 1 || (alignment === 0 && sentiment == null && market == null)) return { post: false, reason: 'not_enough_data', ...detail };
  if (evidence < -0.25) return { post: false, reason: 'evidence_against', ...detail };
  /* -0.25 maps to the 12% floor and +1 to the 40% ceiling; fast movers get a little more room, later updates a little less */
  let pct = MIN_PCT + ((evidence + 0.25) / 1.25) * (MAX_PCT - MIN_PCT);
  pct *= clamp((Number(volPct) || 3) / 4, 0.85, 1.2);
  pct -= updates * 3;
  pct = clamp(pct, MIN_PCT, MAX_PCT);
  let target = p * (1 + dir * pct / 100);
  /* stop just short of a level the chart already respects, as long as that keeps the target inside the band */
  const inBand = (levels || []).map((l) => Number(l && l.price)).filter((x) => x > 0 && (long ? x >= p * (1 + MIN_PCT / 100) && x <= p * (1 + MAX_PCT / 100) : x <= p * (1 - MIN_PCT / 100) && x >= p * (1 - MAX_PCT / 100)))
    .sort((a, b) => (long ? a - b : b - a));
  let snapped = null;
  if (inBand.length) {
    const lvl = inBand[0], near = lvl * (1 - dir * 0.005);
    if (long ? target > lvl * 1.02 : target < lvl * 0.98) { target = near; snapped = lvl; }
  }
  target = roundPrice(clamp(target, long ? p * (1 + MIN_PCT / 100) : p * (1 - MAX_PCT / 100), long ? p * (1 + MAX_PCT / 100) : p * (1 - MIN_PCT / 100)));
  const realPct = Math.round(Math.abs(target / p - 1) * 1000) / 10;
  return { post: true, target, pct: realPct, snappedTo: snapped, reason: 'ok', ...detail };
}

/* Has the target been reached since `since`? range = { high, low } of everything traded after that moment (null when unknown). */
function targetReached({ side, target, range }) {
  if (!range || !fin(target)) return false;
  return side === 'short' ? Number(range.low) <= Number(target) : Number(range.high) >= Number(target);
}

function createAutoPtService({ mode = 'off', listAlerts, range, evidence, sentiment, market, post, compose = null, store, now = Date.now, logger = () => {}, windowMs = WINDOW_MS, maxPerTick = 40 } = {}) {
  const enabled = mode === 'dry' || mode === 'on' || mode === 'desk';
  const winOf = (s) => (fin(s && s.windowMs) ? Number(s.windowMs) : windowMs);
  let state = null, running = false;
  async function load() {
    if (!state) {
      try { state = (await store.read()) || { alerts: {} }; } catch (_) { state = { alerts: {} }; }
      if (!state.alerts) state.alerts = {};
      // desk-only updates made before the pull-back and live-price checks existed (v < 2) are dropped; posted ones are history and stay
      for (const s of Object.values(state.alerts)) if (Array.isArray(s.updates)) { const kept = s.updates.filter((u) => u.posted || u.messageId || u.v >= 2); if (kept.length !== s.updates.length) { s.updates = kept; if (s.status === 'done' && !kept.length) s.status = 'watching'; } }
    }
    return state;
  }
  const save = () => Promise.resolve(store.write(state)).catch((error) => logger('warn', 'auto_pt_save_failed', { error }));

  async function tick() {
    if (!enabled || running) return { ran: false };
    running = true;
    const out = { checked: 0, hits: 0, posted: 0, dry: 0, held: 0, errors: 0 };
    try {
      await load();
      const t = now();
      const list = (await listAlerts()) || [];
      for (const a of list) {
        if (!a || !a.key || !a.symbol || !a.channelId || !fin(a.entry) || !fin(a.target) || !fin(a.at)) continue;
        if (t - a.at > (fin(a.windowMs) ? Number(a.windowMs) : windowMs)) { const old = state.alerts[a.key]; if (old && old.status === 'watching') old.status = 'expired'; continue; }
        if (state.alerts[a.key] && fin(a.windowMs)) state.alerts[a.key].windowMs = Number(a.windowMs);
        if (state.alerts[a.key] && a.postable === false) state.alerts[a.key].postable = false;
        if (!state.alerts[a.key]) state.alerts[a.key] = { windowMs: fin(a.windowMs) ? Number(a.windowMs) : undefined, postable: a.postable !== false, symbol: a.symbol, side: a.side === 'short' ? 'short' : 'long', channelId: String(a.channelId), at: a.at, entry: a.entry, target: a.target, status: 'watching', updates: [], note: '' };
      }
      // one Discord message is one alert: a Click-to-Alert copy ('c:<id>') of a message the desk already follows ('d:<id>') is not updated twice
      for (const [k, s] of Object.entries(state.alerts)) if (k.startsWith('c:') && state.alerts['d:' + k.slice(2)] && s.status === 'watching') { s.status = 'done'; s.note = 'same message as the desk alert'; }
      const watching = Object.entries(state.alerts).filter(([, s]) => s.status === 'watching');
      watching.sort((x, y) => (x[1].checkedAt || 0) - (y[1].checkedAt || 0));
      for (const [key, s] of watching.slice(0, maxPerTick)) {
        out.checked++; s.checkedAt = t;
        if (t - s.at > winOf(s)) { s.status = 'expired'; continue; }
        if (s.updates.length >= MAX_UPDATES) { s.status = 'done'; s.note = 'update limit reached'; continue; }
        const cur = s.updates.length ? s.updates[s.updates.length - 1] : null;
        const target = cur ? cur.target : s.target, since = cur ? cur.at : s.at;
        // a newer alert on the same ticker and channel with a higher target already carries the story: do not repeat it
        const newer = list.find((x) => x && x.key !== key && x.symbol === s.symbol && String(x.channelId) === s.channelId && x.at > since && (s.side === 'short' ? x.target < target : x.target > target));
        if (newer) { s.status = 'done'; s.note = 'superseded by a newer alert'; continue; }
        try {
          const r = await range(s.symbol, since);
          if (!targetReached({ side: s.side, target, range: r })) continue;
          if (!s.hitAt) { s.hitAt = t; out.hits++; }
          const ev = await evidence(s.symbol, s.side);
          // decide on the live price when the desk has one (the evidence bars can still be yesterday's close before the open)
          const live = list.find((x) => x && x.key === key);
          if (ev && live && fin(live.price) && Number(live.price) > 0) ev.price = Number(live.price);
          // only a target that is still being held earns a new one: after a pull-back under the smashed target, hold and look again later
          if (ev && fin(ev.price) && (s.side === 'short' ? Number(ev.price) > target * 1.03 : Number(ev.price) < target * 0.97)) {
            out.held++; s.note = 'no update: pulled back under the smashed target (' + roundPrice(Number(ev.price)) + ' vs ' + target + ')';
            if (t - s.hitAt > HOLD_RECHECK_MS) { s.status = 'done'; s.note += ' (a day after the target was hit)'; }
            continue;
          }
          const sent = sentiment ? await Promise.resolve(sentiment(s.symbol)).catch(() => null) : null;
          const mk = market ? await Promise.resolve(market()).catch(() => null) : null;
          const prop = proposeTarget({ side: s.side, price: ev && ev.price, alignment: ev && ev.alignment, sentiment: sent && sent.available !== false && fin(sent.score) ? Number(sent.score) : null, market: marketOutlook(mk), volPct: ev && ev.volPct, levels: ev && ev.levels, updates: s.updates.length });
          s.lastProposal = { at: t, ...prop };
          if (!prop.post) {
            out.held++; s.note = 'no update: ' + prop.reason;
            if (t - s.hitAt > HOLD_RECHECK_MS) { s.status = 'done'; s.note += ' (a day after the target was hit)'; }
            continue;
          }
          if (mode === 'dry') { out.dry++; s.note = 'dry run: would post ' + prop.target; logger('info', 'auto_pt_dry_run', { symbol: s.symbol, target: prop.target, pct: prop.pct }); s.dryTarget = prop.target; continue; }
          // the write-up (same PT SMASHED layout as the Discord post) is kept for the Academy alerts desk
          let written = null;
          if (compose) { try { written = await compose({ symbol: s.symbol, side: s.side, target: prop.target, previousTarget: target }); } catch (error) { logger('warn', 'auto_pt_compose_failed', { symbol: s.symbol, error: String(error && error.message || error) }); } }
          let sent2 = null;
          const willPost = mode === 'on' && s.postable !== false;
          if (willPost) sent2 = await post({ symbol: s.symbol, side: s.side, channelId: s.channelId, target: prop.target, previousTarget: target });
          s.updates.push({ at: now(), target: prop.target, pct: prop.pct, previous: target, price: ev && ev.price, v: 2, text: written && written.text ? String(written.text).slice(0, 3800) : '', stop: written && written.stop || null, posted: willPost, messageId: sent2 && sent2.messageId || '' });
          out.posted++;
          s.note = (willPost ? 'posted ' : 'set on the desk ') + prop.target; delete s.hitAt;
          logger('info', willPost ? 'auto_pt_posted' : 'auto_pt_desk', { key, symbol: s.symbol, target: prop.target, pct: prop.pct, updates: s.updates.length });
        } catch (error) { out.errors++; s.note = 'error: ' + String(error && error.message || error).slice(0, 80); logger('warn', 'auto_pt_failed', { symbol: s.symbol, error }); }
      }
      await save();
    } finally { running = false; }
    return { ran: true, ...out };
  }
  const status = async () => { await load(); return { mode, watching: Object.values(state.alerts).filter((s) => s.status === 'watching').length, updates: Object.values(state.alerts).reduce((n, s) => n + s.updates.length, 0) }; };
  /* the target ladder for one alert (key 'd:<alert id>'): the latest target and every update, for the alerts desk */
  const forKey = (key) => { const s = state && state.alerts[key]; return s && s.updates.length ? { target: s.updates[s.updates.length - 1].target, updates: s.updates.map((u, i) => ({ n: i + 1, at: u.at, target: u.target, previous: u.previous, pct: u.pct, price: u.price, stop: u.stop, text: u.text, posted: !!u.posted })) } : null; };
  return { tick, status, enabled, mode, forKey, load };
}

module.exports = { proposeTarget, marketOutlook, targetReached, createAutoPtService, MIN_PCT, MAX_PCT, WINDOW_MS, MAX_UPDATES };
