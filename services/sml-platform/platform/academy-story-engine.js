'use strict';

/* The story engine: turns what the Academy measures on a stock into article angles nobody else is writing, ranks them by
 * the strength of the setup and by what search engines are already chasing, and drafts the piece: a hook, the numbers, the
 * speculation (labelled as such), the path to a price target (the same path the GIF animates), what would kill it, and a
 * bottom line. Deterministic prose with varied phrasing, written the way a trader talks, never the way a press release reads.
 *
 * Angles: gamma squeeze (dealer positioning), short squeeze / short covering (FINRA short volume, days to cover), earnings
 * speculation through the smart-money map, unusual tape (sweeps, blocks, off-exchange share, absorption), and a pure
 * structure story (break of structure after a liquidity sweep). Every number in a draft comes from the candidate's data. */

const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r2 = (v) => Math.round(v * 100) / 100;
const px = (v) => (v >= 1 ? '$' + Number(v).toFixed(2) : '$' + Number(v).toFixed(4));
const pct = (v, d = 1) => (v >= 0 ? '+' : '') + Number(v).toFixed(d) + '%';
const big = (v) => (v == null ? '—' : Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(Math.round(v)));
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];
const seedOf = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slugify = (s) => String(s).toLowerCase().replace(/\$/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);

const ANGLES = {
  gamma: { label: 'Gamma squeeze', keywords: ['gamma squeeze', 'dealer gamma', 'call wall', 'options positioning'] },
  short: { label: 'Short squeeze', keywords: ['short squeeze', 'short covering', 'short interest', 'days to cover'] },
  earnings: { label: 'Earnings speculation', keywords: ['earnings preview', 'earnings play', 'implied move', 'smart money'] },
  tape: { label: 'Unusual tape', keywords: ['unusual activity', 'dark pool', 'block trades', 'market makers'] },
  structure: { label: 'Structure story', keywords: ['liquidity sweep', 'break of structure', 'order block', 'smart money concepts'] },
  /* the angle that is always available: a stock with no loud signal still has a story (a build-up, a move nobody agrees on, a rumor in the tape), and the desk's job is the narrative */
  narrative: { label: 'Market narrative', keywords: ['stock narrative', 'price speculation', 'build-up', 'what the market is pricing in'] }
};

/* ---------- angle scorers: each returns { score, facts, lean, pt, scenario } or null ---------- */
function gammaAngle(c) {
  const g = c.gamma; if (!g || !g.available) return null;
  const p = num(c.price); if (!(p > 0)) return null;
  let s = 0; const facts = [];
  const neg = g.regime === 'negative', pressure = num(g.pressurePct, 0), zero = num(g.zeroDteShare, 0);
  if (neg) { s += 30; facts.push(`Dealers are short gamma on ${c.symbol}: they have to buy as it rises and sell as it falls, which is what turns a move into a run.`); } else facts.push(`Dealers are long gamma on ${c.symbol} right now, the pinning kind of positioning; the squeeze case needs price to clear the flip first.`);
  if (pressure >= 25) { s += 25; facts.push(`Hedging pressure is ${g.pressure || 'high'}: the shares dealers would need to buy on a move equal ${Math.round(pressure)}% of an average day's volume.`); } else if (pressure >= 10) { s += 12; facts.push(`Hedge flows would absorb ${Math.round(pressure)}% of a normal day's volume.`); }
  const cw = g.callWall && num(g.callWall.strike), cwd = g.callWall && num(g.callWall.distancePct);
  if (cw && cwd != null && cwd > 0 && cwd <= 6) { s += 20; facts.push(`The call wall sits at ${px(cw)}, only ${cwd.toFixed(1)}% above: that is where the most call open interest is stacked, and the air pocket above it is where squeezes run.`); }
  // the flip is a fact only when the service measured it and it sits within reach; an approximate or far-away flip is noise
  const flipOk = num(g.flipStrike) > 0 && !g.flipIsApproximate && Math.abs(num(g.flipStrike) / p - 1) <= 0.25;
  const flip = flipOk ? num(g.flipStrike) : null, fd = flipOk ? num(g.flipDistancePct, (flip / p - 1) * 100) : null;
  if (flip && fd != null) { if (p >= flip) { s += 10; facts.push(`Price is above the gamma flip at ${px(flip)}; below it, dealer hedging works against the stock.`); } else if (Math.abs(fd) <= 3) { s += 8; facts.push(`The gamma flip at ${px(flip)} is ${Math.abs(fd).toFixed(1)}% away; reclaiming it switches dealer hedging from a headwind to a tailwind.`); } }
  if (zero >= 0.3) { s += 10; facts.push(`${Math.round(zero * 100)}% of the open options are same-day expiries, the fuel that makes gamma moves violent in the final hours.`); }
  if (num(c.relVol, 1) >= 1.5) { s += 5; facts.push(`Volume is ${c.relVol.toFixed(1)}x normal today.`); }
  if (c.short && num(c.short.ratio) >= 0.45) { s += 10; facts.push(`On top of it, ${Math.round(c.short.ratio * 100)}% of off-exchange prints were short sales: the gamma case and the short case are the same case here.`); }
  if (s < 45) return null;
  const pt = cw && cw > p * 1.02 ? cw : r2(p * (1 + Math.min(0.25, 0.06 + pressure / 200)));
  const nextWall = cw && cw > p ? px(cw) : 'the next strike cluster';
  return {
    score: clamp(s, 0, 100), facts, lean: 'bullish', pt: r2(pt), ptPct: r2((pt / p - 1) * 100), timeframe: zero >= 0.3 ? 'days' : '1 to 2 weeks',
    scenario: { trigger: flip && p < flip ? `a close back above the gamma flip at ${px(flip)}` : `a push through ${nextWall} on volume`, confirm: `call volume outrunning put volume while dealers chase the hedge`, target: `${px(pt)} where the call wall sits and the hedge buying runs out`, invalidation: flip ? `a close back under ${px(flip)}, where dealer hedging flips against the stock` : `a failed push that closes back under today's low` },
    path: [{ label: 'TRIGGER', price: r2(flip && p < flip ? flip * 1.005 : p * 1.02) }, { label: 'CONFIRM', price: r2(p + (pt - p) * 0.55) }], stop: r2(flip && flip < p ? flip * 0.99 : p * 0.93),
    controversy: `Everyone is watching the chart. The options dealers are the ones who will move it.`
  };
}
function shortAngle(c) {
  const sh = c.short; if (!sh) return null;
  const p = num(c.price); if (!(p > 0)) return null;
  let s = 0; const facts = [];
  const ratio = num(sh.ratio), dtc = num(sh.daysToCover), si = num(sh.shortInterestPct), base = num(sh.baselineRatio);
  if (ratio != null && ratio >= 0.5) { s += 30; facts.push(`${Math.round(ratio * 100)}% of ${c.symbol}'s off-exchange volume printed as short sales (FINRA daily short volume)${base != null ? `, against a normal ${Math.round(base * 100)}%` : ''}.`); } else if (ratio != null && ratio >= 0.42) { s += 15; facts.push(`${Math.round(ratio * 100)}% of off-exchange volume was short sales.`); }
  if (dtc != null && dtc >= 5) { s += 25; facts.push(`Days to cover: ${dtc.toFixed(1)}. Every short in the name needs ${dtc.toFixed(1)} full days of normal volume to get out.`); } else if (dtc != null && dtc >= 3) { s += 15; facts.push(`Days to cover: ${dtc.toFixed(1)}.`); }
  if (si != null && si >= 20) { s += 20; facts.push(`Short interest is ${si.toFixed(1)}% of the float.`); } else if (si != null && si >= 10) { s += 10; facts.push(`Short interest is ${si.toFixed(1)}% of the float.`); }
  if (c.runner && (c.runner.phase >= 2 || c.runner.parabolic)) { s += 10; facts.push(`The stock is already running${c.runner.parabolic ? ', and the run has gone parabolic' : ''}: shorts are losing, not waiting.`); }
  if (num(c.relVol, 1) >= 2) { s += 10; facts.push(`${c.relVol.toFixed(1)}x normal volume: the covering, if it starts, has an audience.`); }
  if (c.smc && c.smc.structure && c.smc.structure.some((e) => e.type === 'BOS' && e.dir > 0)) { s += 8; facts.push(`Structure broke to the upside on the daily chart.`); }
  if (c.institutional && num(c.institutional.bias) >= 30) { s += 7; facts.push(`The tape leans institutional-buy (${c.institutional.label}).`); }
  if (s < 45) return null;
  const hi = c.smc && c.smc.range ? num(c.smc.range.hi) : null;
  const pt = hi && hi > p * 1.05 ? r2(hi) : r2(p * (1 + clamp(0.08 + (dtc || 2) * 0.03, 0.1, 0.45)));
  return {
    score: clamp(s, 0, 100), facts, lean: 'bullish', pt, ptPct: r2((pt / p - 1) * 100), timeframe: dtc != null && dtc >= 5 ? '1 to 3 weeks' : 'days',
    path: [{ label: 'TRIGGER', price: r2(hi && hi > p && hi < pt ? hi : p * 1.04) }, { label: 'CONFIRM', price: r2(p + (pt - p) * 0.6) }], stop: r2(p * 0.9),
    scenario: { trigger: `a close above ${hi && hi > p && hi < pt ? px(hi) + ', the swing high shorts are leaning on' : 'the recent high on rising volume'}`, confirm: `a second day of ${Math.round((ratio || 0.5) * 100)}%-plus short volume with price refusing to fall: shorts pressing into strength`, target: `${px(pt)}, where the covering runs out of sellers to meet`, invalidation: `a close back under the 20-day average with short volume drying up: the shorts were right` },
    controversy: `The shorts are not scared yet. That is exactly why the squeeze is still available.`
  };
}
function earningsAngle(c) {
  const e = c.earnings; if (!e || num(e.daysAway) == null || e.daysAway < 0 || e.daysAway > 7 || !e.date) return null;
  const p = num(c.price); if (!(p > 0)) return null;
  let s = 25; const facts = [];
  const dateText = (() => { const d = new Date(String(e.date).slice(0, 10) + 'T12:00:00Z'); return Number.isNaN(d.valueOf()) ? String(e.date) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); })();
  facts.push(`${c.symbol} reports ${e.daysAway === 0 ? 'today' : e.daysAway === 1 ? 'tomorrow' : 'in ' + e.daysAway + ' days'}, ${dateText}${e.timing && e.timing !== 'UNSPECIFIED' ? ' (' + e.timing + ')' : ''}.`);
  const imp = num(e.impliedPct), hist = num(e.histAvgMovePct);
  if (imp != null) { facts.push(`The options market prices a ${imp.toFixed(1)}% move${hist != null ? `; the stock has averaged ${hist.toFixed(1)}% on its last prints` : ''}.`); if (hist != null && hist > imp * 1.3) { s += 15; facts.push(`History says the move is underpriced.`); } }
  let lean = 0;
  if (c.smc) {
    const g = (c.smc.fvgs || []).filter((x) => !x.filled)[0]; if (g) { s += 10; lean += g.dir > 0 ? 1 : -1; facts.push(`An unfilled ${g.dir > 0 ? 'bullish' : 'bearish'} imbalance sits at ${px(g.bottom)} to ${px(g.top)}: a magnet if the print disappoints${g.dir > 0 ? ' and support if it delivers' : ''}.`); }
    if (c.smc.range) { const pos = clamp(c.smc.range.pos, 0, 1); s += 5; lean += pos < 0.4 ? 1 : pos > 0.7 ? -1 : 0; facts.push(`Price sits ${pos > 0.55 ? 'in the premium part of' : pos < 0.45 ? 'in the discount part of' : 'in the middle of'} its range (${Math.round(pos * 100)}% up from the low) into the print.`); }
    const sw = (c.smc.sweeps || [])[0]; if (sw) { s += 10; lean += sw.kind === 'EQL' ? 1 : -1; facts.push(`The ${sw.kind === 'EQL' ? 'lows' : 'highs'} at ${px(sw.level)} were swept and reclaimed: stops were taken before the event.`); }
  }
  if (c.institutional && num(c.institutional.bias) != null) { s += 8; lean += Math.sign(c.institutional.bias); facts.push(`The tape leans ${c.institutional.label} into the event.`); }
  if (c.short && num(c.short.ratio) >= 0.45) { s += 8; lean += 1; facts.push(`${Math.round(c.short.ratio * 100)}% short volume into earnings: a beat squeezes.`); }
  if (c.sentiment && c.sentiment.crowdedLong) { s += 5; lean -= 1; facts.push(`Positioning is crowded long: the bar for the print is high.`); }
  const dir = lean >= 1 ? 1 : lean <= -1 ? -1 : (c.sentiment && num(c.sentiment.score) > 0.2 ? 1 : -1);
  const move = imp != null ? imp / 100 : 0.08;
  const pt = r2(p * (1 + dir * move));
  return {
    score: clamp(s, 0, 100), facts, lean: dir > 0 ? 'bullish' : 'bearish', pt, ptPct: r2((pt / p - 1) * 100), timeframe: 'through the print',
    path: [{ label: 'INTO THE PRINT', price: r2(p * (1 + dir * move * 0.15)) }, { label: 'REACTION', price: r2(p * (1 + dir * move * 0.7)) }], stop: r2(p * (1 - dir * move * 0.6)),
    scenario: { trigger: dir > 0 ? `holding above ${c.smc && c.smc.vwap ? px(c.smc.vwap.level) + ' (the anchored VWAP)' : 'the pre-earnings low'} into the report` : `a failure to reclaim ${c.smc && c.smc.vwap ? px(c.smc.vwap.level) : 'the pre-earnings high'} before the report`, confirm: `the first 30 minutes after the print ${dir > 0 ? 'holding the gap' : 'failing to fill the gap'}`, target: `${px(pt)}, one implied move ${dir > 0 ? 'up' : 'down'}`, invalidation: `the opposite gap holding through the first hour` },
    controversy: dir > 0 ? `The crowd is pricing fear. The chart is pricing a beat.` : `The crowd is set up for a beat. The chart is set up for a sell-the-news.`
  };
}
function tapeAngle(c) {
  const t = c.tape; if (!t) return null;
  const p = num(c.price); if (!(p > 0)) return null;
  let s = 0; const facts = []; let dir = 0;
  const sb = num(t.sweepBuy, 0), ss = num(t.sweepSell, 0), bb = num(t.blockBuy, 0), bs = num(t.blockSell, 0);
  if (sb + ss >= 3 && Math.max(sb, ss) >= 2 * Math.min(sb, ss)) { s += 30; dir += sb > ss ? 1 : -1; facts.push(`${sb + ss} intermarket sweeps today, ${sb > ss ? sb + ' on the buy side' : ss + ' on the sell side'}: orders that hit several exchanges at once, the signature of someone who wants size now.`); }
  if (bb + bs >= 2) { s += 20; dir += bb > bs ? 1 : -1; facts.push(`${bb + bs} block prints (10,000 shares or $1M and up), ${bb >= bs ? 'mostly bought' : 'mostly sold'}.`); }
  const off = num(t.offSharePct), typ = num(t.typicalSharePct, 42);
  if (off != null && off >= typ + 10) { s += 20; facts.push(`${Math.round(off)}% of the volume printed off-exchange against a typical ${Math.round(typ)}%: dark pools are busier than the lit book.`); }
  if (t.absorption) { s += 15; facts.push(`Absorption on the tape: heavy volume with almost no price progress, someone sitting on the offer or holding the bid.`); }
  if (num(c.relVol, 1) >= 2) { s += 10; facts.push(`${c.relVol.toFixed(1)}x normal volume.`); }
  if (s < 45) return null;
  const up = dir >= 0;
  const lvl = c.smc && c.smc.openLiquidity ? c.smc.openLiquidity.find((l) => (up ? l.level > p : l.level < p)) : null;
  const pt = lvl ? r2(lvl.level) : r2(p * (1 + (up ? 1 : -1) * 0.08));
  return {
    score: clamp(s, 0, 100), facts, lean: up ? 'bullish' : 'bearish', pt, ptPct: r2((pt / p - 1) * 100), timeframe: 'days',
    path: [{ label: 'TRIGGER', price: r2(p * (1 + (up ? 1 : -1) * 0.02)) }, { label: 'CONFIRM', price: r2(p + (pt - p) * 0.6) }], stop: r2(p * (1 - (up ? 1 : -1) * 0.06)),
    scenario: { trigger: `the tape staying one-sided for another session (${up ? 'buy' : 'sell'} sweeps and blocks)`, confirm: `price ${up ? 'holding above' : 'failing under'} the day's VWAP while the prints keep coming`, target: `${px(pt)}${lvl ? ', the resting liquidity at ' + (lvl.kind === 'EQH' ? 'equal highs' : 'equal lows') : ''}`, invalidation: `the sweeps flipping to the other side, or price moving against the prints for two sessions` },
    controversy: `Retail reads the candles. The prints say who is actually in the stock.`
  };
}
function structureAngle(c) {
  const m = c.smc; if (!m) return null;
  const p = num(c.price); if (!(p > 0)) return null;
  let s = 0; const facts = []; let dir = 0;
  const ev = (m.structure || [])[0]; if (ev) { s += 25; dir += ev.dir; facts.push(`${ev.type === 'BOS' ? 'Break of structure' : 'Change of character'} ${ev.dir > 0 ? 'up' : 'down'} through ${px(ev.level)} on the daily chart.`); }
  const sw = (m.sweeps || [])[0]; if (sw) { s += 25; dir += sw.kind === 'EQL' ? 1 : -1; facts.push(`Liquidity sweep: price ran the ${sw.kind === 'EQL' ? 'lows' : 'highs'} at ${px(sw.level)} and closed back inside the range.`); }
  const ob = (m.orderBlocks || [])[0]; if (ob) { s += 10; facts.push(`An active ${ob.dir > 0 ? 'demand' : 'supply'} block at ${px(ob.bottom)} to ${px(ob.top)}: where the move that broke structure started.`); }
  const g = (m.fvgs || []).filter((x) => !x.filled)[0]; if (g) { s += 10; facts.push(`Unfilled ${g.dir > 0 ? 'bullish' : 'bearish'} imbalance ${px(g.bottom)} to ${px(g.top)}.`); }
  if (s < 50) return null;
  const up = dir >= 0;
  const target = up ? (m.openLiquidity || []).find((l) => l.kind === 'EQH' && l.level > p) : (m.openLiquidity || []).find((l) => l.kind === 'EQL' && l.level < p);
  const pt = target ? r2(target.level) : r2(p * (1 + (up ? 1 : -1) * 0.1));
  return {
    score: clamp(s, 0, 100), facts, lean: up ? 'bullish' : 'bearish', pt, ptPct: r2((pt / p - 1) * 100), timeframe: '1 to 3 weeks',
    path: [{ label: 'RETEST', price: r2(ob ? (up ? ob.top : ob.bottom) : (ev ? ev.level : p * (1 - (up ? 1 : -1) * 0.02))) }, { label: 'BREAK HOLDS', price: r2(ev ? ev.level * (1 + (up ? 1 : -1) * 0.01) : p + (pt - p) * 0.4) }], stop: r2(sw ? sw.level * (1 - (up ? 1 : -1) * 0.01) : p * (1 - (up ? 1 : -1) * 0.08)),
    scenario: { trigger: ob ? `a retest of the ${ob.dir > 0 ? 'demand' : 'supply'} block ${px(ob.bottom)} to ${px(ob.top)} that holds` : `a retest of the break level that holds`, confirm: `a close back ${up ? 'above' : 'below'} the break level on rising volume`, target: `${px(pt)}${target ? ', the resting liquidity at the equal ' + (up ? 'highs' : 'lows') : ''}`, invalidation: `a close ${up ? 'below' : 'above'} the ${up ? 'swept low' : 'swept high'}: the sweep was the real move` },
    controversy: `The indicator crowd sees noise. The structure says the stops were already taken.`
  };
}


/* The narrative angle: always available for a name with a price history. It does not claim a signal the data lacks; it reads the build-up, the move or the
   rumor in the tape (compression, a break toward the range's edge, unusual volume, the headline) and frames it as the story the market is telling, with a
   measured scenario (ATR-based target and stop) that is labelled speculation. Variants: buildup, speculation (a move nobody agrees on), rumor (a headline in play). */
function narrativeAngle(c, { headline = '' } = {}) {
  const p = num(c.price); const d = Array.isArray(c.daily) ? c.daily : [];
  if (!(p > 0) || d.length < 12) return null;
  const closes = d.map((b) => num(b.c, 0)), hi = d.map((b) => num(b.h, 0)), lo = d.map((b) => num(b.l, 0));
  const n = d.length, avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const trs = (from, to) => { const out = []; for (let i = Math.max(1, from); i < to; i++) out.push(Math.max(hi[i] - lo[i], Math.abs(hi[i] - closes[i - 1]), Math.abs(lo[i] - closes[i - 1]))); return out; };
  const atr = avg(trs(n - 14, n)) || p * 0.02, atrPrev = avg(trs(n - 44, n - 30)) || atr;
  const sma = (k) => (n >= k ? avg(closes.slice(n - k)) : null), s20 = sma(20), s50 = sma(50);
  const win = Math.min(20, n), h20 = Math.max(...hi.slice(n - win)), l20 = Math.min(...lo.slice(n - win));
  const ch5 = n > 6 && closes[n - 6] > 0 ? (p / closes[n - 6] - 1) * 100 : null, ch20 = n > 21 && closes[n - 21] > 0 ? (p / closes[n - 21] - 1) * 100 : null;
  const pos = h20 > l20 ? (p - l20) / (h20 - l20) : 0.5, atrPct = (atr / p) * 100, squeeze = atrPrev > 0 ? atr / atrPrev : 1;
  const relVol = num(c.relVol), chg = num(c.changePct);
  const variant = (relVol != null && relVol >= 1.5) || (chg != null && Math.abs(chg) >= 3) ? 'speculation' : headline ? 'rumor' : 'buildup';
  let lean = 0; if (s20 != null) lean += p > s20 ? 1 : -1; if (ch5 != null) lean += ch5 > 0 ? 1 : -1; if (c.direction && num(c.direction.bias) != null) lean += Math.sign(c.direction.bias); lean += pos > 0.8 ? 1 : pos < 0.2 ? -1 : 0;
  const up = lean >= 0, mv = clamp((2 * atr) / p, 0.04, 0.15), sd = clamp(atr / p, 0.02, 0.07);
  const pt = r2(p * (1 + (up ? 1 : -1) * mv)), stop = r2(p * (1 - (up ? 1 : -1) * sd));
  const trig = up ? (h20 > p * 1.004 ? h20 : p * 1.012) : (l20 < p * 0.996 ? l20 : p * 0.988);
  const facts = [];
  facts.push(`${c.symbol} trades at ${px(p)}, in the ${pos >= 0.66 ? 'top third' : pos <= 0.34 ? 'bottom third' : 'middle'} of its ${win}-day range (${px(l20)} to ${px(h20)}).`);
  if (s20 != null) facts.push(`Price is ${p >= s20 ? 'above' : 'below'} its 20-day average of ${px(s20)}${s50 != null ? ` and ${p >= s50 ? 'above' : 'below'} the 50-day at ${px(s50)}` : ''}.`);
  if (ch5 != null) facts.push(`The stock is ${pct(ch5)} over five sessions${ch20 != null ? ` and ${pct(ch20)} over twenty` : ''}.`);
  facts.push(`The average true range is ${atrPct.toFixed(1)}% of the price${squeeze < 0.85 ? ', tighter than it was a month ago: the range is compressing' : squeeze > 1.2 ? ', wider than a month ago: the stock is getting louder' : ''}.`);
  if (relVol != null && relVol >= 1.2) facts.push(`Volume is ${relVol.toFixed(1)}x normal.`);
  if (c.direction && c.direction.label) facts.push(`The market backdrop reads ${c.direction.label}.`);
  if (c.gamma && c.gamma.available) facts.push(`Dealers are ${c.gamma.regime === 'negative' ? 'short' : 'long'} gamma on the name.`);
  if (c.earnings && num(c.earnings.daysAway) != null && c.earnings.daysAway >= 0 && c.earnings.daysAway <= 21) facts.push(`Earnings are ${c.earnings.daysAway === 0 ? 'today' : c.earnings.daysAway === 1 ? 'tomorrow' : 'in ' + c.earnings.daysAway + ' days'}.`);
  const what = { buildup: 'a build-up', speculation: 'a move nobody agrees on', rumor: 'a story the tape is already trading' }[variant];
  return {
    score: 40, variant, facts, lean: up ? 'bullish' : 'bearish', pt, ptPct: r2((pt / p - 1) * 100), timeframe: '1 to 3 weeks',
    path: [{ label: 'TRIGGER', price: r2(trig) }, { label: 'CONFIRM', price: r2(p + (pt - p) * 0.55) }], stop,
    scenario: { trigger: `a ${up ? 'close above' : 'close below'} ${px(trig)}, the edge of the ${win}-day range`, confirm: `volume expanding in the direction of the break instead of fading`, target: `${px(pt)}, about two average ranges from here`, invalidation: `a close ${up ? 'below' : 'above'} ${px(stop)}, which would put the stock back inside the range it is trying to leave` },
    controversy: variant === 'buildup' ? `A quiet stock is not a dead stock. The market is usually early to a build-up and late to the headline.` : variant === 'speculation' ? `Everyone has a theory for the move. The tape only has the facts, and they support fewer theories than the comments do.` : `A story the tape is already trading is no longer a secret. The question is whether it is priced.`,
    narrativeKind: what
  };
}

/* ---------- ranking: setup strength × what search is already chasing × the gap nobody has filled ---------- */
function rankStories(candidates, { maxPerSymbol = 1, force = false } = {}) {
  const out = [];
  for (const c of candidates || []) {
    if (!c || !c.symbol) continue;
    /* force (a piece asked for by name): any name with a price history gets a story, and the narrative angle is the one that never says no */
    if (!force && (num(c.price, 0) < 1 || num(c.adv, 0) < 300_000)) continue;
    const angles = [['gamma', gammaAngle(c)], ['short', shortAngle(c)], ['earnings', earningsAngle(c)], ['tape', tapeAngle(c)], ['structure', structureAngle(c)]].filter(([, a]) => a);
    const heat = c.heat || {};
    const h24 = num(heat.google24h, 0) + num(heat.bing24h, 0);
    const heatMult = 1 + Math.min(1.2, Math.log1p(h24) / 3); // a name in the news ranks, a dead name does not
    const scored = angles.map(([key, a]) => {
      const covered = num(heat.coverage && heat.coverage[key], null);
      const gap = covered == null ? 1 : covered === 0 ? 1.35 : covered <= 2 ? 1.1 : 0.6; // nobody wrote it yet = the story
      const rank = Math.round(a.score * heatMult * gap);
      return { symbol: c.symbol, angle: key, label: ANGLES[key].label, rank, ...a, heat: { h24, covered, heatMult: r2(heatMult), gap } };
    }).sort((a, b) => b.rank - a.rank).slice(0, maxPerSymbol);
    if (!scored.length && force) { const nar = narrativeAngle(c, { headline: c.headline || '' }); if (nar) scored.push({ symbol: c.symbol, angle: 'narrative', label: ANGLES.narrative.label, rank: nar.score, ...nar, heat: { h24, covered: null, heatMult: r2(heatMult), gap: 1 } }); }
    out.push(...scored);
  }
  return out.sort((a, b) => b.rank - a.rank);
}

/* ---------- the draft ---------- */
function headlineFor(st, c) {
  const S = '$' + c.symbol, pt = px(st.pt), seed = seedOf(c.symbol + st.angle + Math.round(st.pt));
  const t = {
    gamma: [`${S} Gamma Squeeze Watch: Dealers Are Short Gamma and ${c.gamma && c.gamma.callWall ? 'the ' + px(c.gamma.callWall.strike) + ' Call Wall Is ' + Number(c.gamma.callWall.distancePct).toFixed(1) + '% Away' : 'the Hedge Flows Are Loaded'}`, `Why ${S} Could Gamma Squeeze to ${pt}: The Options Positioning Nobody Is Reading`, `${S}: The Call Wall at ${pt} Is the Whole Story`],
    short: [`${S} Short Squeeze Setup: ${c.short && c.short.ratio != null ? Math.round(c.short.ratio * 100) + '% Short Volume' : 'Shorts Are Pressing'} and ${c.short && c.short.daysToCover != null ? c.short.daysToCover.toFixed(1) + ' Days to Cover' : 'Nowhere to Exit'}`, `${S} Is Loaded for a Short Squeeze: The FINRA Numbers Say ${pt} Is in Play`, `The Shorts in ${S} Have a Problem, and ${pt} Is Where It Shows`],
    earnings: [`${S} Earnings Speculation: What the Smart-Money Map Says Before the Print`, `${S} Into Earnings: The Chart Is Set Up for ${st.lean === 'bullish' ? 'a Beat' : 'a Sell-the-News'}, ${pt} Is the Number`, `${S} Earnings Preview Through the Tape: ${st.lean === 'bullish' ? 'Buyers Positioned Early' : 'Someone Sold Ahead'}`],
    tape: [`${S} Unusual Activity: Sweeps, Blocks and a Dark Pool Tape That Says Someone Is Building`, `Market Makers Are Busy in ${S}: The Prints Point to ${pt}`, `${S}: The Tape Is Telling a Story the Chart Has Not Caught Up To`],
    structure: [`${S} Just Swept the Stops: The Smart-Money Structure Points to ${pt}`, `${S} Break of Structure: Why the Next Leg Targets ${pt}`, `${S}: Stops Taken, Structure Broken, ${pt} in View`],
    narrative: ({
      buildup: [`${S} Looks Quiet. The Tape Says Someone Is Getting Ready for ${pt}`, `Everyone Is Ignoring ${S}. That May Be the Mistake`, `${S} Is Coiling, and ${st.lean === 'bullish' ? 'the Break Level Is Closer Than It Looks' : 'the Floor Is Thinner Than It Looks'}`],
      speculation: [`${S} Is Moving and Nobody Agrees Why. Here Is What the Tape Shows`, `The ${S} Move Everyone Is Explaining Away: A Skeptical Read`, `Is ${S} Really Headed to ${pt}? The Case For and Against`],
      rumor: [`The Story Behind ${S} Is Already in the Price. Is It All of It?`, `${S}: The Rumor Is Out. What the Chart Says About the Next Move`, `What the Market Is Quietly Pricing In on ${S}, and Who Is Wrong`]
    })[st.variant] || [`${S}: What the Market Is Pricing In, and Why It Matters`]
  }[st.angle];
  // a headline that fits (95 characters or fewer) keeps the title tag, the social card and the URL slug clean
  const fits = t.filter((x) => x.length <= 95), pool = fits.length ? fits : t.map((x) => (x.length <= 95 ? x : x.slice(0, 95).replace(/\s+\S*$/, '').replace(/[,:\-\s]+$/, '')));
  const title = pick(pool, seed), alt = pool.filter((x) => x !== title);
  const meta = (st.angle === 'narrative' ? `${c.symbol} stock: what the price, volume and range are saying right now, a speculative scenario to ${pt}, and what would prove it wrong.` : `${c.symbol} ${ANGLES[st.angle].label.toLowerCase()} read from live options, short-volume, dark-pool and structure data: the setup, the path to ${pt}, and what kills it.`).slice(0, 155);
  return { title, alternates: alt, meta, slug: slugify(title) };
}
function tagsFor(st, c) {
  const base = [c.symbol, '$' + c.symbol, ...ANGLES[st.angle].keywords, `${c.symbol} price target`, `${c.symbol} stock`];
  if (c.name) base.push(c.name);
  return [...new Set(base)].slice(0, 12);
}
function draftArticle(st, c, { asOf = Date.now(), author = 'Vaughn McNair', publication = 'Making Easy Money' } = {}) {
  const S = '$' + c.symbol, name = c.name || c.symbol, p = num(c.price), seed = seedOf(c.symbol + st.angle + asOf);
  const when = new Date(asOf).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
  const hl = headlineFor(st, c);
  const hooks = {
    gamma: [`There is a version of ${name} that is just a stock chart. That is not the version the options dealers are trading.`, `Forget the chart for a minute. The people who will move ${S} this week are not traders, they are the dealers hedging the options book.`],
    short: [`Somebody is still shorting ${name} into this. The FINRA tape says so, and the FINRA tape does not have opinions.`, `${S} has a short position that is pressing into strength. That is the one kind of short that ends badly for the short.`],
    earnings: [`${name} reports soon, and the interesting part is not the estimate. It is what the tape did while nobody was watching.`, `Every earnings preview on ${S} will talk about consensus. None of them will show you where the stops were taken.`],
    tape: [`The chart on ${name} looks ordinary. The prints behind it are not.`, `Someone is working ${S} off-exchange, and the size says it is not a retail account.`],
    narrative: [`There is no loud signal on ${name} today. That is the story: the market is deciding something, and the tape is the only witness.`, `${S} is not the stock everyone is talking about. It might be the one worth reading.`],
    structure: [`${name} just did the thing the smart-money crowd waits weeks for: it took the stops and reversed.`, `Price ran the obvious level in ${S}, then closed back inside. That is not noise. That is a sweep.`]
  }[st.angle];
  const V = require('./academy-article-voice');
  const dek = V.dek(st, c, seed);
  const label = ANGLES[st.angle].label;
  const lines = [];
  lines.push(`<p><strong>${esc(pick(hooks, seed))}</strong></p>`);
  lines.push(`<p>${esc(S)} is trading at ${px(p)}${num(c.changePct) != null ? ` (${pct(c.changePct)} on the day)` : ''}${num(c.relVol) != null ? ` on ${c.relVol.toFixed(1)}x its normal volume` : ''}. What follows reads the data on the name, builds the case for ${px(st.pt)}, then tries hard to break it. If a setup cannot survive its own cross-examination, it does not deserve your attention.</p>`);
  lines.push(`<h2>What the data says</h2><ul>${st.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`);
  if (c.direction && c.direction.label) lines.push(`<p>Backdrop: the market read is <strong>${esc(c.direction.label)}</strong> (bias ${c.direction.bias >= 0 ? '+' : ''}${c.direction.bias}), ${c.direction.bias >= 20 ? 'a tailwind for the long case' : c.direction.bias <= -20 ? 'a headwind for any long idea' : 'neither help nor hindrance'}.</p>`);
  lines.push(`<h2>Why it matters: the mechanism</h2>${V.mechanism(st, c, seed).map((t) => `<p>${esc(t)}</p>`).join('')}`);
  lines.push(`<h2>The speculation</h2><p><em>This is the speculative part, and it is labelled that way on purpose.</em> ${esc(st.controversy)} ${esc(speculationLine(st, c, seed))}</p><p>${esc(V.humor(st, c, seed))}</p>`);
  lines.push(`<h2>The path to ${px(st.pt)} (${pct(st.ptPct)})</h2><ol><li><strong>Trigger:</strong> ${esc(st.scenario.trigger)}.</li><li><strong>Confirmation:</strong> ${esc(st.scenario.confirm)}.</li><li><strong>Target:</strong> ${esc(st.scenario.target)}.</li></ol><p>The animation above plays that exact path on the chart: the real candles, then the move the setup needs, step by step. Horizon for the idea: ${esc(st.timeframe)}.</p>`);
  lines.push(`<h2>The case against</h2><p>${esc(V.counter(st, c, seed))}</p>`);
  lines.push(`<h2>What kills it</h2><p>${esc(cap(st.scenario.invalidation))}. If that happens, the story is wrong and the position should not exist anymore. No averaging down, no hoping, no renaming the thesis after the fact.</p>`);
  lines.push(`<h2>Bottom line</h2><p>${esc(bottomLine(st, c, seed))}</p>`);
  lines.push(`<p class="disclosure"><small>Data as of ${esc(when)}: options positioning, FINRA daily short volume, the off-exchange trade record and the smart-money structure map. Levels are rounded, scenarios are illustrations rather than forecasts, and nothing here is a recommendation. This is speculation and education, not financial advice; ${esc(author)} (Grandmaster-Obi) and ${esc(publication)} may hold or trade positions in the names discussed.</small></p>`);
  const parts = {
    kicker: V.KICKER[st.angle] || 'MARKETS', dek, lean: st.lean, symbol: c.symbol, symbolLine: `${S}: ${label}`, price: p,
    changePct: num(c.changePct), relVol: num(c.relVol), pt: st.pt, ptPct: st.ptPct, stop: num(st.stop), timeframe: st.timeframe, keyStat: V.keyStat(st, c),
    takeaways: [
      `${S} leans ${st.lean} on a ${label.toLowerCase()} setup: scenario target ${px(st.pt)} (${pct(st.ptPct)}), horizon ${st.timeframe}.`,
      String(st.facts[0] || '').replace(/\s+/g, ' ').trim(),
      `Wrong if: ${st.scenario.invalidation}.`
    ].filter(Boolean),
    ladder: [{ label: 'Trigger', text: st.scenario.trigger }, { label: 'Confirmation', text: st.scenario.confirm }, { label: 'Target', text: st.scenario.target }, { label: 'Invalidation', text: st.scenario.invalidation }],
    when
  };
  const html = lines.join('\n');
  return { ...hl, html, parts, dek, subtitle: dek, section: 'Markets', asOfIso: new Date(asOf).toISOString(), tags: tagsFor(st, c), tldr: `${S} at ${px(p)}: ${label.toLowerCase()} setup, path to ${px(st.pt)} (${pct(st.ptPct)}), killed by ${st.scenario.invalidation.split(':')[0]}.`, lean: st.lean, pt: st.pt, ptPct: st.ptPct, angle: st.angle, wordCount: html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length };
}
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
function speculationLine(st, c, seed) {
  const pt = px(st.pt);
  const L = {
    gamma: [`If price gets through the strike where the calls are stacked, the dealers who sold those calls have to buy stock to stay hedged, and they do not get to pick their price. That is the mechanical bid behind a move to ${pt}.`, `The bet is simple: the hedging math forces buying above the wall, and ${pt} is where the math runs out of fuel.`],
    short: [`Shorts who pressed into strength have to buy to leave, and the volume to leave through is not there. ${pt} is where the first wave of covering would carry it.`, `When a crowded short meets a stock that will not go down, the exit is up. ${pt} is the first place the exits open.`],
    earnings: [`The positioning into the print leans ${st.lean}. If the report cooperates, one implied move lands near ${pt}. If it does not, the imbalance on the chart is where it goes to find buyers.`, `The chart did its positioning before the number. ${pt} is one expected move in the direction the tape already chose.`],
    tape: [`Sweeps and blocks are not how retail trades. Someone with size is building, and ${pt} is the nearest pool of resting orders they would run into.`, `The off-exchange share says the real volume is happening where the public cannot see it. ${pt} is the level the visible chart has not priced.`],
    structure: [`A sweep followed by a break is the textbook smart-money sequence: take the stops, then move. ${pt} is the next liquidity the move would reach for.`, `The stops are gone and the structure has turned. ${pt} is where the next set of resting orders sits.`],
    narrative: [`This part is speculation, and it is labelled that way. If the stock leaves its range on real volume, about two average ranges takes it to ${pt}. If it does not, nothing here is true.`, `The honest version of the trade: a break from here, on volume, points to ${pt}. Without the volume it is a stock going nowhere politely.`]
  }[st.angle];
  return pick(L, seed + 7);
}
function bottomLine(st, c, seed) {
  const L = [
    `${'$' + c.symbol} is a ${st.lean} ${ANGLES[st.angle].label.toLowerCase()} candidate with a measurable path to ${px(st.pt)} and a clear line that says the idea is wrong. Treat it as what it is: a setup, not a promise.`,
    `The numbers are real; the outcome is not written. Watch the trigger, respect the invalidation, and let ${px(st.pt)} be the target rather than the plan.`,
    `This is the kind of ${ANGLES[st.angle].label.toLowerCase()} story that reads obvious in hindsight. Right now it is just data pointing at ${px(st.pt)}.`
  ];
  return pick(L, seed + 13);
}

/* ---------- search heat: what Google News and Bing already carry on the name, and whether this angle is covered ---------- */
function parseRssCount(xml, sinceMs) {
  const items = String(xml || '').split(/<item[\s>]/).slice(1);
  let n = 0;
  for (const it of items) { const m = /<pubDate>([^<]+)<\/pubDate>/.exec(it); const t = m ? Date.parse(m[1]) : NaN; if (!Number.isFinite(t) || t >= sinceMs) n += 1; }
  return n;
}
function createNewsHeat({ fetchImpl = fetch, now = Date.now, ttlMs = 30 * 60_000, logger = () => {} } = {}) {
  const cache = new Map();
  async function count(q, sinceMs) {
    const key = q + ':' + Math.floor(sinceMs / 3_600_000);
    const hit = cache.get(key); if (hit && hit.until > now()) return hit.v;
    let g = 0, b = 0;
    try { const r = await fetchImpl('https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' when:1d') + '&hl=en-US&gl=US&ceid=US:en', { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0 (StockMarketLoop story desk)' } }); if (r.ok) g = parseRssCount(await r.text(), sinceMs); } catch (error) { logger('warn', 'news_heat_google_failed', { q, error: String(error && error.message || error) }); }
    try { const r = await fetchImpl('https://www.bing.com/news/search?q=' + encodeURIComponent(q) + '&format=rss', { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0 (StockMarketLoop story desk)' } }); if (r.ok) b = parseRssCount(await r.text(), sinceMs); } catch (error) { logger('warn', 'news_heat_bing_failed', { q, error: String(error && error.message || error) }); }
    const v = { google: g, bing: b }; cache.set(key, { v, until: now() + ttlMs }); if (cache.size > 500) cache.delete(cache.keys().next().value);
    return v;
  }
  /* heat for a symbol plus coverage per angle (how many pieces already use the angle's words with the ticker) */
  async function heatFor(symbol, name = '') {
    const since = now() - 86_400_000;
    const base = await count(`${symbol} stock${name ? ' OR "' + name + '"' : ''}`, since);
    const coverage = {};
    for (const [k, a] of Object.entries(ANGLES)) { const c = await count(`${symbol} "${a.keywords[0]}"`, since - 2 * 86_400_000); coverage[k] = c.google + c.bing; }
    return { google24h: base.google, bing24h: base.bing, coverage };
  }
  return { count, heatFor };
}

module.exports = { ANGLES, narrativeAngle, gammaAngle, shortAngle, earningsAngle, tapeAngle, structureAngle, rankStories, headlineFor, draftArticle, tagsFor, createNewsHeat, parseRssCount, slugify };
