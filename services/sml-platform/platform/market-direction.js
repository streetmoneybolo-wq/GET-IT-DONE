'use strict';

/* Market Direction engine: one read of where the broad market is leaning, for day trading and for swing trading.
 *
 * It stacks independent kinds of evidence instead of several indicators that all say the same thing:
 *   index trend (SPY / QQQ as the ES / NQ stand-ins), market internals built from the whole US market snapshot
 *   (a TICK-style reading, advance/decline, up vs down volume), agreement across timeframes, the live tape and
 *   off-exchange (dark pool) prints on SPY / QQQ, volatility (VIXY as the VIX stand-in), risk appetite (offensive vs
 *   defensive sectors, small caps, equal weight), sector participation, and SPY options positioning.
 * Each piece scores -2..+2 with its reasons; missing data is left out and said so, never guessed.
 * Educational analysis only: no prediction is certain and nothing here places a trade. */

const fin = Number.isFinite;
const round = (v, d = 2) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const SECTORS = ['XLK', 'XLY', 'XLC', 'XLF', 'XLI', 'XLB', 'XLE', 'XLV', 'XLP', 'XLU', 'XLRE'];
const OFFENSE = ['XLK', 'XLY', 'XLC', 'XLF', 'XLI'];
const DEFENSE = ['XLP', 'XLU', 'XLV', 'XLRE'];
const WATCH = ['SPY', 'QQQ', 'IWM', 'DIA', 'RSP', 'VIXY', 'TLT', ...SECTORS];

/* ---------- small math ---------- */
function ema(values, period) {
  const out = []; const k = 2 / (period + 1); let prev = null;
  for (const v of values) { if (!fin(v)) { out.push(prev); continue; } prev = prev === null ? v : v * k + prev * (1 - k); out.push(prev); }
  return out;
}
const last = (a) => (a && a.length ? a[a.length - 1] : null);

/* trend of one bar series: close vs EMA20 and the EMA's slope over `lookback` bars → -1 / 0 / +1 */
function trendOf(bars, lookback = 5) {
  const closes = (bars || []).map((b) => Number(b.c)).filter(fin);
  if (closes.length < 25) return null;
  const e20 = ema(closes, 20);
  const now = last(closes), eNow = last(e20), ePrev = e20[e20.length - 1 - lookback];
  const slope = fin(ePrev) && ePrev ? (eNow - ePrev) / ePrev : 0;
  const dir = now > eNow && slope > 0 ? 1 : now < eNow && slope < 0 ? -1 : 0;
  return { dir, close: now, ema20: round(eNow), slopePct: round(slope * 100, 3) };
}

/* ---------- Eastern time / session ---------- */
function easternParts(ms) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), weekday: p.weekday };
}
function sessionOf(ms) {
  const { minutes, weekday } = easternParts(ms);
  if (weekday === 'Sat' || weekday === 'Sun') return 'closed';
  if (minutes >= 240 && minutes < 570) return 'pre';
  if (minutes >= 570 && minutes < 960) return 'open';
  if (minutes >= 960 && minutes < 1200) return 'after';
  return 'closed';
}

/* ---------- market internals from the whole-market snapshot ---------- */
function internalsFrom(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.prevDay && Number(r.prevDay.c) >= 2 && Number(r.prevDay.v) >= 100_000 && fin(Number(r.todaysChangePerc)));
  let adv = 0, dec = 0, upVol = 0, downVol = 0, tickUp = 0, tickDown = 0, nearHigh = 0, nearLow = 0;
  const unusual = []; // today's volume (pre-market included) vs yesterday's whole day, liquid names only
  const newest = list.reduce((m, r) => Math.max(m, Number(r.min && r.min.t) || 0), 0);
  for (const r of list) {
    const ch = Number(r.todaysChangePerc);
    const vol = Number(r.day && r.day.v) || Number(r.min && r.min.av) || 0;
    if (ch > 0) { adv += 1; upVol += vol; } else if (ch < 0) { dec += 1; downVol += vol; }
    // TICK-style: stocks whose latest one-minute bar closed up vs down (only bars from the last 3 minutes count)
    const m = r.min;
    if (m && newest && newest - Number(m.t) <= 180_000 && fin(Number(m.o)) && fin(Number(m.c))) { if (m.c > m.o) tickUp += 1; else if (m.c < m.o) tickDown += 1; }
    const prevV = Number(r.prevDay.v);
    if (vol >= 100_000 && prevV >= 300_000 && Number(r.prevDay.c) >= 1) unusual.push({ sym: r.ticker, ratio: vol / prevV, vol, chg: round(ch, 2) });
    const d = r.day;
    if (d && Number(d.h) > 0 && Number(d.l) > 0) { const c = Number(r.lastTrade && r.lastTrade.p) || Number(d.c); if (c >= d.h * 0.998) nearHigh += 1; else if (c <= d.l * 1.002) nearLow += 1; }
  }
  const ticks = tickUp + tickDown;
  return {
    universe: list.length, adv, dec, adRatio: dec ? round(adv / dec) : null, pctAdvancing: adv + dec ? round((adv / (adv + dec)) * 100, 1) : null,
    upVol, downVol, upDownVolRatio: downVol ? round(upVol / downVol) : null,
    tick: ticks >= 50 ? { up: tickUp, down: tickDown, net: tickUp - tickDown, ratio: round((tickUp - tickDown) / ticks, 3) } : null,
    nearHigh, nearLow,
    unusualVolume: unusual.sort((a, b) => b.ratio - a.ratio).slice(0, 10).map((u) => ({ sym: u.sym, ratio: round(u.ratio, 2), vol: Math.round(u.vol), chg: u.chg }))
  };
}

/* ---------- options positioning (SPY) ---------- */
function optionsRead(rows, spot, maxDte, todayMs) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  let callVol = 0, putVol = 0; const callOi = new Map(), putOi = new Map();
  for (const r of list) {
    const exp = Date.parse(r.expiry);
    if (fin(exp) && (exp - todayMs) / 86_400_000 > maxDte) continue;
    if (r.call) { callVol += Number(r.call.volume) || 0; if (Number(r.call.oi) > 0) callOi.set(r.strike, (callOi.get(r.strike) || 0) + Number(r.call.oi)); }
    if (r.put) { putVol += Number(r.put.volume) || 0; if (Number(r.put.oi) > 0) putOi.set(r.strike, (putOi.get(r.strike) || 0) + Number(r.put.oi)); }
  }
  const top = (m, above) => [...m.entries()].filter(([k]) => !fin(spot) || (above ? k >= spot : k <= spot)).sort((a, b) => b[1] - a[1])[0];
  const cw = top(callOi, true), pw = top(putOi, false);
  if (!callVol && !putVol && !cw && !pw) return null;
  return { callVol, putVol, pcVolume: callVol ? round(putVol / callVol) : null, callWall: cw ? { strike: cw[0], oi: cw[1] } : null, putWall: pw ? { strike: pw[0], oi: pw[1] } : null };
}

/* ---------- levels ---------- */
function dayLevels(daily, intraday, sessionDate) {
  const out = {};
  const d = (daily || []).filter((b) => fin(Number(b.c)));
  const etDate = (b) => easternParts(Number(b.t) > 1e12 ? Number(b.t) : Number(b.t) * 1000).date;
  const prior = d.filter((b) => etDate(b) < sessionDate);
  const p = last(prior);
  if (p) { out.pdh = round(p.h); out.pdl = round(p.l); out.pdc = round(p.c); }
  const today = (intraday || []).filter((b) => etDate(b) === sessionDate);
  const mins = (b) => easternParts(Number(b.t) > 1e12 ? Number(b.t) : Number(b.t) * 1000).minutes;
  const pre = today.filter((b) => mins(b) < 570), reg = today.filter((b) => mins(b) >= 570 && mins(b) < 960);
  if (pre.length) { out.preHigh = round(Math.max(...pre.map((b) => b.h))); out.preLow = round(Math.min(...pre.map((b) => b.l))); }
  const orb = reg.filter((b) => mins(b) < 585);
  if (orb.length) { out.orHigh = round(Math.max(...orb.map((b) => b.h))); out.orLow = round(Math.min(...orb.map((b) => b.l))); out.open = round(orb[0].o); }
  let pv = 0, v = 0;
  for (const b of reg) { const vol = Number(b.v) || 0; pv += ((b.h + b.l + b.c) / 3) * vol; v += vol; }
  if (v > 0) out.vwap = round(pv / v);
  return out;
}
function swingLevels(daily, weekly) {
  const closes = (daily || []).map((b) => Number(b.c)).filter(fin);
  const out = {};
  if (closes.length >= 20) out.ema20 = round(last(ema(closes, 20)));
  if (closes.length >= 50) out.ema50 = round(last(ema(closes, 50)));
  if (closes.length >= 200) out.ema200 = round(last(ema(closes, 200)));
  const d20 = (daily || []).slice(-20);
  if (d20.length) { out.high20 = round(Math.max(...d20.map((b) => b.h))); out.low20 = round(Math.min(...d20.map((b) => b.l))); }
  const w = (weekly || []).slice(-2, -1)[0];
  if (w) { out.lastWeekHigh = round(w.h); out.lastWeekLow = round(w.l); }
  return out;
}

/* ---------- the score ---------- */
const WEIGHTS = {
  day: { trend: 20, internals: 25, tape: 15, mtf: 15, volatility: 10, appetite: 10, options: 5 },
  swing: { trend: 25, mtf: 20, participation: 20, internals: 10, volatility: 10, appetite: 10, options: 5 }
};
const LABEL = (b) => (b >= 55 ? 'Bullish' : b >= 20 ? 'Lean bullish' : b > -20 ? 'Neutral' : b > -55 ? 'Lean bearish' : 'Bearish');
const step = (v, cuts) => { // cuts: [strongNeg, neg, pos, strongPos] on a value where higher = bullish
  if (!fin(v)) return null;
  if (v >= cuts[3]) return 2; if (v >= cuts[2]) return 1; if (v <= cuts[0]) return -2; if (v <= cuts[1]) return -1; return 0;
};
const pct = (v) => (fin(v) ? (v > 0 ? '+' : '') + round(v, 2) + '%' : '–');

function score(mode, data) {
  const W = WEIGHTS[mode];
  const parts = [];
  const add = (key, label, s, reasons, extra = {}) => parts.push({ key, label, score: s, weight: W[key] || 0, available: s !== null && s !== undefined, reasons: reasons.filter(Boolean), ...extra });
  const q = data.quotes || {};
  const spy = q.SPY || {}, qqq = q.QQQ || {};

  /* 1. index trend (SPY / QQQ for ES / NQ) */
  if (mode === 'day') {
    const lv = data.levels && data.levels.SPY || {};
    const s1 = step(spy.changePct, [-1, -0.25, 0.25, 1]), s2 = step(qqq.changePct, [-1.2, -0.3, 0.3, 1.2]);
    let vw = null;
    if (fin(spy.price) && fin(lv.vwap)) vw = spy.price > lv.vwap * 1.0005 ? 1 : spy.price < lv.vwap * 0.9995 ? -1 : 0;
    const t5 = data.mtf && data.mtf.SPY && data.mtf.SPY['5m'];
    const vals = [s1, s2, vw === null ? null : vw * 2, t5 ? t5.dir * 2 : null].filter((x) => x !== null);
    const s = vals.length ? clamp(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), -2, 2) : null;
    add('trend', 'Index trend (SPY / QQQ for ES / NQ)', s, [
      fin(spy.changePct) ? 'SPY ' + pct(spy.changePct) + ', QQQ ' + pct(qqq.changePct) + (data.session === 'pre' ? ' in pre-market' : '') : '',
      vw === null ? '' : vw > 0 ? 'SPY is above today\'s VWAP $' + lv.vwap : vw < 0 ? 'SPY is below today\'s VWAP $' + lv.vwap : 'SPY is sitting on VWAP $' + lv.vwap,
      t5 ? 'SPY 5-minute trend is ' + (t5.dir > 0 ? 'up' : t5.dir < 0 ? 'down' : 'flat') : ''
    ]);
  } else {
    const tD = data.mtf && data.mtf.SPY && data.mtf.SPY['1D'], tQ = data.mtf && data.mtf.QQQ && data.mtf.QQQ['1D'], tI = data.mtf && data.mtf.IWM && data.mtf.IWM['1D'];
    const lv = data.levels && data.levels.SPY || {};
    const above200 = fin(spy.price) && fin(lv.ema200) ? (spy.price > lv.ema200 ? 1 : -1) : null;
    const vals = [tD && tD.dir, tQ && tQ.dir, tI && tI.dir, above200].filter((x) => x !== null && x !== undefined);
    const s = vals.length ? clamp(Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 2), -2, 2) : null;
    add('trend', 'Index trend (daily)', s, [
      tD ? 'SPY daily trend ' + (tD.dir > 0 ? 'up' : tD.dir < 0 ? 'down' : 'mixed') + ' (20-day average $' + tD.ema20 + ')' : '',
      tQ ? 'QQQ daily trend ' + (tQ.dir > 0 ? 'up' : tQ.dir < 0 ? 'down' : 'mixed') : '',
      tI ? 'Small caps (IWM) ' + (tI.dir > 0 ? 'trending up' : tI.dir < 0 ? 'trending down' : 'mixed') : '',
      above200 === null ? '' : above200 > 0 ? 'SPY is above its 200-day average $' + lv.ema200 : 'SPY is below its 200-day average $' + lv.ema200
    ]);
  }

  /* 2. internals */
  const it = data.internals;
  if (it && it.universe > 500) {
    const sAd = step(it.adRatio, [0.5, 0.77, 1.3, 2]);
    const sUv = step(it.upDownVolRatio, [0.33, 0.66, 1.5, 3]);
    const sTk = mode === 'day' && it.tick && data.session === 'open' ? step(it.tick.ratio, [-0.3, -0.1, 0.1, 0.3]) : null;
    const vals = [sAd, sUv, sTk].filter((x) => x !== null);
    const s = vals.length ? clamp(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), -2, 2) : null;
    add('internals', 'Market internals (' + it.universe.toLocaleString('en-US') + ' stocks)', s, [
      it.adv + ' advancing vs ' + it.dec + ' declining (' + it.pctAdvancing + '% up)',
      fin(it.upDownVolRatio) ? 'Up volume is ' + it.upDownVolRatio + 'x down volume' : '',
      sTk !== null ? 'TICK-style reading ' + (it.tick.net > 0 ? '+' : '') + it.tick.net + ' (stocks ticking up minus down this minute)' : '',
      it.nearHigh + it.nearLow > 20 ? it.nearHigh + ' stocks at their high of day vs ' + it.nearLow + ' at their low' : ''
    ], { detail: it });
  } else add('internals', 'Market internals', null, ['The whole-market snapshot is not available right now.']);

  /* 3. timeframes */
  const tfs = mode === 'day' ? ['5m', '15m', '1h', '4h'] : ['1h', '4h', '1D', '1W'];
  const m = data.mtf && data.mtf.SPY || {};
  const dirs = tfs.map((tf) => m[tf] ? m[tf].dir : null).filter((x) => x !== null);
  if (dirs.length >= 2) {
    const sum = dirs.reduce((a, b) => a + b, 0);
    const s = clamp(Math.round((sum / dirs.length) * 2), -2, 2);
    add('mtf', 'Timeframe agreement (SPY ' + tfs.join(' / ') + ')', s, [
      tfs.map((tf) => tf + ' ' + (m[tf] ? (m[tf].dir > 0 ? '▲' : m[tf].dir < 0 ? '▼' : '•') : '–')).join('  '),
      Math.abs(sum) === dirs.length ? 'All timeframes agree' : sum === 0 ? 'Timeframes disagree: wait for them to line up' : 'Most timeframes agree'
    ], { frames: Object.fromEntries(tfs.map((tf) => [tf, m[tf] ? m[tf].dir : null])) });
  } else add('mtf', 'Timeframe agreement', null, ['Not enough candle history right now.']);

  /* 4. tape + dark pool (day) */
  if (mode === 'day') {
    const tp = data.tape || {};
    const read = (st) => { if (!st) return null; const b = Number(st.buy300) || 0, s = Number(st.sell300) || 0; return b + s > 0 ? (b - s) / (b + s) : null; };
    const r1 = read(tp.SPY), r2 = read(tp.QQQ);
    const off = ['SPY', 'QQQ'].map((k) => tp[k]).filter(Boolean).reduce((a, st) => ({ b: a.b + (Number(st.offBuy) || 0), s: a.s + (Number(st.offSell) || 0) }), { b: 0, s: 0 });
    const offR = off.b + off.s > 0 ? (off.b - off.s) / (off.b + off.s) : null;
    const big = ['SPY', 'QQQ'].flatMap((k) => (tp[k] && tp[k].big) || []).slice(0, 20);
    const bigNet = big.reduce((a, p) => a + (p.dir === 'B' ? 1 : p.dir === 'S' ? -1 : 0), 0);
    const vals = [r1, r2, offR].filter((x) => x !== null).map((x) => step(x, [-0.25, -0.08, 0.08, 0.25]));
    const s = vals.length ? clamp(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), -2, 2) : null;
    add('tape', 'Tape & dark pool (SPY / QQQ)', s, [
      r1 !== null ? 'SPY last 5 minutes: ' + (r1 > 0 ? 'buyers lifting the offer' : r1 < 0 ? 'sellers hitting the bid' : 'balanced') + ' (' + Math.round(r1 * 100) + '% net)' : '',
      r2 !== null ? 'QQQ last 5 minutes: ' + (r2 > 0 ? 'buyers in control' : r2 < 0 ? 'sellers in control' : 'balanced') : '',
      offR !== null ? 'Off-exchange (dark pool) prints lean ' + (offR > 0.05 ? 'buy' : offR < -0.05 ? 'sell' : 'neutral') : '',
      big.length ? 'Largest prints: ' + big.filter((p) => p.dir === 'B').length + ' at the offer, ' + big.filter((p) => p.dir === 'S').length + ' at the bid' + (bigNet > 2 ? ' (big buyers active)' : bigNet < -2 ? ' (big sellers active)' : '') : ''
    ]);
  }

  /* 5. volatility: the SML VIX (CBOE method on SPY options) when it is live, VIXY otherwise */
  const vix = q.VIXY || {};
  const sv = data.vol && data.vol.ok && fin(data.vol.level) ? data.vol : null;
  if (sv) {
    const lvlScore = sv.level < 15 ? 1 : sv.level <= 20 ? 0 : sv.level <= 25 ? -1 : -2;
    const ch = sv.change;
    const chScore = ch && fin(ch.pct) ? (ch.pct > 6 ? -2 : ch.pct > 2 ? -1 : ch.pct < -6 ? 2 : ch.pct < -2 ? 1 : 0) : null;
    const vixyTrend = mode === 'swing' && data.mtf && data.mtf.VIXY && data.mtf.VIXY['1D'] ? -data.mtf.VIXY['1D'].dir : null;
    const vals = [lvlScore, chScore, vixyTrend].filter((x) => x !== null);
    add('volatility', 'Volatility (SML VIX: 30-day, from SPY options)', clamp(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), -2, 2), [
      'SML VIX ' + sv.level + (sv.level < 15 ? ': calm market' : sv.level <= 20 ? ': normal' : sv.level <= 25 ? ': elevated fear' : ': high fear') + (sv.stale ? ' (last reading)' : ''),
      ch ? (mode === 'day' ? 'Since the open ' : 'Since earlier ') + (ch.change > 0 ? '+' : '') + ch.change + ' (' + (ch.pct > 0 ? '+' : '') + ch.pct + '%)' + (ch.pct > 2 ? ': fear rising' : ch.pct < -2 ? ': fear easing' : '') : '',
      vixyTrend !== null ? 'VIXY daily trend is ' + (vixyTrend < 0 ? 'rising' : vixyTrend > 0 ? 'falling' : 'flat') : (fin(vix.changePct) ? 'VIXY ' + pct(vix.changePct) + ' today' : '')
    ], { vol: { level: sv.level, change: ch || null } });
  } else if (mode === 'day' && fin(vix.changePct)) {
    add('volatility', 'Volatility (VIXY for VIX)', step(-vix.changePct, [-4, -1.5, 1.5, 4]), ['VIXY ' + pct(vix.changePct) + ' today: ' + (vix.changePct > 1.5 ? 'fear rising, a headwind for longs' : vix.changePct < -1.5 ? 'fear easing, a tailwind for longs' : 'calm')]);
  } else if (mode === 'swing' && data.mtf && data.mtf.VIXY && data.mtf.VIXY['1D']) {
    const v = data.mtf.VIXY['1D'];
    add('volatility', 'Volatility trend (VIXY for VIX)', v.dir === 0 ? 0 : -v.dir * 2, ['VIXY daily trend is ' + (v.dir > 0 ? 'rising: fear building' : v.dir < 0 ? 'falling: fear fading' : 'flat')]);
  } else add('volatility', 'Volatility', null, ['VIXY is not available right now.']);

  /* 6. risk appetite */
  const avg = (list) => { const v = list.map((s) => q[s] && q[s].changePct).filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const off6 = avg(OFFENSE), def6 = avg(DEFENSE);
  const spread = fin(off6) && fin(def6) ? off6 - def6 : null;
  const small = fin(q.IWM && q.IWM.changePct) && fin(spy.changePct) ? q.IWM.changePct - spy.changePct : null;
  const eq = fin(q.RSP && q.RSP.changePct) && fin(spy.changePct) ? q.RSP.changePct - spy.changePct : null;
  if (spread !== null) {
    const s = clamp(Math.round([step(spread, [-0.8, -0.25, 0.25, 0.8]), small === null ? null : step(small, [-0.8, -0.3, 0.3, 0.8])].filter((x) => x !== null).reduce((a, b, _, arr) => a + b / arr.length, 0)), -2, 2);
    add('appetite', 'Risk appetite', s, [
      'Offensive sectors ' + pct(off6) + ' vs defensive ' + pct(def6) + (spread > 0.25 ? ': money is leaning into risk' : spread < -0.25 ? ': money is hiding in defensives' : ''),
      small === null ? '' : 'Small caps vs S&P: ' + pct(small),
      eq !== null && fin(spy.changePct) && spy.changePct > 0 && eq < -0.4 ? 'Narrow move: the S&P is up but the average stock (RSP) is lagging, so a few mega-caps are carrying it' : '',
      eq !== null && fin(spy.changePct) && spy.changePct < 0 && eq > 0.4 ? 'The average stock is holding up better than the index' : ''
    ]);
  } else add('appetite', 'Risk appetite', null, ['Sector ETF prices are not available right now.']);

  /* 7. sector participation (swing) */
  if (mode === 'swing') {
    const sec = SECTORS.map((s) => ({ s, t: data.mtf && data.mtf[s] && data.mtf[s]['1D'] })).filter((x) => x.t);
    if (sec.length >= 6) {
      const up = sec.filter((x) => x.t.dir > 0).length, down = sec.filter((x) => x.t.dir < 0).length;
      add('participation', 'Sector participation (11 sector ETFs)', step(up - down, [-5, -2, 2, 5]), [
        up + ' of ' + sec.length + ' sectors trending up, ' + down + ' trending down',
        up ? 'Leading: ' + sec.filter((x) => x.t.dir > 0).map((x) => x.s).join(', ') : '',
        down ? 'Lagging: ' + sec.filter((x) => x.t.dir < 0).map((x) => x.s).join(', ') : ''
      ], { sectors: Object.fromEntries(sec.map((x) => [x.s, x.t.dir])) });
    } else add('participation', 'Sector participation', null, ['Sector history is not available right now.']);
  }

  /* 8. options */
  const op = data.options;
  if (op && fin(op.pcVolume)) {
    add('options', 'SPY options positioning', step(-op.pcVolume, [-1.6, -1.2, -0.7, -0.5]), [
      'Put/call volume ' + op.pcVolume + (op.pcVolume > 1.2 ? ': traders are buying protection' : op.pcVolume < 0.7 ? ': traders are leaning on calls' : ': balanced'),
      op.callWall ? 'Biggest call open interest above price: $' + op.callWall.strike + ' (often acts as a ceiling)' : '',
      op.putWall ? 'Biggest put open interest below price: $' + op.putWall.strike + ' (often acts as a floor)' : ''
    ]);
  } else add('options', 'SPY options positioning', null, ['The SPY options chain is not available right now.']);

  /* combine */
  const live = parts.filter((p) => p.available && p.weight);
  const totalW = live.reduce((a, p) => a + p.weight, 0);
  const bias = totalW ? Math.round(live.reduce((a, p) => a + (p.score / 2) * p.weight, 0) / totalW * 100) : 0;
  const sign = Math.sign(bias);
  const agreeW = live.filter((p) => sign !== 0 && Math.sign(p.score) === sign).reduce((a, p) => a + p.weight, 0);
  const confidence = totalW && sign !== 0 ? Math.round((agreeW / totalW) * 100) : 0;
  const coverage = Math.round((totalW / Object.values(W).reduce((a, b) => a + b, 0)) * 100);
  return { bias, label: LABEL(bias), confidence, coverage, components: parts };
}

/* ---------- checklist + flips ---------- */
function checklist(mode, data, result) {
  const q = data.quotes || {}, spy = q.SPY || {}, lv = data.levels && data.levels.SPY || {}, it = data.internals || {};
  const items = [];
  const add = (status, text) => items.push({ status, text });
  if (mode === 'day') {
    if (fin(spy.changePct)) add(Math.abs(spy.changePct) < 0.25 ? 'warn' : spy.changePct > 0 ? 'up' : 'down', (data.session === 'pre' ? 'Pre-market: ' : 'Today: ') + 'SPY ' + pct(spy.changePct) + ', QQQ ' + pct(q.QQQ && q.QQQ.changePct));
    const sv = data.vol && data.vol.ok && fin(data.vol.level) ? data.vol : null;
    if (sv) add(sv.level > 20 || (sv.change && sv.change.pct > 2) ? 'down' : sv.level < 15 || (sv.change && sv.change.pct < -2) ? 'up' : 'ok', 'SML VIX ' + sv.level + (sv.change ? ' (' + (sv.change.change > 0 ? '+' : '') + sv.change.change + ' since the open)' : ''));
    else if (fin(q.VIXY && q.VIXY.changePct)) add(q.VIXY.changePct > 1.5 ? 'down' : q.VIXY.changePct < -1.5 ? 'up' : 'ok', 'Volatility (VIXY) ' + pct(q.VIXY.changePct));
    if (fin(it.adRatio) && fin(spy.changePct)) { const agree = (spy.changePct > 0) === (it.adRatio > 1); add(agree ? 'ok' : 'warn', agree ? 'Breadth confirms the index (' + it.pctAdvancing + '% of stocks up)' : 'Breadth does NOT confirm the index: be careful with size'); }
    if (fin(spy.price) && fin(lv.vwap)) add(spy.price >= lv.vwap ? 'up' : 'down', 'SPY ' + (spy.price >= lv.vwap ? 'above' : 'below') + ' VWAP $' + lv.vwap);
    const h = data.mtf && data.mtf.SPY || {};
    if (h['1h'] && h['4h']) add(h['1h'].dir === h['4h'].dir && h['1h'].dir !== 0 ? 'ok' : 'warn', h['1h'].dir === h['4h'].dir && h['1h'].dir !== 0 ? 'Higher timeframes (1h + 4h) agree: trade with them' : 'Higher timeframes are mixed: favour quick trades');
    const near = (x) => fin(x) && fin(spy.price) && Math.abs(spy.price - x) / x < 0.0015;
    const at = [['prior day high', lv.pdh], ['prior day low', lv.pdl], ['prior close', lv.pdc], ['pre-market high', lv.preHigh], ['pre-market low', lv.preLow]].filter(([, v]) => near(v));
    if (at.length) add('warn', 'SPY is at a decision level: ' + at.map(([n, v]) => n + ' $' + v).join(', '));
  } else {
    const h = data.mtf && data.mtf.SPY || {};
    if (h['1D']) add(h['1D'].dir > 0 ? 'up' : h['1D'].dir < 0 ? 'down' : 'warn', 'Daily trend: ' + (h['1D'].dir > 0 ? 'up' : h['1D'].dir < 0 ? 'down' : 'mixed'));
    if (h['1W']) add(h['1W'].dir > 0 ? 'up' : h['1W'].dir < 0 ? 'down' : 'warn', 'Weekly trend: ' + (h['1W'].dir > 0 ? 'up' : h['1W'].dir < 0 ? 'down' : 'mixed'));
    if (fin(spy.price) && fin(lv.ema50)) add(spy.price > lv.ema50 ? 'up' : 'down', 'SPY ' + (spy.price > lv.ema50 ? 'above' : 'below') + ' its 50-day average $' + lv.ema50);
    const p = result.components.find((c) => c.key === 'participation');
    if (p && p.available) add(p.score > 0 ? 'ok' : p.score < 0 ? 'down' : 'warn', p.reasons[0]);
    if (fin(lv.high20) && fin(spy.price)) add(spy.price >= lv.high20 * 0.995 ? 'up' : spy.price <= lv.low20 * 1.005 ? 'down' : 'ok', 'SPY 20-day range $' + lv.low20 + ' to $' + lv.high20);
  }
  return items;
}
function flips(mode, data, result) {
  const lv = data.levels && data.levels.SPY || {}, out = [];
  if (mode === 'day') {
    if (result.bias >= 20) { if (fin(lv.vwap)) out.push('Weakens if SPY loses VWAP $' + lv.vwap + ' and breadth turns negative'); if (fin(lv.pdl)) out.push('Turns bearish below the prior day low $' + lv.pdl); }
    else if (result.bias <= -20) { if (fin(lv.vwap)) out.push('Improves if SPY reclaims VWAP $' + lv.vwap + ' with more stocks advancing'); if (fin(lv.pdh)) out.push('Turns bullish above the prior day high $' + lv.pdh); }
    else { if (fin(lv.orHigh)) out.push('A break above the opening range $' + lv.orHigh + ' with breadth leans bullish'); if (fin(lv.orLow)) out.push('A break below the opening range $' + lv.orLow + ' leans bearish'); }
  } else {
    if (fin(lv.ema50)) out.push((result.bias >= 0 ? 'Weakens if SPY closes below' : 'Improves if SPY closes above') + ' its 50-day average $' + lv.ema50);
    if (fin(lv.high20)) out.push('A close above the 20-day high $' + lv.high20 + ' confirms strength');
    if (fin(lv.low20)) out.push('A close below the 20-day low $' + lv.low20 + ' confirms weakness');
  }
  return out;
}

/* ---------- the service: gathers data with its own caches ---------- */
function createMarketDirection({ snapshotAll, snapshotTickers, candles, tape = null, optionsChain = null, normalizeChain = (x) => x, volIndex = null, now = Date.now, logger = () => {} } = {}) {
  const caches = new Map();
  const cached = async (key, ms, fn) => {
    const hit = caches.get(key);
    if (hit && hit.until > now()) return hit.value;
    if (hit && hit.pending) return hit.pending;
    const pending = (async () => fn())().then((value) => { caches.set(key, { value, until: now() + ms }); return value; }, (error) => { logger('warn', 'market_direction_source_failed', { key, error: String(error && error.message || error) }); const old = caches.get(key); caches.set(key, { value: old && old.value !== undefined ? old.value : null, until: now() + Math.min(ms, 30_000) }); return old && old.value !== undefined ? old.value : null; });
    caches.set(key, { ...(hit || {}), pending, until: hit ? hit.until : 0 });
    return pending;
  };
  const trendFor = async (sym, tf, ttl) => cached(`t:${sym}:${tf}`, ttl, async () => { const p = await candles(sym, tf); return trendOf(p && p.bars, tf === '1W' ? 3 : 5); });

  const readInternals = (session) => cached('internals', session === 'open' ? 60_000 : session === 'closed' ? 600_000 : 120_000, async () => { const it = internalsFrom(await snapshotAll()); it.asOf = now(); return it; });
  /* the whole-market unusual volume list on its own (the Academy panel and the dashboard card) */
  async function unusualVolume() {
    const session = sessionOf(now());
    const it = await readInternals(session);
    return { ok: !!it, session, asOf: it && it.asOf ? it.asOf : now(), universe: it ? it.universe : 0, rows: it && it.unusualVolume ? it.unusualVolume : [] };
  }

  async function gather(mode) {
    const t = now(), session = sessionOf(t), open = session === 'open';
    const quotesTtl = open ? 15_000 : 60_000;
    const quotes = await cached('quotes', quotesTtl, async () => {
      const rows = await snapshotTickers(WATCH);
      const out = {};
      for (const r of rows || []) {
        const price = Number(r.lastTrade && r.lastTrade.p) || Number(r.day && r.day.c) || Number(r.min && r.min.c) || null;
        out[r.ticker] = { price, changePct: round(Number(r.todaysChangePerc), 2), prevClose: Number(r.prevDay && r.prevDay.c) || null };
      }
      return out;
    }) || {};
    const internals = await readInternals(session);
    const tfs = mode === 'day' ? ['5m', '15m', '1h', '4h'] : ['1h', '4h', '1D', '1W'];
    const mtf = { SPY: {} };
    await Promise.all(tfs.map(async (tf) => { mtf.SPY[tf] = await trendFor('SPY', tf, tf === '5m' ? 30_000 : tf === '15m' ? 60_000 : 300_000); }));
    const levels = { SPY: {} };
    if (mode === 'day') {
      const [daily, intra] = await Promise.all([cached('c:SPY:1D', 600_000, () => candles('SPY', '1D')), cached('c:SPY:5m', 30_000, () => candles('SPY', '5m'))]);
      levels.SPY = dayLevels(daily && daily.bars, intra && intra.bars, easternParts(t).date);
    } else {
      const extra = ['QQQ', 'IWM', 'VIXY', ...SECTORS];
      await Promise.all(extra.map(async (s) => { mtf[s] = { '1D': await trendFor(s, '1D', 1_800_000) }; }));
      const [daily, weekly] = await Promise.all([cached('c:SPY:1D', 600_000, () => candles('SPY', '1D')), cached('c:SPY:1W', 1_800_000, () => candles('SPY', '1W'))]);
      levels.SPY = swingLevels(daily && daily.bars, weekly && weekly.bars);
    }
    let tapeData = null;
    if (mode === 'day' && tape) { tapeData = {}; for (const s of ['SPY', 'QQQ']) { try { tape.watch(s); const pk = tape.peek(s); tapeData[s] = pk && pk.stats; } catch (_) { /* no tape */ } } }
    let options = null;
    if (optionsChain) {
      const rows = await cached('opt:SPY', 120_000, async () => normalizeChain(await optionsChain('SPY')));
      options = optionsRead(rows, quotes.SPY && quotes.SPY.price, mode === 'day' ? 7 : 45, t);
    }
    let vol = null;
    if (volIndex) {
      try {
        const v = await volIndex.get();
        if (v && v.ok) {
          const d = easternParts(t);
          const sinceMs = mode === 'day' ? t - ((d.minutes - 570) * 60_000) : t - 3 * 86_400_000; // today's 9:30 open / last few days
          vol = { ...v, change: d.minutes >= 570 || mode === 'swing' ? volIndex.changeSince(sinceMs) : null };
        }
      } catch (_) { vol = null; }
    }
    return { session, quotes, internals, mtf, levels, tape: tapeData, options, vol };
  }

  async function get(mode = 'day') {
    const m = mode === 'swing' ? 'swing' : 'day';
    return cached('result:' + m, m === 'day' ? 15_000 : 120_000, async () => {
      const data = await gather(m);
      const result = score(m, data);
      return {
        ok: true, mode: m, asOf: now(), session: data.session, ...result,
        levels: data.levels.SPY, options: data.options ? { pcVolume: data.options.pcVolume, callWall: data.options.callWall, putWall: data.options.putWall } : null,
        vol: data.vol ? { level: data.vol.level, change: data.vol.change || null, terms: data.vol.terms, source: data.vol.source, stale: !!data.vol.stale, asOf: data.vol.asOf } : null,
        checklist: checklist(m, data, result), flips: flips(m, data, result),
        unusualVolume: data.internals && data.internals.unusualVolume ? data.internals.unusualVolume : [],
        proxies: 'SPY / QQQ stand in for ES / NQ futures. ' + (data.vol ? 'SML VIX is computed with the CBOE VIX method from live SPY options.' : 'VIXY stands in for VIX while the SPY options feed is down.') + ' Internals are built from the whole US stock snapshot.',
        disclaimer: 'Educational market read. Not financial advice; no read is certain and nothing here places a trade.'
      };
    });
  }
  return { get, unusualVolume };
}

/* Massive (Polygon-format) snapshot readers */
function massiveSnapshots({ apiKey, fetchImpl = fetch, baseUrl = 'https://api.massive.com' }) {
  const call = async (path) => {
    if (!String(apiKey || '').trim()) throw new Error('massive_key_missing');
    const res = await fetchImpl(baseUrl + path, { headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error('massive_' + res.status);
    return res.json();
  };
  return {
    snapshotAll: async () => (await call('/v2/snapshot/locale/us/markets/stocks/tickers?include_otc=false')).tickers || [],
    snapshotTickers: async (list) => (await call('/v2/snapshot/locale/us/markets/stocks/tickers?tickers=' + encodeURIComponent(list.join(',')))).tickers || []
  };
}

module.exports = { createMarketDirection, massiveSnapshots, internalsFrom, trendOf, optionsRead, dayLevels, swingLevels, score, checklist, flips, sessionOf, easternParts, WATCH, SECTORS };
