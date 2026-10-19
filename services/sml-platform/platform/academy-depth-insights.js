'use strict';

/*
 * Depth insights: what the FULL order book and the tape say, beyond the ten-level Level 2 reader.
 *
 * moomoo OpenD (through the site bridge) gives up to 60 price levels a side with the number of resting orders at each level, and the
 * individual prints with their aggressor side. From that this module computes, with the formula for each written next to it:
 *
 *   book  mid, spread (in ticks), microprice and its tilt, bid/ask imbalance at 1 / 5 / 10 levels, the whole book and distance-weighted,
 *         resting size within 0.1% / 0.25% / 0.5% / 1% of the mid, how front-loaded each side is, the walls (with the average order size behind
 *         them, so a wall made of a few large orders reads differently from a crowd of small ones), air pockets (stretches of thin book price can
 *         move through fast), and the average resting order size per side (large resting orders are institutional patience; small ones are retail)
 *   flow  net aggressor delta over 1 and 5 minutes, cumulative volume delta (CVD) in one-minute steps, CVD vs price divergence, large-print bias
 *         (prints above the 90th percentile of the window), tape velocity against its own baseline, and replenishment (size put back at the top of
 *         the book beyond what the tape consumed: who is refilling)
 *   pressure  one -100..+100 number from the components above, each weighted and explained
 *   read  plain sentences, and for MEM ALGO: a hold / add / trim / exit read per model (day, swing, mid, long, short) and an options timing read
 *
 * Everything is a reading of what is on the screen now, not a forecast. Pure functions: nothing here fetches or draws.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const fin = Number.isFinite;
const sum = (a) => a.reduce((s, v) => s + v, 0);
const median = (arr) => { const a = arr.filter(fin).slice().sort((x, y) => x - y); if (!a.length) return NaN; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const pctl = (arr, q) => { const a = arr.filter(fin).slice().sort((x, y) => x - y); if (!a.length) return NaN; return a[Math.min(a.length - 1, Math.floor(q * (a.length - 1)))]; };

/** One side of the book as [{ price, size, orders }], best first. Accepts [[p, s, o]] rows or { price, size, orders } objects. */
function cleanSide(levels, desc) {
  const out = (Array.isArray(levels) ? levels : []).map((l) => Array.isArray(l)
    ? { price: Number(l[0]), size: Number(l[1]), orders: Number(l[2]) || 0 }
    : { price: Number(l && l.price), size: Number(l && l.size), orders: Number(l && l.orders) || 0 })
    .filter((l) => fin(l.price) && l.price > 0 && fin(l.size) && l.size >= 0);
  out.sort((a, b) => (desc ? b.price - a.price : a.price - b.price));
  return out;
}

/** Prints as [{ t, price, size, dir }] with dir B / S / N, oldest first. Accepts [t, price, size, dir] rows or objects (dir may be BUY / SELL). */
function cleanPrints(prints) {
  const out = [];
  for (const p of (Array.isArray(prints) ? prints : [])) {
    const row = Array.isArray(p) ? { t: Number(p[0]), price: Number(p[1]), size: Number(p[2]), dir: p[3] } : { t: Number(p && (p.t != null ? p.t : p.timestamp_ms)), price: Number(p && p.price), size: Number(p && p.size), dir: p && (p.dir || p.direction) };
    if (!fin(row.t) || !fin(row.price) || !(row.size > 0)) continue;
    const d = String(row.dir || '').toUpperCase();
    out.push({ t: row.t, price: row.price, size: row.size, dir: d === 'B' || d === 'BUY' ? 'B' : d === 'S' || d === 'SELL' ? 'S' : 'N' });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** The smallest price step seen between adjacent levels (the tick), falling back to a cent. */
function tickOf(bids, asks) {
  let tick = Infinity;
  for (const side of [bids, asks]) for (let i = 1; i < side.length; i++) { const g = Math.abs(side[i].price - side[i - 1].price); if (g > 1e-6 && g < tick) tick = g; }
  return fin(tick) ? r4(tick) : 0.01;
}

/* ---------- the book ---------- */

/** (bid size - ask size) / (bid size + ask size) over the first n levels: +1 all bids, -1 all asks. */
function imbalanceTop(bids, asks, n) {
  const b = sum(bids.slice(0, n).map((l) => l.size)), a = sum(asks.slice(0, n).map((l) => l.size));
  return b + a > 0 ? (b - a) / (b + a) : 0;
}

/** Distance-weighted imbalance: a level k ticks from the mid counts 1 / (1 + k / 5), so size near the touch matters most and the deep book still counts. */
function imbalanceWeighted(bids, asks, mid, tick) {
  const w = (p) => 1 / (1 + Math.abs(p - mid) / tick / 5);
  const b = sum(bids.map((l) => l.size * w(l.price))), a = sum(asks.map((l) => l.size * w(l.price)));
  return b + a > 0 ? (b - a) / (b + a) : 0;
}

/** Resting shares within each distance band of the mid (0.1%, 0.25%, 0.5%, 1%). */
function bands(side, mid) {
  const out = {};
  for (const [key, pct] of [['p10', 0.001], ['p25', 0.0025], ['p50', 0.005], ['p100', 0.01]]) out[key] = Math.round(sum(side.filter((l) => Math.abs(l.price - mid) / mid <= pct).map((l) => l.size)));
  return out;
}

/** Share of a side's total size sitting within five ticks of the touch: a front-loaded side is ready to trade now, a back-loaded one is waiting for a better price. */
function frontLoad(side, mid, tick) {
  const total = sum(side.map((l) => l.size)); if (!(total > 0)) return null;
  return r2(sum(side.filter((l) => Math.abs(l.price - mid) <= 5 * tick).map((l) => l.size)) / total);
}

/** Walls: a level at least 2.5x the median level size on its side (and 200+ shares), with the average resting order behind it. */
function walls(bids, asks, mid, tick) {
  const out = [];
  for (const [kind, side] of [['bid', bids], ['ask', asks]]) {
    const med = median(side.map((l) => l.size)); if (!(med > 0)) continue;
    side.forEach((l, i) => {
      if (l.size < 2.5 * med || l.size < 200) return;
      out.push({ kind, price: l.price, size: Math.round(l.size), orders: l.orders || null, avgOrder: l.orders > 0 ? Math.round(l.size / l.orders) : null, mult: r2(l.size / med), rank: i + 1, distTicks: Math.round(Math.abs(l.price - mid) / tick), distPct: r2(Math.abs(l.price - mid) / mid * 100) });
    });
  }
  return out.sort((a, b) => b.size - a.size).slice(0, 6);
}

/** Air pockets: three or more consecutive levels under a quarter of the side's median size (or missing price steps). Price moves fast through them. */
function thinZones(bids, asks, mid, tick) {
  const out = [];
  for (const [kind, side] of [['bid', bids], ['ask', asks]]) {
    const med = median(side.map((l) => l.size)); if (!(med > 0) || side.length < 6) continue;
    let run = [];
    const flush = () => { if (run.length >= 3) { const from = run[0].price, to = run[run.length - 1].price; out.push({ kind, from: Math.min(from, to), to: Math.max(from, to), ticks: Math.round(Math.abs(to - from) / tick) + 1, levels: run.length, distTicks: Math.round(Math.abs(run[0].price - mid) / tick) }); } run = []; };
    for (let i = 0; i < side.length; i++) {
      const l = side[i], gap = i > 0 ? Math.abs(l.price - side[i - 1].price) / tick : 1;
      if (l.size < 0.25 * med || gap > 1.5) run.push(l); else flush();
    }
    flush();
  }
  return out.sort((a, b) => a.distTicks - b.distTicks).slice(0, 4);
}

/** Average resting order size per side (size / orders), and the share of the side's size held in levels whose average order is 3x the side's median: large, patient resting interest. */
function orderStats(bids, asks) {
  const one = (side) => {
    const withOrders = side.filter((l) => l.orders > 0);
    if (withOrders.length < 3) return null;
    const avgs = withOrders.map((l) => l.size / l.orders), med = median(avgs);
    const total = sum(withOrders.map((l) => l.size));
    const large = sum(withOrders.filter((l) => l.size / l.orders >= 3 * med).map((l) => l.size));
    return { avgOrder: Math.round(sum(withOrders.map((l) => l.size)) / sum(withOrders.map((l) => l.orders))), orders: sum(withOrders.map((l) => l.orders)), largeShare: total > 0 ? r2(large / total) : 0 };
  };
  const b = one(bids), a = one(asks);
  return { available: Boolean(b && a), bid: b, ask: a };
}

/** Microprice = (bid1 * askSize + ask1 * bidSize) / (bidSize + askSize); its distance from the mid in ticks is where the next trade is leaning. */
function microprice(bids, asks, tick) {
  const b = bids[0], a = asks[0]; if (!b || !a || !(b.size + a.size > 0)) return { price: null, tilt: 0 };
  const mp = (b.price * a.size + a.price * b.size) / (b.size + a.size), mid = (b.price + a.price) / 2;
  return { price: r4(mp), tilt: r2((mp - mid) / tick) };
}

/* ---------- the tape ---------- */

function flowRead(prints, now, windowMs, lookbackMs) {
  const win = prints.filter((p) => now - p.t <= windowMs), minute = prints.filter((p) => now - p.t <= 60_000), back = prints.filter((p) => now - p.t <= lookbackMs);
  const delta = (rows) => { let b = 0, s = 0; for (const p of rows) { if (p.dir === 'B') b += p.size; else if (p.dir === 'S') s += p.size; } return { buy: b, sell: s, net: b - s, ratio: b + s > 0 ? b / (b + s) : null }; };
  const d60 = delta(minute), d300 = delta(win);
  /* CVD in one-minute steps over the lookback, with the last price of each step */
  const cvd = [];
  if (back.length) {
    const start = Math.floor(back[0].t / 60_000) * 60_000;
    let acc = 0, cur = start, last = null;
    for (const p of back) {
      while (p.t >= cur + 60_000) { cvd.push({ t: cur, cvd: Math.round(acc), price: last }); cur += 60_000; }
      if (p.dir === 'B') acc += p.size; else if (p.dir === 'S') acc -= p.size;
      last = p.price;
    }
    cvd.push({ t: cur, cvd: Math.round(acc), price: last });
  }
  /* divergence over the window: price made progress one way while the aggressor delta went the other way (both material) */
  let divergence = null, cvdChange = null, priceChangePct = null;
  if (win.length >= 10) {
    const first = win[0].price, last = win[win.length - 1].price;
    priceChangePct = r2((last - first) / first * 100);
    cvdChange = d300.net;
    const vol = d300.buy + d300.sell;
    const material = vol > 0 && Math.abs(cvdChange) >= 0.15 * vol && Math.abs(priceChangePct) >= 0.08;
    if (material && priceChangePct > 0 && cvdChange < 0) divergence = 'bearish';   // price up on net selling: the lift is being sold into
    else if (material && priceChangePct < 0 && cvdChange > 0) divergence = 'bullish'; // price down on net buying: the dip is being bought
  }
  /* large prints: the 90th percentile of the window's print sizes and above */
  const sizes = win.map((p) => p.size), threshold = win.length >= 20 ? pctl(sizes, 0.9) : null;
  let lb = 0, ls = 0, ln = 0;
  if (threshold != null) for (const p of win) if (p.size >= threshold) { ln++; if (p.dir === 'B') lb += p.size; else if (p.dir === 'S') ls += p.size; }
  const large = threshold != null ? { threshold: Math.round(threshold), buy: lb, sell: ls, n: ln, bias: lb + ls > 0 ? r2((lb - ls) / (lb + ls)) : 0 } : null;
  /* velocity: shares a minute in the last minute against the per-minute average of the lookback */
  const backMs = back.length > 1 ? Math.max(60_000, back[back.length - 1].t - back[0].t) : 0;
  const baseline = backMs ? sum(back.map((p) => p.size)) / (backMs / 60_000) : null;
  const spm = sum(minute.map((p) => p.size));
  const velocity = baseline ? { sharesPerMin: Math.round(spm), baseline: Math.round(baseline), ratio: r2(spm / baseline), tradesPerMin: minute.length } : null;
  return { delta60: d60, delta300: d300, cvd: cvd.slice(-15), cvdChange, priceChangePct, divergence, large, velocity, prints: win.length };
}

/** Replenishment: size that appeared at the top three levels of a side beyond what was there before, measured against what the tape took off that side.
 *  refill = (size added back) / (size consumed); above 1 the side is being refilled faster than it is hit (someone is defending it). */
function replenishment(snaps, prints, tick) {
  if (snaps.length < 4) return null;
  const a = snaps[snaps.length - 4], b = snaps[snaps.length - 1];
  const top = (side) => sum(side.slice(0, 3).map((l) => l.size));
  const window = prints.filter((p) => p.t > a.t && p.t <= b.t);
  const hitBid = sum(window.filter((p) => p.dir === 'S').map((p) => p.size)), liftAsk = sum(window.filter((p) => p.dir === 'B').map((p) => p.size));
  const one = (before, after, consumed) => {
    if (!(consumed > 0)) return null;
    const added = Math.max(0, after - before + consumed); // what is there now, less what was there, plus what was eaten = what was put back
    return r2(added / consumed);
  };
  const sameTouch = Math.abs(b.bids[0].price - a.bids[0].price) <= tick && Math.abs(b.asks[0].price - a.asks[0].price) <= tick;
  if (!sameTouch) return { bid: null, ask: null, note: 'price moved, refill not comparable' };
  return { bid: one(top(a.bids), top(b.bids), hitBid), ask: one(top(a.asks), top(b.asks), liftAsk), hitBid: Math.round(hitBid), liftAsk: Math.round(liftAsk) };
}

/* ---------- the composite ---------- */

function pressureOf(book, flow) {
  const C = [];
  const add = (key, label, max, value, pts, detail) => C.push({ key, label, max, value, pts: Math.round(clamp(pts, -max, max) * 10) / 10, detail });
  add('weighted', 'Book imbalance (distance-weighted, whole book)', 25, book.imbalance.weighted, 25 * Math.tanh(2.2 * book.imbalance.weighted), Math.round(book.imbalance.weighted * 100) + '% toward the ' + (book.imbalance.weighted >= 0 ? 'bids' : 'asks'));
  add('micro', 'Microprice tilt', 15, book.microTilt, 15 * Math.tanh(book.microTilt / 0.35), 'microprice ' + (book.microTilt >= 0 ? '+' : '') + book.microTilt + ' ticks from the mid');
  if (flow.delta300.ratio != null && flow.delta300.buy + flow.delta300.sell > 0) {
    const net = (flow.delta300.buy - flow.delta300.sell) / (flow.delta300.buy + flow.delta300.sell);
    add('delta', 'Aggressor delta (5 min)', 25, r2(net), 25 * Math.tanh(2.5 * net), Math.round(flow.delta300.ratio * 100) + '% of tagged volume lifted the offer');
  }
  if (flow.divergence) add('divergence', 'CVD vs price', 15, flow.divergence, flow.divergence === 'bullish' ? 15 : -15, flow.divergence === 'bullish' ? 'price fell while net buying rose: the dip is being bought' : 'price rose while net selling rose: the lift is being sold into');
  if (flow.large && flow.large.n >= 3) add('large', 'Large prints (top 10% by size)', 10, flow.large.bias, 10 * flow.large.bias, flow.large.n + ' large prints, ' + Math.round((flow.large.bias + 1) / 2 * 100) + '% bought');
  if (flow.replenish && flow.replenish.bid != null && flow.replenish.ask != null) {
    const diff = Math.tanh((flow.replenish.bid - flow.replenish.ask) / 1.5);
    add('refill', 'Replenishment (who refills the touch)', 10, r2(flow.replenish.bid - flow.replenish.ask), 10 * diff, 'bids refilled ' + flow.replenish.bid + 'x what was hit, asks ' + flow.replenish.ask + 'x what was lifted');
  }
  const max = sum(C.map((c) => c.max)), got = sum(C.map((c) => c.pts));
  const score = max > 0 ? Math.round(100 * got / max) : 0;
  const label = score >= 50 ? 'strong buying pressure' : score >= 25 ? 'buying pressure' : score <= -50 ? 'strong selling pressure' : score <= -25 ? 'selling pressure' : 'balanced';
  return { score, label, components: C, coverage: Math.round(max) };
}

function readOf(book, flow, pressure, walls, thin) {
  const lines = [];
  const bias = pressure.score >= 25 ? 'bullish' : pressure.score <= -25 ? 'bearish' : 'neutral';
  const agree = pressure.components.filter((c) => Math.sign(c.pts) === Math.sign(pressure.score) && Math.abs(c.pts) >= c.max * 0.3).length;
  const confidence = pressure.components.length >= 4 && agree >= 3 && Math.abs(pressure.score) >= 40 ? 'high' : Math.abs(pressure.score) >= 25 && agree >= 2 ? 'medium' : 'low';
  lines.push({ tone: bias === 'bullish' ? 'up' : bias === 'bearish' ? 'down' : 'flat', text: 'Pressure ' + (pressure.score > 0 ? '+' : '') + pressure.score + ': ' + pressure.label + '. ' + Math.round(book.imbalance.weighted * 100) + '% weighted book imbalance, ' + Math.round(book.imbalance.top5 * 100) + '% at the first five levels.' });
  lines.push({ tone: 'flat', text: 'Spread ' + book.spreadTicks + ' tick' + (book.spreadTicks === 1 ? '' : 's') + (book.spreadTicks >= 3 ? ' (wide: fills cost more, let limit orders work)' : ' (tight)') + '. Microprice leans ' + (book.microTilt > 0.15 ? 'to the ask: the next tick is more likely up' : book.microTilt < -0.15 ? 'to the bid: the next tick is more likely down' : 'nowhere') + '.' });
  const bw = walls.find((w) => w.kind === 'bid'), aw = walls.find((w) => w.kind === 'ask');
  if (bw) lines.push({ tone: 'up', text: 'Bid wall ' + bw.size.toLocaleString() + ' at ' + bw.price.toFixed(2) + ' (' + bw.distTicks + ' ticks below)' + (bw.avgOrder ? ', average order ' + bw.avgOrder.toLocaleString() + ' shares' + (bw.avgOrder >= 1000 ? ': a few large resting orders' : ': many small orders') : '') + '.' });
  if (aw) lines.push({ tone: 'down', text: 'Ask wall ' + aw.size.toLocaleString() + ' at ' + aw.price.toFixed(2) + ' (' + aw.distTicks + ' ticks above)' + (aw.avgOrder ? ', average order ' + aw.avgOrder.toLocaleString() + ' shares' + (aw.avgOrder >= 1000 ? ': a few large resting orders' : ': many small orders') : '') + '.' });
  if (thin.length) { const z = thin[0]; lines.push({ tone: 'warn', text: 'Thin book ' + (z.kind === 'bid' ? 'below' : 'above') + ' from ' + z.from.toFixed(2) + ' to ' + z.to.toFixed(2) + ' (' + z.ticks + ' ticks): price can move through it fast.' }); }
  if (book.orders.available) lines.push({ tone: 'flat', text: 'Average resting order: bids ' + book.orders.bid.avgOrder.toLocaleString() + ' shares, asks ' + book.orders.ask.avgOrder.toLocaleString() + '. ' + (book.orders.bid.avgOrder > 1.5 * book.orders.ask.avgOrder ? 'Larger, more patient orders sit on the bid.' : book.orders.ask.avgOrder > 1.5 * book.orders.bid.avgOrder ? 'Larger, more patient orders sit on the ask.' : 'Both sides are sized alike.') });
  if (flow.divergence) lines.push({ tone: flow.divergence === 'bullish' ? 'up' : 'down', text: flow.divergence === 'bullish' ? 'Divergence: price slipped while net buying grew. The dip is being bought.' : 'Divergence: price rose while net selling grew. The lift is being sold into.' });
  if (flow.large && flow.large.n >= 3) lines.push({ tone: flow.large.bias > 0.2 ? 'up' : flow.large.bias < -0.2 ? 'down' : 'flat', text: 'Large prints (' + flow.large.threshold.toLocaleString() + '+ shares): ' + Math.round((flow.large.bias + 1) / 2 * 100) + '% bought across ' + flow.large.n + ' prints.' });
  if (flow.velocity && flow.velocity.ratio >= 1.8) lines.push({ tone: 'warn', text: 'Tape velocity ' + flow.velocity.ratio + 'x its recent average: something is happening now.' });
  const headline = bias === 'neutral' ? 'The book and the tape are balanced right now.' : (bias === 'bullish' ? 'Buyers have the book and the tape' : 'Sellers have the book and the tape') + ' (' + confidence + ' confidence).';
  return { bias, confidence, headline, lines };
}

/**
 * The reading. snaps: book snapshots oldest first, each { t, bids, asks } (levels as [price, size, orders] or objects); prints: individual trades.
 * Returns { ready: false, reason } with nothing to read, else { ready: true, asOf, book, flow, pressure, read }.
 */
function depthInsights({ snaps = [], prints = [], now = Date.now(), windowMs = 300_000, lookbackMs = 600_000 } = {}) {
  const list = (Array.isArray(snaps) ? snaps : []).filter((s) => s && fin(Number(s.t)));
  if (!list.length) return { ready: false, reason: 'no_book' };
  const s = list[list.length - 1];
  const bids = cleanSide(s.bids, true), asks = cleanSide(s.asks, false);
  if (!bids.length || !asks.length) return { ready: false, reason: 'empty_book' };
  if (bids[0].price > asks[0].price) return { ready: false, reason: 'crossed_book' };
  const tick = tickOf(bids, asks), mid = (bids[0].price + asks[0].price) / 2;
  const clean = list.slice(-6).map((x) => ({ t: Number(x.t), bids: cleanSide(x.bids, true), asks: cleanSide(x.asks, false) })).filter((x) => x.bids.length && x.asks.length);
  const rows = cleanPrints(prints);
  const mp = microprice(bids, asks, tick);
  const book = {
    mid: r4(mid), spread: r4(asks[0].price - bids[0].price), spreadTicks: Math.max(1, Math.round((asks[0].price - bids[0].price) / tick)), tick,
    levels: { bid: bids.length, ask: asks.length },
    microprice: mp.price, microTilt: mp.tilt,
    imbalance: { top1: r2(imbalanceTop(bids, asks, 1)), top5: r2(imbalanceTop(bids, asks, 5)), top10: r2(imbalanceTop(bids, asks, 10)), full: r2(imbalanceTop(bids, asks, Infinity)), weighted: r2(imbalanceWeighted(bids, asks, mid, tick)) },
    depth: { bid: bands(bids, mid), ask: bands(asks, mid) },
    front: { bid: frontLoad(bids, mid, tick), ask: frontLoad(asks, mid, tick) },
    orders: orderStats(bids, asks)
  };
  const wl = walls(bids, asks, mid, tick), thin = thinZones(bids, asks, mid, tick);
  const flow = flowRead(rows, now, windowMs, lookbackMs);
  flow.replenish = replenishment(clean, rows, tick);
  const pressure = pressureOf(book, flow);
  const read = readOf(book, flow, pressure, wl, thin);
  return { ready: true, asOf: Number(s.t), snapshots: list.length, prints: rows.length, book, walls: wl, thin, flow, pressure, read };
}

/* ---------- MEM ALGO reads ---------- */

/**
 * Should a position be held? mode: day / swing / mid / long / short; dir: +1 long, -1 short; price and atr from the chart.
 * The book is a minutes-long view, so the longer the model's horizon the less it is allowed to say: a day trade exits on it, a swing trims on it,
 * a mid or long hold only ever trims (never exits) on it, and only when several things line up against the position.
 * Returns { verdict: hold | add | trim | exit | wait | none, reasons: [{ tone: for | against, text }], against, withCount }.
 */
function holdRead(mode, dir, ins, { price = null, atr = null } = {}) {
  if (!ins || !ins.ready) return { verdict: 'none', reasons: [], against: 0, withCount: 0, note: 'no depth reading' };
  const d = dir < 0 ? -1 : 1, side = d > 0 ? 'long' : 'short';
  const R = [];
  const against = (text) => R.push({ tone: 'against', text }), withT = (text) => R.push({ tone: 'for', text });
  const p = ins.pressure.score * d;
  if (p <= -40) against('Pressure is strongly against the ' + side + ' (' + (ins.pressure.score > 0 ? '+' : '') + ins.pressure.score + ')');
  else if (p <= -20) against('Pressure leans against the ' + side + ' (' + (ins.pressure.score > 0 ? '+' : '') + ins.pressure.score + ')');
  else if (p >= 25) withT('Pressure is with the ' + side + ' (' + (ins.pressure.score > 0 ? '+' : '') + ins.pressure.score + ')');
  const div = ins.flow.divergence;
  if (div && ((d > 0 && div === 'bearish') || (d < 0 && div === 'bullish'))) against(d > 0 ? 'The lift is being sold into (CVD falling while price rises)' : 'The dip is being bought (CVD rising while price falls)');
  else if (div) withT(d > 0 ? 'Dips are being bought (CVD rising while price slips)' : 'Rallies are being sold (CVD falling while price lifts)');
  const a = fin(atr) && atr > 0 ? atr : (fin(price) ? price * 0.005 : null);
  const front = ins.walls.find((w) => (d > 0 ? w.kind === 'ask' : w.kind === 'bid')), behind = ins.walls.find((w) => (d > 0 ? w.kind === 'bid' : w.kind === 'ask'));
  if (front && a != null && fin(price) && Math.abs(front.price - price) <= 0.5 * a) against((d > 0 ? 'Ask' : 'Bid') + ' wall ' + front.size.toLocaleString() + ' at ' + front.price.toFixed(2) + ' sits right in front (within half an ATR)' + (front.avgOrder >= 1000 ? ', made of large orders' : ''));
  if (behind && a != null && fin(price) && Math.abs(behind.price - price) <= 1.0 * a) withT((d > 0 ? 'Bid' : 'Ask') + ' wall ' + behind.size.toLocaleString() + ' at ' + behind.price.toFixed(2) + ' sits behind the position');
  const rf = ins.flow.replenish;
  if (rf && rf.bid != null && rf.ask != null) {
    if (d > 0 ? rf.ask >= 1.5 && rf.ask > rf.bid : rf.bid >= 1.5 && rf.bid > rf.ask) against(d > 0 ? 'Sellers refill the ask faster than it is lifted (' + rf.ask + 'x)' : 'Buyers refill the bid faster than it is hit (' + rf.bid + 'x)');
    else if (d > 0 ? rf.bid >= 1.5 && rf.bid > rf.ask : rf.ask >= 1.5 && rf.ask > rf.bid) withT(d > 0 ? 'Buyers refill the bid faster than it is hit (' + rf.bid + 'x)' : 'Sellers refill the ask faster than it is lifted (' + rf.ask + 'x)');
  }
  const lg = ins.flow.large;
  if (lg && lg.n >= 3) { if (lg.bias * d <= -0.4) against('Large prints are ' + (d > 0 ? 'selling' : 'buying') + ' (' + Math.round((lg.bias + 1) / 2 * 100) + '% bought)'); else if (lg.bias * d >= 0.4) withT('Large prints are ' + (d > 0 ? 'buying' : 'selling') + ' (' + Math.round((lg.bias + 1) / 2 * 100) + '% bought)'); }
  const thinAhead = ins.thin.find((z) => (d > 0 ? z.kind === 'ask' : z.kind === 'bid') && z.distTicks <= 6);
  if (thinAhead) withT('Thin book ahead (' + thinAhead.ticks + ' ticks): room to run if it goes');
  const n = R.filter((r) => r.tone === 'against').length, w = R.filter((r) => r.tone === 'for').length;
  let verdict = 'hold';
  const horizon = mode === 'day' || mode === 'short' ? 'fast' : mode === 'swing' ? 'swing' : 'slow';
  if (horizon === 'fast') { if (n >= 3 || (n >= 2 && p <= -40)) verdict = 'exit'; else if (n >= 2) verdict = 'trim'; else if (w >= 3 && n === 0) verdict = 'add'; }
  else if (horizon === 'swing') { if (n >= 3) verdict = 'trim'; else if (w >= 3 && n === 0) verdict = 'add'; }
  else { if (n >= 4) verdict = 'trim'; }
  const note = horizon === 'fast' ? 'A day or short model lives on this timescale: the book is allowed to close the trade.'
    : horizon === 'swing' ? 'A swing position never exits on minutes of order flow; three things against it is a reason to take some off.'
      : 'A mid or long hold reads this as weather, not climate: it trims only when the book, the tape and the walls all line up against it, and never exits on it.';
  return { verdict, reasons: R, against: n, withCount: w, note, horizon };
}

/** Options timing on the underlying's book: a wide spread or a book leaning the wrong way is a poor moment to open; dir +1 for calls, -1 for puts. */
function optionsRead(ins, dir) {
  if (!ins || !ins.ready) return { timing: 'unknown', why: ['no depth reading'] };
  const d = dir < 0 ? -1 : 1, why = [];
  let pts = 0;
  if (ins.book.spreadTicks >= 3) { pts -= 1; why.push('the underlying\'s spread is ' + ins.book.spreadTicks + ' ticks wide: the option will be wider still, work a limit'); } else why.push('tight underlying spread');
  const p = ins.pressure.score * d;
  if (p >= 25) { pts += 1; why.push('book pressure is with the ' + (d > 0 ? 'call' : 'put')); } else if (p <= -25) { pts -= 1; why.push('book pressure is against the ' + (d > 0 ? 'call' : 'put') + ': wait for it to turn or buy the pullback'); }
  if (ins.book.microTilt * d >= 0.2) { pts += 1; why.push('microprice leans your way: the next tick favours you'); } else if (ins.book.microTilt * d <= -0.2) why.push('microprice leans against you: no rush to pay the offer');
  const div = ins.flow.divergence;
  if (div && ((d > 0 && div === 'bullish') || (d < 0 && div === 'bearish'))) { pts += 1; why.push('the tape is ' + (d > 0 ? 'buying the dip' : 'selling the rally') + ' under the surface'); }
  else if (div) { pts -= 1; why.push('the tape is ' + (d > 0 ? 'selling the lift' : 'buying the dip') + ' against your side'); }
  if (ins.flow.velocity && ins.flow.velocity.ratio >= 2) why.push('tape velocity ' + ins.flow.velocity.ratio + 'x: premiums are moving, size down');
  return { timing: pts >= 2 ? 'good' : pts <= -1 ? 'poor' : 'fair', why };
}

module.exports = { depthInsights, holdRead, optionsRead, cleanSide, cleanPrints, tickOf, imbalanceTop, imbalanceWeighted, bands, frontLoad, walls, thinZones, orderStats, microprice, flowRead, replenishment, pressureOf };
