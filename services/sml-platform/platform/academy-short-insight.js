'use strict';

/* Short-sale insight: the daily FINRA short volume and the bi-monthly short interest the panel already shows, read TOGETHER with
 * what the Academy now has from Massive and moomoo OpenD, so a member can tell "shorts pressing a weak name" from "a crowded
 * short being squeezed" before they join either side.
 *
 * Sources (every one optional; the read says what it had):
 *   short      the site's feed: daily short volume ratio (short ÷ total) and settlement short interest with days to cover
 *   candles    daily bars: the price path beside the short-volume path, the 20-day high and low, the average volume
 *   depth      moomoo OpenD Level 3 (academy-depth-insights through the order-flow service): pressure, ask walls, replenishment,
 *              large prints, CVD divergence; and the Level 2 reading: absorption, walls, momentum
 *   tape       Massive trades: aggressor buy / sell volume, off-exchange (dark) share, sell sweeps and blocks
 *   flowDays   the daily flow ledger: the week's CVD, large-print and sweep bias, pressure
 *   chain      the options chain: put / call open interest and volume, the put skew (puts bid = shorts hedged or synthetic shorts)
 *
 * Reads
 *   shortVsPrice   the last ten sessions: short ratio against the day's return. High short volume on down days = shorts pressing;
 *                  high short volume on up days = the selling is being absorbed (covering fuel). A correlation and a label.
 *   interestTrend  short interest across the last settlements against the price over the same span: shorts adding into weakness,
 *                  covering into strength, or pressing a rally (the squeeze set-up).
 *   pressing       0..100: how hard sellers are leaning on it right now (ask walls that refill, sell sweeps, negative delta and CVD,
 *                  large prints sold, dark share rising, down days on high short volume)
 *   squeeze        0..100: the fuel and the spark: days to cover, short volume ratio, price above the 20-day high or reclaiming
 *                  it, buying pressure in the book, sweeps bought, positive CVD, calls over puts
 *   verdict        for a short seller (press / wait / stand aside) and for a long (squeeze candidate / no fuel), with the reasons,
 *                  the invalidation and the MEM ALGO short model's read when it is on the chart
 * Educational only: it describes positioning and flow; it does not predict direction. */

const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const SYMBOL = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/* ------------------------------------------------------------------ short volume against the price path */
function dayKey(t) { return new Date(t).toISOString().slice(0, 10); }
function shortVsPrice(volumeRows, bars, n = 10) {
  const vol = (Array.isArray(volumeRows) ? volumeRows : []).map((r) => ({ date: String(r.date || '').slice(0, 10), ratio: num(r.ratio), short: num(r.short), total: num(r.total) })).filter((r) => r.date && r.ratio != null).sort((a, b) => a.date.localeCompare(b.date)).slice(-n);
  const list = Array.isArray(bars) ? bars.filter((b) => b && Number.isFinite(num(b.c))) : [];
  const byDay = new Map(); list.forEach((b, i) => { const prev = list[i - 1]; byDay.set(dayKey(b.t), { close: num(b.c), retPct: prev && num(prev.c) > 0 ? (num(b.c) / num(prev.c) - 1) * 100 : null, volume: num(b.v) }); });
  const days = vol.map((r) => { const d = byDay.get(r.date) || {}; return { date: r.date, ratio: r1(r.ratio), short: r.short, total: r.total, retPct: r1(d.retPct), close: d.close == null ? null : r2(d.close) }; });
  const paired = days.filter((d) => d.retPct != null);
  const avgRatio = r1(avg(days.map((d) => d.ratio)));
  /* a "heavy" day: at least 45% short and at or above the window's own average */
  const hiDays = paired.filter((d) => d.ratio >= Math.max(45, avgRatio || 0));
  const downOnHigh = hiDays.filter((d) => d.retPct < -0.2).length, upOnHigh = hiDays.filter((d) => d.retPct > 0.2).length;
  let corr = null;
  if (paired.length >= 5) {
    const xs = paired.map((d) => d.ratio), ys = paired.map((d) => d.retPct), mx = avg(xs), my = avg(ys);
    let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    corr = sxx > 0 && syy > 0 ? r2(sxy / Math.sqrt(sxx * syy)) : null;
  }
  const trend = days.length >= 6 ? r1(avg(days.slice(-3).map((d) => d.ratio)) - avg(days.slice(0, 3).map((d) => d.ratio))) : null;
  const netRet = paired.length ? r1(paired.reduce((s, d) => s + d.retPct, 0)) : null;
  let label = 'not enough days', tone = 'neutral';
  if (paired.length >= 5) {
    if (hiDays.length >= 3 && upOnHigh > downOnHigh) { label = 'absorbed: heavy short volume on up days, the selling is being bought'; tone = 'up'; }
    else if (hiDays.length >= 3 && downOnHigh > upOnHigh) { label = 'pressing: heavy short volume on down days, shorts are leaning on it'; tone = 'down'; }
    else if (avgRatio != null && avgRatio >= 50) { label = 'elevated short volume without a clear price response'; tone = 'flat'; }
    else { label = 'ordinary short volume'; tone = 'neutral'; }
  }
  return { days, avgRatio, trendPts: trend, corr, highDays: hiDays.length, downOnHigh, upOnHigh, netReturnPct: netRet, label, tone };
}

/* ------------------------------------------------------------------ short interest across settlements against the price */
function interestTrend(interestRows, bars) {
  const rows = (Array.isArray(interestRows) ? interestRows : []).map((r) => ({ date: String(r.date || '').slice(0, 10), si: num(r.short_interest ?? r.shares_short ?? r.shortInterest), adv: num(r.avg_daily_volume ?? r.avgDailyVolume), dtc: num(r.days_to_cover ?? r.daysToCover) })).filter((r) => r.date && (r.si != null || r.dtc != null)).sort((a, b) => a.date.localeCompare(b.date)).slice(-6);
  if (!rows.length) return null;
  const list = Array.isArray(bars) ? bars.filter((b) => b && Number.isFinite(num(b.c))) : [];
  const closeOn = (date) => { let last = null; for (const b of list) { if (dayKey(b.t) <= date) last = num(b.c); else break; } return last; };
  const first = rows[0], last = rows[rows.length - 1];
  const siChgPct = first.si > 0 && last.si != null ? r1((last.si / first.si - 1) * 100) : null;
  const p0 = closeOn(first.date), p1 = closeOn(last.date);
  const pxChgPct = p0 > 0 && p1 > 0 ? r1((p1 / p0 - 1) * 100) : null;
  let label = 'short interest steady', tone = 'neutral';
  if (siChgPct != null && pxChgPct != null) {
    if (siChgPct >= 8 && pxChgPct <= -3) { label = 'shorts added while price fell: they are pressing'; tone = 'down'; }
    else if (siChgPct >= 8 && pxChgPct >= 3) { label = 'shorts added into a rising price: fighting the tape (squeeze fuel)'; tone = 'up'; }
    else if (siChgPct <= -8 && pxChgPct >= 3) { label = 'shorts covered while price rose: a squeeze has been running'; tone = 'up'; }
    else if (siChgPct <= -8 && pxChgPct <= -3) { label = 'shorts covered into weakness: taking profits'; tone = 'flat'; }
  } else if (siChgPct != null) label = siChgPct >= 8 ? 'short interest rising' : siChgPct <= -8 ? 'short interest falling' : 'short interest steady';
  return { rows: rows.map((r) => ({ date: r.date, shortInterest: r.si, daysToCover: r2(r.dtc) })), since: first.date, to: last.date, shortInterest: last.si, daysToCover: r2(last.dtc), siChangePct: siChgPct, priceChangePct: pxChgPct, label, tone };
}

/* ------------------------------------------------------------------ the two scores */
const comp = (list, key, label, max, pts, detail) => list.push({ key, label, max, pts: Math.round(clamp(pts, -max, max) * 10) / 10, detail });
function scores({ svp, it, bars, depth, l2, tape, flowDays, chain }) {
  const P = [], Q = []; // pressing, squeeze
  const list = Array.isArray(bars) ? bars.filter((b) => b && Number.isFinite(num(b.c))) : [], last = list[list.length - 1];
  const close = last ? num(last.c) : null;
  const hi20 = list.length >= 21 ? Math.max(...list.slice(-21, -1).map((b) => num(b.h, num(b.c)))) : null, lo20 = list.length >= 21 ? Math.min(...list.slice(-21, -1).map((b) => num(b.l, num(b.c)))) : null;
  /* days to cover and the short-volume level: the fuel */
  if (it && it.daysToCover != null) { const d = it.daysToCover; comp(Q, 'dtc', 'Days to cover', 25, d >= 8 ? 25 : d >= 5 ? 18 : d >= 3 ? 10 : d >= 1.5 ? 4 : 0, d + ' days of average volume to cover'); }
  if (svp && svp.avgRatio != null) { comp(Q, 'ratio', 'Short volume ratio (10d)', 10, clamp((svp.avgRatio - 40) / 2, 0, 10), svp.avgRatio + '% of volume sold short'); comp(P, 'ratio', 'Short volume ratio (10d)', 15, clamp((svp.avgRatio - 40), 0, 15), svp.avgRatio + '% of volume sold short'); }
  if (svp && svp.tone === 'down') comp(P, 'svp', 'Short volume on down days', 15, 10 + Math.min(5, svp.downOnHigh), svp.downOnHigh + ' heavy-short down days of the last ' + svp.days.length);
  if (svp && svp.tone === 'up') comp(Q, 'svp', 'Short volume on up days (absorbed)', 15, 10 + Math.min(5, svp.upOnHigh), svp.upOnHigh + ' heavy-short up days of the last ' + svp.days.length);
  if (it && it.tone === 'up') comp(Q, 'si', 'Short interest vs price', 15, 15, it.label);
  if (it && it.tone === 'down') comp(P, 'si', 'Short interest vs price', 15, 12, it.label);
  /* the price itself */
  if (close != null && hi20 != null) { if (close > hi20) { comp(Q, 'breakout', 'Price above the 20-day high', 15, 15, 'closing above ' + r2(hi20)); comp(P, 'breakout', 'Price above the 20-day high', 15, -15, 'closing above ' + r2(hi20) + ': shorts are losing'); } else if (close < lo20) { comp(P, 'breakdown', 'Price below the 20-day low', 15, 15, 'closing below ' + r2(lo20)); comp(Q, 'breakdown', 'Price below the 20-day low', 15, -15, 'closing below ' + r2(lo20) + ': no spark'); } else { const pos = (close - lo20) / Math.max(1e-9, hi20 - lo20); comp(Q, 'range', 'Place in the 20-day range', 8, (pos - 0.5) * 16, Math.round(pos * 100) + '% of the way up the range'); comp(P, 'range', 'Place in the 20-day range', 8, (0.5 - pos) * 16, Math.round(pos * 100) + '% of the way up the range'); } }
  /* the full-depth book and tape (moomoo OpenD Level 3) */
  if (depth && depth.ready && depth.pressure) { const s = depth.pressure.score; comp(P, 'pressure', 'Full-depth pressure now', 20, -s / 5, depth.pressure.label); comp(Q, 'pressure', 'Full-depth pressure now', 20, s / 5, depth.pressure.label); }
  if (depth && depth.ready && Array.isArray(depth.walls)) { const ask = depth.walls.filter((w) => w.side === 'ask').length, bid = depth.walls.filter((w) => w.side === 'bid').length; if (ask || bid) { comp(P, 'walls', 'Walls in the book', 10, (ask - bid) * 5, ask + ' ask wall' + (ask === 1 ? '' : 's') + ', ' + bid + ' bid wall' + (bid === 1 ? '' : 's')); comp(Q, 'walls', 'Walls in the book', 10, (bid - ask) * 5, bid + ' bid wall' + (bid === 1 ? '' : 's') + ', ' + ask + ' ask wall' + (ask === 1 ? '' : 's')); } }
  if (depth && depth.ready && depth.flow && depth.flow.divergence) { comp(P, 'cvd', 'CVD vs price', 10, depth.flow.divergence === 'bearish' ? 10 : -10, depth.flow.divergence + ' divergence'); comp(Q, 'cvd', 'CVD vs price', 10, depth.flow.divergence === 'bullish' ? 10 : -10, depth.flow.divergence + ' divergence'); }
  if (l2 && l2.ready && l2.absorption && l2.absorption.state && l2.absorption.state !== 'none') { const bull = l2.absorption.state === 'bull'; comp(Q, 'absorb', 'Absorption at the touch', 10, bull ? 6 + 4 * (l2.absorption.strength || 0) : -(6 + 4 * (l2.absorption.strength || 0)), (bull ? 'bids' : 'asks') + ' are absorbing'); comp(P, 'absorb', 'Absorption at the touch', 10, bull ? -(6 + 4 * (l2.absorption.strength || 0)) : 6 + 4 * (l2.absorption.strength || 0), (bull ? 'bids' : 'asks') + ' are absorbing'); }
  /* Massive tape */
  if (tape && tape.count > 20) {
    const tot = (tape.buy || 0) + (tape.sell || 0); if (tot > 0) { const net = (tape.buy - tape.sell) / tot; comp(P, 'tape', 'Aggressor volume (Massive tape)', 15, -15 * Math.tanh(2 * net), Math.round(tape.sell / tot * 100) + '% hit the bid'); comp(Q, 'tape', 'Aggressor volume (Massive tape)', 15, 15 * Math.tanh(2 * net), Math.round(tape.buy / tot * 100) + '% lifted the offer'); }
    if ((tape.sweepN || 0) >= 2) { comp(P, 'sweeps', 'Sweeps', 10, (tape.sweepSell - tape.sweepBuy) * 3, tape.sweepSell + ' sold, ' + tape.sweepBuy + ' bought'); comp(Q, 'sweeps', 'Sweeps', 10, (tape.sweepBuy - tape.sweepSell) * 3, tape.sweepBuy + ' bought, ' + tape.sweepSell + ' sold'); }
    if (tape.vol > 0 && tape.offVol > 0) { const share = tape.offVol / tape.vol; const offNet = tape.offBuy + tape.offSell > 0 ? (tape.offBuy - tape.offSell) / (tape.offBuy + tape.offSell) : 0; comp(Q, 'dark', 'Off-exchange (dark) flow', 8, share >= 0.35 ? 8 * offNet : 4 * offNet, Math.round(share * 100) + '% of volume off-exchange, ' + (offNet >= 0 ? 'net bought' : 'net sold')); comp(P, 'dark', 'Off-exchange (dark) flow', 8, share >= 0.35 ? -8 * offNet : -4 * offNet, Math.round(share * 100) + '% of volume off-exchange, ' + (offNet >= 0 ? 'net bought' : 'net sold')); }
  }
  /* the week's ledger */
  if (flowDays && flowDays.available && flowDays.days >= 2 && flowDays.score != null) { comp(P, 'week', 'Multi-day flow ledger', 10, -flowDays.score / 10, flowDays.label || (flowDays.days + ' days')); comp(Q, 'week', 'Multi-day flow ledger', 10, flowDays.score / 10, flowDays.label || (flowDays.days + ' days')); }
  /* options: puts over calls = shorts hedged or synthetic shorts; a put-heavy book with a rising stock is squeeze fuel too */
  if (chain && chain.putCallOi != null) { const pc = chain.putCallOi; comp(P, 'options', 'Put / call open interest', 8, clamp((pc - 1) * 8, -8, 8), 'put/call OI ' + pc + (chain.putCallVol != null ? ', volume ' + chain.putCallVol : '')); comp(Q, 'options', 'Put / call open interest', 8, clamp((pc - 1) * 6, -4, 8), 'put/call OI ' + pc + ': puts to unwind if it runs'); }
  const score = (L) => { const max = L.reduce((s, c) => s + c.max, 0), got = L.reduce((s, c) => s + c.pts, 0); return max > 0 ? Math.round(clamp(50 + 50 * got / max, 0, 100)) : null; };
  return { pressing: { score: score(P), components: P }, squeeze: { score: score(Q), components: Q }, price: { close: r2(close), hi20: r2(hi20), lo20: r2(lo20) } };
}

/* ------------------------------------------------------------------ the chain, summarised */
function chainSummary(rows) {
  const list = Array.isArray(rows) ? rows : []; if (!list.length) return null;
  let callOi = 0, putOi = 0, callVol = 0, putVol = 0, callIv = [], putIv = [];
  for (const r of list) { const c = r.call || {}, p = r.put || {}; callOi += num(c.oi, 0); putOi += num(p.oi, 0); callVol += num(c.volume, 0); putVol += num(p.volume, 0); if (num(c.iv) > 0) callIv.push(num(c.iv)); if (num(p.iv) > 0) putIv.push(num(p.iv)); }
  if (!callOi && !putOi && !callVol && !putVol) return null;
  const ivC = avg(callIv), ivP = avg(putIv);
  return { putCallOi: callOi > 0 ? r2(putOi / callOi) : null, putCallVol: callVol > 0 ? r2(putVol / callVol) : null, callOi, putOi, callVol, putVol, putSkewPts: ivC != null && ivP != null ? r1((ivP - ivC) * (ivP < 3 ? 100 : 1)) : null };
}

/* ------------------------------------------------------------------ the verdicts */
function verdicts(s, extra) {
  const pr = s.pressing.score, sq = s.squeeze.score, dtc = extra.it ? extra.it.daysToCover : null, mem = extra.mem;
  const reasons = (L) => L.filter((c) => c.pts > 0).sort((a, b) => b.pts - a.pts).slice(0, 4).map((c) => c.label + ': ' + c.detail);
  const against = (L) => L.filter((c) => c.pts < 0).sort((a, b) => a.pts - b.pts).slice(0, 3).map((c) => c.label + ': ' + c.detail);
  let shortCall, shortTone;
  if (sq != null && sq >= 65) { shortCall = 'stand aside: this is a crowded short that is being bought (squeeze risk)'; shortTone = 'down'; }
  else if (pr != null && pr >= 65 && (sq == null || sq < 50)) { shortCall = 'press: sellers are in control and the short crowd is not trapped' + (dtc != null && dtc >= 5 ? ', but keep the stop tight: ' + dtc + ' days to cover can squeeze on any catalyst' : ''); shortTone = 'up'; }
  else if (pr != null && pr >= 50) { shortCall = 'lean short only on a failed bounce into an ask wall; the tape is not one-sided yet'; shortTone = 'flat'; }
  else { shortCall = 'wait: no edge for a short here; buyers are holding the book'; shortTone = 'flat'; }
  if (mem && mem.mode === 'short') { if (mem.latest && mem.latest.dir < 0) shortCall += '. MEM ALGO\'s short model has an open SELL' + (mem.latest.conf && mem.latest.conf.grade ? ' (grade ' + mem.latest.conf.grade + ')' : '') + '.'; else shortCall += '. MEM ALGO\'s short model has no signal on the chart right now.'; }
  let longCall, longTone;
  if (sq != null && sq >= 65 && dtc != null && dtc >= 3) { longCall = 'squeeze candidate: fuel (' + dtc + ' days to cover) and a spark (buying pressure, price pushing up): manage it like a momentum long with a stop under the breakout'; longTone = 'up'; }
  else if (sq != null && sq >= 50) { longCall = 'some squeeze fuel, no spark yet: wait for the 20-day high to go or the book to flip'; longTone = 'flat'; }
  else if (pr != null && pr >= 65) { longCall = 'not a squeeze: shorts are pressing a weak tape; do not buy because it is "heavily shorted"'; longTone = 'down'; }
  else { longCall = 'no squeeze set-up: short positioning is ordinary'; longTone = 'neutral'; }
  return {
    shortSeller: { call: shortCall, tone: shortTone, reasons: reasons(s.pressing.components), against: against(s.pressing.components), invalidation: s.price.hi20 != null ? 'a close back above the 20-day high (' + s.price.hi20 + ') or the ask walls getting lifted' : 'the ask walls getting lifted' },
    long: { call: longCall, tone: longTone, reasons: reasons(s.squeeze.components), against: against(s.squeeze.components), invalidation: s.price.lo20 != null ? 'a close under the 20-day low (' + s.price.lo20 + ') or bids pulled under the price' : 'bids pulled under the price' }
  };
}

/* ------------------------------------------------------------------ the service */
function createShortInsight({ shortData, candles = null, orderFlow = null, tape = null, flowDays = null, chain = null, memAlgo = null, float = null, gamma = null, sentiment = null, intent = null, earnings = null, marketOpen = null, ai = null, fetchImpl = globalThis.fetch, now = Date.now, logger = () => {}, ttlMs = 60_000 } = {}) {
  const cache = new Map(), inflight = new Map();
  const squeezeModel = require('./academy-squeeze-model');
  const briefs = squeezeModel.createSqueezeBrief({ ai, fetchImpl, now, logger });
  const safe = async (name, fn, ms = 12_000) => { try { return await Promise.race([Promise.resolve(fn()), new Promise((r) => { const t = setTimeout(() => r(null), ms); if (t.unref) t.unref(); })]); } catch (error) { logger('warn', 'short_insight_input_failed', { name, error: String(error && error.message || error) }); return null; } };
  async function build(symbol, { brief = true } = {}) {
    const t = now();
    const [sd, daily, of, tp, fd, ch, fl, gm, se, inn, er] = await Promise.all([
      safe('short', () => shortData(symbol)), candles ? safe('candles', () => candles(symbol, '1D')) : null, orderFlow ? safe('orderflow', () => orderFlow(symbol), 4_000) : null,
      tape ? safe('tape', () => tape(symbol), 2_000) : null, flowDays ? safe('flowdays', () => flowDays(symbol, 7), 6_000) : null, chain ? safe('chain', () => chain(symbol), 10_000) : null,
      float ? safe('float', () => float(symbol), 4_000) : null, gamma ? safe('gamma', () => gamma(symbol), 8_000) : null, sentiment ? safe('sentiment', () => sentiment(symbol), 8_000) : null,
      intent ? safe('intent', () => intent(symbol), 6_000) : null, earnings ? safe('earnings', () => earnings(symbol), 5_000) : null
    ]);
    const bars = daily && Array.isArray(daily.bars) ? daily.bars : Array.isArray(daily) ? daily : [];
    const volumeRows = sd && Array.isArray(sd.volume) ? sd.volume : [], interestRows = sd && Array.isArray(sd.interest) ? sd.interest : [];
    if (!volumeRows.length && !interestRows.length && !bars.length) return { ok: true, available: false, reason: 'no_short_data', symbol, asOf: t };
    const svp = shortVsPrice(volumeRows, bars), it = interestTrend(interestRows, bars);
    const depth = of && of.depth && of.depth.ready ? of.depth : null, l2 = of && of.ready ? of : null;
    const tapeStats = tp && tp.stats ? tp.stats : (tp && tp.count ? tp : null);
    const week = fd && fd.window ? fd.window : null;
    const chainS = chainSummary(ch);
    let mem = null;
    if (memAlgo && bars.length > 220) { try { const a = memAlgo(bars); mem = a ? { mode: 'short', bias: a.bias, latest: a.latest ? { dir: a.latest.dir, t: a.latest.t, conf: a.latest.conf ? { score: a.latest.conf.score, grade: a.latest.conf.grade } : null } : null } : null; } catch (_) { mem = null; } }
    const s = scores({ svp, it, bars, depth, l2, tape: tapeStats, flowDays: week, chain: chainS });
    const v = verdicts(s, { it, mem });
    /* the rebuilt SQUEEZE RISK (academy-squeeze-model.js): fuel, spark, accelerant, trap, the Q-STATE, and the AI brief when a key is set */
    let open = null; try { open = typeof marketOpen === 'function' ? !!marketOpen() : null; } catch (_) { open = null; }
    const model = squeezeModel.computeSqueeze({ svp, it, bars, depth, l2, tape: tapeStats, flowDays: week, chain: chainS, float: fl || null, scanner: fl || null, gamma: gm && gm.available ? gm : null, sentiment: se && se.ok ? se : null, intent: inn && inn.ok ? inn : null, earnings: er || null, marketOpen: open });
    const sqOut = model.score != null ? { ...s.squeeze, score: model.score, legacyScore: s.squeeze.score } : s.squeeze;
    if (model.score != null) {
      const long = v.long;
      if (model.score >= 70) { long.call = 'squeeze candidate: fuel ' + model.fuel.score + ', spark ' + model.spark.score + (model.accelerant.score >= 50 ? ', accelerant ' + model.accelerant.score : '') + ': manage it like a momentum long with a stop under the breakout'; long.tone = 'up'; }
      else if (model.score >= 50) { long.call = 'loaded: ' + (model.missing[0] ? 'missing ' + model.missing[0] : 'fuel and spark are both partial') + '; wait for the 20-day high to go or the book to flip'; long.tone = 'flat'; }
      else if (model.trap.score >= 50) { long.call = 'not a squeeze: shorts are pressing a weak tape (trap ' + model.trap.score + '); do not buy because it is "heavily shorted"'; long.tone = 'down'; }
      else { long.call = 'no squeeze set-up: ' + (model.missing[0] || 'short positioning is ordinary'); long.tone = 'neutral'; }
      long.reasons = [...model.why.fuel.slice(0, 2), ...model.why.spark.slice(0, 2)];
    }
    /* the AI brief is a Claude call that can take tens of seconds; a sweep reads hundreds of names and skips it (the panel asks for it) */
    const aiBrief = brief ? await briefs.brief(symbol, model, { price: s.price.close, hi20: s.price.hi20, lo20: s.price.lo20, marketOpen: open }) : { available: false, reason: 'skipped' };
    const sources = { short: !!(volumeRows.length || interestRows.length), candles: bars.length > 0, level3: !!depth, level2: !!l2, tape: !!tapeStats, flowDays: !!week, chain: !!chainS, float: !!(fl && (fl.sharesFloat || fl.sharesOutstanding)), gamma: !!(gm && gm.available), sentiment: !!(se && se.ok), intent: !!(inn && inn.ok), earnings: !!er };
    return { ok: true, available: true, symbol, asOf: t, shortVsPrice: svp, interest: it, pressing: s.pressing, squeeze: sqOut, model, brief: aiBrief, price: s.price, chain: chainS, tape: tapeStats ? { buy: tapeStats.buy, sell: tapeStats.sell, offVol: tapeStats.offVol, vol: tapeStats.vol, sweepBuy: tapeStats.sweepBuy, sweepSell: tapeStats.sweepSell, blockBuy: tapeStats.blockBuy, blockSell: tapeStats.blockSell } : null, depth: depth ? { pressure: depth.pressure, walls: depth.walls, divergence: depth.flow ? depth.flow.divergence : null } : null, week: week ? { days: week.days, score: week.score, label: week.label, cvd: week.cvd } : null, mem, verdict: v, sources,
      note: 'Short volume = shares sold short that day ÷ total volume (FINRA daily). Short interest settles twice a month. The book, the tape and the ledger are live. The two scores describe positioning and flow, not direction. Educational only.' };
  }
  /* insight(symbol, { brief: false }) is the sweep's read: everything but the AI brief, cached on its own key */
  function insight(symbolRaw, opts = {}) {
    const symbol = String(symbolRaw || '').toUpperCase();
    if (!SYMBOL.test(symbol)) return Promise.resolve({ ok: false, status: 400, error: 'invalid_symbol' });
    const wantBrief = !(opts && opts.brief === false), key = wantBrief ? symbol : symbol + '~';
    const full = cache.get(symbol); if (!wantBrief && full && now() - full.at < ttlMs) return Promise.resolve(full.v); // a fresh full read serves the sweep too
    const hit = cache.get(key); if (hit && now() - hit.at < ttlMs) return Promise.resolve(hit.v);
    if (inflight.has(key)) return inflight.get(key);
    const p = build(symbol, { brief: wantBrief }).then((v) => { cache.set(key, { at: now(), v }); if (cache.size > 600) cache.delete(cache.keys().next().value); return v; }).catch((error) => { logger('error', 'short_insight_failed', { symbol, error: String(error && error.message || error) }); return { ok: false, status: 503, error: 'insight_unavailable' }; }).finally(() => inflight.delete(key));
    inflight.set(key, p); return p;
  }
  /* QUICK: the fuel block alone from the two cheap, long-cached inputs (the short feed and the scanner row with the float), so a
     wide sweep can rank hundreds of names in seconds and spend the full read (book, tape, chain, gamma, intent) on the top ones */
  const quickCache = new Map(), quickInflight = new Map();
  function quick(symbolRaw) {
    const symbol = String(symbolRaw || '').toUpperCase();
    if (!SYMBOL.test(symbol)) return Promise.resolve({ ok: false, status: 400, error: 'invalid_symbol' });
    const hit = quickCache.get(symbol); if (hit && now() - hit.at < 10 * ttlMs) return Promise.resolve(hit.v);
    if (quickInflight.has(symbol)) return quickInflight.get(symbol);
    const p = (async () => {
      const [sd, fl] = await Promise.all([safe('short', () => shortData(symbol), 6_000), float ? safe('float', () => float(symbol), 4_000) : null]);
      const volumeRows = sd && Array.isArray(sd.volume) ? sd.volume : [], interestRows = sd && Array.isArray(sd.interest) ? sd.interest : [];
      if (!volumeRows.length && !interestRows.length) return { ok: true, available: false, reason: 'no_short_data', symbol };
      const svp = shortVsPrice(volumeRows, []), it = interestTrend(interestRows, []);
      const F = squeezeModel.fuel({ it, svp, float: fl || null, scanner: fl || null, chain: null });
      return { ok: true, available: true, symbol, fuel: F.score, coverage: F.coverage, pctFloat: F.pctFloat, coverRatio: F.coverRatio, floatShares: F.floatShares, floatBand: F.floatBand, floatKey: F.floatKey, floatTurn: F.floatTurn, daysToCover: it ? it.daysToCover : null, shortInterest: it ? it.shortInterest : null, siChangePct: it ? it.siChangePct : null, shortRatio: svp ? svp.avgRatio : null };
    })().then((v) => { quickCache.set(symbol, { at: now(), v }); if (quickCache.size > 1500) quickCache.delete(quickCache.keys().next().value); return v; })
      .catch((error) => { logger('warn', 'short_insight_quick_failed', { symbol, error: String(error && error.message || error) }); return { ok: false, status: 503, error: 'insight_unavailable' }; })
      .finally(() => quickInflight.delete(symbol));
    quickInflight.set(symbol, p); return p;
  }
  return { insight, quick };
}

module.exports = { createShortInsight, shortVsPrice, interestTrend, scores, chainSummary, verdicts };
