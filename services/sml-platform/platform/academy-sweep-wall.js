'use strict';

/*
 * Sweep versus wall: what happens when aggressive volume runs into resting size.
 *
 * A sweep is an order routed through several price levels or venues at once: an intermarket sweep on the Massive tape (SIP condition 14,
 * or a burst of same-direction prints across exchanges inside 50 ms), or, when a symbol is not on that stream, a burst of same-direction
 * moomoo prints inside 400 ms that crosses two or more ticks. A wall is a resting level the Level 2 reader already tracks (2.5x the
 * median level, 200+ shares, seen on three snapshots or more).
 *
 * When a buy sweep reaches an ask wall (or a sell sweep a bid wall) the tracker opens a case and watches the next ninety seconds:
 *   breakout_confirmed  the wall was eaten (a quarter or less of its size left) and price held beyond it on three snapshots in a row:
 *                       the level is gone and the aggressor won. Side = the sweep's direction.
 *   sweep_absorbed      the wall refilled to 60% or more of its size and price was pushed back through: the resting order took the
 *                       whole sweep and is still there. Side = against the sweep (a rejection).
 *   false_break         the wall was eaten and price held, then fell back below it within the window. Side = against the sweep, weaker.
 *   faded               nothing decisive inside ninety seconds: dropped, no event.
 * Every resolved case is an event the order-flow store records with its five-minute outcome, so the signal is measured, not assumed.
 *
 * Pure and stateful per symbol: push() takes one book snapshot plus the sweeps and prints since the last push; no fetching, no drawing.
 */

const DEFAULTS = {
  windowMs: 90_000,        // how long a case stays open
  holdSnapshots: 3,        // snapshots price must hold beyond the wall for a confirmed breakout
  eatenShare: 0.25,        // the wall counts as eaten at or under this share of its peak size
  refilledShare: 0.6,      // and as refilled at or over this share
  minAgeMs: 4_000,         // an absorption needs a few seconds (one snapshot can be the sweep itself in flight)
  cooldownMs: 60_000,      // one event per wall and direction per minute
  printBurstMs: 400, printMinTicks: 2, printMinCount: 3, // the moomoo-print sweep proxy
  maxEvents: 30, maxPending: 12
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fin = Number.isFinite;

/** Sweeps inferred from individual prints: consecutive same-direction prints inside `printBurstMs` of each other that cross `printMinTicks` or more. */
function detectPrintSweeps(prints, { tick = 0.01, printBurstMs = DEFAULTS.printBurstMs, printMinTicks = DEFAULTS.printMinTicks, printMinCount = DEFAULTS.printMinCount } = {}) {
  const rows = (prints || []).filter((p) => p && fin(p.t) && p.price > 0 && p.size > 0 && (p.dir === 'B' || p.dir === 'S')).sort((a, b) => a.t - b.t);
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length >= printMinCount) {
      const lo = Math.min(...run.map((p) => p.price)), hi = Math.max(...run.map((p) => p.price));
      if ((hi - lo) / tick >= printMinTicks - 1e-9) out.push({ id: 'p:' + run[0].t + ':' + run[run.length - 1].t + ':' + run[0].dir, t: run[run.length - 1].t, dir: run[0].dir, lo, hi, size: run.reduce((s, p) => s + p.size, 0), legs: run.length, source: 'prints' });
    }
    run = [];
  };
  for (const p of rows) {
    if (run.length && (p.dir !== run[0].dir || p.t - run[run.length - 1].t > printBurstMs)) flush();
    run.push(p);
  }
  flush();
  return out;
}

/** Massive sweeps as the tracker reads them (newest-first lists are fine). */
function normalizeTapeSweeps(sweeps) {
  return (sweeps || []).filter((s) => s && fin(s.t) && s.price > 0 && (s.dir === 'B' || s.dir === 'S')).map((s) => ({ id: 'm:' + s.t + ':' + s.price + ':' + s.dir, t: s.t, dir: s.dir, lo: s.price, hi: s.price, size: Number(s.size) || 0, legs: Number(s.legs) || 1, exchanges: Number(s.exchanges) || 0, isw: Boolean(s.isw), source: 'tape' }));
}

function createSweepWallTracker(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const seen = new Set();
  const pending = [];
  const events = [];
  const lastEventAt = new Map(); // "dir:price" -> t
  let tick = cfg.tick || 0.01;

  const levelAt = (side, price) => { for (const l of side) if (Math.abs(l.price - price) <= tick / 2 + 1e-9) return l.size; return 0; };

  function openCase(sw, walls, t) {
    const wantSide = sw.dir === 'B' ? 'ask' : 'bid';
    const hit = (walls || []).filter((w) => w && w.side === wantSide && (w.seen || 0) >= 3 && w.first < sw.t && w.price >= sw.lo - tick - 1e-9 && w.price <= sw.hi + tick + 1e-9 && (w.max || 0) > 0)
      .sort((a, b) => b.max - a.max)[0];
    if (!hit) return null;
    const key = sw.dir + ':' + hit.price.toFixed(4);
    if (pending.some((c) => c.key === key)) return null;
    if (t - (lastEventAt.get(key) || 0) < cfg.cooldownMs) return null;
    const c = { key, t0: t, sweep: sw, wall: { side: hit.side, price: hit.price, max: hit.max, avgOrder: hit.avgOrder || null }, held: 0, everHeld: false, minAfter: Infinity, resolved: null };
    pending.push(c);
    while (pending.length > cfg.maxPending) pending.shift();
    return c;
  }

  function resolve(c, outcome, t, extra) {
    const buy = c.sweep.dir === 'B';
    const side = outcome === 'breakout_confirmed' ? (buy ? 'bull' : 'bear') : (buy ? 'bear' : 'bull');
    const ratio = c.wall.max > 0 ? c.sweep.size / c.wall.max : 0;
    const strength = clamp(outcome === 'breakout_confirmed' ? 0.4 + 0.6 * Math.min(1, ratio) : outcome === 'sweep_absorbed' ? 0.4 + 0.6 * Math.min(1, 1 / Math.max(0.5, ratio)) : 0.35, 0.2, 1);
    const sz = Math.round(c.sweep.size).toLocaleString(), wz = Math.round(c.wall.max).toLocaleString(), px = c.wall.price.toFixed(2);
    const note = outcome === 'breakout_confirmed' ? (buy ? 'Buy sweep of ' + sz + ' ate the ' + wz + ' ask wall at ' + px + ' and price held above it' : 'Sell sweep of ' + sz + ' ate the ' + wz + ' bid wall at ' + px + ' and price held below it')
      : outcome === 'sweep_absorbed' ? (buy ? 'Buy sweep of ' + sz + ' was absorbed by the ' + wz + ' ask wall at ' + px + ': it refilled and price was pushed back' : 'Sell sweep of ' + sz + ' was absorbed by the ' + wz + ' bid wall at ' + px + ': it refilled and price was pushed back')
        : (buy ? 'Buy sweep of ' + sz + ' broke the ' + wz + ' ask wall at ' + px + ' but price fell back under it' : 'Sell sweep of ' + sz + ' broke the ' + wz + ' bid wall at ' + px + ' but price came back over it');
    const ev = { t, kind: 'sweep', outcome, side, price: c.wall.price, strength: Math.round(strength * 100) / 100, note, sweep: { t: c.sweep.t, dir: c.sweep.dir, size: Math.round(c.sweep.size), legs: c.sweep.legs, source: c.sweep.source, lo: c.sweep.lo, hi: c.sweep.hi }, wall: { ...c.wall }, tookMs: t - c.t0, ...(extra || {}) };
    events.push(ev); while (events.length > cfg.maxEvents) events.shift();
    lastEventAt.set(c.key, t);
    c.resolved = ev;
    return ev;
  }

  /**
   * One step. { t, bids, asks (best first, { price, size }), walls (the Level 2 reader's tracked walls), sweeps (Massive, optional),
   * prints (moomoo prints since the last push, optional), tick }. Returns { emitted: [events resolved this step], opened: n }.
   */
  function push({ t, bids = [], asks = [], walls = [], sweeps = null, prints = null, tick: tk } = {}) {
    if (!fin(t)) return { emitted: [], opened: 0 };
    if (tk > 0) tick = tk;
    const emitted = [];
    let opened = 0;
    const candidates = [...normalizeTapeSweeps(sweeps), ...detectPrintSweeps(prints, { tick, ...cfg })].filter((s) => !seen.has(s.id) && t - s.t <= cfg.windowMs);
    for (const sw of candidates) { seen.add(sw.id); if (openCase(sw, walls, t)) opened += 1; }
    if (seen.size > 2000) { const keep = [...seen].slice(-1000); seen.clear(); for (const k of keep) seen.add(k); }
    const bid1 = bids.length ? bids[0].price : NaN, ask1 = asks.length ? asks[0].price : NaN;
    for (const c of pending) {
      if (c.resolved) continue;
      const buy = c.sweep.dir === 'B', age = t - c.t0;
      const sizeNow = levelAt(buy ? asks : bids, c.wall.price);
      const eaten = sizeNow <= cfg.eatenShare * c.wall.max, refilled = sizeNow >= cfg.refilledShare * c.wall.max;
      const held = buy ? bid1 >= c.wall.price - 1e-9 : ask1 <= c.wall.price + 1e-9;           // price sits at or beyond the wall
      const back = buy ? ask1 < c.wall.price - tick + 1e-9 : bid1 > c.wall.price + tick - 1e-9; // price is fully back on the near side
      if (fin(bid1) && fin(ask1)) { c.held = held ? c.held + 1 : 0; if (held) c.everHeld = true; }
      let outcome = null;
      if (eaten && c.held >= cfg.holdSnapshots) outcome = 'breakout_confirmed';
      else if (refilled && back && age >= cfg.minAgeMs) outcome = 'sweep_absorbed';
      else if (eaten && c.everHeld && back && age >= cfg.minAgeMs) outcome = 'false_break';
      else if (age > cfg.windowMs) { if (eaten && !back) outcome = 'breakout_confirmed'; else c.resolved = { outcome: 'faded' }; }
      if (outcome) emitted.push(resolve(c, outcome, t, { sizeNow: Math.round(sizeNow) }));
    }
    for (let i = pending.length - 1; i >= 0; i--) if (pending[i].resolved) pending.splice(i, 1);
    return { emitted, opened };
  }

  /** What a panel shows: open cases, the latest events (newest first) and a one-line read of the last ten minutes. */
  function state(now = Date.now()) {
    const recent = events.filter((e) => now - e.t <= 10 * 60_000);
    const last = recent[recent.length - 1] || null;
    let read = null;
    if (last) {
      const bull = recent.filter((e) => e.side === 'bull').length, bear = recent.filter((e) => e.side === 'bear').length;
      read = { bias: last.side, lastOutcome: last.outcome, bullEvents: bull, bearEvents: bear, text: last.note + (recent.length > 1 ? ' (' + recent.length + ' sweep-vs-wall events in the last ten minutes: ' + bull + ' bullish, ' + bear + ' bearish)' : '') };
    }
    return {
      pending: pending.map((c) => ({ since: c.t0, dir: c.sweep.dir, sweepSize: Math.round(c.sweep.size), wall: c.wall.price, wallSize: Math.round(c.wall.max), held: c.held, source: c.sweep.source })),
      events: events.slice(-12).reverse(), read
    };
  }

  return { push, state, events: () => events.slice(), pending: () => pending.slice(), cfg };
}

module.exports = { createSweepWallTracker, detectPrintSweeps, normalizeTapeSweeps, DEFAULTS };
