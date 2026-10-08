'use strict';

/* Click-to-Alert for the Academy Live Chart Lab: a separate paid add-on.
 *
 * A member clicks a price on the chart. The entry is the live price at that moment, the clicked price is the target, and the Academy's own data decides
 * how long the trade is likely to take: a day trade (1-2 days), a swing (3-10 trading days), a mid hold (up to about 6 months) or a long-term hold
 * (longer). The alert is then posted to a channel the member picks, in GrandMaster-Obi's layout (academy-alert-format.js).
 *
 * The time estimate blends the stock's own volatility (how long a move this size takes at its usual daily range) with how far the target is in daily
 * ranges, then speeds it up or slows it down by whether MEM ALGO's four horizon reads lean the same way. The levels in the way come from the smart-money
 * map. Nothing here predicts: it is an educational estimate, shown with its evidence, and nothing places a trade.
 *
 * Entitlement is a Discord role in the Academy server (SML_ACADEMY_CLICK_ALERT_ROLE_IDS), checked live on every call, so an ended subscription stops working
 * at once. The member must be able to post in the channel, and the Academy bot must be in that server and able to post there. @everyone is only used where
 * both of them are allowed to ping it. */

const SM = require('./academy-smart-money');
const { horizonRead } = require('./academy-screener');
const format = require('./academy-alert-format');
const { buildScenarios } = require('./academy-scenarios');
const images = require('./academy-scenario-image');
const optionsAlert = require('./academy-options-alert');
const { postAlertRange } = require('./academy-alerts');

const SNOWFLAKE = /^\d{15,25}$/;
const HORIZONS = ['day', 'swing', 'mid', 'long'];
const HORIZON_TEXT = {
  day: { label: 'Day trade', span: '1 to 2 trading days' },
  swing: { label: 'Swing trade', span: '3 to 10 trading days' },
  mid: { label: 'Mid-term hold', span: 'about 1 to 6 months' },
  long: { label: 'Long-term hold', span: 'more than 6 months' }
};
const DISCLAIMER = 'Educational estimate from the Academy\'s data. It is not a prediction, financial advice, or a trade instruction.';
const fin = Number.isFinite;
const round2 = (v) => Math.round(v * 100) / 100;

/* Keep the timestamp and executable price identical across every alert route.
   The clicked chart price is the target; the entry is the live price captured
   when the alert analysis is created. */
function alertTimeAndPrice(analysis, at) {
  const et = at.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' ET';
  const entry = Number(analysis.entry);
  return '⏱ ' + et + ' · price at alert $' + entry.toFixed(entry >= 1 ? 2 : 4);
}

const horizonForDays = (days) => (days <= 2 ? 'day' : days <= 10 ? 'swing' : days <= 126 ? 'mid' : 'long');

const cleanBars = (payload) => (payload && Array.isArray(payload.bars) ? payload.bars : []).map((b) => ({ t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v || 0 })).filter((b) => [b.t, b.o, b.h, b.l, b.c].every(fin));

function dailyVolatility(daily) {
  const c = daily.slice(-61).map((b) => b.c); const r = [];
  for (let i = 1; i < c.length; i++) if (c[i - 1] > 0 && c[i] > 0) r.push(Math.log(c[i] / c[i - 1]));
  if (r.length < 10) return null;
  const mean = r.reduce((s, x) => s + x, 0) / r.length;
  return Math.sqrt(r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1));
}

/* Levels between the entry and the target that price has to work through, from the smart-money map: swing points, equal highs / lows, order blocks, open gaps. */
function levelsInTheWay(a, entry, target) {
  if (!a) return [];
  const lo = Math.min(entry, target), hi = Math.max(entry, target), up = target > entry, out = [];
  const add = (price, text) => { if (fin(price) && price > lo && price < hi) out.push({ price: round2(price), text }); };
  for (const p of (a.pivots.highs || []).slice(-8)) add(p.price, 'swing high');
  for (const p of (a.pivots.lows || []).slice(-8)) add(p.price, 'swing low');
  for (const l of a.liquidity) if (l.takenAt == null) add(l.level, 'equal ' + (l.kind === 'EQH' ? 'highs' : 'lows') + ' x' + l.count + ' (stops rest beyond)');
  for (const o of a.structure.orderBlocks) if (o.invalidAt == null) add(up ? (o.dir < 0 ? o.bottom : o.top) : (o.dir > 0 ? o.top : o.bottom), (o.dir > 0 ? 'demand' : 'supply') + ' block');
  for (const g of a.fvg) if (g.filledAt == null) add(up ? g.bottom : g.top, (g.dir > 0 ? 'bullish' : 'bearish') + ' gap');
  const seen = new Set(), unique = [];
  for (const l of out.sort((x, y) => (up ? x.price - y.price : y.price - x.price))) { const k = l.price.toFixed(2); if (!seen.has(k)) { seen.add(k); unique.push(l); } }
  return unique.slice(0, 6);
}

/* A structure-based stop: just beyond the nearest protective level on the far side of the entry, else a percentage stop by trade type. */
function chooseStop({ entry, side, a, atr, type }) {
  const auto = format.autoStop({ entry, side, type });
  if (!a || !(atr > 0)) return { stop: auto, basis: 'percentage' };
  const cands = [];
  if (side === 'long') {
    for (const p of (a.pivots.lows || []).slice(-6)) cands.push({ p: p.price, why: 'recent swing low' });
    for (const o of a.structure.orderBlocks) if (o.invalidAt == null && o.dir > 0) cands.push({ p: o.bottom, why: 'demand block' });
    for (const l of a.liquidity) if (l.kind === 'EQL' && l.takenAt == null) cands.push({ p: l.level, why: 'equal lows' });
    const ok = cands.filter((c) => c.p < entry - 0.4 * atr && c.p > entry * 0.8).sort((x, y) => y.p - x.p)[0];
    if (ok) return { stop: round2(ok.p - 0.1 * atr) > 0 ? round2(ok.p - 0.1 * atr) : auto, basis: ok.why };
  } else {
    for (const p of (a.pivots.highs || []).slice(-6)) cands.push({ p: p.price, why: 'recent swing high' });
    for (const o of a.structure.orderBlocks) if (o.invalidAt == null && o.dir < 0) cands.push({ p: o.top, why: 'supply block' });
    for (const l of a.liquidity) if (l.kind === 'EQH' && l.takenAt == null) cands.push({ p: l.level, why: 'equal highs' });
    const ok = cands.filter((c) => c.p > entry + 0.4 * atr && c.p < entry * 1.2).sort((x, y) => x.p - y.p)[0];
    if (ok) return { stop: round2(ok.p + 0.1 * atr), basis: ok.why };
  }
  return { stop: auto, basis: 'percentage' };
}

const riskFor = (atrPct, price) => {
  const order = ['low', 'mid', 'mid-high', 'high', 'extreme'];
  let i = atrPct >= 0.08 ? 4 : atrPct >= 0.05 ? 3 : atrPct >= 0.03 ? 2 : atrPct >= 0.015 ? 1 : 0;
  if (price < 1) i = Math.min(4, i + 1);
  return order[i];
};

/* The pure heart: everything it needs is passed in, so it can be tested and re-run exactly. */
function classify({ symbol, target, price, bars }) {
  const sym = String(symbol || '').toUpperCase();
  const entry = Number(price), tgt = Number(target);
  if (!/^[A-Z0-9.:-]{1,10}$/.test(sym)) return { ok: false, code: 'invalid_symbol' };
  if (!(entry > 0)) return { ok: false, code: 'no_live_price' };
  if (!(tgt > 0)) return { ok: false, code: 'invalid_target' };
  const side = tgt > entry ? 'long' : 'short';
  const move = (tgt - entry) / entry;
  if (Math.abs(move) < 0.002) return { ok: false, code: 'target_too_close', detail: 'The target is within 0.2% of the entry price.' };
  if (Math.abs(move) > 3) return { ok: false, code: 'target_too_far', detail: 'The target is more than 300% from the entry price.' };
  const daily = bars.daily || [];
  if (daily.length < 30) return { ok: false, code: 'not_enough_history', detail: 'Fewer than 30 daily candles for ' + sym + '.' };

  const atrD = SM.atrSeries(daily).slice(-1)[0] || entry * 0.02;
  const sigma = Math.max(0.003, dailyVolatility(daily) || atrD / entry);
  const D = Math.abs(tgt - entry), r = D / entry;
  const tVol = (r / sigma) ** 2, tAtr = D / atrD;
  const blend = Math.sqrt(tVol * tAtr);

  // MEM ALGO's four horizon reads: lean the same way as the click, or against it
  const reads = {}; let align = 0, counted = 0;
  const tfOf = { day: bars.m15, swing: bars.daily, mid: bars.daily, long: bars.weekly };
  for (const h of HORIZONS) {
    const rd = tfOf[h] && tfOf[h].length >= 60 ? horizonRead(tfOf[h], h, {}) : null;
    if (!rd) continue;
    reads[h] = { dir: rd.dir, strength: rd.strength, bias: rd.bias, grade: rd.grade };
    const sgn = side === 'long' ? 1 : -1;
    align += rd.dir * sgn * (1 + Math.min(4, rd.strength) / 2); counted += 1;
  }
  const alignment = counted ? Math.max(-1, Math.min(1, align / (counted * 3))) : 0;
  const factor = alignment >= 0.3 ? 0.8 : alignment <= -0.3 ? 1.4 : 1;
  const days = Math.max(0.15, Math.min(3000, blend * factor));
  const low = days * 0.6, high = days * 1.7;
  const horizon = horizonForDays(days), alsoFits = [...new Set([horizonForDays(low), horizonForDays(high)])].filter((h) => h !== horizon);

  // structure and levels for the chosen horizon
  const hBars = horizon === 'day' ? (bars.m5 && bars.m5.length >= 40 ? bars.m5 : daily) : horizon === 'long' ? (bars.weekly && bars.weekly.length >= 40 ? bars.weekly : daily) : daily;
  const a = SM.analyze(hBars), aDaily = hBars === daily ? a : SM.analyze(daily);
  const atrH = a ? a.atr : atrD;
  const levels = levelsInTheWay(a, entry, tgt);
  const stopPick = chooseStop({ entry, side, a, atr: atrH, type: horizon });
  let risk = riskFor(atrD / entry, entry);
  const counterTrend = alignment <= -0.3;
  if (counterTrend) risk = ['low', 'mid', 'mid-high', 'high', 'extreme'][Math.min(4, ['low', 'mid', 'mid-high', 'high', 'extreme'].indexOf(risk) + 1)]; // trading against MEM ALGO is riskier than the volatility alone says
  const nearTarget = a && [...(a.pivots.highs || []), ...(a.pivots.lows || [])].map((p) => p.price).concat(a.liquidity.map((l) => l.level)).find((p) => Math.abs(p - tgt) <= 0.5 * atrH);

  // confidence: how much data there is, whether the horizon reads agree, and how far the estimate is from a boundary
  let pts = 0;
  if (daily.length >= 120) pts++;
  if (horizon !== 'long' || (bars.weekly || []).length >= 60) pts++;
  if (counted >= 3 && alignment >= 0.3) pts += 2; else if (counted >= 3 && alignment <= -0.3) pts -= 1;
  if (!alsoFits.length) pts++;
  if (bars.fresh !== false) pts++;
  const confidence = pts >= 4 ? 'high' : pts >= 2 ? 'medium' : 'low';

  const T = HORIZON_TEXT[horizon];
  const rationale = [];
  rationale.push('The move is ' + (Math.abs(move) * 100).toFixed(1) + '% (' + (D / atrD).toFixed(1) + ' daily ranges) ' + (side === 'long' ? 'up' : 'down') + '; ' + sym + ' usually moves about ' + (sigma * 100).toFixed(1) + '% a day.');
  rationale.push('At its normal pace that takes roughly ' + (days < 1 ? 'under a day' : days < 10 ? days.toFixed(1) + ' trading days' : Math.round(days) + ' trading days') + ' (about ' + (low < 1 ? 'under a day' : Math.round(low) + '') + ' to ' + Math.round(high) + '), which is a ' + T.label.toLowerCase() + ' (' + T.span + ').');
  if (counted) {
    const agree = HORIZONS.filter((h) => reads[h] && reads[h].dir === (side === 'long' ? 1 : -1)).length, against = HORIZONS.filter((h) => reads[h] && reads[h].dir === (side === 'long' ? -1 : 1)).length;
    rationale.push('MEM ALGO leans ' + (side === 'long' ? 'up' : 'down') + ' on ' + agree + ' of ' + counted + ' horizons' + (against ? ' and the other way on ' + against : '') + (factor < 1 ? ', so the estimate was shortened.' : factor > 1 ? ', so the estimate was lengthened.' : '.'));
  }
  if (aDaily && aDaily.structure.events.length) { const e = aDaily.structure.events.slice(-1)[0]; rationale.push('Daily structure: the last break was a ' + (e.type === 'CHoCH' ? 'change of character' : 'break of structure') + ' ' + (e.dir > 0 ? 'up' : 'down') + ' through ' + e.level.toFixed(2) + '.'); }
  if (levels.length) rationale.push('Levels in the way: ' + levels.slice(0, 4).map((l) => l.price.toFixed(2) + ' (' + l.text + ')').join(', ') + '.');
  if (nearTarget != null) rationale.push('The target sits at a level the chart already respects (' + nearTarget.toFixed(2) + ').');
  if (alsoFits.length) rationale.push('The range of the estimate also touches the ' + alsoFits.map((h) => HORIZON_TEXT[h].label.toLowerCase()).join(' and ') + ' band.');

  // the one-line notes the layout uses, drawn only from this data
  const up = side === 'long';
  const trend = aDaily ? aDaily.structure.trend : 0, ev = aDaily && aDaily.structure.events.slice(-1)[0];
  const intra = bars.m5 && bars.m5.length > 15 ? bars.m5 : null, atr5 = intra ? SM.atrSeries(intra).slice(-1)[0] : 0;
  const mom = intra && atr5 > 0 ? (intra[intra.length - 1].c - intra[intra.length - 13].c) / atr5 : 0;
  const setup = sym + ' ' + (trend > 0 ? 'in an uptrend' : trend < 0 ? 'in a downtrend' : 'building a range') + (ev ? ' — last ' + (ev.type === 'CHoCH' ? 'change of character' : 'break of structure') + ' ' + (ev.dir > 0 ? 'up' : 'down') + ' at $' + ev.level.toFixed(2) : ' — structure still forming') + '.';
  const pressure = Math.abs(mom) >= 1.5 ? 'Strong' : Math.abs(mom) >= 0.5 ? 'Steady' : null;
  const momentum = pressure ? pressure + ' ' + (mom > 0 ? 'upside' : 'downside') + ' pressure — ' + (Math.sign(mom) === (up ? 1 : -1) ? 'watching for continuation toward the ' + (up ? 'upper' : 'lower') + ' range.' : 'against the target for now, watching for a turn.') : 'Momentum is flat right now — watching for a push toward the ' + (up ? 'upper' : 'lower') + ' range.';
  const plus = alignment >= 0.3;
  const alert = {
    ticker: sym, side, entry: round2(entry) || entry, pt: tgt, plus, type: horizon, risk, stop: stopPick.stop,
    setup, momentum, targetNote: plus ? 'Likely range test if momentum continues.' : 'Target zone in play if momentum holds.',
    riskNote: counterTrend ? 'Against the trend — size down and take partial profits quickly.' : risk === 'extreme' || risk === 'high' ? 'Partial profits recommended on strength.' : risk === 'low' ? 'Trim into strength and manage the stop.' : 'Scale out into strength and keep size sensible.',
    stopNote: up ? (stopPick.basis === 'percentage' ? 'trend weakens.' : 'below the ' + stopPick.basis + ', trend weakens.') : (stopPick.basis === 'percentage' ? 'downtrend fails.' : 'above the ' + stopPick.basis + ', downtrend fails.')
  };
  return {
    ok: true, symbol: sym, side, entry, target: tgt, movePct: round2(move * 100), stop: stopPick.stop, stopBasis: stopPick.basis, risk,
    atr: atrH, horizon, horizonLabel: T.label, horizonSpan: T.span, counterTrend, alsoFits, expectedDays: { low: round2(low), mid: round2(days), high: round2(high) }, confidence,
    alignment: Math.round(alignment * 100) / 100, reads, levels, rationale, alert, disclaimer: DISCLAIMER
  };
}

/* In-memory or Postgres log of what was sent: audit trail and rate limits. */
function createClickAlertStore({ pool = null } = {}) {
  const db = pool && typeof pool.query === 'function' ? pool : null;
  const mem = [];
  async function record(row) {
    if (db) { await db.query('INSERT INTO academy_click_alerts (discord_id, guild_id, channel_id, message_id, symbol, side, entry, target, stop, horizon, confidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [row.userId, row.guildId, row.channelId, row.messageId, row.symbol, row.side, row.entry, row.target, row.stop, row.horizon, row.confidence]); return; }
    mem.push({ ...row, at: Date.now() }); if (mem.length > 5000) mem.shift();
  }
  async function count({ userId = null, channelId = null, symbol = null, target = null, sinceMs }) {
    if (db) {
      const where = ['created_at > now() - ($1 || \' milliseconds\')::interval']; const args = [String(sinceMs)];
      if (userId) { args.push(userId); where.push('discord_id = $' + args.length); }
      if (channelId) { args.push(channelId); where.push('channel_id = $' + args.length); }
      if (symbol) { args.push(symbol); where.push('symbol = $' + args.length); }
      if (target != null) { args.push(target); where.push('target = $' + args.length); }
      return Number((await db.query('SELECT COUNT(*) AS n FROM academy_click_alerts WHERE ' + where.join(' AND '), args)).rows[0].n);
    }
    const cut = Date.now() - sinceMs;
    return mem.filter((r) => r.at > cut && (!userId || r.userId === userId) && (!channelId || r.channelId === channelId) && (!symbol || r.symbol === symbol) && (target == null || r.target === target)).length;
  }
  /* this member's newest alert on a symbol (to know if its target has since been hit) */
  async function last({ userId, symbol, sinceMs }) {
    if (db) {
      const r = await db.query('SELECT side, entry, target, created_at FROM academy_click_alerts WHERE discord_id = $1 AND symbol = $2 AND created_at > now() - ($3 || \' milliseconds\')::interval ORDER BY created_at DESC LIMIT 1', [userId, symbol, String(sinceMs)]);
      const row = r.rows[0]; return row ? { side: row.side, entry: Number(row.entry), target: Number(row.target), at: new Date(row.created_at).getTime() } : null;
    }
    const cut = Date.now() - sinceMs; let hit = null;
    for (const r of mem) if (r.userId === userId && r.symbol === symbol && r.at > cut && (!hit || r.at >= hit.at)) hit = { side: r.side, entry: Number(r.entry), target: Number(r.target), at: r.at };
    return hit;
  }
  /* every plain-stock alert sent since a moment ago (options contracts have a space in their key and are left out) */
  async function recent({ sinceMs }) {
    if (db) {
      const r = await db.query("SELECT channel_id, message_id, symbol, side, entry, target, created_at FROM academy_click_alerts WHERE created_at > now() - ($1 || ' milliseconds')::interval AND position(' ' in symbol) = 0 AND discord_id <> 'auto' ORDER BY created_at DESC LIMIT 500", [String(sinceMs)]);
      return r.rows.map((x) => ({ channelId: String(x.channel_id), messageId: String(x.message_id), symbol: x.symbol, side: x.side, entry: Number(x.entry), target: Number(x.target), at: new Date(x.created_at).getTime() }));
    }
    const cut = Date.now() - sinceMs;
    return mem.filter((x) => x.at > cut && x.userId !== 'auto' && !String(x.symbol).includes(' ')).map((x) => ({ channelId: x.channelId, messageId: x.messageId, symbol: x.symbol, side: x.side, entry: Number(x.entry), target: Number(x.target), at: x.at }));
  }
  return { record, count, last, recent, persistent: !!db };
}

function createClickAlertService({ getBars, chain = null, directory, store = createClickAlertStore(), academyGuildId = '', roleIds = [], passes = null, freeUserIds = null, personas = null, footer = true, now = Date.now, logger = () => {},
  limits = {} } = {}) {
  const roles = new Set((roleIds || []).map(String).filter((id) => SNOWFLAKE.test(id)));
  const lim = { userHour: Number(limits.userHour) || 6, userDay: Number(limits.userDay) || 40, channelHour: Number(limits.channelHour) || 20, ...limits };
  const byRole = !!(SNOWFLAKE.test(String(academyGuildId)) && roles.size), byPass = !!(passes && passes.configured);
  const free = freeUserIds instanceof Set ? freeUserIds : new Set(freeUserIds || []);
  const configured = byRole || byPass || free.size > 0;

  /* Is this member subscribed to the add-on right now? Asked of Discord live (no cache). */
  async function entitlement(userId) {
    if (!configured) return { configured: false, entitled: false };
    if (free.has(String(userId))) return { configured: true, entitled: true, via: 'owner' };
    /* a live Loop Bucks pass is as good as the subscription role */
    if (byPass && await passes.hasActive(userId).catch(() => false)) return { configured: true, entitled: true, via: 'loopbucks' };
    if (!byRole) return { configured: true, entitled: false };
    if (!directory || typeof directory.memberRolesLive !== 'function') return { configured: true, entitled: false, reason: 'directory_unavailable' };
    let held; try { held = await directory.memberRolesLive(String(academyGuildId), String(userId)); } catch (error) { logger('warn', 'click_alert_entitlement_failed', { error: String(error.message || error) }); return { configured: true, entitled: false, reason: 'lookup_failed' }; }
    return { configured: true, entitled: !!(held && held.some((id) => roles.has(id))) };
  }

  async function loadBars(symbol) {
    const sym = String(symbol || '').toUpperCase();
    const get = async (tf) => { try { return cleanBars(await getBars(sym, tf)); } catch (_) { return []; } };
    const [m5, m15, daily, weekly] = await Promise.all([get('5m'), get('15m'), get('1D'), get('1W')]);
    const last = m5.length ? m5[m5.length - 1] : daily.length ? daily[daily.length - 1] : null;
    return { sym, last, set: { m5, m15, daily, weekly, fresh: !!(last && now() - last.t < 4 * 86_400_000) } };
  }
  async function gather(symbol, target) {
    const { sym, last, set } = await loadBars(symbol);
    const analysis = classify({ symbol: sym, target, price: last ? last.c : null, bars: set });
    analysis.__bars = set;
    return analysis;
  }

  /* the two scenarios (base case, and what to watch) drawn on the chart of the alert's own horizon */
  function scenariosFor(analysis, { png = false, options = null } = {}) {
    try {
      const key = { day: 'm15', swing: 'daily', mid: 'weekly', long: 'weekly' }[analysis.horizon] || 'daily';
      const series = (analysis.__bars && analysis.__bars[key] && analysis.__bars[key].length >= 40) ? analysis.__bars[key] : analysis.__bars.daily;
      const scn = buildScenarios({ symbol: analysis.symbol, side: analysis.side, entry: analysis.entry, target: analysis.target, stop: analysis.stop, horizon: series === analysis.__bars.daily && key !== 'daily' ? 'swing' : analysis.horizon, expectedDays: analysis.expectedDays, levels: analysis.levels, series, atr: analysis.atr });
      return scn ? images.renderPair(scn, { horizonLabel: analysis.horizonLabel, contract: options ? contractMeta(options) : null }, { withPng: png }) : [];
    } catch (error) { logger('warn', 'click_alert_scenarios_failed', { error: String(error.message || error) }); return []; }
  }


  /* the contract picked on the chain: priced from the live chain rows and tied to the stock idea */
  async function optionsFor(analysis, contract) {
    if (!contract) return null;
    if (!chain) return { error: { ok: false, status: 503, code: 'options_unavailable', detail: 'The options chain is not available right now.' } };
    let rows = null; try { rows = await chain(analysis.symbol); } catch (_) { rows = null; }
    if (!rows || !rows.length) return { error: { ok: false, status: 503, code: 'options_unavailable', detail: 'The options chain is not available right now.' } };
    try { return { oa: optionsAlert.buildOptionsAlert({ analysis, rows, contract, now: now() }) }; }
    catch (error) {
      if (error instanceof optionsAlert.OptionsAlertError) return { error: { ok: false, status: error.code === 'contract_not_found' ? 404 : 422, code: error.code, detail: error.detail } };
      throw error;
    }
  }
  const contractMeta = (oa) => {
    const c = oa.contract, e = oa.estimates, t = e.atTarget;
    const pc = (n) => (n == null ? 'n/a' : (n >= 0 ? '+' : '-') + Math.abs(n).toFixed(0) + '%');
    const usd = (n) => (n == null ? 'n/a' : '$' + Number(n).toFixed(2));
    return {
      line1: c.name + ' · ' + usd(c.mid) + ' (' + '$' + c.perContract + ' per contract) · ' + c.dte + ' days left',
      line2: 'breakeven ' + usd(e.breakeven) + ' · IV ' + (c.iv == null ? 'n/a' : c.iv + '%') + ' · delta ' + (c.delta == null ? 'n/a' : c.delta) + ' · ' + c.liquidity + ' liquidity',
      bullets: {
        base: ['The contract: about ' + usd(t.base) + ' at the target (' + pc(t.basePct) + ') after ~' + Math.round(t.days.base) + ' days; ' + usd(t.fast) + ' if it is fast, ' + usd(t.slow) + ' if it is slow.'],
        risk: ['The contract: about ' + usd(e.atStop.value) + ' at the stop (' + pc(e.atStop.pct) + '). The most you can lose is the $' + c.perContract + ' paid; time decay costs about ' + usd(c.thetaPerDay) + ' a day.']
      }
    };
  };

  /* Did this member already alert this ticker, and has price since reached that alert's target? Then a higher target is a PT SMASHED update. */
  const SMASH_WINDOW_MS = 21 * 86_400_000;
  async function detectSmashed(userId, analysis, mode, contract) {
    if (contract || mode === 'new') return null;
    const prev = store.last ? await store.last({ userId, symbol: analysis.symbol, sinceMs: SMASH_WINDOW_MS }).catch(() => null) : null;
    const long = analysis.side === 'long';
    if (prev && prev.side === analysis.side && Number.isFinite(prev.target)) {
      const further = long ? analysis.target > prev.target : analysis.target < prev.target;
      const bars = (analysis.__bars && ((analysis.__bars.m5 && analysis.__bars.m5.length ? analysis.__bars.m5 : analysis.__bars.daily) || [])) || [];
      const after = bars.filter((b) => b.t >= prev.at - 300_000);
      const touched = after.some((b) => (long ? b.h >= prev.target : b.l <= prev.target)) || (long ? analysis.entry >= prev.target : analysis.entry <= prev.target);
      if (further && touched) return { prevTarget: prev.target, prevAt: prev.at };
    }
    return mode === 'smashed' ? { prevTarget: prev ? prev.target : null, prevAt: prev ? prev.at : null, forced: true } : null;
  }
  /* a stop with a wide buffer for fast movers: 7% to 10% away from the live price */
  function wideStop(analysis) {
    const e = Number(analysis.entry); if (!(e > 0)) return {};
    const long = analysis.side === 'long', r = (v) => (e >= 1 ? Math.round(v * 100) / 100 : Math.round(v * 10000) / 10000);
    return long ? { stopLow: r(e * 0.90), stopHigh: r(e * 0.93) } : { stopLow: r(e * 1.07), stopHigh: r(e * 1.10) };
  }
  const textFor = (analysis, opt, mention) => (analysis.smashed && !(opt && opt.oa) ? format.formatPtSmashed({ ticker: analysis.symbol, newPt: analysis.target, plus: true, side: analysis.side, mention, ...wideStop(analysis) }) : opt && opt.oa ? format.formatOptionsContractAlert({ ...analysis.alert, mention, contract: opt.oa.contract, estimates: opt.oa.estimates, risk: opt.oa.risk }) : format.formatEntryAlert({ ...analysis.alert, mention }));

  async function preview(userId, { symbol, target, contract = null, mode = 'auto' } = {}) {
    const ent = await entitlement(userId);
    // the horizon read is part of the paid add-on, so an unsubscribed member never receives it
    if (!ent.configured) return { ok: false, status: 503, code: 'click_alert_not_configured', entitlement: ent };
    if (!ent.entitled) return { ok: false, status: 402, code: 'click_alert_subscription_required', entitlement: ent };
    const analysis = await gather(symbol, Number(target));
    if (!analysis.ok) return { ok: false, status: 422, code: analysis.code, detail: analysis.detail || '', entitlement: ent };
    analysis.smashed = await detectSmashed(userId, analysis, mode, contract);
    const opt = await optionsFor(analysis, contract);
    if (opt && opt.error) return { ...opt.error, entitlement: ent };
    const pics = scenariosFor(analysis, { options: opt && opt.oa }).map((im) => ({ which: im.which, name: im.name, alt: im.alt, svg: im.svg }));
    delete analysis.__bars;
    return { ok: true, entitlement: ent, scenarios: { available: pics.length > 0, pngAvailable: images.available(), images: pics }, options: opt ? opt.oa : null, analysis: { ...analysis, alertText: textFor(analysis, opt, false), alertTextWithMention: textFor(analysis, opt, true) } };
  }

  async function overLimit(userId, channelId) {
    const [uh, ud, ch] = await Promise.all([store.count({ userId, sinceMs: 3_600_000 }), store.count({ userId, sinceMs: 86_400_000 }), store.count({ channelId, sinceMs: 3_600_000 })]);
    if (uh >= lim.userHour) return 'You have reached the hourly limit for alerts. Try again later.';
    if (ud >= lim.userDay) return 'You have reached the daily limit for alerts.';
    if (ch >= lim.channelHour) return 'This channel has reached its hourly limit for alerts.';
    return '';
  }

  /* guilds the member shares with an Academy bot, and the channels in one of them where both can post */
  async function destinations(userId, guildId = '') {
    const dir = (personas && personas[String(userId)]) || directory;
    const guilds = dir ? await dir.guildsFor(String(userId), SNOWFLAKE.test(String(guildId)) ? String(guildId) : '') : [];
    return guilds;
  }
  async function channels(userId, guildId) {
    if (!SNOWFLAKE.test(String(guildId))) return null;
    return ((personas && personas[String(userId)]) || directory).sendableChannels(String(guildId), String(userId));
  }

  async function send(user, { symbol, target, contract = null, mode = 'auto', channelId, mention, images: wantImages = true, asMe = true, via = '' } = {}) {
    const userId = String(user.userId || '');
    if (via === 'site') return { ok: false, status: 410, code: 'site_publishing_unavailable', detail: 'StockMarketLoop group publishing is unavailable. Choose a Discord channel instead.' };
    if (!SNOWFLAKE.test(String(channelId))) return { ok: false, status: 400, code: 'invalid_channel' };
    const ent = await entitlement(userId);
    if (!ent.configured) return { ok: false, status: 503, code: 'click_alert_not_configured' };
    if (!ent.entitled) return { ok: false, status: 402, code: 'click_alert_subscription_required' };
    // a member with their own bot (their name and picture) uses it for everything: which servers and channels are listed, the checks, and the post
    const pd = personas && personas[userId];
    const where = await (pd || directory).postingIn(userId, String(channelId)).catch(() => null);
    if (!where) return { ok: false, status: 404, code: 'channel_unavailable', detail: pd ? 'Your Grandmaster-Obi bot is not in that server, or the channel could not be found.' : 'The Academy app is not installed in that server, or the channel could not be found.' };
    if (!where.userCanSend) return { ok: false, status: 403, code: 'you_cannot_post_there', detail: 'You do not have permission to send messages in that channel.' };
    if (!where.botCanSend) return { ok: false, status: 403, code: 'app_cannot_post_there', detail: 'The Academy app cannot send messages in that channel. Ask a server admin to allow it.' };
    const limited = await overLimit(userId, String(channelId)); if (limited) return { ok: false, status: 429, code: 'rate_limited', detail: limited };
    const analysis = await gather(symbol, Number(target));
    if (!analysis.ok) return { ok: false, status: 422, code: analysis.code, detail: analysis.detail || '' };
    analysis.smashed = await detectSmashed(userId, analysis, mode, contract);
    const opt = await optionsFor(analysis, contract);
    if (opt && opt.error) return opt.error;
    const dupKey = opt ? analysis.symbol + ' ' + opt.oa.contract.occ : analysis.symbol;
    if (await store.count({ userId, symbol: dupKey, target: analysis.target, sinceMs: 300_000 })) return { ok: false, status: 409, code: 'duplicate_alert', detail: 'You just sent this exact alert.' };
    /* a PT SMASHED update goes to everyone unless the member said otherwise */
    const wantPing = mention === undefined ? true : !!mention;
    const ping = wantPing && where.mentionEveryone;
    let content = textFor(analysis, opt, ping) + '\n\n' + alertTimeAndPrice(analysis, new Date(now()));
    // posted under the member's own name when asked and possible, so the 'Sent by' line is only for posts made as the app
    // a member can have their own bot (their name and picture): used when that bot is in the server and may post in the channel
    const persona = pd || null, personaWhere = where;
    const viaWebhook = !persona && asMe !== false && !!where.botCanWebhook && typeof directory.postAsMember === 'function';
    if (footer && !viaWebhook && !persona) content += '\n-# Sent by ' + String(user.displayName || 'an Academy member').replace(/[\u0000-\u001f<>@`*_~|]/g, '').slice(0, 40) + ' with Click-to-Alert · Making Easy Money Academy · educational, not financial advice';
    // the two scenario charts ride along when asked for, when the member and the app may attach files there, and when the picture engine is available
    let files = [], skipped = '';
    if (wantImages === false) skipped = 'declined';
    else if (!where.userCanAttach || !(persona ? personaWhere.botCanAttach : where.botCanAttach)) skipped = 'no_permission';
    else {
      files = scenariosFor(analysis, { png: true, options: opt && opt.oa }).filter((im) => im.png).map((im) => ({ name: im.name, bytes: im.png, contentType: 'image/png', alt: im.alt }));
      if (files.length < 2) { files = []; skipped = 'unavailable'; }
    }
    const msgBody = { content, allowed_mentions: { parse: ping ? ['everyone'] : [] } };
    let posted, postedAs = 'app';
    if (persona) {
      try { posted = await persona.post(String(channelId), msgBody, files); postedAs = 'persona'; }
      catch (error) { logger('warn', 'click_alert_persona_failed', { error: String(error.message || error) }); }
    }
    if (!posted && viaWebhook) {
      try { posted = await directory.postAsMember(String(channelId), msgBody, files, { userId, displayName: user.displayName }); postedAs = 'member'; }
      catch (error) { logger('warn', 'click_alert_webhook_failed', { error: String(error.message || error) }); }
    }
    if (!posted) {
      if (footer && (viaWebhook || persona)) msgBody.content += '\n-# Sent by ' + String(user.displayName || 'an Academy member').replace(/[\u0000-\u001f<>@`*_~|]/g, '').slice(0, 40) + ' with Click-to-Alert · Making Easy Money Academy · educational, not financial advice';
      posted = await directory.post(String(channelId), msgBody, files);
    }
    await store.record({ userId, guildId: where.guildId, channelId: String(channelId), messageId: posted.id, symbol: dupKey, side: analysis.side, entry: analysis.entry, target: analysis.target, stop: analysis.stop, horizon: analysis.horizon, confidence: analysis.confidence }).catch((error) => logger('warn', 'click_alert_record_failed', { error: String(error.message || error) }));
    logger('info', 'click_alert_sent', { symbol: analysis.symbol, horizon: analysis.horizon, guildId: where.guildId });
    return { ok: true, postedAs, messageId: posted.id, channelId: posted.channelId, imagesAttached: files.length, imagesSkipped: skipped, mentioned: ping, mentionRequestedButNotAllowed: wantPing && !ping, contract: opt ? { name: opt.oa.contract.name, price: opt.oa.contract.mid } : null, smashed: !!analysis.smashed, analysis: { horizon: analysis.horizon, horizonLabel: analysis.horizonLabel, entry: analysis.entry, target: analysis.target, stop: analysis.stop } };
  }

  /* ---------- the automatic price-target update (academy-auto-pt.js) ---------- */
  async function rangeSince(symbol, atMs) {
    const { set } = await loadBars(symbol);
    return postAlertRange({ at: atMs }, set.m5, set.daily);
  }
  /* what the Academy knows about the stock right now, for the decision: live price, MEM ALGO alignment, the levels in the way up to 40%, how far it moves in a day */
  async function evidenceFor(symbol, side) {
    const { sym, last, set } = await loadBars(symbol);
    const price = last ? last.c : null; if (!(price > 0)) return null;
    const dir = side === 'short' ? -1 : 1;
    const mid = classify({ symbol: sym, target: price * (1 + dir * 0.2), price, bars: set });
    const wide = classify({ symbol: sym, target: price * (1 + dir * 0.4), price, bars: set });
    if (!mid.ok) return null;
    return { price, alignment: mid.alignment, levels: wide.ok ? wide.levels : mid.levels, volPct: (dailyVolatility(set.daily) || 0.03) * 100 };
  }
  /* the same PT SMASHED update as text only, nothing posted: the Academy alerts desk shows it on the alert (new target + the insight behind it) */
  async function composeAutoUpdate({ symbol, target, previousTarget }) {
    const analysis = await gather(symbol, Number(target));
    if (!analysis.ok) throw new Error('analysis_' + analysis.code);
    analysis.smashed = { auto: true, prevTarget: previousTarget || null, forced: true };
    return { text: textFor(analysis, null, true) + '\n\n' + alertTimeAndPrice(analysis, new Date(now())), stop: analysis.stop, horizon: analysis.horizon };
  }
  /* post the update as the Academy app, to the channel the alert was posted in: PT SMASHED layout, @everyone, both scenario charts */
  async function postAutoUpdate({ symbol, channelId, target, previousTarget }) {
    if (!SNOWFLAKE.test(String(channelId))) throw new Error('invalid_channel');
    const analysis = await gather(symbol, Number(target));
    if (!analysis.ok) throw new Error('analysis_' + analysis.code);
    analysis.smashed = { auto: true, prevTarget: previousTarget || null, forced: true };
    let content = textFor(analysis, null, true) + '\n\n' + alertTimeAndPrice(analysis, new Date(now())) + '\n-# Automatic price-target update · Making Easy Money Academy · educational, not financial advice';
    const files = scenariosFor(analysis, { png: true }).filter((im) => im.png).map((im) => ({ name: im.name, bytes: im.png, contentType: 'image/png', alt: im.alt }));
    const body = { content, allowed_mentions: { parse: ['everyone'] } };
    let posted;
    try { posted = await directory.post(String(channelId), body, files.length === 2 ? files : []); }
    catch (error) { if (files.length === 2) posted = await directory.post(String(channelId), body, []); else throw error; }
    await store.record({ userId: 'auto', guildId: '', channelId: String(channelId), messageId: posted.id, symbol: analysis.symbol, side: analysis.side, entry: analysis.entry, target: analysis.target, stop: analysis.stop, horizon: analysis.horizon, confidence: analysis.confidence }).catch(() => {});
    return { messageId: posted.id, images: files.length === 2 };
  }

  return { entitlement, preview, send, destinations, channels, configured, rangeSince, evidenceFor, postAutoUpdate, composeAutoUpdate, store };
}

module.exports = { createClickAlertService, createClickAlertStore, classify, horizonForDays, levelsInTheWay, chooseStop, riskFor, dailyVolatility, HORIZON_TEXT, DISCLAIMER, alertTimeAndPrice };
