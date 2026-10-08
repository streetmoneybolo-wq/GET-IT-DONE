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

/* The stop moves up with every smashed target and never moves back. The smashed target is now support, so the new stop sits under it by a
   volatility buffer (3% to 8%), at least 3% under the live price, and never below breakeven once the alert is far enough in profit.
   prev = { low, high } of the stop before this update (the alert's own stop the first time). Mirrored for a short. */
function raisedStop({ side = 'long', price, previousTarget, entry, prev = null, volPct = 4 } = {}) {
  const p = Number(price), anchor = Number(previousTarget), e = Number(entry);
  if (!(p > 0) || !(anchor > 0)) return null;
  const buf = clamp((Number(volPct) || 4) * 0.6, 3, 8) / 100;
  let low, high;
  if (side !== 'short') {
    high = Math.min(anchor * (1 - buf), p * 0.97);
    if (e > 0 && e < p * 0.97) high = Math.max(high, e);
    low = high * 0.975;
    if (prev && Number(prev.high) > high) { high = Number(prev.high); low = Math.max(low, Number(prev.low) || 0); }
    if (low >= high) low = high * 0.975;
  } else {
    low = Math.max(anchor * (1 + buf), p * 1.03);
    if (e > 0 && e > p * 1.03) low = Math.min(low, e);
    high = low * 1.025;
    if (prev && Number(prev.low) > 0 && Number(prev.low) < low) { low = Number(prev.low); high = Math.min(high, Number(prev.high) || high); }
    if (high <= low) high = low * 1.025;
  }
  return { low: roundPrice(low), high: roundPrice(high) };
}
const money = (v) => '$' + (Number(v) >= 1 ? Number(v).toFixed(2) : Number(v).toFixed(4));
const rangeText = (r) => (r ? money(r.low) + '–' + money(r.high) : '');

/* The write-up behind a new target, from the decision and the chart readings (evidence.tech / evidence.reads):
   status/targetNote/riskNote fill the PT SMASHED lines, why[] is the "why it can keep running" list (also posted), signals[] are the chips on
   the desk, and story is the same thing said the way a person would say it (the Academy notification and the desk). */
function insightFor({ side = 'long', symbol = '', price, prop, updates = 0, tech = null, reads = null, previousTarget = null, stop = null, stopWas = null }) {
  const up = side !== 'short';
  const tk = String(symbol || '').toUpperCase();
  const al = Number(prop && prop.alignment) || 0, sent = prop ? prop.sentiment : null, mk = prop ? prop.market : null, vol = Number(prop && prop.volPct) || 0;
  const dirWord = up ? 'upward' : 'downward';
  const why = [], signals = [];
  const add = (text, tone, chip) => { why.push(text); signals.push({ text: chip || text, tone }); };
  const px = Number(price);
  // MEM ALGO horizons that agree with the trade
  const H = { day: 'day', swing: 'swing', mid: 'mid', long: 'long-term' };
  const agree = reads ? Object.keys(H).filter((h) => reads[h] && Number(reads[h].dir) === (up ? 1 : -1)) : [];
  const against = reads ? Object.keys(H).filter((h) => reads[h] && Number(reads[h].dir) === (up ? -1 : 1)) : [];
  const list = (arr) => arr.map((h) => H[h]).join(', ').replace(/, ([^,]*)$/, ' & $1');
  if (agree.length) add('MEM ALGO ' + (up ? 'bullish' : 'bearish') + ' on the ' + list(agree) + ' read' + (agree.length > 1 ? 's' : ''), agree.length >= 3 ? 'good' : 'ok', 'MEM ALGO ' + agree.length + '/4 ' + (up ? 'bull' : 'bear'));
  const t = tech || {};
  if (fin(t.relVol) && t.relVol >= 1.5) add('Volume ' + t.relVol + '× its 20-day average: ' + (up ? 'buyers' : 'sellers') + ' are still showing up', t.relVol >= 3 ? 'good' : 'ok', 'Volume ' + t.relVol + '×');
  if (t.aboveVwap != null && fin(t.vwap)) {
    if (t.aboveVwap === up) add('Holding ' + (up ? 'above' : 'below') + ' today’s VWAP (' + money(t.vwap) + ')', 'good', (up ? 'Above' : 'Below') + ' VWAP');
    else signals.push({ text: (up ? 'Under' : 'Over') + ' VWAP', tone: 'warn' });
  }
  if (fin(t.sma20) && px > 0 && (up ? px > t.sma20 : px < t.sma20)) add((up ? 'Above' : 'Below') + ' its ' + (t.sma20Rising === up ? (up ? 'rising' : 'falling') + ' ' : '') + '20-day average (' + money(t.sma20) + ')' + (fin(t.sma50) && (up ? px > t.sma50 : px < t.sma50) ? ' and the 50-day (' + money(t.sma50) + ')' : ''), 'good', (up ? 'Above' : 'Below') + ' 20D avg');
  if (t.breakout && t.range20) add('Broke its 20-day ' + (up ? 'high (' + money(t.range20.high) : 'low (' + money(t.range20.low)) + ')', 'good', '20-day ' + (up ? 'breakout' : 'breakdown'));
  if (fin(t.rsi)) {
    const r = up ? t.rsi : 100 - t.rsi;
    if (r >= 80) signals.push({ text: 'RSI ' + t.rsi + ' stretched', tone: 'warn' });
    else if (r >= 55) add('RSI ' + t.rsi + ': strong momentum, not exhausted yet', 'good', 'RSI ' + t.rsi);
    else signals.push({ text: 'RSI ' + t.rsi, tone: 'ok' });
  }
  const sentS = Number(sent) * (up ? 1 : -1);
  if (sent != null && fin(sentS)) { if (sentS > 0.2) add('News and social sentiment are behind it', 'good', 'Sentiment +'); else if (sentS < -0.2) signals.push({ text: 'Sentiment cooling', tone: 'warn' }); }
  const mkS = Number(mk) * (up ? 1 : -1);
  if (mk != null && fin(mkS)) { if (mkS > 0.2) add('The market backdrop is supportive', 'good', 'Market ' + (up ? 'risk-on' : 'risk-off')); else if (mkS < -0.2) signals.push({ text: 'Market against', tone: 'warn' }); }
  if (prop && prop.snappedTo) signals.push({ text: 'Target under ' + money(prop.snappedTo) + ' level', tone: 'ok' });

  const status = al >= 0.5 ? 'momentum still pushing ' + dirWord + ', MEM ALGO lined up' + (agree.length >= 3 ? ' on ' + agree.length + ' of 4 horizons.' : '.') : al > 0 ? 'momentum holding, MEM ALGO still leaning our way.' : 'price held the level; momentum is mixed, so this leg is on a shorter leash.';
  const targetNote = 'New target is ' + (prop && prop.pct) + '% ' + (up ? 'above' : 'below') + ' here' + (prop && prop.snappedTo ? ', set just ' + (up ? 'under' : 'over') + ' the ' + money(prop.snappedTo) + ' level the chart already respects' : '') + '.';
  const legs = updates >= 1 ? (updates === 1 ? 'Third target now. ' : 'Deep in extended territory now. ') : '';
  const warn = fin(t.rsi) && (up ? t.rsi >= 80 : t.rsi <= 20) ? 'RSI is stretched at ' + t.rsi + ', so expect shakeouts. ' : '';
  const riskNote = legs + warn + (vol >= 6 ? 'This one moves about ' + Math.round(vol) + '% a day, so take majority profits into strength.' : 'Volatility elevated, consider majority profits as we push deeper into extended territory.');

  // the same read, said the way a person would say it
  const parts = [];
  parts.push(tk + ' just ' + (up ? 'ran through' : 'broke down through') + ' our ' + (previousTarget ? money(previousTarget) + ' ' : '') + 'target' + (px > 0 ? ' and it’s still holding ' + (up ? 'up' : 'down') + ' there at ' + money(px) : '') + '.');
  parts.push('The new target is ' + (prop ? money(prop.target) + ', about ' + prop.pct + '% ' + (up ? 'higher' : 'lower') : 'set') + (prop && prop.snappedTo ? ', parked just ' + (up ? 'under' : 'above') + ' the ' + money(prop.snappedTo) + ' level the chart has respected before' : '') + '.');
  if (why.length) parts.push('Why we think it has more in it: ' + why.slice(0, 4).map((w, i) => (i ? w.charAt(0).toLowerCase() + w.slice(1) : w)).join('; ') + '.');
  else parts.push('The read is mixed, so treat this leg as a bonus and manage it tight.');
  if (against.length && agree.length < 3) parts.push('Heads up: MEM ALGO leans the other way on the ' + list(against) + ' read.');
  if (stop) parts.push('We ' + (up ? 'raised' : 'lowered') + ' the stop to ' + (up ? 'below ' : 'above ') + rangeText(stop) + (stopWas ? ' (it was ' + stopWas + ')' : '') + ', so a reversal still leaves you in good shape.');
  parts.push(updates >= 1 ? 'We’re deep into extended territory, so most of the position should already be paid.' : 'Take some off into strength and let the rest work.');
  return { status, targetNote, riskNote, why: why.slice(0, 5), signals: signals.slice(0, 8), story: parts.join(' '), stopLow: stop ? stop.low : null, stopHigh: stop ? stop.high : null, stopWas: stopWas || null };
}

/* Has the target been reached since `since`? range = { high, low } of everything traded after that moment (null when unknown). */
function targetReached({ side, target, range }) {
  if (!range || !fin(target)) return false;
  return side === 'short' ? Number(range.low) <= Number(target) : Number(range.high) >= Number(target);
}

function createAutoPtService({ mode = 'off', listAlerts, range, evidence, sentiment, market, post, compose = null, onUpdate = null, store, now = Date.now, logger = () => {}, windowMs = WINDOW_MS, maxPerTick = 40 } = {}) {
  const enabled = mode === 'dry' || mode === 'on' || mode === 'desk';
  const winOf = (s) => (fin(s && s.windowMs) ? Number(s.windowMs) : windowMs);
  let state = null, running = false, view = null;
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
        if (state.alerts[a.key] && a.postable === true) state.alerts[a.key].postable = true;
        if (state.alerts[a.key] && fin(a.stop) && !fin(state.alerts[a.key].stop0)) state.alerts[a.key].stop0 = Number(a.stop);
        if (!state.alerts[a.key]) state.alerts[a.key] = { stop0: fin(a.stop) ? Number(a.stop) : undefined, windowMs: fin(a.windowMs) ? Number(a.windowMs) : undefined, postable: a.postable !== false, symbol: a.symbol, side: a.side === 'short' ? 'short' : 'long', channelId: String(a.channelId), at: a.at, entry: a.entry, target: a.target, status: 'watching', updates: [], note: '' };
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
          // every new target raises the stop; the first time it moves up from the alert's own stop (or the usual wide 7-10% buffer)
          const prevStop = cur && cur.stopRange ? cur.stopRange : (s.side === 'short' ? { low: fin(s.stop0) ? s.stop0 : s.entry * 1.07, high: fin(s.stop0) ? s.stop0 * 1.025 : s.entry * 1.10 } : { low: fin(s.stop0) ? s.stop0 * 0.975 : s.entry * 0.90, high: fin(s.stop0) ? s.stop0 : s.entry * 0.93 });
          const stopRange = raisedStop({ side: s.side, price: ev && ev.price, previousTarget: target, entry: s.entry, prev: prevStop, volPct: ev && ev.volPct });
          const insight = insightFor({ side: s.side, symbol: s.symbol, price: ev && ev.price, prop, updates: s.updates.length, tech: ev && ev.tech, reads: ev && ev.reads, previousTarget: target, stop: stopRange, stopWas: rangeText({ low: roundPrice(prevStop.low), high: roundPrice(prevStop.high) }) });
          if (compose) { try { written = await compose({ symbol: s.symbol, side: s.side, target: prop.target, previousTarget: target, insight }); } catch (error) { logger('warn', 'auto_pt_compose_failed', { symbol: s.symbol, error: String(error && error.message || error) }); } }
          let sent2 = null;
          const willPost = mode === 'on' && s.postable !== false;
          if (willPost) sent2 = await post({ symbol: s.symbol, side: s.side, channelId: s.channelId, target: prop.target, previousTarget: target, insight });
          s.updates.push({ at: now(), target: prop.target, pct: prop.pct, previous: target, price: ev && ev.price, v: 3, text: written && written.text ? String(written.text).slice(0, 3800) : '', stop: stopRange ? (s.side === 'short' ? stopRange.low : stopRange.high) : (written && written.stop || null), stopRange, stopWas: insight.stopWas, why: insight.why, signals: insight.signals, story: insight.story, tech: ev && ev.tech || null, posted: willPost, messageId: sent2 && sent2.messageId || '' });
          out.posted++;
          s.note = (willPost ? 'posted ' : 'set on the desk ') + prop.target; delete s.hitAt;
          if (typeof onUpdate === 'function') { try { onUpdate({ key, symbol: s.symbol, ...view(s, s.updates[s.updates.length - 1], s.updates.length - 1) }); } catch (error) { logger('warn', 'auto_pt_notify_failed', { error }); } }
          logger('info', willPost ? 'auto_pt_posted' : 'auto_pt_desk', { key, symbol: s.symbol, target: prop.target, pct: prop.pct, updates: s.updates.length });
        } catch (error) { out.errors++; s.note = 'error: ' + String(error && error.message || error).slice(0, 80); logger('warn', 'auto_pt_failed', { symbol: s.symbol, error }); }
      }
      await save();
    } finally { running = false; }
    return { ran: true, ...out };
  }
  const status = async () => { await load(); return { mode, watching: Object.values(state.alerts).filter((s) => s.status === 'watching').length, updates: Object.values(state.alerts).reduce((n, s) => n + s.updates.length, 0) }; };
  /* the target ladder for one alert (key 'd:<alert id>'): the latest target and every update, for the alerts desk */
  view = (s, u, i) => ({ n: i + 1, at: u.at, target: u.target, previous: u.previous, pct: u.pct, price: u.price, stop: u.stop, stopRange: u.stopRange || null, stopWas: u.stopWas || null, why: u.why || [], signals: u.signals || [], story: u.story || '', entry: s.entry, side: s.side, text: u.text, posted: !!u.posted });
  const forKey = (key) => { const s = state && state.alerts[key]; return s && s.updates.length ? { target: s.updates[s.updates.length - 1].target, stop: s.updates[s.updates.length - 1].stop || null, side: s.side, updates: s.updates.map((u, i) => view(s, u, i)) } : null; };
  /* every new target set after `since` (desk alerts only: 'd:<id>'), newest first, for the Academy's new-target notification */
  const recent = (since = 0, limit = 20) => {
    if (!state) return [];
    const out = [];
    for (const [key, s] of Object.entries(state.alerts)) if (key.startsWith('d:')) s.updates.forEach((u, i) => { if (u.at > since) out.push({ key, id: key.slice(2), symbol: s.symbol, ...view(s, u, i), text: undefined }); });
    return out.sort((a, b) => b.at - a.at).slice(0, limit);
  };
  return { tick, status, enabled, mode, forKey, recent, load };
}

module.exports = { proposeTarget, marketOutlook, targetReached, insightFor, raisedStop, createAutoPtService, MIN_PCT, MAX_PCT, WINDOW_MS, MAX_UPDATES };
