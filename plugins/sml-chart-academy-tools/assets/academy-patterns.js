'use strict';

/*
 * SML PATTERNS - rule-based candlestick and chart-pattern detector for the Academy Live Chart Lab.
 *
 * Educational annotation only. Every detection satisfies explicit, ATR-relative numeric rules; nothing is fitted to "look right".
 * Works in node (module.exports) and in the browser (window.SmlPatterns). No dependencies, ES2019, safe to inline in a script tag.
 *
 * Bars: [{ t (ms), o, h, l, c, v }] oldest first, any interval. Bars with non-finite OHLC are ignored; every index in the output
 * refers to the ORIGINAL input array (lines may run past the last bar for projections).
 *
 * How accuracy is kept:
 *  - Swing pivots come from a ZigZag whose reversal threshold is an ATR multiple; only confirmed pivots build structures.
 *  - Chart patterns are evaluated in a "view": the same code detects tops on the raw series and bottoms on the price-flipped series,
 *    so a bullish rule can never differ from its bearish mirror.
 *  - Trendline patterns need >= 2 pivots on each line (>= 5 in total), a bounded fit residual, and price staying inside the channel.
 *  - Status: confirmed = a CLOSE beyond the trigger; failed = a CLOSE beyond the invalidation; forming = complete but untriggered
 *    (and still fresh). Stale unresolved structures are dropped.
 *  - Reversal candlesticks only fire when the 8 bars before the pattern trended the right way (regression slope in ATRs plus R squared).
 */
(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.SmlPatterns = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULTS = {
    atrPeriod: 14, minBars: 20, maxAgeBars: 200, minConfidence: 0.5, minCandleStrength: 0.3,
    pivotAtr: 2, levelPivotAtr: 1.25, maxLevels: 8, includeFailed: true, trendLook: 8
  };

  /* ---------- basics ---------- */
  function num(x) {
    if (x === null || x === undefined || x === '' || typeof x === 'boolean') return NaN;
    const v = typeof x === 'number' ? x : Number(x);
    return Number.isFinite(v) ? v : NaN;
  }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function r4(x) { return Math.round(x * 10000) / 10000; }
  function r6(x) { return Math.round(x * 1000000) / 1000000; }

  function clean(bars) {
    const S = { o: [], h: [], l: [], c: [], v: [], t: [], oi: [], n: 0, hasVol: false };
    if (!Array.isArray(bars)) return S;
    let vols = 0;
    for (let k = 0; k < bars.length; k++) {
      const b = bars[k];
      if (!b || typeof b !== 'object') continue;
      const o = num(b.o), h = num(b.h), l = num(b.l), c = num(b.c);
      if (!(o > 0 && h > 0 && l > 0 && c > 0)) continue;
      S.o.push(o); S.c.push(c);
      S.h.push(Math.max(h, l, o, c)); S.l.push(Math.min(h, l, o, c));
      const v = num(b.v); S.v.push(v > 0 ? v : 0); if (v > 0) vols++;
      const t = num(b.t); S.t.push(Number.isFinite(t) ? t : k);
      S.oi.push(k);
    }
    S.n = S.c.length;
    S.hasVol = S.n > 0 && vols >= 0.8 * S.n;
    return S;
  }

  function atrSeries(h, l, c, period) {
    const n = c.length, out = new Array(n), p = Math.max(1, Math.floor(period) || 14);
    let prev = 0, sum = 0;
    for (let i = 0; i < n; i++) {
      const tr = i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
      if (i < p) { sum += tr; prev = sum / (i + 1); } else prev = (prev * (p - 1) + tr) / p;
      out[i] = Math.max(prev, c[i] * 1e-6, 1e-9);
    }
    return out;
  }

  function regress(y, a, b) {
    const n = b - a + 1;
    if (n < 3) return { slope: 0, r2: 0 };
    let sx = 0, sy = 0;
    for (let i = a; i <= b; i++) { sx += i; sy += y[i]; }
    const mx = sx / n, my = sy / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = a; i <= b; i++) { const dx = i - mx, dy = y[i] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    if (sxx === 0) return { slope: 0, r2: 0 };
    return { slope: sxy / sxx, r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : 0 };
  }

  /* ---------- zigzag pivots ---------- */
  function zigzag(h, l, atrA, mult) {
    const n = h.length, out = [];
    if (n < 3) return out;
    let dir = 0, hiI = 0, loI = 0, ext = 0;
    for (let i = 1; i < n; i++) {
      const thr = mult * atrA[i];
      if (dir === 0) {
        if (h[i] > h[hiI]) hiI = i;
        if (l[i] < l[loI]) loI = i;
        if (h[hiI] - l[loI] >= thr) {
          if (hiI > loI) { out.push({ i: loI, p: l[loI], type: 'L', ok: true }); dir = 1; ext = hiI; }
          else if (loI > hiI) { out.push({ i: hiI, p: h[hiI], type: 'H', ok: true }); dir = -1; ext = loI; }
        }
      } else if (dir === 1) {
        if (h[i] > h[ext]) ext = i;
        else if (h[ext] - l[i] >= thr) { out.push({ i: ext, p: h[ext], type: 'H', ok: true }); dir = -1; ext = i; }
      } else {
        if (l[i] < l[ext]) ext = i;
        else if (h[i] - l[ext] >= thr) { out.push({ i: ext, p: l[ext], type: 'L', ok: true }); dir = 1; ext = i; }
      }
    }
    if (dir === 1) out.push({ i: ext, p: h[ext], type: 'H', ok: false });
    else if (dir === -1) out.push({ i: ext, p: l[ext], type: 'L', ok: false });
    return out;
  }

  /* ---------- public helpers ---------- */
  function atr(bars, period) {
    const S = clean(bars), out = new Array(Array.isArray(bars) ? bars.length : 0).fill(NaN);
    if (!S.n) return out;
    const a = atrSeries(S.h, S.l, S.c, period || 14);
    for (let k = 0; k < S.n; k++) out[S.oi[k]] = a[k];
    return out;
  }

  function pivots(bars, opts) {
    const o = opts || {}, S = clean(bars);
    if (S.n < 3) return [];
    const a = atrSeries(S.h, S.l, S.c, o.atrPeriod || 14);
    let mult = num(o.atrMult); if (!(mult > 0)) mult = DEFAULTS.pivotAtr;
    let z = zigzag(S.h, S.l, a, mult);
    if (o.confirmedOnly) z = z.filter(p => p.ok);
    return z.map(p => ({ i: S.oi[p.i], t: S.t[p.i], p: p.p, type: p.type === 'H' ? 'high' : 'low', confirmed: p.ok }));
  }

  /* ---------- candlesticks ---------- */
  function trendBefore(S, atrA, f, look) {
    const L = look || 8;
    if (f < 5) return { dir: 'flat', strength: 0, net: 0 };
    const a = Math.max(0, f - L), b = f - 1;
    const r = regress(S.c, a, b);
    const net = r.slope * (b - a) / atrA[Math.max(0, f - 1)];
    const strength = clamp(Math.abs(net) / 4, 0, 1) * (0.5 + 0.5 * r.r2);
    if (net >= 1.5 && r.r2 >= 0.4) return { dir: 'up', strength, net };
    if (net <= -1.5 && r.r2 >= 0.4) return { dir: 'down', strength, net };
    return { dir: 'flat', strength: 0, net };
  }

  const CANDLE_LABEL = {
    doji: 'Doji', dragonfly_doji: 'Dragonfly Doji', gravestone_doji: 'Gravestone Doji', long_legged_doji: 'Long-Legged Doji',
    hammer: 'Hammer', inverted_hammer: 'Inverted Hammer', hanging_man: 'Hanging Man', shooting_star: 'Shooting Star',
    bullish_marubozu: 'Bullish Marubozu', bearish_marubozu: 'Bearish Marubozu', spinning_top: 'Spinning Top',
    bullish_engulfing: 'Bullish Engulfing', bearish_engulfing: 'Bearish Engulfing', piercing_line: 'Piercing Line',
    dark_cloud_cover: 'Dark Cloud Cover', bullish_harami: 'Bullish Harami', bearish_harami: 'Bearish Harami',
    bullish_harami_cross: 'Bullish Harami Cross', bearish_harami_cross: 'Bearish Harami Cross', tweezer_top: 'Tweezer Top',
    tweezer_bottom: 'Tweezer Bottom', morning_star: 'Morning Star', evening_star: 'Evening Star',
    morning_doji_star: 'Morning Doji Star', evening_doji_star: 'Evening Doji Star', three_white_soldiers: 'Three White Soldiers',
    three_black_crows: 'Three Black Crows', three_inside_up: 'Three Inside Up', three_inside_down: 'Three Inside Down',
    rising_three_methods: 'Rising Three Methods', falling_three_methods: 'Falling Three Methods'
  };

  function detectCandles(S, A, opts) {
    const out = [], n = S.n, o = S.o, h = S.h, l = S.l, c = S.c;
    const first = Math.max(9, n - Math.floor(opts.maxAgeBars));
    const body = i => Math.abs(c[i] - o[i]);
    const rng = i => h[i] - l[i];
    const upS = i => h[i] - Math.max(o[i], c[i]);
    const loS = i => Math.min(o[i], c[i]) - l[i];
    const bull = i => c[i] > o[i];
    const bear = i => c[i] < o[i];
    const top = i => Math.max(o[i], c[i]);
    const bot = i => Math.min(o[i], c[i]);
    const tr = f => trendBefore(S, A, f, opts.trendLook);

    for (let i = first; i < n; i++) {
      const a = A[i - 1];
      const push = (name, dir, quality, tre, bars, note) => {
        const strength = clamp(0.35 + 0.25 * (tre ? tre.strength : 0) + 0.4 * clamp(quality, 0, 1), 0, 1);
        if (strength >= opts.minCandleStrength) out.push({ i, name, dir, strength: r4(strength), bars, note });
      };
      const r = rng(i), b = body(i);
      // ---- single candle ----
      if (r > 0 && r >= 0.5 * a) {
        const tI = tr(i);
        if (b <= 0.1 * r) {
          const u = upS(i), lo = loS(i);
          if (u <= 0.1 * r && lo >= 0.6 * r) push('dragonfly_doji', tI.dir === 'down' ? 'bull' : 'neutral', lo / r, tI, [i, i], 'Open, high and close together with a long lower shadow: sellers pushed down and were rejected.');
          else if (lo <= 0.1 * r && u >= 0.6 * r) push('gravestone_doji', tI.dir === 'up' ? 'bear' : 'neutral', u / r, tI, [i, i], 'Open, low and close together with a long upper shadow: buyers pushed up and were rejected.');
          else if (u >= 0.3 * r && lo >= 0.3 * r && r >= 0.8 * a) push('long_legged_doji', 'neutral', Math.min(u, lo) / r * 2, null, [i, i], 'Long shadows both ways and no body: strong indecision.');
          else push('doji', 'neutral', 0.4, null, [i, i], 'Open and close nearly equal: indecision.');
        } else if (r >= 0.7 * a) {
          const u = upS(i), lo = loS(i);
          if (lo >= Math.max(2 * b, 0.55 * r) && u <= 0.15 * r) {
            if (tI.dir === 'down') push('hammer', 'bull', 0.5 + 0.5 * clamp(lo / (3 * b), 0, 1) - (bear(i) ? 0.1 : 0), tI, [i, i], 'Small body at the top with a long lower shadow after a decline: sellers were rejected.');
            else if (tI.dir === 'up') push('hanging_man', 'bear', 0.5 + 0.5 * clamp(lo / (3 * b), 0, 1) - (bull(i) ? 0.1 : 0), tI, [i, i], 'Hammer-shaped candle after a rally: a warning that sellers are testing the trend.');
          } else if (u >= Math.max(2 * b, 0.55 * r) && lo <= 0.15 * r) {
            if (tI.dir === 'down') push('inverted_hammer', 'bull', 0.5 + 0.5 * clamp(u / (3 * b), 0, 1), tI, [i, i], 'Long upper shadow after a decline: buyers tried to reverse; needs a bullish follow-through.');
            else if (tI.dir === 'up') push('shooting_star', 'bear', 0.5 + 0.5 * clamp(u / (3 * b), 0, 1) - (bull(i) ? 0.1 : 0), tI, [i, i], 'Long upper shadow after a rally: buyers were rejected at the high.');
          } else if (b <= 0.3 * r && u >= 0.25 * r && lo >= 0.25 * r) {
            push('spinning_top', 'neutral', 0.4, null, [i, i], 'Small body with shadows both ways: momentum is stalling.');
          }
        }
        if (b >= 0.9 * r && b >= 1.0 * a) {
          push(bull(i) ? 'bullish_marubozu' : 'bearish_marubozu', bull(i) ? 'bull' : 'bear', clamp(b / (2 * a), 0, 1), null, [i, i], 'Full-bodied candle with almost no shadows: one side controlled the whole bar.');
        }
      }
      if (i < 1) continue;
      const p = i - 1;
      const bP = body(p), rP = rng(p);
      // ---- two candle ----
      {
        const tI = tr(p);
        if (bP >= 0.4 * a && b >= 0.7 * a && b >= 1.15 * bP) {
          if (tI.dir === 'down' && bear(p) && bull(i) && o[i] <= c[p] && c[i] >= o[p] && (o[i] < c[p] || c[i] > o[p])) push('bullish_engulfing', 'bull', clamp(b / bP / 2.5, 0.3, 1), tI, [p, i], 'A bullish body fully wraps the prior bearish body after a decline.');
          if (tI.dir === 'up' && bull(p) && bear(i) && o[i] >= c[p] && c[i] <= o[p] && (o[i] > c[p] || c[i] < o[p])) push('bearish_engulfing', 'bear', clamp(b / bP / 2.5, 0.3, 1), tI, [p, i], 'A bearish body fully wraps the prior bullish body after a rally.');
        }
        if (bP >= 0.8 * a && bP >= 0.6 * rP) {
          const mid = (o[p] + c[p]) / 2;
          if (tI.dir === 'down' && bear(p) && bull(i) && o[i] < c[p] && c[i] > mid && c[i] < o[p] && b >= 0.4 * a) push('piercing_line', 'bull', 0.5 + 0.5 * clamp((c[i] - mid) / (bP / 2), 0, 1) - (o[i] < l[p] ? 0 : 0.15), tI, [p, i], 'Opens below the prior close and recovers past the midpoint of the prior bearish body.');
          if (tI.dir === 'up' && bull(p) && bear(i) && o[i] > c[p] && c[i] < mid && c[i] > o[p] && b >= 0.4 * a) push('dark_cloud_cover', 'bear', 0.5 + 0.5 * clamp((mid - c[i]) / (bP / 2), 0, 1) - (o[i] > h[p] ? 0 : 0.15), tI, [p, i], 'Opens above the prior close and falls past the midpoint of the prior bullish body.');
          if (top(i) <= top(p) && bot(i) >= bot(p) && b <= 0.5 * bP) {
            const isCross = b <= 0.1 * r && r > 0;
            if (tI.dir === 'down' && bear(p) && (isCross || bull(i))) push(isCross ? 'bullish_harami_cross' : 'bullish_harami', 'bull', 0.5 + 0.5 * (1 - b / bP), tI, [p, i], 'A small candle sits inside the prior long bearish body: the decline is losing force.');
            if (tI.dir === 'up' && bull(p) && (isCross || bear(i))) push(isCross ? 'bearish_harami_cross' : 'bearish_harami', 'bear', 0.5 + 0.5 * (1 - b / bP), tI, [p, i], 'A small candle sits inside the prior long bullish body: the advance is losing force.');
          }
        }
        if (bP >= 0.25 * a && b >= 0.25 * a) {
          if (tI.dir === 'up' && bull(p) && bear(i) && Math.abs(h[p] - h[i]) <= 0.1 * a) push('tweezer_top', 'bear', 0.6 + 0.4 * (1 - Math.abs(h[p] - h[i]) / (0.1 * a)), tI, [p, i], 'Two candles topping at the same high: the level was rejected twice.');
          if (tI.dir === 'down' && bear(p) && bull(i) && Math.abs(l[p] - l[i]) <= 0.1 * a) push('tweezer_bottom', 'bull', 0.6 + 0.4 * (1 - Math.abs(l[p] - l[i]) / (0.1 * a)), tI, [p, i], 'Two candles bottoming at the same low: the level held twice.');
        }
      }
      if (i < 2) continue;
      const f = i - 2, m = i - 1, tF = tr(f);
      const b1 = body(f), r1 = rng(f), b2 = body(m), r2 = rng(m);
      // ---- three candle ----
      if (b1 >= 0.8 * a && b1 >= 0.6 * r1 && b2 <= 0.35 * b1 && b2 <= 0.4 * a && b >= 0.6 * a) {
        const mid1 = (o[f] + c[f]) / 2, doji2 = r2 > 0 && b2 <= 0.1 * r2;
        if (tF.dir === 'down' && bear(f) && bull(i) && top(m) <= c[f] + 0.1 * a && c[i] > mid1) push(doji2 ? 'morning_doji_star' : 'morning_star', 'bull', 0.5 + 0.5 * clamp((c[i] - mid1) / (b1 / 2), 0, 1), tF, [f, i], 'Long bearish candle, a small indecision candle below it, then a bullish candle closing past the first midpoint.');
        if (tF.dir === 'up' && bull(f) && bear(i) && bot(m) >= c[f] - 0.1 * a && c[i] < mid1) push(doji2 ? 'evening_doji_star' : 'evening_star', 'bear', 0.5 + 0.5 * clamp((mid1 - c[i]) / (b1 / 2), 0, 1), tF, [f, i], 'Long bullish candle, a small indecision candle above it, then a bearish candle closing past the first midpoint.');
      }
      {
        const strong = k => body(k) >= 0.6 * a && body(k) >= 0.6 * rng(k);
        if (tF.dir !== 'up' && bull(f) && bull(m) && bull(i) && strong(f) && strong(m) && strong(i) && o[m] >= o[f] && o[m] <= c[f] && o[i] >= o[m] && o[i] <= c[m] && c[m] > c[f] && c[i] > c[m] && upS(f) <= 0.3 * body(f) && upS(m) <= 0.3 * body(m) && upS(i) <= 0.3 * body(i)) push('three_white_soldiers', 'bull', 0.6, tF.dir === 'down' ? tF : null, [f, i], 'Three strong bullish candles, each opening inside the last body and closing at a higher high.');
        if (tF.dir !== 'down' && bear(f) && bear(m) && bear(i) && strong(f) && strong(m) && strong(i) && o[m] <= o[f] && o[m] >= c[f] && o[i] <= o[m] && o[i] >= c[m] && c[m] < c[f] && c[i] < c[m] && loS(f) <= 0.3 * body(f) && loS(m) <= 0.3 * body(m) && loS(i) <= 0.3 * body(i)) push('three_black_crows', 'bear', 0.6, tF.dir === 'up' ? tF : null, [f, i], 'Three strong bearish candles, each opening inside the last body and closing at a lower low.');
      }
      if (b1 >= 0.8 * a && b1 >= 0.6 * r1 && b2 <= 0.6 * b1) {
        if (tF.dir === 'down' && bear(f) && bull(m) && bot(m) >= c[f] && top(m) <= o[f] && bull(i) && c[i] > o[f] && b >= 0.4 * a) push('three_inside_up', 'bull', 0.6 + 0.4 * clamp((c[i] - o[f]) / a, 0, 1), tF, [f, i], 'Bullish harami followed by a close above the first candle open: the reversal is confirmed.');
        if (tF.dir === 'up' && bull(f) && bear(m) && bot(m) >= o[f] && top(m) <= c[f] && bear(i) && c[i] < o[f] && b >= 0.4 * a) push('three_inside_down', 'bear', 0.6 + 0.4 * clamp((o[f] - c[i]) / a, 0, 1), tF, [f, i], 'Bearish harami followed by a close below the first candle open: the reversal is confirmed.');
      }
      if (i < 4) continue;
      // ---- five candle continuation ----
      {
        const f5 = i - 4, t5 = tr(f5), b5 = body(f5), r5 = rng(f5);
        if (b5 >= 0.9 * a && b5 >= 0.6 * r5 && b >= 0.6 * a) {
          let inside = true, counter = 0, small = true;
          for (let k = f5 + 1; k <= f5 + 3; k++) {
            if (h[k] > h[f5] || l[k] < l[f5]) inside = false;
            if (body(k) > 0.6 * b5) small = false;
          }
          if (inside && small) {
            for (let k = f5 + 1; k <= f5 + 3; k++) { if (bear(k)) counter++; }
            let cb = 0; for (let k = f5 + 1; k <= f5 + 3; k++) { if (bull(k)) cb++; }
            if (t5.dir === 'up' && bull(f5) && counter >= 2 && bull(i) && c[i] > c[f5]) push('rising_three_methods', 'bull', 0.6, t5, [f5, i], 'A long bullish candle, three small pullback candles held inside its range, then a new high close.');
            if (t5.dir === 'down' && bear(f5) && cb >= 2 && bear(i) && c[i] < c[f5]) push('falling_three_methods', 'bear', 0.6, t5, [f5, i], 'A long bearish candle, three small bounce candles held inside its range, then a new low close.');
          }
        }
      }
    }
    return out;
  }

  /* ---------- pivot views ---------- */
  function fitLine(pts) {
    const n = pts.length;
    let mx = 0, my = 0;
    for (let k = 0; k < n; k++) { mx += pts[k].i; my += pts[k].p; }
    mx /= n; my /= n;
    let sxx = 0, sxy = 0;
    for (let k = 0; k < n; k++) { const dx = pts[k].i - mx; sxx += dx * dx; sxy += dx * (pts[k].p - my); }
    const s = sxx > 0 ? sxy / sxx : 0;
    let res = 0;
    for (let k = 0; k < n; k++) res = Math.max(res, Math.abs(pts[k].p - (my + s * (pts[k].i - mx))));
    return { s, mx, my, res, at: x => my + s * (x - mx) };
  }

  function makeView(S, A, P, sgn) {
    const V = { n: S.n, sgn, atr: A, v: S.v, hasVol: S.hasVol };
    if (sgn > 0) { V.h = S.h; V.l = S.l; V.c = S.c; V.o = S.o; }
    else { V.h = S.l.map(x => -x); V.l = S.h.map(x => -x); V.c = S.c.map(x => -x); V.o = S.o.map(x => -x); }
    V.P = P.filter(p => p.ok).map(p => ({ i: p.i, p: sgn * p.p, type: sgn > 0 ? p.type : (p.type === 'H' ? 'L' : 'H') }));
    V.pk = sgn > 0 ? 'Peak' : 'Trough';
    V.tr = sgn > 0 ? 'Trough' : 'Peak';
    return V;
  }

  const META = {
    dtop: { id: ['double_top', 'double_bottom'], name: ['Double Top', 'Double Bottom'], dir: ['bear', 'bull'] },
    ttop: { id: ['triple_top', 'triple_bottom'], name: ['Triple Top', 'Triple Bottom'], dir: ['bear', 'bull'] },
    hs: { id: ['head_and_shoulders', 'inverse_head_and_shoulders'], name: ['Head and Shoulders', 'Inverse Head and Shoulders'], dir: ['bear', 'bull'] },
    tri: { id: ['ascending_triangle', 'descending_triangle'], name: ['Ascending Triangle', 'Descending Triangle'], dir: ['bull', 'bear'] },
    wedge: { id: ['rising_wedge', 'falling_wedge'], name: ['Rising Wedge', 'Falling Wedge'], dir: ['bear', 'bull'] },
    flag: { id: ['bull_flag', 'bear_flag'], name: ['Bull Flag', 'Bear Flag'], dir: ['bull', 'bear'] },
    pennant: { id: ['bull_pennant', 'bear_pennant'], name: ['Bull Pennant', 'Bear Pennant'], dir: ['bull', 'bear'] },
    sym: { id: ['symmetrical_triangle', 'symmetrical_triangle'], name: ['Symmetrical Triangle', 'Symmetrical Triangle'], dir: ['neutral', 'neutral'] },
    rect: { id: ['rectangle', 'rectangle'], name: ['Rectangle', 'Rectangle'], dir: ['neutral', 'neutral'] }
  };

  // Convert a view-space raw pattern into a real-space chart entry (still in clean-index space).
  function finish(V, r, out) {
    const k = V.sgn > 0 ? 0 : 1, M = META[r.kind], sg = V.sgn;
    const swap = role => sg > 0 ? role : (role === 'upper' ? 'lower' : role === 'lower' ? 'upper' : role);
    const pv = x => (x === null || x === undefined) ? null : r6(x * sg);
    out.push({
      type: M.id[k], name: M.name[k], dir: r.dir || M.dir[k], status: r.status, confidence: clamp(r.conf, 0, 1),
      startIdx: r.start, endIdx: r.end, breakIdx: r.brk === undefined ? -1 : r.brk,
      points: r.points.map(q => ({ i: q.i, p: pv(q.p), label: q.label })),
      lines: r.lines.map(q => ({ i1: q.i1, p1: pv(q.p1), i2: q.i2, p2: pv(q.p2), role: swap(q.role) })),
      level: pv(r.level), neckline: pv(r.neckline), target: pv(r.target), invalidation: pv(r.invalidation),
      note: r.note, _stale: r.stale
    });
  }

  // first trigger close / invalidation close scanning forward; a later invalidation after a trigger turns it into "failed"
  function scan(V, from, trig, inv, until) {
    const end = until === undefined ? V.n - 1 : Math.min(V.n - 1, Math.round(until));
    let t = -1;
    for (let j = from; j <= end; j++) {
      if (inv(j)) return { status: 'failed', idx: j };
      if (trig(j)) { t = j; break; }
    }
    if (t < 0) return end < V.n - 1 ? { status: 'expired', idx: -1 } : { status: 'forming', idx: -1 };
    for (let j = t + 1; j < V.n; j++) if (inv(j)) return { status: 'failed', idx: j, trigIdx: t };
    return { status: 'confirmed', idx: t };
  }

  function priorRise(V, i) {
    let mn = Infinity;
    for (let j = Math.max(0, i - 40); j <= i; j++) if (V.l[j] < mn) mn = V.l[j];
    return V.h[i] - mn;
  }
  function volAvg(V, a, b) {
    a = Math.max(0, a); b = Math.min(V.n - 1, b);
    let s = 0, k = 0;
    for (let i = a; i <= b; i++) { s += V.v[i]; k++; }
    return k ? s / k : 0;
  }
  function statusConf(base, st) {
    if (st === 'confirmed') return base + 0.2;
    if (st === 'failed') return base * 0.5;
    return base;
  }

  function detDouble(V, out) {
    const P = V.P;
    for (let k = 0; k + 2 < P.length; k++) {
      const A = P[k], T = P[k + 1], B = P[k + 2];
      if (A.type !== 'H') continue;
      const a = V.atr[B.i], hgt = Math.min(A.p, B.p) - T.p;
      if (hgt < 3 * a) continue;
      const tol = clamp(0.1 * hgt, 0.3 * a, 0.75 * a), d = Math.abs(A.p - B.p);
      if (d > tol || B.i - A.i < 8 || B.i - A.i > 150) continue;
      const rise = priorRise(V, A.i);
      if (rise < 1.0 * hgt) continue;
      const peak = Math.max(A.p, B.p), neck = T.p;
      const sc = scan(V, B.i + 1, j => V.c[j] < neck - 0.25 * a, j => V.c[j] > peak + 0.1 * a, B.i + Math.max(10, B.i - A.i));
      if (sc.status === 'expired') continue;
      let conf = 0.3 + 0.25 * (1 - d / tol) + 0.15 * clamp(rise / (2 * hgt), 0, 1);
      if (V.hasVol && volAvg(V, B.i - 1, B.i + 1) < volAvg(V, A.i - 1, A.i + 1)) conf += 0.05;
      conf = statusConf(conf, sc.status);
      finish(V, {
        kind: 'dtop', status: sc.status, conf, start: A.i, end: B.i, brk: sc.idx,
        points: [{ i: A.i, p: A.p, label: V.pk + ' 1' }, { i: T.i, p: T.p, label: V.tr }, { i: B.i, p: B.p, label: V.pk + ' 2' }],
        lines: [{ i1: A.i, p1: neck, i2: Math.max(B.i, sc.idx >= 0 ? sc.idx : V.n - 1), p2: neck, role: 'neckline' }],
        level: peak, neckline: neck, target: neck - hgt, invalidation: peak + 0.1 * a,
        stale: Math.max(10, B.i - A.i),
        note: 'Two ' + (V.sgn > 0 ? 'highs' : 'lows') + ' within ' + r4(d / a) + ' ATR of each other, ' + r4(hgt / a) + ' ATR from the middle swing. Confirmed by a close beyond the middle swing.'
      }, out);
    }
  }

  function detTriple(V, out) {
    const P = V.P;
    for (let k = 0; k + 4 < P.length; k++) {
      if (P[k].type !== 'H') continue;
      const H1 = P[k], L1 = P[k + 1], H2 = P[k + 2], L2 = P[k + 3], H3 = P[k + 4];
      const a = V.atr[H3.i];
      const hi = Math.max(H1.p, H2.p, H3.p), lo = Math.min(H1.p, H2.p, H3.p);
      const hgt = lo - Math.max(L1.p, L2.p);
      if (hgt < 3 * a) continue;
      const tol = clamp(0.1 * hgt, 0.3 * a, 0.75 * a);
      if (hi - lo > tol) continue;
      if (Math.abs(L1.p - L2.p) > Math.max(0.3 * hgt, 1.0 * a)) continue;
      if (H2.i - H1.i < 6 || H3.i - H2.i < 6) continue;
      const rise = priorRise(V, H1.i);
      if (rise < 1.0 * hgt) continue;
      const neck = Math.min(L1.p, L2.p);
      const sc = scan(V, H3.i + 1, j => V.c[j] < neck - 0.25 * a, j => V.c[j] > hi + 0.1 * a, H3.i + Math.max(10, (H3.i - H1.i) / 2));
      if (sc.status === 'expired') continue;
      let conf = 0.35 + 0.25 * (1 - (hi - lo) / tol) + 0.15 * clamp(rise / (2 * hgt), 0, 1) + 0.05;
      conf = statusConf(conf, sc.status);
      finish(V, {
        kind: 'ttop', status: sc.status, conf, start: H1.i, end: H3.i, brk: sc.idx,
        points: [H1, L1, H2, L2, H3].map((q, n) => ({ i: q.i, p: q.p, label: n % 2 === 0 ? V.pk + ' ' + (n / 2 + 1) : V.tr })),
        lines: [{ i1: H1.i, p1: neck, i2: Math.max(H3.i, sc.idx >= 0 ? sc.idx : V.n - 1), p2: neck, role: 'neckline' }],
        level: hi, neckline: neck, target: neck - hgt, invalidation: hi + 0.1 * a,
        stale: Math.max(10, H3.i - H1.i),
        note: 'Three ' + (V.sgn > 0 ? 'highs' : 'lows') + ' within ' + r4((hi - lo) / a) + ' ATR: the same level rejected three times.'
      }, out);
    }
  }

  function detHS(V, out) {
    const P = V.P;
    for (let k = 0; k + 4 < P.length; k++) {
      if (P[k].type !== 'H') continue;
      const LS = P[k], N1 = P[k + 1], HD = P[k + 2], N2 = P[k + 3], RS = P[k + 4];
      const a = V.atr[RS.i];
      if (N2.i === N1.i) continue;
      const slope = (N2.p - N1.p) / (N2.i - N1.i), nl = x => N1.p + slope * (x - N1.i);
      const hgt = HD.p - nl(HD.i);
      if (hgt < 5 * a) continue;
      const lsH = LS.p - nl(LS.i), rsH = RS.p - nl(RS.i);
      if (lsH < 0.45 * hgt || rsH < 0.45 * hgt) continue;
      if (HD.p - Math.max(LS.p, RS.p) < 0.3 * hgt) continue;
      if (Math.abs(lsH - rsH) > 0.15 * hgt) continue;
      if (Math.abs(N1.p - N2.p) > 0.2 * hgt) continue;
      const t1 = HD.i - LS.i, t2 = RS.i - HD.i, ratio = t1 / t2;
      if (ratio < 0.6 || ratio > 1.7 || t1 < 8 || t2 < 8) continue;
      const rise = priorRise(V, LS.i);
      if (rise < 1.0 * hgt) continue;
      const sc = scan(V, RS.i + 1, j => V.c[j] < nl(j) - 0.25 * a, j => V.c[j] > HD.p + 0.1 * a, RS.i + Math.max(10, (RS.i - LS.i) * 0.75));
      if (sc.status === 'expired') continue;
      let conf = 0.3 + 0.2 * (1 - Math.abs(lsH - rsH) / (0.15 * hgt)) + 0.1 * (1 - Math.abs(Math.log(ratio)) / Math.log(1.7)) + 0.1 * clamp(rise / (1.5 * hgt), 0, 1) + 0.05 * clamp((HD.p - Math.max(LS.p, RS.p)) / (0.4 * hgt), 0, 1);
      if (V.hasVol && volAvg(V, RS.i - 1, RS.i + 1) < volAvg(V, HD.i - 1, HD.i + 1)) conf += 0.05;
      conf = statusConf(conf, sc.status);
      const endX = Math.max(RS.i, sc.idx >= 0 ? sc.idx : V.n - 1);
      const tgtBase = sc.idx >= 0 ? nl(sc.idx) : nl(RS.i);
      finish(V, {
        kind: 'hs', status: sc.status, conf, start: LS.i, end: RS.i, brk: sc.idx,
        points: [{ i: LS.i, p: LS.p, label: 'Left shoulder' }, { i: N1.i, p: N1.p, label: 'Neck 1' }, { i: HD.i, p: HD.p, label: 'Head' }, { i: N2.i, p: N2.p, label: 'Neck 2' }, { i: RS.i, p: RS.p, label: 'Right shoulder' }],
        lines: [{ i1: N1.i, p1: N1.p, i2: endX, p2: nl(endX), role: 'neckline' }],
        level: HD.p, neckline: nl(RS.i), target: tgtBase - hgt, invalidation: HD.p + 0.1 * a,
        stale: Math.max(10, Math.round((RS.i - LS.i) * 0.5)),
        note: 'Head ' + r4(hgt / a) + ' ATR above the neckline; shoulders differ by ' + r4(Math.abs(lsH - rsH) / a) + ' ATR. Confirmed by a close through the neckline; target is the head height projected from the break.'
      }, out);
    }
  }

  function detTrendlines(V, out) {
    const P = V.P, cands = [];
    for (let e = 4; e < P.length; e++) {
      for (let len = 5; len <= 9 && e - len + 1 >= 0; len++) {
        const s = e - len + 1, W = P.slice(s, e + 1);
        const hi = W.filter(q => q.type === 'H'), lo = W.filter(q => q.type === 'L');
        if (hi.length < 2 || lo.length < 2 || W.length < 6) continue;
        const i0 = W[0].i, i1 = W[W.length - 1].i, span = i1 - i0;
        if (span < 12 || span > 250) continue;
        const a = V.atr[i1];
        const U = fitLine(hi), L = fitLine(lo);
        const tolRes = 0.35 * a;
        if (U.res > tolRes || L.res > tolRes) continue;
        const w0 = U.at(i0) - L.at(i0), w1 = U.at(i1) - L.at(i1);
        if (w0 < 2.5 * a || w1 < 0.25 * a) continue;
        const dU = U.at(i1) - U.at(i0), dL = L.at(i1) - L.at(i0);
        let viol = 0;
        for (let j = i0; j <= i1; j++) if (V.c[j] > U.at(j) + 0.6 * a || V.c[j] < L.at(j) - 0.6 * a) viol++;
        const allowed = Math.floor(0.04 * (span + 1));
        if (viol > allowed) continue;
        const flatU = Math.abs(dU) <= Math.min(0.12 * w0, a), flatL = Math.abs(dL) <= Math.min(0.12 * w0, a);
        let kind = null;
        if (flatU && dL >= 0.4 * w0 && w1 <= 0.6 * w0) kind = 'tri';
        else if (dU >= 0.15 * w0 && dL >= 0.3 * w0 && dL > dU && w1 <= 0.65 * w0) kind = 'wedge';
        else if (V.sgn > 0 && dU <= -0.2 * w0 && dL >= 0.2 * w0) kind = 'sym';
        else if (V.sgn > 0 && flatU && flatL && w1 >= 0.8 * w0 && span >= 15) kind = 'rect';
        if (!kind) continue;
        const converging = kind !== 'rect';
        // apex index: solve U(x) = L(x) -> x = i0 + w0 * span / (dL - dU)
        const apexI = converging && dL - dU > 0 ? i0 + w0 * span / (dL - dU) : Infinity;
        if (apexI < i1) continue;
        const total = W.length;
        let conf = 0.3 + 0.06 * Math.min(4, total - 4) + 0.15 * (1 - (U.res + L.res) / (2 * tolRes)) + 0.1 * (1 - viol / (allowed + 1)) + 0.1 * clamp(span / 30, 0, 1);
        cands.push({ kind, s, e, W, hi, lo, U, L, i0, i1, span, a, w0, w1, dU, dL, apexI, conf, total });
      }
    }
    // best per (kind, overlapping range)
    cands.sort((x, y) => y.conf - x.conf || y.span - x.span);
    const kept = [];
    for (const c of cands) {
      let dup = false;
      for (const k of kept) {
        if (k.kind !== c.kind) continue;
        const ov = Math.min(k.i1, c.i1) - Math.max(k.i0, c.i0);
        if (ov > 0.5 * Math.min(k.span, c.span)) { dup = true; break; }
      }
      if (!dup) kept.push(c);
    }
    for (const c of kept) {
      const { kind, U, L, i0, i1, a, w0 } = c;
      const isBullTri = kind === 'tri';
      const up = j => U.at(j), dn = j => L.at(j);
      let sc, dir = null;
      const until = i1 + Math.max(8, c.span * 0.5);
      if (kind === 'tri') sc = scan(V, i1 + 1, j => V.c[j] > up(j) + 0.25 * a, j => V.c[j] < dn(j), until);
      else if (kind === 'wedge') sc = scan(V, i1 + 1, j => V.c[j] < dn(j) - 0.25 * a, j => V.c[j] > up(j) + 0.25 * a, until);
      else {
        let hit = -1, side = 0;
        for (let j = i1 + 1; j <= Math.min(V.n - 1, until); j++) { if (V.c[j] > up(j) + 0.25 * a) { hit = j; side = 1; break; } if (V.c[j] < dn(j) - 0.25 * a) { hit = j; side = -1; break; } }
        sc = hit >= 0 ? { status: 'confirmed', idx: hit } : (until < V.n - 1 ? { status: 'expired', idx: -1 } : { status: 'forming', idx: -1 });
        if (hit >= 0) dir = side > 0 ? 'bull' : 'bear';
      }
      if (sc.status === 'expired') continue;
      const last = V.n - 1;
      const stale = Math.max(8, Math.round(c.span * 0.5));
      if (sc.status === 'forming') {
        if (last - i1 > stale || last > c.apexI || V.c[last] > up(last) + 0.6 * a || V.c[last] < dn(last) - 0.6 * a) continue;
      }
      const refX = sc.idx >= 0 ? sc.idx : last;
      const endX = Math.min(Number.isFinite(c.apexI) ? c.apexI : Infinity, Math.max(i1, refX) + (sc.idx >= 0 ? 0 : Math.round(c.span * 0.25)));
      const endLine = Math.round(Math.max(i1, endX));
      let target, invalidation, level = null, neckline = null, conf = c.conf;
      const upBreak = kind === 'tri' || (dir === 'bull');
      const lvl = upBreak ? up(refX) : dn(refX);
      if (kind === 'wedge') { target = dn(refX) - w0; invalidation = up(last) + 0.25 * a; level = dn(refX); }
      else if (kind === 'tri') { target = up(refX) + w0; invalidation = dn(last); level = up(refX); }
      else { target = (dir === 'bear' ? dn(refX) - w0 : up(refX) + w0); invalidation = dir === 'bear' ? up(last) : dn(last); level = lvl; }
      if (kind === 'sym' || kind === 'rect') { if (dir === null) { target = null; invalidation = null; level = null; } }
      neckline = level;
      conf = statusConf(conf, sc.status);
      if (V.hasVol && kind !== 'rect') { if (volAvg(V, i1 - 3, i1) < volAvg(V, i0, i0 + 3)) conf += 0.05; }
      const labelsHi = c.hi.map(q => ({ i: q.i, p: q.p, label: V.sgn > 0 ? 'High' : 'Low' }));
      const labelsLo = c.lo.map(q => ({ i: q.i, p: q.p, label: V.sgn > 0 ? 'Low' : 'High' }));
      const pts = labelsHi.concat(labelsLo).sort((x, y) => x.i - y.i);
      const rawLines = [
        { i1: i0, p1: up(i0), i2: endLine, p2: up(endLine), role: 'upper' },
        { i1: i0, p1: dn(i0), i2: endLine, p2: dn(endLine), role: 'lower' }
      ];
      finish(V, {
        kind, status: sc.status, conf, start: i0, end: i1, brk: sc.idx, dir: dir || undefined,
        points: pts, lines: rawLines, level, neckline, target, invalidation, stale,
        note: (isBullTri ? 'Flat ceiling with rising lows' : kind === 'wedge' ? 'Both lines slope the same way and converge' : kind === 'sym' ? 'Lower highs and higher lows converging' : 'Price oscillating between two flat lines') + '; ' + c.hi.length + ' touches on the upper line and ' + c.lo.length + ' on the lower, widest ' + r4(w0 / a) + ' ATR.'
      }, out);
    }
  }

  function detFlags(V, out) {
    const { n, h, l, c } = V;
    for (let B = 3; B <= n - 6; B++) {
      let isMax = true;
      for (let j = Math.max(0, B - 3); j <= Math.min(n - 1, B + 3); j++) if (h[j] > h[B]) { isMax = false; break; }
      if (!isMax) continue;
      const a = V.atr[B];
      let A = -1, mn = Infinity;
      for (let j = Math.max(0, B - 25); j <= B - 2; j++) if (V.l[j] < mn) { mn = V.l[j]; A = j; }
      if (A < 0) continue;
      for (let j = A + 1; j <= B - 3; j++) if (V.l[j] <= mn + 0.75 * a) A = j;
      const pole = h[B] - l[A], pb = B - A;
      if (pole < 3.5 * a || pb < 3 || pb > 20 || pole / pb < 0.35 * a) continue;
      let runMax = -Infinity, dd = 0, path = 0;
      for (let j = A; j <= B; j++) {
        runMax = Math.max(runMax, h[j]); dd = Math.max(dd, runMax - l[j]);
        if (j > A) path += Math.abs(c[j] - c[j - 1]);
      }
      if (dd > 0.3 * pole || path <= 0 || (c[B] - c[A]) / path < 0.55) continue;
      // consolidation extent: until a new high or a deep dip
      const cmax = Math.max(20, 2 * pb);
      let Ef = B;
      for (let j = B + 1; j <= Math.min(n - 1, B + cmax); j++) {
        if (h[j] > h[B] + 0.25 * a || l[j] < h[B] - 0.5 * pole) break;
        Ef = j;
      }
      let best = null;
      for (let E = Ef; E >= B + 5 && !best; E--) {
        const hs = [], ls = [];
        for (let j = B; j <= E; j++) hs.push({ i: j, p: h[j] });
        for (let j = B + 1; j <= E; j++) ls.push({ i: j, p: l[j] });
        const U0 = fitLine(hs), L0 = fitLine(ls), k = E - B;
        let up = 0, dn = 0, minLow = Infinity;
        for (let j = B; j <= E; j++) up = Math.max(up, h[j] - U0.at(j));
        for (let j = B + 1; j <= E; j++) { dn = Math.min(dn, l[j] - L0.at(j)); if (l[j] < minLow) minLow = l[j]; }
        const U = { s: U0.s, at: x => U0.at(x) + up }, L = { s: L0.s, at: x => L0.at(x) + dn };
        const wS = U.at(B + 1) - L.at(B + 1), wE = U.at(E) - L.at(E);
        if (wS < 0.6 * a || wE < 0.1 * a || wS > 0.6 * pole) continue;
        const depth = h[B] - minLow;
        if (depth > 0.5 * pole || depth < 0.3 * a) continue;
        const m = Math.floor((B + 1 + E) / 2);
        let mx1 = -Infinity, mn1 = Infinity, mx2 = -Infinity, mn2 = Infinity;
        for (let j = B + 1; j <= m; j++) { if (h[j] > mx1) mx1 = h[j]; if (l[j] < mn1) mn1 = l[j]; }
        for (let j = m + 1; j <= E; j++) { if (h[j] > mx2) mx2 = h[j]; if (l[j] < mn2) mn2 = l[j]; }
        let tu = 0, tl = 0;
        for (let j = B; j <= E; j++) { if (h[j] >= (j > 0 ? h[j - 1] : 0) && (j >= n - 1 || h[j] >= h[j + 1]) && U.at(j) - h[j] <= 0.5 * a) tu++; }
        for (let j = B + 1; j <= E; j++) { if (l[j] <= l[j - 1] && (j >= n - 1 || l[j] <= l[j + 1]) && l[j] - L.at(j) <= 0.5 * a) tl++; }
        if (tu < 2 || tl < 2) continue;
        const halfRatio = (mx2 - mn2) / Math.max(mx1 - mn1, 1e-9);
        const dU = U.s * k, dL = L.s * k;
        let type = null;
        if (wE <= 0.7 * wS && halfRatio <= 0.65) { if (dU <= 0.3 * a && dL >= -0.3 * a) type = 'pennant'; }
        else if (Math.abs(wE - wS) <= 0.4 * wS && halfRatio >= 0.7 && halfRatio <= 1.4 && dU <= 0.15 * a && dL <= 0.15 * a && (dU + dL) / 2 >= -0.5 * pole) type = 'flag';
        if (type) best = { E, U, L, k, type, minLow, wS, wE, depth };
      }
      if (!best) continue;
      const { E, U, L, type, minLow, depth } = best;
      const sc = scan(V, E + 1, j => c[j] > U.at(j) + 0.25 * a, j => c[j] < L.at(j) - 0.5 * a || c[j] < h[B] - 0.5 * pole, E + 6);
      if (sc.status === 'expired') continue;
      if (sc.status === 'forming' && E < n - 4) continue;
      const refX = sc.idx >= 0 ? sc.idx : n - 1;
      let conf = 0.3 + 0.15 * clamp((pole / a - 3) / 3, 0, 1) + 0.15 * (1 - depth / (0.5 * pole)) + 0.1 * clamp(((pole / pb) / a - 0.3) / 0.4, 0, 1) + 0.05 * (1 - dd / (0.35 * pole)) + (best.k <= pb * 1.5 ? 0.05 : 0);
      if (V.hasVol && volAvg(V, B + 1, E) < volAvg(V, A, B)) conf += 0.1;
      conf = statusConf(conf, sc.status);
      const endLine = E + (sc.idx >= 0 ? 0 : 3);
      finish(V, {
        kind: type, status: sc.status, conf, start: A, end: E, brk: sc.idx,
        points: [{ i: A, p: l[A], label: 'Pole start' }, { i: B, p: h[B], label: 'Pole top' }],
        lines: [
          { i1: A, p1: l[A], i2: B, p2: h[B], role: 'pole' },
          { i1: B, p1: U.at(B), i2: endLine, p2: U.at(endLine), role: 'upper' },
          { i1: B + 1, p1: L.at(B + 1), i2: endLine, p2: L.at(endLine), role: 'lower' }
        ],
        level: U.at(refX), neckline: U.at(refX), target: U.at(refX) + pole, invalidation: minLow,
        stale: 3,
        note: 'Impulsive pole of ' + r4(pole / a) + ' ATR in ' + pb + ' bars, then a ' + (type === 'flag' ? 'shallow channel' : 'converging triangle') + ' retracing ' + r4(depth / pole * 100) + '% of the pole. Confirmed by a close through the consolidation trendline.'
      }, out);
    }
  }

  /* ---------- assembly helpers ---------- */
  function overlapFrac(a, b) {
    const ov = Math.min(a.endIdx, b.endIdx) - Math.max(a.startIdx, b.startIdx);
    if (ov <= 0) return 0;
    return ov / Math.max(1, Math.min(a.endIdx - a.startIdx, b.endIdx - b.startIdx));
  }

  function dedupe(list) {
    const sorted = list.slice().sort((x, y) => y.confidence - x.confidence || (y.endIdx - y.startIdx) - (x.endIdx - x.startIdx));
    const kept = [];
    for (const c of sorted) {
      let drop = false;
      for (const k of kept) {
        if (k.type === c.type && overlapFrac(k, c) > 0.5) { drop = true; break; }
        if (/flag|pennant/.test(k.type) && /flag|pennant/.test(c.type) && k.dir === c.dir && Math.abs(k.startIdx - c.startIdx) <= 3) { drop = true; break; }
        // a triple top/bottom swallows the double it contains
        if (c.type === 'double_top' && k.type === 'triple_top' && c.startIdx >= k.startIdx && c.endIdx <= k.endIdx) { drop = true; break; }
        if (c.type === 'double_bottom' && k.type === 'triple_bottom' && c.startIdx >= k.startIdx && c.endIdx <= k.endIdx) { drop = true; break; }
      }
      if (!drop) kept.push(c);
    }
    return kept;
  }

  function detectLevels(S, A, opts) {
    const z = zigzag(S.h, S.l, A, opts.levelPivotAtr).filter(p => p.ok);
    if (z.length < 2) return [];
    const ps = z.slice().sort((x, y) => x.p - y.p), clusters = [];
    let cur = null;
    for (const q of ps) {
      const tol = 0.5 * A[q.i];
      if (cur && Math.abs(q.p - cur.mean) <= tol) { cur.items.push(q); cur.sum += q.p; cur.mean = cur.sum / cur.items.length; }
      else { cur = { items: [q], sum: q.p, mean: q.p }; clusters.push(cur); }
    }
    const last = S.c[S.n - 1], minI = S.n - 1 - opts.maxAgeBars, out = [];
    for (const cl of clusters) {
      if (cl.items.length < 2) continue;
      const idxs = cl.items.map(q => q.i).sort((x, y) => x - y);
      let sep = true;
      for (let k = 1; k < idxs.length; k++) if (idxs[k] - idxs[k - 1] < 3) sep = false;
      if (!sep) continue;
      if (idxs[idxs.length - 1] < minI) continue;
      out.push({ p: r6(cl.mean), touches: cl.items.length, kind: cl.mean <= last ? 'support' : 'resistance', firstIdx: idxs[0], lastIdx: idxs[idxs.length - 1] });
    }
    out.sort((x, y) => y.touches - x.touches || y.lastIdx - x.lastIdx);
    return out.slice(0, opts.maxLevels);
  }

  function detectGaps(S, A, opts) {
    const out = [], n = S.n, minI = Math.max(1, n - opts.maxAgeBars);
    for (let i = minI; i < n; i++) {
      const a = A[i - 1];
      let dir = null, from = 0, to = 0;
      if (S.l[i] - S.h[i - 1] > 0.5 * a) { dir = 'up'; from = S.h[i - 1]; to = S.l[i]; }
      else if (S.l[i - 1] - S.h[i] > 0.5 * a) { dir = 'down'; from = S.l[i - 1]; to = S.h[i]; }
      if (!dir) continue;
      let filled = false;
      for (let j = i + 1; j < n; j++) {
        if (dir === 'up' ? S.l[j] <= from : S.h[j] >= from) { filled = true; break; }
      }
      out.push({ i, dir, from: r6(from), to: r6(to), filled });
    }
    return out;
  }

  function overallTrend(S, A) {
    const n = S.n, look = Math.min(30, n), a = n - look;
    const r = regress(S.c, a, n - 1), net = r.slope * (look - 1) / A[n - 1];
    const strength = clamp(Math.abs(net) / 6, 0, 1) * (0.5 + 0.5 * r.r2);
    const dir = Math.abs(net) >= 2 && r.r2 >= 0.3 ? (net > 0 ? 'up' : 'down') : 'flat';
    return { dir, strength: r4(dir === 'flat' ? Math.min(strength, 0.3) : strength) };
  }

  const EMPTY = () => ({ ok: false, count: 0, atr: null, trend: { dir: 'flat', strength: 0 }, candles: [], charts: [], levels: [], gaps: [], summary: [] });

  function detect(bars, options) {
    try { return detectInner(bars, options); } catch (e) { const r = EMPTY(); r.error = String(e && e.message || e); return r; }
  }

  function detectInner(bars, options) {
    const opts = Object.assign({}, DEFAULTS);
    if (options && typeof options === 'object') for (const k of Object.keys(options)) { if (options[k] !== undefined && options[k] !== null) opts[k] = options[k]; }
    opts.maxAgeBars = Math.max(10, num(opts.maxAgeBars) || DEFAULTS.maxAgeBars);
    const S = clean(bars);
    if (S.n < Math.max(20, opts.minBars)) return EMPTY();
    const n = S.n, A = atrSeries(S.h, S.l, S.c, opts.atrPeriod);
    const M = i => (i <= n - 1 ? (i < 0 ? S.oi[0] : S.oi[Math.round(i)]) : S.oi[n - 1] + Math.round(i - (n - 1)));

    const rawPivots = zigzag(S.h, S.l, A, opts.pivotAtr);
    const Vp = makeView(S, A, rawPivots, 1), Vm = makeView(S, A, rawPivots, -1);
    const raw = [];
    for (const V of [Vp, Vm]) { detDouble(V, raw); detTriple(V, raw); detHS(V, raw); detTrendlines(V, raw); detFlags(V, raw); }

    // recency / age policy, confidence floor
    const last = n - 1;
    const kept = raw.filter(c => {
      if (c.status === 'failed' && !opts.includeFailed) return false;
      if (c.status === 'forming') { if (last - c.endIdx > c._stale) return false; }
      else if (last - (c.breakIdx >= 0 ? c.breakIdx : c.endIdx) > opts.maxAgeBars) return false;
      else if (c.breakIdx < 0 && last - c.endIdx > opts.maxAgeBars) return false;
      return c.confidence >= opts.minConfidence;
    });
    const charts = dedupe(kept).sort((x, y) => x.endIdx - y.endIdx || y.confidence - x.confidence).map(c => {
      const o = {
        id: c.type + '-' + M(c.startIdx) + '-' + M(c.endIdx), type: c.type, name: c.name, dir: c.dir, status: c.status,
        confidence: r4(c.confidence), startIdx: M(c.startIdx), endIdx: M(c.endIdx),
        points: c.points.map(q => ({ i: M(q.i), p: q.p, label: q.label })),
        lines: c.lines.map(q => ({ i1: M(q.i1), p1: q.p1, i2: M(q.i2), p2: q.p2, role: q.role })),
        level: c.level, neckline: c.neckline, target: c.target, invalidation: c.invalidation, note: c.note
      };
      if (c.breakIdx >= 0) o.breakIdx = M(c.breakIdx);
      return o;
    });

    const candles = detectCandles(S, A, opts).map(k => ({
      i: S.oi[k.i], t: S.t[k.i], name: k.name, label: CANDLE_LABEL[k.name], dir: k.dir, strength: k.strength,
      bars: [S.oi[k.bars[0]], S.oi[k.bars[1]]], note: k.note
    }));
    const levels = detectLevels(S, A, opts).map(v => ({ p: v.p, touches: v.touches, kind: v.kind, firstIdx: S.oi[v.firstIdx], lastIdx: S.oi[v.lastIdx] }));
    const gaps = detectGaps(S, A, opts).map(g => ({ i: S.oi[g.i], dir: g.dir, from: g.from, to: g.to, filled: g.filled }));
    const trend = overallTrend(S, A);

    const summary = [];
    summary.push(trend.dir === 'flat' ? 'Trend: sideways / no clear direction.' : 'Trend: ' + (trend.dir === 'up' ? 'uptrend' : 'downtrend') + ' (strength ' + trend.strength.toFixed(2) + ').');
    charts.slice().sort((x, y) => y.confidence - x.confidence).slice(0, 5).forEach(c => {
      summary.push(c.name + ' (' + c.dir + ', ' + c.status + ', ' + Math.round(c.confidence * 100) + '%)' + (c.target !== null && c.status !== 'failed' ? ', target ' + c.target.toFixed(2) : '') + '.');
    });
    candles.filter(k => k.i >= S.oi[Math.max(0, n - 3)]).slice(-4).forEach(k => summary.push(k.label + ' on bar ' + k.i + ' (' + k.dir + ').'));
    const nearest = levels.slice().sort((x, y) => Math.abs(x.p - S.c[n - 1]) - Math.abs(y.p - S.c[n - 1]))[0];
    if (nearest) summary.push('Nearest ' + nearest.kind + ' near ' + nearest.p.toFixed(2) + ' (' + nearest.touches + ' touches).');
    const openGap = gaps.filter(g => !g.filled).slice(-1)[0];
    if (openGap) summary.push('Unfilled gap ' + openGap.dir + ' between ' + openGap.from.toFixed(2) + ' and ' + openGap.to.toFixed(2) + '.');

    return { ok: true, count: candles.length + charts.length, atr: r6(A[n - 1]), trend, candles, charts, levels, gaps, summary };
  }

  return { detect, atr, pivots, DEFAULTS, CANDLE_NAMES: Object.keys(CANDLE_LABEL), CHART_TYPES: Object.keys(META).reduce((a, k) => { META[k].id.forEach(x => { if (a.indexOf(x) < 0) a.push(x); }); return a; }, []) };
});
