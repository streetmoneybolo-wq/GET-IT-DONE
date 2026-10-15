'use strict';

/* Market Direction v2: a read of SPY that is built the way a careful researcher would build it.
 *
 *  1. Regime first. Trend up, trend down, range, or high volatility, from SPY's own daily candles (slope of the 20- and
 *     50-day averages, realized volatility, how often the 20-day average is crossed). Every signal below is weighted by the
 *     regime, because the same reading means different things in a trend and in a range.
 *  2. The index is its parts. The heavyweights (NVDA, MSFT, AAPL, AMZN, META, ...) are weighted by their index weight: their
 *     weighted contribution to today's move, how many of them are advancing, how concentrated the move is (top five share),
 *     cap-weighted vs equal-weighted, and each one's catalysts (earnings inside three days) are read, not just the ETF.
 *  3. Breadth, rotation, volatility, positioning, cross-asset. Advance/decline and up/down volume across the universe,
 *     cyclicals vs defensives, small caps and equal weight vs the cap-weighted index, the VIX and its change, SPY dealer
 *     gamma (pinning vs expansion), rates, credit and the dollar.
 *  4. Base rates from SPY's own history: given the current streak, gap and position, what SPY actually did next, counted,
 *     not assumed.
 *  5. One composite for the day and one for the swing, with a confidence that falls when the signals disagree, when a
 *     scheduled catalyst is close, or when coverage is thin. Every forecast is recorded and scored against what SPY then did
 *     (hit rate and Brier score), so the read is falsifiable and its accuracy is visible.
 * Educational: a description of recorded conditions and their historical base rates, not advice. */

const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const tanh = Math.tanh;
const clean = (bars) => (bars || []).map((b) => ({ t: Number(b.t), o: Number(b.o), h: Number(b.h), l: Number(b.l), c: Number(b.c), v: Number(b.v) || 0 })).filter((b) => [b.t, b.o, b.h, b.l, b.c].every(Number.isFinite));
function sma(arr, n, end = arr.length - 1) { if (end + 1 < n || n <= 0) return null; let s = 0; for (let i = end - n + 1; i <= end; i++) s += arr[i]; return s / n; }
function rsi(closes, len = 14) { if (closes.length < len + 1) return null; let g = 0, l = 0; for (let i = closes.length - len; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; } if (l === 0) return 100; const rs = (g / len) / (l / len); return 100 - 100 / (1 + rs); }
function atr(bars, len = 14) { if (bars.length < len + 1) return null; let s = 0; for (let i = bars.length - len; i < bars.length; i++) { const b = bars[i], pc = bars[i - 1].c; s += Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)); } return s / len; }

const CYCLICALS = ['XLK', 'XLY', 'XLF', 'XLI', 'XLC', 'XLB'], DEFENSIVES = ['XLP', 'XLU', 'XLV', 'XLRE'];

/* ---------- 1. regime ---------- */
function regimeOf(daily) {
  const b = clean(daily), n = b.length; if (n < 60) return { kind: 'unknown', reasons: ['Fewer than 60 daily candles.'] };
  const c = b.map((x) => x.c), last = c[n - 1];
  const s20 = sma(c, 20), s50 = sma(c, 50), s200 = sma(c, 200);
  const s20p = sma(c, 20, n - 6), s50p = sma(c, 50, n - 11);
  const slope20 = s20p ? (s20 / s20p - 1) * 100 : 0, slope50 = s50p ? (s50 / s50p - 1) * 100 : 0;
  const rets = []; for (let i = n - 20; i < n; i++) rets.push(Math.log(c[i] / c[i - 1]));
  const mean = rets.reduce((a, x) => a + x, 0) / rets.length, rv20 = Math.sqrt(rets.reduce((a, x) => a + (x - mean) ** 2, 0) / rets.length) * Math.sqrt(252) * 100;
  const rets60 = []; for (let i = n - 60; i < n; i++) rets60.push(Math.log(c[i] / c[i - 1]));
  const m60 = rets60.reduce((a, x) => a + x, 0) / 60, rv60 = Math.sqrt(rets60.reduce((a, x) => a + (x - m60) ** 2, 0) / 60) * Math.sqrt(252) * 100;
  let crosses = 0; for (let i = n - 20; i < n; i++) { const a = sma(c, 20, i), p = sma(c, 20, i - 1); if (a != null && p != null && (c[i] - a) * (c[i - 1] - p) < 0) crosses += 1; }
  const a14 = atr(b), atrPct = a14 ? a14 / last * 100 : null;
  let kind, reasons = [];
  if (rv20 >= 28 || (rv60 && rv20 >= rv60 * 1.6 && rv20 >= 20)) { kind = 'high-vol'; reasons.push(`Realized volatility ${r1(rv20)}% annualized (60-day ${r1(rv60)}%): a high-volatility regime, where moves overshoot and reverse.`); }
  else if (last > s20 && s20 > s50 && slope20 > 0.3 && crosses <= 3) { kind = 'trend-up'; reasons.push(`Price above a rising 20-day average (${r2(slope20)}% in 5 sessions), 20 above 50, only ${crosses} crosses of the 20-day in a month: trend up.`); }
  else if (last < s20 && s20 < s50 && slope20 < -0.3 && crosses <= 3) { kind = 'trend-down'; reasons.push(`Price below a falling 20-day average (${r2(slope20)}% in 5 sessions), 20 below 50: trend down.`); }
  else { kind = 'range'; reasons.push(`${crosses} crosses of the 20-day average in a month with a flat slope (${r2(slope20)}%): a range, where extremes mean-revert.`); }
  return { kind, last: r2(last), sma20: r2(s20), sma50: r2(s50), sma200: s200 != null ? r2(s200) : null, slope20: r2(slope20), slope50: r2(slope50), rv20: r1(rv20), rv60: r1(rv60), crosses, atrPct: atrPct != null ? r2(atrPct) : null, rsi14: r1(rsi(c) || 50), reasons };
}

/* ---------- 4. base rates from SPY's own history ---------- */
function baseRates(daily) {
  const b = clean(daily), n = b.length; if (n < 120) return null;
  const up = (i) => b[i].c > b[i - 1].c;
  let streak = 0; const dir = up(n - 1) ? 1 : -1; for (let i = n - 1; i > 0 && (up(i) ? 1 : -1) === dir; i--) streak += 1;
  // after the same streak, how often did the next session close up?
  let same = 0, nextUp = 0, next5 = [];
  for (let i = 20; i < n - 1; i++) {
    let s = 0; const d = up(i) ? 1 : -1; for (let k = i; k > 0 && (up(k) ? 1 : -1) === d; k--) s += 1;
    if (s === streak && d === dir) { same += 1; if (up(i + 1)) nextUp += 1; if (i + 5 < n) next5.push(b[i + 5].c / b[i].c - 1); }
  }
  // gap follow-through: when SPY gapped the way it gapped today, did it close in the gap's direction?
  const gapPct = (b[n - 1].o / b[n - 2].c - 1) * 100; let gapN = 0, gapFollow = 0;
  if (Math.abs(gapPct) >= 0.3) for (let i = 1; i < n - 1; i++) { const g = (b[i].o / b[i - 1].c - 1) * 100; if (Math.sign(g) === Math.sign(gapPct) && Math.abs(g) >= 0.3) { gapN += 1; if (Math.sign(b[i].c - b[i].o) === Math.sign(gapPct)) gapFollow += 1; } }
  // position: closing at a 20-day high or low, what came next over 5 sessions
  const hi20 = Math.max(...b.slice(n - 20).map((x) => x.h)), lo20 = Math.min(...b.slice(n - 20).map((x) => x.l));
  const atHigh = b[n - 1].c >= hi20 * 0.998, atLow = b[n - 1].c <= lo20 * 1.002;
  let posN = 0, posSum = 0, posUp = 0;
  if (atHigh || atLow) for (let i = 20; i < n - 5; i++) { const h = Math.max(...b.slice(i - 19, i + 1).map((x) => x.h)), l = Math.min(...b.slice(i - 19, i + 1).map((x) => x.l)); if ((atHigh && b[i].c >= h * 0.998) || (atLow && b[i].c <= l * 1.002)) { posN += 1; const r = b[i + 5].c / b[i].c - 1; posSum += r; if (r > 0) posUp += 1; } }
  const allUp = (() => { let u = 0; for (let i = 1; i < n; i++) if (up(i)) u += 1; return u / (n - 1); })();
  return {
    sessions: n, anyDayUpPct: Math.round(allUp * 100),
    streak: { length: streak, dir, n: same, nextUpPct: same ? Math.round(nextUp / same * 100) : null, next5MeanPct: next5.length ? r2(next5.reduce((a, x) => a + x, 0) / next5.length * 100) : null },
    gap: Math.abs(gapPct) >= 0.3 ? { pct: r2(gapPct), n: gapN, followPct: gapN ? Math.round(gapFollow / gapN * 100) : null } : null,
    position: atHigh || atLow ? { at: atHigh ? '20-day high' : '20-day low', n: posN, next5UpPct: posN ? Math.round(posUp / posN * 100) : null, next5MeanPct: posN ? r2(posSum / posN * 100) : null } : null
  };
}

/* ---------- 2. the parts of the index ---------- */
function constituentRead(list) {
  const rows = (list || []).filter((x) => x && x.symbol && num(x.weight) > 0 && num(x.changePct) != null).map((x) => ({ ...x, weight: Number(x.weight), changePct: Number(x.changePct) }));
  if (!rows.length) return null;
  const totalW = rows.reduce((s, x) => s + x.weight, 0);
  const contrib = rows.map((x) => ({ symbol: x.symbol, weight: r3(x.weight), changePct: r2(x.changePct), contributionPct: r3(x.weight * x.changePct), pull: r2(x.weight * Math.abs(x.changePct) * Math.max(1, num(x.rvol, 1))), rvol: num(x.rvol), aboveVwap: x.aboveVwap == null ? null : !!x.aboveVwap, above20: x.above20 == null ? null : !!x.above20, earningsDays: num(x.earningsDays), catalyst: x.catalyst || null, memBias: x.memBias || null })).sort((a, b) => b.pull - a.pull);
  const weighted = contrib.reduce((s, x) => s + x.contributionPct, 0);
  const equal = rows.reduce((s, x) => s + x.changePct, 0) / rows.length;
  const adv = rows.filter((x) => x.changePct > 0).length, dec = rows.filter((x) => x.changePct < 0).length;
  const top5 = contrib.slice().sort((a, b) => Math.abs(b.contributionPct) - Math.abs(a.contributionPct)).slice(0, 5);
  const top5Share = Math.abs(weighted) > 1e-9 ? clamp(top5.reduce((s, x) => s + x.contributionPct, 0) / weighted, -3, 3) : 0;
  const leaders = contrib.filter((x) => x.changePct > 0).sort((a, b) => b.contributionPct - a.contributionPct).slice(0, 3), laggards = contrib.filter((x) => x.changePct < 0).sort((a, b) => a.contributionPct - b.contributionPct).slice(0, 3);
  const capVsEqual = weighted / Math.max(1e-9, totalW) - equal; // >0: the giants carry it, the average name does not
  const leadership = adv >= rows.length * 0.65 ? 'broad' : dec >= rows.length * 0.65 ? 'broad-down' : Math.abs(top5Share) >= 0.7 ? 'narrow' : 'mixed';
  const earningsSoon = contrib.filter((x) => x.earningsDays != null && x.earningsDays >= 0 && x.earningsDays <= 3).sort((a, b) => b.weight - a.weight);
  const score = clamp(tanh(weighted / Math.max(1e-9, totalW) / 0.6) * 0.7 + ((adv - dec) / rows.length) * 0.3, -1, 1);
  return { n: rows.length, weightCovered: r3(totalW), weightedChangePct: r3(weighted / Math.max(1e-9, totalW)), equalChangePct: r2(equal), capVsEqualPct: r2(capVsEqual), advancing: adv, declining: dec, top5Share: r2(top5Share), leadership, leaders, laggards, earningsSoon, score: r3(score), rows: contrib.slice(0, 25) };
}

/* ---------- 3. breadth, rotation, volatility, positioning, cross-asset ---------- */
function breadthRead(bd) {
  if (!bd || !(num(bd.n) > 0)) return null;
  const n = Number(bd.n), adv = num(bd.advancing, 0), dec = num(bd.declining, 0);
  const ad = (adv - dec) / n;
  const a20 = num(bd.above20Pct), a50 = num(bd.above50Pct), a200 = num(bd.above200Pct);
  const upV = num(bd.upVolume), dnV = num(bd.downVolume), volRatio = upV != null && dnV != null && upV + dnV > 0 ? (upV - dnV) / (upV + dnV) : null;
  const nh = num(bd.newHighs), nl = num(bd.newLows);
  let score = ad * 0.5; if (volRatio != null) score += volRatio * 0.3; if (a20 != null) score += ((a20 - 50) / 50) * 0.2;
  const thrust = adv / n >= 0.8, washout = dec / n >= 0.8;
  return { n, advancing: adv, declining: dec, adRatio: r2(ad), above20Pct: a20, above50Pct: a50, above200Pct: a200, volRatio: volRatio != null ? r2(volRatio) : null, newHighs: nh, newLows: nl, thrust, washout, score: r3(clamp(score, -1, 1)) };
}
function rotationRead(q) {
  if (!q) return null;
  const pick = (s) => (q[s] && num(q[s].changePct) != null ? Number(q[s].changePct) : null);
  const cyc = CYCLICALS.map(pick).filter((x) => x != null), def = DEFENSIVES.map(pick).filter((x) => x != null);
  if (cyc.length < 3 || def.length < 2) return null;
  const c = cyc.reduce((a, x) => a + x, 0) / cyc.length, d = def.reduce((a, x) => a + x, 0) / def.length;
  const spread = c - d;
  const sectors = [...CYCLICALS, ...DEFENSIVES].map((s) => ({ etf: s, changePct: pick(s), group: CYCLICALS.includes(s) ? 'cyclical' : 'defensive' })).filter((x) => x.changePct != null).sort((a, b) => b.changePct - a.changePct);
  const iwm = pick('IWM'), rsp = pick('RSP'), spy = pick('SPY'), qqq = pick('QQQ');
  return { cyclicalsPct: r2(c), defensivesPct: r2(d), spreadPct: r2(spread), sectors, smallCapsVsSpyPct: iwm != null && spy != null ? r2(iwm - spy) : null, equalVsCapPct: rsp != null && spy != null ? r2(rsp - spy) : null, qqqVsSpyPct: qqq != null && spy != null ? r2(qqq - spy) : null, score: r3(clamp(tanh(spread / 0.8), -1, 1)) };
}
function volatilityRead(vix, regime) {
  if (!vix || num(vix.level) == null) return null;
  const lvl = Number(vix.level), chg = num(vix.change, 0), rv = regime && regime.rv20 != null ? regime.rv20 : null;
  const premium = rv != null ? lvl - rv : null; // implied over realized: fear priced in
  let score = 0; const notes = [];
  if (chg <= -5) { score += 0.5; notes.push(`VIX down ${Math.abs(r1(chg))}% today: hedges coming off.`); } else if (chg >= 8) { score -= 0.6; notes.push(`VIX up ${r1(chg)}% today: hedges going on.`); }
  if (lvl >= 30) { score -= 0.3; notes.push(`VIX ${r1(lvl)}: stress; rallies are sold until it breaks back under 25.`); if (chg <= -8) { score += 0.6; notes.push('A VIX crush from stress levels is the classic turn.'); } }
  else if (lvl <= 13) { score += 0.1; notes.push(`VIX ${r1(lvl)}: complacent; small moves, and the air pocket risk grows the longer it stays here.`); }
  if (premium != null && premium >= 6) notes.push(`Implied volatility ${r1(premium)} points over realized: fear is overpriced, a tailwind for carry.`); else if (premium != null && premium <= -3) notes.push(`Realized above implied by ${r1(-premium)}: the market is moving more than options expect.`);
  const impliedDailyPct = lvl / Math.sqrt(252);
  return { level: r1(lvl), changePct: r1(chg), realized20: rv, premium: premium != null ? r1(premium) : null, impliedDailyMovePct: r2(impliedDailyPct), termSlope: num(vix.termSlope), score: r3(clamp(score, -1, 1)), notes };
}
function gammaRead(g, price) {
  if (!g) return null;
  const gex = num(g.gex ?? g.netGex ?? g.total), flip = num(g.flip ?? g.flipLevel ?? g.zeroGamma), cw = num(g.callWall), pw = num(g.putWall), px = num(price);
  const notes = []; let score = 0, regime = 'unknown';
  if (gex != null) { regime = gex >= 0 ? 'positive' : 'negative'; notes.push(gex >= 0 ? 'Dealers long gamma: they sell rallies and buy dips, which pins the index and dampens moves.' : 'Dealers short gamma: they chase moves, which widens the range in both directions.'); }
  if (flip != null && px != null) { if (px > flip) { score += 0.2; notes.push(`Above the gamma flip ${r2(flip)}: the supportive side of positioning.`); } else { score -= 0.3; notes.push(`Below the gamma flip ${r2(flip)}: moves accelerate; ${r2(flip)} is the line to reclaim.`); } }
  if (cw != null && px != null && cw > px) notes.push(`Call wall ${r2(cw)} (${r2((cw / px - 1) * 100)}% up): where upside tends to stall into expiration.`);
  if (pw != null && px != null && pw < px) notes.push(`Put wall ${r2(pw)} (${r2((1 - pw / px) * 100)}% down): where dip buying from hedges shows up.`);
  return { regime, gex, flip, callWall: cw, putWall: pw, score: r3(clamp(score, -1, 1)), notes };
}
function crossAssetRead(q) {
  if (!q) return null;
  const pick = (s) => (q[s] && num(q[s].changePct) != null ? Number(q[s].changePct) : null);
  const tlt = pick('TLT'), hyg = pick('HYG'), lqd = pick('LQD'), uup = pick('UUP'), gld = pick('GLD'), cper = pick('CPER'), btc = pick('IBIT') ?? pick('BITO');
  const parts = []; let score = 0, w = 0;
  if (hyg != null && lqd != null) { const credit = hyg - lqd; score += tanh(credit / 0.4) * 0.35; w += 0.35; parts.push({ key: 'credit', label: 'Credit (HYG vs LQD)', value: r2(credit), read: credit > 0.1 ? 'risk appetite in credit' : credit < -0.1 ? 'credit is de-risking' : 'quiet' }); }
  if (tlt != null) { score += tanh(tlt / 0.8) * 0.2; w += 0.2; parts.push({ key: 'rates', label: 'Bonds (TLT)', value: r2(tlt), read: tlt > 0.4 ? 'yields falling: a tailwind for long duration equities' : tlt < -0.4 ? 'yields rising: pressure on growth multiples' : 'steady' }); }
  if (uup != null) { score -= tanh(uup / 0.4) * 0.15; w += 0.15; parts.push({ key: 'dollar', label: 'Dollar (UUP)', value: r2(uup), read: uup > 0.3 ? 'dollar bid: headwind for multinationals and risk' : uup < -0.3 ? 'dollar offered: tailwind' : 'flat' }); }
  if (cper != null && gld != null) { const cg = cper - gld; score += tanh(cg / 1) * 0.15; w += 0.15; parts.push({ key: 'growth', label: 'Copper vs gold', value: r2(cg), read: cg > 0.5 ? 'growth over fear' : cg < -0.5 ? 'fear over growth' : 'balanced' }); }
  if (btc != null) { score += tanh(btc / 3) * 0.15; w += 0.15; parts.push({ key: 'crypto', label: 'Bitcoin (ETF)', value: r2(btc), read: btc > 2 ? 'speculative appetite on' : btc < -2 ? 'speculative appetite off' : 'quiet' }); }
  if (!parts.length) return null;
  return { parts, score: r3(clamp(score / Math.max(0.3, w), -1, 1)) };
}
function intradayRead(bars, prevClose) {
  const b = clean(bars); if (b.length < 6) return null;
  const o = b[0].o, c = b[b.length - 1].c, h = Math.max(...b.map((x) => x.h)), l = Math.min(...b.map((x) => x.l));
  let pv = 0, vv = 0; for (const x of b) { const tp = (x.h + x.l + x.c) / 3; pv += tp * x.v; vv += x.v; }
  const vwap = vv > 0 ? pv / vv : (o + c) / 2;
  const orh = Math.max(...b.filter((x) => x.t < b[0].t + 30 * 60_000).map((x) => x.h)), orl = Math.min(...b.filter((x) => x.t < b[0].t + 30 * 60_000).map((x) => x.l));
  const range = h - l, loc = range > 0 ? (c - l) / range : 0.5;
  const gap = num(prevClose) ? (o / Number(prevClose) - 1) * 100 : null;
  let score = 0; const notes = [];
  if (c > vwap) { score += 0.4; notes.push(`Above VWAP ${r2(vwap)}.`); } else { score -= 0.4; notes.push(`Below VWAP ${r2(vwap)}.`); }
  if (c > orh) { score += 0.3; notes.push(`Above the opening-range high ${r2(orh)}.`); } else if (c < orl) { score -= 0.3; notes.push(`Below the opening-range low ${r2(orl)}.`); } else notes.push(`Inside the opening range ${r2(orl)} to ${r2(orh)}.`);
  score += (loc - 0.5) * 0.6;
  return { open: r2(o), last: r2(c), high: r2(h), low: r2(l), vwap: r2(vwap), orh: r2(orh), orl: r2(orl), closeLoc: r3(loc), gapPct: gap != null ? r2(gap) : null, score: r3(clamp(score, -1, 1)), notes };
}

/* ---------- 5. the composite ---------- */
function compose(input = {}) {
  const now = input.now || Date.now();
  const daily = clean(input.spyDaily);
  const regime = regimeOf(daily);
  const rates = baseRates(daily);
  const cons = constituentRead(input.constituents);
  const breadth = breadthRead(input.breadth);
  const rotation = rotationRead(input.quotes);
  const vol = volatilityRead(input.vix, regime);
  const gamma = gammaRead(input.gamma, input.quotes && input.quotes.SPY ? input.quotes.SPY.last : (daily.length ? daily[daily.length - 1].c : null));
  const cross = crossAssetRead(input.quotes);
  const intra = intradayRead(input.spyIntraday, daily.length > 1 ? daily[daily.length - (input.spyDailyIncludesToday ? 2 : 1)].c : null);
  const cal = input.calendar || null;
  const sent = input.sentiment || null;
  const kind = regime.kind;
  const mult = (key) => {
    if (kind === 'trend-up' || kind === 'trend-down') return { trend: 1.3, momentum: 1.2, meanrev: 0.5, breadth: 1.1, gamma: 0.8, vol: 0.9 }[key] || 1;
    if (kind === 'range') return { trend: 0.6, momentum: 0.5, meanrev: 1.4, breadth: 0.8, gamma: 1.3, vol: 1 }[key] || 1;
    if (kind === 'high-vol') return { trend: 0.7, momentum: 0.6, meanrev: 1.1, breadth: 1, gamma: 1.2, vol: 1.4 }[key] || 1;
    return 1;
  };
  const S = []; // { key, label, score, wDay, wSwing, detail, tone, group }
  const add = (key, label, score, wDay, wSwing, detail, group = 'other') => { if (score == null || !Number.isFinite(score)) return; S.push({ key, label, score: r3(clamp(score, -1, 1)), wDay: r2(wDay), wSwing: r2(wSwing), detail, tone: score > 0.15 ? 'up' : score < -0.15 ? 'down' : 'flat', group }); };
  // trend and momentum from SPY itself
  if (regime.kind !== 'unknown') {
    const c = daily.map((x) => x.c), n = c.length, last = c[n - 1];
    const trendScore = clamp(((last > regime.sma20 ? 0.4 : -0.4) + (regime.sma20 > regime.sma50 ? 0.3 : -0.3) + tanh(regime.slope20 / 1.5) * 0.3), -1, 1);
    add('trend', 'Trend (20/50-day)', trendScore, 0.8 * mult('trend'), 1.5 * mult('trend'), `${last > regime.sma20 ? 'Above' : 'Below'} the 20-day ${regime.sma20}; 20-day ${regime.sma20 > regime.sma50 ? 'above' : 'below'} the 50-day ${regime.sma50}; 20-day slope ${regime.slope20}% per 5 sessions.`, 'spy');
    const r5 = n > 6 ? (last / c[n - 6] - 1) * 100 : 0, rs = regime.rsi14;
    let momentum = tanh(r5 / 2) * 0.6;
    if (kind === 'range' || kind === 'high-vol') { if (rs >= 70) momentum -= 0.5; else if (rs <= 30) momentum += 0.5; }
    else { if (rs >= 80) momentum -= 0.2; else if (rs <= 25) momentum += 0.2; }
    add('momentum', kind === 'range' ? 'Momentum (mean-reverting in a range)' : 'Momentum (5-day, RSI)', momentum, 0.8 * mult('momentum'), 0.8 * mult('momentum'), `5-session return ${r2(r5)}%, RSI(14) ${rs}${(kind === 'range' || kind === 'high-vol') && (rs >= 70 || rs <= 30) ? ': an extreme that mean-reverts in this regime' : ''}.`, 'spy');
  }
  if (intra) add('intraday', 'Today inside SPY', intra.score, 1.2, 0, intra.notes.join(' '), 'spy');
  if (cons) add('heavyweights', `Heavyweights (${cons.n} names, cap-weighted)`, cons.score, 1.5, 1.0, `Weighted change ${cons.weightedChangePct}% vs equal-weighted ${cons.equalChangePct}%; ${cons.advancing} up / ${cons.declining} down; top five carry ${Math.round(cons.top5Share * 100)}% of the move (${cons.leadership}).`, 'parts');
  if (cons && (cons.leadership === 'narrow' || Math.abs(cons.capVsEqualPct) >= 0.6)) add('leadership', 'Leadership quality', cons.leadership === 'narrow' ? -0.5 * Math.sign(cons.weightedChangePct || 1) : -0.3 * Math.sign(cons.capVsEqualPct), 0.5, 0.8, cons.leadership === 'narrow' ? 'A narrow move: five names carry it, the rest do not confirm. Fragile either way.' : `Cap-weighted and equal-weighted disagree by ${cons.capVsEqualPct}%: the giants and the average stock are telling different stories.`, 'parts');
  if (breadth) add('breadth', `Breadth (${breadth.n} stocks)`, breadth.score, 1.2 * mult('breadth'), 1.2 * mult('breadth'), `${breadth.advancing} advancing / ${breadth.declining} declining${breadth.volRatio != null ? `, up-volume share ${Math.round((breadth.volRatio + 1) / 2 * 100)}%` : ''}${breadth.above20Pct != null ? `, ${breadth.above20Pct}% above their 20-day` : ''}${breadth.thrust ? '. Breadth thrust: 80%+ advancing, the kind of day that starts legs higher' : breadth.washout ? '. Washout: 80%+ declining, the kind of day that ends legs lower' : ''}.`, 'internals');
  if (rotation) add('rotation', 'Sector rotation', rotation.score, 0.7, 1.0, `Cyclicals ${rotation.cyclicalsPct}% vs defensives ${rotation.defensivesPct}%${rotation.smallCapsVsSpyPct != null ? `; small caps ${rotation.smallCapsVsSpyPct >= 0 ? '+' : ''}${rotation.smallCapsVsSpyPct}% vs SPY` : ''}${rotation.equalVsCapPct != null ? `; equal-weight ${rotation.equalVsCapPct >= 0 ? '+' : ''}${rotation.equalVsCapPct}% vs SPY` : ''}.`, 'internals');
  if (rotation && rotation.equalVsCapPct != null) add('equalweight', 'Equal weight vs cap weight', clamp(tanh(rotation.equalVsCapPct / 0.5) * 0.6, -1, 1), 0.4, 0.6, rotation.equalVsCapPct > 0.2 ? 'The average stock is outpacing the index: healthy participation.' : rotation.equalVsCapPct < -0.2 ? 'The index is outpacing the average stock: the giants are doing the work.' : 'Participation in line with the index.', 'internals');
  if (vol) add('volatility', 'Volatility (VIX)', vol.score, 1.0 * mult('vol'), 0.8 * mult('vol'), vol.notes.join(' '), 'vol');
  if (gamma) add('gamma', 'Dealer gamma (SPY options)', gamma.score, 0.8 * mult('gamma'), 0.4, gamma.notes.join(' '), 'vol');
  if (cross) add('crossasset', 'Cross-asset risk appetite', cross.score, 0.5, 0.8, cross.parts.map((p) => `${p.label} ${p.value >= 0 ? '+' : ''}${p.value}%: ${p.read}`).join('; ') + '.', 'macro');
  if (sent && num(sent.score) != null) add('sentiment', 'Sentiment and positioning', clamp(Number(sent.score) * (sent.crowdedLong ? -0.5 : 0.6), -1, 1), 0.3, 0.5, `${sent.label || 'composite'} ${Math.round(Number(sent.score) * 100)}${sent.crowdedLong ? '; crowded long, a contrarian weight' : ''}.`, 'macro');
  if (rates && rates.streak.nextUpPct != null && rates.streak.n >= 15) { const edge = (rates.streak.nextUpPct - rates.anyDayUpPct) / 50; add('baserate', `Base rate after ${rates.streak.length} ${rates.streak.dir > 0 ? 'up' : 'down'} session${rates.streak.length === 1 ? '' : 's'}`, clamp(edge, -1, 1), 0.6, 0.3, `In ${rates.streak.n} past cases SPY closed up the next session ${rates.streak.nextUpPct}% of the time (any session: ${rates.anyDayUpPct}%).`, 'history'); }
  if (rates && rates.gap && rates.gap.followPct != null && rates.gap.n >= 15) add('gaprate', `Gap ${rates.gap.pct > 0 ? 'up' : 'down'} ${Math.abs(rates.gap.pct)}%`, clamp(((rates.gap.followPct - 50) / 50) * Math.sign(rates.gap.pct), -1, 1), 0.5, 0, `Gaps like this one closed in the gap's direction ${rates.gap.followPct}% of the time (${rates.gap.n} cases).`, 'history');
  // composites
  const comp = (wkey) => { let s = 0, w = 0, agree = 0; for (const x of S) { const wt = x[wkey]; if (!(wt > 0)) continue; s += x.score * wt; w += wt; } if (!(w > 0)) return { bias: 0, agree: 0, coverage: 0 }; const bias = s / w; for (const x of S) { const wt = x[wkey]; if (!(wt > 0)) continue; if (Math.sign(x.score) === Math.sign(bias) || Math.abs(x.score) < 0.1) agree += wt; } return { bias, agree: agree / w, coverage: w }; };
  const d = comp('wDay'), s = comp('wSwing');
  const eventRisk = cal && num(cal.risk) != null ? Number(cal.risk) : 0;
  const maxDay = 9, maxSwing = 9;
  const confidence = (c, maxW) => Math.round(clamp((0.55 * c.agree + 0.45 * Math.min(1, c.coverage / maxW)) * (1 - 0.35 * eventRisk) * (kind === 'high-vol' ? 0.8 : 1), 0, 1) * 100);
  const label = (b) => (b >= 40 ? 'STRONG BULLISH' : b >= 15 ? 'BULLISH' : b <= -40 ? 'STRONG BEARISH' : b <= -15 ? 'BEARISH' : 'NEUTRAL');
  const day = { bias: Math.round(clamp(d.bias, -1, 1) * 100), confidence: confidence(d, maxDay), agreement: Math.round(d.agree * 100), label: label(Math.round(d.bias * 100)) };
  const swing = { bias: Math.round(clamp(s.bias, -1, 1) * 100), confidence: confidence(s, maxSwing), agreement: Math.round(s.agree * 100), label: label(Math.round(s.bias * 100)) };
  // what would flip it: the heaviest opposing signals, and the levels
  const opposing = S.filter((x) => Math.sign(x.score) === -Math.sign(d.bias || 1) && Math.abs(x.score) >= 0.2).sort((a, b) => Math.abs(b.score * b.wDay) - Math.abs(a.score * a.wDay)).slice(0, 3);
  const flips = opposing.map((x) => `${x.label} is against the read (${x.detail})`);
  if (regime.sma20 != null) flips.push(`${day.bias >= 0 ? 'A close below' : 'A close above'} the 20-day average ${regime.sma20} would change the trend leg.`);
  if (gamma && gamma.flip != null) flips.push(`${(input.quotes && input.quotes.SPY && input.quotes.SPY.last) > gamma.flip ? 'Losing' : 'Reclaiming'} the gamma flip ${gamma.flip} changes how moves behave.`);
  const expected = { atrPct: regime.atrPct, impliedDailyPct: vol ? vol.impliedDailyMovePct : null };
  return { ok: true, asOf: now, regime, day, swing, signals: S, constituents: cons, breadth, rotation, volatility: vol, gamma, crossAsset: cross, intraday: intra, baseRates: rates, calendar: cal, sentiment: sent, expectedMove: expected, flips, disclaimer: 'Recorded conditions and their historical base rates, read for education. Not advice.' };
}

/* ---------- 6. calibration: every forecast is scored against what SPY then did ---------- */
function createCalibration({ store, now = Date.now, keep = 400 } = {}) {
  let state = null;
  async function load() { if (!state) { try { const v = store ? await store.read() : null; state = v && typeof v === 'object' && v.forecasts ? v : { forecasts: {} }; } catch (_) { state = { forecasts: {} }; } } return state; }
  async function save() { if (store) { try { await store.write(state); } catch (_) { /* best effort */ } } }
  async function record({ date, dayBias, swingBias, dayConfidence, swingConfidence, spyClose }) {
    await load();
    if (!date) return;
    const f = state.forecasts[date] || {};
    state.forecasts[date] = { ...f, dayBias, swingBias, dayConfidence, swingConfidence, spyClose, at: now() };
    const keys = Object.keys(state.forecasts).sort(); while (keys.length > keep) delete state.forecasts[keys.shift()];
    await save();
  }
  /* settle with the daily closes: next-session return for the day call, five-session return for the swing call */
  async function settle(daily) {
    await load();
    const b = clean(daily); if (b.length < 7) return;
    const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
    const key = (ms) => { const p = {}; for (const x of ET.formatToParts(new Date(ms))) p[x.type] = x.value; return `${p.year}-${p.month}-${p.day}`; };
    const idx = new Map(b.map((x, i) => [key(x.t), i]));
    let changed = false;
    for (const [date, f] of Object.entries(state.forecasts)) {
      const i = idx.get(date); if (i == null) continue;
      if (f.ret1 == null && i + 1 < b.length) { f.ret1 = r2((b[i + 1].c / b[i].c - 1) * 100); f.hit1 = Math.abs(f.dayBias) >= 15 ? Math.sign(f.dayBias) === Math.sign(f.ret1) : null; changed = true; }
      if (f.ret5 == null && i + 5 < b.length) { f.ret5 = r2((b[i + 5].c / b[i].c - 1) * 100); f.hit5 = Math.abs(f.swingBias) >= 15 ? Math.sign(f.swingBias) === Math.sign(f.ret5) : null; changed = true; }
    }
    if (changed) await save();
  }
  async function summary() {
    await load();
    const all = Object.entries(state.forecasts).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, f]) => ({ date, ...f }));
    const score = (field, hitField, retField) => {
      const rows = all.filter((f) => f[hitField] != null);
      const calls = rows.length, hits = rows.filter((f) => f[hitField]).length;
      const brier = rows.length ? rows.reduce((s, f) => { const p = 0.5 + clamp(f[field], -100, 100) / 200; const y = f[retField] > 0 ? 1 : 0; return s + (p - y) ** 2; }, 0) / rows.length : null;
      const last30 = rows.slice(-30); const h30 = last30.filter((f) => f[hitField]).length;
      return { calls, hits, hitRatePct: calls ? Math.round(hits / calls * 100) : null, brier: brier != null ? r3(brier) : null, last30: { calls: last30.length, hitRatePct: last30.length ? Math.round(h30 / last30.length * 100) : null } };
    };
    return { forecasts: all.length, day: score('dayBias', 'hit1', 'ret1'), swing: score('swingBias', 'hit5', 'ret5'), recent: all.slice(-10).reverse() };
  }
  return { load, record, settle, summary };
}

module.exports = { compose, regimeOf, baseRates, constituentRead, breadthRead, rotationRead, volatilityRead, gammaRead, crossAssetRead, intradayRead, createCalibration, CYCLICALS, DEFENSIVES };
