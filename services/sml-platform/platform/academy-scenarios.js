'use strict';

/* The scenario engine for Click-to-Alert.
 *
 * For one alert (entry, target, stop, side, horizon) it builds TWO schematic price paths from the Academy's own data, both drawn on the chart the alert is about:
 *   1. BASE CASE: how price could travel from the entry to the target: a pullback into the nearest zone that would defend the move, tests of the levels in the way,
 *      then the target, spread over the time the horizon engine expects.
 *   2. RISK CASE: what to watch if it goes wrong: how the setup fails (a close through the stop), the triggers that would warn of it first, and the next level price
 *      would be heading for.
 * The levels, zones and triggers come from the smart-money map (structure, order blocks, fair value gaps, equal highs / lows, swing points, VWAP). The path between
 * them is a schematic: straight legs with a small counter-move, so the picture shows the idea and not a forecast. Nothing here predicts anything. Pure functions. */

const SM = require('./academy-smart-money');

const fin = Number.isFinite;
const round2 = (v) => Math.round(v * 100) / 100;
const px = (v) => (v >= 1 ? v.toFixed(2) : v.toFixed(4));
const SERIES = { day: { key: 'm15', perDay: 26, tf: '15m' }, swing: { key: 'daily', perDay: 1, tf: '1D' }, mid: { key: 'weekly', perDay: 0.2, tf: '1W' }, long: { key: 'weekly', perDay: 0.2, tf: '1W' } };
const WINDOW = 70;

/* A leg between two waypoints with one small counter-move in the middle, so the path reads as price action. Deterministic. */
function leg(a, b, dir, atr, wobble = 0.3) {
  const n = Math.max(1, b.i - a.i);
  if (n < 4) return [b];
  const mid = a.i + Math.round(n * 0.5), span = b.p - a.p;
  const back = Math.min(Math.abs(span) * wobble, 1.2 * atr) * (span >= 0 ? -1 : 1) * (dir === 0 ? 0 : 1);
  return [{ i: a.i + Math.round(n * 0.35), p: a.p + span * 0.45 }, { i: mid, p: a.p + span * 0.45 + back }, b];
}

function buildScenarios({ symbol, side, entry, target, stop, horizon, expectedDays, levels = [], series, atr: atrIn = 0 }) {
  const cfg = SERIES[horizon] || SERIES.swing;
  const bars = (series || []).filter((b) => [b.o, b.h, b.l, b.c].every(fin));
  if (bars.length < 40) return null;
  const a = SM.analyze(bars); if (!a) return null;
  const s = side === 'short' ? -1 : 1;
  const atr = a.atr > 0 ? a.atr : (atrIn > 0 ? atrIn : entry * 0.01);
  const N = bars.length;
  const future = Math.max(8, Math.min(40, Math.round((expectedDays && expectedDays.mid ? expectedDays.mid : 5) * cfg.perDay)));
  // a short expected path gets a closer view, so the projected part is wide enough to read
  const start = Math.max(0, N - Math.max(36, Math.min(WINDOW, Math.round(future * 3.5))));
  const i0 = N - 1, iEnd = i0 + future;
  const view = bars.slice(start);

  /* zones drawn on both charts: the active blocks and open gaps near the move */
  const lo = Math.min(entry, target, stop) - 2 * atr, hi = Math.max(entry, target, stop) + 2 * atr;
  const zones = [];
  for (const o of a.structure.orderBlocks) if (o.invalidAt == null && o.i >= start - 20 && o.top >= lo && o.bottom <= hi) zones.push({ kind: o.dir > 0 ? 'DEMAND' : 'SUPPLY', dir: o.dir, top: o.top, bottom: o.bottom, from: Math.max(start, o.i) });
  for (const g of a.fvg) if (g.filledAt == null && g.i >= start && g.top >= lo && g.bottom <= hi) zones.push({ kind: 'FVG', dir: g.dir, top: g.top, bottom: g.bottom, from: g.i - 1 });
  const pools = a.liquidity.filter((l) => l.takenAt == null && l.level >= lo && l.level <= hi).map((l) => ({ kind: l.kind, price: l.level, count: l.count }));

  /* ---- base case ---- */
  const supportSide = (price, tol) => s * (entry - price) > tol && s * (price - stop) > 0;
  const supports = [];
  for (const z of zones) if (z.dir === s) { const edge = s > 0 ? z.top : z.bottom; if (supportSide(edge, 0.3 * atr)) supports.push({ price: edge, label: (z.kind === 'FVG' ? (s > 0 ? 'bullish' : 'bearish') + ' gap' : z.kind.toLowerCase() + ' block') }); }
  for (const p of (s > 0 ? a.pivots.lows : a.pivots.highs).slice(-6)) if (supportSide(p.price, 0.3 * atr)) supports.push({ price: p.price, label: s > 0 ? 'swing low' : 'swing high' });
  supports.sort((x, y) => s * (y.price - x.price)); // nearest to the entry first
  const pull = supports.find((x) => s * (entry - x.price) <= Math.abs(entry - stop) * 0.85) || null;
  const ahead = levels.filter((l) => s * (l.price - entry) > 0.2 * atr && s * (target - l.price) > 0.2 * atr).sort((x, y) => s * (x.price - y.price)).slice(0, 2);

  const way = [{ i: i0, p: entry, label: 'ENTRY ' + px(entry) }];
  const slots = (pull ? 1 : 0) + ahead.length + 1;
  let k = 0; const at = () => i0 + Math.round(future * (++k / slots));
  if (pull) way.push({ i: at(), p: pull.price, label: 'Pullback into ' + pull.label + ' ' + px(pull.price), tag: 'support' });
  for (const l of ahead) way.push({ i: at(), p: l.price, label: 'Tests ' + px(l.price) + ' (' + l.text.replace(/ \(.*$/, '') + ')', tag: 'level' });
  way.push({ i: iEnd, p: target, label: 'TARGET ' + px(target), tag: 'target' });
  const basePath = [way[0]];
  for (let q = 1; q < way.length; q++) { for (const pt of leg(way[q - 1], way[q], s, atr)) basePath.push(pt); }

  const baseWhy = [];
  const last = a.structure.events.slice(-1)[0];
  if (last) baseWhy.push((last.type === 'CHoCH' ? 'Change of character ' : 'Break of structure ') + (last.dir > 0 ? 'up' : 'down') + ' at ' + px(last.level) + (last.dir === s ? ' agrees with the move.' : ' is against the move, so it needs to be reclaimed.'));
  if (pull) baseWhy.push('A pullback into the ' + pull.label + ' at ' + px(pull.price) + ' is where the move is most likely to be defended.');
  if (ahead.length) baseWhy.push('Levels in the way: ' + ahead.map((l) => px(l.price) + ' (' + l.text.replace(/ \(.*$/, '') + ')').join(', ') + '.');
  const pool = pools.find((p) => (s > 0 ? p.kind === 'EQH' : p.kind === 'EQL') && s * (p.price - entry) > 0 && s * (p.price - target) <= 0.5 * atr);
  if (pool) baseWhy.push('Stops rest beyond ' + px(pool.price) + ' (equal ' + (s > 0 ? 'highs' : 'lows') + '): price is often drawn to them.');
  const vw = a.vwap && a.vwap[N - 1];
  if (vw && cfg.key === 'm15') baseWhy.push('Price is ' + (bars[N - 1].c >= vw.vwap ? 'above' : 'below') + ' VWAP ' + px(vw.vwap) + (s * (bars[N - 1].c - vw.vwap) >= 0 ? ', which supports the move.' : ', which works against it until reclaimed.'));
  baseWhy.push('Reaching the target would take about ' + (expectedDays.mid < 1 ? 'under a day' : expectedDays.mid.toFixed(expectedDays.mid < 10 ? 1 : 0) + ' trading days') + ' at this stock\'s normal pace.');

  /* ---- risk case ---- */
  const below = []; // levels beyond the stop, in the losing direction
  for (const p of (s > 0 ? a.pivots.lows : a.pivots.highs).slice(-8)) if (s * (stop - p.price) > 0.3 * atr) below.push({ price: p.price, label: s > 0 ? 'swing low' : 'swing high' });
  for (const z of zones) if (z.dir === s) { const edge = s > 0 ? z.bottom : z.top; if (s * (stop - edge) > 0.3 * atr) below.push({ price: edge, label: z.kind === 'FVG' ? 'gap' : z.kind.toLowerCase() + ' block' }); }
  for (const p of pools) if ((s > 0 ? p.kind === 'EQL' : p.kind === 'EQH') && s * (stop - p.price) > 0.3 * atr) below.push({ price: p.price, label: 'equal ' + (s > 0 ? 'lows' : 'highs') });
  below.sort((x, y) => s * (y.price - x.price));
  const next = below[0] || { price: stop - s * 2 * atr, label: 'two ATR beyond the stop' };
  const failAt = i0 + Math.round(future * 0.35), brkAt = i0 + Math.round(future * 0.65);
  const stall = entry + s * Math.min(Math.abs(target - entry) * 0.3, 1.5 * atr);
  const riskWay = [{ i: i0, p: entry, label: 'ENTRY ' + px(entry) }, { i: failAt, p: stall, label: 'Fails to extend ' + px(stall), tag: 'stall' }, { i: brkAt, p: stop, label: 'STOP ' + px(stop) + ' breaks', tag: 'stop' }, { i: iEnd, p: next.price, label: 'Heads for ' + px(next.price) + ' (' + next.label + ')', tag: 'next' }];
  const riskPath = [riskWay[0]]; for (let q = 1; q < riskWay.length; q++) for (const pt of leg(riskWay[q - 1], riskWay[q], -s, atr, 0.25)) riskPath.push(pt);

  const watch = [];
  watch.push('A close ' + (s > 0 ? 'below ' : 'above ') + px(stop) + ' invalidates the setup. Exit, or reassess.');
  const swing = (s > 0 ? a.pivots.lows : a.pivots.highs).slice(-1)[0];
  if (swing && s * (entry - swing.price) > 0 && s * (swing.price - stop) >= 0) watch.push('A close ' + (s > 0 ? 'below' : 'above') + ' the last swing ' + (s > 0 ? 'low ' : 'high ') + px(swing.price) + ' is a change of character: the first warning.');
  const defend = pull || null;
  if (defend) watch.push('The ' + defend.label + ' at ' + px(defend.price) + ' failing to hold on a pullback means buyers are not defending it.'.replace('buyers', s > 0 ? 'buyers' : 'sellers'));
  if (vw && cfg.key === 'm15') watch.push('Price ' + (s > 0 ? 'losing' : 'reclaiming') + ' VWAP ' + px(vw.vwap) + ' with volume is an early sign of weakness.');
  const sweepSide = pools.find((p) => (s > 0 ? p.kind === 'EQL' : p.kind === 'EQH') && s * (entry - p.price) > 0);
  if (sweepSide) watch.push('Equal ' + (s > 0 ? 'lows' : 'highs') + ' at ' + px(sweepSide.price) + ': a quick push through and back is a stop run, a close beyond is a real break.');
  watch.push('If it breaks, the next level price is heading for is ' + px(next.price) + ' (' + next.label + ').');

  return {
    symbol, side, horizon, tf: cfg.tf, entry, target, stop, atr, window: { start, end: N - 1, future, i0, iEnd, count: view.length }, expectedDays, bars: view, zones, pools,
    base: { title: 'SCENARIO 1 · BASE CASE', subtitle: 'How the move could play out', path: basePath, waypoints: way, bullets: baseWhy.slice(0, 5) },
    risk: { title: 'SCENARIO 2 · WATCH OUT', subtitle: 'What to watch if it goes wrong', path: riskPath, waypoints: riskWay, bullets: watch.slice(0, 5), triggerLevel: stop, nextLevel: next }
  };
}

module.exports = { buildScenarios, SERIES, WINDOW };
