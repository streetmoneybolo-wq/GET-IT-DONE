'use strict';

/* SESSION RECAP: one trading day of an index or a stock written the way a desk writes it at the bell. A morning session, an afternoon
 * session and an "into tomorrow" paragraph, each sentence tied to a lettered point on the chart (A, B, C ... in time order) and to the
 * day's reference levels: VWAP and its 1st and 2nd bands, the Initial Balance, the pre-market or overnight range, the dealer gamma
 * walls and the flip. Everything comes from the intraday bars (academy-session-levels.js reads them), the gamma service and the
 * catalyst calendar; the prose is deterministic, nothing is predicted, and the picture is academy-session-recap-chart.js.
 *
 *   compose({ symbol, bars, now, gamma, events })   pure: the recap for the day of `now` from intraday bars (any interval, oldest first)
 *   createSessionRecap({ barsFor, gamma, calendar, png, post, store, ... })
 *       .build({ symbol, t, withPng })  the recap plus its SVG (and PNG when asked)
 *       .tick()                        once per trading day after the close: build the default symbol and post it to the recap channel */

const SL = require('./academy-session-levels');
const chart = require('./academy-session-recap-chart');

const fin = Number.isFinite;
const RTH_OPEN = 570, MIDDAY = 780, RTH_CLOSE = 960;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PRIORITY = { open: 10, close: 10, dayHigh: 9, dayLow: 9, ibBreak: 8, callWall: 7, putWall: 7, mornHigh: 6, mornLow: 6, aftHigh: 6, aftLow: 6, band2: 5, vwapCross: 3 };
const px = (p) => !fin(p) ? '-' : Math.abs(p) >= 1000 ? p.toFixed(0) : p.toFixed(2);
const pts = (d) => { const a = Math.abs(d); return (a >= 1000 ? a.toFixed(0) : a >= 10 ? a.toFixed(1) : a.toFixed(2)) + (a === 1 ? ' point' : ' points'); };
const hhmm = (t) => { const m = SL.et(t).min; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const pick = (list, seed) => list[Math.abs(Math.round(seed)) % list.length];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const DATE_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', day: 'numeric', month: 'long', year: 'numeric' });

function clean(bars) {
  return (bars || []).map((b) => ({ t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v || 0 }))
    .filter((b) => fin(b.t) && fin(b.o) && fin(b.h) && fin(b.l) && fin(b.c) && b.h >= b.l).sort((a, b) => a.t - b.t);
}

/* Where a price sits against the day's levels at bar i, as a phrase: the nearest reference within a small tolerance wins, else VWAP. */
function whereAt(ctx, i, price) {
  const tol = Math.max(price * 0.0006, (ctx.vwap[i] && ctx.vwap[i].sd ? ctx.vwap[i].sd * 0.35 : 0)), refs = [];
  const vw = ctx.vwap[i];
  if (vw) { refs.push(['VWAP', vw.vwap]); refs.push(['the 1st upper band', vw.up[0]], ['the 1st lower band', vw.dn[0]], ['the 2nd upper band', vw.up[1]], ['the 2nd lower band', vw.dn[1]]); }
  if (ctx.ib && ctx.ib.complete && ctx.bars[i].t > ctx.ib.endT) { refs.push(['the IB high', ctx.ib.hi], ['the IB low', ctx.ib.lo]); }
  if (ctx.g) { if (fin(ctx.g.callWall)) refs.push(['the call wall at ' + px(ctx.g.callWall), ctx.g.callWall]); if (fin(ctx.g.putWall)) refs.push(['the put wall at ' + px(ctx.g.putWall), ctx.g.putWall]); if (fin(ctx.g.flip)) refs.push(['the gamma flip at ' + px(ctx.g.flip), ctx.g.flip]); }
  if (ctx.pre) refs.push(['the pre-market high', ctx.pre.hi], ['the pre-market low', ctx.pre.lo]);
  if (fin(ctx.prevClose)) refs.push(["yesterday's close", ctx.prevClose]);
  let best = null;
  for (const [name, level] of refs) { if (!fin(level)) continue; const d = Math.abs(price - level); if (d <= tol && (!best || d < best.d)) best = { name, d }; }
  if (best) return 'right at ' + best.name;
  if (!vw) return '';
  const d = price - vw.vwap;
  if (vw.up[1] != null && price > vw.up[1]) return 'above the 2nd upper band';
  if (vw.up[0] != null && price > vw.up[0]) return 'between the 1st and 2nd upper bands';
  if (vw.dn[1] != null && price < vw.dn[1]) return 'below the 2nd lower band';
  if (vw.dn[0] != null && price < vw.dn[0]) return 'between the 1st and 2nd lower bands';
  return pts(d) + ' ' + (d >= 0 ? 'above' : 'below') + ' VWAP';
}

/* The recap for the trading day that `now` falls in (or the last day in the bars), from intraday bars oldest first. */
function compose({ symbol = 'SPY', bars: source, now = Date.now(), gamma = null, events = [], dayLabel = null } = {}) {
  const all = clean(source).filter((b) => b.t <= now);
  if (all.length < 10) return { ok: false, error: 'bars_unavailable' };
  const day = SL.et(all[all.length - 1].t).day;
  const dayIdx = []; for (let i = 0; i < all.length; i++) if (SL.et(all[i].t).day === day) dayIdx.push(i);
  const first = dayIdx[0];
  const rth = dayIdx.filter((i) => { const m = SL.et(all[i].t).min; return m >= RTH_OPEN && m < RTH_CLOSE; });
  if (rth.length < 3) return { ok: false, error: 'no_session_yet', day };
  const g = gamma && gamma.available !== false ? { callWall: gamma.callWall && gamma.callWall.strike != null ? Number(gamma.callWall.strike) : Number(gamma.callWall), putWall: gamma.putWall && gamma.putWall.strike != null ? Number(gamma.putWall.strike) : Number(gamma.putWall), flip: Number(gamma.flipStrike != null ? gamma.flipStrike : gamma.flip), regime: gamma.regime } : null;
  const a = SL.analyze(all, { anchor: 'day', gamma: g ? { callWall: g.callWall, putWall: g.putWall, flip: g.flip, regime: g.regime } : null });
  if (!a) return { ok: false, error: 'bars_unavailable' };
  const ib = a.ib.days.find((d) => d.day === day) || null;
  const sessions = a.sessions.filter((s) => s.day === day), asia = sessions.find((s) => s.key === 'asia') || null, pre = sessions.find((s) => s.key === 'london') || null;
  /* yesterday's close: the last regular-session bar of the previous day in the feed */
  let prevClose = null;
  for (let i = first - 1; i >= 0; i--) { const m = SL.et(all[i].t).min; if (m < RTH_CLOSE) { prevClose = all[i].c; break; } }
  const ctx = { bars: all, vwap: a.vwap, ib, g, pre, prevClose };
  const openI = rth[0], open = all[openI].o, lastI = rth[rth.length - 1], last = all[lastI], closed = SL.et(last.t).min >= RTH_CLOSE - a.interval || SL.et(now).min >= RTH_CLOSE || SL.et(now).day !== day;
  const morning = rth.filter((i) => SL.et(all[i].t).min < MIDDAY), afternoon = rth.filter((i) => SL.et(all[i].t).min >= MIDDAY);
  const extreme = (idx, hiSide) => { let best = null; for (const i of idx) { const v = hiSide ? all[i].h : all[i].l; if (best == null || (hiSide ? v > all[best].h : v < all[best].l)) best = i; } return best; };
  const dayHi = extreme(rth, true), dayLo = extreme(rth, false), mHi = extreme(morning, true), mLo = extreme(morning, false), aHi = afternoon.length ? extreme(afternoon, true) : null, aLo = afternoon.length ? extreme(afternoon, false) : null;

  /* the candidate events, one per bar at most; the higher priority keeps the bar */
  const ev = new Map();
  const add = (i, kind, price, side) => { if (i == null || i < 0) return; const cur = ev.get(i); if (!cur || PRIORITY[kind] > PRIORITY[cur.kind]) ev.set(i, { i, kind, price, side }); };
  add(openI, 'open', open, open >= (prevClose == null ? open : prevClose) ? 'high' : 'low');
  add(mHi, mHi === dayHi ? 'dayHigh' : 'mornHigh', all[mHi].h, 'high'); add(mLo, mLo === dayLo ? 'dayLow' : 'mornLow', all[mLo].l, 'low');
  if (aHi != null) add(aHi, aHi === dayHi ? 'dayHigh' : 'aftHigh', all[aHi].h, 'high');
  if (aLo != null) add(aLo, aLo === dayLo ? 'dayLow' : 'aftLow', all[aLo].l, 'low');
  if (ib && ib.complete) { const bi = ib.breakUp != null && (ib.breakDown == null || ib.breakUp < ib.breakDown) ? ib.breakUp : ib.breakDown; if (bi != null && bi <= lastI) add(bi, 'ibBreak', all[bi].c, bi === ib.breakUp ? 'high' : 'low'); }
  if (g) {
    if (fin(g.callWall)) { const i = rth.find((k) => all[k].h >= g.callWall); if (i != null) add(i, 'callWall', g.callWall, 'high'); }
    if (fin(g.putWall)) { const i = rth.find((k) => all[k].l <= g.putWall); if (i != null) add(i, 'putWall', g.putWall, 'low'); }
  }
  { const iUp = rth.find((k) => a.vwap[k] && all[k].c > a.vwap[k].up[1]), iDn = rth.find((k) => a.vwap[k] && all[k].c < a.vwap[k].dn[1]); if (iUp != null) add(iUp, 'band2', all[iUp].c, 'high'); if (iDn != null) add(iDn, 'band2', all[iDn].c, 'low'); }
  if (closed) add(lastI, 'close', last.c, last.c >= open ? 'high' : 'low');
  let list = [...ev.values()].sort((p, q) => p.i - q.i);
  while (list.length > 12) { let drop = 0; for (let k = 1; k < list.length; k++) if (PRIORITY[list[k].kind] < PRIORITY[list[drop].kind]) drop = k; list.splice(drop, 1); }
  list.forEach((e, k) => { e.letter = LETTERS[k]; e.t = all[e.i].t; e.phase = SL.et(e.t).min < MIDDAY ? 'morning' : 'afternoon'; e.where = whereAt(ctx, e.i, e.price); });

  /* the sentences */
  const L = (e) => '(' + e.letter + ')';
  const held = (i, level, callSide) => { for (let k = i + 1; k <= Math.min(lastI, i + 3); k++) if (callSide ? all[k].c > level : all[k].c < level) return false; return true; };
  const sentence = (e) => {
    const s = e.i;
    switch (e.kind) {
      case 'open': {
        const gap = prevClose != null ? open - prevClose : null, vw = a.vwap[s];
        return 'We opened at ' + px(open) + (gap != null ? ', ' + pts(gap) + ' ' + (gap >= 0 ? 'above' : 'below') + " yesterday's close" : '') + (vw ? ' and ' + pts(open - vw.vwap) + ' ' + (open >= vw.vwap ? 'above' : 'below') + ' VWAP' : '') + ' ' + L(e) + '.';
      }
      case 'dayHigh': case 'mornHigh': case 'aftHigh': {
        const what = e.kind === 'dayHigh' ? 'the day high' : e.kind === 'mornHigh' ? 'the morning high' : 'the afternoon high';
        return cap(pick(['buyers pushed us to', 'a squeeze carried us to', 'we grinded up to', 'buyers ran us into'], s)) + ' ' + what + ' at ' + px(e.price) + ' ' + L(e) + ' at ' + hhmm(e.t) + (e.where ? ', ' + e.where : '') + ', and ' + pick(['sellers slammed the door', 'sellers stepped in', 'it was rejected on the spot', 'the bid dried up'], s + 1) + '.';
      }
      case 'dayLow': case 'mornLow': case 'aftLow': {
        const what = e.kind === 'dayLow' ? 'the day low' : e.kind === 'mornLow' ? 'the morning low' : 'the afternoon low';
        return cap(pick(['sellers dragged us to', 'the flush ran to', 'we bled down to', 'sellers pressed us into'], s)) + ' ' + what + ' at ' + px(e.price) + ' ' + L(e) + ' at ' + hhmm(e.t) + (e.where ? ', ' + e.where : '') + ', where ' + pick(['buyers finally stepped in', 'the selling was absorbed', 'shorts covered', 'buyers defended it'], s + 1) + '.';
      }
      case 'ibBreak': return 'We ' + (e.side === 'high' ? 'broke out of the Initial Balance high at ' + px(ib.hi) : 'lost the Initial Balance low at ' + px(ib.lo)) + ' ' + L(e) + ' at ' + hhmm(e.t) + ', and ' + (e.side === 'high' ? 'the IB high turned to support' : 'the IB low turned to resistance') + '.';
      case 'callWall': return 'The call wall at ' + px(g.callWall) + ' ' + L(e) + ' ' + (held(s, g.callWall, true) ? 'capped us; dealers held the line' : 'gave way and the move extended') + '.';
      case 'putWall': return 'We hit the put wall at ' + px(g.putWall) + ' ' + L(e) + ' at ' + hhmm(e.t) + ', ' + (held(s, g.putWall, false) ? 'and dealers held the line' : 'and once it gave way negative gamma did the rest') + '.';
      case 'band2': return (e.side === 'high' ? 'Momentum carried us above the 2nd upper band' : 'The flush took us below the 2nd lower band') + ' ' + L(e) + ' at ' + hhmm(e.t) + ', a stretched move.';
      case 'close': { const vw = a.vwap[s]; return 'We closed at ' + px(last.c) + ' ' + L(e) + (vw ? ', ' + pts(last.c - vw.vwap) + ' ' + (last.c >= vw.vwap ? 'above' : 'below') + ' VWAP at ' + px(vw.vwap) : '') + (e.where && e.where.startsWith('right at') ? ', ' + e.where : '') + '.'; }
      default: return '';
    }
  };
  const overnight = [];
  if (asia) overnight.push('Asia ranged ' + px(asia.lo) + ' to ' + px(asia.hi) + ' (' + pts(asia.range) + ')');
  if (pre) overnight.push((asia ? 'London' : 'The pre-market') + ' ranged ' + px(pre.lo) + ' to ' + px(pre.hi) + ' (' + pts(pre.range) + ')');
  const regimeLine = g && g.regime ? (g.regime === 'negative' ? 'Dealer gamma was negative' : 'Dealer gamma was positive') + (fin(g.callWall) ? ' with the call wall at ' + px(g.callWall) : '') + (fin(g.putWall) ? ' and the put wall at ' + px(g.putWall) : '') + (fin(g.flip) ? ', the flip at ' + px(g.flip) : '') + '.' : '';
  const ibLine = ib && ib.complete ? 'The Initial Balance set up ' + px(ib.lo) + ' to ' + px(ib.hi) + ', ' + pts(ib.range) + ' wide.' : '';
  const middayI = morning[morning.length - 1], midday = all[middayI], mv = a.vwap[middayI];
  const midLine = afternoon.length ? 'Into 13:00 we were at ' + px(midday.c) + (mv ? ', ' + pts(midday.c - mv.vwap) + ' ' + (midday.c >= mv.vwap ? 'above' : 'below') + ' VWAP' : '') + ', ' + (midday.c >= open ? 'buyers' : 'sellers') + "' market so far." : '';
  const morningEv = list.filter((e) => e.phase === 'morning');
  const morningText = [overnight.length ? overnight.join(', and ') + '.' : '', regimeLine, morningEv.filter((e) => e.kind === 'open').map(sentence).join(' '), ibLine, morningEv.filter((e) => e.kind !== 'open').map(sentence).join(' '), midLine].filter(Boolean).join(' ');
  const rangeLine = 'A ' + pts(all[dayHi].h - all[dayLo].l).replace(' point', '-point') + ' day from ' + px(all[dayLo].l) + ' to ' + px(all[dayHi].h) + '.';
  const afternoonText = afternoon.length ? [list.filter((e) => e.phase === 'afternoon').map(sentence).join(' '), closed ? rangeLine + ' ' + (last.c >= open ? 'Buyers' : 'Sellers') + ' had the day.' : 'Still trading.'].filter(Boolean).join(' ') : 'The afternoon session has not started.';

  /* into tomorrow: where we close against everything, the regime, the levels each way, the calendar */
  const lv = a.vwap[lastI], above = [], below = [];
  const level = (name, p) => { if (!fin(p)) return; if (p > last.c) above.push([name, p]); else if (p < last.c) below.push([name, p]); };
  if (lv) { level('VWAP', lv.vwap); level('the 1st upper band', lv.up[0]); level('the 2nd upper band', lv.up[1]); level('the 1st lower band', lv.dn[0]); level('the 2nd lower band', lv.dn[1]); }
  if (ib && ib.complete) { level('the IB high', ib.hi); level('the IB low', ib.lo); }
  if (g) { level('the call wall', g.callWall); level('the put wall', g.putWall); level('the gamma flip', g.flip); }
  level('the day high', all[dayHi].h); level('the day low', all[dayLo].l);
  above.sort((p, q) => p[1] - q[1]); below.sort((p, q) => q[1] - p[1]);
  const lvl = (arr) => arr.slice(0, 3).map(([n, p]) => n + ' at ' + px(p)).join(', then ');
  const reg = a.gamma ? a.gamma.regime[lastI] : null;
  const tomorrowText = [
    'We close at ' + px(last.c) + (lv ? ', ' + pts(last.c - lv.vwap) + ' ' + (last.c >= lv.vwap ? 'above' : 'under') + ' VWAP at ' + px(lv.vwap) : '') + (() => { const w = whereAt(ctx, lastI, last.c); return w && !/ VWAP$/.test(w) ? ', ' + w : ''; })() + '.',
    reg ? (reg === 'negative' ? 'The regime is negative gamma, so moves stay fast.' : reg === 'positive' ? 'The regime is positive gamma, so moves drift and dips get bought.' : 'We sit at the gamma flip; the regime can turn either way.') : '',
    above.length ? 'Above, ' + lvl(above) + '.' : '', below.length ? 'Below, ' + lvl(below) + '.' : '',
    events && events.length ? 'Tomorrow brings ' + events.slice(0, 5).map((e) => e.label).join(', ') + '.' : 'Nothing scheduled on the calendar for tomorrow.'
  ].filter(Boolean).join(' ');

  const dayBars = dayIdx.filter((i) => SL.et(all[i].t).min >= 8 * 60 && SL.et(all[i].t).min < RTH_CLOSE), off = dayBars.length ? dayBars[0] : first;
  const markers = list.map((e) => ({ letter: e.letter, i: e.i - off, price: e.price, side: e.side, phase: e.phase, kind: e.kind, t: e.t })).filter((m) => m.i >= 0 && m.i < dayBars.length);
  const label = dayLabel || DATE_FMT.format(new Date(last.t));
  return {
    ok: true, symbol, day, label, closed, asOf: last.t, interval: a.interval,
    open, close: last.c, high: all[dayHi].h, low: all[dayLo].l, prevClose, vwap: lv ? lv.vwap : null,
    ib: ib ? { hi: ib.hi, lo: ib.lo, complete: ib.complete, startT: ib.startT, endT: ib.endT } : null,
    overnight: { asia: asia ? { hi: asia.hi, lo: asia.lo } : null, pre: pre ? { hi: pre.hi, lo: pre.lo } : null },
    gamma: g, regime: reg, events: list.map((e) => ({ letter: e.letter, kind: e.kind, t: e.t, time: hhmm(e.t), price: e.price, where: e.where })),
    sections: { morning: morningText, afternoon: afternoonText, tomorrow: tomorrowText },
    chartInput: { bars: dayBars.map((i) => all[i]), vwap: dayBars.map((i) => a.vwap[i]), regime: a.gamma ? dayBars.map((i) => a.gamma.regime[i]) : null, ib: ib && ib.complete ? { hi: ib.hi, lo: ib.lo, startT: ib.startT, endT: ib.endT } : null, levels: a.gamma ? a.gamma.levels : [], markers, prevClose }
  };
}

function svgFor(r, opts = {}) {
  if (!r || !r.ok) return null;
  const ci = r.chartInput;
  return chart.intradaySvg({ ...ci, symbol: r.symbol, title: r.symbol + ' · ' + r.label + ' · session recap', subtitle: 'Open ' + px(r.open) + ' · High ' + px(r.high) + ' · Low ' + px(r.low) + ' · ' + (r.closed ? 'Close ' : 'Last ') + px(r.close) + (r.vwap != null ? ' · VWAP ' + px(r.vwap) : '') + (r.gamma && r.gamma.regime ? ' · ' + r.gamma.regime + ' gamma' : ''), width: opts.width, height: opts.height });
}

/* tomorrow's scheduled catalysts: the next trading day after `now`, from academy-market-calendar.upcoming() */
function nextTradingDayEvents(upcoming, dayInfo, now) {
  const day = new Date(now); let k = 0, key = null;
  while (k < 10) { day.setUTCDate(day.getUTCDate() + 1); k++; const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate(); const info = dayInfo ? dayInfo(y, m, d) : { tradingDay: ![0, 6].includes(day.getUTCDay()) }; if (info.tradingDay) { key = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); break; } }
  return key ? (upcoming || []).filter((e) => e.date === key) : [];
}

function createSessionRecap({ barsFor, gamma = null, calendar = null, calendarExtra = null, dayInfo = null, png = null, post = null, store = null, channelId = '', symbol = 'SPY', tf = '5m', postAt = RTH_CLOSE + 5, now = Date.now, logger = () => {} } = {}) {
  const cache = new Map();
  let state = null;
  async function load() { if (!state) { try { state = (store && await store.read()) || null; } catch (_) { state = null; } if (!state || typeof state !== 'object') state = { posted: {} }; if (!state.posted) state.posted = {}; } return state; }
  async function save() { if (store) { try { await store.write(state); } catch (error) { logger('warn', 'session_recap_state_save_failed', { error: String(error && error.message || error) }); } } }

  async function build({ symbol: sym = symbol, t = now(), withPng = false } = {}) {
    const key = String(sym || '').toUpperCase() + ':' + Math.floor(t / 60000);
    const hit = cache.get(key); if (hit) return withPng && !hit.png && png && hit.svg ? { ...hit, png: png(hit.svg) } : hit;
    const bars = await barsFor(sym, tf).catch(() => []);
    let g = null; try { g = gamma ? await gamma(sym) : null; } catch (_) { g = null; }
    let events = [];
    try { const up = calendar ? calendar({ now: t, days: 6, extra: calendarExtra }) : []; events = nextTradingDayEvents(up, dayInfo, t); } catch (_) { events = []; }
    const r = compose({ symbol: sym, bars, now: t, gamma: g, events });
    if (!r.ok) return r;
    const pic = svgFor(r); r.svg = pic && pic.ok ? pic.svg : '';
    if (withPng && png && r.svg) r.png = png(r.svg);
    cache.set(key, r); if (cache.size > 40) cache.delete(cache.keys().next().value);
    return r;
  }

  /* once per trading day, in the hour after postAt: the recap of `symbol` to the recap channel, picture first then the three sections */
  async function tick(t = now()) {
    if (!post || !/^\d{5,25}$/.test(String(channelId))) return { ok: false, error: 'no_channel' };
    const e = SL.et(t); if (e.min < postAt || e.min > postAt + 60) return { ok: false, error: 'outside_window' };
    if (dayInfo) { const [y, m, d] = e.day.split('-').map(Number); if (!dayInfo(y, m, d).tradingDay) return { ok: false, error: 'not_trading_day' }; }
    await load(); if (state.posted[e.day]) return { ok: false, error: 'already_posted' };
    const r = await build({ symbol, t, withPng: true });
    if (!r.ok) return r;
    if (!r.closed) return { ok: false, error: 'not_closed' };
    const files = r.png ? [{ name: symbol.toLowerCase() + '-session-recap-' + r.day + '.png', bytes: r.png, contentType: 'image/png', alt: symbol + ' session recap chart for ' + r.label }] : [];
    const clip = (s) => (s.length > 1000 ? s.slice(0, 997) + '...' : s);
    const body = { content: '**' + symbol + ' session recap · ' + r.label + '**', allowed_mentions: { parse: [] }, embeds: [{ title: symbol + ' · ' + r.label, color: r.regime === 'negative' ? 0xff5470 : r.regime === 'positive' ? 0x4dc3ff : 0xc879ff, fields: [{ name: 'Morning session', value: clip(r.sections.morning) }, { name: 'Afternoon session', value: clip(r.sections.afternoon) }, { name: 'Into tomorrow', value: clip(r.sections.tomorrow) }], footer: { text: 'What price did against the day\'s levels. Educational, not advice. Making Easy Money Academy' }, ...(files.length ? { image: { url: 'attachment://' + files[0].name } } : {}) }] };
    try { const posted = await post(channelId, body, files); state.posted[e.day] = t; for (const k of Object.keys(state.posted)) if (k < e.day.slice(0, 8) + '00') delete state.posted[k]; await save(); return { ok: true, posted, day: e.day }; }
    catch (error) { logger('warn', 'session_recap_post_failed', { error: String(error && error.message || error) }); return { ok: false, error: 'post_failed' }; }
  }

  return { build, tick, compose, svgFor };
}

module.exports = { compose, svgFor, createSessionRecap, nextTradingDayEvents, whereAt };
