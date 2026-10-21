'use strict';

/* Alert forensics: how an alert was called, measured against the candles that surround it.
 *
 * Given an alert (side, entry, target, stop, the minute it was sent) and the 5-minute candles around it (extended hours included)
 * and the daily candles, this reads:
 *   - the session the alert went out in, and the last regular-session close before it;
 *   - the IGNITION: the first candle where the move started (a volume burst against the stock's own normal, with real dollars behind
 *     it and a move away from the close in the alert's direction), how long after it the alert was sent, and how far price had
 *     already run by then (the chase);
 *   - the run after the alert: the best price, the worst price, how long the target took and whether the stop came first;
 *   - how late the target hit was DETECTED compared with the candle that carried it;
 *   - how big the target and the stop are against the stock's own daily movement.
 * It ends with plain lessons, and a `features` row the learner (academy-target-engine.js) keeps so that every alert that is judged
 * makes the next suggestion better. Pure functions: nothing here fetches or posts. Educational analysis, not advice. */

const BAR_MS = 300_000;
const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const r3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);
const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); if (!s.length) return 0; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function etOf(t) { const o = {}; for (const p of ET.formatToParts(new Date(Number(t)))) o[p.type] = p.value; return { day: o.year + '-' + o.month + '-' + o.day, min: Number(o.hour) * 60 + Number(o.minute) }; }
/* 'pre' 4:00-9:30, 'regular' 9:30-16:00, 'post' 16:00-20:00, otherwise 'closed' (Eastern time) */
function sessionOfMinute(min) { return min >= 570 && min < 960 ? 'regular' : min >= 240 && min < 570 ? 'pre' : min >= 960 && min < 1200 ? 'post' : 'closed'; }
const sessionAt = (t) => sessionOfMinute(etOf(t).min);
const etClock = (t) => { const m = etOf(t).min; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') + ' ET'; };

function atrPct(daily, beforeT, period = 14) {
  const list = (Array.isArray(daily) ? daily : []).filter((b) => b && Number(b.t) < beforeT).slice(-(period + 1));
  if (list.length < 3) return null;
  let sum = 0, n = 0;
  for (let i = 1; i < list.length; i++) {
    const h = num(list[i].h), l = num(list[i].l), pc = num(list[i - 1].c);
    if (h == null || l == null || !(pc > 0)) continue;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)) / pc; n++;
  }
  return n ? sum / n * 100 : null;
}

function analyzeAlert({ symbol = '', side = 'long', entry, target, stop = null, at, bars5 = [], daily = [], detectedAt = null, now = Date.now() } = {}) {
  const e = num(entry), tg = num(target), sp = num(stop), a = num(at);
  const bars = (Array.isArray(bars5) ? bars5 : []).filter((b) => b && num(b.t) != null && num(b.c) > 0).sort((x, y) => x.t - y.t);
  if (!(e > 0) || !(a > 0) || bars.length < 5) return { ok: false, reason: 'not_enough_data', symbol };
  const dir = side === 'short' ? -1 : 1;
  const out = { ok: true, symbol: String(symbol).toUpperCase(), side: dir > 0 ? 'long' : 'short', entry: e, target: tg, stop: sp, at: a, atIso: new Date(a).toISOString(), session: sessionAt(a) };

  /* the last regular-session close before the alert, and what the stock normally trades */
  let priorIdx = -1;
  for (let i = bars.length - 1; i >= 0; i--) { if (bars[i].t < a && sessionAt(bars[i].t) === 'regular') { priorIdx = i; break; } }
  const prior = priorIdx >= 0 ? bars[priorIdx] : null;
  const priorClose = prior ? num(prior.c) : null;
  out.priorClose = priorClose;
  const normal = [];
  for (let i = Math.max(0, priorIdx - 400); i <= priorIdx; i++) if (sessionAt(bars[i].t) === 'regular') normal.push(bars[i]);
  const medVol = Math.max(1, median(normal.map((b) => num(b.v, 0))));
  out.normalBarVolume = Math.round(medVol);
  out.thin = medVol < 500;

  /* the ignition: the first candle with a real volume burst and a move away from the close in the alert's direction */
  let ignition = null;
  if (priorClose > 0) {
    const ig = require('./academy-ignition').findIgnition({ bars, fromIdx: priorIdx + 1, dir, medVol, priorClose });
    if (ig) ignition = { t: ig.t, atIso: new Date(ig.t).toISOString(), price: ig.price, open: ig.open, volume: ig.volume, rvol: ig.rvol, movePct: r2(ig.movePct), afterAlert: ig.t >= a };
  }
  out.ignition = ignition;

  const run = priorClose > 0 ? (e / priorClose - 1) * dir * 100 : null;
  out.runBeforeAlertPct = r2(run);
  if (ignition) {
    out.latencyMin = r2((a - ignition.t) / 60_000);
    out.slipVsIgnitionPct = r2((e / ignition.price - 1) * dir * 100);
  }

  /* the run after the alert (candles that started after the one containing the alert) */
  const alertBarStart = Math.floor(a / BAR_MS) * BAR_MS;
  const after = bars.filter((b) => b.t > alertBarStart);
  if (after.length) {
    let best = e, worst = e, bestT = a, worstT = a, hitBar = null, stopBar = null;
    for (const b of after) {
      const fav = dir > 0 ? num(b.h) : num(b.l), adv = dir > 0 ? num(b.l) : num(b.h);
      if (fav != null && (fav - best) * dir > 0) { best = fav; bestT = b.t; }
      if (adv != null && (adv - worst) * dir < 0) { worst = adv; worstT = b.t; }
      if (!hitBar && tg > 0 && fav != null && (fav - tg) * dir >= 0) hitBar = b;
      if (!stopBar && sp > 0 && adv != null && (adv - sp) * dir <= 0) stopBar = b;
    }
    out.peakPrice = best; out.peakAt = new Date(bestT).toISOString();
    out.peakPct = r2((best / e - 1) * dir * 100); out.minutesToPeak = r2((bestT - a) / 60_000);
    out.drawdownPct = r2((worst / e - 1) * dir * 100);
    out.lastPrice = num(after[after.length - 1].c); out.lastPct = r2((out.lastPrice / e - 1) * dir * 100);
    if (hitBar) {
      const sameBar = stopBar && stopBar.t === hitBar.t;
      out.targetHit = { barStart: new Date(hitBar.t).toISOString(), minutesAfterAlert: r2((hitBar.t + BAR_MS - a) / 60_000), stopFirst: !!(stopBar && (stopBar.t < hitBar.t || sameBar)) };
      if (num(detectedAt) > 0) out.detectionLagMin = r2((detectedAt - (hitBar.t + BAR_MS)) / 60_000);
      if (tg > 0 && best !== e) out.leftOnTablePct = r2((best / tg - 1) * dir * 100);
    } else out.targetHit = null;
    out.stopHit = stopBar ? { barStart: new Date(stopBar.t).toISOString(), beforeTarget: !hitBar || stopBar.t <= hitBar.t } : null;
  }

  /* the target and the stop against the stock's own daily movement */
  const atr = atrPct(daily, a);
  out.dailyAtrPct = r2(atr);
  if (tg > 0) { out.targetDistPct = r2((tg / e - 1) * dir * 100); if (atr > 0) out.targetInAtr = r2(out.targetDistPct / atr); }
  if (sp > 0) { out.stopDistPct = r2((e / sp - 1) * dir * 100); if (atr > 0) out.stopInAtr = r2(out.stopDistPct / atr); if (out.targetDistPct > 0 && out.stopDistPct > 0) out.rr = r2(out.targetDistPct / out.stopDistPct); }

  /* the lessons, in the order they matter */
  const lessons = [];
  const add = (code, text) => lessons.push({ code, text });
  if (ignition && !ignition.afterAlert && out.latencyMin >= 8) add('late_alert', 'The move started at ' + etClock(ignition.t) + ' (volume ' + ignition.rvol + 'x normal, ' + ignition.movePct + '% from the close) and the alert went out ' + Math.round(out.latencyMin) + ' minutes later, after price had already run ' + out.runBeforeAlertPct + '%. The entry was a chase: the engine should flag the burst on its first candle.');
  else if (ignition && !ignition.afterAlert) add('fast_alert', 'The alert came ' + Math.round(out.latencyMin) + ' minutes after the first volume burst, close to the start of the move.');
  else if (ignition && ignition.afterAlert) add('early_alert', 'The alert went out BEFORE the volume burst: the entry was early, so the run after it is clean upside.');
  if (!ignition && out.runBeforeAlertPct != null && out.runBeforeAlertPct >= 8) add('moved_without_burst', 'Price was already ' + out.runBeforeAlertPct + '% from the close with no clean volume burst on record: check for a news gap.');
  if (out.session === 'post' || out.session === 'pre') add('extended_hours', 'Sent in the ' + (out.session === 'post' ? 'after-hours' : 'pre-market') + ' session: spreads are wide, volume is thin and only extended-hours candles count. Targets are best measured in the stock\'s own range, not a fixed percent.' + (out.thin ? ' This stock normally trades only ~' + out.normalBarVolume + ' shares per 5 minutes, so one burst changes everything.' : ''));
  if (out.targetHit) {
    if (out.targetHit.stopFirst) add('stop_first', 'The stop traded in the same candle or before the target: the alert would be scored STOPPED.');
    else add('target_hit', 'The first target traded ' + Math.round(out.targetHit.minutesAfterAlert) + ' minutes after the alert.');
    if (out.detectionLagMin != null && out.detectionLagMin > 8) add('slow_detection', 'The hit was recorded ' + Math.round(out.detectionLagMin) + ' minutes after the candle that carried it. The watcher runs every 5 minutes, so a gap this long means its range read is late: reading the live trade feed for the range makes the follow-up land on time.');
    if (out.leftOnTablePct != null && out.leftOnTablePct >= 8) add('target_too_close', 'Price ran ' + out.leftOnTablePct + '% beyond the first target: a volume-burst move on a stock this size can carry a farther first target.');
  } else if (out.peakPct != null) {
    if (out.peakPct < Math.max(2, (out.targetDistPct || 0) * 0.4)) add('went_nowhere', 'Best move after the alert was only ' + out.peakPct + '% against a target of ' + out.targetDistPct + '%.');
    else add('target_missed_so_far', 'Peak so far ' + out.peakPct + '% of a ' + out.targetDistPct + '% target.');
  }
  if (out.targetInAtr != null) {
    if (out.targetInAtr > 3) add('target_far', 'The target is ' + out.targetInAtr + ' daily ranges away: far beyond a normal day for this stock.');
    else if (out.targetInAtr < 0.4) add('target_tight', 'The target is only ' + out.targetInAtr + ' of a daily range: very tight for this stock.');
  }
  out.lessons = lessons;
  out.features = {
    session: out.session, thin: out.thin, latencyMin: out.latencyMin == null ? null : out.latencyMin,
    runBeforePct: out.runBeforeAlertPct, rvol: ignition ? ignition.rvol : null, atrPct: out.dailyAtrPct,
    targetInAtr: out.targetInAtr == null ? null : out.targetInAtr, stopInAtr: out.stopInAtr == null ? null : out.stopInAtr,
    peakInAtr: out.peakPct != null && atr > 0 ? r2(out.peakPct / atr) : null, hit: !!out.targetHit && !out.targetHit.stopFirst, stopFirst: !!(out.targetHit && out.targetHit.stopFirst) || !!(out.stopHit && out.stopHit.beforeTarget && !out.targetHit)
  };
  return out;
}

module.exports = { analyzeAlert, atrPct, etOf, sessionAt, sessionOfMinute, median, BAR_MS };
