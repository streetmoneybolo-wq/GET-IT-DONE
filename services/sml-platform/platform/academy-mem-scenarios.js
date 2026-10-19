/* MEM ALGO scenarios: the five most likely ways the selected trade type could play out on THIS chart, each drawn like a
   finance professor would draw it: the zones that matter, the levels in the way, a numbered price path from the entry to the
   target, the stop and what would invalidate the idea, and a plain-English note for every step.

   Pure functions over the chart's own candles plus the three readings the Academy already makes on them:
     - the smart-money map (window.SmlSmartMoney.analyze): structure, order blocks, fair value gaps, liquidity, range, VWAP
     - the pattern scanner (window.SmlPatterns.detect): chart patterns with their necklines and measured targets
     - MEM ALGO's own read (MemAlgoEngine.analyze): bias, the open or latest signal with its stop and target, the EMAs
   Each scenario template needs certain things on the map; templates whose prerequisites are missing are not offered. The ones
   that remain are scored on how well the chart supports them and the top five are returned, all in the direction the trade
   type trades. Educational: schematic paths, not forecasts. Works in node (module.exports) and inline (window.SmlMemScenarios). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SmlMemScenarios = api;
})(typeof window !== 'undefined' ? window : this, function () {
  const fin = Number.isFinite;
  const px = (v) => (v >= 1 ? v.toFixed(2) : v.toFixed(4));
  const r2 = (v) => Math.round(v * 100) / 100;

  /* how far ahead the path is drawn, in candles of the chart's own interval, and what the trade type usually trades with */
  const HORIZON = {
    day: { future: 22, label: 'Day trade', options: { type: 'same-week', expiry: '0 to 2 days out', strike: 'at the money, at or just inside the entry' } },
    swing: { future: 16, label: 'Swing trade', options: { type: '3 to 6 weeks', expiry: '3 to 6 weeks out', strike: 'near the entry; a spread to the first target cuts the cost' } },
    mid: { future: 20, label: 'Mid-term hold', options: { type: '90 to 120 days', expiry: '3 to 4 months out', strike: 'in the money, around 0.60 delta' } },
    long: { future: 26, label: 'Long-term hold', options: { type: 'LEAPS', expiry: '9 to 18 months out', strike: 'deep in the money, around 0.70 delta' } },
    short: { future: 18, label: 'Short sale', options: { type: 'puts, 2 to 6 weeks', expiry: '2 to 6 weeks out', strike: 'near the entry; a bear put spread to the first target cuts the cost' } }
  };

  /* a leg between two waypoints with one small counter-move in the middle, so the path reads as price action, not a ruler */
  function leg(a, b, atr, wobble) {
    const n = Math.max(1, b.i - a.i);
    if (n < 4) return [b];
    const span = b.p - a.p, mid = a.i + Math.round(n * 0.5);
    const back = Math.min(Math.abs(span) * (wobble == null ? 0.3 : wobble), 1.1 * atr) * (span >= 0 ? -1 : 1);
    return [{ i: a.i + Math.round(n * 0.35), p: a.p + span * 0.45 }, { i: mid, p: a.p + span * 0.45 + back }, b];
  }
  function pathOf(way, atr, wobble) {
    const out = [way[0]];
    for (let q = 1; q < way.length; q++) for (const pt of leg(way[q - 1], way[q], atr, wobble)) out.push(pt);
    return out;
  }

  /* the trade the scenarios are built around: direction, entry, stop and the first two targets */
  function frame({ bars, mode, analysis, model, patterns, params }) {
    const N = bars.length, last = bars[N - 1], a = analysis;
    const st = params || {};
    const dirs = st.dirs || (mode === 'mid' || mode === 'long' ? 'long' : mode === 'short' ? 'short' : 'both');
    let s = dirs === 'short' ? -1 : 1;
    const recent = (sig) => sig && N - 1 - sig.i <= 30;
    if (dirs === 'both' && model) {
      if (model.open) s = model.open.dir > 0 ? 1 : -1;
      else if (recent(model.latest)) s = model.latest.dir > 0 ? 1 : -1;
      else if (model.bias === 'short' || model.bias === 'bounce') s = -1;
    }
    const atr = a.atr > 0 ? a.atr : last.c * 0.01;
    const entry = r2(model && model.open ? model.open.entry : last.c);
    const stopAtr = fin(st.stopAtr) ? st.stopAtr : (mode === 'day' ? 1.2 : mode === 'swing' ? 2 : mode === 'short' ? 1.6 : 3);
    const targetAtr = fin(st.targetAtr) ? st.targetAtr : (mode === 'day' ? 2.4 : mode === 'swing' ? 4 : mode === 'short' ? 3.2 : 6);
    let stop = model && model.open ? model.open.stop : (model && recent(model.latest) ? model.latest.stop : null);
    if (!fin(stop) || s * (entry - stop) <= 0) {
      /* the nearest swing that protects the trade, a little beyond it; else the model's ATR stop */
      const piv = (s > 0 ? a.pivots.lows : a.pivots.highs).slice(-6).map((p) => p.price).filter((p) => s * (entry - p) > 0.3 * atr && s * (entry - p) < stopAtr * 1.6 * atr);
      stop = piv.length ? (s > 0 ? Math.min(...piv) : Math.max(...piv)) - s * 0.25 * atr : entry - s * stopAtr * atr;
    }
    stop = r2(stop);
    const risk = Math.abs(entry - stop);
    /* levels ahead of the entry, in the trade direction: liquidity pools, structure levels, pattern targets, old swings, measured move */
    const ahead = [];
    const push = (price, label, kind, weight) => { if (fin(price) && s * (price - entry) > 0.4 * atr) ahead.push({ price, label, kind, weight: weight || 1 }); };
    for (const l of a.liquidity) if (l.takenAt == null && (s > 0 ? l.kind === 'EQH' : l.kind === 'EQL')) push(l.level, 'equal ' + (s > 0 ? 'highs' : 'lows') + ' (stops rest here)', 'liquidity', 3);
    for (const p of (s > 0 ? a.pivots.highs : a.pivots.lows).slice(-8)) push(p.price, 'prior swing ' + (s > 0 ? 'high' : 'low'), 'swing', 2);
    for (const e of a.structure.events.slice(-6)) if (e.dir !== s) push(e.level, e.type + ' level', 'structure', 2);
    const pats = patterns && patterns.ok ? patterns.charts.filter((c) => (c.dir === (s > 0 ? 'bull' : 'bear')) && c.status !== 'failed') : [];
    for (const c of pats) push(c.target, c.name + ' measured move', 'pattern', 2 + c.confidence);
    for (const lv of (patterns && patterns.ok ? patterns.levels : [])) if ((s > 0 ? lv.kind === 'resistance' : lv.kind === 'support')) push(lv.p, lv.kind + ' (' + lv.touches + ' touches)', 'level', 1 + Math.min(3, lv.touches) * 0.5);
    push(entry + s * targetAtr * atr, "MEM ALGO's " + targetAtr + '× ATR target', 'measured', 1.5);
    const vw = a.vwap && a.vwap[N - 1];
    if (vw && a.intraday) { push(vw.vwap + s * vw.sd, 'VWAP ' + (s > 0 ? '+' : '−') + '1σ band', 'vwap', 1); push(vw.vwap + s * 2 * vw.sd, 'VWAP ' + (s > 0 ? '+' : '−') + '2σ band', 'vwap', 1); }
    ahead.sort((x, y) => s * (x.price - y.price));
    /* T1: the first level at least 1R away that is worth something; T2: the next distinct one */
    const worth = ahead.filter((l) => s * (l.price - entry) >= Math.max(risk, 0.8 * atr));
    const t1 = worth[0] || { price: entry + s * Math.max(2 * risk, targetAtr * atr), label: 'measured move (2R)', kind: 'measured', weight: 1 };
    const t2 = worth.find((l) => s * (l.price - t1.price) > 0.6 * atr) || null;
    return { s, side: s > 0 ? 'long' : 'short', entry, stop, risk, atr, t1, t2, ahead, pats, N, last, dirs, bars };
  }

  const labelZone = (z) => (z.kind === 'FVG' ? (z.dir > 0 ? 'bullish gap (FVG)' : 'bearish gap (FVG)') : (z.dir > 0 ? 'demand block' : 'supply block'));

  /* ---- templates: each returns a scenario or null ---- */
  function continuation(F, a, model, mode) {
    const { s, entry, stop, atr, t1, t2, N } = F;
    const fast = model && model.ind && fin(model.ind.fast[N - 1]) ? model.ind.fast[N - 1] : null;
    const slow = model && model.ind && fin(model.ind.slow[N - 1]) ? model.ind.slow[N - 1] : null;
    const aligned = model ? (s > 0 ? (model.bias === 'long' || model.bias === 'pullback') : (model.bias === 'short' || model.bias === 'bounce')) : (a.structure.trend === s);
    const lastEv = a.structure.events.slice(-1)[0];
    let score = 58 + (aligned ? 16 : -14) + (lastEv && lastEv.dir === s ? 8 : (lastEv ? -6 : 0)) + (fast != null && slow != null && s * (fast - slow) > 0 ? 8 : -4);
    const toFast = fast != null && s * (entry - fast) > 0.2 * atr && s * (fast - stop) > 0;
    const pull = toFast ? fast : entry - s * 0.6 * atr;
    const bos = (s > 0 ? a.pivots.highs : a.pivots.lows).slice(-4).map((p) => p.price).filter((p) => s * (p - entry) > 0.2 * atr && s * (t1.price - p) > 0.2 * atr).sort((x, y) => s * (x - y))[0];
    const steps = [
      { p: entry, text: 'Entry ' + px(entry) + ': the trend is ' + (s > 0 ? 'up' : 'down') + (fast != null ? ' and price is riding the fast EMA (' + px(fast) + ')' : '') + '.' },
      { p: pull, text: 'A shallow pullback to ' + px(pull) + (toFast ? ', the fast EMA' : ', about half an ATR') + '. Buyers and sellers rarely let a trend run without a breather; this is the breather.' },
      ...(bos ? [{ p: bos, text: 'Break of structure through the last swing ' + (s > 0 ? 'high' : 'low') + ' ' + px(bos) + '. A close through it confirms the trend is still alive.' }] : []),
      { p: t1.price, text: 'First target ' + px(t1.price) + ': ' + t1.label + '. Book part here.' },
      ...(t2 ? [{ p: t2.price, text: 'Second target ' + px(t2.price) + ': ' + t2.label + '. The rest runs with the stop moved to break-even.' }] : [])
    ];
    const zones = [];
    const ob = a.structure.orderBlocks.filter((o) => o.dir === s && o.invalidAt == null).slice(-1)[0];
    if (ob) zones.push({ kind: 'OB', dir: s, top: ob.top, bottom: ob.bottom, from: ob.i, label: labelZone({ kind: 'OB', dir: s }) });
    return { id: 'continuation', title: 'Trend continuation', tag: 'TREND', score, steps, zones, levels: fast != null ? [{ price: fast, label: 'fast EMA', kind: 'ema' }] : [],
      teach: ['A trend is a series of higher highs and higher lows (or the reverse). The trade is simply the next leg of it.'.replace(/\(or the reverse\)/, s > 0 ? '' : '(here: lower highs and lower lows)'), 'The pullback is where the risk is smallest: the stop sits under the last swing, not under the whole move.', aligned ? "MEM ALGO's bias agrees with this direction." : "MEM ALGO's bias does not yet agree; this path needs the averages to turn first."],
      why: (aligned ? "MEM ALGO's bias is aligned, " : 'The averages are not aligned yet, ') + (lastEv ? 'and the last structure event was a ' + lastEv.type + ' ' + (lastEv.dir > 0 ? 'up' : 'down') + '.' : 'with no structure event on screen.') };
  }

  function pullback(F, a, model, mode) {
    const { s, entry, stop, atr, t1, t2 } = F;
    const zones = [];
    for (const o of a.structure.orderBlocks) if (o.dir === s && o.invalidAt == null) zones.push({ kind: 'OB', dir: s, top: o.top, bottom: o.bottom, from: o.i, i: o.i });
    for (const g of a.fvg) if (g.dir === s && g.filledAt == null) zones.push({ kind: 'FVG', dir: s, top: g.top, bottom: g.bottom, from: g.i - 1, i: g.i });
    /* the zone must sit between the stop and the entry, close enough to be reached on a normal dip */
    const near = zones.map((z) => ({ z, edge: s > 0 ? z.top : z.bottom, mid: (z.top + z.bottom) / 2 }))
      .filter((c) => s * (entry - c.edge) > 0.15 * atr && s * (c.mid - stop) > 0 && s * (entry - c.edge) < 3 * atr)
      .sort((x, y) => s * (y.edge - x.edge))[0];
    if (!near) return null;
    const z = near.z, depth = s * (entry - near.edge) / atr;
    let score = 62 + (depth < 1.2 ? 10 : depth < 2 ? 4 : -4) + (z.kind === 'OB' ? 6 : 3);
    const eqLo = a.range && (s > 0 ? near.mid <= a.range.eq : near.mid >= a.range.eq);
    if (eqLo) score += 6;
    const vw = a.vwap && a.vwap[F.N - 1];
    if (vw && Math.abs(vw.vwap - near.mid) < 0.5 * atr) score += 5;
    const label = labelZone(z);
    const steps = [
      { p: entry, text: 'Entry ' + px(entry) + '. Price is above a fresh ' + label + ' at ' + px(z.bottom) + ' to ' + px(z.top) + (s > 0 ? '' : ' (read the mirror: below a fresh supply block)') + '.' },
      { p: near.mid, text: 'Price dips into the ' + label + ' (' + px(near.edge) + '). This is where the orders that started the last move are waiting; the dip should be bought here, not sold.'.replace('bought', s > 0 ? 'bought' : 'sold').replace('not sold', s > 0 ? 'not sold' : 'not bought') },
      { p: entry, text: 'Reclaim of the entry ' + px(entry) + ' on a closing basis: the dip held, the zone did its job.' },
      { p: t1.price, text: 'First target ' + px(t1.price) + ': ' + t1.label + '.' },
      ...(t2 ? [{ p: t2.price, text: 'Second target ' + px(t2.price) + ': ' + t2.label + '.' }] : [])
    ];
    return { id: 'pullback', title: 'Pullback into the ' + label + ', then go', tag: 'PULLBACK', score, steps, zones: [{ kind: z.kind, dir: s, top: z.top, bottom: z.bottom, from: z.from, label }], levels: [],
      teach: ['An order block is the last opposite candle before a move that broke structure: institutions filled there and often defend it.', 'A fair value gap is a one-candle imbalance; price often comes back to fill part of it before continuing.', 'The stop belongs beyond the zone (' + px(stop) + '), because a close through the zone means the story changed.'],
      why: 'A fresh ' + label + ' sits ' + depth.toFixed(1) + ' ATR ' + (s > 0 ? 'below' : 'above') + ' the entry' + (eqLo ? ', in the discount half of the range' : '') + '.' };
  }

  function sweep(F, a, model, mode) {
    const { s, entry, atr, t1, t2, N } = F;
    const pools = a.liquidity.filter((l) => l.takenAt == null && l.sweptAt == null && (s > 0 ? l.kind === 'EQL' : l.kind === 'EQH') && s * (entry - l.level) > 0.1 * atr && s * (entry - l.level) < 3.5 * atr)
      .sort((x, y) => s * (y.level - x.level));
    const pool = pools[0];
    if (!pool) return null;
    const dist = s * (entry - pool.level) / atr;
    let score = 56 + (dist < 1.5 ? 14 : dist < 2.5 ? 6 : 0) + Math.min(8, pool.count * 3);
    if (a.range && (s > 0 ? entry <= a.range.eq : entry >= a.range.eq)) score += 6;
    const stop = pool.level - s * Math.max(0.35 * atr, 0.25 * Math.abs(entry - pool.level));
    const choch = (s > 0 ? a.pivots.highs : a.pivots.lows).slice(-3).map((p) => p.price).filter((p) => s * (p - entry) > 0.2 * atr && s * (t1.price - p) > 0).sort((x, y) => s * (x - y))[0];
    const steps = [
      { p: entry, text: 'Entry ' + px(entry) + '. Equal ' + (s > 0 ? 'lows' : 'highs') + ' sit at ' + px(pool.level) + ' (' + pool.count + ' touches): a pile of stop orders rests just beyond them.' },
      { p: pool.level - s * 0.3 * atr, text: 'The sweep: price pokes through ' + px(pool.level) + ', runs the stops, and snaps back the same candle or the next. A wick, not a close.' },
      { p: entry + s * 0.2 * atr, text: 'Fast reclaim of ' + px(entry) + '. The trapped traders are now fuel for the move.' },
      ...(choch ? [{ p: choch, text: 'Change of character through ' + px(choch) + ': the first swing ' + (s > 0 ? 'high' : 'low') + ' gives way, confirming the reversal.' }] : []),
      { p: t1.price, text: 'First target ' + px(t1.price) + ': ' + t1.label + '.' },
      ...(t2 ? [{ p: t2.price, text: 'Second target ' + px(t2.price) + ': ' + t2.label + '.' }] : [])
    ];
    return { id: 'sweep', title: 'Liquidity sweep, then reversal', tag: 'SWEEP', score, stop, steps, zones: [],
      levels: [{ price: pool.level, label: 'equal ' + (s > 0 ? 'lows' : 'highs') + ' ×' + pool.count + ' (liquidity)', kind: 'liquidity' }],
      teach: ['Equal highs or lows are where the crowd keeps its stops. Big players push through them to fill large orders, then reverse.', 'The tell is the close: a wick through the level and a close back inside is a sweep; a close beyond is a real break.', 'The stop goes beyond the pool (' + px(stop) + '), so a sweep cannot take you out before the move starts.'],
      why: 'Unswept equal ' + (s > 0 ? 'lows' : 'highs') + ' ' + dist.toFixed(1) + ' ATR ' + (s > 0 ? 'below' : 'above') + ' price.' };
  }

  function breakout(F, a, model, mode, patterns) {
    const { s, entry, atr, t1, t2, N } = F;
    const cands = [];
    const pat = F.pats.filter((c) => c.status !== 'confirmed' || (c.breakIdx != null && N - 1 - c.breakIdx <= 8)).sort((x, y) => y.confidence - x.confidence)[0];
    if (pat && fin(pat.neckline != null ? pat.neckline : pat.level)) cands.push({ price: pat.neckline != null ? pat.neckline : pat.level, label: pat.name + ' neckline', weight: 10 + pat.confidence * 10, pat });
    for (const lv of (patterns && patterns.ok ? patterns.levels : [])) if ((s > 0 ? lv.kind === 'resistance' : lv.kind === 'support')) cands.push({ price: lv.p, label: lv.kind + ' (' + lv.touches + ' touches)', weight: 4 + Math.min(4, lv.touches) });
    const sw = (s > 0 ? a.pivots.highs : a.pivots.lows).slice(-3)[0];
    if (sw) cands.push({ price: sw.price, label: 'last swing ' + (s > 0 ? 'high' : 'low'), weight: 4 });
    const lvl = cands.filter((c) => s * (c.price - entry) > 0.15 * atr && s * (c.price - entry) < 2.2 * atr && s * (t1.price - c.price) > 0.3 * atr).sort((x, y) => y.weight - x.weight)[0];
    if (!lvl) return null;
    let score = 54 + Math.min(16, lvl.weight) + (a.flags.some((f) => f.kind === 'spike' && N - 1 - f.i <= 5) ? 6 : 0);
    if (lvl.pat) score += lvl.pat.status === 'confirmed' ? 6 : 3;
    const steps = [
      { p: entry, text: 'Entry ' + px(entry) + ', just under ' + lvl.label + ' at ' + px(lvl.price) + '.' },
      { p: lvl.price + s * 0.5 * atr, text: 'The break: a close ' + (s > 0 ? 'above' : 'below') + ' ' + px(lvl.price) + ' on volume. Wicks through it do not count.' },
      { p: lvl.price, text: 'The retest: price comes back to ' + px(lvl.price) + ' and holds. Old ' + (s > 0 ? 'resistance' : 'support') + ' becomes new ' + (s > 0 ? 'support' : 'resistance') + '. This is the lower-risk add.' },
      { p: t1.price, text: 'First target ' + px(t1.price) + ': ' + t1.label + '.' },
      ...(t2 ? [{ p: t2.price, text: 'Second target ' + px(t2.price) + ': ' + t2.label + '.' }] : [])
    ];
    return { id: 'breakout', title: 'Break ' + px(lvl.price) + ' and retest', tag: 'BREAKOUT', score, steps, zones: [], levels: [{ price: lvl.price, label: lvl.label, kind: 'level' }], patternId: lvl.pat ? lvl.pat.id : null,
      teach: ['A level that was touched several times has orders stacked on both sides. The break clears one side; the retest proves the other side now defends it.', 'Chasing the break is the expensive entry; the retest is the cheap one.', 'If the retest fails and price closes back ' + (s > 0 ? 'below' : 'above') + ' ' + px(lvl.price) + ', the breakout was a trap: exit.'],
      why: lvl.label + ' is ' + (s * (lvl.price - entry) / atr).toFixed(1) + ' ATR away' + (lvl.pat ? ', drawn by a ' + lvl.pat.status + ' ' + lvl.pat.name : '') + '.' };
  }

  function gapFill(F, a, model, mode) {
    const { s, entry, atr, t1, t2, N } = F;
    const gaps = [];
    for (const g of a.fvg) if (g.dir !== s && g.filledAt == null) gaps.push({ kind: 'FVG', dir: g.dir, top: g.top, bottom: g.bottom, from: g.i - 1 });
    for (const g of a.gaps) if (g.filledAt == null && g.dir !== s) gaps.push({ kind: 'GAP', dir: g.dir, top: g.top, bottom: g.bottom, from: g.i, pct: g.pct });
    const ahead = gaps.map((g) => ({ g, near: s > 0 ? g.bottom : g.top, far: s > 0 ? g.top : g.bottom }))
      .filter((c) => s * (c.near - entry) > 0.1 * atr && s * (c.far - entry) < Math.max(s * (t1.price - entry) + 0.5 * atr, 3 * atr)).sort((x, y) => s * (x.near - y.near))[0];
    if (!ahead) return null;
    const g = ahead.g;
    let score = 52 + (g.kind === 'GAP' ? 8 : 4) + (a.gapStat && a.gapStat.rate >= 0.6 ? 8 : 0) + (s * (ahead.far - entry) / atr < 1.5 ? 6 : 0);
    const label = g.kind === 'GAP' ? 'open session gap' : 'unfilled ' + (g.dir > 0 ? 'bullish' : 'bearish') + ' gap (FVG)';
    const beyond = s * (t1.price - ahead.far) > 0.3 * atr;
    const steps = [
      { p: entry, text: 'Entry ' + px(entry) + '. An ' + label + ' sits ahead at ' + px(ahead.near) + ' to ' + px(ahead.far) + '. Price is drawn to gaps the way water is drawn downhill.' },
      { p: ahead.near, text: 'Price reaches the near edge ' + px(ahead.near) + '. Expect a pause: the first touch of a gap often stalls.' },
      { p: ahead.far, text: 'The gap fills to ' + px(ahead.far) + '. ' + (beyond ? 'Trim a piece here; the fill is a natural place for sellers to show up.' : 'This is the target for this idea.').replace('sellers', s > 0 ? 'sellers' : 'buyers') },
      ...(beyond ? [{ p: t1.price, text: 'Continuation to ' + px(t1.price) + ': ' + t1.label + '.' }] : [])
    ];
    return { id: 'gap', title: 'Fill the gap at ' + px(ahead.far), tag: 'GAP FILL', score, steps, zones: [{ kind: g.kind, dir: g.dir, top: g.top, bottom: g.bottom, from: g.from, label }], levels: [], target: beyond ? null : ahead.far,
      teach: ['A gap is a price range where few trades happened. Markets revisit those ranges to find the other side of the order flow.', a.gapStat && fin(a.gapStat.rate) ? 'On this chart ' + Math.round(a.gapStat.rate * 100) + '% of session gaps like this one have filled.' : 'Most ordinary gaps fill; breakaway gaps on big news are the exception.', 'Whether price continues past the fill depends on what is above it: ' + (t1 ? t1.label : 'the next level') + '.'],
      why: 'An ' + label + ' is ' + (s * (ahead.near - entry) / atr).toFixed(1) + ' ATR ahead.' };
  }

  function rangeRotation(F, a, model, mode) {
    const { s, entry, atr, t1, t2 } = F;
    const R = a.range; if (!R || !(R.hi > R.lo)) return null;
    const inZone = s > 0 ? entry <= R.eq : entry >= R.eq;
    if (!inZone) return null;
    const far = s > 0 ? R.hi : R.lo;
    if (s * (far - entry) < 0.8 * atr) return null;
    let score = 50 + (s * (R.eq - entry) / (R.hi - R.lo) > 0.2 ? 14 : 6);
    const vw = a.vwap && a.vwap[F.N - 1];
    if (vw && s * (vw.vwap - entry) > 0 && s * (vw.vwap - entry) < s * (far - entry)) score += 4;
    const steps = [
      { p: entry, text: 'Entry ' + px(entry) + ' in the ' + (s > 0 ? 'discount' : 'premium') + ' half of the range ' + px(R.lo) + ' to ' + px(R.hi) + '. ' + (s > 0 ? 'Buy cheap' : 'Sell dear') + ' is the whole idea.' },
      { p: R.eq, text: 'Rotation to equilibrium ' + px(R.eq) + ', the midpoint. Expect a fight here; it decides whether the range holds.' },
      { p: far, text: 'The far side of the range ' + px(far) + '. Ranges resolve at their edges; this is where the trade is paid.' },
      ...(t1 && s * (t1.price - far) > 0.5 * atr ? [{ p: t1.price, text: 'If the edge breaks: ' + px(t1.price) + ', ' + t1.label + '.' }] : [])
    ];
    return { id: 'range', title: 'Range rotation to ' + px(far), tag: 'RANGE', score, steps, zones: [{ kind: 'RANGE', dir: s, top: s > 0 ? R.eq : R.hi, bottom: s > 0 ? R.lo : R.eq, from: R.fromIdx, label: s > 0 ? 'discount' : 'premium' }],
      levels: [{ price: R.eq, label: 'equilibrium (50%)', kind: 'eq' }, { price: far, label: 'range ' + (s > 0 ? 'high' : 'low'), kind: 'level' }], target: far,
      teach: ['Premium and discount: above the midpoint of the range is expensive, below it is cheap. Institutions buy in discount and sell in premium.', 'Equilibrium is the magnet. A range that has rotated to it several times usually rotates to the other edge next.', 'The stop belongs just beyond the range ' + (s > 0 ? 'low' : 'high') + '; a close outside the range is a different trade.'],
      why: 'Price is ' + Math.round(s * (R.eq - entry) / (R.hi - R.lo) * 200) + '% of the way into the ' + (s > 0 ? 'discount' : 'premium') + ' half.' };
  }

  function patternMove(F, a, model, mode) {
    const { s, entry, atr, t1 } = F;
    const pat = F.pats.filter((c) => fin(c.target) && s * (c.target - entry) > 0.5 * atr).sort((x, y) => y.confidence - x.confidence)[0];
    if (!pat) return null;
    const trigger = pat.neckline != null ? pat.neckline : pat.level;
    let score = 50 + Math.round(pat.confidence * 28) + (pat.status === 'confirmed' ? 8 : 0);
    const steps = [
      { p: entry, text: 'Entry ' + px(entry) + '. A ' + pat.name.toLowerCase() + ' is ' + pat.status + ' on this chart (' + Math.round(pat.confidence * 100) + '% fit).' },
      ...(fin(trigger) && s * (trigger - entry) > 0.1 * atr ? [{ p: trigger, text: 'Trigger ' + px(trigger) + ': the neckline. A close through it completes the pattern.' }] : []),
      { p: pat.target, text: 'Measured move ' + px(pat.target) + ': the height of the pattern projected from the break. Textbook target.' }
    ];
    return { id: 'pattern', title: pat.name + ' measured move', tag: 'PATTERN', score, steps, zones: [], levels: fin(trigger) ? [{ price: trigger, label: pat.name + ' trigger', kind: 'level' }] : [], target: pat.target, patternId: pat.id,
      teach: ['The measured move is the pattern\'s height added to the breakout point. It is where enough of the crowd takes profit to matter.', pat.note || 'The pattern only counts once a candle closes through the trigger.', fin(pat.invalidation) ? 'A close ' + (s > 0 ? 'below' : 'above') + ' ' + px(pat.invalidation) + ' fails the pattern.' : 'A close back inside the pattern after the break fails it.'],
      why: pat.name + ' ' + pat.status + ' at ' + Math.round(pat.confidence * 100) + '% fit.' };
  }

  function vwapHold(F, a, model, mode) {
    const { s, entry, atr, t1, t2, N } = F;
    if (!a.intraday) return null;
    const vw = a.vwap && a.vwap[N - 1]; if (!vw || !(vw.sd > 0)) return null;
    const dist = Math.abs(entry - vw.vwap) / atr; if (dist > 2.5) return null;
    const above = s * (entry - vw.vwap) >= 0;
    let score = 52 + (above ? 12 : 2) + (dist < 0.6 ? 8 : 0);
    const b1 = vw.vwap + s * vw.sd, b2 = vw.vwap + s * 2 * vw.sd;
    const steps = [
      { p: entry, text: 'Entry ' + px(entry) + ', ' + (above ? 'on the right side of' : 'just across from') + ' VWAP ' + px(vw.vwap) + '. Day traders and algos anchor to VWAP; it is the fair price of the session.' },
      { p: vw.vwap, text: (above ? 'Test of VWAP ' : 'Reclaim of VWAP ') + px(vw.vwap) + ' and a hold ' + (s > 0 ? 'above' : 'below') + ' it. The hold is the signal, not the touch.' },
      { p: b1, text: 'First band ' + px(b1) + ' (one standard deviation): the usual stretch of a session move. Book a piece.' },
      { p: b2, text: 'Second band ' + px(b2) + ': the extended move. Trail the rest; reversions from here are sharp.' }
    ];
    return { id: 'vwap', title: 'VWAP ' + (above ? 'hold' : 'reclaim') + ' to the bands', tag: 'VWAP', score, steps, zones: [], levels: [{ price: vw.vwap, label: 'VWAP', kind: 'vwap' }, { price: b1, label: '+1σ', kind: 'vwap' }, { price: b2, label: '+2σ', kind: 'vwap' }].map((l) => (s < 0 ? Object.assign(l, { label: l.label.replace('+', '−') }) : l)), target: b2,
      teach: ['VWAP is the average price paid today, weighted by volume. Above it buyers are winning the day; below it sellers are.', 'The bands are one and two standard deviations of that average: most of a session\'s range lives inside them.', 'A VWAP trade is a session trade: it does not carry overnight.'],
      why: 'Price is ' + dist.toFixed(1) + ' ATR from VWAP and ' + (above ? 'holding the right side' : 'about to test it') + '.' };
  }

  /* ---- always-available ideas: they only need swings and the averages, so a thin chart still gets five ---- */
  function measuredRun(F, a, model, mode) {
    const { s, entry, atr, t1, t2 } = F;
    const pause = (s > 0 ? a.pivots.highs : a.pivots.lows).slice(-5).map((p) => p.price).filter((p) => s * (p - entry) > 0.3 * atr && s * (t1.price - p) > 0.3 * atr).sort((x, y) => s * (x - y))[0];
    let score = 44 + (model && (s > 0 ? model.bias === 'long' : model.bias === 'short') ? 10 : 0) + (a.structure.trend === s ? 6 : -4);
    const steps = [
      { p: entry, text: 'Entry ' + px(entry) + '. The simplest read: momentum carries price straight toward the next objective.' },
      ...(pause ? [{ p: pause, text: 'A pause at the prior swing ' + (s > 0 ? 'high ' : 'low ') + px(pause) + '. Some sellers show up at an old ceiling; the move needs to absorb them.'.replace('sellers', s > 0 ? 'sellers' : 'buyers').replace('ceiling', s > 0 ? 'ceiling' : 'floor') }] : []),
      { p: t1.price, text: 'First target ' + px(t1.price) + ': ' + t1.label + '.' },
      ...(t2 ? [{ p: t2.price, text: 'Second target ' + px(t2.price) + ': ' + t2.label + '.' }] : [])
    ];
    return { id: 'run', title: 'Momentum run to ' + px(t1.price), tag: 'MOMENTUM', score, steps, zones: [], levels: pause ? [{ price: pause, label: 'prior swing ' + (s > 0 ? 'high' : 'low'), kind: 'swing' }] : [],
      teach: ['The target is where the next real sellers (or buyers) live: an old swing, a pile of stops, or the measured distance the stock usually travels.', 'Momentum ideas pay fast or not at all: if price has not moved within a few candles, the read is wrong.', 'Scale out at the first objective; let the remainder work with the stop at break-even.'],
      why: 'Needs nothing but momentum' + (a.structure.trend === s ? ' and the structure is already trending this way.' : '; the structure is not yet trending this way.') };
  }

  function swingRetest(F, a, model, mode) {
    const { s, entry, stop, atr, t1, t2 } = F;
    const reach = (p) => s * (entry - p) > 0.25 * atr && s * (entry - p) < 4 * atr;
    const sw = (s > 0 ? a.pivots.lows : a.pivots.highs).slice(-5).map((p) => p.price).filter(reach).sort((x, y) => s * (y - x))[0];
    const slow = model && model.ind && fin(model.ind.slow[F.N - 1]) ? model.ind.slow[F.N - 1] : null;
    const recent = F.bars ? (s > 0 ? Math.min(...F.bars.slice(-10).map((b) => b.l)) : Math.max(...F.bars.slice(-10).map((b) => b.h))) : null;
    const level = sw != null ? sw : (slow != null && reach(slow) ? slow : (recent != null && reach(recent) ? recent : null));
    if (level == null) return null;
    const what = sw != null ? 'last swing ' + (s > 0 ? 'low' : 'high') : (level === slow ? 'slow EMA' : 'recent ' + (s > 0 ? 'low' : 'high'));
    /* the model's stop may sit inside the level; this idea needs its stop beyond the level it retests */
    const ownStop = s * (level - stop) > 0.1 * atr ? stop : level - s * 0.35 * atr;
    let score = 46 + (s * (entry - level) / atr < 1.5 ? 8 : 2) + (slow != null && Math.abs(slow - level) < 0.6 * atr ? 8 : 0) + (ownStop === stop ? 0 : -6);
    const steps = [
      { p: entry, text: 'Entry ' + px(entry) + ', with the ' + what + ' at ' + px(level) + ' underneath as the floor.'.replace('underneath as the floor', s > 0 ? 'underneath as the floor' : 'overhead as the ceiling') },
      { p: level, text: 'The deeper retest: price revisits ' + px(level) + ' and holds on a closing basis. Higher low confirmed.'.replace('Higher low', s > 0 ? 'Higher low' : 'Lower high') },
      { p: entry + s * 0.3 * atr, text: 'Back through the entry with momentum: the retest brought in the buyers.'.replace('buyers', s > 0 ? 'buyers' : 'sellers') },
      { p: t1.price, text: 'First target ' + px(t1.price) + ': ' + t1.label + '.' },
      ...(t2 ? [{ p: t2.price, text: 'Second target ' + px(t2.price) + ': ' + t2.label + '.' }] : [])
    ];
    return { id: 'retest', title: 'Retest the ' + what + ', then go', tag: 'RETEST', score, stop: ownStop, steps, zones: [], levels: [{ price: level, label: what, kind: sw != null ? 'swing' : 'ema' }],
      teach: ['A higher low is the definition of an uptrend. Waiting for the retest costs a little upside and removes most of the risk.'.replace('higher low', s > 0 ? 'higher low' : 'lower high').replace('uptrend', s > 0 ? 'uptrend' : 'downtrend'), 'The stop belongs just beyond the retested level (' + px(ownStop) + ').', 'If the level breaks on a close, the trend has changed; do not argue with it.'],
      why: 'The ' + what + ' is ' + (s * (entry - level) / atr).toFixed(1) + ' ATR ' + (s > 0 ? 'below' : 'above') + ' price.' };
  }

  function emaTag(F, a, model, mode) {
    const { s, entry, stop, atr, t1, t2, N } = F;
    const slow = model && model.ind && fin(model.ind.slow[N - 1]) ? model.ind.slow[N - 1] : null;
    const trend = model && model.ind && fin(model.ind.trend[N - 1]) ? model.ind.trend[N - 1] : null;
    const fast = model && model.ind && fin(model.ind.fast[N - 1]) ? model.ind.fast[N - 1] : null;
    const usable = (p) => p != null && s * (entry - p) > 0.4 * atr && s * (entry - p) < 4 * atr;
    const line = usable(slow) ? { p: slow, name: 'slow EMA' } : (usable(trend) ? { p: trend, name: 'trend EMA' } : (usable(fast) ? { p: fast, name: 'fast EMA' } : null));
    if (!line) return null;
    const ownStop = s * (line.p - stop) > 0.1 * atr ? stop : line.p - s * 0.4 * atr;
    let score = 42 + (s * (entry - line.p) / atr < 2 ? 8 : 0) + (model && (s > 0 ? model.bias === 'long' : model.bias === 'short') ? 6 : 0) + (ownStop === stop ? 0 : -6);
    const steps = [
      { p: entry, text: 'Entry ' + px(entry) + '. Price is stretched ' + (s * (entry - line.p) / atr).toFixed(1) + ' ATR from the ' + line.name + ' (' + px(line.p) + ').' },
      { p: line.p, text: 'Mean reversion: a tag of the ' + line.name + ' at ' + px(line.p) + '. The average is where the trend buyers reload.'.replace('buyers', s > 0 ? 'buyers' : 'sellers') },
      { p: entry, text: 'Recovery through the entry ' + px(entry) + '. The tag was the reset, not the end.' },
      { p: t1.price, text: 'First target ' + px(t1.price) + ': ' + t1.label + '.' },
      ...(t2 ? [{ p: t2.price, text: 'Second target ' + px(t2.price) + ': ' + t2.label + '.' }] : [])
    ];
    return { id: 'ema', title: 'Tag the ' + line.name + ', then resume', tag: 'EMA TAG', score, stop: ownStop, steps, zones: [], levels: [{ price: line.p, label: line.name, kind: 'ema' }],
      teach: ['Moving averages are the trend\'s fair value. Price oscillates around them; stretched moves snap back to them before continuing.', 'MEM ALGO itself fires on the averages; a tag and resume keeps the model\'s read intact.', 'A close on the wrong side of the ' + line.name + ' is the first warning; the stop (' + px(ownStop) + ') is the last.'],
      why: 'Price is ' + (s * (entry - line.p) / atr).toFixed(1) + ' ATR from the ' + line.name + '.' };
  }

  function stairStep(F, a, model, mode) {
    const { s, entry, atr, t1, t2 } = F;
    const beyond = t2 ? t2.price : t1.price + s * Math.max(1.5 * atr, 0.5 * Math.abs(t1.price - entry));
    const base = t1.price - s * Math.min(0.6 * atr, 0.35 * Math.abs(t1.price - entry));
    let score = 40 + (t2 ? 8 : 0) + (a.structure.trend === s ? 6 : 0);
    const steps = [
      { p: entry, text: 'Entry ' + px(entry) + '. Trends climb like stairs: a push, a flat step, another push.' },
      { p: t1.price, text: 'First push to ' + px(t1.price) + ' (' + t1.label + '). Take a piece here.' },
      { p: base, text: 'The step: a tight consolidation just under ' + px(t1.price) + '. Small candles, shrinking range, no close back through ' + px(base) + '.' },
      { p: beyond, text: 'Second push to ' + px(beyond) + (t2 ? ' (' + t2.label + ')' : ', the measured extension') + '. The runner pays here.' }
    ];
    return { id: 'stairs', title: 'Stair-step to ' + px(beyond), tag: 'STAIRS', score, steps, zones: [], levels: [{ price: t1.price, label: 'step: ' + t1.label, kind: 'level' }], target: beyond,
      teach: ['A tight flag or box right under a level means buyers are holding their gains; the second push usually comes from there.'.replace('buyers', s > 0 ? 'buyers' : 'sellers'), 'Move the stop under the step once it forms; the trade is then free.'.replace('under', s > 0 ? 'under' : 'over'), 'A close back through the step cancels the second push: take what the first one gave.'],
      why: 'Two objectives in the way, ' + px(t1.price) + ' then ' + px(beyond) + '.' };
  }

  const TEMPLATES = [continuation, pullback, sweep, breakout, gapFill, rangeRotation, patternMove, vwapHold, measuredRun, swingRetest, emaTag, stairStep];

  function build({ bars: raw, mode = 'day', analysis, model = null, patterns = null, params = null, top = 5 } = {}) {
    const bars = (raw || []).filter((b) => b && [b.o, b.h, b.l, b.c].every(fin));
    if (bars.length < 40 || !analysis) return { ok: false, reason: 'not_enough_data', scenarios: [] };
    const H = HORIZON[mode] || HORIZON.swing;
    const F = frame({ bars, mode, analysis, model, patterns, params });
    const a = analysis, N = bars.length, i0 = N - 1, future = H.future, iEnd = i0 + future;
    const cands = [];
    for (const t of TEMPLATES) { let sc = null; try { sc = t(F, a, model, mode, patterns); } catch (_) { sc = null; } if (sc) cands.push(sc); }
    cands.sort((x, y) => y.score - x.score);
    const out = cands.slice(0, top).map((sc, rank) => {
      const stop = fin(sc.stop) ? sc.stop : F.stop;
      const target = fin(sc.target) ? sc.target : F.t1.price;
      const risk = Math.abs(F.entry - stop), reward = Math.abs(target - F.entry);
      /* waypoints spread over the horizon; the path returns to the entry level when a step says "reclaim" */
      const steps = sc.steps.filter((s2) => fin(s2.p));
      const way = steps.map((s2, k) => ({ i: k === 0 ? i0 : i0 + Math.round(future * (k / (steps.length - 1))), p: s2.p, n: k + 1, text: s2.text }));
      const path = pathOf(way.map((w) => ({ i: w.i, p: w.p })), F.atr, sc.id === 'sweep' ? 0.2 : 0.3);
      const fit = Math.max(5, Math.min(97, Math.round(sc.score)));
      return {
        id: sc.id, rank: rank + 1, title: sc.title, tag: sc.tag, fit, side: F.side, mode, horizonLabel: H.label,
        entry: r2(F.entry), stop: r2(stop), target: r2(target), target2: F.t2 && s2ok(F, target) ? r2(F.t2.price) : null,
        rr: risk > 0 ? r2(reward / risk) : null, atr: r2(F.atr),
        window: { i0, iEnd, future, count: N },
        path, steps: way, zones: sc.zones || [], levels: (sc.levels || []).map((l) => Object.assign({}, l, { price: r2(l.price) })),
        invalidation: { price: r2(stop), text: 'A close ' + (F.s > 0 ? 'below ' : 'above ') + px(stop) + ' invalidates this scenario.' + (sc.id === 'sweep' ? ' (The stop sits beyond the liquidity pool on purpose.)' : (fin(sc.stop) && sc.stop !== F.stop ? ' (This idea needs a wider stop than MEM ALGO\'s ' + px(F.stop) + '.)' : '')) },
        teach: sc.teach || [], why: sc.why || '', patternId: sc.patternId || null,
        options: Object.assign({ side: F.s > 0 ? 'calls' : 'puts' }, H.options),
        summary: sc.steps[0].text.replace(/^Entry [0-9.]+[.:]?\s*/, '')
      };
    });
    return { ok: out.length > 0, side: F.side, mode, entry: r2(F.entry), stop: r2(F.stop), atr: r2(F.atr), t1: F.t1, t2: F.t2, considered: cands.length, scenarios: out };
  }
  function s2ok(F, target) { return F.t2 && F.s * (F.t2.price - target) > 0.3 * F.atr; }

  return { build, frame, HORIZON, TEMPLATES: TEMPLATES.map((t) => t.name) };
});
