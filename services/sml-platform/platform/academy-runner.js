'use strict';

/* Runner hold: when a day trade starts to run (the RGC / WETO kind of move), hold a piece of it past the close under a
 * trailing stop instead of flattening the whole thing at 3:45.
 *
 * Two decisions, both from recorded candles:
 *   qualify()  late in the session: is this day trade a runner worth holding overnight? Gates first (it must be green, no
 *              earnings tomorrow, no climax candle), then a 0-100 score from the close location, volume, range expansion,
 *              VWAP and opening-range position, the higher-timeframe breakout, late-day strength and the squeeze context.
 *              The plan sells a part at the close (the day trade is booked) and keeps the rest with an overnight stop and a
 *              size cap so a bad gap costs at most one risk unit.
 *   trail()    every session after that: a trailing stop that only rises. Phase 1 (first night) sits at breakeven or the
 *              breakout day's VWAP; phase 2 (orderly run) is a chandelier 2.5 ATR under the highest high and never under the
 *              prior day's low; phase 3 (parabolic: back-to-back big days, far above the 10-day average, gap-ups) tightens to
 *              1.5 ATR. Two sessions without a new high lift the stop to the last low; a climax candle (huge volume with a
 *              long upper wick) or a close below the prior day's low is the exit.
 * Educational simulation of a trade-management rule. Nothing here predicts; it only describes what would end the hold. */

const RULES = Object.freeze({
  decideFromMinutesET: 930, decideToMinutesET: 958, // 3:30 to 3:58 pm New York
  minGainR: 0.8, minScore: 55, partialPct: 0.5, maxHoldDays: 15, earningsBlackoutDays: 2, maxGapRiskPct: 0.25,
  kCalm: 2.5, kParabolic: 1.5
});
const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;
const clean = (bars) => (bars || []).map((b) => ({ t: Number(b.t), o: Number(b.o), h: Number(b.h), l: Number(b.l), c: Number(b.c), v: Number(b.v) || 0 })).filter((b) => [b.t, b.o, b.h, b.l, b.c].every(Number.isFinite));
function atr(bars, len = 14) { if (bars.length < len + 1) return null; let s = 0; for (let i = bars.length - len; i < bars.length; i++) { const b = bars[i], pc = bars[i - 1].c; s += Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)); } return s / len; }
function sma(bars, len, pick = (b) => b.c) { if (bars.length < len) return null; let s = 0; for (let i = bars.length - len; i < bars.length; i++) s += pick(bars[i]); return s / len; }

/* The session so far, from its intraday candles (oldest first). */
function dayStats(intradayRaw, entry = null) {
  const b = clean(intradayRaw); if (!b.length) return null;
  const o = b[0].o, h = Math.max(...b.map((x) => x.h)), l = Math.min(...b.map((x) => x.l)), c = b[b.length - 1].c, v = b.reduce((s, x) => s + x.v, 0);
  const range = h - l;
  let pv = 0, vv = 0; for (const x of b) { const tp = (x.h + x.l + x.c) / 3; pv += tp * x.v; vv += x.v; }
  const vwap = vv > 0 ? pv / vv : (o + c) / 2;
  const t0 = b[0].t, orh = Math.max(...b.filter((x) => x.t < t0 + 30 * 60_000).map((x) => x.h));
  const lastHour = b.filter((x) => x.t >= b[b.length - 1].t - 60 * 60_000);
  const lastHourRet = lastHour.length ? c / lastHour[0].o - 1 : 0;
  const hiBar = b.reduce((x, y) => (y.h > x.h ? y : x), b[0]);
  return {
    o: r4(o), h: r4(h), l: r4(l), c: r4(c), v, range: r4(range), changePct: r2((c / o - 1) * 100),
    closeLoc: range > 0 ? r4((c - l) / range) : 0.5, upperWick: range > 0 ? r4((h - Math.max(o, c)) / range) : 0,
    vwap: r4(vwap), aboveVwap: c >= vwap, orh: r4(orh), aboveOrh: c > orh,
    lastHourRet: r4(lastHourRet), highLate: hiBar.t >= b[b.length - 1].t - 90 * 60_000,
    gainR: entry != null && num(entry) > 0 ? null : null
  };
}

/* Late-session decision: hold a piece of this day trade overnight? */
function qualify({ intraday, daily, entry, stop = null, qty = null, riskDollars = null, earningsDays = null, shortRatio = null, crowded = false, marketBias = null, minutesET = null, rules = RULES } = {}) {
  const day = dayStats(intraday); const hist = clean(daily);
  const out = { hold: false, score: 0, reasons: [], gates: [], plan: null, day };
  if (!day || !(num(entry) > 0)) { out.gates.push('No session candles or entry to judge.'); return out; }
  const price = day.c, e = Number(entry), risk = num(stop) != null && e > num(stop) ? e - num(stop) : (hist.length ? (atr(hist) || e * 0.03) : e * 0.03);
  const gainR = risk > 0 ? (price - e) / risk : 0;
  const prev = hist.length ? hist[hist.length - 1] : null;
  const avgVol20 = sma(hist, 20, (b) => b.v), atr14 = atr(hist), sma20 = sma(hist, 20), sma50 = sma(hist, 50);
  const prior20High = hist.length >= 20 ? Math.max(...hist.slice(-20).map((b) => b.h)) : null;
  const rvol = avgVol20 ? day.v / avgVol20 : null, rangeAtr = atr14 ? day.range / atr14 : null;
  const gapPct = prev ? (day.o / prev.c - 1) * 100 : null;
  const climax = rvol != null && rvol >= 6 && day.upperWick >= 0.4;
  if (minutesET != null && (minutesET < rules.decideFromMinutesET || minutesET > rules.decideToMinutesET)) out.gates.push('Decided only between 3:30 and 3:58 pm New York.');
  if (gainR < rules.minGainR) out.gates.push(`Only ${r2(gainR)}R in profit; a runner hold needs ${rules.minGainR}R first.`);
  if (earningsDays != null && earningsDays >= 0 && earningsDays <= rules.earningsBlackoutDays) out.gates.push(`Earnings in ${earningsDays} day${earningsDays === 1 ? '' : 's'}: no overnight hold into a binary event.`);
  if (climax) out.gates.push(`Climax candle (${rvol.toFixed(1)}x volume with a ${Math.round(day.upperWick * 100)}% upper wick): sellers met the run; book it.`);
  if (gapPct != null && gapPct >= 15 && day.closeLoc < 0.5) out.gates.push(`Gapped up ${gapPct.toFixed(0)}% and faded: the gap is being sold.`);
  if (day.closeLoc < 0.4) out.gates.push(`Closing in the bottom ${Math.round(day.closeLoc * 100)}% of the day's range: the move was sold into.`);
  const add = (pts, text) => { out.score += pts; out.reasons.push({ pts, text }); };
  if (gainR >= 2) add(15, `${r2(gainR)}R in profit: the trade has paid for its own risk twice.`); else if (gainR >= 1) add(10, `${r2(gainR)}R in profit.`);
  if (day.closeLoc >= 0.85) add(20, `Closing in the top ${Math.round((1 - day.closeLoc) * 100)}% of the range: strong close.`); else if (day.closeLoc >= 0.7) add(12, `Closing in the top third of the range.`);
  if (rvol != null) { if (rvol >= 3) add(20, `${rvol.toFixed(1)}x normal volume: the whole street is in this name.`); else if (rvol >= 2) add(12, `${rvol.toFixed(1)}x normal volume.`); else if (rvol < 1.2) add(-10, `Volume only ${rvol.toFixed(1)}x normal: runners need fuel.`); }
  if (rangeAtr != null) { if (rangeAtr >= 2) add(10, `Range ${rangeAtr.toFixed(1)}x the average true range: expansion day.`); else if (rangeAtr >= 1.3) add(6, `Range ${rangeAtr.toFixed(1)}x ATR.`); }
  if (day.aboveVwap) add(8, `Above the day's VWAP (${day.vwap}): the average buyer today is in profit.`); else add(-10, `Below VWAP ${day.vwap}: today's average buyer is underwater.`);
  if (day.aboveOrh) add(5, `Above the opening-range high ${day.orh}.`);
  if (prior20High != null && price > prior20High) add(12, `Closing above the prior 20-session high ${r2(prior20High)}: breakout, not a bounce.`);
  else if (sma20 != null && sma50 != null && price > sma20 && sma20 > sma50) add(6, `Trend aligned up (above the 20-session average, 20 above 50).`);
  else if (sma20 != null && price < sma20) add(-6, `Still under the 20-session average: a bounce in a downtrend.`);
  if (day.lastHourRet > 0.01 && day.highLate) add(10, `Made its high in the last 90 minutes and closed up ${(day.lastHourRet * 100).toFixed(1)}% in the final hour: late buyers, not early ones.`);
  else if (day.lastHourRet < -0.02) add(-8, `Gave back ${(Math.abs(day.lastHourRet) * 100).toFixed(1)}% in the last hour.`);
  if (shortRatio != null && shortRatio >= 0.5) add(6, `Short volume ${Math.round(shortRatio * 100)}% of off-exchange prints: squeeze fuel if it holds.`);
  if (crowded) add(-6, `Crowded long positioning: fewer new buyers left.`);
  if (marketBias != null) { if (marketBias >= 30) add(4, `Market read risk-on.`); else if (marketBias <= -30) add(-6, `Market read risk-off: runners get sold into weakness.`); }
  if (day.upperWick >= 0.3) add(-8, `Upper wick ${Math.round(day.upperWick * 100)}% of the range: the high was rejected.`);
  out.score = Math.max(0, Math.min(100, out.score));
  out.hold = !out.gates.length && out.score >= rules.minScore;
  const stopOvernight = r4(Math.max(e, day.vwap));
  let keep = qty != null ? Math.floor(qty * (1 - rules.partialPct)) : null;
  const capByGap = riskDollars != null && riskDollars > 0 ? Math.floor(riskDollars / (price * rules.maxGapRiskPct)) : null;
  if (keep != null && capByGap != null) keep = Math.max(0, Math.min(keep, capByGap));
  out.plan = {
    sellPct: rules.partialPct, sellShares: qty != null && keep != null ? Math.max(0, qty - keep) : null, keepShares: keep, keepCappedByGap: !!(keep != null && capByGap != null && capByGap < Math.floor(qty * (1 - rules.partialPct))),
    stopOvernight, stopReason: stopOvernight === e ? 'breakeven' : 'the breakout day\'s VWAP: an open below it puts today\'s average buyer underwater', maxHoldDays: rules.maxHoldDays,
    gainR: r2(gainR), rvol: rvol != null ? r2(rvol) : null, rangeAtr: rangeAtr != null ? r2(rangeAtr) : null, gapPct: gapPct != null ? r2(gapPct) : null
  };
  out.summary = out.hold ? `RUNNER: book ${Math.round(rules.partialPct * 100)}% at the close, hold the rest with the stop at ${stopOvernight} (${out.plan.stopReason}).` : (out.gates[0] || `Score ${out.score} is under ${rules.minScore}: close it with the session.`);
  return out;
}

/* The trailing stop for a held runner, from closed daily candles (oldest first, the run included). Only ever rises. */
function trail({ daily, entry, ext = null, daysHeld = 0, currentStop = null, vwapDay = null, rules = RULES } = {}) {
  const b = clean(daily); const n = b.length;
  const out = { stop: num(currentStop), phase: 1, k: null, exit: false, exitReason: '', reasons: [], parabolic: false, climax: false, fade: false, noNewHigh: false };
  if (n < 3 || !(num(entry) > 0)) return out;
  const last = b[n - 1], prev = b[n - 2], a = atr(b) || (last.h - last.l) || last.c * 0.03;
  const high = Math.max(num(ext, last.h), last.h);
  const avgVol20 = sma(b.slice(0, -1), 20, (x) => x.v), sma10 = sma(b, 10);
  const bigDays = b.slice(-3).filter((x) => x.c / x.o - 1 >= 0.06).length;
  const gapUp = prev ? last.o / prev.c - 1 >= 0.10 : false;
  out.parabolic = bigDays >= 2 || (sma10 != null && last.c > sma10 + 2.5 * a) || gapUp;
  out.climax = !!(avgVol20 && last.v >= 5 * avgVol20 && (last.h - last.l) > 0 && (last.h - Math.max(last.o, last.c)) / (last.h - last.l) >= 0.4);
  out.fade = last.c < prev.l;
  out.noNewHigh = n >= 3 && b[n - 1].h < high && b[n - 2].h < high && b[n - 1].t > b[n - 3].t;
  out.phase = daysHeld <= 1 ? 1 : (out.parabolic ? 3 : 2);
  out.k = out.phase === 3 ? rules.kParabolic : rules.kCalm;
  const e = Number(entry);
  const cands = [{ v: e, why: 'breakeven' }];
  if (out.phase === 1 && num(vwapDay) > 0) cands.push({ v: num(vwapDay), why: 'the breakout day\'s VWAP' });
  if (out.phase >= 2) { cands.push({ v: high - out.k * a, why: `${out.k} ATR under the high ${r2(high)} (${out.phase === 3 ? 'parabolic, tight' : 'orderly run'})` }); cands.push({ v: prev.l, why: 'the prior session\'s low' }); }
  if (out.noNewHigh) cands.push({ v: last.l, why: 'two sessions without a new high: the last low is the line' });
  if (num(currentStop) != null) cands.push({ v: num(currentStop), why: 'the stop already set (never lowered)' });
  const best = cands.reduce((x, y) => (y.v > x.v ? y : x));
  out.stop = r4(Math.min(best.v, last.c * 0.995));
  out.reasons.push(`Stop ${out.stop}: ${best.why}.`);
  if (out.parabolic) out.reasons.push('Parabolic phase: the trail tightens to ' + rules.kParabolic + ' ATR.');
  if (out.climax) { out.exit = true; out.exitReason = 'climax candle: 5x volume with a long upper wick'; }
  else if (out.fade) { out.exit = true; out.exitReason = 'closed below the prior session\'s low: momentum is gone'; }
  else if (daysHeld >= rules.maxHoldDays) { out.exit = true; out.exitReason = `held ${daysHeld} sessions: the runner window is over`; }
  if (out.exit) out.reasons.push('Exit: ' + out.exitReason + '.');
  return out;
}

/* For the alerts desk: a trail read for an alert from its date, with the highest high since. */
function trailFor({ daily, entry, sinceT, side = 'long', rules = RULES } = {}) {
  if (side === 'short') return null;
  const b = clean(daily).filter((x) => x.t >= Number(sinceT) - 86_400_000);
  if (b.length < 2) return null;
  const all = clean(daily);
  const ext = Math.max(...b.map((x) => x.h));
  return trail({ daily: all, entry, ext, daysHeld: b.length - 1, rules });
}

module.exports = { RULES, dayStats, qualify, trail, trailFor };
