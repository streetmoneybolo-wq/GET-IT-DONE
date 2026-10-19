'use strict';
/* Smart-money intent: where the big money is placed and what it is doing, from the data the Academy already gathers.
 *
 * Inputs (all optional; the read says which were present):
 *   ticks    Massive prints, newest last: [t, price, size, dir] with dir 'B' | 'S' | 'N' (Massive stream)
 *   prints   moomoo prints { t, price, size, dir } (order-flow service), used when Massive has nothing
 *   snaps    full-book snapshots [{ t, bids: [{price,size,orders}], asks }] newest last (order-flow service, 2.5 s apart)
 *   bars     OHLCV bars { t, o, h, l, c, v } for the chart timeframe (ATR, volume profile, ADV, structure)
 *   smc      SmlSmartMoney.analyze(bars): order blocks, fair value gaps, liquidity pools, structure, range, vwap
 *   darkPool darkPoolSummary(): levels, lean, offSharePct, largest
 *   gamma    analyzeGamma(): callWall, putWall, flipStrike, netGex, regime
 *   stats    Massive session stats (buy, sell, offBuy, offSell, vol, big)
 *
 * Formulas (each is also explained in the output so the panel can teach them):
 *   VPIN           volume-synchronised probability of informed trading: |buy - sell| / bucket, averaged over the last N equal-volume buckets
 *   Kyle's lambda  price impact: OLS slope of 1-minute mid change (bps) on signed volume (% of ADV); low lambda with big flow = absorption
 *   Persistence    autocorrelation of trade signs at lags 1..5: one side slicing a parent order leaves a long-memory tape
 *   Footprint      share of volume in large prints (>= p95 size), odd lots (< 100) and round child-order sizes
 *   Iceberg        executed volume at a price vs the most it ever displayed there: >= 3x means hidden size refilling
 *   Spoof          big resting orders away from the touch that vanish, untraded, as price approaches
 *   Dark pool DIX  off-exchange buy share of off-exchange volume, dollar weighted, plus print clusters by price
 *   Liquidity map  every level the feeds know (order blocks, gaps, equal highs/lows, walls, icebergs, dark-pool clusters,
 *                  gamma walls, POC / value area, VWAP) merged within 0.15 ATR, scored by how many sources agree
 *   Intent         accumulation / markup / distribution / markdown / trap, from flow, absorption, impact, structure and position in the range
 *
 * Pure functions. Works in node (module.exports) and could be inlined in a page (window.SmlSmartIntent). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SmlSmartIntent = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const fin = (v) => Number.isFinite(v);
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const r2 = (v) => Math.round(v * 100) / 100;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const pct = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const i = clamp(Math.floor(p * (s.length - 1)), 0, s.length - 1); return s[i]; };
  const median = (a) => pct(a, 0.5);

  /* ---- normalise the prints: one shape whichever feed they came from ---- */
  function normalizeTrades({ ticks = [], prints = [] } = {}) {
    const out = [];
    if (Array.isArray(ticks) && ticks.length) {
      for (const t of ticks) { if (!Array.isArray(t)) continue; const p = num(t[1]), s = num(t[2]); if (!(p > 0) || !(s >= 0)) continue; out.push({ t: num(t[0]), p, s, d: t[3] === 'B' ? 1 : t[3] === 'S' ? -1 : 0 }); }
      if (out.length) return { trades: out, source: 'massive' };
    }
    if (Array.isArray(prints) && prints.length) {
      for (const k of prints) { const p = num(k && k.price), s = num(k && k.size); if (!(p > 0) || !(s >= 0)) continue; out.push({ t: num(k.t), p, s, d: k.dir === 'B' ? 1 : k.dir === 'S' ? -1 : 0 }); }
      out.sort((a, b) => a.t - b.t);
      return { trades: out, source: out.length ? 'moomoo' : 'none' };
    }
    return { trades: [], source: 'none' };
  }

  /* Trades with no side (midpoint prints) take the tick rule against the previous different price. */
  function signTrades(trades) {
    let lastP = 0, lastD = 0;
    for (const x of trades) {
      if (x.d === 0) { if (lastP && x.p !== lastP) x.d = x.p > lastP ? 1 : -1; else x.d = lastD; }
      if (x.p !== lastP) lastP = x.p;
      lastD = x.d;
    }
    return trades;
  }

  /* ---- VPIN: Easley, Lopez de Prado, O'Hara. Equal-volume buckets; toxicity = mean |buy - sell| / bucket size ---- */
  function vpin(trades, { bucket = null, buckets = 20, adv = null } = {}) {
    const vol = trades.reduce((s, x) => s + x.s, 0);
    if (!trades.length || !(vol > 0)) return { ok: false, reason: 'no_prints' };
    let V = bucket;
    if (!(V > 0)) V = adv > 0 ? adv / 50 : vol / buckets;
    if (!(V > 0)) return { ok: false, reason: 'no_volume' };
    const rows = []; let buy = 0, sell = 0, fill = 0;
    for (const x of trades) {
      let left = x.s;
      while (left > 0) {
        const take = Math.min(left, V - fill);
        if (x.d >= 0) buy += take; else sell += take;
        fill += take; left -= take;
        if (fill >= V - 1e-9) { rows.push(Math.abs(buy - sell) / V); buy = 0; sell = 0; fill = 0; }
      }
    }
    if (rows.length < 3) return { ok: false, reason: 'too_few_buckets', buckets: rows.length, bucket: Math.round(V) };
    const used = rows.slice(-buckets), v = mean(used), recent = mean(used.slice(-5)), earlier = used.length > 5 ? mean(used.slice(0, -5)) : v;
    return { ok: true, vpin: r3(v), recent: r3(recent), trend: r3(recent - earlier), buckets: used.length, bucket: Math.round(V), band: v >= 0.6 ? 'toxic' : v >= 0.4 ? 'informed' : v >= 0.25 ? 'mixed' : 'balanced' };
  }

  /* ---- Kyle's lambda: impact of signed flow on price. 1-minute bins; dp in bps, flow in % of ADV. ---- */
  function kyleLambda(trades, { binMs = 60_000, adv = null } = {}) {
    if (trades.length < 30) return { ok: false, reason: 'too_few_prints' };
    const bins = new Map();
    for (const x of trades) { const k = Math.floor(x.t / binMs); let b = bins.get(k); if (!b) { b = { k, first: x.p, last: x.p, flow: 0, vol: 0 }; bins.set(k, b); } b.last = x.p; b.flow += x.d * x.s; b.vol += x.s; }
    const seq = [...bins.values()].sort((a, b) => a.k - b.k);
    if (seq.length < 6) return { ok: false, reason: 'too_few_bins', bins: seq.length };
    const scale = adv > 0 ? adv / 100 : Math.max(1, mean(seq.map((b) => b.vol)));
    const xs = [], ys = [];
    for (let i = 1; i < seq.length; i++) { const dp = (seq[i].last - seq[i - 1].last) / seq[i - 1].last * 1e4; xs.push(seq[i].flow / scale); ys.push(dp); }
    const mx = mean(xs), my = mean(ys); let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2; }
    if (!(sxx > 0)) return { ok: false, reason: 'flat_flow' };
    const lambda = sxy / sxx, r2v = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
    const absFlow = mean(xs.map(Math.abs));
    const unit = adv > 0 ? '1% of ADV' : 'an average minute of volume';
    /* low impact for the flow that went through = someone is absorbing; high impact = aggressive, informed, thin */
    const band = lambda >= 4 ? 'high impact' : lambda >= 1.5 ? 'normal' : lambda > -1.5 ? 'absorbed' : 'inverted';
    return { ok: true, lambda: r2(lambda), r2: r3(r2v), bins: xs.length, unit, avgFlow: r2(absFlow), band };
  }

  /* ---- Persistence: Lillo-Farmer long memory of order signs. Mean autocorrelation of trade signs at lags 1..5. ---- */
  function persistence(trades, { lags = 5 } = {}) {
    const s = trades.filter((x) => x.d !== 0).map((x) => x.d);
    if (s.length < 60) return { ok: false, reason: 'too_few_prints' };
    const m = mean(s); let v = 0; for (const x of s) v += (x - m) ** 2; v /= s.length;
    if (!(v > 0)) return { ok: true, acf: 1, lagAcf: [], band: 'one-sided', side: s[0] > 0 ? 'buy' : 'sell', n: s.length };
    const lagAcf = [];
    for (let L = 1; L <= lags; L++) { let c = 0; for (let i = L; i < s.length; i++) c += (s[i] - m) * (s[i - L] - m); lagAcf.push(r3(c / (s.length - L) / v)); }
    const acf = mean(lagAcf);
    const recent = s.slice(-100), net = mean(recent);
    return { ok: true, acf: r3(acf), lagAcf, n: s.length, side: net > 0.08 ? 'buy' : net < -0.08 ? 'sell' : 'mixed', netSign: r3(net), band: acf >= 0.25 ? 'worked order' : acf >= 0.12 ? 'some slicing' : acf > -0.05 ? 'random' : 'ping-pong' };
  }

  /* ---- Footprint: who is printing. Large prints (>= p95 size), odd lots, round child orders. ---- */
  function footprint(trades) {
    if (trades.length < 20) return { ok: false, reason: 'too_few_prints' };
    const sizes = trades.map((x) => x.s).filter((s) => s > 0);
    const p95 = pct(sizes, 0.95), vol = sizes.reduce((a, b) => a + b, 0);
    let large = 0, largeBuy = 0, largeSell = 0, odd = 0, round = 0, roundN = 0;
    for (const x of trades) {
      if (x.s >= p95 && x.s >= 300) { large += x.s; if (x.d > 0) largeBuy += x.s; else if (x.d < 0) largeSell += x.s; }
      if (x.s < 100) odd += x.s;
      if (x.s >= 100 && x.s % 100 === 0) { round += x.s; roundN++; }
    }
    const largeShare = vol > 0 ? large / vol : 0, oddShare = vol > 0 ? odd / vol : 0, roundShare = vol > 0 ? round / vol : 0;
    const largeBias = large > 0 ? (largeBuy - largeSell) / large : 0;
    return { ok: true, p95: Math.round(p95), largeShare: r3(largeShare), largeBias: r3(largeBias), oddShare: r3(oddShare), roundShare: r3(roundShare), roundN,
      who: largeShare >= 0.35 ? 'institutions printing size' : oddShare >= 0.35 ? 'retail-heavy tape' : roundShare >= 0.5 ? 'algorithmic child orders' : 'mixed tape',
      side: largeBias >= 0.25 ? 'buy' : largeBias <= -0.25 ? 'sell' : 'mixed' };
  }

  /* ---- Icebergs: executed at a price vs the most that price ever showed in the book while it was the touch. ---- */
  function icebergs(trades, snaps, { tick = 0.01, minRatio = 3, minShares = 500 } = {}) {
    if (!trades.length || !snaps || snaps.length < 2) return { ok: false, reason: 'no_book' };
    const t0 = snaps[0].t, t1 = snaps[snaps.length - 1].t;
    const shown = new Map(); // price -> { bid: max shown, ask: max shown }
    for (const s of snaps) {
      for (const l of (s.bids || []).slice(0, 5)) { const p = num(l.price), z = num(l.size); const k = p.toFixed(4); const e = shown.get(k) || { bid: 0, ask: 0 }; e.bid = Math.max(e.bid, z); shown.set(k, e); }
      for (const l of (s.asks || []).slice(0, 5)) { const p = num(l.price), z = num(l.size); const k = p.toFixed(4); const e = shown.get(k) || { bid: 0, ask: 0 }; e.ask = Math.max(e.ask, z); shown.set(k, e); }
    }
    const done = new Map(); // price -> { buy, sell }
    for (const x of trades) { if (x.t < t0 - 2500 || x.t > t1 + 2500) continue; const k = x.p.toFixed(4); const e = done.get(k) || { buy: 0, sell: 0 }; if (x.d >= 0) e.buy += x.s; else e.sell += x.s; done.set(k, e); }
    const found = [];
    for (const [k, e] of done) {
      const sh = shown.get(k); if (!sh) continue;
      // buyers lifting the ask at this price: the hidden seller is on the ask side, and the reverse
      if (sh.ask > 0 && e.buy >= Math.max(minShares, minRatio * sh.ask)) found.push({ price: Number(k), side: 'ask', hidden: 'seller', executed: Math.round(e.buy), shown: Math.round(sh.ask), ratio: r2(e.buy / sh.ask) });
      if (sh.bid > 0 && e.sell >= Math.max(minShares, minRatio * sh.bid)) found.push({ price: Number(k), side: 'bid', hidden: 'buyer', executed: Math.round(e.sell), shown: Math.round(sh.bid), ratio: r2(e.sell / sh.bid) });
    }
    found.sort((a, b) => b.executed - a.executed);
    const buyers = found.filter((f) => f.hidden === 'buyer').reduce((s, f) => s + f.executed, 0), sellers = found.filter((f) => f.hidden === 'seller').reduce((s, f) => s + f.executed, 0);
    return { ok: true, levels: found.slice(0, 6), hiddenBuyers: buyers, hiddenSellers: sellers, side: buyers > sellers * 1.5 ? 'buyer' : sellers > buyers * 1.5 ? 'seller' : found.length ? 'both' : 'none', windowMs: t1 - t0, tick };
  }

  /* ---- Spoofing: a big order away from the touch that vanishes, untraded, as the touch comes nearer. ---- */
  function spoofing(snaps, trades, { tick = 0.01, minMult = 2.5, minTicksAway = 2 } = {}) {
    if (!snaps || snaps.length < 3) return { ok: false, reason: 'no_book' };
    const events = [];
    const tradedAt = (p, t0, t1) => trades.some((x) => x.t >= t0 && x.t <= t1 && Math.abs(x.p - p) < tick / 2);
    for (let i = 1; i < snaps.length; i++) {
      const a = snaps[i - 1], b = snaps[i];
      for (const side of ['bids', 'asks']) {
        const la = (a[side] || []).map((l) => ({ p: num(l.price), s: num(l.size) })).filter((l) => l.p > 0);
        const lb = (b[side] || []).map((l) => ({ p: num(l.price), s: num(l.size) })).filter((l) => l.p > 0);
        if (la.length < 5 || lb.length < 3) continue;
        const med = median(la.map((l) => l.s)) || 1;
        const touchA = side === 'bids' ? Math.max(...la.map((l) => l.p)) : Math.min(...la.map((l) => l.p));
        const touchB = side === 'bids' ? Math.max(...lb.map((l) => l.p)) : Math.min(...lb.map((l) => l.p));
        const closer = side === 'bids' ? touchB < touchA : touchB > touchA; // price moved toward this side's resting orders
        for (const l of la) {
          if (l.s < minMult * med) continue;
          const away = Math.abs(l.p - touchA) / tick; if (away < minTicksAway) continue;
          const after = lb.find((m) => Math.abs(m.p - l.p) < tick / 2);
          const left = after ? after.s : 0;
          if (left <= l.s * 0.2 && closer && !tradedAt(l.p, a.t, b.t)) events.push({ t: b.t, side: side === 'bids' ? 'bid' : 'ask', price: l.p, size: Math.round(l.s), ticksAway: Math.round(away) });
        }
      }
    }
    const bid = events.filter((e) => e.side === 'bid').length, ask = events.filter((e) => e.side === 'ask').length;
    return { ok: true, count: events.length, bid, ask, events: events.slice(-6),
      /* bids that vanish were painting support to sell into; asks that vanish were painting a ceiling to buy under */
      intent: bid > ask && bid >= 2 ? 'fake support (seller)' : ask > bid && ask >= 2 ? 'fake ceiling (buyer)' : events.length ? 'some pulling' : 'clean book' };
  }

  /* ---- Dark pool: DIX-style share and print clusters ---- */
  function darkRead(stats, darkPool, price) {
    const offBuy = num(stats && stats.offBuy), offSell = num(stats && stats.offSell), off = offBuy + offSell;
    const dix = off > 0 ? offBuy / off : null;
    const levels = (darkPool && Array.isArray(darkPool.levels) ? darkPool.levels : []).map((l) => ({ price: num(l.price), volume: num(l.volume), lean: l.lean || 'mixed', above: price ? l.price > price : null }));
    const offShare = darkPool && fin(darkPool.offSharePct) ? darkPool.offSharePct : null;
    if (dix == null && !levels.length) return { ok: false, reason: 'no_off_exchange_prints' };
    return { ok: true, dix: dix == null ? null : r3(dix), offShare, levels,
      band: dix == null ? 'unknown' : dix >= 0.55 ? 'dark buying' : dix <= 0.45 ? 'dark selling' : 'balanced',
      heavy: offShare != null && darkPool && fin(darkPool.typicalSharePct) ? offShare >= darkPool.typicalSharePct + 10 : null };
  }

  /* ---- Book walls now (for the map) ---- */
  function walls(snap, price, { mult = 2.5, minShares = 200 } = {}) {
    if (!snap) return [];
    const out = [];
    for (const side of ['bids', 'asks']) {
      const ls = (snap[side] || []).map((l) => ({ p: num(l.price), s: num(l.size) })).filter((l) => l.p > 0 && l.s > 0);
      if (ls.length < 5) continue;
      const med = median(ls.map((l) => l.s)) || 1;
      for (const l of ls) if (l.s >= Math.max(minShares, mult * med)) out.push({ price: l.p, size: Math.round(l.s), side: side === 'bids' ? 'bid' : 'ask', mult: r2(l.s / med) });
    }
    return out.sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price)).slice(0, 6);
  }

  /* ---- Volume profile from bars (HVN = where the auction accepted price; LVN = where it did not) ---- */
  function profile(bars, bins = 48) {
    const b = (bars || []).filter((x) => fin(x.h) && fin(x.l) && fin(x.v)).slice(-240);
    if (b.length < 10) return null;
    let lo = Infinity, hi = -Infinity; for (const x of b) { lo = Math.min(lo, x.l); hi = Math.max(hi, x.h); }
    if (!(hi > lo)) return null;
    const step = (hi - lo) / bins, vol = new Array(bins).fill(0);
    for (const x of b) { const a = clamp(Math.floor((x.l - lo) / step), 0, bins - 1), z = clamp(Math.floor((x.h - lo) / step), 0, bins - 1); const per = x.v / (z - a + 1); for (let i = a; i <= z; i++) vol[i] += per; }
    const total = vol.reduce((s, v) => s + v, 0); let poc = 0; for (let i = 1; i < bins; i++) if (vol[i] > vol[poc]) poc = i;
    let a = poc, z = poc, acc = vol[poc];
    while (acc < total * 0.7 && (a > 0 || z < bins - 1)) { const up = z < bins - 1 ? vol[z + 1] : -1, dn = a > 0 ? vol[a - 1] : -1; if (up >= dn) { z++; acc += vol[z]; } else { a--; acc += vol[a]; } }
    const med = median(vol.filter((v) => v > 0)) || 1;
    const hvn = [], lvn = [];
    for (let i = 1; i < bins - 1; i++) { if (vol[i] >= 1.8 * med && vol[i] >= vol[i - 1] && vol[i] >= vol[i + 1]) hvn.push(lo + (i + 0.5) * step); if (vol[i] > 0 && vol[i] <= 0.35 * med && vol[i] <= vol[i - 1] && vol[i] <= vol[i + 1]) lvn.push(lo + (i + 0.5) * step); }
    return { poc: lo + (poc + 0.5) * step, vah: lo + (z + 1) * step, val: lo + a * step, hvn: hvn.slice(0, 6), lvn: lvn.slice(0, 6), lo, hi, bars: b.length };
  }

  /* ---- Liquidity map: every level the feeds know, merged and scored ---- */
  const SOURCE_W = { orderBlock: 2.2, fvg: 1.4, eqh: 1.8, eql: 1.8, wall: 1.6, iceberg: 2.4, darkPool: 2.0, callWall: 1.8, putWall: 1.8, gammaFlip: 1.2, poc: 1.5, vah: 1.0, val: 1.0, hvn: 0.9, vwap: 0.8, swing: 0.7 };
  function liquidityMap({ price, atr, smc, snap, ice, dark, gamma, prof, vwap }) {
    if (!(price > 0)) return { ok: false, reason: 'no_price' };
    const raw = [];
    const add = (source, p, extra = {}) => { if (fin(p) && p > 0 && Math.abs(p - price) / price <= 0.12) raw.push({ source, price: p, ...extra }); };
    if (smc) {
      for (const o of (smc.structure && smc.structure.orderBlocks) || []) if (o.invalidAt == null) add('orderBlock', (o.top + o.bottom) / 2, { dir: o.dir, top: o.top, bottom: o.bottom, label: o.dir > 0 ? 'demand block' : 'supply block' });
      for (const g of smc.fvg || []) if (g.filledAt == null) add('fvg', (g.top + g.bottom) / 2, { dir: g.dir, top: g.top, bottom: g.bottom, label: g.dir > 0 ? 'bullish gap' : 'bearish gap' });
      for (const l of smc.liquidity || []) if (l.takenAt == null) add(l.kind === 'EQH' ? 'eqh' : 'eql', l.level, { label: l.kind === 'EQH' ? 'equal highs (stops above)' : 'equal lows (stops below)', count: l.count, swept: l.sweptAt != null });
      const ph = smc.pivots && smc.pivots.highs ? smc.pivots.highs.slice(-3) : [], pl = smc.pivots && smc.pivots.lows ? smc.pivots.lows.slice(-3) : [];
      for (const p of ph) add('swing', p.price, { label: 'swing high' }); for (const p of pl) add('swing', p.price, { label: 'swing low' });
    }
    for (const w of walls(snap, price)) add('wall', w.price, { label: (w.side === 'bid' ? 'bid wall ' : 'ask wall ') + w.size.toLocaleString('en-US') + ' (' + w.mult + 'x)', side: w.side, size: w.size });
    if (ice && ice.ok) for (const l of ice.levels) add('iceberg', l.price, { label: 'iceberg ' + l.hidden + ' (' + l.ratio + 'x shown)', hidden: l.hidden, executed: l.executed });
    if (dark && dark.ok) for (const l of dark.levels) add('darkPool', l.price, { label: 'dark pool ' + (l.lean === 'mixed' ? 'prints' : l.lean + 's') + ' ' + Math.round(l.volume / 1000) + 'k', lean: l.lean, volume: l.volume });
    if (gamma && gamma.available) {
      if (gamma.callWall) add('callWall', gamma.callWall.strike, { label: 'call wall (dealers sell into)', oi: gamma.callWall.oi });
      if (gamma.putWall) add('putWall', gamma.putWall.strike, { label: 'put wall (dealers buy into)', oi: gamma.putWall.oi });
      if (fin(gamma.flipStrike)) add('gammaFlip', gamma.flipStrike, { label: 'gamma flip' });
    }
    if (prof) { add('poc', prof.poc, { label: 'point of control' }); add('vah', prof.vah, { label: 'value area high' }); add('val', prof.val, { label: 'value area low' }); for (const h of prof.hvn) if (Math.abs(h - prof.poc) > atr * 0.3) add('hvn', h, { label: 'high-volume node' }); }
    if (fin(vwap)) add('vwap', vwap, { label: 'VWAP' });
    if (!raw.length) return { ok: true, levels: [], sources: 0 };
    raw.sort((a, b) => a.price - b.price);
    const tol = Math.max(atr * 0.15, price * 0.0008);
    const clusters = [];
    for (const r of raw) {
      const c = clusters[clusters.length - 1];
      if (c && r.price - c.hi <= tol) { c.items.push(r); c.hi = Math.max(c.hi, r.price); c.lo = Math.min(c.lo, r.price); }
      else clusters.push({ items: [r], lo: r.price, hi: r.price });
    }
    const levels = clusters.map((c) => {
      const score = c.items.reduce((s, r) => s + (SOURCE_W[r.source] || 1), 0);
      const mid = c.items.reduce((s, r) => s + r.price * (SOURCE_W[r.source] || 1), 0) / score;
      const sources = [...new Set(c.items.map((r) => r.source))];
      const above = mid > price;
      /* a demand block, put wall, bid wall, hidden buyer or dark buying under price is support; the mirror above is resistance */
      const buyish = c.items.filter((r) => r.source === 'putWall' || (r.source === 'orderBlock' && r.dir > 0) || (r.source === 'fvg' && r.dir > 0) || r.hidden === 'buyer' || r.side === 'bid' || r.lean === 'buy' || r.source === 'eql').length;
      const sellish = c.items.filter((r) => r.source === 'callWall' || (r.source === 'orderBlock' && r.dir < 0) || (r.source === 'fvg' && r.dir < 0) || r.hidden === 'seller' || r.side === 'ask' || r.lean === 'sell' || r.source === 'eqh').length;
      const role = above ? (sellish >= buyish ? 'resistance' : 'target') : (buyish >= sellish ? 'support' : 'trap');
      return { price: r2(mid), lo: r2(c.lo), hi: r2(c.hi), distanceAtr: atr > 0 ? r2((mid - price) / atr) : null, distancePct: r2((mid - price) / price * 100), score: r2(score), sources, labels: c.items.map((r) => r.label).filter(Boolean), role, grade: score >= 5 ? 'A' : score >= 3.2 ? 'B' : score >= 2 ? 'C' : 'D' };
    });
    levels.sort((a, b) => b.score - a.score || Math.abs(a.distancePct) - Math.abs(b.distancePct));
    return { ok: true, levels: levels.slice(0, 14), sources: raw.length, tolerance: r2(tol) };
  }

  /* ---- Intent: what the money is doing ---- */
  function intent({ price, atr, trades, vp, lam, per, fp, ice, spoof, dark, smc, prof, gamma, stats }) {
    const ev = []; let acc = 0, mark = 0; // acc > 0 = buyers positioning, < 0 = sellers; mark = trend/markup energy
    const push = (w, text, key) => { ev.push({ w: r2(w), text, key }); };
    const recent = trades.slice(-400);
    const vol = recent.reduce((s, x) => s + x.s, 0), net = recent.reduce((s, x) => s + x.d * x.s, 0), delta = vol > 0 ? net / vol : 0;
    const move = recent.length > 10 ? (recent[recent.length - 1].p - recent[0].p) / (atr || recent[0].p * 0.005) : 0;
    if (recent.length > 10) {
      if (Math.abs(delta) >= 0.15 && Math.abs(move) <= 0.35) { const w = 2.2 * Math.sign(delta); acc += w; push(w, (delta > 0 ? 'Buyers' : 'Sellers') + ' pushed ' + Math.round(Math.abs(delta) * 100) + '% net flow and price barely moved: that is absorption, size on the other side is ' + (delta > 0 ? 'selling into strength' : 'buying the dip') + '.', 'absorption'); acc -= 2 * w; }
      else if (Math.abs(delta) >= 0.15 && Math.sign(move) === Math.sign(delta) && Math.abs(move) > 0.6) { const w = 1.5 * Math.sign(delta); mark += w; acc += w * 0.5; push(w, 'Flow and price agree: ' + (delta > 0 ? 'markup, buyers are paying up' : 'markdown, sellers are hitting bids') + '.', 'markup'); }
      else if (Math.abs(delta) < 0.08 && Math.abs(move) > 0.8) { const w = 1.2 * Math.sign(move); push(w, 'Price moved ' + (move > 0 ? 'up' : 'down') + ' on balanced flow: thin book, not conviction. Easy to reverse.', 'thin'); mark += w * 0.4; }
    }
    if (lam && lam.ok) { if (lam.band === 'absorbed' && Math.abs(delta) >= 0.1) { const w = -1.6 * Math.sign(delta); acc += w; push(w, 'Kyle lambda ' + lam.lambda + ' bps per ' + lam.unit + ': big flow, tiny impact. A patient ' + (delta > 0 ? 'seller' : 'buyer') + ' is working the tape.', 'lambda'); } else if (lam.band === 'high impact') { const w = 1.2 * (Math.sign(delta) || 1); mark += w; push(w, 'Kyle lambda ' + lam.lambda + ': every ' + lam.unit + ' moves price ' + lam.lambda + ' bps. Thin, aggressive, informed flow.', 'lambda'); } }
    if (per && per.ok && per.band !== 'random' && per.side !== 'mixed') { const w = (per.band === 'worked order' ? 1.8 : 1.0) * (per.side === 'buy' ? 1 : -1); acc += w; push(w, 'Trade signs autocorrelate ' + per.acf + ' over 5 lags: one ' + per.side + 'er is slicing a parent order (algorithmic accumulation).', 'persistence'); }
    if (fp && fp.ok && fp.side !== 'mixed') { const w = 1.3 * (fp.side === 'buy' ? 1 : -1); acc += w; push(w, 'Large prints (top 5% of sizes) lean ' + Math.round(Math.abs(fp.largeBias) * 100) + '% to the ' + fp.side + ' side: ' + fp.who + '.', 'footprint'); }
    if (ice && ice.ok && ice.side !== 'none' && ice.side !== 'both') { const w = 2.0 * (ice.side === 'buyer' ? 1 : -1); acc += w; push(w, 'Iceberg: a hidden ' + ice.side + ' refilled ' + (ice.side === 'buyer' ? ice.hiddenBuyers : ice.hiddenSellers).toLocaleString('en-US') + ' shares at ' + ice.levels.filter((l) => l.hidden === ice.side).map((l) => l.price).slice(0, 2).join(', ') + '.', 'iceberg'); }
    if (spoof && spoof.ok && spoof.count >= 2 && spoof.intent !== 'some pulling') { const w = spoof.intent.includes('seller') ? -1.4 : 1.4; acc += w; push(w, 'Spoofing: ' + spoof.count + ' big ' + (w < 0 ? 'bids' : 'asks') + ' vanished untraded as price came close. ' + (w < 0 ? 'Fake support, real seller.' : 'Fake ceiling, real buyer.'), 'spoof'); }
    if (dark && dark.ok && dark.dix != null && dark.band !== 'balanced') { const w = 1.2 * (dark.band === 'dark buying' ? 1 : -1); acc += w; push(w, 'Dark pool DIX ' + Math.round(dark.dix * 100) + '%: off-exchange prints lean ' + (w > 0 ? 'buy' : 'sell') + (dark.heavy ? ', and the dark share is heavy today' : '') + '.', 'dark'); }
    if (vp && vp.ok) { if (vp.band === 'toxic' || vp.band === 'informed') { const w = 0.8 * (Math.sign(delta) || Math.sign(net) || 1); mark += w; push(w, 'VPIN ' + vp.vpin + ' (' + vp.band + '): one side owns the volume buckets. Market makers will widen; moves extend.', 'vpin'); } else push(0, 'VPIN ' + vp.vpin + ' (' + vp.band + '): two-sided tape, no urgency yet.', 'vpin'); }
    let pos = null;
    if (prof && prof.vah > prof.val) { pos = (price - prof.val) / (prof.vah - prof.val); if (pos > 1.05) { mark += 0.6; push(0.6, 'Price is above the value area: acceptance higher only if it holds the VAH ' + r2(prof.vah) + '.', 'value'); } else if (pos < -0.05) { mark -= 0.6; push(-0.6, 'Price is below the value area: acceptance lower only if it holds under the VAL ' + r2(prof.val) + '.', 'value'); } else push(0, 'Price is inside the value area (' + r2(prof.val) + ' to ' + r2(prof.vah) + '): rotation, fade the edges unless flow breaks out.', 'value'); }
    if (smc && smc.structure) { const tr = smc.structure.trend || 0; const last = (smc.structure.events || []).slice(-1)[0]; if (last) { const w = 0.9 * last.dir; mark += w; push(w, 'Structure: last ' + last.type + ' was ' + (last.dir > 0 ? 'up' : 'down') + ' at ' + r2(last.level) + (last.type === 'CHoCH' ? ' (character changed).' : '.'), 'structure'); } if (smc.range && fin(smc.range.pos)) { const p = smc.range.pos; if (p >= 0.7 && acc > 0) push(0, 'Buying this high in the range is late: smart money buys discount, sells premium.', 'range'); if (p <= 0.3 && acc < 0) push(0, 'Selling this low in the range is late: smart money sells premium, buys discount.', 'range'); } }
    if (gamma && gamma.available) { push(0, 'Gamma ' + gamma.regime + ': dealers ' + (gamma.regime === 'positive' ? 'dampen moves, ranges hold' : 'amplify moves, breaks run') + '.', 'gamma'); }

    const phase = acc >= 2.5 && mark <= 0.8 ? 'accumulation' : acc <= -2.5 && mark >= -0.8 ? 'distribution' : mark >= 1.8 && acc >= 0 ? 'markup' : mark <= -1.8 && acc <= 0 ? 'markdown' : (acc >= 1.5 && mark <= -1.2) || (acc <= -1.5 && mark >= 1.2) ? 'trap' : 'undecided';
    const lean = acc + 0.6 * mark;
    const side = lean >= 1.2 ? 'buyers' : lean <= -1.2 ? 'sellers' : 'neither';
    const strength = clamp(Math.round(Math.min(100, 18 * Math.abs(lean) + 8 * ev.filter((e) => e.w !== 0).length)), 0, 100);
    const say = {
      accumulation: 'Smart money is accumulating: absorbing sells, refilling bids, working buy orders without lifting price. Expect a markup once supply is exhausted.',
      distribution: 'Smart money is distributing: selling into strength, refilling asks, working sell orders while price looks fine. Expect a markdown once demand is exhausted.',
      markup: 'Markup: the positioned side is now paying up and price is moving with the flow. Pullbacks into the map levels below are where they add.',
      markdown: 'Markdown: the positioned side is hitting bids and price is moving with the flow. Bounces into the map levels above are where they add.',
      trap: 'Trap: price is moving one way while the real money positions the other way. The move is being sold (or bought) into. Fade it at the map levels.',
      undecided: 'No clear intent yet: the reads disagree or the tape is thin. Wait for absorption, an iceberg or a clean sweep at a map level.'
    };
    return { phase, side, strength, acc: r2(acc), mark: r2(mark), delta: r3(delta), moveAtr: r2(move), valuePos: pos == null ? null : r2(pos), evidence: ev.sort((a, b) => Math.abs(b.w) - Math.abs(a.w)), read: say[phase] };
  }

  function atrOf(bars, n = 14) {
    const b = (bars || []).filter((x) => fin(x.h) && fin(x.l) && fin(x.c)); if (b.length < 2) return null;
    const trs = []; for (let i = 1; i < b.length; i++) trs.push(Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)));
    const last = trs.slice(-n); return last.length ? mean(last) : null;
  }

  /* ---- The whole read ---- */
  function analyze({ symbol = '', ticks = [], prints = [], snaps = [], bars = [], smc = null, darkPool = null, gamma = null, stats = null, price = null, adv = null, tick = 0.01, now = Date.now() } = {}) {
    const { trades, source } = normalizeTrades({ ticks, prints });
    signTrades(trades);
    const px = price > 0 ? price : trades.length ? trades[trades.length - 1].p : bars.length ? bars[bars.length - 1].c : null;
    const atr = atrOf(bars) || (px ? px * 0.004 : null);
    const dailyAdv = adv > 0 ? adv : null;
    const snap = snaps.length ? snaps[snaps.length - 1] : null;
    const vp = vpin(trades, { adv: dailyAdv });
    const lam = kyleLambda(trades, { adv: dailyAdv });
    const per = persistence(trades);
    const fp = footprint(trades);
    const ice = icebergs(trades, snaps, { tick });
    const sp = spoofing(snaps, trades, { tick });
    const dark = darkRead(stats, darkPool, px);
    const prof = profile(bars);
    const vw = smc && smc.vwap && fin(smc.vwap.vwap) ? smc.vwap.vwap : null;
    const map = liquidityMap({ price: px, atr, smc, snap, ice, dark, gamma, prof, vwap: vw });
    const it = intent({ price: px, atr, trades, vp, lam, per, fp, ice, spoof: sp, dark, smc, prof, gamma, stats });
    const present = { tape: source, book: snaps.length > 0, bars: bars.length > 0, smc: !!smc, darkPool: !!(dark && dark.ok), gamma: !!(gamma && gamma.available) };
    const quality = (present.tape !== 'none' ? 1 : 0) + (present.book ? 1 : 0) + (present.bars ? 1 : 0) + (present.darkPool ? 1 : 0) + (present.gamma ? 1 : 0);
    return { ok: true, symbol, asOf: now, price: px, atr: atr ? r3(atr) : null, trades: trades.length, source, present, quality,
      formulas: { vpin: vp, lambda: lam, persistence: per, footprint: fp, iceberg: ice, spoof: sp, darkPool: dark },
      profile: prof ? { poc: r2(prof.poc), vah: r2(prof.vah), val: r2(prof.val), hvn: prof.hvn.map(r2), lvn: prof.lvn.map(r2) } : null,
      map, intent: it,
      invalidation: it.side === 'buyers' ? 'A close below the highest support on the map with sellers taking the flow (delta < -15%) flips this read.' : it.side === 'sellers' ? 'A close above the nearest resistance on the map with buyers taking the flow (delta > +15%) flips this read.' : 'Wait for a level on the map to be defended or swept with flow behind it.',
      glossary: {
        vpin: 'VPIN: split the tape into equal-volume buckets; toxicity = average |buy - sell| / bucket. High = one side owns the volume, market makers widen, moves extend.',
        lambda: "Kyle's lambda: slope of 1-minute price change (bps) on signed volume (% of ADV). High = aggressive informed flow. Low with big flow = someone absorbing.",
        persistence: 'Persistence: autocorrelation of trade signs at lags 1 to 5. A parent order sliced into child orders leaves a long-memory tape.',
        footprint: 'Footprint: share of volume in the biggest 5% of prints, in odd lots, and in round child-order sizes, and which way the big prints lean.',
        iceberg: 'Iceberg: executed at a price versus the most that price ever displayed. 3x or more means hidden size refilling.',
        spoof: 'Spoof: big resting orders away from the touch that vanish untraded as price approaches. Fake support means a real seller, and the reverse.',
        darkPool: 'DIX: off-exchange buy share of off-exchange volume. Above 55% is dark buying; print clusters are where blocks changed hands.',
        map: 'Liquidity map: every level the feeds know, merged within 0.15 ATR and scored by how many independent sources agree.'
      } };
  }

  return { analyze, normalizeTrades, signTrades, vpin, kyleLambda, persistence, footprint, icebergs, spoofing, darkRead, walls, profile, liquidityMap, intent, atrOf, SOURCE_W };
});
