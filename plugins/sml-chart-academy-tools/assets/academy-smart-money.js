/* Smart-money map for the Academy Live Chart Lab: the things large traders plan around that a plain candle chart does not show.
   Pure functions over OHLCV bars ({ t, o, h, l, c, v }); works in node (module.exports) and inline in the page (window.SmlSmartMoney).
     - fair value gaps (price left an imbalance behind it) and whether they have been filled
     - swing structure: break of structure / change of character
     - order blocks: the last opposing candle before the move that broke structure
     - equal highs / equal lows: where stop orders pile up (liquidity) and whether they have been swept
     - opening gaps and how often gaps like them have filled
     - premium / discount of the current range
     - session VWAP with deviation bands, volume-by-price with point of control and value area
     - volume spikes and absorption (heavy volume, no progress)
   Educational: patterns describe what price did, they do not predict what it will do. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SmlSmartMoney = api;
})(typeof window !== 'undefined' ? window : this, function () {
  const fin = Number.isFinite;
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayMemo = new Map();
  function dayKey(t) { let k = dayMemo.get(t); if (k === undefined) { k = dayFmt.format(new Date(t)); dayMemo.set(t, k); if (dayMemo.size > 8000) dayMemo.clear(); } return k; }

  function clean(bars) { return (bars || []).map((b) => ({ t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v || 0 })).filter((b) => fin(b.o) && fin(b.h) && fin(b.l) && fin(b.c) && b.h >= b.l); }

  function atrSeries(b, n = 14) {
    const out = new Array(b.length).fill(0); let prev = null;
    for (let i = 0; i < b.length; i++) {
      const tr = i ? Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)) : b[i].h - b[i].l;
      prev = prev == null ? tr : (prev * (n - 1) + tr) / n; out[i] = prev;
    }
    return out;
  }

  function pivots(b, k = 3) {
    const highs = [], lows = [];
    for (let i = k; i < b.length - k; i++) {
      let hi = true, lo = true;
      for (let j = 1; j <= k; j++) {
        if (!(b[i].h > b[i - j].h && b[i].h >= b[i + j].h)) hi = false;
        if (!(b[i].l < b[i - j].l && b[i].l <= b[i + j].l)) lo = false;
      }
      if (hi) highs.push({ i, price: b[i].h, confirmedAt: i + k }); if (lo) lows.push({ i, price: b[i].l, confirmedAt: i + k });
    }
    return { highs, lows };
  }

  function fairValueGaps(b, atr) {
    const out = [];
    for (let i = 1; i < b.length - 1; i++) {
      const min = Math.max(0.12 * atr[i], b[i].c * 0.0003);
      if (b[i + 1].l - b[i - 1].h >= min) out.push({ dir: 1, i, top: b[i + 1].l, bottom: b[i - 1].h, orig: [b[i - 1].h, b[i + 1].l], filledAt: null });
      else if (b[i - 1].l - b[i + 1].h >= min) out.push({ dir: -1, i, top: b[i - 1].l, bottom: b[i + 1].h, orig: [b[i + 1].h, b[i - 1].l], filledAt: null });
    }
    for (const g of out) {
      for (let j = g.i + 2; j < b.length; j++) {
        if (g.dir > 0) { if (b[j].l <= g.bottom) { g.filledAt = j; break; } if (b[j].l < g.top) g.top = b[j].l; }
        else { if (b[j].h >= g.top) { g.filledAt = j; break; } if (b[j].h > g.bottom) g.bottom = b[j].h; }
      }
    }
    return out;
  }

  /* Structure: a close beyond the last swing high/low is a break of structure when it continues the trend and a change of character when it reverses it. */
  function structure(b, piv, atr) {
    const events = [], orderBlocks = [];
    let trend = 0, lastHigh = null, lastLow = null;
    const ph = piv.highs.slice(), pl = piv.lows.slice();
    let hi = 0, lo = 0;
    for (let j = 0; j < b.length; j++) {
      while (hi < ph.length && ph[hi].confirmedAt <= j) { lastHigh = Object.assign({ broken: false }, ph[hi]); hi++; }
      while (lo < pl.length && pl[lo].confirmedAt <= j) { lastLow = Object.assign({ broken: false }, pl[lo]); lo++; }
      if (lastHigh && !lastHigh.broken && b[j].c > lastHigh.price && j > lastHigh.i) {
        events.push({ type: trend < 0 ? 'CHoCH' : 'BOS', dir: 1, level: lastHigh.price, fromIdx: lastHigh.i, idx: j }); lastHigh.broken = true; trend = 1;
        // order block: the lowest bearish candle between the last swing low and the break
        const from = lastLow ? Math.max(0, lastLow.i) : Math.max(0, j - 12); let pick = -1;
        for (let q = from; q < j; q++) if (b[q].c < b[q].o && (pick < 0 || b[q].l < b[pick].l)) pick = q;
        if (pick >= 0 && b[j].c - lastHigh.price >= 0.05 * atr[j]) orderBlocks.push({ dir: 1, i: pick, top: b[pick].h, bottom: b[pick].l, breakIdx: j, invalidAt: null });
      } else if (lastLow && !lastLow.broken && b[j].c < lastLow.price && j > lastLow.i) {
        events.push({ type: trend > 0 ? 'CHoCH' : 'BOS', dir: -1, level: lastLow.price, fromIdx: lastLow.i, idx: j }); lastLow.broken = true; trend = -1;
        const from = lastHigh ? Math.max(0, lastHigh.i) : Math.max(0, j - 12); let pick = -1;
        for (let q = from; q < j; q++) if (b[q].c > b[q].o && (pick < 0 || b[q].h > b[pick].h)) pick = q;
        if (pick >= 0 && lastLow.price - b[j].c >= 0.05 * atr[j]) orderBlocks.push({ dir: -1, i: pick, top: b[pick].h, bottom: b[pick].l, breakIdx: j, invalidAt: null });
      }
    }
    for (const ob of orderBlocks) for (let j = ob.breakIdx + 1; j < b.length; j++) { if (ob.dir > 0 ? b[j].c < ob.bottom : b[j].c > ob.top) { ob.invalidAt = j; break; } }
    return { events, trend, orderBlocks };
  }

  /* Equal highs / lows: two or more swing points within a hair of each other. Stops sit just beyond them, so price is often pulled there first. */
  function liquidity(b, piv, atr) {
    const out = [];
    const group = (list, kind) => {
      const pts = list.slice(-40).sort((x, y) => x.price - y.price); const used = new Set();
      for (let a = 0; a < pts.length; a++) {
        if (used.has(a)) continue; const tol = Math.max(0.1 * atr[pts[a].i], pts[a].price * 0.0005); const members = [pts[a]];
        for (let c = a + 1; c < pts.length; c++) if (pts[c].price - pts[a].price <= tol) { members.push(pts[c]); used.add(c); }
        if (members.length < 2) continue;
        const level = kind === 'EQH' ? Math.max(...members.map((m) => m.price)) : Math.min(...members.map((m) => m.price));
        const first = Math.min(...members.map((m) => m.i)), last = Math.max(...members.map((m) => m.i));
        let sweptAt = null, takenAt = null;
        for (let j = last + 1; j < b.length; j++) {
          if (kind === 'EQH') { if (b[j].h > level) { if (b[j].c < level) sweptAt = j; else takenAt = j; break; } }
          else if (b[j].l < level) { if (b[j].c > level) sweptAt = j; else takenAt = j; break; }
        }
        out.push({ kind, level, count: members.length, first, last, sweptAt, takenAt });
      }
    };
    group(piv.highs, 'EQH'); group(piv.lows, 'EQL');
    return out;
  }

  function sessionGaps(b) {
    const out = [];
    for (let i = 1; i < b.length; i++) {
      if (dayKey(b[i].t) === dayKey(b[i - 1].t)) continue;
      const prev = b[i - 1].c, open = b[i].o, pct = (open - prev) / prev;
      if (Math.abs(pct) < 0.004) continue;
      const up = pct > 0; let filledAt = null;
      for (let j = i; j < b.length; j++) { if (up ? b[j].l <= prev : b[j].h >= prev) { filledAt = j; break; } }
      out.push({ i, dir: up ? 1 : -1, pct, top: Math.max(prev, open), bottom: Math.min(prev, open), prevClose: prev, filledAt });
    }
    return out;
  }

  function vwapSeries(b, opts = {}) {
    const intraday = opts.intraday !== false; const out = new Array(b.length); let s1 = 0, s2 = 0, vv = 0, day = null;
    const anchor = opts.anchor || 0;
    for (let i = 0; i < b.length; i++) {
      if (intraday) { const d = dayKey(b[i].t); if (d !== day) { day = d; s1 = s2 = vv = 0; } } else if (i < anchor) { out[i] = null; continue; }
      const tp = (b[i].h + b[i].l + b[i].c) / 3, v = b[i].v || 0; s1 += tp * v; s2 += tp * tp * v; vv += v;
      if (vv <= 0) { out[i] = null; continue; }
      const vw = s1 / vv, sd = Math.sqrt(Math.max(0, s2 / vv - vw * vw)); out[i] = { vwap: vw, sd };
    }
    return out;
  }

  /* Volume by price over a set of bars: each bar's volume is spread across the prices it traded through. */
  function volumeProfile(b, bins = 48) {
    if (!b.length) return null;
    let lo = Infinity, hi = -Infinity; for (const x of b) { if (x.l < lo) lo = x.l; if (x.h > hi) hi = x.h; }
    if (!(hi > lo)) return null;
    const step = (hi - lo) / bins, vol = new Array(bins).fill(0);
    for (const x of b) {
      const a = Math.max(0, Math.floor((x.l - lo) / step)), z = Math.min(bins - 1, Math.floor((x.h - lo) / step)), n = z - a + 1, v = (x.v || 0) / n;
      for (let i = a; i <= z; i++) vol[i] += v;
    }
    const total = vol.reduce((p, q) => p + q, 0); if (!(total > 0)) return null;
    let poc = 0; for (let i = 1; i < bins; i++) if (vol[i] > vol[poc]) poc = i;
    let a = poc, z = poc, acc = vol[poc];
    while (acc / total < 0.7 && (a > 0 || z < bins - 1)) {
      const up = z < bins - 1 ? vol[z + 1] : -1, dn = a > 0 ? vol[a - 1] : -1;
      if (up >= dn) { z++; acc += vol[z]; } else { a--; acc += vol[a]; }
    }
    return { lo, hi, step, vol, max: vol[poc], total, poc: lo + (poc + 0.5) * step, vah: lo + (z + 1) * step, val: lo + a * step };
  }

  function volumeFlags(b, atr) {
    const out = []; let sum = 0;
    for (let i = 0; i < b.length; i++) {
      sum += b[i].v; if (i >= 20) sum -= b[i - 20].v; const avg = sum / Math.min(i + 1, 20);
      if (i < 5 || !(avg > 0)) continue; const rel = b[i].v / avg, range = b[i].h - b[i].l;
      if (rel >= 1.8 && range <= 0.6 * atr[i]) out.push({ i, kind: 'absorption', rel });
      else if (rel >= 2.5) out.push({ i, kind: 'spike', rel, dir: b[i].c >= b[i].o ? 1 : -1 });
    }
    return out;
  }

  function analyze(source, opts = {}) {
    const b = clean(source); if (b.length < 20) return null;
    const atr = atrSeries(b), piv = pivots(b, opts.k || 3), n = b.length, last = b[n - 1];
    const intraday = b.length > 1 ? (b[n - 1].t - b[n - 2].t) < 72e6 : true;
    const fvg = fairValueGaps(b, atr), st = structure(b, piv, atr), liq = liquidity(b, piv, atr), gaps = sessionGaps(b);
    const recentHigh = piv.highs.length ? piv.highs.slice(-1)[0] : null, recentLow = piv.lows.length ? piv.lows.slice(-1)[0] : null;
    let range = null;
    if (recentHigh && recentLow) {
      const hi = Math.max(recentHigh.price, recentLow.price), lo = Math.min(recentHigh.price, recentLow.price);
      if (hi > lo) range = { hi, lo, eq: (hi + lo) / 2, pos: (last.c - lo) / (hi - lo), fromIdx: Math.min(recentHigh.i, recentLow.i) };
    }
    const vw = vwapSeries(b, { intraday, anchor: Math.max(0, n - 120) });
    const flags = volumeFlags(b, atr);
    const filledGaps = gaps.filter((g) => g.filledAt != null), gapStat = gaps.length >= 3 ? { total: gaps.length, filled: filledGaps.length, rate: filledGaps.length / gaps.length } : null;
    return { n, atr: atr[n - 1], last: last.c, intraday, fvg, structure: st, liquidity: liq, gaps, gapStat, range, vwap: vw, flags, pivots: piv };
  }

  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  /* Plain-English read of the map, newest and most relevant first. */
  function read(a) {
    if (!a) return [];
    const out = [], px = a.last, atr = a.atr || px * 0.01, n = a.n;
    const ev = a.structure.events.slice(-1)[0];
    if (ev) out.push({ tone: ev.dir > 0 ? 'up' : 'down', text: (ev.type === 'CHoCH' ? 'Change of character' : 'Break of structure') + ' ' + (ev.dir > 0 ? 'up' : 'down') + ' through ' + ev.level.toFixed(2) + ', ' + (n - 1 - ev.idx) + ' bars ago.' });
    if (a.range) out.push({ tone: a.range.pos > 0.5 ? 'down' : 'up', text: 'Price is in ' + (a.range.pos > 0.5 ? 'PREMIUM' : 'DISCOUNT') + ' (' + Math.round(Math.max(0, Math.min(1, a.range.pos)) * 100) + '% of the ' + a.range.lo.toFixed(2) + ' to ' + a.range.hi.toFixed(2) + ' range). ' + (a.range.pos > 0.5 ? 'Large traders prefer to sell up here, not buy.' : 'Large traders prefer to buy down here, not sell.') });
    const openFvg = a.fvg.filter((g) => g.filledAt == null && n - 1 - g.i <= 150);
    const below = openFvg.filter((g) => g.top < px).sort((x, y) => y.top - x.top)[0], above = openFvg.filter((g) => g.bottom > px).sort((x, y) => x.bottom - y.bottom)[0];
    if (below) out.push({ tone: below.dir > 0 ? 'up' : 'down', text: 'Nearest open ' + (below.dir > 0 ? 'bullish' : 'bearish') + ' imbalance below: ' + below.bottom.toFixed(2) + ' to ' + below.top.toFixed(2) + ' (' + ((px / below.top - 1) * 100).toFixed(1) + '% away).' });
    if (above) out.push({ tone: above.dir > 0 ? 'up' : 'down', text: 'Nearest open ' + (above.dir > 0 ? 'bullish' : 'bearish') + ' imbalance above: ' + above.bottom.toFixed(2) + ' to ' + above.top.toFixed(2) + '.' });
    const eqh = a.liquidity.filter((l) => l.kind === 'EQH' && l.takenAt == null && l.sweptAt == null && l.level > px).sort((x, y) => x.level - y.level)[0];
    const eql = a.liquidity.filter((l) => l.kind === 'EQL' && l.takenAt == null && l.sweptAt == null && l.level < px).sort((x, y) => y.level - x.level)[0];
    if (eqh) out.push({ tone: 'warn', text: 'Equal highs at ' + eqh.level.toFixed(2) + ' (' + eqh.count + ' touches): stops rest above them. A push through and back under is a liquidity sweep.' });
    if (eql) out.push({ tone: 'warn', text: 'Equal lows at ' + eql.level.toFixed(2) + ' (' + eql.count + ' touches): stops rest below them.' });
    const sweep = a.liquidity.filter((l) => l.sweptAt != null && n - 1 - l.sweptAt <= 15).sort((x, y) => y.sweptAt - x.sweptAt)[0];
    if (sweep) out.push({ tone: sweep.kind === 'EQL' ? 'up' : 'down', text: 'Liquidity sweep ' + (n - 1 - sweep.sweptAt) + ' bars ago: price ran the ' + (sweep.kind === 'EQL' ? 'lows' : 'highs') + ' at ' + sweep.level.toFixed(2) + ' and closed back inside.' });
    const ob = a.structure.orderBlocks.filter((o) => o.invalidAt == null).slice(-1)[0];
    if (ob) out.push({ tone: ob.dir > 0 ? 'up' : 'down', text: 'Active ' + (ob.dir > 0 ? 'demand' : 'supply') + ' block ' + ob.bottom.toFixed(2) + ' to ' + ob.top.toFixed(2) + ': where the move that broke structure began.' });
    const gap = a.gaps.filter((g) => g.filledAt == null).slice(-1)[0];
    if (gap) out.push({ tone: 'warn', text: 'Unfilled ' + (gap.dir > 0 ? 'gap up' : 'gap down') + ' of ' + (gap.pct * 100).toFixed(1) + '%; the gap closes at ' + gap.prevClose.toFixed(2) + '.' + (a.gapStat ? ' Similar gaps here filled ' + Math.round(a.gapStat.rate * 100) + '% of the time (' + a.gapStat.filled + ' of ' + a.gapStat.total + ').' : '') });
    const vw = a.vwap[n - 1]; if (vw) out.push({ tone: px >= vw.vwap ? 'up' : 'down', text: 'Price is ' + (px >= vw.vwap ? 'above' : 'below') + ' VWAP ' + vw.vwap.toFixed(2) + (vw.sd > 0 ? ' (' + (((px - vw.vwap) / vw.sd)).toFixed(1) + ' deviations)' : '') + '. Institutions benchmark their fills to it.' });
    const fl = a.flags.filter((f) => n - 1 - f.i <= 8).slice(-1)[0];
    if (fl) out.push({ tone: fl.kind === 'absorption' ? 'warn' : (fl.dir > 0 ? 'up' : 'down'), text: fl.kind === 'absorption' ? 'Absorption ' + (n - 1 - fl.i) + ' bars ago: ' + fl.rel.toFixed(1) + 'x normal volume but almost no movement. Someone is soaking up the other side.' : 'Volume spike ' + (n - 1 - fl.i) + ' bars ago: ' + fl.rel.toFixed(1) + 'x normal.' });
    return out;
  }

  return { analyze, read, atrSeries, pivots, fairValueGaps, structure, liquidity, sessionGaps, vwapSeries, volumeProfile, volumeFlags, dayKey, near };
});
