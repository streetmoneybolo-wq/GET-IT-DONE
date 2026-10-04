/* Smart-money explainer for the Academy Live Chart Lab.
   Takes what SmlSmartMoney.analyze() found (zones, sweeps, structure breaks, gaps) plus the bars it came from and writes, for ONE item the member hovers,
   the full facts, the evidence for and against it, and a conclusion on what the move looks like it was for: sentiment, purpose and intent.

   The conclusion weighs the item against everything else the map knows: trend (the last break of structure), where price sits in its range
   (premium / discount), VWAP, recent momentum, live order flow when the page has it, and how zones like this one reacted earlier in the same history.
   Pure functions; node (module.exports) and the page (window.SmlSmcExplain). Educational: it describes what price did and what the data leans toward,
   it never predicts, and it is not a signal. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SmlSmcExplain = api;
})(typeof window !== 'undefined' ? window : this, function () {
  const fin = Number.isFinite;
  const f2 = (v) => (fin(v) ? Number(v).toFixed(2) : '-');
  const pct = (v, d = 1) => (fin(v) ? (v * 100).toFixed(d) + '%' : '-');
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const avgVol = (bars, i, n = 20) => { let s = 0, c = 0; for (let j = Math.max(0, i - n); j < i; j++) { s += bars[j].v || 0; c++; } return c ? s / c : 0; };
  const when = (bars, i) => { const b = bars[i]; if (!b) return ''; try { return new Date(b.t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'; } catch (_) { return ''; } };
  const ago = (n, i) => plural(Math.max(0, n - 1 - i), 'bar') + ' ago';

  /* ---------- shared context: trend, premium / discount, VWAP, momentum, flow ---------- */
  function context(a, bars, ctx = {}) {
    const n = a.n, px = a.last, atr = a.atr || px * 0.01;
    const ev = a.structure.events.slice(-1)[0] || null;
    const trend = a.structure.trend || 0;
    const pos = a.range ? a.range.pos : null;
    const vw = a.vwap && a.vwap[n - 1] ? a.vwap[n - 1] : null;
    const back = Math.min(10, n - 1), move = back > 0 ? (px - bars[n - 1 - back].c) / atr : 0;
    const flow = ctx.flow && fin(ctx.flow.buy) && fin(ctx.flow.sell) && ctx.flow.buy + ctx.flow.sell > 0 ? { buyShare: ctx.flow.buy / (ctx.flow.buy + ctx.flow.sell) } : null;
    return { n, px, atr, ev, trend, pos, vwapSide: vw ? (px >= vw.vwap ? 1 : -1) : 0, vwap: vw ? vw.vwap : null, momentum: move, flow, htf: ctx.htf && fin(ctx.htf.dir) ? ctx.htf.dir : null };
  }

  /* How zones of the same kind and direction reacted the first time price came back to them earlier in this history. */
  function zoneHistory(a, bars, list, dir, bounds) {
    let tested = 0, held = 0;
    for (const z of list) {
      if (z.dir !== dir) continue;
      const start = bounds(z).start, top = bounds(z).top, bottom = bounds(z).bottom;
      for (let j = start + 1; j < bars.length - 3; j++) {
        if (bars[j].l <= top && bars[j].h >= bottom) {
          tested++;
          const out = dir > 0 ? bars[Math.min(bars.length - 1, j + 3)].c > top : bars[Math.min(bars.length - 1, j + 3)].c < bottom;
          if (out) held++;
          break;
        }
      }
    }
    return tested >= 2 ? { tested, held, rate: held / tested } : null;
  }

  /* Turn a list of weighted observations into a bias, a confidence and a one-line read. */
  function conclude(dirOfItem, evidence, base) {
    const net = evidence.reduce((s, e) => s + (e.w || 0), 0);
    const strength = Math.abs(net);
    const confidence = strength >= 4 ? 'high' : strength >= 2 ? 'medium' : 'low';
    const lean = net >= 1 ? dirOfItem : net <= -1 ? -dirOfItem : 0;
    const word = lean > 0 ? 'bullish' : lean < 0 ? 'bearish' : 'neutral';
    return { bias: word, confidence, score: Math.round(net * 10) / 10, summary: base(word, confidence, net) };
  }
  const tone = (w) => (w > 0 ? 'for' : w < 0 ? 'against' : 'neutral');
  const ev = (w, text) => ({ w, tone: tone(w), text });

  /* Evidence every zone shares, expressed relative to the direction the item points (+1 up / -1 down). */
  function sharedEvidence(c, dir, kind) {
    const out = [];
    if (c.ev) {
      const aligned = c.ev.dir === dir;
      out.push(ev(aligned ? 1.5 : -1.5, 'The last structure break was a ' + (c.ev.type === 'CHoCH' ? 'change of character' : 'break of structure') + ' ' + (c.ev.dir > 0 ? 'up' : 'down') + ', which ' + (aligned ? 'agrees with' : 'runs against') + ' this ' + kind + '.'));
    }
    if (c.pos != null) {
      const discount = c.pos <= 0.5;
      const fits = dir > 0 ? discount : !discount;
      out.push(ev(fits ? 1 : -1, 'Price is in ' + (discount ? 'discount' : 'premium') + ' (' + Math.round(clamp(c.pos, 0, 1) * 100) + '% of its range), ' + (fits ? 'where large traders prefer to ' + (dir > 0 ? 'buy' : 'sell') + '.' : 'the wrong side for a ' + (dir > 0 ? 'buy' : 'sell') + '.')));
    }
    if (c.vwapSide) out.push(ev(c.vwapSide === dir ? 0.5 : -0.5, 'Price is ' + (c.vwapSide > 0 ? 'above' : 'below') + ' VWAP (' + f2(c.vwap) + ').'));
    if (Math.abs(c.momentum) >= 0.5) out.push(ev(Math.sign(c.momentum) === dir ? 0.5 : -0.5, 'The last ten bars moved ' + (c.momentum > 0 ? 'up' : 'down') + ' about ' + Math.abs(c.momentum).toFixed(1) + ' ATR.'));
    if (c.flow) {
      const share = c.flow.buyShare, lean = share >= 0.58 ? 1 : share <= 0.42 ? -1 : 0;
      if (lean) out.push(ev(lean === dir ? 1 : -1, 'Live order flow is ' + Math.round(share * 100) + '% buyers, ' + Math.round((1 - share) * 100) + '% sellers' + (lean === dir ? ', supporting it.' : ', leaning the other way.')));
      else out.push(ev(0, 'Live order flow is balanced (' + Math.round(share * 100) + '% buyers).'));
    }
    if (c.htf != null && c.htf !== 0) out.push(ev(c.htf === dir ? 1.5 : -1.5, 'The higher timeframe leans ' + (c.htf > 0 ? 'up' : 'down') + ', ' + (c.htf === dir ? 'with' : 'against') + ' it.'));
    return out;
  }

  const result = (kind, title, headline, facts, evidence, conclusion, notes) => ({ kind, title, headline, facts: facts.filter((x) => x[1] !== '' && x[1] != null), evidence, conclusion, notes: notes || [] });
  const DISCLAIMER = 'Educational: this is a read of what price did and what the data leans toward. It is not a prediction and not a signal.';

  /* ---------- order blocks (supply / demand) ---------- */
  function orderBlock(a, bars, idx, ctx) {
    const ob = a.structure.orderBlocks[idx]; if (!ob) return null;
    const c = context(a, bars, ctx), n = a.n, dir = ob.dir, atr = a.atr;
    const demand = dir > 0, name = demand ? 'Demand' : 'Supply';
    const size = ob.top - ob.bottom;
    let touches = 0, mitigated = false, lastTouch = null;
    for (let j = ob.breakIdx + 1; j < n; j++) {
      const overlap = bars[j].l <= ob.top && bars[j].h >= ob.bottom;
      if (overlap) { touches++; lastTouch = j; }
      if (ob.invalidAt != null && j >= ob.invalidAt) break;
    }
    if (touches && ob.invalidAt == null) { const t = lastTouch; mitigated = demand ? bars[t].c < (ob.top + ob.bottom) / 2 : bars[t].c > (ob.top + ob.bottom) / 2; }
    const status = ob.invalidAt != null ? 'invalidated' : touches === 0 ? 'fresh (price has not come back)' : touches === 1 ? 'tested once and held' : 'tested ' + touches + ' times';
    const originVol = avgVol(bars, ob.i) > 0 ? (bars[ob.i].v || 0) / avgVol(bars, ob.i) : null;
    const brk = bars[ob.breakIdx], disp = Math.abs(brk.c - brk.o) / (atr || 1);
    const hist = zoneHistory(a, bars, a.structure.orderBlocks, dir, (z) => ({ start: z.breakIdx, top: z.top, bottom: z.bottom }));
    const dist = (c.px - (demand ? ob.top : ob.bottom)) / c.px;
    const evidence = sharedEvidence(c, dir, demand ? 'demand block' : 'supply block');
    if (ob.invalidAt != null) evidence.push(ev(-4, 'Price closed ' + (demand ? 'below' : 'above') + ' the block ' + ago(n, ob.invalidAt) + ', so it failed and is no longer defended.'));
    else if (touches === 0) evidence.push(ev(1, 'Untouched since the move that created it: the orders there have likely not been used up.'));
    else if (touches >= 3) evidence.push(ev(-1.5, 'Re-tested ' + touches + ' times: each test uses up some of the resting orders.'));
    else if (touches >= 1 && !mitigated) evidence.push(ev(1, 'Price came back into it and held the ' + (demand ? 'lower' : 'upper') + ' half, a sign it was defended.'));
    if (mitigated) evidence.push(ev(-1.5, 'The last test closed past the block’s midpoint, a weak defence.'));
    if (originVol != null && originVol >= 1.3) evidence.push(ev(1, 'The origin candle traded ' + originVol.toFixed(1) + 'x its usual volume: real size was involved.'));
    else if (originVol != null && originVol < 0.7) evidence.push(ev(-0.5, 'The origin candle traded on thin volume (' + originVol.toFixed(1) + 'x usual).'));
    if (disp >= 1) evidence.push(ev(1, 'The break that confirmed it was a strong ' + disp.toFixed(1) + ' ATR candle: an aggressive, one-sided move.'));
    if (hist) evidence.push(ev(hist.rate >= 0.6 ? 1.5 : hist.rate <= 0.4 ? -1.5 : 0, 'Earlier ' + (demand ? 'demand' : 'supply') + ' blocks in this history held ' + hist.held + ' of ' + hist.tested + ' first retests (' + Math.round(hist.rate * 100) + '%).'));
    const conclusion = conclude(dir, evidence, (word, conf) => ob.invalidAt != null
      ? 'This ' + name.toLowerCase() + ' block failed, so it is now more likely a level to trade back through than to defend.'
      : word === 'neutral' ? 'The evidence on this ' + name.toLowerCase() + ' block is mixed; treat it as a level to watch, not a lean.'
        : 'The purpose of this block looks like ' + (demand ? 'large buyers defending a ' + 'price they accumulated at' : 'large sellers defending a price they distributed at') + '. The read is ' + word + ' with ' + conf + ' confidence'
          + (word === (demand ? 'bullish' : 'bearish') ? ': a ' + (demand ? 'bounce' : 'rejection') + ' from here is the more likely reaction.' : ', but the data is leaning against it, so expect a weaker reaction or a break.'));
    return result('ob', name + ' block', name + ' block ' + f2(ob.bottom) + ' to ' + f2(ob.top),
      [['Zone', f2(ob.bottom) + ' to ' + f2(ob.top)], ['Size', f2(size) + ' (' + (size / (atr || 1)).toFixed(1) + ' ATR)'], ['Formed', when(bars, ob.i) + ', ' + ago(n, ob.i)],
        ['Confirmed by', 'break at ' + f2(brk.c) + ', ' + ago(n, ob.breakIdx)], ['Origin volume', originVol != null ? originVol.toFixed(1) + 'x average' : ''], ['Status', status],
        ['Distance now', (dist >= 0 ? '+' : '') + pct(dist) + ' from the near edge']], evidence, conclusion,
      [demand ? 'A demand block is the last down candle before the up move that broke structure.' : 'A supply block is the last up candle before the down move that broke structure.', DISCLAIMER]);
  }

  /* ---------- fair value gaps ---------- */
  function fairValueGap(a, bars, idx, ctx) {
    const g = a.fvg[idx]; if (!g) return null;
    const c = context(a, bars, ctx), n = a.n, dir = g.dir, atr = a.atr, bull = dir > 0;
    const size = Math.abs(g.orig[1] - g.orig[0]);
    const filled = g.filledAt != null;
    const remaining = filled ? 0 : (g.top - g.bottom) / (size || 1);
    const evidence = sharedEvidence(c, dir, 'imbalance');
    const mid = bars[g.i];
    const disp = Math.abs(mid.c - mid.o) / (atr || 1);
    if (disp >= 1) evidence.push(ev(1, 'The candle that made the gap was a ' + disp.toFixed(1) + ' ATR move: aggressive, one-sided buying or selling.'));
    const vr = avgVol(bars, g.i) > 0 ? (mid.v || 0) / avgVol(bars, g.i) : null;
    if (vr != null && vr >= 1.5) evidence.push(ev(1, 'It formed on ' + vr.toFixed(1) + 'x normal volume.'));
    if (filled) evidence.push(ev(-2, 'Price has already traded back through the gap (' + ago(n, g.filledAt) + '), so the imbalance is gone.'));
    else if (remaining < 1) evidence.push(ev(-0.5, 'Only ' + Math.round(remaining * 100) + '% of the gap is still open.'));
    const age = n - 1 - g.i; if (age > 120) evidence.push(ev(-0.5, 'It is old (' + plural(age, 'bar') + '): older gaps matter less.'));
    const hist = zoneHistory(a, bars, a.fvg, dir, (z) => ({ start: z.i + 1, top: z.top, bottom: z.bottom }));
    if (hist) evidence.push(ev(hist.rate >= 0.6 ? 1 : hist.rate <= 0.4 ? -1 : 0, 'Earlier ' + (bull ? 'bullish' : 'bearish') + ' gaps held ' + hist.held + ' of ' + hist.tested + ' first revisits.'));
    const conclusion = conclude(dir, evidence, (word, conf) => filled ? 'This imbalance has been filled, so it no longer acts as a magnet or a support.'
      : 'A fair value gap is where price moved so fast that one side was never fully matched. Price tends to come back to rebalance it. The read is ' + word + ' (' + conf + ' confidence): '
        + (word === (bull ? 'bullish' : 'bearish') ? 'expect the gap to be a reaction area where the original move may resume.' : word === 'neutral' ? 'treat it as a level to watch.' : 'expect it to be filled and traded through rather than defended.'));
    return result('fvg', (bull ? 'Bullish' : 'Bearish') + ' fair value gap', (bull ? 'Bullish' : 'Bearish') + ' fair value gap ' + f2(g.bottom) + ' to ' + f2(g.top),
      [['Original gap', f2(g.orig[0]) + ' to ' + f2(g.orig[1])], ['Still open', filled ? 'filled ' + ago(n, g.filledAt) : f2(g.bottom) + ' to ' + f2(g.top) + ' (' + Math.round(remaining * 100) + '% left)'], ['Size', f2(size) + ' (' + (size / (atr || 1)).toFixed(1) + ' ATR)'],
        ['Formed', when(bars, g.i) + ', ' + ago(n, g.i)], ['Volume on the gap candle', vr != null ? vr.toFixed(1) + 'x average' : '']], evidence, conclusion, [DISCLAIMER]);
  }

  /* ---------- liquidity pools and sweeps ---------- */
  function liquidity(a, bars, idx, ctx) {
    const l = a.liquidity[idx]; if (!l) return null;
    const c = context(a, bars, ctx), n = a.n, atr = a.atr, high = l.kind === 'EQH';
    const swept = l.sweptAt != null, taken = l.takenAt != null;
    const resting = high ? 'buy stops (short sellers’ stops and breakout buyers)' : 'sell stops (long holders’ stops and breakdown sellers)';
    if (!swept && !taken) {
      const dist = (l.level - c.px) / c.px;
      const dir = high ? 1 : -1;
      const evidence = [ev(0, 'Equal ' + (high ? 'highs' : 'lows') + ' at ' + f2(l.level) + ' have been touched ' + l.count + ' times without breaking: ' + resting + ' pile up just ' + (high ? 'above' : 'below') + '.')];
      evidence.push(...sharedEvidence(c, dir, 'move to the ' + (high ? 'highs' : 'lows')));
      const conclusion = conclude(dir, evidence, (word, conf) => 'This is a liquidity pool, a pool of resting orders that large traders can trade against. Price is often drawn to it. The data leans ' + word + ' (' + conf + ' confidence) on a run to ' + f2(l.level) + ': '
        + (word === (high ? 'bullish' : 'bearish') ? 'a move to take these stops looks more likely than not.' : word === 'neutral' ? 'no clear edge either way.' : 'a run there looks less likely right now.') + ' What happens at it matters more: a push through and back inside is a sweep, a close beyond is a real breakout.');
      return result('liq', 'Equal ' + (high ? 'highs' : 'lows') + ' (liquidity pool)', 'Equal ' + (high ? 'highs' : 'lows') + ' at ' + f2(l.level),
        [['Level', f2(l.level)], ['Touches', String(l.count)], ['First / last touch', ago(n, l.first) + ' / ' + ago(n, l.last)], ['Distance now', (dist >= 0 ? '+' : '') + pct(dist)], ['Resting orders', resting]], evidence, conclusion, [DISCLAIMER]);
    }
    const at = swept ? l.sweptAt : l.takenAt, bar = bars[at];
    const wick = high ? bar.h - l.level : l.level - bar.l, wickAtr = wick / (atr || 1);
    const closeBack = high ? l.level - bar.c : bar.c - l.level;
    const vr = avgVol(bars, at) > 0 ? (bar.v || 0) / avgVol(bars, at) : null;
    // follow-through in the five bars after the sweep: reversal (away from the level) or acceptance (through it)
    const after = bars.slice(at + 1, at + 6); let follow = null;
    if (after.length) { const end = after[after.length - 1].c; follow = (high ? l.level - end : end - l.level) / (atr || 1); }
    const reversalDir = high ? -1 : 1;
    const evidence = [];
    if (swept) {
      evidence.push(ev(0, 'Price ' + (high ? 'pushed above' : 'dropped below') + ' the level by ' + f2(wick) + ' (' + wickAtr.toFixed(1) + ' ATR) and CLOSED back ' + (high ? 'below' : 'above') + ' it: a stop run, not a breakout.'));
      if (closeBack >= 0.3 * atr) evidence.push(ev(1.5, 'It closed ' + (closeBack / atr).toFixed(1) + ' ATR back inside: a firm rejection of the move.'));
      if (vr != null && vr >= 1.5) evidence.push(ev(1.5, 'The sweep candle traded ' + vr.toFixed(1) + 'x normal volume: stops were being triggered and filled in size.'));
      else if (vr != null && vr < 0.8) evidence.push(ev(-0.5, 'The sweep candle was on light volume (' + vr.toFixed(1) + 'x), a weaker stop run.'));
      if (follow != null) evidence.push(ev(follow >= 0.5 ? 2 : follow <= -0.5 ? -2 : 0, follow >= 0.5 ? 'Over the next bars price moved ' + follow.toFixed(1) + ' ATR away from the level: the sweep was followed through.' : follow <= -0.5 ? 'Price has since gone back through the level, so the sweep did not hold.' : 'Price has not yet moved decisively away from the level.'));
      const choch = a.structure.events.find((e) => e.idx > at && e.idx <= at + 12 && e.dir === reversalDir);
      if (choch) evidence.push(ev(2, 'A ' + (choch.type === 'CHoCH' ? 'change of character' : 'break of structure') + ' ' + (choch.dir > 0 ? 'up' : 'down') + ' followed within ' + (choch.idx - at) + ' bars: structure confirmed the reversal.'));
      else evidence.push(ev(-0.5, 'No structure break has confirmed the reversal yet.'));
      evidence.push(...sharedEvidence(c, reversalDir, 'reversal'));
    } else {
      evidence.push(ev(0, 'Price closed ' + (high ? 'above' : 'below') + ' the level ' + ago(n, at) + ': this pool was taken, not swept.'));
      evidence.push(...sharedEvidence(c, high ? 1 : -1, 'breakout'));
    }
    const dirOfRead = swept ? reversalDir : (high ? 1 : -1);
    const conclusion = conclude(dirOfRead, evidence, (word, conf) => swept
      ? 'The purpose of this move looks like a liquidity grab: trigger the ' + resting + ', fill large orders against them, then reverse. The read is ' + word + ' with ' + conf + ' confidence'
        + (word === (reversalDir > 0 ? 'bullish' : 'bearish') ? ': the reversal ' + (reversalDir > 0 ? 'up' : 'down') + ' is the more likely path.' : word === 'neutral' ? ': the evidence is mixed.' : ': the data leans against the reversal, so this may be a pause rather than a turn.')
      : 'A close beyond the pool means the stops were absorbed as a real breakout rather than a trap. The read is ' + word + ' (' + conf + ').');
    return result('sweep', swept ? (high ? 'Sweep of equal highs' : 'Sweep of equal lows') : (high ? 'Equal highs taken' : 'Equal lows taken'), (swept ? 'Liquidity sweep at ' : 'Liquidity taken at ') + f2(l.level),
      [['Level', f2(l.level) + ' (x' + l.count + ' touches)'], [swept ? 'Swept' : 'Taken', when(bars, at) + ', ' + ago(n, at)], ['Wick beyond level', f2(wick) + ' (' + wickAtr.toFixed(1) + ' ATR)'], ['Closed back inside by', swept ? f2(closeBack) : ''],
        ['Sweep candle volume', vr != null ? vr.toFixed(1) + 'x average' : ''], ['Move since', follow != null ? (follow >= 0 ? '+' : '') + follow.toFixed(1) + ' ATR away from the level' : '']], evidence, conclusion,
      [swept ? 'Smart-money traders often hunt the stops resting beyond equal highs / lows, then reverse. The tell is the close back inside.' : 'A close beyond is usually acceptance, not a trap.', DISCLAIMER]);
  }

  /* ---------- break of structure / change of character ---------- */
  function structureEvent(a, bars, idx, ctx) {
    const e = a.structure.events[idx]; if (!e) return null;
    const c = context(a, bars, ctx), n = a.n, atr = a.atr, up = e.dir > 0, choch = e.type === 'CHoCH';
    const bar = bars[e.idx], body = Math.abs(bar.c - bar.o) / (atr || 1), through = Math.abs(bar.c - e.level) / (atr || 1);
    const vr = avgVol(bars, e.idx) > 0 ? (bar.v || 0) / avgVol(bars, e.idx) : null;
    const after = bars.slice(e.idx + 1);
    let held = null, retest = null;
    if (after.length) {
      held = up ? after.every((b) => b.c > e.level) : after.every((b) => b.c < e.level);
      retest = after.find((b) => (up ? b.l <= e.level : b.h >= e.level)) ? true : false;
    }
    const gapMade = a.fvg.some((g) => g.dir === e.dir && g.i >= e.idx - 2 && g.i <= e.idx + 1);
    const evidence = [];
    evidence.push(ev(body >= 1 ? 1.5 : 0, 'The breaking candle had a ' + body.toFixed(1) + ' ATR body and closed ' + through.toFixed(1) + ' ATR beyond ' + f2(e.level) + (body >= 1 ? ': a decisive close.' : '.')));
    if (vr != null) evidence.push(ev(vr >= 1.3 ? 1.5 : vr < 0.8 ? -1 : 0, 'It traded ' + vr.toFixed(1) + 'x normal volume' + (vr >= 1.3 ? ': participation behind the break.' : vr < 0.8 ? ': thin, which weakens it.' : '.')));
    if (gapMade) evidence.push(ev(1.5, 'It left a fair value gap behind it: displacement, the footprint of institutional order flow.'));
    if (held != null) evidence.push(ev(held ? 1.5 : -2, held ? 'Price has stayed ' + (up ? 'above' : 'below') + ' the broken level since.' : 'Price has closed back through the broken level since: the break failed.'));
    if (retest) evidence.push(ev(held ? 1 : 0, 'Price retested the level after the break' + (held ? ' and held it, the classic confirmation.' : '.')));
    evidence.push(...sharedEvidence(c, e.dir, up ? 'upside break' : 'downside break').filter((x) => !/last structure break/.test(x.text)));
    const conclusion = conclude(e.dir, evidence, (word, conf) => (choch
      ? 'A change of character is the first sign the prevailing ' + (up ? 'down' : 'up') + 'trend may be ending: the side that was in control lost a key level. It is a warning, not confirmation; a second break in the same direction is what confirms a new trend. '
      : 'A break of structure is a continuation signal: the ' + (up ? 'up' : 'down') + 'trend made a new ' + (up ? 'high' : 'low') + ' and its intent looks to be ' + (up ? 'accumulation and higher prices' : 'distribution and lower prices') + '. ')
      + 'The read is ' + word + ' with ' + conf + ' confidence.');
    return result('structure', choch ? 'Change of character (CHoCH)' : 'Break of structure (BOS)', (choch ? 'CHoCH ' : 'BOS ') + (up ? 'up' : 'down') + ' through ' + f2(e.level),
      [['Level broken', f2(e.level)], ['Swing formed', when(bars, e.fromIdx) + ', ' + ago(n, e.fromIdx)], ['Broken', when(bars, e.idx) + ', ' + ago(n, e.idx)], ['Break candle', body.toFixed(1) + ' ATR body, ' + (vr != null ? vr.toFixed(1) + 'x volume' : '')],
        ['Held since', held == null ? '' : held ? 'yes' : 'no'], ['Left a fair value gap', gapMade ? 'yes' : 'no']], evidence, conclusion,
      [choch ? 'CHoCH: a break AGAINST the prior trend. BOS: a break WITH it.' : 'BOS: a break WITH the prevailing trend.', DISCLAIMER]);
  }

  /* ---------- opening gaps ---------- */
  function openingGap(a, bars, idx, ctx) {
    const g = a.gaps[idx]; if (!g) return null;
    const c = context(a, bars, ctx), n = a.n, up = g.dir > 0;
    const filled = g.filledAt != null;
    const evidence = [];
    if (a.gapStat) evidence.push(ev(a.gapStat.rate >= 0.6 ? 1 : a.gapStat.rate <= 0.4 ? -1 : 0, 'Gaps like this have filled ' + a.gapStat.filled + ' of ' + a.gapStat.total + ' times (' + Math.round(a.gapStat.rate * 100) + '%) in this history.'));
    evidence.push(...sharedEvidence(c, up ? -1 : 1, 'gap fill'));
    const conclusion = conclude(up ? -1 : 1, evidence, (word, conf) => filled ? 'This gap has already closed.' : 'An unfilled gap is an area price often returns to. The read on a fill is ' + word + ' with ' + conf + ' confidence.');
    return result('gap', (up ? 'Gap up' : 'Gap down') + ' ' + (g.pct * 100).toFixed(1) + '%', (up ? 'Gap up ' : 'Gap down ') + (g.pct * 100).toFixed(1) + '%, closes at ' + f2(g.prevClose),
      [['Prior close', f2(g.prevClose)], ['Open', f2(g.prevClose * (1 + g.pct))], ['Status', filled ? 'filled ' + ago(n, g.filledAt) : 'unfilled'], ['Formed', when(bars, g.i) + ', ' + ago(n, g.i)]], evidence, conclusion, [DISCLAIMER]);
  }

  /* ---------- whole-map conclusion ---------- */
  function overall(a, bars, ctx) {
    if (!a) return null;
    const c = context(a, bars, ctx), items = [];
    const push = (w, text) => items.push(ev(w, text));
    if (c.ev) push(c.ev.dir > 0 ? 2 : -2, (c.ev.type === 'CHoCH' ? 'Change of character ' : 'Break of structure ') + (c.ev.dir > 0 ? 'up' : 'down') + ' through ' + f2(c.ev.level) + ' (' + ago(a.n, c.ev.idx) + ').');
    if (c.pos != null) push(c.pos <= 0.5 ? 0.5 : -0.5, 'Price is in ' + (c.pos <= 0.5 ? 'discount' : 'premium') + ' of its range.');
    if (c.vwapSide) push(c.vwapSide > 0 ? 0.5 : -0.5, 'Price is ' + (c.vwapSide > 0 ? 'above' : 'below') + ' VWAP.');
    const sweep = a.liquidity.filter((l) => l.sweptAt != null && a.n - 1 - l.sweptAt <= 15).sort((x, y) => y.sweptAt - x.sweptAt)[0];
    if (sweep) push(sweep.kind === 'EQL' ? 1.5 : -1.5, 'Recent sweep of equal ' + (sweep.kind === 'EQL' ? 'lows' : 'highs') + ' at ' + f2(sweep.level) + ' (' + ago(a.n, sweep.sweptAt) + ').');
    const activeOb = a.structure.orderBlocks.filter((o) => o.invalidAt == null).slice(-1)[0];
    if (activeOb) push(activeOb.dir > 0 ? 1 : -1, 'Active ' + (activeOb.dir > 0 ? 'demand' : 'supply') + ' block ' + f2(activeOb.bottom) + ' to ' + f2(activeOb.top) + '.');
    if (c.flow) push(c.flow.buyShare >= 0.58 ? 1 : c.flow.buyShare <= 0.42 ? -1 : 0, 'Live order flow is ' + Math.round(c.flow.buyShare * 100) + '% buyers.');
    if (c.htf) push(c.htf * 1.5, 'The higher timeframe leans ' + (c.htf > 0 ? 'up' : 'down') + '.');
    const net = items.reduce((s, e) => s + e.w, 0);
    const bias = net >= 1.5 ? 'bullish' : net <= -1.5 ? 'bearish' : 'neutral';
    const confidence = Math.abs(net) >= 4 ? 'high' : Math.abs(net) >= 2.5 ? 'medium' : 'low';
    const purpose = bias === 'bullish' ? 'The map reads as accumulation: structure, location and flow lean toward buyers being in control.' : bias === 'bearish' ? 'The map reads as distribution: structure, location and flow lean toward sellers being in control.' : 'The map is mixed: no side has clear control, so expect rotation between the zones.';
    return { bias, confidence, score: Math.round(net * 10) / 10, purpose, evidence: items, note: DISCLAIMER };
  }

  const KINDS = { ob: orderBlock, fvg: fairValueGap, liq: liquidity, sweep: liquidity, structure: structureEvent, gap: openingGap };
  function explain(a, bars, kind, index, ctx) {
    const fn = KINDS[kind]; if (!a || !fn || !Array.isArray(bars)) return null;
    try { return fn(a, bars, index, ctx || {}); } catch (_) { return null; }
  }

  return { explain, overall, context, DISCLAIMER };
});
