'use strict';

/* IGNITION: the first candle of a real move, caught on that candle.
 *
 * A stock that normally trades a few hundred shares a candle and suddenly trades tens of thousands, with real dollars behind it and a
 * move of 3% or more away from the last regular-session close, has ignited. Extended hours count: that is where most of these start.
 * The read says whether the burst is fresh, running, extended or fading, and how far price has already run since the first candle (the
 * chase). It is the early warning behind the late-alert lesson: the AHT alert went out fifteen minutes after its first burst, after
 * a 34% run, and this is the signal that sees it on the first candle.
 *
 *   findIgnition({ bars, fromIdx, dir, medVol, priorClose })  the first candle that qualifies after fromIdx (dir 1 up, -1 down, 0 either)
 *   read(bars, { now })                                       the live read of the latest burst, or null when there is none
 * Pure functions. Educational analysis of what price and volume did, not a prediction and not advice. */

const F = require('./academy-alert-forensics');
const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r1 = (v) => Math.round(v * 10) / 10;
const MIN_DOLLARS = 20_000, MIN_RVOL = 15, MIN_MOVE = 3;

function findIgnition({ bars, fromIdx, dir = 0, medVol, priorClose }) {
  if (!(priorClose > 0)) return null;
  for (let i = Math.max(0, fromIdx); i < bars.length; i++) {
    const b = bars[i], v = num(b.v, 0), dollars = v * num(b.c);
    const signed = (num(b.c) / priorClose - 1) * 100;
    const move = dir === 0 ? Math.abs(signed) : signed * dir;
    if (dollars >= MIN_DOLLARS && v >= MIN_RVOL * medVol && move >= MIN_MOVE) return { idx: i, t: b.t, price: num(b.c), open: num(b.o), volume: Math.round(v), rvol: Math.round(v / medVol), movePct: r1(move), dir: signed >= 0 ? 1 : -1 };
  }
  return null;
}

function read(bars5, { now = Date.now() } = {}) {
  const bars = (Array.isArray(bars5) ? bars5 : []).filter((b) => b && num(b.t) != null && num(b.c) > 0).sort((a, b) => a.t - b.t);
  if (bars.length < 30) return null;
  const last = bars[bars.length - 1];
  if (now - last.t > 3 * 3_600_000) return null; // stale candles say nothing about now
  // the last regular-session close at or before the latest candle, in a session earlier than (or the regular part of) the latest day
  let priorIdx = -1;
  for (let i = bars.length - 1; i >= 0; i--) if (F.sessionAt(bars[i].t) === 'regular' && (bars[i].t < last.t - 300_000 || F.sessionAt(last.t) === 'regular')) { priorIdx = i; break; }
  if (priorIdx < 0) return null;
  // while the regular session is still running, the reference is the previous session's close
  let ref = priorIdx;
  if (F.sessionAt(last.t) === 'regular') { const day = F.etOf(last.t).day; while (ref >= 0 && F.etOf(bars[ref].t).day === day) ref--; if (ref < 0) return null; }
  const priorClose = num(bars[ref].c);
  const normal = []; for (let i = Math.max(0, ref - 400); i <= ref; i++) if (F.sessionAt(bars[i].t) === 'regular') normal.push(bars[i]);
  const medVol = Math.max(1, F.median(normal.map((b) => num(b.v, 0))));
  const ig = findIgnition({ bars, fromIdx: ref + 1, dir: 0, medVol, priorClose });
  if (!ig) return null;
  const dir = ig.dir;
  const since = bars.slice(ig.idx);
  const peak = since.reduce((m, b) => (dir > 0 ? Math.max(m, num(b.h)) : Math.min(m, num(b.l))), ig.price);
  const chase = (last.c / ig.price - 1) * dir * 100;
  const fromClose = (last.c / priorClose - 1) * dir * 100;
  const minutes = Math.max(0, Math.round((last.t + 300_000 - ig.t) / 60_000));
  const tail = since.slice(-3), peakVol = Math.max(...since.map((b) => num(b.v, 0)));
  const tailVol = tail.reduce((a, b) => a + num(b.v, 0), 0) / Math.max(1, tail.length);
  const offPeak = (peak / last.c - 1) * dir * 100;
  let state = 'running';
  if (minutes <= 10 && chase < 8) state = 'fresh';
  else if (tail.length >= 2 && tailVol < peakVol * 0.3 && offPeak > 2) state = 'fading';
  else if (fromClose >= 25 || chase >= 12) state = 'extended';
  const dirName = dir > 0 ? 'up' : 'down';
  const note = state === 'fresh' ? 'Fresh burst ' + dirName + ': volume ' + ig.rvol + 'x normal, ' + ig.movePct + '% from the close, ' + minutes + ' min ago. Earliest point to look at it.'
    : state === 'running' ? 'A burst ' + dirName + ' ' + minutes + ' min ago (volume ' + ig.rvol + 'x normal) is still running: ' + r1(fromClose) + '% from the close, ' + r1(chase) + '% since the first candle.'
    : state === 'extended' ? 'Extended: ' + r1(fromClose) + '% from the close, ' + r1(chase) + '% past the first candle. Chasing here risks paying the top; wait for a pull-back to a level.'
    : 'Fading: volume has dried up to ' + Math.round(tailVol / Math.max(1, peakVol) * 100) + '% of the burst and price is ' + r1(offPeak) + '% off the extreme.';
  return { active: true, state, dir, direction: dir > 0 ? 'long' : 'short', startedAt: ig.t, minutesAgo: minutes, rvol: ig.rvol, movePct: ig.movePct, priceAtIgnition: ig.price, priorClose, fromClosePct: r1(fromClose), chasePct: r1(chase), session: F.sessionAt(last.t), thin: medVol < 500, note };
}

module.exports = { findIgnition, read, MIN_DOLLARS, MIN_RVOL, MIN_MOVE };
