'use strict';

/*
 * Order Flow (Level 2) reader for the Academy: pulling & stacking, absorption/icebergs, bid/ask flip.
 *
 * Input is a stream of order-book snapshots (10 price levels a side) plus the recent trade prints. Everything here is a *reading of the book*,
 * not a prediction: it says what buyers and sellers are doing right now, with the numbers behind it. Level 2 has no history, so none of this can be
 * backtested on old candles; the Academy records every event and its 5-minute outcome so the signals can be measured before anyone trusts them.
 *
 *  - Pulling & stacking (momentum): size added at the top of one side while the other side is pulled (size that disappears WITHOUT trading).
 *  - Absorption / icebergs (reversal): heavy aggressive volume hits one side and price does not move, because a resting order (or a refilling
 *    hidden order) keeps absorbing it.
 *  - Bid/ask flip (breakout confirmation): a large resistance wall on the ask is consumed, price holds above it, and it reappears as bids.
 *
 * Spoofing note: single snapshots are easy to fake, so every signal compares a short window against the recent median and needs persistence.
 */

const DEFAULTS = {
  maxSnapshots: 240,        // ~10 min at 2.5 s
  minSnapshots: 12,         // before this the reader reports "warming"
  staleMs: 15000,
  window: 6,                // snapshots used for "now" (~15 s)
  baseline: 40,             // snapshots used for the median
  wallMult: 2.5,            // a wall is a level >= 2.5x the median level on that side
  wallMinSize: 200,
  absorbWindowMs: 30000,
  absorbVolMult: 2,
  absorbTicks: 2,
  flipHold: 3,              // snapshots price must hold beyond the wall
  cooldownMs: 20000         // per event kind + side
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const median = (arr) => { const a = arr.filter(Number.isFinite).slice().sort((x, y) => x - y); if (!a.length) return NaN; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const sum = (levels, n) => levels.slice(0, n).reduce((s, l) => s + (l.size || 0), 0);

function cleanSide(levels, desc) {
  const out = (Array.isArray(levels) ? levels : []).map((l) => ({ price: Number(l && l.price), size: Number(l && l.size) }))
    .filter((l) => Number.isFinite(l.price) && l.price > 0 && Number.isFinite(l.size) && l.size >= 0);
  out.sort((a, b) => (desc ? b.price - a.price : a.price - b.price));
  return out.slice(0, 10);
}

function createOrderFlow(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const snaps = [];            // { t, bids, asks, bid1, ask1, mid, bidD3, askD3, bidD5, askD5 }
  const trades = [];           // { ts, price, size, side }
  const seenTrades = new Set();
  const walls = new Map();     // "ask:767.70" -> { side, price, first, last, seen, max, crossedAt, holds, done }
  const events = [];
  const lastEvent = new Map();
  let tick = 0.01, lastPrice = NaN;

  function classify(tr, book) {
    const dir = String(tr.direction || tr.dir || '').toUpperCase();
    if (dir === 'BUY' || dir === 'SELL') return dir === 'BUY' ? 'buy' : 'sell';
    if (book && book.ask1 && tr.price >= book.ask1 - 1e-9) return 'buy';
    if (book && book.bid1 && tr.price <= book.bid1 + 1e-9) return 'sell';
    if (Number.isFinite(lastPrice)) return tr.price > lastPrice ? 'buy' : (tr.price < lastPrice ? 'sell' : 'neutral');
    return 'neutral';
  }

  function emit(t, kind, side, price, strength, note, extra) {
    const key = kind + ':' + side;
    if (t - (lastEvent.get(key) || 0) < cfg.cooldownMs) return null;
    lastEvent.set(key, t);
    const ev = { t, kind, side, price: Number.isFinite(price) ? Math.round(price * 1e4) / 1e4 : null, strength: Math.round(clamp(strength, 0, 1) * 100) / 100, note, ...(extra || {}) };
    events.push(ev); if (events.length > 60) events.shift();
    return ev;
  }

  function push(input) {
    const t = Number(input && input.t);
    if (!Number.isFinite(t)) return { ok: false, emitted: [] };
    const bids = cleanSide(input.bids, true), asks = cleanSide(input.asks, false);
    if (!bids.length || !asks.length) return { ok: false, emitted: [] };
    const last = snaps[snaps.length - 1];
    if (last && t <= last.t) return { ok: false, emitted: [] };
    const bid1 = bids[0].price, ask1 = asks[0].price;
    if (bid1 > ask1) return { ok: false, emitted: [] }; // crossed/garbled book — skip rather than misread
    const s = { t, bids, asks, bid1, ask1, mid: (bid1 + ask1) / 2, bidD3: sum(bids, 3), askD3: sum(asks, 3), bidD5: sum(bids, 5), askD5: sum(asks, 5) };
    if (asks.length > 1) { const gap = asks[1].price - asks[0].price; if (gap > 1e-6 && gap < tick) tick = gap; }
    snaps.push(s); if (snaps.length > cfg.maxSnapshots) snaps.shift();

    for (const tr of (Array.isArray(input.ticks) ? input.ticks : [])) {
      const price = Number(tr.price), size = Number(tr.size), ts = Number(tr.timestamp_ms || tr.ts || t);
      const id = String(tr.id != null ? tr.id : ts + ':' + price + ':' + size);
      if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0 || seenTrades.has(id)) continue;
      seenTrades.add(id); if (seenTrades.size > 2000) seenTrades.delete(seenTrades.values().next().value);
      trades.push({ ts, price, size, side: classify({ ...tr, price }, s) }); lastPrice = price;
    }
    while (trades.length > 1500) trades.shift();
    return { ok: true, emitted: detect(s) };
  }

  function baselineOf(field, n) { const prior = snaps.slice(Math.max(0, snaps.length - 1 - cfg.baseline), snaps.length - 1); return median(prior.map((x) => x[field])) || NaN; }

  function metrics() {
    const s = snaps[snaps.length - 1];
    if (!s || snaps.length < cfg.minSnapshots) return null;
    const win = snaps.slice(-cfg.window);
    const nowBid = median(win.map((x) => x.bidD3)), nowAsk = median(win.map((x) => x.askD3));
    const baseBid = baselineOf('bidD3'), baseAsk = baselineOf('askD3');
    const winStart = win[0].t;
    const wt = trades.filter((x) => x.ts >= winStart);
    const buyVol = wt.filter((x) => x.side === 'buy').reduce((a, x) => a + x.size, 0), sellVol = wt.filter((x) => x.side === 'sell').reduce((a, x) => a + x.size, 0);
    const stackBid = baseBid > 0 ? nowBid / baseBid : 1, stackAsk = baseAsk > 0 ? nowAsk / baseAsk : 1;
    // size that left the book beyond what the tape can explain = pulled, not traded
    const pulledAsk = baseAsk > 0 ? clamp((baseAsk - nowAsk - buyVol) / baseAsk, 0, 1) : 0;
    const pulledBid = baseBid > 0 ? clamp((baseBid - nowBid - sellVol) / baseBid, 0, 1) : 0;
    const imb = (s.bidD5 + s.askD5) > 0 ? (s.bidD5 - s.askD5) / (s.bidD5 + s.askD5) : 0;
    const c1 = Math.tanh(1.2 * (Math.log(Math.max(0.05, stackBid)) - Math.log(Math.max(0.05, stackAsk))));
    const c2 = clamp(pulledAsk - pulledBid, -1, 1);
    const score = Math.round(100 * (0.4 * c1 + 0.35 * c2 + 0.25 * imb));
    return { score, imbalance: imb, stackBid, stackAsk, pulledAsk, pulledBid, buyVol, sellVol, nowBid, nowAsk, baseBid, baseAsk };
  }

  function absorption(s) {
    const from = s.t - cfg.absorbWindowMs;
    const wt = trades.filter((x) => x.ts >= from);
    const buyVol = wt.filter((x) => x.side === 'buy').reduce((a, x) => a + x.size, 0), sellVol = wt.filter((x) => x.side === 'sell').reduce((a, x) => a + x.size, 0);
    // normal volume per window from the older part of the tape
    const olderStart = s.t - cfg.absorbWindowMs * 5, older = trades.filter((x) => x.ts >= olderStart && x.ts < from);
    const avg = older.length ? older.reduce((a, x) => a + x.size, 0) / 4 : NaN;
    const win = snaps.filter((x) => x.t >= from);
    if (win.length < 4 || !Number.isFinite(avg) || avg <= 0) return { state: 'none', buyVol, sellVol, avgVol: Number.isFinite(avg) ? avg : null };
    const bidDrift = (win[win.length - 1].bid1 - win[0].bid1) / tick, askDrift = (win[win.length - 1].ask1 - win[0].ask1) / tick;
    const bidsHeld = win[win.length - 1].bidD3 >= 0.7 * (median(win.map((x) => x.bidD3)) || 0), asksHeld = win[win.length - 1].askD3 >= 0.7 * (median(win.map((x) => x.askD3)) || 0);
    let state = 'none', strength = 0, price = null;
    if (sellVol >= cfg.absorbVolMult * avg && sellVol >= 1.5 * buyVol && bidDrift >= -cfg.absorbTicks && bidsHeld) { state = 'bull'; strength = clamp(sellVol / (3 * avg), 0, 1); price = win[win.length - 1].bid1; }
    else if (buyVol >= cfg.absorbVolMult * avg && buyVol >= 1.5 * sellVol && askDrift <= cfg.absorbTicks && asksHeld) { state = 'bear'; strength = clamp(buyVol / (3 * avg), 0, 1); price = win[win.length - 1].ask1; }
    // iceberg: the same price keeps trading far beyond what is ever displayed there, and the level refills
    let iceberg = null;
    const byPrice = new Map();
    for (const x of wt) { const k = x.price.toFixed(4); const r = byPrice.get(k) || { price: x.price, vol: 0, n: 0 }; r.vol += x.size; r.n++; byPrice.set(k, r); }
    for (const r of byPrice.values()) {
      if (r.n < 4) continue;
      let shown = 0; for (const sn of win) for (const l of sn.bids.concat(sn.asks)) if (Math.abs(l.price - r.price) < tick / 2) shown = Math.max(shown, l.size);
      if (shown > 0 && r.vol >= 3 * shown && (!iceberg || r.vol > iceberg.vol)) iceberg = { price: r.price, vol: r.vol, shown, side: r.price <= s.mid ? 'bull' : 'bear' };
    }
    return { state, strength, price, buyVol, sellVol, avgVol: avg, iceberg };
  }

  function trackWalls(s) {
    for (const [side, levels] of [['ask', s.asks], ['bid', s.bids]]) {
      const med = median(levels.map((l) => l.size));
      if (!(med > 0)) continue;
      for (const l of levels) {
        if (l.size < cfg.wallMult * med || l.size < cfg.wallMinSize) continue;
        const key = side + ':' + l.price.toFixed(4);
        const w = walls.get(key) || { side, price: l.price, first: s.t, seen: 0, max: 0, crossedAt: null, holds: 0, done: false };
        w.last = s.t; w.seen++; w.max = Math.max(w.max, l.size); walls.set(key, w);
      }
    }
    for (const [k, w] of walls) if (s.t - w.last > 120000) walls.delete(k);
  }

  function flips(s) {
    const out = [];
    for (const w of walls.values()) {
      if (w.done || w.seen < 3) continue;
      const brokeUp = w.side === 'ask' && s.bid1 >= w.price, brokeDn = w.side === 'bid' && s.ask1 <= w.price;
      if (!brokeUp && !brokeDn) { if (w.crossedAt && s.t - w.crossedAt > 30000) { w.crossedAt = null; w.holds = 0; } continue; }
      if (!w.crossedAt) { w.crossedAt = s.t; w.holds = 0; }
      const held = brokeUp ? s.bid1 >= w.price - tick : s.ask1 <= w.price + tick;
      w.holds = held ? w.holds + 1 : 0;
      const nowSide = brokeUp ? s.bids : s.asks; // the old resistance should now show up as support (or the reverse)
      const reappeared = nowSide.some((l) => Math.abs(l.price - w.price) <= tick * 1.5 && l.size > 0) || nowSide.slice(0, 3).some((l) => l.price <= w.price + tick && brokeUp) || nowSide.slice(0, 3).some((l) => l.price >= w.price - tick && brokeDn);
      if (w.holds >= cfg.flipHold && reappeared) { w.done = true; out.push({ side: brokeUp ? 'bull' : 'bear', price: w.price, size: w.max }); }
    }
    return out;
  }

  function detect(s) {
    const emitted = [];
    trackWalls(s);
    const m = metrics();
    if (m) {
      if (m.score >= 45) { const e = emit(s.t, 'stack', 'bull', s.bid1, clamp(m.score / 100, 0, 1), 'Bids stacking' + (m.pulledAsk > 0.15 ? ' while asks are pulled' : '') + ' (' + m.score + ')', { score: m.score }); if (e) emitted.push(e); }
      else if (m.score <= -45) { const e = emit(s.t, 'stack', 'bear', s.ask1, clamp(-m.score / 100, 0, 1), 'Asks stacking' + (m.pulledBid > 0.15 ? ' while bids are pulled' : '') + ' (' + m.score + ')', { score: m.score }); if (e) emitted.push(e); }
      if (m.pulledAsk >= 0.35) { const e = emit(s.t, 'pull', 'bull', s.ask1, m.pulledAsk, 'Sellers pulled ' + Math.round(m.pulledAsk * 100) + '% of the ask size without trading'); if (e) emitted.push(e); }
      if (m.pulledBid >= 0.35) { const e = emit(s.t, 'pull', 'bear', s.bid1, m.pulledBid, 'Buyers pulled ' + Math.round(m.pulledBid * 100) + '% of the bid size without trading'); if (e) emitted.push(e); }
    }
    const a = absorption(s);
    if (a.state !== 'none') { const e = emit(s.t, 'absorb', a.state, a.price, a.strength, (a.state === 'bull' ? 'Selling absorbed at the bid' : 'Buying absorbed at the ask') + ': ' + Math.round(a.state === 'bull' ? a.sellVol : a.buyVol) + ' shares traded, price did not give way'); if (e) emitted.push(e); }
    if (a.iceberg) { const e = emit(s.t, 'iceberg', a.iceberg.side, a.iceberg.price, clamp(a.iceberg.vol / (6 * a.iceberg.shown), 0, 1), 'Possible iceberg at ' + a.iceberg.price.toFixed(2) + ': ' + Math.round(a.iceberg.vol) + ' traded vs ' + Math.round(a.iceberg.shown) + ' shown'); if (e) emitted.push(e); }
    for (const f of flips(s)) { const e = emit(s.t, 'flip', f.side, f.price, clamp(f.size / 2000, 0.3, 1), (f.side === 'bull' ? 'Resistance flipped to support' : 'Support flipped to resistance') + ' at ' + f.price.toFixed(2)); if (e) emitted.push(e); }
    return emitted;
  }

  /** Current reading. `now` lets the caller judge staleness. */
  function analyze(now = Date.now()) {
    const s = snaps[snaps.length - 1];
    if (!s) return { ready: false, state: 'empty', bias: 'neutral', score: 0 };
    const stale = now - s.t > cfg.staleMs, m = metrics();
    if (!m) return { ready: false, state: 'warming', snapshots: snaps.length, needed: cfg.minSnapshots, stale, bias: 'neutral', score: 0, book: { bids: s.bids.slice(0, 5), asks: s.asks.slice(0, 5) }, asOf: s.t };
    const a = absorption(s);
    const recentFlip = events.slice().reverse().find((e) => e.kind === 'flip' && s.t - e.t < 120000) || null;
    const absScore = a.state === 'bull' ? 30 * a.strength + 10 : (a.state === 'bear' ? -(30 * a.strength + 10) : 0);
    const flipScore = recentFlip ? (recentFlip.side === 'bull' ? 40 : -40) : 0;
    const total = clamp(Math.round(0.5 * m.score + absScore + flipScore), -100, 100);
    const bias = total >= 30 ? 'bullish' : (total <= -30 ? 'bearish' : 'neutral');
    const wallsNow = [...walls.values()].filter((w) => !w.done && s.t - w.last < 15000).sort((x, y) => y.max - x.max).slice(0, 4).map((w) => ({ side: w.side, price: w.price, size: w.max }));
    return {
      ready: true, state: stale ? 'stale' : 'live', stale, asOf: s.t, snapshots: snaps.length, bias, score: total,
      momentum: { score: m.score, imbalance: Math.round(m.imbalance * 100) / 100, stackBid: Math.round(m.stackBid * 100) / 100, stackAsk: Math.round(m.stackAsk * 100) / 100, pulledAsk: Math.round(m.pulledAsk * 100) / 100, pulledBid: Math.round(m.pulledBid * 100) / 100, label: m.score >= 35 ? 'bullish' : (m.score <= -35 ? 'bearish' : 'neutral') },
      absorption: { state: a.state, strength: a.strength || 0, buyVol: Math.round(a.buyVol), sellVol: Math.round(a.sellVol), avgVol: a.avgVol ? Math.round(a.avgVol) : null, iceberg: a.iceberg || null },
      flip: recentFlip ? { side: recentFlip.side, price: recentFlip.price, at: recentFlip.t } : null,
      book: { bids: s.bids.slice(0, 5), asks: s.asks.slice(0, 5), spread: Math.round((s.ask1 - s.bid1) * 1e4) / 1e4, mid: s.mid }, walls: wallsNow,
      events: events.slice(-8).reverse(), trades: trades.length
    };
  }

  /** How the book sees a trade direction (+1 long / -1 short) right now. */
  function grade(dir, now = Date.now()) {
    const a = analyze(now);
    if (!a.ready || a.stale) return { grade: 'unavailable', reason: a.stale ? 'order flow is not updating' : 'still collecting order flow' };
    const against = dir > 0 ? (a.bias === 'bearish' || a.absorption.state === 'bear' || (a.flip && a.flip.side === 'bear')) : (a.bias === 'bullish' || a.absorption.state === 'bull' || (a.flip && a.flip.side === 'bull'));
    const with_ = dir > 0 ? (a.bias === 'bullish') : (a.bias === 'bearish');
    if (against) return { grade: 'disagrees', reason: 'the book leans the other way (' + a.bias + ', ' + a.score + ')' };
    if (with_) return { grade: 'confirms', reason: 'the book leans the same way (' + a.bias + ', ' + a.score + ')' };
    return { grade: 'neutral', reason: 'the book is not taking a side (' + a.score + ')' };
  }

  return { push, analyze, grade, events: () => events.slice(), size: () => snaps.length, cfg };
}

module.exports = { createOrderFlow, DEFAULTS, median };
