'use strict';

/* The alert brain: when an alert's price target is reached, decide the next step the way a disciplined trader would, and say
 * it so a member can follow it in under ten seconds.
 *
 *   RAISE       momentum intact, nothing in the way, early in the move: keep the position, new target, stop moved up.
 *   TRIM_RAISE  the move is good but stretched, crowded, near a level, late in the ladder, or risk is elevated: bank a third
 *               to a half here, keep the rest with a new target and a wider trailing stop.
 *   SELL        the leg is done: exhaustion, a reversal signal, an earnings print inside two days, the market turning, or the
 *               ladder is complete. Take it all off and say why.
 *
 * Stops are set for momentum, not for comfort: a volatility stop under the highest price reached (3 ATR for a fast day name,
 * 2.5 for a swing, 2 otherwise), never tighter than one and a half days of the stock's own movement, never under breakeven
 * once the trade is 10% in profit, and never moved back down. Educational simulation of a trade-management rule, not advice. */

const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const px = (p) => (p >= 1 ? Math.round(p * 100) / 100 : Math.round(p * 10_000) / 10_000);
const money = (v) => '$' + (Number(v) >= 1 ? Number(v).toFixed(2) : Number(v).toFixed(4));
const pct = (v) => (v >= 0 ? '+' : '') + Number(v).toFixed(1) + '%';

/* A stop wide enough for the move: chandelier under the high, volatility floor, breakeven floor, never lowered. */
function momentumStop({ side = 'long', entry, price, highSince, atr = null, volPct = 4, relVol = 1, channel = 'swing', prevStop = null, trailStop = null } = {}) {
  const long = side !== 'short', dir = long ? 1 : -1;
  const p = Number(price), e = Number(entry), hi = num(highSince, p);
  const a = num(atr) > 0 ? Number(atr) : p * (num(volPct, 4) / 100);
  const fast = num(relVol, 1) >= 2 || num(volPct, 4) >= 6;
  const k = channel === 'day' ? (fast ? 3 : 2.2) : channel === 'longterm' ? 3 : (fast ? 2.8 : 2.2);
  const chandelier = hi - dir * k * a;
  const floorDist = p * Math.max(0.03, num(volPct, 4) * 1.5 / 100); // at least a day and a half of normal movement
  const volFloor = p - dir * floorDist;
  const profitPct = dir * (p / e - 1) * 100;
  let stop = long ? Math.min(chandelier, volFloor) : Math.max(chandelier, volFloor); // the wider of the two
  const why = [`${k} ATR under the high ${money(hi)}`, `at least ${Math.round(floorDist / p * 100)}% from here (a day and a half of its usual movement)`];
  if (profitPct >= 10) { const be = e * (1 + dir * 0.005); if (long ? stop < be : stop > be) { stop = be; why.push('never under breakeven once 10% in profit'); } }
  if (num(trailStop) != null && (long ? trailStop > stop : trailStop < stop)) { stop = Number(trailStop); why.push('the runner trail is higher'); }
  if (num(prevStop) != null && (long ? prevStop > stop : prevStop < stop)) { stop = Number(prevStop); why.push('a stop already set is never lowered'); }
  // never closer than 1.5% to the live price (a stop that sits on the bid is a stop that fills on noise)
  if (long ? stop > p * 0.985 : stop < p * 1.015) stop = p * (1 - dir * 0.015);
  const high = px(stop), low = px(long ? stop * 0.975 : stop * 1.025);
  return { level: px(stop), low: long ? low : high, high: long ? high : low, k, basis: why.join('; '), fast };
}

/* The decision at a reached target. */
function decide({ side = 'long', symbol = '', entry, price, target, highSince = null, updates = 0, channel = 'swing', evidence = null, proposal = null, runner = null, sentiment = null, market = null, earningsDays = null, pullbackFromHighPct = null, prevStop = null } = {}) {
  const long = side !== 'short', dir = long ? 1 : -1, tk = String(symbol || '').toUpperCase();
  const p = Number(price), e = Number(entry);
  if (!(p > 0) || !(e > 0)) return { action: 'HOLD', reason: 'no_price', why: [], steps: [] };
  const t = evidence && evidence.tech ? evidence.tech : {};
  const reads = evidence && evidence.reads ? evidence.reads : {};
  const alignment = num(evidence && evidence.alignment, 0), volPct = num(evidence && evidence.volPct, 4);
  const profitPct = dir * (p / e - 1) * 100;
  const hi = num(highSince, p);
  const pullback = num(pullbackFromHighPct, hi > 0 ? Math.abs((hi - p) / hi) * 100 : 0);
  const rsi = num(t.rsi), rsiDir = rsi == null ? null : (long ? rsi : 100 - rsi);
  const relVol = num(t.relVol, 1);
  const agree = Object.keys(reads).filter((h) => reads[h] && Number(reads[h].dir) === dir).length;
  const against = Object.keys(reads).filter((h) => reads[h] && Number(reads[h].dir) === -dir).length;
  const mk = num(market), sent = num(sentiment);
  const levels = (evidence && evidence.levels) || [];
  const nextLevel = levels.map((l) => num(l && l.price)).filter((x) => x > 0 && (long ? x > p : x < p)).sort((a, b) => (long ? a - b : b - a))[0] || null;
  const roomPct = nextLevel ? Math.abs(nextLevel / p - 1) * 100 : null;

  let momentum = 0, exhaustion = 0; const why = [], warn = [];
  if (alignment >= 0.5) { momentum += 2; why.push(`MEM ALGO lined up ${agree ? agree + ' of 4' : ''} horizons ${long ? 'bullish' : 'bearish'}`.replace(/\s+/g, ' ').trim()); } else if (alignment > 0) { momentum += 1; why.push('MEM ALGO still leaning our way'); } else if (alignment < -0.2) { exhaustion += 2; warn.push('MEM ALGO has turned against the trade'); }
  if (relVol >= 2) { momentum += 1.5; why.push(`volume ${relVol}x normal: the crowd is still arriving`); } else if (relVol < 0.8) { exhaustion += 1; warn.push('volume is drying up'); }
  if (t.aboveVwap != null) { if (t.aboveVwap === long) { momentum += 1; why.push(`holding ${long ? 'above' : 'below'} today's VWAP`); } else { exhaustion += 1; warn.push(`lost today's VWAP`); } }
  if (t.breakout) { momentum += 1; why.push(`broke its 20-day ${long ? 'high' : 'low'}`); }
  if (rsiDir != null) { if (rsiDir >= 85) { exhaustion += 2; warn.push(`RSI ${rsi}: stretched, shakeouts come from here`); } else if (rsiDir >= 78) { exhaustion += 1; warn.push(`RSI ${rsi}: getting stretched`); } else if (rsiDir >= 55) { momentum += 0.5; } }
  const underTargetPct = num(target) > 0 ? dir * (p / Number(target) - 1) * 100 : 0;
  if (underTargetPct <= -3) { exhaustion += 2; warn.push(`fell back ${Math.abs(underTargetPct).toFixed(1)}% under the smashed target ${money(target)}`); }
  if (pullback >= 35) { exhaustion += 2; warn.push(`gave back ${Math.round(pullback)}% of the move since the high`); } else if (pullback >= 20) { exhaustion += 1; warn.push(`${Math.round(pullback)}% off the high`); }
  if (runner) { if (runner.exit) { exhaustion += 3; warn.push('runner trail says exit: ' + runner.exitReason); } else if (runner.parabolic) { exhaustion += 1; warn.push('parabolic phase: the air gets thin up here'); } if (runner.climax) { exhaustion += 2; warn.push('climax candle: heavy volume with a long wick'); } }
  if (sent != null) { const s = sent * dir; if (s > 0.2) { momentum += 0.5; why.push('sentiment behind it'); } else if (s < -0.2) { exhaustion += 0.5; warn.push('sentiment cooling'); } }
  if (mk != null) { const m = mk * dir; if (m > 0.2) { momentum += 0.5; why.push('the market backdrop helps'); } else if (m < -0.2) { exhaustion += 1; warn.push('the market is against the move'); } }
  if (roomPct != null && roomPct < 5) { exhaustion += 1; warn.push(`a level the chart respects sits ${roomPct.toFixed(1)}% away at ${money(nextLevel)}`); }
  if (earningsDays != null && earningsDays >= 0 && earningsDays <= 2) { exhaustion += 3; warn.push(`earnings in ${earningsDays} day${earningsDays === 1 ? '' : 's'}: a coin flip, not a trade`); }
  if (updates >= 2) { exhaustion += 1.5; warn.push('third leg of the ladder: most of the move is behind us'); } else if (updates === 1) exhaustion += 0.5;
  if (profitPct >= 40) { exhaustion += 1; warn.push(`${pct(profitPct)} from the entry: pay yourself`); }

  let action;
  const canRaise = proposal && proposal.post;
  if (earningsDays != null && earningsDays >= 0 && earningsDays <= 2) action = 'SELL';
  else if (runner && runner.exit) action = 'SELL';
  else if (!canRaise) action = 'SELL';
  else if (updates >= 3) action = 'SELL';
  else if (momentum >= exhaustion + 2 && exhaustion < 2.5 && updates === 0) action = 'RAISE';
  else if (momentum >= exhaustion - 1 && exhaustion < 5) action = 'TRIM_RAISE';
  else action = 'SELL';
  if (action === 'RAISE' && profitPct >= 25) action = 'TRIM_RAISE';

  const trimPct = action === 'TRIM_RAISE' ? (exhaustion >= 3 || updates >= 1 || profitPct >= 30 ? 50 : 33) : action === 'SELL' ? 100 : 0;
  const stop = action === 'SELL' ? null : momentumStop({ side, entry: e, price: p, highSince: hi, atr: num(t.atr), volPct, relVol, channel, prevStop, trailStop: runner && runner.stop != null && !runner.exit ? runner.stop : null });
  const newTarget = action === 'SELL' ? null : (canRaise ? proposal.target : null);
  const newPct = newTarget ? Math.round(Math.abs(newTarget / p - 1) * 1000) / 10 : null;
  const lock = (q) => money(p) + ' (' + pct(dir * (p / e - 1) * 100) + ' from the ' + money(e) + ' entry' + (q ? ', ' + q : '') + ')';
  const steps = [];
  const headline = action === 'RAISE' ? `${tk} smashed ${money(target)}: holding for ${money(newTarget)}`
    : action === 'TRIM_RAISE' ? `${tk} smashed ${money(target)}: bank ${trimPct}%, ride the rest to ${money(newTarget)}`
    : `${tk} hit ${money(target)}: take the profit`;
  if (action === 'RAISE') {
    steps.push(`Keep the position. Nothing to sell yet.`);
    steps.push(`Move your stop to ${money(stop.level)} (${stop.basis.split(';')[0]}). If it closes under that, you are out with profit.`);
    steps.push(`New target ${money(newTarget)} (${pct(dir * newPct)} from here). We will update again there.`);
  } else if (action === 'TRIM_RAISE') {
    steps.push(`Sell ${trimPct}% now around ${lock()}. That is money in the account.`);
    steps.push(`Keep the other ${100 - trimPct}% and move its stop to ${money(stop.level)}. Below that on a close, the rest comes off too.`);
    steps.push(`New target for what is left: ${money(newTarget)} (${pct(dir * newPct)} from here).`);
  } else {
    steps.push(`Sell the whole position around ${lock()}.`);
    steps.push(`Do not chase it back in today. If it sets up again, it will be a new alert.`);
  }
  const confidence = Math.round(clamp(50 + Math.abs(momentum - exhaustion) * 8, 50, 95));
  return { action, trimPct, headline, steps, why: why.slice(0, 4), warn: warn.slice(0, 4), stop, newTarget, newPct, momentum: Math.round(momentum * 10) / 10, exhaustion: Math.round(exhaustion * 10) / 10, confidence, profitPct: Math.round(profitPct * 10) / 10, pullbackPct: Math.round(pullback * 10) / 10 };
}

/* The Discord text of a decision: a member-first layout, the action in the first line, numbered steps, then the why. */
function memberText({ decision, symbol, side = 'long', entry, price, target, n = 1 }) {
  const d = decision, tk = String(symbol || '').toUpperCase(), long = side !== 'short';
  const badge = d.action === 'RAISE' ? '🚀 PT SMASHED · HOLDING' : d.action === 'TRIM_RAISE' ? `💰 PT SMASHED · BANK ${d.trimPct}%` : '✅ PT HIT · TAKE PROFITS';
  const lines = [`**${badge}** · ${tk} · update ${n}`, `**${d.headline}**`, ''];
  lines.push('**WHAT TO DO NOW**');
  d.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push('');
  lines.push(`**Trade so far:** entry ${money(entry)} → now ${money(price)} (${pct((long ? 1 : -1) * (price / entry - 1) * 100)}), target ${money(target)} reached.`);
  if (d.newTarget) lines.push(`**Next target:** ${money(d.newTarget)} (${pct((long ? 1 : -1) * d.newPct)} from here). **Stop:** ${money(d.stop.level)} — ${d.stop.basis}.`);
  if (d.why.length) lines.push(`**Why ${d.action === 'SELL' ? 'it ran' : 'it can keep going'}:** ${d.why.join('; ')}.`);
  if (d.warn.length) lines.push(`**Watch out:** ${d.warn.join('; ')}.`);
  lines.push(`-# Decided by the Academy's alert brain (momentum ${d.momentum} vs exhaustion ${d.exhaustion}, confidence ${d.confidence}%). Educational, not financial advice.`);
  return lines.join('\n');
}

module.exports = { decide, momentumStop, memberText };
